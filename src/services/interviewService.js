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
const { EmbedBuilder } = require('discord.js');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { createChatProvider, resolveConfig } = require('../providers');
const Groq = require('groq-sdk');
const OpusScript = require('opusscript');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_QUESTIONS = 8;
const MAX_ANSWER_WAIT_MS = 65000;
const MIN_ANSWER_CHARS = 5;
const ANSWER_SILENCE_MS = 2500; // wait for this long a pause before treating the answer as done
const MAX_TTS_ATTEMPTS = 3;
const TTS_RETRY_BASE_MS = 500; // exponential backoff: 500ms, 1000ms, ...

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
      attachment,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
  }

  updatePendingStyle(userId, style) {
    const setup = this.pendingSetups.get(userId);
    if (setup) setup.style = style;
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
      case 'behavioral':
      default:
        return 'Use a behavioral interview style — ask STAR-method questions (Situation, Task, Action, Result) about past experiences and how the candidate handled specific situations.';
    }
  }

  async generateQuestion(jdText, history, guildId, company = null, style = 'behavioral') {
    const guildConfig = this.gcs?.getConfig(guildId) || null;
    const provider = createChatProvider('summ', guildConfig);
    const truncatedJd = jdText.substring(0, 3000);
    const companyContext = company ? ` The candidate is interviewing at: ${company}.` : '';
    const styleInstructions = this._styleInstructions(style);

    const systemPrompt = history.length === 0
      ? `You are a professional job interviewer conducting a voice interview.${companyContext} ${styleInstructions} Based on the job description, ask a single concise opening interview question directly relevant to the role. Keep it short — one sentence, no multi-part questions. Return ONLY the question — no preamble, numbering, or explanation.`
      : `You are a professional job interviewer conducting a voice interview.${companyContext} ${styleInstructions} Based on the job description and prior Q&A history, ask a single concise follow-up question that probes deeper into the candidate's experience. Keep it short — one sentence, no multi-part questions. Return ONLY the question — no preamble, numbering, or explanation.`;

    return await provider.chat(
      systemPrompt,
      JSON.stringify({ job_description: truncatedJd, conversation_history: history }),
      { max_tokens: 256, temperature: 0.7 }
    );
  }

  async generateSummary(jdText, history, guildId, company = null, style = 'behavioral') {
    const guildConfig = this.gcs?.getConfig(guildId) || null;
    const { apiKey } = resolveConfig('summ', guildConfig);
    const groq = new Groq({ apiKey });
    const truncatedJd = jdText.substring(0, 3000);
    const companyContext = company ? ` The candidate interviewed at: ${company}.` : '';
    const styleInstructions = this._styleInstructions(style);

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: `You are an expert hiring manager evaluating a job interview.${companyContext} The interview was conducted in the following style: ${styleInstructions} Based on the job description and the candidate's answers, return ONLY valid JSON with this exact shape: { "score": <integer 1-10>, "strengths": [<string>, ...], "gaps": [<string>, ...], "narrative": <string> }. The "narrative" should be a 3-5 sentence paragraph, written directly to the candidate, that explains their weaknesses in context and gives concrete, actionable steps they can take to make those weaknesses less impactful in future interviews. No markdown, no explanation — just JSON.`,
        },
        {
          role: 'user',
          content: JSON.stringify({ job_description: truncatedJd, interview_transcript: history }),
        },
      ],
    });

    try {
      const raw = completion.choices[0].message.content;
      const stripped = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      return JSON.parse(stripped);
    } catch {
      return { score: 5, strengths: ['Interview completed'], gaps: ['Evaluation could not be parsed'], narrative: '' };
    }
  }

  // Possible options for the voice
  // en-US-AriaNeural — current (US female)
  // en-US-GuyNeural — US male
  // en-US-JennyNeural — US female
  // en-US-EricNeural — US male
  // en-GB-SoniaNeural — British female
  // en-GB-RyanNeural — British male
  // en-AU-NatashaNeural — Australian female
  async _synthesizeSpeech(tmpDir, text, userId, attempt = 1) {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata('en-US-AriaNeural', OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
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
      return this._synthesizeSpeech(tmpDir, text, userId, attempt + 1);
    }
  }

  async speakQuestion(connection, userId, text) {
    const tmpDir = path.join(os.tmpdir(), `tts_${Date.now()}_${userId}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const audioFilePath = await this._synthesizeSpeech(tmpDir, text, userId);
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

  async captureAnswer(receiver, userId, guildId) {
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
      const transcript = await this.transcriptionService.transcribe(wavFile, guildId);
      return transcript?.text?.trim() ?? '';
    } catch (err) {
      console.error(`[interview] transcription error for ${userId}:`, err?.message);
      return '';
    } finally {
      if (fs.existsSync(tempPcmFile)) fs.unlink(tempPcmFile, () => {});
      if (wavFile && fs.existsSync(wavFile)) fs.unlink(wavFile, () => {});
    }
  }

  async startInterview(guild, member, voiceChannel, originalChannel, jdText, company = null, style = 'behavioral') {
    const userId = member.id;
    const guildId = guild.id;

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
      history: [],
      aborted: false,
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

    try {
      const companyPhrase = company ? ` for ${company}` : '';
      await this.speakQuestion(connection, userId,
        `Hello! Welcome to your AI-powered job interview${companyPhrase}. I'll be asking you a series of ${MAX_QUESTIONS} questions based on the job description you provided. Please answer each question clearly after I finish speaking. Let's get started.`
      );

      for (let i = 0; i < MAX_QUESTIONS; i++) {
        if (session.aborted) break;

        const question = await this.generateQuestion(jdText, history, guildId, company, style);
        if (session.aborted) break;

        await this.speakQuestion(connection, userId, question);
        if (session.aborted) break;

        let answer = await this.captureAnswer(receiver, userId, guildId);

        if (!session.aborted && answer.length <= MIN_ANSWER_CHARS) {
          await this.speakQuestion(connection, userId, "I didn't quite catch that. Could you please repeat your answer?");
          if (!session.aborted) {
            answer = await this.captureAnswer(receiver, userId, guildId);
          }
        }

        if (session.aborted) break;
        history.push({ question, answer });
      }

      if (!session.aborted && history.length > 0) {
        const summary = await this.generateSummary(jdText, history, guildId, company, style);
        const embed = this._buildSummaryEmbed(summary, history, member);
        try {
          await member.send({ embeds: [embed] });
        } catch {
          await originalChannel.send({ content: `<@${member.id}>`, embeds: [embed] }).catch(() => {});
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
    session.aborted = true;

    if (session.history.length > 0) {
      try {
        const summary = await this.generateSummary(session.jdText, session.history, session.guildId, session.company, session.style);
        const embed = this._buildSummaryEmbed(summary, session.history, session.member);
        try {
          await session.member.send({ embeds: [embed] });
        } catch {
          await session.originalChannel.send({ content: `<@${session.member.id}>`, embeds: [embed] }).catch(() => {});
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

  _buildSummaryEmbed(summary, history, member) {
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
        { name: '📊 Questions Answered', value: `${history.length}/${MAX_QUESTIONS}`, inline: true },
        { name: '✅ Strengths', value: strengthsText },
        { name: '🔍 Areas for Improvement', value: gapsText },
      );

    if (narrative && narrative.trim()) {
      embed.addFields({ name: '📝 Coaching Notes', value: narrative.trim().slice(0, 1024) });
    }

    return embed
      .setTimestamp()
      .setFooter({ text: 'AI-Powered Interview Assessment' });
  }
}

module.exports = { InterviewService };
