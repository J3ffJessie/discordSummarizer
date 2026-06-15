const giveawayCmd = require('../giveaway');

function makeInteraction({ sub = 'start', title = 'My Giveaway', prize = 'A Prize', guildId = 'g1' } = {}) {
  return {
    guildId,
    user: { id: 'host1', username: 'host' },
    member: { displayName: 'Host' },
    options: {
      getSubcommand: jest.fn().mockReturnValue(sub),
      getString: jest.fn((name) => (name === 'title' ? title : prize)),
    },
    client: {
      channels: { fetch: jest.fn().mockResolvedValue({
        messages: { fetch: jest.fn().mockResolvedValue({ edit: jest.fn().mockResolvedValue(undefined) }) },
      }) },
    },
    reply: jest.fn().mockResolvedValue({ id: 'msg1', channelId: 'ch1' }),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

function makeServices(existing = null) {
  return {
    giveawayService: {
      get: jest.fn().mockReturnValue(existing),
      create: jest.fn().mockReturnValue({ id: 'ga1', token: 'tok1', title: 'My Giveaway', messageId: null, channelId: null }),
      end: jest.fn().mockReturnValue(existing),
    },
  };
}

describe('/giveaway command', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('start subcommand', () => {
    it('should reply with an embed and follow up with host link when no active giveaway', async () => {
      const interaction = makeInteraction({ sub: 'start' });
      const services = makeServices(null);
      await giveawayCmd.execute(interaction, services);
      expect(services.giveawayService.create).toHaveBeenCalledWith('g1', 'host1', 'My Giveaway', 'A Prize');
      expect(interaction.reply).toHaveBeenCalled();
      expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    });

    it('should reject start when a giveaway is already active', async () => {
      const interaction = makeInteraction({ sub: 'start' });
      const services = makeServices({ active: true });
      await giveawayCmd.execute(interaction, services);
      expect(services.giveawayService.create).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true, content: expect.stringContaining('already running') }));
    });
  });

  describe('end subcommand', () => {
    it('should reply with confirmation when giveaway is ended', async () => {
      const interaction = makeInteraction({ sub: 'end' });
      const services = makeServices({ active: true, title: 'My Giveaway', messageId: null, channelId: null });
      services.giveawayService.end.mockReturnValue({ active: false, title: 'My Giveaway', messageId: null, channelId: null });
      await giveawayCmd.execute(interaction, services);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ended') }));
    });

    it('should reply with error when no active giveaway to end', async () => {
      const interaction = makeInteraction({ sub: 'end' });
      const services = makeServices(null);
      services.giveawayService.end.mockReturnValue(null);
      await giveawayCmd.execute(interaction, services);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No active') }));
    });
  });
});
