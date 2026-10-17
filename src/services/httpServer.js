const http = require('http');
const fs = require('fs');
const path = require('path');

const ALLOWED_CONFIG_FIELDS = new Set([
  'summary_channel_id', 'summary_enabled', 'summary_cron',
  'coffee_enabled', 'coffee_role_name', 'coffee_cron', 'coffee_biweekly', 'coffee_cooldown_days', 'coffee_channel_id',
  'timezone',
  'summ_provider', 'summ_api_key', 'summ_model', 'summ_base_url',
  'trans_provider', 'trans_api_key', 'trans_model', 'trans_base_url',
  'stt_provider',  'stt_api_key',  'stt_model',  'stt_base_url',
  'admin_user_ids',
  'google_client_id',
  'google_client_secret',
  'resume_channel_id', 'resume_review_enabled',
]);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function sanitizeConfig(config) {
  if (!config) return null;
  const out = { ...config };
  delete out.dashboard_token;
  delete out.dashboard_token_exp;
  // Replace secret values with a boolean so the UI knows if they're set
  for (const key of ['summ_api_key', 'trans_api_key', 'stt_api_key', 'google_client_secret']) {
    out[key] = !!out[key];
  }
  return out;
}

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const DUCKHUNT_HTML = path.join(PUBLIC_DIR, 'duckhunt', 'index.html');

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function createHttpServer({ getStats, getGuild, getMembers, getChannels, guildConfigService, giveawayService, discordClient, musicService, duckHuntService } = {}) {
  return http.createServer(async (req, res) => {
    const [pathname, search] = req.url.split('?');
    const params = new URLSearchParams(search || '');
    const guildId = params.get('guildId') || undefined;

    // Duck Hunt Activity. Discord loads the URL-mapped root ("/") with a
    // frame_id query param; plain "/" stays the health-check response below.
    if (req.method === 'GET' && (pathname === '/duckhunt' || (pathname === '/' && params.has('frame_id')))) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(DUCKHUNT_HTML));
      return;
    }

    if (pathname === '/api/duckhunt/config' && req.method === 'GET') {
      sendJson(res, 200, { clientId: process.env.CLIENT_ID || null });
      return;
    }

    if (pathname === '/api/duckhunt/token' && req.method === 'POST' && duckHuntService) {
      const body = await readBody(req);
      if (typeof body.code !== 'string' || !body.code) {
        sendJson(res, 400, { error: 'code required' });
        return;
      }
      try {
        const accessToken = await duckHuntService.exchangeCode(body.code);
        sendJson(res, 200, { access_token: accessToken });
      } catch (err) {
        console.error('Duck Hunt token exchange failed:', err.response?.data || err.message);
        sendJson(res, 502, { error: 'Token exchange failed' });
      }
      return;
    }

    if (pathname === '/api/duckhunt/score' && req.method === 'POST' && duckHuntService && discordClient) {
      const body = await readBody(req);
      const result = { score: body.score, ducks: body.ducks, round: body.round };
      if (typeof body.access_token !== 'string' || typeof body.guildId !== 'string' || !duckHuntService.isValidResult(result)) {
        sendJson(res, 400, { error: 'Invalid score submission' });
        return;
      }

      let user;
      try {
        user = await duckHuntService.fetchUser(body.access_token);
      } catch {
        sendJson(res, 401, { error: 'Invalid access token' });
        return;
      }

      // Only record scores for servers the bot is in and the player belongs to
      const guild = discordClient.guilds.cache.get(body.guildId);
      const member = guild && await guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        sendJson(res, 403, { error: 'Not a member of this server' });
        return;
      }

      const username = member.displayName || user.global_name || user.username;
      const { player, isPersonalBest } = duckHuntService.recordGame(body.guildId, user.id, username, result);
      sendJson(res, 200, { player, isPersonalBest });
      return;
    }

    if (pathname === '/api/duckhunt/leaderboard' && req.method === 'GET' && duckHuntService) {
      if (!guildId) {
        sendJson(res, 400, { error: 'guildId required' });
        return;
      }
      sendJson(res, 200, duckHuntService.getLeaderboard(guildId));
      return;
    }

    // Dashboard redirect
    if (pathname === '/dashboard') {
      res.writeHead(301, { Location: '/public/dashboard.html' });
      res.end();
      return;
    }

    // Stats API
    if (pathname === '/api/stats' && getStats) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getStats(guildId)));
      return;
    }

    // Guild info API
    if (pathname === '/api/guild' && getGuild) {
      const guild = getGuild(guildId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(guild || {}));
      return;
    }

    // Members / server composition API
    if (pathname === '/api/members' && getMembers) {
      const members = getMembers(guildId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(members || {}));
      return;
    }

    // Channels list (for settings channel picker)
    if (pathname === '/api/channels' && getChannels) {
      const channels = getChannels(guildId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(channels || []));
      return;
    }

    // Guild config — GET (read-only, no token required)
    if (pathname === '/api/config' && req.method === 'GET' && guildConfigService) {
      const config = guildConfigService.getConfig(guildId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sanitizeConfig(config) || {}));
      return;
    }

    // Guild config — POST (requires valid dashboard token)
    if (pathname === '/api/config' && req.method === 'POST' && guildConfigService) {
      const body = await readBody(req);
      const token = body.token || params.get('token');

      if (!guildId || !guildConfigService.validateDashboardToken(guildId, token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or expired token. Run /setup dashboard in Discord to get a new link.' }));
        return;
      }

      // Only allow known, safe fields
      const fields = {};
      for (const [k, v] of Object.entries(body)) {
        if (k === 'token') continue;
        if (!ALLOWED_CONFIG_FIELDS.has(k)) continue;
        // Skip empty api key values so we don't clear existing keys
        if ((k === 'summ_api_key' || k === 'trans_api_key' || k === 'stt_api_key') && v === '') continue;
        fields[k] = v;
      }

      guildConfigService.upsertConfig(guildId, fields);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Giveaway wheel page
    if (pathname === '/giveaway') {
      const filePath = path.join(process.cwd(), 'public', 'giveaway.html');
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(filePath));
      } else {
        res.writeHead(404);
        res.end('Giveaway page not found');
      }
      return;
    }

    // Giveaway state API — GET
    if (pathname === '/api/giveaway' && req.method === 'GET' && giveawayService) {
      const id = params.get('id');
      if (!guildId || !id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing guildId or id' }));
        return;
      }
      const g = giveawayService.get(guildId);
      if (!g || g.id !== id) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Giveaway not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: g.id,
        title: g.title,
        prize: g.prize,
        participants: g.participants.map(p => ({ userId: p.userId, displayName: p.displayName })),
        active: g.active,
        hostId: g.hostId,
        selectedItem: g.selectedItem || null,
        lastSpin: g.lastSpin || null,
      }));
      return;
    }

    // Giveaway spin API — POST (requires host token)
    if (pathname === '/api/giveaway/spin' && req.method === 'POST' && giveawayService) {
      const body = await readBody(req);
      const gid = body.guildId || guildId;
      const { id, token } = body;
      if (!gid || !id || !token) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing guildId, id, or token' }));
        return;
      }
      const result = giveawayService.spin(gid, id, token);
      if (!result) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cannot spin: invalid token, no participants, or giveaway inactive' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));

      // Fire-and-forget DM to winner
      if (discordClient && result.winner) {
        const giveaway = giveawayService.get(gid);
        (async () => {
          try {
            const [winnerUser, hostUser] = await Promise.all([
              discordClient.users.fetch(result.winner.userId),
              giveaway ? discordClient.users.fetch(giveaway.hostId) : Promise.resolve(null),
            ]);
            const hostMention = hostUser
              ? `**${hostUser.displayName || hostUser.username}** (@${hostUser.username})`
              : 'the giveaway host';
            const prizeText = giveaway?.prize ? `\n🎁 **Prize:** ${giveaway.prize}` : '';
            await winnerUser.send(
              `🎉 Congratulations, **${result.winner.displayName}**! You've been selected as the winner of the **${giveaway?.title || 'giveaway'}**!${prizeText}\n\nPlease reach out to ${hostMention} for further details. Congratulations! 🏆`
            );
          } catch { /* DMs may be disabled for this user — silently ignore */ }
        })();
      }

      return;
    }

    // Giveaway winner history — GET (requires dashboard token)
    if (pathname === '/api/giveaway/winners' && req.method === 'GET' && giveawayService && guildConfigService) {
      const token = params.get('token');
      if (!guildId || !guildConfigService.validateDashboardToken(guildId, token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or expired token' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(giveawayService.getWinnerHistory(guildId)));
      return;
    }

    // Giveaway winner history — DELETE/clear (requires dashboard token)
    if (pathname === '/api/giveaway/winners' && req.method === 'DELETE' && giveawayService && guildConfigService) {
      const token = params.get('token');
      if (!guildId || !guildConfigService.validateDashboardToken(guildId, token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or expired token' }));
        return;
      }
      giveawayService.clearWinnerHistory(guildId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Giveaway selected item — POST (requires host token)
    if (pathname === '/api/giveaway/item' && req.method === 'POST' && giveawayService) {
      const body = await readBody(req);
      const gid = body.guildId || guildId;
      const { id, token, item } = body;
      if (!gid || !id || !token) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing guildId, id, or token' }));
        return;
      }
      const ok = giveawayService.setItem(gid, id, token, item);
      if (!ok) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid token or giveaway not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (pathname.startsWith('/public/')) {
      const filePath = path.join(process.cwd(), pathname);

      // Reject "/public/../" traversal out of the public directory
      if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const contentType =
          ext === '.html' ? 'text/html' :
          ext === '.js'   ? 'application/javascript' :
          ext === '.css'  ? 'text/css' :
          ext === '.json' ? 'application/json' :
          'text/plain';

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(fs.readFileSync(filePath));
        return;
      }

      res.writeHead(404);
      res.end('File not found');
      return;
    }

    // Spotify OAuth callback
    if (pathname === '/oauth/spotify/callback' && musicService) {
      const code = params.get('code');
      const state = params.get('state');
      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<p>Missing code or state parameter.</p>');
        return;
      }
      try {
        await musicService.handleSpotifyCallback(code, state);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Spotify connected!</h2><p>You can close this tab and return to Discord.</p>');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h2>Spotify auth failed</h2><p>${err.message}</p>`);
      }
      return;
    }

    // YouTube OAuth callback
    if (pathname === '/oauth/youtube/callback' && musicService) {
      const code = params.get('code');
      const state = params.get('state');
      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<p>Missing code or state parameter.</p>');
        return;
      }
      try {
        await musicService.handleYoutubeCallback(code, state);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>YouTube Music connected!</h2><p>You can close this tab and return to Discord.</p>');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h2>YouTube auth failed</h2><p>${err.message}</p>`);
      }
      return;
    }

    // Root route
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord summarizer bot is running.\n');
  });
}

module.exports = { createHttpServer };
