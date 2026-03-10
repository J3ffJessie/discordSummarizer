module.exports = (client) => {
  client.on('guildMemberRemove', (member) => {
    client.services?.messageStats?.recordMemberLeave(member);
  });
};
