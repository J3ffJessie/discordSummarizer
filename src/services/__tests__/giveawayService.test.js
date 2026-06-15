const { GiveawayService } = require('../giveawayService');

describe('GiveawayService', () => {
  let service;

  beforeEach(() => {
    service = new GiveawayService();
  });

  describe('create', () => {
    it('should create a giveaway with correct fields', () => {
      const g = service.create('g1', 'host1', 'My Giveaway', 'A Prize');
      expect(g.guildId).toBe('g1');
      expect(g.hostId).toBe('host1');
      expect(g.title).toBe('My Giveaway');
      expect(g.prize).toBe('A Prize');
      expect(g.active).toBe(true);
      expect(g.participants).toEqual([]);
      expect(g.id).toBeTruthy();
      expect(g.token).toBeTruthy();
    });

    it('should default title to "Giveaway" when empty', () => {
      const g = service.create('g1', 'host1', '', '');
      expect(g.title).toBe('Giveaway');
    });

    it('should generate unique ids per giveaway', () => {
      const g1 = service.create('guild1', 'host1', 'GA', '');
      const g2 = service.create('guild2', 'host2', 'GB', '');
      expect(g1.id).not.toBe(g2.id);
      expect(g1.token).not.toBe(g2.token);
    });
  });

  describe('get', () => {
    it('should return null for unknown guildId', () => {
      expect(service.get('unknown')).toBeNull();
    });

    it('should return the giveaway for a known guildId', () => {
      service.create('g1', 'host1', 'Test', '');
      const g = service.get('g1');
      expect(g).not.toBeNull();
      expect(g.title).toBe('Test');
    });
  });

  describe('validate', () => {
    it('should return giveaway when id and token match', () => {
      const g = service.create('g1', 'host1', 'Test', '');
      expect(service.validate('g1', g.id, g.token)).toEqual(expect.objectContaining({ id: g.id }));
    });

    it('should return null for wrong token', () => {
      const g = service.create('g1', 'host1', 'Test', '');
      expect(service.validate('g1', g.id, 'wrong-token')).toBeNull();
    });

    it('should return null for wrong id', () => {
      const g = service.create('g1', 'host1', 'Test', '');
      expect(service.validate('g1', 'wrong-id', g.token)).toBeNull();
    });

    it('should return null for unknown guild', () => {
      expect(service.validate('nobody', 'id', 'token')).toBeNull();
    });
  });

  describe('addParticipant', () => {
    it('should return "no_giveaway" when no giveaway exists', () => {
      expect(service.addParticipant('g1', 'u1', 'user1', 'User One')).toBe('no_giveaway');
    });

    it('should add a participant and return "ok"', () => {
      service.create('g1', 'host1', 'Test', '');
      expect(service.addParticipant('g1', 'u1', 'user1', 'User One')).toBe('ok');
      expect(service.get('g1').participants).toHaveLength(1);
    });

    it('should return "already_entered" for duplicate participant', () => {
      service.create('g1', 'host1', 'Test', '');
      service.addParticipant('g1', 'u1', 'user1', 'User One');
      expect(service.addParticipant('g1', 'u1', 'user1', 'User One')).toBe('already_entered');
    });

    it('should return "no_giveaway" when giveaway is inactive', () => {
      service.create('g1', 'host1', 'Test', '');
      service.end('g1');
      expect(service.addParticipant('g1', 'u1', 'user1', 'User One')).toBe('no_giveaway');
    });
  });

  describe('spin', () => {
    it('should return null when no participants', () => {
      const g = service.create('g1', 'host1', 'Test', '');
      expect(service.spin('g1', g.id, g.token)).toBeNull();
    });

    it('should return null with invalid token', () => {
      const g = service.create('g1', 'host1', 'Test', '');
      service.addParticipant('g1', 'u1', 'user1', 'User One');
      expect(service.spin('g1', g.id, 'bad-token')).toBeNull();
    });

    it('should return a winner and remove them from participants', () => {
      const g = service.create('g1', 'host1', 'Test', '');
      service.addParticipant('g1', 'u1', 'user1', 'User One');
      service.addParticipant('g1', 'u2', 'user2', 'User Two');
      const result = service.spin('g1', g.id, g.token);
      expect(result).not.toBeNull();
      expect(result.winner).toBeDefined();
      expect(result.winner.userId).toMatch(/u[12]/);
      expect(service.get('g1').participants).toHaveLength(1);
    });

    it('should add winner to history', () => {
      const g = service.create('g1', 'host1', 'Test', 'Prize');
      service.addParticipant('g1', 'u1', 'user1', 'User One');
      service.spin('g1', g.id, g.token);
      expect(service.getWinnerHistory('g1')).toHaveLength(1);
      expect(service.getWinnerHistory('g1')[0].giveawayTitle).toBe('Test');
    });

    it('should return null when giveaway is inactive', () => {
      const g = service.create('g1', 'host1', 'Test', '');
      service.addParticipant('g1', 'u1', 'user1', 'User One');
      service.end('g1');
      expect(service.spin('g1', g.id, g.token)).toBeNull();
    });
  });

  describe('end', () => {
    it('should set active to false', () => {
      service.create('g1', 'host1', 'Test', '');
      service.end('g1');
      expect(service.get('g1').active).toBe(false);
    });

    it('should return the giveaway when ending', () => {
      service.create('g1', 'host1', 'Test', '');
      const result = service.end('g1');
      expect(result.title).toBe('Test');
    });

    it('should return null when no giveaway exists', () => {
      expect(service.end('unknown')).toBeNull();
    });
  });

  describe('getWinnerHistory / clearWinnerHistory', () => {
    it('should return empty array initially', () => {
      expect(service.getWinnerHistory('g1')).toEqual([]);
    });

    it('should clear winner history', () => {
      const g = service.create('g1', 'host1', 'Test', '');
      service.addParticipant('g1', 'u1', 'user1', 'User One');
      service.spin('g1', g.id, g.token);
      service.clearWinnerHistory('g1');
      expect(service.getWinnerHistory('g1')).toHaveLength(0);
    });
  });

  describe('setItem', () => {
    it('should set the selected item', () => {
      const g = service.create('g1', 'host1', 'Test', '');
      expect(service.setItem('g1', g.id, g.token, 'Steam Key')).toBe(true);
      expect(service.get('g1').selectedItem).toBe('Steam Key');
    });

    it('should return false with invalid token', () => {
      const g = service.create('g1', 'host1', 'Test', '');
      expect(service.setItem('g1', g.id, 'bad-token', 'item')).toBe(false);
    });

    it('should clear item when null passed', () => {
      const g = service.create('g1', 'host1', 'Test', '');
      service.setItem('g1', g.id, g.token, 'Prize');
      service.setItem('g1', g.id, g.token, null);
      expect(service.get('g1').selectedItem).toBeNull();
    });
  });
});
