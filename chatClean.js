require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const channelId = process.env.CHANNEL_ID;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel.isTextBased()) {
      console.error("Provided channel is not text-based.");
      return;
    }

    let deletedCount = 0;
    let hasMore = true;

    while (hasMore) {
      const messages = await channel.messages.fetch({ limit: 100 });

      if (messages.size === 0) {
        hasMore = false;
        break;
      }

      // Separate messages by age
      const [bulkDeletable, oldMessages] = messages.partition(
        msg => Date.now() - msg.createdTimestamp < 14 * 24 * 60 * 60 * 1000
      );

      if (bulkDeletable.size > 0) {
        const deleted = await channel.bulkDelete(bulkDeletable, true);
        deletedCount += deleted.size;
        console.log(`Bulk deleted ${deleted.size} messages.`);
      }

      for (const [id, msg] of oldMessages) {
        try {
          await msg.delete();
          deletedCount++;
          console.log(`Individually deleted old message: ${id}`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // prevent rate limits
        } catch (err) {
          console.error(`Failed to delete message ${id}:`, err);
        }
      }

      hasMore = messages.size >= 100;
    }

    console.log(`✅ Done. Deleted a total of ${deletedCount} messages.`);
  } catch (error) {
    console.error('Error while deleting messages:', error);
  } finally {
    client.destroy();
  }
});

client.login(process.env.BOT_TOKEN);
