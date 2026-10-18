const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;
const TOKEN     = process.env.DISCORD_TOKEN;
const isGuild   = process.argv.includes('--guild');

if (!TOKEN || !CLIENT_ID) {
  console.error('DISCORD_TOKEN and CLIENT_ID must be set');
  process.exit(1);
}

if (isGuild && !GUILD_ID) {
  console.error('GUILD_ID must be set in .env to use --guild');
  process.exit(1);
}

const commandsPath = path.join(__dirname, '.');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js') && f !== 'register.js');
const commands = [];
for (const file of commandFiles) {
  const cmd = require(path.join(commandsPath, file));
  if (cmd && cmd.data) commands.push(cmd.data);
}

// Enabling Activities in the Developer Portal creates a global Entry Point
// command (the App Launcher's "Launch" button). A global bulk overwrite must
// include it or Discord rejects the whole request. handler 2 = Discord launches
// the Activity itself, so it never reaches interactionCreate.
const ENTRY_POINT_COMMAND = {
  name: 'launch',
  description: 'Launch Duck Hunt',
  type: 4,     // PRIMARY_ENTRY_POINT
  handler: 2,  // DISCORD_LAUNCH_ACTIVITY
};

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    if (isGuild) {
      console.log(`Registering commands to guild ${GUILD_ID} (instant)...`);
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    } else {
      console.log('Registering commands globally (~1 hour to propagate)...');
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [...commands, ENTRY_POINT_COMMAND] });
    }

    console.log('Commands registered');
  } catch (err) {
    console.error('Failed to register commands:', err?.message || err);
  }
})();
