const { Events } = require('discord.js');

module.exports = (client) => {
  client.on(Events.InteractionCreate, async (interaction) => {
    // Button interactions
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('giveaway_enter_')) {
        const { giveawayService } = client.services;
        const guildId = interaction.guildId;
        const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
        const result = giveawayService.addParticipant(guildId, interaction.user.id, interaction.user.username, displayName);
        if (result === 'ok') {
          await interaction.reply({ content: `✅ You're in, **${displayName}**! Good luck! 🎉`, ephemeral: true });
        } else if (result === 'already_entered') {
          await interaction.reply({ content: '❌ You\'ve already entered this giveaway!', ephemeral: true });
        } else {
          await interaction.reply({ content: '❌ This giveaway is no longer active.', ephemeral: true });
        }
        return;
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, client.services);
    } catch (err) {
      console.error(err);

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: '❌ Error processing command.' });
        } else {
          await interaction.reply({ content: '❌ Error processing command.', ephemeral: true });
        }
      } catch (replyErr) {
        console.error('Failed to send error reply to interaction:', replyErr.message);
      }
    }
  });
};
