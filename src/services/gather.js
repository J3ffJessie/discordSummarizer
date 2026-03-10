const { ChannelType } = require('discord.js');

async function gatherServerConversationsAndSummarize(guild, useServerSummarize = false, { summarizationService, guildId } = {}) {
  let allMessages = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildText && channel.viewable) {
      try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const formatted = messages
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .map((msg) => `[${channel.name}] ${msg.member?.displayName || msg.author.username}: ${msg.content}`);
        allMessages.push(...formatted);
      } catch (err) {
        console.warn(`Could not fetch messages for #${channel.name}:`, err);
      }
    }
  }

  let combined = allMessages.join('\n');
  if (combined.length > 16000) combined = combined.slice(-16000);

  if (useServerSummarize) {
    return await summarizationService.serverSummarize(combined, guildId);
  } else {
    return await summarizationService.summarizeMessages(combined, guildId);
  }
}

module.exports = { gatherServerConversationsAndSummarize };