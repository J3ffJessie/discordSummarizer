const http = require('http');
const fs = require('fs');
const path = require('path');

function createHttpServer() {
  return http.createServer((req, res) => {

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
