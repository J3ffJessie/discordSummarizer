jest.mock('../../services/coffee', () => ({
  getMembersWithCoffeeRole: jest.fn(),
}));

const coffeeListCmd = require('../coffee-list');
const coffeeService = require('../../services/coffee');

function makeInteraction() {
  return {
    guild: { id: 'g1' },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('/coffee-list command', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should defer reply and show member count', async () => {
    coffeeService.getMembersWithCoffeeRole.mockResolvedValue([
      { user: { username: 'alice', discriminator: '0001' } },
      { user: { username: 'bob', discriminator: '0002' } },
    ]);
    const interaction = makeInteraction();
    await coffeeListCmd.execute(interaction);
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalled();
    const content = interaction.editReply.mock.calls[0][0].content;
    expect(content).toContain('2');
    expect(content).toContain('alice');
  });

  it('should show "(No members found)" when list is empty', async () => {
    coffeeService.getMembersWithCoffeeRole.mockResolvedValue([]);
    const interaction = makeInteraction();
    await coffeeListCmd.execute(interaction);
    const content = interaction.editReply.mock.calls[0][0].content;
    expect(content).toContain('No members found');
  });

  it('should reply with error message when service throws', async () => {
    coffeeService.getMembersWithCoffeeRole.mockRejectedValue(new Error('DB error'));
    const interaction = makeInteraction();
    await coffeeListCmd.execute(interaction);
    const content = interaction.editReply.mock.calls[0][0].content;
    expect(content).toContain('Failed');
  });

  it('should have correct command name', () => {
    expect(coffeeListCmd.data.name).toBe('coffee-list');
  });
});
