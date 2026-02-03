# discord-summarizer (refactor)

This repository contains a Discord bot that summarizes conversations and offers utilities like coffee pairing and reminders.

Important:
- The original index.js at project root is preserved for backwards compatibility.
- A refactored modular version lives under src/ which splits commands, events, and services.

Getting started:
1. Copy .env.example to .env and fill in required values.
2. npm install
3. npm run start (runs the refactored bot at src/index.js)

Development:
- npm run dev (requires nodemon to be installed globally or as a dev dependency)
- Commands are in src/commands, events in src/events, services in src/services.

Notes:
- The refactor is intentionally run alongside the original index.js. You can switch to the refactored version fully after testing.
