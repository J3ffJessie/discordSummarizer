const { ChannelType } = require('discord.js');
const groq = require('./groq');

async function gatherServerConversationsAndSummarize(guild, useServerSummarize = false) {
  let allMessages = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel.isTextBased && channel.viewable && !channel.isThread && channel.type === ChannelType.GuildText) {
      try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const formatted = messages
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .map((msg) => `[${channel.name}] ${msg.member?.displayName || msg.author.username}: ${msg.content}`);
        allMessages.push(...formatted);
      } catch (err) {
        console.warn(`Could not fetch messages for #${channel.name}:`, err?.message || err);
      }
    }
  }

  let combined = allMessages.join('\n');
  if (combined.length > 16000) combined = combined.slice(-16000);

  if (useServerSummarize) {
    return await groq.serverSummarize(combined);
  } else {
    return await groq.summarizeMessages(combined);
  }
}

module.exports = { gatherServerConversationsAndSummarize };
