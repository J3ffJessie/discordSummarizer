const {
  joinVoiceChannel,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  createAudioResource,
  StreamType,
  AudioPlayer,
  AudioPlayerStatus,
} = require('@discordjs/voice');
const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { createChatProvider, resolveConfig } = require('../providers');
const codeExecutionService = require('./codeExecutionService');
const Groq = require('groq-sdk');
const OpusScript = require('opusscript');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_QUESTIONS = 8;
// Each leetcode question can take up to MAX_CODE_WAIT_MS (10 min) of code-wait time
// alone, on top of the voice discussion — far heavier than a spoken Q&A turn, so it gets a
// much smaller cap.
const MAX_CODING_QUESTIONS = 2;
const MAX_ANSWER_WAIT_MS = 65000;
const MIN_ANSWER_CHARS = 5;
const ANSWER_SILENCE_MS = 3000; // wait for this long a pause before treating the answer as done
const MAX_TTS_ATTEMPTS = 3;
const TTS_RETRY_BASE_MS = 500; // exponential backoff: 500ms, 1000ms, ...
const VOICE_JOIN_TIMEOUT_MS = 5 * 60 * 1000; // how long to wait for the candidate to join before cancelling
const VOICE_JOIN_POLL_MS = 1000;
const MAX_CODE_WAIT_MS = 10 * 60 * 1000; // how long to wait for a code submission before moving on
const INTERVIEW_SUBMIT_CODE_BUTTON_ID = 'interview_submit_code';
const INTERVIEW_RUN_CODE_BUTTON_ID = 'interview_run_code';
// The first N generated testCases double as the visible "sample" set a candidate can Run
// against before Submitting — mirrors LeetCode's examples-vs-hidden-tests split. The prompt
// requires at least 4 testCases, so slicing this many is always safe.
const SAMPLE_TEST_CASE_COUNT = 2;
const MAX_SAMPLE_RUNS = 3; // caps Judge0 load and how long a candidate can iterate on one question

const DEFAULT_LANGUAGE = 'en';

// code → { name, voice }. `voice` must be a valid Microsoft Edge TTS neural voice.
const LANGUAGES = {
  en: { name: 'English', voice: 'en-US-AriaNeural' },
  es: { name: 'Spanish', voice: 'es-ES-ElviraNeural' },
  fr: { name: 'French', voice: 'fr-FR-DeniseNeural' },
  de: { name: 'German', voice: 'de-DE-KatjaNeural' },
  it: { name: 'Italian', voice: 'it-IT-ElsaNeural' },
  pt: { name: 'Portuguese', voice: 'pt-BR-FranciscaNeural' },
  ja: { name: 'Japanese', voice: 'ja-JP-NanamiNeural' },
  ko: { name: 'Korean', voice: 'ko-KR-SunHiNeural' },
  zh: { name: 'Chinese (Mandarin)', voice: 'zh-CN-XiaoxiaoNeural' },
  hi: { name: 'Hindi', voice: 'hi-IN-SwaraNeural' },
  ar: { name: 'Arabic', voice: 'ar-SA-ZariyahNeural' },
  ru: { name: 'Russian', voice: 'ru-RU-SvetlanaNeural' },
};

function getLanguage(code) {
  return LANGUAGES[code] || LANGUAGES[DEFAULT_LANGUAGE];
}

function questionCountFor(style) {
  return style === 'leetcode' ? MAX_CODING_QUESTIONS : MAX_QUESTIONS;
}

// The model's "JSON" occasionally embeds raw newline/tab characters inside string values
// (e.g. a multi-paragraph "prompt" field) instead of escaping them as \n, which JSON.parse
// rejects as an "unterminated string". Escape control characters found inside string literals
// before parsing, tracking quote/escape state so we don't touch structural whitespace.
function repairJsonControlChars(str) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (const ch of str) {
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString && ch === '\n') { result += '\\n'; continue; }
    if (inString && ch === '\r') { result += '\\r'; continue; }
    if (inString && ch === '\t') { result += '\\t'; continue; }
    result += ch;
  }
  return result;
}

function parseJsonResponse(raw) {
  const stripped = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    const repaired = repairJsonControlChars(stripped);
    try {
      return JSON.parse(repaired);
    } catch {
      // Last resort: strip trailing commas before a closing brace/bracket, another common
      // model slip-up (e.g. a trailing comma after the last testCases entry).
      return JSON.parse(repaired.replace(/,(\s*[}\]])/g, '$1'));
    }
  }
}

const MAX_JSON_GEN_ATTEMPTS = 2;
const MAX_PROBLEM_GEN_ATTEMPTS = 2; // regenerate the whole problem if its reference solution doesn't actually run

