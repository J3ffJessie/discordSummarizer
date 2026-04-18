const fs = require('fs');
const path = require('path');
const { delay, ensureDataDir } = require('../utils/helpers');

const STATS_FILE = () => path.join(ensureDataDir(), 'message_stats.json');
const BACKFILL_DAYS = 60;

class MessageStatsService {
  constructor() {
    this._data = this._load();
    this._saveTimer = null;
  }

  _load() {
    try {
      const file = STATS_FILE();
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        // Migrate old single-guild flat format
        if (parsed && !parsed.guilds) return { guilds: {} };
        return parsed;
      }
    } catch (err) {
      console.error('[messageStats] Failed to load stats file:', err.message);
    }
    return { guilds: {} };
  }

  _save() {
    try {
      fs.writeFileSync(STATS_FILE(), JSON.stringify(this._data, null, 2));
    } catch (err) {
      console.error('[messageStats] Failed to save stats file:', err.message);
    }
  }

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save();
    }, 5000);
  }

  _todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  _getGuildData(guildId) {
    if (!this._data.guilds[guildId]) {
      this._data.guilds[guildId] = { lastBackfill: null, daily: {} };
    }
    return this._data.guilds[guildId];
  }

  _increment(guildId, dateKey, channelId, channelName, userId, count = 1) {
    const gd = this._getGuildData(guildId);
    if (!gd.daily[dateKey]) {
      gd.daily[dateKey] = { total: 0, channels: {}, users: {} };
    }
    const day = gd.daily[dateKey];
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
    if (!message.guild) return;
    const dateKey = this._todayKey();
    this._increment(message.guild.id, dateKey, message.channel.id, message.channel.name || message.channel.id, message.author?.id);
    this._scheduleSave();
  }

  recordMemberJoin(member) {
    if (!member.guild) return;
    const gd = this._getGuildData(member.guild.id);
    const dateKey = this._todayKey();
    if (!gd.daily[dateKey]) {
      gd.daily[dateKey] = { total: 0, channels: {}, users: {} };
    }
    const day = gd.daily[dateKey];
    day.newMembers = (day.newMembers || 0) + 1;
    try {
      const created = new Date(Number((BigInt(member.user.id) >> 22n) + 1420070400000n));
      const ageDays = (Date.now() - created.getTime()) / 86400000;
      if (!day.accountAges) day.accountAges = { new: 0, established: 0, veteran: 0 };
      if (ageDays < 30) day.accountAges.new++;
      else if (ageDays < 365) day.accountAges.established++;
      else day.accountAges.veteran++;
    } catch {}
    this._scheduleSave();
  }

  recordMemberLeave(member) {
    if (!member.guild) return;
    const gd = this._getGuildData(member.guild.id);
    const dateKey = this._todayKey();
    if (!gd.daily[dateKey]) {
      gd.daily[dateKey] = { total: 0, channels: {}, users: {} };
    }
    gd.daily[dateKey].leaves = (gd.daily[dateKey].leaves || 0) + 1;
    this._scheduleSave();
  }

  recordVoiceMinutes(guildId, minutes) {
    if (!guildId || !minutes || minutes <= 0) return;
    const gd = this._getGuildData(guildId);
    const dateKey = this._todayKey();
    if (!gd.daily[dateKey]) {
      gd.daily[dateKey] = { total: 0, channels: {}, users: {} };
    }
    gd.daily[dateKey].voiceMinutes = (gd.daily[dateKey].voiceMinutes || 0) + minutes;
    this._scheduleSave();
  }

  async backfillHistory(client) {
    const now = Date.now();
    const cutoff = new Date(now - BACKFILL_DAYS * 24 * 60 * 60 * 1000);
    const cutoffKey = cutoff.toISOString().slice(0, 10);

    for (const [guildId, guild] of client.guilds.cache) {
      const gd = this._getGuildData(guildId);

      for (const dateKey of Object.keys(gd.daily)) {
        if (dateKey >= cutoffKey) delete gd.daily[dateKey];
      }

      console.log(`[messageStats] Starting backfill for ${guild.name} from ${cutoff.toISOString()}`);

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

      await this._backfillMembers(guildId, guild, cutoff);

      gd.lastBackfill = new Date().toISOString();
      this._save();
      console.log(`[messageStats] Backfill complete for ${guild.name}`);
    }
  }

  async _backfillMembers(guildId, guild, cutoff) {
    try {
      await guild.members.fetch();
    } catch (err) {
      console.warn('[messageStats] Could not fetch members for backfill:', err.message);
      return;
    }
    const gd = this._getGuildData(guildId);
    for (const [, member] of guild.members.cache) {
      if (!member.joinedAt || member.joinedAt < cutoff || member.user?.bot) continue;
      const dateKey = member.joinedAt.toISOString().slice(0, 10);
      if (!gd.daily[dateKey]) {
        gd.daily[dateKey] = { total: 0, channels: {}, users: {} };
      }
      const day = gd.daily[dateKey];
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
    this._scheduleSave();
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

      await delay(100);
    }

    this._scheduleSave();
  }

  getStats(guildId) {
    if (!guildId) return { lastBackfill: null, daily: {} };
    return this._data.guilds[guildId] || { lastBackfill: null, daily: {} };
  }
}

module.exports = { MessageStatsService };
