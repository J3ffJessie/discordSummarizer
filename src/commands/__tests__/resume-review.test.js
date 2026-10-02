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
        addAttachmentOption: jest.fn(fn => { fn(option()); return builder; }),
        addStringOption: jest.fn(fn => { fn(option()); return builder; }),
        toJSON: jest.fn().mockReturnValue({ name: 'resume-review' }),
      };
      return builder;
    }),
    MessageFlags: { Ephemeral: 64 },
  };
});

const command = require('../resume-review');
const { ResumeReviewError, DEFAULT_ROLE } = require('../../services/resumeReviewService');

function makeInteraction({ inGuild = true, role = null, sendImpl } = {}) {
  return {
    guildId: 'guild-1',
    inGuild: jest.fn().mockReturnValue(inGuild),
    user: { send: jest.fn(sendImpl || (() => Promise.resolve())) },
    options: {
      getAttachment: jest.fn().mockReturnValue({ url: 'https://cdn/resume.pdf', size: 1234, name: 'resume.pdf' }),
      getString: jest.fn().mockReturnValue(role),
    },
    reply: jest.fn().mockResolvedValue(),
    deferReply: jest.fn().mockResolvedValue(),
    editReply: jest.fn().mockResolvedValue(),
  };
}

function makeServices({ enabled = 1, review } = {}) {
  return {
    guildConfigService: { getConfig: jest.fn().mockReturnValue({ resume_review_enabled: enabled }) },
    resumeReviewService: {
      review: review || jest.fn().mockResolvedValue('REVIEW TEXT'),
      sendToUser: jest.fn().mockResolvedValue(),
    },
  };
}

const lastEdit = (interaction) => interaction.editReply.mock.calls.at(-1)[0].content;

describe('/resume-review', () => {
  const originalEnv = process.env.RESUME_REVIEW_ENABLED;
  beforeEach(() => { delete process.env.RESUME_REVIEW_ENABLED; });
  afterAll(() => {
    if (originalEnv === undefined) delete process.env.RESUME_REVIEW_ENABLED;
    else process.env.RESUME_REVIEW_ENABLED = originalEnv;
  });

  it('is registered as resume-review', () => {
    expect(command.data.name).toBe('resume-review');
  });

  it('rejects use outside a server', async () => {
    const interaction = makeInteraction({ inGuild: false });
    const services = makeServices();

    await command.execute(interaction, services);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: 64 }));
    expect(services.resumeReviewService.review).not.toHaveBeenCalled();
  });

  it('rejects use when the feature is disabled for the server', async () => {
    const interaction = makeInteraction();
    const services = makeServices({ enabled: 0 });

    await command.execute(interaction, services);

    expect(interaction.reply.mock.calls[0][0].content).toMatch(/not enabled/);
    expect(services.resumeReviewService.review).not.toHaveBeenCalled();
  });

  it('allows use when enabled via RESUME_REVIEW_ENABLED env var', async () => {
    process.env.RESUME_REVIEW_ENABLED = 'true';
    const interaction = makeInteraction();
    const services = makeServices({ enabled: 0 });

    await command.execute(interaction, services);

    expect(services.resumeReviewService.review).toHaveBeenCalled();
  });

  it('reviews the attachment and DMs the result', async () => {
    const interaction = makeInteraction({ role: '  Data Analyst  ' });
    const services = makeServices();

    await command.execute(interaction, services);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(services.resumeReviewService.review).toHaveBeenCalledWith({
      url: 'https://cdn/resume.pdf',
      size: 1234,
      filename: 'resume.pdf',
      guildConfig: { resume_review_enabled: 1 },
      targetRole: 'Data Analyst',
    });
    expect(services.resumeReviewService.sendToUser).toHaveBeenCalledWith(interaction.user, 'REVIEW TEXT');
    expect(lastEdit(interaction)).toMatch(/sent to your DMs/);
  });

  it('uses the default role when none is provided', async () => {
    const interaction = makeInteraction({ role: null });
    const services = makeServices();

    await command.execute(interaction, services);

    expect(services.resumeReviewService.review.mock.calls[0][0].targetRole).toBe(DEFAULT_ROLE);
  });

  it('stops before reviewing when the user has DMs closed', async () => {
    const interaction = makeInteraction({
      sendImpl: () => Promise.reject(Object.assign(new Error('Cannot send messages to this user'), { code: 50007 })),
    });
    const services = makeServices();

    await command.execute(interaction, services);

    expect(lastEdit(interaction)).toMatch(/couldn't send you a DM/);
    expect(services.resumeReviewService.review).not.toHaveBeenCalled();
  });

  it('shows user-facing review errors directly', async () => {
    const interaction = makeInteraction();
    const services = makeServices({
      review: jest.fn().mockRejectedValue(new ResumeReviewError('Unsupported file type.')),
    });

    await command.execute(interaction, services);

    expect(lastEdit(interaction)).toBe('❌ Unsupported file type.');
    expect(services.resumeReviewService.sendToUser).not.toHaveBeenCalled();
  });

  it('shows a generic message for unexpected errors', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const interaction = makeInteraction();
    const services = makeServices({ review: jest.fn().mockRejectedValue(new Error('boom')) });

    await command.execute(interaction, services);

    expect(lastEdit(interaction)).toMatch(/error reviewing your resume/);
    consoleSpy.mockRestore();
  });
});
