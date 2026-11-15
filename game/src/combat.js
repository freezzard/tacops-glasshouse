// combat.js — gunfire, resolved the same way for the human and the bots.
//
// A shot is a ray from the shooter's eye: spread from weapons.spreadFor,
// the first thing it meets wins, glass shatters and lets it through weakened,
// armour halves what reaches health (a helmet does the same for the head).
// Effects are pooled — tracers, impact particles and muzzle flashes are
// recycled rings, so a firefight allocates nothing per frame.

import * as THREE from 'three';
import { S, MONEY } from './state.js';
import { PAL } from './palette.js';
import { WORLD, breakGlass } from './map.js';
import { raycastWorld, rayVsBox, fighterBoxes, eyePos, lookDir, sightBlocked, dist2d } from './physics.js';
import { currentDef, currentWeaponId, damageAt, spreadFor } from './weapons.js';
import * as AU from './audio.js';

const _o = { x: 0, y: 0, z: 0 };
const _d = { x: 0, y: 0, z: 0 };
const _e = { x: 0, y: 0, z: 0 };

let scene = null;
let tracers = [];
let particles = null;
let pData = [];
let flashes = [];
let flashLight = null;
let projectiles = [];
export const smokes = []; // {x,y,z,r,until} — sight blockers, read by bots

export function initCombat(sc) {
  scene = sc;
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  for (let i = 0; i < 28; i++) {
    const line = new THREE.Line(tGeo.clone(), new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  const pGeo = new THREE.BufferGeometry();
  const N = 420;
  pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.085, map: makePuffTexture(), vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  particles.frustumCulled = false;
  scene.add(particles);
  for (let i = 0; i < N; i++) pData.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, grav: 0 });
  const fTex = makeFlashTexture();
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fTex, color: PAL.muzzle, transparent: true, opacity: 0, depthWrite: false }));
    sp.scale.set(0.55, 0.55, 1);
    sp.visible = false;
    scene.add(sp);
    flashes.push({ sp, life: 0 });
  }
  flashLight = new THREE.PointLight(PAL.muzzle, 0, 11, 1.6);
  scene.add(flashLight);
  const gGeo = new THREE.SphereGeometry(0.09, 8, 6);
  for (let i = 0; i < 8; i++) {
    const mesh = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({ color: 0x3a4145, roughness: 0.5 }));
    mesh.visible = false;
    scene.add(mesh);
    projectiles.push({ mesh, active: false, kind: 'frag', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0, from: null });
  }
}

function makePuffTexture() {
  // A soft disc, so impact particles read as puffs of dust and glass
  // rather than square confetti.
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,240,200,1)');
  g.addColorStop(0.4, 'rgba(255,190,90,.75)');
  g.addColorStop(1, 'rgba(255,150,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function spawnParticles(x, y, z, colorHex, n, speed, life, grav) {
  const pos = particles.geometry.attributes.position.array;
  const col = particles.geometry.attributes.color.array;
  const colr = new THREE.Color(colorHex);
  let placed = 0;
  for (let i = 0; i < pData.length && placed < n; i++) {
    const p = pData[i];
    if (p.life > 0) continue;
    p.life = p.max = life * (0.5 + S.rng() * 0.8);
    p.grav = grav;
    const a = S.rng() * Math.PI * 2;
    const up = S.rng() * 0.9 + 0.1;
    const sp = speed * (0.3 + S.rng() * 0.7);
    p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp; p.vy = up * sp;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    col[i * 3] = colr.r; col[i * 3 + 1] = colr.g; col[i * 3 + 2] = colr.b;
    placed++;
  }
  particles.geometry.attributes.position.needsUpdate = true;
  particles.geometry.attributes.color.needsUpdate = true;
}

function spawnTracer(from, to, team) {
  const t = tracers.find((x) => x.life <= 0) || tracers[0];
  const arr = t.line.geometry.attributes.position.array;
  arr[0] = from.x; arr[1] = from.y; arr[2] = from.z;
  arr[3] = to.x; arr[4] = to.y; arr[5] = to.z;
  t.line.geometry.attributes.position.needsUpdate = true;
  t.line.material.color.setHex(team === 'atk' ? PAL.tracerAtk : PAL.tracerDef);
  t.line.material.opacity = 0.85;
  t.line.visible = true;
  t.life = 0.09;
}

function muzzle(from, dir) {
  const fl = flashes.find((x) => x.life <= 0) || flashes[0];
  fl.sp.position.set(from.x + dir.x * 0.15, from.y + dir.y * 0.15, from.z + dir.z * 0.15);
  fl.sp.visible = true;
  fl.sp.material.opacity = 0.95;
  fl.life = 0.045;
  flashLight.position.copy(fl.sp.position);
  flashLight.intensity = 14;
}

