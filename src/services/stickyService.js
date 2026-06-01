const Database = require('better-sqlite3');
const path = require('path');
const { ensureDataDir } = require('../utils/helpers');

const DB_PATH = path.join(ensureDataDir(), 'guild_config.db');

class StickyService {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sticky_messages (
        channel_id  TEXT PRIMARY KEY,
        guild_id    TEXT NOT NULL,
        content     TEXT NOT NULL,
        message_id  TEXT,
        created_by  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      )
    `);
  }

  getSticky(channelId) {
    return this.db.prepare('SELECT * FROM sticky_messages WHERE channel_id = ?').get(channelId) || null;
  }

  setSticky(channelId, guildId, content, createdBy, messageId = null) {
    const now = new Date().toISOString();
    const existing = this.getSticky(channelId);
    if (existing) {
      this.db.prepare(
        'UPDATE sticky_messages SET content = ?, message_id = ?, updated_at = ? WHERE channel_id = ?'
      ).run(content, messageId, now, channelId);
    } else {
      this.db.prepare(
        'INSERT INTO sticky_messages (channel_id, guild_id, content, message_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(channelId, guildId, content, messageId, createdBy, now, now);
    }
  }

  updateMessageId(channelId, messageId) {
    this.db.prepare('UPDATE sticky_messages SET message_id = ? WHERE channel_id = ?').run(messageId, channelId);
  }

  removeSticky(channelId) {
    this.db.prepare('DELETE FROM sticky_messages WHERE channel_id = ?').run(channelId);
  }

  getAllForGuild(guildId) {
    return this.db.prepare('SELECT * FROM sticky_messages WHERE guild_id = ?').all(guildId);
  }
}

module.exports = { StickyService };
