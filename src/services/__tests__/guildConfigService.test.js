jest.mock('../../utils/helpers', () => ({ ensureDataDir: jest.fn(() => '/mock') }));
jest.mock('better-sqlite3', () => {
  const RealDB = jest.requireActual('better-sqlite3');
  return jest.fn(() => new RealDB(':memory:'));
});

const { GuildConfigService } = require('../guildConfigService');

describe('GuildConfigService', () => {
  let service;

  beforeEach(() => {
    service = new GuildConfigService();
  });

  afterEach(() => {
    service.db.close();
  });

  describe('getConfig', () => {
    it('should return null for unknown guild', () => {
      expect(service.getConfig('g1')).toBeNull();
    });
  });

  describe('upsertConfig', () => {
    it('should insert a new config row', () => {
      const config = service.upsertConfig('g1', { summary_enabled: 1, summary_channel_id: 'ch1' });
      expect(config.guild_id).toBe('g1');
      expect(config.summary_enabled).toBe(1);
      expect(config.summary_channel_id).toBe('ch1');
    });

    it('should update an existing config row', () => {
      service.upsertConfig('g1', { summary_enabled: 0 });
      const updated = service.upsertConfig('g1', { summary_enabled: 1 });
      expect(updated.summary_enabled).toBe(1);
    });

    it('should not overwrite other fields on partial update', () => {
      service.upsertConfig('g1', { summary_channel_id: 'ch1', coffee_enabled: 1 });
      const updated = service.upsertConfig('g1', { summary_channel_id: 'ch2' });
      expect(updated.coffee_enabled).toBe(1);
    });
  });

  describe('getAllWithSummaryEnabled', () => {
    it('should return only guilds with summary_enabled = 1', () => {
      service.upsertConfig('g1', { summary_enabled: 1 });
      service.upsertConfig('g2', { summary_enabled: 0 });
      service.upsertConfig('g3', { summary_enabled: 1 });
      const results = service.getAllWithSummaryEnabled();
      expect(results.map(r => r.guild_id)).toEqual(expect.arrayContaining(['g1', 'g3']));
      expect(results.map(r => r.guild_id)).not.toContain('g2');
    });
  });

  describe('getAllWithCoffeeEnabled', () => {
    it('should return only guilds with coffee_enabled = 1', () => {
      service.upsertConfig('g1', { coffee_enabled: 1 });
      service.upsertConfig('g2', { coffee_enabled: 0 });
      const results = service.getAllWithCoffeeEnabled();
      expect(results.map(r => r.guild_id)).toContain('g1');
      expect(results.map(r => r.guild_id)).not.toContain('g2');
    });
  });

  describe('admin management', () => {
    it('should return empty array for getAdminIds when no admins set', () => {
      service.upsertConfig('g1', {});
      expect(service.getAdminIds('g1')).toEqual([]);
    });

    it('should add an admin', () => {
      service.upsertConfig('g1', {});
      const ids = service.addAdmin('g1', 'u1');
      expect(ids).toContain('u1');
      expect(service.isAdmin('g1', 'u1')).toBe(true);
    });

    it('should not duplicate admin on repeated add', () => {
      service.upsertConfig('g1', {});
      service.addAdmin('g1', 'u1');
      const ids = service.addAdmin('g1', 'u1');
      expect(ids.filter(id => id === 'u1')).toHaveLength(1);
    });

    it('should remove an admin', () => {
      service.upsertConfig('g1', {});
      service.addAdmin('g1', 'u1');
      service.addAdmin('g1', 'u2');
      const ids = service.removeAdmin('g1', 'u1');
      expect(ids).not.toContain('u1');
      expect(ids).toContain('u2');
    });

    it('isAdmin should return false for unknown user', () => {
      service.upsertConfig('g1', {});
      expect(service.isAdmin('g1', 'unknown')).toBe(false);
    });
  });

  describe('dashboard token', () => {
    it('should generate and validate a dashboard token', () => {
      service.upsertConfig('g1', {});
      const token = service.generateDashboardToken('g1');
      expect(token).toBeTruthy();
      expect(service.validateDashboardToken('g1', token)).toBe(true);
    });

    it('should reject wrong token', () => {
      service.upsertConfig('g1', {});
      service.generateDashboardToken('g1');
      expect(service.validateDashboardToken('g1', 'bad-token')).toBe(false);
    });

    it('should return false for null token', () => {
      service.upsertConfig('g1', {});
      expect(service.validateDashboardToken('g1', null)).toBe(false);
    });
  });

  describe('getAllInstallerUserIds', () => {
    it('should return unique installer user ids', () => {
      // Two-step: INSERT then UPDATE so installer_user_id goes through the UPDATE path
      service.upsertConfig('g1', {});
      service.upsertConfig('g1', { installer_user_id: 'u1' });
      service.upsertConfig('g2', {});
      service.upsertConfig('g2', { installer_user_id: 'u2' });
      service.upsertConfig('g3', {});
      service.upsertConfig('g3', { installer_user_id: 'u1' });
      const ids = service.getAllInstallerUserIds();
      expect(ids).toContain('u1');
      expect(ids).toContain('u2');
    });
  });
});
