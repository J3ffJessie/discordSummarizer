// Import required dependencies
/** @type {*} */
const http = require("http");
const {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType, // ✅ Added this to fix ChannelType error
} = require("discord.js");
const dotenv = require("dotenv");
const Groq = require("groq-sdk");
const axios = require("axios");
const cron = require("node-cron");

const { findLocation } = require("./locations");
const fs = require("fs");
const path = require("path");

// Load environment variables
dotenv.config();

// Delay helper to respect rate limits
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Initialize Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Register slash commands
const commands = [
  new SlashCommandBuilder()
    .setName("summarize")
    .setDescription("Summarize recent messages in this channel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("events")
    .setDescription("Get upcoming events for the next 7 days")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("coffee-pair")
    .setDescription(
      "Randomly pair users that have the coffee-chat role and send them a DM to meet"
    )
    .toJSON(),
];

const TARGET_CHANNEL_ID = "1392954859803644014"; // Replace with your target channel ID for weekly summaries

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Started refreshing application (/) commands.");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands,
    });
    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    await logError(error, "Error registering slash commands");
  }
})();

// Summarization function
async function summarizeMessages(messages) {
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are a friendly Discord conversation analyzer. Summarize the following Discord conversation as a concise, engaging list of key points. Use bullet points, but do not break the summary into sections or categories. Just provide a single bulleted list that captures the main ideas, events, and noteworthy exchanges from the conversation.",
        },
        {
          role: "user",
          content: `Please provide a detailed summary of this Discord conversation following the format above:\n\n${messages}`,
        },
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.7,
      max_tokens: 1024,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    await logError(error, "Error in summarization");
    throw error;
  }
}

// Server summarization function
// async function serverSummarize(messages) {
//   console.log("Starting server summarization...");
//   try {
//     const completion = await groq.chat.completions.create({
//       messages: [
//         {
//           role: "system",
//           content: `You are a friendly Discord conversation analyzer. Format your response in this engaging style:\n\n📬 **Conversation Overview**\nHere's what was discussed in the chat:\n\n🎯 **Main Topics & Decisions**\n• [Detailed point about the first main topic, including any decisions or outcomes]\n• [Detailed point about the second main topic, including any decisions or outcomes]\n\n🔄 **Ongoing Discussions**\n• [Any continuing discussions or unresolved points]\n\n📋 **Action Items**\n• [Any clear next steps or tasks mentioned]\n\nYour summary should:\n- Maintain a friendly, natural tone\n- Provide context for technical discussions\n- Include specific details while avoiding usernames\n- Separate ongoing discussions from concrete decisions\n- Keep technical and social topics separate\n- Be thorough yet concise`,
//         },
//         {
//           role: "user",
//           content: `Please provide a detailed summary of this Discord conversation following the format above:\n\n${messages}`,
//         },
//       ],
//       model: "llama-3.1-8b-instant",
//       temperature: 0.7,
//       max_tokens: 1024,
//     });
//     return completion.choices[0].message.content;
//   } catch (error) {
//     await logError(error, "Error in server summarization");
//     throw error;
//   }
// }

async function serverSummarize(messages) {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0.3,
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `
You are a Discord conversation summarizer.

CRITICAL RULES:
- Only summarize information explicitly present in the messages
- Do NOT infer intent, motivation, or outcomes
- Do NOT invent decisions, conclusions, or action items
- If a section has no relevant content, write "None mentioned"
- If something is unclear or ambiguous, state that clearly

The input is a chronological Discord chat log.
Ignore jokes, memes, or sarcasm unless they directly impact discussion outcomes.

Format your response exactly as follows:

📬 **Conversation Overview**
A concise, factual overview of what was discussed.

🧾 **Explicitly Stated Facts**
• Only facts clearly stated in the conversation

🎯 **Main Topics & Decisions**
• Topics discussed and decisions ONLY if explicitly stated
• If no decisions were made, say so

🔄 **Ongoing or Unresolved Discussions**
• Topics still being discussed or left unresolved
• If unclear, state the uncertainty

📋 **Action Items (only if explicitly stated)**
• Task + details if clearly mentioned
• Otherwise: "No explicit action items mentioned"

Maintain a friendly but factual tone.
Avoid speculation.
Be thorough but concise.
`,
        },
        {
          role: "user",
          content: messages,
        },
      ],
    });

    return completion.choices[0].message.content;
  } catch (error) {
    await logError(error, "Error in server summarization");
    throw error;
  }
}

// ---- Coffee-pairing Helpers ----
const COFFEE_ROLE_NAME = process.env.COFFEE_ROLE_NAME || "coffee chat";
const COFFEE_CRON_SCHEDULE =
  process.env.COFFEE_CRON_SCHEDULE || process.env.COFFEE_CRON || "0 9 * * 1"; // every other Monday at 09:00 UTC
const COFFEE_PAIRING_COOLDOWN_DAYS = Number(
  process.env.COFFEE_PAIRING_COOLDOWN_DAYS || 30
);
const COFFEE_PAIRING_COOLDOWN_MS =
  COFFEE_PAIRING_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const COFFEE_PAIRING_FILE = path.join(__dirname, "coffee_pairs.json");
const COFFEE_FETCH_MEMBERS =
  typeof process.env.COFFEE_FETCH_MEMBERS !== "undefined"
    ? process.env.COFFEE_FETCH_MEMBERS === "true"
    : true; // if true, attempt guild.members.fetch() when cache is insufficient (default true)
const COFFEE_FETCH_TIMEOUT_MS = Number(
  process.env.COFFEE_FETCH_TIMEOUT_MS || 10000
);

