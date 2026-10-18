// Duck Hunt — Discord Activity
// A light-gun-style shooter played with the mouse (or keyboard). All art is
// drawn procedurally and all sound is synthesized, so there are no assets.

/* ===========================
   CANVAS SETUP
=========================== */

const W = 256;          // logical resolution (NES-like)
const H = 240;
const S = 3;            // internal render scale, keeps text crisp

const canvas = document.getElementById('game');
canvas.width = W * S;
canvas.height = H * S;
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
ctx.scale(S, S);

function fitCanvas() {
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = `${Math.floor(W * scale)}px`;
  canvas.style.height = `${Math.floor(H * scale)}px`;
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

/* ===========================
   CONSTANTS
=========================== */

const SKY = '#3cbcfc';
const SKY_FLEE = '#fcbcb0';
const GRASS_TOP = 152;          // ducks below this line are hidden in the grass
const DUCK_SPAWN_Y = 172;
const DUCK_GROUND_Y = 176;
const FLY_BOUNDS = { left: 10, right: 246, top: 14, bottom: 148 };
const DUCKS_PER_ROUND = 10;
const DUCKS_PER_WAVE = 2;
const SHELLS_PER_WAVE = 3;
const BASE_SPEED = 46;
const PERFECT_BONUS = 10000;

const KINDS = {
  black: { chance: 0.5,  speed: 1.0,  points: [500, 800, 1000],  colors: { b: '#3a3a3a', w: '#a7834f', h: '#1f6b3a' } },
  blue:  { chance: 0.35, speed: 1.25, points: [1000, 1600, 2000], colors: { b: '#3c5ad6', w: '#e6dcc6', h: '#1f6b3a' } },
  red:   { chance: 0.15, speed: 1.5,  points: [1500, 2400, 3000], colors: { b: '#b5332e', w: '#f0c27b', h: '#6b2a1f' } },
};

function quotaForRound(round) {
  if (round <= 10) return 6;
  if (round <= 12) return 7;
  if (round <= 14) return 8;
  if (round <= 19) return 9;
  return 10;
}

function pointsFor(kind, round) {
  const tier = round <= 5 ? 0 : round <= 10 ? 1 : 2;
  return KINDS[kind].points[tier];
}

const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/* ===========================
   SPRITES
=========================== */

// k = outline, b = body, w = wing, h = head, e = eye, y = beak/feet
const DUCK_WINGS_UP = [
  '...kk...........',
  '..kwwk..........',
  '..kwwwk....kkk..',
  '...kwwwk..khhhk.',
  '....kwwwkkhhehk.',
  '.....kwwbbhhhhyy',
  '.kk..kbbbbkhhkyy',
  'kbbkkbbbbbbkk...',
  '.kbbbbbbbbbbk...',
  '..kbbbbbbbbk....',
  '...kkbbbbkk.....',
  '.....kyk.ky.....',
  '................',
];

const DUCK_WINGS_DOWN = [
  '................',
  '................',
  '...........kkk..',
  '..........khhhk.',
  '.........khhehk.',
  '.kk......khhhhyy',
  'kbbk..kkkkkhhkyy',
  'kbbbkkbbbbbbk...',
  '.kbbbbwwwwbbk...',
  '..kbbbkwwwwk....',
  '...kkbbkwwwk....',
  '.......kwwk.....',
  '........kk......',
];

const DUCK_HIT = [
  '......kkkk......',
  '.....khhhhk.....',
  '....khehhehk....',
  '....khhyyhhk....',
  'kk...khyyhk...kk',
  'kwk..kbbbbk..kwk',
  'kwwkkbbbbbbkkwwk',
  '.kwwbbbbbbbbwwk.',
  '..kkbbbbbbbbkk..',
  '....kbbbbbbk....',
  '.....kbbbbk.....',
  '......kyyk......',
  '.......kk.......',
];

const MINI_DUCK = [
  '....ww.',
  '...wwww',
  'w.wwww.',
  'wwwwww.',
  '.wwww..',
];

function makeSprite(rows, palette) {
  const c = document.createElement('canvas');
  c.width = rows[0].length;
  c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (!palette[ch]) return;
      g.fillStyle = palette[ch];
      g.fillRect(x, y, 1, 1);
    });
  });
  return c;
}

