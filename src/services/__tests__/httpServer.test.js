const http = require('http');
const { createHttpServer } = require('../httpServer');

function makeGuildConfigService(config = null, tokenValid = true) {
  return {
    getConfig: jest.fn().mockReturnValue(config),
    upsertConfig: jest.fn(),
    validateDashboardToken: jest.fn().mockReturnValue(tokenValid),
  };
}

function makeGiveawayService(giveaway = null) {
  return {
    get: jest.fn().mockReturnValue(giveaway),
    spin: jest.fn().mockReturnValue(null),
    setItem: jest.fn().mockReturnValue(true),
    getWinnerHistory: jest.fn().mockReturnValue([]),
    clearWinnerHistory: jest.fn(),
  };
}

function request(server, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`http://127.0.0.1${path}`);
    const opts = {
      hostname: '127.0.0.1',
      port: server.address().port,
      path: url.pathname + url.search,
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify(body)) } : {},
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('createHttpServer', () => {
  let server;

  afterEach((done) => {
    if (server?.listening) server.close(done);
    else done();
  });

  it('should return 200 for root route', async () => {
    server = createHttpServer({}).listen(0);
    const res = await request(server, 'GET', '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('running');
  });

  it('should redirect /dashboard to /public/dashboard.html', async () => {
    server = createHttpServer({}).listen(0);
    const res = await request(server, 'GET', '/dashboard');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/public/dashboard.html');
  });

  it('should return stats JSON from /api/stats', async () => {
    const getStats = jest.fn().mockReturnValue({ daily: {} });
    server = createHttpServer({ getStats }).listen(0);
    const res = await request(server, 'GET', '/api/stats?guildId=g1');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ daily: {} });
  });

  it('should return config from GET /api/config', async () => {
    const gcs = makeGuildConfigService({ summary_enabled: 1 });
    server = createHttpServer({ guildConfigService: gcs }).listen(0);
    const res = await request(server, 'GET', '/api/config?guildId=g1');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.summary_enabled).toBe(1);
    expect(body.dashboard_token).toBeUndefined();
  });

  it('should reject POST /api/config with invalid token', async () => {
    const gcs = makeGuildConfigService(null, false);
    server = createHttpServer({ guildConfigService: gcs }).listen(0);
    const res = await request(server, 'POST', '/api/config?guildId=g1', { token: 'bad', summary_enabled: 1 });
    expect(res.status).toBe(401);
  });

  it('should accept POST /api/config with valid token', async () => {
    const gcs = makeGuildConfigService({ summary_enabled: 0 }, true);
    server = createHttpServer({ guildConfigService: gcs }).listen(0);
    const res = await request(server, 'POST', '/api/config?guildId=g1', { token: 'valid', summary_enabled: 1 });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(gcs.upsertConfig).toHaveBeenCalled();
  });

  it('should return 404 for GET /api/giveaway with no giveaway', async () => {
    const gs = makeGiveawayService(null);
    server = createHttpServer({ giveawayService: gs }).listen(0);
    const res = await request(server, 'GET', '/api/giveaway?guildId=g1&id=abc');
    expect(res.status).toBe(404);
  });

  it('should return 400 for GET /api/giveaway missing params', async () => {
    const gs = makeGiveawayService(null);
    server = createHttpServer({ giveawayService: gs }).listen(0);
    const res = await request(server, 'GET', '/api/giveaway?guildId=g1');
    expect(res.status).toBe(400);
  });

  it('should return giveaway data for GET /api/giveaway when found', async () => {
    const giveaway = { id: 'ga1', title: 'Test', prize: 'Prize', participants: [], active: true, hostId: 'h1', selectedItem: null, lastSpin: null };
    const gs = makeGiveawayService(giveaway);
    server = createHttpServer({ giveawayService: gs }).listen(0);
    const res = await request(server, 'GET', '/api/giveaway?guildId=g1&id=ga1');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).title).toBe('Test');
  });

  it('should return 400 for spin with no participants or invalid token', async () => {
    const gs = makeGiveawayService();
    gs.spin.mockReturnValue(null);
    server = createHttpServer({ giveawayService: gs }).listen(0);
    const res = await request(server, 'POST', '/api/giveaway/spin', { guildId: 'g1', id: 'ga1', token: 'bad' });
    expect(res.status).toBe(400);
  });

  it('should return winner history from /api/giveaway/winners', async () => {
    const gs = makeGiveawayService();
    gs.getWinnerHistory.mockReturnValue([{ winnerName: 'Alice' }]);
    const gcs = makeGuildConfigService(null, true);
    server = createHttpServer({ giveawayService: gs, guildConfigService: gcs }).listen(0);
    const res = await request(server, 'GET', '/api/giveaway/winners?guildId=g1&token=valid');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)[0].winnerName).toBe('Alice');
  });
});

