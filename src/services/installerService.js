const { AuditLogEvent } = require('discord.js');

/**
 * Look up the user who added this bot to the given guild via the audit log.
 * Returns the user ID string, or null if not found or no permission.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<string|null>}
 */
async function fetchInstallerUserId(guild) {
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 10 });
    const entry = logs.entries.find(e => e.target?.id === guild.client.user.id);
    return entry?.executor?.id || null;
  } catch (e) {
    console.warn(`[installerService] Could not fetch audit log for guild ${guild.id} (${guild.name}):`, e.message);
    return null;
  }
}

/**
 * For all guilds the bot is in, backfill installer_user_id where missing.
 * @param {import('discord.js').Client} client
 * @param {import('./guildConfigService').GuildConfigService} guildConfigService
 */
async function backfillInstallers(client, guildConfigService) {
  for (const [guildId, guild] of client.guilds.cache) {
    const config = guildConfigService.getConfig(guildId);
    if (config?.installer_user_id) continue; // already known

    const userId = await fetchInstallerUserId(guild);
    if (userId) {
      guildConfigService.upsertConfig(guildId, { installer_user_id: userId });
      console.log(`[installerService] Recorded installer ${userId} for guild ${guild.name}`);
    }
  }
}

module.exports = { fetchInstallerUserId, backfillInstallers };
