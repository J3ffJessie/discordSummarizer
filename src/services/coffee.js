const fs = require('fs');
const path = require('path');
const { ensureDataDir } = require('../utils/helpers');

const DATA_DIR = ensureDataDir();
const COFFEE_FILE = path.join(DATA_DIR, 'coffee_pairs.json');

function readCoffeePairs() {
  try {
    if (!fs.existsSync(COFFEE_FILE)) return {};
    const raw = fs.readFileSync(COFFEE_FILE, 'utf-8') || '{}';
    const parsed = JSON.parse(raw);
    // Normalize older format
    Object.keys(parsed).forEach((userId) => {
      const entry = parsed[userId];
      if (!entry) return;
      if (!entry.history && entry.lastPaired) {
        const ts = Number(entry.lastPaired) || Date.now();
        const partners = Array.isArray(entry.partners) ? entry.partners : [];
        entry.history = partners.map((p) => ({ partnerId: p, timestamp: ts }));
        delete entry.lastPaired;
        delete entry.partners;
      }
      if (!entry.history) entry.history = [];
    });
    return parsed;
  } catch (e) {
    console.warn('Error reading coffee pairs:', e?.message || e);
    return {};
  }
}

function saveCoffeePairs(data) {
  try {
    fs.writeFileSync(COFFEE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error saving coffee pairs:', e?.message || e);
  }
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function fetchGuildMembersWithTimeout(guild, timeoutMs = 10000) {
  return Promise.race([
    guild.members.fetch(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('GuildMembersFetchTimeout')), timeoutMs)
    ),
  ]);
}

/**
 * Robustly return the list of guild members that have the configured coffee role.
 * Attempts to refresh guild member cache and deduplicates by user id.
 */
async function getMembersWithCoffeeRole(guild, roleIdentifier) {
  const roleName = roleIdentifier || process.env.COFFEE_ROLE_NAME || 'coffee chat';
  const COFFEE_FETCH_MEMBERS = typeof process.env.COFFEE_FETCH_MEMBERS !== 'undefined'
    ? process.env.COFFEE_FETCH_MEMBERS === 'true'
    : true;
  const COFFEE_FETCH_TIMEOUT_MS = Number(process.env.COFFEE_FETCH_TIMEOUT_MS || 10000);

  // Find role
  const role = guild.roles.cache.find((r) => r.name === roleName || r.id === roleName);
  if (!role) {
    console.warn(`getMembersWithCoffeeRole: role ${roleName} not found in guild ${guild?.name || guild?.id}`);
    return [];
  }

  // Try to populate member cache if configured
  if (COFFEE_FETCH_MEMBERS) {
    try {
      // prefer force fetch to ensure cache populated (requires GUILD_MEMBERS intent enabled in developer portal)
      await guild.members.fetch({ force: true });
    } catch (err) {
      try {
        await fetchGuildMembersWithTimeout(guild, COFFEE_FETCH_TIMEOUT_MS);
      } catch (err2) {
        console.warn('getMembersWithCoffeeRole: member fetch failed or timed out, proceeding with current cache');
      }
    }
  }

  // Build member list from the guild cache by role id
  let members = [];
  try {
    members = guild.members.cache.filter((m) => {
      try {
        return !m.user?.bot && m.roles?.cache?.has(role.id);
      } catch (e) {
        return false;
      }
    }).map((m) => m);
  } catch (e) {
    console.warn('getMembersWithCoffeeRole: error filtering guild members cache', e?.message || e);
    members = [];
  }

  // Dedupe by user id (sometimes cache can contain duplicates in weird states)
  const unique = new Map();
  members.forEach((m) => {
    if (!m || !m.id) return;
    unique.set(String(m.id), m);
  });
  members = Array.from(unique.values());

  // Capture simple snapshots for DM messages
  members = members.map((m) => {
    m._capturedUsername = m.user?.username || m.user?.tag || 'Unknown';
    m._capturedDiscriminator = m.user?.discriminator || '0000';
    return m;
  });

  console.log(`getMembersWithCoffeeRole: role='${roleName}' role.members.size=${role.members?.size || 0} guild.cache.members=${guild.members.cache.size} returning ${members.length}`);
  // Debug small sample of ids
  if (members.length > 0) {
    console.log('getMembersWithCoffeeRole ids:', members.slice(0, 20).map((m) => m.id).join(','));
  }

  return members;
}

function getLastPairTimestamp(history, userA, userB) {
  if (!history || !history[userA]) return 0;
  const entry = history[userA];
  if (!entry || !Array.isArray(entry.history)) return 0;
  const rec = entry.history.find((h) => h.partnerId === userB);
  return rec ? Number(rec.timestamp) || 0 : 0;
}

function getPairCount(history, userA, userB) {
  if (!history || !history[userA] || !Array.isArray(history[userA].history)) return 0;
  return history[userA].history.reduce((acc, h) => acc + (h.partnerId === userB ? 1 : 0), 0);
}