describe('static files', () => {
  let server;

  afterEach((done) => {
    if (server?.listening) server.close(done);
    else done();
  });

  // Raw request: URL() would normalize the ".." away before it's sent
  function rawGet(path) {
    return new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port: server.address().port, path }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }).on('error', reject);
    });
  }

  it('should serve files inside /public', async () => {
    server = createHttpServer({}).listen(0);
    expect(await rawGet('/public/dashboard.html')).toBe(200);
  });

  it('should not serve files outside /public via path traversal', async () => {
    server = createHttpServer({}).listen(0);
    expect(await rawGet('/public/../package.json')).toBe(404);
    expect(await rawGet('/public/../src/data/guild_config.db')).toBe(404);
  });
});

describe('Duck Hunt routes', () => {
  let server;
  const env = process.env;

  function makeDuckHuntService() {
    return {
      isValidResult: jest.fn().mockReturnValue(true),
      exchangeCode: jest.fn().mockResolvedValue('access-tok'),
      fetchUser: jest.fn().mockResolvedValue({ id: 'u1', username: 'jeff', global_name: 'Jeff' }),
      recordGame: jest.fn().mockReturnValue({ player: { best_score: 5000 }, isPersonalBest: true }),
      getLeaderboard: jest.fn().mockReturnValue([{ user_id: 'u1', best_score: 5000 }]),
    };
  }

  function makeDiscordClient(member = { displayName: 'Jeffy' }) {
    const guild = { members: { fetch: member ? jest.fn().mockResolvedValue(member) : jest.fn().mockRejectedValue(new Error('Unknown Member')) } };
    return { guilds: { cache: { get: jest.fn(id => (id === 'g1' ? guild : undefined)) } } };
  }

  const validScore = { access_token: 'tok', guildId: 'g1', score: 5000, ducks: 8, round: 2 };

  beforeEach(() => {
    process.env = { ...env, CLIENT_ID: 'client-id' };
  });

  afterEach((done) => {
    process.env = env;
    if (server?.listening) server.close(done);
    else done();
  });

  it('should serve the game at /duckhunt', async () => {
    server = createHttpServer({}).listen(0);
    const res = await request(server, 'GET', '/duckhunt');
    expect(res.status).toBe(200);
    expect(res.body).toContain('/public/duckhunt/game.js');
  });

  it('should serve the game at the root when Discord loads it with a frame_id', async () => {
    server = createHttpServer({}).listen(0);
    const res = await request(server, 'GET', '/?frame_id=abc&instance_id=i1');
    expect(res.status).toBe(200);
    expect(res.body).toContain('/public/duckhunt/game.js');
  });

  it('should return the public client ID from /api/duckhunt/config', async () => {
    server = createHttpServer({}).listen(0);
    const res = await request(server, 'GET', '/api/duckhunt/config');
    expect(JSON.parse(res.body)).toEqual({ clientId: 'client-id' });
  });

  it('should exchange an auth code for an access token', async () => {
    const dh = makeDuckHuntService();
    server = createHttpServer({ duckHuntService: dh }).listen(0);
    const res = await request(server, 'POST', '/api/duckhunt/token', { code: 'abc' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ access_token: 'access-tok' });
    expect(dh.exchangeCode).toHaveBeenCalledWith('abc');
  });

  it('should return 400 when no code is given', async () => {
    server = createHttpServer({ duckHuntService: makeDuckHuntService() }).listen(0);
    const res = await request(server, 'POST', '/api/duckhunt/token', {});
    expect(res.status).toBe(400);
  });

  it('should return 502 when the token exchange fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const dh = makeDuckHuntService();
    dh.exchangeCode.mockRejectedValue(new Error('invalid_grant'));
    server = createHttpServer({ duckHuntService: dh }).listen(0);
    const res = await request(server, 'POST', '/api/duckhunt/token', { code: 'bad' });
    expect(res.status).toBe(502);
    console.error.mockRestore();
  });

  it('should record a score for the verified user', async () => {
    const dh = makeDuckHuntService();
    server = createHttpServer({ duckHuntService: dh, discordClient: makeDiscordClient() }).listen(0);
    const res = await request(server, 'POST', '/api/duckhunt/score', validScore);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ player: { best_score: 5000 }, isPersonalBest: true });
    expect(dh.fetchUser).toHaveBeenCalledWith('tok');
    expect(dh.recordGame).toHaveBeenCalledWith('g1', 'u1', 'Jeffy', { score: 5000, ducks: 8, round: 2 });
  });

  it('should reject invalid score values', async () => {
    const dh = makeDuckHuntService();
    dh.isValidResult.mockReturnValue(false);
    server = createHttpServer({ duckHuntService: dh, discordClient: makeDiscordClient() }).listen(0);
    const res = await request(server, 'POST', '/api/duckhunt/score', validScore);
    expect(res.status).toBe(400);
    expect(dh.recordGame).not.toHaveBeenCalled();
  });

  it('should return 401 for an invalid access token', async () => {
    const dh = makeDuckHuntService();
    dh.fetchUser.mockRejectedValue(new Error('401'));
    server = createHttpServer({ duckHuntService: dh, discordClient: makeDiscordClient() }).listen(0);
    const res = await request(server, 'POST', '/api/duckhunt/score', validScore);
    expect(res.status).toBe(401);
    expect(dh.recordGame).not.toHaveBeenCalled();
  });

  it('should return 403 for a guild the bot is not in', async () => {
    const dh = makeDuckHuntService();
    server = createHttpServer({ duckHuntService: dh, discordClient: makeDiscordClient() }).listen(0);
    const res = await request(server, 'POST', '/api/duckhunt/score', { ...validScore, guildId: 'other' });
    expect(res.status).toBe(403);
    expect(dh.recordGame).not.toHaveBeenCalled();
  });

  it('should return 403 when the player is not a member of the guild', async () => {
    const dh = makeDuckHuntService();
    server = createHttpServer({ duckHuntService: dh, discordClient: makeDiscordClient(null) }).listen(0);
    const res = await request(server, 'POST', '/api/duckhunt/score', validScore);
    expect(res.status).toBe(403);
    expect(dh.recordGame).not.toHaveBeenCalled();
  });

  it('should return the guild leaderboard', async () => {
    const dh = makeDuckHuntService();
    server = createHttpServer({ duckHuntService: dh }).listen(0);
    const res = await request(server, 'GET', '/api/duckhunt/leaderboard?guildId=g1');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual([{ user_id: 'u1', best_score: 5000 }]);
    expect(dh.getLeaderboard).toHaveBeenCalledWith('g1');
  });

  it('should require a guildId for the leaderboard', async () => {
    server = createHttpServer({ duckHuntService: makeDuckHuntService() }).listen(0);
    const res = await request(server, 'GET', '/api/duckhunt/leaderboard');
    expect(res.status).toBe(400);
  });
});
