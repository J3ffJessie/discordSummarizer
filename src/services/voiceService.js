const { joinVoiceChannel, EndBehaviorType } = require("@discordjs/voice");
const prism = require("prism-media");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { pipeline } = require("stream");
const { promisify } = require("util");

const pipelineAsync = promisify(pipeline);

class VoiceService {
  constructor(
    client,
    sessionService,
    streamingService,
    transcriptionService,
    translationService,
  ) {
    this.client = client;
    this.sessionService = sessionService;
    this.streamingService = streamingService;
    this.transcriptionService = transcriptionService;
    this.translationService = translationService;

    this.connections = new Map();
    this.activeCaptures = new Map();
    this.lastTranscript = new Map();
  }

  async start(guild, channel, guildId) {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    this.connections.set(guildId, connection);

    const receiver = connection.receiver;

    receiver.speaking.on("start", (userId) => {
      // 🔒 Small delay prevents mid-frame corruption
      setTimeout(() => {
        if (!this.connections.has(guildId)) return;

        this.captureAudio(receiver, userId, guildId).catch(() => {});
      }, 150);
    });
  }

  async stop(guildId) {
    const connection = this.connections.get(guildId);
    if (connection) {
      try {
        connection.destroy();
      } catch {}
      this.connections.delete(guildId);
    }
  }

  async captureAudio(receiver, userId, guildId) {
    if (this.activeCaptures.get(userId)) return;
    this.activeCaptures.set(userId, true);

    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 800,
      },
    });

    const decoder = new prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960,
    });

    // ✅ Use OS temp directory (no repo pollution)
    const tempPcmFile = path.join(
      os.tmpdir(),
      `voice_${Date.now()}_${userId}.pcm`,
    );
    const writeStream = fs.createWriteStream(tempPcmFile);

    let audioBytes = 0;
    let wavFile;
    let hasErrored = false;

    decoder.on("data", (chunk) => {
      audioBytes += chunk.length;
    });

    // 🔒 Fully safe Opus error handling
    decoder.on("error", (err) => {
      if (err?.message?.includes("corrupted")) {
        console.warn(`⚠️ Corrupted Opus frame ignored for user ${userId}`);
        return;
      }

      console.error("Decoder error:", err);
      hasErrored = true;
    });

    opusStream.on("error", () => {});
    writeStream.on("error", () => {});

    try {
      await pipelineAsync(opusStream, decoder, writeStream);

      if (hasErrored) return;

      const minBytes = 48000 * 2 * 2 * 0.3;
      if (audioBytes < minBytes) return;

      wavFile = await this.transcriptionService.convertPcmToWav(tempPcmFile);
      const transcript = await this.transcriptionService.transcribe(wavFile);

      if (!transcript?.text) return;

      const cleaned = transcript.text.trim();
      if (!cleaned) return;

      if (this.lastTranscript.get(userId) === cleaned) return;
      this.lastTranscript.set(userId, cleaned);

      const translated = await this.translationService.translate(cleaned);

      // ✅ Proper member lookup (no cache assumption)
      // const guild = await this.client.guilds.fetch(guildId);
      // const member = await guild.members.fetch(userId).catch(() => null);
      // const displayName = member?.displayName || 'Unknown User';

      // member look up to display user name for who is speaking in the discord voice channel
      // ✅ Safer member lookup
      let displayName = userId; // fallback to ID if everything fails

      try {
        const guild = this.client.guilds.cache.get(guildId);

        if (guild) {
          // Try cache first
          let member = guild.members.cache.get(userId);

          // If not cached, fetch from API
          if (!member) {
            member = await guild.members.fetch(userId).catch(() => null);
          }

          if (member) {
            displayName = member.displayName || member.user.username;
          }
        }
      } catch (err) {
        console.warn("Member lookup failed:", err.message);
      }

      this.streamingService.broadcast(guildId, {
        userId,
        displayName,
        original: cleaned,
        translated,
        timestamp: Date.now(),
      });
    } catch (err) {
      if (!err?.message?.includes("corrupted")) {
        console.error(`Capture error for user ${userId}:`, err?.message);
      }
    } finally {
      this.activeCaptures.delete(userId);

      try {
        opusStream.destroy();
      } catch {}
      try {
        decoder.destroy();
      } catch {}
      try {
        writeStream.destroy();
      } catch {}

      if (fs.existsSync(tempPcmFile)) {
        fs.unlink(tempPcmFile, () => {});
      }

      if (wavFile && fs.existsSync(wavFile)) {
        fs.unlink(wavFile, () => {});
      }
    }
  }
}

module.exports = { VoiceService };
