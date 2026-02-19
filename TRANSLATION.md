# Live Voice Translation — How It Works

This document explains the full technical pipeline behind the `/translate` command, from Discord audio capture through to the captions web page.

---

## Overview

When `/translate start` is run, the bot joins the user's voice channel and begins listening. Every time someone speaks, their audio is captured, decoded, transcribed to text by Whisper, translated to English by LLaMA, and broadcast to a live captions web page — all in near real-time.

```
Discord voice channel
        │
        ▼
  voiceService.js        — Opus audio capture + per-frame decoding
        │
        ▼
transcriptionService.js  — PCM → WAV → Whisper (Groq API)
        │
        ▼
 translationService.js   — Translated English text (Groq API / LLaMA)
        │
        ▼
  streamingService.js    — WebSocket broadcast
        │
        ▼
   captions.html         — Live captions displayed in browser
```

---

## Step-by-Step Pipeline

### 1. Starting a Session (`translate.js` + `sessionService.js`)

When a user runs `/translate start`:

1. The bot checks the user is in a voice channel
2. A **session** is created via `SessionService` — this generates a unique random token tied to the guild ID, and stores a set of connected WebSocket clients
3. `VoiceService.start()` is called, joining the voice channel
4. A **captions URL** is generated and posted in Discord:
   ```
   https://your-app.onrender.com/public/captions.html?guild=GUILD_ID&token=TOKEN
   ```
   Anyone with this URL can open the live captions page in their browser

Sessions automatically expire after **1 hour**, at which point the voice connection is also stopped.

---

### 2. Audio Capture (`voiceService.js`)

The bot listens for Discord's `speaking.start` event, which fires whenever a user's microphone becomes active.

