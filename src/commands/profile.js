const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const { buildProfileEmbed } = require('../services/profileService');

const MODAL_ID = 'profile_edit_modal';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View or edit your member profile')
    .addSubcommand(sub =>
      sub.setName('edit').setDescription('Edit your profile')
    )
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription("View a member's profile")
        .addUserOption(opt =>
          opt.setName('user')
            .setDescription('Member to view')
            .setRequired(true)
        )
    )
    .toJSON(),

  async execute(interaction, services) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'edit') {
      const existing = services.profileService?.getProfile(interaction.guildId, interaction.user.id);

      const modal = new ModalBuilder()
        .setCustomId(MODAL_ID)
        .setTitle('Edit Your Profile');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('bio')
            .setLabel('About me')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(400)
            .setRequired(false)
            .setValue(existing?.bio || '')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('title')
            .setLabel('Current role / title')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(false)
            .setValue(existing?.title || '')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('skills')
            .setLabel('Skills & interests (comma separated)')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(200)
            .setRequired(false)
            .setValue(existing?.skills || '')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('timezone')
            .setLabel('Timezone (e.g. CST, EST, UTC+2)')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(50)
            .setRequired(false)
            .setValue(existing?.timezone || '')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('networking')
            .setLabel('Open to networking? (yes / no)')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(3)
            .setRequired(false)
            .setPlaceholder('yes = opts you in to bi-weekly coffee chat pairings')
            .setValue(existing?.networking ? 'yes' : 'no')
        ),
      );

      await interaction.showModal(modal);
      return;
    }

    if (sub === 'view') {
      const targetUser = interaction.options.getUser('user');
      const [member, fullUser] = await Promise.all([
        interaction.guild.members.fetch(targetUser.id).catch(() => null),
        targetUser.fetch().catch(() => targetUser),
      ]);
      const profile = services.profileService?.getProfile(interaction.guildId, targetUser.id);

      const embed = buildProfileEmbed(fullUser, member, profile);

      try {
        await interaction.user.send({ embeds: [embed] });
        await interaction.reply({ content: 'Profile sent to your DMs!', ephemeral: true });
      } catch {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  },

  MODAL_ID,
};
