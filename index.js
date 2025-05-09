require("dotenv").config();
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

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "summarize") return;

  const channel = interaction.channel;
  await interaction.reply({ content: "Working on it..." });
  const reply = await interaction.fetchReply();

  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const userMessages = messages
      .filter((msg) => !msg.author.bot && msg.content)
      .map((msg) => `${msg.author.username}: ${msg.content}`)
      .reverse()
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

    await reply.delete().catch(console.warn);

    await interaction.editReply({
      content: "✅ Summary posted in a new thread.",
    });
  } catch (error) {
    console.error("Error handling /summarize:", error);
    await interaction.editReply({
      content: "❌ Failed to summarize the channel.",
    });
  }
});



// Function to generate summary using Ollama with retries
async function generateSummary(userMessages) {
  const maxRetries = 3;
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      const response = await axios.post(process.env.API_URL, {
        model: "mistral",
        temperature: 0.2,
      messages: [
  {
    role: "system",
    content: `You are a professional meeting summarizer for Discord channels.

Your task is to extract only the most important and relevant information from the conversation. You MUST follow these rules:

- Summarize using bullet points (each starting with '-').
- Focus on key topics, decisions made, action items, questions raised, and important insights.
- Group related bullet points under a topic if multiple messages support the same idea.
- Use concise and neutral language.
- Skip repetitive or vague content.
- At the end, list key topics discussed (e.g., "Topics: project deadlines, onboarding, deployment issues").`,
  },
  {
    role: "user",
    content: `Here is the chat log:\n\n${userMessages}\n\nSummarize it as instructed.`,
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
        return "Sorry, there was an error generating the summary.";
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
    }
  }
}

client.login(process.env.BOT_TOKEN).catch((error) => {
  console.error("Failed to login:", error);
  process.exit(1);
});
