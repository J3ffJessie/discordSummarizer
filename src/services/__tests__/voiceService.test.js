jest.mock('@discordjs/voice', () => ({
  joinVoiceChannel: jest.fn().mockReturnValue({
    on: jest.fn(),
    destroy: jest.fn(),
    receiver: {
      speaking: { on: jest.fn() },
      subscribe: jest.fn(),
    },
  }),
  EndBehaviorType: { AfterSilence: 'AfterSilence' },
  VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected' },
  entersState: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('opusscript', () => {
  return jest.fn().mockImplementation(() => ({
    decode: jest.fn().mockReturnValue(Buffer.alloc(1000)),
    delete: jest.fn(),
  }));
});

jest.mock('fs', () => ({
  promises: { writeFile: jest.fn().mockResolvedValue(undefined) },
  existsSync: jest.fn().mockReturnValue(false),
  unlink: jest.fn((p, cb) => cb && cb()),
}));

const { VoiceService } = require('../voiceService');
const { joinVoiceChannel, entersState } = require('@discordjs/voice');

function makeServices() {
  return {
    sessionService: {},
    streamingService: {
      getRequestedLanguages: jest.fn().mockReturnValue(new Set(['English'])),
      broadcast: jest.fn(),
    },
    transcriptionService: {
      convertPcmToWav: jest.fn().mockResolvedValue('/tmp/test.wav'),
      transcribe: jest.fn().mockResolvedValue({ text: 'Hello world' }),
    },
    translationService: {
      translate: jest.fn().mockResolvedValue('Hello world'),
    },
  };
}

function makeClient(guildId = 'g1') {
  const members = new Map([['u1', { displayName: 'Alice', user: { username: 'alice' } }]]);
  return {
    guilds: {
      cache: new Map([[guildId, {
        members: { cache: members, fetch: jest.fn().mockResolvedValue(members.get('u1')) },
      }]]),
    },
  };
}

describe('VoiceService', () => {
  let service;
  let svcs;

  beforeEach(() => {
    jest.clearAllMocks();
    svcs = makeServices();
    service = new VoiceService(
      makeClient(),
      svcs.sessionService,
      svcs.streamingService,
      svcs.transcriptionService,
      svcs.translationService,
    );
  });

  describe('start', () => {
    it('should call joinVoiceChannel and store connection', async () => {
      const guild = { id: 'g1', voiceAdapterCreator: jest.fn() };
      const channel = { id: 'ch1' };
      await service.start(guild, channel, 'g1');
      expect(joinVoiceChannel).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'ch1', guildId: 'g1' }));
      expect(service.connections.has('g1')).toBe(true);
    });
  });

  describe('stop', () => {
    it('should destroy the connection and remove it', async () => {
      const mockDestroy = jest.fn();
      service.connections.set('g1', { destroy: mockDestroy });
      await service.stop('g1');
      expect(mockDestroy).toHaveBeenCalled();
      expect(service.connections.has('g1')).toBe(false);
    });

    it('should not throw when stopping a non-existent connection', async () => {
      await expect(service.stop('unknown')).resolves.not.toThrow();
    });
  });

  describe('processAudio', () => {
    it('should transcribe and broadcast when transcript is present', async () => {
      const pcmChunks = [Buffer.alloc(100000)];
      await service.processAudio(pcmChunks, 'u1', 'g1');
      expect(svcs.transcriptionService.transcribe).toHaveBeenCalled();
      expect(svcs.streamingService.broadcast).toHaveBeenCalled();
    });

    it('should not broadcast when transcript is empty', async () => {
      svcs.transcriptionService.transcribe.mockResolvedValue({ text: '' });
      const pcmChunks = [Buffer.alloc(100000)];
      await service.processAudio(pcmChunks, 'u1', 'g1');
      expect(svcs.streamingService.broadcast).not.toHaveBeenCalled();
    });

    it('should not broadcast when transcript is null', async () => {
      svcs.transcriptionService.transcribe.mockResolvedValue(null);
      const pcmChunks = [Buffer.alloc(100000)];
      await service.processAudio(pcmChunks, 'u1', 'g1');
      expect(svcs.streamingService.broadcast).not.toHaveBeenCalled();
    });

    it('should deduplicate repeated identical transcripts', async () => {
      const pcmChunks = [Buffer.alloc(100000)];
      await service.processAudio(pcmChunks, 'u1', 'g1');
      await service.processAudio(pcmChunks, 'u1', 'g1');
      expect(svcs.streamingService.broadcast).toHaveBeenCalledTimes(1);
    });
  });

  describe('captureAudio', () => {
    it('should not start a second capture for the same user while one is active', async () => {
      service.activeCaptures.set('g1-u1', true);

      const mockSubscribe = jest.fn();
      const mockReceiver = { subscribe: mockSubscribe };
      await service.captureAudio(mockReceiver, 'u1', 'g1');

      expect(mockSubscribe).not.toHaveBeenCalled();
    });
  });
});