function getISOWeek(date = new Date()) {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// Optional Mee6 integration settings: set COFFEE_MIN_MEE6_LEVEL via env var
// to filter coffee-role members to only those at or above the configured Mee6 level.
// Default to 0 (disabled) so servers without Mee6 are not filtered.
const COFFEE_MIN_MEE6_LEVEL = Number(process.env.COFFEE_MIN_MEE6_LEVEL || 0);
// Base for fetching the MEE6 leaderboard; default to the public site
const COFFEE_MEE6_API_HOST = "https://mee6.xyz";
// If strict, the coffee pairing will abort (no members) when Mee6 lookup fails
const COFFEE_MEE6_STRICT = process.env.COFFEE_MEE6_STRICT === "false";

function readCoffeePairs() {
  try {
    if (!fs.existsSync(COFFEE_PAIRING_FILE)) return {};
    const raw = JSON.parse(
      fs.readFileSync(COFFEE_PAIRING_FILE, "utf-8") || "{}"
    );
    // Normalize older format to history array structure
    Object.keys(raw).forEach((userId) => {
      const entry = raw[userId];
      if (!entry) return;
      if (!entry.history && entry.lastPaired) {
        // Migrate existing 'lastPaired' + 'partners' to 'history' entries
        const ts = Number(entry.lastPaired) || Date.now();
        const partners = Array.isArray(entry.partners) ? entry.partners : [];
        entry.history = partners.map((p) => ({ partnerId: p, timestamp: ts }));
        delete entry.lastPaired;
        delete entry.partners;
      }
      if (!entry.history) entry.history = [];
    });
    return raw;
  } catch (e) {
    logError(e, "Error reading coffee_pairs.json").catch(() => {});
    return {};
  }
}

function saveCoffeePairs(data) {
  try {
    fs.writeFileSync(COFFEE_PAIRING_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    logError(e, "Error saving coffee_pairs.json").catch(() => {});
  }
}

function normalizeHistory(data) {
  // Ensure every user has history array
  Object.keys(data).forEach((uid) => {
    const entry = data[uid];
    if (!entry) data[uid] = { history: [] };
    else if (!Array.isArray(entry.history)) entry.history = [];
  });
  return data;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function getMembersWithCoffeeRole(
  guild,
  roleIdentifier = COFFEE_ROLE_NAME
) {
  let role = guild.roles.cache.find(
    (r) => r.name === roleIdentifier || r.id === roleIdentifier
  );
  if (!role) {
    console.warn(`Role ${roleIdentifier} not found in ${guild.name}`);
    return [];
  }
  // Prefer cached role members to avoid long fetches. If enabled, try fetching members with timeout
  let members = role.members.filter((m) => !m.user.bot).map((m) => m);
  if (members.length < 2 && COFFEE_FETCH_MEMBERS) {
    try {
      await fetchGuildMembersWithTimeout(guild, COFFEE_FETCH_TIMEOUT_MS);
      members = role.members.filter((m) => !m.user.bot).map((m) => m);
    } catch (err) {
      // The underlying discord.js fetch can throw a GuildMembersTimeout error or our timed out error
      console.warn(
        "Could not refresh member cache (fetch timed out or failed). Falling back to cached role members.",
        err && err.message ? err.message : err
      );
    }
  }
  let memberList = Array.from(members.values());

  // Optionally filter by Mee6 minimum level if configured
  if (COFFEE_MIN_MEE6_LEVEL > 0) {
    let levels = {};
    try {
      levels = await fetchMee6LevelsForGuildMembers(
        guild.id,
        memberList.map((m) => m.id)
      );
    } catch (err) {
      console.warn(
        "Could not fetch Mee6 leaderboard for guild or apply min level filter:",
        err?.message || err
      );
      if (COFFEE_MEE6_STRICT) {
        console.warn(
          "COFFEE_MEE6_STRICT is enabled — aborting coffee pairing due to failed Mee6 lookup."
        );
        return [];
      }
    }
    // If the lookup returned no data and strict mode is disabled, skip the filter
    const hasMee6Data = levels && Object.keys(levels).length > 0;
    if (!hasMee6Data && !COFFEE_MEE6_STRICT) {
      console.log(
        "Mee6 filter configured, but no Mee6 data found — skipping Mee6 filtering (set COFFEE_MEE6_STRICT=true to abort instead).\n"
      );
    } else {
      const before = memberList.length;
      memberList = memberList.filter((m) => {
        // map keys are IDs returned from the Mee6 leaderboard; default to level 0 if not present
        const lvl = Number(levels[String(m.id)] || levels[m.id] || 0);
        return lvl >= COFFEE_MIN_MEE6_LEVEL;
      });
      const after = memberList.length;
      console.log(
        `Mee6 level filter: required >=${COFFEE_MIN_MEE6_LEVEL} — filtered ${before} -> ${after}`
      );
    }
  }

  return memberList;
}

/**
 * Fetch Mee6 leaderboard entries and return a map of userId->level for the requested members
 * This is a best-effort approach that queries the public MEE6 leaderboard JSON
 * - If MEE6 is not in the guild or the plugin is disabled, the call can 404 and we'll treat that as no-one has a level
 * - This implementation attempts to request a large limit and fallback sensibly
 */
async function fetchMee6LevelsForGuildMembers(
  guildId,
  memberIds = [],
  limit = 1000
) {
  // Fast path: if no members requested, return empty mapping
  if (!memberIds || memberIds.length === 0) return {};

  const map = {};
  try {
    // try to fetch a large leaderboard page. If the server has many members you may need to increase paging logic
    const url = `${COFFEE_MEE6_API_HOST}/api/plugins/levels/leaderboard/${guildId}?limit=${limit}`;
    const res = await axios.get(url, {
      headers: { Accept: "application/json" },
      timeout: 8000,
    });
    const data = res.data || {};
    // Mee6 leaderboard sometimes returns data under 'entries' or 'players'
    const entries = data.entries || data.players || data.leaderboard || [];
    if (Array.isArray(entries) && entries.length > 0) {
      entries.forEach((e) => {
        if (!e) return;
        // Support multiple id fields the API may emit
        const userId = (
          e.id ||
          e.user_id ||
          e.userId ||
          e.uid ||
          e.discord_id ||
          e.discordId ||
          ""
        ).toString();
        const levelVal =
          typeof e.level !== "undefined" ? e.level : e.rank || e.xp || 0;
        if (userId) map[userId] = Number(levelVal) || 0;
      });
    }
  } catch (err) {
    // If the request fails (404, network, etc.) log and return empty map
    // We prefer to avoid blocking pairings entirely in case of a temporary issue
    console.warn(
      `Failed to fetch Mee6 leaderboard for guild ${guildId}:`,
      err?.message || err
    );
  }

  // If some member IDs are still missing in the map, their level remains 0
  return map;
}

async function fetchGuildMembersWithTimeout(guild, timeoutMs = 10000) {
  // Return a promise that races member fetch with timeout
  return Promise.race([
    guild.members.fetch(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("GuildMembersFetchTimeout")), timeoutMs)
    ),
  ]);
}

function pairUp(members) {
  if (!members || members.length === 0) return [];
  const shuffled = shuffle(members.slice());
  const pairs = [];
  while (shuffled.length >= 2) {
    const a = shuffled.pop();
    const b = shuffled.pop();
    pairs.push([a, b]);
  }
  // If leftover, add them as a trio with the last pair
  if (shuffled.length === 1) {
    if (pairs.length > 0) pairs[pairs.length - 1].push(shuffled.pop());
    else pairs.push([shuffled.pop()]);
  }
  return pairs;
}

function getLastPairTimestamp(history, userA, userB) {
  if (!history || !history[userA]) return 0;
  const entry = history[userA];
  if (!entry || !Array.isArray(entry.history)) return 0;
  const rec = entry.history.find((h) => h.partnerId === userB);
  return rec ? Number(rec.timestamp) || 0 : 0;
}

function getPairCount(history, userA, userB) {
  if (!history || !history[userA] || !Array.isArray(history[userA].history))
    return 0;
  return history[userA].history.reduce(
    (acc, h) => acc + (h.partnerId === userB ? 1 : 0),
    0
  );
}

function wasRecentlyPaired(history, userA, userB, cooldownMs) {
  const aTs = getLastPairTimestamp(history, userA, userB);
  const bTs = getLastPairTimestamp(history, userB, userA);
  const ts = Math.max(aTs, bTs);
  if (!ts) return false;
  return Date.now() - ts < cooldownMs;
}

function pairUpWithCooldown(members, history, cooldownMs) {
  if (!members || members.length === 0) return [];
  const shuffled = shuffle(members.slice());
  const pairs = [];

  while (shuffled.length >= 2) {
    const a = shuffled.shift();
    let partnerIndex = -1;

    // 1) Try to find a partner that was not paired recently
    for (let i = 0; i < shuffled.length; i++) {
      const cand = shuffled[i];
      if (!wasRecentlyPaired(history, a.id, cand.id, cooldownMs)) {
        partnerIndex = i;
        break;
      }
    }

    // 2) If none found, prefer the partner with the fewest prior pairings (least matched)
    if (partnerIndex === -1) {
      let minCount = Number.MAX_SAFE_INTEGER;
      let oldestTs = Number.MAX_SAFE_INTEGER;
      for (let i = 0; i < shuffled.length; i++) {
        const cand = shuffled[i];
        const count =
          getPairCount(history, a.id, cand.id) +
          getPairCount(history, cand.id, a.id); // symmetric count
        const ts = Math.max(
          getLastPairTimestamp(history, a.id, cand.id) || 0,
          getLastPairTimestamp(history, cand.id, a.id) || 0
        );

        // Prefer candidates never-paired first
        if (count === 0) {
          partnerIndex = i;
          break;
        }

        // otherwise, pick the one with the smallest count; tie-break on oldest timestamp
        if (count < minCount || (count === minCount && ts < oldestTs)) {
          minCount = count;
          oldestTs = ts;
          partnerIndex = i;
        }
      }
    }

    if (partnerIndex === -1) {
      // No partner found (shouldn't happen), push back 'a' and break
      shuffled.push(a);
      break;
    }

    const b = shuffled.splice(partnerIndex, 1)[0];
    // If we chose a partner via the fallback, log some debug info
    try {
      const pairCount =
        getPairCount(history, a.id, b.id) + getPairCount(history, b.id, a.id);
      const recency = wasRecentlyPaired(history, a.id, b.id, cooldownMs);
      if (recency) {
        console.warn(
          `Soft fallback: pairing ${a.user?.username || a.id} with ${
            b.user?.username || b.id
          } despite cooldown (pairCount=${pairCount})`
        );
      } else if (pairCount > 0) {
        console.info(
          `Fallback to least-matched partner: pairing ${
            a.user?.username || a.id
          } with ${b.user?.username || b.id} (pairCount=${pairCount})`
        );
      }
    } catch (err) {}
    pairs.push([a, b]);
  }

  // If leftover, join them to the last pair to create a trio
  if (shuffled.length === 1) {
    const leftover = shuffled.pop();
    if (pairs.length > 0) {
      pairs[pairs.length - 1].push(leftover);
    } else {
      pairs.push([leftover]);
    }
  }
  return pairs;
}

async function notifyPairs(pairs, guild, source = "scheduled") {
  let history = readCoffeePairs();
  history = normalizeHistory(history);
  const results = [];
  // Warn admin if DM delivery fails for all or many users
  let totalFailedDMs = 0;
  for (const pair of pairs) {
    const usernames = pair.map(
      (m) => `${m.user.username}#${m.user.discriminator}`
    );
    const mentionText = pair.map((m) => `<@${m.id}>`).join(" and ");
    const first = pair[0];
    const partnerList = pair
      .slice(1)
      .map((m) => `<@${m.id}>`)
      .join(", ");
    const msg = `☕ Hi ${first.user.username}! I've paired you with ${
      partnerList || "someone"
    } for a coffee-chat. Please DM them to arrange a time — you'd make a great match!`;

    // Send DM to each member listing their partner(s)
    for (const m of pair) {
      const others = pair
        .filter((p) => p.id !== m.id)
        .map((p) => `<@${p.id}>`)
        .join(", ");
      const content = `☕ Hi ${m.user.username}! You were paired for a coffee chat with ${others}. Please DM them to set up a time. (${source})`;
      try {
        await m.send({ content });
        await delay(500);
      } catch (err) {
        totalFailedDMs++;
        console.warn(`Could not DM user ${m.id}:`, err.message);
      }
    }

    // Update history - append entry for each pair partner
    const timeNow = Date.now();
    pair.forEach((m) => {
      if (!history[m.id]) history[m.id] = { history: [] };
      const entry = history[m.id];
      const partnersToAdd = pair.filter((p) => p.id !== m.id).map((p) => p.id);
      partnersToAdd.forEach((pid) =>
        entry.history.push({ partnerId: pid, timestamp: timeNow })
      );
      // Keep history manageable
      if (entry.history.length > 200) entry.history = entry.history.slice(-200);
    });
    results.push({ pair: usernames });
  }
  saveCoffeePairs(history);
  // Also post a summary to the church channel if available
  const logChannelId = process.env.COFFEE_LOG_CHANNEL_ID || TARGET_CHANNEL_ID;
  const logChannel = guild.channels.cache.get(logChannelId);
  if (logChannel && logChannel.type === ChannelType.GuildText) {
    for (const p of results) {
      await logChannel.send(
        `☕ Coffee Pairing (${new Date().toLocaleString()}): ${p.pair.join(
          " <> "
        )}`
      );
      await delay(400);
    }
  }
  if (totalFailedDMs > 0) {
    try {
      const logChannel2 = guild.channels.cache.get(
        process.env.COFFEE_LOG_CHANNEL_ID || TARGET_CHANNEL_ID
      );
      if (logChannel2 && logChannel2.type === ChannelType.GuildText) {
        await logChannel2.send(
          `⚠️ DM delivery failed for ${totalFailedDMs} recipients during the recent pairing. Users may have DMs disabled.`
        );
      }
    } catch {}
  }
  return results;
}

async function runCoffeePairing(
  guild,
  roleIdentifier = COFFEE_ROLE_NAME,
  source = "scheduled"
) {
  try {
    const members = await getMembersWithCoffeeRole(guild, roleIdentifier);
    console.log(
      `Coffee pairing: found ${members.length} eligible member(s): ${members
        .map((m) => m.user?.tag || m.id)
        .join(", ")}`
    );
    if (!members || members.length < 2) {
      console.log("Not enough members to pair for coffee.");
      return [];
    }
    let history = readCoffeePairs();
    history = normalizeHistory(history);
    const pairs = pairUpWithCooldown(
      members,
      history,
      COFFEE_PAIRING_COOLDOWN_MS
    );
    // Check if any pairings violated cooldown (should be minimized by algorithm)
    const violated = [];
    pairs.forEach((pair) => {
      for (let i = 0; i < pair.length; i++) {
        for (let j = i + 1; j < pair.length; j++) {
          const a = pair[i];
          const b = pair[j];
          if (
            wasRecentlyPaired(history, a.id, b.id, COFFEE_PAIRING_COOLDOWN_MS)
          ) {
            violated.push([a, b]);
          }
        }
      }
    });

    if (violated.length > 0) {
      console.warn(
        "Some pairings violated the configured cooldown. This can happen if there are too few eligible members."
      );
    }

    const results = await notifyPairs(pairs, guild, source);
    return results;
  } catch (e) {
    await logError(e, "Error running coffee pairing");
    // If this is a fetch timeout, return empty and avoid throwing to let the cron continue
    if (e && e.message && e.message.includes("GuildMembersFetchTimeout")) {
      console.warn(
        "Member fetch timed out; using cache or skipping pairing. Try setting COFFEE_FETCH_MEMBERS=true to force refresh or increase COFFEE_FETCH_TIMEOUT_MS."
      );
      return [];
    }
    return [];
  }
}

// Fetch upcoming events helper
async function fetchUpcomingEvents() {
  try {
    const response = await axios.get(
      "https://public-api.luma.com/v1/calendar/list-events",
      {
        headers: {
          accept: "application/json",
          "x-luma-api-key": process.env.LUMA_API_KEY,
        },
      }
    );

    const events = response.data.sort(
      (a, b) => new Date(a.startTime) - new Date(b.startTime)
    );

    return events;
  } catch (error) {
    await logError(error, "Error fetching Luma events");
    return [];
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Notify admin that a slash command was invoked
  try {
    await notifyAdmin(
      `Slash command /${interaction.commandName} invoked by ${
        interaction.user.tag
      } (${interaction.user.id}) ${
        interaction.guild ? `in guild ${interaction.guild.id}` : "in DM"
      }`
    );
  } catch (ignore) {}

  if (interaction.commandName === "summarize") {
    try {
      await interaction.deferReply({ ephemeral: true });
      const messages = await interaction.channel.messages.fetch({ limit: 100 });

      const formattedMessages = messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(
          (msg) =>
            `${msg.member?.displayName || msg.author.username}: ${msg.content}`
        )
        .join("\n");

      const summary = await summarizeMessages(formattedMessages);
      const chunks = summary.match(/[\s\S]{1,1900}/g) || [
        "No summary available.",
      ];

      try {
        for (const chunk of chunks) {
          await interaction.user.send(chunk);
          await delay(1000);
        }

        await interaction.editReply({
          content: "✅ Summary sent to your DMs!",
          ephemeral: true,
        });
        // Notify admin of successful completion
        notifyAdmin(
          `/summarize completed for ${interaction.user.tag} (${interaction.user.id})`
        ).catch(() => {});
      } catch (dmError) {
        console.error("Failed to send DM:", dmError);
        await interaction.editReply({
          content:
            "❌ Could not send you a DM. Please check if you have DMs enabled for this server.",
          ephemeral: true,
        });
      }
    } catch (error) {
      await logError(error, `/summarize interaction error`);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ An error occurred while processing your request.",
          ephemeral: true,
        });
      } else {
        await interaction.editReply({
          content: "❌ An error occurred while processing your request.",
          ephemeral: true,
        });
      }
    }
  } else if (interaction.commandName === "events") {
    try {
      await interaction.reply({
        content: "📬 Check your DMs for upcoming events!",
        ephemeral: true,
      });

      const upcomingEvents = await fetchUpcomingEvents();

      if (upcomingEvents.length === 0) {
        await interaction.followUp({
          content: "No upcoming events found.",
          ephemeral: true,
        });
        return;
      }

      const embeds = upcomingEvents.slice(0, 10).map((event) => {
        const embed = new EmbedBuilder()
          .setTitle(event.name)
          .setURL(event.fullUrl)
          .setDescription(
            event.description
              ? event.description.substring(0, 200) +
                  (event.description.length > 200 ? "..." : "")
              : "No description"
          )
          .addFields(
            {
              name: "Start Time",
              value: new Date(event.startAt).toLocaleString("en-US", {
                timeZone: event.timeZone,
              }),
              inline: true,
            },
            {
              name: "End Time",
              value: new Date(event.endAt).toLocaleString("en-US", {
                timeZone: event.timeZone,
              }),
              inline: true,
            },
            {
              name: "Visibility",
              value: event.visibility,
              inline: true,
            }
          )
          .setColor("#0099ff")
          .setTimestamp(new Date(event.startAt))
          .setFooter({ text: "torc-dev events" });

        // Include social card image if available
        if (event.uploadedSocialCard && event.uploadedSocialCard.url) {
          embed.setImage(event.uploadedSocialCard.url);
        }

        return embed;
      });

      // Try sending to user's DM
      try {
        await interaction.user.send({
          content: " Here are the upcoming events:",
          embeds,
        });
        notifyAdmin(
          `/events completed for ${interaction.user.tag} (${interaction.user.id})`
        ).catch(() => {});
      } catch (dmError) {
        console.error("Could not DM user:", dmError);
        await interaction.followUp({
          content:
            "❌ I couldn't send you a DM. Please enable DMs and try again.",
          ephemeral: true,
        });
      }
    } catch (error) {
      await logError(error, `/events interaction error`);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ Failed to fetch events.",
          ephemeral: true,
        });
      } else {
        await interaction.followUp({
          content: "❌ Failed to fetch events.",
          ephemeral: true,
        });
      }
    }
  } else if (interaction.commandName === "coffee-pair") {
    try {
      // Only allow admin users to run the pairing
      if (!ALLOWED_USER_IDS.includes(interaction.user.id)) {
        await interaction.reply({
          content: "❌ You don't have permission to run this command.",
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: "☕ Running coffee pairing...",
        ephemeral: true,
      });
      const guild = interaction.guild;
      const res = await runCoffeePairing(guild, COFFEE_ROLE_NAME, "manual");
      if (!res || res.length === 0) {
        await interaction.followUp({
          content:
            "⚠️ No pairings created. This can happen if not enough members were found with the role, or the member fetch timed out. Check the logs or enable `COFFEE_FETCH_MEMBERS=true` to force a member cache refresh.",
          ephemeral: true,
        });
      } else {
        await interaction.followUp({
          content: `✅ Paired ${res.length} groups for coffee.`,
          ephemeral: true,
        });
        notifyAdmin(
          `/coffee-pair completed for ${interaction.user.tag} (${interaction.user.id}) — pairs: ${res.length}`
        ).catch(() => {});
      }
    } catch (err) {
      await logError(err, `/coffee-pair interaction error`);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ Failed to run coffee pairing.",
          ephemeral: true,
        });
      } else {
        await interaction.editReply({
          content: "❌ Failed to run coffee pairing.",
          ephemeral: true,
        });
      }
    }
  }
});

