const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { notifyRelease } = require('../services/releaseNotifier');
const { backfillInstallers } = require('../services/installerService');

module.exports = (client) => {
  client.on(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);
    logger.init(client);

    const { guildConfigService } = client.services || {};
    if (guildConfigService) {
      await backfillInstallers(client, guildConfigService).catch(err =>
        console.error('[installerService] Backfill error:', err.message)
      );
    }

    notifyRelease(client, guildConfigService).catch(err =>
      console.error('[releaseNotifier] Error:', err.message)
    );
  });
};
