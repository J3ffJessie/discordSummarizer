const crypto = require('crypto');

class GiveawayService {
  constructor() {
    // One active giveaway per guild
    this.giveaways = new Map();
  }

  create(guildId, hostId, title, prize) {
    const id = crypto.randomBytes(4).toString('hex');
    const token = crypto.randomBytes(16).toString('hex');
    const giveaway = {
      id,
      guildId,
      hostId,
      title: title || 'Giveaway',
      prize: prize || '',
      participants: [],
      active: true,
      token,
      createdAt: Date.now(),
      messageId: null,
      channelId: null,
      selectedItem: null,
    };
    this.giveaways.set(guildId, giveaway);
    return giveaway;
  }

  get(guildId) {
    return this.giveaways.get(guildId) || null;
  }

  validate(guildId, id, token) {
    const g = this.giveaways.get(guildId);
    return (g && g.id === id && g.token === token) ? g : null;
  }

  addParticipant(guildId, userId, username, displayName) {
    const g = this.giveaways.get(guildId);
    if (!g || !g.active) return 'no_giveaway';
    if (g.participants.find(p => p.userId === userId)) return 'already_entered';
    g.participants.push({ userId, username, displayName });
    return 'ok';
  }

  setItem(guildId, id, token, item) {
    const g = this.validate(guildId, id, token);
    if (!g) return false;
    g.selectedItem = item || null;
    return true;
  }

  spin(guildId, id, token) {
    const g = this.validate(guildId, id, token);
    if (!g || !g.active || g.participants.length === 0) return null;
    const idx = Math.floor(Math.random() * g.participants.length);
    const winner = g.participants[idx];
    g.participants.splice(idx, 1);
    return { winner, remaining: [...g.participants] };
  }

  end(guildId) {
    const g = this.giveaways.get(guildId);
    if (g) g.active = false;
    return g || null;
  }
}

module.exports = { GiveawayService };
