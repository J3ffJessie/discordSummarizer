# Multi-Server Support — Local Testing Guide

Testing guide for the multi-server `/setup` command and per-guild SQLite configuration.

---

## Phase 1 — Smoke Test (no Discord required)

Start the bot locally and verify it boots without errors.

```bash
npm start
```

**Expected output:**
- No crash on startup
- `src/data/guild_config.db` created automatically
- Log line: `Scheduler: loaded cron tasks for 0 guild(s)` (expected — DB is empty)

---

## Phase 2 — Single Server (`/setup` command)

### 2a. Command Registration for Local Dev

The production `register.js` always registers globally (up to 1 hour propagation). For local testing, temporarily restore guild-scoped registration in `src/commands/register.js` and set `GUILD_ID` in your `.env`:

```js
// Temporary local dev version of the registration block
if (GUILD_ID) {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
} else {
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
}
```

```bash
node src/commands/register.js
```

> **Note:** Revert to global-only before deploying to Render.

### 2b. Test `/setup` Commands

Run each command in your test server and verify the response embeds match the expected output.

| Command | Expected Result |
|---|---|
| `/setup view` | Embed shows "No configuration set yet" |
| `/setup summary channel:#your-channel` | Confirm embed + channel saved |
| `/setup view` | Embed shows summary enabled with channel mention |
| `/setup coffee enabled:true` | Confirm embed — coffee enabled |
| `/setup view` | Embed shows both features active |
| `/setup summary-disable` | Confirm embed — summary disabled |
| `/setup view` | Embed shows summary disabled, coffee still enabled |
| `/setup coffee enabled:false` | Confirm embed — coffee disabled |

### 2c. Verify Data Persisted to DB

```bash
node -e "const db = require('better-sqlite3')('src/data/guild_config.db'); console.log(db.prepare('SELECT * FROM guild_config').all())"
```

Confirm the row exists with the correct `guild_id`, `summary_channel_id`, and feature flags.

---

## Phase 3 — Scheduler

### 3a. Temporarily Set Cron to Fire Every Minute

Replace `YOUR_GUILD_ID` with your actual guild ID.

```bash
node -e "
  const db = require('better-sqlite3')('src/data/guild_config.db');
  db.prepare(\"UPDATE guild_config SET summary_cron = '* * * * *' WHERE guild_id = ?\").run('YOUR_GUILD_ID');
"
```

Restart the bot and wait up to 60 seconds. Verify a server summary is posted to the configured channel.

### 3b. Reset Cron to Production Schedule

```bash
node -e "
  const db = require('better-sqlite3')('src/data/guild_config.db');
  db.prepare(\"UPDATE guild_config SET summary_cron = '0 10 * * 1' WHERE guild_id = ?\").run('YOUR_GUILD_ID');
"
```

### 3c. Test Live Refresh (no restart required)

With the bot running, update the config via `/setup` and verify the scheduler picks up the change without restarting:

1. Run `/setup summary-disable`
2. Check logs — no more cron firing for that guild
3. Run `/setup summary channel:#your-channel`
4. Check logs — cron re-registered for that guild

---

## Phase 4 — Second Server (Isolation Test)

### 4a. Setup

1. Create a new Discord server (click `+` in the Discord sidebar)
2. Invite the bot using your existing OAuth2 invite link
3. Run `node src/commands/register.js` if guild-scoped — commands appear instantly

### 4b. Verify Isolation

| Action | Expected |
|---|---|
| `/setup view` in new server | "No configuration set yet" — isolated from server 1 |
| `/setup summary channel:#different-channel` in new server | Saves independently |
| `/setup view` in original server | Config unchanged |
| `/setup coffee enabled:false` in new server | Overrides only for that guild |
| Check DB | Two rows — one per guild, different values |

```bash
node -e "const db = require('better-sqlite3')('src/data/guild_config.db'); console.log(db.prepare('SELECT guild_id, summary_channel_id, summary_enabled, coffee_enabled FROM guild_config').all())"
```

Confirm two rows exist with different `guild_id` values and independent config.
