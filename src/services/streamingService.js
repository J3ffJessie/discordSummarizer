const WebSocket = require('ws');

class StreamingService {
  constructor(server, sessionService) {
    this.sessionService = sessionService;
    this.wss = new WebSocket.Server({ server });

    this.wss.on('connection', (ws, req) => {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const guildId = params.get('guild');
      const token = params.get('token');

      const session = this.sessionService.validateSession(guildId, token);
      if (!session) return ws.close();

      session.clients.add(ws);

      ws.on('close', () => {
        session.clients.delete(ws);
      });
    });
  }

  broadcast(guildId, caption) {
    const session = this.sessionService.getSession(guildId);
    if (!session) return;

    session.captions.push(caption);

    for (const client of session.clients) {
      client.send(JSON.stringify(caption));
    }
  }
}

module.exports = { StreamingService };
