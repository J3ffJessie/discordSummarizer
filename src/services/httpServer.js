const http = require('http');
const fs = require('fs');
const path = require('path');

function createHttpServer({ getStats, getGuild, getMembers } = {}) {
  return http.createServer((req, res) => {

    // Dashboard redirect
    if (req.url === '/dashboard') {
      res.writeHead(301, { Location: '/public/dashboard.html' });
      res.end();
      return;
    }

    // Stats API
    if (req.url === '/api/stats' && getStats) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getStats()));
      return;
    }

    // Guild info API
    if (req.url === '/api/guild' && getGuild) {
      const guild = getGuild();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(guild || {}));
      return;
    }

    // Members / server composition API
    if (req.url === '/api/members' && getMembers) {
      const members = getMembers();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(members || {}));
      return;
    }

    if (req.url.startsWith('/public/')) {

      // Remove query parameters
      const cleanUrl = req.url.split('?')[0];

      const filePath = path.join(process.cwd(), cleanUrl);

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
