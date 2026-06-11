jest.mock('../../services/coffee', () => ({
  runCoffeePairing: jest.fn(),
}));

const paircoffeeCmd = require('../paircoffee');
const coffeeService = require('../../services/coffee');

function makeInteraction(guildId = 'g1') {
  return {
    guildId,
    guild: { id: guildId },
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

function makeServices(config = null) {
  return {
    guildConfigService: { getConfig: jest.fn().mockReturnValue(config) },
    profileService: {},
  };
}

describe('/paircoffee command', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should reply with running message and follow up with pair count', async () => {
    coffeeService.runCoffeePairing.mockResolvedValue([['u1', 'u2'], ['u3', 'u4']]);
    const interaction = makeInteraction();
    await paircoffeeCmd.execute(interaction, makeServices());
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Running') }));
    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('2') }));
  });

  it('should warn when no pairings were created', async () => {
    coffeeService.runCoffeePairing.mockResolvedValue([]);
    const interaction = makeInteraction();
    await paircoffeeCmd.execute(interaction, makeServices());
    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No pairings') }));
  });

  it('should warn when pairing returns null', async () => {
    coffeeService.runCoffeePairing.mockResolvedValue(null);
    const interaction = makeInteraction();
    await paircoffeeCmd.execute(interaction, makeServices());
    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No pairings') }));
  });

  it('should follow up with error message when service throws', async () => {
    coffeeService.runCoffeePairing.mockRejectedValue(new Error('Boom'));
    const interaction = makeInteraction();
    await paircoffeeCmd.execute(interaction, makeServices());
    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Failed') }));
  });

  it('should pass coffee_channel_id from config', async () => {
    coffeeService.runCoffeePairing.mockResolvedValue([]);
    const interaction = makeInteraction();
    await paircoffeeCmd.execute(interaction, makeServices({ coffee_channel_id: 'ch99' }));
    const call = coffeeService.runCoffeePairing.mock.calls[0];
    expect(call[2]).toBe('manual');
    expect(call[3]).toBe('ch99');
  });
});
