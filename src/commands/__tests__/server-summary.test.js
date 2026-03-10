jest.mock('../../services/gather', () => ({
  gatherServerConversationsAndSummarize: jest.fn(),
}));
jest.mock('discord.js', () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => ({
    setName: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({}),
  })),
}));

const gather = require('../../services/gather');
const command = require('../server-summary');

function makeChannel() {
  return {
    send: jest.fn().mockResolvedValue(undefined),
  };
}

function makeGuild({ channelFound = true } = {}) {
  const channel = makeChannel();
  return {
    id: 'guild1',
    channels: {
      cache: {
        get: jest.fn(() => (channelFound ? channel : undefined)),
      },
      fetch: jest.fn().mockResolvedValue(channelFound ? channel : null),
    },
    _channel: channel,
  };
}

function makeInteraction({ userId = 'admin1', guildFound = true } = {}) {
  const guild = makeGuild({ channelFound: guildFound });
  return {
    user: { id: userId },
    guild,
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

describe('/server command (server-summary)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should deny non-allowed users when ALLOWED_USER_IDS is set', async () => {
    process.env.ALLOWED_USER_IDS = 'admin1';
    const interaction = makeInteraction({ userId: 'notadmin' });

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('permission'), ephemeral: true })
    );
    expect(gather.gatherServerConversationsAndSummarize).not.toHaveBeenCalled();
  });

  it('should allow any user when ALLOWED_USER_IDS is empty', async () => {
    process.env.ALLOWED_USER_IDS = '';
    gather.gatherServerConversationsAndSummarize.mockResolvedValue('Summary text');
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(gather.gatherServerConversationsAndSummarize).toHaveBeenCalled();
  });

  it('should send the summary to the target channel in chunks', async () => {
    process.env.ALLOWED_USER_IDS = '';
    const summary = 'Line 1\nLine 2';
    gather.gatherServerConversationsAndSummarize.mockResolvedValue(summary);
    const interaction = makeInteraction();

    await command.execute(interaction);

    const channel = interaction.guild._channel;
    expect(channel.send).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('summary sent') })
    );
  });

  it('should follow up with error when channel is not found', async () => {
    process.env.ALLOWED_USER_IDS = '';
    gather.gatherServerConversationsAndSummarize.mockResolvedValue('Summary');
    const interaction = makeInteraction({ guildFound: false });
    // Also mock the fetch to fail
    interaction.guild.channels.cache.get.mockReturnValue(undefined);
    interaction.guild.channels.fetch = jest.fn().mockResolvedValue(null);

    await command.execute(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Could not find') })
    );
  });

  it('should follow up with error when gather throws', async () => {
    process.env.ALLOWED_USER_IDS = '';
    gather.gatherServerConversationsAndSummarize.mockRejectedValue(new Error('gather error'));
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Error') })
    );
  });
});