const SPRITES = {};
for (const [kind, { colors }] of Object.entries(KINDS)) {
  const palette = { k: '#000', e: '#fff', y: '#f08c1c', ...colors };
  SPRITES[kind] = {
    up: makeSprite(DUCK_WINGS_UP, palette),
    down: makeSprite(DUCK_WINGS_DOWN, palette),
    hit: makeSprite(DUCK_HIT, palette),
  };
}
const MINI_WHITE = makeSprite(MINI_DUCK, { w: '#ffffff' });
const MINI_RED = makeSprite(MINI_DUCK, { w: '#fc4040' });
const MINI_DIM = makeSprite(MINI_DUCK, { w: '#5c5c5c' });

function drawSprite(img, cx, cy, { flipX = false, flipY = false } = {}) {
  ctx.save();
  ctx.translate(Math.round(cx), Math.round(cy));
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(img, -Math.floor(img.width / 2), -Math.floor(img.height / 2));
  ctx.restore();
}

/* ===========================
   SCENERY (pre-rendered once)
=========================== */

function makeLayer(draw) {
  const c = document.createElement('canvas');
  c.width = W * S;
  c.height = H * S;
  const g = c.getContext('2d');
  g.scale(S, S);
  draw(g);
  return c;
}

function circle(g, x, y, r) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

// Deterministic pseudo-random so the scenery looks the same every load
function seeded(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const BACKGROUND = makeLayer((g) => {
  // Tree
  g.fillStyle = '#8c5a2c';
  g.fillRect(27, 66, 11, 110);
  g.fillRect(36, 96, 14, 4);
  g.fillStyle = '#6b4220';
  g.fillRect(27, 66, 3, 110);
  g.fillStyle = '#2f8a2f';
  [[20, 62, 16], [40, 50, 18], [55, 66, 14], [30, 80, 13], [10, 76, 10]].forEach(([x, y, r]) => circle(g, x, y, r));
  g.fillStyle = '#4caa3a';
  [[36, 44, 8], [18, 56, 6], [52, 60, 6]].forEach(([x, y, r]) => circle(g, x, y, r));

  // Bush
  g.fillStyle = '#2f8a2f';
  [[204, 148, 13], [221, 138, 16], [240, 146, 14]].forEach(([x, y, r]) => circle(g, x, y, r));
  g.fillStyle = '#4caa3a';
  [[216, 130, 6], [236, 138, 5]].forEach(([x, y, r]) => circle(g, x, y, r));
});

const FOREGROUND = makeLayer((g) => {
  const rnd = seeded(42);

  // Tall grass with jagged blade tips
  g.fillStyle = '#5ab40a';
  g.beginPath();
  g.moveTo(0, H);
  g.lineTo(0, GRASS_TOP + 4);
  for (let x = 0; x < W; x += 6) {
    g.lineTo(x + 3, GRASS_TOP - 4 + Math.floor(rnd() * 7));
    g.lineTo(x + 6, GRASS_TOP + 5);
  }
  g.lineTo(W, H);
  g.closePath();
  g.fill();

  g.strokeStyle = '#3c8c08';
  g.lineWidth = 1;
  for (let x = 2; x < W; x += 5) {
    g.beginPath();
    g.moveTo(x, 182);
    g.lineTo(x + rnd() * 4 - 2, GRASS_TOP + 6 + rnd() * 10);
    g.stroke();
  }

  // Dirt
  g.fillStyle = '#9c5a14';
  g.fillRect(0, 182, W, H - 182);
  g.fillStyle = '#6b3a0c';
  g.fillRect(0, 182, W, 1);
  g.fillStyle = '#7a4410';
  for (let i = 0; i < 140; i++) {
    g.fillRect(Math.floor(rnd() * W), 184 + Math.floor(rnd() * (H - 186)), 2, 1);
  }
});

/* ===========================
   AUDIO (synthesized)
=========================== */

let audioCtx = null;
let master = null;
let muted = false;

function ensureAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      master = audioCtx.createGain();
      master.gain.value = 0.35;
      master.connect(audioCtx.destination);
    } catch {
      return;
    }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function tone({ type = 'square', from, to = from, dur, vol = 0.2, delay = 0 }) {
  if (!audioCtx || muted) return;
  const t0 = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur, vol = 0.5, cutoff = 2000 }) {
  if (!audioCtx || muted) return;
  const t0 = audioCtx.currentTime;
  const buffer = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * dur), audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
}

