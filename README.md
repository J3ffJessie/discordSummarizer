# Discord Summarizer Bot

A Discord bot with live voice translation, server summarization, coffee chat pairing, reminders, and more. Hosted on Render.

---

## Features

- **Live voice translation** — Captures voice channel audio, transcribes with Whisper, translates with LLaMA, and streams captions to a web page in near real-time
- **Server summarization** — Summarizes recent messages across all text channels using Groq AI
- **Coffee chat pairing** — Randomly pairs members with a designated role and DMs them to set up meetings
- **Reminders** — Set, list, and cancel personal reminders delivered via DM
- **Events** — Fetch and display upcoming server events
- **Location tracking** — Scan messages for location mentions and export a locations report

---

## Prerequisites

- Node.js >= 20
- A Discord application and bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- A Groq API key ([console.groq.com](https://console.groq.com))

---

## Installation

```bash
git clone https://github.com/your-repo/discord-summarizer.git
cd discord-summarizer
npm install
```

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Your bot token from the Discord Developer Portal |
| `CLIENT_ID` | Yes | Your application/bot ID |
| `GUILD_ID` | Yes | Your Discord server ID |
| `GROQ_API_KEY` | Yes | Groq API key for Whisper transcription and LLaMA translation |
| `CAPTION_URL` | Yes (production) | Public URL of the service — used to generate the captions link. Set to your Host URL if available or localhost if running locally (e.g. `https://your-app.onrender.com`) |
| `TARGET_CHANNEL_ID` | Yes (for summary) | Channel ID where the weekly server summary is posted |
| `ADMIN_USER_ID` | No | Discord user ID to receive admin notifications via DM |
| `ALLOWED_USER_IDS` | No | Comma-separated user IDs permitted to run admin commands |
| `SERVER_SUMMARY_CRON` | No | Cron expression for weekly summary (default: `0 10 * * 1` — Mondays at 10:00) |
| `COFFEE_CRON_SCHEDULE` | No | Cron expression for coffee pairing (e.g. `0 5 * * 1`) |
| `COFFEE_BIWEEKLY` | No | Set to `true` to run coffee pairing every other Monday instead of weekly |
| `COFFEE_ROLE_NAME` | No | Name of the role to include in coffee pairing (default: `coffee chat`) |
| `COFFEE_PAIRING_COOLDOWN_DAYS` | No | Days before the same two people can be re-paired (default: `30`) |
| `CRON_TIMEZONE` | No | IANA timezone for all cron jobs (default: `UTC`). Example: `America/New_York` |
| `PORT` | No | HTTP server port — set automatically by Render |

---

## Registering Slash Commands

Run this once after setup, or any time you add or change commands:

```bash
npm run register-commands
```

This registers all slash commands to the guild specified by `GUILD_ID`. Guild commands are available instantly.

---

## Running the Bot

**Production:**
```bash
npm start
```

**Development (with auto-restart):**
```bash
npm run dev
```

---

## Slash Commands

### `/translate`
Start or stop live voice translation in a voice channel.

| Subcommand | Description |
|-----------|-------------|
| `start` | Join your current voice channel and begin live translation. Posts a captions URL to the channel. You must be in a voice channel. |
| `stop` | Stop translation and end the session. |

Sessions auto-expire after 1 hour. See [TRANSLATION.md](TRANSLATION.md) for a full technical breakdown of how the translation pipeline works.

---

### `/summarize`
Summarizes the last 100 messages in the current channel and DMs the result to you.

---

### `/server-summary`
*(Admin only)* Gathers recent messages from all visible text channels and posts an AI-generated summary to the configured `TARGET_CHANNEL_ID`.

---

### `/coffee-pair`
*(Admin only)* Randomly pairs members who have the coffee chat role and DMs each person their partner's name. Respects the cooldown period so the same pair isn't repeated too soon.

---

### `/coffee-list`
*(Admin only)* Lists all members currently assigned the coffee chat role. Useful for verifying who is eligible for pairing.

---

### `/remindme`
Set a personal reminder delivered to your DMs.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `time` | String | Yes | How long from now (e.g. `2 hours`, `3 days`) |
| `message` | String | Yes | What to remind you about |

---

### `/listreminders`
Lists all your active reminders with their IDs and time remaining.

---

### `/cancelreminder`
Cancel a reminder by ID, or cancel all of your reminders at once.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | String | Yes | Reminder ID from `/listreminders`, or `all` to cancel everything |

---

### `/events`
Fetches and DMs you the next 7 days of scheduled server events (up to 10).

---

### `/location`
*(Admin only)* Scans recent messages for location mentions and logs them to `locations.log`.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `limit` | Integer | No | Number of messages to scan (max 100, default 100) |

---

### `/downloadlocations`
*(Admin only)* Exports the locations log as a JSON file and DMs it to you.

---

## Scheduled Jobs

Both jobs use the `CRON_TIMEZONE` environment variable. Set this to your local timezone so they fire at the right time (Render runs UTC by default).

### Weekly Server Summary
- **Default schedule:** Every Monday at 10:00 UTC (`0 10 * * 1`)
- **Override:** Set `SERVER_SUMMARY_CRON` to any valid cron expression
- **What it does:** Gathers messages from all visible text channels and posts an AI summary to `TARGET_CHANNEL_ID`

### Coffee Chat Pairing
- **Schedule:** Set via `COFFEE_CRON_SCHEDULE` or `COFFEE_CRON` (no default — must be configured)
- **Biweekly mode:** Set `COFFEE_BIWEEKLY=true` to run every other Monday. The cron expression still runs weekly — the skip logic is handled in code based on ISO week number (runs on even weeks: 2, 4, 6…)
- **What it does:** Pairs members with the coffee chat role and DMs each person their partner

---

## Project Structure

```
discord-summarizer/
├── src/
│   ├── index.js                    # Entry point — bootstraps all services and the Discord client
│   ├── commands/                   # One file per slash command
│   │   ├── translate.js
│   │   ├── summarize.js
│   │   ├── server-summary.js
│   │   ├── coffee-pair.js
│   │   ├── coffee-list.js
│   │   ├── remindme.js
│   │   ├── listreminders.js
│   │   ├── cancelreminder.js
│   │   ├── events.js
│   │   ├── location.js
│   │   └── downloadlocations.js
│   ├── events/
│   │   └── interactionCreate.js    # Routes slash command interactions to the right command file
│   ├── services/
│   │   ├── voiceService.js         # Voice capture and per-frame Opus decoding
│   │   ├── transcriptionService.js # PCM→WAV conversion and Whisper API calls
│   │   ├── translationService.js   # LLaMA translation via Groq
│   │   ├── streamingService.js     # WebSocket server — broadcasts captions to browser clients
│   │   ├── sessionService.js       # Per-guild session management with token auth
│   │   ├── schedulerService.js     # Cron job management (summary + coffee pairing)
│   │   ├── httpServer.js           # HTTP server — serves static files and health check
│   │   ├── coffee.js               # Coffee pairing logic (matching algorithm, DM sending)
│   │   └── gather.js               # Message gathering and summarization for server summary
│   └── utils/
│       ├── helpers.js              # Shared utilities (delay, ensureDataDir)
│       └── logger.js               # Admin DM notifications and error logging
├── public/
│   ├── captions.html               # Live captions web page (WebSocket client)
│   └── torc-logo.png               # Bot logo
├── register-commands.js            # Run this to register slash commands with Discord
├── package.json
└── .env.example                    # Template for all environment variables
```

---

## Deployment (Render)

1. Push your code to GitHub
2. Create a new **Web Service** on Render connected to your repo
3. Set the **Start Command** to `npm start`
4. Add all required environment variables in the Render dashboard
5. Use a **paid plan** with **Always On** enabled — the free tier sleeps after inactivity and will disconnect the bot

The bot uses no native binaries (`opusscript` is WASM, `@noble/ciphers` is pure JS), so it builds and runs on Render's Linux environment without any extra configuration.
