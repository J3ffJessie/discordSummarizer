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