function melody(notes, { type = 'square', step = 0.1, dur = 0.12, vol = 0.1 } = {}) {
  notes.forEach((f, i) => tone({ type, from: f, dur, vol, delay: i * step }));
}

const sfx = {
  shot: () => { noise({ dur: 0.28, vol: 0.9, cutoff: 2600 }); tone({ type: 'triangle', from: 180, to: 40, dur: 0.15, vol: 0.5 }); },
  quack: () => {
    tone({ type: 'sawtooth', from: 640, to: 380, dur: 0.08, vol: 0.06 });
    tone({ type: 'sawtooth', from: 580, to: 330, dur: 0.08, vol: 0.06, delay: 0.11 });
  },
  hit: () => tone({ type: 'square', from: 900, to: 1200, dur: 0.08, vol: 0.12 }),
  fall: () => tone({ type: 'square', from: 1400, to: 260, dur: 0.8, vol: 0.05 }),
  thud: () => tone({ type: 'sine', from: 140, to: 50, dur: 0.2, vol: 0.5 }),
  gotIt: () => melody([523, 659, 784, 1047]),
  laugh: () => [0, 1, 2, 3, 4, 5].forEach(i =>
    tone({ type: 'square', from: i % 2 ? 330 : 392, to: i % 2 ? 294 : 349, dur: 0.1, vol: 0.09, delay: i * 0.15 })),
  roundStart: () => melody([392, 523, 659, 523, 784], { step: 0.12 }),
  roundClear: () => melody([523, 659, 784, 1047, 784, 1047], { step: 0.11 }),
  perfect: () => melody([784, 988, 1175, 1568, 1175, 1568, 2093], { step: 0.09 }),
  gameOver: () => melody([392, 330, 262, 196], { type: 'triangle', step: 0.28, dur: 0.3, vol: 0.25 }),
};

/* ===========================
   DISCORD INTEGRATION
=========================== */

// Outside Discord (e.g. opening /duckhunt in a browser to test) the game runs
// in offline mode: fully playable, but scores aren't saved.
const discord = {
  status: 'offline',  // offline | connecting | ready | error
  user: null,
  guildId: null,
  accessToken: null,
  leaderboard: null,
};

async function connectDiscord() {
  if (!new URLSearchParams(window.location.search).has('frame_id')) return;
  discord.status = 'connecting';

  try {
    const { DiscordSDK } = await import('/public/duckhunt/vendor/discord-sdk.js');
    const { clientId } = await (await fetch('/api/duckhunt/config')).json();
    const sdk = new DiscordSDK(clientId);
    await sdk.ready();

    const { code } = await sdk.commands.authorize({
      client_id: clientId,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify'],
    });

    const tokenResp = await fetch('/api/duckhunt/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!tokenResp.ok) throw new Error(`Token exchange failed (${tokenResp.status})`);
    const { access_token } = await tokenResp.json();

    const auth = await sdk.commands.authenticate({ access_token });
    discord.user = auth.user;
    discord.accessToken = access_token;
    discord.guildId = sdk.guildId;
    discord.status = 'ready';
    loadLeaderboard();
  } catch (err) {
    console.error('Discord connection failed:', err);
    discord.status = 'error';
  }
}

async function loadLeaderboard() {
  if (!discord.guildId) return;
  try {
    const resp = await fetch(`/api/duckhunt/leaderboard?guildId=${encodeURIComponent(discord.guildId)}`);
    if (resp.ok) discord.leaderboard = await resp.json();
  } catch { /* leaderboard is optional */ }
}

async function submitScore() {
  if (discord.status !== 'ready') {
    game.result = { status: 'offline' };
    return;
  }
  if (!discord.guildId) {
    game.result = { status: 'dm' };
    return;
  }

  game.result = { status: 'saving' };
  try {
    const resp = await fetch('/api/duckhunt/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: discord.accessToken,
        guildId: discord.guildId,
        score: game.score,
        ducks: game.totalDucks,
        round: game.round,
      }),
    });
    if (!resp.ok) throw new Error(`Score submit failed (${resp.status})`);
    const { player, isPersonalBest } = await resp.json();
    game.result = { status: 'saved', best: player.best_score, isPersonalBest };
    await loadLeaderboard();
  } catch (err) {
    console.error(err);
    game.result = { status: 'error' };
  }
}

