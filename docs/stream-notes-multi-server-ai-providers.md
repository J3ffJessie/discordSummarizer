# Stream Notes: Multi-Server Support & Pluggable AI Providers

> A walkthrough of the changes made to support multiple Discord servers with independently configurable AI providers.

---

## What Changed & Why

The bot originally worked for a single Discord server with hardcoded API keys in environment variables. The goal was to make it a proper multi-tenant bot where:

- **Each server** gets its own isolated configuration
- **Each server admin** can bring their own AI provider and API key
- **Settings** are manageable through a friendly web dashboard (not just slash commands)
- **Scheduled tasks** (summaries, coffee pairing) run independently per server

---

## 1. Per-Guild Config Storage — `src/services/guildConfigService.js`

The foundation of everything. Uses **SQLite** (`better-sqlite3`) to store one config row per Discord server.

### Why SQLite?
- Synchronous API — no async headaches in service constructors
- Zero infrastructure — just a file on disk
- Portable — works locally and on Render with a persistent disk mount

### Database Schema (`guild_config` table)

| Column | Type | Description |
|---|---|---|
| `guild_id` | TEXT (PK) | Discord server ID |
| `summary_channel_id` | TEXT | Channel for automated summaries |
| `summary_enabled` | INTEGER | 0/1 feature flag |
| `summary_cron` | TEXT | Cron expression (default: `0 10 * * 1`) |
| `coffee_enabled` | INTEGER | 0/1 feature flag |
| `coffee_role_name` | TEXT | Role targeted for pairing |
| `coffee_cron` | TEXT | Cron expression |
| `coffee_biweekly` | INTEGER | Run every 2 weeks flag |
| `coffee_cooldown_days` | INTEGER | Days before same pair is re-matched |
| `timezone` | TEXT | IANA timezone (default: `UTC`) |
| `summ_provider` | TEXT | AI provider for summarization |
| `summ_api_key` | TEXT | Encrypted API key |
| `summ_model` | TEXT | Model name override |
| `summ_base_url` | TEXT | For custom/Ollama endpoints |
| `trans_provider` | TEXT | AI provider for translation |
| `trans_api_key` | TEXT | |
| `trans_model` | TEXT | |
| `stt_provider` | TEXT | AI provider for speech-to-text |
| `stt_api_key` | TEXT | |
| `stt_model` | TEXT | |
| `dashboard_token` | TEXT | Web dashboard auth token |
| `dashboard_token_exp` | TEXT | Token expiry (24-hour TTL) |

### Schema Migration
The service uses `_addMissingColumns()` on startup — so old databases get new columns automatically without manual migration scripts.

---

## 2. Pluggable AI Providers — `src/providers/index.js`

A unified abstraction layer so every AI feature can swap providers without changing service code.

### Supported Providers

| Provider | Chat/Summarization | Translation | Speech-to-Text |
|---|---|---|---|
| **Groq** | ✅ | ✅ | ✅ |
| **OpenAI** | ✅ | ✅ | ✅ |
| **Anthropic (Claude)** | ✅ | ✅ | ❌ |
| **Ollama** (local) | ✅ | ✅ | ❌ |
| **Custom endpoint** | ✅ | ✅ | ❌ |

### How Config Resolution Works

For any service call, the provider is resolved in this priority order:

```
1. Guild SQLite config  →  server admin's own key/provider
2. Environment variable →  bot operator's default key/provider
3. Default: Groq        →  fallback if nothing else is set
4. Error                →  no API key found anywhere
```

### Default Models

```javascript
// Chat (summarization + translation)
groq:       'llama-3.1-8b-instant'
openai:     'gpt-4o-mini'
anthropic:  'claude-haiku-4-5-20251001'
ollama:     'llama3.2'

// Speech-to-Text
groq:       'whisper-large-v3-turbo'
openai:     'whisper-1'
```

### Factory Functions

```javascript
createChatProvider('summ', guildConfig)  // summarization
createChatProvider('trans', guildConfig) // translation
createTranscriptionProvider(guildConfig) // speech-to-text
```

Each factory reads the appropriate `summ_*`, `trans_*`, or `stt_*` columns from the guild config.

---

## 3. Services Updated to Accept `guildId`

All three AI-powered services now accept a `guildId` parameter, look up that guild's config, and create the appropriate provider:

### TranscriptionService — `src/services/transcriptionService.js`
```javascript
async transcribe(filePath, guildId = null) {
  const guildConfig = this.gcs?.getConfig(guildId) || null;
  const provider = createTranscriptionProvider(guildConfig);
  return await provider.transcribe(fs.createReadStream(filePath));
}
```

### TranslationService — `src/services/translationService.js`
```javascript
async translate(text, targetLanguage = 'English', guildId = null) {
  const guildConfig = this.gcs?.getConfig(guildId) || null;
  const provider = createChatProvider('trans', guildConfig);
  // ...
}
```

### SummarizationService — `src/services/groq.js`
```javascript
async serverSummarize(messages, guildId) {
  const guildConfig = this.gcs?.getConfig(guildId) || null;
  const provider = createChatProvider('summ', guildConfig);
  // ...
}
```

Two servers can run simultaneously with completely different AI providers — fully isolated.

---

## 4. Per-Guild Scheduler — `src/services/schedulerService.js`

