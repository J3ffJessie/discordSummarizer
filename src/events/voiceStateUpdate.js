module.exports = (client) => {
  const joinTimes = new Map(); // userId -> timestamp

  client.on('voiceStateUpdate', (oldState, newState) => {
    const member = newState.member || oldState.member;
    const userId = member?.user?.id;
    if (!userId || member?.user?.bot) return;

    const wasIn = !!oldState.channelId;
    const isIn  = !!newState.channelId;

    if (!wasIn && isIn) {
      // Joined a voice channel
      joinTimes.set(userId, Date.now());
    } else if (wasIn && !isIn) {
      // Left voice entirely
      const joined = joinTimes.get(userId);
      if (joined) {
        joinTimes.delete(userId);
        const minutes = (Date.now() - joined) / 60000;
        const guildId = oldState.guild?.id;
        client.services?.messageStats?.recordVoiceMinutes(guildId, minutes);
      }
    } else if (wasIn && isIn && oldState.channelId !== newState.channelId) {
      // Switched channels — count time in old channel, start new timer
      const joined = joinTimes.get(userId);
      if (joined) {
        const minutes = (Date.now() - joined) / 60000;
        const guildId = oldState.guild?.id;
        client.services?.messageStats?.recordVoiceMinutes(guildId, minutes);
      }
      joinTimes.set(userId, Date.now());
    }
  });
};
