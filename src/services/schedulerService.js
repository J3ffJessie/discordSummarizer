const cron = require('node-cron');
const gather = require('./gather');
const coffeeService = require('./coffee');
const logger = require('../utils/logger');

class SchedulerService {
  constructor(client) {
    this.client = client;
  }

  start() {
    this.client.once('ready', () => {
      this.registerServerSummary();
      this.registerCoffeePairing();
    });
  }

  registerServerSummary() {
    const cronExpr = process.env.SERVER_SUMMARY_CRON || '0 10 * * 1';

    cron.schedule(cronExpr, async () => {
      try {
        logger.notifyAdmin(
          `Cron job: Server summary started at ${new Date().toISOString()}`
        ).catch(() => {});

        const guildId = process.env.GUILD_ID;
        if (!guildId) return;

        let guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
          guild = await this.client.guilds.fetch(guildId).catch(() => null);
        }
        if (!guild) return;

        const summary =
          await gather.gatherServerConversationsAndSummarize(guild, true);

        const chunks =
          summary.match(/[\s\S]{1,1900}/g) || ['No summary available.'];

        const channelId = process.env.TARGET_CHANNEL_ID;
        let channel = guild.channels.cache.get(channelId);
        if (!channel) {
          channel = await this.client.channels.fetch(channelId).catch(() => null);
        }
        if (!channel) return;

        for (const chunk of chunks) {
          await channel.send(chunk);
        }

        logger.notifyAdmin(
          `Cron job: Server summary completed at ${new Date().toISOString()}`
        ).catch(() => {});
      } catch (err) {
        logger.logError(err, 'Scheduled server summary failed').catch(() => {});
      }
    });

    console.log(`Scheduled server summary cron: ${cronExpr}`);
  }

  registerCoffeePairing() {
    const coffeeCron =
      process.env.COFFEE_CRON_SCHEDULE || process.env.COFFEE_CRON;

    if (!coffeeCron) return;

    cron.schedule(coffeeCron, async () => {
      try {
        const guildId = process.env.GUILD_ID;
        if (!guildId) return;

        let guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
          guild = await this.client.guilds.fetch(guildId).catch(() => null);
        }
        if (!guild) return;

        const result = await coffeeService.runCoffeePairing(guild);

        logger.notifyAdmin(
          `Cron job: Coffee pairing completed with ${result.length} pairs`
        ).catch(() => {});
      } catch (err) {
        logger.logError(err, 'Coffee pairing cron failed').catch(() => {});
      }
    });

    console.log(`Scheduled coffee pairing cron: ${coffeeCron}`);
  }
}

module.exports = { SchedulerService };
