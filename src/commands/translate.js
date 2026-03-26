const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags
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
        flags: MessageFlags.Ephemeral
      });
    }

    if (subcommand === "start") {
      const member = interaction.member;

      if (!member.voice.channel) {
        return interaction.reply({
          content: "You must be in a voice channel to start translation.",
          flags: MessageFlags.Ephemeral
        });
      }

      // Prevent duplicate sessions
      const existingSession = sessionService.getSession(interaction.guildId);
      if (existingSession) {
        return interaction.reply({
          content: "Translation is already running in this server.",
          flags: MessageFlags.Ephemeral
        });
      }

      // Acknowledge immediately — joinVoiceChannel can take longer than
      // Discord's 3-second interaction window, causing error 10062.
      try {
        await interaction.deferReply();
      } catch (err) {
        console.error("deferReply failed (interaction expired):", err?.message);
        return;
      }

      // Create session — stop voice capture when session auto-expires after 1 hour
      const session = sessionService.createSession(interaction.guildId, () => {
        if (voiceService) voiceService.stop(interaction.guildId);
      });

      // Start voice capture
      try {
        if (voiceService) {
          await voiceService.start(
            interaction.guild,
            member.voice.channel,
            interaction.guildId
          );
        }
      } catch (err) {
        console.error("Failed to start voice capture:", err?.message);
        sessionService.deleteSession(interaction.guildId);
        return interaction.editReply({
          content: "Failed to join your voice channel. Please try again.",
        });
      }

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

      await interaction.editReply({ embeds: [embed] });
    }

    else if (subcommand === "stop") {
      const existingSession = sessionService.getSession(interaction.guildId);

      if (!existingSession) {
        return interaction.reply({
          content: "There is no active translation session.",
          flags: MessageFlags.Ephemeral
        });
      }

      try {
        await interaction.deferReply();
      } catch (err) {
        console.error("deferReply failed (interaction expired):", err?.message);
        return;
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

      await interaction.editReply({ embeds: [embed] });
    }
  }
};
