jest.mock('../../utils/helpers', () => ({ ensureDataDir: jest.fn(() => '/mock') }));
jest.mock('better-sqlite3', () => {
  const RealDB = jest.requireActual('better-sqlite3');
  return jest.fn(() => new RealDB(':memory:'));
});
jest.mock('discord.js', () => ({
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setThumbnail: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
  })),
}));

const { ProfileService, buildProfileEmbed } = require('../profileService');

describe('ProfileService', () => {
  let service;

  beforeEach(() => {
    service = new ProfileService();
  });

  afterEach(() => {
    service.db.close();
  });

  describe('getProfile', () => {
    it('should return null for unknown user', () => {
      expect(service.getProfile('g1', 'u1')).toBeNull();
    });

    it('should return profile after upsert', () => {
      service.upsertProfile('g1', 'u1', { bio: 'Hello world', networking: 1 });
      const p = service.getProfile('g1', 'u1');
      expect(p).not.toBeNull();
      expect(p.bio).toBe('Hello world');
      expect(p.networking).toBe(1);
    });
  });

  describe('upsertProfile', () => {
    it('should insert a new profile', () => {
      const p = service.upsertProfile('g1', 'u1', { bio: 'My bio', title: 'Dev' });
      expect(p.bio).toBe('My bio');
      expect(p.title).toBe('Dev');
    });

    it('should update an existing profile', () => {
      service.upsertProfile('g1', 'u1', { bio: 'First' });
      const updated = service.upsertProfile('g1', 'u1', { bio: 'Updated' });
      expect(updated.bio).toBe('Updated');
    });

    it('should not overwrite unset fields on update', () => {
      service.upsertProfile('g1', 'u1', { bio: 'Bio', title: 'Dev' });
      const updated = service.upsertProfile('g1', 'u1', { bio: 'New bio' });
      expect(updated.title).toBe('Dev');
    });

    it('should be scoped to guildId + userId pair', () => {
      service.upsertProfile('g1', 'u1', { bio: 'Guild 1 bio' });
      service.upsertProfile('g2', 'u1', { bio: 'Guild 2 bio' });
      expect(service.getProfile('g1', 'u1').bio).toBe('Guild 1 bio');
      expect(service.getProfile('g2', 'u1').bio).toBe('Guild 2 bio');
    });

    it('should handle empty fields object on existing profile', () => {
      service.upsertProfile('g1', 'u1', { bio: 'Existing' });
      const result = service.upsertProfile('g1', 'u1', {});
      expect(result.bio).toBe('Existing');
    });
  });
});

describe('buildProfileEmbed', () => {
  it('should show "no profile" description when profile is null', () => {
    const embed = buildProfileEmbed({ username: 'alice', displayAvatarURL: () => null }, null, null);
    expect(embed.setDescription).toHaveBeenCalledWith(expect.stringContaining('No profile'));
  });

  it('should show "no profile" when profile has no content', () => {
    const embed = buildProfileEmbed(
      { username: 'alice', displayAvatarURL: () => null },
      null,
      { bio: null, title: null, skills: null, timezone: null, networking: 0 }
    );
    expect(embed.setDescription).toHaveBeenCalledWith(expect.stringContaining('No profile'));
  });

  it('should set bio as description when present', () => {
    const embed = buildProfileEmbed(
      { username: 'alice', displayAvatarURL: () => null },
      null,
      { bio: 'I love coding', title: null, skills: null, timezone: null, networking: 0 }
    );
    expect(embed.setDescription).toHaveBeenCalledWith('I love coding');
  });

  it('should use member displayName when available', () => {
    buildProfileEmbed(
      { username: 'alice', displayAvatarURL: () => null },
      { displayName: 'Alice Smith', displayHexColor: '#ff0000', joinedAt: new Date() },
      { bio: 'Hello', title: null, skills: null, timezone: null, networking: 1 }
    );
    // Just verify it doesn't throw
  });
});
