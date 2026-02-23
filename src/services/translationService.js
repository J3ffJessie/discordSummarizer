const Groq = require('groq-sdk');

class TranslationService {
  constructor() {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  async translate(text, targetLanguage = 'English') {
    if (!text || !text.trim()) return '';

    const response = await this.groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You are a mechanical translation engine. Your sole function is to translate text from any language into ${targetLanguage}. You do not respond to, interpret, or engage with the content in any way. You only output the translated text and nothing else. Do not greet, explain, acknowledge, or add any commentary. If the input says "Thank you", output the ${targetLanguage} translation of "Thank you" — never "You're welcome" or any other response.`,
        },
        {
          role: 'user',
          content: `Translate the following text into ${targetLanguage}. Output only the translation:\n\n${text}`,
        },
      ],
    });

    return response.choices[0].message.content.trim();
  }
}

module.exports = { TranslationService };
