// Import required dependencies
const http = require('http');
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
const dotenv = require('dotenv');
const Groq = require('groq-sdk');

// Load environment variables
dotenv.config();

// Initialize Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ]
});

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Define slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('summarize')
    .setDescription('Summarize recent messages in this channel')
    .toJSON()
];

// Register slash commands
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
})();

// Handle ready event
client.once(Events.ClientReady, readyClient => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Function to summarize messages using Groq
async function summarizeMessages(messages) {
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a Discord conversation summarizer. Format your response exactly as follows:\n\n" +
            "📬 Here's a summary of the conversation:\n\n" +
            "• [First main point without any usernames]\n" +
            "• [Second main point without any usernames]\n" +
            "• [Additional points as needed]\n\n" +
            "Your summary must:\n" +
            "- Start with the exact header '📬 Here's a summary of the conversation:'\n" +
            "- Use bullet points (•) for each main point\n" +
            "- Never mention participant names\n" +
            "- Focus only on key topics and decisions\n" +
            "- Be concise and clear"
        },
        {
          role: "user",
          content: `Please summarize the conversation:\n\n${messages}`
        }
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.7,
      max_tokens: 1024,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Error in summarization:', error);
    throw error;
  }
}

// Handle slash commands
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'summarize') {
    try {
      // Defer reply immediately to prevent timeout
      await interaction.deferReply({ ephemeral: true });

      // Fetch messages
      const messages = await interaction.channel.messages.fetch({ limit: 100 });

      // Format messages for summarization
      const formattedMessages = messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(msg => `${msg.author.username}: ${msg.content}`)
        .join('\n');

      // Get summary from Groq
      const summary = await summarizeMessages(formattedMessages);

      // Split summary into safe chunks (≤1900 characters)
      const chunks = summary.match(/[\s\S]{1,1900}/g) || ['No summary available.'];

      try {
        // Send summary chunks via DM
        for (const chunk of chunks) {
          await interaction.user.send(chunk);
        }

        // Edit the deferred reply
        await interaction.editReply('✅ Summary sent to your DMs!');
      } catch (dmError) {
        console.error('Failed to send DM:', dmError);
        await interaction.editReply('❌ Could not send you a DM. Please check if you have DMs enabled for this server.');
      }
    } catch (error) {
      console.error('Error processing command:', error);
      // Only try to reply if we haven't already
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ 
          content: '❌ An error occurred while processing your request.',
          ephemeral: true 
        });
      } else {
        await interaction.editReply('❌ An error occurred while processing your request.');
      }
    }
  }
});

// Error handling
client.on('error', error => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);

// --- Minimal HTTP server for Render port binding ---
const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Discord summarizer bot is running.');
});

server.listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});
