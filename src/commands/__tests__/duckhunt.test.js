const duckhuntCmd = require('../duckhunt');

function makeInteraction({ sub = 'play', launchFails = false } = {}) {
  return {
    guildId: 'g1',
    user: { id: 'u1' },
    options: { getSubcommand: jest.fn().mockReturnValue(sub) },
    launchActivity: launchFails
      ? jest.fn().mockRejectedValue(new Error('Activities not enabled'))
      : jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

function makeServices(leaderboard = []) {
  return {
    duckHuntService: { getLeaderboard: jest.fn().mockReturnValue(leaderboard) },
  };
}

describe('/duckhunt command', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should define play and leaderboard subcommands', () => {
    expect(duckhuntCmd.data.name).toBe('duckhunt');
    expect(duckhuntCmd.data.options.map(o => o.name)).toEqual(['play', 'leaderboard']);
  });

  describe('play subcommand', () => {
    it('should launch the Activity', async () => {
      const interaction = makeInteraction();
      await duckhuntCmd.execute(interaction, makeServices());
      expect(interaction.launchActivity).toHaveBeenCalled();
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should reply with an error if the Activity cannot launch', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const interaction = makeInteraction({ launchFails: true });
      await duckhuntCmd.execute(interaction, makeServices());
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Activities'),
        ephemeral: true,
      }));
      console.error.mockRestore();
    });
  });

  describe('leaderboard subcommand', () => {
    it('should say when there are no scores yet', async () => {
      const interaction = makeInteraction({ sub: 'leaderboard' });
      await duckhuntCmd.execute(interaction, makeServices([]));
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('No Duck Hunt scores yet'),
        ephemeral: true,
      }));
    });

    it('should show ranked scores without pinging players', async () => {
      const services = makeServices([
        { user_id: 'a', username: 'A', best_score: 12000, best_round: 4, total_ducks: 30, games_played: 3 },
        { user_id: 'b', username: 'B', best_score: 4500, best_round: 2, total_ducks: 9, games_played: 1 },
      ]);
      const interaction = makeInteraction({ sub: 'leaderboard' });
      await duckhuntCmd.execute(interaction, services);

      expect(services.duckHuntService.getLeaderboard).toHaveBeenCalledWith('g1', 10);
      const { embeds, allowedMentions } = interaction.reply.mock.calls[0][0];
      const description = embeds[0].data.description;
      expect(description).toContain('🥇 <@a>');
      expect(description).toContain('12,000');
      expect(description).toContain('🥈 <@b>');
      expect(allowedMentions).toEqual({ users: [] });
    });
  });
});
