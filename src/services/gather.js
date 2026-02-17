const { ChannelType } = require('discord.js');
const groq = require('./groq');

async function gatherLiveServerConversationsAndSummarize(client, useServerSummarize = false) {
  const LIVE_GUILD_ID = process.env.GUILD_ID; // pulls from Render

  if (!LIVE_GUILD_ID) throw new Error('GUILD_ID is not defined in environment variables.');

  const guild = client.guilds.cache.get(LIVE_GUILD_ID);
  if (!guild) throw new Error(`Live server with ID ${LIVE_GUILD_ID} not found.`);

  let allMessages = [];

  for (const channel of guild.channels.cache.values()) {
    if (
      channel.isTextBased() &&
      channel.viewable &&
      !channel.isThread() &&
      channel.type === ChannelType.GuildText
    ) {
      try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const formatted = messages
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .map(
            (msg) =>
              `[${channel.name}] ${msg.member?.displayName || msg.author.username}: ${msg.content}`
          );
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

module.exports = { gatherLiveServerConversationsAndSummarize };