const mockChat = jest.fn();

jest.mock('../../providers', () => ({
  createChatProvider: jest.fn(() => ({ chat: mockChat })),
}));

const { TranslationService } = require('../translationService');

describe('TranslationService', () => {
  let translationService;

  beforeEach(() => {
    jest.clearAllMocks();
    translationService = new TranslationService(null);
  });

  describe('translate', () => {
    it('should return empty string when given an empty string', async () => {
      const result = await translationService.translate('');

      expect(result).toBe('');
      expect(mockChat).not.toHaveBeenCalled();
    });

    it('should return empty string when given whitespace-only input', async () => {
      const result = await translationService.translate('   \t\n  ');

      expect(result).toBe('');
      expect(mockChat).not.toHaveBeenCalled();
    });

    it('should return empty string when given null', async () => {
      const result = await translationService.translate(null);

      expect(result).toBe('');
      expect(mockChat).not.toHaveBeenCalled();
    });

    it('should return empty string when given undefined', async () => {
      const result = await translationService.translate(undefined);

      expect(result).toBe('');
      expect(mockChat).not.toHaveBeenCalled();
    });

    it('should translate non-English text to English', async () => {
      mockChat.mockResolvedValue('Hello, how are you?');

      const result = await translationService.translate('Bonjour, comment ça va?');

      expect(result).toBe('Hello, how are you?');
      expect(mockChat).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Bonjour, comment ça va?'),
        expect.any(Object)
      );
    });

    it('should translate text even if it appears to be English (system prompt instructs mechanical translation)', async () => {
      mockChat.mockResolvedValue('Hello');

      await translationService.translate('Hello');

      const [systemPrompt] = mockChat.mock.calls[0];
      expect(systemPrompt).toContain('mechanical translation engine');
    });

    it('should use temperature 0 for consistent output', async () => {
      mockChat.mockResolvedValue('Test response');

      await translationService.translate('Test input');

      const [, , options] = mockChat.mock.calls[0];
      expect(options.temperature).toBe(0);
    });

    it('should return consistent output for the same input due to temperature setting', async () => {
      const consistentResponse = 'Consistent translation';
      mockChat.mockResolvedValue(consistentResponse);

      const result1 = await translationService.translate('Hola mundo');
      const result2 = await translationService.translate('Hola mundo');

      expect(result1).toBe(consistentResponse);
      expect(result2).toBe(consistentResponse);
      expect(mockChat).toHaveBeenCalledTimes(2);

      mockChat.mock.calls.forEach((call) => {
        expect(call[2].temperature).toBe(0);
      });
    });

    it('should trim whitespace from the response', async () => {
      mockChat.mockResolvedValue('  Trimmed response  \n');

      const result = await translationService.translate('Test');

      expect(result).toBe('Trimmed response');
    });
  });
});