// Armour model: a vest halves body damage and eats the absorbed half from
// its own points; a helmet does the same for the head. The knife and blast
// damage go through the same rule, which keeps one code path.
export function applyDamage(attacker, target, raw, head, weaponId) {
  if (!target.alive || raw <= 0) return false;
  let hpDmg = raw;
  const covered = head ? target.helmet && target.armor > 0 : target.armor > 0;
  if (covered) {
    hpDmg = raw * 0.5;
    target.armor = Math.max(0, target.armor - raw * 0.5);
  }
  target.hp -= hpDmg;
  target.lastDamageFrom = attacker;
  target.lastDamageAt = S.time;
  if (attacker && attacker.isHuman) {
    S.hitMark = { at: S.time, head, kill: target.hp <= 0 };
  }
  if (target.isHuman) {
    AU.hurtSound();
    S.shake = Math.min(0.6, S.shake + hpDmg * 0.006);
  }
  if (attacker.isHuman && target.hp > 0) AU.hitSound(head);
  if (target.hp <= 0) {
    killFighter(attacker, target, head, weaponId);
    return true;
  }
  return false;
}

export function killFighter(attacker, target, head, weaponId) {
  target.alive = false;
  target.hp = 0;
  target.deaths++;
  if (attacker && attacker !== target) {
    attacker.kills++;
    if (S.phase === 'live' || S.phase === 'planted') attacker.money = Math.min(MONEY.cap, attacker.money + MONEY.kill);
    if (attacker.isHuman) AU.killSound();
  }
  S.feed.push({ a: attacker, v: target, weapon: weaponId, head });
  if (S.bomb.carrier === target) {
    S.bomb.carrier = null;
    S.bomb.state = 'dropped';
    S.bomb.pos = { x: target.pos.x, y: target.pos.y, z: target.pos.z };
  }
  spawnParticles(target.pos.x, target.pos.y + 1.2, target.pos.z, PAL.blood, 16, 2.2, 0.5, 3);
  if (S.onKill) S.onKill(attacker, target);
}

// The trigger. Returns 'fired', 'dry', 'wait' or 'thrown'.
export function tryFire(f) {
  const w = f.weapons;
  const slot = w.current;
  if (slot === 'frag' || slot === 'smoke') return throwGrenade(f, slot);
  const def = currentDef(f);
  if (!def || w.fireT > 0 || w.drawT > 0 || w.reloadT > 0) return 'wait';
  if (def.melee) return swingKnife(f, def);
  const ammo = w.ammo[currentWeaponId(f)];
  w.fireT = 60 / def.rpm;
  if (ammo.mag <= 0) {
    AU.dryFire(dist2d(f.pos, S.human.pos));
    return 'dry';
  }
  ammo.mag--;
  w.bloom = Math.min(0.05, w.bloom + def.bloom);
  f.recoil = (f.recoil || 0) + def.recoil;
  eyePos(f, _o);
  lookDir(f.yaw, f.pitch, _d);
  S.noises.push({ x: f.pos.x, z: f.pos.z, radius: def.noise, team: f.team, kind: 'shot' });
  AU.shotSound(def.sound, f.isHuman ? 0 : dist2d(f.pos, S.human.pos));
  const gunTip = { x: _o.x + _d.x * 0.45, y: _o.y - 0.12 + _d.y * 0.45, z: _o.z + _d.z * 0.45 };
  muzzle(gunTip, _d);
  const spread = spreadFor(f, def);
  for (let p = 0; p < def.pellets; p++) {
    const yaw = f.yaw + (S.rng() * 2 - 1) * spread;
    const pitch = f.pitch + (S.rng() * 2 - 1) * spread * 0.8;
    firePellet(f, def, yaw, pitch);
  }
  return 'fired';
}