// Helper to gather conversations across all channels in a server
async function gatherServerConversationsAndSummarize(
  guild,
  useServerSummarize = false
) {
  let allMessages = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel.isTextBased() && channel.viewable && !channel.isThread()) {
      try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const formatted = messages
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .map(
            (msg) =>
              `[${channel.name}] ${
                msg.member?.displayName || msg.author.username
              }: ${msg.content}`
          );
        allMessages.push(...formatted);
      } catch (err) {
        console.warn(
          `Could not fetch messages for #${channel.name}:`,
          err.message
        );
      }
    }
  }

  let combined = allMessages.join("\n");
  if (combined.length > 16000) {
    combined = combined.slice(-16000);
  }

  if (useServerSummarize) {
    return await serverSummarize(combined);
  } else {
    return await summarizeMessages(combined);
  }
}

const ALLOWED_USER_IDS = ["1048620443474608178", "280096257282670592"];
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || "280096257282670592";

/**
 * Send a DM to the configured admin user id. No-ops if ADMIN_USER_ID is not configured.
 * @param {string} content - content to send
 */
async function notifyAdmin(content) {
  if (!ADMIN_USER_ID) return;
  try {
    // const user = await client.users.fetch(ADMIN_USER_ID);
    if (!user) return;
    await user.send({ content: `📣 Admin Notification: ${content}` });
  } catch (err) {
    // Always swallow errors from notifyAdmin to avoid cascading failures
    console.error("Failed to send admin DM:", err?.message || err);
  }
}

