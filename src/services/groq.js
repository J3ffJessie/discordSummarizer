const { createChatProvider } = require("../providers");

class SummarizationService {
  constructor(guildConfigService) {
    this.gcs = guildConfigService;
  }

  async serverSummarize(messages, guildId) {
    const guildConfig = this.gcs?.getConfig(guildId) || null;
    const provider = createChatProvider("summ", guildConfig);

    return await provider.chat(
      `You are a Discord server activity summarizer. Given a recent chat log from multiple channels, write a short, friendly summary of what was discussed. Be factual and concise. Do not invent details not present in the log. Do not include decisions, outcomes, or action items.`,
      `Summarize the following Discord activity:\n\n<chat_log>\n${messages}\n</chat_log>`,
      { temperature: 0.3, max_tokens: 1024 },
    );
  }

  async summarizeMessages(messages, guildId) {
    const guildConfig = this.gcs?.getConfig(guildId) || null;
    const provider = createChatProvider("summ", guildConfig);

    return await provider.chat(
      "You are a friendly Discord conversation analyzer. Summarize the following Discord conversation as a concise, engaging list of key points. Use bullet points, but do not break the summary into sections or categories. Just provide a single bulleted list that captures the main ideas, events, and noteworthy exchanges from the conversation.",
      `Please provide a detailed summary of this Discord conversation following the format above:\n\n${messages}`,
      { temperature: 0.7, max_tokens: 1024 },
    );
  }
}

module.exports = { SummarizationService };
