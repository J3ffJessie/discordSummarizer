const Groq = require('groq-sdk');
const dotenv = require('dotenv');

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function serverSummarize(messages) {
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0.3,
      max_tokens: 1024,
      messages: [
        {
          role: 'system',
          content: `You are a Discord conversation summarizer.\n\nRULES:\n- Only summarize information explicitly present in the messages\n- Do NOT infer intent, motivation, or outcomes\n- Do NOT invent decisions, conclusions, or action items\n- Ignore jokes, memes, or sarcasm unless they directly impact discussion\n\nFormat your response exactly as follows:\n\n📋 **Summary**\nA 1-2 sentence overview of the conversation.\n\n💬 **Key Points**\n• Concise bullets covering the main topics and facts discussed\n\nOnly include the following section if action items are explicitly stated in the conversation:\n\n✅ **Action Items**\n• Task and relevant details\n\nMaintain a friendly but factual tone. Be concise.`,
        },
        {
          role: 'user',
          content: messages,
        },
      ],
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Error in groq.serverSummarize', error?.message || error);
    throw error;
  }
}


async function summarizeMessages(messages) {
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            'You are a friendly Discord conversation analyzer. Summarize the following Discord conversation as a concise, engaging list of key points. Use bullet points, but do not break the summary into sections or categories. Just provide a single bulleted list that captures the main ideas, events, and noteworthy exchanges from the conversation.',
        },
        {
          role: 'user',
          content: `Please provide a detailed summary of this Discord conversation following the format above:\n\n${messages}`,
        },
      ],
      model: 'llama-3.1-8b-instant',
      temperature: 0.7,
      max_tokens: 1024,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Error in groq.summarizeMessages', error?.message || error);
    throw error;
  }
}

module.exports = { summarizeMessages, serverSummarize };
