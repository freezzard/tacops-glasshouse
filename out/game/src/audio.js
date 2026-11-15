// audio.js — every sound is synthesized with WebAudio; the game ships no
// audio files. A noise buffer and a few oscillators cover gunfire, glass,
// footsteps, the bomb's beeper and the round stingers.
//
// Sounds are placed crudely in space: volume and low-pass cutoff fall with
// distance from the human, which is also how the bots' world stays fair —
// if you can hear a shot clearly, it was close.

let ctx = null;
let master = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

export function audioReady() {
  return !!ctx;
}

// distance in metres -> [gain, lowpass Hz]
function place(dist) {
  const g = Math.min(1, 9 / (9 + dist));
  return [g * g, Math.max(500, 9000 - dist * 190)];
}

function burst(dist, dur, freq, gain, type = 'lowpass') {
  if (!ctx) return;
  const [g, f] = place(dist);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = f * (freq ?? 1);
  const env = ctx.createGain();
  const t = ctx.currentTime;
  env.gain.setValueAtTime(gain * g, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(env).connect(master);
  src.start(t, Math.random() * 0.4, dur + 0.05);
}

function tone(dist, freq, dur, gain, type = 'sine', slideTo = null) {
  if (!ctx) return;
  const [g] = place(dist);
  const osc = ctx.createOscillator();
  osc.type = type;
  const t = ctx.currentTime;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain * g, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// One gunshot. `kind` shifts the body of the crack; a suppressed, distant
// version is just the same call from farther away.
export function shotSound(kind, dist) {
  if (!ctx) return;
  switch (kind) {
    case 'sniper': burst(dist, 0.5, 0.7, 0.95); tone(dist, 130, 0.3, 0.5, 'triangle', 45); break;
    case 'shotgun': burst(dist, 0.34, 0.8, 0.9); tone(dist, 110, 0.22, 0.45, 'triangle', 50); break;
    case 'rifle': burst(dist, 0.2, 1.1, 0.75); tone(dist, 170, 0.12, 0.3, 'square', 70); break;
    case 'smg': burst(dist, 0.13, 1.3, 0.6); tone(dist, 210, 0.08, 0.22, 'square', 90); break;
    case 'pistol': burst(dist, 0.15, 1.2, 0.62); tone(dist, 190, 0.09, 0.25, 'square', 80); break;
    case 'knife': burst(dist, 0.07, 2.2, 0.3, 'highpass'); break;
    default: burst(dist, 0.16, 1.1, 0.6);
  }
}

export function dryFire(dist) { tone(dist, 1400, 0.04, 0.2, 'square'); }
export function reloadSound(dist) {
  tone(dist, 500, 0.05, 0.18, 'square');
  setTimeout(() => tone(dist, 320, 0.05, 0.18, 'square'), 130);
  setTimeout(() => tone(dist, 700, 0.05, 0.2, 'square'), 300);
}
export function drawSound(dist) { burst(dist, 0.06, 2.6, 0.2, 'highpass'); }
export function hitSound(head) {
  if (!ctx) return;
  tone(0, head ? 1750 : 1150, 0.06, 0.3, 'sine');
  if (head) setTimeout(() => tone(0, 2200, 0.07, 0.25, 'sine'), 45);
}
export function killSound() { tone(0, 880, 0.1, 0.25, 'triangle', 660); }
export function hurtSound() { tone(0, 140, 0.16, 0.35, 'sawtooth', 90); }
export function stepSound(dist, run) { burst(dist, 0.05, 0.5, run ? 0.16 : 0.06); }
export function jumpSound(dist) { burst(dist, 0.06, 0.7, 0.1); }
export function glassSound(dist) {
  burst(dist, 0.3, 2.4, 0.5, 'highpass');
  tone(dist, 2900, 0.18, 0.12, 'sine', 1800);
  tone(dist, 3600, 0.12, 0.08, 'sine', 2400);
}
export function throwSound(dist) { burst(dist, 0.08, 1.6, 0.2, 'bandpass'); }
export function explosionSound(dist) {
  burst(dist, 1.1, 0.4, 1.0);
  tone(dist, 70, 0.9, 0.7, 'sine', 32);
}
export function smokeSound(dist) { burst(dist, 0.7, 0.9, 0.3); }
export function plantBeep(final) { tone(0, final ? 1560 : 1040, final ? 0.3 : 0.07, 0.3, 'square'); }
export function defuseSound() { tone(0, 740, 0.06, 0.2, 'square'); }
export function buySound() { tone(0, 990, 0.06, 0.2, 'triangle'); setTimeout(() => tone(0, 1320, 0.08, 0.2, 'triangle'), 60); }
export function deniedSound() { tone(0, 220, 0.12, 0.22, 'square'); }
export function roundSting(won) {
  if (!ctx) return;
  const seq = won ? [523, 659, 784] : [392, 330, 262];
  seq.forEach((f, i) => setTimeout(() => tone(0, f, 0.34, 0.25, 'triangle'), i * 130));
}
export function plantStartSound() { tone(0, 620, 0.08, 0.25, 'square'); }
