# Discord Summarizer Bot

A Discord bot with live voice translation, server summarization, coffee chat pairing, reminders, and more. Hosted on Render.

AI features are fully customizable — each Discord server admin can choose their own AI provider (Groq, OpenAI, Anthropic/Claude, Ollama, or any OpenAI-compatible endpoint) for summarization, translation, and transcription independently, without requiring any code changes.

---

## Features

- **Live voice translation** — Captures voice channel audio, transcribes with Whisper, translates via your chosen AI provider, and streams captions to a web page in near real-time
- **Server summarization** — Summarizes recent messages across all text channels using your configured AI provider
- **Coffee chat pairing** — Randomly pairs members with a designated role and DMs them to set up meetings
- **Reminders** — Set, list, and cancel personal reminders delivered via DM
- **Events** — Fetch and display upcoming server events
- **Location tracking** — Scan messages for location mentions and export a locations report

---

## Prerequisites

- Node.js >= 20
- A Discord application and bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- An AI provider account — Groq is the default and has a free tier ([console.groq.com](https://console.groq.com)). Other supported providers: OpenAI, Anthropic, Ollama (local)

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

### Required

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Your bot token from the Discord Developer Portal |
| `CLIENT_ID` | Your application/bot ID |
| `GUILD_ID` | Your Discord server ID |
| `CAPTION_URL` | Public URL of the service — used to generate the captions link (e.g. `https://your-app.onrender.com`). Use `http://localhost:3000` for local development. |

### AI Provider (at least one key is required)

| Variable | Description |
|----------|-------------|
| `GROQ_API_KEY` | Groq API key — used as the default for all AI tasks if no provider-specific key is set. Get one free at [console.groq.com](https://console.groq.com). |
| `SUMM_API_KEY` | API key specifically for summarization (falls back to `GROQ_API_KEY`) |
| `TRANS_API_KEY` | API key specifically for translation (falls back to `GROQ_API_KEY`) |
| `STT_API_KEY` | API key specifically for transcription/speech-to-text (falls back to `GROQ_API_KEY`) |

The simplest setup is to set `GROQ_API_KEY` only — all three AI tasks will use it with Groq's default models. Guild admins can then override their own provider and key via `/setup ai` without needing any env var changes.

See [AI Provider Configuration](#ai-provider-configuration) below for the full list of AI-related variables.

### Optional

| Variable | Description |
|----------|-------------|
| `TARGET_CHANNEL_ID` | Channel ID where the weekly server summary is posted |
| `ADMIN_USER_ID` | Discord user ID to receive admin notifications via DM |
| `ALLOWED_USER_IDS` | Comma-separated user IDs permitted to run admin commands |
| `SERVER_SUMMARY_CRON` | Cron expression for weekly summary (default: `0 10 * * 1` — Mondays at 10:00) |
| `COFFEE_CRON_SCHEDULE` | Cron expression for coffee pairing (e.g. `0 5 * * 1`) |
| `COFFEE_BIWEEKLY` | Set to `true` to run coffee pairing every other Monday instead of weekly |
| `COFFEE_ROLE_NAME` | Name of the role to include in coffee pairing (default: `coffee chat`) |
| `COFFEE_PAIRING_COOLDOWN_DAYS` | Days before the same two people can be re-paired (default: `30`) |
| `CRON_TIMEZONE` | IANA timezone for all cron jobs (default: `UTC`). Example: `America/New_York` |
| `PORT` | HTTP server port — set automatically by Render |

---

## AI Provider Configuration

The bot supports multiple AI providers for each of its three AI tasks independently:

| Task | What it does | Default provider | Default model |
|------|-------------|-----------------|---------------|
| **Summarization** | `/summarize` and scheduled weekly summaries | Groq | `llama-3.1-8b-instant` |
| **Translation** | Live voice caption translation | Groq | `llama-3.1-8b-instant` |
| **Transcription** | Voice-to-text (Whisper) | Groq | `whisper-large-v3-turbo` |

### Supported providers

| Provider | Key | Notes |
|----------|-----|-------|
| `groq` | Required | Default. Fast, free tier available. |
| `openai` | Required | OpenAI API. |
| `anthropic` | Required | Anthropic Claude API. |
| `ollama` | Not required | Runs locally. Requires a running Ollama instance and a `url`. |
| `custom` | Optional | Any OpenAI-compatible endpoint. Requires a `url`. |

> **Transcription note:** Only `groq` and `openai` support Whisper-compatible speech-to-text. Anthropic, Ollama, and custom endpoints are not supported for transcription.

### How configuration works

There are two ways to configure AI providers — they can be combined:

**1. Environment variables (bot-level defaults)**

Set these in your `.env` or Render dashboard to apply defaults for all guilds:

```env
# Provider for each task: groq | openai | anthropic | ollama | custom
SUMM_PROVIDER=groq
TRANS_PROVIDER=groq
STT_PROVIDER=groq

# API keys (each falls back to GROQ_API_KEY if not set)
SUMM_API_KEY=
TRANS_API_KEY=
STT_API_KEY=

# Model overrides (uses provider defaults if not set)
SUMM_MODEL=llama-3.1-8b-instant
TRANS_MODEL=llama-3.1-8b-instant
STT_MODEL=whisper-large-v3-turbo

# Base URL — required for ollama and custom providers
SUMM_BASE_URL=
TRANS_BASE_URL=
STT_BASE_URL=
```

**2. `/setup ai` command (per-guild overrides)**

Discord server admins can configure their own provider and API key for any task without touching the bot's environment. Keys are stored per-guild in the bot's database and take effect immediately.

```
/setup ai service:summarization provider:anthropic key:sk-ant-xxx model:claude-haiku-4-5-20251001
/setup ai service:translation provider:openai key:sk-xxx model:gpt-4o-mini
/setup ai service:transcription provider:openai key:sk-xxx
/setup ai service:translation provider:ollama model:llama3.2 url:http://localhost:11434/v1
```

All options except `service` are optional — you can update just a key, just a model, or any combination in one command.

Run `/setup view` to see the current AI configuration for your server.

### Examples

**Keep everything on Groq (simplest):**
Set `GROQ_API_KEY` in your `.env`. Done — all tasks use Groq with sensible defaults.

**Use Claude for summarization, Groq for translation/transcription:**
```env
GROQ_API_KEY=your-groq-key
SUMM_PROVIDER=anthropic
SUMM_API_KEY=sk-ant-your-anthropic-key
SUMM_MODEL=claude-haiku-4-5-20251001
```

**Use local Ollama for summarization:**
```env
SUMM_PROVIDER=ollama
SUMM_MODEL=llama3.2
SUMM_BASE_URL=http://localhost:11434/v1
```

**Per-guild — let each server admin bring their own Anthropic key:**
Leave `GROQ_API_KEY` set for translation/transcription defaults. Each guild admin runs:
```
/setup ai service:summarization provider:anthropic key:sk-ant-xxx model:claude-haiku-4-5-20251001
```

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

### `/setup`
*(Admin only)* Configure the bot for your server. All subcommands are ephemeral (only you can see the response).

| Subcommand | Description |
|-----------|-------------|
| `view` | Show the current configuration for this server, including AI provider settings |
| `summary <channel>` | Enable automated weekly summaries and set the channel to post them in |
| `summary-disable` | Disable automated weekly summaries |
| `summary-schedule <cron>` | Set a custom cron schedule for summaries (e.g. `0 10 * * 1`) |
| `coffee <enabled>` | Enable or disable coffee chat pairing |
| `coffee-role <role>` | Set the role name used for coffee pairing |
| `coffee-schedule <cron>` | Set the cron schedule for coffee pairing |
| `coffee-biweekly <enabled>` | Toggle every-other-week pairing |
| `coffee-cooldown <days>` | Set the cooldown before the same pair can be matched again |
| `timezone <tz>` | Set the IANA timezone for all scheduled tasks (e.g. `America/New_York`) |
| `ai` | Configure AI providers — see below |

#### `/setup ai` — Configure AI providers

Use this subcommand to set the AI provider, API key, model, and (for local/custom endpoints) the base URL for any of the three AI tasks. All options except `service` are optional — you can update just one thing at a time.

```
/setup ai service:<task> [provider:<name>] [key:<api-key>] [model:<model-name>] [url:<base-url>]
```

| Option | Description |
|--------|-------------|
| `service` | Which task to configure: `summarization`, `translation`, or `transcription` |
| `provider` | `groq`, `openai`, `anthropic`, `ollama`, or `custom` |
| `key` | API key for the provider (stored securely in the bot's database for this server only) |
| `model` | The model name to use (e.g. `gpt-4o-mini`, `claude-haiku-4-5-20251001`, `llama3.2`) |
| `url` | Base URL — required for `ollama` (e.g. `http://localhost:11434/v1`) and `custom` endpoints |

**Examples:**

```
# Switch summarization to Claude
/setup ai service:summarization provider:anthropic key:sk-ant-xxx model:claude-haiku-4-5-20251001

# Use OpenAI for translation
/setup ai service:translation provider:openai key:sk-xxx model:gpt-4o-mini

# Use local Ollama for summarization
/setup ai service:summarization provider:ollama model:llama3.2 url:http://localhost:11434/v1

# Just update the model (keep existing provider and key)
/setup ai service:summarization model:llama-3.3-70b-versatile
```

Settings saved via `/setup ai` apply only to your server and override any bot-level defaults. Run `/setup view` to confirm what's currently configured.

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
│   ├── providers/
│   │   └── index.js                # AI provider abstraction — adapters for Groq, OpenAI, Anthropic, Ollama
│   ├── services/
│   │   ├── voiceService.js         # Voice capture and per-frame Opus decoding
│   │   ├── transcriptionService.js # PCM→WAV conversion and Whisper API calls (provider-aware)
│   │   ├── translationService.js   # Text translation (provider-aware)
│   │   ├── groq.js                 # SummarizationService — provider-aware summarization
│   │   ├── streamingService.js     # WebSocket server — broadcasts captions to browser clients
│   │   ├── sessionService.js       # Per-guild session management with token auth
│   │   ├── guildConfigService.js   # SQLite config store — includes per-guild AI provider settings
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
