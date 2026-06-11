module.exports = (client) => {
  client.on('messageCreate', async (message) => {
    if (message.author?.bot) return;

    const config = client.services?.guildConfigService?.getConfig(message.guildId);
    if (!config?.music_enabled || message.channelId !== config.music_channel_id) return;

    const musicService = client.services?.musicService;
    if (!musicService) return;

    const detected = musicService.detectMusicLink(message.content);
    if (!detected) return;

    let resolved;
    try {
      resolved = await musicService.resolveViaOdesli(detected.url);
    } catch (err) {
      await message.reply(err.message);
      return;
    }

    if (!resolved) {
      await message.reply('Could not identify this track via song.link.');
      return;
    }

    let videoId = resolved.youtubeVideoId;

    if (!videoId) {
      try {
        videoId = await musicService.searchYoutubeMusic(resolved.title, resolved.artist, message.guildId);
      } catch (err) {
        console.error('[music] YouTube search failed:', err.message);
      }
    }

    if (!videoId) {
      await message.reply(`Could not find **${resolved.title}** by **${resolved.artist}** on YouTube Music.`);
      return;
    }

    try {
      await musicService.addToYoutubePlaylist(message.guildId, videoId);
    } catch (err) {
      await message.reply(`Failed to add **${resolved.title}** to the playlist: ${err.message}`);
    }
    // Happy path: silent
  });

  client.on('messageDelete', async (message) => {
    if (message.author?.bot) return;

    const config = client.services?.guildConfigService?.getConfig(message.guildId);
    if (!config?.music_enabled || message.channelId !== config.music_channel_id) return;

    const musicService = client.services?.musicService;
    if (!musicService || !message.content) return;

    const detected = musicService.detectMusicLink(message.content);
    if (!detected) return;

    let resolved;
    try {
      resolved = await musicService.resolveViaOdesli(detected.url);
    } catch {
      return;
    }

    if (!resolved) return;

    let videoId = resolved.youtubeVideoId;
    if (!videoId) {
      try {
        videoId = await musicService.searchYoutubeMusic(resolved.title, resolved.artist, message.guildId);
      } catch {
        return;
      }
    }

    if (!videoId) return;

    try {
      await musicService.removeFromYoutubePlaylist(message.guildId, videoId);
    } catch (err) {
      console.error('[music] Failed to remove track from playlist:', err.message);
    }
  });
};
