const fs = require('fs');
const wav = require('wav');
const Groq = require('groq-sdk');

class TranscriptionService {
  constructor() {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
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

  async transcribe(filePath) {
    return await this.groq.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-large-v3-turbo',
    });
  }
}

module.exports = { TranscriptionService };
