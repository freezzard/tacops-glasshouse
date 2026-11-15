// main.js — boot and the frame loop.
//
// The simulation runs on a fixed 60 Hz step, accumulated from real frame
// times, and rendering reads whatever the last step produced: the game's
// logic never sees a frame rate. The same file stages the deterministic
// ?shot= scenes the screenshots are taken from — a seeded match, a few
// teleports, a fixed number of steps, then the tableau holds still.

import * as THREE from 'three';
import { S, TEAM, makeRng } from './state.js';
import { PAL } from './palette.js';
import { buildMap, WORLD } from './map.js';
import { buildFigure } from './models.js';
import { poseFigure } from './anim.js';
import { initInput, lockPointer, input } from './input.js';
import { initAudio } from './audio.js';
import { initCombat, updateCombat } from './combat.js';
import { initViewmodel, syncViewmodel, cameraPose } from './player.js';
import { createRoster, resetMatch, step as stepMatch } from './rounds.js';
import { giveWeapon } from './weapons.js';
import { initHud, frameHud } from './hud.js';
import { yawTo } from './physics.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
S.seed = Number(params.get('seed') || 20261115);
S.rng = makeRng(S.seed);
S.shot = params.get('shot');

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// Screenshot captures render at pixel ratio 2 so the stills can be
// supersampled down; live play keeps the 1.5 cap for frame rate.
renderer.setPixelRatio(S.shot ? 2 : Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PAL.sky);
// Image-based light from a painted sky: a small equirect canvas — warm
// horizon, green glasshouse glow, one soft sun disc — so the glass, the
// brass and the water have something real to reflect. No texture files.
{
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#9fc4de');
  grad.addColorStop(0.42, '#cfe5cf');
  grad.addColorStop(0.55, '#ffe3b3');
  grad.addColorStop(0.62, '#7d8f6d');
  grad.addColorStop(1, '#3d4a38');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);
  const sun = ctx.createRadialGradient(360, 118, 2, 360, 118, 60);
  sun.addColorStop(0, 'rgba(255,246,220,0.95)');
  sun.addColorStop(0.25, 'rgba(255,227,179,0.55)');
  sun.addColorStop(1, 'rgba(255,227,179,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = 'rgba(255,255,255,0.20)';
  for (let x = 24; x < 512; x += 64) ctx.fillRect(x, 30, 20, 92); // glasshouse panes
  const env = new THREE.CanvasTexture(c);
  env.mapping = THREE.EquirectangularReflectionMapping;
  env.colorSpace = THREE.SRGBColorSpace;
  scene.environment = env;
  scene.environmentIntensity = 0.55;
}
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 240);
camera.rotation.order = 'YXZ';
scene.add(camera);

buildMap(scene);
initCombat(scene);
createRoster();
initHud();

function buildBodies() {
  for (const f of S.players) {
    if (f.body) scene.remove(f.body);
    const built = buildFigure(f.team);
    f.body = built.group;
    f.rig = built.rig;
    scene.add(f.body);
  }
}
S.rebuildBodies = buildBodies;
buildBodies();
initViewmodel(camera);

// The bomb prop: a dark charge with a screen and a light that blinks
// faster as its timer runs down.
const bombMesh = new THREE.Group();
{
  const shell = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x33302a, roughness: 0.6 }));
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x881111, emissive: 0xff2211, emissiveIntensity: 0.4 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), lampMat);
  lamp.position.set(0.1, 0.15, 0);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x1d2b1d, emissive: 0x2a5a2a, emissiveIntensity: 0.7 }));
  face.position.set(-0.04, 0.02, 0.075);
  bombMesh.add(shell, lamp, face);
  bombMesh.userData.lamp = lampMat;
  scene.add(bombMesh);
}

function placeAtSpawns() {
  let ai = 0, di = 0;
  for (const f of S.players) {
    const s = f.team === TEAM.ATK ? WORLD.spawns.atk[ai++] : WORLD.spawns.def[di++];
    f.pos.x = s.x; f.pos.z = s.z; f.pos.y = 0;
    f.yaw = s.yaw;
  }
}
placeAtSpawns();

// ---------- menu, pause, and the pointer lock ----------

const menuEl = document.getElementById('menu');
const playBtn = document.getElementById('play');
let started = false;
S.paused = false;

playBtn.addEventListener('click', () => {
  playBtn.blur();
  initAudio();
  menuEl.style.display = 'none';
  if (!started) {
    started = true;
    resetMatch();
  }
  S.paused = false;
  lockPointer();
});

initInput(canvas, () => {
  if (started && !S.shot && S.phase !== 'matchover' && S.phase !== 'menu') {
    S.paused = true;
    playBtn.textContent = 'Resume';
    menuEl.style.display = 'flex';
  }
});

if (S.shot) {
  menuEl.style.display = 'none';
  started = true;
}

// ---------- ?shot= staging ----------

const shotPlan = { setup: false, simT: 0, duration: 0, hold: false };

