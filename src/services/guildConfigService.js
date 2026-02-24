const Database = require('better-sqlite3');
const path = require('path');
const { ensureDataDir } = require('../utils/helpers');

const DB_PATH = path.join(ensureDataDir(), 'guild_config.db');

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id             TEXT PRIMARY KEY,
    summary_channel_id   TEXT,
    summary_enabled      INTEGER NOT NULL DEFAULT 0,
    summary_cron         TEXT    NOT NULL DEFAULT '0 10 * * 1',
    coffee_enabled       INTEGER NOT NULL DEFAULT 0,
    coffee_role_name     TEXT    NOT NULL DEFAULT 'coffee chat',
    coffee_cron          TEXT,
    coffee_biweekly      INTEGER NOT NULL DEFAULT 0,
    coffee_cooldown_days INTEGER NOT NULL DEFAULT 30,
    timezone             TEXT    NOT NULL DEFAULT 'UTC',
    created_at           TEXT    NOT NULL,
    updated_at           TEXT    NOT NULL
  )
`;

class GuildConfigService {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.exec(CREATE_TABLE);
  }

  getConfig(guildId) {
    return this.db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId) || null;
  }

  upsertConfig(guildId, fields) {
    const now = new Date().toISOString();
    const existing = this.getConfig(guildId);

    if (!existing) {
      const defaults = {
        summary_channel_id: null,
        summary_enabled: 0,
        summary_cron: process.env.SERVER_SUMMARY_CRON || '0 10 * * 1',
        coffee_enabled: 0,
        coffee_role_name: process.env.COFFEE_ROLE_NAME || 'coffee chat',
        coffee_cron: process.env.COFFEE_CRON_SCHEDULE || process.env.COFFEE_CRON || null,
        coffee_biweekly: process.env.COFFEE_BIWEEKLY === 'true' ? 1 : 0,
        coffee_cooldown_days: Number(process.env.COFFEE_PAIRING_COOLDOWN_DAYS || 30),
        timezone: process.env.CRON_TIMEZONE || 'UTC',
      };
      const row = { ...defaults, ...fields, guild_id: guildId, created_at: now, updated_at: now };
      this.db.prepare(`
        INSERT INTO guild_config
          (guild_id, summary_channel_id, summary_enabled, summary_cron,
           coffee_enabled, coffee_role_name, coffee_cron, coffee_biweekly,
           coffee_cooldown_days, timezone, created_at, updated_at)
        VALUES
          (@guild_id, @summary_channel_id, @summary_enabled, @summary_cron,
           @coffee_enabled, @coffee_role_name, @coffee_cron, @coffee_biweekly,
           @coffee_cooldown_days, @timezone, @created_at, @updated_at)
      `).run(row);
    } else {
      const updates = { ...fields, updated_at: now, guild_id: guildId };
      const setClauses = Object.keys(fields).map(k => `${k} = @${k}`).join(', ');
      this.db.prepare(`
        UPDATE guild_config SET ${setClauses}, updated_at = @updated_at WHERE guild_id = @guild_id
      `).run(updates);
    }

    return this.getConfig(guildId);
  }

  getAllWithSummaryEnabled() {
    return this.db.prepare('SELECT * FROM guild_config WHERE summary_enabled = 1').all();
  }

  getAllWithCoffeeEnabled() {
    return this.db.prepare('SELECT * FROM guild_config WHERE coffee_enabled = 1').all();
  }
}

module.exports = { GuildConfigService };
