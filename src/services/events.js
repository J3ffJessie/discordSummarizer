const axios = require('axios');

async function fetchUpcomingEvents() {
  try {
    const response = await axios.get('https://public-api.luma.com/v1/calendar/list-events', {
      headers: { accept: 'application/json', 'x-luma-api-key': process.env.LUMA_API_KEY },
      timeout: 8000,
    });
    const events = response.data.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    return events;
  } catch (err) {
    console.error('Error fetching upcoming events:', err?.message || err);
    return [];
  }
}

module.exports = { fetchUpcomingEvents };
