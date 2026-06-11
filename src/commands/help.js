const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List all available bot commands')
    .toJSON(),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('Bot Commands')
      .setColor(0x5865f2)
      .addFields(
        {
          name: '🔧 Utility',
          value: [
            '`/translate start` — Join your voice channel and begin live captioning',
            '`/translate stop` — End the active translation session',
            '`/summarize` — Summarize recent messages in this channel',
            '`/remindme` — Set a personal reminder',
            '`/listreminders` — View your pending reminders',
            '`/cancelreminder` — Cancel a reminder by ID, or cancel all',
            '`/events` — Get upcoming server events sent to your DMs',
          ].join('\n'),
          inline: false,
        },
        {
          name: '👤 Profile',
          value: [
            '`/profile edit` — Edit your member profile (bio, title, skills, timezone, networking)',
            '`/profile view` — View your profile or another member\'s profile',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🎉 Community',
          value: [
            '`/giveaway start` — Start a new giveaway with a spinning wheel',
            '`/giveaway end` — Close entries and end the active giveaway',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🛡️ Admin — General',
          value: [
            '`/setup view` — View current server configuration',
            '`/setup ai` — Configure the AI provider, model, and API key for summarization, translation, or transcription',
            '`/setup timezone` — Set the timezone for all scheduled tasks',
            '`/setup admin-add` — Grant a user bot-admin privileges',
            '`/setup admin-remove` — Revoke bot-admin privileges from a user',
            '`/setup dashboard` — Get a private link to the web configuration dashboard',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🛡️ Admin — Summaries & Coffee',
          value: [
            '`/setup summary` — Enable automated weekly summaries',
            '`/setup summary-schedule` — Set the summary cron schedule',
            '`/setup summary-disable` — Disable automated summaries',
            '`/setup coffee` — Enable or disable coffee pairing',
            '`/setup coffee-channel` — Set the channel where pairings are announced',
            '`/setup coffee-role` — Set the role used for coffee pairing',
            '`/setup coffee-schedule` — Set the coffee pairing cron schedule',
            '`/setup coffee-biweekly` — Toggle every-other-week pairing',
            '`/setup coffee-cooldown` — Set the cooldown between repeat pairings',
            '`/server` — Gather and summarize conversations across all channels',
            '`/paircoffee` — Manually trigger a coffee pairing run',
            '`/coffee-list` — Check how many members have the coffee chat role',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🛡️ Admin — Music & Tools',
          value: [
            '`/music setup` — Set the channel to watch for music link sharing',
            '`/music auth` — Authenticate with YouTube Music via OAuth',
            '`/music status` — Show YouTube Music authentication and playlist status',
            '`/music reset` — Clear the stored YouTube playlist ID',
            '`/sticky set` — Set a message that stays pinned at the bottom of a channel',
            '`/sticky remove` — Remove the sticky message from a channel',
            '`/sticky view` — View the current sticky message for a channel',
            '`/location` — Scan channel messages for location mentions',
            '`/downloadlocations` — Send the sorted locations log to your DMs',
          ].join('\n'),
          inline: false,
        }
      )
      .setFooter({ text: 'Admin-only commands require the Administrator permission or bot-admin role.' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
