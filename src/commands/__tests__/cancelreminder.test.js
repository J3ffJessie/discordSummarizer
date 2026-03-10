jest.mock('../../services/reminders', () => ({
  cancelReminderById: jest.fn(),
  cancelAllForUser: jest.fn(),
}));
jest.mock('discord.js', () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => ({
    setName: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    addStringOption: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({}),
  })),
}));

const reminders = require('../../services/reminders');
const command = require('../cancelreminder');

function makeInteraction({ userId = 'user1', id = '123' } = {}) {
  return {
    user: { id: userId },
    options: {
      getString: jest.fn(() => id),
    },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('/cancelreminder command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should cancel all reminders when id is "all"', async () => {
    reminders.cancelAllForUser.mockReturnValue(3);
    const interaction = makeInteraction({ id: 'all' });

    await command.execute(interaction);

    expect(reminders.cancelAllForUser).toHaveBeenCalledWith('user1');
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Canceled 3') })
    );
  });

  it('should cancel a specific reminder by ID when found', async () => {
    reminders.cancelReminderById.mockReturnValue(true);
    const interaction = makeInteraction({ id: '456' });

    await command.execute(interaction);

    expect(reminders.cancelReminderById).toHaveBeenCalledWith('user1', '456');
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('456') })
    );
  });

  it('should reply with error when reminder ID is not found', async () => {
    reminders.cancelReminderById.mockReturnValue(false);
    const interaction = makeInteraction({ id: 'notexist' });

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('No reminder found') })
    );
  });

  it('should handle "ALL" in uppercase as cancel-all', async () => {
    reminders.cancelAllForUser.mockReturnValue(0);
    const interaction = makeInteraction({ id: 'ALL' });

    await command.execute(interaction);

    expect(reminders.cancelAllForUser).toHaveBeenCalledWith('user1');
  });
});
