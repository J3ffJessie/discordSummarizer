jest.mock('../../services/coffee', () => ({
  runCoffeePairing: jest.fn(),
}));
jest.mock('discord.js', () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => ({
    setName: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({}),
  })),
}));

const coffeeService = require('../../services/coffee');
const command = require('../coffee-pair');

function makeInteraction({ userId = 'user1', guildId = 'guild1' } = {}) {
  return {
    user: { id: userId },
    guild: { id: guildId },
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

describe('/coffee-pair command', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should deny non-allowed users when ALLOWED_USER_IDS is set', async () => {
    process.env.ALLOWED_USER_IDS = 'admin1,admin2';
    const interaction = makeInteraction({ userId: 'notadmin' });

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringContaining("permission") })
    );
    expect(coffeeService.runCoffeePairing).not.toHaveBeenCalled();
  });

  it('should allow any user when ALLOWED_USER_IDS is empty', async () => {
    process.env.ALLOWED_USER_IDS = '';
    coffeeService.runCoffeePairing.mockResolvedValue([{ pair: ['Alice', 'Bob'] }]);
    const interaction = makeInteraction({ userId: 'anyone' });

    await command.execute(interaction);

    expect(coffeeService.runCoffeePairing).toHaveBeenCalledWith(interaction.guild);
  });

  it('should allow listed users to run the command', async () => {
    process.env.ALLOWED_USER_IDS = 'admin1';
    coffeeService.runCoffeePairing.mockResolvedValue([{ pair: ['Alice', 'Bob'] }]);
    const interaction = makeInteraction({ userId: 'admin1' });

    await command.execute(interaction);

    expect(coffeeService.runCoffeePairing).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Paired') })
    );
  });

  it('should follow up with warning when no pairings are created', async () => {
    process.env.ALLOWED_USER_IDS = '';
    coffeeService.runCoffeePairing.mockResolvedValue([]);
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('No pairings') })
    );
  });

  it('should follow up with error message when runCoffeePairing throws', async () => {
    process.env.ALLOWED_USER_IDS = '';
    coffeeService.runCoffeePairing.mockRejectedValue(new Error('pairing error'));
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Failed') })
    );
  });
});
