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
  constructor(client, guildConfigService, summarizationService) {
    this.client = client;
    this.guildConfigService = guildConfigService;
    this.summarizationService = summarizationService;
    // Map<guildId, { summaryTask: ScheduledTask|null, coffeeTask: ScheduledTask|null }>
    this.tasks = new Map();
  }

  start() {
    this.client.once('ready', () => {
      this._scheduleAllGuilds();
    });
  }

  _scheduleAllGuilds() {
    const summaryGuilds = this.guildConfigService.getAllWithSummaryEnabled();
    const coffeeGuilds = this.guildConfigService.getAllWithCoffeeEnabled();

    const allGuildIds = new Set([
      ...summaryGuilds.map(g => g.guild_id),
      ...coffeeGuilds.map(g => g.guild_id),
    ]);

    for (const guildId of allGuildIds) {
      const config = this.guildConfigService.getConfig(guildId);
      this._applyConfig(guildId, config);
    }

    console.log(`Scheduler: loaded cron tasks for ${allGuildIds.size} guild(s)`);
  }

  refreshGuild(guildId) {
    this._stopGuild(guildId);
    const config = this.guildConfigService.getConfig(guildId);
    if (config) this._applyConfig(guildId, config);
  }

  _stopGuild(guildId) {
    const existing = this.tasks.get(guildId);
    if (!existing) return;
    if (existing.summaryTask) existing.summaryTask.stop();
    if (existing.coffeeTask) existing.coffeeTask.stop();
    this.tasks.delete(guildId);
  }

  _applyConfig(guildId, config) {
    const entry = { summaryTask: null, coffeeTask: null };

    if (config.summary_enabled && config.summary_channel_id) {
      entry.summaryTask = this._scheduleSummary(guildId, config);
    }

    if (config.coffee_enabled && config.coffee_cron) {
      entry.coffeeTask = this._scheduleCoffee(guildId, config);
    }

    this.tasks.set(guildId, entry);
  }

  _scheduleSummary(guildId, config) {
    const cronExpr = config.summary_cron || '0 10 * * 1';
    const timezone = config.timezone || 'UTC';

    const task = cron.schedule(cronExpr, async () => {
      try {
        logger.notifyAdmin(
          `Cron job: Server summary started for guild ${guildId} at ${new Date().toISOString()}`
        ).catch(() => {});

        await this._runSummaryForGuild(guildId, config);

        logger.notifyAdmin(
          `Cron job: Server summary completed for guild ${guildId} at ${new Date().toISOString()}`
        ).catch(() => {});
      } catch (err) {
        logger.logError(err, `Scheduled server summary failed for guild ${guildId}`).catch(() => {});
      }
    }, { timezone });

    console.log(`Scheduler: summary cron for guild ${guildId}: ${cronExpr} (${timezone})`);
    return task;
  }

  _scheduleCoffee(guildId, config) {
    const cronExpr = config.coffee_cron;
    const timezone = config.timezone || 'UTC';
    const biweekly = config.coffee_biweekly === 1;

    const task = cron.schedule(cronExpr, async () => {
      try {
        if (biweekly && getISOWeek(new Date()) % 2 !== 0) return;
        await this._runCoffeeForGuild(guildId, config);
      } catch (err) {
        logger.logError(err, `Coffee pairing cron failed for guild ${guildId}`).catch(() => {});
      }
    }, { timezone });

    console.log(`Scheduler: coffee cron for guild ${guildId}: ${cronExpr} (${timezone})`);
    return task;
  }

  async _runSummaryForGuild(guildId, config) {
    let guild = this.client.guilds.cache.get(guildId);
    if (!guild) guild = await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    const summary = await gather.gatherServerConversationsAndSummarize(guild, true, {
      summarizationService: this.summarizationService,
      guildId,
    });
    const chunks = summary.match(/[\s\S]{1,1900}/g) || ['No summary available.'];

    let channel = guild.channels.cache.get(config.summary_channel_id);
    if (!channel) {
      channel = await this.client.channels.fetch(config.summary_channel_id).catch(() => null);
    }
    if (!channel) return;

    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  }

  async _runCoffeeForGuild(guildId, config) {
    let guild = this.client.guilds.cache.get(guildId);
    if (!guild) guild = await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    const result = await coffeeService.runCoffeePairing(
      guild,
      config.coffee_role_name || process.env.COFFEE_ROLE_NAME || 'coffee chat'
    );

    logger.notifyAdmin(
      `Cron job: Coffee pairing for guild ${guildId} completed with ${result.length} pairs`
    ).catch(() => {});
  }
}

module.exports = { SchedulerService };
