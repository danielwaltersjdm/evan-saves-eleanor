'use strict';

// =========================================================
// SETUP
// =========================================================
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

const GRAVITY = 0.6;
const STARTING_LIVES = 3;

const STATE = {
  TITLE: 0, LEVEL_SELECT: 1, PLAYING: 2, CHALLENGE: 3,
  LEVEL_WIN: 4, GAME_OVER: 5, FINAL_WIN: 6,
};
let state = STATE.TITLE;

// =========================================================
// SAVE
// =========================================================
const SAVE_KEY = 'evan-saves-eleanor-v2';
const save = { highestUnlocked: 1, totalCoins: 0, cleared: {} };
try {
  const s = localStorage.getItem(SAVE_KEY);
  if (s) Object.assign(save, JSON.parse(s));
} catch (e) {}
function saveProgress() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
}

// =========================================================
// INPUT
// =========================================================
const keys = {};
const justPressed = {};
function isDown(group) { return group.some(k => keys[k]); }
function pressed(group) {
  for (const k of group) if (justPressed[k]) { return true; }
  return false;
}

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (!keys[k]) justPressed[k] = true;
  keys[k] = true;
  initAudio();
  if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('mousedown', initAudio);
window.addEventListener('touchstart', initAudio, { passive: true });

const K_LEFT  = ['arrowleft',  'a'];
const K_RIGHT = ['arrowright', 'd'];
const K_UP    = ['arrowup',    'w'];
const K_DOWN  = ['arrowdown',  's'];
const K_JUMP  = ['arrowup',    'w', ' '];
const K_A     = ['z'];
const K_B     = ['x'];
const K_CONFIRM = [' ', 'enter'];

// Touch controls
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  document.body.classList.add('touch');
  const tmap = {
    'touch-left':  ['arrowleft'],
    'touch-right': ['arrowright'],
    'touch-down':  ['arrowdown'],
    'touch-jump':  [' ', 'arrowup'],
    'touch-a':     ['z'],
    'touch-b':     ['x'],
  };
  for (const [id, keysForBtn] of Object.entries(tmap)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const down = e => {
      e.preventDefault();
      for (const key of keysForBtn) {
        if (!keys[key]) justPressed[key] = true;
        keys[key] = true;
      }
      el.classList.add('held');
      initAudio();
    };
    const up = e => {
      if (e) e.preventDefault();
      for (const key of keysForBtn) keys[key] = false;
      el.classList.remove('held');
    };
    el.addEventListener('touchstart',  down, { passive: false });
    el.addEventListener('touchend',    up,   { passive: false });
    el.addEventListener('touchcancel', up,   { passive: false });
    el.addEventListener('mousedown',   down);
    el.addEventListener('mouseup',     up);
    el.addEventListener('mouseleave',  up);
  }
}

// Mute button
const muteBtn = document.getElementById('mute-btn');
let isMuted = false;
muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  setMuted(isMuted);
  muteBtn.textContent = isMuted ? '🔇' : '🔊';
  muteBtn.classList.toggle('muted', isMuted);
});

// Canvas click → confirm (for title/level select on touch)
canvas.addEventListener('click', e => {
  initAudio();
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) * (W / rect.width);
  const cy = (e.clientY - rect.top)  * (H / rect.height);
  handleCanvasClick(cx, cy);
});

// =========================================================
// PLAYER + GAME STATE
// =========================================================
const player = {
  x: 60, y: 300, w: 28, h: 36,
  vx: 0, vy: 0,
  onGround: false,
  facing: 1,
  form: 'evan',
  camouflaged: false,
  sprayCooldown: 0,
  invincible: 0,
  fishEaten: 0,
  ridingDolphin: false,
  onVine: null,
  ballRotation: 0,
};

let currentLevel = 1;
let level = null;
let camera = 0;
let lives = STARTING_LIVES;
let coins = 0;
let messageText = '';
let messageTimer = 0;
let sprays = [];
let particles = [];
let selectedLevel = 1;
let levelTransitionTimer = 0;
let challenge = null;

// =========================================================
// HELPERS
// =========================================================
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function showMessage(text, duration = 90) {
  messageText = text;
  messageTimer = duration;
}

function addParticles(x, y, count, color, spread = 4) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * spread,
      vy: (Math.random() - 0.5) * spread - 1,
      life: 30 + Math.random() * 20,
      color,
      size: 2 + Math.random() * 3,
    });
  }
}

function updateParticles() {
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15;
    p.life--;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].life <= 0) particles.splice(i, 1);
  }
}

