jest.mock('../../services/profileService', () => ({
  buildProfileEmbed: jest.fn().mockReturnValue({ title: 'Profile Embed' }),
}));

const profileCmd = require('../profile');
const { buildProfileEmbed } = require('../../services/profileService');

function makeInteraction({ sub = 'view', targetUser = null } = {}) {
  const self = { id: 'u1', username: 'alice' };
  self.fetch = jest.fn().mockResolvedValue(self);
  self.send = jest.fn().mockResolvedValue(undefined);
  const target = targetUser ?? self;
  return {
    guildId: 'g1',
    user: self,
    guild: {
      members: {
        fetch: jest.fn().mockResolvedValue({ displayName: 'Alice', user: { username: 'alice' } }),
      },
    },
    options: {
      getSubcommand: jest.fn().mockReturnValue(sub),
      getUser: jest.fn().mockReturnValue(target),
    },
    showModal: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

function makeServices(profile = null) {
  return {
    profileService: {
      getProfile: jest.fn().mockReturnValue(profile),
    },
  };
}

describe('/profile command', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('edit subcommand', () => {
    it('should show modal with empty values when no existing profile', async () => {
      const interaction = makeInteraction({ sub: 'edit' });
      await profileCmd.execute(interaction, makeServices(null));
      expect(interaction.showModal).toHaveBeenCalled();
    });

    it('should show modal pre-filled with existing profile values', async () => {
      const interaction = makeInteraction({ sub: 'edit' });
      await profileCmd.execute(interaction, makeServices({ bio: 'My bio', title: 'Dev', skills: 'JS', timezone: 'UTC', networking: 1 }));
      expect(interaction.showModal).toHaveBeenCalled();
    });
  });

  describe('view subcommand', () => {
    it('should DM the profile embed to the invoking user', async () => {
      const interaction = makeInteraction({ sub: 'view' });
      await profileCmd.execute(interaction, makeServices(null));
      expect(buildProfileEmbed).toHaveBeenCalled();
      expect(interaction.user.send).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    });

    it('should fall back to ephemeral reply if DMs are disabled', async () => {
      const interaction = makeInteraction({ sub: 'view' });
      interaction.user.send = jest.fn().mockRejectedValue(new Error('Cannot send DM'));
      await profileCmd.execute(interaction, makeServices(null));
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array), ephemeral: true }));
    });
  });

  it('should expose MODAL_ID constant', () => {
    expect(profileCmd.MODAL_ID).toBe('profile_edit_modal');
  });
});
