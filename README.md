# Discord Summarizer Bot

A Discord bot with live voice translation, server summarization, coffee chat pairing, reminders, and more. Designed for multi-server use — each server admin configures their own settings and AI provider keys through a web dashboard, with no access to any other server's data.

---

## Features

- **Live voice translation** — Captures voice channel audio, transcribes with Whisper, translates via your chosen AI provider, and streams captions to a web page in near real-time
- **Server summarization** — Summarizes recent messages across all text channels using your configured AI provider
- **Automated weekly summaries** — Scheduled AI-generated server summaries posted to a configured channel
- **Coffee chat pairing** — Randomly pairs members with a designated role and announces pairings in a configured channel (falls back to DMs if no channel is set)
- **Web dashboard** — Admins configure all settings and AI provider keys through a browser UI (no slash commands required for setup)
- **Reminders** — Set, list, and cancel personal reminders delivered via DM
- **Events** — Fetch and display upcoming server events

---

## How it works for server admins

1. Invite the bot to your server
2. Run `/setup dashboard` — the bot replies with a private, time-limited link
3. Open the link to access your server's configuration dashboard
4. Set your summary channel, coffee pairing channel and schedule, AI provider, and API keys
5. Done — all settings are saved per-server and persist across bot updates

Each server's configuration is completely isolated. API keys entered on the dashboard are stored only for that server and are never visible to other servers or bot owners.

---

## Prerequisites