function drawParticles(useCamera = true) {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / 40);
    ctx.fillStyle = p.color;
    ctx.fillRect((useCamera ? p.x - camera : p.x) - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

// =========================================================
// LEVEL CONTROL
// =========================================================
function startLevel(num, freshLives = true) {
  currentLevel = num;
  level = LEVELS[num - 1];
  // Clone enemies so we can reset alive states each entry
  for (const e of level.enemies) e.alive = true;
  for (const c of level.coins) c.taken = false;
  for (const p of level.powerups) p.taken = false;
  for (const t of level.tubes) t.completed = false;
  if (level.fish)   level.fish.forEach(f => f.eaten = false);
  if (level.whales) level.whales.forEach(w => w.caught = false);
  if (level.dolphin) { level.dolphin.riding = false; level.dolphin.activated = false; }

  player.x = level.spawn.x;
  player.y = level.spawn.y;
  player.vx = 0; player.vy = 0;
  player.w = 28; player.h = 36;
  player.form = 'evan';
  player.camouflaged = false;
  player.invincible = 60;
  player.fishEaten = 0;
  player.ridingDolphin = false;
  player.onVine = null;
  player.facing = 1;
  coins = 0;
  if (freshLives) lives = STARTING_LIVES;
  sprays = [];
  particles = [];
  camera = 0;
  state = STATE.PLAYING;
  updateHUD();
}

function respawnInLevel() {
  lives--;
  if (lives <= 0) {
    sfx.gameOver();
    state = STATE.GAME_OVER;
    levelTransitionTimer = 120;
    return;
  }
  sfx.hurt();
  // Always restart from the level spawn so the player never lands in a pit on respawn
  player.x = level.spawn.x;
  player.y = level.spawn.y;
  player.vx = 0; player.vy = 0;
  player.w = 28; player.h = 36;
  player.form = 'evan';
  player.camouflaged = false;
  player.invincible = 90;
  player.onVine = null;
  player.ridingDolphin = false;
  player.fishEaten = 0;
  camera = 0;
  updateHUD();
}

function completeLevel() {
  sfx.win();
  // Only credit coins the first time a level is cleared, so replaying doesn't double-count
  if (!save.cleared[currentLevel]) {
    save.totalCoins = (save.totalCoins | 0) + coins;
  }
  save.cleared[currentLevel] = true;
  if (currentLevel + 1 > save.highestUnlocked) save.highestUnlocked = Math.min(30, currentLevel + 1);
  saveProgress();
  if (currentLevel === 30) {
    state = STATE.FINAL_WIN;
    sfx.bigWin();
  } else {
    state = STATE.LEVEL_WIN;
  }
  levelTransitionTimer = 150;
}

// =========================================================
// MAIN LOOP
// =========================================================
function loop() {
  update();
  draw();
  for (const k in justPressed) justPressed[k] = false;
  requestAnimationFrame(loop);
}

function update() {
  switch (state) {
    case STATE.TITLE:        updateTitle(); break;
    case STATE.LEVEL_SELECT: updateLevelSelect(); break;
    case STATE.PLAYING:      updatePlaying(); break;
    case STATE.CHALLENGE:    updateChallenge(); break;
    case STATE.LEVEL_WIN:    updateLevelWin(); break;
    case STATE.GAME_OVER:    updateGameOver(); break;
    case STATE.FINAL_WIN:    updateFinalWin(); break;
  }
  if (messageTimer > 0) messageTimer--;
  updateParticles();
}

function draw() {
  switch (state) {
    case STATE.TITLE:        drawTitle(); break;
    case STATE.LEVEL_SELECT: drawLevelSelect(); break;
    case STATE.PLAYING:      drawPlaying(); break;
    case STATE.CHALLENGE:    drawChallenge(); break;
    case STATE.LEVEL_WIN:    drawPlaying(); drawLevelWinOverlay(); break;
    case STATE.GAME_OVER:    drawPlaying(); drawGameOverOverlay(); break;
    case STATE.FINAL_WIN:    drawFinalWin(); break;
  }
}

function handleCanvasClick(cx, cy) {
  if (state === STATE.TITLE) {
    state = STATE.LEVEL_SELECT;
    selectedLevel = save.highestUnlocked;
    sfx.start();
  } else if (state === STATE.LEVEL_SELECT) {
    // Detect grid click
    const gridX = 80, gridY = 130;
    const cellW = 100, cellH = 60;
    for (let i = 0; i < 30; i++) {
      const col = i % 6, row = Math.floor(i / 6);
      const x = gridX + col * cellW;
      const y = gridY + row * cellH;
      if (cx >= x && cx < x + cellW - 8 && cy >= y && cy < y + cellH - 8) {
        const lvl = i + 1;
        if (lvl <= save.highestUnlocked) {
          selectedLevel = lvl;
          sfx.select();
          startLevel(lvl);
        }
        return;
      }
    }
  } else if (state === STATE.GAME_OVER) {
    if (levelTransitionTimer <= 0) {
      startLevel(currentLevel);
    }
  } else if (state === STATE.LEVEL_WIN) {
    if (levelTransitionTimer <= 0) {
      startLevel(currentLevel + 1);
    }
  } else if (state === STATE.FINAL_WIN) {
    if (levelTransitionTimer <= 0) {
      state = STATE.TITLE;
    }
  }
}

// =========================================================
// TITLE
// =========================================================
let titleBob = 0;
function updateTitle() {
  titleBob += 0.05;
  if (pressed(K_CONFIRM)) {
    state = STATE.LEVEL_SELECT;
    selectedLevel = save.highestUnlocked;
    sfx.start();
  }
}

function drawTitle() {
  // Gradient sky background
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1a1a3e');
  g.addColorStop(0.5, '#3a3a6e');
  g.addColorStop(1, '#5a3a8e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Stars
  ctx.fillStyle = 'white';
  for (let i = 0; i < 40; i++) {
    const sx = (i * 97) % W;
    const sy = (i * 53) % (H / 2);
    const tw = 0.5 + 0.5 * Math.sin(titleBob * 2 + i);
    ctx.globalAlpha = tw;
    ctx.fillRect(sx, sy, 2, 2);
  }
  ctx.globalAlpha = 1;

  // Title
  const bobY = Math.sin(titleBob) * 6;
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 8;
  ctx.fillText('Evan Saves', W / 2, 140 + bobY);
  ctx.fillStyle = '#FF6BCB';
  ctx.fillText('Eleanor', W / 2, 210 + bobY);
  ctx.shadowBlur = 0;

  // Story
  ctx.fillStyle = 'white';
  ctx.font = '18px sans-serif';
  ctx.fillText('Eleanor has been captured.', W / 2, 280);
  ctx.fillText('Travel through 5 worlds and 30 levels to save her!', W / 2, 305);

  // Mini characters
  drawMiniEvan(W / 2 - 80, 360 + bobY);
  drawMiniEleanor(W / 2 + 60, 360 + bobY);
  ctx.fillStyle = '#FF6BCB';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('❤', W / 2, 380 + bobY);

  // Press to start
  const blink = Math.floor(Date.now() / 500) % 2 === 0;
  if (blink) {
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('Press SPACE or tap to start', W / 2, 450);
  }

  // Save status
  if (save.highestUnlocked > 1) {
    ctx.fillStyle = '#aaa';
    ctx.font = '14px sans-serif';
    ctx.fillText('Continue from Level ' + save.highestUnlocked, W / 2, 480);
  }
  ctx.textAlign = 'start';
}

function drawMiniEvan(x, y) {
  ctx.fillStyle = '#FFDBAC';
  ctx.fillRect(x + 4, y + 2, 20, 14);
  ctx.fillStyle = '#FF69B4';
  ctx.fillRect(x, y + 16, 28, 22);
  ctx.fillStyle = '#3B2417';
  ctx.fillRect(x + 4, y, 20, 6);
  ctx.fillStyle = 'black';
  ctx.fillRect(x + 10, y + 8, 2, 2);
  ctx.fillRect(x + 17, y + 8, 2, 2);
}

function drawMiniEleanor(x, y) {
  ctx.fillStyle = '#FFDBAC';
  ctx.fillRect(x + 6, y + 4, 20, 14);
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(x + 4, y, 24, 6);
  ctx.fillStyle = '#FFE5F0';
  ctx.fillRect(x, y + 18, 32, 22);
  ctx.fillStyle = 'black';
  ctx.fillRect(x + 11, y + 10, 2, 2);
  ctx.fillRect(x + 19, y + 10, 2, 2);
}

// =========================================================
// LEVEL SELECT
// =========================================================
function updateLevelSelect() {
  if (pressed(K_LEFT))  { selectedLevel = Math.max(1, selectedLevel - 1); sfx.select(); }
  if (pressed(K_RIGHT)) { selectedLevel = Math.min(30, selectedLevel + 1); sfx.select(); }
  if (pressed(K_UP))    { selectedLevel = Math.max(1, selectedLevel - 6); sfx.select(); }
  if (pressed(K_DOWN))  { selectedLevel = Math.min(30, selectedLevel + 6); sfx.select(); }
  if (pressed(K_CONFIRM)) {
    if (selectedLevel <= save.highestUnlocked) startLevel(selectedLevel);
  }
  if (pressed(['escape'])) state = STATE.TITLE;
}

function drawLevelSelect() {
  // Background
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2a2a5e');
  g.addColorStop(1, '#1a1a3e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Choose a Level', W / 2, 60);

  // Grid: 5 rows (one per world), 6 cols
  const gridX = 80, gridY = 130;
  const cellW = 100, cellH = 60;

  // World labels (rows)
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'right';
  for (let w = 0; w < 5; w++) {
    const world = WORLDS[w];
    ctx.fillStyle = worldColor(world.id);
    ctx.fillText(world.name, gridX - 8, gridY + w * cellH + cellH / 2 + 5);
  }

  ctx.textAlign = 'center';
  for (let i = 0; i < 30; i++) {
    const col = i % 6, row = Math.floor(i / 6);
    const x = gridX + col * cellW;
    const y = gridY + row * cellH;
    const lvl = i + 1;
    const unlocked = lvl <= save.highestUnlocked;
    const cleared = save.cleared[lvl];
    const isSel = lvl === selectedLevel;

    ctx.fillStyle = unlocked ? worldColor(WORLDS[row].id) : '#3a3a4e';
    ctx.globalAlpha = unlocked ? 1 : 0.4;
    ctx.fillRect(x, y, cellW - 8, cellH - 8);
    ctx.globalAlpha = 1;

    if (isSel) {
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 4;
      ctx.strokeRect(x - 2, y - 2, cellW - 4, cellH - 4);
    }

    ctx.fillStyle = unlocked ? 'white' : '#666';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(lvl.toString(), x + (cellW - 8) / 2, y + 32);

    if (cleared) {
      ctx.fillStyle = '#FFD700';
      ctx.font = '20px sans-serif';
      ctx.fillText('★', x + (cellW - 8) / 2, y + 52);
    } else if (!unlocked) {
      ctx.fillStyle = '#888';
      ctx.font = '18px sans-serif';
      ctx.fillText('🔒', x + (cellW - 8) / 2, y + 52);
    }
  }

  ctx.fillStyle = '#aaa';
  ctx.font = '14px sans-serif';
  ctx.fillText('Arrows to move • Space to play • Esc for title', W / 2, H - 24);
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('Total coins: ' + (save.totalCoins | 0), W / 2, H - 44);
  ctx.textAlign = 'start';
}

function worldColor(id) {
  return ['#4a8a4a', '#7ab8d8', '#3a6a9a', '#4a6a3a', '#6a3a3a'][id];
}

// =========================================================
// PLAYING
// =========================================================
function updatePlaying() {
  if (pressed(['escape'])) {
    state = STATE.LEVEL_SELECT;
    selectedLevel = currentLevel;
    return;
  }
  if (level.underwater) {
    updateOceanPlayer();
  } else {
    updatePlatformerPlayer();
  }
  updateLevelEntities();
  updateHUD();
}

function updatePlatformerPlayer() {
  const onSlippery = level.slippery && player.onGround;
  let accel = onSlippery ? 0.35 : 1.0;
  let maxSpeed = player.form === 'dog' ? 5 : 3.4;
  const jumpV = player.form === 'dog' ? -14 : -12;
  const friction = onSlippery ? 0.96 : 0.78;

  // Movement input
  let dx = 0;
  if (isDown(K_LEFT))  dx -= 1;
  if (isDown(K_RIGHT)) dx += 1;
  if (dx !== 0) {
    player.facing = dx;
    player.vx += dx * accel;
    player.vx = clamp(player.vx, -maxSpeed, maxSpeed);
  } else if (player.onGround) {
    player.vx *= friction;
    if (Math.abs(player.vx) < 0.1) player.vx = 0;
  } else {
    player.vx *= 0.98;
  }

  // Vine grab
  if (level.vines && !player.onVine) {
    if (isDown(K_UP)) {
      for (const v of level.vines) {
        if (player.x + player.w > v.x - 6 && player.x < v.x + 6 &&
            player.y + player.h > v.yTop && player.y < v.yBot) {
          player.onVine = v;
          player.vx = 0; player.vy = 0;
          sfx.vine();
          break;
        }
      }
    }
  }

  if (player.onVine) {
    // While on vine: climb up/down, locked horizontally to vine x
    player.x = player.onVine.x - player.w / 2;
    player.vx = 0;
    player.vy = 0;
    if (isDown(K_UP))   player.y -= 3.5;
    if (isDown(K_DOWN)) player.y += 3.5;
    if (player.y < player.onVine.yTop) player.y = player.onVine.yTop;
    if (player.y > player.onVine.yBot - player.h) player.y = player.onVine.yBot - player.h;
    // Release vine only by pressing Space
    if (justPressed[' ']) {
      player.onVine = null;
      player.vy = -10;
      let kickX = 0;
      if (isDown(K_LEFT))  kickX = -4;
      if (isDown(K_RIGHT)) kickX = 4;
      player.vx = kickX;
      sfx.jump();
    }
    cameraFollow();
    return;
  }

  if (pressed(K_JUMP) && player.onGround) {
    player.vy = jumpV;
    player.onGround = false;
    sfx.jump();
  }

  // Octopus abilities
  if (player.form === 'octopus') {
    player.camouflaged = isDown(K_B);
    if (isDown(K_A) && player.sprayCooldown <= 0) {
      sprays.push({
        x: player.x + player.w / 2,
        y: player.y + 14,
        vx: 9 * player.facing, vy: 0,
        life: 50,
      });
      player.sprayCooldown = 16;
      sfx.spray();
    }
  } else {
    player.camouflaged = false;
  }
  if (player.sprayCooldown > 0) player.sprayCooldown--;
  if (player.invincible > 0) player.invincible--;

  // Gravity
  player.vy += GRAVITY;
  if (player.vy > 14) player.vy = 14;

  moveAndCollideHorizontal();
  moveAndCollideVertical();

  // Falling off
  if (player.y > H + 100) {
    respawnInLevel();
    return;
  }

  // Tube entry
  if (isDown(K_DOWN)) {
    for (const t of level.tubes) {
      if (t.completed) continue;
      if (player.x + player.w > t.x + 4 && player.x < t.x + t.w - 4 &&
          Math.abs(player.y + player.h - t.y) < 12 && player.onGround) {
        enterTube(t);
        return;
      }
    }
  }

  cameraFollow();
}

function moveAndCollideHorizontal() {
  player.x += player.vx;
  for (const p of level.platforms) {
    if (p.type === 'ceiling') continue;
    if (rectsOverlap(player, p)) {
      if (player.vx > 0) { player.x = p.x - player.w; player.vx = 0; }
      else if (player.vx < 0) { player.x = p.x + p.w; player.vx = 0; }
    }
  }
  for (const t of level.tubes) {
    if (rectsOverlap(player, t)) {
      if (player.vx > 0) { player.x = t.x - player.w; player.vx = 0; }
      else if (player.vx < 0) { player.x = t.x + t.w; player.vx = 0; }
    }
  }
  player.x = clamp(player.x, 0, level.worldW - player.w);
}

function moveAndCollideVertical() {
  player.y += player.vy;
  player.onGround = false;
  for (const p of level.platforms) {
    if (rectsOverlap(player, p)) {
      if (player.vy > 0) {
        player.y = p.y - player.h;
        player.vy = 0;
        player.onGround = true;
      } else if (player.vy < 0) {
        player.y = p.y + p.h;
        player.vy = 0;
      }
    }
  }
  for (const t of level.tubes) {
    if (rectsOverlap(player, t)) {
      if (player.vy > 0) {
        player.y = t.y - player.h;
        player.vy = 0;
        player.onGround = true;
      } else if (player.vy < 0) {
        player.y = t.y + t.h;
        player.vy = 0;
      }
    }
  }
}

function cameraFollow() {
  camera = player.x - W / 2;
  camera = clamp(camera, 0, level.worldW - W);
}

function updateOceanPlayer() {
  // 8-direction swim, no gravity, light drag
  let dx = 0, dy = 0;
  if (isDown(K_LEFT))  dx -= 1;
  if (isDown(K_RIGHT)) dx += 1;
  if (isDown(K_UP))    dy -= 1;
  if (isDown(K_DOWN))  dy += 1;
  if (dx !== 0) player.facing = dx;
  const isShark = player.form === 'shark';
  const speed = isShark ? 4.5 : 3;
  player.vx += dx * 0.5;
  player.vy += dy * 0.5;
  player.vx = clamp(player.vx, -speed, speed);
  player.vy = clamp(player.vy, -speed, speed);
  if (dx === 0) player.vx *= 0.88;
  if (dy === 0) player.vy *= 0.88;

  if (player.ridingDolphin) {
    // Auto-ride to exit
    player.x += 6;
    player.y += (380 - player.y) * 0.05;
    if (player.x + player.w > level.exit.x) {
      completeLevel();
    }
    cameraFollow();
    return;
  }

  // Move and collide with platforms (some breakable as shark)
  player.x += player.vx;
  for (const p of level.platforms) {
    if (rectsOverlap(player, p)) {
      if (p.breakable && isShark) {
        // Smash through
        addParticles(p.x + p.w / 2, p.y + p.h / 2, 12, '#FF8080', 6);
        p.broken = true;
        sfx.break();
      } else if (!p.broken) {
        if (player.vx > 0) { player.x = p.x - player.w; player.vx = 0; }
        else if (player.vx < 0) { player.x = p.x + p.w; player.vx = 0; }
      }
    }
  }
  // Remove broken
  level.platforms = level.platforms.filter(p => !p.broken);

  player.y += player.vy;
  for (const p of level.platforms) {
    if (rectsOverlap(player, p)) {
      if (p.breakable && isShark) {
        addParticles(p.x + p.w / 2, p.y + p.h / 2, 12, '#FF8080', 6);
        p.broken = true;
        sfx.break();
      } else if (!p.broken) {
        if (player.vy > 0) { player.y = p.y - player.h; player.vy = 0; }
        else if (player.vy < 0) { player.y = p.y + p.h; player.vy = 0; }
      }
    }
  }
  level.platforms = level.platforms.filter(p => !p.broken);

  player.x = clamp(player.x, 0, level.worldW - player.w);
  player.y = clamp(player.y, 60, H - 40);

  // Eat fish
  for (const f of level.fish) {
    if (f.eaten) continue;
    f.x += f.vx;
    if (f.x < 180 || f.x > level.worldW - 180) f.vx *= -1;
    if (rectsOverlap(player, f)) {
      f.eaten = true;
      player.fishEaten++;
      coins++;
      sfx.fish();
      addParticles(f.x, f.y, 6, '#FFA0C8');
      if (player.fishEaten >= 5 && player.form !== 'shark') {
        player.form = 'shark';
        player.w = 44; player.h = 26;
        sfx.shark();
        showMessage('SHARK! Now find the DOLPHIN to escape!', 240);
        if (level.dolphin) level.dolphin.activated = true;
      }
    }
  }

  // Catch whales (shark only)
  for (const w of level.whales || []) {
    if (w.caught) continue;
    w.x += w.vx;
    if (w.x < 200 || w.x > level.worldW - 200) w.vx *= -1;
    if (player.form === 'shark' && rectsOverlap(player, w)) {
      w.caught = true;
      coins += 5;
      sfx.whale();
      addParticles(w.x + w.w / 2, w.y + w.h / 2, 18, '#80C0FF', 6);
      showMessage('Whale caught! +5 coins', 90);
    }
  }

  // Coins
  for (const c of level.coins) {
    if (c.taken) continue;
    if (player.x + player.w > c.x - 8 && player.x < c.x + 20 &&
        player.y + player.h > c.y - 8 && player.y < c.y + 20) {
      c.taken = true; coins++;
      sfx.coin();
      addParticles(c.x, c.y, 6, '#FFD700');
    }
  }

  // Enemies (jellies) — bounce non-shark players away with brief invincibility, don't kill them
  for (const e of level.enemies) {
    if (!e.alive) continue;
    if (e.type === 'jelly') {
      e.bobPhase += 0.04;
      e.y = e.baseY + Math.sin(e.bobPhase) * 30;
    }
    if (rectsOverlap(player, e) && player.invincible <= 0 && !player.ridingDolphin) {
      if (player.form === 'shark') {
        e.alive = false;
        sfx.defeat();
        addParticles(e.x + e.w / 2, e.y + e.h / 2, 10, '#FFA0A0');
      } else {
        const dx = (player.x + player.w / 2) - (e.x + e.w / 2);
        const dy = (player.y + player.h / 2) - (e.y + e.h / 2);
        player.vx = dx >= 0 ? 6 : -6;
        player.vy = dy >= 0 ? 3 : -3;
        player.invincible = 50;
        sfx.hurt();
      }
    }
  }

  // Dolphin (activated after shark)
  if (level.dolphin && level.dolphin.activated && !player.ridingDolphin) {
    const d = level.dolphin;
    if (rectsOverlap(player, d)) {
      player.ridingDolphin = true;
      player.form = 'evan';
      player.w = 28; player.h = 36;
      sfx.power();
      showMessage('Riding the dolphin to the other side!', 120);
    }
  }

  // Exit (only via dolphin in ocean)
  // Handled in ridingDolphin block

  cameraFollow();

  if (player.invincible > 0) player.invincible--;
}

function updateLevelEntities() {
  if (level.underwater) return; // ocean entities handled above

  // Enemies
  for (const e of level.enemies) {
    if (!e.alive) continue;
    if (e.type === 'bird') {
      e.flap = (e.flap || 0) + 1;
      e.x += e.vx;
      if (e.x < e.min) { e.x = e.min; e.vx = Math.abs(e.vx); }
      if (e.x + e.w > e.max) { e.x = e.max - e.w; e.vx = -Math.abs(e.vx); }
    } else if (e.type === 'walker' || !e.type) {
      e.x += e.vx;
      if (e.x < e.min) { e.x = e.min; e.vx = Math.abs(e.vx); }
      if (e.x + e.w > e.max) { e.x = e.max - e.w; e.vx = -Math.abs(e.vx); }
    }

    if (rectsOverlap(player, e) && player.invincible <= 0 && !player.camouflaged) {
      const stompZone = (player.y + player.h - e.y) < 20 && player.vy > 2;
      if (stompZone) {
        e.alive = false;
        player.vy = -9;
        sfx.defeat();
        addParticles(e.x + e.w / 2, e.y + e.h / 2, 8, '#FF8080');
      } else {
        if (player.form !== 'evan') {
          // Lose form, gain brief invincibility
          player.form = 'evan';
          player.invincible = 90;
          sfx.hurt();
        } else {
          respawnInLevel();
          return;
        }
      }
    }
  }

  // Sprays
  for (const s of sprays) {
    s.x += s.vx;
    s.life--;
    for (const e of level.enemies) {
      if (!e.alive) continue;
      if (s.x > e.x && s.x < e.x + e.w && s.y > e.y && s.y < e.y + e.h) {
        e.alive = false;
        s.life = 0;
        sfx.defeat();
        addParticles(e.x + e.w / 2, e.y + e.h / 2, 6, '#C8A0FF');
      }
    }
  }
  for (let i = sprays.length - 1; i >= 0; i--) if (sprays[i].life <= 0) sprays.splice(i, 1);

  // Powerups
  for (const p of level.powerups) {
    if (p.taken) continue;
    if (rectsOverlap(player, { x: p.x, y: p.y, w: 28, h: 28 })) {
      p.taken = true;
      player.form = p.type;
      sfx.power();
      showMessage('You became a ' + (p.type === 'dog' ? 'DOG! Run faster!' : 'OCTOPUS! Z=spray, X=hide'), 120);
    }
  }

  // Coins
  for (const c of level.coins) {
    if (c.taken) continue;
    if (player.x + player.w > c.x - 8 && player.x < c.x + 20 &&
        player.y + player.h > c.y - 8 && player.y < c.y + 20) {
      c.taken = true; coins++;
      sfx.coin();
      addParticles(c.x, c.y, 6, '#FFD700');
    }
  }

  // Exit (require all tubes to be completed first)
  if (rectsOverlap(player, level.exit)) {
    const tubesDone = level.tubes.every(t => t.completed);
    if (tubesDone) {
      completeLevel();
    } else if (messageTimer <= 0) {
      showMessage('Finish the green tube challenge first!', 90);
    }
  }

  updateHUD();
}

function updateHUD() {
  document.getElementById('hud-level').textContent = currentLevel;
  document.getElementById('hud-lives').textContent = lives;
  document.getElementById('hud-coins').textContent = coins;
  const f = player.form;
  document.getElementById('hud-form').textContent = f[0].toUpperCase() + f.slice(1);
}

// =========================================================
// DRAWING - PLAYING
// =========================================================
function drawPlaying() {
  drawBackground(level.theme);
  drawPlatforms();
  drawTubes();
  drawCoins();
  drawPowerups();
  drawVines();
  drawOceanEntities();
  drawEnemies();
  drawSprays();
  drawParticles(true);
  drawPlayer();
  drawExit();
  drawMessage();
}

function drawBackground(theme) {
  switch (theme) {
    case 0: drawMeadowBG(); break;
    case 1: drawSnowBG(); break;
    case 2: drawOceanBG(); break;
    case 3: drawJungleBG(); break;
    case 4: drawCastleBG(); break;
  }
}

function drawMeadowBG() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#87CEEB');
  g.addColorStop(1, '#D4F1F9');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Clouds (parallax)
  ctx.fillStyle = 'white';
  for (let i = 0; i < 8; i++) {
    const cx = (i * 350 - camera * 0.4) % (level.worldW + 400);
    const cy = 60 + (i % 3) * 30;
    ctx.fillRect(cx, cy, 80, 18);
    ctx.fillRect(cx + 12, cy - 10, 60, 18);
    ctx.fillRect(cx + 30, cy + 4, 50, 14);
  }
  // Hills
  ctx.fillStyle = '#4A7B2A';
  for (let i = 0; i < 12; i++) {
    const hx = i * 320 - camera * 0.5;
    ctx.beginPath();
    ctx.arc(hx, 460, 130, Math.PI, 0);
    ctx.fill();
  }
}

function drawSnowBG() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#B0E0E6');
  g.addColorStop(1, '#E8F4F8');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Snowflakes
  ctx.fillStyle = 'white';
  const t = Date.now() / 30;
  for (let i = 0; i < 50; i++) {
    const sx = (i * 73 - camera * 0.6 + t * (1 + (i % 3) * 0.2)) % (W + 40);
    const sy = ((i * 41 + t * (1 + (i % 4) * 0.3)) % (H - 60));
    ctx.fillRect(sx, sy, 3, 3);
  }
  // Mountains
  ctx.fillStyle = '#FFFFFF';
  for (let i = 0; i < 12; i++) {
    const hx = i * 400 - camera * 0.4;
    ctx.beginPath();
    ctx.moveTo(hx - 150, 460);
    ctx.lineTo(hx, 250);
    ctx.lineTo(hx + 150, 460);
    ctx.fill();
  }
  ctx.fillStyle = '#C0D0E0';
  for (let i = 0; i < 12; i++) {
    const hx = i * 400 - camera * 0.4;
    ctx.beginPath();
    ctx.moveTo(hx - 30, 280);
    ctx.lineTo(hx, 250);
    ctx.lineTo(hx + 30, 280);
    ctx.fill();
  }
}

