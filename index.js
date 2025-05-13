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

// Roast personalities
const roastPersonalities = [
  // {
  //   name: "Gordon Ramsay",
  //   prompt: `You're Gordon Ramsay. You just received a pathetic Discord summary request. Roast the user like they served you microwaved spam. Be brutal, loud, and funny. Keep it short, one paragraph max.`,
  // },
  // {
  //   name: "Simon Cowell",
  //   prompt: `You're Simon Cowell. Someone just asked for a Discord summary and you’re not impressed. Be sarcastic, witty, and critical. Roast them like they're auditioning terribly. One paragraph max.`,
  // },
  {
    name: "Rick Sanchez",
    prompt: `You're Rick from Rick and Morty. You’re annoyed by a Discord summary request and ready to roast the user like a scientist with zero patience for dumb humans. Add sci-fi insults and genius-level rudeness.`,
  },
  // {
  //   name: "Your Sarcastic Manager",
  //   prompt: `You're a passive-aggressive corporate manager. Someone just asked for a meeting summary. Roast them like you're reviewing their annual performance. Be dry, sarcastic, and ruthlessly disappointed.`,
  // },
];

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

  await interaction.deferReply();

  // Roast first
  const roast = await generateRoast(interaction.user.username);

  await interaction.editReply({
    content: `**${roast.personality}'s Opinion**\n\n${roast.text}\n\nNow summarizing... 🍳`,
  });

  const reply = await interaction.fetchReply();

  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    const userMessages = messages
      // .filter((msg) => !msg.author.bot && msg.content)
      // .map((msg) => `${msg.author.username}: ${msg.content}`)
      .map((msg) => msg.content)
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

    // Optionally repost roast in thread
    await thread.send(
      `**${roast.personality}'s Opinion (again)**\n\n${roast.text}`
    );


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

// Function to generate the channel summary
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

// Function to roast the user with a random personality
async function generateRoast(username) {
  const personality =
    roastPersonalities[Math.floor(Math.random() * roastPersonalities.length)];

  try {
    const response = await axios.post(process.env.API_URL, {
      model: "mistral",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: personality.prompt,
        },
        {
          role: "user",
          content: `Roast the user named ${username}.`,
        },
      ],
      stream: false,
    });

    const text =
      response.data?.message?.content ||
      response.data?.choices?.[0]?.message?.content ||
      "You're not even worth roasting.";

    return { personality: personality.name, text: text.trim() };
  } catch (error) {
    console.error("Roast failed:", error);
    return {
      personality: "Gordon Ramsay",
      text: "I can't even roast you properly. That’s how bland you are.",
    };
  }
}

client.login(process.env.BOT_TOKEN).catch((error) => {
  console.error("Failed to login:", error);
  process.exit(1);
});
