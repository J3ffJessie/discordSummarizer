const crypto = require('crypto');

class SessionService {
  constructor() {
    this.sessions = new Map();
  }

  createSession(guildId) {
    const token = crypto.randomBytes(16).toString('hex');

    const session = {
      token,
      captions: [],
      clients: new Set(),
      createdAt: Date.now(),
    };

    this.sessions.set(guildId, session);

    setTimeout(() => {
      this.deleteSession(guildId);
    }, 1000 * 60 * 60);

    return session;
  }

  getSession(guildId) {
    return this.sessions.get(guildId);
  }

  deleteSession(guildId) {
    this.sessions.delete(guildId);
  }

  validateSession(guildId, token) {
    const session = this.sessions.get(guildId);
    if (!session || session.token !== token) return null;
    return session;
  }
}

module.exports = { SessionService };
