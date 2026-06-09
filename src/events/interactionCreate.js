const { Events } = require('discord.js');
const { MODAL_ID: PROFILE_MODAL_ID } = require('../commands/profile');

module.exports = (client) => {
  client.on(Events.InteractionCreate, async (interaction) => {
    // Modal submissions
    if (interaction.isModalSubmit()) {
      if (interaction.customId === PROFILE_MODAL_ID) {
        const { profileService, guildConfigService } = client.services;
        const str = (field) => interaction.fields.getTextInputValue(field).trim() || null;
        const networkingRaw = interaction.fields.getTextInputValue('networking').trim().toLowerCase();
        const networking = networkingRaw === 'yes' ? 1 : 0;

        profileService.upsertProfile(interaction.guildId, interaction.user.id, {
          bio:      str('bio'),
          title:    str('title'),
          skills:   str('skills'),
          timezone: str('timezone'),
          networking,
        });

        // Sync coffee role with networking preference
        try {
          const config = guildConfigService?.getConfig(interaction.guildId);
          const roleName = config?.coffee_role_name || process.env.COFFEE_ROLE_NAME || 'coffee chat';
          const role = interaction.guild.roles.cache.find(r => r.name === roleName || r.id === roleName);
          if (role) {
            const member = interaction.member;
            if (networking && !member.roles.cache.has(role.id)) {
              await member.roles.add(role);
            } else if (!networking && member.roles.cache.has(role.id)) {
              await member.roles.remove(role);
            }
          }
        } catch (err) {
          console.warn('[profile] Could not sync coffee role:', err.message);
        }

        await interaction.reply({ content: '✅ Your profile has been updated!', ephemeral: true });
      }
      return;
    }

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
