const { AuditLogEvent } = require('discord.js');
const { fetchInstallerUserId, backfillInstallers } = require('../installerService');

jest.mock('discord.js', () => ({ AuditLogEvent: { BotAdd: 'BOT_ADD' } }));

function makeGuild(entries = [], clientUserId = 'bot1') {
  return {
    id: 'g1',
    name: 'Test Guild',
    client: { user: { id: clientUserId } },
    fetchAuditLogs: jest.fn().mockResolvedValue({
      entries: { find: (fn) => entries.find(fn) },
    }),
  };
}

describe('installerService', () => {
  describe('fetchInstallerUserId', () => {
    it('should return the executor id from audit log', async () => {
      const guild = makeGuild([
        { target: { id: 'bot1' }, executor: { id: 'installer1' } },
      ]);
      const result = await fetchInstallerUserId(guild);
      expect(result).toBe('installer1');
    });

    it('should return null when bot is not in audit log entries', async () => {
      const guild = makeGuild([
        { target: { id: 'other-bot' }, executor: { id: 'someone' } },
      ]);
      const result = await fetchInstallerUserId(guild);
      expect(result).toBeNull();
    });

    it('should return null when audit log fetch fails', async () => {
      const guild = {
        id: 'g1',
        name: 'Test',
        client: { user: { id: 'bot1' } },
        fetchAuditLogs: jest.fn().mockRejectedValue(new Error('Missing Access')),
      };
      const result = await fetchInstallerUserId(guild);
      expect(result).toBeNull();
    });

    it('should return null when entry has no executor', async () => {
      const guild = makeGuild([
        { target: { id: 'bot1' }, executor: null },
      ]);
      const result = await fetchInstallerUserId(guild);
      expect(result).toBeNull();
    });
  });

  describe('backfillInstallers', () => {
    it('should backfill installer for guilds missing installer_user_id', async () => {
      const guild = makeGuild([
        { target: { id: 'bot1' }, executor: { id: 'installer1' } },
      ]);
      const client = {
        guilds: { cache: new Map([['g1', guild]]) },
        user: { id: 'bot1' },
      };
      const guildConfigService = {
        getConfig: jest.fn().mockReturnValue(null),
        upsertConfig: jest.fn(),
      };

      await backfillInstallers(client, guildConfigService);
      expect(guildConfigService.upsertConfig).toHaveBeenCalledWith('g1', { installer_user_id: 'installer1' });
    });

    it('should skip guilds that already have installer_user_id', async () => {
      const guild = makeGuild([]);
      const client = {
        guilds: { cache: new Map([['g1', guild]]) },
      };
      const guildConfigService = {
        getConfig: jest.fn().mockReturnValue({ installer_user_id: 'already-set' }),
        upsertConfig: jest.fn(),
      };

      await backfillInstallers(client, guildConfigService);
      expect(guildConfigService.upsertConfig).not.toHaveBeenCalled();
    });

    it('should not call upsertConfig when installer not found', async () => {
      const guild = makeGuild([]);
      const client = {
        guilds: { cache: new Map([['g1', guild]]) },
        user: { id: 'bot1' },
      };
      const guildConfigService = {
        getConfig: jest.fn().mockReturnValue(null),
        upsertConfig: jest.fn(),
      };

      await backfillInstallers(client, guildConfigService);
      expect(guildConfigService.upsertConfig).not.toHaveBeenCalled();
    });
  });
});