function firePellet(f, def, yaw, pitch) {
  eyePos(f, _o);
  lookDir(yaw, pitch, _d);
  let dmgScale = 1;
  let ox = _o.x, oy = _o.y, oz = _o.z;
  for (let pen = 0; pen < 3; pen++) {
    const origin = { x: ox, y: oy, z: oz };
    const wall = raycastWorld(origin, _d, 120);
    let bestDist = wall ? wall.dist : 120;
    let bestFighter = null;
    let bestHead = false;
    for (const t of S.players) {
      if (t === f || !t.alive || t.team === f.team) continue;
      const boxes = fighterBoxes(t);
      const th = rayVsBox(origin, _d, boxes.head);
      if (th < bestDist) { bestDist = th; bestFighter = t; bestHead = true; continue; }
      const tb = rayVsBox(origin, _d, boxes.body);
      if (tb < bestDist) { bestDist = tb; bestFighter = t; bestHead = false; }
    }
    const hx = ox + _d.x * bestDist, hy = oy + _d.y * bestDist, hz = oz + _d.z * bestDist;
    if (pen === 0) spawnTracer({ x: ox + _d.x * 0.5, y: oy - 0.1, z: oz + _d.z * 0.5 }, { x: hx, y: hy, z: hz }, f.team);
    if (bestFighter) {
      spawnParticles(hx, hy, hz, PAL.blood, 5, 1.4, 0.35, 2);
      applyDamage(f, bestFighter, damageAt(def, bestDist) * (bestHead ? def.headMult : 1) * dmgScale, bestHead, currentWeaponId(f));
      return;
    }
    if (!wall) return;
    if (wall.box.kind === 'glass') {
      const panel = WORLD.glass.find((g) => g.box === wall.box);
      if (panel && !panel.broken) {
        breakGlass(panel);
        AU.glassSound(dist2d({ x: hx, z: hz }, S.human.pos));
        spawnParticles(hx, hy, hz, PAL.glass, 14, 2.4, 0.6, 4);
        S.noises.push({ x: hx, z: hz, radius: 14, team: f.team, kind: 'glass' });
      }
      dmgScale *= 0.7;
      ox = hx + _d.x * 0.06; oy = hy + _d.y * 0.06; oz = hz + _d.z * 0.06;
      continue;
    }
    spawnParticles(hx, hy, hz, 0xcfc8b8, 4, 1.1, 0.3, 2);
    return;
  }
}

function swingKnife(f, def) {
  f.weapons.fireT = 60 / def.rpm;
  eyePos(f, _o);
  lookDir(f.yaw, f.pitch, _d);
  AU.shotSound('knife', f.isHuman ? 0 : dist2d(f.pos, S.human.pos));
  for (const t of S.players) {
    if (t === f || !t.alive || t.team === f.team) continue;
    _e.x = t.pos.x - _o.x; _e.y = (t.pos.y + 1) - _o.y; _e.z = t.pos.z - _o.z;
    const dist = Math.hypot(_e.x, _e.y, _e.z);
    if (dist > def.melee + 0.3) continue;
    if ((_e.x * _d.x + _e.y * _d.y + _e.z * _d.z) / dist < 0.55) continue;
    if (sightBlocked(_o, { x: t.pos.x, y: t.pos.y + 1, z: t.pos.z })) continue;
    applyDamage(f, t, def.damage, false, 'knife');
    return 'fired';
  }
  return 'fired';
}

export function startReload(f) {
  const w = f.weapons;
  const def = currentDef(f);
  if (!def || !def.mag || w.reloadT > 0) return;
  const ammo = w.ammo[currentWeaponId(f)];
  if (!ammo || ammo.mag >= def.mag || ammo.reserve <= 0) return;
  w.reloadT = def.reload;
  AU.reloadSound(f.isHuman ? 0 : dist2d(f.pos, S.human.pos));
}

function finishReload(f) {
  const w = f.weapons;
  const def = currentDef(f);
  if (!def || !def.mag) return;
  const ammo = w.ammo[currentWeaponId(f)];
  if (!ammo) return;
  const take = Math.min(def.mag - ammo.mag, ammo.reserve);
  ammo.mag += take;
  ammo.reserve -= take;
}

export function throwGrenade(f, kind) {
  const w = f.weapons;
  if (w.grenades[kind] <= 0 || w.fireT > 0 || w.drawT > 0) return 'wait';
  const p = projectiles.find((x) => !x.active);
  if (!p) return 'wait';
  w.grenades[kind]--;
  w.fireT = 0.45;
  eyePos(f, _o);
  lookDir(f.yaw, f.pitch + 0.12, _d);
  p.active = true;
  p.kind = kind;
  p.from = f;
  p.x = _o.x + _d.x * 0.4; p.y = _o.y; p.z = _o.z + _d.z * 0.4;
  p.vx = _d.x * 13; p.vy = _d.y * 13 + 2.2; p.vz = _d.z * 13;
  p.fuse = kind === 'frag' ? 1.5 : 1.15;
  p.mesh.visible = true;
  AU.throwSound(f.isHuman ? 0 : dist2d(f.pos, S.human.pos));
  if (w.grenades[kind] <= 0) w.current = w.primary ? 'primary' : 'sidearm';
  return 'thrown';
}

