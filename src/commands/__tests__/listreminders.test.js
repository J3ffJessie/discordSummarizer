jest.mock('../../services/reminders', () => ({
  listRemindersForUser: jest.fn(),
}));
jest.mock('discord.js', () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => ({
    setName: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({}),
  })),
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
  })),
}));

const reminders = require('../../services/reminders');
const command = require('../listreminders');

function makeInteraction({ userId = 'user1', username = 'Alice', canDM = true } = {}) {
  return {
    user: {
      id: userId,
      username,
      send: canDM
        ? jest.fn().mockResolvedValue(undefined)
        : jest.fn().mockRejectedValue(new Error('Cannot send DM')),
    },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('/listreminders command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reply with no reminders message when list is empty', async () => {
    reminders.listRemindersForUser.mockReturnValue([]);
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("don't have any pending"),
        ephemeral: true,
      })
    );
    expect(interaction.user.send).not.toHaveBeenCalled();
  });

  it('should DM the reminder list and confirm via reply', async () => {
    const userReminders = [
      { id: '1', msg: 'Buy groceries', time: Date.now() + 60000 },
      { id: '2', msg: 'Call dentist', time: Date.now() + 3600000 },
    ];
    reminders.listRemindersForUser.mockReturnValue(userReminders);
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(interaction.user.send).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('DMs') })
    );
  });

  it('should reply with error when DM fails', async () => {
    reminders.listRemindersForUser.mockReturnValue([
      { id: '1', msg: 'Test', time: Date.now() + 1000 },
    ]);
    const interaction = makeInteraction({ canDM: false });

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Couldn't DM") })
    );
  });

  it('should query reminders for the correct user', async () => {
    reminders.listRemindersForUser.mockReturnValue([]);
    const interaction = makeInteraction({ userId: 'user999' });

    await command.execute(interaction);

    expect(reminders.listRemindersForUser).toHaveBeenCalledWith('user999');
  });
});
