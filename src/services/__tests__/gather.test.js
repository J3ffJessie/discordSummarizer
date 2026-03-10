const { ChannelType } = require('discord.js');

jest.mock('discord.js', () => ({
  ChannelType: { GuildText: 0 },
}));
jest.mock('../groq', () => ({
  summarizeMessages: jest.fn(),
  serverSummarize: jest.fn(),
}));

const groq = require('../groq');
const { gatherServerConversationsAndSummarize } = require('../gather');

// Build a mock text channel
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

// Build a mock guild
function makeGuild(channels = []) {
  return {
    channels: {
      cache: {
        values: jest.fn().mockReturnValue(channels[Symbol.iterator]()),
      },
    },
  };
}

describe('gatherServerConversationsAndSummarize', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call serverSummarize when useServerSummarize=true', async () => {
    groq.serverSummarize.mockResolvedValue('Server summary result');

    const channel = makeChannel({ messages: ['[general] Alice: hi'] });
    const guild = makeGuild([channel]);

    const result = await gatherServerConversationsAndSummarize(guild, true);

    expect(groq.serverSummarize).toHaveBeenCalledTimes(1);
    expect(groq.summarizeMessages).not.toHaveBeenCalled();
    expect(result).toBe('Server summary result');
  });

  it('should call summarizeMessages when useServerSummarize=false', async () => {
    groq.summarizeMessages.mockResolvedValue('General summary result');

    const channel = makeChannel({ messages: ['[general] Bob: hello'] });
    const guild = makeGuild([channel]);

    const result = await gatherServerConversationsAndSummarize(guild, false);

    expect(groq.summarizeMessages).toHaveBeenCalledTimes(1);
    expect(groq.serverSummarize).not.toHaveBeenCalled();
    expect(result).toBe('General summary result');
  });

  it('should default to summarizeMessages when useServerSummarize is not provided', async () => {
    groq.summarizeMessages.mockResolvedValue('Default summary');

    const channel = makeChannel({ messages: [] });
    const guild = makeGuild([channel]);

    await gatherServerConversationsAndSummarize(guild);

    expect(groq.summarizeMessages).toHaveBeenCalledTimes(1);
  });

  it('should skip channels that are not GuildText type', async () => {
    groq.serverSummarize.mockResolvedValue('summary');

    const voiceChannel = makeChannel({ type: 2, viewable: true }); // not GuildText
    const guild = makeGuild([voiceChannel]);

    await gatherServerConversationsAndSummarize(guild, true);

    // channel.messages.fetch should not be called for non-text channels
    expect(voiceChannel.messages.fetch).not.toHaveBeenCalled();
  });

  it('should skip channels that are not viewable', async () => {
    groq.serverSummarize.mockResolvedValue('summary');

    const hiddenChannel = makeChannel({ viewable: false, type: 0 });
    const guild = makeGuild([hiddenChannel]);

    await gatherServerConversationsAndSummarize(guild, true);

    expect(hiddenChannel.messages.fetch).not.toHaveBeenCalled();
  });

  it('should gracefully skip channels that throw on fetch', async () => {
    groq.summarizeMessages.mockResolvedValue('partial summary');

    const badChannel = {
      type: 0,
      viewable: true,
      name: 'broken',
      messages: { fetch: jest.fn().mockRejectedValue(new Error('Missing Access')) },
    };
    const goodChannel = makeChannel({ messages: ['[good] Alice: hello'] });
    const guild = makeGuild([badChannel, goodChannel]);

    // Should not throw
    await expect(gatherServerConversationsAndSummarize(guild, false)).resolves.toBeDefined();
  });

  it('should truncate combined messages to 16000 chars before summarizing', async () => {
    groq.serverSummarize.mockResolvedValue('truncated summary');

    // Create a long message array
    const longMsg = 'x'.repeat(200);
    const messages = Array(100).fill(`[ch] User: ${longMsg}`);
    const channel = makeChannel({ messages });
    const guild = makeGuild([channel]);

    await gatherServerConversationsAndSummarize(guild, true);

    const calledWith = groq.serverSummarize.mock.calls[0][0];
    expect(calledWith.length).toBeLessThanOrEqual(16000);
  });
});
