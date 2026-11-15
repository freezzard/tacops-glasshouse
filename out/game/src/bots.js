// bots.js — the nine other fighters: their bodies and their brains.
//
// Bodies are box-built figures in team colours with a separate head, so the
// silhouette the raycast tests is the one you see. Brains run on a budget:
// perception refreshes a few times a second per bot, sight is a cone plus a
// sight-line test, hearing is the noise list combat publishes, and movement
// follows the map's waypoint graph. A bot that sees you still needs a human
// beat to react, aims worse the longer your duel is fresh, and fires in
// bursts — it is beatable, but it punishes noise and dry peeks.

import * as THREE from 'three';
import { S, TEAM, rand, pick } from './state.js';
import { PAL } from './palette.js';
import { WORLD } from './map.js';
import { sightBlocked, eyePos, angleLerp, yawTo, dist2d } from './physics.js';
import { WEAPONS, GEAR, giveWeapon, switchTo } from './weapons.js';
import { tryFire, startReload, smokeBlocks } from './combat.js';
import * as AU from './audio.js';

export const BOT_NAMES = {
  atk: ['Vex', 'Moss', 'Juno', 'Pike'],
  def: ['Sable', 'Rook', 'Ivy', 'Tarn', 'Hollis'],
};

// ---------- bodies ----------

const bodyParts = new WeakMap();

export function makeBody(team) {
  const main = team === TEAM.ATK ? PAL.atk : PAL.def;
  const dark = team === TEAM.ATK ? PAL.atkDark : PAL.defDark;
  const mat = new THREE.MeshStandardMaterial({ color: main, roughness: 0.85 });
  const matDark = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.9 });
  const matSkin = new THREE.MeshStandardMaterial({ color: 0xc9a183, roughness: 0.8 });
  const matGun = new THREE.MeshStandardMaterial({ color: 0x2e3236, roughness: 0.45, metalness: 0.5 });

  const g = new THREE.Group();
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.78, 0.2), matDark);
  const legR = legL.clone();
  legL.position.set(-0.13, 0.39, 0);
  legR.position.set(0.13, 0.39, 0);
  const hips = new THREE.Group();
  hips.position.y = 0.78;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.6, 0.3), mat);
  torso.position.y = 0.3;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.06), matDark);
  plate.position.set(0, 0.3, -0.17);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.3, 0.27), matSkin);
  head.position.y = 0.78;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.09, 0.31), matDark);
  cap.position.y = 0.95;
  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.62), matGun);
  gunBody.position.z = -0.3;
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.3), matGun);
  barrel.position.set(0, 0.03, -0.72);
  gun.add(gunBody, barrel);
  gun.position.set(0.16, 0.34, -0.1);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.42), mat);
  armL.position.set(-0.2, 0.36, -0.18);
  armL.rotation.x = 0.25;
  const armR = armL.clone();
  armR.position.x = 0.24;
  hips.add(torso, plate, head, cap, gun, armL, armR);
  g.add(legL, legR, hips);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  bodyParts.set(g, { legL, legR, hips, gun, cap, phase: 0, deathT: 0 });
  return g;
}

export function syncBody(f, dt) {
  const g = f.body;
  if (!g) return;
  const parts = bodyParts.get(g);
  g.position.set(f.pos.x, f.pos.y, f.pos.z);
  g.rotation.y = f.yaw;
  if (!f.alive) {
    parts.deathT = Math.min(1, parts.deathT + dt * 2.4);
    g.rotation.x = -Math.PI / 2 * parts.deathT;
    g.position.y = f.pos.y + 0.12 * parts.deathT;
    return;
  }
  parts.deathT = 0;
  g.rotation.x = 0;
  const hipTarget = f.crouch ? 0.46 : 0.78;
  parts.hips.position.y += (hipTarget - parts.hips.position.y) * Math.min(1, dt * 10);
  parts.phase += f.speedNow * dt * 2.1;
  const swing = Math.sin(parts.phase) * 0.5 * Math.min(1, f.speedNow / 3);
  parts.legL.rotation.x = swing;
  parts.legR.rotation.x = -swing;
  parts.gun.rotation.x = f.pitch;
  parts.cap.visible = !!f.helmet;
}

// ---------- brains ----------

export function newBrain(role, sitePref) {
  return {
    role, sitePref,
    state: 'advance',
    path: [], pathI: 0,
    target: null, lastSeenAt: -9, lastSeenPos: null, heardPos: null,
    reactT: 0, aimErr: 0.05, burstLeft: 0, burstWait: 0, fireHold: false,
    holdYaw: 0, repathT: 0, stuckT: 0, lastX: 0, lastZ: 0,
    nadeT: 4, plan: null, scanPhase: Math.random() * 6,
  };
}

