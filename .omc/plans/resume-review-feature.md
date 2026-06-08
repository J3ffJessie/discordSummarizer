# Resume Review Feature Plan

## Requirements Summary

Add automated resume review to the Discord bot. A server admin designates a channel as the "resume channel." When a user posts a message with a file attachment in a thread in that channel, the bot downloads and parses the file, reviews it against resume best practices using the guild's configured AI provider, and replies in the same thread.

**Key decisions captured from planning:**
- Bot replies inside the thread where the resume was posted (not DM, not new thread)
- All file formats supported: PDF, DOCX, TXT, images (PNG/JPG/GIF/WEBP)
- Uses the guild's configured AI provider (via existing provider abstraction)
- Channel configured via `/setup resume-channel` AND the web dashboard

---

## Acceptance Criteria

1. `/setup resume-channel #channel` stores `resume_channel_id` and sets `resume_review_enabled = 1` in `guild_config` for the guild — testable: `/setup view` shows the configured channel
2. `/setup resume-disable` sets `resume_review_enabled = 0` — testable: post a PDF, no bot reply
3. `messageCreate`: when a message is posted in a thread whose `parentId` matches `resume_channel_id` AND `resume_review_enabled = 1` AND `message.attachments.size > 0`, the bot replies in that thread with a structured review within 30 seconds
4. PDF files are parsed with `pdf-parse`; extracted text is sent to the AI for review
5. DOCX files are parsed with `mammoth`; extracted text is sent to the AI for review
6. `.txt` files are decoded as UTF-8 directly — no extra library
7. Image attachments (PNG, JPG, GIF, WEBP) are passed to vision-capable providers (Anthropic, OpenAI) using base64 encoding; if the guild uses Groq or Ollama, bot replies with a clear "image resumes not supported with your current AI provider" message
8. The AI review covers: summary/objective quality, skills section, experience descriptions (action verbs + quantification), education section, formatting/length, ATS compatibility — structured as 6 labeled sections
9. Messages without attachments in the resume channel trigger no bot action
10. Dashboard shows resume review status (enabled/disabled) and the configured channel ID with a save button
11. `ALLOWED_CONFIG_FIELDS` in `httpServer.js` includes `resume_channel_id` and `resume_review_enabled` so the dashboard POST can update them
12. `/setup view` embed includes a "Resume Review" field showing enabled/disabled status and configured channel

---

## Implementation Steps

### Step 1 — Install dependencies
```
npm install pdf-parse mammoth
```
- `pdf-parse`: PDF text extraction (pure JS, no native binaries — safe for Render)
- `mammoth`: DOCX → raw text extraction (pure JS)
- Image handling uses Node.js built-in `fetch` (Node 20) for download + base64 encoding — no extra library

---

### Step 2 — Extend database schema
**File:** `src/services/guildConfigService.js:26-44`

Add two entries to the `AI_COLUMNS` array (the existing `_addMissingColumns()` migration at line 53 applies them automatically on startup):
```js
'resume_channel_id     TEXT',
'resume_review_enabled INTEGER NOT NULL DEFAULT 0',
```

No changes to `CREATE_TABLE` or `upsertConfig` — the migration pattern already handles new columns.

---

### Step 3 — Extend provider abstraction for vision
**File:** `src/providers/index.js`

The existing `GroqChatAdapter`, `OpenAICompatibleAdapter`, and `AnthropicAdapter` each expose `chat(systemPrompt, userContent, options)`. Add a parallel `chatWithVision` method to vision-capable adapters:

**`AnthropicAdapter.chatWithVision(systemPrompt, userText, imageBuffer, mimeType)`**
- Uses `client.messages.create` with a `content` array: `[{ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } }, { type: 'text', text: userText }]`

**`OpenAICompatibleAdapter.chatWithVision(systemPrompt, userText, imageBuffer, mimeType)`**
- Uses `client.chat.completions.create` with user message `content` array: `[{ type: 'image_url', image_url: { url: \`data:${mimeType};base64,${base64}\` } }, { type: 'text', text: userText }]`

**`GroqChatAdapter`** — no `chatWithVision` method (vision not supported)

Add a helper export:
```js
function supportsVision(provider) {
  return ['anthropic', 'openai'].includes(provider);
}
```

Update `createChatProvider(guildConfig, servicePrefix)` — no changes needed; the returned adapter is used by `ResumeReviewService` directly.

---

### Step 4 — Create ResumeReviewService
**New file:** `src/services/resumeReviewService.js`

