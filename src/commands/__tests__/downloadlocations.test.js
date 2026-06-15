jest.mock('fs');

const downloadCmd = require('../downloadlocations');
const fs = require('fs');

function makeInteraction() {
  return {
    user: { send: jest.fn().mockResolvedValue(undefined) },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('/downloadlocations command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync = jest.fn();
    fs.readFileSync = jest.fn();
    fs.writeFileSync = jest.fn();
    fs.unlinkSync = jest.fn();
  });

  it('should reply with "No log file" when file does not exist', async () => {
    fs.existsSync.mockReturnValue(false);
    const interaction = makeInteraction();
    await downloadCmd.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No log file') }));
    expect(interaction.user.send).not.toHaveBeenCalled();
  });

  it('should DM sorted locations and reply with confirmation', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ type: 'city', name: 'Paris' }) + '\n' +
      JSON.stringify({ type: 'country', name: 'France' }) + '\n' +
      JSON.stringify({ type: 'city', name: 'London' }) + '\n'
    );
    const interaction = makeInteraction();
    await downloadCmd.execute(interaction);
    expect(interaction.user.send).toHaveBeenCalled();
    expect(fs.unlinkSync).toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('DMs') }));
  });

  it('should reply with DM error when send fails', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ type: 'city', name: 'Paris' }) + '\n');
    const interaction = makeInteraction();
    interaction.user.send.mockRejectedValue(new Error('Cannot DM'));
    await downloadCmd.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Failed') }));
  });

  it('should sort cities and countries alphabetically', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ type: 'city', name: 'Zurich' }) + '\n' +
      JSON.stringify({ type: 'city', name: 'Amsterdam' }) + '\n'
    );
    const interaction = makeInteraction();
    await downloadCmd.execute(interaction);
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.cities[0]).toBe('Amsterdam');
    expect(written.cities[1]).toBe('Zurich');
  });

  it('should deduplicate repeated locations', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ type: 'city', name: 'Paris' }) + '\n' +
      JSON.stringify({ type: 'city', name: 'Paris' }) + '\n'
    );
    const interaction = makeInteraction();
    await downloadCmd.execute(interaction);
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.cities.filter(c => c === 'Paris')).toHaveLength(1);
  });
});
