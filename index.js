// Import required dependencies
const http = require("http");
const {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");
const dotenv = require("dotenv");
const Groq = require("groq-sdk");
const axios = require("axios");
const cron = require("node-cron");
const fuzz = require("fuzzball");
const { findLocation } = require('./locations');

// Load environment variables
dotenv.config();

// Initialize Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Register slash commands
const commands = [
  new SlashCommandBuilder()
    .setName("summarize")
    .setDescription("Summarize recent messages in this channel")
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Started refreshing application (/) commands.");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands,
    });
    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error("Error registering slash commands:", error);
  }
})();


// Summarization function (unchanged)
async function summarizeMessages(messages) {
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are a friendly Discord conversation analyzer. Summarize the following Discord conversation as a concise, engaging list of key points. Use bullet points, but do not break the summary into sections or categories. Just provide a single bulleted list that captures the main ideas, events, and noteworthy exchanges from the conversation.",
        },
        {
          role: "user",
          content: `Please provide a detailed summary of this Discord conversation following the format above:\n\n${messages}`,
        },
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.7,
      max_tokens: 1024,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Error in summarization:", error);
    throw error;
  }
}

// Handle slash command interaction (unchanged)
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "summarize") {
    try {
      await interaction.deferReply({ ephemeral: true });
      const messages = await interaction.channel.messages.fetch({ limit: 100 });

      const formattedMessages = messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map((msg) => `${msg.member?.displayName || msg.author.username}: ${msg.content}`)
        .join("\n");

      const summary = await summarizeMessages(formattedMessages);
      const chunks = summary.match(/[\s\S]{1,1900}/g) || [
        "No summary available.",
      ];

      try {
        for (const chunk of chunks) {
          await interaction.user.send(chunk);
        }

        await interaction.editReply({
          content: "✅ Summary sent to your DMs!",
          ephemeral: true,
        });
      } catch (dmError) {
        console.error("Failed to send DM:", dmError);
        await interaction.editReply({
          content:
            "❌ Could not send you a DM. Please check if you have DMs enabled for this server.",
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error("Error processing command:", error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ An error occurred while processing your request.",
          ephemeral: true,
        });
      } else {
        await interaction.editReply({
          content: "❌ An error occurred while processing your request.",
          ephemeral: true,
        });
      }
    }
  }
});

// Gather and summarize all server conversations
async function gatherServerConversationsAndSummarize(guild) {
  let allMessages = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel.isTextBased() && channel.viewable && !channel.isThread()) {
      try {
        const messages = await channel.messages.fetch({ limit: 30 }); // Adjust as needed
        const formatted = messages
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .map(msg => `[${channel.name}] ${msg.member?.displayName || msg.author.username}: ${msg.content}`);
        allMessages.push(...formatted);
      } catch (err) {
        console.warn(`Could not fetch messages for #${channel.name}:`, err.message);
      }
    }
  }

  // Optionally truncate if too long for LLM
  const combined = allMessages.slice(-500).join('\n'); // Last 500 messages across channels

  const summary = await summarizeMessages(combined);
  return summary;
}


client.on(Events.MessageCreate, async (message) => {
  // Ignore bot messages
  // if (message.author.bot) return;

  // Replace with your target channel ID. Check to make it dynamic later if Jason sets up a specific channel or copy the intros id from Torc.
  const targetChannelId = "1387791462745247904";
  if (message.channel.id === targetChannelId) {
    // Check for city in message
    const cityResult = findCity(message.content);
    if (cityResult.matchFound) {
      await message.reply(
        `🏙️ Detected city: **${cityResult.name}** (${cityResult.region}, ${cityResult.country})`
      );
    }

  }

  // The !server command is still useful for on-demand summaries,
  // even if you also run server summarization on a schedule via cron.
  if (message.content.trim() === "!server") {
    await message.channel.send("⏳ Gathering and summarizing conversations across all channels. Please wait...");
    try {
      const summary = await gatherServerConversationsAndSummarize(message.guild);
      // Split summary if too long for Discord
      const chunks = summary.match(/[\s\S]{1,1900}/g) || ["No summary available."];
      for (const chunk of chunks) {
        await message.author.send(chunk);
      }
      await message.channel.send("✅ Server summary sent to your DMs!");
    } catch (error) {
      console.error("Error summarizing server:", error);
      await message.channel.send("❌ Error summarizing server conversations.");
    }
    return;
  }

  const locationResult = findLocation(message.content);

  if (locationResult.matchFound) {
    console.log(
      `[${new Date().toISOString()}] Location mention detected:`,
      {
      user: message.member?.displayName || message.author.username,
      type: locationResult.type,
      name: locationResult.name || locationResult.city,
      }
    );
  }
});
client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

// Create HTTP server for Render
const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Discord summarizer bot is running.");
});

server.listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
