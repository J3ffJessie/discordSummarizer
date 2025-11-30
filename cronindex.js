// cron version of the bot

require("dotenv").config(); // Load environment variables from .env file
const { Client, GatewayIntentBits, Events } = require("discord.js");
const axios = require("axios");

const ADMIN_USER_ID = process.env.ADMIN_USER_ID || "280096257282670592";

/**
 * Notify the configured admin by DM.
 * @param {string} content
 */
async function notifyAdmin(content) {
  if (!ADMIN_USER_ID) return;
  try {
    const user = await client.users.fetch(ADMIN_USER_ID);
    if (!user) return;
    await user.send({ content: `📣 Admin Notification: ${content}` });
  } catch (err) {
    console.error("Failed to send admin DM:", err?.message || err);
  }
}

async function logError(err, context = "") {
  try {
    if (context) console.error(context, err);
    else console.error(err);
    await notifyAdmin(`${context ? `${context} — ` : ""}${(err && err.message) || String(err)}`);
  } catch (ignore) {}
}

// Helper: split long messages under 2000 chars
function splitMessage(content, limit = 1900) {
  const chunks = [];
  let current = "";

  content.split("\n").forEach((line) => {
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

// Function to generate summary using Ollama with retries
async function generateSummary(userMessages) {
  const maxRetries = 3;
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      const response = await axios.post(process.env.API_URL, {
        model: "phi",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "Summarize the following chat. Focus only on key discussion points, decisions, and tasks. Respond with clear bullet points that begin with '-'. Do not explain anything or use paragraphs.",
          },
          {
            role: "user",
            content: `Discord chat log:\n\n${userMessages}`,
          },
        ],
        stream: false,
      });

      const modelResponse =
        response.data?.message?.content ||
        response.data?.choices?.[0]?.message?.content;
      return modelResponse?.trim() || "No summary generated.";
    } catch (error) {
      attempts++;
      logError(error, `Summarization attempt ${attempts} failed`).catch(() => {});
      if (attempts === maxRetries) {
        return "Sorry, there was an error generating the summary. Please try again later.";
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
    }
  }
}

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Handle /summarize slash command
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "summarize") {
    try {
      await notifyAdmin(`Slash command /summarize invoked by ${interaction.user.tag} (${interaction.user.id}) in ${interaction.guild ? `guild ${interaction.guild.id}` : `DM`}`);
    } catch (ignore) {}
    await interaction.deferReply({ ephemeral: true });

    try {
      const channel = await client.channels.fetch(interaction.channelId);
      const messages = await channel.messages.fetch({ limit: 100 });

      const userMessages = messages
        .map((msg) => `${msg.author.username}: ${msg.content}`)
        .join("\n");

      const summary = await generateSummary(userMessages);

      const thread = await channel.threads.create({
        name: `Summary - ${new Date().toLocaleDateString()}`,
        autoArchiveDuration: 60,
      });

      const chunks = splitMessage(
        `**Channel Summary**\n\n${summary}\n\n*Summarized ${messages.size} messages*`
      );

      for (const chunk of chunks) {
        await thread.send({ content: chunk });
      }

      await interaction.editReply("Summary created successfully.");
      try {
        await notifyAdmin(`Slash command /summarize completed successfully by ${interaction.user.tag} (${interaction.user.id}) in ${interaction.guild ? `guild ${interaction.guild.id}` : `DM`}`);
      } catch (ignore) {}
    } catch (error) {
      await logError(error, "Error generating summary");
      await interaction.editReply("There was an error generating the summary.");
    }
  }
});

client.on("disconnect", () => {
  console.log("Bot disconnected from Discord. Attempting to reconnect...");
});

client.login(process.env.BOT_TOKEN).catch(async (error) => {
  await logError(error, "Failed to login");
  process.exit(1);
});
