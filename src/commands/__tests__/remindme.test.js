jest.mock('../../services/reminders', () => ({
  parseTime: jest.fn(),
  addReminderSafely: jest.fn(),
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
const command = require('../remindme');

function makeInteraction({ userId = 'user1', time = '30m', message = 'Take a break' } = {}) {
  return {
    user: { id: userId },
    options: {
      getString: jest.fn((key) => (key === 'time' ? time : message)),
    },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('/remindme command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reply with error for invalid time format', async () => {
    reminders.parseTime.mockReturnValue(null);
    const interaction = makeInteraction({ time: 'badtime' });

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Invalid time format.', ephemeral: true })
    );
    expect(reminders.addReminderSafely).not.toHaveBeenCalled();
  });

  it('should create a reminder and reply with confirmation', async () => {
    reminders.parseTime.mockReturnValue(1800000); // 30 minutes
    reminders.addReminderSafely.mockResolvedValue({ created: true });
    const interaction = makeInteraction({ time: '30m', message: 'Stand up' });

    await command.execute(interaction);

    expect(reminders.addReminderSafely).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user1', msg: 'Stand up' })
    );
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Reminder set'), ephemeral: true })
    );
  });

  it('should warn when a duplicate reminder already exists', async () => {
    reminders.parseTime.mockReturnValue(1800000);
    reminders.addReminderSafely.mockResolvedValue({ created: false, existing: { id: '123' } });
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('already exists') })
    );
  });

  it('should reply with error when addReminderSafely throws', async () => {
    reminders.parseTime.mockReturnValue(1800000);
    reminders.addReminderSafely.mockRejectedValue(new Error('lock error'));
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Failed') })
    );
  });

  it('should set the reminder time in the future', async () => {
    const before = Date.now();
    reminders.parseTime.mockReturnValue(60000); // 1 minute
    reminders.addReminderSafely.mockResolvedValue({ created: true });
    const interaction = makeInteraction({ time: '1m', message: 'Test' });

    await command.execute(interaction);

    const callArg = reminders.addReminderSafely.mock.calls[0][0];
    expect(callArg.time).toBeGreaterThan(before);
  });
});