function teleport(f, x, z, yaw) {
  f.pos.x = x; f.pos.z = z; f.pos.y = 0;
  f.vel.x = 0; f.vel.z = 0;
  f.yaw = yaw;
}

function setupShot() {
  const mode = S.shot;
  if (mode === 'vista' || mode === 'pose') {
    // The cover and the rig check share a staging: dressed fighters in and
    // around the dome, rifles up, so the shot shows the cast, not an empty
    // room. Nobody simulates in menu phase; poseFigure holds the poses.
    const atk = S.players.filter((p) => p.team === TEAM.ATK);
    const def = S.players.filter((p) => p.team === TEAM.DEF);
    for (const f of [...atk, ...def]) {
      giveWeapon(f, 'rifle');
      f.armor = 100;
      f.helmet = true;
      f.weapons.current = 'primary';
    }
    if (mode === 'pose') {
      // The pair stands on open floor south of the tree bed, lit by the
      // dome, facing the lens; the rest of the cast waits behind the
      // camera (the frame loop force-shows bot bodies, so distance, not
      // visibility, keeps them out of the portrait).
      const pair = [def.find((p) => !p.isHuman), atk.find((p) => !p.isHuman)];
      teleport(pair[0], -0.85, 5.2, 0);
      pair[0].yaw = yawTo(pair[0].pos, { x: 0.4, z: 8.8 });
      pair[0].bot.state = 'hold';
      pair[0].pitch = 0.08;
      teleport(pair[1], 0.85, 5.2, 0);
      pair[1].yaw = yawTo(pair[1].pos, { x: 0.4, z: 8.8 });
      pair[1].bot.state = 'hold';
      pair[1].pitch = 0.08;
      let park = -6;
      for (const p of S.players) {
        if (p === pair[0] || p === pair[1]) continue;
        teleport(p, park, 19, Math.PI);
        park += 1.7;
      }
      S.shotPose = { x: 0.4, y: 1.5, z: 8.8, yaw: 0.11, pitch: -0.1 };
    } else {
      teleport(def[0], -3, -6.9, Math.PI);
      def[0].pos.y = 3.0; // on the north catwalk
      teleport(def[1], -4.5, -1.5, 0);
      def[1].yaw = yawTo(def[1].pos, { x: 12.5, z: 18.5 });
      def[1].bot.state = 'hold';
      teleport(atk[1], 0, 7.2, 0);
      teleport(atk[2], 3.5, 4.6, 0);
      atk[2].yaw = yawTo(atk[2].pos, { x: -2, z: -4 });
      S.shotPose = { x: 12.5, y: 6.4, z: 18.5, yaw: 0.57, pitch: -0.17 };
    }
    shotPlan.hold = true;
    window.__shotReady = true;
    return;
  }
  resetMatch();
  if (mode === 'buy') {
    shotPlan.duration = 0.25;
    return;
  }
  if (mode === 'fight') {
    S.phase = 'live';
    S.phaseT = 80;
    S.buyOpen = false;
    S.banner = null;
    const atk = S.players.filter((p) => p.team === TEAM.ATK);
    const def = S.players.filter((p) => p.team === TEAM.DEF);
    for (const f of [...atk, ...def]) {
      giveWeapon(f, 'rifle');
      f.armor = 100;
      f.weapons.current = 'primary';
      f.weapons.grenades.frag = 0;
      f.weapons.grenades.smoke = 0;
    }
    teleport(S.human, 0.8, 6.8, 0);
    teleport(atk[1], -3.5, 7.5, 0);
    teleport(atk[2], 3.5, 7.5, 0);
    teleport(def[0], 0, -5.5, Math.PI);
    teleport(def[1], -5.5, -6.5, Math.PI);
    shotPlan.duration = 1.15;
    return;
  }
  if (mode === 'defuse') {
    S.phase = 'planted';
    S.phaseT = 31;
    S.buyOpen = false;
    S.banner = null;
    S.bomb.state = 'planted';
    S.bomb.site = 'A';
    S.bomb.pos = { x: -21, y: 0, z: 0.5 };
    const def = S.players.filter((p) => p.team === TEAM.DEF);
    const atk = S.players.filter((p) => p.team === TEAM.ATK);
    for (const f of [...atk, ...def]) { giveWeapon(f, 'rifle'); f.armor = 100; f.weapons.current = 'primary'; }
    const defuser = def[0];
    teleport(defuser, -20.2, 0.4, 0);
    defuser.yaw = yawTo(defuser.pos, S.bomb.pos);
    defuser.crouch = true;
    defuser.hasKit = true;
    defuser.bot.state = 'defuse';
    // Everyone else stays at their spawns, far away: the tableau is just
    // the defuser at work and the human watching him through the planters.
    teleport(S.human, -15.2, 4.2, 0);
    S.human.yaw = yawTo(S.human.pos, defuser.pos);
    S.human.pitch = -0.05;
    shotPlan.duration = 1.2;
    return;
  }
  shotPlan.hold = true;
  window.__shotReady = true;
}