function drawOceanBG() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#3A7AB8');
  g.addColorStop(1, '#0D3B66');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Sun rays
  ctx.fillStyle = 'rgba(255,255,200,0.08)';
  for (let i = 0; i < 6; i++) {
    const rx = (i * 200 - camera * 0.3) % (level.worldW + 200);
    ctx.fillRect(rx, 0, 30, H);
  }
  // Bubbles
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  const t = Date.now() / 30;
  for (let i = 0; i < 30; i++) {
    const bx = (i * 97 - camera * 0.7) % (W + 40);
    const by = (H - ((i * 53 + t * (1 + (i % 3) * 0.4)) % (H + 40)));
    ctx.beginPath();
    ctx.arc(bx, by, 3 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  // Seaweed bottom
  ctx.fillStyle = '#1E5F4E';
  for (let i = 0; i < 20; i++) {
    const sx = i * 200 - camera * 0.6;
    const sw = 10 + (Math.sin(t * 0.05 + i) * 3);
    ctx.fillRect(sx, H - 40, sw, 40);
  }
}

function drawJungleBG() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2A4A2A');
  g.addColorStop(1, '#4A6A3A');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Distant trees
  ctx.fillStyle = '#1A3A1A';
  for (let i = 0; i < 14; i++) {
    const tx = i * 220 - camera * 0.4;
    ctx.fillRect(tx, 200, 20, 260);
    ctx.beginPath();
    ctx.arc(tx + 10, 200, 60, 0, Math.PI * 2);
    ctx.fill();
  }
  // Leaves overlay
  ctx.fillStyle = 'rgba(40,80,40,0.4)';
  for (let i = 0; i < 20; i++) {
    const lx = (i * 180 - camera * 0.6) % (W + 100);
    ctx.beginPath();
    ctx.arc(lx, 80 + (i % 3) * 30, 35, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCastleBG() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1a0808');
  g.addColorStop(1, '#3a1a1a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Castle silhouette
  ctx.fillStyle = '#2a1010';
  for (let i = 0; i < 12; i++) {
    const cx = i * 300 - camera * 0.4;
    ctx.fillRect(cx, 280, 200, 180);
    ctx.fillRect(cx + 20, 240, 40, 50);
    ctx.fillRect(cx + 140, 240, 40, 50);
  }
  // Torches glow
  ctx.fillStyle = 'rgba(255,100,0,0.15)';
  const t = Date.now() / 200;
  for (let i = 0; i < 8; i++) {
    const fx = i * 380 - camera * 0.5;
    const r = 50 + Math.sin(t + i) * 8;
    ctx.beginPath();
    ctx.arc(fx, 350, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlatforms() {
  for (const p of level.platforms) {
    if (p.broken) continue;
    if (p.type === 'ground') {
      ctx.fillStyle = level.theme === 4 ? '#3a1a1a' : '#8B4513';
      ctx.fillRect(p.x - camera, p.y, p.w, p.h);
      const top = ['#228B22', '#FFFFFF', '#445555', '#3A6A3A', '#5a2a2a'][level.theme];
      ctx.fillStyle = top;
      ctx.fillRect(p.x - camera, p.y, p.w, 8);
      if (level.theme === 0 || level.theme === 3) {
        ctx.fillStyle = level.theme === 0 ? '#1A5A1A' : '#1A3A1A';
        for (let gx = p.x; gx < p.x + p.w; gx += 14) ctx.fillRect(gx - camera, p.y - 2, 3, 4);
      }
    } else if (p.type === 'jungle-ground') {
      ctx.fillStyle = '#5C3317';
      ctx.fillRect(p.x - camera, p.y, p.w, p.h);
      ctx.fillStyle = '#3A6A3A';
      ctx.fillRect(p.x - camera, p.y, p.w, 8);
      ctx.fillStyle = '#1A3A1A';
      for (let gx = p.x; gx < p.x + p.w; gx += 14) ctx.fillRect(gx - camera, p.y - 2, 3, 4);
    } else if (p.type === 'tree') {
      ctx.fillStyle = '#5C3317';
      ctx.fillRect(p.x - camera, p.y, p.w, p.h);
      ctx.fillStyle = '#3A6A3A';
      ctx.fillRect(p.x - camera, p.y - 4, p.w, 6);
    } else if (p.type === 'float') {
      const color = ['#A0522D', '#B8D8E8', null, null, '#553333'][level.theme] || '#A0522D';
      ctx.fillStyle = color;
      ctx.fillRect(p.x - camera, p.y, p.w, p.h);
      ctx.fillStyle = ['#8B4513', '#90B8C8', '#000', '#000', '#3a1a1a'][level.theme] || '#8B4513';
      ctx.fillRect(p.x - camera, p.y, p.w, 3);
    } else if (p.type === 'coralwall') {
      ctx.fillStyle = '#E08080';
      ctx.fillRect(p.x - camera, p.y, p.w, p.h);
      ctx.fillStyle = '#A04060';
      for (let gx = p.x; gx < p.x + p.w; gx += 8) {
        for (let gy = p.y; gy < p.y + p.h; gy += 8) {
          if ((gx + gy) % 16 === 0) ctx.fillRect(gx - camera, gy, 4, 4);
        }
      }
    } else if (p.type === 'seafloor') {
      ctx.fillStyle = '#B8A060';
      ctx.fillRect(p.x - camera, p.y, p.w, p.h);
    } else if (p.type === 'ceiling') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(p.x - camera, p.y, p.w, p.h);
    }
    if (p.type === 'ground' || p.type === 'jungle-ground' || p.type === 'tree' || p.type === 'float') {
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x - camera, p.y, p.w, p.h);
    }
  }
}

function drawTubes() {
  for (const t of level.tubes) {
    ctx.fillStyle = t.completed ? '#557755' : '#33AA33';
    ctx.fillRect(t.x - camera, t.y, t.w, t.h);
    ctx.fillStyle = t.completed ? '#447744' : '#228822';
    ctx.fillRect(t.x - camera - 4, t.y, t.w + 8, 8);
    ctx.fillStyle = t.completed ? '#557755' : '#33AA33';
    ctx.fillRect(t.x - camera - 4, t.y, 4, 8);
    ctx.fillRect(t.x - camera + t.w, t.y, 4, 8);
    // Inside dark
    if (!t.completed) {
      ctx.fillStyle = '#114411';
      ctx.fillRect(t.x - camera + 4, t.y + 8, t.w - 8, t.h - 8);
      // Arrow hint
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('↓', t.x + t.w / 2 - camera, t.y + 26);
      ctx.textAlign = 'start';
    } else {
      // Show a check mark
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✓', t.x + t.w / 2 - camera, t.y + 30);
      ctx.textAlign = 'start';
    }
  }
}

function drawCoins() {
  const t = Date.now() / 200;
  for (const c of level.coins) {
    if (c.taken) continue;
    const bob = Math.sin(t + c.x) * 3;
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(c.x - camera, c.y + bob, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFB000';
    ctx.beginPath();
    ctx.arc(c.x - camera, c.y + bob, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPowerups() {
  const t = Date.now() / 250;
  for (const p of level.powerups) {
    if (p.taken) continue;
    const bob = Math.sin(t + p.x) * 3;
    const color = p.type === 'dog' ? '#D2691E' : '#9400D3';
    ctx.fillStyle = color;
    ctx.fillRect(p.x - camera, p.y + bob, 28, 28);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - camera, p.y + bob, 28, 28);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.type === 'dog' ? 'D' : 'O', p.x + 14 - camera, p.y + 22 + bob);
    ctx.textAlign = 'start';
  }
}

function drawVines() {
  if (!level.vines) return;
  for (const v of level.vines) {
    ctx.strokeStyle = '#3A6A2A';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(v.x - camera, v.yTop);
    ctx.lineTo(v.x - camera, v.yBot);
    ctx.stroke();
    // Leaves
    ctx.fillStyle = '#4A8A2A';
    for (let yy = v.yTop + 30; yy < v.yBot; yy += 50) {
      ctx.beginPath();
      ctx.arc(v.x - camera + 8 * ((yy / 50) % 2 === 0 ? 1 : -1), yy, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawOceanEntities() {
  if (!level.underwater) return;
  const t = Date.now() / 150;
  // Fish
  for (const f of level.fish || []) {
    if (f.eaten) continue;
    ctx.fillStyle = '#FFA0C8';
    ctx.fillRect(f.x - camera, f.y, f.w, f.h);
    // Tail
    ctx.beginPath();
    if (f.vx > 0) {
      ctx.moveTo(f.x - camera, f.y + 2);
      ctx.lineTo(f.x - camera - 6, f.y + f.h / 2);
      ctx.lineTo(f.x - camera, f.y + f.h - 2);
    } else {
      ctx.moveTo(f.x + f.w - camera, f.y + 2);
      ctx.lineTo(f.x + f.w + 6 - camera, f.y + f.h / 2);
      ctx.lineTo(f.x + f.w - camera, f.y + f.h - 2);
    }
    ctx.fill();
    // Eye
    ctx.fillStyle = 'black';
    const eyeX = f.vx > 0 ? f.x + 16 : f.x + 4;
    ctx.fillRect(eyeX - camera, f.y + 4, 2, 2);
  }
  // Whales
  for (const w of level.whales || []) {
    if (w.caught) continue;
    ctx.fillStyle = '#5080B0';
    ctx.fillRect(w.x - camera, w.y, w.w, w.h);
    // Tail
    ctx.beginPath();
    if (w.vx > 0) {
      ctx.moveTo(w.x - camera, w.y + 4);
      ctx.lineTo(w.x - 16 - camera, w.y + w.h / 2);
      ctx.lineTo(w.x - camera, w.y + w.h - 4);
    } else {
      ctx.moveTo(w.x + w.w - camera, w.y + 4);
      ctx.lineTo(w.x + w.w + 16 - camera, w.y + w.h / 2);
      ctx.lineTo(w.x + w.w - camera, w.y + w.h - 4);
    }
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.fillRect(w.x + (w.vx > 0 ? w.w - 12 : 6) - camera, w.y + 8, 4, 4);
  }
  // Dolphin
  if (level.dolphin) {
    const d = level.dolphin;
    if (d.activated && !player.ridingDolphin) {
      const bob = Math.sin(t * 0.5) * 6;
      ctx.fillStyle = '#80A0C8';
      ctx.fillRect(d.x - camera, d.y + bob, d.w, d.h);
      ctx.beginPath();
      ctx.moveTo(d.x - camera, d.y + 4 + bob);
      ctx.lineTo(d.x - 12 - camera, d.y + d.h / 2 + bob);
      ctx.lineTo(d.x - camera, d.y + d.h - 4 + bob);
      ctx.fill();
      // Eye
      ctx.fillStyle = 'black';
      ctx.fillRect(d.x + d.w - 10 - camera, d.y + 8 + bob, 3, 3);
      // Label
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(d.x + d.w / 2 - 50 - camera, d.y - 26 + bob, 100, 18);
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('RIDE ME!', d.x + d.w / 2 - camera, d.y - 12 + bob);
      ctx.textAlign = 'start';
      // Pulsing arrow above
      const pulse = Math.abs(Math.sin(t * 0.6)) * 6;
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.moveTo(d.x + d.w / 2 - 10 - camera, d.y - 46 - pulse + bob);
      ctx.lineTo(d.x + d.w / 2 + 10 - camera, d.y - 46 - pulse + bob);
      ctx.lineTo(d.x + d.w / 2 - camera, d.y - 30 - pulse + bob);
      ctx.fill();
    }
  }
}

function drawEnemies() {
  for (const e of level.enemies) {
    if (!e.alive) continue;
    if (e.type === 'jelly') {
      ctx.fillStyle = '#FFC0E0';
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(e.x + e.w / 2 - camera, e.y + 8, e.w / 2, Math.PI, 0);
      ctx.fill();
      // Tentacles
      ctx.fillStyle = 'rgba(255,150,200,0.7)';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(e.x + 4 + i * 6 - camera, e.y + 8, 2, 18);
      }
      ctx.globalAlpha = 1;
    } else if (e.type === 'bird') {
      const flap = Math.sin(e.flap * 0.3) * 4;
      ctx.fillStyle = '#333';
      ctx.fillRect(e.x - camera, e.y, e.w, e.h);
      // Wings
      ctx.beginPath();
      ctx.moveTo(e.x - camera, e.y + 4);
      ctx.lineTo(e.x - 8 - camera, e.y - flap);
      ctx.lineTo(e.x - camera, e.y + 10);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(e.x + e.w - camera, e.y + 4);
      ctx.lineTo(e.x + e.w + 8 - camera, e.y - flap);
      ctx.lineTo(e.x + e.w - camera, e.y + 10);
      ctx.fill();
      // Beak
      ctx.fillStyle = '#FFA500';
      const bx = e.vx > 0 ? e.x + e.w : e.x - 6;
      ctx.fillRect(bx - camera, e.y + 8, 6, 4);
      // Eye
      ctx.fillStyle = 'red';
      ctx.fillRect(e.x + (e.vx > 0 ? e.w - 8 : 4) - camera, e.y + 4, 3, 3);
    } else {
      // Poop devil walker
      const ex = e.x - camera;
      const ey = e.y;
      const cx = ex + 14;
      // Brown swirl body (bottom -> top)
      ctx.fillStyle = '#5C3317';
      ctx.beginPath(); ctx.ellipse(cx, ey + 24, 13, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, ey + 17, 10, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, ey + 10, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, ey + 5, 2.5, 0, Math.PI * 2); ctx.fill();
      // Lighter brown highlights
      ctx.fillStyle = '#8B5A2B';
      ctx.beginPath(); ctx.ellipse(cx - 3, ey + 22, 6, 1.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 2, ey + 15, 4, 1.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 1, ey + 9, 2.5, 1, 0, 0, Math.PI * 2); ctx.fill();
      // Red devil horns
      ctx.fillStyle = '#C00000';
      ctx.beginPath();
      ctx.moveTo(cx - 7, ey + 6);
      ctx.lineTo(cx - 5, ey - 2);
      ctx.lineTo(cx - 2, ey + 5);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 2, ey + 5);
      ctx.lineTo(cx + 5, ey - 2);
      ctx.lineTo(cx + 7, ey + 6);
      ctx.fill();
      // Eyes
      ctx.fillStyle = 'white';
      ctx.beginPath(); ctx.arc(cx - 4, ey + 15, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 4, ey + 15, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'black';
      ctx.fillRect(cx - 5, ey + 14, 2, 2);
      ctx.fillRect(cx + 3, ey + 14, 2, 2);
      // Angry eyebrows
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 8, ey + 11); ctx.lineTo(cx - 2, ey + 13);
      ctx.moveTo(cx + 2, ey + 13); ctx.lineTo(cx + 8, ey + 11);
      ctx.stroke();
      // Mean mouth with fangs
      ctx.fillStyle = 'black';
      ctx.fillRect(cx - 4, ey + 21, 8, 2);
      ctx.fillStyle = 'white';
      ctx.fillRect(cx - 3, ey + 23, 1.5, 1.5);
      ctx.fillRect(cx + 1.5, ey + 23, 1.5, 1.5);
    }
  }
}

function drawSprays() {
  for (const s of sprays) {
    ctx.fillStyle = '#C39BD3';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(s.x - camera, s.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9400D3';
    ctx.beginPath();
    ctx.arc(s.x - camera, s.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  if (player.ridingDolphin) {
    const d = level.dolphin;
    ctx.fillStyle = '#80A0C8';
    ctx.fillRect(player.x - 8 - camera, player.y + 8, 50, 22);
    ctx.beginPath();
    ctx.moveTo(player.x - 8 - camera, player.y + 12);
    ctx.lineTo(player.x - 22 - camera, player.y + 20);
    ctx.lineTo(player.x - 8 - camera, player.y + 28);
    ctx.fill();
    drawEvanSprite(player.x, player.y - 12);
    return;
  }
  const x = player.x, y = player.y;
  const alpha = player.camouflaged ? 0.22 :
    (player.invincible > 0 && Math.floor(player.invincible / 6) % 2 === 0 ? 0.4 : 1);
  ctx.globalAlpha = alpha;

  if (player.form === 'shark') drawSharkSprite(x, y);
  else if (player.form === 'octopus') drawOctopusSprite(x, y);
  else if (player.form === 'dog') drawDogSprite(x, y);
  else drawEvanSprite(x, y);

  ctx.globalAlpha = 1;
}

function drawEvanSprite(x, y) {
  ctx.fillStyle = '#FFDBAC';
  ctx.fillRect(x + 4 - camera, y + 2, 20, 14);
  ctx.fillStyle = '#FF69B4';
  ctx.fillRect(x - camera, y + 16, 28, 20);
  ctx.fillStyle = '#3B2417';
  ctx.fillRect(x + 4 - camera, y, 20, 6);
  ctx.fillRect(x + 4 - camera, y + 2, 4, 9);
  ctx.fillRect(x + 20 - camera, y + 2, 4, 9);
  ctx.fillStyle = 'black';
  ctx.fillRect(x + 10 - camera, y + 8, 2, 2);
  ctx.fillRect(x + 17 - camera, y + 8, 2, 2);
  ctx.fillStyle = '#C04080';
  ctx.fillRect(x + 12 - camera, y + 12, 5, 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - camera, y + 16, 28, 20);
}

function drawDogSprite(x, y) {
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(x - camera, y + 12, 28, 24);
  ctx.fillStyle = '#A0522D';
  ctx.fillRect(x + 12 - camera, y, 16, 16);
  ctx.fillStyle = '#5C2C0C';
  ctx.fillRect(x + 11 - camera, y - 2, 5, 6);
  ctx.fillRect(x + 24 - camera, y - 2, 5, 6);
  ctx.fillStyle = 'black';
  ctx.fillRect(x + 17 - camera, y + 5, 2, 2);
  ctx.fillRect(x + 24 - camera, y + 5, 2, 2);
  ctx.fillRect(x + 26 - camera, y + 10, 3, 3);
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(x - 4 - camera, y + 14, 6, 4);
}

function drawOctopusSprite(x, y) {
  ctx.fillStyle = '#9400D3';
  ctx.fillRect(x - camera, y + 4, 28, 22);
  for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 7 - camera, y + 26, 5, 10);
  ctx.fillStyle = 'white';
  ctx.fillRect(x + 6  - camera, y + 10, 5, 5);
  ctx.fillRect(x + 17 - camera, y + 10, 5, 5);
  ctx.fillStyle = 'black';
  ctx.fillRect(x + 8  - camera, y + 12, 2, 2);
  ctx.fillRect(x + 19 - camera, y + 12, 2, 2);
}

function drawSharkSprite(x, y) {
  ctx.fillStyle = '#4A6A8A';
  ctx.fillRect(x - camera, y, 44, 22);
  // Fin
  ctx.beginPath();
  ctx.moveTo(x + 14 - camera, y);
  ctx.lineTo(x + 20 - camera, y - 10);
  ctx.lineTo(x + 26 - camera, y);
  ctx.fill();
  // Tail
  if (player.facing > 0) {
    ctx.beginPath();
    ctx.moveTo(x - camera, y + 2);
    ctx.lineTo(x - 12 - camera, y + 11);
    ctx.lineTo(x - camera, y + 20);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(x + 44 - camera, y + 2);
    ctx.lineTo(x + 56 - camera, y + 11);
    ctx.lineTo(x + 44 - camera, y + 20);
    ctx.fill();
  }
  // Eye + teeth
  ctx.fillStyle = 'black';
  ctx.fillRect(x + (player.facing > 0 ? 32 : 8) - camera, y + 6, 3, 3);
  ctx.fillStyle = 'white';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x + (player.facing > 0 ? 36 : 4) + i * (player.facing > 0 ? -2 : 2) - camera, y + 14, 1.5, 4);
  }
}

function drawExit() {
  if (level.underwater) {
    // Show dock on right
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(level.exit.x - camera, level.exit.y, 32, 38);
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Exit', level.exit.x + 16 - camera, level.exit.y - 6);
    ctx.textAlign = 'start';
    return;
  }
  if (level.hasEleanor) {
    // Eleanor at the exit
    const bob = Math.sin(Date.now() / 400) * 3;
    const x = level.exit.x, y = level.exit.y + bob;
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(x - camera, y, 32, 38);
    ctx.fillStyle = '#FFDBAC';
    ctx.fillRect(x + 6 - camera, y + 4, 20, 14);
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(x + 4 - camera, y, 24, 6);
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(x + 8 - camera, y - 6, 16, 4);
    ctx.fillRect(x + 10 - camera, y - 10, 4, 6);
    ctx.fillRect(x + 14 - camera, y - 12, 4, 8);
    ctx.fillRect(x + 18 - camera, y - 10, 4, 6);
    ctx.fillStyle = 'black';
    ctx.fillRect(x + 11 - camera, y + 10, 2, 2);
    ctx.fillRect(x + 19 - camera, y + 10, 2, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x + 16 - 36 - camera, y - 32, 72, 16);
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Eleanor!', x + 16 - camera, y - 20);
    ctx.textAlign = 'start';
  } else {
    // Goal flag
    const x = level.exit.x;
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(x + 14 - camera, level.exit.y - 30, 4, 68);
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.moveTo(x + 18 - camera, level.exit.y - 30);
    ctx.lineTo(x + 40 - camera, level.exit.y - 20);
    ctx.lineTo(x + 18 - camera, level.exit.y - 10);
    ctx.fill();
    ctx.fillStyle = '#FF6BCB';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GOAL', x + 16 - camera, level.exit.y + 30);
    ctx.textAlign = 'start';
  }
}

function drawMessage() {
  if (messageTimer > 0 && messageText) {
    ctx.font = 'bold 16px sans-serif';
    const w = ctx.measureText(messageText).width + 24;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(W / 2 - w / 2, 16, w, 32);
    ctx.fillStyle = '#FFD700';
    ctx.textAlign = 'center';
    ctx.fillText(messageText, W / 2, 38);
    ctx.textAlign = 'start';
  }
}

// =========================================================
// LEVEL WIN / GAME OVER / FINAL WIN
// =========================================================
function updateLevelWin() {
  if (levelTransitionTimer > 0) levelTransitionTimer--;
  if (levelTransitionTimer <= 0 && (pressed(K_CONFIRM) || pressed(['enter']))) {
    startLevel(currentLevel + 1);
  }
  if (pressed(['escape'])) {
    state = STATE.LEVEL_SELECT;
    selectedLevel = Math.min(30, currentLevel + 1);
  }
}

function drawLevelWinOverlay() {
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 52px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Level Complete!', W / 2, H / 2 - 30);
  ctx.fillStyle = 'white';
  ctx.font = '22px sans-serif';
  ctx.fillText('Coins this level: ' + coins, W / 2, H / 2 + 10);
  ctx.font = '18px sans-serif';
  ctx.fillText('Press SPACE for next level', W / 2, H / 2 + 50);
  ctx.fillStyle = '#aaa';
  ctx.font = '14px sans-serif';
  ctx.fillText('Esc for level select', W / 2, H / 2 + 80);
  ctx.textAlign = 'start';
}

function updateGameOver() {
  if (levelTransitionTimer > 0) levelTransitionTimer--;
  if (levelTransitionTimer <= 0 && (pressed(K_CONFIRM) || pressed(['enter']))) {
    startLevel(currentLevel);
  }
  if (pressed(['escape'])) {
    state = STATE.LEVEL_SELECT;
    selectedLevel = currentLevel;
  }
}

function drawGameOverOverlay() {
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#FF4444';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Game Over', W / 2, H / 2 - 20);
  ctx.fillStyle = 'white';
  ctx.font = '20px sans-serif';
  ctx.fillText('Press SPACE or tap to retry this level', W / 2, H / 2 + 30);
  ctx.fillStyle = '#aaa';
  ctx.font = '14px sans-serif';
  ctx.fillText('Esc for level select', W / 2, H / 2 + 60);
  ctx.textAlign = 'start';
}

function updateFinalWin() {
  if (levelTransitionTimer > 0) levelTransitionTimer--;
  if (levelTransitionTimer <= 0 && (pressed(K_CONFIRM) || pressed(['enter']))) {
    state = STATE.TITLE;
  }
}

function drawFinalWin() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#FFE5F0');
  g.addColorStop(1, '#FFD700');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Confetti
  const t = Date.now() / 30;
  for (let i = 0; i < 80; i++) {
    const colors = ['#FF6BCB', '#FFD700', '#4ECDC4', '#9400D3', '#FF6B6B'];
    ctx.fillStyle = colors[i % colors.length];
    const cx = (i * 71 + t * (1 + (i % 3) * 0.3)) % W;
    const cy = ((i * 47 + t * (1 + (i % 4) * 0.2)) % (H + 40));
    ctx.fillRect(cx, cy, 6, 10);
  }
  ctx.fillStyle = '#FF6BCB';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'white';
  ctx.shadowBlur = 12;
  ctx.fillText('You saved Eleanor!', W / 2, 160);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#5a2080';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('You beat all 30 levels!', W / 2, 220);
  ctx.fillStyle = '#333';
  ctx.font = '20px sans-serif';
  ctx.fillText('Total coins collected: ' + save.totalCoins, W / 2, 270);
  ctx.fillStyle = '#5a2080';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('Press SPACE for the title screen', W / 2, H - 80);
  // Hero shot
  drawMiniEvan(W / 2 - 70, 320);
  drawMiniEleanor(W / 2 + 40, 320);
  ctx.fillStyle = '#FF6BCB';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('❤', W / 2 + 5, 350);
  ctx.textAlign = 'start';
}

// =========================================================
// CHALLENGE ROOMS
// =========================================================
function enterTube(tube) {
  sfx.enter();
  challenge = createChallenge(tube.challenge, tube);
  state = STATE.CHALLENGE;
}

function exitChallenge(success, tube) {
  sfx.exit();
  if (success) {
    tube.completed = true;
    coins += 3;
    showMessage('Challenge done! +3 power coins', 120);
    sfx.coin();
  }
  // Place player just above tube
  player.x = tube.x + tube.w / 2 - player.w / 2;
  player.y = tube.y - player.h - 4;
  player.vx = 0; player.vy = 0;
  player.invincible = 60;
  player.form = 'evan';
  challenge = null;
  state = STATE.PLAYING;
}

function createChallenge(type, tube) {
  const ch = { type, tube, timer: 0, done: false };
  if (type === 'balls') {
    ch.balls = [];
    ch.spawnTimer = 0;
    ch.duration = 60 * 12; // 12 seconds
    ch.player = { x: 100, y: 350, w: 28, h: 36, vx: 0, vy: 0, onGround: false };
  } else if (type === 'spikes') {
    ch.player = { x: 60, y: 320, w: 28, h: 36, vx: 0, vy: 0, onGround: false, facing: 1 };
    ch.spikes = [];
    const spikeCount = 6;
    for (let i = 0; i < spikeCount; i++) {
      ch.spikes.push({
        x: 240 + i * 280 + Math.random() * 30,
        y: 420,
        w: 50,
        h: 30,
      });
    }
    ch.exitX = 240 + spikeCount * 280 + 60;
  } else if (type === 'iceball') {
    ch.player = { x: 60, y: 240, w: 32, h: 32, vx: 0, vy: 0, radius: 18, rotation: 0 };
    ch.balls = [];
    for (let i = 0; i < 9; i++) {
      const onTop = i % 2 === 0;
      const r = 16 + Math.random() * 6;  // 16-22
      ch.balls.push({
        x: 280 + i * 200 + Math.random() * 40,
        y: onTop ? (104 + r) : (436 - r),  // alternate top corridor / bottom corridor
        r,
        vx: (Math.random() > 0.5 ? 1 : -1) * (1.0 + Math.random() * 1.2),
        minX: 200, maxX: 1900,
      });
    }
    ch.exitX = 1980;
  } else if (type === 'swim') {
    ch.player = { x: 60, y: 240, w: 28, h: 36, vx: 0, vy: 0 };
    ch.fish = [];
    for (let i = 0; i < 8; i++) {
      ch.fish.push({
        x: 250 + i * 180 + Math.random() * 60,
        y: 100 + Math.random() * 320,
        w: 22, h: 14,
        vx: (Math.random() > 0.5 ? 1 : -1) * 0.8,
        eaten: false,
      });
    }
    ch.exitX = 1900;
    ch.fishNeeded = 5;
    ch.fishEaten = 0;
  }
  return ch;
}

function updateChallenge() {
  if (!challenge) return;
  if (pressed(['escape'])) {
    exitChallenge(false, challenge.tube);
    return;
  }
  challenge.timer++;
  if (challenge.type === 'balls')    updateBallsChallenge();
  else if (challenge.type === 'spikes')   updateSpikesChallenge();
  else if (challenge.type === 'iceball')  updateIceballChallenge();
  else if (challenge.type === 'swim')     updateSwimChallenge();
}

function challengeFail() {
  sfx.hurt();
  lives--;
  if (lives <= 0) {
    state = STATE.GAME_OVER;
    levelTransitionTimer = 120;
    challenge = null;
    return;
  }
  // Restart challenge from scratch
  challenge = createChallenge(challenge.type, challenge.tube);
  showMessage('Try again!', 60);
}

function challengeSucceed() {
  challenge.done = true;
  exitChallenge(true, challenge.tube);
}

// ----- Balls challenge: dodge incoming balls for duration
function updateBallsChallenge() {
  const ch = challenge;
  const p = ch.player;
  // Movement (platformer style, simpler)
  if (isDown(K_LEFT))  p.vx = -3.5;
  else if (isDown(K_RIGHT)) p.vx = 3.5;
  else p.vx = 0;
  if (pressed(K_JUMP) && p.onGround) { p.vy = -12; p.onGround = false; sfx.jump(); }
  p.vy += GRAVITY;
  if (p.vy > 14) p.vy = 14;
  p.x += p.vx;
  p.y += p.vy;
  if (p.y + p.h >= 420) { p.y = 420 - p.h; p.vy = 0; p.onGround = true; }
  p.x = clamp(p.x, 20, W - 20 - p.w);

  // Spawn balls from right (and sometimes left)
  ch.spawnTimer--;
  if (ch.spawnTimer <= 0) {
    const fromRight = Math.random() > 0.3;
    ch.balls.push({
      x: fromRight ? W + 20 : -20,
      y: 80 + Math.random() * 280,
      vx: fromRight ? -(3 + Math.random() * 3) : (3 + Math.random() * 3),
      r: 12 + Math.random() * 8,
    });
    ch.spawnTimer = 28 - Math.min(20, Math.floor(ch.timer / 60));
  }
  for (const b of ch.balls) b.x += b.vx;
  ch.balls = ch.balls.filter(b => b.x > -40 && b.x < W + 40);

  // Collision
  for (const b of ch.balls) {
    const dx = (p.x + p.w / 2) - b.x;
    const dy = (p.y + p.h / 2) - b.y;
    if (dx * dx + dy * dy < (b.r + 14) * (b.r + 14)) {
      challengeFail();
      return;
    }
  }

  if (ch.timer >= ch.duration) {
    challengeSucceed();
  }
}

// ----- Spikes challenge: auto-traverse right, jump over spike pits
function updateSpikesChallenge() {
  const ch = challenge;
  const p = ch.player;
  // Auto-move to the right at constant speed
  p.vx = 4;
  p.facing = 1;
  if (pressed(K_JUMP) && p.onGround) { p.vy = -13; p.onGround = false; sfx.jump(); }
  p.vy += GRAVITY;
  if (p.vy > 14) p.vy = 14;
  p.x += p.vx; p.y += p.vy;
  if (p.y + p.h >= 460) { p.y = 460 - p.h; p.vy = 0; p.onGround = true; }
  p.x = clamp(p.x, 20, ch.exitX + 50);

  for (const s of ch.spikes) {
    if (p.x + p.w > s.x + 4 && p.x < s.x + s.w - 4 &&
        p.y + p.h > s.y + 4 && p.y < s.y + s.h) {
      challengeFail();
      return;
    }
  }
  if (p.x > ch.exitX) {
    challengeSucceed();
  }
}

// ----- Iceball challenge: float through a corridor, dodging snowballs above and below
function updateIceballChallenge() {
  const ch = challenge;
  const p = ch.player;
  // Horizontal: ice rolling momentum
  if (isDown(K_LEFT))  p.vx -= 0.25;
  if (isDown(K_RIGHT)) p.vx += 0.25;
  p.vx = clamp(p.vx, -6, 6);
  p.vx *= 0.99;
  // Vertical: free up/down movement (no gravity)
  let dy = 0;
  if (isDown(K_JUMP)) dy -= 1;
  if (isDown(K_DOWN)) dy += 1;
  p.vy += dy * 0.5;
  p.vy = clamp(p.vy, -5, 5);
  if (dy === 0) p.vy *= 0.85;
  p.x += p.vx;
  p.y += p.vy;
  // Bounds: corridor between y=104 (ceiling) and y=436 (floor)
  p.x = clamp(p.x, 30, ch.exitX + 50);
  if (p.y < 104) { p.y = 104; p.vy = 0; }
  if (p.y + p.h > 436) { p.y = 436 - p.h; p.vy = 0; }
  p.rotation += p.vx * 0.1;

  for (const b of ch.balls) {
    b.x += b.vx;
    if (b.x < b.minX) { b.x = b.minX; b.vx = Math.abs(b.vx); }
    if (b.x > b.maxX) { b.x = b.maxX; b.vx = -Math.abs(b.vx); }
    const dx = (p.x + p.w / 2) - b.x;
    const dy = (p.y + p.h / 2) - b.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < p.radius + b.r) {
      challengeFail();
      return;
    }
  }

  if (p.x > ch.exitX) challengeSucceed();
}

// ----- Swim mini-challenge: eat 5 fish then reach exit
function updateSwimChallenge() {
  const ch = challenge;
  const p = ch.player;
  let dx = 0, dy = 0;
  if (isDown(K_LEFT))  dx -= 1;
  if (isDown(K_RIGHT)) dx += 1;
  if (isDown(K_UP))    dy -= 1;
  if (isDown(K_DOWN))  dy += 1;
  p.vx += dx * 0.5; p.vy += dy * 0.5;
  p.vx = clamp(p.vx, -4, 4); p.vy = clamp(p.vy, -4, 4);
  if (dx === 0) p.vx *= 0.88;
  if (dy === 0) p.vy *= 0.88;
  p.x += p.vx; p.y += p.vy;
  p.x = clamp(p.x, 20, ch.exitX + 50);
  p.y = clamp(p.y, 60, H - 60);

  for (const f of ch.fish) {
    if (f.eaten) continue;
    f.x += f.vx;
    if (f.x < 100 || f.x > 1900) f.vx *= -1;
    if (p.x + p.w > f.x && p.x < f.x + f.w && p.y + p.h > f.y && p.y < f.y + f.h) {
      f.eaten = true;
      ch.fishEaten++;
      sfx.fish();
    }
  }

  if (ch.fishEaten >= ch.fishNeeded && p.x > ch.exitX) {
    challengeSucceed();
  }
}

// ----- Challenge rendering
function drawChallenge() {
  if (!challenge) return;
  if (challenge.type === 'balls')   drawBallsChallenge();
  else if (challenge.type === 'spikes')  drawSpikesChallenge();
  else if (challenge.type === 'iceball') drawIceballChallenge();
  else if (challenge.type === 'swim')    drawSwimChallenge();
}

function drawCaveBG() {
  ctx.fillStyle = '#2a1a2a';
  ctx.fillRect(0, 0, W, H);
  // Stalactites
  ctx.fillStyle = '#1a0a1a';
  for (let i = 0; i < 12; i++) {
    const sx = i * 70;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx + 30, 0);
    ctx.lineTo(sx + 15, 40);
    ctx.fill();
  }
  ctx.fillStyle = '#3a2a3a';
  ctx.fillRect(0, 420, W, 80);
}

function drawBallsChallenge() {
  const ch = challenge;
  drawCaveBG();
  // Floor
  ctx.fillStyle = '#5a4a5a';
  ctx.fillRect(0, 420, W, 80);
  // Player (drawn as Evan in cave)
  const p = ch.player;
  drawEvanAt(p.x, p.y);
  // Balls
  for (const b of ch.balls) {
    ctx.fillStyle = '#FFB050';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#A06020';
    ctx.beginPath();
    ctx.arc(b.x - b.r / 3, b.y - b.r / 3, b.r / 3, 0, Math.PI * 2);
    ctx.fill();
  }
  drawParticles(false);
  // HUD
  drawChallengeHud('Dodge the balls!', ch.duration - ch.timer);
}

function drawSpikesChallenge() {
  const ch = challenge;
  drawCaveBG();
  ctx.fillStyle = '#5a4a5a';
  ctx.fillRect(0, 460, W, 40);
  const p = ch.player;
  const cx = clamp(p.x - W / 2, 0, ch.exitX);
  ctx.save();
  ctx.translate(-cx, 0);
  // Spikes
  for (const s of ch.spikes) {
    ctx.fillStyle = '#222';
    ctx.fillRect(s.x, 458, s.w, 4);
    ctx.fillStyle = '#888';
    for (let i = 0; i < s.w; i += 12) {
      ctx.beginPath();
      ctx.moveTo(s.x + i, s.y + s.h);
      ctx.lineTo(s.x + i + 6, s.y);
      ctx.lineTo(s.x + i + 12, s.y + s.h);
      ctx.fill();
    }
  }
  // Exit flag
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(ch.exitX + 14, 350, 4, 100);
  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  ctx.moveTo(ch.exitX + 18, 350);
  ctx.lineTo(ch.exitX + 50, 370);
  ctx.lineTo(ch.exitX + 18, 390);
  ctx.fill();
  // Player
  drawEvanAt(p.x, p.y);
  ctx.restore();
  drawChallengeHud('Auto-running! Press SPACE to jump over spikes!', null);
}

function drawIceballChallenge() {
  const ch = challenge;
  // Ice background
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#B0E0E6');
  g.addColorStop(1, '#80B8D0');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Ice ceiling
  ctx.fillStyle = '#D0E8F0';
  ctx.fillRect(0, 0, W, 104);
  ctx.fillStyle = '#A0C8D8';
  for (let i = 0; i < 40; i++) ctx.fillRect(i * 50, 102, 25, 2);
  // Ice floor
  ctx.fillStyle = '#D0E8F0';
  ctx.fillRect(0, 436, W, 64);
  ctx.fillStyle = '#A0C8D8';
  for (let i = 0; i < 40; i++) ctx.fillRect(i * 50, 436, 25, 2);

  const p = ch.player;
  const cx = clamp(p.x - W / 2, 0, ch.exitX);
  ctx.save();
  ctx.translate(-cx, 0);
  // Exit flag in middle of corridor
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(ch.exitX + 14, 200, 4, 200);
  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  ctx.moveTo(ch.exitX + 18, 250);
  ctx.lineTo(ch.exitX + 50, 270);
  ctx.lineTo(ch.exitX + 18, 290);
  ctx.fill();
  // Balls
  for (const b of ch.balls) {
    ctx.fillStyle = '#C8E8F8';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#88B8C8';
    ctx.beginPath();
    ctx.arc(b.x - b.r / 3, b.y - b.r / 3, b.r / 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Player ball (with face)
  ctx.fillStyle = '#FF69B4';
  ctx.beginPath();
  ctx.arc(p.x + p.w / 2, p.y + p.h / 2, p.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
  ctx.rotate(p.rotation);
  ctx.fillStyle = 'black';
  ctx.fillRect(-5, -4, 2, 2);
  ctx.fillRect(3, -4, 2, 2);
  ctx.fillStyle = '#C04080';
  ctx.fillRect(-3, 2, 6, 2);
  ctx.restore();
  drawParticles(false);
  ctx.restore();
  drawChallengeHud('Move UP, DOWN, LEFT, RIGHT to dodge snowballs and reach the flag!', null);
}

function drawSwimChallenge() {
  const ch = challenge;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#3A7AB8');
  g.addColorStop(1, '#0D3B66');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const p = ch.player;
  const cx = clamp(p.x - W / 2, 0, ch.exitX);
  ctx.save();
  ctx.translate(-cx, 0);
  // Fish
  for (const f of ch.fish) {
    if (f.eaten) continue;
    ctx.fillStyle = '#FFA0C8';
    ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.beginPath();
    if (f.vx > 0) { ctx.moveTo(f.x, f.y + 2); ctx.lineTo(f.x - 6, f.y + f.h / 2); ctx.lineTo(f.x, f.y + f.h - 2); }
    else { ctx.moveTo(f.x + f.w, f.y + 2); ctx.lineTo(f.x + f.w + 6, f.y + f.h / 2); ctx.lineTo(f.x + f.w, f.y + f.h - 2); }
    ctx.fill();
  }
  // Exit
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(ch.exitX + 12, 200, 4, 200);
  ctx.beginPath();
  ctx.moveTo(ch.exitX + 16, 200);
  ctx.lineTo(ch.exitX + 50, 220);
  ctx.lineTo(ch.exitX + 16, 240);
  ctx.fill();
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('EXIT', ch.exitX + 30, 260);
  ctx.textAlign = 'start';
  // Player as Evan swimming
  drawEvanAt(p.x, p.y);
  ctx.restore();
  drawChallengeHud('Eat ' + ch.fishNeeded + ' fish, then reach the flag (' + ch.fishEaten + '/' + ch.fishNeeded + ')', null);
}

function drawChallengeHud(text, timer) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(20, 12, W - 40, 30);
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text + '   (Esc to leave)', W / 2, 32);
  if (timer != null) {
    const sec = Math.max(0, Math.ceil(timer / 60));
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('Time left: ' + sec, W / 2, 56);
  }
  ctx.textAlign = 'start';
}

function drawEvanAt(x, y) {
  ctx.fillStyle = '#FFDBAC';
  ctx.fillRect(x + 4, y + 2, 20, 14);
  ctx.fillStyle = '#FF69B4';
  ctx.fillRect(x, y + 16, 28, 20);
  ctx.fillStyle = '#3B2417';
  ctx.fillRect(x + 4, y, 20, 6);
  ctx.fillRect(x + 4, y + 2, 4, 9);
  ctx.fillRect(x + 20, y + 2, 4, 9);
  ctx.fillStyle = 'black';
  ctx.fillRect(x + 10, y + 8, 2, 2);
  ctx.fillRect(x + 17, y + 8, 2, 2);
  ctx.fillStyle = '#C04080';
  ctx.fillRect(x + 12, y + 12, 5, 2);
}

// =========================================================
// GO
// =========================================================
updateHUD();
loop();
