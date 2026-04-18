const fs = require('fs');
const path = require('path');
const { ensureDataDir } = require('../utils/helpers');

const VERSION_FILE = path.join(ensureDataDir(), 'last_version.txt');
const CHANGELOG_PATH = path.join(__dirname, '..', '..', 'CHANGELOG.md');
const CURRENT_VERSION = require('../../package.json').version;

function readLastVersion() {
  try {
    if (!fs.existsSync(VERSION_FILE)) return null;
    return fs.readFileSync(VERSION_FILE, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

function saveCurrentVersion() {
  try {
    fs.writeFileSync(VERSION_FILE, CURRENT_VERSION);
  } catch (e) {
    console.warn('[releaseNotifier] Could not save version file:', e.message);
  }
}

/**
 * Extract the changelog section for the given version.
 * Looks for `## [x.y.z]` headers and returns everything up to the next `## [`.
 */
function extractChangelogSection(version) {
  try {
    if (!fs.existsSync(CHANGELOG_PATH)) return null;
    const content = fs.readFileSync(CHANGELOG_PATH, 'utf-8');
    const startMarker = `## [${version}]`;
    const startIdx = content.indexOf(startMarker);
    if (startIdx === -1) return null;

    const afterStart = content.indexOf('\n', startIdx) + 1;
    const nextSection = content.indexOf('\n## [', afterStart);
    const section = nextSection === -1
      ? content.slice(afterStart).trim()
      : content.slice(afterStart, nextSection).trim();

    return section || null;
  } catch {
    return null;
  }
}

/**
 * Send release notification to installers via DM and/or a configured channel.
 * Call this after the client is ready.
 * @param {import('discord.js').Client} client
 * @param {import('./guildConfigService').GuildConfigService|null} guildConfigService
 */
async function notifyRelease(client, guildConfigService = null) {
  const lastVersion = readLastVersion();

  if (lastVersion === CURRENT_VERSION) return; // no change

  const isFirstRun = lastVersion === null;
  const changelogSection = extractChangelogSection(CURRENT_VERSION);

  const header = isFirstRun
    ? `🤖 Bot is online! Running **v${CURRENT_VERSION}**.`
    : `🚀 Bot updated from **v${lastVersion}** → **v${CURRENT_VERSION}**!`;

  const body = changelogSection
    ? `\n\n**What's new:**\n${changelogSection}`
    : '';

  const message = `${header}${body}`;

  // Collect unique user IDs to notify: per-guild installers + any ALLOWED_USER_IDS fallback
  const userIds = new Set();

  if (guildConfigService) {
    for (const id of guildConfigService.getAllInstallerUserIds()) userIds.add(id);
  }

  // Fallback: legacy env var (still honoured if set)
  for (const id of (process.env.ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)) {
    userIds.add(id);
  }

  const NOTIFY_CHANNEL_ID = process.env.RELEASE_NOTIFY_CHANNEL_ID;

  let notified = false;

  // DM each installer
  for (const userId of userIds) {
    try {
      const user = await client.users.fetch(userId);
      const chunks = splitMessage(message);
      for (const chunk of chunks) await user.send(chunk);
      notified = true;
    } catch (e) {
      console.warn(`[releaseNotifier] Could not DM user ${userId}:`, e.message);
    }
  }

  // Post to notification channel if configured
  if (NOTIFY_CHANNEL_ID) {
    try {
      const channel = await client.channels.fetch(NOTIFY_CHANNEL_ID);
      if (channel?.isTextBased()) {
        const chunks = splitMessage(message);
        for (const chunk of chunks) await channel.send(chunk);
        notified = true;
      }
    } catch (e) {
      console.warn('[releaseNotifier] Could not send to release channel:', e.message);
    }
  }

  if (!notified && !isFirstRun) {
    console.warn('[releaseNotifier] No installers found — ensure the bot has ViewAuditLog permission, or set RELEASE_NOTIFY_CHANNEL_ID');
  }

  console.log(`[releaseNotifier] Release v${CURRENT_VERSION} announced (was: ${lastVersion ?? 'first run'})`);
  saveCurrentVersion();
}

function splitMessage(text, maxLen = 1900) {
  const chunks = [];
  while (text.length > maxLen) {
    chunks.push(text.slice(0, maxLen));
    text = text.slice(maxLen);
  }
  if (text.length) chunks.push(text);
  return chunks;
}

module.exports = { notifyRelease, CURRENT_VERSION };