/* ===========================
   GAME STATE
=========================== */

const game = {
  phase: 'title',     // title | intro | wave | dog | roundEnd | gameover
  phaseTime: 0,
  clock: 0,
  paused: false,
  round: 1,
  score: 0,
  totalDucks: 0,
  hits: [],           // per-duck result this round: pending | hit | miss
  waveStart: 0,       // index of the first duck in the current wave
  ducks: [],
  shells: SHELLS_PER_WAVE,
  waveTime: 0,
  fleeing: false,
  nextQuack: 0,
  popups: [],
  muzzle: 0,
  dog: null,
  perfect: false,
  result: null,
  titleDuck: null,
};

const aim = { x: W / 2, y: 90 };
const keys = new Set();

function setPhase(phase) {
  game.phase = phase;
  game.phaseTime = 0;
}

function startGame() {
  game.round = 1;
  game.score = 0;
  game.totalDucks = 0;
  game.result = null;
  startRound();
}

function startRound() {
  game.hits = Array(DUCKS_PER_ROUND).fill('pending');
  game.waveStart = 0;
  game.ducks = [];
  sfx.roundStart();
  setPhase('intro');
}

function startWave() {
  game.ducks = [];
  for (let i = 0; i < DUCKS_PER_WAVE; i++) game.ducks.push(makeDuck(game.waveStart + i));
  game.shells = SHELLS_PER_WAVE;
  game.waveTime = 0;
  game.fleeing = false;
  game.nextQuack = 0.3;
  setPhase('wave');
}

function finishWave() {
  const caught = game.ducks.filter(d => d.state === 'down');
  const lastDown = caught[caught.length - 1];
  game.dog = {
    x: clamp(lastDown ? lastDown.x : W / 2, 40, W - 40),
    count: caught.length,
    kinds: caught.map(d => d.kind),
  };
  if (caught.length) sfx.gotIt();
  else sfx.laugh();
  setPhase('dog');
}

function finishRound() {
  const hitCount = game.hits.filter(h => h === 'hit').length;
  if (hitCount < quotaForRound(game.round)) {
    sfx.gameOver();
    setPhase('gameover');
    submitScore();
    return;
  }
  game.perfect = hitCount === DUCKS_PER_ROUND;
  if (game.perfect) {
    game.score += PERFECT_BONUS;
    sfx.perfect();
  } else {
    sfx.roundClear();
  }
  setPhase('roundEnd');
}

/* ===========================
   DUCKS
=========================== */

function pickKind() {
  let r = Math.random();
  for (const [kind, { chance }] of Object.entries(KINDS)) {
    if ((r -= chance) < 0) return kind;
  }
  return 'black';
}

function turnDuck(d) {
  // Keep away from pure horizontal/vertical paths so ducks feel erratic
  const angle = rand(0.35, 1.1);
  d.vx = Math.cos(angle) * d.speed * (Math.random() < 0.5 ? -1 : 1);
  d.vy = Math.sin(angle) * d.speed * (Math.random() < 0.5 ? -1 : 1);
  d.turnIn = rand(0.6, 1.6);
}

function makeDuck(idx, round = game.round) {
  const kind = pickKind();
  const speed = BASE_SPEED * KINDS[kind].speed * Math.min(2.4, 1 + 0.09 * (round - 1));
  const angle = -Math.PI / 2 + (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 0.85);
  return {
    idx,
    kind,
    speed,
    x: rand(48, W - 48),
    y: DUCK_SPAWN_Y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    facing: 1,
    state: 'fly',     // fly | flee | hit | fall | down | gone
    t: 0,
    anim: Math.random(),
    turnIn: rand(0.5, 1.4),
    emerged: false,
  };
}

