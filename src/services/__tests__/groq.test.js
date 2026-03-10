// Use a single shared instance so groq.js and the test share the same create fn
jest.mock('groq-sdk', () => {
  const createFn = jest.fn();
  const instance = {
    chat: { completions: { create: createFn } },
  };
  const MockGroq = jest.fn(() => instance);
  MockGroq._instance = instance;
  return MockGroq;
});
jest.mock('dotenv', () => ({ config: jest.fn() }));

const Groq = require('groq-sdk');
const groqService = require('../groq');

describe('groq service', () => {
  let mockCreate;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate = Groq._instance.chat.completions.create;
  });

  // ─── summarizeMessages ──────────────────────────────────────────────────────

  describe('summarizeMessages', () => {
    it('should call Groq with correct model and return content', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '• Point 1\n• Point 2' } }],
      });

      const result = await groqService.summarizeMessages('User1: Hello\nUser2: Hi');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'llama-3.1-8b-instant',
          temperature: 0.7,
          max_tokens: 1024,
        })
      );
      expect(result).toBe('• Point 1\n• Point 2');
    });

    it('should include the messages in the user prompt', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'summary' } }],
      });

      const input = 'Alice: hello\nBob: world';
      await groqService.summarizeMessages(input);

      const callArgs = mockCreate.mock.calls[0][0];
      const userMsg = callArgs.messages.find((m) => m.role === 'user');
      expect(userMsg.content).toContain(input);
    });

    it('should include a system prompt', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'summary' } }],
      });

      await groqService.summarizeMessages('test');

      const callArgs = mockCreate.mock.calls[0][0];
      const systemMsg = callArgs.messages.find((m) => m.role === 'system');
      expect(systemMsg).toBeDefined();
      expect(systemMsg.content.length).toBeGreaterThan(0);
    });

    it('should throw when Groq API fails', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));

      await expect(groqService.summarizeMessages('test')).rejects.toThrow('API error');
    });
  });

  // ─── serverSummarize ────────────────────────────────────────────────────────

  describe('serverSummarize', () => {
    it('should call Groq with correct model and return content', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '📋 **Summary**\nTalk happened.' } }],
      });

      const result = await groqService.serverSummarize('[general] Alice: hello');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'llama-3.1-8b-instant',
          temperature: 0.3,
          max_tokens: 1024,
        })
      );
      expect(result).toContain('Summary');
    });

    it('should include the messages in the user prompt', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'summary' } }],
      });

      const input = '[general] Bob: hi there';
      await groqService.serverSummarize(input);

      const callArgs = mockCreate.mock.calls[0][0];
      const userMsg = callArgs.messages.find((m) => m.role === 'user');
      expect(userMsg.content).toContain(input);
    });

    it('should use a system prompt with summarizer instructions', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'summary' } }],
      });

      await groqService.serverSummarize('test');

      const callArgs = mockCreate.mock.calls[0][0];
      const systemMsg = callArgs.messages.find((m) => m.role === 'system');
      expect(systemMsg).toBeDefined();
      expect(systemMsg.content).toContain('summarizer');
    });

    it('should throw when Groq API fails', async () => {
      mockCreate.mockRejectedValue(new Error('rate limit'));

      await expect(groqService.serverSummarize('test')).rejects.toThrow('rate limit');
    });
  });
});
