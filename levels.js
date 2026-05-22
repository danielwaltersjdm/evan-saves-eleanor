// Worlds: 6 levels each = 30 total
// 1-6: Meadow, 7-12: Snow, 13-18: Ocean, 19-24: Jungle, 25-30: Castle
const WORLDS = [
  { id: 0, name: 'Meadow', start: 1,  end: 6  },
  { id: 1, name: 'Snow',   start: 7,  end: 12 },
  { id: 2, name: 'Ocean',  start: 13, end: 18 },
  { id: 3, name: 'Jungle', start: 19, end: 24 },
  { id: 4, name: 'Castle', start: 25, end: 30 },
];

function worldOf(num) {
  return WORLDS.find(w => num >= w.start && num <= w.end);
}

// Challenge types: balls, spikes, iceball, swim
const CHALLENGE_TYPES = ['balls', 'spikes', 'iceball', 'swim'];

function seededRand(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 4294967296);
  };
}

const LEVELS = [];
for (let i = 1; i <= 30; i++) LEVELS.push(generateLevel(i));

function generateLevel(num) {
  const world = worldOf(num);
  const diff = (num - 1) / 29; // 0..1
  const rand = seededRand(num * 7919);

  const baseLen = 2200 + Math.floor(diff * 1800);
  const level = {
    num,
    world: world.id,
    worldName: world.name,
    worldW: baseLen,
    platforms: [],
    enemies: [],
    powerups: [],
    coins: [],
    tubes: [],
    vines: [],
    spawn: { x: 60, y: 300 },
    exit: { x: baseLen - 80, y: 422, w: 32, h: 38 },
    hasEleanor: num === 30,
    challengeType: CHALLENGE_TYPES[(num - 1) % CHALLENGE_TYPES.length],
    theme: world.id,
    slippery: world.id === 1,   // snow world: low friction
    underwater: world.id === 2, // ocean world: swim physics
  };

  if (world.id === 2) {
    buildOceanLevel(level, rand, diff);
  } else if (world.id === 3) {
    buildJungleLevel(level, rand, diff);
  } else {
    buildStandardLevel(level, rand, diff);
  }

  return level;
}

function buildStandardLevel(level, rand, diff) {
  const W = level.worldW;
  // Ground with gaps — cap gap width so normal-form Evan can always cross
  const grounds = [];
  let x = 0;
  while (x < W) {
    const segLen = 350 + Math.floor(rand() * 260);
    const segW = Math.min(segLen, W - x);
    const g = { x, y: 460, w: segW, h: 40, type: 'ground' };
    level.platforms.push(g);
    grounds.push(g);
    x += segW;
    if (x < W - 200) {
      const gap = 55 + Math.floor(rand() * (20 + diff * 25));  // 55-100 max
      x += gap;
    } else {
      break;
    }
  }
  // Ensure last 240px is ground for exit (avoid double-stacking)
  if (grounds.length === 0 || grounds[grounds.length - 1].x + grounds[grounds.length - 1].w < W - 240) {
    const g = { x: W - 240, y: 460, w: 240, h: 40, type: 'ground' };
    level.platforms.push(g);
    grounds.push(g);
  }

  // Floating platforms — always placed ABOVE a ground segment so the arc over a gap is clear
  // Height kept in 330-400 range so they're always reachable from a normal jump
  const fpCount = 3 + Math.floor(diff * 6);
  for (let i = 0; i < fpCount; i++) {
    const g = grounds[Math.floor(rand() * grounds.length)];
    if (g.w < 130) continue;
    const fw = 70 + Math.floor(rand() * 70);
    const fx = g.x + 20 + rand() * (g.w - 40 - fw);
    const fy = 330 + Math.floor(rand() * 70);
    level.platforms.push({ x: fx, y: fy, w: fw, h: 16, type: 'float' });
  }

  // Enemies on ground or platforms
  const enemyCount = 2 + Math.floor(diff * 7);
  for (let i = 0; i < enemyCount; i++) {
    const desired = 320 + i * (W - 600) / Math.max(1, enemyCount);
    const ground = level.platforms.find(p =>
      p.type === 'ground' && p.x + 30 < desired && p.x + p.w - 30 > desired);
    if (!ground) continue;
    const range = 80 + Math.floor(rand() * 90);
    const cx = Math.max(ground.x + 20, Math.min(ground.x + ground.w - 20, desired));
    level.enemies.push({
      x: cx, y: ground.y - 28, w: 28, h: 28,
      vx: rand() > 0.5 ? 1.2 : -1.2,
      min: Math.max(ground.x + 4, cx - range / 2),
      max: Math.min(ground.x + ground.w - 32, cx + range / 2),
      alive: true,
      type: 'walker',
    });
  }

  // Coins
  const coinCount = 5 + Math.floor(diff * 6);
  for (let i = 0; i < coinCount; i++) {
    level.coins.push({
      x: 180 + rand() * (W - 360),
      y: 180 + rand() * 230,
      taken: false,
    });
  }

  // Power-ups (occasional)
  if (rand() > 0.4) {
    level.powerups.push({
      x: 280 + rand() * (W - 560),
      y: 230 + rand() * 130,
      type: rand() > 0.5 ? 'dog' : 'octopus',
      taken: false,
    });
  }

  // One required tube per level (except final boss level)
  if (level.num !== 30) {
    placeTube(level, rand);
  }
}

