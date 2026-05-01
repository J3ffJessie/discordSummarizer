const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

function getBaseUrl() {
  const raw = process.env.CAPTION_URL || '';
  if (raw) {
    try { return new URL(raw).origin; } catch {}
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage server giveaways with a spinning wheel')
    .addSubcommand(sub =>
      sub.setName('start')
        .setDescription('Start a new giveaway')
        .addStringOption(opt =>
          opt.setName('title').setDescription('Giveaway title (e.g. "Game Key Giveaway")').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('prize').setDescription('What are you giving away?').setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('end')
        .setDescription('End the current giveaway and close entries')
    )
    .toJSON(),

  async execute(interaction, services) {
    const { giveawayService } = services;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      const existing = giveawayService.get(guildId);
      if (existing && existing.active) {
        return interaction.reply({
          content: '❌ A giveaway is already running. Use `/giveaway end` to close it first.',
          ephemeral: true,
        });
      }

      const title = interaction.options.getString('title');
      const prize = interaction.options.getString('prize') || '';

      const giveaway = giveawayService.create(guildId, interaction.user.id, title, prize);
      const base = getBaseUrl();
      const viewUrl = `${base}/giveaway?guildId=${guildId}&id=${giveaway.id}`;
      const hostUrl = `${viewUrl}&token=${giveaway.token}`;

      const embed = new EmbedBuilder()
        .setTitle(`🎉 ${title}`)
        .setDescription(
          (prize ? `**Prize:** ${prize}\n\n` : '') +
          `Click **Enter Giveaway** to add your name to the wheel!`
        )
        .setColor(0x5865f2)
        .setFooter({ text: `Hosted by ${interaction.member?.displayName || interaction.user.username}` })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`giveaway_enter_${guildId}`)
          .setLabel('Enter Giveaway')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎉'),
        new ButtonBuilder()
          .setURL(viewUrl)
          .setLabel('Watch the Wheel')
          .setStyle(ButtonStyle.Link)
          .setEmoji('🎡')
      );

      const msg = await interaction.reply({
        embeds: [embed],
        components: [row],
        fetchReply: true,
      });

      giveaway.messageId = msg.id;
      giveaway.channelId = msg.channelId;

      await interaction.followUp({
        content: `🎡 **Your giveaway wheel is ready!**\n\nUse this link to spin the wheel:\n${hostUrl}\n\n*Keep this link private — it controls the spin.*`,
        ephemeral: true,
      });
    }

    if (sub === 'end') {
      const giveaway = giveawayService.end(guildId);
      if (!giveaway) {
        return interaction.reply({ content: '❌ No active giveaway found.', ephemeral: true });
      }

      if (giveaway.messageId && giveaway.channelId) {
        try {
          const channel = await interaction.client.channels.fetch(giveaway.channelId);
          const msg = await channel.messages.fetch(giveaway.messageId);
          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`giveaway_enter_${guildId}`)
              .setLabel('Giveaway Ended')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('🔒')
              .setDisabled(true)
          );
          await msg.edit({ components: [disabledRow] });
        } catch { /* message may have been deleted */ }
      }

      return interaction.reply({
        content: `✅ Giveaway **${giveaway.title}** has ended. No more entries accepted.`,
        ephemeral: true,
      });
    }
  },
};
