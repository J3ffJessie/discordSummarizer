const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function generateSummary(captions) {
  const transcript = captions
    .map(c => `[${c.timestamp}] ${c.speaker}: ${c.translated}`)
    .join('\n');

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content:
          'You are a professional event writer. Your job is to read live-event transcripts and produce polished written recaps. ' +
          'Write in third-person past tense. Group related discussion points naturally into paragraphs. ' +
          'Do not mention translation, captions, or any technical process. Focus entirely on the substance of what was discussed. ' +
          'Keep the tone clear and engaging, suitable for an audience who was not present.',
      },
      {
        role: 'user',
        content:
          'Please write a 3–5 paragraph article recap of the following event transcript. ' +
          'Capture the key topics, important points, and overall tone.\n\n' +
          `Transcript:\n${transcript}`,
      },
    ],
    max_tokens: 1500,
    temperature: 0.6,
  });

  return response.choices[0].message.content.trim();
}

module.exports = { generateSummary };
