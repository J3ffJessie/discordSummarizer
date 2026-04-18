const { Events } = require('discord.js');
const { fetchInstallerUserId } = require('../services/installerService');

module.exports = (client) => {
  client.on(Events.GuildCreate, async (guild) => {
    console.log(`[guildCreate] Bot added to guild: ${guild.name} (${guild.id})`);

    const { guildConfigService } = client.services || {};
    if (!guildConfigService) return;

    // Small delay — audit log entry may not be immediately available
    await new Promise(r => setTimeout(r, 2000));

    const userId = await fetchInstallerUserId(guild);
    if (userId) {
      guildConfigService.upsertConfig(guild.id, { installer_user_id: userId });
      console.log(`[guildCreate] Recorded installer ${userId} for guild ${guild.name}`);
    }
  });
};