function nearestNode(x, z) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < WORLD.nodes.length; i++) {
    const n = WORLD.nodes[i];
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function pathTo(f, x, z) {
  const start = nearestNode(f.pos.x, f.pos.z);
  const goal = nearestNode(x, z);
  if (start === goal) { f.bot.path = []; f.bot.pathI = 0; return; }
  const prev = new Map([[start, -1]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === goal) break;
    for (const nb of WORLD.links[cur]) {
      if (!prev.has(nb)) { prev.set(nb, cur); queue.push(nb); }
    }
  }
  if (!prev.has(goal)) { f.bot.path = []; return; }
  const path = [];
  for (let c = goal; c !== -1; c = prev.get(c)) path.push(c);
  path.reverse();
  path.shift();
  f.bot.path = path;
  f.bot.pathI = 0;
  // The last leg walks straight at the true target, not its nearest node.
  f.bot.finalX = x;
  f.bot.finalZ = z;
}

const _eye = { x: 0, y: 0, z: 0 };
const _chest = { x: 0, y: 0, z: 0 };

export function canSee(f, e) {
  const d = dist2d(f.pos, e.pos);
  if (d > 48) return false;
  eyePos(f, _eye);
  _chest.x = e.pos.x; _chest.y = e.pos.y + 1.25; _chest.z = e.pos.z;
  if (d > 5) {
    const want = yawTo(_eye, _chest);
    let diff = Math.abs(((want - f.yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    if (diff > 1.05) return false; // ~120 degree cone, kind at the edges
  }
  if (sightBlocked(_eye, _chest)) return false;
  if (smokeBlocks(_eye, _chest)) return false;
  return true;
}

function perceive(f, dt) {
  const b = f.bot;
  b.percepT = (b.percepT || 0) - dt;
  if (b.percepT <= 0) {
    b.percepT = 0.11 + S.rng() * 0.05;
    let best = null;
    let bd = Infinity;
    for (const e of S.players) {
      if (!e.alive || e.team === f.team) continue;
      if (canSee(f, e)) {
        const d = dist2d(f.pos, e.pos);
        if (d < bd) { bd = d; best = e; }
      }
    }
    if (best) {
      if (b.target !== best) { b.reactT = rand(S.rng, 0.22, 0.42); b.aimErr = 0.055; }
      b.target = best;
      b.lastSeenAt = S.time;
      b.lastSeenPos = { x: best.pos.x, z: best.pos.z };
    } else if (b.target && S.time - b.lastSeenAt > 0.4) {
      b.target = null;
    }
  }
  for (const n of S.noises) {
    if (n.team === f.team) continue;
    if (Math.hypot(n.x - f.pos.x, n.z - f.pos.z) < n.radius) {
      b.heardPos = { x: n.x, z: n.z };
      b.heardAt = S.time;
      if (b.state === 'hold') b.holdYaw = yawTo(f.pos, n);
    }
  }
}

function steer(f, tx, tz, speed, dt) {
  const dx = tx - f.pos.x;
  const dz = tz - f.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) { f.vel.x = 0; f.vel.z = 0; return true; }
  // Separation: never stack two bots on one doorway.
  let px = 0, pz = 0;
  for (const o of S.players) {
    if (o === f || !o.alive) continue;
    const ox = f.pos.x - o.pos.x, oz = f.pos.z - o.pos.z;
    const od = Math.hypot(ox, oz);
    if (od > 0.01 && od < 0.95) { px += (ox / od) * (0.95 - od); pz += (oz / od) * (0.95 - od); }
  }
  const vx = (dx / d) * speed + px * 2.2;
  const vz = (dz / d) * speed + pz * 2.2;
  const accel = f.onGround ? 26 : 4;
  f.vel.x += Math.max(-accel * dt, Math.min(accel * dt, vx - f.vel.x));
  f.vel.z += Math.max(-accel * dt, Math.min(accel * dt, vz - f.vel.z));
  return d < 0.6;
}

function followPath(f, speed, dt) {
  const b = f.bot;
  if (b.pathI >= b.path.length) {
    if (b.finalX !== undefined) return steer(f, b.finalX, b.finalZ, speed, dt);
    f.vel.x = 0; f.vel.z = 0;
    return true;
  }
  const node = WORLD.nodes[b.path[b.pathI]];
  if (steer(f, node.x, node.z, speed, dt)) b.pathI++;
  return false;
}

function faceToward(f, tx, tz, dt, rate = 5) {
  const want = yawTo(f.pos, { x: tx, z: tz });
  f.yaw = angleLerp(f.yaw, want, Math.min(1, dt * rate));
  return want;
}

function engage(f, dt) {
  const b = f.bot;
  const t = b.target;
  const d = dist2d(f.pos, t.pos);
  b.reactT -= dt;
  b.aimErr = Math.max(0.011, b.aimErr - dt * 0.02);
  // Aim at the head with a rifle inside 20 m, the chest otherwise; the aim
  // error is a wandering offset that settles the longer the duel runs.
  const aimHead = d < 20 && f.weapons.primary === 'rifle';
  const aimY = t.pos.y + (aimHead ? 1.52 : 1.15);
  const errA = b.aimErr * Math.sin(S.time * 3.1 + b.scanPhase * 7);
  const want = yawTo(f.pos, t.pos) + errA;
  f.yaw = angleLerp(f.yaw, want, Math.min(1, dt * 6.5));
  const eyeY = f.pos.y + 1.62;
  f.pitch = Math.atan2(aimY - eyeY, Math.max(1, d)) + b.aimErr * 0.4 * Math.cos(S.time * 2.3 + b.scanPhase);
  // Range discipline: close in with a short gun, back off with a long one.
  const gun = f.weapons.primary || 'pistol';
  const sweet = gun === 'shotgun' ? 9 : gun === 'smg' ? 14 : gun === 'sniper' ? 26 : 19;
  let mx = 0, mz = 0;
  if (d > sweet + 5) { mx = (t.pos.x - f.pos.x) / d; mz = (t.pos.z - f.pos.z) / d; }
  else if (d < sweet - 6) { mx = -(t.pos.x - f.pos.x) / d; mz = -(t.pos.z - f.pos.z) / d; }
  const strafe = Math.sin(S.time * 1.7 + b.scanPhase * 3) > 0 ? 1 : -1;
  const sx = -(t.pos.z - f.pos.z) / d * strafe, sz = (t.pos.x - f.pos.x) / d * strafe;
  const speed = 2.6;
  f.vel.x += ((mx * 0.8 + sx * 0.55) * speed - f.vel.x) * Math.min(1, dt * 8);
  f.vel.z += ((mz * 0.8 + sz * 0.55) * speed - f.vel.z) * Math.min(1, dt * 8);
  f.crouch = d > 13 && S.rng() < 0.01 ? !f.crouch : f.crouch && d > 10;
  // Fire: only settled, only in bursts, never before the reaction beat.
  const ammo = f.weapons.ammo[f.weapons.primary || 'pistol'];
  if (ammo && ammo.mag === 0) startReload(f);
  if (b.reactT > 0) return;
  if (b.burstWait > 0) { b.burstWait -= dt; return; }
  if (b.burstLeft <= 0) { b.burstLeft = 2 + Math.floor(S.rng() * 4); }
  const before = ammo ? ammo.mag : 0;
  if (tryFire(f) === 'fired') {
    if (ammo && ammo.mag < before) b.burstLeft--;
    if (b.burstLeft <= 0) b.burstWait = rand(S.rng, 0.28, 0.65) * (d > 30 ? 1.5 : 1);
  }
  // A grenade for an enemy who just broke line of sight nearby.
  b.nadeT -= dt;
  if (b.nadeT <= 0 && f.weapons.grenades.frag > 0 && d < 18 && S.rng() < 0.3) {
    if (switchTo(f, 'frag')) tryFire(f);
    switchTo(f, f.weapons.primary ? 'primary' : 'sidearm');
    b.nadeT = 7;
  }
}

export function stepBot(f, dt) {
  const b = f.bot;
  if (!f.alive) { f.vel.x = 0; f.vel.z = 0; return; }
  perceive(f, dt);
  const phase = S.phase;
  if (phase !== 'live' && phase !== 'planted') {
    f.vel.x = 0; f.vel.z = 0;
    if (phase === 'freeze') faceToward(f, f.pos.x - Math.sin(f.yaw), f.pos.z - Math.cos(f.yaw), dt, 1);
    return;
  }
  if (b.target && b.target.alive) { engage(f, dt); return; }
  if (b.target && !b.target.alive) b.target = null;

  switch (b.state) {
    case 'plant': {
      const site = WORLD.sites[b.sitePref];
      if (dist2d(f.pos, site) > 1.6) {
        followPath(f, 4.6, dt);
        faceToward(f, f.pos.x + f.vel.x, f.pos.z + f.vel.z, dt);
      } else {
        f.vel.x = 0; f.vel.z = 0;
        f.crouch = true;
        faceToward(f, site.x + (f.team === TEAM.ATK ? 6 : -6), site.z, dt, 2);
        S.botPlanting = f; // rounds.js runs the channel while this holds
      }
      break;
    }
    case 'defuse': {
      if (dist2d(f.pos, S.bomb.pos) > 1.5) {
        followPath(f, 4.9, dt);
        faceToward(f, f.pos.x + f.vel.x, f.pos.z + f.vel.z, dt);
      } else {
        f.vel.x = 0; f.vel.z = 0;
        f.crouch = true;
        faceToward(f, S.bomb.pos.x + 4, S.bomb.pos.z, dt, 2);
        S.botDefusing = f;
      }
      break;
    }
    case 'hold': {
      if (b.path.length && b.pathI < b.path.length) {
        followPath(f, 4.4, dt);
        faceToward(f, f.pos.x + f.vel.x, f.pos.z + f.vel.z, dt);
        break;
      }
      f.vel.x = 0; f.vel.z = 0;
      const drift = Math.sin(S.time * 0.45 + b.scanPhase) * 0.5;
      f.yaw = angleLerp(f.yaw, b.holdYaw + drift, Math.min(1, dt * 2));
      f.pitch = 0;
      if (b.heardPos && S.time - (b.heardAt || -9) < 4 && dist2d(f.pos, b.heardPos) < 22) {
        b.state = 'advance';
        pathTo(f, b.heardPos.x, b.heardPos.z);
        b.afterAdvance = 'hold';
      }
      break;
    }
    default: { // advance
      const arrived = followPath(f, b.careful ? 2.7 : 4.7, dt);
      if (f.speedNow > 0.4) faceToward(f, f.pos.x + f.vel.x, f.pos.z + f.vel.z, dt);
      if (b.lastSeenPos && S.time - b.lastSeenAt < 3) {
        // drawn by a glimpse: push the last known spot
        if (dist2d(f.pos, b.lastSeenPos) > 3) pathTo(f, b.lastSeenPos.x, b.lastSeenPos.z);
        b.lastSeenPos = null;
      }
      if (arrived) {
        if (b.afterAdvance === 'plant') { b.state = 'plant'; }
        else if (b.afterAdvance === 'defuse') { b.state = 'defuse'; }
        else { b.state = 'hold'; b.holdYaw = f.yaw; }
        b.afterAdvance = null;
      }
      // A stuck bot (shouldering a planter) re-paths rather than grinding.
      b.stuckT += dt;
      if (b.stuckT > 1.2) {
        const moved = Math.hypot(f.pos.x - b.lastX, f.pos.z - b.lastZ);
        if (moved < 0.25 && b.pathI < b.path.length) {
          const n = WORLD.nodes[b.path[b.pathI]];
          pathTo(f, n.x, n.z);
        }
        b.lastX = f.pos.x; b.lastZ = f.pos.z; b.stuckT = 0;
      }
    }
  }
  // Reload discipline away from the fight.
  const ammo = f.weapons.ammo[f.weapons.primary || 'pistol'];
  if (ammo && ammo.mag > 0 && ammo.mag < WEAPONS[f.weapons.primary || 'pistol'].mag * 0.3 && !b.target) {
    startReload(f);
  }
}

// The freeze-time shop, run once per bot per round: a rifle and a vest when
// rich, a submachine gun when comfortable, a save when poor — with the
// occasional full-buy gamble so the economy is not a metronome.
export function botBuy(f) {
  const w = f.weapons;
  const rich = f.money >= 3700;
  const mid = f.money >= 2150;
  if (!w.primary && rich) { buy(f, 'rifle'); }
  else if (!w.primary && mid) { buy(f, 'smg'); }
  else if (!w.primary && f.money >= 1800 && S.rng() < 0.3) { buy(f, 'shotgun'); }
  if (f.armor < 60 && f.money >= GEAR.armor.price + (w.primary ? 0 : 400)) {
    f.armor = 100;
    f.money -= GEAR.armor.price;
  }
  if (f.armor > 0 && !f.helmet && f.money >= 2400) {
    f.helmet = true;
    f.money -= (GEAR.helmet.price - GEAR.armor.price);
  }
  if (f.team === TEAM.DEF && !f.hasKit && f.money >= 900) {
    f.hasKit = true;
    f.money -= GEAR.kit.price;
  }
  if (f.money >= 900 && w.grenades.frag === 0 && S.rng() < 0.6) { w.grenades.frag = 1; f.money -= GEAR.frag.price; }
  if (f.money >= 900 && w.grenades.smoke === 0 && S.rng() < 0.35) { w.grenades.smoke = 1; f.money -= GEAR.smoke.price; }
  if (w.primary) switchTo(f, 'primary');
}

function buy(f, id) {
  f.money -= WEAPONS[id].price;
  giveWeapon(f, id);
}
