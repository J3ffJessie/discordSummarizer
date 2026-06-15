jest.mock('fs');
jest.mock('../../utils/helpers', () => ({ ensureDataDir: jest.fn(() => '/mock/data') }));
jest.mock('../../../package.json', () => ({ version: '2.0.0' }), { virtual: true });

describe('releaseNotifier', () => {
  let fs;
  let notifyRelease;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('fs');
    jest.mock('../../utils/helpers', () => ({ ensureDataDir: jest.fn(() => '/mock/data') }));
    jest.mock('../../../package.json', () => ({ version: '2.0.0' }), { virtual: true });

    fs = require('fs');
    fs.existsSync = jest.fn().mockReturnValue(false);
    fs.readFileSync = jest.fn().mockReturnValue('');
    fs.writeFileSync = jest.fn();

    ({ notifyRelease } = require('../releaseNotifier'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should do nothing when version has not changed', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('last_version')) return '2.0.0';
      return '';
    });

    const client = { users: { fetch: jest.fn() }, channels: { fetch: jest.fn() } };
    await notifyRelease(client, null);
    expect(client.users.fetch).not.toHaveBeenCalled();
  });

  it('should DM installer users when version changes', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('last_version')) return '1.0.0';
      if (p.includes('CHANGELOG')) return '## [2.0.0]\n- New stuff\n## [1.0.0]\n- Old stuff';
      return '';
    });

    const mockSend = jest.fn().mockResolvedValue(undefined);
    const client = {
      users: { fetch: jest.fn().mockResolvedValue({ send: mockSend }) },
      channels: { fetch: jest.fn() },
    };
    const guildConfigService = { getAllInstallerUserIds: jest.fn().mockReturnValue(['u1']) };

    await notifyRelease(client, guildConfigService);
    expect(client.users.fetch).toHaveBeenCalledWith('u1');
    expect(mockSend).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('should treat null last version as first run', async () => {
    fs.existsSync.mockReturnValue(false);

    const mockSend = jest.fn().mockResolvedValue(undefined);
    const client = {
      users: { fetch: jest.fn().mockResolvedValue({ send: mockSend }) },
      channels: { fetch: jest.fn() },
    };
    const guildConfigService = { getAllInstallerUserIds: jest.fn().mockReturnValue(['u1']) };

    await notifyRelease(client, guildConfigService);
    expect(mockSend).toHaveBeenCalled();
    const msg = mockSend.mock.calls[0][0];
    expect(msg).toContain('online');
  });

  it('should post to RELEASE_NOTIFY_CHANNEL_ID when set', async () => {
    process.env.RELEASE_NOTIFY_CHANNEL_ID = 'chan1';
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation((p) => (p.includes('last_version') ? '1.0.0' : ''));

    const mockSend = jest.fn().mockResolvedValue(undefined);
    const client = {
      users: { fetch: jest.fn() },
      channels: {
        fetch: jest.fn().mockResolvedValue({ isTextBased: () => true, send: mockSend }),
      },
    };

    await notifyRelease(client, null);
    expect(mockSend).toHaveBeenCalled();
    delete process.env.RELEASE_NOTIFY_CHANNEL_ID;
  });

  it('should not crash when DM fails for a user', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation((p) => (p.includes('last_version') ? '1.0.0' : ''));

    const client = {
      users: { fetch: jest.fn().mockRejectedValue(new Error('Cannot DM')) },
      channels: { fetch: jest.fn() },
    };
    const guildConfigService = { getAllInstallerUserIds: jest.fn().mockReturnValue(['u1']) };

    await expect(notifyRelease(client, guildConfigService)).resolves.not.toThrow();
  });
});