```
class ResumeReviewService {
  async handleMessage(message, guildConfig)      — entry point called from messageCreate
  async downloadAttachment(url)                  — fetch buffer from Discord CDN, cap at 10MB
  extractText(buffer, filename)                  — routes to pdf/docx/txt parser; returns null for images
  buildSystemPrompt()                            — returns resume best-practices system prompt
  buildUserPrompt(text)                          — wraps extracted text in user turn
  async reviewText(extractedText, guildConfig)   — calls createChatProvider(guildConfig, 'summ').chat(...)
  async reviewImage(buffer, mimeType, guildConfig) — calls chatWithVision or throws UnsupportedVisionError
}
```

**Key implementation details:**

`extractText(buffer, filename)`:
- Extension `.pdf` → `require('pdf-parse')(buffer)` → `.text`
- Extension `.docx` → `require('mammoth').extractRawText({ buffer })` → `.value`
- Extension `.txt` / `.text` → `buffer.toString('utf8')`
- Extensions `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` → return `null` (signals image path)
- Unknown extension → attempt UTF-8 decode as plain text fallback

`handleMessage(message, guildConfig)`:
1. Take first attachment from `message.attachments`
2. Note if multiple attachments (include "Note: only the first attachment was reviewed" in reply)
3. Download buffer
4. Call `extractText`; if `null` → image path
5. If text path: call `reviewText`, reply in thread
6. If image path: check `supportsVision(resolvedProvider)`; if yes call `reviewImage`; if no, reply with guidance
7. Wrap entire flow in try/catch; on error reply with user-friendly error message in thread

`buildSystemPrompt()` — instructs the AI to act as a professional resume reviewer and evaluate:
1. **Summary/Objective** — clarity, tailoring, impact
2. **Skills** — relevance, specificity, organization
3. **Experience** — action verbs, quantified achievements, relevance
4. **Education** — completeness, formatting
5. **Formatting & Length** — ATS compatibility, readability, length (1-2 pages)
6. **Overall Score & Top 3 Improvements** — actionable next steps

Provider resolution: uses `createChatProvider(guildConfig, 'summ')` — reuses the guild's summarization provider config (`summ_provider`, `summ_api_key`, `summ_model`). This avoids adding a new `resume_*` column set while still respecting the guild's AI choice. Pass `{ max_tokens: 2048 }` for complete reviews.

---

### Step 5 — Update messageCreate event
**File:** `src/events/messageCreate.js`

After the existing sticky logic (after line 25), add:
```js
const resumeReviewService = client.services?.resumeReviewService;
if (resumeReviewService) {
  const guildConfig = client.services?.guildConfigService?.getConfig(message.guildId);
  if (
    guildConfig?.resume_review_enabled &&
    message.channel.isThread() &&
    message.channel.parentId === guildConfig.resume_channel_id &&
    message.attachments.size > 0
  ) {
    resumeReviewService.handleMessage(message, guildConfig)
      .catch(err => console.error('[resume-review] Unhandled error:', err.message));
  }
}
```
Fire-and-forget (no `await`) so it doesn't block the event loop — consistent with how sticky handles async operations (line 20-24).

---

### Step 6 — Add `/setup` subcommands
**File:** `src/commands/setup.js`

**Add two subcommands to `SlashCommandBuilder` (after existing subcommands, before `.setDefaultMemberPermissions` if present):**

`resume-channel` subcommand:
```js
.addSubcommand(sub =>
  sub
    .setName('resume-channel')
    .setDescription('Set the channel where resumes are posted for automated AI review')
    .addChannelOption(opt =>
      opt
        .setName('channel')
        .setDescription('Channel where members post their resumes (should use threads)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum)
        .setRequired(true)
    )
)
```

`resume-disable` subcommand:
```js
.addSubcommand(sub =>
  sub
    .setName('resume-disable')
    .setDescription('Disable automated resume review for this server')
)
```

**Add handlers in `execute()` (following the same pattern as `coffee-channel` at line 403):**

`resume-channel` handler:
```js
if (subcommand === 'resume-channel') {
  const channel = interaction.options.getChannel('channel');
  await interaction.deferReply({ ephemeral: true });
  guildConfigService.upsertConfig(guildId, {
    resume_channel_id: channel.id,
    resume_review_enabled: 1,
  });
  // embed confirming the channel
}
```

`resume-disable` handler:
```js
if (subcommand === 'resume-disable') {
  await interaction.deferReply({ ephemeral: true });
  guildConfigService.upsertConfig(guildId, { resume_review_enabled: 0 });
  // embed confirming disabled
}
```

**Update `view` handler** (line 262): add a "Resume Review" field to the embed:
```js
const resumeStatus = config?.resume_review_enabled
  ? `Enabled — <#${config.resume_channel_id}>`
  : 'Disabled';
