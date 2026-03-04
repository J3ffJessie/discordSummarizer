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
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch (err) {
      console.error('[messageStats] Failed to load stats file:', err.message);
    }
    return { lastBackfill: null, daily: {} };
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
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  }

  _increment(dateKey, channelId, channelName, userId, count = 1) {
    if (!this._data.daily[dateKey]) {
      this._data.daily[dateKey] = { total: 0, channels: {}, users: {} };
    }
    const day = this._data.daily[dateKey];
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
    const dateKey = this._todayKey();
    const channelId = message.channel.id;
    const channelName = message.channel.name || channelId;
    const userId = message.author?.id;
    this._increment(dateKey, channelId, channelName, userId);
    this._scheduleSave();
  }

  recordMemberJoin(member) {
    if (!member.guild) return;
    const dateKey = this._todayKey();
    if (!this._data.daily[dateKey]) {
      this._data.daily[dateKey] = { total: 0, channels: {}, users: {} };
    }
    const day = this._data.daily[dateKey];
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
    const dateKey = this._todayKey();
    if (!this._data.daily[dateKey]) {
      this._data.daily[dateKey] = { total: 0, channels: {}, users: {} };
    }
    this._data.daily[dateKey].leaves = (this._data.daily[dateKey].leaves || 0) + 1;
    this._scheduleSave();
  }

  async backfillHistory(client) {
    const now = Date.now();

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
      console.warn('[messageStats] GUILD_ID not set — skipping backfill');
      return;
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.warn('[messageStats] Guild not found in cache — skipping backfill');
      return;
    }

    const cutoff = new Date(now - BACKFILL_DAYS * 24 * 60 * 60 * 1000);

    // Clear existing data for the backfill window so re-runs don't double-count.
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    for (const dateKey of Object.keys(this._data.daily)) {
      if (dateKey >= cutoffKey) delete this._data.daily[dateKey];
    }

    console.log(`[messageStats] Starting backfill from ${cutoff.toISOString()}`);

    const channels = guild.channels.cache.filter(
      c => c.isTextBased() && !c.isDMBased() && c.viewable
    );

    for (const [, channel] of channels) {
      try {
        await this._backfillChannel(channel, cutoff);
        await delay(200);
      } catch (err) {
        console.error(`[messageStats] Error backfilling #${channel.name}:`, err.message);
      }
    }

    await this._backfillMembers(guild, cutoff);

    this._data.lastBackfill = new Date().toISOString();
    this._save();
    console.log('[messageStats] Backfill complete');
  }

  async _backfillMembers(guild, cutoff) {
    try {
      await guild.members.fetch();
    } catch (err) {
      console.warn('[messageStats] Could not fetch members for backfill:', err.message);
      return;
    }
    for (const [, member] of guild.members.cache) {
      if (!member.joinedAt || member.joinedAt < cutoff || member.user?.bot) continue;
      const dateKey = member.joinedAt.toISOString().slice(0, 10);
      if (!this._data.daily[dateKey]) {
        this._data.daily[dateKey] = { total: 0, channels: {}, users: {} };
      }
      const day = this._data.daily[dateKey];
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

  async _backfillChannel(channel, cutoff) {
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
        this._increment(dateKey, channel.id, channel.name, msg.author?.id);
      }

      lastId = messages.last()?.id;
      if (messages.size < 100) break;

      await delay(100); // Small pause between pages
    }

    this._scheduleSave();
  }

  getStats() {
    return this._data;
  }
}

module.exports = { MessageStatsService };
