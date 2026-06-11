jest.mock('axios');

const axios = require('axios');
const { MusicService } = require('../musicService');

function makeConfigService(config = {}) {
  return {
    getConfig: jest.fn().mockReturnValue(config),
    upsertConfig: jest.fn(),
  };
}

describe('MusicService', () => {
  let service;
  let guildConfigService;

  beforeEach(() => {
    guildConfigService = makeConfigService();
    service = new MusicService(guildConfigService);
    jest.clearAllMocks();
  });

  describe('detectMusicLink', () => {
    it('should detect Spotify track links', () => {
      const result = service.detectMusicLink('Check this out https://open.spotify.com/track/abc123');
      expect(result).toEqual({ service: 'spotify', url: 'https://open.spotify.com/track/abc123' });
    });

    it('should detect Spotify links with lowercase locale prefix', () => {
      const result = service.detectMusicLink('https://open.spotify.com/en-gb/track/xyz789');
      expect(result.service).toBe('spotify');
    });

    it('should detect Apple Music links', () => {
      const result = service.detectMusicLink('https://music.apple.com/us/album/song/123');
      expect(result).toEqual({ service: 'appleMusic', url: 'https://music.apple.com/us/album/song/123' });
    });

    it('should detect YouTube Music links', () => {
      const result = service.detectMusicLink('https://music.youtube.com/watch?v=abc');
      expect(result.service).toBe('youtube');
    });

    it('should detect standard YouTube links', () => {
      const result = service.detectMusicLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result).toEqual({ service: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    });

    it('should detect youtu.be short links', () => {
      const result = service.detectMusicLink('https://youtu.be/dQw4w9WgXcQ');
      expect(result.service).toBe('youtube');
    });

    it('should return null for non-music content', () => {
      expect(service.detectMusicLink('just a regular message')).toBeNull();
      expect(service.detectMusicLink('https://example.com/song')).toBeNull();
    });
  });

  describe('resolveViaOdesli', () => {
    it('should return track info when Odesli responds', async () => {
      axios.get.mockResolvedValue({
        data: {
          entitiesByUniqueId: {
            'YOUTUBE::abc': { title: 'Cool Song', artistName: 'Cool Artist' },
          },
          linksByPlatform: {
            youtube: { entityUniqueId: 'YOUTUBE::abc' },
          },
        },
      });

      const result = await service.resolveViaOdesli('https://open.spotify.com/track/abc');
      expect(result.title).toBe('Cool Song');
      expect(result.artist).toBe('Cool Artist');
      expect(result.youtubeVideoId).toBe('abc');
    });

    it('should return null when axios throws a non-429 error', async () => {
      axios.get.mockRejectedValue({ response: { status: 500 } });
      const result = await service.resolveViaOdesli('https://open.spotify.com/track/abc');
      expect(result).toBeNull();
    });

    it('should throw a rate limit error on 429', async () => {
      axios.get.mockRejectedValue({ response: { status: 429 } });
      await expect(service.resolveViaOdesli('https://open.spotify.com/track/abc')).rejects.toThrow('rate limited');
    });
  });

  describe('generateYoutubeAuthUrl', () => {
    beforeEach(() => {
      process.env.PUBLIC_URL = 'https://mybot.example.com';
      process.env.GOOGLE_CLIENT_ID = 'global-client-id';
    });

    afterEach(() => {
      delete process.env.PUBLIC_URL;
      delete process.env.GOOGLE_CLIENT_ID;
    });

    it('should build an OAuth URL containing required params', () => {
      guildConfigService.getConfig.mockReturnValue({ google_client_id: 'guild-client-id' });
      const url = service.generateYoutubeAuthUrl('g1');
      expect(url).toContain('accounts.google.com');
      expect(url).toContain('guild-client-id');
      expect(url).toContain('g1');
      expect(url).toContain('youtube');
    });

    it('should fall back to env GOOGLE_CLIENT_ID', () => {
      guildConfigService.getConfig.mockReturnValue({});
      const url = service.generateYoutubeAuthUrl('g1');
      expect(url).toContain('global-client-id');
    });
  });

  describe('getYoutubeHeaders', () => {
    it('should throw when youtube is not authenticated', async () => {
      guildConfigService.getConfig.mockReturnValue({});
      await expect(service.getYoutubeHeaders('g1')).rejects.toThrow('not authenticated');
    });

    it('should return Authorization header when token is fresh', async () => {
      guildConfigService.getConfig.mockReturnValue({
        youtube_access_token: 'tok123',
        youtube_token_expires: Date.now() + 9999999,
      });
      const headers = await service.getYoutubeHeaders('g1');
      expect(headers.Authorization).toBe('Bearer tok123');
    });
  });
});
