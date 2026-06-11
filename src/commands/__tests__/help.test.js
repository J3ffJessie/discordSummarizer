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
});
