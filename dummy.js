require('dotenv').config(); // Load environment variables from .env file
const { Client, GatewayIntentBits } = require('discord.js');

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Create dummy messages
async function sendDummyMessages() {
  const channelId = process.env.CHANNEL_ID;  // Get channel ID from .env file

  try {
    const channel = await client.channels.fetch(channelId);

    // Sending some dummy messages to the channel
    for (let i = 0; i < 10; i++) {
      await channel.send(`Dummy message ${i + 1}`);
    }

    console.log('Dummy messages sent successfully.');
  } catch (error) {
    console.error('Error sending dummy messages:', error);
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  sendDummyMessages();  // Call the function to send dummy messages
});

client.login(process.env.BOT_TOKEN);  // Log in using the bot token from .env file
