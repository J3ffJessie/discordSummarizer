require('dotenv').config(); // Load environment variables from .env file
const { Client, GatewayIntentBits } = require('discord.js');
const { OpenAI } = require('openai'); // Make sure you've configured OpenAI as before
const cron = require('node-cron'); // For scheduling tasks

// Your bot and OpenAI setup as before
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Schedule the summarization task at a specific time
  cron.schedule('*/5 * * * *', async () => {  // Runs every day at 9:00 AM server time
    const channelId = process.env.CHANNEL_ID;  // Replace with the actual channel ID

    try {
      // Fetch messages from the channel (let's get the last 100 messages for example)
      const channel = await client.channels.fetch(channelId);
      const messages = await channel.messages.fetch({ limit: 100 });

      // Combine the messages into a single string for summarization
      const userMessages = messages.map(msg => `${msg.author.username}: ${msg.content}`).join("\n");

      // Generate the summary from OpenAI
      const summary = await generateSummary(userMessages);

      // Create a thread in the channel and post the summary
      const thread = await channel.threads.create({
        name: `Summary - ${new Date().toLocaleDateString()}`,
        autoArchiveDuration: 60,
      });

      await thread.send(summary);

    } catch (error) {
      console.error('Error summarizing and creating thread:', error);
    }
  });
});

// Function to generate summary using OpenAI API
async function generateSummary(userMessages) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that summarizes Discord conversations.',
        },
        {
          role: 'user',
          content: `Summarize the following messages:\n\n${userMessages}`,
        },
      ],
    });

    return completion.choices[0]?.message?.content?.trim();
  } catch (error) {
    console.error('Error during summarization:', error);
    return 'Sorry, there was an error generating the summary.';
  }
}

client.login(process.env.BOT_TOKEN);
