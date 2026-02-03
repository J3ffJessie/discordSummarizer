# discord-summarizer (refactor)

This repository contains a Discord bot that summarizes conversations and offers utilities like coffee pairing and reminders.

Important:
1. Set up a .env file with values for Discord Client/Application/Server as well as Groq or AI provider of your choice API key
2. npm install
3. npm run start (runs the refactored bot at src/index.js)

Development:
- npm run dev (requires nodemon to be installed globally or as a dev dependency)
- Commands are in src/commands, events in src/events, services in src/services.

Notes:
- The base index.js file is temporarily staying in place commented until I can ensure all functionality is working and will be removed in a later push
