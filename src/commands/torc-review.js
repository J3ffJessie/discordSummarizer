const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { TorcReviewError } = require('../services/torcReviewService');

// Discord error code when a user has DMs from server members disabled
const CANNOT_DM_USER = 50007;

const COOLDOWN_MS = 10 * 60 * 1000; // one review per user per 10 minutes

// In-memory cooldowns; they reset on restart, which is fine for a rate limit this short.
const cooldowns = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('torc-review')
    .setDescription('Get private feedback on your Torc profile, sent to your DMs. Nothing is stored.')
    .addStringOption(opt =>
      opt.setName('url')
        .setDescription('Link to your public torc.dev profile')
        .setMaxLength(500)
        .setRequired(true))
    .toJSON(),

  cooldowns,

  async execute(interaction, services) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: '❌ This command can only be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const userId = interaction.user.id;
    const last = cooldowns.get(userId);
    if (last && Date.now() - last < COOLDOWN_MS) {
      const mins = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 60000);
      await interaction.reply({
        content: `⏳ You can run another Torc review in about ${mins} minute(s).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const url = interaction.options.getString('url', true).trim();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { torcReviewService, guildConfigService } = services;
    const guildConfig = guildConfigService?.getConfig(interaction.guildId);

    try {
      const { text, source } = await torcReviewService.loadProfile(url);

      cooldowns.set(userId, Date.now());
      await interaction.editReply({ content: '🔎 Reading your Torc profile now. Your feedback will land in your DMs in a moment.' });

      let evaluation;
      try {
        evaluation = await torcReviewService.evaluate(text, source, guildConfig);
      } catch (err) {
        cooldowns.delete(userId); // don't penalize the user for our failure
        throw err;
      }

      const embeds = torcReviewService.buildEmbeds(evaluation);
      try {
        for (const embed of embeds) {
          await interaction.user.send({ embeds: [embed] });
        }
        await interaction.editReply({ content: '✅ Done! Check your DMs for your Torc profile feedback.' });
      } catch (err) {
        if (err.code !== CANNOT_DM_USER) throw err;
        // DMs closed: show it here instead. Ephemeral, so only they can see it.
        const [first, ...rest] = embeds;
        await interaction.editReply({
          content: 'I couldn\'t DM you (your DMs may be closed), so here\'s your feedback privately:',
          embeds: [first],
        });
        for (const embed of rest) {
          await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
      }
    } catch (err) {
      if (err instanceof TorcReviewError) {
        await interaction.editReply({ content: `❌ ${err.message}` });
        return;
      }
      console.error('[torc-review] Error:', err?.message || err);
      await interaction.editReply({
        content: '❌ Something went wrong while reviewing your profile. Please try again later.',
      });
    }
  },
};
