// Import required dependencies
const http = require('http');
const { Client, GatewayIntentBits, Events } = require('discord.js');
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
  ]
});

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

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
          content: "You are a helpful assistant that summarizes Discord conversations. Provide concise, clear summaries that capture the main points and any decisions made."
        },
        {
          role: "user",
          content: `Please summarize this Discord conversation:\n\n${messages}`
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
    await interaction.deferReply({ flags: 1 << 6 }); // ephemeral reply

    try {
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
        for (let i = 0; i < chunks.length; i++) {
          const content = i === 0
            ? `📬 Here's a summary of the conversation:\n\n${chunks[i]}`
            : chunks[i];
          await interaction.user.send(content);
        }

        await interaction.editReply({
          content: '✅ Summary sent via DM!',
        });
      } catch (dmError) {
        console.error('❌ Failed to send DM:', dmError);
        await interaction.editReply({
          content: '❌ I couldn’t DM you the summary. Do you have DMs disabled?',
        });
      }

    } catch (error) {
      console.error('Error processing command:', error);
      await interaction.editReply({
        content: '❌ Sorry, something went wrong while summarizing.',
      });
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
