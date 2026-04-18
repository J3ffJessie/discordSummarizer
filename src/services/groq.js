const { createChatProvider } = require('../providers');

class SummarizationService {
  constructor(guildConfigService) {
    this.gcs = guildConfigService;
  }

  async serverSummarize(messages, guildId) {
    const guildConfig = this.gcs?.getConfig(guildId) || null;
    const provider = createChatProvider('summ', guildConfig);

    return await provider.chat(
      `\nYou are a Discord conversation summarizer.\n\nCRITICAL RULES:\n- Only summarize information explicitly present in the messages\n- Do NOT infer intent, motivation, or outcomes\n- Do NOT invent decisions, conclusions, or action items\n- If a section has no relevant content, write "None mentioned"\n- If something is unclear or ambiguous, state that clearly\n\nThe input is a chronological Discord chat log.\nIgnore jokes, memes, or sarcasm unless they directly impact discussion outcomes.\n\nFormat your response exactly as follows:\n\n📬 **Conversation Overview**\nA concise, factual overview of what was discussed.\n\n🧾 **Explicitly Stated Facts**\n• Only facts clearly stated in the conversation\n\n🎯 **Main Topics & Decisions**\n• Topics discussed and decisions ONLY if explicitly stated\n• If no decisions were made, say so\n\n🔄 **Ongoing or Unresolved Discussions**\n• Topics still being discussed or left unresolved\n• If unclear, state the uncertainty\n\n📋 **Action Items (only if explicitly stated)**\n• Task + details if clearly mentioned\n• Otherwise: "No explicit action items mentioned"\n\nMaintain a friendly but factual tone.\nAvoid speculation.\nBe thorough but concise.\n`,
      messages,
      { temperature: 0.3, max_tokens: 1024 }
    );
  }

  async summarizeMessages(messages, guildId) {
    const guildConfig = this.gcs?.getConfig(guildId) || null;
    const provider = createChatProvider('summ', guildConfig);

    return await provider.chat(
      'You are a friendly Discord conversation analyzer. Summarize the following Discord conversation as a concise, engaging list of key points. Use bullet points, but do not break the summary into sections or categories. Just provide a single bulleted list that captures the main ideas, events, and noteworthy exchanges from the conversation.',
      `Please provide a detailed summary of this Discord conversation following the format above:\n\n${messages}`,
      { temperature: 0.7, max_tokens: 1024 }
    );
  }
}

module.exports = { SummarizationService };
