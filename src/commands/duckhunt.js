const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('duckhunt')
    .setDescription('Play Duck Hunt right inside Discord')
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub.setName('play')
        .setDescription('Launch the Duck Hunt Activity (aim with your mouse, click to shoot)')
    )
    .addSubcommand(sub =>
      sub.setName('leaderboard')
        .setDescription('Show the top Duck Hunt scores for this server')
    )
    .toJSON(),

  async execute(interaction, services) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'play') {
      try {
        await interaction.launchActivity();
      } catch (err) {
        console.error('Failed to launch Duck Hunt Activity:', err?.message || err);
        await interaction.reply({
          content: '❌ Couldn\'t launch Duck Hunt. The bot owner may need to enable Activities for this app in the Discord Developer Portal.',
          ephemeral: true,
        });
      }
      return;
    }

    if (sub === 'leaderboard') {
      const rows = services.duckHuntService.getLeaderboard(interaction.guildId, 10);

      if (rows.length === 0) {
        return interaction.reply({
          content: '🦆 No Duck Hunt scores yet. Be the first — run `/duckhunt play`!',
          ephemeral: true,
        });
      }

      const lines = rows.map((r, i) => {
        const place = MEDALS[i] || `**${i + 1}.**`;
        return `${place} <@${r.user_id}> — **${r.best_score.toLocaleString()}** pts · round ${r.best_round} · ${r.total_ducks} ducks`;
      });

      const embed = new EmbedBuilder()
        .setTitle('🦆 Duck Hunt Leaderboard')
        .setColor(0x3cbcfc)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Best score per player · /duckhunt play to compete' });

      return interaction.reply({ embeds: [embed], allowedMentions: { users: [] } });
    }
  },
};
