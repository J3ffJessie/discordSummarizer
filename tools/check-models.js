#!/usr/bin/env node
/**
 * Reports which AI model each guild resolves to (summarization, translation, transcription)
 * and asks the provider's /models endpoint whether that model still exists.
 *
 * Usage: node tools/check-models.js            (reads .env and DATA_DIR/guild_config.db)
 *
 * A model the provider no longer serves comes back 404 → marked RETIRED.
 * Note: provider APIs only tell you whether a model is live, not whether it is scheduled
 * for retirement — check the provider's deprecations page for upcoming shutdown dates.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { resolveConfig } = require('../src/providers');

const DEFAULT_STT_MODELS = { groq: 'whisper-large-v3-turbo', openai: 'whisper-1' };
const DEPRECATION_PAGES = {
  groq: 'https://console.groq.com/docs/deprecations',
  openai: 'https://platform.openai.com/docs/deprecations',
  anthropic: 'https://docs.anthropic.com/en/docs/about-claude/model-deprecations',
};

function resolveStt(gc = {}) {
  const provider = gc.stt_provider || process.env.STT_PROVIDER || 'groq';
  return {
    provider,
    apiKey: gc.stt_api_key || process.env.STT_API_KEY,
    model: gc.stt_model || process.env.STT_MODEL || DEFAULT_STT_MODELS[provider] || DEFAULT_STT_MODELS.groq,
  };
}

async function checkModel({ provider, apiKey, model, baseUrl }) {
  if (!apiKey && provider !== 'ollama') return 'NO KEY (cannot check)';
  // Fetch the provider's full model list and look for an exact id match. (Looking a model up by
  // id in the URL breaks for ids containing "/", e.g. Groq's "openai/gpt-oss-120b".)
  let url, headers;
  switch (provider) {
    case 'groq':      url = 'https://api.groq.com/openai/v1/models'; headers = { Authorization: `Bearer ${apiKey}` }; break;
    case 'openai':    url = 'https://api.openai.com/v1/models';      headers = { Authorization: `Bearer ${apiKey}` }; break;
    case 'anthropic': url = 'https://api.anthropic.com/v1/models?limit=1000'; headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }; break;
    case 'ollama':
    case 'custom':
      url = `${(baseUrl || 'http://localhost:11434/v1').replace(/\/$/, '')}/models`;
      headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      break;
    default: return `unknown provider "${provider}"`;
  }
  const res = await fetch(url, { headers });
  if (res.status === 401 || res.status === 403) return `KEY REJECTED (${res.status})`;
  if (!res.ok) return `ERROR ${res.status} listing models`;
  const { data = [] } = await res.json();
  const ids = data.map((m) => m.id);
  if (ids.includes(model) || ids.includes(`${model}:latest`)) return 'OK';
  return `NOT IN ${provider}'s model list (${ids.length} models listed) — likely retired or misspelled`;
}

function loadGuilds() {
  const dbPath = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'src', 'data'), 'guild_config.db');
  if (!fs.existsSync(dbPath)) {
    console.log(`(no guild DB at ${dbPath} — checking env/defaults only)\n`);
    return [{ guild_id: '(env defaults)' }];
  }
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const rows = db.prepare('SELECT * FROM guild_config').all();
  db.close();
  return [{ guild_id: '(env defaults)' }, ...rows];
}

(async () => {
  const providersSeen = new Set();
  for (const gc of loadGuilds()) {
    console.log(`Guild ${gc.guild_id}`);
    const services = [
      ['summarization', resolveConfig('summ', gc)],
      ['translation  ', resolveConfig('trans', gc)],
      ['transcription', resolveStt(gc)],
    ];
    for (const [label, cfg] of services) {
      providersSeen.add(cfg.provider);
      let status;
      try { status = await checkModel(cfg); } catch (e) { status = `ERROR ${e.message}`; }
      console.log(`  ${label}  ${cfg.provider.padEnd(9)} ${cfg.model.padEnd(32)} ${status}`);
    }
  }
  // The interview feature hardcodes this Groq model (src/services/interviewService.js).
  console.log('\nHardcoded: interviewService uses groq / openai/gpt-oss-120b (with the guild summ key)');
  console.log('\nUpcoming deprecations are not exposed by the APIs — see:');
  for (const p of providersSeen) if (DEPRECATION_PAGES[p]) console.log(`  ${p}: ${DEPRECATION_PAGES[p]}`);
})();
