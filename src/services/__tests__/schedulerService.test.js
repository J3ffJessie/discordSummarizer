jest.mock('node-cron', () => ({
  schedule: jest.fn().mockReturnValue({ stop: jest.fn() }),
  validate: jest.fn().mockReturnValue(true),
}));
jest.mock('../gather', () => ({
  gatherServerConversationsAndSummarize: jest.fn().mockResolvedValue('Summary text'),
}));
jest.mock('../coffee', () => ({
  runCoffeePairing: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../utils/logger', () => ({
  notifyAdmin: jest.fn().mockResolvedValue(undefined),
  logError: jest.fn().mockResolvedValue(undefined),
}));

const { SchedulerService } = require('../schedulerService');
const cron = require('node-cron');

function makeGuildConfigService(summaryGuilds = [], coffeeGuilds = [], configs = {}) {
  return {
    getAllWithSummaryEnabled: jest.fn().mockReturnValue(summaryGuilds),
    getAllWithCoffeeEnabled: jest.fn().mockReturnValue(coffeeGuilds),
    getConfig: jest.fn((id) => configs[id] || null),
  };
}

function makeClient(guilds = {}) {
  const cache = new Map(Object.entries(guilds));
  return {
    once: jest.fn((event, cb) => { if (event === 'ready') cb(); }),
    guilds: { cache, fetch: jest.fn().mockResolvedValue(null) },
    channels: { fetch: jest.fn().mockResolvedValue({ send: jest.fn() }) },
  };
}

describe('SchedulerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('start', () => {
    it('should schedule cron tasks for guilds with summary enabled', () => {
      const gcs = makeGuildConfigService(
        [{ guild_id: 'g1' }],
        [],
        { g1: { summary_enabled: 1, summary_channel_id: 'ch1', summary_cron: '0 10 * * 1', timezone: 'UTC' } }
      );
      const client = makeClient();
      const scheduler = new SchedulerService(client, gcs, {});
      scheduler.start();
      expect(cron.schedule).toHaveBeenCalled();
    });

    it('should schedule cron tasks for guilds with coffee enabled', () => {
      const gcs = makeGuildConfigService(
        [],
        [{ guild_id: 'g1' }],
        { g1: { coffee_enabled: 1, coffee_cron: '0 10 * * 5', timezone: 'UTC' } }
      );
      const client = makeClient();
      const scheduler = new SchedulerService(client, gcs, {});
      scheduler.start();
      expect(cron.schedule).toHaveBeenCalled();
    });

    it('should not schedule when no guilds have tasks enabled', () => {
      const gcs = makeGuildConfigService([], [], {});
      const client = makeClient();
      const scheduler = new SchedulerService(client, gcs, {});
      scheduler.start();
      expect(cron.schedule).not.toHaveBeenCalled();
    });
  });

  describe('refreshGuild', () => {
    it('should stop existing tasks and re-apply config', () => {
      const mockStop = jest.fn();
      cron.schedule.mockReturnValueOnce({ stop: mockStop });

      const gcs = makeGuildConfigService(
        [{ guild_id: 'g1' }],
        [],
        { g1: { summary_enabled: 1, summary_channel_id: 'ch1', summary_cron: '0 10 * * 1', timezone: 'UTC' } }
      );
      const client = makeClient();
      const scheduler = new SchedulerService(client, gcs, {});
      scheduler.start();

      // Now refresh - should stop old task and create new one
      cron.schedule.mockReturnValueOnce({ stop: jest.fn() });
      scheduler.refreshGuild('g1');

      expect(mockStop).toHaveBeenCalled();
    });

    it('should handle refreshGuild for guild with no config', () => {
      const gcs = makeGuildConfigService([], [], {});
      const client = makeClient();
      const scheduler = new SchedulerService(client, gcs, {});
      expect(() => scheduler.refreshGuild('unknown')).not.toThrow();
    });
  });
});