Manages independent cron tasks for each server.

### What it does
- On startup: queries all guilds with features enabled, schedules independent tasks for each
- Uses a `Map<guildId, {summaryTask, coffeeTask}>` to track tasks per server
- Respects each guild's `timezone` field when scheduling crons
- Supports `coffee_biweekly` — only runs on even-numbered weeks

### Hot Refresh
`schedulerService.refreshGuild(guildId)` stops old tasks and reschedules without a bot restart. Called automatically when an admin changes their schedule through `/setup` or the dashboard.

---

## 5. Admin Dashboard — `public/dashboard.html`

A browser-based web UI for managing all per-guild settings.

### How Access Works

1. Server admin runs `/setup dashboard`
2. Bot generates a 32-byte random token, stores it with a 24-hour expiry
3. Bot replies with a link: `https://[PUBLIC_URL]/dashboard.html?guildId=X&token=Y`
4. Admin opens the link — dashboard loads their server's config
5. Every POST to save settings requires the valid token

API keys are **never exposed** to the frontend — the dashboard shows `✅ already set` instead of the real key.

### Dashboard Sections

**Analytics (read-only)**
- Server overview (members, boost level, channels, roles)
- Member growth over a date range
- Engagement stats (messages, voice minutes)
- Activity heatmap by channel and time of day

**Admin Settings (token-required)**

*Scheduling*
- Enable/disable summaries + coffee pairing
- Channel picker for summaries
- IANA timezone input
- Cron schedule inputs
- Biweekly toggle, cooldown days

*AI Providers (3 independent sections)*

For each service (Summarization, Translation, Transcription):
- Provider dropdown: `groq | openai | anthropic | ollama | custom`
- API key field (write-only — existing keys shown as "already set")
- Model name override
- Base URL (for Ollama or custom endpoints)

---

## 6. HTTP API — `src/services/httpServer.js`

A single Node.js HTTP server (no native dependencies, Render-safe) that:
- Serves static files from `/public/`
- Hosts the REST API for the dashboard

### Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/guild?guildId=X` | GET | None | Server name + icon |
| `/api/stats?guildId=X` | GET | None | Message stats |
| `/api/members?guildId=X` | GET | None | Member counts |
| `/api/channels?guildId=X` | GET | None | Text channels list |
| `/api/config?guildId=X` | GET | None | Sanitized config (keys hidden) |
| `/api/config?guildId=X` | POST | Token in body | Update config |

### Security
The POST handler has a strict field whitelist — only known config fields are accepted, preventing injection or data corruption.

---

## 7. Updated Slash Commands — `/setup`

All setup commands now scope to the current server (`interaction.guildId`).

| Command | What it does |
|---|---|
| `/setup dashboard` | Generates token + dashboard link |
| `/setup view` | Shows current config as embed |
| `/setup ai service:X provider:Y key:Z` | Configure AI for a specific service |
| `/setup summary channel:#channel` | Set summary channel |
| `/setup timezone America/New_York` | Set server timezone |
| `/setup coffee enabled:true role:coffee-chat` | Configure coffee pairing |

---

## 8. Data Persistence & Deployment

All data lives in `/src/data/` (or `DATA_DIR` env var):

| File | Contents |
|---|---|
| `guild_config.db` | SQLite database — all guild configs |
| `message_stats.json` | Message stats for dashboard |
| `reminders.json` | User reminders |

**On Render**: Mount a persistent disk at `/data`, set `DATA_DIR=/data` so configs survive redeploys.

---

## 9. New Dependencies

```json
"better-sqlite3": "^12.6.2"    // Synchronous SQLite
"openai": "^6.25.0"             // OpenAI + Ollama + custom endpoint support
"@anthropic-ai/sdk": "^0.78.0"  // Anthropic/Claude support
```

---

## 10. Multi-Server Isolation in Action

Here's the full flow for voice translation across two servers simultaneously:

```
Guild A: /translate start
  → voiceService captures audio
  → transcriptionService.transcribe(wav, guildId: "A")
      → gcs.getConfig("A") → { stt_provider: "openai", stt_api_key: "sk-..." }
      → OpenAI Whisper
  → translationService.translate(text, "English", guildId: "A")
      → gcs.getConfig("A") → { trans_provider: "openai", ... }
      → OpenAI GPT-4o-mini
  → streamed to captions.html

Guild B: /translate start (running at the same time)
  → transcriptionService.transcribe(wav, guildId: "B")
      → gcs.getConfig("B") → { stt_provider: "groq", stt_api_key: "gsk_..." }
      → Groq Whisper
  → translationService.translate(text, "Spanish", guildId: "B")
      → gcs.getConfig("B") → { trans_provider: "anthropic", ... }
      → Claude Haiku
```

Completely isolated. Different providers, different languages, different API keys.

---

## Summary of What Changed

| Area | Before | After |
|---|---|---|
| Server support | Single server | Unlimited servers, isolated configs |
| AI providers | Groq only, hardcoded | Groq, OpenAI, Anthropic, Ollama, Custom |
| API keys | Bot operator's `.env` | Each server admin's own key |
| Configuration | `.env` file | Web dashboard + slash commands |
| Scheduling | Hardcoded | Per-guild cron + timezone |
| Config storage | None | SQLite database |
| Dashboard | None | Token-authenticated web UI |
