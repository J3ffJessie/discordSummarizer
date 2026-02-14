// const {
//   joinVoiceChannel,
//   EndBehaviorType,
// } = require('@discordjs/voice');

// const prism = require('prism-media');
// const fs = require('fs');
// const { pipeline } = require('stream');
// const { promisify } = require('util');

// const pipelineAsync = promisify(pipeline);

// class VoiceService {
//   constructor(sessionService, streamingService, transcriptionService, translationService) {
//     this.sessionService = sessionService;
//     this.streamingService = streamingService;
//     this.transcriptionService = transcriptionService;
//     this.translationService = translationService;
//     this.connections = new Map();
//   }

//   async start(guild, channel, guildId) {
//     const connection = joinVoiceChannel({
//       channelId: channel.id,
//       guildId: guild.id,
//       adapterCreator: guild.voiceAdapterCreator,
//       selfDeaf: false,
//       selfMute: true,
//     });

//     this.connections.set(guildId, connection);

//     const receiver = connection.receiver;

//     receiver.speaking.on('start', (userId) => {
//       this.captureAudio(receiver, userId, guildId);
//     });
//   }

//   async stop(guildId) {
//     const connection = this.connections.get(guildId);
//     if (connection) {
//       connection.destroy();
//       this.connections.delete(guildId);
//     }
//   }

//   async captureAudio(receiver, userId, guildId) {
//     const opusStream = receiver.subscribe(userId, {
//       end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
//     });

//     const pcmStream = opusStream.pipe(
//       new prism.opus.Decoder({
//         rate: 48000,
//         channels: 2,
//         frameSize: 960,
//       })
//     );

//     const tempFile = `temp_${Date.now()}.pcm`;
//     const writeStream = fs.createWriteStream(tempFile);

//     try {
//       await pipelineAsync(pcmStream, writeStream);

//       const wavFile = await this.transcriptionService.convertPcmToWav(tempFile);
//       const transcript = await this.transcriptionService.transcribe(wavFile);
//       if (!transcript?.text) return;

//       const translated = await this.translationService.translate(transcript.text);

//       this.streamingService.broadcast(guildId, {
//         userId,
//         original: transcript.text,
//         translated,
//         timestamp: Date.now(),
//       });
//     } catch (err) {
//       console.error(err);
//     } finally {
//       fs.unlink(tempFile, () => {});
//     }
//   }
// }

// module.exports = { VoiceService };
const { joinVoiceChannel, EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const fs = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');

const pipelineAsync = promisify(pipeline);

class VoiceService {
  constructor(sessionService, streamingService, transcriptionService, translationService) {
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

    receiver.speaking.on('start', (userId) => {
      this.captureAudio(receiver, userId, guildId).catch((err) =>
        console.error(`Error capturing audio for user ${userId}:`, err)
      );
    });
  }

  async stop(guildId) {
    const connection = this.connections.get(guildId);
    if (connection) {
      connection.destroy();
      this.connections.delete(guildId);
    }
  }

  async captureAudio(receiver, userId, guildId) {
  if (this.activeCaptures.get(userId)) return;
  this.activeCaptures.set(userId, true);

  // Small delay to avoid partial frame corruption
  await new Promise(res => setTimeout(res, 200));

  const opusStream = receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: 1500,
    },
  });

  const decoder = new prism.opus.Decoder({
    rate: 48000,
    channels: 2,
    frameSize: 960,
  });

  const tempPcmFile = `temp_${Date.now()}_${userId}.pcm`;
  const writeStream = fs.createWriteStream(tempPcmFile);

  let audioBytes = 0;
  let wavFile;

  decoder.on('data', (chunk) => {
    audioBytes += chunk.length;
  });

  // Suppress corrupted frame crashes
  decoder.on('error', (err) => {
    if (err.message.includes('corrupted')) {
      console.warn(`Corrupted frame ignored for user ${userId}`);
      return;
    }
    console.error(err);
  });

  opusStream.on('error', () => {});
  writeStream.on('error', () => {});

  try {
    await pipelineAsync(opusStream, decoder, writeStream);

    const minBytes = 48000 * 2 * 2 * 0.3; // require ~300ms minimum
    if (audioBytes < minBytes) {
      return;
    }

    wavFile = await this.transcriptionService.convertPcmToWav(tempPcmFile);
    const transcript = await this.transcriptionService.transcribe(wavFile);

    if (!transcript?.text) return;

    const cleaned = transcript.text.trim();
    if (!cleaned) return;

    if (this.lastTranscript.get(userId) === cleaned) return;
    this.lastTranscript.set(userId, cleaned);

    const translated = await this.translationService.translate(cleaned);

    this.streamingService.broadcast(guildId, {
      userId,
      original: cleaned,
      translated,
      timestamp: Date.now(),
    });

  } catch (err) {
    console.error(`Capture error for user ${userId}:`, err.message);
  } finally {
    this.activeCaptures.delete(userId);

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

