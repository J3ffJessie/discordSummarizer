const Groq = require('groq-sdk');

class TranslationService {
  constructor() {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  async translate(text) {
    if (!text || !text.trim()) return '';

    const response = await this.groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0, // 🔥 important for consistency
      messages: [
        {
          role: 'system',
          content:
            'You are a translation engine. Translate ALL input text to English. Return ONLY the translated text. Do not explain. Do not add commentary.',
        },
        {
          role: 'user',
          content: text,
        },
      ],
    });

    return response.choices[0].message.content.trim();
  }
}

module.exports = { TranslationService };