async function logError(err, context = "") {
  try {
    if (context) console.error(context, err);
    else console.error(err);
    await notifyAdmin(
      `${context ? `${context} — ` : ""}${(err && err.message) || String(err)}`
    );
  } catch (ignore) {
    // swallowing errors intentionally
  }
}

client.on(Events.MessageCreate, async (message) => {
  // Quick per-process dedupe — ignore duplicate events for same message id
  try {
    if (processedMessageIds.has(message.id)) return;
    processedMessageIds.add(message.id);
    setTimeout(() => processedMessageIds.delete(message.id), 30 * 1000); // keep cache short
  } catch (err) {}
  if (message.author.bot) return;

  // Reminder commands
  if (message.content.startsWith(PREFIX)) {
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Notify admin of message-based command execution
    try {
      notifyAdmin(
        `Message command: ${command} invoked by ${
          message.author.tag || message.author.username
        } (${message.author.id}) in ${
          message.guild ? `guild ${message.guild.id}` : `DM`
        }`
      ).catch(() => {});
    } catch (ignore) {}

    if (command === "remindme") {
      if (args.length < 2) {
        const replyMsg = await message.reply(
          "Usage: `!remindme <time> <message>` (e.g., `!remindme 2 weeks Take out the trash`)"
        );
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
        return;
      }

      const { timeStr, reminderMsg } = splitTimeAndMessage(args);
      const duration = parseTime(timeStr);

      if (!timeStr || !duration || !reminderMsg) {
        const replyMsg = await message.reply(
          "Invalid format. Try `!remindme 2 weeks Do something` or `!remindme 3 months 2 days Task`."
        );
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
        return;
      }

      const reminderId = Date.now().toString();
      const reminder = {
        id: reminderId,
        userId: message.author.id,
        msg: reminderMsg,
        time: Date.now() + duration,
      };

      try {
        const addRes = await addReminderSafely(reminder);
        if (!addRes.created && addRes.existing) {
          const replyMsg = await message.reply(
            `⚠️ A similar reminder already exists (ID: ${addRes.existing.id}). I won't create a duplicate.`
          );
          setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
          return;
        }
      } catch (e) {
        await logError(e, "Error adding reminder safely");
        // Fall back to original behavior if lock/add fails
        reminders.push(reminder);
        saveReminders();
        scheduleReminder(reminder, duration);
      }

      const replyMsg = await message.reply(
        `⏰ Reminder set! I'll remind you in ${timeStr}. (ID: ${reminderId})`
      );
      setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
    }

    // !listreminders
    if (command === "listreminders") {
      // Read authoritative reminders from file in case multiple processes exist
      const persisted = loadRemindersFromFile();
      const userReminders = persisted.filter(
        (r) => r.userId === message.author.id
      );
      console.log(
        `!listreminders run by ${
          message.author.tag || message.author.username
        } (${message.author.id}) — pid ${process.pid} — returning ${
          userReminders.length
        } reminder(s)`
      );

      if (userReminders.length === 0) {
        const replyMsg = await message.reply(
          "You don't have any pending reminders"
        );

        // Only auto-delete if run in a guild channel
        if (message.guild) {
          setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
        }
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`${message.author.username}'s Reminders`)
        .setColor("Blue");

      userReminders.forEach((r) => {
        const remaining = Math.max(0, r.time - Date.now());
        const mins = Math.round(remaining / 60000);
        embed.addFields({
          name: `ID: ${r.id}`,
          value: `${r.msg} (in ~${mins} min)`,
        });
      });

      if (message.guild) {
        // Command was run in a server: DM the list, delete the *command message* only
        await message.author.send({ embeds: [embed] });
        setTimeout(() => message.delete().catch(() => {}), 500);
      } else {
        // Command was run in a DM: just reply in DM, no auto-deletion
        await message.reply({ embeds: [embed] });
      }

      return;
    }

    // Cancel reminder with timeout clearing fixed
    if (command === "cancelreminder") {
      if (args.length < 1) {
        const replyMsg = await message.reply(
          "Usage: `!cancelreminder <id|all>`"
        );
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
        return;
      }

      const arg = args[0].toLowerCase();

      if (arg === "all") {
        // Remove all reminders for this user
        const userReminders = reminders.filter(
          (r) => r.userId === message.author.id
        );

        if (userReminders.length === 0) {
          const replyMsg = await message.reply(
            "❌ You don't have any reminders to cancel."
          );
          setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
          return;
        }

        // Clear all scheduled timeouts for this user's reminders
        userReminders.forEach((r) => {
          if (scheduledTimeouts.has(r.id)) {
            clearTimeout(scheduledTimeouts.get(r.id));
            scheduledTimeouts.delete(r.id);
            console.log(
              `Cleared scheduled timeout for reminder ${r.id} (user ${message.author.id})`
            );
          }
        });

        // Filter out all user's reminders
        reminders = reminders.filter((r) => r.userId !== message.author.id);
        saveReminders();

        const replyMsg = await message.reply(
          `✅ All your reminders have been canceled.`
        );
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
        return;
      }

      // Otherwise, treat it as a reminder ID
      const id = arg;
      const index = reminders.findIndex(
        (r) => r.id === id && r.userId === message.author.id
      );

      if (index === -1) {
        const replyMsg = await message.reply(
          `❌ No reminder found with ID \`${id}\`.`
        );
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
        return;
      }

      // Clear scheduled timeout for this reminder
      if (scheduledTimeouts.has(id)) {
        clearTimeout(scheduledTimeouts.get(id));
        scheduledTimeouts.delete(id);
        console.log(
          `Cleared scheduled timeout for reminder ${id} (user ${message.author.id})`
        );
      }

      reminders.splice(index, 1);
      saveReminders();

      const replyMsg = await message.reply(
        `✅ Reminder with ID \`${id}\` has been canceled.`
      );
      setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
    }
  }

  if (message.content.trim().startsWith("!location")) {
    if (!ALLOWED_USER_IDS.includes(message.author.id)) {
      await message.reply("❌ You do not have permission to use this command.");
      setTimeout(() => message.delete().catch(() => {}), 2000);
      return;
    }

    const args = message.content.trim().split(" ");
    let searchLimit = 100;
    if (args.length > 1 && !isNaN(Number(args[1]))) {
      searchLimit = Math.min(Number(args[1]), 100);
    }

    try {
      const messages = await message.channel.messages.fetch({
        limit: searchLimit,
      });
      const foundLocations = [];

      messages.forEach((msg) => {
        const locationResult = findLocation(msg.content);
        if (locationResult.matchFound) {
          foundLocations.push({
            user: msg.member?.displayName || msg.author.username,
            text: msg.content,
            ...locationResult,
          });
        }
      });

      if (foundLocations.length > 0) {
        const loggedUsernames = readLoggedUsernames();
        foundLocations
          .filter((loc) => loc.user !== "Chat Summary")
          .forEach((loc) => {
            if (!loggedUsernames.has(loc.user)) {
              appendLocationToLog({
                type: loc.type,
                name: loc.name || loc.city,
              });
            }
          });
      }

      const replyMsg = await message.reply(
        "✅ Location data has been summarized and logged."
      );
      setTimeout(() => replyMsg.delete().catch(() => {}), 3000);
    } catch (err) {
      await logError(err, "Error searching for locations");
    }

    setTimeout(() => message.delete().catch(() => {}), 500);
    return;
  }

  if (message.content.trim() === "!downloadlocations") {
    if (!ALLOWED_USER_IDS.includes(message.author.id)) {
      await message.reply("❌ You do not have permission to use this command.");
      setTimeout(() => message.delete().catch(() => {}), 2000);
      return;
    }

    if (fs.existsSync(LOG_FILE)) {
      const lines = fs
        .readFileSync(LOG_FILE, "utf-8")
        .split("\n")
        .filter(Boolean);
      const entries = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const cities = entries
        .filter((e) => e.type === "city")
        .map((e) => e.name);
      const countries = entries
        .filter((e) => e.type === "country")
        .map((e) => e.name);

      const uniqueCities = Array.from(new Set(cities)).sort();
      const uniqueCountries = Array.from(new Set(countries)).sort();

      const sortedData = { cities: uniqueCities, countries: uniqueCountries };

      const tempFile = path.join(__dirname, "locations_sorted.json");
      fs.writeFileSync(tempFile, JSON.stringify(sortedData, null, 2));

      await message.author.send({ files: [tempFile] });

      fs.unlinkSync(tempFile);

      const replyMsg = await message.reply(
        "📄 Sorted log file sent to your DMs!"
      );
      setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
    } else {
      const replyMsg = await message.reply("No log file found.");
      setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
    }

    setTimeout(() => message.delete().catch(() => {}), 500);
    return;
  }

  // !server command (restricted)
  if (message.content.trim() === "!server") {
    if (!ALLOWED_USER_IDS.includes(message.author.id)) {
      await message.reply("❌ You do not have permission to use this command.");
      setTimeout(() => message.delete().catch(() => {}), 2000);
      return;
    }

    const statusMsg = await message.channel.send(
      "⏳ Gathering and summarizing conversations across all channels. Please wait..."
    );
    setTimeout(() => statusMsg.delete().catch(() => {}), 500);

    try {
      const guild = message.guild;
      const summary = await gatherServerConversationsAndSummarize(guild, true); // Use serverSummarize
      const chunks = summary.match(/[\s\S]{1,1900}/g) || [
        "No summary available.",
      ];

      // Send summary to the same channel as the cron job (TARGET_CHANNEL_ID)
      const targetChannel = guild.channels.cache.get("1392954859803644014");
      if (targetChannel && targetChannel.type === ChannelType.GuildText) {
        for (const chunk of chunks) {
          await targetChannel.send(chunk);
          await delay(1000);
        }
        const doneMsg = await message.channel.send(
          "✅ Server summary sent to the summary channel!"
        );
        // Notify admin that the manual server summary completed
        notifyAdmin(
          `!server manual summary completed by ${
            message.author.tag || message.author.username
          } (${message.author.id})`
        ).catch(() => {});
        setTimeout(() => doneMsg.delete().catch(() => {}), 500);
      } else {
        const replyMsg = await message.channel.send(
          "❌ Could not find the summary channel."
        );
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
      }
    } catch (error) {
      await logError(error, "Error summarizing server");
      const errorMsg = await message.channel.send(
        "❌ Error summarizing server conversations."
      );
      setTimeout(() => errorMsg.delete().catch(() => {}), 500);
    }

    setTimeout(() => message.delete().catch(() => {}), 500);
    return;
  }

  // !paircoffee - manual pairing using message command (restricted)
  if (message.content.trim() === "!paircoffee") {
    if (!ALLOWED_USER_IDS.includes(message.author.id)) {
      await message.reply("❌ You do not have permission to use this command.");
      setTimeout(() => message.delete().catch(() => {}), 2000);
      return;
    }
    const replyMsg = await message.reply(
      "☕ Running coffee pairing... This may take a moment."
    );
    try {
      const res = await runCoffeePairing(
        message.guild,
        COFFEE_ROLE_NAME,
        "manual"
      );
      if (!res || res.length === 0) {
        await message.channel.send(
          "⚠️ No pairings created — not enough eligible members or member fetch timed out. Check logs or set COFFEE_FETCH_MEMBERS=true to force refresh."
        );
      } else {
        await message.channel.send(
          `✅ Paired ${res.length} groups for coffee.`
        );
        notifyAdmin(
          `!paircoffee completed by ${
            message.author.tag || message.author.username
          } (${message.author.id}) — pairs: ${res.length}`
        ).catch(() => {});
      }
    } catch (e) {
      await logError(e, "Error running !paircoffee");
      await message.channel.send("❌ Failed to run coffee pairing.");
    }
    setTimeout(() => replyMsg.delete().catch(() => {}), 2000);
    setTimeout(() => message.delete().catch(() => {}), 500);
    return;
  }
});

