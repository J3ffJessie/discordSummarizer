const fs = require('fs');
const wav = require('wav');
const { createTranscriptionProvider } = require('../providers');

class TranscriptionService {
  constructor(guildConfigService) {
    this.gcs = guildConfigService;
  }

  async convertPcmToWav(pcmFile) {
    const wavFile = pcmFile.replace('.pcm', '.wav');

    return new Promise((resolve, reject) => {
      const reader = fs.createReadStream(pcmFile);
      const writer = new wav.FileWriter(wavFile, {
        channels: 2,
        sampleRate: 48000,
        bitDepth: 16,
      });

      reader.pipe(writer);
      writer.on('finish', () => resolve(wavFile));
      writer.on('error', reject);
    });
  }

  async transcribe(filePath, guildId = null) {
    if (!filePath) throw new Error('Invalid file path');
    const guildConfig = this.gcs?.getConfig(guildId) || null;
    const provider = createTranscriptionProvider(guildConfig);
    return await provider.transcribe(fs.createReadStream(filePath));
  }
}

module.exports = { TranscriptionService };
