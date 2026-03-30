const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const coffeeService = require('../services/coffee');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coffee-list')
    .setDescription('Debug: Check how many members have the coffee-chat role (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const members = await coffeeService.getMembersWithCoffeeRole(interaction.guild);
      const memberNames = members.map((m) => `${m.user.username}#${m.user.discriminator}`).join('\n');
      const response = `**☕ Coffee Role Member Detection Debug**\n\n**Role Name:** ${process.env.COFFEE_ROLE_NAME || 'coffee chat'}\n**Total Members Found:** ${members.length}\n\n**Member List:**\n${memberNames || '(No members found)'}\n\n`;
      await interaction.editReply({ content: response });
    } catch (err) {
      console.error('coffee-list error:', err?.message || err);
      await interaction.editReply({ content: '❌ Failed to list coffee members.' });
    }
  },
};
