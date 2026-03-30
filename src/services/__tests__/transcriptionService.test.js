const fs = require('fs');
const { Readable, Writable } = require('stream');

const mockTranscribe = jest.fn();

jest.mock('fs');
jest.mock('../../providers', () => ({
  createTranscriptionProvider: jest.fn(() => ({ transcribe: mockTranscribe })),
}));
jest.mock('wav', () => ({
  FileWriter: jest.fn(),
}));

const wav = require('wav');
const { TranscriptionService } = require('../TranscriptionService');

describe('TranscriptionService', () => {
  let transcriptionService;

  beforeEach(() => {
    jest.clearAllMocks();

    transcriptionService = new TranscriptionService(null);

    fs.createReadStream.mockImplementation(() => {
      const stream = new Readable();
      stream._read = () => {};
      return stream;
    });

    wav.FileWriter.mockImplementation(() => {
      const writable = new Writable({
        write(chunk, encoding, callback) {
          callback();
        },
      });
      process.nextTick(() => writable.emit('finish'));
      return writable;
    });
  });

  describe('transcribe', () => {
    it('should call provider with the file stream', async () => {
      mockTranscribe.mockResolvedValue({ text: 'hello world' });

      await transcriptionService.transcribe('test.wav');

      expect(mockTranscribe).toHaveBeenCalledWith(expect.any(Readable));
    });

    it('should return the transcription result', async () => {
      mockTranscribe.mockResolvedValue({ text: 'hello world' });

      const result = await transcriptionService.transcribe('test.wav');

      expect(result.text).toBe('hello world');
    });

    it('should throw if provider fails', async () => {
      mockTranscribe.mockRejectedValue(new Error('API error'));

      await expect(transcriptionService.transcribe('test.wav')).rejects.toThrow('API error');
    });

    it('should throw for empty or null file path', async () => {
      await expect(transcriptionService.transcribe('')).rejects.toThrow('Invalid file path');
      await expect(transcriptionService.transcribe(null)).rejects.toThrow('Invalid file path');
    });
  });

  describe('convertPcmToWav', () => {
    it('should convert PCM file to WAV', async () => {
      const result = await transcriptionService.convertPcmToWav('audio.pcm');

      expect(result).toBe('audio.wav');
      expect(fs.createReadStream).toHaveBeenCalledWith('audio.pcm');
      expect(wav.FileWriter).toHaveBeenCalledWith('audio.wav', expect.any(Object));
    });
  });
});
