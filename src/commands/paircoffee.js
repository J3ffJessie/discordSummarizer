const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const coffeeService = require('../services/coffee');

module.exports = {
  data: new SlashCommandBuilder().setName('paircoffee').setDescription('Manual coffee pairing (admin only)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).toJSON(),
  async execute(interaction, services) {
    await interaction.reply({ content: '☕ Running coffee pairing... This may take a moment.', ephemeral: true });
    try {
      const config = services?.guildConfigService?.getConfig(interaction.guildId);
      const channelId = config?.coffee_channel_id || null;
      const res = await coffeeService.runCoffeePairing(interaction.guild, process.env.COFFEE_ROLE_NAME, 'manual', channelId);
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
