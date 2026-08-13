jest.mock('discord.js', () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => ({
    setName: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    addSubcommand: jest.fn().mockReturnThis(),
  })),
  PermissionFlagsBits: {
    ManageChannels: 'MANAGE_CHANNELS',
    ManageRoles: 'MANAGE_ROLES',
    Connect: 'CONNECT',
  },
  MessageFlags: { Ephemeral: 64 },
  ActionRowBuilder: jest.fn().mockImplementation(() => ({
    addComponents: jest.fn().mockReturnThis(),
  })),
  StringSelectMenuBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setPlaceholder: jest.fn().mockReturnThis(),
    addOptions: jest.fn().mockReturnThis(),
  })),
  ButtonBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
  })),
  ButtonStyle: { Primary: 1 },
}));

const command = require('../interview');

// ─── helpers ───────────────────────────────────────────────────────────────────

function makeBotMember({ manageChannels = true, manageRoles = true, connect = true } = {}) {
  const { PermissionFlagsBits } = require('discord.js');
  return {
    permissions: {
      has: jest.fn().mockImplementation((perm) => {
        if (perm === PermissionFlagsBits.ManageChannels) return manageChannels;
        if (perm === PermissionFlagsBits.ManageRoles) return manageRoles;
        if (perm === PermissionFlagsBits.Connect) return connect;
        return true;
      }),
    },
  };
}

function makeInterviewService({ hasSession = false, userId = 'u1' } = {}) {
  const sessions = new Map();
  if (hasSession) sessions.set(userId, {});
  return {
    sessions,
    setPendingSetup: jest.fn(),
    stopInterview: jest.fn().mockResolvedValue(undefined),
  };
}

function makeInteraction({
  subcommand = 'start',
  inGuild = true,
  userId = 'u1',
  hasAttachment = false,
  botPerms = {},
} = {}) {
  return {
    guild: inGuild
      ? { id: 'guild1', members: { me: makeBotMember(botPerms) } }
      : null,
    guildId: 'guild1',
    user: { id: userId },
    options: {
      getSubcommand: jest.fn().mockReturnValue(subcommand),
      getAttachment: jest.fn().mockReturnValue(
        hasAttachment
          ? { url: 'http://example.com/jd.pdf', contentType: 'application/pdf', name: 'jd.pdf' }
          : null
      ),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

// ─── tests ─────────────────────────────────────────────────────────────────────

describe('/interview command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── start subcommand ──────────────────────────────────────────────────────

  describe('start', () => {
    it('should reply with error when not used in a guild', async () => {
      const interaction = makeInteraction({ inGuild: false });
      await command.execute(interaction, { interviewService: makeInterviewService() });
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('inside a server') })
      );
    });

    it('should reply with error when user already has an active interview', async () => {
      const interaction = makeInteraction();
      await command.execute(interaction, { interviewService: makeInterviewService({ hasSession: true }) });
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('already have an active interview') })
      );
    });

    it('should reply with error when bot is missing permissions', async () => {
      const interaction = makeInteraction({ botPerms: { manageChannels: false } });
      await command.execute(interaction, { interviewService: makeInterviewService() });
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('missing the following permissions') })
      );
    });

    it('should list every missing permission in the error message', async () => {
      const interaction = makeInteraction({ botPerms: { manageChannels: false, manageRoles: false } });
      await command.execute(interaction, { interviewService: makeInterviewService() });
      const { content } = interaction.reply.mock.calls[0][0];
      expect(content).toContain('Manage Channels');
      expect(content).toContain('Manage Roles');
    });

    it('should call setPendingSetup with null attachment when none is provided', async () => {
      const interaction = makeInteraction();
      const interviewService = makeInterviewService();
      await command.execute(interaction, { interviewService });
      expect(interviewService.setPendingSetup).toHaveBeenCalledWith('u1', { attachment: null });
    });

    it('should pass attachment data to setPendingSetup when an attachment is provided', async () => {
      const interaction = makeInteraction({ hasAttachment: true });
      const interviewService = makeInterviewService();
      await command.execute(interaction, { interviewService });
      expect(interviewService.setPendingSetup).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          attachment: expect.objectContaining({ url: 'http://example.com/jd.pdf' }),
        })
      );
    });

    it('should reply with the style selector and continue button', async () => {
      const interaction = makeInteraction();
      await command.execute(interaction, { interviewService: makeInterviewService() });
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Step 1 of 2'),
          components: expect.any(Array),
        })
      );
    });

    it('should include a language selector with English as the default option', async () => {
      const { StringSelectMenuBuilder } = require('discord.js');
      const interaction = makeInteraction();
      await command.execute(interaction, { interviewService: makeInterviewService() });

      // Second StringSelectMenuBuilder instance created is the language selector (style is first)
      const languageSelect = StringSelectMenuBuilder.mock.results[1].value;
      expect(languageSelect.setPlaceholder).toHaveBeenCalledWith(
        expect.stringContaining('English')
      );
      const options = languageSelect.addOptions.mock.calls[0][0];
      expect(options).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: 'English', value: 'en', default: true })])
      );
      expect(options.length).toBeGreaterThan(1);
    });

    it('should send the reply as ephemeral', async () => {
      const interaction = makeInteraction();
      await command.execute(interaction, { interviewService: makeInterviewService() });
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: 64 })
      );
    });
  });

  // ─── stop subcommand ───────────────────────────────────────────────────────

  describe('stop', () => {
    it('should reply with error when the user has no active interview', async () => {
      const interaction = makeInteraction({ subcommand: 'stop' });
      await command.execute(interaction, { interviewService: makeInterviewService() });
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("don't have an active interview") })
      );
    });

    it('should call stopInterview and confirm success', async () => {
      const interaction = makeInteraction({ subcommand: 'stop' });
      const interviewService = makeInterviewService({ hasSession: true });
      await command.execute(interaction, { interviewService });
      expect(interviewService.stopInterview).toHaveBeenCalledWith('u1');
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('stopped') })
      );
    });

    it('should send the stop confirmation as ephemeral', async () => {
      const interaction = makeInteraction({ subcommand: 'stop' });
      const interviewService = makeInterviewService({ hasSession: true });
      await command.execute(interaction, { interviewService });
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: 64 })
      );
    });
  });
});
