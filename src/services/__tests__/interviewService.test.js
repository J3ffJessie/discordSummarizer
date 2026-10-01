jest.mock('@discordjs/voice', () => ({
  joinVoiceChannel: jest.fn().mockReturnValue({
    destroy: jest.fn(),
    subscribe: jest.fn(),
    receiver: { subscribe: jest.fn() },
  }),
  EndBehaviorType: { AfterSilence: 'AfterSilence' },
  VoiceConnectionStatus: { Ready: 'ready' },
  entersState: jest.fn().mockResolvedValue(undefined),
  createAudioResource: jest.fn().mockReturnValue({}),
  StreamType: { WebmOpus: 'webm/opus' },
  AudioPlayer: jest.fn().mockImplementation(() => ({ play: jest.fn(), on: jest.fn() })),
  AudioPlayerStatus: { Idle: 'idle' },
}));

jest.mock('discord.js', () => ({
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setTimestamp: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
  })),
  AttachmentBuilder: jest.fn().mockImplementation((buffer, opts) => ({ buffer, ...opts })),
  ActionRowBuilder: jest.fn().mockImplementation(() => ({ addComponents: jest.fn().mockReturnThis() })),
  ButtonBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
  })),
  ButtonStyle: { Primary: 1 },
}));

jest.mock('msedge-tts', () => ({
  MsEdgeTTS: jest.fn().mockImplementation(() => ({
    setMetadata: jest.fn().mockResolvedValue(undefined),
    toFile: jest.fn().mockResolvedValue({ audioFilePath: '/tmp/tts.webm' }),
  })),
  OUTPUT_FORMAT: { WEBM_24KHZ_16BIT_MONO_OPUS: 'webm-opus' },
}));

const mockChat = jest.fn();
jest.mock('../../providers', () => ({
  createChatProvider: jest.fn(() => ({ chat: mockChat })),
  resolveConfig: jest.fn().mockReturnValue({ apiKey: 'test-key' }),
}));

const mockGroqCreate = jest.fn();
jest.mock('groq-sdk', () =>
  jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockGroqCreate } },
  }))
);

jest.mock('opusscript', () => {
  const OpusMock = jest.fn().mockImplementation(() => ({
    decode: jest.fn().mockReturnValue(Buffer.alloc(1000)),
    delete: jest.fn(),
  }));
  OpusMock.Application = { AUDIO: 2048 };
  return OpusMock;
});

jest.mock('fs', () => ({
  promises: { writeFile: jest.fn().mockResolvedValue(undefined) },
  existsSync: jest.fn().mockReturnValue(false),
  unlink: jest.fn((_p, cb) => cb && cb()),
  mkdirSync: jest.fn(),
  createReadStream: jest.fn().mockReturnValue({}),
  rm: jest.fn((_p, _opts, cb) => cb && cb()),
}));

const mockRunTestCases = jest.fn();
jest.mock('../codeExecutionService', () => ({
  runTestCases: (...args) => mockRunTestCases(...args),
}));

jest.mock('pdf-parse', () => jest.fn().mockResolvedValue({ text: 'PDF job description' }));
jest.mock('mammoth', () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: 'DOCX job description' }),
}));

const { InterviewService } = require('../interviewService');
const { joinVoiceChannel, entersState } = require('@discordjs/voice');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { MsEdgeTTS } = require('msedge-tts');
const { EventEmitter } = require('events');

// ─── helpers ───────────────────────────────────────────────────────────────────

function makeMember(id = 'u1', voiceChannelId = 'vc1') {
  return {
    id,
    displayName: 'Alice',
    user: { id, username: 'alice' },
    voice: { channelId: voiceChannelId },
    send: jest.fn().mockResolvedValue(undefined),
  };
}

function makeGuild(id = 'g1') {
  return { id, voiceAdapterCreator: jest.fn() };
}

function makeVoiceChannel() {
  return { id: 'vc1', delete: jest.fn().mockResolvedValue(undefined) };
}

function makeOriginalChannel() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

function makeTranscriptionService() {
  return {
    convertPcmToWav: jest.fn().mockResolvedValue('/tmp/test.wav'),
    transcribe: jest.fn().mockResolvedValue({ text: 'My answer' }),
  };
}

function makeService() {
  const transcriptionService = makeTranscriptionService();
  const gcs = { getConfig: jest.fn().mockReturnValue(null) };
  const instance = new InterviewService({}, transcriptionService, gcs);
  return { instance, transcriptionService, gcs };
}

function makeOpusStream({ packets = [], error = null } = {}) {
  const stream = new EventEmitter();
  stream.destroy = jest.fn();
  process.nextTick(() => {
    if (error) {
      stream.emit('error', error);
    } else {
      for (const p of packets) stream.emit('data', p);
      stream.emit('end');
    }
  });
  return stream;
}

const MOCK_SUMMARY = { score: 7, strengths: ['Clear communicator'], gaps: ['Needs more examples'] };
const MOCK_SUMMARY_JSON = JSON.stringify(MOCK_SUMMARY);

const MOCK_PROBLEM = {
  title: 'Two Sum',
  prompt: 'Given an array of integers, return indices of the two numbers that add up to target.',
  examples: ['Input: [2,7,11,15], 9 -> Output: [0,1]'],
  constraints: ['2 <= nums.length <= 10^4'],
  functionName: 'twoSum',
  functionSignature: 'function twoSum(nums, target) {}',
  testCases: [{ input: [[2, 7, 11, 15], 9], expected: [0, 1] }],
};
const MOCK_PROBLEM_JSON = JSON.stringify(MOCK_PROBLEM);

const MOCK_PROBLEM_WITH_REF = {
  ...MOCK_PROBLEM,
  title: 'Broken Problem',
  referenceSolution: 'function twoSum(nums, target) { return [1, 0]; }',
};
const MOCK_PROBLEM_WITH_REF_JSON = JSON.stringify(MOCK_PROBLEM_WITH_REF);

// ─── tests ─────────────────────────────────────────────────────────────────────

