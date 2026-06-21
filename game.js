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
  ROPE_CLIMB: 7, DRESSUP: 8, GALLERY: 9, MAZE: 10,
};
let state = STATE.TITLE;

// =========================================================
// SAVE
// =========================================================
const SAVE_KEY = 'evan-saves-eleanor-v2';
const save = { highestUnlocked: 1, totalCoins: 0, cleared: {}, savedEleanors: [] };
try {
  const s = localStorage.getItem(SAVE_KEY);
  if (s) Object.assign(save, JSON.parse(s));
  if (!save.savedEleanors) save.savedEleanors = [];
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

// Fullscreen button
const fullscreenBtn = document.getElementById('fullscreen-btn');
fullscreenBtn.addEventListener('click', () => {
  const el = document.getElementById('game-container');
  const inFS = document.fullscreenElement || document.webkitFullscreenElement;
  if (inFS) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
  } else {
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      const p = req.call(el);
      if (p && p.catch) p.catch(() => {});
    }
  }
});
document.addEventListener('fullscreenchange', () => {
  const inFS = document.fullscreenElement || document.webkitFullscreenElement;
  fullscreenBtn.textContent = inFS ? '⤤' : '⛶';
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
let ropeClimb = null;
let dressup = null;
let maze = null;

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
  if (level.special === 'rope')    { startRopeClimb(); updateHUD(); return; }
  if (level.special === 'dressup') { startDressup();   updateHUD(); return; }
  if (level.special === 'maze')    { startMaze();      updateHUD(); return; }
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
    case STATE.ROPE_CLIMB:   updateRopeClimb(); break;
    case STATE.DRESSUP:      updateDressup(); break;
    case STATE.GALLERY:      updateGallery(); break;
    case STATE.MAZE:         updateMaze(); break;
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
    case STATE.LEVEL_WIN:    if (ropeClimb) drawRopeClimb(); else if (maze) drawMaze(); else drawPlaying(); drawLevelWinOverlay(); break;
    case STATE.GAME_OVER:    if (ropeClimb) drawRopeClimb(); else if (maze) drawMaze(); else drawPlaying(); drawGameOverOverlay(); break;
    case STATE.FINAL_WIN:    drawFinalWin(); break;
    case STATE.ROPE_CLIMB:   drawRopeClimb(); break;
    case STATE.DRESSUP:      drawDressup(); break;
    case STATE.GALLERY:      drawGallery(); break;
    case STATE.MAZE:         drawMaze(); break;
  }
}

