const cron = require('node-cron');
const gather = require('./gather');
const coffeeService = require('./coffee');
const logger = require('../utils/logger');

// Returns the ISO week number (1-53) for a given date.
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

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
    const timezone = process.env.CRON_TIMEZONE || 'UTC';

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
    }, { timezone });

    console.log(`Scheduled server summary cron: ${cronExpr} (timezone: ${timezone})`);
  }

  registerCoffeePairing() {
    const coffeeCron =
      process.env.COFFEE_CRON_SCHEDULE || process.env.COFFEE_CRON;
    const timezone = process.env.CRON_TIMEZONE || 'UTC';

    if (!coffeeCron) return;

    const biweekly = process.env.COFFEE_BIWEEKLY === 'true';

    cron.schedule(coffeeCron, async () => {
      try {
        // Skip every other Monday when biweekly mode is on.
        // Runs on even ISO weeks (2, 4, 6 …). To shift the cycle by one week,
        // change !== 0 to === 0.
        if (biweekly && getISOWeek(new Date()) % 2 !== 0) return;

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
    }, { timezone });

    console.log(`Scheduled coffee pairing cron: ${coffeeCron} (timezone: ${timezone})`);
  }
}

module.exports = { SchedulerService };
