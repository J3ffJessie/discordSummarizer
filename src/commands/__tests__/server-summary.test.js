jest.mock('../../services/gather', () => ({
  gatherServerConversationsAndSummarize: jest.fn(),
}));
jest.mock('discord.js', () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => ({
    setName: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setDefaultMemberPermissions: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({}),
  })),
  PermissionFlagsBits: { Administrator: 8n },
}));

const gather = require('../../services/gather');
const command = require('../server-summary');

const TARGET_CHANNEL_ID = 'channel123';

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

function makeServices() {
  return {
    summarizationService: { summarizeMessages: jest.fn(), serverSummarize: jest.fn() },
    guildConfigService: {
      getConfig: jest.fn().mockResolvedValue({ summary_channel_id: TARGET_CHANNEL_ID }),
    },
  };
}

function makeInteraction({ userId = 'admin1', guildFound = true } = {}) {
  const guild = makeGuild({ channelFound: guildFound });
  return {
    user: { id: userId },
    guild,
    guildId: 'guild1',
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

describe('/server command (server-summary)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, TARGET_CHANNEL_ID };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should call gather when executed', async () => {
    gather.gatherServerConversationsAndSummarize.mockResolvedValue('Summary text');
    const interaction = makeInteraction();

    await command.execute(interaction, makeServices());

    expect(gather.gatherServerConversationsAndSummarize).toHaveBeenCalled();
  });

  it('should send the summary to the target channel in chunks', async () => {
    const summary = 'Line 1\nLine 2';
    gather.gatherServerConversationsAndSummarize.mockResolvedValue(summary);
    const interaction = makeInteraction();

    await command.execute(interaction, makeServices());

    const channel = interaction.guild._channel;
    expect(channel.send).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('summary sent') })
    );
  });

  it('should follow up with error when channel is not found', async () => {
    gather.gatherServerConversationsAndSummarize.mockResolvedValue('Summary');
    const interaction = makeInteraction({ guildFound: false });
    interaction.guild.channels.cache.get.mockReturnValue(undefined);
    interaction.guild.channels.fetch = jest.fn().mockResolvedValue(null);

    await command.execute(interaction, makeServices());

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Could not find') })
    );
  });

  it('should follow up with error when gather throws', async () => {
    gather.gatherServerConversationsAndSummarize.mockRejectedValue(new Error('gather error'));
    const interaction = makeInteraction();

    await command.execute(interaction, makeServices());

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Error') })
    );
  });
});
