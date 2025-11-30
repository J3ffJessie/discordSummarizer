# Discord Summarizer Bot

A Discord bot that provides message summarization, upcoming event notifications, and personal reminders. It uses the Groq API for AI-powered summarization and supports both channel-level and server-wide summaries.

---

## Features

* **Summarize Messages**

  * `/summarize` — Summarizes recent messages in the channel and sends the summary to the user's DMs.
  * Provides concise, bulleted summaries while maintaining context and friendly tone.

* **Server-Wide Summaries**

  * `!server` — Summarizes conversations across all channels in a server and posts the result in a designated channel.
  * Scheduled weekly summaries via cron jobs.

* **Event Notifications**

  * `/events` — Fetches upcoming events from the Guild.Host API and DMs them to the user.
  * Includes event details like start/end time, description, and social card images.

* **Reminders**

  * `!remindme <time> <message>` — Sets a personal reminder (supports weeks, months, days, hours, minutes, seconds).
  * `!listreminders` — Lists pending reminders for the user.
  * `!cancelreminder <id|all>` — Cancel a specific reminder or all reminders.

* **Location Logging** (Restricted)

  * `!location` — Extracts and logs location mentions from messages.
  * `!downloadlocations` — Sends a sorted JSON file of logged locations to authorized users.

* **Robust AI Integration**

  * Uses Groq API with `llama-3.1-8b-instant` model for summarization.
  * Supports both channel-level and server-level conversation summaries.

---

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/discord-summarizer-bot.git
   cd discord-summarizer-bot
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with the following environment variables:

   ```env
   DISCORD_TOKEN=your_discord_bot_token
   CLIENT_ID=your_discord_client_id
   GROQ_API_KEY=your_groq_api_key
   PORT=3000
  GUILD_ID=your_test_guild_id
  COFFEE_ROLE_NAME=coffee-chat
  COFFEE_CRON_SCHEDULE="0 9 * * 1"
  COFFEE_LOG_CHANNEL_ID=optional_channel_id_for_coffee_logs
  COFFEE_PAIRING_COOLDOWN_DAYS=30
  COFFEE_FETCH_MEMBERS=false
  COFFEE_FETCH_TIMEOUT_MS=10000
   ```

4. Start the bot:

   ```bash
   node index.js
   ```

Note: Don't start both `index.js` and `cronindex.js` with the same bot token; that will log in two separate processes subscribing to the same message events and will duplicate responses. If you need separate background cron processes, use a different token or coordinate that only one active process handles message commands.

---

## Usage

### Slash Commands

* `/summarize` — Summarize recent messages in the current channel.
* `/events` — Fetch and display upcoming events from Guild.Host.
* `/coffee-pair` — Manually run coffee pairing (restricted to admin IDs in `ALLOWED_USER_IDS`).

### Message Commands

* `!remindme <time> <message>` — Set a reminder.
* `!listreminders` — View pending reminders.
* `!cancelreminder <id|all>` — Cancel a specific or all reminders.
* `!location [limit]` — Search messages for location mentions (restricted).
* `!downloadlocations` — Download logged locations in JSON format (restricted).
* `!server` — Summarize the entire server's conversations (restricted).

* **Coffee Pairing**

  * `/coffee-pair` — Pair members that have the configured 'coffee-chat' role and DM them to arrange a coffee chat. Can be scheduled via cron and manually triggered.

> **Note:** Restricted commands can only be used by users with IDs listed in the `ALLOWED_USER_IDS` array in `index.js`.

---

## Configuration

* **Target Summary Channel**
  Set `TARGET_CHANNEL_ID` to the channel ID where server-wide summaries will be posted.

* **Logging**

  * Location logs are stored in `locations.log`.
  * Reminders are saved in `reminders.json`.

