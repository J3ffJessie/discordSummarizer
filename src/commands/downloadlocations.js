const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder().setName('downloadlocations').setDescription('Download the sorted locations log (admin only)').toJSON(),
  async execute(interaction) {
    const ALLOWED = (process.env.ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ALLOWED.length && !ALLOWED.includes(interaction.user.id)) {
      await interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
      return;
    }
    const logFile = path.join(__dirname, '..', '..', 'locations.log');
    if (!fs.existsSync(logFile)) {
      await interaction.reply({ content: 'No log file found.', ephemeral: true });
      return;
    }
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    const entries = lines.map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    const cities = entries.filter((e) => e.type === 'city').map((e) => e.name);
    const countries = entries.filter((e) => e.type === 'country').map((e) => e.name);
    const uniqueCities = Array.from(new Set(cities)).sort();
    const uniqueCountries = Array.from(new Set(countries)).sort();
    const sortedData = { cities: uniqueCities, countries: uniqueCountries };
    const tempFile = path.join(__dirname, '..', '..', 'locations_sorted.json');
    fs.writeFileSync(tempFile, JSON.stringify(sortedData, null, 2));
    try {
      await interaction.user.send({ files: [tempFile] });
      fs.unlinkSync(tempFile);
      await interaction.reply({ content: '📄 Sorted log file sent to your DMs!', ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: '❌ Failed to send DM.', ephemeral: true });
    }
  },
};
