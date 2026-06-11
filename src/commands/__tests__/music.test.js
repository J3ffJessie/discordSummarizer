const musicCmd = require('../music');

function makeInteraction({ sub = 'status', guildId = 'g1', userId = 'u1', isAdmin = true, channel = null } = {}) {
  return {
    guildId,
    user: { id: userId },
    memberPermissions: { has: jest.fn().mockReturnValue(isAdmin) },
    options: {
      getSubcommand: jest.fn().mockReturnValue(sub),
      getChannel: jest.fn().mockReturnValue(channel || { id: 'ch1' }),
      getString: jest.fn().mockReturnValue(null),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
  };
}

function makeServices({ config = {}, authUrl = 'http://auth.url', isStoredAdmin = false } = {}) {
  return {
    guildConfigService: {
      getConfig: jest.fn().mockReturnValue(config),
      upsertConfig: jest.fn(),
      isAdmin: jest.fn().mockReturnValue(isStoredAdmin),
    },
    musicService: {
      generateYoutubeAuthUrl: jest.fn().mockReturnValue(authUrl),
    },
  };
}

describe('/music command', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should reply with error if not inside a server', async () => {
    const interaction = makeInteraction();
    interaction.guildId = null;
    await musicCmd.execute(interaction, makeServices());
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('server') }));
  });

  it('should deny non-admins', async () => {
    const interaction = makeInteraction({ isAdmin: false });
    await musicCmd.execute(interaction, makeServices({ isStoredAdmin: false }));
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Administrator') }));
  });

  describe('setup subcommand', () => {
    it('should save channel config and reply with embed', async () => {
      const interaction = makeInteraction({ sub: 'setup' });
      const services = makeServices();
      await musicCmd.execute(interaction, services);
      expect(services.guildConfigService.upsertConfig).toHaveBeenCalledWith('g1', expect.objectContaining({ music_channel_id: 'ch1' }));
      expect(interaction.editReply).toHaveBeenCalled();
    });
  });

  describe('auth subcommand', () => {
    it('should reply with error when PUBLIC_URL is not set', async () => {
      delete process.env.PUBLIC_URL;
      const interaction = makeInteraction({ sub: 'auth' });
      const services = makeServices({ config: { google_client_id: 'id', google_client_secret: 'sec' } });
      await musicCmd.execute(interaction, services);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('PUBLIC_URL') }));
    });

    it('should reply with error when Google credentials are missing', async () => {
      process.env.PUBLIC_URL = 'https://mybot.example.com';
      const interaction = makeInteraction({ sub: 'auth' });
      const services = makeServices({ config: {} });
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      await musicCmd.execute(interaction, services);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('credentials') }));
      delete process.env.PUBLIC_URL;
    });

    it('should reply with auth embed when credentials are available', async () => {
      process.env.PUBLIC_URL = 'https://mybot.example.com';
      process.env.GOOGLE_CLIENT_ID = 'client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
      const interaction = makeInteraction({ sub: 'auth' });
      const services = makeServices({ config: { google_client_id: 'id', google_client_secret: 'sec' } });
      await musicCmd.execute(interaction, services);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
      delete process.env.PUBLIC_URL;
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
    });
  });

  describe('reset subcommand', () => {
    it('should clear youtube_playlist_id and reply with embed', async () => {
      const interaction = makeInteraction({ sub: 'reset' });
      const services = makeServices();
      await musicCmd.execute(interaction, services);
      expect(services.guildConfigService.upsertConfig).toHaveBeenCalledWith('g1', { youtube_playlist_id: null });
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
    });
  });

  describe('status subcommand', () => {
    it('should reply with status embed showing not authenticated', async () => {
      const interaction = makeInteraction({ sub: 'status' });
      const services = makeServices({ config: {} });
      await musicCmd.execute(interaction, services);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
    });

    it('should show authenticated status when youtube_access_token is present', async () => {
      const interaction = makeInteraction({ sub: 'status' });
      const services = makeServices({ config: { youtube_access_token: 'tok', youtube_refresh_token: 'ref', music_enabled: 1, music_channel_id: 'ch1' } });
      await musicCmd.execute(interaction, services);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
    });
  });
});