client.on("error", async (error) => {
  await logError(error, "Discord client error");
});

process.on("unhandledRejection", async (error) => {
  await logError(error, "Unhandled promise rejection");
});

process.on("uncaughtException", async (error) => {
  await logError(error, "Uncaught exception");
});

const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Discord summarizer bot is running.");
});

server.listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});

client.login(process.env.DISCORD_TOKEN);

const LOG_FILE = path.join(__dirname, "locations.log");

function readLoggedUsernames() {
  if (!fs.existsSync(LOG_FILE)) return new Set();
  const lines = fs.readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);
  return new Set(
    lines
      .map((line) => {
        try {
          const entry = JSON.parse(line);
          return entry.user;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  );
}

function appendLocationToLog(location) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(location) + "\n");
}

const PREFIX = "!";

// Local dedupe cache to ignore duplicate message events within the process
const processedMessageIds = new Set();

const REMINDER_FILE = path.join(__dirname, "reminders.json");
const REMINDER_LOCK_FILE = path.join(__dirname, "reminders.json.lock");

// Load reminders from file
let reminders = [];
if (fs.existsSync(REMINDER_FILE)) {
  try {
    const data = fs.readFileSync(REMINDER_FILE, "utf8") || "[]";
    reminders = JSON.parse(data);
  } catch (err) {
    logError(err, "Error reading reminders.json").catch(() => {});
    reminders = [];
  }
}

