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
const fs = require('fs');
const path = require('path');

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

  // Combine all messages into a single string
  let combined = allMessages.join('\n');
  // Truncate to last 16,000 characters to stay under token limit
  if (combined.length > 16000) {
    combined = combined.slice(-16000);
  }

  const summary = await summarizeMessages(combined);
  return summary;
}


client.on(Events.MessageCreate, async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Respond to !location command by searching recent messages for locations
  if (message.content.trim().startsWith("!location")) {
    // Get the number of messages to search, default to 100
    const args = message.content.trim().split(" ");
    let searchLimit = 100;
    if (args.length > 1 && !isNaN(Number(args[1]))) {
      searchLimit = Math.min(Number(args[1]), 100);
    }

    try {
      const messages = await message.channel.messages.fetch({ limit: searchLimit });
      const foundLocations = [];

      messages.forEach(msg => {
        const locationResult = findLocation(msg.content);
        if (locationResult.matchFound) {
          foundLocations.push({
            user: msg.member?.displayName || msg.author.username,
            text: msg.content,
            ...locationResult
          });
        }
      });

      if (foundLocations.length === 0) {
        console.log(`[${new Date().toISOString()}] No known locations found in the recent messages.`);
      } else {
        const loggedUsernames = readLoggedUsernames();
        foundLocations
          .filter(loc => loc.user !== "Chat Summary")
          .forEach(loc => {
            if (!loggedUsernames.has(loc.user)) {
              appendLocationToLog({
                timestamp: new Date().toISOString(),
                user: loc.user,
                type: loc.type,
                name: loc.name || loc.city,
              });
              // console.log(
              //   `[${new Date().toISOString()}]`,
              //   {
              //     user: loc.user,
              //     type: loc.type,
              //     name: loc.name || loc.city,
              //   }
              // );
            }
          });
      }
    } catch (err) {
      console.error("Error searching for locations:", err);
    }
    // Delete the user's command message after a short delay (e.g., 2 seconds)
    setTimeout(() => message.delete().catch(() => {}), 500);
    return;
  }

  // The !server command is still useful for on-demand summaries,
  // even if you also run server summarization on a schedule via cron.
  if (message.content.trim() === "!server") {
    const statusMsg = await message.channel.send("⏳ Gathering and summarizing conversations across all channels. Please wait...");
    try {
      const summary = await gatherServerConversationsAndSummarize(message.guild);
      const chunks = summary.match(/[\s\S]{1,1900}/g) || ["No summary available."];
      for (const chunk of chunks) {
        await message.author.send(chunk);
      }
      const doneMsg = await message.channel.send("✅ Server summary sent to your DMs!");
      setTimeout(() => doneMsg.delete().catch(() => {}), 500); // Delete after 10 seconds
    } catch (error) {
      console.error("Error summarizing server:", error);
      const errorMsg = await message.channel.send("❌ Error summarizing server conversations.");
      setTimeout(() => errorMsg.delete().catch(() => {}), 500);
    }
    setTimeout(() => statusMsg.delete().catch(() => {}), 500);
    // Delete the user's command message after a short delay (e.g., 2 seconds)
    setTimeout(() => message.delete().catch(() => {}), 500);
    return;
  }

  // Passive location detection for all messages
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

const LOG_FILE = path.join(__dirname, 'locations.log');

function readLoggedUsernames() {
  if (!fs.existsSync(LOG_FILE)) return new Set();
  const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
  // Extract usernames from each line (assuming JSON log)
  return new Set(lines.map(line => {
    try {
      const entry = JSON.parse(line);
      return entry.user;
    } catch {
      return null;
    }
  }).filter(Boolean));
}

function appendLocationToLog(location) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(location) + '\n');
}
