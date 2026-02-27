const http = require('http');
const fs = require('fs');
const path = require('path');

function createHttpServer({ onSummarize } = {}) {
  return http.createServer(async (req, res) => {

    // POST /api/summarize — generate AI article from caption transcript
    if (req.method === 'POST' && req.url === '/api/summarize') {
      if (!onSummarize) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Summary service not available' }));
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { captions } = JSON.parse(body);
          if (!Array.isArray(captions) || captions.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'captions array is required' }));
            return;
          }
          const summary = await onSummarize(captions);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ summary }));
        } catch (err) {
          console.error('[summarize]', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to generate summary' }));
        }
      });
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
