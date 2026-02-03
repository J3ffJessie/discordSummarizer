const { SlashCommandBuilder } = require('discord.js');
const { findLocation } = require('../../locations');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('location')
    .setDescription('Scan recent messages for locations and log them (admin only)')
    .addIntegerOption((opt) => opt.setName('limit').setDescription('How many messages to scan (max 100)').setRequired(false)),
  async execute(interaction) {
    const ALLOWED = (process.env.ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ALLOWED.length && !ALLOWED.includes(interaction.user.id)) {
      await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
      return;
    }
    const limit = Math.min(Math.max(1, interaction.options.getInteger('limit') || 100), 100);
    await interaction.deferReply({ ephemeral: true });
    const messages = await interaction.channel.messages.fetch({ limit });
    const foundLocations = [];
    messages.forEach((msg) => {
      const res = findLocation(msg.content);
      if (res && res.matchFound) foundLocations.push({ user: msg.member?.displayName || msg.author.username, text: msg.content, ...res });
    });

    if (foundLocations.length > 0) {
      const logFile = path.join(__dirname, '..', '..', 'locations.log');
      const loggedUsernames = new Set();
      try {
        if (fs.existsSync(logFile)) {
          const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
          lines.forEach((l) => {
            try { const entry = JSON.parse(l); if (entry && entry.user) loggedUsernames.add(entry.user); } catch (e) {}
          });
        }
      } catch (e) {}

      foundLocations.filter((loc) => loc.user !== 'Chat Summary').forEach((loc) => {
        if (!loggedUsernames.has(loc.user)) {
          fs.appendFileSync(logFile, JSON.stringify({ type: loc.type, name: loc.name || loc.city, user: loc.user }) + '\n');
        }
      });
    }

    await interaction.editReply({ content: '✅ Location data has been summarized and logged.' });
  },
};
