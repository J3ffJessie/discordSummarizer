const mockChat = jest.fn();

jest.mock('../../providers', () => ({
  createChatProvider: jest.fn(() => ({ chat: mockChat })),
}));
jest.mock('dotenv', () => ({ config: jest.fn() }));

const { SummarizationService } = require('../groq');

describe('SummarizationService (groq)', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SummarizationService(null);
  });

  // ─── summarizeMessages ──────────────────────────────────────────────────────

  describe('summarizeMessages', () => {
    it('should call provider.chat with correct options and return content', async () => {
      mockChat.mockResolvedValue('• Point 1\n• Point 2');

      const result = await service.summarizeMessages('User1: Hello\nUser2: Hi');

      expect(mockChat).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('User1: Hello'),
        expect.objectContaining({ temperature: 0.7, max_tokens: 1024 })
      );
      expect(result).toBe('• Point 1\n• Point 2');
    });

    it('should include the messages in the user content', async () => {
      mockChat.mockResolvedValue('summary');

      const input = 'Alice: hello\nBob: world';
      await service.summarizeMessages(input);

      const [, userContent] = mockChat.mock.calls[0];
      expect(userContent).toContain(input);
    });

    it('should include a system prompt', async () => {
      mockChat.mockResolvedValue('summary');

      await service.summarizeMessages('test');

      const [systemPrompt] = mockChat.mock.calls[0];
      expect(systemPrompt.length).toBeGreaterThan(0);
    });

    it('should throw when provider chat fails', async () => {
      mockChat.mockRejectedValue(new Error('API error'));

      await expect(service.summarizeMessages('test')).rejects.toThrow('API error');
    });
  });

  // ─── serverSummarize ────────────────────────────────────────────────────────

  describe('serverSummarize', () => {
    it('should call provider.chat with correct options and return content', async () => {
      mockChat.mockResolvedValue('📋 **Summary**\nTalk happened.');

      const result = await service.serverSummarize('[general] Alice: hello');

      expect(mockChat).toHaveBeenCalledWith(
        expect.stringContaining('summarizer'),
        expect.any(String),
        expect.objectContaining({ temperature: 0.3, max_tokens: 1024 })
      );
      expect(result).toContain('Summary');
    });

    it('should include the messages in the user content', async () => {
      mockChat.mockResolvedValue('summary');

      const input = '[general] Bob: hi there';
      await service.serverSummarize(input);

      const [, userContent] = mockChat.mock.calls[0];
      expect(userContent).toContain(input);
    });

    it('should use a system prompt with summarizer instructions', async () => {
      mockChat.mockResolvedValue('summary');

      await service.serverSummarize('test');

      const [systemPrompt] = mockChat.mock.calls[0];
      expect(systemPrompt).toContain('summarizer');
    });

    it('should throw when provider chat fails', async () => {
      mockChat.mockRejectedValue(new Error('rate limit'));

      await expect(service.serverSummarize('test')).rejects.toThrow('rate limit');
    });
  });
});
