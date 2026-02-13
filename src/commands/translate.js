const {
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("translate")
    .setDescription("Start or stop live voice translation")
    .addSubcommand(sub =>
      sub
        .setName("start")
        .setDescription("Start live voice translation")
    )
    .addSubcommand(sub =>
      sub
        .setName("stop")
        .setDescription("Stop live voice translation")
    ),

  async execute(interaction, services) {
    const subcommand = interaction.options.getSubcommand();
    const { sessionService, voiceService } = services;

    if (!interaction.guild) {
      return interaction.reply({
        content: "This command can only be used inside a server.",
        ephemeral: true
      });
    }

    if (subcommand === "start") {
      const member = interaction.member;

      if (!member.voice.channel) {
        return interaction.reply({
          content: "You must be in a voice channel to start translation.",
          ephemeral: true
        });
      }

      // Prevent duplicate sessions
      const existingSession = sessionService.getSession(interaction.guildId);
      if (existingSession) {
        return interaction.reply({
          content: "Translation is already running in this server.",
          ephemeral: true
        });
      }

      // Create session
      const session = sessionService.createSession(interaction.guildId);

      // Start voice capture (handled in your voiceService)
      if (voiceService) {
        await voiceService.start(
          interaction.guild,
          member.voice.channel,
          interaction.guildId
        );
      }

      // Generate caption URL

      const PORT = process.env.PORT || 3000;
      const baseUrl =
        process.env.CAPTION_URL ||
        `http://localhost:${process.env.PORT || 3000}`;

      const captionUrl =
        `${baseUrl}/public/captions.html?guild=${interaction.guildId}&token=${session.token}`;

      const embed = new EmbedBuilder()
        .setTitle("🎤 Live Voice Translation Started")
        .setDescription(
          `Captions are now streaming.\n\n**Live Captions URL:**\n${captionUrl}`
        )
        .setColor(0x2ecc71)
        .setFooter({ text: "Share this link with anyone who needs live captions." })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    if (subcommand === "stop") {
      const existingSession = sessionService.getSession(interaction.guildId);

      if (!existingSession) {
        return interaction.reply({
          content: "There is no active translation session.",
          ephemeral: true
        });
      }

      // Stop voice capture
      if (voiceService) {
        await voiceService.stop(interaction.guildId);
      }

      // Remove session
      sessionService.deleteSession(interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle("🛑 Live Voice Translation Stopped")
        .setDescription("The translation session has ended.")
        .setColor(0xe74c3c)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  }
};
