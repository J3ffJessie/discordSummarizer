const { Events } = require('discord.js');

module.exports = (client) => {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, client.services);
    } catch (err) {
      console.error(err);

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: '❌ Error processing command.' });
      } else {
        await interaction.reply({ content: '❌ Error processing command.', ephemeral: true });
      }
    }
  });
};