// Map to track scheduled timeouts by reminder ID
const scheduledTimeouts = new Map();

// Save reminders to file
function saveReminders() {
  fs.writeFileSync(REMINDER_FILE, JSON.stringify(reminders, null, 2));
}

// Load reminders from file — use for commands where we need the authoritative persisted state
function loadRemindersFromFile() {
  try {
    if (!fs.existsSync(REMINDER_FILE)) return [];
    const data = fs.readFileSync(REMINDER_FILE, "utf8") || "[]";
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Failed to load reminders from file:", err?.message || err);
    return [];
  }
}

// Acquire a simple file lock (bad-man's lock) for REMINDER_FILE operations to avoid races
async function acquireRemindersLock(retries = 50, delayMs = 100) {
  for (let i = 0; i < retries; i++) {
    try {
      const fd = fs.openSync(REMINDER_LOCK_FILE, "wx");
      fs.writeSync(fd, `${process.pid}\n${Date.now()}`);
      fs.closeSync(fd);
      return () => {
        try {
          fs.unlinkSync(REMINDER_LOCK_FILE);
        } catch (e) {}
      };
    } catch (err) {
      if (err && err.code === "EEXIST") {
        // lock exists, check for staleness
        try {
          const stat = fs.statSync(REMINDER_LOCK_FILE);
          const ageMs = Date.now() - stat.mtimeMs;
          if (ageMs > 30000) {
            // older than 30s
            try {
              fs.unlinkSync(REMINDER_LOCK_FILE);
            } catch (er) {}
            // next iteration will try again
          }
        } catch (sErr) {
          // ignore
        }
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      // Other errors: don't retry
      throw err;
    }
  }
  throw new Error("Could not acquire reminders lock");
}

// Check whether an equivalent reminder already exists (same user, same message, time within tolerance)
function findDuplicatePersistedReminder(reminder, persisted) {
  const TOLERANCE_MS = 5000; // 5 seconds
  return (persisted || []).find((r) => {
    try {
      return (
        r.userId === reminder.userId &&
        (r.msg || "").trim() === (reminder.msg || "").trim() &&
        Math.abs((Number(r.time) || 0) - Number(reminder.time)) <= TOLERANCE_MS
      );
    } catch (e) {
      return false;
    }
  });
}

// Atomically add a reminder by acquiring a simple lock, reading file, checking duplicate, and writing
async function addReminderSafely(reminder) {
  let release;
  try {
    release = await acquireRemindersLock();
  } catch (err) {
    // If lock cannot be acquired, fallback to naive method (best-effort). Still check file before writing.
    try {
      const persisted = loadRemindersFromFile();
      const dup = findDuplicatePersistedReminder(reminder, persisted);
      if (dup) return { created: false, existing: dup };
      persisted.push(reminder);
      fs.writeFileSync(REMINDER_FILE, JSON.stringify(persisted, null, 2));
      // update in-memory
      reminders = persisted;
      scheduleReminder(reminder, Math.max(0, reminder.time - Date.now()));
      console.log(
        `(fallback) Created reminder ${reminder.id} for user ${reminder.userId}`
      );
      return { created: true };
    } catch (e) {
      throw e;
    }
  }

  try {
    const persisted = loadRemindersFromFile();
    const dup = findDuplicatePersistedReminder(reminder, persisted);
    if (dup) {
      console.log(
        `Duplicate reminder detected for user ${reminder.userId}; existing ID: ${dup.id}`
      );
      return { created: false, existing: dup };
    }
    persisted.push(reminder);
    fs.writeFileSync(REMINDER_FILE, JSON.stringify(persisted, null, 2));
    reminders = persisted;
    console.log(
      `Created reminder ${reminder.id} for user ${
        reminder.userId
      } (scheduled in ${Math.max(
        0,
        Math.round((reminder.time - Date.now()) / 1000)
      )}s)`
    );
    scheduleReminder(reminder, Math.max(0, reminder.time - Date.now()));
    return { created: true };
  } finally {
    try {
      release && release();
    } catch (e) {}
  }
}

// Clean up expired reminders from file
function cleanReminders() {
  const before = reminders.length;
  reminders = reminders.filter((r) => r.time > Date.now());

  // Also clear scheduled timeouts for expired reminders
  for (const [id, timeout] of scheduledTimeouts.entries()) {
    const remExists = reminders.find((r) => r.id === id);
    if (!remExists) {
      clearTimeout(timeout);
      scheduledTimeouts.delete(id);
    }
  }

  if (reminders.length !== before) {
    saveReminders();
    console.log(`🧹 Cleaned ${before - reminders.length} expired reminders`);
  }
}

// 1) Regex-based duration parser
function parseTime(input) {
  if (!input || typeof input !== "string") return null;

  // Now supports weeks and months
  const regex =
    /(\d+(?:\.\d+)?)\s*(mo(?:nths?)?|w(?:eeks?)?|d(?:ays?)?|h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)/gi;
  let total = 0;
  let matched = false;
  const str = input.toLowerCase().replace(/[,]+/g, " ");

  let m;
  while ((m = regex.exec(str)) !== null) {
    matched = true;
    const value = parseFloat(m[1]);
    const unit = m[2].toLowerCase();

    if (unit.startsWith("mo"))
      total += value * 30 * 24 * 60 * 60 * 1000; // months = 30 days
    else if (unit.startsWith("w"))
      total += value * 7 * 24 * 60 * 60 * 1000; // weeks
    else if (unit.startsWith("d")) total += value * 24 * 60 * 60 * 1000;
    else if (unit.startsWith("h")) total += value * 60 * 60 * 1000;
    else if (unit.startsWith("m")) total += value * 60 * 1000;
    else if (unit.startsWith("s")) total += value * 1000;
  }

  return matched && total > 0 ? Math.round(total) : null;
}

function splitTimeAndMessage(args) {
  const timeUnits = [
    "mo",
    "month",
    "months",
    "w",
    "week",
    "weeks",
    "d",
    "day",
    "days",
    "h",
    "hour",
    "hours",
    "m",
    "min",
    "minute",
    "minutes",
    "s",
    "sec",
    "second",
    "seconds",
  ];

  let timeStrTokens = [];
  let i = 0;

  // Collect all consecutive tokens that are part of a time phrase
  while (i < args.length) {
    const token = args[i].toLowerCase();
    const next = args[i + 1] ? args[i + 1].toLowerCase() : null;

    // If token is a number and next token is a unit, include both
    if (!isNaN(token) && next && timeUnits.some((u) => next.startsWith(u))) {
      timeStrTokens.push(token);
      timeStrTokens.push(next);
      i += 2;
    }
    // If token itself is compact format like "1h30m"
    else if (/^\d+[smhdwmo]+$/i.test(token)) {
      timeStrTokens.push(token);
      i++;
    } else {
      break; // first token that is not part of the time phrase
    }
  }

  const timeStr = timeStrTokens.join(" ");
  const reminderMsg = args.slice(i).join(" ");

  return { timeStr, reminderMsg };
}

// Re-schedule reminders after restart
function rescheduleReminders() {
  // Re-load persisted reminders to ensure in-memory state is authoritative on startup
  reminders = loadRemindersFromFile();
  reminders.forEach((r) => {
    const delay = r.time - Date.now();
    if (delay <= 0) {
      sendReminder(r);
    } else {
      scheduleReminder(r, delay);
    }
  });
}

// Send reminder message
async function sendReminder(reminder) {
  try {
    // Double-check persisted reminders file to avoid sending canceled reminders
    let persistedReminders = [];
    try {
      if (fs.existsSync(REMINDER_FILE)) {
        persistedReminders = JSON.parse(
          fs.readFileSync(REMINDER_FILE, "utf8") || "[]"
        );
      }
    } catch (err) {
      console.warn(
        "Failed to read reminders.json while sending reminder; proceeding with in-memory checks.",
        err?.message || err
      );
    }

    const stillActive =
      persistedReminders.some((r) => r.id === reminder.id) ||
      reminders.some((r) => r.id === reminder.id);
    if (!stillActive) {
      console.log(
        `Reminder ${reminder.id} was canceled (not found in persisted reminders). Skipping send.`
      );
      if (scheduledTimeouts.has(reminder.id)) {
        clearTimeout(scheduledTimeouts.get(reminder.id));
        scheduledTimeouts.delete(reminder.id);
      }
      return;
    }

    const user = await client.users.fetch(reminder.userId);
    try {
      await user.send(`🔔 Reminder: ${reminder.msg}`);
    } catch (dmErr) {
      console.log(
        `Failed to DM user ${reminder.userId}, reminder was: ${reminder.msg}`,
        dmErr?.message || dmErr
      );
    }

    // Remove reminder and persist the change
    reminders = reminders.filter((r) => r.id !== reminder.id);
    saveReminders();

    // Clear scheduled timeout since reminder fired (if present)
    if (scheduledTimeouts.has(reminder.id)) {
      clearTimeout(scheduledTimeouts.get(reminder.id));
      scheduledTimeouts.delete(reminder.id);
    }
  } catch (err2) {
    // Log and notify admin if necessary
    await logError(err2, "sendReminder error").catch(() => {});
  }
}

// Schedule reminder with timeout tracking
function scheduleReminder(reminder, delay) {
  // Avoid scheduling duplicates: clear any existing timeout for this reminder id
  if (scheduledTimeouts.has(reminder.id)) {
    try {
      clearTimeout(scheduledTimeouts.get(reminder.id));
      scheduledTimeouts.delete(reminder.id);
      console.log(
        `Cleared existing scheduled timeout when re-scheduling reminder ${reminder.id}`
      );
    } catch (ignore) {}
  }
  const timeoutId = setTimeout(() => sendReminder(reminder), delay);
  scheduledTimeouts.set(reminder.id, timeoutId);
  console.log(
    `Scheduled reminder ${reminder.id} in ${Math.max(
      0,
      Math.round(delay / 1000)
    )}s for user ${reminder.userId}`
  );
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag} (pid ${process.pid})`);
  // Debug: show env and cached guilds for diagnosing scheduling issues
  const GUILD_ID_IN_USE = process.env.GUILD_ID || "885547853567635476";
  console.log(`DEBUG: GUILD_ID=${GUILD_ID_IN_USE}`);
  try {
    const cached = Array.from(client.guilds.cache.keys());
    console.log(`DEBUG: Cached guild ids: ${JSON.stringify(cached)}`);
  } catch (ignore) {}

  // Re-schedule saved reminders
  rescheduleReminders();

  // Auto-clean expired reminders every 10 minutes
  setInterval(cleanReminders, 10 * 60 * 1000);

  // ⏰ Cron Job — Monday 10 UTC = 5 AM EDT
  try {
    cron.schedule("0 10 * * 1", async () => {
      try {
        console.log(
          `⏰ [CRON] Server summary job triggered at ${new Date().toISOString()}`
        );
        notifyAdmin(
          `Cron job: Server summary started at ${new Date().toISOString()}`
        ).catch(() => {});
        const serverGuildId = process.env.GUILD_ID || "885547853567635476";
        let guild = client.guilds.cache.get(serverGuildId);
        if (!guild) {
          // Attempt to fetch the guild as a fallback in case cache was evicted or not populated
          try {
            console.log(
              `DEBUG: guild ${serverGuildId} not in cache; attempting client.guilds.fetch(${serverGuildId})`
            );
            guild = await client.guilds.fetch(serverGuildId);
          } catch (fetchErr) {
            await logError(
              fetchErr,
              `Failed to fetch guild ${serverGuildId} for server summary`
            );
          }
        }
        if (!guild) {
          logError(
            new Error("Guild not found for server summary."),
            "Server summary cron"
          ).catch(() => {});
          return;
        }

        const summary = await gatherServerConversationsAndSummarize(
          guild,
          true
        );
        const chunks = summary.match(/[\s\S]{1,1900}/g) || [
          "No summary available.",
        ];

        let channel = guild
          ? guild.channels.cache.get(TARGET_CHANNEL_ID)
          : null;
        if (!channel) {
          // Fallback: fetch the channel if not cached or if guild is not present
          try {
            channel = await client.channels.fetch(TARGET_CHANNEL_ID);
          } catch (fetchErr) {
            await logError(
              fetchErr,
              `Failed to fetch target channel ${TARGET_CHANNEL_ID} for server summary`
            );
          }
        }
        if (channel && channel.type === ChannelType.GuildText) {
          for (const chunk of chunks) {
            await channel.send(chunk);
            await delay(1000); // ✅ Respect rate limit
          }
        }

        console.log("✅ Weekly server summary sent.");
        notifyAdmin(
          `Cron job: Server summary completed at ${new Date().toISOString()}`
        ).catch(() => {});
      } catch (error) {
        await logError(error, "Error running scheduled summary");
        try {
          const channel = client.channels.cache.get(TARGET_CHANNEL_ID);
          if (channel && channel.type === ChannelType.GuildText) {
            await channel.send(
              `❌ Error running scheduled summary: ${error?.message || error}`
            );
          }
        } catch (sendErr) {
          logError(sendErr, "Failed to send scheduling error to channel").catch(
            () => {}
          );
        }
      }
    });
    console.log(`⏰ Server summary scheduled with cron: 0 10 * * 1`);
  } catch (e) {
    await logError(e, "Error scheduling server summary");
  }

  // Coffee pairing cron job (configurable)
  try {
    cron.schedule(COFFEE_CRON_SCHEDULE, async () => {
      // ⛔ Every-other-week guard (ISO weeks)
      const isoWeek = getISOWeek();
      if (isoWeek % 2 !== 0) {
        console.log(
          `☕ [CRON] Skipping coffee pairing (off week, ISO week ${isoWeek})`
        );
        return;
      }

      console.log(
        `☕ [CRON] Coffee pairing job triggered at ${new Date().toISOString()}`
      );
      notifyAdmin(
        `Cron job: Coffee pairing started at ${new Date().toISOString()}`
      ).catch(() => {});

      try {
        const coffeeGuildId = process.env.GUILD_ID || "885547853567635476";
        let guild = client.guilds.cache.get(coffeeGuildId);
        if (!guild) {
          try {
            console.log(
              `DEBUG: guild ${coffeeGuildId} not in cache; attempting client.guilds.fetch(${coffeeGuildId})`
            );
            guild = await client.guilds.fetch(coffeeGuildId);
          } catch (fetchErr) {
            await logError(
              fetchErr,
              `Failed to fetch guild ${coffeeGuildId} for coffee pairing`
            );
          }
        }
        if (!guild) {
          logError(
            new Error("Guild not found for coffee pairing."),
            "Coffee pairing cron"
          ).catch(() => {});
          return;
        }
        const result = await runCoffeePairing(guild, COFFEE_ROLE_NAME);
        console.log(`☕ Coffee pairing job completed, pairs: ${result.length}`);
        notifyAdmin(
          `Cron job: Coffee pairing completed with ${
            result.length
          } pairs at ${new Date().toISOString()}`
        ).catch(() => {});
      } catch (e) {
        await logError(e, "Error running coffee pairing cron job");
        try {
          const logChannelId =
            process.env.COFFEE_LOG_CHANNEL_ID || TARGET_CHANNEL_ID;
          let logChannel = client.channels.cache.get(logChannelId);
          if (!logChannel) {
            try {
              logChannel = await client.channels.fetch(logChannelId);
            } catch (fetchErr) {
              console.warn(
                `Failed to fetch coffee log channel ${logChannelId}: `,
                fetchErr?.message || fetchErr
              );
            }
          }
          if (logChannel && logChannel.type === ChannelType.GuildText) {
            await logChannel.send(
              `❌ Coffee pairing cron job failed: ${e?.message || e}`
            );
          }
        } catch (sendErr) {
          logError(sendErr, "Failed to send cron error to log channel").catch(
            () => {}
          );
        }
      }
    });
    console.log(
      `☕ Coffee pairing scheduled with cron: ${COFFEE_CRON_SCHEDULE}`
    );
  } catch (e) {
    await logError(e, "Error scheduling coffee pairing");
  }
});
