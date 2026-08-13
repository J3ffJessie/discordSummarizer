const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { LANGUAGES, DEFAULT_LANGUAGE } = require('../services/interviewService');

const INTERVIEW_STYLE_SELECT_ID = 'interview_style_select';
const INTERVIEW_LANGUAGE_SELECT_ID = 'interview_language_select';
const INTERVIEW_CONTINUE_BUTTON_ID = 'interview_continue';
const INTERVIEW_MODAL_ID = 'interview_modal';

module.exports = {
  INTERVIEW_STYLE_SELECT_ID,
  INTERVIEW_LANGUAGE_SELECT_ID,
  INTERVIEW_CONTINUE_BUTTON_ID,
  INTERVIEW_MODAL_ID,

  data: new SlashCommandBuilder()
    .setName('interview')
    .setDescription('Start or stop an AI-powered voice interview')
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('Start an AI voice interview')
        .addAttachmentOption(opt =>
          opt
            .setName('attachment')
            .setDescription('Upload a PDF or DOCX job description (or paste text in the next step)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('stop')
        .setDescription('Stop your current AI voice interview')
    ),

  async execute(interaction, { interviewService }) {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (!interaction.guild) {
      return interaction.reply({
        content: 'This command can only be used inside a server.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === 'start') {
      if (interviewService.sessions.has(userId)) {
        return interaction.reply({
          content: '❌ You already have an active interview. Use `/interview stop` to end it first.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const botMember = interaction.guild.members.me;
      const missingPerms = [];
      if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) missingPerms.push('Manage Channels');
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) missingPerms.push('Manage Roles');
      if (!botMember.permissions.has(PermissionFlagsBits.Connect)) missingPerms.push('Connect');
      if (missingPerms.length > 0) {
        return interaction.reply({
          content: `❌ I'm missing the following permissions: **${missingPerms.join(', ')}**. Please grant these to the bot role in Server Settings.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const attachment = interaction.options.getAttachment('attachment');
      interviewService.setPendingSetup(userId, {
        attachment: attachment
          ? { url: attachment.url, contentType: attachment.contentType, name: attachment.name }
          : null,
      });

      const styleRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(INTERVIEW_STYLE_SELECT_ID)
          .setPlaceholder('Interview style (default: Behavioral)')
          .addOptions([
            { label: 'Behavioral', description: 'STAR-method — past situations and actions', value: 'behavioral', default: true },
            { label: 'Technical', description: 'Skills and knowledge assessment', value: 'technical' },
            { label: 'Conversational', description: 'Relaxed, culture-fit focused', value: 'conversational' },
            { label: 'Case-based', description: 'Problem-solving scenarios', value: 'case_based' },
          ])
      );

      const languageRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(INTERVIEW_LANGUAGE_SELECT_ID)
          .setPlaceholder('Interview language (default: English)')
          .addOptions(
            Object.entries(LANGUAGES).map(([code, { name }]) => ({
              label: name,
              value: code,
              default: code === DEFAULT_LANGUAGE,
            }))
          )
      );

      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(INTERVIEW_CONTINUE_BUTTON_ID)
          .setLabel('Continue →')
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({
        content: '**Step 1 of 2** — Choose your interview style and language, then click **Continue** to enter the job details.',
        components: [styleRow, languageRow, buttonRow],
        flags: MessageFlags.Ephemeral,
      });
    }

    else if (subcommand === 'stop') {
      if (!interviewService.sessions.has(userId)) {
        return interaction.reply({
          content: '❌ You don\'t have an active interview.',
          flags: MessageFlags.Ephemeral,
        });
      }

      await interviewService.stopInterview(userId);

      await interaction.reply({
        content: '✅ Your interview has been stopped.',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
