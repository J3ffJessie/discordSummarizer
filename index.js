require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const cron = require("node-cron");

// Helper: convert timestamp to Discord snowflake
function timestampToSnowflake(timestamp) {
  const discordEpoch = 1420070400000n;
  return ((BigInt(timestamp) - discordEpoch) << 22n).toString();
}

// Helper: split long messages under 2000 chars
function splitMessage(content, limit = 1900) {
  const chunks = [];
  let current = "";

  content.split("\n").forEach(line => {
    if ((current + "\n" + line).length > limit) {
      chunks.push(current);
      current = line;
    } else {
      current += "\n" + line;
    }
  });

  if (current) chunks.push(current);
  return chunks;
}

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Run every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    const channelId = process.env.CHANNEL_ID;

    try {
      const channel = await client.channels.fetch(channelId);
      const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
      const afterSnowflake = timestampToSnowflake(fiveHoursAgo);

      const messages = await channel.messages.fetch({
        limit: 100,
        after: afterSnowflake,
      });

      if (messages.size === 0) {
        console.log("No new messages to summarize");
        return;
      }

      const userMessages = messages
        .map((msg) => `${msg.author.username}: ${msg.content}`)
        .filter((content) => content.trim().length > 0)
        .join("\n");

      const summary = await generateSummary(userMessages);

      const thread = await channel.threads.create({
        name: `Summary for ${new Date().toLocaleString()}`,
        autoArchiveDuration: 60,
        reason: "Automated channel summary",
      });

      const chunks = splitMessage(`**Channel Summary**\n\n${summary}\n\n*Summarized ${messages.size} messages*`);
      for (const chunk of chunks) {
        await thread.send({ content: chunk });
      }

    } catch (error) {
      console.error("Error in summarization routine:", error);
    }
  });
});

async function generateSummary(userMessages) {
  const maxRetries = 3;
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      const response = await axios.post(process.env.API_URL, {
        model: "tinyllama",
        messages: [
          {
            role: "system",
            content: "You are a meeting assistant who summarizes actual conversation content. Focus on identifying major topics discussed, decisions made, action items, and tone. Avoid inventing content or giving generic descriptions.",
          },
          {
            role: "user",
            content: `Here is a real conversation from a Discord channel:\n\n${userMessages}\n\nSummarize the key points as a concise paragraph. Include major themes, decisions made, any questions asked, and highlight specific contributions from users if relevant.`,
          },
        ],
        stream: false,
      });

      return response.data.message.content.trim();
    } catch (error) {
      attempts++;
      console.error(`Summarization attempt ${attempts} failed:`, error);
      if (attempts === maxRetries) {
        return "Sorry, there was an error generating the summary. Please try again later.";
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
    }
  }
}


client.on("disconnect", () => {
  console.log("Bot disconnected from Discord. Attempting to reconnect...");
});

client.login(process.env.BOT_TOKEN).catch((error) => {
  console.error("Failed to login:", error);
  process.exit(1);
});
