module.exports = (client) => {
  client.on('messageCreate', async (message) => {
    // Very small wrapper: preserve legacy behavior in root index.js for now
    // We avoid moving logic until other modules are fully implemented.
    if (message.author?.bot) return;
    // Future: dispatch to command handler or services
  });
};
