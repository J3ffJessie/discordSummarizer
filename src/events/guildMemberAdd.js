module.exports = (client) => {
  client.on('guildMemberAdd', (member) => {
    client.services?.messageStats?.recordMemberJoin(member);
  });
};
