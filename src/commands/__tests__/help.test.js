const help = require('../help');

function makeInteraction() {
  return {
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

describe('/help command', () => {
  it('should reply with an embed', async () => {
    const interaction = makeInteraction();
    await help.execute(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array), ephemeral: true })
    );
  });

  it('should include at least one embed', async () => {
    const interaction = makeInteraction();
    await help.execute(interaction);
    const { embeds } = interaction.reply.mock.calls[0][0];
    expect(embeds.length).toBeGreaterThan(0);
  });

  it('should have a data property with name "help"', () => {
    expect(help.data.name).toBe('help');
  });

  it('should include fields for profile, community, and music sections', async () => {
    const interaction = makeInteraction();
    await help.execute(interaction);
    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    const fieldNames = embed.data.fields.map(f => f.name);
    expect(fieldNames.some(n => n.includes('Profile'))).toBe(true);
    expect(fieldNames.some(n => n.includes('Community'))).toBe(true);
    expect(fieldNames.some(n => n.includes('Music'))).toBe(true);
  });
});
