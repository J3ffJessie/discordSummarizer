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

const { findLocation } = require("./locations");
const fs = require("fs");
const path = require("path");

// Load environment variables
dotenv.config();

// Delay helper to respect rate limits
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  new SlashCommandBuilder()
    .setName("events")
    .setDescription("Get upcoming events for the next 7 days")
    .toJSON(),
];

const TARGET_CHANNEL_ID = "1392954859803644014"; // Replace with your target channel ID for weekly summaries

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

// Server summarization function
async function serverSummarize(messages) {
  console.log("Starting server summarization...");
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a friendly Discord conversation analyzer. Format your response in this engaging style:\n\n📬 **Conversation Overview**\nHere's what was discussed in the chat:\n\n🎯 **Main Topics & Decisions**\n• [Detailed point about the first main topic, including any decisions or outcomes]\n• [Detailed point about the second main topic, including any decisions or outcomes]\n\n🔄 **Ongoing Discussions**\n• [Any continuing discussions or unresolved points]\n\n📋 **Action Items**\n• [Any clear next steps or tasks mentioned]\n\nYour summary should:\n- Maintain a friendly, natural tone\n- Provide context for technical discussions\n- Include specific details while avoiding usernames\n- Separate ongoing discussions from concrete decisions\n- Keep technical and social topics separate\n- Be thorough yet concise`,
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
    console.error("Error in server summarization:", error);
    throw error;
  }
}

// Fetch upcoming events helper
async function fetchUpcomingEvents() {
  try {
    const response = await axios.get(
      "https://guild.host/api/next/torc-dev/events/upcoming"
    );

    const edges = response.data.events.edges;

    // ✅ Sort by startAt in ascending order (soonest first)
    edges.sort((a, b) => new Date(a.node.startAt) - new Date(b.node.startAt));

    const events = edges.map((edge) => edge.node);
    return events;
  } catch (error) {
    console.error("Error fetching events:", error);
    return [];
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
        .map(
          (msg) =>
            `${msg.member?.displayName || msg.author.username}: ${msg.content}`
        )
        .join("\n");

      const summary = await summarizeMessages(formattedMessages);
      const chunks = summary.match(/[\s\S]{1,1900}/g) || [
        "No summary available.",
      ];

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
  } else if (interaction.commandName === "events") {
    try {
      await interaction.reply({
        content: "📬 Check your DMs for upcoming events!",
        ephemeral: true,
      });

      const upcomingEvents = await fetchUpcomingEvents();

      if (upcomingEvents.length === 0) {
        await interaction.followUp({
          content: "No upcoming events found.",
          ephemeral: true,
        });
        return;
      }

      const embeds = upcomingEvents.slice(0, 10).map((event) => {
        const embed = new EmbedBuilder()
          .setTitle(event.name)
          .setURL(event.fullUrl)
          .setDescription(
            event.description
              ? event.description.substring(0, 200) +
                  (event.description.length > 200 ? "..." : "")
              : "No description"
          )
          .addFields(
            {
              name: "Start Time",
              value: new Date(event.startAt).toLocaleString("en-US", {
                timeZone: event.timeZone,
              }),
              inline: true,
            },
            {
              name: "End Time",
              value: new Date(event.endAt).toLocaleString("en-US", {
                timeZone: event.timeZone,
              }),
              inline: true,
            },
            {
              name: "Visibility",
              value: event.visibility,
              inline: true,
            }
          )
          .setColor("#0099ff")
          .setTimestamp(new Date(event.startAt))
          .setFooter({ text: "torc-dev events" });

        // Include social card image if available
        if (event.uploadedSocialCard && event.uploadedSocialCard.url) {
          embed.setImage(event.uploadedSocialCard.url);
        }

        return embed;
      });

      // Try sending to user's DM
      try {
        await interaction.user.send({
          content: " Here are the upcoming events:",
          embeds,
        });
      } catch (dmError) {
        console.error("Could not DM user:", dmError);
        await interaction.followUp({
          content:
            "❌ I couldn't send you a DM. Please enable DMs and try again.",
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error("Error handling /events command:", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ Failed to fetch events.",
          ephemeral: true,
        });
      } else {
        await interaction.followUp({
          content: "❌ Failed to fetch events.",
          ephemeral: true,
        });
      }
    }
  }
});

