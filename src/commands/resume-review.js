const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { ResumeReviewError, DEFAULT_ROLE } = require('../services/resumeReviewService');

// Discord error code when a user has DMs from server members disabled
const CANNOT_DM_USER = 50007;

const DMS_CLOSED_MESSAGE =
  '❌ I couldn\'t send you a DM. Enable **Direct Messages** from server members ' +
  '(Server name → Privacy Settings) and try again.';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resume-review')
    .setDescription('Get private AI feedback on your resume, sent to your DMs')
    .addAttachmentOption(opt =>
      opt.setName('file')
        .setDescription('Your resume — PDF, DOCX, TXT, or image (PNG, JPG, GIF, WEBP)')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('role')
        .setDescription('The role or position you are targeting (optional)')
        .setMaxLength(200)
        .setRequired(false))
    .toJSON(),

  async execute(interaction, services) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: '❌ This command can only be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const { resumeReviewService, guildConfigService } = services;
    const guildConfig = guildConfigService?.getConfig(interaction.guildId);
    const enabled = guildConfig?.resume_review_enabled || process.env.RESUME_REVIEW_ENABLED === 'true';
    if (!enabled) {
      await interaction.reply({
        content: '❌ Resume review is not enabled on this server. Ask a server admin to turn it on in the dashboard.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const attachment = interaction.options.getAttachment('file', true);
    const targetRole = interaction.options.getString('role')?.trim() || DEFAULT_ROLE;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Confirm DMs are open before spending an AI call on the review
    try {
      await interaction.user.send(
        `📄 Reviewing **${attachment.name}** for **${targetRole}** — your feedback will arrive here shortly.`
      );
    } catch (err) {
      if (err.code === CANNOT_DM_USER) {
        await interaction.editReply({ content: DMS_CLOSED_MESSAGE });
        return;
      }
      throw err;
    }

    await interaction.editReply({ content: '⏳ Reviewing your resume — I\'ll DM you the feedback when it\'s ready.' });

    try {
      const review = await resumeReviewService.review({
        url: attachment.url,
        size: attachment.size,
        filename: attachment.name,
        guildConfig,
        targetRole,
      });
      await resumeReviewService.sendToUser(interaction.user, review);
      await interaction.editReply({ content: '✅ Your resume review has been sent to your DMs!' });
    } catch (err) {
      if (err instanceof ResumeReviewError) {
        await interaction.editReply({ content: `❌ ${err.message}` });
        return;
      }
      console.error('[resume-review] Error:', err?.message || err);
      await interaction.editReply({
        content: '❌ There was an error reviewing your resume. Please try again or contact a server admin.',
      });
    }
  },
};
