const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure bot settings for this server (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub
        .setName('view')
        .setDescription('View the current configuration for this server')
    )
    .addSubcommand(sub =>
      sub
        .setName('summary')
        .setDescription('Set the channel for automated server summaries')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to post weekly server summaries in')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('summary-disable')
        .setDescription('Disable automated server summaries')
    )
    .addSubcommand(sub =>
      sub
        .setName('coffee')
        .setDescription('Enable or disable automated coffee pairing')
        .addBooleanOption(opt =>
          opt
            .setName('enabled')
            .setDescription('Turn coffee pairing on or off')
            .setRequired(true)
        )
    ),

  async execute(interaction, services) {
    if (!interaction.guild) {
      return interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true,
      });
    }

    const { guildConfigService, schedulerService } = services;
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (subcommand === 'view') {
      const config = guildConfigService.getConfig(guildId);

      const summaryStatus = config?.summary_enabled
        ? `Enabled — <#${config.summary_channel_id}>`
        : 'Disabled';
      const coffeeStatus = config?.coffee_enabled ? 'Enabled' : 'Disabled';

      const embed = new EmbedBuilder()
        .setTitle('Server Configuration')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Server Summaries', value: summaryStatus, inline: false },
          { name: 'Coffee Pairing', value: coffeeStatus, inline: false },
        )
        .setFooter({ text: 'Use /setup summary or /setup coffee to configure.' })
        .setTimestamp();

      if (!config) {
        embed.setDescription('No configuration set yet for this server.');
      }

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (subcommand === 'summary') {
      const channel = interaction.options.getChannel('channel');

      await interaction.deferReply({ ephemeral: true });

      guildConfigService.upsertConfig(guildId, {
        summary_channel_id: channel.id,
        summary_enabled: 1,
      });

      if (schedulerService) schedulerService.refreshGuild(guildId);

      const embed = new EmbedBuilder()
        .setTitle('Server Summaries Enabled')
        .setDescription(`Weekly summaries will be posted in <#${channel.id}>.`)
        .setColor(0x2ecc71)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (subcommand === 'summary-disable') {
      await interaction.deferReply({ ephemeral: true });

      guildConfigService.upsertConfig(guildId, { summary_enabled: 0 });

      if (schedulerService) schedulerService.refreshGuild(guildId);

      const embed = new EmbedBuilder()
        .setTitle('Server Summaries Disabled')
        .setDescription('Automated server summaries have been turned off.')
        .setColor(0xe74c3c)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (subcommand === 'coffee') {
      const enabled = interaction.options.getBoolean('enabled');

      await interaction.deferReply({ ephemeral: true });

      guildConfigService.upsertConfig(guildId, { coffee_enabled: enabled ? 1 : 0 });

      if (schedulerService) schedulerService.refreshGuild(guildId);

      const embed = new EmbedBuilder()
        .setTitle(`Coffee Pairing ${enabled ? 'Enabled' : 'Disabled'}`)
        .setDescription(
          enabled
            ? 'Coffee pairing will run on the configured schedule and DM participants.'
            : 'Automated coffee pairing has been turned off.'
        )
        .setColor(enabled ? 0x2ecc71 : 0xe74c3c)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
