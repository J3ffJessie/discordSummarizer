const fs = require('fs');

jest.mock('fs');

const { delay, ensureDataDir } = require('../helpers');

// helpers.js is stateless — no resetModules needed; just clear mocks between tests
describe('helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('delay', () => {
    it('should resolve after the specified milliseconds', async () => {
      jest.useFakeTimers();

      let resolved = false;
      const p = delay(500).then(() => { resolved = true; });

      expect(resolved).toBe(false);
      jest.advanceTimersByTime(500);
      await p;
      expect(resolved).toBe(true);

      jest.useRealTimers();
    });

    it('should resolve immediately for 0ms', async () => {
      jest.useFakeTimers();

      let resolved = false;
      const p = delay(0).then(() => { resolved = true; });
      jest.advanceTimersByTime(0);
      await p;
      expect(resolved).toBe(true);

      jest.useRealTimers();
    });
  });

  describe('ensureDataDir', () => {
    it('should return the data directory path', () => {
      fs.existsSync.mockReturnValue(true);

      const result = ensureDataDir();

      expect(result).toContain('data');
      expect(result).toMatch(/src[/\\]data$/);
    });

    it('should create the data directory if it does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      fs.mkdirSync.mockImplementation(() => {});

      ensureDataDir();

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('data'),
        { recursive: true }
      );
    });

    it('should not create the directory if it already exists', () => {
      fs.existsSync.mockReturnValue(true);

      ensureDataDir();

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });
});