// Groq's SDK doesn't unwrap the response body before attaching it to the thrown error, so
// `err.error` ends up as `{ error: { message, type, code, failed_generation } }` — one level
// deeper than the `{ message, type, code, ... }` shape you'd expect. Reach past that either way.
function groqErrorDetail(err) {
  return err?.error?.error || err?.error || null;
}

class InterviewService {
  constructor(client, transcriptionService, guildConfigService) {
    this.client = client;
    this.transcriptionService = transcriptionService;
    this.gcs = guildConfigService;
    this.sessions = new Map();
    this.players = new Map();
    this.pendingSetups = new Map(); // userId → { style, attachment, expiresAt }
  }

  setPendingSetup(userId, { attachment = null } = {}) {
    this.pendingSetups.set(userId, {
      style: 'behavioral',
      language: DEFAULT_LANGUAGE,
      codeLanguage: 'javascript',
      attachment,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
  }

  updatePendingStyle(userId, style) {
    const setup = this.pendingSetups.get(userId);
    if (setup) setup.style = style;
  }

  updatePendingLanguage(userId, language) {
    const setup = this.pendingSetups.get(userId);
    if (setup) setup.language = language;
  }

  updatePendingCodeLanguage(userId, codeLanguage) {
    const setup = this.pendingSetups.get(userId);
    if (setup) setup.codeLanguage = codeLanguage;
  }

  getPendingSetup(userId) {
    const setup = this.pendingSetups.get(userId);
    if (!setup) return null;
    if (Date.now() > setup.expiresAt) {
      this.pendingSetups.delete(userId);
      return null;
    }
    return setup;
  }

  clearPendingSetup(userId) {
    this.pendingSetups.delete(userId);
  }

  async parseJobDescription(text, attachment) {
    if (attachment) {
      const res = await fetch(attachment.url);
      const buffer = Buffer.from(await res.arrayBuffer());

      const contentType = attachment.contentType || '';
      const name = (attachment.name || '').toLowerCase();

      if (contentType.includes('pdf') || name.endsWith('.pdf')) {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(buffer);
        const result = data.text.trim();
        if (!result) throw new Error('Could not extract text from PDF.');
        return result;
      }

      if (
        contentType.includes('wordprocessingml') ||
        contentType.includes('msword') ||
        name.endsWith('.docx') ||
        name.endsWith('.doc')
      ) {
        const mammoth = require('mammoth');
        const { value } = await mammoth.extractRawText({ buffer });
        const result = value.trim();
        if (!result) throw new Error('Could not extract text from DOCX.');
        return result;
      }

      throw new Error('Unsupported file type. Please upload a PDF or DOCX file.');
    }

    if (text) {
      const result = text.trim();
      if (!result) throw new Error('Job description cannot be empty.');
      return result;
    }

    throw new Error('Please provide a job description or attach a PDF/DOCX file.');
  }

  _styleInstructions(style) {
    switch (style) {
      case 'technical':
        return 'Use a technical interview style — assess specific skills, knowledge, and problem-solving ability. Ask about tools, technologies, architecture decisions, and concrete technical challenges.';
      case 'conversational':
        return 'Use a relaxed, conversational style focused on culture fit and personality. Ask open-ended questions about motivations, working preferences, team dynamics, and career goals.';
      case 'case_based':
        return 'Use a case-based interview style — present realistic business or technical scenarios and ask the candidate how they would approach or solve them.';
      case 'leetcode':
        return 'Use a LeetCode-style technical coding interview — present algorithmic coding problems and evaluate the candidate\'s written solution and their verbal explanation of it.';
      case 'behavioral':
      default:
        return 'Use a behavioral interview style — ask STAR-method questions (Situation, Task, Action, Result) about past experiences and how the candidate handled specific situations.';
    }
  }

  // Translates a fixed English prompt (intro/retry lines) into the interview language.
  // Falls back to the original English text if translation fails.
  async _localize(text, language, guildId) {
    if (!language || language === DEFAULT_LANGUAGE) return text;
    try {
      const guildConfig = this.gcs?.getConfig(guildId) || null;
      const provider = createChatProvider('summ', guildConfig);
      const translated = await provider.chat(
        `Translate the user's message into ${getLanguage(language).name}. Return ONLY the translated text — no quotes, preamble, or explanation.`,
        text,
        { max_tokens: 200, temperature: 0.3 }
      );
      return translated?.trim() || text;
    } catch (err) {
      console.warn('[interview] Localization failed, using English fallback:', err?.message);
      return text;
    }
  }

  async generateQuestion(jdText, history, guildId, company = null, style = 'behavioral', language = DEFAULT_LANGUAGE) {
    const guildConfig = this.gcs?.getConfig(guildId) || null;
    const provider = createChatProvider('summ', guildConfig);
    const truncatedJd = jdText.substring(0, 3000);
    const companyContext = company ? ` The candidate is interviewing at: ${company}.` : '';
    const styleInstructions = this._styleInstructions(style);
    const languageInstruction = language === DEFAULT_LANGUAGE ? '' : ` Ask the question in ${getLanguage(language).name}.`;

    const systemPrompt = history.length === 0
      ? `You are a professional job interviewer conducting a voice interview.${companyContext} ${styleInstructions}${languageInstruction} Based on the job description, ask a single concise opening interview question directly relevant to the role. Keep it short — one sentence, no multi-part questions. Return ONLY the question — no preamble, numbering, or explanation.`
      : `You are a professional job interviewer conducting a voice interview.${companyContext} ${styleInstructions}${languageInstruction} Based on the job description and prior Q&A history, ask a single concise follow-up question that probes deeper into the candidate's experience. Keep it short — one sentence, no multi-part questions. Return ONLY the question — no preamble, numbering, or explanation.`;

    return await provider.chat(
      systemPrompt,
      JSON.stringify({ job_description: truncatedJd, conversation_history: history }),
      { max_tokens: 256, temperature: 0.7 }
    );
  }

  // Requests a JSON-mode completion and parses it, salvaging or retrying when Groq's own
  // server-side JSON validation rejects the generation (code: json_validate_failed) — a
  // stochastic hiccup on complex generations, not a fatal error. Groq still hands back the
  // (near-valid) text it generated as `failed_generation`, so try repairing/parsing that
  // first since it costs no extra API call; only fall back to a fresh attempt if that fails.
  async _createJsonCompletion(groq, requestParams, attempt = 1) {
    try {
      const completion = await groq.chat.completions.create(requestParams);
      return parseJsonResponse(completion.choices[0].message.content);
    } catch (err) {
      const detail = groqErrorDetail(err);
      if (detail?.failed_generation) {
        try {
          return parseJsonResponse(detail.failed_generation);
        } catch { /* fall through to retry/throw below */ }
      }
      if (detail?.code === 'json_validate_failed' && attempt < MAX_JSON_GEN_ATTEMPTS) {
        return this._createJsonCompletion(groq, requestParams, attempt + 1);
      }
      throw err;
    }
  }

  // Runs the model's own reference solution (always JS, regardless of the candidate's chosen
  // language, to keep verification to a single harness) against the testCases it generated
  // alongside the problem. The model hand-writes "expected" values from reasoning, not
  // execution, so they occasionally don't match what the described logic actually produces —
  // this catches that by trusting the executed output instead and correcting testCases in
  // place. Returns false only when the reference solution itself doesn't run cleanly (every
  // case erroring), which means the generation can't be trusted at all and should be redone;
  // a Judge0 hiccup here is swallowed rather than blocking problem generation on it.
  async _verifyTestCases(problem) {
    if (!problem?.referenceSolution || !Array.isArray(problem.testCases) || !problem.testCases.length) {
      return true;
    }

    let verification;
    try {
      verification = await codeExecutionService.runTestCases(
        problem.referenceSolution,
        'javascript',
        problem.testCases,
        problem.functionName
      );
    } catch (err) {
      console.warn('[interview] Could not verify generated test cases (execution service unavailable):', err?.message);
      return true;
    }

    if (verification.results.some((r) => r.error)) return false;

    verification.results.forEach((r, i) => {
      if (!r.pass) problem.testCases[i].expected = r.actual;
    });
    return true;
  }

  // Generates a structured LeetCode-style problem: prompt/examples/constraints/signature plus
  // language-agnostic test cases (plain JSON args/expected), which codeExecutionService later
  // serializes per the candidate's chosen coding language. Follows the same direct-Groq JSON
  // pattern as generateSummary below, since this needs structured output rather than prose.
  // Also requests a JS reference solution used only to verify/correct the testCases (see
  // _verifyTestCases) — stripped from the object before it's returned.
  async generateCodingProblem(jdText, history, guildId, company = null, codeLanguage = 'javascript', language = DEFAULT_LANGUAGE, attempt = 1) {
    const guildConfig = this.gcs?.getConfig(guildId) || null;
    const { apiKey } = resolveConfig('summ', guildConfig);
    const groq = new Groq({ apiKey });
    const truncatedJd = jdText.substring(0, 3000);
    const companyContext = company ? ` The candidate is interviewing at: ${company}.` : '';
    const priorTitles = history.map((h) => h.question).join('; ');
    const avoidRepeats = priorTitles ? ` Do not repeat or closely resemble these previously asked problems: ${priorTitles}.` : '';
    const languageLabel = codeLanguage.charAt(0).toUpperCase() + codeLanguage.slice(1);

    const problem = await this._createJsonCompletion(groq, {
      model: 'openai/gpt-oss-120b',
      max_tokens: 4096,
      temperature: 0.7,
      reasoning_effort: 'low',
      reasoning_format: 'hidden',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a technical interviewer writing a single LeetCode-style algorithmic coding problem, informed by the given job description where relevant.${companyContext}${avoidRepeats} The candidate will write their solution in ${languageLabel}. Return ONLY valid JSON with this exact shape: { "title": <string>, "prompt": <string, the full problem statement>, "examples": [<string>, ...], "constraints": [<string>, ...], "functionName": <string, a valid ${languageLabel} identifier>, "functionSignature": <string, the function/method signature in ${languageLabel} the candidate should implement>, "testCases": [{ "input": [<arg1>, <arg2>, ...], "expected": <value> }, ...], "referenceSolution": <string, a correct, working JavaScript function — regardless of what language the candidate will use — that solves the problem, declared with the exact same name as "functionName", used only to verify the testCases> }. Provide at least 4 testCases covering typical cases and at least one edge case. Every "input" array's values and every "expected" value must be plain JSON types only — numbers, strings, booleans, or flat arrays of those (no nested objects or nested arrays). The referenceSolution must actually run correctly against every testCase you provide — double check your own arithmetic/logic before finalizing "expected" values. This must be a single valid JSON object: escape every double-quote character (") and newline that appears inside a string value (e.g. in code snippets or quoted text) as \\" and \\n respectively — never a literal unescaped " or line break inside a string. No markdown, no explanation — just JSON.`,
        },
        {
          role: 'user',
          content: JSON.stringify({ job_description: truncatedJd }),
        },
      ],
    });

    const verified = await this._verifyTestCases(problem);
    if (!verified && attempt < MAX_PROBLEM_GEN_ATTEMPTS) {
      return this.generateCodingProblem(jdText, history, guildId, company, codeLanguage, language, attempt + 1);
    }

    delete problem.referenceSolution;
    return problem;
  }

