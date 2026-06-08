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
          const sent = await message.channel.send({ content: `📌 **Sticky Message**\n\n${sticky.content}` });
          stickyService.updateMessageId(message.channelId, sent.id);
        } catch (err) {
          console.error('[sticky] Failed to repost sticky message:', err.message);
        }
      }
    }

    // ── Resume review ────────────────────────────────────────────────────────
    const resumeReviewService = client.services?.resumeReviewService;
    if (resumeReviewService) {
      const guildConfig    = client.services?.guildConfigService?.getConfig(message.guildId);
      const resumeEnabled  = guildConfig?.resume_review_enabled || (process.env.RESUME_REVIEW_ENABLED === 'true' ? 1 : 0);
      const resumeChannel  = guildConfig?.resume_channel_id     || process.env.RESUME_CHANNEL_ID;
      if (
        resumeEnabled &&
        resumeChannel &&
        message.channel.isThread() &&
        message.channel.parentId === resumeChannel &&
        message.attachments.size > 0
      ) {
        resumeReviewService.handleMessage(message, guildConfig)
          .catch(err => console.error('[resume-review] Unhandled error:', err.message));
      }
    }
  });
};
