jest.mock('discord.js', () => ({
  ChannelType: { GuildText: 0 },
}));

const { gatherServerConversationsAndSummarize } = require('../gather');

function makeChannel({ name = 'general', viewable = true, type = 0, messages = [] } = {}) {
  return {
    type,
    viewable,
    name,
    messages: {
      fetch: jest.fn().mockResolvedValue({
        sort: jest.fn().mockReturnValue({ map: jest.fn().mockReturnValue(messages) }),
      }),
    },
  };
}

function makeGuild(channels = []) {
  return {
    channels: {
      cache: {
        values: jest.fn().mockReturnValue(channels[Symbol.iterator]()),
      },
    },
  };
}

function makeSummarizationService() {
  return {
    summarizeMessages: jest.fn(),
    serverSummarize: jest.fn(),
  };
}

describe('gatherServerConversationsAndSummarize', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call serverSummarize when useServerSummarize=true', async () => {
    const summarizationService = makeSummarizationService();
    summarizationService.serverSummarize.mockResolvedValue('Server summary result');

    const channel = makeChannel({ messages: ['[general] Alice: hi'] });
    const guild = makeGuild([channel]);

    const result = await gatherServerConversationsAndSummarize(guild, true, { summarizationService });

    expect(summarizationService.serverSummarize).toHaveBeenCalledTimes(1);
    expect(summarizationService.summarizeMessages).not.toHaveBeenCalled();
    expect(result).toBe('Server summary result');
  });

  it('should call summarizeMessages when useServerSummarize=false', async () => {
    const summarizationService = makeSummarizationService();
    summarizationService.summarizeMessages.mockResolvedValue('General summary result');

    const channel = makeChannel({ messages: ['[general] Bob: hello'] });
    const guild = makeGuild([channel]);

    const result = await gatherServerConversationsAndSummarize(guild, false, { summarizationService });

    expect(summarizationService.summarizeMessages).toHaveBeenCalledTimes(1);
    expect(summarizationService.serverSummarize).not.toHaveBeenCalled();
    expect(result).toBe('General summary result');
  });

  it('should default to summarizeMessages when useServerSummarize is not provided', async () => {
    const summarizationService = makeSummarizationService();
    summarizationService.summarizeMessages.mockResolvedValue('Default summary');

    const channel = makeChannel({ messages: [] });
    const guild = makeGuild([channel]);

    await gatherServerConversationsAndSummarize(guild, false, { summarizationService });

    expect(summarizationService.summarizeMessages).toHaveBeenCalledTimes(1);
  });

  it('should skip channels that are not GuildText type', async () => {
    const summarizationService = makeSummarizationService();
    summarizationService.serverSummarize.mockResolvedValue('summary');

    const voiceChannel = makeChannel({ type: 2, viewable: true });
    const guild = makeGuild([voiceChannel]);

    await gatherServerConversationsAndSummarize(guild, true, { summarizationService });

    expect(voiceChannel.messages.fetch).not.toHaveBeenCalled();
  });

  it('should skip channels that are not viewable', async () => {
    const summarizationService = makeSummarizationService();
    summarizationService.serverSummarize.mockResolvedValue('summary');

    const hiddenChannel = makeChannel({ viewable: false, type: 0 });
    const guild = makeGuild([hiddenChannel]);

    await gatherServerConversationsAndSummarize(guild, true, { summarizationService });

    expect(hiddenChannel.messages.fetch).not.toHaveBeenCalled();
  });

  it('should gracefully skip channels that throw on fetch', async () => {
    const summarizationService = makeSummarizationService();
    summarizationService.summarizeMessages.mockResolvedValue('partial summary');

    const badChannel = {
      type: 0,
      viewable: true,
      name: 'broken',
      messages: { fetch: jest.fn().mockRejectedValue(new Error('Missing Access')) },
    };
    const goodChannel = makeChannel({ messages: ['[good] Alice: hello'] });
    const guild = makeGuild([badChannel, goodChannel]);

    await expect(gatherServerConversationsAndSummarize(guild, false, { summarizationService })).resolves.toBeDefined();
  });

  it('should truncate combined messages to 16000 chars before summarizing', async () => {
    const summarizationService = makeSummarizationService();
    summarizationService.serverSummarize.mockResolvedValue('truncated summary');

    const longMsg = 'x'.repeat(200);
    const messages = Array(100).fill(`[ch] User: ${longMsg}`);
    const channel = makeChannel({ messages });
    const guild = makeGuild([channel]);

    await gatherServerConversationsAndSummarize(guild, true, { summarizationService });

    const calledWith = summarizationService.serverSummarize.mock.calls[0][0];
    expect(calledWith.length).toBeLessThanOrEqual(16000);
  });
});
