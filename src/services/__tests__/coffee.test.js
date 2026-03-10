jest.mock('fs');
jest.mock('../../utils/helpers', () => ({
  ensureDataDir: jest.fn(() => '/mock/data'),
  delay: jest.fn(() => Promise.resolve()),
}));

// Build a minimal mock guild member
function makeMember(id, hasRole = true, isBot = false) {
  return {
    id,
    user: { id, bot: isBot, username: `user_${id}`, discriminator: '0000' },
    roles: {
      cache: {
        has: jest.fn(() => hasRole),
      },
    },
    send: jest.fn().mockResolvedValue(undefined),
    _capturedUsername: `user_${id}`,
    _capturedDiscriminator: '0000',
  };
}

// Build a minimal mock guild
function makeGuild({ members = [], roleName = 'coffee chat' } = {}) {
  const roleObj = { id: 'role1', name: roleName, members: { size: members.length } };

  return {
    name: 'TestGuild',
    id: 'guild1',
    roles: {
      cache: {
        find: jest.fn((fn) => (fn(roleObj) ? roleObj : undefined)),
      },
    },
    members: {
      fetch: jest.fn().mockResolvedValue(new Map(members.map((m) => [m.id, m]))),
      cache: {
        size: members.length,
        filter: jest.fn((fn) => {
          const result = members.filter((m) => {
            try { return fn(m); } catch { return false; }
          });
          return { map: (mapFn) => result.map(mapFn) };
        }),
      },
    },
  };
}

describe('coffeeService', () => {
  let fs;
  let coffeeService;

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

    coffeeService = require('../coffee');
  });

  // ─── readCoffeePairs ────────────────────────────────────────────────────────

  describe('readCoffeePairs', () => {
    it('should return empty object when file does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      const result = coffeeService.readCoffeePairs();
      expect(result).toEqual({});
    });

    it('should parse and return coffee pairs from file', () => {
      const data = { user1: { history: [{ partnerId: 'user2', timestamp: 1000 }] } };
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(data));

      const result = coffeeService.readCoffeePairs();
      expect(result.user1.history[0].partnerId).toBe('user2');
    });

    it('should normalize old format (lastPaired + partners) to history', () => {
      const legacyData = {
        user1: { lastPaired: '1000000', partners: ['user2', 'user3'] },
      };
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(legacyData));

      const result = coffeeService.readCoffeePairs();
      expect(Array.isArray(result.user1.history)).toBe(true);
      expect(result.user1.history.some((h) => h.partnerId === 'user2')).toBe(true);
    });

    it('should return empty object on parse error', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json');

      const result = coffeeService.readCoffeePairs();
      expect(result).toEqual({});
    });
  });

  // ─── saveCoffeePairs ────────────────────────────────────────────────────────

  describe('saveCoffeePairs', () => {
    it('should write data to the coffee pairs file', () => {
      const data = { user1: { history: [] } };
      coffeeService.saveCoffeePairs(data);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('coffee_pairs.json'),
        JSON.stringify(data, null, 2)
      );
    });

    it('should not throw on write error', () => {
      fs.writeFileSync.mockImplementation(() => { throw new Error('disk full'); });
      expect(() => coffeeService.saveCoffeePairs({})).not.toThrow();
    });
  });

  // ─── runCoffeePairing ───────────────────────────────────────────────────────

  describe('runCoffeePairing', () => {
    it('should return empty array when fewer than 2 members have the role', async () => {
      const guild = makeGuild({ members: [] });

      const result = await coffeeService.runCoffeePairing(guild);
      expect(result).toEqual([]);
    });

    it('should return empty array when role is not found', async () => {
      const guild = {
        name: 'TestGuild',
        id: 'guild1',
        roles: {
          cache: { find: jest.fn(() => undefined) },
        },
        members: { fetch: jest.fn().mockResolvedValue(new Map()), cache: { size: 0, filter: jest.fn() } },
      };

      const result = await coffeeService.runCoffeePairing(guild);
      expect(result).toEqual([]);
    });

    it('should pair up two eligible members and return results', async () => {
      const m1 = makeMember('user1');
      const m2 = makeMember('user2');
      const guild = makeGuild({ members: [m1, m2] });
      fs.existsSync.mockReturnValue(false);
      fs.readFileSync.mockReturnValue('{}');

      const result = await coffeeService.runCoffeePairing(guild);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].pair).toBeDefined();
    });

    it('should handle errors gracefully and return empty array', async () => {
      const guild = {
        name: 'TestGuild',
        id: 'guild1',
        roles: { cache: { find: jest.fn(() => { throw new Error('guild error'); }) } },
        members: { fetch: jest.fn(), cache: { size: 0, filter: jest.fn() } },
      };

      const result = await coffeeService.runCoffeePairing(guild);
      expect(result).toEqual([]);
    });
  });

  // ─── getMembersWithCoffeeRole ────────────────────────────────────────────────

  describe('getMembersWithCoffeeRole', () => {
    it('should return empty array when role is not found', async () => {
      const guild = {
        name: 'TestGuild',
        roles: { cache: { find: jest.fn(() => undefined) } },
        members: { fetch: jest.fn().mockResolvedValue(new Map()), cache: { size: 0, filter: jest.fn() } },
      };

      const result = await coffeeService.getMembersWithCoffeeRole(guild, 'nonexistent');
      expect(result).toEqual([]);
    });

    it('should deduplicate members by user id', async () => {
      const m1 = makeMember('user1');
      // Simulate a guild with duplicate member entries
      const guild = makeGuild({ members: [m1, m1] });

      const result = await coffeeService.getMembersWithCoffeeRole(guild, 'coffee chat');

      const ids = result.map((m) => m.id);
      const uniqueIds = [...new Set(ids)];
      expect(ids.length).toBe(uniqueIds.length);
    });
  });
});