function explode(p) {
  const at = { x: p.x, y: p.y + 0.4, z: p.z };
  AU.explosionSound(dist2d(at, S.human.pos));
  spawnParticles(at.x, at.y, at.z, 0xff9a3c, 30, 5.5, 0.7, 1);
  spawnParticles(at.x, at.y, at.z, 0x5a5a55, 16, 2.5, 1.1, -0.4);
  S.shake = Math.min(0.9, S.shake + Math.max(0, 0.55 - dist2d(at, S.human.pos) * 0.02));
  S.noises.push({ x: at.x, z: at.z, radius: 55, team: p.from ? p.from.team : 'atk', kind: 'boom' });
  for (const t of S.players) {
    if (!t.alive) continue;
    const d = Math.hypot(t.pos.x - at.x, t.pos.z - at.z);
    if (d > 7) continue;
    if (sightBlocked(at, { x: t.pos.x, y: t.pos.y + 0.9, z: t.pos.z })) continue;
    applyDamage(p.from, t, 92 * (1 - d / 7.5), false, 'frag');
  }
}

function popSmoke(p) {
  // A vented dome (seal at 70% or worse) thins a fresh cloud out 2 s early.
  const cloud = { x: p.x, y: p.y + 0.8, z: p.z, r: 2.7, until: S.time + (S.sealPct <= 70 ? 7 : 9) };
  smokes.push(cloud);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(2.7, 12, 9),
    new THREE.MeshStandardMaterial({ color: PAL.smoke, transparent: true, opacity: 0.55, roughness: 1, depthWrite: false }),
  );
  mesh.position.set(cloud.x, cloud.y, cloud.z);
  scene.add(mesh);
  cloud.mesh = mesh;
  AU.smokeSound(dist2d(cloud, S.human.pos));
  spawnParticles(cloud.x, cloud.y, cloud.z, PAL.smoke, 18, 1.6, 0.9, -0.3);
}

// Does the segment a-b pass through live smoke? Bots and blast checks ask.
export function smokeBlocks(a, b) {
  for (const s of smokes) {
    if (s.until < S.time) continue;
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz;
    if (len2 < 0.001) continue;
    let t = ((s.x - a.x) * abx + (s.y - a.y) * aby + (s.z - a.z) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const dx = a.x + abx * t - s.x, dy = a.y + aby * t - s.y, dz = a.z + abz * t - s.z;
    if (dx * dx + dy * dy + dz * dz < s.r * s.r) return true;
  }
  return false;
}

export function updateCombat(dt) {
  for (const f of S.players) {
    const w = f.weapons;
    if (!w) continue;
    if (w.fireT > 0) w.fireT -= dt;
    if (w.drawT > 0) w.drawT -= dt;
    if (w.bloom > 0) w.bloom = Math.max(0, w.bloom - dt * 0.055);
    if (f.recoil) f.recoil = Math.max(0, f.recoil - dt * 0.09);
    if (w.reloadT > 0) {
      w.reloadT -= dt;
      if (w.reloadT <= 0) finishReload(f);
    }
  }
  for (const t of tracers) {
    if (t.life <= 0) continue;
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.85;
    if (t.life <= 0) t.line.visible = false;
  }
  for (const fl of flashes) {
    if (fl.life <= 0) continue;
    fl.life -= dt;
    if (fl.life <= 0) fl.sp.visible = false;
  }
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 260);
  const pos = particles.geometry.attributes.position.array;
  for (let i = 0; i < pData.length; i++) {
    const p = pData[i];
    if (p.life <= 0) { pos[i * 3 + 1] = -50; continue; }
    p.life -= dt;
    p.vy -= p.grav * dt;
    pos[i * 3] += p.vx * dt; pos[i * 3 + 1] += p.vy * dt; pos[i * 3 + 2] += p.vz * dt;
    if (pos[i * 3 + 1] < 0.03) { pos[i * 3 + 1] = 0.03; p.vy = 0; }
  }
  particles.geometry.attributes.position.needsUpdate = true;
  for (const p of projectiles) {
    if (!p.active) continue;
    p.fuse -= dt;
    p.vy -= 9.8 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.y < 0.1) { p.y = 0.1; p.vy = Math.abs(p.vy) > 1.4 ? -p.vy * 0.35 : 0; p.vx *= 0.7; p.vz *= 0.7; }
    p.mesh.position.set(p.x, p.y, p.z);
    if (p.fuse <= 0) {
      p.active = false;
      p.mesh.visible = false;
      if (p.kind === 'frag') explode(p); else popSmoke(p);
    }
  }
  for (let i = smokes.length - 1; i >= 0; i--) {
    const s = smokes[i];
    const left = s.until - S.time;
    if (left <= 0) {
      scene.remove(s.mesh);
      smokes.splice(i, 1);
    } else if (left < 1.6) {
      s.mesh.material.opacity = 0.55 * (left / 1.6);
    }
  }
}
