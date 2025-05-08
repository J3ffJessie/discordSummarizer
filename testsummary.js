const fetch = require('node-fetch');

// Sample messages (simulate messages the bot would fetch)
const messages = [
  { author: { username: 'Alice' }, content: 'Hey team, the deadline got moved to Friday.' },
  { author: { username: 'Bob' }, content: 'Great, more time to test the UI.' },
  { author: { username: 'Charlie' }, content: 'Can we push the staging update to tomorrow?' },
  { author: { username: 'Alice' }, content: 'Yes, that works.' },
];

// Define the function to generate the summary
const generateSummary = async (messages) => {
  const filteredMessages = messages
    .filter((msg) => msg.content && !msg.author.bot)
    .map((msg) => `${msg.author.username}: ${msg.content.trim()}`)
    .join('\n');

  if (!filteredMessages || filteredMessages.length === 0) {
    return 'No relevant messages to summarize.';
  }

  const prompt = `
You are a helpful assistant. Summarize the following conversation into concise bullet points, keeping the key ideas only. Do not include any messages from bots.

Conversation:
${filteredMessages}

Return only the bullet-point summary with no intro or conclusion. Each bullet should start with a dash (-).
`;

  try {
    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: 'phi', // Replace with the model you're using
        prompt,
        stream: false,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();
    return data.response?.trim() || 'No summary generated.';
  } catch (error) {
    console.error('Error generating summary:', error);
    return 'Failed to generate summary.';
  }
};

// Test the function with simulated messages
generateSummary(messages).then((summary) => {
  console.log('Generated Summary:', summary);
});