After a **100ms delay** (to skip the corrupted first Opus frame that Discord sends when a speaker's encoder initializes), `captureAudio()` begins:

- A subscription to the user's audio stream is opened via `@discordjs/voice`'s `receiver.subscribe()`
- The stream uses `EndBehaviorType.AfterSilence` with a **300ms window** — the stream ends 300ms after the user stops speaking
- A **4-second max capture timer** is also set. If the user speaks continuously for 4 seconds, the audio collected so far is force-ended and sent for processing immediately, then a new capture starts right away. This prevents long speech from being delayed into one big batch

**Key design: decoupled capture and processing**

The `activeCaptures` lock (which prevents duplicate captures for the same user) is released the **moment the audio stream ends**, not after the API calls complete. This means if a user speaks again immediately after their first utterance, their second utterance starts capturing straight away — it does not wait for Whisper or translation to finish. Both segments process in the background independently.

Without this design, quick consecutive utterances would be silently dropped during the ~1–2 second API round-trip window.

---

### 3. Opus Decoding (`voiceService.js` + `opusscript`)

Discord sends audio in the **Opus codec** — a compressed audio format optimized for voice. Before the audio can be sent to Whisper, it must be decoded to raw PCM (uncompressed audio samples).

Decoding is done **frame by frame** using `opusscript` (a WASM-compiled Opus decoder) rather than through a stream pipeline. This matters because:

- If a pipeline decoder encounters a corrupted frame, it fails the entire stream and discards all audio for that utterance
- With per-frame decoding, corrupted frames are silently skipped with a `try/catch` and the rest of the audio continues normally

Decoded PCM chunks (16-bit signed integers, stereo, 48000 Hz) are accumulated in memory. When capture ends, they are written to a temporary file in the OS temp directory.

---

### 4. WAV Conversion (`transcriptionService.js`)

Whisper requires audio in a standard format. The raw PCM file is wrapped in a **WAV container** using the `wav` npm package — this adds a header describing the audio format (sample rate, bit depth, channels) without re-encoding the audio data. The result is a `.wav` file ready for the API.

Both the PCM and WAV temp files are deleted after processing completes regardless of success or failure.

---

### 5. Transcription — Whisper (`transcriptionService.js`)

The WAV file is sent to the **Groq API** using the `whisper-large-v3-turbo` model. Groq's Whisper implementation is significantly faster than OpenAI's hosted version, which is important for near-live output.

Groq returns a transcript object containing the spoken text. If the transcript is empty or matches the user's previous transcript exactly (duplicate detection), it is discarded.

---

### 6. Translation — LLaMA (`translationService.js`)

The transcript text is sent to the Groq API using the **`llama-3.1-8b-instant`** model with a strict system prompt:

> *"You are a translation engine. Translate ALL input text to English. Return ONLY the translated text. Do not explain. Do not add commentary."*

`temperature: 0` is set to ensure consistent, deterministic output. The model returns only the translated English text.

If the original speech was already in English, the model returns it as-is.

---

### 7. Broadcasting (`streamingService.js`)

Once translation is complete, the result is broadcast to all connected WebSocket clients for that guild's session via `StreamingService.broadcast()`.

The payload sent to each client:

```json
{
  "userId": "280096257282670592",
  "displayName": "Jeff",
  "original": "Hola, ¿cómo estás?",
  "translated": "Hello, how are you?",
  "timestamp": 1708300000000
}
```

The `displayName` is resolved from the guild member cache. If the member isn't cached, a Discord API fetch is attempted. The user ID is used as a fallback if both fail.

---

### 8. The Captions Page (`public/captions.html`)

The captions page is a single HTML file served by the bot's HTTP server. It connects to the bot via **WebSocket** (WSS on HTTPS) using the guild ID and session token from the URL query string.

For each message received, the page renders a caption card showing:
- **Speaker name** (bold, teal)
- **Translated text** (large, primary)
- **Original text** (smaller, italic, dimmed)
- **Timestamp**

The page **auto-scrolls** to keep the latest caption visible when the user is near the bottom, and **auto-reconnects** if the WebSocket connection drops (retrying every 3 seconds).

---

## Latency Breakdown

The total delay from a user finishing a sentence to the caption appearing is approximately:

| Stage | Time |
|-------|------|
| Silence detection | ~300ms |
| PCM write + WAV conversion | ~50ms |
| Groq Whisper API | ~300–800ms |
| Groq LLaMA translation | ~200–500ms |
| WebSocket broadcast | <10ms |
| **Total** | **~850ms – 1.6s** |

This is the practical floor for a cloud-based pipeline. The only way to reduce it further would be running Whisper locally on the same machine as the bot, eliminating the network round-trip.

---

## Configuration

| Setting | Location | Default | Effect |
|---------|----------|---------|--------|
| Silence window | `voiceService.js` | 300ms | How long to wait after speech stops before processing |
| Max capture duration | `voiceService.js` | 4000ms | Forces a chunk to process during continuous speech |
| Start delay | `voiceService.js` | 100ms | Skips the corrupted first frame at speech start |
| Whisper model | `transcriptionService.js` | `whisper-large-v3-turbo` | Groq Whisper model used |
| Translation model | `translationService.js` | `llama-3.1-8b-instant` | Groq LLaMA model used |
| Session expiry | `sessionService.js` | 1 hour | Auto-stops the session and voice capture |

---

## Files Involved

| File | Role |
|------|------|
| [src/commands/translate.js](src/commands/translate.js) | Slash command handler — creates session, starts/stops voice |
| [src/services/voiceService.js](src/services/voiceService.js) | Audio capture, Opus decoding, orchestrates the pipeline |
| [src/services/transcriptionService.js](src/services/transcriptionService.js) | PCM→WAV conversion and Whisper API calls |
| [src/services/translationService.js](src/services/translationService.js) | LLaMA translation via Groq |
| [src/services/streamingService.js](src/services/streamingService.js) | WebSocket server — manages connected browser clients |
| [src/services/sessionService.js](src/services/sessionService.js) | Session lifecycle, token validation, auto-expiry |
| [src/services/httpServer.js](src/services/httpServer.js) | Serves captions.html and static assets |
| [public/captions.html](public/captions.html) | Browser client — renders live captions via WebSocket |
