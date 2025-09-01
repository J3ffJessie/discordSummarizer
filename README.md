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
   ```

4. Start the bot:

   ```bash
   node index.js
   ```

---

## Usage

### Slash Commands

* `/summarize` — Summarize recent messages in the current channel.
* `/events` — Fetch and display upcoming events from Guild.Host.

### Message Commands

* `!remindme <time> <message>` — Set a reminder.
* `!listreminders` — View pending reminders.
* `!cancelreminder <id|all>` — Cancel a specific or all reminders.
* `!location [limit]` — Search messages for location mentions (restricted).
* `!downloadlocations` — Download logged locations in JSON format (restricted).
* `!server` — Summarize the entire server's conversations (restricted).

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

* Respect Discord rate limits when sending multiple messages; a small delay is implemented between chunks of summaries.

* The bot runs a simple HTTP server on the port specified in `.env` to keep hosting services alive (e.g., Replit, Heroku).

---

## License

MIT License © Jeff Jessie
