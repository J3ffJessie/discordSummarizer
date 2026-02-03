const { SlashCommandBuilder } = require('discord.js');
const reminders = require('../services/reminders');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelreminder')
    .setDescription('Cancel a reminder by ID or use `all` to cancel all your reminders')
    .addStringOption((opt) => opt.setName('id').setDescription('Reminder ID or "all"').setRequired(true))
    .toJSON(),
  async execute(interaction) {
    const arg = interaction.options.getString('id').toLowerCase();
    if (arg === 'all') {
      const count = reminders.cancelAllForUser(interaction.user.id);
      await interaction.reply({ content: `✅ Canceled ${count} reminders.`, ephemeral: true });
      return;
    }
    const success = reminders.cancelReminderById(interaction.user.id, arg);
    if (!success) {
      await interaction.reply({ content: '❌ No reminder found with ID `' + arg + '`.', ephemeral: true });
    } else {
      await interaction.reply({ content: '✅ Reminder with ID `' + arg + '` has been canceled.', ephemeral: true });
    }
  },
};
