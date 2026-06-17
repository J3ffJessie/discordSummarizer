const { EmbedBuilder } = require('discord.js');

module.exports = (client) => {
  client.on('messageCreate', async (message) => {
    if (message.author?.bot) return;
    client.services?.messageStats?.recordMessage(message);

    // ── Sticky messages ──────────────────────────────────────────────────────
    const stickyService = client.services?.stickyService;
    if (stickyService) {
      const sticky = stickyService.getSticky(message.channelId);
      if (sticky) {
        if (sticky.message_id) {
          try {
            const old = await message.channel.messages.fetch(sticky.message_id);
            await old.delete();
          } catch { /* already deleted or missing */ }
        }
        try {
          const stickyEmbed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('📌 Sticky Message')
            .setDescription(sticky.content);
          const sent = await message.channel.send({ embeds: [stickyEmbed] });
          stickyService.updateMessageId(message.channelId, sent.id);
        } catch (err) {
          console.error('[sticky] Failed to repost sticky message:', err.message);
        }
      }
    }

  });
};
