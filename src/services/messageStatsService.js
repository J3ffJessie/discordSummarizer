const fs = require('fs');
const path = require('path');
const { delay, ensureDataDir } = require('../utils/helpers');

const STATS_FILE = (guildId) => path.join(ensureDataDir(), `message_stats_${guildId}.json`);
const BACKFILL_DAYS = 60;

class MessageStatsService {
  constructor() {
    this._guilds = new Map();     // guildId -> { lastBackfill, daily }
    this._saveTimers = new Map(); // guildId -> timer
  }

  _loadGuild(guildId) {
    if (this._guilds.has(guildId)) return this._guilds.get(guildId);
    let data = { lastBackfill: null, daily: {} };
    try {
      const file = STATS_FILE(guildId);
      if (fs.existsSync(file)) {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch (err) {
      console.error(`[messageStats] Failed to load stats for guild ${guildId}:`, err.message);
    }
    this._guilds.set(guildId, data);
    return data;
  }

  _save(guildId) {
    const data = this._guilds.get(guildId);
    if (!data) return;
    try {
      fs.writeFileSync(STATS_FILE(guildId), JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`[messageStats] Failed to save stats for guild ${guildId}:`, err.message);
    }
  }

  _scheduleSave(guildId) {
    if (this._saveTimers.has(guildId)) clearTimeout(this._saveTimers.get(guildId));
    this._saveTimers.set(guildId, setTimeout(() => {
      this._saveTimers.delete(guildId);
      this._save(guildId);
    }, 5000));
  }

  _todayKey() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  }

  _increment(guildId, dateKey, channelId, channelName, userId, count = 1) {
    const data = this._loadGuild(guildId);
    if (!data.daily[dateKey]) {
      data.daily[dateKey] = { total: 0, channels: {}, users: {} };
    }
    const day = data.daily[dateKey];
    day.total = (day.total || 0) + count;

    if (!day.channels[channelId]) {
      day.channels[channelId] = { name: channelName, count: 0 };
    }
    day.channels[channelId].name = channelName;
    day.channels[channelId].count += count;

    if (userId) {
      if (!day.users) day.users = {};
      day.users[userId] = (day.users[userId] || 0) + count;
    }
  }

  recordMessage(message) {
    if (!message.guild) return; // Ignore DMs
    const guildId = message.guild.id;
    const dateKey = this._todayKey();
    this._increment(guildId, dateKey, message.channel.id, message.channel.name || message.channel.id, message.author?.id);
    this._scheduleSave(guildId);
  }

  recordMemberJoin(member) {
    if (!member.guild) return;
    const guildId = member.guild.id;
    const dateKey = this._todayKey();
    const data = this._loadGuild(guildId);
    if (!data.daily[dateKey]) {
      data.daily[dateKey] = { total: 0, channels: {}, users: {} };
    }
    const day = data.daily[dateKey];
    day.newMembers = (day.newMembers || 0) + 1;
    try {
      const created = new Date(Number((BigInt(member.user.id) >> 22n) + 1420070400000n));
      const ageDays = (Date.now() - created.getTime()) / 86400000;
      if (!day.accountAges) day.accountAges = { new: 0, established: 0, veteran: 0 };
      if (ageDays < 30) day.accountAges.new++;
      else if (ageDays < 365) day.accountAges.established++;
      else day.accountAges.veteran++;
    } catch {}
    this._scheduleSave(guildId);
  }

  recordMemberLeave(member) {
    if (!member.guild) return;
    const guildId = member.guild.id;
    const dateKey = this._todayKey();
    const data = this._loadGuild(guildId);
    if (!data.daily[dateKey]) {
      data.daily[dateKey] = { total: 0, channels: {}, users: {} };
    }
    data.daily[dateKey].leaves = (data.daily[dateKey].leaves || 0) + 1;
    this._scheduleSave(guildId);
  }

  recordVoiceMinutes(guildId, minutes) {
    if (!guildId || !minutes || minutes <= 0) return;
    const dateKey = this._todayKey();
    const data = this._loadGuild(guildId);
    if (!data.daily[dateKey]) {
      data.daily[dateKey] = { total: 0, channels: {}, users: {} };
    }
    data.daily[dateKey].voiceMinutes = (data.daily[dateKey].voiceMinutes || 0) + minutes;
    this._scheduleSave(guildId);
  }

  async backfillHistory(client) {
    for (const [, guild] of client.guilds.cache) {
      await this._backfillGuild(guild);
    }
  }

  async _backfillGuild(guild) {
    const guildId = guild.id;
    const data = this._loadGuild(guildId);
    const now = Date.now();
    const cutoff = new Date(now - BACKFILL_DAYS * 24 * 60 * 60 * 1000);

    // Clear existing data for the backfill window so re-runs don't double-count.
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    for (const dateKey of Object.keys(data.daily)) {
      if (dateKey >= cutoffKey) delete data.daily[dateKey];
    }

    console.log(`[messageStats] Starting backfill for guild "${guild.name}" from ${cutoffKey}`);

    const channels = guild.channels.cache.filter(
      c => c.isTextBased() && !c.isDMBased() && c.viewable
    );

    for (const [, channel] of channels) {
      try {
        await this._backfillChannel(guildId, channel, cutoff);
        await delay(200);
      } catch (err) {
        console.error(`[messageStats] Error backfilling #${channel.name}:`, err.message);
      }
    }

    await this._backfillMembers(guild, cutoff);

    data.lastBackfill = new Date().toISOString();
    this._save(guildId);
    console.log(`[messageStats] Backfill complete for guild "${guild.name}"`);
  }

  async _backfillMembers(guild, cutoff) {
    const guildId = guild.id;
    const data = this._loadGuild(guildId);
    try {
      await guild.members.fetch();
    } catch (err) {
      console.warn(`[messageStats] Could not fetch members for guild "${guild.name}":`, err.message);
      return;
    }
    for (const [, member] of guild.members.cache) {
      if (!member.joinedAt || member.joinedAt < cutoff || member.user?.bot) continue;
      const dateKey = member.joinedAt.toISOString().slice(0, 10);
      if (!data.daily[dateKey]) {
        data.daily[dateKey] = { total: 0, channels: {}, users: {} };
      }
      const day = data.daily[dateKey];
      day.newMembers = (day.newMembers || 0) + 1;
      try {
        const created = new Date(Number((BigInt(member.user.id) >> 22n) + 1420070400000n));
        const ageDays = (member.joinedAt.getTime() - created.getTime()) / 86400000;
        if (!day.accountAges) day.accountAges = { new: 0, established: 0, veteran: 0 };
        if (ageDays < 30) day.accountAges.new++;
        else if (ageDays < 365) day.accountAges.established++;
        else day.accountAges.veteran++;
      } catch {}
    }
    this._scheduleSave(guildId);
  }

  async _backfillChannel(guildId, channel, cutoff) {
    let lastId = null;
    let done = false;

    while (!done) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      const messages = await channel.messages.fetch(options);
      if (messages.size === 0) break;

      for (const [, msg] of messages) {
        if (msg.createdAt < cutoff) {
          done = true;
          break;
        }
        if (msg.author?.bot) continue;
        const dateKey = msg.createdAt.toISOString().slice(0, 10);
        this._increment(guildId, dateKey, channel.id, channel.name, msg.author?.id);
      }

      lastId = messages.last()?.id;
      if (messages.size < 100) break;

      await delay(100); // Small pause between pages
    }

    this._scheduleSave(guildId);
  }

  getStats(guildId) {
    if (guildId) return this._loadGuild(guildId);
    // Fallback: return first loaded guild's data
    const first = [...this._guilds.values()][0];
    return first || { lastBackfill: null, daily: {} };
  }
}

module.exports = { MessageStatsService };
