jest.mock('../../services/profileService', () => ({
  buildProfileEmbed: jest.fn().mockReturnValue({ title: 'Profile Embed' }),
}));

const profileCmd = require('../profile');
const { buildProfileEmbed } = require('../../services/profileService');

function makeInteraction({ sub = 'view', targetUser = null, existingProfile = null } = {}) {
  return {
    guildId: 'g1',
    user: { id: 'u1', username: 'alice' },
    guild: {
      members: {
        fetch: jest.fn().mockResolvedValue({ displayName: 'Alice', user: { username: 'alice' } }),
      },
    },
    options: {
      getSubcommand: jest.fn().mockReturnValue(sub),
      getUser: jest.fn().mockReturnValue(targetUser),
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
    it('should fetch member and reply with profile embed for self', async () => {
      const interaction = makeInteraction({ sub: 'view', targetUser: null });
      await profileCmd.execute(interaction, makeServices(null));
      expect(buildProfileEmbed).toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
    });

    it('should fetch another user when target is specified', async () => {
      const targetUser = { id: 'u2', username: 'bob' };
      const interaction = makeInteraction({ sub: 'view', targetUser });
      await profileCmd.execute(interaction, makeServices(null));
      expect(interaction.guild.members.fetch).toHaveBeenCalledWith('u2');
      expect(buildProfileEmbed).toHaveBeenCalledWith(targetUser, expect.anything(), null);
    });
  });

  it('should expose MODAL_ID constant', () => {
    expect(profileCmd.MODAL_ID).toBe('profile_edit_modal');
  });
});
