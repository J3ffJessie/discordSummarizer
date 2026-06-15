const WebSocket = require('ws');

jest.mock('ws', () => {
  const mockOn = jest.fn();
  const MockServer = jest.fn().mockImplementation(() => ({ on: mockOn }));
  MockServer._mockOn = mockOn;
  MockServer.OPEN = 1;
  return { Server: MockServer, OPEN: 1 };
});

const { StreamingService } = require('../streamingService');

function makeSession(clients = []) {
  return { clients: new Set(clients), captions: [] };
}

function makeClient(lang = 'English', readyState = 1) {
  return { targetLanguage: lang, readyState, send: jest.fn() };
}

describe('StreamingService', () => {
  let service;
  let sessionService;

  beforeEach(() => {
    sessionService = {
      getSession: jest.fn(),
      validateSession: jest.fn(),
    };
    const fakeServer = {};
    service = new StreamingService(fakeServer, sessionService);
  });

  describe('getRequestedLanguages', () => {
    it('should always include English as baseline', () => {
      sessionService.getSession.mockReturnValue(null);
      const langs = service.getRequestedLanguages('g1');
      expect(langs.has('English')).toBe(true);
    });

    it('should include languages from connected open clients', () => {
      const clients = [makeClient('Arabic'), makeClient('Spanish')];
      sessionService.getSession.mockReturnValue(makeSession(clients));
      const langs = service.getRequestedLanguages('g1');
      expect(langs.has('Arabic')).toBe(true);
      expect(langs.has('Spanish')).toBe(true);
      expect(langs.has('English')).toBe(true);
    });

    it('should exclude closed clients', () => {
      const clients = [makeClient('Arabic', 3)]; // readyState 3 = CLOSED
      sessionService.getSession.mockReturnValue(makeSession(clients));
      const langs = service.getRequestedLanguages('g1');
      expect(langs.has('Arabic')).toBe(false);
    });
  });

  describe('broadcast', () => {
    it('should do nothing when no session', () => {
      sessionService.getSession.mockReturnValue(null);
      expect(() => service.broadcast('g1', { userId: 'u1' }, new Map())).not.toThrow();
    });

    it('should send translated text to each connected client in their language', () => {
      const arabicClient = makeClient('Arabic');
      const englishClient = makeClient('English');
      sessionService.getSession.mockReturnValue(makeSession([arabicClient, englishClient]));

      const translations = new Map([['English', 'Hello'], ['Arabic', 'مرحبا']]);
      service.broadcast('g1', { userId: 'u1', original: 'Hello' }, translations);

      const arabicPayload = JSON.parse(arabicClient.send.mock.calls[0][0]);
      expect(arabicPayload.translated).toBe('مرحبا');

      const englishPayload = JSON.parse(englishClient.send.mock.calls[0][0]);
      expect(englishPayload.translated).toBe('Hello');
    });

    it('should fall back to English when client language not in translations', () => {
      const client = makeClient('Klingon');
      sessionService.getSession.mockReturnValue(makeSession([client]));

      const translations = new Map([['English', 'Hello']]);
      service.broadcast('g1', { userId: 'u1' }, translations);

      const payload = JSON.parse(client.send.mock.calls[0][0]);
      expect(payload.translated).toBe('Hello');
    });

    it('should push caption to session.captions', () => {
      const session = makeSession([makeClient('English')]);
      sessionService.getSession.mockReturnValue(session);

      const translations = new Map([['English', 'Hello']]);
      service.broadcast('g1', { userId: 'u1', original: 'Hello' }, translations);

      expect(session.captions).toHaveLength(1);
      expect(session.captions[0].userId).toBe('u1');
    });

    it('should skip clients that are not open', () => {
      const closedClient = makeClient('English', 3);
      sessionService.getSession.mockReturnValue(makeSession([closedClient]));

      const translations = new Map([['English', 'Hello']]);
      service.broadcast('g1', { userId: 'u1' }, translations);

      expect(closedClient.send).not.toHaveBeenCalled();
    });
  });
});
