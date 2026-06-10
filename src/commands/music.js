const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Configure music recommendations for this server')
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Set the channel to watch for music links')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to watch for Spotify and YouTube Music links')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('auth')
        .setDescription('Authenticate with YouTube Music via OAuth')
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Show authentication and playlist status for YouTube Music')
    )
    .addSubcommand(sub =>
      sub
        .setName('reset')
        .setDescription('Clear the stored YouTube playlist ID so it is recreated fresh on the next song post')
    ),

  async execute(interaction, services) {
    if (!interaction.guildId) {
      return interaction.reply({ content: 'This command can only be used inside a server.', ephemeral: true });
    }

    const { guildConfigService, musicService } = services;
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    const isDiscordAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    const isStoredAdmin = guildConfigService.isAdmin(guildId, interaction.user.id);
    const isBotOwner = process.env.ADMIN_USER_ID && interaction.user.id === process.env.ADMIN_USER_ID;

    if (!isDiscordAdmin && !isStoredAdmin && !isBotOwner) {
      return interaction.reply({
        content: '❌ You need Administrator permission or must be configured as a bot admin to use this command.',
        ephemeral: true,
      });
    }

    if (subcommand === 'setup') {
      const channel = interaction.options.getChannel('channel');
      await interaction.deferReply({ ephemeral: true });

      guildConfigService.upsertConfig(guildId, {
        music_channel_id: channel.id,
        music_enabled: 1,
      });

      const embed = new EmbedBuilder()
        .setTitle('Music Channel Set')
        .setDescription(
          `Music links posted in <#${channel.id}> will be added to the Torc Grooves playlist.\n\n` +
          `Next step: run \`/music auth\` to authenticate with YouTube Music.`
        )
        .setColor(0xff0000)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (subcommand === 'auth') {
      if (!musicService) {
        return interaction.reply({ content: '❌ Music service is not available.', ephemeral: true });
      }

      const baseUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
      if (!baseUrl) {
        return interaction.reply({
          content: '❌ `PUBLIC_URL` environment variable is not set. Ask the bot owner to configure it.',
          ephemeral: true,
        });
      }

      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return interaction.reply({
          content: '❌ `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are not configured. Ask the bot owner to add them.',
          ephemeral: true,
        });
      }

      const authUrl = musicService.generateYoutubeAuthUrl(guildId);

      const embed = new EmbedBuilder()
        .setTitle('Authenticate with YouTube Music')
        .setDescription(
          `[Click here to authorize YouTube Music](${authUrl})\n\n` +
          `After completing the login you'll see a confirmation page and can close the tab.`
        )
        .setColor(0xff0000)
        .setFooter({ text: 'This link is for your server only — do not share it.' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (subcommand === 'reset') {
      guildConfigService.upsertConfig(guildId, { youtube_playlist_id: null });

      const embed = new EmbedBuilder()
        .setTitle('Playlist Reset')
        .setDescription('YouTube Music playlist ID cleared. A fresh playlist will be created on the next song post.')
        .setColor(0xf39c12)
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (subcommand === 'status') {
      const config = guildConfigService.getConfig(guildId);

      const musicChannel = config?.music_channel_id
        ? `<#${config.music_channel_id}>`
        : 'Not set — run `/music setup`';
      const musicEnabled = config?.music_enabled ? '✅ Enabled' : '❌ Disabled';

      const youtubeStatus = config?.youtube_access_token
        ? (config.youtube_refresh_token ? '✅ Authenticated' : '⚠️ No refresh token — re-auth recommended')
        : '❌ Not authenticated — run `/music auth`';
      const youtubePlaylist = config?.youtube_playlist_id
        ? `[View playlist](https://www.youtube.com/playlist?list=${config.youtube_playlist_id})`
        : 'Will be created on first song add';

      const embed = new EmbedBuilder()
        .setTitle('Music Recs Status')
        .setColor(0xff0000)
        .addFields(
          { name: 'Watch Channel', value: musicChannel, inline: false },
          { name: 'Status', value: musicEnabled, inline: false },
          { name: '​', value: '​', inline: false },
          { name: 'YouTube Music', value: youtubeStatus, inline: false },
          { name: 'Playlist', value: youtubePlaylist, inline: false },
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
