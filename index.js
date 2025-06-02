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

// Register slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('summarize')
    .setDescription('Summarize recent messages in this channel')
    .toJSON()
];

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

async function summarizeMessages(messages) {
  try {
    const completion = await groq.chat.completions.create({
  messages: [
    {
      role: "system",
      content: "You are a friendly Discord conversation analyzer. Format your response in this engaging style:\n\n" +
        "📬 **Conversation Overview**\n" +
        "Here's what was discussed in the chat:\n\n" +
        "🎯 **Main Topics & Decisions**\n" +
        "• [Detailed point about the first main topic, including any decisions or outcomes]\n" +
        "• [Detailed point about the second main topic, including any decisions or outcomes]\n\n" +
        "🔄 **Ongoing Discussions**\n" +
        "• [Any continuing discussions or unresolved points]\n\n" +
        "📋 **Action Items**\n" +
        "• [Any clear next steps or tasks mentioned]\n\n" +
        "Your summary should:\n" +
        "- Maintain a friendly, natural tone\n" +
        "- Provide context for technical discussions\n" +
        "- Include specific details while avoiding usernames\n" +
        "- Separate ongoing discussions from concrete decisions\n" +
        "- Keep technical and social topics separate\n" +
        "- Be thorough yet concise"
    },
    {
      role: "user",
      content: `Please provide a detailed summary of this Discord conversation following the format above:\n\n${messages}`
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

        // Use editReply instead of reply since we already deferred
        await interaction.editReply({
          content: '✅ Summary sent to your DMs!',
          ephemeral: true
        });

      } catch (dmError) {
        console.error('Failed to send DM:', dmError);
        // Use editReply for the error message too
        await interaction.editReply({
          content: '❌ Could not send you a DM. Please check if you have DMs enabled for this server.',
          ephemeral: true
        });
      }
    } catch (error) {
      console.error('Error processing command:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        // Only use reply if we haven't deferred or replied yet
        await interaction.reply({
          content: '❌ An error occurred while processing your request.',
          ephemeral: true
        });
      } else {
        // Use editReply if we've already deferred
        await interaction.editReply({
          content: '❌ An error occurred while processing your request.',
          ephemeral: true
        });
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

// Create HTTP server for Render
const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Discord summarizer bot is running.');
});

server.listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
