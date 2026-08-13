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
    addFields: jest.fn().mockReturnThis(),
    setTimestamp: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
  })),
  AttachmentBuilder: jest.fn().mockImplementation((buffer, opts) => ({ buffer, ...opts })),
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

function makeMember(id = 'u1') {
  return {
    id,
    displayName: 'Alice',
    user: { id, username: 'alice' },
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

    it('should use the llama-3.3-70b-versatile model', async () => {
      mockGroqCreate.mockResolvedValue({
        choices: [{ message: { content: MOCK_SUMMARY_JSON } }],
      });
      await service.generateSummary('Engineer', history, 'g1');
      expect(mockGroqCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'llama-3.3-70b-versatile' })
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
  });
});