function wasRecentlyPaired(history, userA, userB, cooldownMs) {
  const aTs = getLastPairTimestamp(history, userA, userB);
  const bTs = getLastPairTimestamp(history, userB, userA);
  const ts = Math.max(aTs, bTs);
  if (!ts) return false;
  return Date.now() - ts < cooldownMs;
}

/**
 * Pair up members with cooldown rules.
 * Returns arrays of pairs or trios. Ensures each member appears at most once.
 */
function pairUpWithCooldown(members, history, cooldownMs) {
  if (!members || members.length === 0) return [];
  // shallow copy and shuffle
  const pool = shuffle(members.slice());
  const pairs = [];
  const used = new Set();

  while (pool.length >= 2) {
    const a = pool.shift();
    if (!a || used.has(a.id)) continue;

    // find partner index in pool
    let partnerIndex = -1;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      if (!cand || used.has(cand.id)) continue;
      if (!wasRecentlyPaired(history, a.id, cand.id, cooldownMs)) {
        partnerIndex = i;
        break;
      }
    }

    // fallback to least-paired if no fresh partner
    if (partnerIndex === -1) {
      let minCount = Number.MAX_SAFE_INTEGER;
      let oldestTs = Number.MAX_SAFE_INTEGER;
      for (let i = 0; i < pool.length; i++) {
        const cand = pool[i];
        if (!cand || used.has(cand.id)) continue;
        const count = getPairCount(history, a.id, cand.id) + getPairCount(history, cand.id, a.id);
        const ts = Math.max(getLastPairTimestamp(history, a.id, cand.id) || 0, getLastPairTimestamp(history, cand.id, a.id) || 0);
        if (count < minCount || (count === minCount && ts < oldestTs)) {
          minCount = count;
          oldestTs = ts;
          partnerIndex = i;
        }
      }
    }

    if (partnerIndex === -1) {
      // couldn't find any partner, put a back and break
      pool.push(a);
      break;
    }

    const b = pool.splice(partnerIndex, 1)[0];
    used.add(a.id);
    used.add(b.id);
    pairs.push([a, b]);
  }

  // handle leftover
  if (pool.length === 1) {
    const last = pool.pop();
    if (pairs.length > 0 && !used.has(last.id)) {
      // add to last pair to form a trio
      pairs[pairs.length - 1].push(last);
    } else if (!used.has(last.id)) {
      pairs.push([last]);
    }
  }

  return pairs;
}

async function notifyPairs(pairs, guild, source = 'scheduled') {
  let history = readCoffeePairs();
  const results = [];
  let totalFailedDMs = 0;

  for (const pair of pairs) {
    const usernames = pair.map((m) => `${m._capturedUsername}#${m._capturedDiscriminator}`);
    for (const m of pair) {
      const others = pair.filter((p) => p.id !== m.id).map((p) => `${p._capturedUsername} (${p.id})`).join(' and ');
      const senderName = m._capturedUsername;
      const content = `☕ Hi ${senderName}! You were paired for a coffee chat with ${others}. Please DM them to set up a time. (${source})`;
      try {
        await m.send({ content });
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        totalFailedDMs++;
        console.warn(`Could not DM user ${m.id}:`, err?.message || err);
      }
    }

    const timeNow = Date.now();
    pair.forEach((m) => {
      if (!history[m.id]) history[m.id] = { history: [] };
      const entry = history[m.id];
      const partnersToAdd = pair.filter((p) => p.id !== m.id).map((p) => p.id);
      partnersToAdd.forEach((pid) => entry.history.push({ partnerId: pid, timestamp: timeNow }));
      if (entry.history.length > 200) entry.history = entry.history.slice(-200);
    });
    results.push({ pair: usernames });
  }

  saveCoffeePairs(history);
  return { results, failed: totalFailedDMs };
}

async function runCoffeePairing(guild, roleIdentifier = process.env.COFFEE_ROLE_NAME || 'coffee chat', source = 'scheduled') {
  try {
    const members = await getMembersWithCoffeeRole(guild, roleIdentifier);
    console.log(`runCoffeePairing: found ${members.length} members eligible`);
    if (!members || members.length < 2) return [];
    let history = readCoffeePairs();
    const cooldownDays = Number(process.env.COFFEE_PAIRING_COOLDOWN_DAYS || 30);
    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
    const pairs = pairUpWithCooldown(members, history, cooldownMs);
    console.log(`runCoffeePairing: created ${pairs.length} pair groups`);
    const res = await notifyPairs(pairs, guild, source);
    return res.results;
  } catch (err) {
    console.error('Error running coffee pairing:', err?.message || err);
    return [];
  }
}

module.exports = { runCoffeePairing, getMembersWithCoffeeRole, readCoffeePairs, saveCoffeePairs };
