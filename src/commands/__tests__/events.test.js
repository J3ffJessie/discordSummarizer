jest.mock('../../services/events', () => ({
  fetchUpcomingEvents: jest.fn(),
}));
jest.mock('discord.js', () => ({
  SlashCommandBuilder: jest.fn().mockImplementation(() => ({
    setName: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({}),
  })),
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setURL: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    setTimestamp: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
    setImage: jest.fn().mockReturnThis(),
  })),
}));

const eventsService = require('../../services/events');
const command = require('../events');

const sampleEvent = {
  name: 'Test Event',
  fullUrl: 'https://lu.ma/test',
  description: 'A test event',
  startAt: new Date('2026-04-01T10:00:00Z').toISOString(),
  endAt: new Date('2026-04-01T12:00:00Z').toISOString(),
  timeZone: 'UTC',
  visibility: 'public',
  uploadedSocialCard: null,
};

function makeInteraction({ canDM = true } = {}) {
  return {
    user: {
      id: 'user1',
      send: canDM
        ? jest.fn().mockResolvedValue(undefined)
        : jest.fn().mockRejectedValue(new Error('Cannot DM')),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

describe('/events command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reply with "Check your DMs" immediately', async () => {
    eventsService.fetchUpcomingEvents.mockResolvedValue([sampleEvent]);
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('DMs'), ephemeral: true })
    );
  });

  it('should DM the user with event embeds when events exist', async () => {
    eventsService.fetchUpcomingEvents.mockResolvedValue([sampleEvent]);
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(interaction.user.send).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });

  it('should limit to 10 event embeds', async () => {
    const manyEvents = Array(15).fill(sampleEvent);
    eventsService.fetchUpcomingEvents.mockResolvedValue(manyEvents);
    const interaction = makeInteraction();

    await command.execute(interaction);

    const dmCall = interaction.user.send.mock.calls[0][0];
    expect(dmCall.embeds.length).toBeLessThanOrEqual(10);
  });

  it('should follow up with "No upcoming events" when list is empty', async () => {
    eventsService.fetchUpcomingEvents.mockResolvedValue([]);
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('No upcoming events') })
    );
    expect(interaction.user.send).not.toHaveBeenCalled();
  });

  it('should follow up with DM error message when DM fails', async () => {
    eventsService.fetchUpcomingEvents.mockResolvedValue([sampleEvent]);
    const interaction = makeInteraction({ canDM: false });

    await command.execute(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("couldn't send") })
    );
  });

  it('should follow up with error when fetchUpcomingEvents throws', async () => {
    eventsService.fetchUpcomingEvents.mockRejectedValue(new Error('Network error'));
    const interaction = makeInteraction();

    await command.execute(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Failed') })
    );
  });

  it('should truncate long descriptions to 200 characters', async () => {
    const longDesc = 'D'.repeat(300);
    const event = { ...sampleEvent, description: longDesc };
    eventsService.fetchUpcomingEvents.mockResolvedValue([event]);
    const interaction = makeInteraction();

    await command.execute(interaction);

    const { EmbedBuilder } = require('discord.js');
    const embedInstance = EmbedBuilder.mock.results[0]?.value;
    const descCall = embedInstance.setDescription.mock.calls[0][0];
    expect(descCall.length).toBeLessThanOrEqual(203); // 200 + '...'
  });
});
