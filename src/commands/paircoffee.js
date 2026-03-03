const { SlashCommandBuilder } = require('discord.js');
const coffeeService = require('../services/coffee');

module.exports = {
  data: new SlashCommandBuilder().setName('paircoffee').setDescription('Manual coffee pairing (admin only)').toJSON(),
  async execute(interaction, services) {
    const ALLOWED = (process.env.ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ALLOWED.length && !ALLOWED.includes(interaction.user.id)) {
      await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
      return;
    }

    const config = services?.guildConfigService?.getConfig(interaction.guildId);
    const roleIdentifier = config?.coffee_role_name || process.env.COFFEE_ROLE_NAME;
    const cooldownDays = config?.coffee_cooldown_days ?? null;

    await interaction.reply({ content: '☕ Running coffee pairing... This may take a moment.', ephemeral: true });
    try {
      const res = await coffeeService.runCoffeePairing(interaction.guild, roleIdentifier, 'manual', cooldownDays);
      if (!res || res.length === 0) {
        await interaction.followUp({ content: '⚠️ No pairings created — not enough eligible members or member fetch timed out.', ephemeral: true });
      } else {
        await interaction.followUp({ content: `✅ Paired ${res.length} groups for coffee.`, ephemeral: true });
      }
    } catch (e) {
      console.error('paircoffee error:', e?.message || e);
      await interaction.followUp({ content: '❌ Failed to run coffee pairing.', ephemeral: true });
    }
  },
};
