const cron = require('node-cron');
const gather = require('./gather');
const coffeeService = require('./coffee');
const logger = require('../utils/logger');

let _client = null;

function init(client) {
  _client = client;
}

function startScheduledJobs() {
  // Server summary cron
  try {
    const cronExpr = process.env.SERVER_SUMMARY_CRON || '0 10 * * 1';
    cron.schedule(cronExpr, async () => {
      try {
        logger.notifyAdmin(`Cron job: Server summary started at ${new Date().toISOString()}`).catch(() => {});
        const serverGuildId = process.env.GUILD_ID;
        if (!serverGuildId) return;
        let guild = _client.guilds.cache.get(serverGuildId);
        if (!guild) guild = await _client.guilds.fetch(serverGuildId).catch(() => null);
        if (!guild) return logger.logError(new Error('Guild not found for scheduled server summary'));
        const summary = await gather.gatherServerConversationsAndSummarize(guild, true);
        const chunks = summary.match(/[\s\S]{1,1900}/g) || ['No summary available.'];
        const targetChannelId = process.env.TARGET_CHANNEL_ID;
        let channel = guild.channels.cache.get(targetChannelId);
        if (!channel) channel = await _client.channels.fetch(targetChannelId).catch(() => null);
        if (!channel) return;
        for (const chunk of chunks) { await channel.send(chunk); }
        logger.notifyAdmin(`Cron job: Server summary completed at ${new Date().toISOString()}`).catch(() => {});
      } catch (err) {
        logger.logError(err, 'Error running scheduled server summary').catch(() => {});
      }
    });
    console.log(`Scheduled server summary cron: ${process.env.SERVER_SUMMARY_CRON || '0 10 * * 1'}`);
  } catch (e) {
    logger.logError(e, 'Error scheduling server summary').catch(() => {});
  }

  // Coffee pairing cron (optional)
  try {
    const coffeeCron = process.env.COFFEE_CRON_SCHEDULE || process.env.COFFEE_CRON || null;
    if (coffeeCron) {
      cron.schedule(coffeeCron, async () => {
        try {
          const coffeeGuildId = process.env.GUILD_ID;
          if (!coffeeGuildId) return;
          let guild = _client.guilds.cache.get(coffeeGuildId);
          if (!guild) guild = await _client.guilds.fetch(coffeeGuildId).catch(() => null);
          if (!guild) return;
          const result = await coffeeService.runCoffeePairing(guild);
          logger.notifyAdmin(`Cron job: Coffee pairing completed with ${result.length} pairs at ${new Date().toISOString()}`).catch(() => {});
        } catch (err) {
          logger.logError(err, 'Error running coffee pairing cron job').catch(() => {});
        }
      });
      console.log(`Scheduled coffee pairing cron: ${coffeeCron}`);
    }
  } catch (e) {
    logger.logError(e, 'Error scheduling coffee pairing').catch(() => {});
  }
}

module.exports = { init, startScheduledJobs };
