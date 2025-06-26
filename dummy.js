require('dotenv').config(); // Load environment variables from .env file
const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Technical Participants: Alice & Dana
const aliceMessages = [
  // "Hey Dana, did you see the recent update to the GraphQL schema?",
  // "I'm thinking we should switch from REST to gRPC for internal services.",
  // "Some endpoints are still returning 500s — can you check the logs?",
  // "I've added unit tests for the new controller logic.",
  // "What do you think about introducing feature flags for the beta rollout?",
  // "The auth middleware still needs some cleanup.",
  // "I'll write a wiki page to document the DB migration steps.",
  // "Do we want to cache the dashboard stats?",
  // "Linting failed on the latest merge. Mind checking?",
  // "I suspect our rate limiting isn't working as expected.",
  // "Anyone else seeing that memory leak on staging?",
  // "Let’s make sure every service has a health check before launch.",
  // "I'll try adding retry logic to the API client.",
  // "We should create a Jenkins job for this pipeline.",
  // "The log aggregation is missing from service B.",
  // "Should we move all config to a shared env repo?",
  // "I'll look into Prometheus alerts tomorrow.",
  // "Mind reviewing the cleanup script for orphaned records?",
  // "I'm wrapping up the integration test suite now.",
  // "The feature toggle API is almost ready for review."
  "Hi everyone my name is Diego Zumarraga Mera.  I’m from Ecuador. I’m interested in this community to find opportunities. I’m an AI enthusiast and a Solutions Architect. Outside of tech I like music, tv and playing bass"
];

const danaMessages = [
  // "Good call on the GraphQL — the schema needs simplification too.",
  // "Yeah, gRPC sounds great. Let’s do a spike on that.",
  // "Sure, I’ll grep the logs for anything suspicious.",
  // "Nice, I’ll review your test coverage later today.",
  // "Feature flags are a must — I’ll add a toggling mechanism.",
  // "Agreed — the middleware is messy. I'll refactor it.",
  // "Thanks for the docs — that’ll help onboarding.",
  // "We can memoize the stats method for better performance.",
  // "I'll fix the linting error in the sidebar component.",
  // "You're right — rate limiting needs revisiting.",
  // "Yup, the leak happens only under load.",
  // "I’ll add readiness and liveness probes to our Helm charts.",
  // "Retry logic sounds good — exponential backoff?",
  // "I'll add the Jenkins config file now.",
  // "Oh, I totally missed logging for that service. Thanks!",
  // "Yeah, let’s centralize all our env vars.",
  // "I’ll test the Prometheus alert rules this afternoon.",
  // "Sure, I’ll check the script and run it on QA.",
  // "Awesome — that test suite will save us later.",
  // "I'll do a final code pass and merge it in."
  "Hi!!! Lidia here 🌎 Where: New York City 💜 Why you are here: Excited to connect with like-minded individuals in this community to share knowledge, collaborate, and learn from others. I’m passionate about tech and community building, and I’m looking forward to expanding my network and learning new insights from this space."
];

// Casual Participants: Bob & Eli
const bobMessages = [
  // "Hey Eli! How was your weekend?",
  // "We went hiking upstate — the fall colors were unreal.",
  // "Did you watch that new sci-fi movie on Netflix?",
  // "The twins started soccer practice this week!",
  // "We’re planning a family BBQ next Saturday — you're invited!",
  // "I finally finished that mystery novel I told you about.",
  // "The kids are obsessed with LEGOs lately.",
  // "I tried making sourdough again… still needs work.",
  // "We watched *Elemental* — super cute animation.",
  // "I picked up biking again — feels great to be outside more.",
  // "We saw a bald eagle while kayaking last weekend!",
  // "Dinner at Mom’s was full of dad jokes as usual.",
  // "I’m teaching my daughter to ride a bike — wish me luck.",
  // "We binged *The Bear* — that kitchen stress is real.",
  // "I might sign up for that local pottery class.",
  // "Our garden finally sprouted tomatoes!",
  // "I’ve been decluttering — garage sale next weekend.",
  // "My dog figured out how to open the fridge...",
  // "We went apple picking and left with 3 full bags.",
  // "I took my parents to that jazz café — they loved it."
  "Hey Besties to be!!  I'm Yanique, 🌎  Charlotte NC 💜 Excited to make some Tech Torc besties 💼 Software Engineer"
];

