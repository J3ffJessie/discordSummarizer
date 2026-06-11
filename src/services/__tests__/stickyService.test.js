jest.mock('../../utils/helpers', () => ({ ensureDataDir: jest.fn(() => '/mock') }));
jest.mock('better-sqlite3', () => {
  const RealDB = jest.requireActual('better-sqlite3');
  return jest.fn(() => new RealDB(':memory:'));
});

const { StickyService } = require('../stickyService');

describe('StickyService', () => {
  let service;

  beforeEach(() => {
    service = new StickyService();
  });

  afterEach(() => {
    service.db.close();
  });

  describe('getSticky', () => {
    it('should return null when no sticky is set', () => {
      expect(service.getSticky('ch1')).toBeNull();
    });
  });

  describe('setSticky', () => {
    it('should insert a new sticky', () => {
      service.setSticky('ch1', 'g1', 'Hello!', 'user1', 'msg1');
      const s = service.getSticky('ch1');
      expect(s).not.toBeNull();
      expect(s.content).toBe('Hello!');
      expect(s.guild_id).toBe('g1');
      expect(s.created_by).toBe('user1');
      expect(s.message_id).toBe('msg1');
    });

    it('should update an existing sticky', () => {
      service.setSticky('ch1', 'g1', 'First', 'user1', 'msg1');
      service.setSticky('ch1', 'g1', 'Updated', 'user1', 'msg2');
      const s = service.getSticky('ch1');
      expect(s.content).toBe('Updated');
      expect(s.message_id).toBe('msg2');
    });
  });

  describe('updateMessageId', () => {
    it('should update just the message_id', () => {
      service.setSticky('ch1', 'g1', 'Content', 'user1', 'old-msg');
      service.updateMessageId('ch1', 'new-msg');
      expect(service.getSticky('ch1').message_id).toBe('new-msg');
    });
  });

  describe('removeSticky', () => {
    it('should delete the sticky', () => {
      service.setSticky('ch1', 'g1', 'Hello', 'user1', null);
      service.removeSticky('ch1');
      expect(service.getSticky('ch1')).toBeNull();
    });

    it('should not throw when removing non-existent sticky', () => {
      expect(() => service.removeSticky('nonexistent')).not.toThrow();
    });
  });

  describe('getAllForGuild', () => {
    it('should return all stickies for a guild', () => {
      service.setSticky('ch1', 'g1', 'Sticky 1', 'user1', null);
      service.setSticky('ch2', 'g1', 'Sticky 2', 'user1', null);
      service.setSticky('ch3', 'g2', 'Other guild', 'user1', null);
      const stickies = service.getAllForGuild('g1');
      expect(stickies).toHaveLength(2);
      expect(stickies.map(s => s.channel_id)).toContain('ch1');
      expect(stickies.map(s => s.channel_id)).toContain('ch2');
    });

    it('should return empty array for guild with no stickies', () => {
      expect(service.getAllForGuild('g99')).toEqual([]);
    });
  });
});