function updateDuck(d, dt) {
  d.t += dt;
  d.anim += dt * (d.speed / BASE_SPEED);

  if (d.state === 'fly') {
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (d.y < FLY_BOUNDS.bottom) d.emerged = true;
    if (d.x < FLY_BOUNDS.left) { d.x = FLY_BOUNDS.left; d.vx = Math.abs(d.vx); }
    if (d.x > FLY_BOUNDS.right) { d.x = FLY_BOUNDS.right; d.vx = -Math.abs(d.vx); }
    if (d.y < FLY_BOUNDS.top) { d.y = FLY_BOUNDS.top; d.vy = Math.abs(d.vy); }
    if (d.emerged && d.y > FLY_BOUNDS.bottom) { d.y = FLY_BOUNDS.bottom; d.vy = -Math.abs(d.vy); }
    if (d.emerged && (d.turnIn -= dt) <= 0) turnDuck(d);
    if (Math.abs(d.vx) > 1) d.facing = Math.sign(d.vx);
  } else if (d.state === 'flee') {
    d.y -= d.speed * 1.5 * dt;
    if (d.y < -16) {
      d.state = 'gone';
      game.hits[d.idx] = 'miss';
    }
  } else if (d.state === 'hit') {
    if (d.t > 0.4) {
      d.state = 'fall';
      d.t = 0;
      sfx.fall();
    }
  } else if (d.state === 'fall') {
    d.y += 110 * dt;
    if (d.y >= DUCK_GROUND_Y) {
      d.state = 'down';
      sfx.thud();
    }
  }
}

function drawDuck(d) {
  const spr = SPRITES[d.kind];
  if (d.state === 'hit') {
    drawSprite(spr.hit, d.x, d.y);
  } else if (d.state === 'fall') {
    drawSprite(spr.hit, d.x, d.y, { flipY: true, flipX: Math.floor(d.t * 8) % 2 === 0 });
  } else if (d.state === 'fly' || d.state === 'flee') {
    const frame = Math.floor(d.anim * 8) % 2 ? spr.up : spr.down;
    drawSprite(frame, d.x, d.y, { flipX: d.facing < 0 });
  }
}

function fleeAll() {
  game.fleeing = true;
  for (const d of game.ducks) {
    if (d.state === 'fly') d.state = 'flee';
  }
}

/* ===========================
   SHOOTING
=========================== */

function shoot() {
  ensureAudio();
  if (game.paused) {
    game.paused = false;
    return;
  }

  if (game.phase === 'title') {
    startGame();
    return;
  }
  if (game.phase === 'gameover') {
    if (game.phaseTime > 1.5) startGame();
    return;
  }
  if (game.phase !== 'wave' || game.shells <= 0) return;

  const flying = game.ducks.filter(d => d.state === 'fly');
  if (!flying.length) return;

  game.shells--;
  game.muzzle = 0.07;
  sfx.shot();

  const target = flying
    .filter(d => Math.abs(d.x - aim.x) <= 10 && Math.abs(d.y - aim.y) <= 9)
    .sort((a, b) => Math.hypot(a.x - aim.x, a.y - aim.y) - Math.hypot(b.x - aim.x, b.y - aim.y))[0];

  if (target) {
    const points = pointsFor(target.kind, game.round);
    target.state = 'hit';
    target.t = 0;
    game.hits[target.idx] = 'hit';
    game.score += points;
    game.totalDucks++;
    game.popups.push({ x: target.x, y: target.y - 10, text: String(points), t: 0 });
    sfx.hit();
  }

  if (game.shells === 0 && game.ducks.some(d => d.state === 'fly')) fleeAll();
}

/* ===========================
   UPDATE
=========================== */

function update(dt) {
  game.clock += dt;

  // Keyboard aiming
  const dx = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
  const dy = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0);
  if (dx || dy) {
    const fast = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1.8 : 1;
    aim.x = clamp(aim.x + dx * 150 * fast * dt, 0, W);
    aim.y = clamp(aim.y + dy * 150 * fast * dt, 0, H);
  }

  if (game.paused) return;

  game.phaseTime += dt;
  game.muzzle = Math.max(0, game.muzzle - dt);
  game.popups = game.popups.filter(p => (p.t += dt) < 0.9);

  switch (game.phase) {
    case 'title':
      if (!game.titleDuck || game.titleDuck.state !== 'fly') game.titleDuck = makeDuck(0, 1);
      updateDuck(game.titleDuck, dt);
      break;

    case 'intro':
      if (game.phaseTime > 1.8) startWave();
      break;

    case 'wave': {
      game.waveTime += dt;
      game.ducks.forEach(d => updateDuck(d, dt));

      const flyTime = Math.max(3.5, 7 - game.round * 0.25);
      if (!game.fleeing && game.waveTime > flyTime && game.ducks.some(d => d.state === 'fly')) fleeAll();

      if (game.ducks.some(d => d.state === 'fly') && (game.nextQuack -= dt) <= 0) {
        sfx.quack();
        game.nextQuack = rand(0.7, 1.4);
      }

      if (game.ducks.every(d => d.state === 'down' || d.state === 'gone')) finishWave();
      break;
    }

    case 'dog':
      if (game.phaseTime > 1.9) {
        game.waveStart += DUCKS_PER_WAVE;
        if (game.waveStart >= DUCKS_PER_ROUND) finishRound();
        else startWave();
      }
      break;

    case 'roundEnd':
      if (game.phaseTime > 2.6) {
        game.round++;
        startRound();
      }
      break;

    default:
      break;
  }
}

