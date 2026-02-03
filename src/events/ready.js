const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = (client) => {
  client.on(Events.ClientReady, () => {
    console.log(`(refactor) Logged in as ${client.user.tag}`);
    logger.init(client);
  });
};
