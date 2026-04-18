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
          name: '🛡️ Moderation (Admin Only)',
          value: [
            '`/setup view` — View current server configuration',
            '`/setup summary` — Enable automated weekly summaries',
            '`/setup summary-schedule` — Set the summary cron schedule',
            '`/setup summary-disable` — Disable automated summaries',
            '`/setup coffee` — Enable or disable coffee pairing',
            '`/setup coffee-role` — Set the role used for coffee pairing',
            '`/setup coffee-schedule` — Set the coffee pairing cron schedule',
            '`/setup coffee-biweekly` — Toggle every-other-week pairing',
            '`/setup coffee-cooldown` — Set the cooldown between repeat pairings',
            '`/setup timezone` — Set the timezone for all scheduled tasks',
            '`/server` — Gather and summarize conversations across all channels',
            '`/paircoffee` — Manually trigger a coffee pairing run',
            '`/coffee-list` — Check how many members have the coffee chat role',
            '`/location` — Scan channel messages for location mentions',
            '`/downloadlocations` — Send the sorted locations log to your DMs',
          ].join('\n'),
          inline: false,
        }
      )
      .setFooter({ text: 'Admin-only commands require the Administrator permission.' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
