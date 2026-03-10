const { TranslationService } = require('../translationService');

jest.mock('groq-sdk', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }));
});

const Groq = require('groq-sdk');

describe('TranslationService', () => {
  let translationService;
  let mockCreate;

  beforeEach(() => {
    jest.clearAllMocks();
    translationService = new TranslationService();
    mockCreate = translationService.groq.chat.completions.create;
  });

  describe('translate', () => {
    it('should return empty string when given an empty string', async () => {
      const result = await translationService.translate('');

      expect(result).toBe('');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should return empty string when given whitespace-only input', async () => {
      const result = await translationService.translate('   \t\n  ');

      expect(result).toBe('');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should return empty string when given null', async () => {
      const result = await translationService.translate(null);

      expect(result).toBe('');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should return empty string when given undefined', async () => {
      const result = await translationService.translate(undefined);

      expect(result).toBe('');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should translate non-English text to English', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hello, how are you?' } }],
      });

      const result = await translationService.translate('Bonjour, comment ça va?');

      expect(result).toBe('Hello, how are you?');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('Bonjour, comment ça va?'),
            }),
          ]),
        })
      );
    });

    it('should translate text even if it appears to be English (system prompt instructs mechanical translation)', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hello' } }],
      });

      const result = await translationService.translate('Hello');

      expect(result).toBe('Hello');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining('mechanical translation engine'),
            }),
          ]),
        })
      );
    });

    it('should use temperature 0 for consistent output', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Test response' } }],
      });

      await translationService.translate('Test input');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
        })
      );
    });

    it('should return consistent output for the same input due to temperature setting', async () => {
      const consistentResponse = 'Consistent translation';
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: consistentResponse } }],
      });

      const result1 = await translationService.translate('Hola mundo');
      const result2 = await translationService.translate('Hola mundo');

      expect(result1).toBe(consistentResponse);
      expect(result2).toBe(consistentResponse);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      
      // Verify both calls used temperature: 0
      mockCreate.mock.calls.forEach((call) => {
        expect(call[0].temperature).toBe(0);
      });
    });

    it('should trim whitespace from the response', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '  Trimmed response  \n' } }],
      });

      const result = await translationService.translate('Test');

      expect(result).toBe('Trimmed response');
    });
  });
});
