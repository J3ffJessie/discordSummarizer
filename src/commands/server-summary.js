const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const gather = require('../services/gather');

module.exports = {
  data: new SlashCommandBuilder().setName('server').setDescription('Gather and summarize server conversations (admin only)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).toJSON(),
  async execute(interaction, services) {

    await interaction.reply({ content: '⏳ Gathering and summarizing conversations across all channels. Please wait...', ephemeral: true });
    try {
      const summary = await gather.gatherServerConversationsAndSummarize(interaction.guild, true, {
        summarizationService: services.summarizationService,
        guildId: interaction.guildId,
      });
      const chunks = summary.match(/[\s\S]{1,1900}/g) || ['No summary available.'];
      const guildConfig = services.guildConfigService?.getConfig(interaction.guildId) ?? null;
      const targetChannelId = guildConfig?.summary_channel_id || process.env.TARGET_CHANNEL_ID;
      if (!targetChannelId) {
        await interaction.followUp({ content: '❌ No summary channel configured. Use `/setup` to set one.', ephemeral: true });
        return;
      }
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
      console.error('server summary error:', err);
      await interaction.followUp({ content: '❌ Error summarizing server conversations.', ephemeral: true });
    }
  },
};
