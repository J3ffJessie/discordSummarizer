# Discord Summarizer Bot

## Overview
Discord Summarizer is a multi-feature Discord bot that provides:
- AI-powered summarization of channel and server conversations
- Location mention detection and logging
- Scheduled and on-demand server summaries
- Upcoming event notifications
- Personal reminders via chat commands

## Features

### 1. Summarization
- `/summarize` (slash command): Summarizes the last 100 messages in the current channel and sends the summary to your DMs.
- `!server` (prefix command, restricted): Summarizes recent conversations across all text channels and posts the summary in a designated summary channel.
- Scheduled weekly summary: Every Monday at 10 UTC, posts a server-wide summary in the summary channel.

 ### 2. Location Mention Detection 
- `!location [N]` (restricted): Scans the last N (default 100, max 100) messages in the current channel for city/country mentions and logs new locations.
- `!downloadlocations` (restricted): Sends a sorted JSON file of all detected cities and countries to your DMs. -->

### 3. Event Notifications
- `/events` (slash command): Fetches and DMs the user a list of upcoming events for the next 7 days for the community Guild.host, including details and images.

### 4. Reminders
- `!remindme <time> <message>`: Sets a personal reminder (e.g., `!remindme 10m Take out the trash`). The bot will DM you at the specified time.
- `!listreminders`: Lists all your pending reminders in a DM.
- `!cancelreminder <id>`: Cancels a specific reminder by its ID.

## Command Reference

| Command                      | Type         | Description                                                                 |
|------------------------------|--------------|-----------------------------------------------------------------------------|
| `/summarize`                 | Slash        | Summarize recent messages in the current channel (DMs you the summary)      |
| `/events`                    | Slash        | Get upcoming events for the next 7 days (DMs you the event list)            |
| `!server`                    | Prefix       | Summarize all channels and post in summary channel (restricted)             |
| `!location [N]`              | Prefix       | Scan last N messages for location mentions (restricted)                     |
| `!downloadlocations`         | Prefix       | Download sorted location log as JSON (restricted)                           |
| `!remindme <time> <message>` | Prefix       | Set a personal reminder (DMs you at the specified time)                     |
| `!listreminders`             | Prefix       | List your pending reminders (DM)                                            |
| `!cancelreminder <id>`       | Prefix       | Cancel a specific reminder by ID                                            |

## Setup Instructions

1. **Clone the repository**
2. **Install dependencies**
  ```bash
  npm install
  ```
3. **Create a `.env` file** with the following variables:
  ```env
  DISCORD_TOKEN=your-bot-token
  CLIENT_ID=your-discord-client-id
  GROQ_API_KEY=your-groq-api-key
  PORT=3000
  ```
4. **Configure your summary channel**
  - Set `TARGET_CHANNEL_ID` in `index.js` to the channel ID where summaries should be posted.
5. **Run the bot**
  ```bash
  node index.js
  ```

## Permissions
- The bot requires permissions to read messages, send messages, embed links, and manage DMs.
- Some commands are restricted to specific user IDs (see `ALLOWED_USER_IDS` in `index.js`).

## File Structure
- `index.js` — Main bot logic and command/event handlers
- `locations.js` — Location detection logic
- `locations.log` — Log file for detected locations
- `reminders.json` — Persistent storage for reminders
- `README.md` — Documentation

## Notes
- All reminder command responses auto-delete after a few seconds to reduce chat clutter.
- Summaries and event lists are sent via DM for privacy.
- Scheduled summaries run every Monday at 10 UTC.
- Location detection is only run on command, not passively.

## Example Usage

```
/summarize
!remindme 15m Join the meeting
!listreminders
!cancelreminder 1692624000000
!location 50
!downloadlocations
/events
```

## Troubleshooting
- If slash commands do not appear, ensure the bot is registered and has the correct permissions.
- If DMs are not received, check your Discord DM settings and bot permissions.
- For restricted commands, ensure your user ID is listed in `ALLOWED_USER_IDS`.

---
**Enjoy your summarized Discord experience!**