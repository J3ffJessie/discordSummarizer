const http = require('http');
const fs = require('fs');
const path = require('path');

function createHttpServer({ getStats, getGuild, getMembers } = {}) {
  return http.createServer((req, res) => {
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

    if (pathname.startsWith('/public/')) {
      const filePath = path.join(process.cwd(), pathname);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {

        const ext = path.extname(filePath);

        const contentType =
          ext === '.html' ? 'text/html' :
          ext === '.js' ? 'application/javascript' :
          ext === '.css' ? 'text/css' :
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
