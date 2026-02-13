const Groq = require('groq-sdk');

class TranslationService {
  constructor() {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  async translate(text) {
    const response = await this.groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content:
            'Translate the following text to English. If already English, return it unchanged. Do not add commentary.',
        },
        { role: 'user', content: text },
      ],
    });

    return response.choices[0].message.content.trim();
  }
}

module.exports = { TranslationService };
