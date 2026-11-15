// models.js — every figure and weapon in the game, built from primitives.
//
// No model file exists anywhere in this entry. A fighter is a hierarchy of
// jointed boxes and one rounded helmet shell: pelvis, spine, head, and two
// arms and legs with a pivot at every joint, dressed in the team's gear.
// The arms and the gun hang from a single aim pivot at the shoulder line,
// posed once so both palms rest on the grips; anim.js swings that whole
// assembly with the fighter's pitch instead of solving elbows per frame.
// Geometries and materials are shared across all ten fighters, so the cast
// costs a handful of distinct GPU states, and nothing here allocates after
// the build.

import * as THREE from 'three';
import { TEAM } from './state.js';
import { PAL } from './palette.js';

// ---------- shared geometry and materials ----------

const geoCache = new Map();
function box(w, h, d) {
  const key = 'b' + w + ',' + h + ',' + d;
  let g = geoCache.get(key);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(key, g); }
  return g;
}
function ball(r, w, h) {
  const key = 's' + r + ',' + w + ',' + h;
  let g = geoCache.get(key);
  if (!g) { g = new THREE.SphereGeometry(r, w, h); geoCache.set(key, g); }
  return g;
}

const std = (color, roughness, metalness = 0, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true, ...extra });

const MAT = {
  skin: std(PAL.skin, 0.75),
  skinDark: std(PAL.skinDark, 0.8),
  glove: std(PAL.glove, 0.9),
  boot: std(PAL.boot, 0.92),
  gun: std(0x2e3236, 0.42, 0.65),
  gunAccent: std(0x8a6d2f, 0.5, 0.5),
};
for (const t of [TEAM.ATK, TEAM.DEF]) {
  const def = t === TEAM.DEF;
  MAT[t] = {
    suit: std(def ? PAL.suitDef : PAL.suitAtk, 0.88, 0.02),
    armor: std(def ? PAL.armorDef : PAL.armorAtk, 0.62, 0.18),
    armorDark: std(def ? PAL.armorDefDark : PAL.armorAtkDark, 0.7, 0.12),
    cloth: std(def ? PAL.suitDef : PAL.clothAtk, 0.95, 0),
    visor: std(0x181a1c, 0.22, 0.45, {
      emissive: def ? PAL.visorDef : PAL.visorAtk, emissiveIntensity: 0.85,
    }),
  };
}

