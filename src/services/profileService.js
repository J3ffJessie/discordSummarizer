const Database = require('better-sqlite3');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { ensureDataDir } = require('../utils/helpers');

const DB_PATH = path.join(ensureDataDir(), 'profiles.db');

class ProfileService {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS member_profiles (
        guild_id   TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        bio        TEXT,
        title      TEXT,
        skills     TEXT,
        timezone   TEXT,
        networking INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      )
    `);
  }

  getProfile(guildId, userId) {
    return this.db.prepare(
      'SELECT * FROM member_profiles WHERE guild_id = ? AND user_id = ?'
    ).get(guildId, userId) || null;
  }

  upsertProfile(guildId, userId, fields) {
    const now = new Date().toISOString();
    const existing = this.getProfile(guildId, userId);

    if (!existing) {
      this.db.prepare(`
        INSERT INTO member_profiles (guild_id, user_id, bio, title, skills, timezone, networking, updated_at)
        VALUES (@guild_id, @user_id, @bio, @title, @skills, @timezone, @networking, @updated_at)
      `).run({
        guild_id: guildId,
        user_id: userId,
        bio: null,
        title: null,
        skills: null,
        timezone: null,
        networking: 0,
        ...fields,
        updated_at: now,
      });
    } else {
      const keys = Object.keys(fields);
      if (keys.length === 0) return this.getProfile(guildId, userId);
      const setClauses = keys.map(k => `${k} = @${k}`).join(', ');
      this.db.prepare(`
        UPDATE member_profiles SET ${setClauses}, updated_at = @updated_at
        WHERE guild_id = @guild_id AND user_id = @user_id
      `).run({ ...fields, updated_at: now, guild_id: guildId, user_id: userId });
    }

    return this.getProfile(guildId, userId);
  }
}

function buildProfileEmbed(user, member, profile) {
  const displayName = member?.displayName || user?.globalName || user?.username || 'Unknown';
  const color = member?.displayHexColor && member.displayHexColor !== '#000000'
    ? member.displayHexColor
    : 0x5865F2;

  const embed = new EmbedBuilder()
    .setTitle(displayName)
    .setThumbnail(user?.displayAvatarURL?.({ size: 128 }) ?? null)
    .setColor(color);

  if (member?.joinedAt) {
    const joined = member.joinedAt.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    embed.setFooter({ text: `Member since ${joined}` });
  }

  const hasData = profile && (profile.bio || profile.title || profile.skills || profile.timezone || profile.networking);
  if (!hasData) {
    embed.setDescription('*No profile set up yet. Use `/profile edit` to add your info.*');
    return embed;
  }

  if (profile.bio) embed.setDescription(profile.bio);

  const fields = [];
  if (profile.title)    fields.push({ name: 'Role',              value: profile.title,    inline: true });
  if (profile.timezone) fields.push({ name: 'Timezone',          value: profile.timezone, inline: true });
  if (profile.skills)   fields.push({ name: 'Skills & Interests', value: profile.skills });
  fields.push({
    name: 'Networking',
    value: profile.networking ? '✅ Open to connect' : '❌ Not currently looking',
    inline: true,
  });

  embed.addFields(fields);
  return embed;
}

module.exports = { ProfileService, buildProfileEmbed };
