// Import required dependencies
/** @type {*} */
const http = require("http");
const {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType, // ✅ Added this to fix ChannelType error
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

// Delay helper to respect rate limits
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

const TARGET_CHANNEL_ID = "1387976135282921512"; // Replace with your target channel ID

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

// Summarization function
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

async function serverSummarize(messages) {
  console.log("Starting server summarization...");
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a friendly Discord conversation analyzer. Format your response in this engaging style:\n\n📬 **Conversation Overview**\nHere's what was discussed in the chat:\n\n🎯 **Main Topics & Decisions**\n• [Detailed point about the first main topic, including any decisions or outcomes]\n• [Detailed point about the second main topic, including any decisions or outcomes]\n\n🔄 **Ongoing Discussions**\n• [Any continuing discussions or unresolved points]\n\n📋 **Action Items**\n• [Any clear next steps or tasks mentioned]\n\nYour summary should:\n- Maintain a friendly, natural tone\n- Provide context for technical discussions\n- Include specific details while avoiding usernames\n- Separate ongoing discussions from concrete decisions\n- Keep technical and social topics separate\n- Be thorough yet concise`
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
    console.error("Error in server summarization:", error);
    throw error;
  }
}

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
      const chunks = summary.match(/[\s\S]{1,1900}/g) || ["No summary available."];

      try {
        for (const chunk of chunks) {
          await interaction.user.send(chunk);
          await delay(1000);
        }

        await interaction.editReply({
          content: "✅ Summary sent to your DMs!",
          ephemeral: true,
        });
      } catch (dmError) {
        console.error("Failed to send DM:", dmError);
        await interaction.editReply({
          content: "❌ Could not send you a DM. Please check if you have DMs enabled for this server.",
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

async function gatherServerConversationsAndSummarize(guild, useServerSummarize = false) {
  let allMessages = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel.isTextBased() && channel.viewable && !channel.isThread()) {
      try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const formatted = messages
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .map(msg => `[${channel.name}] ${msg.member?.displayName || msg.author.username}: ${msg.content}`);
        allMessages.push(...formatted);
      } catch (err) {
        console.warn(`Could not fetch messages for #${channel.name}:`, err.message);
      }
    }
  }

  let combined = allMessages.join('\n');
  if (combined.length > 16000) {
    combined = combined.slice(-16000);
  }

  if (useServerSummarize) {
    return await serverSummarize(combined);
  } else {
    return await summarizeMessages(combined);
  }
}

const ALLOWED_USER_IDS = [
  '1048620443474608178',
  '280096257282670592'
];

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (message.content.trim().startsWith("!location")) {
    if (!ALLOWED_USER_IDS.includes(message.author.id)) {
      await message.reply("❌ You do not have permission to use this command.");
      setTimeout(() => message.delete().catch(() => {}), 2000);
      return;
    }

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

      if (foundLocations.length > 0) {
        const loggedUsernames = readLoggedUsernames();
        foundLocations
          .filter(loc => loc.user !== "Chat Summary")
          .forEach(loc => {
            if (!loggedUsernames.has(loc.user)) {
              appendLocationToLog({ type: loc.type, name: loc.name || loc.city });
            }
          });
      }

      const replyMsg = await message.reply("✅ Location data has been summarized and logged.");
      setTimeout(() => replyMsg.delete().catch(() => {}), 3000);
    } catch (err) {
      console.error("Error searching for locations:", err);
    }

    setTimeout(() => message.delete().catch(() => {}), 500);
    return;
  }

  if (message.content.trim() === "!downloadlocations") {
    if (!ALLOWED_USER_IDS.includes(message.author.id)) {
      await message.reply("❌ You do not have permission to use this command.");
      setTimeout(() => message.delete().catch(() => {}), 2000);
      return;
    }

    if (fs.existsSync(LOG_FILE)) {
      const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
      const entries = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);

      const cities = entries.filter(e => e.type === "city").map(e => e.name);
      const countries = entries.filter(e => e.type === "country").map(e => e.name);

      const uniqueCities = Array.from(new Set(cities)).sort();
      const uniqueCountries = Array.from(new Set(countries)).sort();

      const sortedData = { cities: uniqueCities, countries: uniqueCountries };

      const tempFile = path.join(__dirname, 'locations_sorted.json');
      fs.writeFileSync(tempFile, JSON.stringify(sortedData, null, 2));

      await message.author.send({ files: [tempFile] });

      fs.unlinkSync(tempFile);

      const replyMsg = await message.reply("📄 Sorted log file sent to your DMs!");
      setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
    } else {
      const replyMsg = await message.reply("No log file found.");
      setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
    }

    setTimeout(() => message.delete().catch(() => {}), 500);
    return;
  }
});

// ⏰ Cron Job — Monday 10 UTC = 5 AM EDT
cron.schedule("0 10 * * 1", async () => {
  try {
    const guild = client.guilds.cache.get('1380702425433899170');
    if (!guild) return console.error("Guild not found.");

    const summary = await gatherServerConversationsAndSummarize(guild, true);
    const chunks = summary.match(/[\s\S]{1,1900}/g) || ["No summary available."];

    const channel = guild.channels.cache.get(TARGET_CHANNEL_ID);
    if (channel && channel.type === ChannelType.GuildText) {
      for (const chunk of chunks) {
        await channel.send(chunk);
        await delay(1000); // ✅ Respect rate limit
      }
    }

    console.log("✅ Weekly server summary sent.");
  } catch (error) {
    console.error("❌ Error running scheduled summary:", error);
  }
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Discord summarizer bot is running.");
});

server.listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});

client.login(process.env.DISCORD_TOKEN);

const LOG_FILE = path.join(__dirname, 'locations.log');

function readLoggedUsernames() {
  if (!fs.existsSync(LOG_FILE)) return new Set();
  const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
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