function part(parent, geo, mat, x, y, z, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}
function joint(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ---------- the held weapon ----------

// One gun built from seven boxes, reshaped per weapon by setWeaponLook:
// barrels lengthen, magazines hide, a pump appears — the same trick the
// first-person viewmodel uses, so the two never disagree about the gun.
function buildGun() {
  const g = new THREE.Group();
  const p = {};
  p.receiver = part(g, box(0.075, 0.13, 0.44), MAT.gun, 0, 0, -0.06);
  p.barrel = part(g, box(0.04, 0.04, 0.3), MAT.gun, 0, 0.028, -0.4, false);
  p.muzzle = part(g, box(0.055, 0.055, 0.07), MAT.gun, 0, 0.028, -0.55, false);
  p.mag = part(g, box(0.05, 0.15, 0.085), MAT.gunAccent, 0, -0.125, -0.02, false);
  p.stock = part(g, box(0.06, 0.1, 0.17), MAT.gun, 0, -0.015, 0.155, false);
  p.sight = part(g, box(0.024, 0.055, 0.03), MAT.gun, 0, 0.09, -0.06, false);
  p.pump = part(g, box(0.062, 0.062, 0.17), MAT.gunAccent, 0, -0.05, -0.3, false);
  p.grip = part(g, box(0.05, 0.11, 0.06), MAT.gun, 0, -0.1, 0.04, false);
  p.grip.rotation.x = 0.35;
  p.blade = part(g, box(0.018, 0.045, 0.26), MAT.gunAccent, 0, -0.02, -0.14, false);
  p.nade = part(g, ball(0.048, 8, 6), MAT.gun, 0, -0.04, -0.02, false);
  return { group: g, parts: p };
}

export function setWeaponLook(p, id) {
  const isGun = !!id && id !== 'knife' && id !== 'frag' && id !== 'smoke';
  p.receiver.visible = isGun;
  p.barrel.visible = isGun;
  p.muzzle.visible = isGun && id !== 'pistol';
  p.mag.visible = isGun && id !== 'shotgun';
  p.stock.visible = isGun && id !== 'pistol';
  p.sight.visible = isGun && id !== 'shotgun';
  p.pump.visible = id === 'shotgun';
  p.grip.visible = isGun;
  p.blade.visible = id === 'knife';
  p.nade.visible = id === 'frag' || id === 'smoke';
  p.receiver.scale.z = id === 'sniper' ? 1.3 : id === 'smg' ? 0.82 : id === 'pistol' ? 0.52 : 1;
  p.barrel.position.z = id === 'sniper' ? -0.5 : id === 'pistol' ? -0.28 : -0.4;
  p.muzzle.position.z = id === 'sniper' ? -0.68 : -0.55;
}

// ---------- the fighter ----------

// Builds one fighter of the given team and returns the root group plus the
// rig anim.js poses. Standing height 1.82 m; forward is -z, matching the
// game's yaw convention. The helmet shell is the bought armour made
// visible: over a cloth hood or wrap that every fighter always wears.
export function buildFigure(team) {
  const M = MAT[team];
  const skin = team === TEAM.DEF ? MAT.skin : MAT.skinDark;
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';

  const hips = joint(root, 0, 0.94, 0);
  part(hips, box(0.34, 0.19, 0.23), M.suit, 0, 0, 0); // pelvis
  part(hips, box(0.36, 0.07, 0.25), M.armorDark, 0, 0.07, 0, false); // belt

  const legs = {};
  for (const s of [-1, 1]) {
    const key = s < 0 ? 'L' : 'R';
    const thigh = joint(hips, 0.105 * s, -0.03, 0);
    part(thigh, box(0.155, 0.43, 0.18), M.suit, 0, -0.215, 0);
    const shin = joint(thigh, 0, -0.43, 0);
    part(shin, box(0.13, 0.42, 0.15), M.suit, 0, -0.21, 0);
    part(shin, box(0.145, 0.15, 0.05), M.armorDark, 0, -0.1, -0.095, false); // knee pad
    part(shin, box(0.125, 0.09, 0.29), MAT.boot, 0, -0.415, -0.05); // boot
    legs[key] = { thigh, shin };
  }

  const spine = joint(hips, 0, 0.09, 0);
  part(spine, box(0.4, 0.49, 0.22), M.suit, 0, 0.245, 0); // torso
  part(spine, box(0.43, 0.4, 0.26), M.armor, 0, 0.26, 0); // vest shell
  part(spine, box(0.1, 0.12, 0.05), M.armorDark, -0.09, 0.13, -0.155, false); // pouches
  part(spine, box(0.1, 0.12, 0.05), M.armorDark, 0.09, 0.13, -0.155, false);
  part(spine, box(0.32, 0.36, 0.15), M.armorDark, 0, 0.27, 0.185); // backpack
  part(spine, box(0.46, 0.09, 0.24), M.armorDark, 0, 0.47, 0, false); // shoulder bar
  // A bright team stripe across the back, so friend and foe read from
  // behind as surely as from the front.
  part(spine, box(0.34, 0.07, 0.02), M.armor, 0, 0.42, 0.27, false);

  const neck = joint(spine, 0, 0.5, 0);
  part(neck, ball(0.055, 8, 6), skin, 0, 0.01, 0, false);
  const head = joint(neck, 0, 0.04, 0);
  part(head, box(0.24, 0.26, 0.25), skin, 0, 0.12, 0);
  // The always-worn layer: a Curator's green wrap, a Graft rust hood.
  const wrap = part(head, box(0.28, 0.19, 0.28), M.cloth, 0, 0.17, 0.012, false);
  // The bought helmet: a rounded shell, its brim, the glowing visor, and
  // the team's silhouette mark — a Curator's crest fin, a Graft's horns.
  const helmet = new THREE.Group();
  head.add(helmet);
  const shell = part(helmet, ball(0.155, 10, 7), M.armor, 0, 0.19, 0);
  shell.scale.set(1, 0.78, 1.06);
  part(helmet, box(0.3, 0.035, 0.32), M.armorDark, 0, 0.145, 0, false);
  part(helmet, box(0.2, 0.06, 0.02), M.visor, 0, 0.115, -0.128, false);
  if (team === TEAM.DEF) {
    part(helmet, box(0.045, 0.11, 0.24), M.armor, 0, 0.325, 0.01, false); // crest
  } else {
    part(helmet, box(0.05, 0.09, 0.05), M.armor, -0.14, 0.3, 0, false); // horns
    part(helmet, box(0.05, 0.09, 0.05), M.armor, 0.14, 0.3, 0, false);
  }

  // Arms and gun on one pivot at the shoulder line. The pose inside the
  // pivot is fixed — solved once, here, so the right palm sits on the grip
  // and the left palm under the forend — and the pivot itself does all the
  // aiming, so the hold can never drift apart.
  const aim = joint(spine, 0, 0.44, -0.03);
  const gun = buildGun();
  gun.group.position.set(0.13, -0.1, -0.13);
  aim.add(gun.group);
  const arms = {};
  for (const s of [-1, 1]) {
    const key = s < 0 ? 'L' : 'R';
    const sh = joint(aim, 0.245 * s, 0.02, 0);
    part(sh, box(0.13, 0.13, 0.14), M.armor, 0, 0.01, 0, false); // shoulder pad
    part(sh, box(0.115, 0.3, 0.125), M.suit, 0, -0.15, 0); // upper arm
    const el = joint(sh, 0, -0.3, 0);
    part(el, box(0.1, 0.28, 0.11), M.armorDark, 0, -0.14, 0); // forearm guard
    part(el, box(0.095, 0.09, 0.12), MAT.glove, 0, -0.31, 0, false); // hand
    arms[key] = { sh, el };
  }
  // The solved hold (rotation.x swings a hanging limb forward, toward -z):
  // right elbow low and folded up to the grip, left arm reaching across.
  arms.R.sh.rotation.set(0.38, 0, 0.3);
  arms.R.el.rotation.set(1.62, 0, -0.15);
  arms.L.sh.rotation.set(1.02, 0, 0.46);
  arms.L.el.rotation.set(0.5, 0, 0.1);

  const rig = {
    root, hips, spine, neck, head, aim,
    legL: legs.L, legR: legs.R, armL: arms.L, armR: arms.R,
    gun: gun.group, gunParts: gun.parts, helmet, wrap,
    anim: {
      phase: Math.random() * 6.28, crouchT: 0, aimT: 0, deathT: 0,
      weaponId: null, seed: Math.random() * 10,
    },
  };
  root.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
  return { group: root, rig };
}

// ---------- the first-person viewmodel ----------

// The human's own arms and gun, built to the same pattern as a figure's:
// sleeves in the fighter's team colours, gloves on the grips, and a
// magazine group the reload animation can drop and reseat. player.js poses
// the assembly; the sleeve material is returned so a halftime side-swap can
// recolour it.
export function buildViewmodel(team) {
  const M = MAT[team];
  const vm = new THREE.Group();
  const gun = buildGun();
  gun.group.scale.setScalar(1.15);
  vm.add(gun.group);

  const armR = new THREE.Group();
  armR.position.set(0.03, -0.13, 0.06);
  const foreR = part(armR, box(0.085, 0.085, 0.4), M.suit, 0.1, -0.11, 0.21, false);
  foreR.rotation.y = -0.42;
  part(armR, box(0.09, 0.09, 0.12), MAT.glove, 0, -0.02, 0, false); // grip hand
  vm.add(armR);

  const armL = new THREE.Group();
  armL.position.set(0.1, -0.14, -0.34);
  const foreL = part(armL, box(0.08, 0.08, 0.38), M.suit, -0.1, -0.12, 0.2, false);
  foreL.rotation.y = 0.45;
  part(armL, box(0.088, 0.085, 0.12), MAT.glove, 0, -0.01, 0.01, false); // forend hand
  vm.add(armL);

  vm.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return {
    group: vm,
    parts: {
      gun: gun.group, gunParts: gun.parts, armL, armR,
      sleeves: [foreR, foreL], teamMats: MAT,
    },
  };
}