describe('InterviewService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ instance: service } = makeService());
  });

  // ── pending setup ──────────────────────────────────────────────────────────

  describe('setPendingSetup / getPendingSetup', () => {
    it('should store and retrieve a pending setup', () => {
      service.setPendingSetup('u1', { attachment: null });
      const setup = service.getPendingSetup('u1');
      expect(setup).not.toBeNull();
      expect(setup.style).toBe('behavioral');
      expect(setup.language).toBe('en');
      expect(setup.attachment).toBeNull();
    });

    it('should return null when no setup exists', () => {
      expect(service.getPendingSetup('unknown')).toBeNull();
    });

    it('should return null and remove the entry when setup has expired', () => {
      service.setPendingSetup('u1');
      service.pendingSetups.get('u1').expiresAt = Date.now() - 1;
      expect(service.getPendingSetup('u1')).toBeNull();
      expect(service.pendingSetups.has('u1')).toBe(false);
    });
  });

  describe('updatePendingStyle', () => {
    it('should update the style on an existing pending setup', () => {
      service.setPendingSetup('u1');
      service.updatePendingStyle('u1', 'technical');
      expect(service.getPendingSetup('u1').style).toBe('technical');
    });

    it('should not throw when no pending setup exists', () => {
      expect(() => service.updatePendingStyle('ghost', 'technical')).not.toThrow();
    });
  });

  describe('updatePendingLanguage', () => {
    it('should update the language on an existing pending setup', () => {
      service.setPendingSetup('u1');
      service.updatePendingLanguage('u1', 'es');
      expect(service.getPendingSetup('u1').language).toBe('es');
    });

    it('should not throw when no pending setup exists', () => {
      expect(() => service.updatePendingLanguage('ghost', 'es')).not.toThrow();
    });
  });

  describe('updatePendingCodeLanguage', () => {
    it('should update the code language on an existing pending setup', () => {
      service.setPendingSetup('u1');
      service.updatePendingCodeLanguage('u1', 'python');
      expect(service.getPendingSetup('u1').codeLanguage).toBe('python');
    });

    it('should default codeLanguage to javascript', () => {
      service.setPendingSetup('u1');
      expect(service.getPendingSetup('u1').codeLanguage).toBe('javascript');
    });

    it('should not throw when no pending setup exists', () => {
      expect(() => service.updatePendingCodeLanguage('ghost', 'python')).not.toThrow();
    });
  });

  describe('clearPendingSetup', () => {
    it('should remove the pending setup', () => {
      service.setPendingSetup('u1');
      service.clearPendingSetup('u1');
      expect(service.getPendingSetup('u1')).toBeNull();
    });
  });

  // ── parseJobDescription ────────────────────────────────────────────────────

  describe('parseJobDescription', () => {
    it('should return trimmed plain text', async () => {
      const result = await service.parseJobDescription('  Senior Engineer  ', null);
      expect(result).toBe('Senior Engineer');
    });

    it('should throw when text is empty', async () => {
      await expect(service.parseJobDescription('   ', null)).rejects.toThrow('Job description cannot be empty');
    });

    it('should throw when neither text nor attachment is provided', async () => {
      await expect(service.parseJobDescription(null, null)).rejects.toThrow('Please provide');
    });

    it('should extract text from a PDF attachment', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      const attachment = { url: 'http://example.com/jd.pdf', contentType: 'application/pdf', name: 'jd.pdf' };
      const result = await service.parseJobDescription(null, attachment);
      expect(result).toBe('PDF job description');
    });

    it('should extract text from a DOCX attachment', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      const attachment = {
        url: 'http://example.com/jd.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        name: 'jd.docx',
      };
      const result = await service.parseJobDescription(null, attachment);
      expect(result).toBe('DOCX job description');
    });

    it('should throw for an unsupported attachment type', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      const attachment = { url: 'http://example.com/jd.xlsx', contentType: 'application/vnd.ms-excel', name: 'jd.xlsx' };
      await expect(service.parseJobDescription(null, attachment)).rejects.toThrow('Unsupported file type');
    });
  });

  // ── _styleInstructions ─────────────────────────────────────────────────────

  describe('_styleInstructions', () => {
    it('should return behavioral instructions by default', () => {
      expect(service._styleInstructions('behavioral')).toContain('STAR');
    });

    it('should return technical instructions for technical style', () => {
      expect(service._styleInstructions('technical')).toContain('technical');
    });

    it('should return conversational instructions for conversational style', () => {
      expect(service._styleInstructions('conversational')).toContain('culture fit');
    });

    it('should return case-based instructions for case_based style', () => {
      expect(service._styleInstructions('case_based')).toContain('scenario');
    });

    it('should return LeetCode-style instructions for leetcode style', () => {
      expect(service._styleInstructions('leetcode')).toContain('LeetCode');
    });

    it('should fall back to behavioral for an unknown style', () => {
      expect(service._styleInstructions('unknown')).toContain('STAR');
    });
  });

  // ── generateQuestion ───────────────────────────────────────────────────────

  describe('generateQuestion', () => {
    it('should call provider.chat and return the question text', async () => {
      mockChat.mockResolvedValue('What is your greatest strength?');
      const result = await service.generateQuestion('Software Engineer', [], 'g1');
      expect(mockChat).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Software Engineer'),
        expect.objectContaining({ max_tokens: 256, temperature: 0.7 })
      );
      expect(result).toBe('What is your greatest strength?');
    });

    it('should use an opening system prompt when history is empty', async () => {
      mockChat.mockResolvedValue('Tell me about yourself.');
      await service.generateQuestion('Engineer', [], 'g1');
      const [systemPrompt] = mockChat.mock.calls[0];
      expect(systemPrompt).toContain('opening');
    });

    it('should use a follow-up system prompt when history has entries', async () => {
      mockChat.mockResolvedValue('How did you handle that?');
      const history = [{ question: 'Q1', answer: 'A1' }];
      await service.generateQuestion('Engineer', history, 'g1');
      const [systemPrompt] = mockChat.mock.calls[0];
      expect(systemPrompt).toContain('follow-up');
    });

    it('should truncate the job description to 3000 characters', async () => {
      mockChat.mockResolvedValue('Q?');
      const longJd = 'x'.repeat(5000);
      await service.generateQuestion(longJd, [], 'g1');
      const [, userContent] = mockChat.mock.calls[0];
      expect(JSON.parse(userContent).job_description.length).toBe(3000);
    });

    it('should include company name in the system prompt when provided', async () => {
      mockChat.mockResolvedValue('Q?');
      await service.generateQuestion('Engineer', [], 'g1', 'Acme Corp');
      const [systemPrompt] = mockChat.mock.calls[0];
      expect(systemPrompt).toContain('Acme Corp');
    });

    it('should instruct the model to ask in the chosen language when not English', async () => {
      mockChat.mockResolvedValue('¿Cuál es tu mayor fortaleza?');
      await service.generateQuestion('Engineer', [], 'g1', null, 'behavioral', 'es');
      const [systemPrompt] = mockChat.mock.calls[0];
      expect(systemPrompt).toContain('Ask the question in Spanish');
    });

    it('should omit the language instruction for the default English language', async () => {
      mockChat.mockResolvedValue('Q?');
      await service.generateQuestion('Engineer', [], 'g1');
      const [systemPrompt] = mockChat.mock.calls[0];
      expect(systemPrompt).not.toContain('Ask the question in');
    });
  });

  // ── generateCodingProblem ──────────────────────────────────────────────────

  describe('generateCodingProblem', () => {
    it('should parse and return the structured problem from Groq', async () => {
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_PROBLEM_JSON } }] });
      const result = await service.generateCodingProblem('Engineer', [], 'g1');
      expect(result.title).toBe('Two Sum');
      expect(result.testCases).toHaveLength(1);
    });

    it('should strip <think> tags before parsing', async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: `<think>reasoning</think>${MOCK_PROBLEM_JSON}` } }],
      });
      const result = await service.generateCodingProblem('Engineer', [], 'g1');
      expect(result.title).toBe('Two Sum');
    });

    it('should mention the chosen code language in the system prompt', async () => {
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_PROBLEM_JSON } }] });
      await service.generateCodingProblem('Engineer', [], 'g1', null, 'python');
      const call = mockGroqCreate.mock.calls[0][0];
      expect(call.messages[0].content).toContain('Python');
    });

    it('should instruct the model to avoid repeating prior problems', async () => {
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_PROBLEM_JSON } }] });
      const history = [{ question: 'Two Sum\n\nGiven an array...' }];
      await service.generateCodingProblem('Engineer', history, 'g1');
      const call = mockGroqCreate.mock.calls[0][0];
      expect(call.messages[0].content).toContain('Do not repeat');
    });

    it('should include company name in the system prompt when provided', async () => {
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_PROBLEM_JSON } }] });
      await service.generateCodingProblem('Engineer', [], 'g1', 'Acme Corp');
      const call = mockGroqCreate.mock.calls[0][0];
      expect(call.messages[0].content).toContain('Acme Corp');
    });

    it('should repair and parse JSON containing raw newlines inside string values', async () => {
      const brokenJson = `{"title": "Two Sum", "prompt": "Line one.\nLine two.", "examples": [], "constraints": [], "functionName": "twoSum", "functionSignature": "function twoSum(nums, target) {}", "testCases": [{"input": [[2, 7], 9], "expected": [0, 1]}]}`;
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: brokenJson } }] });
      const result = await service.generateCodingProblem('Engineer', [], 'g1');
      expect(result.title).toBe('Two Sum');
      expect(result.prompt).toBe('Line one.\nLine two.');
    });

    it('should repair JSON with a trailing comma before a closing bracket', async () => {
      const brokenJson = `{"title": "Two Sum", "prompt": "p", "examples": [], "constraints": [], "functionName": "twoSum", "functionSignature": "function twoSum(nums, target) {}", "testCases": [{"input": [[2, 7], 9], "expected": [0, 1]},]}`;
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: brokenJson } }] });
      const result = await service.generateCodingProblem('Engineer', [], 'g1');
      expect(result.title).toBe('Two Sum');
    });

    it('should strip markdown code fences around the JSON', async () => {
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: `\`\`\`json\n${MOCK_PROBLEM_JSON}\n\`\`\`` } }] });
      const result = await service.generateCodingProblem('Engineer', [], 'g1');
      expect(result.title).toBe('Two Sum');
    });

    it('should request JSON-mode output from Groq', async () => {
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_PROBLEM_JSON } }] });
      await service.generateCodingProblem('Engineer', [], 'g1');
      const call = mockGroqCreate.mock.calls[0][0];
      expect(call.response_format).toEqual({ type: 'json_object' });
    });

    // Groq's own server-side JSON validation (response_format: json_object) occasionally
    // rejects a generation outright with a 400 and code: json_validate_failed, handing back
    // the (near-valid) text as `failed_generation` on the thrown error's `.error.error`.
    function makeJsonValidateFailedError(failedGeneration) {
      const err = new Error('400 json_validate_failed');
      err.error = { error: { message: 'Failed to generate JSON.', type: 'invalid_request_error', code: 'json_validate_failed', failed_generation: failedGeneration } };
      return err;
    }

    it('should salvage a result from failed_generation without a retry when it repairs cleanly', async () => {
      mockGroqCreate.mockRejectedValueOnce(makeJsonValidateFailedError(MOCK_PROBLEM_JSON));
      const result = await service.generateCodingProblem('Engineer', [], 'g1');
      expect(result.title).toBe('Two Sum');
      expect(mockGroqCreate).toHaveBeenCalledTimes(1);
    });

    it('should retry once when failed_generation cannot be salvaged', async () => {
      mockGroqCreate
        .mockRejectedValueOnce(makeJsonValidateFailedError(''))
        .mockResolvedValueOnce({ choices: [{ message: { content: MOCK_PROBLEM_JSON } }] });

      const result = await service.generateCodingProblem('Engineer', [], 'g1');

      expect(result.title).toBe('Two Sum');
      expect(mockGroqCreate).toHaveBeenCalledTimes(2);
    });

    it('should give up after exhausting retries on repeated json_validate_failed errors', async () => {
      mockGroqCreate.mockRejectedValue(makeJsonValidateFailedError(''));
      await expect(service.generateCodingProblem('Engineer', [], 'g1')).rejects.toThrow();
      expect(mockGroqCreate).toHaveBeenCalledTimes(2);
    });

    // ── test-case verification against the model's own reference solution ────

    it('should correct a testCase\'s expected value when the reference solution disagrees', async () => {
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_PROBLEM_WITH_REF_JSON } }] });
      mockRunTestCases.mockResolvedValue({
        results: [{ pass: false, actual: [1, 0], expected: [0, 1] }],
        passCount: 0,
        total: 1,
      });

      const result = await service.generateCodingProblem('Engineer', [], 'g1');

      expect(mockRunTestCases).toHaveBeenCalledWith(
        MOCK_PROBLEM_WITH_REF.referenceSolution,
        'javascript',
        result.testCases,
        'twoSum'
      );
      expect(result.testCases[0].expected).toEqual([1, 0]);
    });

    it('should strip the referenceSolution field from the returned problem', async () => {
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_PROBLEM_WITH_REF_JSON } }] });
      mockRunTestCases.mockResolvedValue({
        results: [{ pass: true, actual: [0, 1], expected: [0, 1] }],
        passCount: 1,
        total: 1,
      });

      const result = await service.generateCodingProblem('Engineer', [], 'g1');

      expect(result.referenceSolution).toBeUndefined();
    });

    it('should leave testCases untouched when the reference solution already matches', async () => {
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_PROBLEM_WITH_REF_JSON } }] });
      mockRunTestCases.mockResolvedValue({
        results: [{ pass: true, actual: [0, 1], expected: [0, 1] }],
        passCount: 1,
        total: 1,
      });

      const result = await service.generateCodingProblem('Engineer', [], 'g1');

      expect(result.testCases[0].expected).toEqual([0, 1]);
    });

    it('should regenerate the problem when the reference solution errors on every test case', async () => {
      mockGroqCreate
        .mockResolvedValueOnce({ choices: [{ message: { content: MOCK_PROBLEM_WITH_REF_JSON } }] })
        .mockResolvedValueOnce({ choices: [{ message: { content: MOCK_PROBLEM_JSON } }] });
      mockRunTestCases.mockResolvedValueOnce({
        results: [{ pass: false, actual: null, expected: [0, 1], error: 'ReferenceError: twoSum is not defined' }],
        passCount: 0,
        total: 1,
      });

      const result = await service.generateCodingProblem('Engineer', [], 'g1');

      expect(mockGroqCreate).toHaveBeenCalledTimes(2);
      expect(mockRunTestCases).toHaveBeenCalledTimes(1); // second attempt's problem has no referenceSolution to verify
      expect(result.title).toBe('Two Sum');
    });

    it('should not block problem generation when the execution service itself fails', async () => {
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_PROBLEM_WITH_REF_JSON } }] });
      mockRunTestCases.mockRejectedValue(new Error('Judge0 request failed: ECONNREFUSED'));

      const result = await service.generateCodingProblem('Engineer', [], 'g1');

      expect(mockGroqCreate).toHaveBeenCalledTimes(1);
      expect(result.title).toBe('Broken Problem');
    });
  });

  // ── generateCodeFollowupQuestion ───────────────────────────────────────────

  describe('generateCodeFollowupQuestion', () => {
    const testResult = { results: [{ pass: true }, { pass: false }], passCount: 1, total: 2 };

    it('should call provider.chat and return the follow-up question text', async () => {
      mockChat.mockResolvedValue('Walk me through your approach.');
      const result = await service.generateCodeFollowupQuestion(MOCK_PROBLEM, 'function twoSum() {}', testResult, 'g1');
      expect(result).toBe('Walk me through your approach.');
    });

    it('should reference the actual pass count in the system prompt', async () => {
      mockChat.mockResolvedValue('Q?');
      await service.generateCodeFollowupQuestion(MOCK_PROBLEM, 'code', testResult, 'g1');
      const [systemPrompt] = mockChat.mock.calls[0];
      expect(systemPrompt).toContain('passing 1 of them');
    });

    it('should include the code and test results in the user content', async () => {
      mockChat.mockResolvedValue('Q?');
      await service.generateCodeFollowupQuestion(MOCK_PROBLEM, 'function twoSum() {}', testResult, 'g1');
      const [, userContent] = mockChat.mock.calls[0];
      expect(JSON.parse(userContent).code).toBe('function twoSum() {}');
    });
  });

  // ── submitCode / _waitForCodeSubmission ────────────────────────────────────

  describe('submitCode / _waitForCodeSubmission', () => {
    it('should resolve the pending wait with the submitted code', async () => {
      const session = {};
      const promise = service._waitForCodeSubmission(session);
      expect(typeof session.pendingCodeResolve).toBe('function');

      const resolved = service.submitCode('u1', 'function twoSum() {}');
      service.sessions.set('u1', session); // not required for this call, but mirrors real usage
      expect(resolved).toBe(false); // no session registered under 'u1' yet

      session.pendingCodeResolve('function twoSum() {}');
      await expect(promise).resolves.toBe('function twoSum() {}');
    });

    it('should return true and resolve via submitCode when the session is registered', async () => {
      const session = {};
      service.sessions.set('u1', session);
      const promise = service._waitForCodeSubmission(session);

      const resolved = service.submitCode('u1', 'my code');
      expect(resolved).toBe(true);
      await expect(promise).resolves.toBe('my code');
      expect(session.pendingCodeResolve).toBeNull();
    });

    it('should return false when there is no pending submission for the user', () => {
      service.sessions.set('u1', {});
      expect(service.submitCode('u1', 'code')).toBe(false);
    });

    it('should return false when the user has no active session', () => {
      expect(service.submitCode('ghost', 'code')).toBe(false);
    });

    it('should resolve with null after the timeout elapses with no submission', async () => {
      jest.useFakeTimers();
      try {
        const session = {};
        const promise = service._waitForCodeSubmission(session);
        await jest.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
        await expect(promise).resolves.toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // ── runSampleCode ─────────────────────────────────────────────────────────

  describe('runSampleCode', () => {
    function makeCodingProblemSession(overrides = {}) {
      return {
        codeLanguage: 'javascript',
        currentProblem: {
          functionName: 'twoSum',
          testCases: [
            { input: [[2, 7], 9], expected: [0, 1] },
            { input: [[3, 3], 6], expected: [0, 1] },
            { input: [[1, 1], 2], expected: [0, 1] }, // hidden — should never be sent to Run
          ],
        },
        runCount: 0,
        ...overrides,
      };
    }

    it('should return an error message when the user has no active problem', async () => {
      const result = await service.runSampleCode('ghost', 'code');
      expect(result.ok).toBe(false);
      expect(result.content).toContain('no coding question waiting');
      expect(mockRunTestCases).not.toHaveBeenCalled();
    });

    it('should run only the first SAMPLE_TEST_CASE_COUNT test cases', async () => {
      const session = makeCodingProblemSession();
      service.sessions.set('u1', session);
      mockRunTestCases.mockResolvedValue({
        results: [{ pass: true, actual: [0, 1], expected: [0, 1] }, { pass: true, actual: [0, 1], expected: [0, 1] }],
        passCount: 2,
        total: 2,
      });

      await service.runSampleCode('u1', 'function twoSum() {}');

      expect(mockRunTestCases).toHaveBeenCalledWith(
        'function twoSum() {}',
        'javascript',
        session.currentProblem.testCases.slice(0, 2),
        'twoSum'
      );
    });

    it('should report pass/fail counts and detail for failures', async () => {
      const session = makeCodingProblemSession();
      service.sessions.set('u1', session);
      mockRunTestCases.mockResolvedValue({
        results: [
          { pass: true, actual: [0, 1], expected: [0, 1] },
          { pass: false, actual: [1, 0], expected: [0, 1] },
        ],
        passCount: 1,
        total: 2,
      });

      const result = await service.runSampleCode('u1', 'function twoSum() {}');

      expect(result.ok).toBe(true);
      expect(result.content).toContain('1/2 sample tests passed');
      expect(result.content).toContain('Sample 1: ✅ Passed');
      expect(result.content).toContain('Sample 2: ❌ Failed');
    });

    it('should count down remaining runs and block after MAX_SAMPLE_RUNS', async () => {
      const session = makeCodingProblemSession();
      service.sessions.set('u1', session);
      mockRunTestCases.mockResolvedValue({
        results: [{ pass: true, actual: [0, 1], expected: [0, 1] }, { pass: true, actual: [0, 1], expected: [0, 1] }],
        passCount: 2,
        total: 2,
      });

      const first = await service.runSampleCode('u1', 'code');
      const second = await service.runSampleCode('u1', 'code');
      const third = await service.runSampleCode('u1', 'code');
      const fourth = await service.runSampleCode('u1', 'code');

      expect(first.content).toContain('2 run(s) remaining');
      expect(second.content).toContain('1 run(s) remaining');
      expect(third.content).toContain('0 run(s) remaining');
      expect(fourth.ok).toBe(false);
      expect(fourth.content).toContain('used all 3 sample runs');
      expect(mockRunTestCases).toHaveBeenCalledTimes(3);
    });

    it('should not resolve the pending Submit wait', async () => {
      const session = makeCodingProblemSession();
      service.sessions.set('u1', session);
      const waitPromise = service._waitForCodeSubmission(session);
      mockRunTestCases.mockResolvedValue({ results: [], passCount: 0, total: 0 });

      await service.runSampleCode('u1', 'code');

      expect(session.pendingCodeResolve).not.toBeNull();
      service.submitCode('u1', 'final code');
      await expect(waitPromise).resolves.toBe('final code');
    });

    it('should return a friendly error when execution fails', async () => {
      const session = makeCodingProblemSession();
      service.sessions.set('u1', session);
      mockRunTestCases.mockRejectedValue(new Error('Judge0 down'));

      const result = await service.runSampleCode('u1', 'code');

      expect(result.ok).toBe(false);
      expect(result.content).toContain('Something went wrong');
    });
  });

  // ── generateSummary ────────────────────────────────────────────────────────

  describe('generateSummary', () => {
    const history = [{ question: 'Q?', answer: 'A.' }];

    it('should parse and return the JSON summary from Groq', async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: MOCK_SUMMARY_JSON } }],
      });
      const result = await service.generateSummary('Engineer', history, 'g1');
      expect(result.score).toBe(7);
      expect(result.strengths).toEqual(['Clear communicator']);
      expect(result.gaps).toEqual(['Needs more examples']);
    });

    it('should strip <think> tags before parsing', async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: `<think>internal reasoning</think>${MOCK_SUMMARY_JSON}` } }],
      });
      const result = await service.generateSummary('Engineer', history, 'g1');
      expect(result.score).toBe(7);
    });

    it('should return fallback values when response is not valid JSON', async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: 'not valid json at all' } }],
      });
      const result = await service.generateSummary('Engineer', history, 'g1');
      expect(result.score).toBe(5);
      expect(result.strengths).toEqual(['Interview completed']);
    });

    it('should use the openai/gpt-oss-120b model', async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: MOCK_SUMMARY_JSON } }],
      });
      await service.generateSummary('Engineer', history, 'g1');
      expect(mockGroqCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'openai/gpt-oss-120b' })
      );
    });

    it('should include company name in the system prompt when provided', async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: MOCK_SUMMARY_JSON } }],
      });
      await service.generateSummary('Engineer', history, 'g1', 'Initech');
      const call = mockGroqCreate.mock.calls[0][0];
      expect(call.messages[0].content).toContain('Initech');
    });

    it('should request a narrative field in the system prompt', async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: MOCK_SUMMARY_JSON } }],
      });
      await service.generateSummary('Engineer', history, 'g1');
      const call = mockGroqCreate.mock.calls[0][0];
      expect(call.messages[0].content).toContain('"narrative"');
    });

    it('should instruct the model to respond in the chosen language when not English', async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: MOCK_SUMMARY_JSON } }],
      });
      await service.generateSummary('Engineer', history, 'g1', null, 'behavioral', 'fr');
      const call = mockGroqCreate.mock.calls[0][0];
      expect(call.messages[0].content).toContain('French');
    });

    it('should not add a language instruction for the default English language', async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: MOCK_SUMMARY_JSON } }],
      });
      await service.generateSummary('Engineer', history, 'g1');
      const call = mockGroqCreate.mock.calls[0][0];
      expect(call.messages[0].content).not.toContain('candidate interviewed in');
    });

    it('should instruct the model to weigh test results for leetcode style', async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: MOCK_SUMMARY_JSON } }],
      });
      await service.generateSummary('Engineer', history, 'g1', null, 'leetcode');
      const call = mockGroqCreate.mock.calls[0][0];
      expect(call.messages[0].content).toContain('testResults');
    });

    it('should include code and testResults from history entries in the user content', async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: MOCK_SUMMARY_JSON } }],
      });
      const codingHistory = [{
        question: 'Two Sum',
        code: 'function twoSum() {}',
        codeLanguage: 'javascript',
        testResults: { passCount: 1, total: 2, results: [] },
        answer: 'I used a hash map.',
      }];
      await service.generateSummary('Engineer', codingHistory, 'g1', null, 'leetcode');
      const call = mockGroqCreate.mock.calls[0][0];
      const userContent = JSON.parse(call.messages[1].content);
      expect(userContent.interview_transcript[0].code).toBe('function twoSum() {}');
      expect(userContent.interview_transcript[0].testResults.passCount).toBe(1);
    });
  });

  // ── _localize ──────────────────────────────────────────────────────────────

  describe('_localize', () => {
    it('should return the text unchanged for the default English language', async () => {
      const result = await service._localize('Hello there', 'en', 'g1');
      expect(result).toBe('Hello there');
      expect(mockChat).not.toHaveBeenCalled();
    });

    it('should translate the text via the chat provider for other languages', async () => {
      mockChat.mockResolvedValue('Hola');
      const result = await service._localize('Hello', 'es', 'g1');
      expect(result).toBe('Hola');
      expect(mockChat).toHaveBeenCalledWith(
        expect.stringContaining('Spanish'),
        'Hello',
        expect.any(Object)
      );
    });

    it('should fall back to the original text if translation fails', async () => {
      mockChat.mockRejectedValue(new Error('provider down'));
      const result = await service._localize('Hello', 'es', 'g1');
      expect(result).toBe('Hello');
    });
  });

  // ── _buildSummaryEmbed ─────────────────────────────────────────────────────

  describe('_buildSummaryEmbed', () => {
    const member = makeMember();

    it('should use green color for score >= 8', () => {
      service._buildSummaryEmbed({ score: 8, strengths: [], gaps: [] }, [], member);
      expect(EmbedBuilder.mock.results[0].value.setColor).toHaveBeenCalledWith(0x2ecc71);
    });

    it('should use orange color for score 5-7', () => {
      service._buildSummaryEmbed({ score: 6, strengths: [], gaps: [] }, [], member);
      expect(EmbedBuilder.mock.results[0].value.setColor).toHaveBeenCalledWith(0xf39c12);
    });

    it('should use red color for score < 5', () => {
      service._buildSummaryEmbed({ score: 3, strengths: [], gaps: [] }, [], member);
      expect(EmbedBuilder.mock.results[0].value.setColor).toHaveBeenCalledWith(0xe74c3c);
    });

    it('should show "None identified" when strengths and gaps are empty', () => {
      service._buildSummaryEmbed({ score: 5, strengths: [], gaps: [] }, [], member);
      expect(EmbedBuilder.mock.results[0].value.addFields).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ value: '• None identified' }),
        expect.objectContaining({ value: '• None identified' })
      );
    });

    it('should include strengths and gaps in the embed fields', () => {
      service._buildSummaryEmbed({ score: 7, strengths: ['Leadership'], gaps: ['Needs clarity'] }, [], member);
      expect(EmbedBuilder.mock.results[0].value.addFields).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ value: '• Leadership' }),
        expect.objectContaining({ value: '• Needs clarity' })
      );
    });

    it('should add a Coaching Notes field when narrative is present', () => {
      service._buildSummaryEmbed({ score: 7, strengths: [], gaps: [], narrative: 'Work on concise answers.' }, [], member);
      expect(EmbedBuilder.mock.results[0].value.addFields).toHaveBeenCalledWith(
        expect.objectContaining({ name: '📝 Coaching Notes', value: 'Work on concise answers.' })
      );
    });

    it('should not add a Coaching Notes field when narrative is missing or blank', () => {
      service._buildSummaryEmbed({ score: 7, strengths: [], gaps: [] }, [], member);
      const calls = EmbedBuilder.mock.results[0].value.addFields.mock.calls;
      expect(calls.some(args => args[0]?.name === '📝 Coaching Notes')).toBe(false);
    });

    it('should show questions answered out of MAX_QUESTIONS', () => {
      const history = [{ question: 'Q?', answer: 'A.' }, { question: 'Q2?', answer: 'A2.' }];
      service._buildSummaryEmbed({ score: 7, strengths: [], gaps: [] }, history, member);
      expect(EmbedBuilder.mock.results[0].value.addFields).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ value: '2/8' }),
        expect.anything(),
        expect.anything()
      );
    });

    it('should show questions answered out of the coding-specific cap for leetcode', () => {
      const history = [{ question: 'Two Sum', answer: 'A.' }];
      service._buildSummaryEmbed({ score: 7, strengths: [], gaps: [] }, history, member, 'leetcode');
      expect(EmbedBuilder.mock.results[0].value.addFields).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ value: '1/2' }),
        expect.anything(),
        expect.anything()
      );
    });

    it('should add a Test Results field when history entries have testResults', () => {
      const history = [{ question: 'Two Sum', answer: 'A.', testResults: { passCount: 3, total: 5 } }];
      service._buildSummaryEmbed({ score: 7, strengths: [], gaps: [] }, history, member);
      expect(EmbedBuilder.mock.results[0].value.addFields).toHaveBeenCalledWith(
        expect.objectContaining({ name: '🧪 Test Results', value: 'Q1: 3/5 tests passed' })
      );
    });

    it('should not add a Test Results field when no history entries have testResults', () => {
      const history = [{ question: 'Q?', answer: 'A.' }];
      service._buildSummaryEmbed({ score: 7, strengths: [], gaps: [] }, history, member);
      const calls = EmbedBuilder.mock.results[0].value.addFields.mock.calls;
      expect(calls.some(args => args[0]?.name === '🧪 Test Results')).toBe(false);
    });
  });

  // ── _buildTranscriptAttachment ────────────────────────────────────────────

  describe('_buildTranscriptAttachment', () => {
    const member = makeMember();

    it('should build a text attachment named interview-transcript.txt', () => {
      const attachment = service._buildTranscriptAttachment([{ question: 'Q?', answer: 'A.' }], member, null);
      expect(AttachmentBuilder).toHaveBeenCalledWith(expect.any(Buffer), { name: 'interview-transcript.txt' });
      expect(attachment.name).toBe('interview-transcript.txt');
    });

    it('should include every question and answer in order', () => {
      const history = [
        { question: 'What is your greatest strength?', answer: 'Communication.' },
        { question: 'Tell me about a challenge.', answer: 'Handled a tight deadline.' },
      ];
      const attachment = service._buildTranscriptAttachment(history, member, null);
      const text = attachment.buffer.toString('utf-8');
      expect(text).toContain('Q1: What is your greatest strength?');
      expect(text).toContain('A1: Communication.');
      expect(text).toContain('Q2: Tell me about a challenge.');
      expect(text).toContain('A2: Handled a tight deadline.');
    });

    it('should note unanswered questions', () => {
      const attachment = service._buildTranscriptAttachment([{ question: 'Q?', answer: '' }], member, null);
      expect(attachment.buffer.toString('utf-8')).toContain('(no answer captured)');
    });

    it('should include company name when provided', () => {
      const attachment = service._buildTranscriptAttachment([], member, 'Acme Corp');
      expect(attachment.buffer.toString('utf-8')).toContain('Company: Acme Corp');
    });

    it('should omit the company line when not provided', () => {
      const attachment = service._buildTranscriptAttachment([], member, null);
      expect(attachment.buffer.toString('utf-8')).not.toContain('Company:');
    });

    it('should include the language line for non-English interviews', () => {
      const attachment = service._buildTranscriptAttachment([], member, null, 'ja');
      expect(attachment.buffer.toString('utf-8')).toContain('Language: Japanese');
    });

    it('should omit the language line for the default English language', () => {
      const attachment = service._buildTranscriptAttachment([], member, null, 'en');
      expect(attachment.buffer.toString('utf-8')).not.toContain('Language:');
    });

    it('should include the submitted code and test pass counts when present', () => {
      const history = [{
        question: 'Two Sum',
        code: 'function twoSum() {}',
        codeLanguage: 'javascript',
        testResults: {
          passCount: 1,
          total: 2,
          results: [{ pass: true, actual: [0, 1], expected: [0, 1] }, { pass: false, actual: [1, 2], expected: [0, 1] }],
        },
        answer: 'I used a hash map.',
      }];
      const attachment = service._buildTranscriptAttachment(history, member, null);
      const text = attachment.buffer.toString('utf-8');
      expect(text).toContain('Submitted Code (javascript):');
      expect(text).toContain('function twoSum() {}');
      expect(text).toContain('Tests: 1/2 passed');
      expect(text).toContain('Test 1: PASS');
      expect(text).toContain('Test 2: FAIL');
    });

    it('should not include a code section when no code was submitted', () => {
      const attachment = service._buildTranscriptAttachment([{ question: 'Q?', answer: 'A.' }], member, null);
      expect(attachment.buffer.toString('utf-8')).not.toContain('Submitted Code');
    });
  });

  // ── _cleanup ───────────────────────────────────────────────────────────────

  describe('_cleanup', () => {
    it('should destroy the connection and delete the voice channel', async () => {
      const connection = { destroy: jest.fn() };
      const voiceChannel = makeVoiceChannel();
      service.sessions.set('u1', { connection, voiceChannel });
      service.players.set('u1', {});

      await service._cleanup('u1');

      expect(connection.destroy).toHaveBeenCalled();
      expect(voiceChannel.delete).toHaveBeenCalled();
      expect(service.sessions.has('u1')).toBe(false);
      expect(service.players.has('u1')).toBe(false);
    });

    it('should not throw when no session exists', async () => {
      await expect(service._cleanup('nonexistent')).resolves.not.toThrow();
    });
  });

  // ── stopInterview ──────────────────────────────────────────────────────────

  describe('stopInterview', () => {
    it('should do nothing when no session exists', async () => {
      await expect(service.stopInterview('unknown')).resolves.not.toThrow();
    });

    it('should clean up the session', async () => {
      const session = {
        aborted: false,
        history: [],
        jdText: 'jd',
        guildId: 'g1',
        company: null,
        style: 'behavioral',
        member: makeMember(),
        originalChannel: makeOriginalChannel(),
        connection: { destroy: jest.fn() },
        voiceChannel: makeVoiceChannel(),
      };
      service.sessions.set('u1', session);
      await service.stopInterview('u1');
      expect(service.sessions.has('u1')).toBe(false);
    });

    it('should generate and DM a summary if history has entries', async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: MOCK_SUMMARY_JSON } }],
      });
      const member = makeMember();
      service.sessions.set('u1', {
        aborted: false,
        history: [{ question: 'Q?', answer: 'A.' }],
        jdText: 'Engineer role',
        guildId: 'g1',
        company: null,
        style: 'behavioral',
        member,
        originalChannel: makeOriginalChannel(),
        connection: { destroy: jest.fn() },
        voiceChannel: makeVoiceChannel(),
      });

      await service.stopInterview('u1');

      expect(member.send).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array), files: expect.any(Array) })
      );
    });

    it('should fall back to originalChannel if the member DM fails', async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: MOCK_SUMMARY_JSON } }],
      });
      const member = makeMember();
      member.send.mockRejectedValue(new Error('DM blocked'));
      const originalChannel = makeOriginalChannel();
      service.sessions.set('u1', {
        aborted: false,
        history: [{ question: 'Q?', answer: 'A.' }],
        jdText: 'Engineer role',
        guildId: 'g1',
        company: null,
        style: 'behavioral',
        member,
        originalChannel,
        connection: { destroy: jest.fn() },
        voiceChannel: makeVoiceChannel(),
      });

      await service.stopInterview('u1');

      expect(originalChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );
    });

    it('should not generate a summary when history is empty', async () => {
      service.sessions.set('u1', {
        aborted: false,
        history: [],
        jdText: 'jd',
        guildId: 'g1',
        company: null,
        style: 'behavioral',
        member: makeMember(),
        originalChannel: makeOriginalChannel(),
        connection: { destroy: jest.fn() },
        voiceChannel: makeVoiceChannel(),
      });

      await service.stopInterview('u1');

      expect(mockGroqCreate).not.toHaveBeenCalled();
    });
  });

  // ── captureAnswer ──────────────────────────────────────────────────────────

  describe('captureAnswer', () => {
    it('should return empty string when stream ends with no audio data', async () => {
      const receiver = { subscribe: jest.fn().mockReturnValue(makeOpusStream()) };
      const result = await service.captureAnswer(receiver, 'u1', 'g1');
      expect(result).toBe('');
    });

    it('should return transcribed text when sufficient audio is captured', async () => {
      // 60 packets × 1000 decoded bytes = 60 000 bytes > 57 600 minimum
      const packets = Array(60).fill(Buffer.alloc(10));
      const receiver = { subscribe: jest.fn().mockReturnValue(makeOpusStream({ packets })) };
      service.transcriptionService.transcribe.mockResolvedValue({ text: 'Hello world' });

      const result = await service.captureAnswer(receiver, 'u1', 'g1');

      expect(service.transcriptionService.transcribe).toHaveBeenCalled();
      expect(result).toBe('Hello world');
    });

    it('should return empty string on stream error', async () => {
      const receiver = {
        subscribe: jest.fn().mockReturnValue(makeOpusStream({ error: new Error('stream failure') })),
      };
      const result = await service.captureAnswer(receiver, 'u1', 'g1');
      expect(result).toBe('');
    });

    it('should return empty string when transcription returns null', async () => {
      const packets = Array(60).fill(Buffer.alloc(10));
      const receiver = { subscribe: jest.fn().mockReturnValue(makeOpusStream({ packets })) };
      service.transcriptionService.transcribe.mockResolvedValue(null);

      const result = await service.captureAnswer(receiver, 'u1', 'g1');

      expect(result).toBe('');
    });

    it('should forward the language hint to the transcription service', async () => {
      const packets = Array(60).fill(Buffer.alloc(10));
      const receiver = { subscribe: jest.fn().mockReturnValue(makeOpusStream({ packets })) };
      service.transcriptionService.transcribe.mockResolvedValue({ text: 'Bonjour' });

      await service.captureAnswer(receiver, 'u1', 'g1', 'fr');

      expect(service.transcriptionService.transcribe).toHaveBeenCalledWith('/tmp/test.wav', 'g1', 'fr');
    });
  });

  // ── speakQuestion ──────────────────────────────────────────────────────────

  describe('speakQuestion', () => {
    it('should use the default English voice when none is specified', async () => {
      const connection = { subscribe: jest.fn() };
      await service.speakQuestion(connection, 'u1', 'Hello');
      const ttsInstance = MsEdgeTTS.mock.results[MsEdgeTTS.mock.results.length - 1].value;
      expect(ttsInstance.setMetadata).toHaveBeenCalledWith('en-US-AriaNeural', 'webm-opus');
    });

    it('should use the provided voice for non-English languages', async () => {
      const connection = { subscribe: jest.fn() };
      await service.speakQuestion(connection, 'u1', 'Hola', 'es-ES-ElviraNeural');
      const ttsInstance = MsEdgeTTS.mock.results[MsEdgeTTS.mock.results.length - 1].value;
      expect(ttsInstance.setMetadata).toHaveBeenCalledWith('es-ES-ElviraNeural', 'webm-opus');
    });
  });

  // ── _waitForMemberJoin ─────────────────────────────────────────────────────

  describe('_waitForMemberJoin', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should resolve true immediately if the member is already in the channel', async () => {
      const member = makeMember('u1', 'vc1');
      const voiceChannel = makeVoiceChannel();
      const session = { aborted: false };

      await expect(service._waitForMemberJoin(member, voiceChannel, session)).resolves.toBe(true);
    });

    it('should resolve true once the member joins the channel', async () => {
      const member = makeMember('u1', null);
      const voiceChannel = makeVoiceChannel();
      const session = { aborted: false };

      const promise = service._waitForMemberJoin(member, voiceChannel, session);
      member.voice.channelId = 'vc1';
      await jest.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBe(true);
    });

    it('should resolve false if the member never joins before the timeout', async () => {
      const member = makeMember('u1', null);
      const voiceChannel = makeVoiceChannel();
      const session = { aborted: false };

      const promise = service._waitForMemberJoin(member, voiceChannel, session);
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);

      await expect(promise).resolves.toBe(false);
    });

    it('should resolve false early if the session is aborted while waiting', async () => {
      const member = makeMember('u1', null);
      const voiceChannel = makeVoiceChannel();
      const session = { aborted: false };

      const promise = service._waitForMemberJoin(member, voiceChannel, session);
      session.aborted = true;
      await jest.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBe(false);
    });
  });

  // ── _runCodingQuestion ─────────────────────────────────────────────────────

  describe('_runCodingQuestion', () => {
    function makeCodingSession(overrides = {}) {
      return {
        guildId: 'g1',
        company: null,
        language: 'en',
        codeLanguage: 'javascript',
        jdText: 'Engineer role',
        history: [],
        voiceChannel: { ...makeVoiceChannel(), send: jest.fn().mockResolvedValue(undefined) },
        aborted: false,
        currentProblem: null,
        pendingCodeResolve: null,
        ...overrides,
      };
    }

    it('should run the full flow and push a rich history entry when code is submitted', async () => {
      const session = makeCodingSession();
      jest.spyOn(service, 'generateCodingProblem').mockResolvedValue(MOCK_PROBLEM);
      jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);
      jest.spyOn(service, '_waitForCodeSubmission').mockResolvedValue('function twoSum() {}');
      const testResult = { results: [{ pass: true }], passCount: 1, total: 1 };
      mockRunTestCases.mockResolvedValue(testResult);
      jest.spyOn(service, 'generateCodeFollowupQuestion').mockResolvedValue('Walk me through it.');
      jest.spyOn(service, 'captureAnswer').mockResolvedValue('I used a hash map.');

      await service._runCodingQuestion(session, {}, {}, 'u1', 'en-US-AriaNeural');

      expect(mockRunTestCases).toHaveBeenCalledWith('function twoSum() {}', 'javascript', MOCK_PROBLEM.testCases, 'twoSum');
      expect(session.voiceChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array), components: expect.any(Array) })
      );
      expect(session.history).toHaveLength(1);
      expect(session.history[0]).toMatchObject({
        code: 'function twoSum() {}',
        codeLanguage: 'javascript',
        testResults: testResult,
        answer: 'I used a hash map.',
      });
    });

    it('should skip test execution and use a fallback follow-up when no code is submitted', async () => {
      const session = makeCodingSession();
      jest.spyOn(service, 'generateCodingProblem').mockResolvedValue(MOCK_PROBLEM);
      jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);
      jest.spyOn(service, '_waitForCodeSubmission').mockResolvedValue(null);
      jest.spyOn(service, 'captureAnswer').mockResolvedValue('I would use a hash map.');

      await service._runCodingQuestion(session, {}, {}, 'u1', 'en-US-AriaNeural');

      expect(mockRunTestCases).not.toHaveBeenCalled();
      expect(session.history).toHaveLength(1);
      expect(session.history[0].code).toBeNull();
      expect(session.history[0].testResults).toBeNull();
    });

    it('should speak an apology and skip the turn when problem generation fails', async () => {
      const session = makeCodingSession();
      jest.spyOn(service, 'generateCodingProblem').mockRejectedValue(new Error('Unterminated string in JSON at position 1150'));
      jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);

      await service._runCodingQuestion(session, {}, {}, 'u1', 'en-US-AriaNeural');

      expect(service.speakQuestion).toHaveBeenCalledTimes(1);
      expect(session.voiceChannel.send).not.toHaveBeenCalled();
      expect(session.history).toHaveLength(0);
    });

    it('should not speak an apology if the session was already aborted when generation fails', async () => {
      const session = makeCodingSession({ aborted: true });
      jest.spyOn(service, 'generateCodingProblem').mockRejectedValue(new Error('boom'));
      jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);

      await service._runCodingQuestion(session, {}, {}, 'u1', 'en-US-AriaNeural');

      expect(service.speakQuestion).not.toHaveBeenCalled();
    });

    it('should not push to history when aborted after the code wait resolves', async () => {
      const session = makeCodingSession();
      jest.spyOn(service, 'generateCodingProblem').mockResolvedValue(MOCK_PROBLEM);
      jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);
      jest.spyOn(service, '_waitForCodeSubmission').mockImplementation(async () => {
        session.aborted = true;
        return null;
      });
      jest.spyOn(service, 'captureAnswer').mockResolvedValue('should not be called');

      await service._runCodingQuestion(session, {}, {}, 'u1', 'en-US-AriaNeural');

      expect(session.history).toHaveLength(0);
      expect(service.captureAnswer).not.toHaveBeenCalled();
    });
  });

  // ── startInterview ─────────────────────────────────────────────────────────

  describe('startInterview', () => {
    it('should join the voice channel with correct params', async () => {
      jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);
      jest.spyOn(service, 'captureAnswer').mockResolvedValue('A solid answer');
      mockChat.mockResolvedValue('Tell me about yourself.');
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_SUMMARY_JSON } }] });

      await service.startInterview(makeGuild(), makeMember(), makeVoiceChannel(), makeOriginalChannel(), 'Engineer');

      expect(joinVoiceChannel).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: 'vc1', guildId: 'g1' })
      );
    });

    it('should dispatch to _runCodingQuestion for the leetcode style', async () => {
      jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);
      const runCodingQuestion = jest.spyOn(service, '_runCodingQuestion').mockResolvedValue(undefined);

      await service.startInterview(makeGuild(), makeMember(), makeVoiceChannel(), makeOriginalChannel(), 'Engineer', null, 'leetcode');

      expect(runCodingQuestion).toHaveBeenCalled();
    });

    it('should cap leetcode interviews at 2 questions instead of the usual 8', async () => {
      jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);
      const runCodingQuestion = jest.spyOn(service, '_runCodingQuestion').mockResolvedValue(undefined);
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_SUMMARY_JSON } }] });

      await service.startInterview(makeGuild(), makeMember(), makeVoiceChannel(), makeOriginalChannel(), 'Engineer', null, 'leetcode');

      expect(runCodingQuestion).toHaveBeenCalledTimes(2);
    });

    it('should mention the correct question count in the spoken intro for leetcode', async () => {
      const speakQuestion = jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);
      jest.spyOn(service, '_runCodingQuestion').mockResolvedValue(undefined);
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_SUMMARY_JSON } }] });

      await service.startInterview(makeGuild(), makeMember(), makeVoiceChannel(), makeOriginalChannel(), 'Engineer', null, 'leetcode');

      const introText = speakQuestion.mock.calls[0][2];
      expect(introText).toContain('a series of 2 questions');
    });

    it('should DM the summary embed to the member after all questions', async () => {
      jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);
      jest.spyOn(service, 'captureAnswer').mockResolvedValue('A solid answer');
      mockChat.mockResolvedValue('Next question?');
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_SUMMARY_JSON } }] });

      const member = makeMember();
      await service.startInterview(makeGuild(), member, makeVoiceChannel(), makeOriginalChannel(), 'Engineer');

      expect(member.send).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array), files: expect.any(Array) })
      );
    });

    it('should fall back to originalChannel if member DM fails', async () => {
      jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);
      jest.spyOn(service, 'captureAnswer').mockResolvedValue('Answer');
      mockChat.mockResolvedValue('Q?');
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_SUMMARY_JSON } }] });

      const member = makeMember();
      member.send.mockRejectedValue(new Error('DM blocked'));
      const originalChannel = makeOriginalChannel();

      await service.startInterview(makeGuild(), member, makeVoiceChannel(), originalChannel, 'Engineer');

      expect(originalChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );
    });

    it('should send an error message and clean up when the connection never becomes ready', async () => {
      entersState.mockRejectedValueOnce(new Error('Timeout'));
      const originalChannel = makeOriginalChannel();

      await service.startInterview(makeGuild(), makeMember(), makeVoiceChannel(), originalChannel, 'Engineer');

      expect(originalChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('Failed to join')
      );
      expect(service.sessions.has('u1')).toBe(false);
    });

    it('should re-prompt once when the first answer is too short', async () => {
      jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);
      const captureAnswer = jest.spyOn(service, 'captureAnswer');
      // First answer is too short (<=5 chars), subsequent ones are not
      captureAnswer.mockResolvedValueOnce('ok').mockResolvedValue('A longer answer here');
      mockChat.mockResolvedValue('Q?');
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_SUMMARY_JSON } }] });

      await service.startInterview(makeGuild(), makeMember(), makeVoiceChannel(), makeOriginalChannel(), 'Engineer');

      // 8 questions + 1 re-prompt on Q1 = 9 total captureAnswer calls
      expect(captureAnswer).toHaveBeenCalledTimes(9);
    });

    it('should not send a summary when aborted before any Q&A', async () => {
      jest.spyOn(service, 'speakQuestion').mockImplementation(async () => {
        // Abort on the welcome message (first speakQuestion call)
        const session = service.sessions.get('u1');
        if (session) session.aborted = true;
      });
      jest.spyOn(service, 'captureAnswer').mockResolvedValue('');
      mockChat.mockResolvedValue('Q?');

      const member = makeMember();
      await service.startInterview(makeGuild(), member, makeVoiceChannel(), makeOriginalChannel(), 'Engineer');

      expect(mockGroqCreate).not.toHaveBeenCalled();
      expect(member.send).not.toHaveBeenCalled();
    });

    it('should clean up the session when the interview ends', async () => {
      jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);
      jest.spyOn(service, 'captureAnswer').mockResolvedValue('Answer');
      mockChat.mockResolvedValue('Q?');
      mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_SUMMARY_JSON } }] });

      await service.startInterview(makeGuild(), makeMember(), makeVoiceChannel(), makeOriginalChannel(), 'Engineer');

      expect(service.sessions.has('u1')).toBe(false);
      expect(service.players.has('u1')).toBe(false);
    });

    it('should not speak the intro until the member actually joins the voice channel', async () => {
      jest.useFakeTimers();
      try {
        const speakQuestion = jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);
        jest.spyOn(service, 'captureAnswer').mockResolvedValue('Answer');
        mockChat.mockResolvedValue('Q?');
        mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: MOCK_SUMMARY_JSON } }] });

        const member = makeMember('u1', null);
        const voiceChannel = makeVoiceChannel();
        const promise = service.startInterview(makeGuild(), member, voiceChannel, makeOriginalChannel(), 'Engineer');

        await jest.advanceTimersByTimeAsync(2000);
        expect(speakQuestion).not.toHaveBeenCalled();

        member.voice.channelId = voiceChannel.id;
        await jest.advanceTimersByTimeAsync(1000);
        await promise;

        expect(speakQuestion).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('should cancel and notify the channel if the member never joins', async () => {
      jest.useFakeTimers();
      try {
        const speakQuestion = jest.spyOn(service, 'speakQuestion').mockResolvedValue(undefined);
        const member = makeMember('u1', null);
        const voiceChannel = makeVoiceChannel();
        const originalChannel = makeOriginalChannel();

        const promise = service.startInterview(makeGuild(), member, voiceChannel, originalChannel, 'Engineer');
        await jest.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
        await promise;

        expect(speakQuestion).not.toHaveBeenCalled();
        expect(originalChannel.send).toHaveBeenCalledWith(expect.stringContaining("didn't join"));
        expect(service.sessions.has('u1')).toBe(false);
        expect(voiceChannel.delete).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
