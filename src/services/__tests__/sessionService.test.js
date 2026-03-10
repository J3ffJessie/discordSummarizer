const { SessionService } = require('../sessionService');

describe('SessionService', () => {
  let service;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new SessionService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createSession', () => {
    it('should return a session with a token', () => {
      const session = service.createSession('guild123');

      expect(session).toBeDefined();
      expect(typeof session.token).toBe('string');
      expect(session.token.length).toBe(32); // 16 bytes hex = 32 chars
    });

    it('should return a session with empty captions and clients', () => {
      const session = service.createSession('guild123');

      expect(Array.isArray(session.captions)).toBe(true);
      expect(session.captions.length).toBe(0);
      expect(session.clients).toBeInstanceOf(Set);
      expect(session.clients.size).toBe(0);
    });

    it('should store the session so getSession returns it', () => {
      const session = service.createSession('guild123');

      expect(service.getSession('guild123')).toBe(session);
    });

    it('should call onExpire and delete session after 1 hour', () => {
      const onExpire = jest.fn();
      service.createSession('guild123', onExpire);

      jest.advanceTimersByTime(1000 * 60 * 60 - 1);
      expect(onExpire).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(onExpire).toHaveBeenCalledTimes(1);
      expect(service.getSession('guild123')).toBeUndefined();
    });

    it('should work without an onExpire callback', () => {
      service.createSession('guild123');
      expect(() => jest.advanceTimersByTime(1000 * 60 * 60)).not.toThrow();
      expect(service.getSession('guild123')).toBeUndefined();
    });

    it('should overwrite an existing session for the same guild', () => {
      const session1 = service.createSession('guild123');
      const session2 = service.createSession('guild123');

      expect(service.getSession('guild123')).toBe(session2);
      expect(session1.token).not.toBe(session2.token);
    });
  });

  describe('getSession', () => {
    it('should return undefined for unknown guildId', () => {
      expect(service.getSession('unknown')).toBeUndefined();
    });

    it('should return the session for a known guildId', () => {
      const session = service.createSession('guild456');

      expect(service.getSession('guild456')).toBe(session);
    });
  });

  describe('deleteSession', () => {
    it('should remove the session for the given guildId', () => {
      service.createSession('guild789');
      service.deleteSession('guild789');

      expect(service.getSession('guild789')).toBeUndefined();
    });

    it('should not throw when deleting a non-existent session', () => {
      expect(() => service.deleteSession('nonexistent')).not.toThrow();
    });
  });

  describe('validateSession', () => {
    it('should return the session when guildId and token match', () => {
      const session = service.createSession('guild1');

      const result = service.validateSession('guild1', session.token);

      expect(result).toBe(session);
    });

    it('should return null for wrong token', () => {
      service.createSession('guild1');

      const result = service.validateSession('guild1', 'wrongtoken');

      expect(result).toBeNull();
    });

    it('should return null for unknown guildId', () => {
      const result = service.validateSession('unknownguild', 'anytoken');

      expect(result).toBeNull();
    });

    it('should return null after session is deleted', () => {
      const session = service.createSession('guild1');
      service.deleteSession('guild1');

      const result = service.validateSession('guild1', session.token);

      expect(result).toBeNull();
    });
  });
});
