jest.mock('fs');
jest.mock('../../utils/helpers', () => ({
  ensureDataDir: jest.fn(() => '/mock/data'),
  delay: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../utils/logger', () => ({
  logError: jest.fn(() => Promise.resolve()),
}));

describe('reminders', () => {
  let fs;
  let reminders;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('fs');
    jest.mock('../../utils/helpers', () => ({
      ensureDataDir: jest.fn(() => '/mock/data'),
      delay: jest.fn(() => Promise.resolve()),
    }));
    jest.mock('../../utils/logger', () => ({
      logError: jest.fn(() => Promise.resolve()),
    }));

    fs = require('fs');
    // Default: no lock file, no reminders file
    fs.existsSync = jest.fn().mockReturnValue(false);
    fs.readFileSync = jest.fn().mockReturnValue('[]');
    fs.writeFileSync = jest.fn();
    fs.openSync = jest.fn().mockReturnValue(1);
    fs.writeSync = jest.fn();
    fs.closeSync = jest.fn();
    fs.unlinkSync = jest.fn();
    fs.statSync = jest.fn().mockReturnValue({ mtimeMs: Date.now() });

    reminders = require('../reminders');
  });

  // ─── parseTime ───────────────────────────────────────────────────────────────

  describe('parseTime', () => {
    it('should parse seconds', () => {
      expect(reminders.parseTime('30s')).toBe(30000);
      expect(reminders.parseTime('1 sec')).toBe(1000);
      expect(reminders.parseTime('2 seconds')).toBe(2000);
    });

    it('should parse minutes', () => {
      expect(reminders.parseTime('5m')).toBe(300000);
      expect(reminders.parseTime('10 min')).toBe(600000);
      expect(reminders.parseTime('3 minutes')).toBe(180000);
    });

    it('should parse hours', () => {
      expect(reminders.parseTime('1h')).toBe(3600000);
      expect(reminders.parseTime('2 hours')).toBe(7200000);
      expect(reminders.parseTime('1 hr')).toBe(3600000);
    });

    it('should parse days', () => {
      expect(reminders.parseTime('1d')).toBe(86400000);
      expect(reminders.parseTime('2 days')).toBe(172800000);
    });

    it('should parse weeks', () => {
      expect(reminders.parseTime('1w')).toBe(604800000);
      expect(reminders.parseTime('2 weeks')).toBe(1209600000);
    });

    it('should parse months (approximate 30 days)', () => {
      expect(reminders.parseTime('1mo')).toBe(30 * 24 * 60 * 60 * 1000);
      expect(reminders.parseTime('2 months')).toBe(2 * 30 * 24 * 60 * 60 * 1000);
    });

    it('should parse compound durations', () => {
      const result = reminders.parseTime('1h 30m');
      expect(result).toBe(3600000 + 1800000);
    });

    it('should return null for invalid input', () => {
      expect(reminders.parseTime('')).toBeNull();
      expect(reminders.parseTime(null)).toBeNull();
      expect(reminders.parseTime('invalid')).toBeNull();
      expect(reminders.parseTime('0s')).toBeNull(); // total must be > 0
    });

    it('should handle decimal values', () => {
      expect(reminders.parseTime('0.5h')).toBe(1800000);
    });
  });

  // ─── splitTimeAndMessage ─────────────────────────────────────────────────────

  describe('splitTimeAndMessage', () => {
    it('should split a time token and message', () => {
      const result = reminders.splitTimeAndMessage(['30m', 'Take', 'a', 'break']);
      expect(result.timeStr).toBe('30m');
      expect(result.reminderMsg).toBe('Take a break');
    });

    it('should handle numeric + unit token pattern', () => {
      const result = reminders.splitTimeAndMessage(['2', 'hours', 'Eat', 'lunch']);
      expect(result.timeStr).toBe('2 hours');
      expect(result.reminderMsg).toBe('Eat lunch');
    });

    it('should handle all tokens being message (no time)', () => {
      const result = reminders.splitTimeAndMessage(['hello', 'world']);
      expect(result.timeStr).toBe('');
      expect(result.reminderMsg).toBe('hello world');
    });

    it('should handle empty input', () => {
      const result = reminders.splitTimeAndMessage([]);
      expect(result.timeStr).toBe('');
      expect(result.reminderMsg).toBe('');
    });
  });

  // ─── addReminderSafely ───────────────────────────────────────────────────────

  describe('addReminderSafely', () => {
    it('should create a new reminder and return { created: true }', async () => {
      fs.readFileSync.mockReturnValue('[]');

      const reminder = { id: '1', userId: 'user1', msg: 'hello', time: Date.now() + 60000 };
      const result = await reminders.addReminderSafely(reminder);

      expect(result.created).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should detect a duplicate reminder and return { created: false, existing }', async () => {
      const now = Date.now();
      const existing = { id: '999', userId: 'user1', msg: 'hello', time: now + 60000 };
      fs.existsSync.mockReturnValue(true); // reminder file exists
      fs.readFileSync.mockReturnValue(JSON.stringify([existing]));

      const duplicate = { id: '1000', userId: 'user1', msg: 'hello', time: now + 60000 };
      const result = await reminders.addReminderSafely(duplicate);

      expect(result.created).toBe(false);
      expect(result.existing.id).toBe('999');
    });

    it('should not flag a duplicate if messages differ', async () => {
      const now = Date.now();
      const existing = { id: '999', userId: 'user1', msg: 'hello', time: now + 60000 };
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([existing]));

      const different = { id: '1000', userId: 'user1', msg: 'world', time: now + 60000 };
      const result = await reminders.addReminderSafely(different);

      expect(result.created).toBe(true);
    });
  });

  // ─── cancelReminderById ──────────────────────────────────────────────────────

  describe('cancelReminderById', () => {
    it('should return false for unknown id (no reminders in memory)', () => {
      const result = reminders.cancelReminderById('user1', 'nonexistent');
      expect(result).toBe(false);
    });
  });

  // ─── cancelAllForUser ────────────────────────────────────────────────────────

  describe('cancelAllForUser', () => {
    it('should return 0 when user has no reminders', () => {
      const count = reminders.cancelAllForUser('user_with_none');
      expect(count).toBe(0);
    });
  });

  // ─── listRemindersForUser ────────────────────────────────────────────────────

  describe('listRemindersForUser', () => {
    it('should return empty array when user has no reminders', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([]));

      const result = reminders.listRemindersForUser('user1');
      expect(result).toEqual([]);
    });

    it("should return only the user's reminders", () => {
      const list = [
        { id: '1', userId: 'user1', msg: 'A', time: Date.now() + 1000 },
        { id: '2', userId: 'user2', msg: 'B', time: Date.now() + 2000 },
        { id: '3', userId: 'user1', msg: 'C', time: Date.now() + 3000 },
      ];
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(list));

      const result = reminders.listRemindersForUser('user1');
      expect(result).toHaveLength(2);
      expect(result.every((r) => r.userId === 'user1')).toBe(true);
    });

    it('should return empty array when reminders file does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      const result = reminders.listRemindersForUser('user1');
      expect(result).toEqual([]);
    });
  });

  // ─── loadRemindersFromFile ───────────────────────────────────────────────────

  describe('loadRemindersFromFile', () => {
    it('should return empty array when file does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      const result = reminders.loadRemindersFromFile();
      expect(result).toEqual([]);
    });

    it('should parse and return reminders from file', () => {
      const list = [{ id: '1', userId: 'u1', msg: 'test', time: 9999999 }];
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(list));

      const result = reminders.loadRemindersFromFile();
      expect(result).toEqual(list);
    });

    it('should return empty array on parse error', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json {{{');

      const result = reminders.loadRemindersFromFile();
      expect(result).toEqual([]);
    });
  });
});
