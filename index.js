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


// Summarization function 
/**
 * Summarizes a list of Discord messages.
 *
 * @param {*} messages
 * @return {*} 
 */
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


/**
 * Summarizes a list of Discord messages from the entire server.
 *
 * @param {*} messages
 * @return {*} 
 */
async function serverSummarize(messages) {
  console.log("Starting server summarization...");
  
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
    },
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

// Handle slash command interaction for summarize that summarizes that channel's messages for the last 100 messages
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

// Gather and summarize all server conversations for the last 100 messages in each channel
async function gatherServerConversationsAndSummarize(guild, useServerSummarize = false) {
  let allMessages = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel.isTextBased() && channel.viewable && !channel.isThread()) {
      try {
        const messages = await channel.messages.fetch({ limit: 100 }); // Adjust as needed
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

  if (useServerSummarize) {
    const summary = await serverSummarize(combined);
    return summary;
  } else {
    const summary = await summarizeMessages(combined);
    return summary;
  }
}

// List of allowed user IDs that can run the location and download commands 
const ALLOWED_USER_IDS = [
  '1048620443474608178', // Replace with actual Discord user IDs
  '280096257282670592'
];

client.on(Events.MessageCreate, async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // !location command (restricted) summarizes locations from the last 100 messages in the channel 
  if (message.content.trim().startsWith("!location")) {
    if (!ALLOWED_USER_IDS.includes(message.author.id)) {
      await message.reply("❌ You do not have permission to use this command.");
      setTimeout(() => message.delete().catch(() => {}), 2000);
      return;
    }
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
                type: loc.type,
                name: loc.name || loc.city,
              });
            }
          });
      }
      // Notify the user that the data has been summarized
      const replyMsg = await message.reply("✅ Location data has been summarized and logged.");
      setTimeout(() => replyMsg.delete().catch(() => {}), 3000);
    } catch (err) {
      console.error("Error searching for locations:", err);
    }
    setTimeout(() => message.delete().catch(() => {}), 500);
    return;
  }

  // !server command (restricted)
  if (message.content.trim() === "!server") {
    if (!ALLOWED_USER_IDS.includes(message.author.id)) {
      await message.reply("❌ You do not have permission to use this command.");
      setTimeout(() => message.delete().catch(() => {}), 2000);
      return;
    }
    const statusMsg = await message.channel.send("⏳ Gathering and summarizing conversations across all channels. Please wait...");
    setTimeout(() => statusMsg.delete().catch(() => {}), 500);
    try {
      const summary = await gatherServerConversationsAndSummarize(message.guild, true); // Pass true to use serverSummarize
      const chunks = summary.match(/[\s\S]{1,1900}/g) || ["No summary available."];
      for (const chunk of chunks) {
        await message.author.send(chunk);
      }
      const doneMsg = await message.channel.send("✅ Server summary sent to your DMs!");
      setTimeout(() => doneMsg.delete().catch(() => {}), 500);
    } catch (error) {
      console.error("Error summarizing server:", error);
      const errorMsg = await message.channel.send("❌ Error summarizing server conversations.");
      setTimeout(() => errorMsg.delete().catch(() => {}), 500);
    }
    setTimeout(() => message.delete().catch(() => {}), 500);
    return;
  }

  // !downloadlocations command (restricted) reads the location log file checks for duplicates, sorts, and sends the data to the user in a DM for download
  if (message.content.trim() === "!downloadlocations") {
    if (!ALLOWED_USER_IDS.includes(message.author.id)) {
      await message.reply("❌ You do not have permission to use this command.");
      setTimeout(() => message.delete().catch(() => {}), 2000);
      return;
    }

    if (fs.existsSync(LOG_FILE)) {
      // Read and parse the log file
      const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
      const entries = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);

      // Separate into cities and countries
      const cities = entries.filter(e => e.type === "city").map(e => e.name);
      const countries = entries.filter(e => e.type === "country").map(e => e.name);

      // Remove duplicates and sort
      const uniqueCities = Array.from(new Set(cities)).sort();
      const uniqueCountries = Array.from(new Set(countries)).sort();

      // Prepare the sorted data
      const sortedData = {
        cities: uniqueCities,
        countries: uniqueCountries
      };

      // Write to a temporary file
      const tempFile = path.join(__dirname, 'locations_sorted.json');
      fs.writeFileSync(tempFile, JSON.stringify(sortedData, null, 2));

      // Send the sorted file to the user's DMs
      await message.author.send({
        files: [tempFile]
      });

      // Optionally delete the temp file after sending
      fs.unlinkSync(tempFile);

      // Confirmation message in channel, auto-delete
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
