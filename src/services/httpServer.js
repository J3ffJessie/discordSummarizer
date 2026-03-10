const http = require('http');
const fs = require('fs');
const path = require('path');

const ALLOWED_CONFIG_FIELDS = new Set([
  'summary_channel_id', 'summary_enabled', 'summary_cron',
  'coffee_enabled', 'coffee_role_name', 'coffee_cron', 'coffee_biweekly', 'coffee_cooldown_days',
  'timezone',
  'summ_provider', 'summ_api_key', 'summ_model', 'summ_base_url',
  'trans_provider', 'trans_api_key', 'trans_model', 'trans_base_url',
  'stt_provider',  'stt_api_key',  'stt_model',  'stt_base_url',
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
  // Replace api key values with a boolean so the UI knows if they're set
  for (const key of ['summ_api_key', 'trans_api_key', 'stt_api_key']) {
    out[key] = !!out[key];
  }
  return out;
}

function createHttpServer({ getStats, getGuild, getMembers, getChannels, guildConfigService } = {}) {
  return http.createServer(async (req, res) => {
    const [pathname, search] = req.url.split('?');
    const params = new URLSearchParams(search || '');
    const guildId = params.get('guildId') || undefined;

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

    if (pathname.startsWith('/public/')) {
      const filePath = path.join(process.cwd(), pathname);

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

    // Root route
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord summarizer bot is running.\n');
  });
}

module.exports = { createHttpServer };
