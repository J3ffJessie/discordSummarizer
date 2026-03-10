jest.mock('fs');
jest.mock('../../utils/helpers', () => ({
  ensureDataDir: jest.fn(() => '/mock/data'),
  delay: jest.fn(() => Promise.resolve()),
}));

describe('MessageStatsService', () => {
  let fs;
  let MessageStatsService;
  let service;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('fs');
    jest.mock('../../utils/helpers', () => ({
      ensureDataDir: jest.fn(() => '/mock/data'),
      delay: jest.fn(() => Promise.resolve()),
    }));

    fs = require('fs');
    fs.existsSync = jest.fn().mockReturnValue(false);
    fs.readFileSync = jest.fn().mockReturnValue('{}');
    fs.writeFileSync = jest.fn();

    ({ MessageStatsService } = require('../messageStatsService'));
    service = new MessageStatsService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('recordMessage', () => {
    it('should ignore DMs (messages without guild)', () => {
      service.recordMessage({ guild: null, channel: { id: 'ch1', name: 'general' }, author: { id: 'u1' } });
      expect(Object.keys(service.getStats('g1').daily)).toHaveLength(0);
    });

    it('should record a message in the daily stats', () => {
      jest.useFakeTimers();
      const today = new Date().toISOString().slice(0, 10);
      service.recordMessage({ guild: { id: 'g1' }, channel: { id: 'ch1', name: 'general' }, author: { id: 'u1' } });
      const stats = service.getStats('g1');
      expect(stats.daily[today].total).toBe(1);
      expect(stats.daily[today].channels['ch1'].count).toBe(1);
      expect(stats.daily[today].users['u1']).toBe(1);
    });

    it('should accumulate multiple messages', () => {
      jest.useFakeTimers();
      const today = new Date().toISOString().slice(0, 10);
      const msg = { guild: { id: 'g1' }, channel: { id: 'ch1', name: 'general' }, author: { id: 'u1' } };
      service.recordMessage(msg);
      service.recordMessage(msg);
      service.recordMessage(msg);
      expect(service.getStats('g1').daily[today].total).toBe(3);
    });

    it('should track multiple channels separately', () => {
      jest.useFakeTimers();
      const today = new Date().toISOString().slice(0, 10);
      service.recordMessage({ guild: { id: 'g1' }, channel: { id: 'ch1', name: 'general' }, author: { id: 'u1' } });
      service.recordMessage({ guild: { id: 'g1' }, channel: { id: 'ch2', name: 'random' }, author: { id: 'u2' } });
      const stats = service.getStats('g1');
      expect(stats.daily[today].total).toBe(2);
      expect(stats.daily[today].channels['ch1'].count).toBe(1);
      expect(stats.daily[today].channels['ch2'].count).toBe(1);
    });

    it('should track messages from different guilds separately', () => {
      jest.useFakeTimers();
      const today = new Date().toISOString().slice(0, 10);
      service.recordMessage({ guild: { id: 'g1' }, channel: { id: 'ch1', name: 'general' }, author: { id: 'u1' } });
      service.recordMessage({ guild: { id: 'g2' }, channel: { id: 'ch1', name: 'general' }, author: { id: 'u1' } });
      expect(service.getStats('g1').daily[today].total).toBe(1);
      expect(service.getStats('g2').daily[today].total).toBe(1);
    });
  });

  describe('recordMemberJoin', () => {
    it('should ignore members without a guild', () => {
      service.recordMemberJoin({ guild: null, user: { id: '123456789012345678' } });
      expect(Object.keys(service.getStats('g1').daily)).toHaveLength(0);
    });

    it('should increment newMembers for today', () => {
      jest.useFakeTimers();
      const today = new Date().toISOString().slice(0, 10);
      service.recordMemberJoin({ guild: { id: 'g1' }, user: { id: '123456789012345678' } });
      expect(service.getStats('g1').daily[today].newMembers).toBe(1);
    });

    it('should increment newMembers on multiple joins', () => {
      jest.useFakeTimers();
      const today = new Date().toISOString().slice(0, 10);
      const member = { guild: { id: 'g1' }, user: { id: '123456789012345678' } };
      service.recordMemberJoin(member);
      service.recordMemberJoin(member);
      expect(service.getStats('g1').daily[today].newMembers).toBe(2);
    });

    it('should classify veteran account age correctly', () => {
      jest.useFakeTimers();
      const today = new Date().toISOString().slice(0, 10);
      const twoYearsAgo = Date.now() - 2 * 365 * 24 * 60 * 60 * 1000;
      const snowflake = String(BigInt(twoYearsAgo - 1420070400000) << 22n);
      service.recordMemberJoin({ guild: { id: 'g1' }, user: { id: snowflake } });
      expect(service.getStats('g1').daily[today].accountAges.veteran).toBe(1);
    });
  });

  describe('recordMemberLeave', () => {
    it('should ignore members without a guild', () => {
      service.recordMemberLeave({ guild: null });
      expect(Object.keys(service.getStats('g1').daily)).toHaveLength(0);
    });

    it('should increment leaves count for today', () => {
      jest.useFakeTimers();
      const today = new Date().toISOString().slice(0, 10);
      service.recordMemberLeave({ guild: { id: 'g1' } });
      expect(service.getStats('g1').daily[today].leaves).toBe(1);
    });

    it('should accumulate multiple leaves', () => {
      jest.useFakeTimers();
      const today = new Date().toISOString().slice(0, 10);
      service.recordMemberLeave({ guild: { id: 'g1' } });
      service.recordMemberLeave({ guild: { id: 'g1' } });
      expect(service.getStats('g1').daily[today].leaves).toBe(2);
    });
  });

  describe('recordVoiceMinutes', () => {
    it('should not record zero or negative minutes', () => {
      service.recordVoiceMinutes('g1', 0);
      service.recordVoiceMinutes('g1', -5);
      expect(Object.keys(service.getStats('g1').daily)).toHaveLength(0);
    });

    it('should accumulate voice minutes for today', () => {
      jest.useFakeTimers();
      const today = new Date().toISOString().slice(0, 10);
      service.recordVoiceMinutes('g1', 10);
      service.recordVoiceMinutes('g1', 25);
      expect(service.getStats('g1').daily[today].voiceMinutes).toBe(35);
    });
  });

  describe('getStats', () => {
    it('should return the internal data object with daily property', () => {
      const stats = service.getStats('g1');
      expect(stats).toBeDefined();
      expect(stats.daily).toBeDefined();
    });

    it('should return lastBackfill as null initially when no file', () => {
      expect(service.getStats('g1').lastBackfill).toBeNull();
    });

    it('should return empty fallback when called with no guildId and no guilds loaded', () => {
      const stats = service.getStats();
      expect(stats.daily).toEqual({});
      expect(stats.lastBackfill).toBeNull();
    });
  });

  describe('_loadGuild (initial state)', () => {
    it('should load data from file if it exists', () => {
      const existingData = { lastBackfill: '2026-01-01', daily: { '2026-01-01': { total: 5 } } };
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(existingData));

      const svc = new MessageStatsService();

      expect(svc.getStats('g1').lastBackfill).toBe('2026-01-01');
      expect(svc.getStats('g1').daily['2026-01-01'].total).toBe(5);
    });

    it('should fall back to empty state on file parse error', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('bad json{{');

      const svc = new MessageStatsService();

      expect(svc.getStats('g1').lastBackfill).toBeNull();
      expect(svc.getStats('g1').daily).toEqual({});
    });
  });
});
