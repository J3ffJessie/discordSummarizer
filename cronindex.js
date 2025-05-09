// cron version of the bot

require("dotenv").config(); // Load environment variables from .env file
const { Client, GatewayIntentBits, Events } = require("discord.js");
const axios = require("axios");

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
      console.error(`Summarization attempt ${attempts} failed:`, error);
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
    } catch (error) {
      console.error("Error generating summary:", error);
      await interaction.editReply("There was an error generating the summary.");
    }
  }
});

client.on("disconnect", () => {
  console.log("Bot disconnected from Discord. Attempting to reconnect...");
});

client.login(process.env.BOT_TOKEN).catch((error) => {
  console.error("Failed to login:", error);
  process.exit(1);
});
