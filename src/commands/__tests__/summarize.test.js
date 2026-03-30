jest.mock('discord.js', () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => ({
    setName: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({}),
  })),
}));

const command = require('../summarize');

function makeMessages(count = 5) {
  const map = new Map();
  for (let i = 0; i < count; i++) {
    map.set(`msg${i}`, {
      createdTimestamp: i,
      content: `Message ${i}`,
      author: { username: `User${i}` },
      member: null,
    });
  }
  const sorted = {
    sort: jest.fn().mockReturnValue({
      map: jest.fn().mockReturnValue(
        Array.from(map.values()).map((m) => `User: ${m.content}`)
      ),
    }),
  };
  return { ...sorted, sort: sorted.sort };
}

function makeServices() {
  return {
    summarizationService: {
      summarizeMessages: jest.fn(),
    },
  };
}

function makeInteraction({ canDM = true } = {}) {
  const messages = makeMessages();
  return {
    guild: { id: 'guild1' },
    guildId: 'guild1',
    channel: {
      messages: {
        fetch: jest.fn().mockResolvedValue(messages),
      },
    },
    user: {
      id: 'user1',
      send: canDM
        ? jest.fn().mockResolvedValue(undefined)
        : jest.fn().mockRejectedValue(new Error('Cannot DM')),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('/summarize command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should defer the reply, fetch messages, and DM the summary', async () => {
    const services = makeServices();
    services.summarizationService.summarizeMessages.mockResolvedValue('• Point 1\n• Point 2');
    const interaction = makeInteraction();

    await command.execute(interaction, services);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.channel.messages.fetch).toHaveBeenCalledWith({ limit: 100 });
    expect(services.summarizationService.summarizeMessages).toHaveBeenCalledTimes(1);
    expect(interaction.user.send).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('DMs') })
    );
  });

  it('should split long summaries into chunks of 1900 chars', async () => {
    const services = makeServices();
    const longSummary = 'A'.repeat(4000);
    services.summarizationService.summarizeMessages.mockResolvedValue(longSummary);
    const interaction = makeInteraction();

    await command.execute(interaction, services);

    expect(interaction.user.send).toHaveBeenCalledTimes(Math.ceil(4000 / 1900));
  });

  it('should edit reply with error message when summarization throws', async () => {
    const services = makeServices();
    services.summarizationService.summarizeMessages.mockRejectedValue(new Error('API error'));
    const interaction = makeInteraction();

    await command.execute(interaction, services);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Failed') })
    );
  });
});
