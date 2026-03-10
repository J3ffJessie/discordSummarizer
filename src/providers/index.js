/**
 * AI Provider abstraction layer.
 *
 * Supports: groq, openai, anthropic, ollama, custom (OpenAI-compatible)
 * Transcription: groq, openai
 *
 * Config resolution order for each service (summ / trans / stt):
 *   1. Guild SQLite config fields (e.g. summ_provider, summ_api_key, ...)
 *   2. Env var overrides (SUMM_PROVIDER, SUMM_API_KEY, ...)
 *   3. Error — guild must configure their own API key via /setup ai
 */

const DEFAULT_CHAT_MODELS = {
  groq: 'llama-3.1-8b-instant',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  ollama: 'llama3.2',
  custom: 'llama3.2',
};

const DEFAULT_STT_MODELS = {
  groq: 'whisper-large-v3-turbo',
  openai: 'whisper-1',
};

/* ============================================================
   Chat adapters — all expose: async chat(systemPrompt, userContent, options) → string
   ============================================================ */

class GroqChatAdapter {
  constructor(apiKey, model) {
    const Groq = require('groq-sdk');
    this.client = new Groq({ apiKey });
    this.model = model;
  }

  async chat(systemPrompt, userContent, options = {}) {
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    });
    return response.choices[0].message.content;
  }
}

class OpenAICompatibleAdapter {
  constructor(apiKey, model, baseURL) {
    const { OpenAI } = require('openai');
    this.client = new OpenAI({ apiKey, baseURL });
    this.model = model;
  }

  async chat(systemPrompt, userContent, options = {}) {
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    });
    return response.choices[0].message.content;
  }
}

class AnthropicAdapter {
  constructor(apiKey, model) {
    const Anthropic = require('@anthropic-ai/sdk');
    this.client = new Anthropic.default({ apiKey });
    this.model = model;
  }

  async chat(systemPrompt, userContent, options = {}) {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options.max_tokens ?? 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
    return response.content[0].text;
  }
}

/* ============================================================
   Transcription adapters — expose: async transcribe(fileStream) → transcription object
   ============================================================ */

class GroqTranscriptionAdapter {
  constructor(apiKey, model) {
    const Groq = require('groq-sdk');
    this.client = new Groq({ apiKey });
    this.model = model;
  }

  async transcribe(fileStream) {
    return await this.client.audio.transcriptions.create({
      file: fileStream,
      model: this.model,
    });
  }
}

class OpenAITranscriptionAdapter {
  constructor(apiKey, model) {
    const { OpenAI } = require('openai');
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async transcribe(fileStream) {
    return await this.client.audio.transcriptions.create({
      file: fileStream,
      model: this.model,
    });
  }
}

/* ============================================================
   Factory functions
   ============================================================ */

/**
 * Resolve config for a given service type from guild config + env vars.
 * @param {'summ'|'trans'} serviceType
 * @param {object|null} guildConfig  Row from guild_config table (or null)
 */
function resolveConfig(serviceType, guildConfig) {
  const env = serviceType.toUpperCase(); // 'SUMM' or 'TRANS'
  const gc = guildConfig || {};

  const provider = gc[`${serviceType}_provider`]
    || process.env[`${env}_PROVIDER`]
    || 'groq';

  const apiKey = gc[`${serviceType}_api_key`]
    || process.env[`${env}_API_KEY`];

  const model = gc[`${serviceType}_model`]
    || process.env[`${env}_MODEL`]
    || DEFAULT_CHAT_MODELS[provider]
    || DEFAULT_CHAT_MODELS.groq;

  const baseUrl = gc[`${serviceType}_base_url`]
    || process.env[`${env}_BASE_URL`];

  return { provider, apiKey, model, baseUrl };
}

/**
 * Create a chat provider for summarization or translation.
 * @param {'summ'|'trans'} serviceType
 * @param {object|null} guildConfig
 */
function createChatProvider(serviceType, guildConfig) {
  const { provider, apiKey, model, baseUrl } = resolveConfig(serviceType, guildConfig);

  if (!apiKey && provider !== 'ollama') {
    throw new Error(
      `No API key configured for ${serviceType === 'summ' ? 'summarization' : 'translation'} ` +
      `(provider: ${provider}). ` +
      `Set an API key via \`/setup ai\` or the relevant environment variable.`
    );
  }

  switch (provider) {
    case 'groq':
      return new GroqChatAdapter(apiKey, model);
    case 'openai':
      return new OpenAICompatibleAdapter(apiKey, model, 'https://api.openai.com/v1');
    case 'anthropic':
      return new AnthropicAdapter(apiKey, model);
    case 'ollama':
      return new OpenAICompatibleAdapter(
        apiKey || 'ollama',
        model,
        baseUrl || 'http://localhost:11434/v1'
      );
    case 'custom':
      if (!baseUrl) throw new Error('Custom provider requires a base URL. Set it via `/setup ai`.');
      return new OpenAICompatibleAdapter(apiKey, model, baseUrl);
    default:
      throw new Error(`Unknown provider "${provider}". Use groq, openai, anthropic, ollama, or custom.`);
  }
}

/**
 * Create a transcription provider.
 * @param {object|null} guildConfig
 */
function createTranscriptionProvider(guildConfig) {
  const gc = guildConfig || {};

  const provider = gc.stt_provider
    || process.env.STT_PROVIDER
    || 'groq';

  const apiKey = gc.stt_api_key
    || process.env.STT_API_KEY;

  const model = gc.stt_model
    || process.env.STT_MODEL
    || DEFAULT_STT_MODELS[provider]
    || DEFAULT_STT_MODELS.groq;

  if (!apiKey) {
    throw new Error(
      `No API key configured for transcription (provider: ${provider}). ` +
      `Set one via \`/setup ai service:transcription\` or the STT_API_KEY environment variable.`
    );
  }

  switch (provider) {
    case 'groq':
      return new GroqTranscriptionAdapter(apiKey, model);
    case 'openai':
      return new OpenAITranscriptionAdapter(apiKey, model);
    default:
      throw new Error(`Unknown transcription provider "${provider}". Use groq or openai.`);
  }
}

module.exports = { createChatProvider, createTranscriptionProvider };
