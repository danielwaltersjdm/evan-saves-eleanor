let audioCtx = null;
let muted = false;

function initAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function setMuted(m) { muted = m; }

function tone(freq, dur, type = 'square', vol = 0.06, delay = 0) {
  if (muted || !audioCtx) return;
  const t = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

function sweep(f1, f2, dur, type = 'square', vol = 0.06) {
  if (muted || !audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f1, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, f2), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

function noise(dur, vol = 0.05, filterFreq = 1000) {
  if (muted || !audioCtx) return;
  const sr = audioCtx.sampleRate;
  const bufSize = Math.floor(sr * dur);
  const buf = audioCtx.createBuffer(1, bufSize, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  const gain = audioCtx.createGain();
  gain.gain.value = vol;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  src.start();
}

const sfx = {
  jump:     () => sweep(380, 720, 0.09, 'square', 0.05),
  doubleJump: () => sweep(500, 900, 0.12, 'square', 0.05),
  coin:     () => { tone(880, 0.06); tone(1320, 0.1, 'square', 0.06, 0.06); },
  hurt:     () => sweep(330, 90, 0.28, 'sawtooth', 0.07),
  defeat:   () => sweep(700, 220, 0.18, 'triangle', 0.06),
  spray:    () => noise(0.18, 0.06, 1800),
  splash:   () => noise(0.25, 0.08, 600),
  bubble:   () => tone(640 + Math.random() * 200, 0.05, 'sine', 0.025),
  enter:    () => sweep(800, 220, 0.22, 'sine', 0.07),
  exit:     () => sweep(220, 880, 0.22, 'sine', 0.07),
  power:    () => { tone(523, 0.08); tone(659, 0.08, 'square', 0.06, 0.07); tone(784, 0.12, 'square', 0.06, 0.14); },
  fish:     () => { tone(700, 0.05); tone(900, 0.07, 'sine', 0.05, 0.05); },
  shark:    () => { sweep(220, 80, 0.3, 'sawtooth', 0.08); },
  whale:    () => { sweep(110, 60, 0.5, 'sine', 0.08); },
  break:    () => noise(0.12, 0.07, 400),
  vine:     () => tone(450, 0.08, 'triangle', 0.05),
  win:      () => {
    [523, 659, 784, 1047].forEach((n, i) => tone(n, 0.14, 'square', 0.06, i * 0.1));
  },
  bigWin:   () => {
    [523, 659, 784, 1047, 1319, 1568].forEach((n, i) => tone(n, 0.18, 'square', 0.07, i * 0.13));
  },
  gameOver: () => {
    tone(440, 0.15, 'sawtooth', 0.06);
    tone(330, 0.15, 'sawtooth', 0.06, 0.15);
    tone(220, 0.4,  'sawtooth', 0.07, 0.3);
  },
  select:   () => tone(660, 0.05, 'square', 0.04),
  start:    () => { tone(659, 0.08); tone(880, 0.15, 'square', 0.06, 0.08); },
};
