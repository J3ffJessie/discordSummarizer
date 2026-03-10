/*
  Production bootstrap for discord-summarizer
  - Modular commands/events
  - Single HTTP server (Render safe)
  - WebSocket streaming
  - Voice + Whisper pipeline
  - Graceful shutdown
*/

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');

dotenv.config();

/* ===========================
   IMPORT SERVICES
=========================== */

const { createHttpServer } = require('./services/httpServer');
const { StreamingService } = require('./services/streamingService');
const { SessionService } = require('./services/sessionService');
const { VoiceService } = require('./services/voiceService');
const { TranscriptionService } = require('./services/transcriptionService');
const { TranslationService } = require('./services/translationService');
const { SchedulerService } = require('./services/schedulerService');
const { GuildConfigService } = require('./services/guildConfigService');
const { MessageStatsService } = require('./services/messageStatsService');
const logger = require('./utils/logger');

/* ===========================
   DISCORD CLIENT SETUP
=========================== */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.commands = new Collection();

/* ===========================
   LOAD COMMANDS
=========================== */

const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command?.data && command?.execute) {
      client.commands.set(command.data.name, command);
    }
  }
}

/* ===========================
   LOAD EVENTS
=========================== */

const eventsPath = path.join(__dirname, 'events');

if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

  for (const file of eventFiles) {
    const eventHandler = require(path.join(eventsPath, file));
    if (typeof eventHandler === 'function') {
      eventHandler(client);
    }
  }
}

/* ===========================
   HTTP SERVER (RENDER SAFE)
=========================== */

const PORT = process.env.PORT || 3000;

const guildConfigService = new GuildConfigService();
const messageStatsService = new MessageStatsService();

const server = createHttpServer({
  getStats: (guildId) => messageStatsService.getStats(guildId),
  getGuild: (guildId) => {
    const guild = client.guilds.cache.get(guildId || process.env.GUILD_ID);
    if (!guild) return null;
    return { name: guild.name, iconURL: guild.iconURL({ size: 64 }) };
  },
  getMembers: (guildId) => {
    const guild = client.guilds.cache.get(guildId || process.env.GUILD_ID);
    if (!guild) return null;
    const cachedMembers = guild.members.cache;
    const botCount = cachedMembers.filter(m => m.user.bot).size;
    const roleCounts = new Map();
    for (const [, member] of cachedMembers) {
      if (member.user.bot) continue;
      for (const [, role] of member.roles.cache) {
        if (role.name === '@everyone') continue;
        const existing = roleCounts.get(role.id);
        roleCounts.set(role.id, {
          name: role.name,
          color: role.hexColor !== '#000000' ? role.hexColor : '#99aab5',
          count: (existing?.count || 0) + 1,
        });
      }
    }
    const topRoles = [...roleCounts.values()]
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
    const channels = guild.channels.cache;
    const textChannelCount = channels.filter(c => c.isTextBased() && !c.isDMBased() && !c.isThread()).size;
    const voiceChannelCount = channels.filter(c => !c.isDMBased() && c.isVoiceBased?.()).size;
    return {
      totalMembers: guild.memberCount,
      humanCount: guild.memberCount - botCount,
      botCount,
      boostTier: guild.premiumTier,
      boostCount: guild.premiumSubscriptionCount || 0,
      textChannelCount,
      voiceChannelCount,
      roleCount: guild.roles.cache.size - 1,
      topRoles,
    };
  },
});
const sessionService = new SessionService();
const streamingService = new StreamingService(server, sessionService);

const transcriptionService = new TranscriptionService();
const translationService = new TranslationService();

const voiceService = new VoiceService(
  client,
  sessionService,
  streamingService,
  transcriptionService,
  translationService
);

const schedulerService = new SchedulerService(client, guildConfigService);

client.services = {
  guildConfigService,
  sessionService,
  streamingService,
  voiceService,
  schedulerService,
  messageStats: messageStatsService,
};

server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

/* ===========================
   GRACEFUL SHUTDOWN
=========================== */

function shutdown() {
  console.log('Graceful shutdown initiated...');

  for (const guildId of sessionService.sessions.keys()) {
    voiceService.stop(guildId);
    sessionService.deleteSession(guildId);
  }

  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);


/* ===========================
   SCHEDULER
=========================== */

schedulerService.start();

/* ===========================
   LOGIN
=========================== */

client.once(Events.ClientReady, () => {
  messageStatsService.backfillHistory(client).catch(err => {
    console.error('[messageStats] Backfill error:', err.message);
  });
});

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN not set.');
} else {
  client.login(process.env.DISCORD_TOKEN).then(() => {
    logger.init(client);
  }).catch((err) => {
    console.error('Discord login failed:', err.message);
    process.exit(1);
  });
}

module.exports = client;