/* ===========================
   DRAWING HELPERS
=========================== */

const FONT = '"Courier New", ui-monospace, monospace';

function text(str, x, y, { size = 8, color = '#fff', align = 'center', shadow = true } = {}) {
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (shadow) {
    ctx.fillStyle = '#000';
    ctx.fillText(str, x + 0.7, y + 0.7);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function panel(x, y, w, h, border = '#fff') {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

const blink = (rate = 2) => Math.floor(game.clock * rate) % 2 === 0;
const pad = (n, len = 6) => String(n).padStart(len, '0');
const truncate = (s, len) => (s.length > len ? `${s.slice(0, len - 1)}…` : s);

function playerName() {
  return discord.user ? (discord.user.global_name || discord.user.username) : null;
}

/* ===========================
   DOG
=========================== */

function ellipse(x, y, rx, ry, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

function drawDog() {
  const { dog } = game;
  if (!dog) return;

  // Rise out of the grass, hold, then sink back down
  const t = game.phaseTime;
  const rise = clamp(Math.min(t / 0.35, (1.9 - t) / 0.35), 0, 1);
  const laughing = dog.count === 0;
  const x = dog.x + (laughing ? Math.sin(t * 22) * 1 : 0);
  const y = 198 - rise * 66;

  // Body
  ctx.fillStyle = '#b7701e';
  ctx.fillRect(x - 13, y + 8, 26, 36);
  ctx.fillStyle = '#f2c888';
  ellipse(x, y + 20, 7, 10);

  // Ears
  ctx.fillStyle = '#6b3a0c';
  ellipse(x - 11, y + 1, 4, 9, 0.3);
  ellipse(x + 11, y + 1, 4, 9, -0.3);

  // Head and snout
  ctx.fillStyle = '#b7701e';
  ellipse(x, y - 2, 10, 9);
  ctx.fillStyle = '#f2c888';
  ellipse(x, y + 4, 7, 5);
  ctx.fillStyle = '#000';
  ellipse(x, y + 1, 2.5, 2);

  if (laughing) {
    // Squinting eyes and a flapping open mouth
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    for (const ex of [x - 4, x + 4]) {
      ctx.beginPath();
      ctx.arc(ex, y - 3, 2, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
    ctx.fillStyle = '#d03030';
    ellipse(x, y + 7, 3.5, 1.5 + Math.abs(Math.sin(t * 14)) * 2.5);
  } else {
    ctx.fillStyle = '#000';
    ellipse(x - 4, y - 4, 1.5, 1.8);
    ellipse(x + 4, y - 4, 1.5, 1.8);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 4.5, y - 5.5, 1, 1);
    ctx.fillRect(x + 3.5, y - 5.5, 1, 1);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y + 5, 3, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();

    // Hold up the catch, one duck per paw
    dog.kinds.forEach((kind, i) => {
      const side = i === 0 ? -1 : 1;
      const px = x + side * 19;
      drawSprite(SPRITES[kind].hit, px, y + 4, { flipY: true });
      ctx.fillStyle = '#b7701e';
      ellipse(px, y - 4, 3.5, 3);
    });
  }
}

/* ===========================
   HUD
=========================== */

function drawHud() {
  text(`R=${game.round}`, 24, 192, { size: 7, color: '#a4e85c' });

  // Shells remaining
  panel(10, 202, 36, 30, '#5ab40a');
  for (let i = 0; i < SHELLS_PER_WAVE; i++) {
    if (i >= game.shells) continue;
    const sx = 16 + i * 9;
    ctx.fillStyle = '#fcb040';
    ctx.fillRect(sx, 209, 4, 6);
    ctx.fillStyle = '#c03018';
    ctx.fillRect(sx, 215, 4, 3);
  }
  text('SHOT', 28, 225, { size: 6, color: '#5ab0fc', shadow: false });

  // Ducks hit this round, with the quota needed to advance underlined
  panel(52, 202, 132, 30, '#5ab40a');
  text('HIT', 66, 211, { size: 7, color: '#a4e85c', shadow: false });
  const quota = quotaForRound(game.round);
  game.hits.forEach((h, i) => {
    const ix = 84 + i * 10;
    const inWave = game.phase === 'wave' && i >= game.waveStart && i < game.waveStart + DUCKS_PER_WAVE;
    let icon = MINI_WHITE;
    if (h === 'hit') icon = MINI_RED;
    else if (h === 'miss') icon = MINI_DIM;
    else if (inWave && !blink(4)) icon = null;
    if (icon) drawSprite(icon, ix, 211);
    if (i < quota) {
      ctx.fillStyle = '#3c7cfc';
      ctx.fillRect(ix - 4, 220, 8, 2);
    }
  });
  text(`NEED ${quota}`, 118, 227, { size: 5, color: '#7c9cfc', shadow: false });

  // Score
  panel(190, 202, 58, 30, '#5ab40a');
  text(pad(game.score), 219, 212, { size: 8 });
  text('SCORE', 219, 225, { size: 6, shadow: false });
}

function drawCrosshair() {
  const x = Math.round(aim.x);
  const y = Math.round(aim.y);
  if (game.muzzle > 0) {
    ctx.fillStyle = 'rgba(255, 255, 220, 0.9)';
    circle(ctx, x, y, 6);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#000';
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.moveTo(x - 11, y); ctx.lineTo(x - 3, y);
  ctx.moveTo(x + 3, y); ctx.lineTo(x + 11, y);
  ctx.moveTo(x, y - 11); ctx.lineTo(x, y - 3);
  ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 11);
  ctx.stroke();
  ctx.fillStyle = '#fc4040';
  ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
}

/* ===========================
   SCREENS
=========================== */

function drawTitle() {
  text('DUCK HUNT', W / 2, 34, { size: 24, color: '#fcb040' });
  text('A DISCORD ACTIVITY', W / 2, 54, { size: 7, color: '#fff' });
  if (blink(1.5)) text('CLICK OR PRESS SPACE TO START', W / 2, 76, { size: 7, color: '#fff' });

  text('MOUSE: AIM    CLICK: SHOOT', W / 2, 96, { size: 6, color: '#e6f4ff' });
  text('ARROWS/WASD: AIM    SPACE: SHOOT', W / 2, 106, { size: 6, color: '#e6f4ff' });
  text('SHIFT: FAST AIM   P: PAUSE   M: MUTE', W / 2, 116, { size: 6, color: '#e6f4ff' });

  let status = 'OFFLINE MODE - SCORES NOT SAVED';
  if (discord.status === 'connecting') status = 'CONNECTING TO DISCORD...';
  else if (discord.status === 'error') status = 'COULD NOT CONNECT - SCORES NOT SAVED';
  else if (discord.status === 'ready') status = `HUNTER: ${truncate(playerName(), 20).toUpperCase()}`;
  text(status, W / 2, 134, { size: 6, color: discord.status === 'ready' ? '#a4e85c' : '#fcbcb0' });
}

function drawBanner(lines) {
  const h = 14 + lines.length * 12;
  panel(W / 2 - 52, 60, 104, h);
  lines.forEach(([str, color], i) => text(str, W / 2, 73 + i * 12, { size: 9, color }));
}

function drawGameOver() {
  panel(36, 20, 184, 138);
  text('GAME OVER', W / 2, 32, { size: 12, color: '#fc4040' });
  text(`SCORE ${pad(game.score)}`, W / 2, 47, { size: 8 });
  text(`ROUND ${game.round}  -  ${game.totalDucks} DUCK${game.totalDucks === 1 ? '' : 'S'}`, W / 2, 58, { size: 6, color: '#e6f4ff' });

  const r = game.result || {};
  const resultLine = {
    saving: ['SAVING SCORE...', '#fff'],
    saved: r.isPersonalBest ? ['NEW PERSONAL BEST!', '#fcb040'] : [`YOUR BEST: ${pad(r.best || 0)}`, '#a4e85c'],
    offline: ['OFFLINE - SCORE NOT SAVED', '#fcbcb0'],
    dm: ['SCORES ARE SAVED IN SERVERS ONLY', '#fcbcb0'],
    error: ['COULD NOT SAVE SCORE', '#fcbcb0'],
  }[r.status] || ['', '#fff'];
  if (resultLine[0] && (r.status !== 'saved' || !r.isPersonalBest || blink(3))) {
    text(resultLine[0], W / 2, 71, { size: 7, color: resultLine[1] });
  }

  const board = discord.leaderboard;
  if (board && board.length) {
    text('TOP HUNTERS', W / 2, 86, { size: 7, color: '#5ab0fc' });
    board.slice(0, 5).forEach((row, i) => {
      const y = 97 + i * 9;
      const mine = discord.user && row.user_id === discord.user.id;
      const color = mine ? '#fcb040' : '#fff';
      text(`${i + 1}. ${truncate(row.username, 16)}`, 52, y, { size: 6, color, align: 'left', shadow: false });
      text(pad(row.best_score), 204, y, { size: 6, color, align: 'right', shadow: false });
    });
  }

  if (game.phaseTime > 1.5 && blink(1.5)) text('CLICK TO PLAY AGAIN', W / 2, 148, { size: 7 });
}

/* ===========================
   RENDER
=========================== */

function render() {
  const fleeingNow = game.phase === 'wave' && game.ducks.some(d => d.state === 'flee');
  ctx.fillStyle = fleeingNow ? SKY_FLEE : SKY;
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(BACKGROUND, 0, 0, W, H);

  if (game.phase === 'title' && game.titleDuck) drawDuck(game.titleDuck);
  if (game.phase === 'wave') game.ducks.forEach(drawDuck);
  if (game.phase === 'dog') drawDog();

  ctx.drawImage(FOREGROUND, 0, 0, W, H);

  game.popups.forEach(p => text(p.text, p.x, p.y - p.t * 10, { size: 6 }));

  if (game.phase === 'title') {
    drawTitle();
  } else {
    drawHud();
    if (game.phase === 'intro') drawBanner([['ROUND', '#fff'], [String(game.round), '#fcb040']]);
    if (fleeingNow) drawBanner([['FLY AWAY', '#fff']]);
    if (game.phase === 'roundEnd') {
      drawBanner(game.perfect
        ? [['PERFECT!!', '#fcb040'], [`BONUS ${PERFECT_BONUS}`, '#fff']]
        : [['ROUND CLEAR', '#a4e85c']]);
    }
    if (game.phase === 'gameover') drawGameOver();
  }

  if (game.paused) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, W, H);
    text('PAUSED', W / 2, 90, { size: 14 });
    text('PRESS P OR CLICK TO RESUME', W / 2, 108, { size: 7 });
  }

  drawCrosshair();
}

/* ===========================
   INPUT
=========================== */

function aimFromPointer(e) {
  const rect = canvas.getBoundingClientRect();
  aim.x = clamp(((e.clientX - rect.left) / rect.width) * W, 0, W);
  aim.y = clamp(((e.clientY - rect.top) / rect.height) * H, 0, H);
}

canvas.addEventListener('pointermove', aimFromPointer);
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  canvas.focus();
  aimFromPointer(e);
  shoot();
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

const SHOOT_KEYS = new Set(['Space', 'Enter', 'KeyJ', 'KeyF']);
const AIM_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight']);

window.addEventListener('keydown', (e) => {
  if (SHOOT_KEYS.has(e.code) || AIM_KEYS.has(e.code)) e.preventDefault();
  if (AIM_KEYS.has(e.code)) keys.add(e.code);
  if (e.repeat) return;

  if (SHOOT_KEYS.has(e.code)) shoot();
  else if (e.code === 'KeyP' || e.code === 'Escape') {
    if (game.phase !== 'title' && game.phase !== 'gameover') game.paused = !game.paused;
  } else if (e.code === 'KeyM') {
    muted = !muted;
  }
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// Pause automatically if the Activity is hidden mid-game
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.phase !== 'title' && game.phase !== 'gameover') game.paused = true;
});

/* ===========================
   MAIN LOOP
=========================== */

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

canvas.focus();
requestAnimationFrame(frame);
connectDiscord();
