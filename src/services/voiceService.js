const { joinVoiceChannel, EndBehaviorType } = require("@discordjs/voice");
const OpusScript = require("opusscript");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Force-process audio in chunks so continuous speech doesn't pile up into
// one big delayed translation. 4s balances latency vs. Whisper accuracy.
const MAX_CAPTURE_MS = 4000;

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
      // Brief delay avoids the corrupted first Opus frame Discord sends
      // when a user's encoder initializes.
      setTimeout(() => {
        if (!this.connections.has(guildId)) return;
        this.captureAudio(receiver, userId, guildId).catch(() => {});
      }, 100);
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
        duration: 300,
      },
    });

    let audioBytes = 0;
    let hitMaxDuration = false;

    const decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
    const pcmChunks = [];

    try {
      await new Promise((resolve, reject) => {
        let settled = false;

        const settle = (err) => {
          if (settled) return;
          settled = true;
          if (err) reject(err);
          else resolve();
        };

        const maxTimer = setTimeout(() => {
          hitMaxDuration = true;
          opusStream.destroy();
          settle();
        }, MAX_CAPTURE_MS);

        opusStream.on("data", (packet) => {
          try {
            const pcm = decoder.decode(packet);
            pcmChunks.push(pcm);
            audioBytes += pcm.length;
          } catch {
            // Corrupted Opus frame — skip this frame, keep going
          }
        });

        opusStream.on("end",   () => { clearTimeout(maxTimer); settle(); });
        opusStream.on("close", () => { clearTimeout(maxTimer); settle(); });
        opusStream.on("error", (err) => { clearTimeout(maxTimer); settle(err); });
      });
    } catch (err) {
      console.error(`Capture error for user ${userId}:`, err?.message);
    } finally {
      decoder.delete();

      // Release the lock immediately — the next utterance can start capturing
      // without waiting for the Whisper + translation API calls to finish.
      this.activeCaptures.delete(userId);

      // User is still speaking — re-subscribe right away before yielding to
      // the event loop so we don't miss audio between chunks.
      if (hitMaxDuration && this.connections.has(guildId)) {
        this.captureAudio(receiver, userId, guildId).catch(() => {});
      }

      try { opusStream.destroy(); } catch {}
    }

    // Hand off to background processing — does not block the next capture.
    const minBytes = 48000 * 2 * 2 * 0.3;
    if (audioBytes >= minBytes && pcmChunks.length > 0) {
      this.processAudio(pcmChunks, userId, guildId).catch((err) => {
        console.error(`Process error for user ${userId}:`, err?.message);
      });
    }
  }

  async processAudio(pcmChunks, userId, guildId) {
    const tempPcmFile = path.join(
      os.tmpdir(),
      `voice_${Date.now()}_${userId}.pcm`,
    );
    let wavFile;

    try {
      await fs.promises.writeFile(tempPcmFile, Buffer.concat(pcmChunks));

      wavFile = await this.transcriptionService.convertPcmToWav(tempPcmFile);
      const transcript = await this.transcriptionService.transcribe(wavFile);

      if (!transcript?.text) return;

      const cleaned = transcript.text.trim();
      if (!cleaned) return;

      if (this.lastTranscript.get(userId) === cleaned) return;
      this.lastTranscript.set(userId, cleaned);

      const translated = await this.translationService.translate(cleaned);

      let displayName = userId;

      try {
        const guild = this.client.guilds.cache.get(guildId);

        if (guild) {
          let member = guild.members.cache.get(userId);

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
    } finally {
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
