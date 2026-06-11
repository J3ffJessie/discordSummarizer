jest.mock('fs');
jest.mock('../../../locations', () => ({
  findLocation: jest.fn(),
}));

const locationCmd = require('../location');
const { findLocation } = require('../../../locations');
const fs = require('fs');

function makeInteraction(messages = [], limit = 100) {
  const msgMap = new Map(messages.map((m, i) => [String(i), m]));
  return {
    options: {
      getInteger: jest.fn().mockReturnValue(limit),
    },
    channel: {
      messages: { fetch: jest.fn().mockResolvedValue(msgMap) },
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('/location command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync = jest.fn().mockReturnValue(false);
    fs.readFileSync = jest.fn().mockReturnValue('');
    fs.appendFileSync = jest.fn();
  });

  it('should defer reply and confirm completion', async () => {
    findLocation.mockReturnValue(null);
    const interaction = makeInteraction([{ content: 'hello', author: { username: 'alice' }, member: null }]);
    await locationCmd.execute(interaction);
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('summarized') }));
  });

  it('should log new locations found in messages', async () => {
    findLocation.mockReturnValue({ matchFound: true, type: 'city', name: 'Paris', city: 'Paris' });
    const interaction = makeInteraction([{ content: 'I am in Paris', author: { username: 'bob' }, member: { displayName: 'Bob' } }]);
    await locationCmd.execute(interaction);
    expect(fs.appendFileSync).toHaveBeenCalled();
  });

  it('should not log location for "Chat Summary" user', async () => {
    findLocation.mockReturnValue({ matchFound: true, type: 'city', name: 'Paris' });
    const interaction = makeInteraction([{
      content: 'Chat Summary of Paris',
      author: { username: 'Chat Summary' },
      member: { displayName: 'Chat Summary' },
    }]);
    await locationCmd.execute(interaction);
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });

  it('should not log location for already-logged user', async () => {
    findLocation.mockReturnValue({ matchFound: true, type: 'city', name: 'London' });
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ type: 'city', name: 'London', user: 'alice' }) + '\n');
    const interaction = makeInteraction([{ content: 'I am in London', author: { username: 'alice' }, member: { displayName: 'alice' } }]);
    await locationCmd.execute(interaction);
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });

  it('should clamp limit between 1 and 100', async () => {
    findLocation.mockReturnValue(null);
    const interaction = makeInteraction([], 200);
    await locationCmd.execute(interaction);
    expect(interaction.channel.messages.fetch).toHaveBeenCalledWith({ limit: 100 });
  });
});
