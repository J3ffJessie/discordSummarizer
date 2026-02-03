const { SlashCommandBuilder } = require('discord.js');
const groqService = require('../services/groq');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('summarize')
    .setDescription('Summarize recent messages in this channel')
    .toJSON(),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const formattedMessages = messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map((msg) => `${msg.member?.displayName || msg.author.username}: ${msg.content}`)
        .join('\n');

      const summary = await groqService.summarizeMessages(formattedMessages);
      const chunks = summary.match(/[\s\S]{1,1900}/g) || ['No summary available.'];

      for (const chunk of chunks) {
        await interaction.user.send(chunk);
      }

      await interaction.editReply({ content: '✅ Summary sent to your DMs!' });
    } catch (err) {
      console.error('summarize command error:', err?.message || err);
      await interaction.editReply({ content: '❌ Failed to summarize messages.' });
    }
  },
};
