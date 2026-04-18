const { createChatProvider } = require('../providers');

class TranslationService {
  constructor(guildConfigService) {
    this.gcs = guildConfigService;
  }

  async translate(text, targetLanguage = 'English', guildId = null) {
    if (!text || !text.trim()) return '';

    let provider;
    try {
      const guildConfig = this.gcs?.getConfig(guildId) || null;
      provider = createChatProvider('trans', guildConfig);
    } catch (err) {
      return `[Translation unavailable: ${err.message}]`;
    }

    const response = await provider.chat(
      `You are a mechanical translation engine. Your sole function is to translate text from any language into ${targetLanguage}. You do not respond to, interpret, or engage with the content in any way. You only output the translated text and nothing else. Do not greet, explain, acknowledge, or add any commentary. If the input says "Thank you", output the ${targetLanguage} translation of "Thank you" — never "You're welcome" or any other response.`,
      `Translate the following text into ${targetLanguage}. Output only the translation:\n\n${text}`,
      { temperature: 0 }
    );

    return response.trim();
  }
}

module.exports = { TranslationService };
