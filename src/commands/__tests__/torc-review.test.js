jest.mock('discord.js', () => {
  const option = () => ({
    setName: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setRequired: jest.fn().mockReturnThis(),
    setMaxLength: jest.fn().mockReturnThis(),
  });
  return {
    SlashCommandBuilder: jest.fn().mockImplementation(function () {
      const builder = {
        setName: jest.fn().mockReturnThis(),
        setDescription: jest.fn().mockReturnThis(),
        addStringOption: jest.fn(fn => { fn(option()); return builder; }),
        toJSON: jest.fn().mockReturnValue({ name: 'torc-review' }),
      };
      return builder;
    }),
    EmbedBuilder: jest.fn(),
    MessageFlags: { Ephemeral: 64 },
  };
});

const command = require('../torc-review');
const { TorcReviewError } = require('../../services/torcReviewService');

let userCounter = 0;

function makeInteraction({ inGuild = true, url = 'https://torc.dev/u/jane', sendImpl } = {}) {
  return {
    guildId: 'guild-1',
    inGuild: jest.fn().mockReturnValue(inGuild),
    user: { id: `user-${++userCounter}`, send: jest.fn(sendImpl || (() => Promise.resolve())) },
    options: { getString: jest.fn().mockReturnValue(url) },
    reply: jest.fn().mockResolvedValue(),
    deferReply: jest.fn().mockResolvedValue(),
    editReply: jest.fn().mockResolvedValue(),
    followUp: jest.fn().mockResolvedValue(),
  };
}

function makeServices(overrides = {}) {
  return {
    guildConfigService: { getConfig: jest.fn().mockReturnValue({ summ_provider: 'groq' }) },
    torcReviewService: {
      loadProfile: jest.fn().mockResolvedValue({ text: 'PROFILE', source: 'Torc profile (jane)' }),
      evaluate: jest.fn().mockResolvedValue({ criteria: [] }),
      buildEmbeds: jest.fn().mockReturnValue(['EMBED1', 'EMBED2']),
      ...overrides,
    },
  };
}

const lastEdit = (interaction) => interaction.editReply.mock.calls.at(-1)[0];

describe('/torc-review', () => {
  beforeEach(() => command.cooldowns.clear());

  it('is registered as torc-review', () => {
    expect(command.data.name).toBe('torc-review');
  });

  it('rejects use outside a server', async () => {
    const interaction = makeInteraction({ inGuild: false });
    const services = makeServices();

    await command.execute(interaction, services);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: 64 }));
    expect(services.torcReviewService.loadProfile).not.toHaveBeenCalled();
  });

  it('evaluates with the guild config and DMs each embed as its own message', async () => {
    const interaction = makeInteraction({ url: '  https://torc.dev/u/jane  ' });
    const services = makeServices();

    await command.execute(interaction, services);

    expect(services.torcReviewService.loadProfile).toHaveBeenCalledWith('https://torc.dev/u/jane');
    expect(services.torcReviewService.evaluate).toHaveBeenCalledWith('PROFILE', 'Torc profile (jane)', { summ_provider: 'groq' });
    expect(interaction.user.send).toHaveBeenCalledTimes(2);
    expect(interaction.user.send).toHaveBeenNthCalledWith(1, { embeds: ['EMBED1'] });
    expect(lastEdit(interaction).content).toMatch(/Check your DMs/);
  });

  it('enforces a cooldown after a successful review', async () => {
    const interaction = makeInteraction();
    const services = makeServices();
    await command.execute(interaction, services);

    const again = { ...makeInteraction(), user: interaction.user };
    await command.execute(again, services);

    expect(again.reply.mock.calls[0][0].content).toMatch(/minute/);
    expect(services.torcReviewService.loadProfile).toHaveBeenCalledTimes(1);
  });

  it('shows user-facing errors and does not start a cooldown when the link is rejected', async () => {
    const interaction = makeInteraction({ url: 'https://example.com/me' });
    const services = makeServices({
      loadProfile: jest.fn().mockRejectedValue(new TorcReviewError('I can only review Torc profiles.')),
    });

    await command.execute(interaction, services);

    expect(lastEdit(interaction).content).toBe('❌ I can only review Torc profiles.');
    expect(command.cooldowns.has(interaction.user.id)).toBe(false);
  });

  it('clears the cooldown when evaluation fails, without leaking details', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const interaction = makeInteraction();
    const services = makeServices({ evaluate: jest.fn().mockRejectedValue(new Error('secret upstream detail')) });

    await command.execute(interaction, services);

    expect(lastEdit(interaction).content).toMatch(/Something went wrong/);
    expect(lastEdit(interaction).content).not.toMatch(/secret/);
    expect(command.cooldowns.has(interaction.user.id)).toBe(false);
    spy.mockRestore();
  });

  it('falls back to private in-channel feedback when DMs are closed', async () => {
    const interaction = makeInteraction({
      sendImpl: () => Promise.reject(Object.assign(new Error('Cannot send'), { code: 50007 })),
    });

    await command.execute(interaction, makeServices());

    expect(lastEdit(interaction)).toMatchObject({ embeds: ['EMBED1'] });
    expect(interaction.followUp).toHaveBeenCalledWith({ embeds: ['EMBED2'], flags: 64 });
  });
});
