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
import { initInput, lockPointer, input } from './input.js';
import { initAudio } from './audio.js';
import { initCombat, updateCombat } from './combat.js';
import { makeBody, syncBody } from './bots.js';
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PAL.sky);
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
    f.body = makeBody(f.team);
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
  if (mode === 'vista') {
    S.shotPose = { x: 10.5, y: 5.4, z: 16.5, yaw: 0.57, pitch: -0.13 };
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
    for (const f of [...atk, ...def]) { giveWeapon(f, 'rifle'); f.armor = 100; f.weapons.current = 'primary'; }
    teleport(S.human, 0, 6.5, 0);
    teleport(atk[1], -3.5, 7.5, 0);
    teleport(atk[2], 3.5, 7.5, 0);
    teleport(def[0], 0, -5.5, Math.PI);
    teleport(def[1], -4, -4.5, Math.PI);
    teleport(def[2], 4.5, -3.5, Math.PI);
    shotPlan.duration = 1.7;
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
    teleport(defuser, -20.2, 0.4, Math.PI / 2);
    defuser.crouch = true;
    defuser.hasKit = true;
    defuser.bot.state = 'defuse';
    const cover = def[1];
    teleport(cover, -24.5, -4.5, 2.4);
    cover.bot.state = 'hold';
    cover.bot.holdYaw = 2.4;
    cover.bot.path = [];
    teleport(S.human, -16.8, 2.8, 0);
    S.human.yaw = yawTo(S.human.pos, defuser.pos);
    const mate = atk[1];
    teleport(mate, -18.5, -3.5, 0.4);
    mate.bot.state = 'hold';
    mate.bot.holdYaw = 0.4;
    mate.bot.path = [];
    shotPlan.duration = 0.9;
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
    // The human trades fire with the nearest Warden for the camera.
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
  let n = Math.max(1, Math.round(dt / STEP));
  while (n-- > 0 && shotPlan.simT < shotPlan.duration) {
    stepMatch(STEP);
    shotPlan.simT += STEP;
  }
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
    syncBody(f, dt);
    if (f.body) f.body.visible = f.isHuman ? !f.alive : true;
  }
  // The charge rides on its carrier's back, then sits where it was left.
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
