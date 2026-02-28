const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const cron = require('node-cron');

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
    )
    .addSubcommand(sub =>
      sub
        .setName('summary-schedule')
        .setDescription('Set the cron schedule for automated server summaries')
        .addStringOption(opt =>
          opt
            .setName('cron')
            .setDescription('Cron expression (e.g. 0 10 * * 1 for Mon 10am)')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('coffee-role')
        .setDescription('Set the role name used for coffee pairing')
        .addStringOption(opt =>
          opt
            .setName('role')
            .setDescription('Role name (e.g. coffee chat)')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('coffee-schedule')
        .setDescription('Set the cron schedule for coffee pairing')
        .addStringOption(opt =>
          opt
            .setName('cron')
            .setDescription('Cron expression (e.g. 0 10 * * 5 for Fri 10am)')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('coffee-biweekly')
        .setDescription('Toggle whether coffee pairing runs every other week')
        .addBooleanOption(opt =>
          opt
            .setName('enabled')
            .setDescription('Run every 2 weeks instead of every week')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('coffee-cooldown')
        .setDescription('Set the cooldown between pairings for the same pair')
        .addIntegerOption(opt =>
          opt
            .setName('days')
            .setDescription('Cooldown in days (e.g. 30)')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('timezone')
        .setDescription('Set the timezone for all scheduled tasks')
        .addStringOption(opt =>
          opt
            .setName('tz')
            .setDescription('IANA timezone (e.g. America/New_York)')
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

      const summaryCron = config?.summary_cron || process.env.SERVER_SUMMARY_CRON || '0 10 * * 1';
      const coffeeCron = config?.coffee_cron || process.env.COFFEE_CRON_SCHEDULE || 'Not set';
      const coffeeRole = config?.coffee_role_name || process.env.COFFEE_ROLE_NAME || 'coffee chat';
      const coffeeBiweekly = config?.coffee_biweekly ? 'Yes' : 'No';
      const coffeeCooldown = config?.coffee_cooldown_days ?? Number(process.env.COFFEE_PAIRING_COOLDOWN_DAYS || 30);
      const timezone = config?.timezone || process.env.CRON_TIMEZONE || 'UTC';

      const embed = new EmbedBuilder()
        .setTitle('Server Configuration')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Server Summaries', value: summaryStatus, inline: false },
          { name: 'Summary Schedule', value: `\`${summaryCron}\``, inline: true },
          { name: 'Timezone', value: `\`${timezone}\``, inline: true },
          { name: '\u200b', value: '\u200b', inline: false },
          { name: 'Coffee Pairing', value: coffeeStatus, inline: false },
          { name: 'Coffee Role', value: coffeeRole, inline: true },
          { name: 'Coffee Schedule', value: `\`${coffeeCron}\``, inline: true },
          { name: 'Biweekly', value: coffeeBiweekly, inline: true },
          { name: 'Cooldown', value: `${coffeeCooldown} days`, inline: true },
        )
        .setFooter({ text: 'Use /setup <subcommand> to configure individual settings.' })
        .setTimestamp();

      if (!config) {
        embed.setDescription('No configuration saved yet — showing defaults.');
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

    if (subcommand === 'summary-schedule') {
      const expr = interaction.options.getString('cron');

      if (!cron.validate(expr)) {
        return interaction.reply({ content: '❌ Invalid cron expression. Example: `0 10 * * 1`', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      guildConfigService.upsertConfig(guildId, { summary_cron: expr });
      if (schedulerService) schedulerService.refreshGuild(guildId);

      const embed = new EmbedBuilder()
        .setTitle('Summary Schedule Updated')
        .setDescription(`Server summaries will now run on: \`${expr}\``)
        .setColor(0x5865f2)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (subcommand === 'coffee-role') {
      const role = interaction.options.getString('role');

      await interaction.deferReply({ ephemeral: true });
      guildConfigService.upsertConfig(guildId, { coffee_role_name: role });
      if (schedulerService) schedulerService.refreshGuild(guildId);

      const embed = new EmbedBuilder()
        .setTitle('Coffee Role Updated')
        .setDescription(`Coffee pairing will now target members with the role: **${role}**`)
        .setColor(0x5865f2)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (subcommand === 'coffee-schedule') {
      const expr = interaction.options.getString('cron');

      if (!cron.validate(expr)) {
        return interaction.reply({ content: '❌ Invalid cron expression. Example: `0 10 * * 5`', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      guildConfigService.upsertConfig(guildId, { coffee_cron: expr });
      if (schedulerService) schedulerService.refreshGuild(guildId);

      const embed = new EmbedBuilder()
        .setTitle('Coffee Schedule Updated')
        .setDescription(`Coffee pairing will now run on: \`${expr}\``)
        .setColor(0x5865f2)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (subcommand === 'coffee-biweekly') {
      const enabled = interaction.options.getBoolean('enabled');

      await interaction.deferReply({ ephemeral: true });
      guildConfigService.upsertConfig(guildId, { coffee_biweekly: enabled ? 1 : 0 });
      if (schedulerService) schedulerService.refreshGuild(guildId);

      const embed = new EmbedBuilder()
        .setTitle(`Coffee Biweekly ${enabled ? 'Enabled' : 'Disabled'}`)
        .setDescription(enabled ? 'Coffee pairing will run every other week.' : 'Coffee pairing will run every week.')
        .setColor(0x5865f2)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (subcommand === 'coffee-cooldown') {
      const days = interaction.options.getInteger('days');

      await interaction.deferReply({ ephemeral: true });
      guildConfigService.upsertConfig(guildId, { coffee_cooldown_days: days });
      if (schedulerService) schedulerService.refreshGuild(guildId);

      const embed = new EmbedBuilder()
        .setTitle('Coffee Cooldown Updated')
        .setDescription(`The same pair won't be matched again for **${days} day${days === 1 ? '' : 's'}**.`)
        .setColor(0x5865f2)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (subcommand === 'timezone') {
      const tz = interaction.options.getString('tz');
      const validTimezones = Intl.supportedValuesOf('timeZone');

      if (!validTimezones.includes(tz)) {
        return interaction.reply({ content: `❌ Invalid timezone. Use an IANA timezone name (e.g. \`America/New_York\`, \`Europe/London\`).`, ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      guildConfigService.upsertConfig(guildId, { timezone: tz });
      if (schedulerService) schedulerService.refreshGuild(guildId);

      const embed = new EmbedBuilder()
        .setTitle('Timezone Updated')
        .setDescription(`All scheduled tasks will now use: \`${tz}\``)
        .setColor(0x5865f2)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