const eliMessages = [
  // "Hey Bob! Weekend was chill, just caught up on sleep.",
  // "Nice! I’ve been meaning to do a hike soon.",
  // "Yes! I watched it too — the ending was wild.",
  // "Soccer already? That’s awesome. Busy schedule ahead!",
  // "I’ll be there — love a good BBQ.",
  // "Ohh, how was the ending? Worth the buildup?",
  // "LEGOs are timeless. I still have my old sets.",
  // "Sourdough is an art form. I’m still learning too.",
  // "I loved *Elemental*! The characters were so lovable.",
  // "That’s great! I need to dust off my old bike.",
  // "No way — a bald eagle? That’s epic.",
  // "Haha, classic Dad! Glad you had fun.",
  // "Good luck! Helmet and bandaids ready?",
  // "That show stressed me out in the best way.",
  // "Do it! Pottery sounds super therapeutic.",
  // "Fresh tomatoes — now I’m craving bruschetta.",
  // "Garage sale? Count me in for the weird knick-knacks.",
  // "LOL your dog is too smart for their own good.",
  // "Apple overload! Time for pie?",
  // "Jazz café? Sounds fancy — send me the name!"
  "Name: Joseph Jewell 🌎 Where: Birmingham, AL 💜 Why you are here: just looking to get more involved in the tech community from both a personal standpoint and for the company I work for, Motion 💼 Career/Work: IT recruiter 🤔 Fun facts: I have 5 kids and a masters in software engineering "
];

// Combine and label messages
function labelMessages(sender, messages) {
  return messages.map(msg => `${sender}: ${msg}`);
}

const allMessages = [
  ...labelMessages("Alice", aliceMessages),
  ...labelMessages("Dana", danaMessages),
  ...labelMessages("Bob", bobMessages),
  ...labelMessages("Eli", eliMessages)
];

// Shuffle function
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

shuffle(allMessages);

// Limit to 50 messages
const limitedMessages = allMessages.slice(0, 5);

// Send messages every 2 seconds
// Helper: Map sender names to Discord user IDs (set these in your .env or config)
const senderUserIds = {
  "Alice": process.env.ALICE_USER_ID,
  "Dana": process.env.DANA_USER_ID,
  "Bob": process.env.BOB_USER_ID,
  "Eli": process.env.ELI_USER_ID
};

// Add sender avatars (optional)
const senderAvatars = {
  "Alice": "https://example.com/alice.png",
  "Dana": "https://example.com/dana.png",
  "Bob": "https://example.com/bob.png",
  "Eli": "https://example.com/eli.png"
};

// Parse sender and message from labeled string
function parseLabeledMessage(labeledMsg) {
  const idx = labeledMsg.indexOf(":");
  return {
    sender: labeledMsg.slice(0, idx),
    message: labeledMsg.slice(idx + 1).trim()
  };
}

async function sendCyclicMessages() {
  const guildId = process.env.GUILD_ID;
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.error('Guild not found in cache. Is the bot in the server?');
      return;
    }

    const channels = Array.from(guild.channels.cache.values()).filter(
      ch => ch.isTextBased() && ch.viewable && !ch.isThread()
    );

    if (channels.length === 0) {
      console.error('No text channels found in the guild.');
      return;
    }

    for (let i = 0; i < limitedMessages.length; i++) {
      const { sender, message } = parseLabeledMessage(limitedMessages[i]);
      const randomChannel = channels[Math.floor(Math.random() * channels.length)];

      // Create a webhook for the channel (or reuse an existing one)
      let webhooks = await randomChannel.fetchWebhooks();
      let webhook = webhooks.find(wh => wh.owner.id === client.user.id);
      if (!webhook) {
        webhook = await randomChannel.createWebhook({
          name: "SimUser",
          avatar: client.user.displayAvatarURL()
        });
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
      await webhook.send({
        content: message,
        username: sender,
        avatarURL: senderAvatars[sender] // Optional: custom avatar per sender
      });
      console.log(`Sent message as ${sender} to #${randomChannel.name}`);
    }

    console.log('Messages sent successfully across random channels.');
  } catch (error) {
    console.error('Error sending dummy messages:', error);
  }
}

// On bot ready
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  sendCyclicMessages();
});

client.login(process.env.BOT_TOKEN);
