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

      // Default to English until the client sends a preference
      ws.targetLanguage = 'English';

      session.clients.add(ws);

      // Client sends { type: 'setLanguage', language: 'Arabic' } to set preference
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === 'setLanguage' && typeof msg.language === 'string') {
            ws.targetLanguage = msg.language;
          }
        } catch {}
      });

      ws.on('close', () => {
        session.clients.delete(ws);
      });
    });
  }

  // Returns the set of unique languages currently requested by connected clients.
  // Always includes English as a baseline so there is always at least one translation.
  getRequestedLanguages(guildId) {
    const session = this.sessionService.getSession(guildId);
    const langs = new Set(['English']);
    if (!session) return langs;

    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        langs.add(client.targetLanguage || 'English');
      }
    }
    return langs;
  }

  // translations: Map<language, translatedText>
  // Each client receives only the translation for their selected language.
  broadcast(guildId, captionBase, translations) {
    const session = this.sessionService.getSession(guildId);
    if (!session) return;

    session.captions.push({ ...captionBase, translations: Object.fromEntries(translations) });

    for (const client of session.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;

      const lang = client.targetLanguage || 'English';
      const translated = translations.get(lang) ?? translations.get('English') ?? '';

      client.send(JSON.stringify({ ...captionBase, translated }));
    }
  }
}

module.exports = { StreamingService };