  // Generates a spoken follow-up question that references the candidate's actual test results,
  // so the discussion is grounded in what really happened rather than a generic prompt.
  async generateCodeFollowupQuestion(problem, code, testResult, guildId, company = null, language = DEFAULT_LANGUAGE) {
    const guildConfig = this.gcs?.getConfig(guildId) || null;
    const provider = createChatProvider('summ', guildConfig);
    const companyContext = company ? ` The candidate is interviewing at: ${company}.` : '';
    const languageInstruction = language === DEFAULT_LANGUAGE ? '' : ` Ask the question in ${getLanguage(language).name}.`;

    const systemPrompt = `You are a professional technical interviewer conducting a voice interview.${companyContext}${languageInstruction} The candidate just submitted code for a coding problem and it was run against ${testResult.total} test case(s), passing ${testResult.passCount} of them. Ask a single concise spoken follow-up question that has them walk through their approach and, if any tests failed, probes why. Keep it short — one or two sentences. Return ONLY the question — no preamble, numbering, or explanation.`;

    return await provider.chat(
      systemPrompt,
      JSON.stringify({ problem: problem.prompt, code, testResults: testResult.results }),
      { max_tokens: 256, temperature: 0.7 }
    );
  }

  async generateSummary(jdText, history, guildId, company = null, style = 'behavioral', language = DEFAULT_LANGUAGE) {
    const guildConfig = this.gcs?.getConfig(guildId) || null;
    const { apiKey } = resolveConfig('summ', guildConfig);
    const groq = new Groq({ apiKey });
    const truncatedJd = jdText.substring(0, 3000);
    const companyContext = company ? ` The candidate interviewed at: ${company}.` : '';
    const styleInstructions = this._styleInstructions(style);
    const languageInstruction = language === DEFAULT_LANGUAGE
      ? ''
      : ` Write the "strengths", "gaps", and "narrative" fields in ${getLanguage(language).name}, since that is the language the candidate interviewed in.`;

    try {
      return await this._createJsonCompletion(groq, {
        model: 'openai/gpt-oss-120b',
        max_tokens: 2048,
        temperature: 0.3,
        reasoning_effort: 'low',
        reasoning_format: 'hidden',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an expert hiring manager evaluating a job interview.${companyContext} The interview was conducted in the following style: ${styleInstructions}${languageInstruction}${style === 'leetcode' ? ' Some entries in the transcript include the candidate\'s submitted "code" and "testResults" (from actually executing their code against test cases) alongside their verbal "answer" explaining it — weigh the real test pass/fail results and code quality alongside the verbal explanation, not just the explanation on its own.' : ''} Based on the job description and the candidate's answers, return ONLY valid JSON with this exact shape: { "score": <integer 1-10>, "strengths": [<string>, ...], "gaps": [<string>, ...], "narrative": <string> }. The "narrative" should be a 3-5 sentence paragraph, written directly to the candidate, that explains their weaknesses in context and gives concrete, actionable steps they can take to make those weaknesses less impactful in future interviews. This must be a single valid JSON object: escape every double-quote character (") and newline that appears inside a string value as \\" and \\n respectively. No markdown, no explanation — just JSON.`,
          },
          {
            role: 'user',
            content: JSON.stringify({ job_description: truncatedJd, interview_transcript: history }),
          },
        ],
      });
    } catch {
      return { score: 5, strengths: ['Interview completed'], gaps: ['Evaluation could not be parsed'], narrative: '' };
    }
  }

  // Voice defaults to English; pass a voice from LANGUAGES to speak in another language.
  async _synthesizeSpeech(tmpDir, text, userId, voice = LANGUAGES[DEFAULT_LANGUAGE].voice, attempt = 1) {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
      const { audioFilePath } = await tts.toFile(tmpDir, text);
      return audioFilePath;
    } catch (err) {
      if (attempt >= MAX_TTS_ATTEMPTS) {
        console.error(`[interview] TTS failed for ${userId} after ${MAX_TTS_ATTEMPTS} attempts:`, err?.message);
        return null;
      }
      console.warn(`[interview] TTS attempt ${attempt} failed for ${userId}, retrying:`, err?.message);
      const backoffMs = TTS_RETRY_BASE_MS * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return this._synthesizeSpeech(tmpDir, text, userId, voice, attempt + 1);
    }
  }

  async speakQuestion(connection, userId, text, voice = LANGUAGES[DEFAULT_LANGUAGE].voice) {
    const tmpDir = path.join(os.tmpdir(), `tts_${Date.now()}_${userId}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const audioFilePath = await this._synthesizeSpeech(tmpDir, text, userId, voice);
      if (!audioFilePath) return; // TTS unavailable after retries — skip this turn's audio rather than aborting the interview

      const resource = createAudioResource(fs.createReadStream(audioFilePath), {
        inputType: StreamType.WebmOpus,
      });

      let player = this.players.get(userId);
      if (!player) {
        player = new AudioPlayer();
        this.players.set(userId, player);
      }

      connection.subscribe(player);
      player.play(resource);

      try {
        await entersState(player, AudioPlayerStatus.Idle, 60_000);
      } catch {
        // Connection destroyed or session aborted mid-play — swallow gracefully
      }
    } finally {
      fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    }
  }

  async captureAnswer(receiver, userId, guildId, language = null) {
    const opusStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: ANSWER_SILENCE_MS },
    });

    const decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
    const pcmChunks = [];
    let audioBytes = 0;

    const forceEndTimer = setTimeout(() => {
      try { opusStream.destroy(); } catch {}
    }, MAX_ANSWER_WAIT_MS);

    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const settle = (err) => {
          if (settled) return;
          settled = true;
          if (err) reject(err);
          else resolve();
        };

        opusStream.on('data', (packet) => {
          try {
            const pcmData = decoder.decode(packet);
            pcmChunks.push(pcmData);
            audioBytes += pcmData.length;
          } catch {}
        });

        opusStream.on('end', () => settle());
        opusStream.on('close', () => settle());
        opusStream.on('error', (err) => settle(err));
      });
    } catch (err) {
      console.error(`[interview] captureAnswer error for ${userId}:`, err?.message);
    } finally {
      clearTimeout(forceEndTimer);
      decoder.delete();
      try { opusStream.destroy(); } catch {}
    }

    const minBytes = 48000 * 2 * 2 * 0.3;
    if (audioBytes < minBytes || pcmChunks.length === 0) return '';

    const tempPcmFile = path.join(os.tmpdir(), `interview_${Date.now()}_${userId}.pcm`);
    let wavFile;
    try {
      await fs.promises.writeFile(tempPcmFile, Buffer.concat(pcmChunks));
      wavFile = await this.transcriptionService.convertPcmToWav(tempPcmFile);
      const transcript = await this.transcriptionService.transcribe(wavFile, guildId, language);
      return transcript?.text?.trim() ?? '';
    } catch (err) {
      console.error(`[interview] transcription error for ${userId}:`, err?.message);
      return '';
    } finally {
      if (fs.existsSync(tempPcmFile)) fs.unlink(tempPcmFile, () => {});
      if (wavFile && fs.existsSync(wavFile)) fs.unlink(wavFile, () => {});
    }
  }

  // Resolves the code-submission wait for a user's active session, if one is pending.
  // Called from the modal-submit interaction handler. Returns false if there was nothing to resolve
  // (e.g. the wait already timed out, or the user has no active session).
  submitCode(userId, code) {
    const session = this.sessions.get(userId);
    if (!session || !session.pendingCodeResolve) return false;
    session.pendingCodeResolve(code);
    return true;
  }

  // Runs a candidate's in-progress code against the visible "sample" test cases (the first
  // SAMPLE_TEST_CASE_COUNT of the generated set — the rest stay hidden until Submit) without
  // resolving the pending Submit wait, so they can iterate before committing. Capped at
  // MAX_SAMPLE_RUNS per question. Called from the Run Code modal-submit handler; returns the
  // fully-formed message to show back to the candidate.
  async runSampleCode(userId, code) {
    const session = this.sessions.get(userId);
    if (!session || !session.currentProblem) {
      return { ok: false, content: '❌ There\'s no coding question waiting for a submission right now (the interview may have moved on or ended).' };
    }

    session.runCount = (session.runCount || 0) + 1;
    if (session.runCount > MAX_SAMPLE_RUNS) {
      session.runCount = MAX_SAMPLE_RUNS;
      return { ok: false, content: `❌ You've used all ${MAX_SAMPLE_RUNS} sample runs for this question — go ahead and Submit Code when you're ready.` };
    }

    const { currentProblem, codeLanguage } = session;
    const sampleCases = currentProblem.testCases.slice(0, SAMPLE_TEST_CASE_COUNT);

    let result;
    try {
      result = await codeExecutionService.runTestCases(code, codeLanguage, sampleCases, currentProblem.functionName);
    } catch (err) {
      console.error(`[interview] Sample run failed for ${userId}:`, err?.message);
      return { ok: false, content: '❌ Something went wrong running your code against the sample tests. You can try again or just submit when ready.' };
    }

    const lines = result.results.map((r, i) => {
      if (r.pass) return `Sample ${i + 1}: ✅ Passed`;
      const detail = r.error || `expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`;
      return `Sample ${i + 1}: ❌ Failed — ${detail}`;
    });
    const runsLeft = MAX_SAMPLE_RUNS - session.runCount;

    return {
      ok: true,
      content: `**${result.passCount}/${result.total} sample tests passed**\n${lines.join('\n')}\n\n_${runsLeft} run(s) remaining before you submit._`,
    };
  }

  // Waits (self-paced, no polling) for a Submit Code modal to resolve session.pendingCodeResolve,
  // racing against MAX_CODE_WAIT_MS. Unlike captureAnswer, this deliberately does not hold any
  // voice capture open — the interviewee can take as long as they need up to the timeout.
  _waitForCodeSubmission(session) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => settle(null), MAX_CODE_WAIT_MS);
      const settle = (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        session.pendingCodeResolve = null;
        resolve(code);
      };
      session.pendingCodeResolve = settle;
    });
  }

  _buildProblemEmbed(problem) {
    const embed = new EmbedBuilder()
      .setTitle(`🧩 ${problem.title}`)
      .setColor(0x3498db)
      .setDescription((problem.prompt || '').slice(0, 4096));

    if (Array.isArray(problem.examples) && problem.examples.length) {
      embed.addFields({ name: 'Examples', value: problem.examples.join('\n\n').slice(0, 1024) });
    }
    if (Array.isArray(problem.constraints) && problem.constraints.length) {
      embed.addFields({ name: 'Constraints', value: problem.constraints.map((c) => `• ${c}`).join('\n').slice(0, 1024) });
    }
    if (problem.functionSignature) {
      embed.addFields({ name: 'Function Signature', value: `\`\`\`\n${problem.functionSignature.slice(0, 1000)}\n\`\`\`` });
    }

    return embed.setFooter({ text: `Click "Run Code" to test against the first ${SAMPLE_TEST_CASE_COUNT} example(s) (up to ${MAX_SAMPLE_RUNS} times), or "Submit Code" when you're ready for the real thing.` });
  }

  // Runs one full coding-style question: generate problem -> post it (text, not voice) ->
  // wait (self-paced) for a code submission -> execute it against real test cases -> ask a
  // results-aware follow-up question over voice -> capture the verbal walkthrough as usual.
  async _runCodingQuestion(session, connection, receiver, userId, voice) {
    const { guildId, company, language, codeLanguage, jdText, history, voiceChannel } = session;

    let problem;
    try {
      problem = await this.generateCodingProblem(jdText, history, guildId, company, codeLanguage, language);
    } catch (err) {
      console.error('[interview] Failed to generate coding problem:', err?.message);
      if (!session.aborted) {
        const apologyText = await this._localize(
          "Sorry, I ran into an issue preparing that coding problem — let's move on to the next one.",
          language,
          guildId
        );
        await this.speakQuestion(connection, userId, apologyText, voice);
      }
      return;
    }
    if (session.aborted) return;

    const introText = await this._localize(
      `Here's your next problem: ${problem.title}. Check the channel for the full details, and click Submit Code when you're ready.`,
      language,
      guildId
    );
    await this.speakQuestion(connection, userId, introText, voice);
    if (session.aborted) return;

    const embed = this._buildProblemEmbed(problem);
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(INTERVIEW_RUN_CODE_BUTTON_ID)
        .setLabel('Run Code')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(INTERVIEW_SUBMIT_CODE_BUTTON_ID)
        .setLabel('Submit Code')
        .setStyle(ButtonStyle.Primary)
    );

    try {
      await voiceChannel.send({ content: `<@${userId}>`, embeds: [embed], components: [buttonRow] });
    } catch (err) {
      console.error('[interview] Failed to post coding problem:', err?.message);
    }

    session.currentProblem = problem;
    session.runCount = 0;
    const code = await this._waitForCodeSubmission(session);
    session.currentProblem = null;
    if (session.aborted) return;

    let testResult = { results: [], passCount: 0, total: problem.testCases?.length ?? 0 };
    if (code) {
      try {
        testResult = await codeExecutionService.runTestCases(code, codeLanguage, problem.testCases, problem.functionName);
      } catch (err) {
        console.error('[interview] Code execution failed:', err?.message);
      }
    }
    if (session.aborted) return;

    let followup = null;
    if (code) {
      try {
        followup = await this.generateCodeFollowupQuestion(problem, code, testResult, guildId, company, language);
      } catch (err) {
        console.error('[interview] Failed to generate follow-up question:', err?.message);
      }
    }
    if (!followup) {
      followup = await this._localize(
        "No worries — let's move on. Can you briefly describe how you would have approached this problem?",
        language,
        guildId
      );
    }

    await this.speakQuestion(connection, userId, followup, voice);
    if (session.aborted) return;

    const answer = await this.captureAnswer(receiver, userId, guildId, language);
    if (session.aborted) return;

    history.push({
      question: `${problem.title}\n\n${problem.prompt}`,
      code: code || null,
      codeLanguage,
      testResults: code ? testResult : null,
      answer,
    });
  }

  // Polls the member's live voice state (a discord.js getter backed by the guild's
  // voice state cache) until they join voiceChannel, the session is aborted, or we time out.
  async _waitForMemberJoin(member, voiceChannel, session) {
    if (member.voice?.channelId === voiceChannel.id) return true;

    const deadline = Date.now() + VOICE_JOIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (session.aborted) return false;
      await new Promise((resolve) => setTimeout(resolve, VOICE_JOIN_POLL_MS));
      if (session.aborted) return false;
      if (member.voice?.channelId === voiceChannel.id) return true;
    }
    return false;
  }

  async startInterview(guild, member, voiceChannel, originalChannel, jdText, company = null, style = 'behavioral', language = DEFAULT_LANGUAGE, codeLanguage = 'javascript') {
    const userId = member.id;
    const guildId = guild.id;
    const voice = getLanguage(language).voice;

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    const session = {
      connection,
      voiceChannel,
      originalChannel,
      jdText,
      guildId,
      member,
      company,
      style,
      language,
      codeLanguage,
      history: [],
      aborted: false,
      pendingCodeResolve: null,
    };
    this.sessions.set(userId, session);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch (err) {
      console.error('[interview] Connection never became ready:', err?.message);
      await this._cleanup(userId);
      await originalChannel.send('❌ Failed to join the interview channel. Please try again.').catch(() => {});
      return;
    }

    const receiver = connection.receiver;
    const history = session.history;

    const joined = await this._waitForMemberJoin(member, voiceChannel, session);
    if (!joined) {
      if (!session.aborted) {
        await originalChannel.send(
          `⏱️ <@${userId}> didn't join <#${voiceChannel.id}> in time, so the interview was cancelled.`
        ).catch(() => {});
      }
      await this._cleanup(userId);
      return;
    }

    const questionCount = questionCountFor(style);

    try {
      const companyPhrase = company ? ` for ${company}` : '';
      const introText = await this._localize(
        `Hello! Welcome to your AI-powered job interview${companyPhrase}. I'll be asking you a series of ${questionCount} questions based on the job description you provided. Please answer each question clearly after I finish speaking. Let's get started.`,
        language,
        guildId
      );
      await this.speakQuestion(connection, userId, introText, voice);

      for (let i = 0; i < questionCount; i++) {
        if (session.aborted) break;

        if (style === 'leetcode') {
          await this._runCodingQuestion(session, connection, receiver, userId, voice);
          continue;
        }

        const question = await this.generateQuestion(jdText, history, guildId, company, style, language);
        if (session.aborted) break;

        await this.speakQuestion(connection, userId, question, voice);
        if (session.aborted) break;

        let answer = await this.captureAnswer(receiver, userId, guildId, language);

        if (!session.aborted && answer.length <= MIN_ANSWER_CHARS) {
          const retryText = await this._localize("I didn't quite catch that. Could you please repeat your answer?", language, guildId);
          await this.speakQuestion(connection, userId, retryText, voice);
          if (!session.aborted) {
            answer = await this.captureAnswer(receiver, userId, guildId, language);
          }
        }

        if (session.aborted) break;
        history.push({ question, answer });
      }

      if (!session.aborted && history.length > 0) {
        const summary = await this.generateSummary(jdText, history, guildId, company, style, language);
        const embed = this._buildSummaryEmbed(summary, history, member, style);
        const transcript = this._buildTranscriptAttachment(history, member, company, language);
        try {
          await member.send({ embeds: [embed], files: [transcript] });
        } catch {
          await originalChannel.send({ content: `<@${member.id}>`, embeds: [embed], files: [transcript] }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[interview] Error during interview:', err?.message);
      if (!session.aborted) {
        await originalChannel.send('❌ The interview encountered an unexpected error.').catch(() => {});
      }
    } finally {
      await this._cleanup(userId);
    }
  }

  async stopInterview(userId) {
    const session = this.sessions.get(userId);
    if (!session) return;
    if (session.pendingCodeResolve) session.pendingCodeResolve(null);
    session.aborted = true;

    if (session.history.length > 0) {
      try {
        const summary = await this.generateSummary(session.jdText, session.history, session.guildId, session.company, session.style, session.language);
        const embed = this._buildSummaryEmbed(summary, session.history, session.member, session.style);
        const transcript = this._buildTranscriptAttachment(session.history, session.member, session.company, session.language);
        try {
          await session.member.send({ embeds: [embed], files: [transcript] });
        } catch {
          await session.originalChannel.send({ content: `<@${session.member.id}>`, embeds: [embed], files: [transcript] }).catch(() => {});
        }
      } catch (err) {
        console.error('[interview] Failed to generate early-stop summary:', err?.message);
      }
    }

    await this._cleanup(userId);
  }

  async _cleanup(userId) {
    const session = this.sessions.get(userId);
    if (session) {
      try { session.connection.destroy(); } catch {}
      try { await session.voiceChannel.delete(); } catch {}
    }
    this.sessions.delete(userId);
    this.players.delete(userId);
  }

  _buildTranscriptAttachment(history, member, company, language) {
    const lines = [
      `Interview Transcript — ${member.displayName || member.user.username}`,
      company ? `Company: ${company}` : null,
      language && language !== DEFAULT_LANGUAGE ? `Language: ${getLanguage(language).name}` : null,
      `Date: ${new Date().toISOString()}`,
      '',
    ].filter((line) => line !== null);

    history.forEach(({ question, answer, code, codeLanguage, testResults }, i) => {
      lines.push(`Q${i + 1}: ${question}`);
      if (code) {
        lines.push(`Submitted Code (${codeLanguage}):`);
        lines.push(code);
        if (testResults) {
          lines.push(`Tests: ${testResults.passCount}/${testResults.total} passed`);
          testResults.results.forEach((r, j) => {
            const outcome = r.pass ? 'PASS' : 'FAIL';
            const detail = r.error ? ` error: ${r.error}` : ` actual: ${JSON.stringify(r.actual)}, expected: ${JSON.stringify(r.expected)}`;
            lines.push(`  Test ${j + 1}: ${outcome}${detail}`);
          });
        }
      }
      lines.push(`A${i + 1}: ${answer || '(no answer captured)'}`);
      lines.push('');
    });

    return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf-8'), {
      name: 'interview-transcript.txt',
    });
  }

  _buildSummaryEmbed(summary, history, member, style = 'behavioral') {
    const { score, strengths, gaps, narrative } = summary;

    const strengthsText = Array.isArray(strengths) && strengths.length
      ? strengths.map(s => `• ${s}`).join('\n')
      : '• None identified';

    const gapsText = Array.isArray(gaps) && gaps.length
      ? gaps.map(g => `• ${g}`).join('\n')
      : '• None identified';

    const scoreColor = score >= 8 ? 0x2ecc71 : score >= 5 ? 0xf39c12 : 0xe74c3c;

    const embed = new EmbedBuilder()
      .setTitle(`📋 Interview Summary — ${member.displayName || member.user.username}`)
      .setColor(scoreColor)
      .addFields(
        { name: '🏆 Score', value: `${score}/10`, inline: true },
        { name: '📊 Questions Answered', value: `${history.length}/${questionCountFor(style)}`, inline: true },
        { name: '✅ Strengths', value: strengthsText },
        { name: '🔍 Areas for Improvement', value: gapsText },
      );

    const codingResults = history
      .map(({ testResults }, i) => (testResults ? `Q${i + 1}: ${testResults.passCount}/${testResults.total} tests passed` : null))
      .filter(Boolean);
    if (codingResults.length) {
      embed.addFields({ name: '🧪 Test Results', value: codingResults.join('\n').slice(0, 1024) });
    }

    if (narrative && narrative.trim()) {
      embed.addFields({ name: '📝 Coaching Notes', value: narrative.trim().slice(0, 1024) });
    }

    return embed
      .setTimestamp()
      .setFooter({ text: 'AI-Powered Interview Assessment' });
  }
}

module.exports = { InterviewService, LANGUAGES, DEFAULT_LANGUAGE };
