require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Messages for Alice, Bob, and Charlie
const aliceMessages = [
  "Hey Bob, have you had a chance to check the latest updates?",
  "The UI tweaks are looking really clean. Great job on that!",
  "I'm seeing some weird behavior in the API responses though.",
  "I’ll document the new flow after our meeting today.",
  "We should probably sync tomorrow before the deploy.",
  "Do you think we need more test coverage for the new feature?",
  "I was thinking about how we could improve error handling in the app.",
  "I'll review the code tonight and send over my thoughts.",
  "Looking forward to pushing these updates to production!",
  "Have you started looking into the next sprint's tasks?"
];

const bobMessages = [
  "Hey Alice! Just saw your commits — looks solid to me.",
  "Thanks! I tried to simplify the layout based on your feedback.",
  "Hmm, I'll take a look at the API — could be a caching issue.",
  "Cool, let me know if you need help with the documentation.",
  "Agreed, a sync would help. How’s 10 AM for you?",
  "I’m excited about the new feature. Let’s make sure we’re aligned before the demo.",
  "I’ll ping you later about the deployment steps.",
  "Just realized we need to update the readme for the new changes.",
  "I’ll follow up on the open PRs after our meeting.",
  "The testing was smooth, but I’ll double-check the edge cases."
];

const charlieMessages = [
  "Hey Alice, Bob! Hope you're both doing well today.",
  "I’ve been thinking about the new feature — we might need a more robust solution.",
  "I'm working on the backend integration. Should be ready by the end of the week.",
  "By the way, I’ve noticed some inconsistencies in the UI during testing.",
  "I’ll create a testing checklist to ensure we don’t miss any critical flows.",
  "How are you both feeling about the upcoming sprint planning?",
  "I’ll jump on the meeting agenda once we finalize the feature set.",
  "Just finished setting up the staging environment. It's all green now.",
  "I’ve added a couple of ideas to the backlog for future releases.",
  "Looking forward to collaborating on the deployment tomorrow!"
];

// Combine and alternate messages from Alice, Bob, and Charlie
const sampleMessages = [];
for (let i = 0; i < 30; i++) {
  const msg = i % 3 === 0
    ? `Alice: ${aliceMessages[i % aliceMessages.length]}`
    : i % 3 === 1
    ? `Bob: ${bobMessages[i % bobMessages.length]}`
    : `Charlie: ${charlieMessages[i % charlieMessages.length]}`;
  sampleMessages.push(msg);
}

async function sendCyclicMessages() {
  const channelId = process.env.CHANNEL_ID;

  try {
    const channel = await client.channels.fetch(channelId);

    for (let i = 0; i < sampleMessages.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await channel.send(sampleMessages[i]);
      console.log(`Sent message ${i + 1} of ${sampleMessages.length}`);
    }

    console.log('All messages sent successfully.');
  } catch (error) {
    console.error('Error sending messages:', error);
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  sendCyclicMessages();
});

client.login(process.env.BOT_TOKEN);
