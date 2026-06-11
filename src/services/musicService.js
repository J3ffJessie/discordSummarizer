const axios = require('axios');

const ODESLI_BASE = 'https://api.song.link/v1-alpha.1/links';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

class MusicService {
  constructor(guildConfigService) {
    this.guildConfigService = guildConfigService;
  }

  detectMusicLink(content) {
    const spotifyMatch = content.match(/https?:\/\/open\.spotify\.com\/(?:[a-z]{2,}(?:-[a-z]{2,})?\/)?track\/[^\s)>]+/);
    if (spotifyMatch) return { service: 'spotify', url: spotifyMatch[0] };

    const appleMusicMatch = content.match(/https?:\/\/music\.apple\.com\/[^\s)>]+/);
    if (appleMusicMatch) return { service: 'appleMusic', url: appleMusicMatch[0] };

    const ytMusicMatch = content.match(/https?:\/\/music\.youtube\.com\/watch\?[^\s)>]+/);
    if (ytMusicMatch) return { service: 'youtube', url: ytMusicMatch[0] };

    const ytMatch = content.match(/https?:\/\/(?:www\.)?youtube\.com\/watch\?[^\s)>]+/) ||
                    content.match(/https?:\/\/youtu\.be\/[^\s)>]+/);
    if (ytMatch) return { service: 'youtube', url: ytMatch[0] };

    return null;
  }

  async resolveViaOdesli(url) {
    try {
      const resp = await axios.get(ODESLI_BASE, { params: { url } });
      const data = resp.data;
      const firstKey = Object.keys(data.entitiesByUniqueId || {})[0];
      const entity = data.entitiesByUniqueId?.[firstKey];
      const youtubePlatform = data.linksByPlatform?.youtubeMusic || data.linksByPlatform?.youtube;
      const rawYoutubeId = youtubePlatform?.entityUniqueId;
      const youtubeVideoId = rawYoutubeId ? rawYoutubeId.split(':').pop() || null : null;

      return {
        youtubeVideoId,
        title: entity?.title || 'Unknown Track',
        artist: entity?.artistName || 'Unknown Artist',
      };
    } catch (err) {
      if (err.response?.status === 429) throw new Error('song.link is rate limited, try again shortly');
      return null;
    }
  }

  async searchYoutubeMusic(title, artist, guildId) {
    const headers = await this.getYoutubeHeaders(guildId);
    const resp = await axios.get(`${YOUTUBE_API_BASE}/search`, {
      headers,
      params: {
        part: 'snippet',
        q: `${title} ${artist} official audio`,
        type: 'video',
        videoCategoryId: '10',
        maxResults: 1,
      },
    });
    return resp.data.items?.[0]?.id?.videoId || null;
  }

  // --- YouTube ---

  async getYoutubeHeaders(guildId) {
    const config = this.guildConfigService.getConfig(guildId);
    if (!config?.youtube_access_token) throw new Error('YouTube not authenticated');

    if (Date.now() > (config.youtube_token_expires || 0) - 60000) {
      await this.refreshYoutubeToken(guildId);
    }

    const updated = this.guildConfigService.getConfig(guildId);
    return { Authorization: `Bearer ${updated.youtube_access_token}` };
  }

  _googleClientId(config) {
    return config?.google_client_id || process.env.GOOGLE_CLIENT_ID;
  }

  _googleClientSecret(config) {
    return config?.google_client_secret || process.env.GOOGLE_CLIENT_SECRET;
  }

  async refreshYoutubeToken(guildId) {
    const config = this.guildConfigService.getConfig(guildId);
    if (!config?.youtube_refresh_token) throw new Error('No YouTube refresh token stored');

    const resp = await axios.post(GOOGLE_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: config.youtube_refresh_token,
        client_id: this._googleClientId(config),
        client_secret: this._googleClientSecret(config),
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    this.guildConfigService.upsertConfig(guildId, {
      youtube_access_token: resp.data.access_token,
      youtube_token_expires: Date.now() + resp.data.expires_in * 1000,
    });
  }

  async ensureYoutubePlaylist(guildId) {
    const config = this.guildConfigService.getConfig(guildId);
    if (config?.youtube_playlist_id) return config.youtube_playlist_id;

    const headers = await this.getYoutubeHeaders(guildId);

    const resp = await axios.post(
      `${YOUTUBE_API_BASE}/playlists`,
      {
        snippet: { title: 'Torc Grooves', description: 'Music added by Torc Bot' },
        status: { privacyStatus: 'public' },
      },
      {
        headers: { ...headers, 'Content-Type': 'application/json' },
        params: { part: 'snippet,status' },
      }
    );

    const playlistId = resp.data.id;
    this.guildConfigService.upsertConfig(guildId, { youtube_playlist_id: playlistId });
    return playlistId;
  }

  async removeFromYoutubePlaylist(guildId, videoId) {
    if (!videoId) return;
    const config = this.guildConfigService.getConfig(guildId);
    if (!config?.youtube_playlist_id) return;

    const headers = await this.getYoutubeHeaders(guildId);
    const playlistId = config.youtube_playlist_id;

    const listResp = await axios.get(`${YOUTUBE_API_BASE}/playlistItems`, {
      headers,
      params: { part: 'id,contentDetails', playlistId, maxResults: 50 },
    });

    const item = listResp.data.items?.find(i => i.contentDetails?.videoId === videoId);
    if (!item) return;

    await axios.delete(`${YOUTUBE_API_BASE}/playlistItems`, {
      headers,
      params: { id: item.id },
    });
  }

  async addToYoutubePlaylist(guildId, videoId) {
    if (!videoId) throw new Error('No YouTube video ID');
    const headers = await this.getYoutubeHeaders(guildId);
    let playlistId = await this.ensureYoutubePlaylist(guildId);

    let existing = [];
    try {
      const listResp = await axios.get(`${YOUTUBE_API_BASE}/playlistItems`, {
        headers,
        params: { part: 'contentDetails', playlistId, maxResults: 50 },
      });
      existing = listResp.data.items?.map(i => i.contentDetails?.videoId) || [];
    } catch (err) {
      if (err.response?.status === 404) {
        // Playlist was deleted — clear stored ID and recreate
        this.guildConfigService.upsertConfig(guildId, { youtube_playlist_id: null });
        playlistId = await this.ensureYoutubePlaylist(guildId);
      } else {
        throw err;
      }
    }

    if (existing.includes(videoId)) return;

    try {
      await axios.post(
        `${YOUTUBE_API_BASE}/playlistItems`,
        {
          snippet: {
            playlistId,
            resourceId: { kind: 'youtube#video', videoId },
          },
        },
        {
          headers: { ...headers, 'Content-Type': 'application/json' },
          params: { part: 'snippet' },
        }
      );
    } catch (err) {
      console.error('[music] POST playlistItems failed:', err.response?.status, JSON.stringify(err.response?.data));
      console.error('[music] playlistId:', playlistId, 'videoId:', videoId);
      throw err;
    }
  }

  generateYoutubeAuthUrl(guildId) {
    const config = this.guildConfigService.getConfig(guildId);
    const params = new URLSearchParams({
      client_id: this._googleClientId(config),
      redirect_uri: `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/oauth/youtube/callback`,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube',
      access_type: 'offline',
      prompt: 'consent',
      state: guildId,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async handleYoutubeCallback(code, guildId) {
    const config = this.guildConfigService.getConfig(guildId);
    const resp = await axios.post(GOOGLE_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/oauth/youtube/callback`,
        client_id: this._googleClientId(config),
        client_secret: this._googleClientSecret(config),
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const fields = {
      youtube_access_token: resp.data.access_token,
      youtube_token_expires: Date.now() + resp.data.expires_in * 1000,
    };
    if (resp.data.refresh_token) fields.youtube_refresh_token = resp.data.refresh_token;

    this.guildConfigService.upsertConfig(guildId, fields);
  }
}

module.exports = { MusicService };
