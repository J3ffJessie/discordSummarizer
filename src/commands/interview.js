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
const INTERVIEW_CODE_LANGUAGE_SELECT_ID = 'interview_code_language_select';
const INTERVIEW_CONTINUE_BUTTON_ID = 'interview_continue';
const INTERVIEW_MODAL_ID = 'interview_modal';
const INTERVIEW_SUBMIT_CODE_BUTTON_ID = 'interview_submit_code';
const INTERVIEW_CODE_MODAL_ID = 'interview_code_modal';

const CODE_LANGUAGES = {
  javascript: 'JavaScript',
  python: 'Python',
  java: 'Java',
  cpp: 'C++',
};
const DEFAULT_CODE_LANGUAGE = 'javascript';

function buildSetupComponents(style, language = DEFAULT_LANGUAGE, codeLanguage = DEFAULT_CODE_LANGUAGE) {
  const styleRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(INTERVIEW_STYLE_SELECT_ID)
      .setPlaceholder('Interview style (default: Behavioral)')
      .addOptions([
        { label: 'Behavioral', description: 'STAR-method — past situations and actions', value: 'behavioral', default: style === 'behavioral' },
        { label: 'Technical', description: 'Skills and knowledge assessment', value: 'technical', default: style === 'technical' },
        { label: 'Conversational', description: 'Relaxed, culture-fit focused', value: 'conversational', default: style === 'conversational' },
        { label: 'Case-based', description: 'Problem-solving scenarios', value: 'case_based', default: style === 'case_based' },
        { label: 'Technical (Coding)', description: 'LeetCode-style problems with real test execution', value: 'technical_coding', default: style === 'technical_coding' },
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
          default: code === language,
        }))
      )
  );

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(INTERVIEW_CONTINUE_BUTTON_ID)
      .setLabel('Continue →')
      .setStyle(ButtonStyle.Primary)
  );

  const rows = [styleRow, languageRow];

  if (style === 'technical_coding') {
    const codeLanguageRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(INTERVIEW_CODE_LANGUAGE_SELECT_ID)
        .setPlaceholder('Coding language')
        .addOptions(
          Object.entries(CODE_LANGUAGES).map(([value, label]) => ({
            label,
            value,
            default: value === codeLanguage,
          }))
        )
    );
    rows.push(codeLanguageRow);
  }

  rows.push(buttonRow);

  return rows;
}

module.exports = {
  INTERVIEW_STYLE_SELECT_ID,
  INTERVIEW_LANGUAGE_SELECT_ID,
  INTERVIEW_CODE_LANGUAGE_SELECT_ID,
  INTERVIEW_CONTINUE_BUTTON_ID,
  INTERVIEW_MODAL_ID,
  INTERVIEW_SUBMIT_CODE_BUTTON_ID,
  INTERVIEW_CODE_MODAL_ID,
  CODE_LANGUAGES,
  DEFAULT_CODE_LANGUAGE,
  buildSetupComponents,

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

      await interaction.reply({
        content: '**Step 1 of 2** — Choose your interview style and language, then click **Continue** to enter the job details.',
        components: buildSetupComponents('behavioral'),
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
