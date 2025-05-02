require('dotenv').config(); // Load environment variables from .env file
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');  // Import axios for HTTP requests
const cron = require('node-cron'); // For scheduling tasks

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Schedule the summarization task at a specific time
  cron.schedule('*/5 * * * *', async () => {  // Runs every 5 minutes
    const channelId = process.env.CHANNEL_ID;  // Channel ID from the environment file

    try {
      // Fetch messages from the channel (let's get the last 100 messages for example)
      const channel = await client.channels.fetch(channelId);
      const messages = await channel.messages.fetch({ limit: 100 });

      // Combine the messages into a single string for summarization
      const userMessages = messages.map(msg => `${msg.author.username}: ${msg.content}`).join("\n");

      // Generate the summary using Ollama
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

// Function to generate summary using Ollama
async function generateSummary(userMessages) {
  try {
    const response = await axios.post(process.env.API_URL, {
      model: 'tinyllama',  // Example model (ensure this matches the model you're using)
      messages: [
        { role: 'user', content: `Summarize the following messages:\n\n${userMessages}` }
      ],
      stream: false  // Set to true if you want a streamed response, false for full response
    });

    // Return the summary from Ollama's response
    return response.data.message.content.trim();
  } catch (error) {
    console.error('Error during summarization:', error);
    return 'Sorry, there was an error generating the summary.';
  }
}

client.login(process.env.BOT_TOKEN);
