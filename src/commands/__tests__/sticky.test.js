const stickyCmd = require('../sticky');

function makeInteraction({ sub = 'set', content = 'Hello!', isAdmin = true, channelId = 'ch1', guildId = 'g1', userId = 'u1', existingMsg = null } = {}) {
  return {
    guildId,
    channelId,
    user: { id: userId },
    memberPermissions: { has: jest.fn().mockReturnValue(isAdmin) },
    options: {
      getSubcommand: jest.fn().mockReturnValue(sub),
      getString: jest.fn().mockReturnValue(content),
    },
    channel: {
      send: jest.fn().mockResolvedValue({ id: 'new-msg' }),
      messages: {
        fetch: jest.fn().mockResolvedValue(existingMsg || { delete: jest.fn().mockResolvedValue(undefined) }),
      },
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    showModal: jest.fn().mockResolvedValue(undefined),
  };
}

function makeServices({ sticky = null, isStoredAdmin = false } = {}) {
  return {
    stickyService: {
      getSticky: jest.fn().mockReturnValue(sticky),
      setSticky: jest.fn(),
      removeSticky: jest.fn(),
    },
    guildConfigService: {
      isAdmin: jest.fn().mockReturnValue(isStoredAdmin),
    },
  };
}

describe('/sticky command', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should deny non-admins', async () => {
    const interaction = makeInteraction({ isAdmin: false });
    const services = makeServices({ isStoredAdmin: false });
    await stickyCmd.execute(interaction, services);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Administrator') }));
    expect(services.stickyService.setSticky).not.toHaveBeenCalled();
  });

  describe('set subcommand', () => {
    // "set" only opens the modal that collects the sticky text — the actual save/send/delete
    // happens in interactionCreate.js's modal-submit handler once the user submits it.
    it('should show the sticky modal', async () => {
      const interaction = makeInteraction({ sub: 'set' });
      const services = makeServices();
      await stickyCmd.execute(interaction, services);

      expect(interaction.showModal).toHaveBeenCalledTimes(1);
      const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
      expect(modalJson.custom_id).toBe(stickyCmd.MODAL_ID);
      expect(services.stickyService.setSticky).not.toHaveBeenCalled();
    });

    it('should pre-fill the modal with the existing sticky content when one is set', async () => {
      const interaction = makeInteraction({ sub: 'set' });
      const services = makeServices({ sticky: { content: 'Old sticky text', message_id: 'old-msg' } });
      await stickyCmd.execute(interaction, services);

      const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
      const contentInput = modalJson.components[0].components[0];
      expect(contentInput.value).toBe('Old sticky text');
    });

    it('should leave the modal input blank when no sticky is set yet', async () => {
      const interaction = makeInteraction({ sub: 'set' });
      const services = makeServices({ sticky: null });
      await stickyCmd.execute(interaction, services);

      const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
      const contentInput = modalJson.components[0].components[0];
      expect(contentInput.value).toBeUndefined();
    });
  });

  describe('remove subcommand', () => {
    it('should reply with error when no sticky is set', async () => {
      const interaction = makeInteraction({ sub: 'remove' });
      const services = makeServices({ sticky: null });
      await stickyCmd.execute(interaction, services);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No sticky') }));
    });

    it('should remove the sticky and reply with confirmation', async () => {
      const interaction = makeInteraction({ sub: 'remove' });
      const services = makeServices({ sticky: { message_id: null, content: 'Old sticky' } });
      await stickyCmd.execute(interaction, services);
      expect(services.stickyService.removeSticky).toHaveBeenCalledWith('ch1');
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('removed') }));
    });
  });

  describe('view subcommand', () => {
    it('should reply with error when no sticky is set', async () => {
      const interaction = makeInteraction({ sub: 'view' });
      const services = makeServices({ sticky: null });
      await stickyCmd.execute(interaction, services);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No sticky') }));
    });

    it('should reply with embed showing the sticky content', async () => {
      const interaction = makeInteraction({ sub: 'view' });
      const services = makeServices({ sticky: { content: 'Hello world', created_by: 'u1', message_id: 'msg1' } });
      await stickyCmd.execute(interaction, services);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
    });
  });
});