// add to embed fields:
{ name: 'Resume Review', value: resumeStatus, inline: false }
```

---

### Step 7 — Update httpServer.js allowlist
**File:** `src/services/httpServer.js:5-13`

Add to `ALLOWED_CONFIG_FIELDS` Set:
```js
'resume_channel_id', 'resume_review_enabled',
```

---

### Step 8 — Update dashboard.html
**File:** `public/dashboard.html`

Add a "Resume Review" section to the dashboard settings panel (after the existing Coffee Pairing section). The section needs:
- A channel picker `<select>` populated from `/api/channels`; pre-selects `config.resume_channel_id` on load
- An enabled/disabled `<input type="checkbox">` bound to `config.resume_review_enabled`
- A Save button that POSTs `{ resume_channel_id, resume_review_enabled, token }` to `/api/config`

Follow the same JS pattern already used for the coffee channel picker in the dashboard.

---

### Step 9 — Register ResumeReviewService in index.js
**File:** `src/index.js`

1. Import: `const { ResumeReviewService } = require('./services/resumeReviewService');`
2. Instantiate: `const resumeReviewService = new ResumeReviewService();`
3. Add to `client.services`: `resumeReviewService`

---

### Step 10 — Re-register slash commands
Run the command registration script (whichever is used in this project) to push the updated `/setup` schema (with new `resume-channel` and `resume-disable` subcommands) to Discord.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Large PDF/DOCX causes slow response | Cap downloaded files at 10MB; `pdf-parse` and `mammoth` are synchronous-ish — wrap in a 20s timeout; reply with error if exceeded |
| Password-protected PDF fails to parse | Wrap `pdf-parse` call in try/catch; reply "Could not read PDF — it may be password protected" |
| `pdf-parse` returns near-empty text (scanned PDF) | Check `text.trim().length < 100`; if too short, reply "PDF appears to be a scanned image — try exporting as a text-based PDF or submitting a DOCX/TXT version" |
| Forum channel vs text channel thread detection | `message.channel.isThread()` returns true for both; `parentId` comparison handles both correctly |
| Guild using Groq (no vision) uploads an image resume | `supportsVision()` check returns false; bot replies with clear guidance to use Anthropic or OpenAI, or to resubmit as PDF/DOCX |
| AI provider not configured | `createChatProvider` already throws a descriptive error; catch in `handleMessage` and reply to thread |
| Multiple attachments on one message | Review first attachment only; if `message.attachments.size > 1`, add "Note: only the first attachment was reviewed" to the reply |
| Bot posts duplicate reviews if user edits message | `messageCreate` only fires on new messages, not edits — no issue |
| `resume_review_enabled` null vs 0 in SQLite | `config?.resume_review_enabled` is falsy for both `null` and `0` — the check `if (config?.resume_review_enabled)` handles both |

---

## Verification Steps

1. `/setup resume-channel #resume` → `/setup view` shows resume channel and "Enabled" — **pass/fail**
2. Post a PDF with a resume in a thread in the configured channel → bot replies with structured 6-section review within 30s — **pass/fail**
3. Post a DOCX → bot replies with review — **pass/fail**
4. Post a `.txt` file → bot replies with review — **pass/fail**
5. Post a PNG with Anthropic provider → bot replies with vision-based review — **pass/fail**
6. Post a PNG with Groq provider → bot replies with "image not supported" message — **pass/fail**
7. Post a message with NO attachment in the resume channel thread → no bot reply — **pass/fail**
8. `/setup resume-disable` → post a PDF → no bot reply — **pass/fail**
9. Open dashboard → "Resume Review" section shows the correct channel and enabled state; change channel → `/setup view` reflects the new value — **pass/fail**
10. Post a 0-byte or corrupted file → bot replies with a graceful error message, does not crash — **pass/fail**

---

## Files Changed Summary

| File | Change |
|------|--------|
| `src/services/resumeReviewService.js` | **NEW** — core service |
| `src/services/guildConfigService.js` | Add 2 columns to `AI_COLUMNS` array (lines 26-44) |
| `src/providers/index.js` | Add `chatWithVision` to Anthropic + OpenAI adapters; add `supportsVision()` export |
| `src/commands/setup.js` | Add 2 subcommands to builder + 2 handlers + update `view` embed |
| `src/events/messageCreate.js` | Add resume check after sticky logic |
| `src/services/httpServer.js` | Add 2 fields to `ALLOWED_CONFIG_FIELDS` |
| `public/dashboard.html` | Add Resume Review settings section |
| `src/index.js` | Import + instantiate + register `ResumeReviewService` |
