require("dotenv").config();
const { Client, GatewayIntentBits, Partials, Events } = require("discord.js");
const axios = require("axios");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// Split long messages to fit Discord limit
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

// Function to summarize chat using Ollama
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
              "Summarize the following Discord conversation. Focus on key discussion points, decisions, and tasks. Respond only with clear bullet points that begin with '-'. No explanations or paragraphs.",
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
        return "Sorry, there was an error generating the summary.";
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
    }
  }
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "summarize") return;

  const channel = interaction.channel;

  // Send a temporary message to acknowledge command
  await interaction.reply({
  content: "Working on it...",
});
const reply = await interaction.fetchReply();


  try {
    // Fetch messages
    const messages = await channel.messages.fetch({ limit: 100 });
    const userMessages = messages
      .filter((msg) => !msg.author.bot && msg.content)
      .map((msg) => `${msg.author.username}: ${msg.content}`)
      .reverse()
      .join("\n");

    const summary = await generateSummary(userMessages);

    // Create thread with summary
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

    // Delete the "working on it" message
    await reply.delete().catch(console.warn);

    // Optionally acknowledge completion silently
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

client.login(process.env.BOT_TOKEN);
