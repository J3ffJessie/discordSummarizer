const { SlashCommandBuilder } = require('discord.js');
const gather = require('../services/gather');

module.exports = {
  data: new SlashCommandBuilder().setName('server').setDescription('Gather and summarize server conversations (admin only)').toJSON(),
  async execute(interaction) {
    const ALLOWED = (process.env.ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ALLOWED.length && !ALLOWED.includes(interaction.user.id)) {
      await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
      return;
    }

    await interaction.reply({ content: '⏳ Gathering and summarizing conversations across all channels. Please wait...', ephemeral: true });
    try {
      const summary = await gather.gatherServerConversationsAndSummarize(interaction.guild, true);
      const chunks = summary.match(/[\s\S]{1,1900}/g) || ['No summary available.'];
      const targetChannelId = process.env.TARGET_CHANNEL_ID || '1392954859803644014';
      let channel = interaction.guild.channels.cache.get(targetChannelId);
      if (!channel) channel = await interaction.guild.channels.fetch(targetChannelId).catch(() => null);
      if (!channel) {
        await interaction.followUp({ content: '❌ Could not find the summary channel.', ephemeral: true });
        return;
      }
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
      await interaction.followUp({ content: '✅ Server summary sent to the summary channel!', ephemeral: true });
    } catch (err) {
      console.error('server summary error:', err?.message || err);
      await interaction.followUp({ content: '❌ Error summarizing server conversations.', ephemeral: true });
    }
  },
};