// Helper to gather conversations across all channels in a server
async function gatherServerConversationsAndSummarize(
  guild,
  useServerSummarize = false
) {
  let allMessages = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel.isTextBased() && channel.viewable && !channel.isThread()) {
      try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const formatted = messages
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .map(
            (msg) =>
              `[${channel.name}] ${
                msg.member?.displayName || msg.author.username
              }: ${msg.content}`
          );
        allMessages.push(...formatted);
      } catch (err) {
        console.warn(
          `Could not fetch messages for #${channel.name}:`,
          err.message
        );
      }
    }
  }

  let combined = allMessages.join("\n");
  if (combined.length > 16000) {
    combined = combined.slice(-16000);
  }

  if (useServerSummarize) {
    return await serverSummarize(combined);
  } else {
    return await summarizeMessages(combined);
  }
}

const ALLOWED_USER_IDS = ["1048620443474608178", "280096257282670592"];

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // Reminder commands
  if (message.content.startsWith(PREFIX)) {
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // !remindme <time> <message>
    if (command === "remindme") {
      if (args.length < 2) {
        const replyMsg = await message.reply(
          "Usage: `!remindme <time> <message>` (e.g., `!remindme 10m Take out the trash`)"
        );
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
        return;
      }
      const timeStr = args.shift();
      const reminderMsg = args.join(" ");
      const duration = parseTime(timeStr);

      if (!duration) {
        const replyMsg = await message.reply(
          "Invalid time format. Use `10s`, `10m`, `2h`, `1d`."
        );
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
        return;
      }

      const reminderId = Date.now().toString();
      const reminder = {
        id: reminderId,
        userId: message.author.id,
        msg: reminderMsg,
        time: Date.now() + duration,
      };

      reminders.push(reminder);
      saveReminders();
      scheduleReminder(reminder, duration);

      const replyMsg = await message.reply(
        `⏰ Reminder set! I'll remind you in ${timeStr}. (ID: ${reminderId})`
      );
      setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
      return;
    }

    // !listreminders
    if (command === "listreminders") {
      const userReminders = reminders.filter(
        (r) => r.userId === message.author.id
      );

      if (userReminders.length === 0) {
        const replyMsg = await message.reply(
          "You don't have any pending reminders"
        );
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`${message.author.username}'s Reminders`)
        .setColor("Blue");

      userReminders.forEach((r) => {
        const remaining = Math.max(0, r.time - Date.now());
        const mins = Math.round(remaining / 60000);
        embed.addFields({
          name: `ID: ${r.id}`,
          value: `${r.msg} (in ~${mins} min)`,
        });
      });

      // Send reminders as a DM and auto-delete the original command message
      const replyMsg = await message.author.send({ embeds: [embed] });
      setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
      setTimeout(() => message.delete().catch(() => {}), 500);
      return;
    }

    // !cancelreminder <id>
    if (command === "cancelreminder") {
      if (args.length < 1) {
        const replyMsg = await message.reply("Usage: `!cancelreminder <id>`");
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
        return;
      }

      const id = args[0];
      const index = reminders.findIndex(
        (r) => r.id === id && r.userId === message.author.id
      );

      if (index === -1) {
        const replyMsg = await message.reply(
          `❌ No reminder found with ID \`${id}\`.`
        );
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
        return;
      }

      reminders.splice(index, 1);
      saveReminders();
      const replyMsg = await message.reply(
        `✅ Reminder with ID \`${id}\` has been canceled.`
      );
      setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
      return;
    }
  }

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
      const messages = await message.channel.messages.fetch({
        limit: searchLimit,
      });
      const foundLocations = [];

      messages.forEach((msg) => {
        const locationResult = findLocation(msg.content);
        if (locationResult.matchFound) {
          foundLocations.push({
            user: msg.member?.displayName || msg.author.username,
            text: msg.content,
            ...locationResult,
          });
        }
      });

      if (foundLocations.length > 0) {
        const loggedUsernames = readLoggedUsernames();
        foundLocations
          .filter((loc) => loc.user !== "Chat Summary")
          .forEach((loc) => {
            if (!loggedUsernames.has(loc.user)) {
              appendLocationToLog({
                type: loc.type,
                name: loc.name || loc.city,
              });
            }
          });
      }

      const replyMsg = await message.reply(
        "✅ Location data has been summarized and logged."
      );
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
      const lines = fs
        .readFileSync(LOG_FILE, "utf-8")
        .split("\n")
        .filter(Boolean);
      const entries = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const cities = entries
        .filter((e) => e.type === "city")
        .map((e) => e.name);
      const countries = entries
        .filter((e) => e.type === "country")
        .map((e) => e.name);

      const uniqueCities = Array.from(new Set(cities)).sort();
      const uniqueCountries = Array.from(new Set(countries)).sort();

      const sortedData = { cities: uniqueCities, countries: uniqueCountries };

      const tempFile = path.join(__dirname, "locations_sorted.json");
      fs.writeFileSync(tempFile, JSON.stringify(sortedData, null, 2));

      await message.author.send({ files: [tempFile] });

      fs.unlinkSync(tempFile);

      const replyMsg = await message.reply(
        "📄 Sorted log file sent to your DMs!"
      );
      setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
    } else {
      const replyMsg = await message.reply("No log file found.");
      setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
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

    const statusMsg = await message.channel.send(
      "⏳ Gathering and summarizing conversations across all channels. Please wait..."
    );
    setTimeout(() => statusMsg.delete().catch(() => {}), 500);

    try {
      const guild = message.guild;
      const summary = await gatherServerConversationsAndSummarize(guild, true); // Use serverSummarize
      const chunks = summary.match(/[\s\S]{1,1900}/g) || [
        "No summary available.",
      ];

      // Send summary to the same channel as the cron job (TARGET_CHANNEL_ID)
      const targetChannel = guild.channels.cache.get("1392954859803644014");
      if (targetChannel && targetChannel.type === ChannelType.GuildText) {
        for (const chunk of chunks) {
          await targetChannel.send(chunk);
          await delay(1000);
        }
        const doneMsg = await message.channel.send(
          "✅ Server summary sent to the summary channel!"
        );
        setTimeout(() => doneMsg.delete().catch(() => {}), 500);
      } else {
        await message.channel.send("❌ Could not find the summary channel.");
      }
    } catch (error) {
      console.error("Error summarizing server:", error);
      const errorMsg = await message.channel.send(
        "❌ Error summarizing server conversations."
      );
      setTimeout(() => errorMsg.delete().catch(() => {}), 500);
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

const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Discord summarizer bot is running.");
});