function stageShot(dt) {
  if (!shotPlan.setup) {
    setupShot();
    shotPlan.setup = true;
    if (shotPlan.hold) return;
  }
  if (shotPlan.hold) return;
  if (S.shot === 'fight' && S.human.alive) {
    // The human trades fire with the nearest Curator for the camera.
    let best = null, bd = Infinity;
    for (const p of S.players) {
      if (p.team !== TEAM.DEF || !p.alive) continue;
      const d = Math.hypot(p.pos.x - S.human.pos.x, p.pos.z - S.human.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      S.human.yaw = yawTo(S.human.pos, best.pos);
      S.human.pitch = Math.atan2((best.pos.y + 1.25) - (S.human.pos.y + 1.62), Math.max(1, bd));
      input.firing = shotPlan.simT > 0.5;
    }
  }
  // In the fight tableau the human trades fire but must not fall before
  // the capture: a deep health buffer during the steps, pinned back to a
  // clean 100 for the frame that gets photographed.
  if (S.shot === 'fight') S.human.hp = 250;
  let n = Math.max(1, Math.round(dt / STEP));
  while (n-- > 0 && shotPlan.simT < shotPlan.duration) {
    stepMatch(STEP);
    shotPlan.simT += STEP;
  }
  if (S.shot === 'fight') S.human.hp = 100;
  if (shotPlan.simT >= shotPlan.duration) {
    shotPlan.hold = true;
    window.__shotReady = true;
  }
}

// ---------- the frame ----------

const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
let last = performance.now() / 1000;
let acc = 0;
let wasMatchover = false;

function render(now) {
  const dt = Math.min(0.05, now - last);
  if (S.shotPose) {
    camera.position.set(S.shotPose.x, S.shotPose.y, S.shotPose.z);
    camera.rotation.set(S.shotPose.pitch, S.shotPose.yaw, 0);
  } else if (S.phase === 'menu') {
    const t = now * 0.045;
    camera.position.set(Math.sin(t) * 15.5, 6.8 + Math.sin(now * 0.2) * 0.7, Math.cos(t) * 15.5);
    camera.lookAt(0, 1.2, 0);
  } else {
    cameraPose(S.human, pose);
    camera.position.set(pose.x, pose.y, pose.z);
    camera.rotation.set(pose.pitch, pose.yaw, 0);
    if (S.shake > 0.003) {
      camera.position.x += (S.rng() - 0.5) * S.shake * 0.14;
      camera.position.y += (S.rng() - 0.5) * S.shake * 0.14;
      camera.rotation.z = (S.rng() - 0.5) * S.shake * 0.02;
    }
  }
  S.shake = Math.max(0, S.shake - dt * 2.4);
  const fovT = S.human.scoped ? 26 : 74;
  if (Math.abs(camera.fov - fovT) > 0.1) {
    camera.fov += (fovT - camera.fov) * Math.min(1, dt * 11);
    camera.updateProjectionMatrix();
  }
  for (const f of S.players) {
    poseFigure(f, dt);
    if (f.body) f.body.visible = f.isHuman ? !f.alive : true;
  }
  // The Cryo-Core rides on its carrier's back, then sits where it was left.
  if (S.bomb.state === 'carried' && S.bomb.carrier) {
    const c = S.bomb.carrier;
    bombMesh.visible = true;
    bombMesh.position.set(c.pos.x - Math.sin(c.yaw) * -0.24, c.pos.y + 1.02, c.pos.z - Math.cos(c.yaw) * -0.24);
    bombMesh.rotation.y = c.yaw;
  } else if (S.bomb.state === 'dropped' || S.bomb.state === 'planted') {
    bombMesh.visible = true;
    bombMesh.position.set(S.bomb.pos.x, S.bomb.pos.y + 0.13, S.bomb.pos.z);
    bombMesh.rotation.y = 0.6;
  } else {
    bombMesh.visible = false;
  }
  if (S.bomb.state === 'planted') {
    const rate = S.phaseT > 20 ? 2 : S.phaseT > 10 ? 4 : 8;
    bombMesh.userData.lamp.emissiveIntensity = (Math.sin(now * rate * Math.PI) > 0 ? 2.4 : 0.2);
  }
  syncViewmodel(S.human, dt);
  frameHud();
  renderer.render(scene, camera);
}

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = Math.min(0.1, now - last);
  last = now;
  if (!S.paused) {
    if (S.shot) {
      stageShot(dt);
    } else if (S.phase !== 'menu') {
      acc += dt;
      let guard = 0;
      while (acc >= STEP && guard++ < 6) {
        stepMatch(STEP);
        acc -= STEP;
      }
      if (guard >= 6) acc = 0;
    } else {
      S.time += dt;
      updateCombat(dt);
    }
  }
  if (S.phase === 'matchover' && !wasMatchover) {
    wasMatchover = true;
    if (document.pointerLockElement) document.exitPointerLock();
  }
  if (S.phase !== 'matchover') wasMatchover = false;
  render(now);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

requestAnimationFrame(frame);
