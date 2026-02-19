const fs = require('fs');
const { Readable, Writable } = require('stream');
const { TranscriptionService } = require('../TranscriptionService');

jest.mock('fs');
jest.mock('groq-sdk', () => {
  return jest.fn().mockImplementation(() => ({
    audio: {
      transcriptions: {
        create: jest.fn(),
      },
    },
  }));
});
jest.mock('wav', () => ({
  FileWriter: jest.fn(),
}));

const wav = require('wav');

describe('TranscriptionService', () => {
  let transcriptionService;
  let mockCreate;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create service instance
    transcriptionService = new TranscriptionService();
    mockCreate = transcriptionService.groq.audio.transcriptions.create;

    // Mock fs.createReadStream with a dummy readable stream
    fs.createReadStream.mockImplementation(() => {
      const stream = new Readable();
      stream._read = () => {}; // no-op
      return stream;
    });

    // Mock wav.FileWriter as a writable stream compatible with pipe()
    wav.FileWriter.mockImplementation(() => {
      const writable = new Writable({
        write(chunk, encoding, callback) {
          callback(); // no-op
        },
      });

      // Simulate immediate 'finish' event
      process.nextTick(() => writable.emit('finish'));
      return writable;
    });
  });

  // -----------------------------
  // Tests for transcribe()
  // -----------------------------
  describe('transcribe', () => {
    it('should call Groq SDK with correct file and model', async () => {
      mockCreate.mockResolvedValue({ text: 'hello world' });

      await transcriptionService.transcribe('test.wav');

      expect(mockCreate).toHaveBeenCalledWith({
        file: expect.any(Readable),
        model: 'whisper-large-v3-turbo',
      });
    });

    it('should return the transcription text', async () => {
      mockCreate.mockResolvedValue({ text: 'hello world' });

      const result = await transcriptionService.transcribe('test.wav');

      expect(result.text).toBe('hello world');
    });

    it('should throw if Groq SDK fails', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));

      await expect(transcriptionService.transcribe('test.wav')).rejects.toThrow(
        'API error'
      );
    });

    it('should throw for empty or null file path', async () => {
      await expect(transcriptionService.transcribe('')).rejects.toThrow(
        'Invalid file path'
      );
      await expect(transcriptionService.transcribe(null)).rejects.toThrow(
        'Invalid file path'
      );
    });
  });

  // -----------------------------
  // Tests for convertPcmToWav()
  // -----------------------------
  describe('convertPcmToWav', () => {
    it('should convert PCM file to WAV', async () => {
      const result = await transcriptionService.convertPcmToWav('audio.pcm');

      expect(result).toBe('audio.wav');
      expect(fs.createReadStream).toHaveBeenCalledWith('audio.pcm');
      expect(wav.FileWriter).toHaveBeenCalledWith('audio.wav', expect.any(Object));
    });
  });
});