server.listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});

client.login(process.env.DISCORD_TOKEN);

const LOG_FILE = path.join(__dirname, "locations.log");

function readLoggedUsernames() {
  if (!fs.existsSync(LOG_FILE)) return new Set();
  const lines = fs.readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);
  return new Set(
    lines
      .map((line) => {
        try {
          const entry = JSON.parse(line);
          return entry.user;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  );
}

function appendLocationToLog(location) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(location) + "\n");
}

const PREFIX = "!";
const REMINDER_FILE = path.join(__dirname, "reminders.json");

// Load reminders from file
let reminders = [];
if (fs.existsSync(REMINDER_FILE)) {
  try {
    reminders = JSON.parse(fs.readFileSync(REMINDER_FILE, "utf8"));
  } catch (err) {
    console.error("Error reading reminders.json:", err);
  }
}

// Save reminders to file
function saveReminders() {
  fs.writeFileSync(REMINDER_FILE, JSON.stringify(reminders, null, 2));
}

// Clean up expired reminders from file
function cleanReminders() {
  const before = reminders.length;
  reminders = reminders.filter((r) => r.time > Date.now());
  if (reminders.length !== before) {
    saveReminders();
    console.log(`🧹 Cleaned ${before - reminders.length} expired reminders`);
  }
}

// Helper: convert "10m", "2h", "1d" → ms
function parseTime(str) {
  const match = str.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const num = parseInt(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return num * multipliers[unit];
}

// Re-schedule reminders after restart
function rescheduleReminders() {
  reminders.forEach((r) => {
    const delay = r.time - Date.now();
    if (delay <= 0) {
      sendReminder(r);
    } else {
      scheduleReminder(r, delay);
    }
  });
}

// Send reminder message
function sendReminder(reminder) {
  client.users.fetch(reminder.userId).then((user) => {
    user.send(`🔔 Reminder: ${reminder.msg}`).catch(() => {
      console.log(
        `Failed to DM user ${reminder.userId}, reminder was: ${reminder.msg}`
      );
    });
  });
  reminders = reminders.filter((r) => r.id !== reminder.id);
  saveReminders();
}

// Schedule reminder with timeout
function scheduleReminder(reminder, delay) {
  setTimeout(() => sendReminder(reminder), delay);
}

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Re-schedule saved reminders
  rescheduleReminders();

  // Auto-clean expired reminders every 10 minutes
  setInterval(cleanReminders, 10 * 60 * 1000);

  // ⏰ Cron Job — Monday 10 UTC = 5 AM EDT
  cron.schedule("0 10 * * 1", async () => {
    try {
      const guild = client.guilds.cache.get("1392954859803644014");
      if (!guild) return console.error("Guild not found.");

      const summary = await gatherServerConversationsAndSummarize(guild, true);
      const chunks = summary.match(/[\s\S]{1,1900}/g) || [
        "No summary available.",
      ];

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
});