- Node.js >= 20
- A Discord application and bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- Each server admin will need their own AI provider API key — the bot does not include a shared key. Supported providers:
  - [Groq](https://console.groq.com) — Fast, free tier available (recommended)
  - OpenAI, Anthropic (Claude), Ollama (local), or any OpenAI-compatible endpoint

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

These are the only variables you need to set. Per-server settings (AI provider, keys, channels, schedules) are configured by each guild admin through the dashboard — not here.

### Required

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Your bot token from the Discord Developer Portal |
| `CLIENT_ID` | Your application/bot ID |
| `PUBLIC_URL` | Public URL of this service — used to generate dashboard links. Set to `http://localhost:3000` for local dev, or your Render URL in production (e.g. `https://your-app.onrender.com`) |
| `DATA_DIR` | Path where the database and data files are stored. Set to `/data` on Render (persistent disk mount path). Defaults to `src/data/` if unset. |

### Optional

| Variable | Description |
|----------|-------------|
| `ADMIN_USER_ID` | Your Discord user ID — the bot will DM you error alerts |
| `ALLOWED_USER_IDS` | Comma-separated user IDs permitted to run bot-owner commands (`/server-summary`, `/paircoffee`, etc.) |
| `CAPTION_URL` | Public URL for the live captions page — only needed if using the voice translation feature. Can be the same as `PUBLIC_URL`. |
| `PORT` | HTTP server port — set automatically by Render, defaults to `3000` |

> **No AI keys needed at the bot level.** Each server admin provides their own API key through the dashboard. If you want a fallback key for testing, you can set `GROQ_API_KEY` — but this is not required and should not be used in production to avoid unexpected costs.

---

## Registering Slash Commands

Run this once after setup, and again any time commands change:

```bash
npm run register-commands
```

By default this registers commands globally. For local testing against a single server only, edit [src/commands/register.js](src/commands/register.js) line 27-28 to use `Routes.applicationGuildCommands` with your `GUILD_ID` — guild commands register instantly without the 1-hour global propagation delay.

---

## Running the Bot

**Production:**
```bash
npm start
```

**Development:**
```bash
node src/index.js
```

---

## Local Testing

1. Fill in `.env` with your `DISCORD_TOKEN`, `CLIENT_ID`, and set `PUBLIC_URL=http://localhost:3000`
2. In [src/commands/register.js](src/commands/register.js), temporarily switch to guild-only registration (see comment on line 27) and add `GUILD_ID` to your `.env`
3. Run `npm run register-commands` — commands appear in your test server instantly
4. Run `node src/index.js`
5. In your test server, run `/setup dashboard` — open the link and configure settings
6. When done testing, switch register.js back to global, run `npm run register-commands`, then push to production

---

## Slash Commands

### `/setup dashboard`
*(Admin only)* Generates a private, time-limited link to the web configuration dashboard. The link expires in 24 hours. From the dashboard you can configure everything — summary channel, coffee pairing channel and schedule, AI provider and API keys.

---

### `/setup view`
*(Admin only)* Shows the current configuration for your server as an embed in Discord — including the coffee announcement channel, role, schedule, cooldown, and all AI provider settings.

---

### `/setup summary`
*(Admin only)* Set the channel where automated server summaries are posted and enable the feature.

---

### `/setup coffee-channel`
*(Admin only)* Set the channel where coffee pairings are announced. When set, a single message listing all pairs (with mentions) is posted to this channel instead of DMing each participant individually.

---

### `/setup coffee`
*(Admin only)* Enable or disable automated coffee pairing.

---

### `/setup coffee-role`
*(Admin only)* Set the role name used to identify members eligible for coffee pairing (default: `coffee chat`).

---

### `/setup coffee-schedule`
*(Admin only)* Set the cron schedule for automated coffee pairing (e.g. `0 10 * * 5` for Fridays at 10am).

---

### `/setup coffee-biweekly`
*(Admin only)* Toggle whether coffee pairing runs every week or every other week.

---

### `/setup coffee-cooldown`
*(Admin only)* Set how many days must pass before the same pair can be matched again (default: 30).

---

### `/setup timezone`
*(Admin only)* Set the IANA timezone used for all scheduled tasks (e.g. `America/New_York`).

---

### `/setup admin-add` / `/setup admin-remove`
*(Discord Administrator only)* Grant or revoke bot-admin privileges for a user. Bot admins can run all admin commands without needing Discord Administrator permission — useful for delegating bot management to moderators or multiple team members.

---

### `/translate`
Start or stop live voice translation in a voice channel.

| Subcommand | Description |
|-----------|-------------|
| `start` | Join your current voice channel and begin live translation. Posts a captions URL to the channel. |
| `stop` | Stop translation and end the session. |

Sessions auto-expire after 1 hour.

---

### `/summarize`
Summarizes the last 100 messages in the current channel and DMs the result to you.

---

### `/server-summary`
*(Admin only)* Gathers recent messages from all visible text channels and posts an AI-generated summary to the configured summary channel.

---

### `/paircoffee`
*(Admin only)* Manually triggers a coffee pairing run immediately. Posts pairings to the configured announcement channel (or falls back to DMs if no channel is set). Respects the cooldown period so the same pair isn't repeated too soon.

---

### `/coffee-list`
*(Admin only)* Lists all members currently assigned the coffee chat role.

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

## AI Provider Configuration

Each server configures its own AI provider through the dashboard. Three tasks can each use a different provider and model:

| Task | What it does | Default model |
|------|-------------|---------------|
| **Summarization** | `/summarize` and scheduled weekly summaries | `llama-3.1-8b-instant` (Groq) |
| **Translation** | Live voice caption translation | `llama-3.1-8b-instant` (Groq) |
| **Transcription** | Voice-to-text (Whisper) | `whisper-large-v3-turbo` (Groq) |

### Supported providers

| Provider | Notes |
|----------|-------|
| `groq` | Default. Fast inference, free tier available at [console.groq.com](https://console.groq.com) |
| `openai` | OpenAI API |
| `anthropic` | Anthropic Claude API |
| `ollama` | Runs locally — requires a running Ollama instance and a base URL |
| `custom` | Any OpenAI-compatible endpoint — provide a base URL |

> **Transcription note:** Only `groq` and `openai` support Whisper-compatible speech-to-text.

Admins can also configure AI settings via slash command if preferred:
```
/setup ai service:summarization provider:anthropic key:sk-ant-xxx model:claude-haiku-4-5-20251001
/setup ai service:translation provider:openai key:sk-xxx model:gpt-4o-mini
/setup ai service:transcription provider:groq key:gsk_xxx
```

---

## Deployment (Render)

1. Push your code to GitHub
2. Create a new **Web Service** on Render connected to your repo
3. Set the **Start Command** to `npm start`
4. Use a **paid plan** with **Always On** enabled — the free tier sleeps and disconnects the bot
5. **Add a persistent disk:**
   - Go to your service → **Disks** tab → **Add Disk**
   - Mount path: `/data`
   - Size: `1 GB`
   - This ensures guild configs and data survive redeploys
6. Set environment variables:

```
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-client-id
PUBLIC_URL=https://your-app.onrender.com
DATA_DIR=/data
ADMIN_USER_ID=your-discord-user-id    # optional
ALLOWED_USER_IDS=id1,id2              # optional
CAPTION_URL=https://your-app.onrender.com  # optional, for voice translation
```

7. Run `npm run register-commands` once to register slash commands globally
8. Invite the bot to servers — each admin runs `/setup dashboard` to configure their server

The bot uses no native binaries (`opusscript` is WASM, `@noble/ciphers` is pure JS) — builds and runs on Render without any extra configuration.

---

## Project Structure

```
discord-summarizer/
├── src/
│   ├── index.js                    # Entry point — bootstraps all services and the Discord client
│   ├── commands/                   # One file per slash command
│   │   ├── setup.js                # /setup — dashboard link, view config, channel/schedule/AI/admin config
│   │   ├── translate.js
│   │   ├── summarize.js
│   │   ├── server-summary.js
│   │   ├── paircoffee.js
│   │   ├── coffee-list.js
│   │   ├── remindme.js
│   │   ├── listreminders.js
│   │   ├── cancelreminder.js
│   │   ├── events.js
│   │   ├── location.js
│   │   └── downloadlocations.js
│   ├── events/
│   │   └── interactionCreate.js    # Routes slash command interactions to the right command file
│   ├── providers/
│   │   └── index.js                # AI provider abstraction — adapters for Groq, OpenAI, Anthropic, Ollama
│   ├── services/
│   │   ├── voiceService.js         # Voice capture and per-frame Opus decoding
│   │   ├── transcriptionService.js # PCM→WAV conversion and Whisper API calls (provider-aware)
│   │   ├── translationService.js   # Text translation (provider-aware)
│   │   ├── groq.js                 # SummarizationService — provider-aware summarization
│   │   ├── streamingService.js     # WebSocket server — broadcasts captions to browser clients
│   │   ├── sessionService.js       # Per-guild session management with token auth
│   │   ├── guildConfigService.js   # SQLite config store — per-guild settings and AI provider config
│   │   ├── messageStatsService.js  # Per-guild message statistics tracking
│   │   ├── schedulerService.js     # Cron job management (summary + coffee pairing)
│   │   ├── httpServer.js           # HTTP server — dashboard API, static files, health check
│   │   ├── coffee.js               # Coffee pairing logic (matching algorithm, channel announcements, DM fallback)
│   │   └── gather.js               # Message gathering and summarization for server summary
│   └── utils/
│       ├── helpers.js              # Shared utilities (delay, ensureDataDir)
│       └── logger.js               # Admin DM notifications and error logging
├── public/
│   ├── dashboard.html              # Web configuration dashboard and analytics
│   ├── captions.html               # Live captions web page (WebSocket client)
│   └── torc-logo.png
├── src/commands/register.js        # Run this to register slash commands with Discord
├── package.json
└── .env.example                    # Template for environment variables
```
