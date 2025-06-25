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
const fetch = require("node-fetch"); // Add this at the top with your other requires

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

// let jobChannelId = null; // Will store ID of job-listings channel

// Ready event
// client.once(Events.ClientReady, async (readyClient) => {
//   console.log(`Ready! Logged in as ${readyClient.user.tag}`);

//   // Find the "job-listings" channel across all guilds the bot is in
//   for (const [guildId, guild] of client.guilds.cache) {
//     try {
//       const fullGuild = await guild.fetch();
//       const channel = fullGuild.channels.cache.find(
//         (ch) => ch.name === "job-list" && ch.isTextBased()
//       );

//       if (channel) {
//         jobChannelId = channel.id;
//         console.log(
//           `✅ Job listing channel found: ${channel.name} (${channel.id}) in guild ${fullGuild.name}`
//         );
//         break; // Stop after finding first match
//       }
//     } catch (err) {
//       console.warn(`Failed to fetch channels for guild ID ${guildId}:`, err);
//     }
//   }

//   if (!jobChannelId) {
//     console.warn('⚠️ Could not find a "job-listings" channel in any guild.');
//   }
// });

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

// // Fetch real job listings from RemoteOK API
// async function fetchJobListings() {
//   try {
//     const response = await fetch("https://remoteok.com/api");
//     if (!response.ok) throw new Error("Failed to fetch job listings");
//     const data = await response.json();

//     // The first element is metadata, skip it
//     const jobs = data
//       .slice(1)
//       .filter(
//         (job) =>
//           job.position &&
//           job.company &&
//           (job.location || job.country) &&
//           job.url
//       )
//       .slice(0, 10) // Limit to 10 jobs
//       .map((job) => ({
//         title: job.position,
//         company: job.company,
//         location: job.location || job.country || "Remote",
//         salary: job.salary || "N/A",
//         url: job.url.startsWith("http")
//           ? job.url
//           : `https://remoteok.com${job.url}`,
//       }));

//     return jobs;
//   } catch (error) {
//     console.error("RemoteOK job listing error:", error.message);
//     return [];
//   }
// }

// Send job listings as embeds to a channel
// async function sendJobListingsToChannel(channel) {
//   const jobs = await fetchJobListings();

//   if (jobs.length === 0) {
//     await channel.send("⚠️ No job listings available at the moment.");
//     return;
//   }

//   for (const job of jobs) {
//     const embed = new EmbedBuilder()
//       .setTitle(job.title || "No title")
//       .setURL(job.url || null)
//       .addFields(
//         { name: "Company", value: job.company || "N/A", inline: true },
//         { name: "Location", value: job.location || "N/A", inline: true },
//         { name: "Salary/Contract", value: job.salary || "N/A", inline: true }
//       )
//       .setColor(0x00ae86);

//     await channel.send({ embeds: [embed] });
//   }
// }

// Schedule weekly job listing every Monday at 9am CST
// cron.schedule(
//   "0 9 * * 1",
//   async () => {
//     if (!jobChannelId) {
//       console.log(
//         "No job-listings channel found. Skipping scheduled job listings."
//       );
//       return;
//     }

//     console.log("📆 Running weekly job listing fetch...");
//     try {
//       const channel = await client.channels.fetch(jobChannelId);
//       if (channel && channel.isTextBased()) {
//         await sendJobListingsToChannel(channel);
//       }
//     } catch (error) {
//       console.error("Error posting listings to channel:", error);
//     }
//   },
//   {
//     timezone: "America/Chicago",
//   }
// );

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

// Add !server command to gather and summarize all channels
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

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

  // if (message.content.startsWith("!jobs")) {
  //   const parts = message.content.trim().split(" ");
  //   const query = parts.slice(1).join(" ") || "technology jobs";
  //   await message.channel.send(`🔍 Searching jobs for: ${query}. Please wait...`);
  //   await sendJobsToChannel(message.channel, query);
  //   return;
  // }
});

// Fetch jobs from JSearch API
// async function fetchJobs(query = "technology jobs", page = 1, num_pages = 1, date_posted = "all") {
//   try {
//     const response = await fetch(
//       `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query)}&page=${page}&num_pages=${num_pages}&date_posted=${date_posted}`,
//       {
//         method: "GET",
//         headers: {
//           "x-rapidapi-key": process.env.RAPIDAPI_KEY,
//           "x-rapidapi-host": "jsearch.p.rapidapi.com",
//         },
//       }
//     );
//     if (!response.ok) throw new Error("Failed to fetch jobs from JSearch");
//     const data = await response.json();
//     return data;
//   } catch (error) {
//     console.error("JSearch API error:", error.message);
//     return null;
//   }
// }

// Send jobs as embeds to a Discord channel
// async function sendJobsToChannel(channel, query = "technology jobs") {
//   const data = await fetchJobs(query);

//   if (!data || !Array.isArray(data.data) || data.data.length === 0) {
//     await channel.send(`⚠️ No jobs found for "${query}".`);
//     return;
//   }

//   console.log('Fetched jobs:', data.data);
//   for (const job of data.data.slice(0, 15)) { // Limit to 5 jobs per request
//     const embed = new EmbedBuilder()
//       .setTitle(job.job_title || "No title")
//       .setURL(job.job_apply_link || job.job_google_link || null)
//       .addFields(
//         { name: "Company", value: job.employer_name || "N/A", inline: true },
//         { name: "Location", value: job.job_city ? `${job.job_city}, ${job.job_country}` : "N/A", inline: true },
//         { name: "Posted", value: job.job_posted_at_datetime_utc ? new Date(job.job_posted_at_datetime_utc).toLocaleString() : "N/A", inline: true }
//       )
//       .setColor(0x00ae86);

//     if (job.employer_logo) {
//       embed.setThumbnail(job.employer_logo);
//     }

//     await channel.send({ embeds: [embed] });
//   }
// }

// Error handling
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
