/*
  Refactored bootstrap for discord-summarizer.
  This file initializes the Discord client and wires in the modular command + event structure.
  The original index.js is preserved in the project root.
*/
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const http = require('http');

dotenv.config();

const commandsPath = path.join(__dirname, 'commands');
const eventsPath = path.join(__dirname, 'events');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.commands = new Collection();

// Load command modules
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    try {
      const command = require(filePath);
      if (command?.data && command?.execute) {
        client.commands.set(command.data.name, command);
      }
    } catch (err) {
      console.error(`Failed to load command ${file}:`, err?.message || err);
    }
  }
}

// Load event handlers and bind them
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'));
  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    try {
      const eventHandler = require(filePath);
      if (typeof eventHandler === 'function') {
        eventHandler(client);
      }
    } catch (err) {
      console.error(`Failed to load event ${file}:`, err?.message || err);
    }
  }
}

// Ready handler present in src/events/ready.js will be registered above when the file is loaded

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN not set in environment. Refactored bot will not log in.');
} else {
  client.login(token).catch((err) => {
    console.error('Failed to login refactored client:', err?.message || err);
  });
}

// Wire client into services that require it
const reminders = require('./services/reminders');
const scheduler = require('./services/scheduler');
reminders.init(client);
reminders.rescheduleAll();
scheduler.init(client);
// Start scheduled jobs if configured
scheduler.startScheduledJobs();


const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord summarizer bot is running.\n');
});
server.listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});

module.exports = client;
