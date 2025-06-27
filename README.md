# Discord Summarizer Bot

A Discord bot that summarizes conversations, detects location mentions, and manages location logs for your server. Powered by the Groq API for AI summarization.

---

## Features

### 1. Summarize Channel Conversations
- **Slash Command `/summarize`**  
  Summarizes the latest 100 messages in the current channel and sends the summary to your DMs as a concise, bulleted list.

- **On-Demand Server Summary (`!server`)**  
  Summarizes recent conversations across all text channels in the server and sends the summary to your DMs.

### 2. Location Mention Detection
- **Passive Detection**  
  Automatically scans every message for known city or country names (using fuzzy matching). Logs detected locations for later review.

- **Manual Search (`!location [N]`)**  
  Searches the last N (default 100, max 100) messages in the current channel for location mentions. Newly detected locations are logged.

### 3. Location Log Management
- **Download Sorted Log (`!downloadlocations`)**  
  Sends you a sorted list of all detected cities and countries (from the log) as a JSON file via DM.

---

## Commands

| Command                | Description                                                                                  |
|------------------------|----------------------------------------------------------------------------------------------|
| `/summarize`           | Summarizes the last 100 messages in the current channel and DMs you the summary.             |
| `!server`              | Summarizes recent messages from all channels and DMs you the summary.                        |
| `!location [N]`        | Searches the last N (default 100, max 100) messages for location mentions and logs them.     |
| `!downloadlocations`   | Sends you a sorted JSON file of all detected cities and countries via DM.                    |

---

## Setup

1. **Install dependencies:**
    ```sh
    npm install
    ```

2. **Create a `.env` file** with the following variables:
    ```
    DISCORD_TOKEN=your-bot-token
    CLIENT_ID=your-discord-client-id
    GROQ_API_KEY=your-groq-api-key
    PORT=3000
    ```

3. **Run the bot:**
    ```sh
    node index.js
    ```

---

## Files

- [`index.js`](index.js): Main bot logic, commands, and event handlers.
- [`locations.js`](locations.js): Contains the list of cities/countries and the `findLocation` function.
- [`locations.log`](locations.log): Log file for detected locations.

---

## Notes

- The bot ignores messages from other bots.
- Summaries are sent via DM for privacy.
- Location detection is passive and also available via command.
- The bot creates a simple HTTP server for health checks (useful for deployment platforms like Render).

---

**Enjoy your summarized Discord experience!**