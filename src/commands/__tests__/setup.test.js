jest.mock('node-cron', () => ({ validate: jest.fn().mockReturnValue(true) }));

const setupCmd = require('../setup');
const cron = require('node-cron');

function makeInteraction({ sub = 'view', guildId = 'g1', userId = 'u1', isAdmin = true, options = {} } = {}) {
  return {
    guildId,
    user: { id: userId },
    memberPermissions: { has: jest.fn().mockReturnValue(isAdmin) },
    options: {
      getSubcommand: jest.fn().mockReturnValue(sub),
      getChannel: jest.fn().mockReturnValue(options.channel || { id: 'ch1' }),
      getString: jest.fn((name) => options[name] || null),
      getBoolean: jest.fn((name) => options[name] ?? null),
      getInteger: jest.fn((name) => options[name] || null),
      getUser: jest.fn().mockReturnValue(options.user || { id: 'target1' }),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

function makeServices({ config = null, isStoredAdmin = false, adminIds = [] } = {}) {
  return {
    guildConfigService: {
      getConfig: jest.fn().mockReturnValue(config),
      upsertConfig: jest.fn().mockReturnValue(config || {}),
      isAdmin: jest.fn().mockReturnValue(isStoredAdmin),
      getAdminIds: jest.fn().mockReturnValue(adminIds),
      addAdmin: jest.fn().mockReturnValue(['target1']),
      removeAdmin: jest.fn().mockReturnValue([]),
      generateDashboardToken: jest.fn().mockReturnValue('tok123'),
    },
    schedulerService: { refreshGuild: jest.fn() },
  };
}

describe('/setup command', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should reply with error when used outside a server', async () => {
    const interaction = makeInteraction();
    interaction.guildId = null;
    await setupCmd.execute(interaction, makeServices());
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('server') }));
  });

  it('should deny non-admins', async () => {
    const interaction = makeInteraction({ isAdmin: false });
    await setupCmd.execute(interaction, makeServices({ isStoredAdmin: false }));
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Administrator') }));
  });

  describe('view subcommand', () => {
    it('should reply with config embed', async () => {
      const interaction = makeInteraction({ sub: 'view' });
      await setupCmd.execute(interaction, makeServices({ config: { summary_enabled: 1, summary_channel_id: 'ch1' } }));
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array), ephemeral: true }));
    });

    it('should show "no configuration" description for new guilds', async () => {
      const interaction = makeInteraction({ sub: 'view' });
      await setupCmd.execute(interaction, makeServices({ config: null }));
      expect(interaction.reply).toHaveBeenCalled();
    });
  });

  describe('summary subcommand', () => {
    it('should save channel and refresh scheduler', async () => {
      const interaction = makeInteraction({ sub: 'summary' });
      const services = makeServices();
      await setupCmd.execute(interaction, services);
      expect(services.guildConfigService.upsertConfig).toHaveBeenCalledWith('g1', expect.objectContaining({ summary_channel_id: 'ch1', summary_enabled: 1 }));
      expect(services.schedulerService.refreshGuild).toHaveBeenCalledWith('g1');
    });
  });

  describe('summary-disable subcommand', () => {
    it('should disable summary and refresh scheduler', async () => {
      const interaction = makeInteraction({ sub: 'summary-disable' });
      const services = makeServices();
      await setupCmd.execute(interaction, services);
      expect(services.guildConfigService.upsertConfig).toHaveBeenCalledWith('g1', { summary_enabled: 0 });
    });
  });

  describe('coffee subcommand', () => {
    it('should enable coffee pairing', async () => {
      const interaction = makeInteraction({ sub: 'coffee', options: { enabled: true } });
      const services = makeServices();
      await setupCmd.execute(interaction, services);
      expect(services.guildConfigService.upsertConfig).toHaveBeenCalledWith('g1', { coffee_enabled: 1 });
    });

    it('should disable coffee pairing', async () => {
      const interaction = makeInteraction({ sub: 'coffee', options: { enabled: false } });
      const services = makeServices();
      await setupCmd.execute(interaction, services);
      expect(services.guildConfigService.upsertConfig).toHaveBeenCalledWith('g1', { coffee_enabled: 0 });
    });
  });

  describe('summary-schedule subcommand', () => {
    it('should save valid cron expression', async () => {
      const interaction = makeInteraction({ sub: 'summary-schedule', options: { cron: '0 10 * * 1' } });
      const services = makeServices();
      await setupCmd.execute(interaction, services);
      expect(services.guildConfigService.upsertConfig).toHaveBeenCalledWith('g1', { summary_cron: '0 10 * * 1' });
    });

    it('should reject invalid cron expression', async () => {
      cron.validate.mockReturnValueOnce(false);
      const interaction = makeInteraction({ sub: 'summary-schedule', options: { cron: 'bad-cron' } });
      const services = makeServices();
      await setupCmd.execute(interaction, services);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Invalid cron') }));
      expect(services.guildConfigService.upsertConfig).not.toHaveBeenCalled();
    });
  });

  describe('timezone subcommand', () => {
    it('should save a valid IANA timezone', async () => {
      const interaction = makeInteraction({ sub: 'timezone', options: { tz: 'America/New_York' } });
      const services = makeServices();
      await setupCmd.execute(interaction, services);
      expect(services.guildConfigService.upsertConfig).toHaveBeenCalledWith('g1', { timezone: 'America/New_York' });
    });

    it('should reject an invalid timezone', async () => {
      const interaction = makeInteraction({ sub: 'timezone', options: { tz: 'NotReal/Zone' } });
      const services = makeServices();
      await setupCmd.execute(interaction, services);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Invalid timezone') }));
    });
  });

  describe('admin-add subcommand', () => {
    it('should add a bot admin and reply with embed', async () => {
      const interaction = makeInteraction({ sub: 'admin-add', options: { user: { id: 'target1' } } });
      interaction.user.id = 'u1'; // ensure not self
      const services = makeServices();
      await setupCmd.execute(interaction, services);
      expect(services.guildConfigService.addAdmin).toHaveBeenCalledWith('g1', 'target1');
    });

    it('should not allow modifying own admin status', async () => {
      const interaction = makeInteraction({ sub: 'admin-add', options: { user: { id: 'u1' } } });
      interaction.user.id = 'u1';
      const services = makeServices();
      await setupCmd.execute(interaction, services);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('cannot modify your own') }));
    });
  });

  describe('dashboard subcommand', () => {
    it('should reply with error when PUBLIC_URL is not set', async () => {
      delete process.env.PUBLIC_URL;
      delete process.env.CAPTION_URL;
      const interaction = makeInteraction({ sub: 'dashboard' });
      await setupCmd.execute(interaction, makeServices());
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('PUBLIC_URL') }));
    });

    it('should reply with dashboard link embed when PUBLIC_URL is set', async () => {
      process.env.PUBLIC_URL = 'https://mybot.example.com';
      const interaction = makeInteraction({ sub: 'dashboard' });
      await setupCmd.execute(interaction, makeServices());
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
      delete process.env.PUBLIC_URL;
    });
  });

  describe('ai subcommand', () => {
    it('should reject when no options provided', async () => {
      const interaction = makeInteraction({ sub: 'ai', options: { service: 'summarization' } });
      await setupCmd.execute(interaction, makeServices());
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('at least one option') }));
    });

    it('should save AI settings and reply with embed', async () => {
      const interaction = makeInteraction({ sub: 'ai', options: { service: 'summarization', provider: 'groq', model: 'llama3' } });
      const services = makeServices();
      await setupCmd.execute(interaction, services);
      expect(services.guildConfigService.upsertConfig).toHaveBeenCalledWith('g1', expect.objectContaining({ summ_provider: 'groq', summ_model: 'llama3' }));
    });
  });
});
