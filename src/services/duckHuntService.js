const Database = require('better-sqlite3');
const axios = require('axios');
const path = require('path');
const { ensureDataDir } = require('../utils/helpers');

const DB_PATH = path.join(ensureDataDir(), 'guild_config.db');
const DISCORD_API_BASE = 'https://discord.com/api/v10';

// Upper bounds for a single submitted game. The game runs client-side, so these
// only reject obviously bogus submissions — they are not anti-cheat.
const MAX_SCORE = 999999;
const MAX_DUCKS = 1000;
const MAX_ROUND = 99;

class DuckHuntService {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS duckhunt_scores (
        guild_id      TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        username      TEXT NOT NULL,
        best_score    INTEGER NOT NULL DEFAULT 0,
        best_round    INTEGER NOT NULL DEFAULT 0,
        total_ducks   INTEGER NOT NULL DEFAULT 0,
        games_played  INTEGER NOT NULL DEFAULT 0,
        updated_at    TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      )
    `);
  }

  // Exchanges the code from the Activity's sdk.commands.authorize() for an
  // access token. The client secret never leaves the server.
  async exchangeCode(code) {
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('CLIENT_ID and DISCORD_CLIENT_SECRET must be set');
    }

    const resp = await axios.post(`${DISCORD_API_BASE}/oauth2/token`,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return resp.data.access_token;
  }

  // Resolves an Activity access token to the Discord user it belongs to, so
  // score submissions can't claim to be someone else.
  async fetchUser(accessToken) {
    const resp = await axios.get(`${DISCORD_API_BASE}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return resp.data;
  }

  isValidResult({ score, ducks, round }) {
    return [score, ducks, round].every(Number.isInteger)
      && score >= 0 && score <= MAX_SCORE
      && ducks >= 0 && ducks <= MAX_DUCKS
      && round >= 1 && round <= MAX_ROUND;
  }

  getPlayer(guildId, userId) {
    return this.db.prepare(
      'SELECT * FROM duckhunt_scores WHERE guild_id = ? AND user_id = ?'
    ).get(guildId, userId) || null;
  }

  // Records a finished game. Returns { player, isPersonalBest }.
  recordGame(guildId, userId, username, { score, ducks, round }) {
    const now = new Date().toISOString();
    const existing = this.getPlayer(guildId, userId);
    const isPersonalBest = !existing || score > existing.best_score;

    if (existing) {
      this.db.prepare(`
        UPDATE duckhunt_scores
        SET username = ?, best_score = MAX(best_score, ?), best_round = MAX(best_round, ?),
            total_ducks = total_ducks + ?, games_played = games_played + 1, updated_at = ?
        WHERE guild_id = ? AND user_id = ?
      `).run(username, score, round, ducks, now, guildId, userId);
    } else {
      this.db.prepare(`
        INSERT INTO duckhunt_scores
          (guild_id, user_id, username, best_score, best_round, total_ducks, games_played, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `).run(guildId, userId, username, score, round, ducks, now);
    }

    return { player: this.getPlayer(guildId, userId), isPersonalBest };
  }

  getLeaderboard(guildId, limit = 10) {
    return this.db.prepare(`
      SELECT user_id, username, best_score, best_round, total_ducks, games_played
      FROM duckhunt_scores
      WHERE guild_id = ?
      ORDER BY best_score DESC, updated_at ASC
      LIMIT ?
    `).all(guildId, limit);
  }
}

module.exports = { DuckHuntService };
