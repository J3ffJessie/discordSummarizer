const { SlashCommandBuilder } = require('discord.js');
const coffeeService = require('../services/coffee');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coffee-pair')
    .setDescription('Randomly pair users that have the coffee-chat role and send them a DM to meet')
    .toJSON(),
  async execute(interaction) {
    // permission check: simple allowed users list
    const ALLOWED = (process.env.ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ALLOWED.length && !ALLOWED.includes(interaction.user.id)) {
      await interaction.reply({ content: "❌ You don't have permission to run this command.", ephemeral: true });
      return;
    }

    await interaction.reply({ content: '☕ Running coffee pairing...', ephemeral: true });
    try {
      const res = await coffeeService.runCoffeePairing(interaction.guild);
      if (!res || res.length === 0) {
        await interaction.followUp({ content: '⚠️ No pairings created.', ephemeral: true });
      } else {
        await interaction.followUp({ content: `✅ Paired ${res.length} groups for coffee.`, ephemeral: true });
      }
    } catch (err) {
      console.error('coffee-pair command error:', err?.message || err);
      await interaction.followUp({ content: '❌ Failed to run coffee pairing.', ephemeral: true });
    }
  },
};
