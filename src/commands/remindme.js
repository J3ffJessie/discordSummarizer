const { SlashCommandBuilder } = require('discord.js');
const reminders = require('../services/reminders');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remindme')
    .setDescription('Set a reminder: /remindme <time> <message>')
    .addStringOption((opt) => opt.setName('time').setDescription('Time (e.g. 2 days)').setRequired(true))
    .addStringOption((opt) => opt.setName('message').setDescription('Reminder message').setRequired(true))
    .toJSON(),
  async execute(interaction) {
    const timeStr = interaction.options.getString('time');
    const reminderMsg = interaction.options.getString('message');
    const duration = reminders.parseTime(timeStr);
    if (!duration) {
      await interaction.reply({ content: 'Invalid time format.', ephemeral: true });
      return;
    }
    const reminder = { id: Date.now().toString(), userId: interaction.user.id, msg: reminderMsg, time: Date.now() + duration };
    try {
      const res = await reminders.addReminderSafely(reminder);
      if (!res.created && res.existing) {
        await interaction.reply({ content: `⚠️ A similar reminder already exists (ID: ${res.existing.id}).`, ephemeral: true });
        return;
      }
      await interaction.reply({ content: `⏰ Reminder set! I'll remind you in ${timeStr}. (ID: ${reminder.id})`, ephemeral: true });
    } catch (err) {
      console.error('remindme error:', err?.message || err);
      await interaction.reply({ content: '❌ Failed to schedule reminder.', ephemeral: true });
    }
  },
};
