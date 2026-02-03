const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const reminders = require('../services/reminders');

module.exports = {
  data: new SlashCommandBuilder().setName('listreminders').setDescription("List your reminders").toJSON(),
  async execute(interaction) {
    const userReminders = reminders.listRemindersForUser(interaction.user.id);
    if (!userReminders || userReminders.length === 0) {
      await interaction.reply({ content: "You don't have any pending reminders", ephemeral: true });
      return;
    }
    const embed = new EmbedBuilder().setTitle(`${interaction.user.username}'s Reminders`).setColor('Blue');
    userReminders.forEach((r) => {
      const remaining = Math.max(0, r.time - Date.now());
      const mins = Math.round(remaining / 60000);
      embed.addFields({ name: `ID: ${r.id}`, value: `${r.msg} (in ~${mins} min)` });
    });
    try {
      await interaction.user.send({ embeds: [embed] });
      await interaction.reply({ content: '✅ I sent your reminder list to your DMs.', ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: "❌ Couldn't DM you. Please enable DMs.", ephemeral: true });
    }
  },
};
