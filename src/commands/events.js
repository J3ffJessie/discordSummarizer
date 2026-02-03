const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { fetchUpcomingEvents } = require('../services/events');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('events')
    .setDescription('Get upcoming events for the next 7 days')
    .toJSON(),
  async execute(interaction) {
    await interaction.reply({ content: '📬 Check your DMs for upcoming events!', ephemeral: true });
    try {
      const upcomingEvents = await fetchUpcomingEvents();
      if (!upcomingEvents || upcomingEvents.length === 0) {
        await interaction.followUp({ content: 'No upcoming events found.', ephemeral: true });
        return;
      }

      const embeds = upcomingEvents.slice(0, 10).map((event) => {
        const embed = new EmbedBuilder()
          .setTitle(event.name)
          .setURL(event.fullUrl)
          .setDescription(event.description ? (event.description.substring(0, 200) + (event.description.length > 200 ? '...' : '')) : 'No description')
          .addFields(
            { name: 'Start Time', value: new Date(event.startAt).toLocaleString('en-US', { timeZone: event.timeZone }), inline: true },
            { name: 'End Time', value: new Date(event.endAt).toLocaleString('en-US', { timeZone: event.timeZone }), inline: true },
            { name: 'Visibility', value: event.visibility, inline: true }
          )
          .setColor('#0099ff')
          .setTimestamp(new Date(event.startAt))
          .setFooter({ text: 'torc-dev events' });

        if (event.uploadedSocialCard && event.uploadedSocialCard.url) embed.setImage(event.uploadedSocialCard.url);

        return embed;
      });

      try {
        await interaction.user.send({ content: 'Here are the upcoming events:', embeds });
      } catch (dmErr) {
        await interaction.followUp({ content: '❌ I couldn\'t send you a DM. Please enable DMs and try again.', ephemeral: true });
      }
    } catch (err) {
      console.error('events command error:', err?.message || err);
      await interaction.followUp({ content: '❌ Failed to fetch events.', ephemeral: true });
    }
  },
};
