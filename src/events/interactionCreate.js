const {
  Events,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const { MODAL_ID: PROFILE_MODAL_ID } = require('../commands/profile');
const { MODAL_ID: STICKY_MODAL_ID } = require('../commands/sticky');
const {
  INTERVIEW_STYLE_SELECT_ID,
  INTERVIEW_LANGUAGE_SELECT_ID,
  INTERVIEW_CONTINUE_BUTTON_ID,
  INTERVIEW_MODAL_ID,
} = require('../commands/interview');

module.exports = (client) => {
  client.on(Events.InteractionCreate, async (interaction) => {
    // Select menu interactions
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === INTERVIEW_STYLE_SELECT_ID) {
        const { interviewService } = client.services;
        interviewService.updatePendingStyle(interaction.user.id, interaction.values[0]);
        await interaction.deferUpdate();
      }

      if (interaction.customId === INTERVIEW_LANGUAGE_SELECT_ID) {
        const { interviewService } = client.services;
        interviewService.updatePendingLanguage(interaction.user.id, interaction.values[0]);
        await interaction.deferUpdate();
      }
      return;
    }

    // Modal submissions
    if (interaction.isModalSubmit()) {
      if (interaction.customId === STICKY_MODAL_ID) {
        const { stickyService } = client.services;
        const content = interaction.fields.getTextInputValue('sticky_content').trim();
        const channelId = interaction.channelId;

        const existing = stickyService.getSticky(channelId);
        if (existing?.message_id) {
          try {
            const old = await interaction.channel.messages.fetch(existing.message_id);
            await old.delete();
          } catch { /* already deleted */ }
        }

        await interaction.deferReply({ ephemeral: true });

        const stickyEmbed = new EmbedBuilder()
          .setColor(0xFFD700)
          .setTitle('📌 Sticky Message')
          .setDescription(content);
        const sent = await interaction.channel.send({ embeds: [stickyEmbed] });
        stickyService.setSticky(channelId, interaction.guildId, content, interaction.user.id, sent.id);

        await interaction.editReply({ content: '✅ Sticky message set for this channel.' });
        return;
      }

      if (interaction.customId === PROFILE_MODAL_ID) {
        const { profileService, guildConfigService } = client.services;
        const str = (field) => interaction.fields.getTextInputValue(field).trim() || null;
        const networkingRaw = interaction.fields.getTextInputValue('networking').trim().toLowerCase();
        const networking = networkingRaw === 'yes' ? 1 : 0;

        profileService.upsertProfile(interaction.guildId, interaction.user.id, {
          bio:      str('bio'),
          title:    str('title'),
          skills:   str('skills'),
          timezone: str('timezone'),
          networking,
        });

        try {
          const config = guildConfigService?.getConfig(interaction.guildId);
          const roleName = config?.coffee_role_name || process.env.COFFEE_ROLE_NAME || 'coffee chat';
          await interaction.guild.roles.fetch();
          const role = interaction.guild.roles.cache.find(r => r.name === roleName || r.id === roleName);
          if (role) {
            const member = interaction.member;
            if (networking && !member.roles.cache.has(role.id)) {
              await member.roles.add(role);
            } else if (!networking && member.roles.cache.has(role.id)) {
              await member.roles.remove(role);
            }
          }
        } catch (err) {
          console.warn('[profile] Could not sync coffee role:', err.message, '| code:', err.code, '| status:', err.status);
        }

        await interaction.reply({ content: '✅ Your profile has been updated!', ephemeral: true });
        return;
      }

      if (interaction.customId === INTERVIEW_MODAL_ID) {
        const { interviewService } = client.services;
        const userId = interaction.user.id;
        const setup = interviewService.getPendingSetup(userId);

        if (!setup) {
          await interaction.reply({
            content: '❌ Your setup session has expired. Please run `/interview start` again.',
            ephemeral: true,
          });
          return;
        }

        const company = interaction.fields.getTextInputValue('interview_company').trim() || null;
        const jdText = interaction.fields.getTextInputValue('interview_jd').trim() || null;
        interviewService.clearPendingSetup(userId);

        if (interviewService.sessions.has(userId)) {
          await interaction.reply({ content: '❌ You already have an active interview.', ephemeral: true });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        let parsedJd;
        try {
          parsedJd = await interviewService.parseJobDescription(jdText, setup.attachment);
        } catch (err) {
          return interaction.editReply({ content: `❌ ${err.message}` });
        }

        const member = interaction.member;
        const guild = interaction.guild;
        const botId = interaction.client.user.id;
        const channelName = `interview-${(member.displayName || member.user.username).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50)}`;

        let voiceChannel;
        try {
          voiceChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            permissionOverwrites: [
              {
                id: guild.roles.everyone.id,
                deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel],
              },
              {
                id: member.id,
                allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Speak],
              },
              {
                id: botId,
                allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Speak],
              },
            ],
          });
        } catch (err) {
          console.error('[interview] Failed to create voice channel:', err?.message);
          return interaction.editReply({ content: '❌ Failed to create interview channel. Please check bot permissions.' });
        }

        await interaction.editReply({
          content: `✅ Interview room created! Join <#${voiceChannel.id}> — I'll start asking questions once you join.`,
        });

        interviewService
          .startInterview(guild, member, voiceChannel, interaction.channel, parsedJd, company, setup.style, setup.language)
          .catch(async (err) => {
            console.error('[interview] Unhandled error in startInterview:', err?.message);
            try {
              await interaction.channel.send('❌ An unexpected error occurred during the interview.');
            } catch {}
          });

        return;
      }

      return;
    }

    // Button interactions
    if (interaction.isButton()) {
      if (interaction.customId === INTERVIEW_CONTINUE_BUTTON_ID) {
        const { interviewService } = client.services;
        const setup = interviewService.getPendingSetup(interaction.user.id);

        if (!setup) {
          await interaction.reply({
            content: '❌ Your setup session has expired. Please run `/interview start` again.',
            ephemeral: true,
          });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(INTERVIEW_MODAL_ID)
          .setTitle('Interview Setup — Step 2 of 2');

        const companyInput = new TextInputBuilder()
          .setCustomId('interview_company')
          .setLabel('Company Name (optional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. Google, early stage fintech startup')
          .setRequired(false);

        const jdInput = new TextInputBuilder()
          .setCustomId('interview_jd')
          .setLabel(setup.attachment ? 'Additional context (optional)' : 'Job Description')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(
            setup.attachment
              ? 'Any extra context to add alongside your uploaded file...'
              : 'Paste the job description here'
          )
          .setRequired(!setup.attachment);

        modal.addComponents(
          new ActionRowBuilder().addComponents(companyInput),
          new ActionRowBuilder().addComponents(jdInput),
        );

        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('giveaway_enter_')) {
        const { giveawayService } = client.services;
        const guildId = interaction.guildId;
        const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
        const result = giveawayService.addParticipant(guildId, interaction.user.id, interaction.user.username, displayName);
        if (result === 'ok') {
          await interaction.reply({ content: `✅ You're in, **${displayName}**! Good luck! 🎉`, ephemeral: true });
        } else if (result === 'already_entered') {
          await interaction.reply({ content: '❌ You\'ve already entered this giveaway!', ephemeral: true });
        } else {
          await interaction.reply({ content: '❌ This giveaway is no longer active.', ephemeral: true });
        }
        return;
      }

      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, client.services);
    } catch (err) {
      console.error(err);

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: '❌ Error processing command.' });
        } else {
          await interaction.reply({ content: '❌ Error processing command.', ephemeral: true });
        }
      } catch (replyErr) {
        console.error('Failed to send error reply to interaction:', replyErr.message);
      }
    }
  });
};