* **Scheduled Summaries**

  * Cron job sends a weekly server summary every Monday at 10:00 UTC.
  * Adjust cron schedule in `index.js` if needed.

  * **Coffee Pairing Scheduling**

    * The coffee pairing job is scheduled via the environment variable `COFFEE_CRON_SCHEDULE` (defaults to `"0 9 * * 1"` - Monday at 9 UTC).
    * By default the role name used to find participants is `coffee-chat`, configurable with `COFFEE_ROLE_NAME`.
    * You can configure the cooldown window to prevent users from being re-paired with the same person within a timespan using `COFFEE_PAIRING_COOLDOWN_DAYS` (defaults to `30`).
    * By default the pairing uses cached role members to avoid expensive fetches/chunking. To attempt an explicit member cache refresh when the cache is insufficient, enable `COFFEE_FETCH_MEMBERS=true`. If enabled, you can tune `COFFEE_FETCH_TIMEOUT_MS` to control how long the bot waits for the member fetch to complete.
    ### How cooldown works

    The bot keeps a per-user pairing history in `coffee_pairs.json`. When forming pairs, it will try to avoid pairing two users who were paired within the last `COFFEE_PAIRING_COOLDOWN_DAYS` days. If the pool of eligible users is too small and non-repeating pairing is not possible, it will pair anyway and prefer the least-matched partner (i.e., the candidate the user has paired with the fewest times). If there is a tie, the olded pairing timestamp is used as a tiebreaker. The bot will log a console warning when cooldown rules are violated.
    * A log of pairings is saved to `coffee_pairs.json`.
    * You can set `COFFEE_LOG_CHANNEL_ID` to a channel where a summary of pairings will be posted; if not set, the bot will post into `TARGET_CHANNEL_ID`.
    * Optionally, require a minimum Mee6 level for pairing by setting `COFFEE_MIN_MEE6_LEVEL` to a positive integer. The bot will call the public MEE6 leaderboard API to check levels and exclude users below the configured threshold.
    * You can override the Mee6 API host with `COFFEE_MEE6_API_HOST` (default: `https://mee6.xyz`) if using a proxy or private instance.
      * If you'd like pairing to abort when Mee6 lookup fails (strict behavior), set `COFFEE_MEE6_STRICT=true`. When strict mode is enabled and the Mee6 lookup fails, pairing will not occur.
      * The Mee6 check uses the `level` field returned by the leaderboard API (e.g. `"level":13`) to determine eligibility.

---

## Dependencies

* [discord.js](https://discord.js.org/) — Discord bot library.
* [dotenv](https://www.npmjs.com/package/dotenv) — Load environment variables.
* [groq-sdk](https://www.npmjs.com/package/groq-sdk) — AI summarization API.
* [axios](https://www.npmjs.com/package/axios) — HTTP requests for events.
* [node-cron](https://www.npmjs.com/package/node-cron) — Scheduled tasks.

---

## File Structure

```
.
├── index.js           # Main bot logic
├── locations.js       # Helper functions for location extraction
├── reminders.json     # Persisted reminders
├── locations.log      # Logged locations
├── package.json
└── README.md
```

---

## Notes

* Ensure the bot has the following Discord intents enabled:

  * `Guilds`
  * `GuildMessages`
  * `MessageContent`
  * `DirectMessages`
  * `GuildMembers` (privileged intent; enable in Developer Portal)

* Respect Discord rate limits when sending multiple messages; a small delay is implemented between chunks of summaries.

* The bot runs a simple HTTP server on the port specified in `.env` to keep hosting services alive (e.g., Replit, Heroku).

### Testing coffee pairing manually

1. Create a role in your test server named `coffee-chat` (or set `COFFEE_ROLE_NAME` to your desired role). Add a few members with that role.
2. Restart the bot (so it fetches up-to-date member lists).
3. Run the slash command `/coffee-pair` (you must be in `ALLOWED_USER_IDS`) or send the message `!paircoffee` in a server channel.
4. Check that paired users received DMs and that a summary of pairings is posted into `COFFEE_LOG_CHANNEL_ID` or `TARGET_CHANNEL_ID`.

If users have DMs disabled, the bot will warn in the console and keep trying for other users; consider notifying the admin to enable DMs for pairing to be delivered.

---

## License

MIT License © Jeff Jessie
