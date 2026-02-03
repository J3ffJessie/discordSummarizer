const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = (client) => {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, client);
    } catch (err) {
      console.error(`Error executing command ${interaction.commandName}:`, err?.message || err);
      logger.logError(err, `Command ${interaction.commandName} failed`).catch(() => {});
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: '❌ An error occurred while processing your command.' });
        } else {
          await interaction.reply({ content: '❌ An error occurred while processing your command.', ephemeral: true });
        }
      } catch (e) {}
    }
  });
};
