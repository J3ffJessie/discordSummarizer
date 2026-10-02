jest.mock('../../providers', () => ({
  createChatProvider: jest.fn(),
  resolveConfig: jest.fn(),
  supportsVision: jest.fn(),
}));

const { createChatProvider, resolveConfig, supportsVision } = require('../../providers');
const { ResumeReviewService, ResumeReviewError, DEFAULT_ROLE } = require('../resumeReviewService');

const RESUME_TEXT = 'Jane Doe — Software Engineer. Built scalable services handling 1M requests/day.';

function mockFetch(body = RESUME_TEXT, { ok = true, status = 200 } = {}) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    arrayBuffer: async () => Buffer.from(body),
  });
}

describe('ResumeReviewService', () => {
  let service;
  let provider;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ResumeReviewService();
    provider = {
      chat: jest.fn().mockResolvedValue('TEXT REVIEW'),
      chatWithVision: jest.fn().mockResolvedValue('IMAGE REVIEW'),
    };
    createChatProvider.mockReturnValue(provider);
    resolveConfig.mockReturnValue({ provider: 'anthropic' });
    supportsVision.mockReturnValue(true);
    mockFetch();
  });

  describe('review', () => {
    it('reviews a text resume and includes the preface and target role', async () => {
      const result = await service.review({ url: 'u', size: 100, filename: 'resume.txt', targetRole: 'Backend Engineer' });

      expect(result).toContain('auto generated review');
      expect(result).toContain('TEXT REVIEW');
      expect(provider.chat.mock.calls[0][0]).toContain('Backend Engineer');
      expect(provider.chat.mock.calls[0][1]).toContain(RESUME_TEXT);
    });

    it('defaults the target role when none is given', async () => {
      await service.review({ url: 'u', size: 100, filename: 'resume.txt' });
      expect(provider.chat.mock.calls[0][0]).toContain(DEFAULT_ROLE);
    });

    it('reviews image resumes with a vision-capable provider', async () => {
      const result = await service.review({ url: 'u', size: 100, filename: 'Resume.PNG' });

      expect(result).toContain('IMAGE REVIEW');
      expect(provider.chatWithVision).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(Buffer), 'image/png');
    });

    it('rejects image resumes when the provider lacks vision, without downloading', async () => {
      supportsVision.mockReturnValue(false);
      resolveConfig.mockReturnValue({ provider: 'groq' });

      await expect(service.review({ url: 'u', size: 100, filename: 'resume.jpg' }))
        .rejects.toThrow(/groq/);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects unsupported file types', async () => {
      await expect(service.review({ url: 'u', size: 100, filename: 'resume.exe' }))
        .rejects.toBeInstanceOf(ResumeReviewError);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects files over 10 MB as a user-facing error', async () => {
      await expect(service.review({ url: 'u', size: 11 * 1024 * 1024, filename: 'resume.pdf' }))
        .rejects.toThrow(new ResumeReviewError('File too large (max 10 MB).'));
    });

    it('rejects files with too little readable text', async () => {
      mockFetch('short');
      await expect(service.review({ url: 'u', size: 5, filename: 'resume.txt' }))
        .rejects.toThrow(/extract readable text/);
    });

    it('surfaces missing API key errors as user-facing errors', async () => {
      provider.chat.mockRejectedValue(new Error('No API key configured for groq'));
      await expect(service.review({ url: 'u', size: 100, filename: 'resume.txt' }))
        .rejects.toThrow(new ResumeReviewError("Resume review isn't configured — No API key configured for groq"));
    });

    it('explains when the configured model is unavailable', async () => {
      resolveConfig.mockReturnValue({ provider: 'groq', model: 'llama-3.1-8b-instant' });
      provider.chat.mockRejectedValue(Object.assign(new Error('model_not_found'), { status: 404 }));

      const err = await service.review({ url: 'u', size: 100, filename: 'resume.txt' }).catch(e => e);

      expect(err).toBeInstanceOf(ResumeReviewError);
      expect(err.message).toContain('llama-3.1-8b-instant');
      expect(err.message).toContain('/setup ai');
    });

    it('rethrows unexpected errors unchanged', async () => {
      mockFetch('', { ok: false, status: 500 });
      const err = await service.review({ url: 'u', size: 100, filename: 'resume.txt' }).catch(e => e);
      expect(err).not.toBeInstanceOf(ResumeReviewError);
      expect(err.message).toMatch(/HTTP 500/);
    });
  });

  describe('sendToUser', () => {
    it('sends short reviews in a single DM', async () => {
      const user = { send: jest.fn().mockResolvedValue() };
      await service.sendToUser(user, 'hello');
      expect(user.send).toHaveBeenCalledTimes(1);
    });

    it('splits long reviews into chunks under the Discord limit, preserving content', async () => {
      const user = { send: jest.fn().mockResolvedValue() };
      const text = Array.from({ length: 200 }, (_, i) => `Line ${i} of the review`).join('\n');

      await service.sendToUser(user, text);

      const sent = user.send.mock.calls.map(c => c[0]);
      expect(sent.length).toBeGreaterThan(1);
      sent.forEach(chunk => expect(chunk.length).toBeLessThanOrEqual(1900));
      expect(sent.join('\n')).toBe(text);
    });
  });
});