function buildOceanLevel(level, rand, diff) {
  // Side-scrolling underwater. Start on small dock, swim across, exit on dock.
  const W = level.worldW;
  level.platforms.push({ x: 0,        y: 460, w: 140, h: 40, type: 'ground' });
  level.platforms.push({ x: W - 160,  y: 460, w: 160, h: 40, type: 'ground' });
  level.platforms.push({ x: 0,        y: 0,   w: W,   h: 60, type: 'ceiling' }); // top barrier

  // Floor underwater
  level.platforms.push({ x: 140,      y: 470, w: W - 300, h: 30, type: 'seafloor' });

  // Underwater walls (breakable when shark)
  const wallCount = 5 + Math.floor(diff * 5);
  for (let i = 0; i < wallCount; i++) {
    const wx = 220 + i * (W - 540) / wallCount + rand() * 80;
    const wh = 80 + rand() * 120;
    const wy = 80 + rand() * (380 - wh);
    level.platforms.push({
      x: wx, y: wy, w: 30 + rand() * 40, h: wh,
      type: 'coralwall', breakable: true,
    });
  }

  // Fish to eat (need 5 to become shark)
  level.fish = [];
  const fishCount = 9 + Math.floor(diff * 4);
  for (let i = 0; i < fishCount; i++) {
    level.fish.push({
      x: 220 + rand() * (W - 440),
      y: 100 + rand() * 320,
      w: 22, h: 14,
      vx: rand() > 0.5 ? 0.8 : -0.8,
      eaten: false,
    });
  }

  // Whales (only chase-able as shark, give bonus coins)
  level.whales = [];
  const whaleCount = 1 + Math.floor(diff * 2);
  for (let i = 0; i < whaleCount; i++) {
    level.whales.push({
      x: 500 + rand() * (W - 1000),
      y: 200 + rand() * 180,
      w: 90, h: 38,
      vx: 0.4 * (rand() > 0.5 ? 1 : -1),
      caught: false,
    });
  }

  // Dolphin (appears once you become shark) — position near end
  level.dolphin = {
    x: W - 350,
    y: 320,
    w: 56, h: 28,
    riding: false,
    activated: false,
  };

  // Enemy jellyfish that bob
  const jellyCount = 2 + Math.floor(diff * 5);
  for (let i = 0; i < jellyCount; i++) {
    level.enemies.push({
      x: 300 + rand() * (W - 600),
      y: 120 + rand() * 250,
      w: 26, h: 30,
      vx: 0, vy: 0,
      baseY: 0,
      bobPhase: rand() * Math.PI * 2,
      alive: true,
      type: 'jelly',
    });
    const e = level.enemies[level.enemies.length - 1];
    e.baseY = e.y;
  }

  // Coins
  const coinCount = 5 + Math.floor(diff * 5);
  for (let i = 0; i < coinCount; i++) {
    level.coins.push({
      x: 200 + rand() * (W - 400),
      y: 120 + rand() * 320,
      taken: false,
    });
  }

  // No tube in ocean levels — the whole level is the swim challenge
  level.spawn = { x: 60, y: 420 };
  level.exit = { x: W - 80, y: 422, w: 32, h: 38 };
}