function handleCanvasClick(cx, cy) {
  if (state === STATE.TITLE) {
    state = STATE.LEVEL_SELECT;
    selectedLevel = save.highestUnlocked;
    sfx.start();
  } else if (state === STATE.LEVEL_SELECT) {
    // Saved Eleanors button (above the grid, right side)
    if (cx >= 550 && cx < 770 && cy >= 60 && cy < 100) {
      state = STATE.GALLERY;
      sfx.select();
      return;
    }
    const gridX = 80, gridY = 115;
    const cellW = 100, cellH = 55;
    for (let i = 0; i < 32; i++) {
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
  } else if (state === STATE.GALLERY) {
    // Back button
    if (cx >= W / 2 - 80 && cx < W / 2 + 80 && cy >= H - 42 && cy < H - 10) {
      state = STATE.LEVEL_SELECT;
      sfx.select();
    }
  } else if (state === STATE.DRESSUP) {
    const hit = dressupHitTest(cx, cy);
    if (!hit) return;
    if (hit.kind === 'done') {
      if (dressupReady()) {
        let entered = null;
        try { entered = window.prompt("What's her name?", 'Eleanor'); } catch (e) {}
        if (entered === null) { sfx.select(); return; }
        const finalName = (entered.trim() || 'Eleanor');
        save.cleared[31] = true;
        if (save.highestUnlocked < 32) save.highestUnlocked = 32;
        saveCurrentEleanorToGallery(finalName);
        sfx.bigWin();
        // Auto-advance to level 32 (maze home)
        startLevel(32);
      } else {
        sfx.hurt();
      }
      return;
    }
    if (hit.kind === 'tab') {
      dressup.activeTab = hit.index;
      sfx.select();
      return;
    }
    dressup[hit.kind] = hit.index;
    sfx.coin();
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
  drawEvanFigure(x, y);
}

function drawMiniEleanor(x, y) {
  drawEleanorFigure(x, y);
}

// =========================================================
// LEVEL SELECT
// =========================================================
function updateLevelSelect() {
  if (pressed(K_LEFT))  { selectedLevel = Math.max(1, selectedLevel - 1); sfx.select(); }
  if (pressed(K_RIGHT)) { selectedLevel = Math.min(32, selectedLevel + 1); sfx.select(); }
  if (pressed(K_UP))    { selectedLevel = Math.max(1, selectedLevel - 6); sfx.select(); }
  if (pressed(K_DOWN))  { selectedLevel = Math.min(32, selectedLevel + 6); sfx.select(); }
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
  ctx.font = 'bold 32px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Choose a Level', W / 2, 48);

  // Saved Eleanors button (top right)
  const sCount = (save.savedEleanors || []).length;
  ctx.fillStyle = sCount > 0 ? '#FFB0D8' : 'rgba(255,176,216,0.35)';
  ctx.fillRect(550, 60, 220, 40);
  ctx.strokeStyle = '#FFD700';
  ctx.lineWidth = 2;
  ctx.strokeRect(550, 60, 220, 40);
  ctx.fillStyle = '#5A2A4A';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Saved Eleanors', 660, 80);
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('(' + sCount + ' saved)', 660, 95);

  // Grid: 6 rows (one per world + bonus), 6 cols
  const gridX = 80, gridY = 115;
  const cellW = 100, cellH = 55;

  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'right';
  for (let w = 0; w < 6; w++) {
    const world = WORLDS[w];
    ctx.fillStyle = worldColor(world.id);
    ctx.fillText(world.name, gridX - 8, gridY + w * cellH + cellH / 2 + 5);
  }

  ctx.textAlign = 'center';
  for (let i = 0; i < 32; i++) {
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
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(lvl.toString(), x + (cellW - 8) / 2, y + 28);

    if (cleared) {
      ctx.fillStyle = '#FFD700';
      ctx.font = '18px sans-serif';
      ctx.fillText('★', x + (cellW - 8) / 2, y + 46);
    } else if (!unlocked) {
      ctx.fillStyle = '#888';
      ctx.font = '16px sans-serif';
      ctx.fillText('🔒', x + (cellW - 8) / 2, y + 46);
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
  return ['#4a8a4a', '#7ab8d8', '#3a6a9a', '#4a6a3a', '#6a3a3a', '#a04080'][id];
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
      drawDolphinFigure(d.x - camera - 4, d.y + bob, 1);
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
      const cx = e.x + e.w / 2 - camera;
      const ey = e.y;
      const t = Date.now() / 200;
      // Wavy tentacles
      ctx.strokeStyle = 'rgba(255,150,200,0.75)';
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const tx = cx - 8 + i * 4;
        const wig = Math.sin(t + i * 0.6) * 2;
        ctx.beginPath();
        ctx.moveTo(tx, ey + 12);
        ctx.quadraticCurveTo(tx + wig, ey + 20, tx + wig * 1.5, ey + 28);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      // Dome
      ctx.fillStyle = 'rgba(255,170,210,0.85)';
      ctx.beginPath();
      ctx.arc(cx, ey + 12, 13, Math.PI, 0);
      ctx.fill();
      // Inner glow
      ctx.fillStyle = 'rgba(255,220,235,0.55)';
      ctx.beginPath(); ctx.ellipse(cx - 3, ey + 7, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      // Eyes
      ctx.fillStyle = 'black';
      ctx.beginPath(); ctx.arc(cx - 4, ey + 9, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 4, ey + 9, 1.5, 0, Math.PI * 2); ctx.fill();
      // Smile
      ctx.strokeStyle = '#8B3A50';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, ey + 11, 2, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    } else if (e.type === 'bird') {
      const flap = Math.sin(e.flap * 0.3) * 5;
      const cx = e.x + e.w / 2 - camera;
      const cy = e.y + e.h / 2;
      const facing = e.vx > 0 ? 1 : -1;
      // Tail feathers
      ctx.fillStyle = '#3A1A0A';
      ctx.beginPath();
      ctx.moveTo(cx - facing * 8, cy);
      ctx.lineTo(cx - facing * 16, cy - 2);
      ctx.lineTo(cx - facing * 16, cy + 4);
      ctx.lineTo(cx - facing * 8, cy + 4);
      ctx.closePath();
      ctx.fill();
      // Body
      ctx.fillStyle = '#4A2A1A';
      ctx.beginPath(); ctx.ellipse(cx, cy + 1, 10, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      // Back wing
      ctx.fillStyle = '#3A1A0A';
      ctx.beginPath();
      ctx.moveTo(cx - facing * 2, cy);
      ctx.quadraticCurveTo(cx - facing * 4, cy - 5 + flap, cx - facing * 10, cy - 3 + flap);
      ctx.quadraticCurveTo(cx - facing * 6, cy + 3, cx - facing * 2, cy + 3);
      ctx.closePath();
      ctx.fill();
      // Head
      ctx.fillStyle = '#5A3A2A';
      ctx.beginPath(); ctx.arc(cx + facing * 7, cy - 4, 5, 0, Math.PI * 2); ctx.fill();
      // Beak
      ctx.fillStyle = '#FFA500';
      ctx.beginPath();
      ctx.moveTo(cx + facing * 11, cy - 4);
      ctx.lineTo(cx + facing * 17, cy - 3);
      ctx.lineTo(cx + facing * 11, cy - 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#D08000';
      ctx.beginPath();
      ctx.moveTo(cx + facing * 11, cy - 1);
      ctx.lineTo(cx + facing * 15, cy);
      ctx.lineTo(cx + facing * 11, cy + 1);
      ctx.closePath();
      ctx.fill();
      // Eye (angry)
      ctx.fillStyle = 'white';
      ctx.beginPath(); ctx.arc(cx + facing * 7.5, cy - 5, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#C00000';
      ctx.beginPath(); ctx.arc(cx + facing * 8, cy - 5, 1.1, 0, Math.PI * 2); ctx.fill();
      // Angry brow
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + facing * 4, cy - 7);
      ctx.lineTo(cx + facing * 10, cy - 6);
      ctx.stroke();
      // Front wing (flapping)
      ctx.fillStyle = '#3A1A0A';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx + facing * 2, cy - 6 - flap, cx + facing * 10, cy - 4 - flap);
      ctx.quadraticCurveTo(cx + facing * 5, cy + 2, cx + facing * 2, cy + 3);
      ctx.closePath();
      ctx.fill();
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
    drawDolphinFigure(player.x - 12 - camera, player.y + 6, 1);
    drawEvanFigure(player.x - camera, player.y - 14);
    return;
  }
  const x = player.x, y = player.y;
  const alpha = player.camouflaged ? 0.22 :
    (player.invincible > 0 && Math.floor(player.invincible / 6) % 2 === 0 ? 0.4 : 1);
  ctx.globalAlpha = alpha;

  if (player.form === 'shark')        drawSharkFigure(x - camera, y, player.facing);
  else if (player.form === 'octopus') drawOctopusFigure(x - camera, y);
  else if (player.form === 'dog')     drawDogFigure(x - camera, y, player.facing);
  else                                drawEvanFigure(x - camera, y);

  ctx.globalAlpha = 1;
}

function drawEvanSprite(x, y) { drawEvanFigure(x - camera, y); }
function drawDogSprite(x, y)  { drawDogFigure(x - camera, y, player.facing); }
function drawOctopusSprite(x, y) { drawOctopusFigure(x - camera, y); }
function drawSharkSprite(x, y) { drawSharkFigure(x - camera, y, player.facing); }

// === CARTOON SPRITES (screen-space) ===

function drawEvanFigure(sx, sy) {
  const cx = sx + 14;
  // Long flowing brown hair (back)
  ctx.fillStyle = '#5C3A1A';
  ctx.beginPath();
  ctx.ellipse(cx, sy + 22, 14, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  // Head
  ctx.fillStyle = '#FFDBAC';
  ctx.beginPath(); ctx.arc(cx, sy + 13, 8.5, 0, Math.PI * 2); ctx.fill();
  // Bangs swoop
  ctx.fillStyle = '#5C3A1A';
  ctx.beginPath();
  ctx.moveTo(cx - 8, sy + 9);
  ctx.quadraticCurveTo(cx, sy + 4, cx + 8, sy + 7);
  ctx.quadraticCurveTo(cx + 2, sy + 13, cx - 8, sy + 9);
  ctx.fill();
  // Side hair strands flowing past shoulders
  ctx.fillStyle = '#5C3A1A';
  ctx.beginPath();
  ctx.ellipse(cx - 12, sy + 26, 4, 9, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + 12, sy + 26, 4, 9, 0.25, 0, Math.PI * 2);
  ctx.fill();
  // Pink crown with hearts
  ctx.fillStyle = '#FF99CC';
  ctx.beginPath();
  ctx.moveTo(cx - 8, sy + 3);
  ctx.lineTo(cx - 5, sy - 3);
  ctx.lineTo(cx - 2, sy + 3);
  ctx.lineTo(cx, sy - 5);
  ctx.lineTo(cx + 2, sy + 3);
  ctx.lineTo(cx + 5, sy - 3);
  ctx.lineTo(cx + 8, sy + 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(cx - 8, sy + 3, 16, 2.5);
  // Crown jewels
  ctx.fillStyle = '#E04A95';
  ctx.beginPath(); ctx.arc(cx, sy + 4, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFD700';
  ctx.beginPath(); ctx.arc(cx - 5, sy + 4, 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 5, sy + 4, 0.9, 0, Math.PI * 2); ctx.fill();
  // Eyes
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.arc(cx - 3.2, sy + 13, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 3.2, sy + 13, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1A3050';
  ctx.beginPath(); ctx.arc(cx - 2.9, sy + 13.3, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 3.5, sy + 13.3, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'white';
  ctx.fillRect(cx - 3.3, sy + 12.5, 0.8, 0.8);
  ctx.fillRect(cx + 3.1, sy + 12.5, 0.8, 0.8);
  // Eyelashes
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - 5, sy + 11); ctx.lineTo(cx - 4, sy + 10);
  ctx.moveTo(cx + 5, sy + 11); ctx.lineTo(cx + 4, sy + 10);
  ctx.stroke();
  // Cheeks
  ctx.fillStyle = 'rgba(255,140,170,0.6)';
  ctx.beginPath(); ctx.arc(cx - 6, sy + 16, 1.7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 6, sy + 16, 1.7, 0, Math.PI * 2); ctx.fill();
  // Smile
  ctx.strokeStyle = '#7A2A40';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, sy + 17, 2.3, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  // Princess dress (pink with purple bodice)
  ctx.fillStyle = '#FF69B4';
  ctx.beginPath();
  ctx.moveTo(cx - 7, sy + 22);
  ctx.lineTo(cx + 7, sy + 22);
  ctx.quadraticCurveTo(cx + 14, sy + 32, cx + 14, sy + 36);
  ctx.lineTo(cx - 14, sy + 36);
  ctx.quadraticCurveTo(cx - 14, sy + 32, cx - 7, sy + 22);
  ctx.closePath();
  ctx.fill();
  // Dress shading
  ctx.fillStyle = 'rgba(160,40,100,0.25)';
  ctx.beginPath();
  ctx.moveTo(cx + 3, sy + 22);
  ctx.quadraticCurveTo(cx + 14, sy + 32, cx + 14, sy + 36);
  ctx.lineTo(cx + 5, sy + 36);
  ctx.closePath();
  ctx.fill();
  // Purple bodice
  ctx.fillStyle = '#C040A0';
  ctx.beginPath();
  ctx.moveTo(cx - 6, sy + 22);
  ctx.lineTo(cx + 6, sy + 22);
  ctx.lineTo(cx + 6, sy + 26);
  ctx.lineTo(cx - 6, sy + 26);
  ctx.closePath();
  ctx.fill();
  // V-neck
  ctx.fillStyle = '#FFDBAC';
  ctx.beginPath();
  ctx.moveTo(cx - 3, sy + 22);
  ctx.lineTo(cx, sy + 25);
  ctx.lineTo(cx + 3, sy + 22);
  ctx.closePath();
  ctx.fill();
  // Gold sparkles on skirt
  ctx.fillStyle = '#FFD700';
  ctx.beginPath(); ctx.arc(cx - 6, sy + 30, 0.8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 4, sy + 28, 0.8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, sy + 34, 0.8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 7, sy + 32, 0.8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx - 8, sy + 33, 0.8, 0, Math.PI * 2); ctx.fill();
  // Arms
  ctx.fillStyle = '#FFDBAC';
  ctx.beginPath(); ctx.ellipse(cx - 10, sy + 25, 2, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 10, sy + 25, 2, 5, 0, 0, Math.PI * 2); ctx.fill();
  // Gold slippers
  ctx.fillStyle = '#FFD700';
  ctx.beginPath(); ctx.ellipse(cx - 3, sy + 36, 2.8, 1.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 3, sy + 36, 2.8, 1.3, 0, 0, Math.PI * 2); ctx.fill();
}

function drawDogFigure(sx, sy, facing) {
  const cx = sx + 14;
  facing = facing || 1;
  // Tail (wagging)
  const wag = Math.sin(Date.now() / 100) * 3;
  ctx.fillStyle = '#A0522D';
  ctx.beginPath();
  ctx.ellipse(cx - facing * 12, sy + 20 + wag, 2.5, 5.5, facing * 0.5, 0, Math.PI * 2);
  ctx.fill();
  // Body
  ctx.fillStyle = '#A0522D';
  ctx.beginPath(); ctx.ellipse(cx, sy + 24, 12, 9, 0, 0, Math.PI * 2); ctx.fill();
  // Belly
  ctx.fillStyle = '#D8AC7A';
  ctx.beginPath(); ctx.ellipse(cx, sy + 27, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
  // Back ear
  ctx.fillStyle = '#5C2C0C';
  ctx.beginPath();
  ctx.ellipse(cx + facing * 3, sy + 5, 3.5, 5.5, -facing * 0.4, 0, Math.PI * 2);
  ctx.fill();
  // Head
  const hx = cx + facing * 6;
  ctx.fillStyle = '#A0522D';
  ctx.beginPath(); ctx.arc(hx, sy + 11, 8, 0, Math.PI * 2); ctx.fill();
  // Front ear
  ctx.fillStyle = '#5C2C0C';
  ctx.beginPath();
  ctx.ellipse(hx + facing * 1, sy + 6, 3.2, 5.2, facing * 0.3, 0, Math.PI * 2);
  ctx.fill();
  // Snout
  ctx.fillStyle = '#E8C09A';
  ctx.beginPath(); ctx.ellipse(hx + facing * 5, sy + 14, 5, 3.6, 0, 0, Math.PI * 2); ctx.fill();
  // Nose
  ctx.fillStyle = '#1A1A1A';
  ctx.beginPath(); ctx.ellipse(hx + facing * 8.5, sy + 13, 1.8, 1.5, 0, 0, Math.PI * 2); ctx.fill();
  // Mouth
  ctx.strokeStyle = '#5A2C0C';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx + facing * 5, sy + 15);
  ctx.lineTo(hx + facing * 7, sy + 16);
  ctx.lineTo(hx + facing * 5, sy + 16.5);
  ctx.stroke();
  // Tongue
  ctx.fillStyle = '#FF8AA0';
  ctx.beginPath(); ctx.ellipse(hx + facing * 7, sy + 16, 1.5, 0.9, 0, 0, Math.PI * 2); ctx.fill();
  // Eye
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.arc(hx + facing * 2, sy + 9, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1A1A1A';
  ctx.beginPath(); ctx.arc(hx + facing * 2.5, sy + 9.3, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'white';
  ctx.fillRect(hx + facing * 2, sy + 8.5, 0.7, 0.7);
  // Legs
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(cx - 9, sy + 30, 3, 6);
  ctx.fillRect(cx - 3, sy + 30, 3, 6);
  ctx.fillRect(cx + 3, sy + 30, 3, 6);
  ctx.fillRect(cx + 7, sy + 30, 3, 6);
  // Paws
  ctx.fillStyle = '#5C2C0C';
  for (const px of [cx - 9, cx - 3, cx + 3, cx + 7]) {
    ctx.beginPath();
    ctx.ellipse(px + 1.5, sy + 35.5, 2, 1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawOctopusFigure(sx, sy) {
  const cx = sx + 14;
  const t = Date.now() / 200;
  // Tentacles (behind body)
  ctx.strokeStyle = '#9400D3';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const tx = cx - 10 + i * 4;
    const wig = Math.sin(t + i * 0.6) * 2.5;
    ctx.beginPath();
    ctx.moveTo(tx, sy + 24);
    ctx.quadraticCurveTo(tx + wig, sy + 30, tx + wig * 1.6, sy + 36);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  // Head dome
  ctx.fillStyle = '#9400D3';
  ctx.beginPath();
  ctx.arc(cx, sy + 16, 12, Math.PI, Math.PI * 2);
  ctx.fill();
  // Body bottom
  ctx.beginPath();
  ctx.ellipse(cx, sy + 16, 12, 9, 0, 0, Math.PI);
  ctx.fill();
  // Belly highlight
  ctx.fillStyle = '#C46BE6';
  ctx.beginPath(); ctx.ellipse(cx, sy + 19, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
  // Eyes
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.arc(cx - 4, sy + 13, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 4, sy + 13, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'black';
  ctx.beginPath(); ctx.arc(cx - 3.6, sy + 13.4, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 4.4, sy + 13.4, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'white';
  ctx.fillRect(cx - 4, sy + 12.5, 0.8, 0.8);
  ctx.fillRect(cx + 4, sy + 12.5, 0.8, 0.8);
  // Smile
  ctx.strokeStyle = '#5A0080';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, sy + 17, 2.5, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}

function drawSharkFigure(sx, sy, facing) {
  const cx = sx + 22;
  const cy = sy + 13;
  facing = facing || 1;
  // Tail
  ctx.fillStyle = '#5680A8';
  if (facing > 0) {
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy);
    ctx.lineTo(cx - 32, cy - 10);
    ctx.lineTo(cx - 26, cy);
    ctx.lineTo(cx - 32, cy + 10);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx + 20, cy);
    ctx.lineTo(cx + 32, cy - 10);
    ctx.lineTo(cx + 26, cy);
    ctx.lineTo(cx + 32, cy + 10);
    ctx.closePath();
    ctx.fill();
  }
  // Body
  ctx.beginPath(); ctx.ellipse(cx, cy, 22, 10, 0, 0, Math.PI * 2); ctx.fill();
  // Belly
  ctx.fillStyle = '#C0DCEE';
  ctx.beginPath(); ctx.ellipse(cx, cy + 4, 17, 5, 0, 0, Math.PI * 2); ctx.fill();
  // Dorsal fin
  ctx.fillStyle = '#3A6080';
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy - 7);
  ctx.lineTo(cx + 2, cy - 16);
  ctx.lineTo(cx + 7, cy - 7);
  ctx.closePath();
  ctx.fill();
  // Side fin
  ctx.beginPath();
  ctx.ellipse(cx - facing * 3, cy + 7, 4, 2, facing * 0.3, 0, Math.PI * 2);
  ctx.fill();
  // Gills
  ctx.strokeStyle = '#3A6080';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + facing * (-2 - i * 3), cy - 3);
    ctx.lineTo(cx + facing * (-2 - i * 3), cy + 3);
    ctx.stroke();
  }
  // Eye
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.arc(cx + facing * 11, cy - 4, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'black';
  ctx.beginPath(); ctx.arc(cx + facing * 12, cy - 4, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'white';
  ctx.fillRect(cx + facing * 11.5, cy - 4.5, 0.8, 0.8);
  // Mouth
  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx + facing * 8, cy + 2);
  ctx.quadraticCurveTo(cx + facing * 14, cy + 4, cx + facing * 18, cy);
  ctx.stroke();
  // Teeth
  ctx.fillStyle = 'white';
  for (let i = 0; i < 4; i++) {
    const tx = cx + facing * (10 + i * 2);
    ctx.beginPath();
    ctx.moveTo(tx, cy + 2);
    ctx.lineTo(tx + facing * 1, cy + 4);
    ctx.lineTo(tx + facing * 2, cy + 2);
    ctx.closePath();
    ctx.fill();
  }
}

function drawEleanorFigure(sx, sy) {
  const cx = sx + 16;
  // Hair (blonde, long)
  ctx.fillStyle = '#E5C16A';
  ctx.beginPath(); ctx.ellipse(cx, sy + 14, 11.5, 13, 0, 0, Math.PI * 2); ctx.fill();
  // Head
  ctx.fillStyle = '#FFDBAC';
  ctx.beginPath(); ctx.arc(cx, sy + 13, 8.5, 0, Math.PI * 2); ctx.fill();
  // Bangs (blonde)
  ctx.fillStyle = '#E5C16A';
  ctx.beginPath();
  ctx.moveTo(cx - 8, sy + 9);
  ctx.quadraticCurveTo(cx, sy + 4, cx + 8, sy + 7);
  ctx.quadraticCurveTo(cx + 2, sy + 13, cx - 8, sy + 9);
  ctx.fill();
  // Crown
  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  ctx.moveTo(cx - 8, sy + 2);
  ctx.lineTo(cx - 5, sy - 4);
  ctx.lineTo(cx - 2, sy + 2);
  ctx.lineTo(cx, sy - 6);
  ctx.lineTo(cx + 2, sy + 2);
  ctx.lineTo(cx + 5, sy - 4);
  ctx.lineTo(cx + 8, sy + 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(cx - 8, sy + 2, 16, 2.5);
  // Jewels
  ctx.fillStyle = '#E04A95';
  ctx.beginPath(); ctx.arc(cx, sy + 3.2, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4080C0';
  ctx.beginPath(); ctx.arc(cx - 5, sy + 3.2, 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 5, sy + 3.2, 0.9, 0, Math.PI * 2); ctx.fill();
  // Eyes
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.arc(cx - 3.2, sy + 13, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 3.2, sy + 13, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3A7050';
  ctx.beginPath(); ctx.arc(cx - 2.9, sy + 13.3, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 3.5, sy + 13.3, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'white';
  ctx.fillRect(cx - 3.3, sy + 12.5, 0.8, 0.8);
  ctx.fillRect(cx + 3.1, sy + 12.5, 0.8, 0.8);
  // Cheeks
  ctx.fillStyle = 'rgba(255,140,170,0.55)';
  ctx.beginPath(); ctx.arc(cx - 6, sy + 16, 1.7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 6, sy + 16, 1.7, 0, Math.PI * 2); ctx.fill();
  // Smile
  ctx.strokeStyle = '#7A2A40';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, sy + 17, 2.3, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  // Princess dress (white + gold)
  ctx.fillStyle = '#FFF0F8';
  ctx.beginPath();
  ctx.moveTo(cx - 7, sy + 23);
  ctx.lineTo(cx + 7, sy + 23);
  ctx.quadraticCurveTo(cx + 14, sy + 33, cx + 14, sy + 38);
  ctx.lineTo(cx - 14, sy + 38);
  ctx.quadraticCurveTo(cx - 14, sy + 33, cx - 7, sy + 23);
  ctx.closePath();
  ctx.fill();
  // Gold sash
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(cx - 12, sy + 28, 24, 2.5);
  // V-neck
  ctx.fillStyle = '#FFC0D8';
  ctx.beginPath();
  ctx.moveTo(cx - 4, sy + 23);
  ctx.lineTo(cx, sy + 26);
  ctx.lineTo(cx + 4, sy + 23);
  ctx.closePath();
  ctx.fill();
  // Arms
  ctx.fillStyle = '#FFDBAC';
  ctx.beginPath(); ctx.ellipse(cx - 10, sy + 26, 2, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 10, sy + 26, 2, 5, 0, 0, Math.PI * 2); ctx.fill();
}

function drawCaptiveEleanorFigure(sx, sy) {
  const cx = sx + 16;
  // Stringy, dirty long hair
  ctx.fillStyle = '#8B7355';
  ctx.beginPath();
  ctx.ellipse(cx, sy + 22, 12, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  // Loose strands flying around
  ctx.strokeStyle = '#8B7355';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 11, sy + 12); ctx.quadraticCurveTo(cx - 15, sy + 18, cx - 13, sy + 24);
  ctx.moveTo(cx + 11, sy + 12); ctx.quadraticCurveTo(cx + 16, sy + 17, cx + 14, sy + 22);
  ctx.stroke();
  ctx.lineCap = 'butt';
  // Head (paler, dirty)
  ctx.fillStyle = '#E8C5A0';
  ctx.beginPath(); ctx.arc(cx, sy + 13, 8.5, 0, Math.PI * 2); ctx.fill();
  // Dirt smudges
  ctx.fillStyle = 'rgba(60,40,20,0.35)';
  ctx.beginPath(); ctx.arc(cx + 4, sy + 16, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx - 5, sy + 14, 1.8, 0, Math.PI * 2); ctx.fill();
  // Messy bangs (jagged)
  ctx.fillStyle = '#8B7355';
  ctx.beginPath();
  ctx.moveTo(cx - 8, sy + 9);
  ctx.lineTo(cx - 5, sy + 5);
  ctx.lineTo(cx - 2, sy + 11);
  ctx.lineTo(cx + 1, sy + 4);
  ctx.lineTo(cx + 4, sy + 10);
  ctx.lineTo(cx + 8, sy + 6);
  ctx.lineTo(cx + 9, sy + 12);
  ctx.quadraticCurveTo(cx, sy + 15, cx - 8, sy + 9);
  ctx.closePath();
  ctx.fill();
  // Sad eyes
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.arc(cx - 3.2, sy + 13, 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 3.2, sy + 13, 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3A7050';
  ctx.beginPath(); ctx.arc(cx - 3, sy + 13.5, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 3.4, sy + 13.5, 1.2, 0, Math.PI * 2); ctx.fill();
  // Sad eyebrows tilted up at inner ends
  ctx.strokeStyle = '#5C3A1A';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(cx - 6, sy + 10); ctx.lineTo(cx - 1, sy + 11.5);
  ctx.moveTo(cx + 1, sy + 11.5); ctx.lineTo(cx + 6, sy + 10);
  ctx.stroke();
  // Frown
  ctx.strokeStyle = '#7A2A40';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(cx, sy + 20, 2.5, Math.PI * 1.15, Math.PI * 1.85, true);
  ctx.stroke();
  // Tear
  ctx.fillStyle = 'rgba(150,200,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(cx + 4, sy + 17, 1, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  // Tattered grey dress
  ctx.fillStyle = '#6A5A4A';
  ctx.beginPath();
  ctx.moveTo(cx - 7, sy + 22);
  ctx.lineTo(cx + 7, sy + 22);
  ctx.lineTo(cx + 12, sy + 32);
  // Ragged hem
  ctx.lineTo(cx + 11, sy + 37);
  ctx.lineTo(cx + 6, sy + 33);
  ctx.lineTo(cx + 3, sy + 37);
  ctx.lineTo(cx - 1, sy + 33);
  ctx.lineTo(cx - 4, sy + 37);
  ctx.lineTo(cx - 8, sy + 33);
  ctx.lineTo(cx - 11, sy + 37);
  ctx.lineTo(cx - 12, sy + 32);
  ctx.closePath();
  ctx.fill();
  // Stain patches
  ctx.fillStyle = '#4A3A2A';
  ctx.fillRect(cx - 6, sy + 27, 3.5, 3);
  ctx.fillRect(cx + 4, sy + 30, 4, 2.5);
  // Arms (dirty)
  ctx.fillStyle = '#E8C5A0';
  ctx.beginPath(); ctx.ellipse(cx - 10, sy + 26, 2, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 10, sy + 26, 2, 5, 0, 0, Math.PI * 2); ctx.fill();
}

function drawCastleExit(x, y) {
  const sx = x - camera;
  // Castle main body
  ctx.fillStyle = '#9A9A9A';
  ctx.fillRect(sx, y - 50, 60, 90);
  // Stone block pattern
  ctx.fillStyle = '#7A7A7A';
  for (let by = y - 48; by < y + 38; by += 12) {
    const off = (Math.floor((by - y) / 12) % 2) * 10;
    for (let bx = sx + off; bx < sx + 60; bx += 20) {
      ctx.fillRect(bx, by, 18, 10);
    }
  }
  // Crenellations on top
  ctx.fillStyle = '#9A9A9A';
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(sx + i * 12, y - 58, 8, 10);
  }
  // Flag pole + flag on top
  ctx.fillStyle = '#3A2A1A';
  ctx.fillRect(sx + 28, y - 75, 2, 18);
  ctx.fillStyle = '#E04A95';
  ctx.beginPath();
  ctx.moveTo(sx + 30, y - 73);
  ctx.lineTo(sx + 44, y - 69);
  ctx.lineTo(sx + 30, y - 65);
  ctx.closePath();
  ctx.fill();
  // Door (arched)
  ctx.fillStyle = '#3A2A1A';
  ctx.beginPath();
  ctx.moveTo(sx + 22, y + 40);
  ctx.lineTo(sx + 22, y + 18);
  ctx.arc(sx + 30, y + 18, 8, Math.PI, 0);
  ctx.lineTo(sx + 38, y + 40);
  ctx.closePath();
  ctx.fill();
  // Door planks
  ctx.strokeStyle = '#1A0A0A';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(sx + 26, y + 18); ctx.lineTo(sx + 26, y + 40);
  ctx.moveTo(sx + 30, y + 12); ctx.lineTo(sx + 30, y + 40);
  ctx.moveTo(sx + 34, y + 18); ctx.lineTo(sx + 34, y + 40);
  ctx.stroke();
  // Window with Eleanor's face
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(sx + 8, y - 40, 16, 18);
  // Hair behind
  ctx.fillStyle = '#E5C16A';
  ctx.beginPath();
  ctx.arc(sx + 16, y - 32, 6, Math.PI, Math.PI * 2);
  ctx.fill();
  // Face
  ctx.fillStyle = '#FFDBAC';
  ctx.beginPath();
  ctx.arc(sx + 16, y - 30, 5, 0, Math.PI * 2);
  ctx.fill();
  // Tiny crown
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(sx + 13, y - 37, 6, 2);
  ctx.beginPath();
  ctx.moveTo(sx + 13, y - 37);
  ctx.lineTo(sx + 14.5, y - 40);
  ctx.lineTo(sx + 16, y - 37);
  ctx.lineTo(sx + 17.5, y - 40);
  ctx.lineTo(sx + 19, y - 37);
  ctx.closePath();
  ctx.fill();
  // Eyes
  ctx.fillStyle = 'black';
  ctx.fillRect(sx + 14, y - 30, 1.2, 1.2);
  ctx.fillRect(sx + 17, y - 30, 1.2, 1.2);
  // Tiny smile
  ctx.strokeStyle = '#7A2A40';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(sx + 16, y - 28, 1.5, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  // Right side window decoration
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(sx + 38, y - 40, 14, 18);
  // Castle label
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(sx + 30 - 50, y - 90, 100, 16);
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText("Eleanor's Castle!", sx + 30, y - 78);
  ctx.textAlign = 'start';
}

function drawDolphinFigure(sx, sy, facing) {
  facing = facing || 1;
  const cx = sx + 26;
  const cy = sy + 12;
  // Tail
  ctx.fillStyle = '#80A8C8';
  ctx.beginPath();
  ctx.moveTo(cx - facing * 22, cy);
  ctx.lineTo(cx - facing * 32, cy - 9);
  ctx.lineTo(cx - facing * 27, cy);
  ctx.lineTo(cx - facing * 32, cy + 9);
  ctx.closePath();
  ctx.fill();
  // Body
  ctx.beginPath(); ctx.ellipse(cx, cy, 22, 10, 0, 0, Math.PI * 2); ctx.fill();
  // Belly
  ctx.fillStyle = '#E0EEF6';
  ctx.beginPath(); ctx.ellipse(cx, cy + 4, 17, 5, 0, 0, Math.PI * 2); ctx.fill();
  // Beak
  ctx.fillStyle = '#80A8C8';
  ctx.beginPath();
  ctx.moveTo(cx + facing * 18, cy + 1);
  ctx.quadraticCurveTo(cx + facing * 26, cy + 2, cx + facing * 26, cy + 4);
  ctx.quadraticCurveTo(cx + facing * 22, cy + 5, cx + facing * 18, cy + 4);
  ctx.fill();
  // Dorsal fin
  ctx.fillStyle = '#5A88A8';
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy - 7);
  ctx.lineTo(cx + 2, cy - 15);
  ctx.lineTo(cx + 6, cy - 7);
  ctx.closePath();
  ctx.fill();
  // Eye
  ctx.fillStyle = 'black';
  ctx.beginPath(); ctx.arc(cx + facing * 13, cy - 3, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'white';
  ctx.fillRect(cx + facing * 13, cy - 3.5, 0.6, 0.6);
  // Smile
  ctx.strokeStyle = '#1A4A6A';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + facing * 12, cy + 2);
  ctx.quadraticCurveTo(cx + facing * 16, cy + 3, cx + facing * 20, cy + 2);
  ctx.stroke();
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
  if (level.hasCastleExit) {
    drawCastleExit(level.exit.x - 14, level.exit.y);
    return;
  }
  if (level.hasEleanor) {
    const bob = Math.sin(Date.now() / 400) * 3;
    const x = level.exit.x, y = level.exit.y + bob;
    // Sparkles around Eleanor
    const t = Date.now() / 300;
    ctx.fillStyle = '#FFD700';
    for (let i = 0; i < 4; i++) {
      const sa = t + i * Math.PI / 2;
      const sx = x + 16 - camera + Math.cos(sa) * 22;
      const sy = y + 16 + Math.sin(sa) * 22;
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    drawEleanorFigure(x - camera, y - 4);
    // Name label
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
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
  drawEvanFigure(x, y);
}

// =========================================================
// ROPE CLIMB (Level 30)
// =========================================================
function startRopeClimb() {
  state = STATE.ROPE_CLIMB;
  ropeClimb = {
    px: 400, py: 1400,
    pvx: 0,
    eleanorY: 100,
    cameraY: 0,
    projectiles: [],
    spawnTimer: 60,
    wind: 0,
    windTimer: 0,
    climbBoost: 0,
    invincible: 60,
    rescued: false,
    rescuedTimer: 0,
  };
  lives = STARTING_LIVES;
  coins = 0;
  currentLevel = 30;
}

function updateRopeClimb() {
  const rc = ropeClimb;
  if (pressed(['escape'])) { state = STATE.LEVEL_SELECT; selectedLevel = 30; ropeClimb = null; return; }
  if (rc.rescued) {
    rc.rescuedTimer--;
    rc.py = Math.max(rc.eleanorY, rc.py - 1);
    if (rc.rescuedTimer <= 0) {
      // Auto-advance to dress-up
      save.cleared[30] = true;
      if (31 > save.highestUnlocked) save.highestUnlocked = 31;
      saveProgress();
      ropeClimb = null;
      startLevel(31);
    }
    return;
  }

  // Wind shifts every couple seconds
  rc.windTimer--;
  if (rc.windTimer <= 0) {
    rc.wind = (Math.random() - 0.5) * 1.6;
    rc.windTimer = 90 + Math.floor(Math.random() * 60);
  }
  // Climb (N or A/touch-A or up arrow)
  if (pressed(['n']) || pressed(['z']) || pressed(K_JUMP)) {
    rc.climbBoost = 16;
    sfx.jump();
  }
  if (rc.climbBoost > 0) {
    rc.py -= 3;
    rc.climbBoost--;
  } else {
    rc.py -= 0.35; // slow auto-climb
  }
  // Sideways control: B / X / arrows
  let dx = 0;
  if (isDown(K_LEFT))  dx -= 1;
  if (isDown(K_RIGHT)) dx += 1;
  if (isDown(['b'])) dx -= 1;
  if (isDown(['x'])) dx -= 1;
  rc.pvx += dx * 0.7 + rc.wind * 0.35;
  rc.pvx = clamp(rc.pvx, -4.5, 4.5);
  rc.pvx *= 0.92;
  rc.px += rc.pvx;
  rc.px = clamp(rc.px, 110, 690);
  // Spawn projectiles from above
  rc.spawnTimer--;
  if (rc.spawnTimer <= 0) {
    const type = Math.random() > 0.5 ? 'bomb' : 'knife';
    rc.projectiles.push({
      x: 130 + Math.random() * 540,
      y: rc.py - 320,
      vy: 2.5 + Math.random() * 2,
      type,
      r: type === 'bomb' ? 14 : 9,
    });
    rc.spawnTimer = 38 - Math.min(20, Math.floor((1400 - rc.py) / 60));
  }
  // Update projectiles + check collision
  for (const p of rc.projectiles) {
    p.y += p.vy;
    if (rc.invincible <= 0) {
      const dx2 = p.x - rc.px;
      const dy2 = p.y - rc.py + 6;
      if (dx2 * dx2 + dy2 * dy2 < (p.r + 12) * (p.r + 12)) {
        lives--;
        sfx.hurt();
        rc.invincible = 90;
        p.y = rc.py + 9999; // remove
        if (lives <= 0) {
          state = STATE.GAME_OVER;
          levelTransitionTimer = 120;
          sfx.gameOver();
          return;
        }
      }
    }
  }
  rc.projectiles = rc.projectiles.filter(p => p.y < rc.py + 500);
  if (rc.invincible > 0) rc.invincible--;
  // Camera follows player
  rc.cameraY = rc.py - H / 2;
  // Reach Eleanor
  if (rc.py <= rc.eleanorY + 50) {
    rc.rescued = true;
    rc.rescuedTimer = 90;
    sfx.bigWin();
  }
  updateHUD();
}

function drawRopeClimb() {
  const rc = ropeClimb;
  // Sky-to-dark gradient
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1a0820');
  g.addColorStop(0.5, '#3a1830');
  g.addColorStop(1, '#5a2840');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Stars
  ctx.fillStyle = 'white';
  for (let i = 0; i < 30; i++) {
    const sx = (i * 97) % W;
    const sy = (i * 53 + Math.floor(rc.cameraY * 0.05)) % (H / 2);
    ctx.fillRect(sx, Math.abs(sy), 1.5, 1.5);
  }
  // Moon
  ctx.fillStyle = '#FFF5C8';
  ctx.beginPath();
  ctx.arc(W - 100, 80, 30, 0, Math.PI * 2);
  ctx.fill();

  // Castle walls scrolling with camera
  ctx.save();
  ctx.translate(0, -rc.cameraY);
  // Left tower
  ctx.fillStyle = '#8A8898';
  ctx.fillRect(0, -200, 100, 2000);
  ctx.fillStyle = '#6A6878';
  for (let yy = -200; yy < 1800; yy += 24) {
    const off = (Math.floor(yy / 24) % 2) * 18;
    for (let xx = off; xx < 100; xx += 36) {
      ctx.fillRect(xx, yy, 32, 20);
    }
  }
  // Right tower
  ctx.fillStyle = '#8A8898';
  ctx.fillRect(W - 100, -200, 100, 2000);
  ctx.fillStyle = '#6A6878';
  for (let yy = -200; yy < 1800; yy += 24) {
    const off = (Math.floor(yy / 24) % 2) * 18;
    for (let xx = off; xx < 100; xx += 36) {
      ctx.fillRect(W - 100 + xx, yy, 32, 20);
    }
  }
  // Windows with lit candles, scattered up the towers
  for (let yy = 200; yy < 1500; yy += 250) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(30, yy, 18, 26);
    ctx.fillRect(W - 48, yy, 18, 26);
    ctx.fillStyle = '#FFD060';
    ctx.fillRect(34, yy + 4, 10, 18);
    ctx.fillRect(W - 44, yy + 4, 10, 18);
  }

  // Rope from off-screen anchor at top, down to player hands
  ctx.strokeStyle = '#A56020';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(rc.px, -300);
  ctx.lineTo(rc.px, rc.py - 12);
  ctx.stroke();
  // Knot at bottom of rope
  ctx.fillStyle = '#7A4014';
  ctx.beginPath();
  ctx.arc(rc.px, rc.py - 12, 4, 0, Math.PI * 2);
  ctx.fill();

  // Projectiles
  for (const p of rc.projectiles) {
    if (p.type === 'bomb') {
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
      ctx.fill();
      // Shine
      ctx.fillStyle = '#444';
      ctx.beginPath(); ctx.arc(p.x - 4, p.y - 4, 3, 0, Math.PI * 2); ctx.fill();
      // Fuse
      ctx.strokeStyle = '#A0522D';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 13);
      ctx.quadraticCurveTo(p.x + 4, p.y - 18, p.x + 6, p.y - 22);
      ctx.stroke();
      // Spark
      ctx.fillStyle = '#FFFF60';
      ctx.beginPath(); ctx.arc(p.x + 6, p.y - 22, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FFA500';
      ctx.beginPath(); ctx.arc(p.x + 6, p.y - 22, 1.5, 0, Math.PI * 2); ctx.fill();
    } else {
      // Knife
      ctx.fillStyle = '#CCC';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + 14);
      ctx.lineTo(p.x - 4, p.y - 4);
      ctx.lineTo(p.x + 4, p.y - 4);
      ctx.closePath();
      ctx.fill();
      // Hilt
      ctx.fillStyle = '#5C2C0C';
      ctx.fillRect(p.x - 5, p.y - 8, 10, 4);
      // Highlight
      ctx.fillStyle = '#EEE';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + 13);
      ctx.lineTo(p.x - 1, p.y - 3);
      ctx.lineTo(p.x + 1, p.y - 3);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Player
  const palpha = rc.invincible > 0 && Math.floor(rc.invincible / 6) % 2 === 0 ? 0.4 : 1;
  ctx.globalAlpha = palpha;
  drawEvanFigure(rc.px - 14, rc.py - 18);
  ctx.globalAlpha = 1;

  // Eleanor at the top — captive
  drawCaptiveEleanorFigure(rc.px - 16, rc.eleanorY - 30);
  // Bars in front of her
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 3;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(rc.px + i * 7, rc.eleanorY - 36);
    ctx.lineTo(rc.px + i * 7, rc.eleanorY + 14);
    ctx.stroke();
  }

  ctx.restore();

  // HUD
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(20, 16, W - 40, 28);
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Climb to Eleanor! N or SPACE = climb, B or arrows = swing', W / 2, 34);
  ctx.textAlign = 'start';
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(W - 100, 50, 80, 24);
  ctx.fillStyle = 'white';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Lives: ' + lives, W - 60, 67);
  ctx.textAlign = 'start';
  // Progress bar
  const progress = 1 - clamp((rc.py - rc.eleanorY) / (1400 - rc.eleanorY), 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(W / 2 - 100, H - 30, 200, 16);
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(W / 2 - 98, H - 28, 196 * progress, 12);
  // Wind indicator
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Wind: ' + (rc.wind > 0.2 ? '→' : rc.wind < -0.2 ? '←' : '·'), W / 2, H - 40);
  ctx.textAlign = 'start';
  if (rc.rescued) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, H / 2 - 30, W, 60);
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Eleanor is saved!', W / 2, H / 2 + 12);
    ctx.textAlign = 'start';
  }
}

// =========================================================
// DRESS-UP (Level 31) — full salon
// =========================================================

const HAIR_COLORS = [
  '#5C3A1A',  // 0 brown
  '#E5C16A',  // 1 blonde
  '#8B5A2B',  // 2 light brown
  '#1A1A1A',  // 3 black
  '#B04030',  // 4 red
  '#FF80C0',  // 5 pink
  '#9040C0',  // 6 purple
  '#3060D0',  // 7 blue
  '#30C0A0',  // 8 teal
  '#40A040',  // 9 green
  '#E07020',  // 10 orange
  '#F0D040',  // 11 yellow
  '#A0A0A0',  // 12 silver
  'rainbow',  // 13 rainbow
];
const DRESS_COLORS = ['#6A5A4A', '#FF69B4', '#FFD700', '#9040C0', '#4080C0', '#40A040', '#FFFFFF'];
const SHOE_COLORS = ['#FFD700', '#FF80C0', '#C8C8D8', '#C04040', '#1A1A1A', '#FFFFFF'];
const EYE_COLORS = ['#3A7050', '#4080C0', '#704A2A', '#8B5A1A', '#9040C0', '#FF80C0'];
const EYESHADOW_COLORS = [null, '#FF80C0', '#4080C0', '#9040C0', '#40A040', '#FFD700'];
const LIPSTICK_COLORS = [null, '#FF80C0', '#C04040', '#FF8060', '#9040C0'];
const NAIL_COLORS = [null, '#FF80C0', '#C04040', '#9040C0', '#4080C0', '#FFD700'];
const CROWN_COLORS = [null, '#FFD700', '#FF99CC', '#C8C8D8', '#80E040'];
const CROWN_JEWEL_COLORS = ['#E04A95', '#4080C0', '#40A040', '#9040C0', '#FFD700', '#C04040'];
const NECKLACE_COLORS = [null, '#FFD700', '#F0E8D0', '#FF80C0', '#C04040'];
const EARRING_COLORS = [null, '#FFD700', '#F0E8D0', '#FF80C0', '#4080C0'];
const BRACELET_COLORS = [null, '#FFD700', '#F0E8D0', '#FF80C0'];

const TABS = ['Hair', 'Crown', 'Dress', 'Shoes', 'Makeup', 'Jewelry'];
const TAB_OPTIONS = [
  [{ key: 'hairstyle', label: 'Style', count: 7, startIndex: 0 },
   { key: 'hairstyle', label: '',      count: 6, startIndex: 7 },
   { key: 'hairColor', label: 'Color', count: 7, startIndex: 0 },
   { key: 'hairColor', label: '',      count: 7, startIndex: 7 }],
  [{ key: 'crown',      label: 'Crown', count: 5 },
   { key: 'crownJewel', label: 'Jewel', count: 6 }],
  [{ key: 'dressColor',   label: 'Color',   count: 7 },
   { key: 'dressPattern', label: 'Pattern', count: 6 }],
  [{ key: 'shoes',      label: 'Style', count: 5 },
   { key: 'shoesColor', label: 'Color', count: 6 }],
  [{ key: 'eyeColor',  label: 'Eyes',      count: 6 },
   { key: 'eyeshadow', label: 'Eyeshadow', count: 6 },
   { key: 'blush',     label: 'Blush',     count: 3 },
   { key: 'lipstick',  label: 'Lipstick',  count: 5 },
   { key: 'nails',     label: 'Nails',     count: 6 }],
  [{ key: 'necklace', label: 'Necklace', count: 5 },
   { key: 'earrings', label: 'Earrings', count: 5 },
   { key: 'bracelet', label: 'Bracelet', count: 4 }],
];

function startDressup() {
  state = STATE.DRESSUP;
  dressup = {
    hairstyle: 0, hairColor: 0,
    crown: 0, crownJewel: 0,
    dressColor: 0, dressPattern: 0,
    shoes: 0, shoesColor: 0,
    eyeColor: 0,
    eyeshadow: 0, blush: 0, lipstick: 0, nails: 0,
    necklace: 0, earrings: 0, bracelet: 0,
    activeTab: 0,
    sparkleT: 0,
  };
  currentLevel = 31;
}

function saveCurrentEleanorToGallery(name) {
  if (!save.savedEleanors) save.savedEleanors = [];
  const snap = { name: (name || 'Eleanor').slice(0, 24) };
  for (const k of ['hairstyle','hairColor','crown','crownJewel','dressColor',
    'dressPattern','shoes','shoesColor','eyeColor','eyeshadow','blush',
    'lipstick','nails','necklace','earrings','bracelet']) {
    snap[k] = dressup[k];
  }
  save.savedEleanors.push(snap);
  saveProgress();
}

function dressupReady() {
  return dressup.dressColor > 0 && dressup.shoes > 0;
}

function makeHairGradient(cx, sy, w, h) {
  const g = ctx.createLinearGradient(cx - w/2, sy, cx + w/2, sy + h);
  g.addColorStop(0,    '#FF4040');
  g.addColorStop(0.18, '#FFA040');
  g.addColorStop(0.36, '#FFE040');
  g.addColorStop(0.54, '#40D040');
  g.addColorStop(0.72, '#4070FF');
  g.addColorStop(1,    '#A040FF');
  return g;
}

function hairFill(idx, cx, sy) {
  if (idx === 13) return makeHairGradient(cx, sy + 4, 32, 48);
  return HAIR_COLORS[idx];
}

function hairShade(idx) {
  if (idx === 13) return '#5040A0';
  // Darker version for shading
  const base = HAIR_COLORS[idx];
  if (base === '#1A1A1A') return '#333';
  return base;
}

function updateDressup() {
  if (pressed(['escape'])) { state = STATE.LEVEL_SELECT; selectedLevel = 31; return; }
  dressup.sparkleT += 0.06;
  updateHUD();
}

function dressupHitTest(cx, cy) {
  // Tabs
  const tabsY = 70, tabW = 122, tabsStartX = 40;
  if (cy >= tabsY && cy < tabsY + 32) {
    for (let i = 0; i < TABS.length; i++) {
      const tx = tabsStartX + i * tabW;
      if (cx >= tx && cx < tx + tabW - 6) return { kind: 'tab', index: i };
    }
  }
  // Tab content rows
  const tab = TAB_OPTIONS[dressup.activeTab];
  const startY = 128;
  const rowH = tab.length >= 4 ? 52 : 65;
  for (let r = 0; r < tab.length; r++) {
    const row = tab[r];
    const rowY = startY + r * rowH;
    const offset = row.startIndex || 0;
    const startX = 360;
    const spacing = 56;
    for (let i = 0; i < row.count; i++) {
      const ix = startX + i * spacing;
      if (cx >= ix - 22 && cx < ix + 22 && cy >= rowY - 22 && cy < rowY + 24) {
        return { kind: row.key, index: offset + i };
      }
    }
  }
  // Done button
  if (cx >= W / 2 - 130 && cx < W / 2 + 130 && cy >= H - 42 && cy < H - 10) {
    return { kind: 'done' };
  }
  return null;
}

function drawDressup() {
  const du = dressup;
  // Background
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#FFD8E8');
  g.addColorStop(1, '#FFE5F0');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Twinkles
  for (let i = 0; i < 30; i++) {
    const sx = (i * 71 + 30) % W;
    const sy = (i * 41 + 30) % H;
    const a = 0.2 + 0.35 * Math.sin(du.sparkleT + i);
    ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
    ctx.beginPath(); ctx.arc(sx, sy, 2, 0, Math.PI * 2); ctx.fill();
  }
  // Title
  ctx.fillStyle = '#7A2A40';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Dress Up Eleanor!', W / 2, 36);

  // Tabs (6 of them — narrower)
  const tabsY = 70, tabW = 122, tabsStartX = 40;
  for (let i = 0; i < TABS.length; i++) {
    const tx = tabsStartX + i * tabW;
    const active = du.activeTab === i;
    ctx.fillStyle = active ? '#FFD700' : 'rgba(255,255,255,0.65)';
    ctx.fillRect(tx, tabsY, tabW - 6, 32);
    if (active) {
      ctx.strokeStyle = '#7A2A40';
      ctx.lineWidth = 2;
      ctx.strokeRect(tx, tabsY, tabW - 6, 32);
    }
    ctx.fillStyle = '#7A2A40';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(TABS[i], tx + (tabW - 6) / 2, tabsY + 22);
  }

  // Eleanor preview (left side, scaled 3x)
  ctx.fillStyle = '#C46BAE';
  ctx.beginPath();
  ctx.ellipse(170, 430, 80, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(170, 290);
  ctx.scale(3, 3);
  drawDressupEleanor(-16, -36);
  ctx.restore();

  // Tab options on the right
  const tab = TAB_OPTIONS[du.activeTab];
  const startY = 128;
  const rowH = tab.length >= 4 ? 52 : 65;
  for (let r = 0; r < tab.length; r++) {
    const row = tab[r];
    const rowY = startY + r * rowH;
    const offset = row.startIndex || 0;
    if (row.label) {
      ctx.fillStyle = '#5A2A4A';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(row.label, 310, rowY + 4);
    }
    const startX = 360;
    const spacing = 56;
    for (let i = 0; i < row.count; i++) {
      const ix = startX + i * spacing;
      const effIdx = offset + i;
      const selected = du[row.key] === effIdx;
      ctx.fillStyle = selected ? '#FFFFFF' : 'rgba(255,255,255,0.5)';
      ctx.fillRect(ix - 22, rowY - 22, 44, 46);
      if (selected) {
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 3;
        ctx.strokeRect(ix - 22, rowY - 22, 44, 46);
      }
      drawOptionIcon(row.key, effIdx, ix, rowY + 2);
    }
  }

  // Done button
  const ready = dressupReady();
  ctx.fillStyle = ready ? '#FFD700' : '#bbb';
  ctx.fillRect(W / 2 - 130, H - 42, 260, 32);
  ctx.fillStyle = ready ? '#5a2080' : '#666';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(ready ? 'Save Eleanor & Finish! ✨' : 'Pick hair, dress & shoes first!', W / 2, H - 21);
  ctx.textAlign = 'start';
}

function drawOptionIcon(key, i, x, y) {
  if      (key === 'hairstyle')    drawHairstyleIcon(x, y, i);
  else if (key === 'hairColor')    drawColorChip(x, y, HAIR_COLORS[i]);
  else if (key === 'crown')        drawCrownChip(x, y, i);
  else if (key === 'crownJewel')   drawColorChip(x, y, CROWN_JEWEL_COLORS[i]);
  else if (key === 'dressColor')   drawColorChip(x, y, DRESS_COLORS[i]);
  else if (key === 'dressPattern') drawPatternChip(x, y, i);
  else if (key === 'shoes')        drawShoeChip(x, y, i);
  else if (key === 'shoesColor')   drawColorChip(x, y, SHOE_COLORS[i]);
  else if (key === 'eyeColor')     drawColorChip(x, y, EYE_COLORS[i]);
  else if (key === 'eyeshadow')    drawColorChip(x, y, EYESHADOW_COLORS[i]);
  else if (key === 'blush')        drawBlushChip(x, y, i);
  else if (key === 'lipstick')     drawColorChip(x, y, LIPSTICK_COLORS[i]);
  else if (key === 'nails')        drawColorChip(x, y, NAIL_COLORS[i]);
  else if (key === 'necklace')     drawNecklaceChip(x, y, i);
  else if (key === 'earrings')     drawEarringChip(x, y, i);
  else if (key === 'bracelet')     drawBraceletChip(x, y, i);
}

function drawNecklaceChip(x, y, i) {
  if (i === 0) return drawNoneChip(x, y);
  const col = NECKLACE_COLORS[i];
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y + 2, 10, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  if (i === 3) {
    // Heart pendant
    ctx.fillStyle = '#FF80C0';
    ctx.beginPath();
    ctx.arc(x - 2, y + 10, 1.6, 0, Math.PI * 2);
    ctx.arc(x + 2, y + 10, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 3.5, y + 10);
    ctx.lineTo(x, y + 14);
    ctx.lineTo(x + 3.5, y + 10);
    ctx.fill();
  } else if (i === 4) {
    // Ruby pendant
    ctx.fillStyle = '#C04040';
    ctx.beginPath();
    ctx.arc(x, y + 11, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x - 0.8, y + 10, 0.7, 0, Math.PI * 2);
    ctx.fill();
  } else if (i === 2) {
    // Pearl strand
    for (let p = 0; p < 6; p++) {
      const a = Math.PI * 0.18 + (p / 5) * Math.PI * 0.64;
      ctx.fillStyle = '#F0E8D0';
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 10, y + 2 + Math.sin(a) * 10, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (i === 1) {
    // Gold chain (small pendant)
    ctx.fillStyle = '#FFD700';
    ctx.beginPath(); ctx.arc(x, y + 11, 1.5, 0, Math.PI * 2); ctx.fill();
  }
}

function drawEarringChip(x, y, i) {
  if (i === 0) return drawNoneChip(x, y);
  // Show a tiny face profile
  ctx.fillStyle = '#FFDBAC';
  ctx.beginPath();
  ctx.arc(x, y + 4, 8, 0, Math.PI * 2);
  ctx.fill();
  const col = EARRING_COLORS[i];
  ctx.fillStyle = col;
  if (i === 1) {
    // Studs
    ctx.beginPath(); ctx.arc(x - 6, y + 6, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 6, y + 6, 1.5, 0, Math.PI * 2); ctx.fill();
  } else if (i === 2) {
    // Pearl drops
    ctx.beginPath(); ctx.ellipse(x - 7, y + 9, 1.5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 7, y + 9, 1.5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    // Dangle
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 6); ctx.lineTo(x - 6, y + 10);
    ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + 6, y + 10);
    ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x - 6, y + 12, 1.5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 6, y + 12, 1.5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function drawBraceletChip(x, y, i) {
  if (i === 0) return drawNoneChip(x, y);
  // Show a tiny arm
  ctx.fillStyle = '#FFDBAC';
  ctx.fillRect(x - 8, y, 16, 8);
  ctx.fillStyle = BRACELET_COLORS[i];
  ctx.fillRect(x - 8, y + 2, 16, 2.5);
  if (i === 3) {
    // Charm
    ctx.fillStyle = '#FF80C0';
    ctx.beginPath(); ctx.arc(x, y + 8, 1.6, 0, Math.PI * 2); ctx.fill();
  } else if (i === 2) {
    // Pearls
    ctx.fillStyle = '#FFFFFF';
    for (let p = 0; p < 6; p++) {
      ctx.beginPath(); ctx.arc(x - 6 + p * 2.5, y + 3.2, 0.7, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawNoneChip(x, y) {
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y + 6, 13, 0, Math.PI * 2);
  ctx.moveTo(x - 9, y - 3); ctx.lineTo(x + 9, y + 15);
  ctx.stroke();
}

function drawColorChip(x, y, color) {
  if (!color) return drawNoneChip(x, y);
  if (color === 'rainbow') {
    const g = ctx.createLinearGradient(x - 13, y - 7, x + 13, y + 19);
    g.addColorStop(0,    '#FF4040');
    g.addColorStop(0.2,  '#FFA040');
    g.addColorStop(0.4,  '#FFE040');
    g.addColorStop(0.6,  '#40D040');
    g.addColorStop(0.8,  '#4070FF');
    g.addColorStop(1,    '#A040FF');
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = color;
  }
  ctx.beginPath(); ctx.arc(x, y + 6, 13, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.stroke();
}

function drawCrownChip(x, y, i) {
  if (i === 0) return drawNoneChip(x, y);
  ctx.fillStyle = CROWN_COLORS[i];
  ctx.beginPath();
  ctx.moveTo(x - 14, y + 10);
  ctx.lineTo(x - 9, y - 5);
  ctx.lineTo(x - 4, y + 10);
  ctx.lineTo(x, y - 9);
  ctx.lineTo(x + 4, y + 10);
  ctx.lineTo(x + 9, y - 5);
  ctx.lineTo(x + 14, y + 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - 14, y + 10, 28, 4);
  ctx.fillStyle = '#E04A95';
  ctx.beginPath(); ctx.arc(x, y + 12, 1.6, 0, Math.PI * 2); ctx.fill();
  if (i === 4) {
    // Flower crown - little flowers
    for (let j = 0; j < 3; j++) {
      const fx = x - 7 + j * 7;
      ctx.fillStyle = '#FF80C0';
      ctx.beginPath(); ctx.arc(fx, y - 1, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FFD700';
      ctx.beginPath(); ctx.arc(fx, y - 1, 0.8, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawHairstyleIcon(x, y, i) {
  const cx = x, cy = y + 4;
  const hc = '#5C3A1A';
  const sk = '#FFDBAC';
  const tie = '#FF80C0';
  // helper: base head behind
  function head() {
    ctx.fillStyle = sk;
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
  }
  // helper: standard bangs sweep
  function bangs() {
    ctx.fillStyle = hc;
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy);
    ctx.quadraticCurveTo(cx, cy - 6, cx + 7, cy);
    ctx.quadraticCurveTo(cx, cy + 4, cx - 7, cy);
    ctx.fill();
  }
  if (i === 0) {
    // Two braids
    head();
    ctx.fillStyle = hc;
    ctx.beginPath(); ctx.arc(cx, cy - 1, 7.5, Math.PI, 0); ctx.fill();
    // Two braids
    for (let j = 0; j < 4; j++) {
      ctx.beginPath();
      ctx.ellipse(cx - 8 + (j%2)*0.6, cy + 2 + j*2.5, 2, 1.6, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + 8 - (j%2)*0.6, cy + 2 + j*2.5, 2, 1.6, 0, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.fillStyle = tie;
    ctx.beginPath(); ctx.arc(cx - 8, cy + 12, 1.2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 8, cy + 12, 1.2, 0, Math.PI*2); ctx.fill();
    bangs();
  } else if (i === 1) {
    // One braid (side)
    head();
    ctx.fillStyle = hc;
    ctx.beginPath(); ctx.arc(cx, cy - 1, 7.5, Math.PI, 0); ctx.fill();
    for (let j = 0; j < 5; j++) {
      ctx.beginPath();
      ctx.ellipse(cx + 9, cy + 2 + j*2.5, 2.2, 1.7, 0.3, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.fillStyle = tie;
    ctx.beginPath(); ctx.arc(cx + 9, cy + 14, 1.2, 0, Math.PI*2); ctx.fill();
    bangs();
  } else if (i === 2) {
    // High ponytail
    head();
    ctx.fillStyle = hc;
    ctx.beginPath(); ctx.arc(cx, cy - 1, 7.5, Math.PI, 0); ctx.fill();
    // Pony going up + back
    ctx.beginPath();
    ctx.ellipse(cx - 1, cy - 8, 3, 5, -0.3, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = tie;
    ctx.beginPath(); ctx.arc(cx, cy - 4, 1.4, 0, Math.PI*2); ctx.fill();
    bangs();
  } else if (i === 3) {
    // Two ponytails (pigtails)
    head();
    ctx.fillStyle = hc;
    ctx.beginPath(); ctx.arc(cx, cy - 1, 7.5, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx - 10, cy + 4, 3, 6, -0.4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 10, cy + 4, 3, 6, 0.4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = tie;
    ctx.beginPath(); ctx.arc(cx - 8, cy + 1, 1.2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 8, cy + 1, 1.2, 0, Math.PI*2); ctx.fill();
    bangs();
  } else if (i === 4) {
    // Two high buns
    head();
    ctx.fillStyle = hc;
    ctx.beginPath(); ctx.arc(cx, cy - 1, 7.5, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.arc(cx - 5, cy - 7, 3.5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 5, cy - 7, 3.5, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#3A1A0A';
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(cx - 5, cy - 7, 2.2, 0, Math.PI*2);
    ctx.arc(cx + 5, cy - 7, 2.2, 0, Math.PI*2);
    ctx.stroke();
    bangs();
  } else if (i === 5) {
    // One high bun (top knot)
    head();
    ctx.fillStyle = hc;
    ctx.beginPath(); ctx.arc(cx, cy - 1, 7.5, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy - 8, 4.5, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#3A1A0A';
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(cx, cy - 8, 3, 0, Math.PI*2); ctx.stroke();
    bangs();
  } else if (i === 6) {
    // One French braid
    ctx.fillStyle = hc;
    ctx.beginPath(); ctx.ellipse(cx, cy + 4, 9, 12, 0, 0, Math.PI*2); ctx.fill();
    head();
    ctx.fillStyle = '#3A1A0A';
    for (let j = 0; j < 6; j++) {
      ctx.beginPath();
      ctx.ellipse(cx + (j%2 ? -1.5 : 1.5), cy - 5 + j*3, 2.8, 1.6, 0, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.fillStyle = tie;
    ctx.beginPath(); ctx.arc(cx, cy + 14, 1.2, 0, Math.PI*2); ctx.fill();
  } else if (i === 7) {
    // Two French braids
    ctx.fillStyle = hc;
    ctx.beginPath(); ctx.ellipse(cx, cy + 4, 9, 12, 0, 0, Math.PI*2); ctx.fill();
    head();
    ctx.fillStyle = '#3A1A0A';
    for (let j = 0; j < 5; j++) {
      ctx.beginPath();
      ctx.ellipse(cx - 3, cy - 4 + j*2.8, 1.8, 1.3, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + 3, cy - 4 + j*2.8, 1.8, 1.3, 0, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.fillStyle = tie;
    ctx.beginPath(); ctx.arc(cx - 3, cy + 11, 1, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 3, cy + 11, 1, 0, Math.PI*2); ctx.fill();
  } else if (i === 8) {
    // Hair down
    ctx.fillStyle = hc;
    ctx.beginPath(); ctx.ellipse(cx, cy + 5, 10, 13, 0, 0, Math.PI*2); ctx.fill();
    head();
    bangs();
  } else if (i === 9) {
    // Bangs (short bob)
    ctx.fillStyle = hc;
    ctx.beginPath(); ctx.ellipse(cx, cy + 2, 9, 9, 0, 0, Math.PI*2); ctx.fill();
    head();
    // Full bangs across forehead
    ctx.fillStyle = hc;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx - 8, cy + 3);
    ctx.lineTo(cx + 8, cy + 3);
    ctx.lineTo(cx + 8, cy);
    ctx.quadraticCurveTo(cx, cy + 6, cx - 8, cy);
    ctx.fill();
  } else if (i === 10) {
    // Wavy
    ctx.fillStyle = hc;
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy);
    ctx.bezierCurveTo(cx - 11, cy + 6, cx - 8, cy + 10, cx - 10, cy + 14);
    ctx.lineTo(cx + 10, cy + 14);
    ctx.bezierCurveTo(cx + 8, cy + 10, cx + 11, cy + 6, cx + 9, cy);
    ctx.fill();
    head();
    bangs();
  } else if (i === 11) {
    // Straight
    ctx.fillStyle = hc;
    ctx.fillRect(cx - 9, cy, 18, 14);
    head();
    // Center part bangs
    ctx.fillStyle = hc;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx - 1, cy + 3);
    ctx.lineTo(cx + 1, cy + 3);
    ctx.lineTo(cx + 8, cy);
    ctx.quadraticCurveTo(cx, cy + 5, cx - 8, cy);
    ctx.fill();
  } else if (i === 12) {
    // Curly
    ctx.fillStyle = hc;
    for (let j = 0; j < 5; j++) {
      ctx.beginPath(); ctx.arc(cx - 8 + j*4, cy + 4, 3, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx - 6 + j*4, cy + 10, 3, 0, Math.PI*2); ctx.fill();
    }
    head();
    // Curly bangs
    ctx.beginPath(); ctx.arc(cx - 4, cy, 2, 0, Math.PI*2);
    ctx.arc(cx, cy - 1, 2, 0, Math.PI*2);
    ctx.arc(cx + 4, cy, 2, 0, Math.PI*2);
    ctx.fillStyle = hc;
    ctx.fill();
  }
}

function drawPatternChip(x, y, i) {
  // Show as a square swatch with pattern
  ctx.fillStyle = '#FFE5F0';
  ctx.fillRect(x - 14, y - 8, 28, 22);
  if (i === 0) {
    ctx.fillStyle = '#7A2A40';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('plain', x, y + 5);
    ctx.textAlign = 'start';
    return;
  }
  ctx.fillStyle = '#7A2A40';
  if (i === 1) {
    for (let dx = -10; dx <= 10; dx += 5) for (let dy = -5; dy <= 11; dy += 5) {
      ctx.beginPath(); ctx.arc(x + dx, y + dy, 1.4, 0, Math.PI * 2); ctx.fill();
    }
  } else if (i === 2) {
    for (let dy = -6; dy <= 12; dy += 4) ctx.fillRect(x - 12, y + dy, 24, 1.4);
  } else if (i === 3) {
    for (let j = 0; j < 4; j++) {
      const hx = x - 8 + (j % 2 === 0 ? 0 : 8);
      const hy = y - 4 + Math.floor(j / 2) * 8;
      ctx.beginPath();
      ctx.arc(hx - 1.5, hy, 1.4, 0, Math.PI * 2);
      ctx.arc(hx + 1.5, hy, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(hx - 3, hy);
      ctx.lineTo(hx, hy + 3);
      ctx.lineTo(hx + 3, hy);
      ctx.fill();
    }
  } else if (i === 4) {
    ctx.fillStyle = '#FFD700';
    for (let j = 0; j < 4; j++) {
      const sx = x - 6 + (j % 2) * 12;
      const sy = y - 4 + Math.floor(j / 2) * 8;
      drawStar(sx, sy, 3);
    }
  } else if (i === 5) {
    for (let j = 0; j < 3; j++) {
      const fx = x - 8 + j * 8;
      const fy = y + (j === 1 ? -3 : 6);
      ctx.fillStyle = '#FF80C0';
      for (let k = 0; k < 5; k++) {
        const a = k * Math.PI / 2.5;
        ctx.beginPath();
        ctx.arc(fx + Math.cos(a) * 1.6, fy + Math.sin(a) * 1.6, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#FFD700';
      ctx.beginPath(); ctx.arc(fx, fy, 1, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawStar(x, y, r) {
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const a1 = -Math.PI / 2 + k * Math.PI * 2 / 5;
    const a2 = a1 + Math.PI / 5;
    if (k === 0) ctx.moveTo(x + Math.cos(a1) * r, y + Math.sin(a1) * r);
    else ctx.lineTo(x + Math.cos(a1) * r, y + Math.sin(a1) * r);
    ctx.lineTo(x + Math.cos(a2) * r * 0.4, y + Math.sin(a2) * r * 0.4);
  }
  ctx.closePath();
  ctx.fill();
}

function drawShoeChip(x, y, i) {
  if (i === 0) return drawNoneChip(x, y);
  ctx.fillStyle = '#FFD700';
  if (i === 1) {
    // Slippers
    ctx.beginPath(); ctx.ellipse(x, y + 8, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FF80C0';
    ctx.beginPath(); ctx.arc(x, y + 5, 2, 0, Math.PI * 2); ctx.fill();
  } else if (i === 2) {
    // Heels
    ctx.beginPath();
    ctx.moveTo(x - 11, y + 10);
    ctx.lineTo(x + 12, y + 5);
    ctx.lineTo(x + 14, y + 10);
    ctx.lineTo(x + 14, y + 12);
    ctx.lineTo(x - 11, y + 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - 10, y + 12, 2, 6);
  } else if (i === 3) {
    // Boots
    ctx.fillRect(x - 7, y - 8, 14, 16);
    ctx.fillRect(x - 9, y + 8, 18, 5);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x - 7, y - 8, 14, 3);
  } else if (i === 4) {
    // Sandals
    ctx.beginPath(); ctx.ellipse(x, y + 10, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#A56020';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 8, y + 8); ctx.lineTo(x - 4, y);
    ctx.moveTo(x + 8, y + 8); ctx.lineTo(x + 4, y);
    ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y);
    ctx.stroke();
  }
}

function drawBlushChip(x, y, i) {
  ctx.fillStyle = '#FFDBAC';
  ctx.beginPath();
  ctx.arc(x, y + 5, 12, 0, Math.PI * 2);
  ctx.fill();
  // Eyes
  ctx.fillStyle = 'black';
  ctx.fillRect(x - 4, y + 3, 1.2, 1.2);
  ctx.fillRect(x + 3, y + 3, 1.2, 1.2);
  if (i > 0) {
    const alpha = i === 1 ? 0.45 : 0.85;
    ctx.fillStyle = 'rgba(255,140,170,' + alpha + ')';
    ctx.beginPath(); ctx.arc(x - 5, y + 7, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 5, y + 7, 2.5, 0, Math.PI * 2); ctx.fill();
  }
}

function drawDressupEleanor(sx, sy) {
  const du = dressup;
  const cx = sx + 16;
  const hc = hairFill(du.hairColor, cx, sy);
  const tieCol = '#FF80C0';

  // BACK HAIR by style (13 options)
  ctx.fillStyle = hc;
  switch (du.hairstyle) {
    case 0: {
      // Two braids (pigtails)
      ctx.beginPath(); ctx.ellipse(cx, sy + 14, 12, 10, 0, 0, Math.PI * 2); ctx.fill();
      for (let j = 0; j < 8; j++) {
        ctx.fillStyle = hairFill(du.hairColor, cx, sy);
        ctx.beginPath(); ctx.ellipse(cx - 10 + (j % 2 ? 0.7 : -0.7), sy + 18 + j * 3, 2.6, 2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + 10 + (j % 2 ? -0.7 : 0.7), sy + 18 + j * 3, 2.6, 2, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = tieCol;
      ctx.beginPath(); ctx.ellipse(cx - 10, sy + 44, 2.6, 1.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 10, sy + 44, 2.6, 1.6, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 1: {
      // One side braid
      ctx.beginPath(); ctx.ellipse(cx, sy + 14, 12, 10, 0, 0, Math.PI * 2); ctx.fill();
      for (let j = 0; j < 10; j++) {
        ctx.beginPath();
        ctx.ellipse(cx + 12 - j * 0.3, sy + 18 + j * 3, 3.2, 2.3, 0.2 + j * 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = tieCol;
      ctx.beginPath(); ctx.ellipse(cx + 9, sy + 48, 2.8, 1.6, 0.4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 2: {
      // High ponytail (up and back)
      ctx.beginPath(); ctx.ellipse(cx, sy + 14, 12, 10, 0, 0, Math.PI * 2); ctx.fill();
      // Pony rising up + falling back
      ctx.beginPath();
      ctx.moveTo(cx - 1, sy + 4);
      ctx.bezierCurveTo(cx - 8, sy - 4, cx - 12, sy + 4, cx - 9, sy + 18);
      ctx.bezierCurveTo(cx - 5, sy + 14, cx, sy + 8, cx + 2, sy + 4);
      ctx.fill();
      ctx.fillStyle = tieCol;
      ctx.beginPath(); ctx.arc(cx - 1, sy + 4, 2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 3: {
      // Two ponytails (pigtails)
      ctx.beginPath(); ctx.ellipse(cx, sy + 14, 12, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 14, sy + 24, 4.5, 12, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 14, sy + 24, 4.5, 12, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = tieCol;
      ctx.beginPath(); ctx.arc(cx - 10, sy + 15, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 10, sy + 15, 1.8, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 4: {
      // Two high buns (space buns)
      ctx.beginPath(); ctx.ellipse(cx, sy + 14, 12, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx - 7, sy - 1, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 7, sy - 1, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hairShade(du.hairColor);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(cx - 7, sy - 1, 3.5, 0, Math.PI * 2);
      ctx.arc(cx + 7, sy - 1, 3.5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 5: {
      // One high bun (top knot)
      ctx.beginPath(); ctx.ellipse(cx, sy + 14, 12, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, sy - 3, 6.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hairShade(du.hairColor);
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.arc(cx, sy - 3, 4.2, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 6: {
      // One French braid down the middle, with tail
      ctx.beginPath(); ctx.ellipse(cx, sy + 24, 14, 20, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hairShade(du.hairColor);
      for (let j = 0; j < 13; j++) {
        ctx.beginPath();
        ctx.ellipse(cx + (j % 2 ? -2.2 : 2.2), sy + 4 + j * 3.2, 3.6, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = tieCol;
      ctx.beginPath(); ctx.ellipse(cx, sy + 46, 3, 1.6, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 7: {
      // Two French braids
      ctx.beginPath(); ctx.ellipse(cx, sy + 24, 14, 20, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hairShade(du.hairColor);
      for (let j = 0; j < 10; j++) {
        ctx.beginPath(); ctx.ellipse(cx - 4, sy + 4 + j * 3.3, 2.6, 1.7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + 4, sy + 4 + j * 3.3, 2.6, 1.7, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = tieCol;
      ctx.beginPath(); ctx.arc(cx - 4, sy + 38, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 4, sy + 38, 1.6, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 8: {
      // Hair down (long flowing)
      ctx.beginPath(); ctx.ellipse(cx, sy + 28, 16, 24, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hairFill(du.hairColor, cx, sy);
      ctx.beginPath(); ctx.ellipse(cx - 13, sy + 28, 4, 11, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 13, sy + 28, 4, 11, 0.2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 9: {
      // Bangs (short bob)
      ctx.beginPath(); ctx.ellipse(cx, sy + 14, 13, 11, 0, 0, Math.PI * 2); ctx.fill();
      // Chin-length sides
      ctx.beginPath();
      ctx.moveTo(cx - 11, sy + 14);
      ctx.lineTo(cx - 11, sy + 22);
      ctx.lineTo(cx - 7, sy + 20);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 11, sy + 14);
      ctx.lineTo(cx + 11, sy + 22);
      ctx.lineTo(cx + 7, sy + 20);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 10: {
      // Wavy long
      ctx.beginPath();
      ctx.moveTo(cx - 12, sy + 10);
      ctx.bezierCurveTo(cx - 16, sy + 18, cx - 12, sy + 26, cx - 15, sy + 34);
      ctx.bezierCurveTo(cx - 13, sy + 42, cx - 8, sy + 46, cx, sy + 46);
      ctx.bezierCurveTo(cx + 8, sy + 46, cx + 13, sy + 42, cx + 15, sy + 34);
      ctx.bezierCurveTo(cx + 12, sy + 26, cx + 16, sy + 18, cx + 12, sy + 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = hairShade(du.hairColor);
      // Wave highlights
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = hairShade(du.hairColor);
      ctx.beginPath();
      for (let j = 0; j < 3; j++) {
        const yy = sy + 22 + j * 7;
        ctx.moveTo(cx - 12, yy);
        ctx.quadraticCurveTo(cx - 6, yy + 3, cx, yy);
        ctx.quadraticCurveTo(cx + 6, yy - 3, cx + 12, yy);
      }
      ctx.stroke();
      break;
    }
    case 11: {
      // Straight long
      ctx.beginPath();
      ctx.moveTo(cx - 12, sy + 10);
      ctx.lineTo(cx - 13, sy + 46);
      ctx.lineTo(cx + 13, sy + 46);
      ctx.lineTo(cx + 12, sy + 10);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 12: {
      // Curly
      ctx.beginPath(); ctx.ellipse(cx, sy + 26, 16, 22, 0, 0, Math.PI * 2); ctx.fill();
      // Curl loops around the edges
      for (let j = 0; j < 7; j++) {
        const ang = Math.PI + (j / 6) * Math.PI;
        const rx = cx + Math.cos(ang) * 15;
        const ry = sy + 28 + Math.sin(ang) * 17;
        ctx.fillStyle = hairFill(du.hairColor, cx, sy);
        ctx.beginPath(); ctx.arc(rx, ry, 3.2, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
  }

  // HEAD
  ctx.fillStyle = du.hairColor === 0 ? '#E8C5A0' : '#FFDBAC';
  ctx.beginPath(); ctx.arc(cx, sy + 14, 9, 0, Math.PI * 2); ctx.fill();

  // BANGS by style
  ctx.fillStyle = hairFill(du.hairColor, cx, sy);
  const st = du.hairstyle;
  if (st === 6 || st === 7) {
    // French braids cover the top — no separate bangs
  } else if (st === 9) {
    // Full bangs across the forehead (short bob)
    ctx.beginPath();
    ctx.moveTo(cx - 10, sy + 8);
    ctx.lineTo(cx - 10, sy + 13);
    ctx.lineTo(cx + 10, sy + 13);
    ctx.lineTo(cx + 10, sy + 8);
    ctx.quadraticCurveTo(cx, sy + 5, cx - 10, sy + 8);
    ctx.fill();
  } else if (st === 11) {
    // Center part
    ctx.beginPath();
    ctx.moveTo(cx - 9, sy + 9);
    ctx.lineTo(cx - 1, sy + 13);
    ctx.lineTo(cx + 1, sy + 13);
    ctx.lineTo(cx + 9, sy + 9);
    ctx.quadraticCurveTo(cx, sy + 14, cx - 9, sy + 9);
    ctx.fill();
  } else if (st === 12) {
    // Curly bangs
    ctx.beginPath();
    ctx.arc(cx - 5, sy + 10, 2.5, 0, Math.PI * 2);
    ctx.arc(cx, sy + 8, 2.5, 0, Math.PI * 2);
    ctx.arc(cx + 5, sy + 10, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (st === 10) {
    // Wavy side-swept
    ctx.beginPath();
    ctx.moveTo(cx - 9, sy + 9);
    ctx.quadraticCurveTo(cx - 2, sy + 4, cx + 9, sy + 8);
    ctx.quadraticCurveTo(cx + 4, sy + 12, cx - 9, sy + 9);
    ctx.fill();
  } else {
    // Standard sweep
    ctx.beginPath();
    ctx.moveTo(cx - 9, sy + 9);
    ctx.quadraticCurveTo(cx, sy + 3, cx + 9, sy + 7);
    ctx.quadraticCurveTo(cx + 2, sy + 14, cx - 9, sy + 9);
    ctx.fill();
  }

  // CROWN
  if (du.crown > 0) {
    ctx.fillStyle = CROWN_COLORS[du.crown];
    ctx.beginPath();
    ctx.moveTo(cx - 8, sy + 3);
    ctx.lineTo(cx - 5, sy - 4);
    ctx.lineTo(cx - 2, sy + 3);
    ctx.lineTo(cx, sy - 6);
    ctx.lineTo(cx + 2, sy + 3);
    ctx.lineTo(cx + 5, sy - 4);
    ctx.lineTo(cx + 8, sy + 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - 8, sy + 3, 16, 2.5);
    // Crown jewel (uses crownJewel color)
    ctx.fillStyle = CROWN_JEWEL_COLORS[du.crownJewel];
    ctx.beginPath(); ctx.arc(cx, sy + 4, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CROWN_JEWEL_COLORS[(du.crownJewel + 2) % 6];
    ctx.beginPath(); ctx.arc(cx - 4, sy + 4, 0.9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 4, sy + 4, 0.9, 0, Math.PI * 2); ctx.fill();
    if (du.crown === 4) {
      // Flower crown — flowers on top
      for (let j = 0; j < 3; j++) {
        const fx = cx - 4 + j * 4;
        ctx.fillStyle = '#FF80C0';
        ctx.beginPath(); ctx.arc(fx, sy - 3, 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FFD700';
        ctx.beginPath(); ctx.arc(fx, sy - 3, 0.6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // EYESHADOW (above eyes)
  const esColor = EYESHADOW_COLORS[du.eyeshadow];
  if (esColor) {
    ctx.fillStyle = esColor;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.arc(cx - 3.2, sy + 12.5, 2.8, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 3.2, sy + 12.5, 2.8, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // EYES
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.arc(cx - 3.2, sy + 14, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 3.2, sy + 14, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = EYE_COLORS[du.eyeColor];
  ctx.beginPath(); ctx.arc(cx - 2.9, sy + 14.3, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 3.5, sy + 14.3, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'white';
  ctx.fillRect(cx - 3.3, sy + 13.5, 0.8, 0.8);
  ctx.fillRect(cx + 3.1, sy + 13.5, 0.8, 0.8);
  // Eyelashes
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(cx - 5, sy + 13); ctx.lineTo(cx - 4, sy + 12);
  ctx.moveTo(cx + 5, sy + 13); ctx.lineTo(cx + 4, sy + 12);
  ctx.stroke();

  // BLUSH
  if (du.blush > 0) {
    const a = du.blush === 1 ? 0.45 : 0.8;
    ctx.fillStyle = 'rgba(255,140,170,' + a + ')';
    ctx.beginPath(); ctx.arc(cx - 6, sy + 17, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 6, sy + 17, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  // MOUTH (with optional lipstick)
  const happy = dressupReady();
  const lipColor = LIPSTICK_COLORS[du.lipstick];
  if (lipColor) {
    ctx.fillStyle = lipColor;
    if (happy) {
      ctx.beginPath();
      ctx.moveTo(cx - 3, sy + 19);
      ctx.quadraticCurveTo(cx, sy + 22, cx + 3, sy + 19);
      ctx.quadraticCurveTo(cx, sy + 20, cx - 3, sy + 19);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(cx, sy + 22, 2, Math.PI, 0, true);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = '#7A2A40';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (happy) ctx.arc(cx, sy + 19, 2.5, 0.15 * Math.PI, 0.85 * Math.PI);
    else ctx.arc(cx, sy + 23, 2.5, Math.PI * 1.15, Math.PI * 1.85, true);
    ctx.stroke();
  }

  // DRESS
  const dressCol = DRESS_COLORS[du.dressColor];
  ctx.fillStyle = dressCol;
  ctx.beginPath();
  ctx.moveTo(cx - 8, sy + 24);
  ctx.lineTo(cx + 8, sy + 24);
  ctx.quadraticCurveTo(cx + 16, sy + 36, cx + 16, sy + 42);
  if (du.dressColor === 0) {
    ctx.lineTo(cx + 13, sy + 46);
    ctx.lineTo(cx + 9, sy + 41);
    ctx.lineTo(cx + 4, sy + 46);
    ctx.lineTo(cx, sy + 41);
    ctx.lineTo(cx - 4, sy + 46);
    ctx.lineTo(cx - 9, sy + 41);
    ctx.lineTo(cx - 13, sy + 46);
    ctx.lineTo(cx - 16, sy + 42);
  } else {
    ctx.lineTo(cx - 16, sy + 42);
  }
  ctx.quadraticCurveTo(cx - 16, sy + 36, cx - 8, sy + 24);
  ctx.closePath();
  ctx.fill();

  if (du.dressPattern > 0 && du.dressColor > 0) {
    drawDressPattern(cx, sy, du.dressPattern, dressCol);
  }
  // V-neck
  ctx.fillStyle = du.hairColor === 0 ? '#E8C5A0' : '#FFDBAC';
  ctx.beginPath();
  ctx.moveTo(cx - 3, sy + 24);
  ctx.lineTo(cx, sy + 27);
  ctx.lineTo(cx + 3, sy + 24);
  ctx.closePath();
  ctx.fill();
  // Gold sash on bright dresses
  if (du.dressColor >= 2) {
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(cx - 14, sy + 32, 28, 2.5);
  }

  // NECKLACE
  if (du.necklace > 0) {
    const ncol = NECKLACE_COLORS[du.necklace];
    ctx.strokeStyle = ncol;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(cx, sy + 23, 6, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
    if (du.necklace === 2) {
      // Pearl strand
      for (let p = 0; p < 7; p++) {
        const a = Math.PI * 0.12 + (p / 6) * Math.PI * 0.76;
        ctx.fillStyle = '#F0E8D0';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * 6, sy + 23 + Math.sin(a) * 6, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (du.necklace === 3) {
      // Heart pendant
      ctx.fillStyle = '#FF80C0';
      ctx.beginPath();
      ctx.arc(cx - 1, sy + 28, 1, 0, Math.PI * 2);
      ctx.arc(cx + 1, sy + 28, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 2, sy + 28);
      ctx.lineTo(cx, sy + 30.2);
      ctx.lineTo(cx + 2, sy + 28);
      ctx.fill();
    } else if (du.necklace === 4) {
      // Ruby pendant
      ctx.fillStyle = '#C04040';
      ctx.beginPath();
      ctx.arc(cx, sy + 29, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(cx - 0.5, sy + 28.5, 0.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (du.necklace === 1) {
      // Gold pendant
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(cx, sy + 28.5, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // EARRINGS
  if (du.earrings > 0) {
    const ecol = EARRING_COLORS[du.earrings];
    ctx.fillStyle = ecol;
    if (du.earrings === 1) {
      // Studs
      ctx.beginPath(); ctx.arc(cx - 9, sy + 16, 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 9, sy + 16, 0.8, 0, Math.PI * 2); ctx.fill();
    } else if (du.earrings === 2) {
      // Pearl drops
      ctx.beginPath(); ctx.arc(cx - 9, sy + 15, 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 9, sy + 15, 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 9, sy + 18, 0.9, 1.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 9, sy + 18, 0.9, 1.4, 0, 0, Math.PI * 2); ctx.fill();
    } else if (du.earrings === 3 || du.earrings === 4) {
      // Dangle
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.moveTo(cx - 9, sy + 14); ctx.lineTo(cx - 9, sy + 18.5);
      ctx.moveTo(cx + 9, sy + 14); ctx.lineTo(cx + 9, sy + 18.5);
      ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx - 9, sy + 20, 1, 1.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 9, sy + 20, 1, 1.6, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ARMS
  ctx.fillStyle = du.hairColor === 0 ? '#E8C5A0' : '#FFDBAC';
  ctx.beginPath(); ctx.ellipse(cx - 11, sy + 28, 2.2, 5.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 11, sy + 28, 2.2, 5.5, 0, 0, Math.PI * 2); ctx.fill();

  // BRACELET
  if (du.bracelet > 0) {
    ctx.fillStyle = BRACELET_COLORS[du.bracelet];
    ctx.fillRect(cx - 13, sy + 32, 4, 1.2);
    ctx.fillRect(cx + 9, sy + 32, 4, 1.2);
    if (du.bracelet === 3) {
      ctx.fillStyle = '#FF80C0';
      ctx.beginPath(); ctx.arc(cx - 11, sy + 34, 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 11, sy + 34, 0.6, 0, Math.PI * 2); ctx.fill();
    } else if (du.bracelet === 2) {
      ctx.fillStyle = '#FFFFFF';
      for (let pp = 0; pp < 3; pp++) {
        ctx.beginPath(); ctx.arc(cx - 12 + pp * 1.5, sy + 32.6, 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + 9.5 + pp * 1.5, sy + 32.6, 0.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // NAILS
  const nailCol = NAIL_COLORS[du.nails];
  if (nailCol) {
    ctx.fillStyle = nailCol;
    ctx.beginPath(); ctx.arc(cx - 11, sy + 33, 0.9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 11, sy + 33, 0.9, 0, Math.PI * 2); ctx.fill();
    if (du.nails === 5) {
      ctx.fillStyle = 'white';
      ctx.fillRect(cx - 11.2, sy + 32.6, 0.4, 0.4);
      ctx.fillRect(cx + 10.8, sy + 33.3, 0.4, 0.4);
    }
  }

  // SHOES
  if (du.shoes > 0) {
    const shoeCol = SHOE_COLORS[du.shoesColor];
    ctx.fillStyle = shoeCol;
    if (du.shoes === 1) {
      // Slippers
      ctx.beginPath(); ctx.ellipse(cx - 3, sy + 43, 2.8, 1.3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 3, sy + 43, 2.8, 1.3, 0, 0, Math.PI * 2); ctx.fill();
    } else if (du.shoes === 2) {
      // High heels
      ctx.beginPath();
      ctx.moveTo(cx - 5.5, sy + 42);
      ctx.lineTo(cx - 0.5, sy + 41);
      ctx.lineTo(cx - 0.5, sy + 43);
      ctx.lineTo(cx - 5.5, sy + 43);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 0.5, sy + 41);
      ctx.lineTo(cx + 5.5, sy + 42);
      ctx.lineTo(cx + 5.5, sy + 43);
      ctx.lineTo(cx + 0.5, sy + 43);
      ctx.closePath();
      ctx.fill();
      // Thin heels
      ctx.fillRect(cx - 5.2, sy + 43, 0.6, 3);
      ctx.fillRect(cx + 4.6, sy + 43, 0.6, 3);
    } else if (du.shoes === 3) {
      // Tall boots
      ctx.fillRect(cx - 5.2, sy + 34, 2.5, 10);
      ctx.fillRect(cx + 2.7, sy + 34, 2.5, 10);
      ctx.beginPath(); ctx.ellipse(cx - 3, sy + 44, 3, 1.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 3, sy + 44, 3, 1.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(cx - 5.2, sy + 34, 2.5, 2);
      ctx.fillRect(cx + 2.7, sy + 34, 2.5, 2);
    } else if (du.shoes === 4) {
      // Sandals
      ctx.beginPath(); ctx.ellipse(cx - 3, sy + 43.5, 2.7, 1.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 3, sy + 43.5, 2.7, 1.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = shoeCol;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(cx - 4, sy + 42.5); ctx.lineTo(cx - 2, sy + 41);
      ctx.moveTo(cx + 2, sy + 41); ctx.lineTo(cx + 4, sy + 42.5);
      ctx.stroke();
    }
  }
}

function drawDressPattern(cx, sy, pattern, dressColor) {
  let pc = '#7A2A40';
  if (dressColor === '#FF69B4') pc = '#FFD700';
  else if (dressColor === '#FFD700') pc = '#E04A95';
  else if (dressColor === '#9040C0') pc = '#FFD700';
  else if (dressColor === '#4080C0') pc = '#FFFFFF';
  else if (dressColor === '#FFFFFF') pc = '#E04A95';
  else if (dressColor === '#40A040') pc = '#FFD700';

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - 8, sy + 24);
  ctx.lineTo(cx + 8, sy + 24);
  ctx.quadraticCurveTo(cx + 16, sy + 36, cx + 16, sy + 42);
  ctx.lineTo(cx - 16, sy + 42);
  ctx.quadraticCurveTo(cx - 16, sy + 36, cx - 8, sy + 24);
  ctx.closePath();
  ctx.clip();

  ctx.fillStyle = pc;
  if (pattern === 1) {
    for (let dx = -16; dx <= 16; dx += 4) for (let dy = 24; dy <= 42; dy += 4) {
      ctx.beginPath(); ctx.arc(cx + dx, sy + dy, 1, 0, Math.PI * 2); ctx.fill();
    }
  } else if (pattern === 2) {
    for (let dy = 25; dy <= 42; dy += 2.5) ctx.fillRect(cx - 16, sy + dy, 32, 1);
  } else if (pattern === 3) {
    for (let dy = 26; dy <= 42; dy += 5) {
      for (let dx = -12; dx <= 12; dx += 6) {
        const hx = cx + dx + (Math.floor((dy - 26) / 5) % 2 === 0 ? 0 : 3);
        ctx.beginPath();
        ctx.arc(hx - 1.2, sy + dy, 1, 0, Math.PI * 2);
        ctx.arc(hx + 1.2, sy + dy, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(hx - 2.4, sy + dy);
        ctx.lineTo(hx, sy + dy + 2);
        ctx.lineTo(hx + 2.4, sy + dy);
        ctx.fill();
      }
    }
  } else if (pattern === 4) {
    for (let dy = 27; dy <= 41; dy += 5) {
      for (let dx = -12; dx <= 12; dx += 5) {
        drawStar(cx + dx + (Math.floor((dy - 27) / 5) % 2 ? 2 : 0), sy + dy, 1.7);
      }
    }
  } else if (pattern === 5) {
    for (let dy = 27; dy <= 41; dy += 5) {
      for (let dx = -12; dx <= 12; dx += 5) {
        const fx = cx + dx + (Math.floor((dy - 27) / 5) % 2 ? 2 : 0);
        for (let k = 0; k < 5; k++) {
          const a = k * Math.PI / 2.5;
          ctx.beginPath();
          ctx.arc(fx + Math.cos(a) * 1, sy + dy + Math.sin(a) * 1, 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  ctx.restore();
}

// =========================================================
// SAVED ELEANORS GALLERY
// =========================================================
let galleryPage = 0;
function updateGallery() {
  if (pressed(['escape'])) state = STATE.LEVEL_SELECT;
  const total = (save.savedEleanors || []).length;
  const perPage = 10;
  const maxPage = Math.max(0, Math.ceil(total / perPage) - 1);
  if (pressed(K_LEFT))  { galleryPage = Math.max(0, galleryPage - 1); sfx.select(); }
  if (pressed(K_RIGHT)) { galleryPage = Math.min(maxPage, galleryPage + 1); sfx.select(); }
}

function drawGallery() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#FFD8E8');
  g.addColorStop(1, '#FFE5F0');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 25; i++) {
    const sx = (i * 71 + 30) % W;
    const sy = (i * 41 + 30) % H;
    const a = 0.3 + 0.3 * Math.sin(Date.now() / 300 + i);
    ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
    ctx.beginPath(); ctx.arc(sx, sy, 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#7A2A40';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Saved Eleanors', W / 2, 38);

  const list = save.savedEleanors || [];
  const perPage = 10;
  const total = list.length;
  const maxPage = Math.max(0, Math.ceil(total / perPage) - 1);
  if (galleryPage > maxPage) galleryPage = maxPage;
  const startIdx = galleryPage * perPage;
  const slice = list.slice(startIdx, startIdx + perPage);

  if (total === 0) {
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#7A2A40';
    ctx.fillText('No Eleanors saved yet!', W / 2, 200);
    ctx.font = '14px sans-serif';
    ctx.fillText('Finish level 31 to save your makeover here.', W / 2, 230);
  } else {
    const cellW = 130, cellH = 175;
    const cols = 5;
    const gridStartX = (W - cols * cellW) / 2;
    const gridStartY = 65;
    for (let i = 0; i < slice.length; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const x = gridStartX + col * cellW;
      const y = gridStartY + row * cellH;
      // Card
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillRect(x + 5, y + 5, cellW - 10, cellH - 10);
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 5, y + 5, cellW - 10, cellH - 10);
      // Pedestal
      ctx.fillStyle = '#C46BAE';
      ctx.beginPath();
      ctx.ellipse(x + cellW / 2, y + 140, 38, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Eleanor
      drawSavedEleanorAt(x + cellW / 2, y + 75, slice[i]);
      // Name + number
      const name = (slice[i] && slice[i].name) ? slice[i].name : 'Eleanor';
      ctx.fillStyle = '#7A2A40';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      const shownName = name.length > 14 ? name.slice(0, 13) + '…' : name;
      ctx.fillText(shownName, x + cellW / 2, y + 154);
      ctx.fillStyle = '#A06080';
      ctx.font = '10px sans-serif';
      ctx.fillText('#' + (startIdx + i + 1), x + cellW / 2, y + 168);
    }
    // Page indicator
    if (maxPage > 0) {
      ctx.fillStyle = '#5A2A4A';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Page ' + (galleryPage + 1) + ' / ' + (maxPage + 1) + '   (← → arrows)', W / 2, H - 60);
    }
  }

  // Back button
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(W / 2 - 80, H - 42, 160, 32);
  ctx.fillStyle = '#5a2080';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('← Back', W / 2, H - 21);
  ctx.textAlign = 'start';
}

function drawSavedEleanorAt(centerX, centerY, config) {
  const saved = dressup;
  // Inject a temporary dressup state so drawDressupEleanor renders from the saved config
  dressup = Object.assign({
    hairstyle: 0, hairColor: 0, crown: 0, crownJewel: 0,
    dressColor: 0, dressPattern: 0, shoes: 0, shoesColor: 0,
    eyeColor: 0, eyeshadow: 0, blush: 0, lipstick: 0, nails: 0,
    necklace: 0, earrings: 0, bracelet: 0,
    activeTab: 0, sparkleT: 0,
  }, config);
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.scale(1.8, 1.8);
  drawDressupEleanor(-16, -28);
  ctx.restore();
  dressup = saved;
}

// =========================================================
// MAZE HOME (Level 32)
// =========================================================
const MAZE_LAYOUT = [
  "WWWWWWWWWWWW",
  "W..........W",
  "W.WWWWWW.W.W",
  "W......W.W.W",
  "W.WWWW.W.W.W",
  "W.W..W...W.W",
  "W.W.WWWWW..W",
  "W..........P",
  "WWWWWWWWWWWW",
];
const MAZE_COLS = 12;
const MAZE_ROWS = 9;
const MAZE_TILE = 48;
const MAZE_OX = (W - MAZE_COLS * MAZE_TILE) / 2;  // 112
const MAZE_OY = 50;
const MAZE_COIN_TILES = [[2,1],[5,1],[8,1],[3,3],[6,5],[7,5],[3,7],[8,7]];

function mazeIsWall(px, py) {
  const c = Math.floor((px - MAZE_OX) / MAZE_TILE);
  const r = Math.floor((py - MAZE_OY) / MAZE_TILE);
  if (r < 0 || r >= MAZE_ROWS || c < 0 || c >= MAZE_COLS) return true;
  const ch = MAZE_LAYOUT[r][c];
  return ch === 'W';
}

function mazeCollides(x, y, w, h) {
  return mazeIsWall(x, y) || mazeIsWall(x + w - 1, y) ||
         mazeIsWall(x, y + h - 1) || mazeIsWall(x + w - 1, y + h - 1);
}

function defaultEleanorOutfit() {
  return {
    hairstyle: 8, hairColor: 1, crown: 1, crownJewel: 4,
    dressColor: 1, dressPattern: 0, shoes: 2, shoesColor: 1,
    eyeColor: 1, eyeshadow: 1, blush: 1, lipstick: 1, nails: 1,
    necklace: 3, earrings: 1, bracelet: 1,
  };
}

function startMaze() {
  state = STATE.MAZE;
  // Eleanor wears the most recently saved outfit, or a fancy default
  const list = save.savedEleanors || [];
  const outfit = list.length > 0 ? list[list.length - 1] : defaultEleanorOutfit();
  dressup = Object.assign({
    hairstyle: 0, hairColor: 0, crown: 0, crownJewel: 0,
    dressColor: 0, dressPattern: 0, shoes: 0, shoesColor: 0,
    eyeColor: 0, eyeshadow: 0, blush: 0, lipstick: 0, nails: 0,
    necklace: 0, earrings: 0, bracelet: 0,
    activeTab: 0, sparkleT: 0,
  }, outfit);

  maze = {
    px: MAZE_OX + MAZE_TILE + 10,
    py: MAZE_OY + MAZE_TILE + 5,
    pw: 28, ph: 38,
    pvx: 0, pvy: 0,
    facing: 1,
    hearts: 3,
    invincible: 60,
    swingTimer: 0,
    coinsCollected: 0,
    coinsTotal: MAZE_COIN_TILES.length,
    enemies: [
      { x: MAZE_OX + 5.5*MAZE_TILE,  y: MAZE_OY + 1.3*MAZE_TILE, w: 28, h: 28, vx: 1.4, vy: 0,   alive: true, kind: 'shadow' },
      { x: MAZE_OX + 1.4*MAZE_TILE,  y: MAZE_OY + 5.4*MAZE_TILE, w: 28, h: 28, vx: 0,   vy: 1.4, alive: true, kind: 'shadow' },
      { x: MAZE_OX + 10.4*MAZE_TILE, y: MAZE_OY + 4.4*MAZE_TILE, w: 28, h: 28, vx: 0,   vy: 1.4, alive: true, kind: 'shadow' },
      { x: MAZE_OX + 6.4*MAZE_TILE,  y: MAZE_OY + 7.4*MAZE_TILE, w: 28, h: 28, vx: 1.2, vy: 0,   alive: true, kind: 'shadow' },
    ],
    coins: MAZE_COIN_TILES.map(([c, r]) => ({
      x: MAZE_OX + (c + 0.5) * MAZE_TILE,
      y: MAZE_OY + (r + 0.5) * MAZE_TILE,
      taken: false,
    })),
    palace: { x: MAZE_OX + 11.5 * MAZE_TILE, y: MAZE_OY + 7.5 * MAZE_TILE },
    won: false,
    wonTimer: 0,
  };
  particles = [];
  currentLevel = 32;
}

function updateMaze() {
  const m = maze;
  if (pressed(['escape'])) { state = STATE.LEVEL_SELECT; selectedLevel = 32; return; }
  if (m.won) {
    m.wonTimer--;
    if (m.wonTimer <= 0) {
      save.cleared[32] = true;
      saveProgress();
      state = STATE.FINAL_WIN;
      levelTransitionTimer = 180;
    }
    return;
  }
  // Movement
  let dx = 0, dy = 0;
  if (isDown(K_LEFT))  dx -= 1;
  if (isDown(K_RIGHT)) dx += 1;
  if (isDown(['arrowup', 'w'])) dy -= 1;
  if (isDown(K_DOWN)) dy += 1;
  const speed = 2.4;
  let vx = dx * speed, vy = dy * speed;
  if (dx !== 0 && dy !== 0) { vx *= 0.707; vy *= 0.707; }
  if (Math.abs(dx) > 0) m.facing = dx > 0 ? 1 : -1;

  // Move with collision
  if (vx !== 0) {
    const nx = m.px + vx;
    if (!mazeCollides(nx + 4, m.py + 16, m.pw - 8, m.ph - 18)) m.px = nx;
  }
  if (vy !== 0) {
    const ny = m.py + vy;
    if (!mazeCollides(m.px + 4, ny + 16, m.pw - 8, m.ph - 18)) m.py = ny;
  }

  // Attack (Z, N, or Space)
  if ((pressed(['z']) || pressed(['n']) || pressed([' '])) && m.swingTimer <= 0) {
    m.swingTimer = 16;
    sfx.spray();
  }
  if (m.swingTimer > 0) m.swingTimer--;

  // Enemy movement + collision
  const pcx = m.px + m.pw/2, pcy = m.py + m.ph/2;
  for (const e of m.enemies) {
    if (!e.alive) continue;
    const nx = e.x + e.vx, ny = e.y + e.vy;
    if (mazeCollides(nx, e.y, e.w, e.h)) e.vx = -e.vx;
    else e.x = nx;
    if (mazeCollides(e.x, ny, e.w, e.h)) e.vy = -e.vy;
    else e.y = ny;

    const ecx = e.x + e.w/2, ecy = e.y + e.h/2;
    const dxe = pcx - ecx, dye = pcy - ecy;
    const distSq = dxe*dxe + dye*dye;
    // Swing attack reaches enemies within ~50 px of Eleanor's center
    if (m.swingTimer > 0 && distSq < 50*50) {
      e.alive = false;
      sfx.defeat();
      addParticles(e.x + e.w/2, e.y + e.h/2, 10, '#FF8080', 5);
      continue;
    }
    // Direct contact damages Eleanor
    if (distSq < 25*25 && m.invincible <= 0) {
      m.hearts--;
      sfx.hurt();
      m.invincible = 90;
      const d = Math.sqrt(distSq) || 1;
      m.px += dxe/d * 22;
      m.py += dye/d * 22;
      if (m.hearts <= 0) {
        state = STATE.GAME_OVER;
        levelTransitionTimer = 120;
        sfx.gameOver();
        return;
      }
    }
  }
  if (m.invincible > 0) m.invincible--;

  // Coins
  for (const c of m.coins) {
    if (c.taken) continue;
    const cx = c.x - (m.px + m.pw/2);
    const cy = c.y - (m.py + m.ph/2);
    if (cx*cx + cy*cy < 22*22) {
      c.taken = true;
      m.coinsCollected++;
      sfx.coin();
      addParticles(c.x, c.y, 8, '#FFD700');
    }
  }

  // Palace (only triggers once all coins are in)
  if (m.coinsCollected >= m.coinsTotal) {
    const dxp = m.palace.x - (m.px + m.pw/2);
    const dyp = m.palace.y - (m.py + m.ph/2);
    if (dxp*dxp + dyp*dyp < 36*36) {
      m.won = true;
      m.wonTimer = 90;
      sfx.bigWin();
      addParticles(m.palace.x, m.palace.y, 24, '#FFD700', 6);
    }
  }
  updateHUD();
}

function drawHeart(x, y, filled) {
  ctx.fillStyle = filled ? '#FF4070' : '#444';
  ctx.beginPath();
  ctx.arc(x + 5, y + 5, 5, 0, Math.PI * 2);
  ctx.arc(x + 13, y + 5, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y + 6);
  ctx.lineTo(x + 9, y + 16);
  ctx.lineTo(x + 18, y + 6);
  ctx.closePath();
  ctx.fill();
}

function drawMaze() {
  const m = maze;
  // Night sky background
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1a0820');
  g.addColorStop(1, '#3a1830');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Stars
  ctx.fillStyle = 'white';
  for (let i = 0; i < 25; i++) {
    const sx = (i * 97) % W;
    const sy = (i * 53) % 45;
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }

  // Maze tiles
  for (let r = 0; r < MAZE_ROWS; r++) {
    for (let c = 0; c < MAZE_COLS; c++) {
      const x = MAZE_OX + c * MAZE_TILE;
      const y = MAZE_OY + r * MAZE_TILE;
      const ch = MAZE_LAYOUT[r][c];
      if (ch === 'W') {
        // Stone wall
        ctx.fillStyle = '#5A5A78';
        ctx.fillRect(x, y, MAZE_TILE, MAZE_TILE);
        ctx.fillStyle = '#7A7A98';
        ctx.fillRect(x + 2, y + 2, MAZE_TILE - 4, 4);
        ctx.fillStyle = '#3A3A58';
        ctx.fillRect(x, y + MAZE_TILE - 4, MAZE_TILE, 4);
        ctx.fillRect(x + MAZE_TILE - 4, y, 4, MAZE_TILE);
        // Tiny block lines
        ctx.fillStyle = '#3A3A58';
        ctx.fillRect(x + MAZE_TILE/2 - 1, y + 4, 2, MAZE_TILE - 8);
        ctx.fillRect(x + 4, y + MAZE_TILE/2 - 1, MAZE_TILE - 8, 2);
      } else {
        // Carpet floor
        ctx.fillStyle = '#C8A878';
        ctx.fillRect(x, y, MAZE_TILE, MAZE_TILE);
        ctx.fillStyle = '#B89868';
        ctx.fillRect(x + MAZE_TILE/2 - 1, y, 2, MAZE_TILE);
        ctx.fillRect(x, y + MAZE_TILE/2 - 1, MAZE_TILE, 2);
      }
    }
  }

  // Palace (right side)
  const palaceUnlocked = m.coinsCollected >= m.coinsTotal;
  const px = m.palace.x - 30;
  const py = m.palace.y - 30;
  // Glow if unlocked
  if (palaceUnlocked) {
    ctx.fillStyle = 'rgba(255,255,200,0.35)';
    const r = 50 + Math.sin(Date.now()/250) * 8;
    ctx.beginPath();
    ctx.arc(m.palace.x, m.palace.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#D4A040';
  ctx.fillRect(px, py - 12, 60, 60);
  // Crenellations
  ctx.fillStyle = '#B07820';
  for (let i = 0; i < 4; i++) ctx.fillRect(px + i * 15, py - 22, 11, 12);
  // Door
  ctx.fillStyle = palaceUnlocked ? '#5A3A1A' : '#3A2A1A';
  ctx.beginPath();
  ctx.moveTo(px + 22, py + 48);
  ctx.lineTo(px + 22, py + 22);
  ctx.arc(px + 30, py + 22, 8, Math.PI, 0);
  ctx.lineTo(px + 38, py + 48);
  ctx.closePath();
  ctx.fill();
  if (palaceUnlocked) {
    // Bright open archway
    ctx.fillStyle = '#FFE89A';
    ctx.beginPath();
    ctx.moveTo(px + 25, py + 48);
    ctx.lineTo(px + 25, py + 24);
    ctx.arc(px + 30, py + 24, 5, Math.PI, 0);
    ctx.lineTo(px + 35, py + 48);
    ctx.closePath();
    ctx.fill();
  } else {
    // Lock icon on door
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(px + 27, py + 28, 6, 7);
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px + 30, py + 28, 3, Math.PI, 0);
    ctx.stroke();
  }
  // Flag
  ctx.fillStyle = '#3A2A1A';
  ctx.fillRect(px + 28, py - 36, 2, 16);
  ctx.fillStyle = '#FF6BCB';
  ctx.beginPath();
  ctx.moveTo(px + 30, py - 36);
  ctx.lineTo(px + 42, py - 32);
  ctx.lineTo(px + 30, py - 28);
  ctx.fill();

  // Coins
  const t = Date.now() / 250;
  for (const c of m.coins) {
    if (c.taken) continue;
    const bob = Math.sin(t + c.x) * 2;
    ctx.fillStyle = '#FFD700';
    ctx.beginPath(); ctx.arc(c.x, c.y + bob, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFB000';
    ctx.beginPath(); ctx.arc(c.x, c.y + bob, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(c.x - 2, c.y - 2 + bob, 1.5, 1.5);
  }

  // Enemies (shadow blobs)
  for (const e of m.enemies) {
    if (!e.alive) continue;
    const ecx = e.x + e.w/2, ecy = e.y + e.h/2;
    // Body
    ctx.fillStyle = '#2A1020';
    ctx.beginPath();
    ctx.arc(ecx, ecy, 15, 0, Math.PI * 2);
    ctx.fill();
    // Drippy bottom
    ctx.beginPath();
    ctx.arc(ecx - 6, ecy + 8, 3.5, 0, Math.PI * 2);
    ctx.arc(ecx, ecy + 10, 3.5, 0, Math.PI * 2);
    ctx.arc(ecx + 6, ecy + 8, 3.5, 0, Math.PI * 2);
    ctx.fill();
    // Red glowing eyes
    ctx.fillStyle = '#FF2030';
    ctx.beginPath();
    ctx.arc(ecx - 5, ecy - 3, 2.5, 0, Math.PI * 2);
    ctx.arc(ecx + 5, ecy - 3, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(ecx - 5.5, ecy - 3.5, 1, 1);
    ctx.fillRect(ecx + 4.5, ecy - 3.5, 1, 1);
    // Mean fangs
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(ecx - 3, ecy + 3);
    ctx.lineTo(ecx - 2, ecy + 6);
    ctx.lineTo(ecx - 1, ecy + 3);
    ctx.moveTo(ecx + 1, ecy + 3);
    ctx.lineTo(ecx + 2, ecy + 6);
    ctx.lineTo(ecx + 3, ecy + 3);
    ctx.fill();
  }

  // Swing effect (around Eleanor)
  if (m.swingTimer > 0) {
    const k = m.swingTimer / 16;
    const cx = m.px + m.pw/2, cy = m.py + m.ph/2;
    ctx.strokeStyle = 'rgba(255,255,200,' + k + ')';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,210,255,' + (k * 0.7) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 38, 0, Math.PI * 2);
    ctx.stroke();
    // Sparkles
    for (let s = 0; s < 8; s++) {
      const ang = (Date.now() / 100) + s * Math.PI / 4;
      const sx = cx + Math.cos(ang) * 32;
      const sy = cy + Math.sin(ang) * 32;
      ctx.fillStyle = '#FFD700';
      ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Eleanor (scaled-up dressup sprite, possibly flickering when invincible)
  const flicker = m.invincible > 0 && Math.floor(m.invincible/4) % 2 === 0;
  ctx.save();
  ctx.globalAlpha = flicker ? 0.5 : 1;
  ctx.translate(m.px + m.pw/2, m.py + m.ph/2);
  if (m.facing < 0) ctx.scale(-1.4, 1.4);
  else ctx.scale(1.4, 1.4);
  drawDressupEleanor(-16, -24);
  ctx.restore();

  drawParticles(false);

  // HUD bar
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, W, 44);
  // Hearts
  for (let i = 0; i < 3; i++) drawHeart(10 + i * 26, 14, i < m.hearts);
  // Coins
  ctx.fillStyle = '#FFD700';
  ctx.beginPath(); ctx.arc(100, 22, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFB000';
  ctx.beginPath(); ctx.arc(100, 22, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(m.coinsCollected + ' / ' + m.coinsTotal, 115, 28);
  // Hint
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  if (palaceUnlocked) {
    ctx.fillText('All gold! Run to the palace!', W - 10, 19);
  } else {
    ctx.fillText('Arrows = move · Z/Space = magic wand', W - 10, 19);
  }
  ctx.fillText('Bring Eleanor home with all her money', W - 10, 35);
  ctx.textAlign = 'start';

  if (m.won) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, H/2 - 36, W, 72);
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Home Safe!', W/2, H/2 + 4);
    ctx.textAlign = 'start';
  }
}

// =========================================================
// GO
// =========================================================
updateHUD();
loop();
