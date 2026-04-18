jest.mock('discord.js', () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => ({
    setName: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    addSubcommand: jest.fn().mockReturnThis(),
  })),
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
    setTimestamp: jest.fn().mockReturnThis(),
  })),
  MessageFlags: { Ephemeral: 64 },
}));

const command = require('../translate');

function makeSessionService({ hasSession = false } = {}) {
  const session = hasSession ? { token: 'tok123', captions: [], clients: new Set() } : null;
  return {
    getSession: jest.fn().mockReturnValue(session),
    createSession: jest.fn().mockReturnValue({ token: 'newtoken123' }),
    deleteSession: jest.fn(),
  };
}

function makeVoiceService() {
  return {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
  };
}

function makeInteraction({ subcommand = 'start', inGuild = true, inVoice = true, guildId = 'guild1' } = {}) {
  return {
    guild: inGuild ? { id: guildId } : null,
    guildId,
    member: {
      voice: {
        channel: inVoice ? { id: 'vc1', name: 'General' } : null,
      },
    },
    options: {
      getSubcommand: jest.fn().mockReturnValue(subcommand),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('/translate command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── start subcommand ───────────────────────────────────────────────────────

  describe('start', () => {
    it('should reply with error when not used in a guild', async () => {
      const interaction = makeInteraction({ inGuild: false });
      const services = { sessionService: makeSessionService(), voiceService: makeVoiceService() };

      await command.execute(interaction, services);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('inside a server') })
      );
    });

    it('should reply with error when user is not in a voice channel', async () => {
      const interaction = makeInteraction({ inVoice: false });
      const services = { sessionService: makeSessionService(), voiceService: makeVoiceService() };

      await command.execute(interaction, services);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('voice channel') })
      );
    });

    it('should reply with error when a session already exists', async () => {
      const interaction = makeInteraction();
      const services = { sessionService: makeSessionService({ hasSession: true }), voiceService: makeVoiceService() };

      await command.execute(interaction, services);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('already running') })
      );
    });

    it('should start a session and voice capture, then edit reply with embed', async () => {
      const interaction = makeInteraction();
      const voiceService = makeVoiceService();
      const sessionService = makeSessionService({ hasSession: false });
      const services = { sessionService, voiceService };

      await command.execute(interaction, services);

      expect(sessionService.createSession).toHaveBeenCalledWith(
        'guild1',
        expect.any(Function)
      );
      expect(voiceService.start).toHaveBeenCalledWith(
        interaction.guild,
        interaction.member.voice.channel,
        'guild1'
      );
      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );
    });

    it('should include the caption URL in the embed description', async () => {
      process.env.CAPTION_URL = 'https://example.com';
      const interaction = makeInteraction({ guildId: 'guild99' });
      const services = { sessionService: makeSessionService(), voiceService: makeVoiceService() };

      await command.execute(interaction, services);

      const { EmbedBuilder } = require('discord.js');
      const embedInstance = EmbedBuilder.mock.results[0]?.value;
      expect(embedInstance.setDescription).toHaveBeenCalledWith(
        expect.stringContaining('guild99')
      );

      delete process.env.CAPTION_URL;
    });

    it('should call voiceService.stop when the session expires', async () => {
      jest.useFakeTimers();
      const voiceService = makeVoiceService();
      const sessionService = makeSessionService({ hasSession: false });
      // Capture the onExpire callback
      let capturedOnExpire;
      sessionService.createSession.mockImplementation((guildId, onExpire) => {
        capturedOnExpire = onExpire;
        return { token: 'tok' };
      });

      const interaction = makeInteraction({ guildId: 'guild1' });
      await command.execute(interaction, { sessionService, voiceService });

      expect(capturedOnExpire).toBeDefined();
      capturedOnExpire();
      expect(voiceService.stop).toHaveBeenCalledWith('guild1');

      jest.useRealTimers();
    });
  });

  // ─── stop subcommand ────────────────────────────────────────────────────────

  describe('stop', () => {
    it('should reply with error when no active session exists', async () => {
      const interaction = makeInteraction({ subcommand: 'stop' });
      const services = { sessionService: makeSessionService({ hasSession: false }), voiceService: makeVoiceService() };

      await command.execute(interaction, services);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('no active') })
      );
    });

    it('should stop voice capture, delete session, and edit reply with embed', async () => {
      const interaction = makeInteraction({ subcommand: 'stop' });
      const voiceService = makeVoiceService();
      const sessionService = makeSessionService({ hasSession: true });
      const services = { sessionService, voiceService };

      await command.execute(interaction, services);

      expect(voiceService.stop).toHaveBeenCalledWith('guild1');
      expect(sessionService.deleteSession).toHaveBeenCalledWith('guild1');
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );
    });
  });
});
