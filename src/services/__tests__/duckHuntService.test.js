jest.mock('axios');
jest.mock('../../utils/helpers', () => ({ ensureDataDir: jest.fn(() => '/mock') }));
jest.mock('better-sqlite3', () => {
  const RealDB = jest.requireActual('better-sqlite3');
  return jest.fn(() => new RealDB(':memory:'));
});

const axios = require('axios');
const { DuckHuntService } = require('../duckHuntService');

describe('DuckHuntService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DuckHuntService();
  });

  afterEach(() => {
    service.db.close();
  });

  describe('isValidResult', () => {
    it('should accept a normal game', () => {
      expect(service.isValidResult({ score: 12500, ducks: 14, round: 3 })).toBe(true);
    });

    it.each([
      [{ score: -1, ducks: 0, round: 1 }],
      [{ score: 1000000, ducks: 0, round: 1 }],
      [{ score: 500, ducks: 1, round: 0 }],
      [{ score: 500.5, ducks: 1, round: 1 }],
      [{ score: '500', ducks: 1, round: 1 }],
      [{ score: 500, ducks: undefined, round: 1 }],
    ])('should reject %j', (result) => {
      expect(service.isValidResult(result)).toBe(false);
    });
  });

  describe('recordGame', () => {
    it('should create a player on their first game', () => {
      const { player, isPersonalBest } = service.recordGame('g1', 'u1', 'Jeff', { score: 3000, ducks: 5, round: 1 });
      expect(isPersonalBest).toBe(true);
      expect(player).toMatchObject({ username: 'Jeff', best_score: 3000, best_round: 1, total_ducks: 5, games_played: 1 });
    });

    it('should keep the best score and accumulate totals', () => {
      service.recordGame('g1', 'u1', 'Jeff', { score: 9000, ducks: 12, round: 2 });
      const { player, isPersonalBest } = service.recordGame('g1', 'u1', 'Jeff2', { score: 4000, ducks: 6, round: 1 });
      expect(isPersonalBest).toBe(false);
      expect(player).toMatchObject({ username: 'Jeff2', best_score: 9000, best_round: 2, total_ducks: 18, games_played: 2 });
    });

    it('should report a new personal best', () => {
      service.recordGame('g1', 'u1', 'Jeff', { score: 4000, ducks: 6, round: 1 });
      const { player, isPersonalBest } = service.recordGame('g1', 'u1', 'Jeff', { score: 9000, ducks: 12, round: 2 });
      expect(isPersonalBest).toBe(true);
      expect(player.best_score).toBe(9000);
    });

    it('should track the same user separately per guild', () => {
      service.recordGame('g1', 'u1', 'Jeff', { score: 4000, ducks: 6, round: 1 });
      service.recordGame('g2', 'u1', 'Jeff', { score: 100, ducks: 1, round: 1 });
      expect(service.getPlayer('g1', 'u1').best_score).toBe(4000);
      expect(service.getPlayer('g2', 'u1').best_score).toBe(100);
    });
  });

  describe('getLeaderboard', () => {
    it('should return an empty list for a guild with no games', () => {
      expect(service.getLeaderboard('g1')).toEqual([]);
    });

    it('should order by best score and respect the limit', () => {
      service.recordGame('g1', 'a', 'A', { score: 1000, ducks: 2, round: 1 });
      service.recordGame('g1', 'b', 'B', { score: 5000, ducks: 8, round: 2 });
      service.recordGame('g1', 'c', 'C', { score: 3000, ducks: 5, round: 1 });
      service.recordGame('g2', 'd', 'D', { score: 9000, ducks: 9, round: 3 });

      const board = service.getLeaderboard('g1', 2);
      expect(board.map(r => r.user_id)).toEqual(['b', 'c']);
    });
  });

  describe('exchangeCode', () => {
    const env = process.env;

    beforeEach(() => {
      process.env = { ...env, CLIENT_ID: 'client-id', DISCORD_CLIENT_SECRET: 'client-secret' };
    });

    afterEach(() => {
      process.env = env;
    });

    it('should exchange the code for an access token', async () => {
      axios.post.mockResolvedValue({ data: { access_token: 'tok' } });
      await expect(service.exchangeCode('abc')).resolves.toBe('tok');

      const [url, body] = axios.post.mock.calls[0];
      expect(url).toBe('https://discord.com/api/v10/oauth2/token');
      const params = new URLSearchParams(body);
      expect(params.get('client_id')).toBe('client-id');
      expect(params.get('client_secret')).toBe('client-secret');
      expect(params.get('grant_type')).toBe('authorization_code');
      expect(params.get('code')).toBe('abc');
    });

    it('should throw when the client secret is not configured', async () => {
      delete process.env.DISCORD_CLIENT_SECRET;
      await expect(service.exchangeCode('abc')).rejects.toThrow('DISCORD_CLIENT_SECRET');
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  describe('fetchUser', () => {
    it('should look up the user with the bearer token', async () => {
      axios.get.mockResolvedValue({ data: { id: 'u1', username: 'jeff' } });
      await expect(service.fetchUser('tok')).resolves.toEqual({ id: 'u1', username: 'jeff' });
      expect(axios.get).toHaveBeenCalledWith('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: 'Bearer tok' },
      });
    });
  });
});
