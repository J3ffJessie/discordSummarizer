const fs = require('fs');
const path = require('path');
const { ensureDataDir } = require('../utils/helpers');
const logger = require('../utils/logger');

const DATA_DIR = ensureDataDir();
const REMINDER_FILE = path.join(DATA_DIR, 'reminders.json');
const REMINDER_LOCK_FILE = path.join(DATA_DIR, 'reminders.json.lock');

let reminders = [];
const scheduledTimeouts = new Map();
let _client = null;

function init(client) {
  _client = client;
}

function loadRemindersFromFile() {
  try {
    if (!fs.existsSync(REMINDER_FILE)) return [];
    const data = fs.readFileSync(REMINDER_FILE, 'utf8') || '[]';
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Failed to load reminders from file:', err?.message || err);
    return [];
  }
}

function saveRemindersToFile(list) {
  try {
    fs.writeFileSync(REMINDER_FILE, JSON.stringify(list, null, 2));
  } catch (err) {
    console.error('Failed to save reminders to file:', err?.message || err);
  }
}

// Simple file lock utility
async function acquireRemindersLock(retries = 50, delayMs = 100) {
  for (let i = 0; i < retries; i++) {
    try {
      const fd = fs.openSync(REMINDER_LOCK_FILE, 'wx');
      fs.writeSync(fd, `${process.pid}\n${Date.now()}`);
      fs.closeSync(fd);
      return () => {
        try { fs.unlinkSync(REMINDER_LOCK_FILE); } catch (e) {}
      };
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        try {
          const stat = fs.statSync(REMINDER_LOCK_FILE);
          const ageMs = Date.now() - stat.mtimeMs;
          if (ageMs > 30000) {
            try { fs.unlinkSync(REMINDER_LOCK_FILE); } catch (er) {}
          }
        } catch (sErr) {}
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Could not acquire reminders lock');
}

function findDuplicatePersistedReminder(reminder, persisted) {
  const TOLERANCE_MS = 5000;
  return (persisted || []).find((r) => {
    try {
      return r.userId === reminder.userId && (r.msg || '').trim() === (reminder.msg || '').trim() && Math.abs((Number(r.time) || 0) - Number(reminder.time)) <= TOLERANCE_MS;
    } catch (e) { return false; }
  });
}

async function addReminderSafely(reminder) {
  let release;
  try {
    release = await acquireRemindersLock();
  } catch (err) {
    // fallback: try naive append under best-effort
    try {
      const persisted = loadRemindersFromFile();
      const dup = findDuplicatePersistedReminder(reminder, persisted);
      if (dup) return { created: false, existing: dup };
      persisted.push(reminder);
      saveRemindersToFile(persisted);
      reminders = persisted;
      scheduleReminder(reminder, Math.max(0, reminder.time - Date.now()));
      return { created: true };
    } catch (e) {
      throw e;
    }
  }

  try {
    const persisted = loadRemindersFromFile();
    const dup = findDuplicatePersistedReminder(reminder, persisted);
    if (dup) return { created: false, existing: dup };
    persisted.push(reminder);
    saveRemindersToFile(persisted);
    reminders = persisted;
    scheduleReminder(reminder, Math.max(0, reminder.time - Date.now()));
    return { created: true };
  } finally {
    try { release && release(); } catch (e) {}
  }
}

function cleanReminders() {
  const before = reminders.length;
  reminders = reminders.filter((r) => r.time > Date.now());
  for (const [id, timeout] of scheduledTimeouts.entries()) {
    const remExists = reminders.find((r) => r.id === id);
    if (!remExists) {
      clearTimeout(timeout);
      scheduledTimeouts.delete(id);
    }
  }
  if (reminders.length !== before) saveRemindersToFile(reminders);
}

// parseTime and splitTimeAndMessage ported
function parseTime(input) {
  if (!input || typeof input !== 'string') return null;
  const regex = /(\d+(?:\.\d+)?)\s*(mo(?:nths?)?|w(?:eeks?)?|d(?:ays?)?|h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)/gi;
  let total = 0; let matched = false; const str = input.toLowerCase().replace(/[,]+/g, ' ');
  let m;
  while ((m = regex.exec(str)) !== null) {
    matched = true;
    const value = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit.startsWith('mo')) total += value * 30 * 24 * 60 * 60 * 1000;
    else if (unit.startsWith('w')) total += value * 7 * 24 * 60 * 60 * 1000;
    else if (unit.startsWith('d')) total += value * 24 * 60 * 60 * 1000;
    else if (unit.startsWith('h')) total += value * 60 * 60 * 1000;
    else if (unit.startsWith('m')) total += value * 60 * 1000;
    else if (unit.startsWith('s')) total += value * 1000;
  }
  return matched && total > 0 ? Math.round(total) : null;
}

function splitTimeAndMessage(args) {
  const timeUnits = ['mo','month','months','w','week','weeks','d','day','days','h','hour','hours','m','min','minute','minutes','s','sec','second','seconds'];
  let timeStrTokens = [];
  let i = 0;
  while (i < args.length) {
    const token = args[i].toLowerCase();
    const next = args[i+1] ? args[i+1].toLowerCase() : null;
    if (!isNaN(token) && next && timeUnits.some((u) => next.startsWith(u))) {
      timeStrTokens.push(token); timeStrTokens.push(next); i += 2; continue;
    } else if (/^\d+[smhdwmo]+$/i.test(token)) { timeStrTokens.push(token); i++; continue; }
    else break;
  }
  const timeStr = timeStrTokens.join(' ');
  const reminderMsg = args.slice(i).join(' ');
  return { timeStr, reminderMsg };
}

// Scheduling helpers
function scheduleReminder(reminder, delayMs) {
  if (scheduledTimeouts.has(reminder.id)) {
    try { clearTimeout(scheduledTimeouts.get(reminder.id)); scheduledTimeouts.delete(reminder.id); } catch (e) {}
  }
  const timeoutId = setTimeout(() => sendReminder(reminder), Math.max(0, delayMs));
  scheduledTimeouts.set(reminder.id, timeoutId);
}

async function sendReminder(reminder) {
  try {
    // refresh persisted list and ensure reminder still active
    let persisted = [];
    try { persisted = loadRemindersFromFile(); } catch (e) { persisted = []; }
    const stillActive = persisted.some((r) => r.id === reminder.id) || reminders.some((r) => r.id === reminder.id);
    if (!stillActive) {
      if (scheduledTimeouts.has(reminder.id)) { clearTimeout(scheduledTimeouts.get(reminder.id)); scheduledTimeouts.delete(reminder.id); }
      return;
    }
    if (!_client) {
      console.warn('Refactor client not available to send reminder');
    } else {
      try {
        const user = await _client.users.fetch(reminder.userId);
        await user.send(`🔔 Reminder: ${reminder.msg}`);
      } catch (dmErr) {
        console.warn('Failed to DM user for reminder:', dmErr?.message || dmErr);
      }
    }
    // remove from persisted
    reminders = reminders.filter((r) => r.id !== reminder.id);
    saveRemindersToFile(reminders);
    if (scheduledTimeouts.has(reminder.id)) { clearTimeout(scheduledTimeouts.get(reminder.id)); scheduledTimeouts.delete(reminder.id); }
  } catch (err) {
    logger.logError(err, 'sendReminder error').catch(() => {});
  }
}

function rescheduleAll() {
  reminders = loadRemindersFromFile();
  for (const r of reminders) {
    const delay = r.time - Date.now();
    if (delay <= 0) sendReminder(r);
    else scheduleReminder(r, delay);
  }
}

// Cancel reminder by id for a user
function cancelReminderById(userId, id) {
  const idx = reminders.findIndex((r) => r.id === id && r.userId === userId);
  if (idx === -1) return false;
  const rem = reminders[idx];
  if (scheduledTimeouts.has(rem.id)) {
    clearTimeout(scheduledTimeouts.get(rem.id));
    scheduledTimeouts.delete(rem.id);
  }
  reminders.splice(idx, 1);
  saveRemindersToFile(reminders);
  return true;
}

// Cancel all reminders for a user
function cancelAllForUser(userId) {
  const userReminders = reminders.filter((r) => r.userId === userId);
  if (userReminders.length === 0) return 0;
  userReminders.forEach((r) => {
    if (scheduledTimeouts.has(r.id)) {
      clearTimeout(scheduledTimeouts.get(r.id));
      scheduledTimeouts.delete(r.id);
    }
  });
  reminders = reminders.filter((r) => r.userId !== userId);
  saveRemindersToFile(reminders);
  return userReminders.length;
}

function listRemindersForUser(userId) {
  const persisted = loadRemindersFromFile();
  return persisted.filter((r) => r.userId === userId);
}

// Public API
module.exports = {
  init,
  parseTime,
  splitTimeAndMessage,
  addReminderSafely,
  loadRemindersFromFile,
  rescheduleAll,
  cancelReminderById,
  cancelAllForUser,
  listRemindersForUser,
  // for tests or admin
  _internal: { scheduledTimeouts, reminders },
};
