const { EmbedBuilder } = require('discord.js');

function buildStickyEmbed(content) {
  return new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('📌 Sticky Message')
    .setDescription(content)
    .setFooter({ text: 'This message is pinned to the bottom of this channel.' });
}

module.exports = (client) => {
  client.on('messageCreate', async (message) => {
    if (message.author?.bot) return;
    client.services?.messageStats?.recordMessage(message);

    const stickyService = client.services?.stickyService;
    if (!stickyService) return;

    const sticky = stickyService.getSticky(message.channelId);
    if (!sticky) return;

    // Delete old sticky post, then repost so it stays at the bottom
    if (sticky.message_id) {
      try {
        const old = await message.channel.messages.fetch(sticky.message_id);
        await old.delete();
      } catch { /* already deleted or missing */ }
    }

    try {
      const sent = await message.channel.send({ embeds: [buildStickyEmbed(sticky.content)] });
      stickyService.updateMessageId(message.channelId, sent.id);
    } catch (err) {
      console.error('[sticky] Failed to repost sticky message:', err.message);
    }
  });
};
