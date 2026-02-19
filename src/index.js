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
const { Client, GatewayIntentBits, Collection } = require('discord.js');

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

const server = createHttpServer();
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

client.services = {
  sessionService,
  streamingService,
  voiceService,
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

const schedulerService = new SchedulerService(client);
schedulerService.start();

/* ===========================
   LOGIN
=========================== */

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN not set.');
} else {
  client.login(process.env.DISCORD_TOKEN).then(() => {
    logger.init(client);
  });
}

module.exports = client;