function buildJungleLevel(level, rand, diff) {
  const W = level.worldW;
  // Ground with capped gap widths
  const grounds = [];
  let x = 0;
  while (x < W) {
    const segLen = 280 + Math.floor(rand() * 200);
    const segW = Math.min(segLen, W - x);
    const g = { x, y: 460, w: segW, h: 40, type: 'jungle-ground' };
    level.platforms.push(g);
    grounds.push(g);
    x += segW;
    if (x < W - 200) {
      x += 60 + Math.floor(rand() * (20 + diff * 30));  // 60-110 max
    } else {
      break;
    }
  }
  if (grounds.length === 0 || grounds[grounds.length - 1].x + grounds[grounds.length - 1].w < W - 240) {
    const g = { x: W - 240, y: 460, w: 240, h: 40, type: 'jungle-ground' };
    level.platforms.push(g);
    grounds.push(g);
  }

  // Tree platforms — above ground only, reachable from a normal jump
  const treeCount = 4 + Math.floor(diff * 5);
  for (let i = 0; i < treeCount; i++) {
    const g = grounds[Math.floor(rand() * grounds.length)];
    if (g.w < 130) continue;
    const tw = 70 + Math.floor(rand() * 60);
    const tx = g.x + 20 + rand() * (g.w - 40 - tw);
    const ty = 320 + Math.floor(rand() * 80);
    level.platforms.push({ x: tx, y: ty, w: tw, h: 16, type: 'tree' });
  }

  // Vines (hang low enough to grab by jumping from the ground)
  const vineCount = 3 + Math.floor(diff * 5);
  for (let i = 0; i < vineCount; i++) {
    level.vines.push({
      x: 280 + i * (W - 560) / vineCount + (rand() - 0.5) * 60,
      yTop: 40,
      yBot: 380 + rand() * 40,
    });
  }

  // Bird enemies
  const birdCount = 2 + Math.floor(diff * 6);
  for (let i = 0; i < birdCount; i++) {
    level.enemies.push({
      x: 320 + rand() * (W - 640),
      y: 120 + rand() * 220,
      w: 30, h: 22,
      vx: rand() > 0.5 ? 1.6 : -1.6,
      min: 100, max: W - 100,
      alive: true,
      type: 'bird',
      flap: 0,
    });
  }

  // Ground walkers too
  const walkerCount = 1 + Math.floor(diff * 4);
  for (let i = 0; i < walkerCount; i++) {
    const desired = 400 + i * (W - 800) / Math.max(1, walkerCount);
    const ground = level.platforms.find(p =>
      p.type === 'jungle-ground' && p.x + 30 < desired && p.x + p.w - 30 > desired);
    if (!ground) continue;
    level.enemies.push({
      x: desired, y: ground.y - 28, w: 28, h: 28,
      vx: 1.1,
      min: ground.x + 4, max: ground.x + ground.w - 32,
      alive: true, type: 'walker',
    });
  }

  // Coins
  for (let i = 0; i < 6 + Math.floor(diff * 5); i++) {
    level.coins.push({
      x: 200 + rand() * (W - 400),
      y: 100 + rand() * 330,
      taken: false,
    });
  }

  // Power-up sometimes
  if (rand() > 0.5) {
    level.powerups.push({
      x: 300 + rand() * (W - 600),
      y: 250 + rand() * 120,
      type: rand() > 0.5 ? 'dog' : 'octopus',
      taken: false,
    });
  }

  placeTube(level, rand);
}

function placeTube(level, rand) {
  // Tube is solid, so it must never sit in front of the exit or the player can't reach the goal.
  // Require the tube's right edge to be at least 90px before the exit.
  const exitX = level.exit.x;
  const wideGrounds = level.platforms.filter(p =>
    (p.type === 'ground' || p.type === 'jungle-ground') && p.w >= 140);
  if (wideGrounds.length === 0) return;
  // Prefer grounds whose right edge is well before the exit
  const safe = wideGrounds.filter(g => g.x + g.w + 40 < exitX);
  const candidates = safe.length > 0 ? safe : wideGrounds;
  const target = candidates[Math.floor(rand() * candidates.length)];
  const tubeMaxX = exitX - 90; // tube right edge stays >= 40px before exit
  const minStart = target.x + 40;
  const maxStart = Math.min(target.x + target.w - 60, tubeMaxX);
  if (maxStart <= minStart) return; // no safe spot on this ground
  const tx = minStart + Math.floor(rand() * (maxStart - minStart));
  level.tubes.push({
    x: tx, y: target.y - 42, w: 50, h: 42,
    challenge: level.challengeType,
    completed: false,
  });
}
