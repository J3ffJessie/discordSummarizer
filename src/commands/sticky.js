const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Manage a sticky message that stays at the bottom of a channel')
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Set or update the sticky message for this channel')
        .addStringOption(opt =>
          opt.setName('content')
            .setDescription('The message to keep at the bottom of this channel')
            .setRequired(true)
            .setMaxLength(2000)
        )
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove the sticky message from this channel')
    )
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View the current sticky message for this channel')
    )
    .toJSON(),

  async execute(interaction, services) {
    const { stickyService, guildConfigService } = services;
    const guildId = interaction.guildId;

    const isDiscordAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    const isStoredAdmin  = guildConfigService.isAdmin(guildId, interaction.user.id);
    const isBotOwner     = process.env.ADMIN_USER_ID && interaction.user.id === process.env.ADMIN_USER_ID;

    if (!isDiscordAdmin && !isStoredAdmin && !isBotOwner) {
      return interaction.reply({
        content: '❌ You need Administrator permission or must be configured as a bot admin to use this command.',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();
    const channelId = interaction.channelId;

    if (sub === 'set') {
      const content = interaction.options.getString('content');

      // Delete existing sticky message from the channel if present
      const existing = stickyService.getSticky(channelId);
      if (existing?.message_id) {
        try {
          const old = await interaction.channel.messages.fetch(existing.message_id);
          await old.delete();
        } catch { /* already deleted or not found */ }
      }

      // Defer so the send + DB write can complete before we reply
      await interaction.deferReply({ ephemeral: true });

      const sent = await interaction.channel.send({ content: `📌 **Sticky Message**\n\n${content}` });
      stickyService.setSticky(channelId, interaction.guildId, content, interaction.user.id, sent.id);

      await interaction.editReply({ content: '✅ Sticky message set for this channel.' });

    } else if (sub === 'remove') {
      const existing = stickyService.getSticky(channelId);
      if (!existing) {
        return interaction.reply({ content: '❌ No sticky message is set for this channel.', ephemeral: true });
      }

      if (existing.message_id) {
        try {
          const old = await interaction.channel.messages.fetch(existing.message_id);
          await old.delete();
        } catch { /* already gone */ }
      }

      stickyService.removeSticky(channelId);
      await interaction.reply({ content: '✅ Sticky message removed from this channel.', ephemeral: true });

    } else if (sub === 'view') {
      const existing = stickyService.getSticky(channelId);
      if (!existing) {
        return interaction.reply({ content: '❌ No sticky message is set for this channel.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('📌 Current Sticky Message')
        .setDescription(existing.content)
        .setFooter({ text: `Set by <@${existing.created_by}>` });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
