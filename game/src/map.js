// map.js — the Glasshouse: a botanical research house, 64 by 44 metres.
//
// Layout, south to north: the Raiders' yard, a middle band holding the
// central dome hall between the Orchid House (site A, west) and the Fern
// Vault (site B, east), and the Wardens' service corridor. Each site room
// has three doors — from its gallery beside the dome, from the yard, and
// from the corridor — and the dome has a catwalk ring with two ramps.
//
// Everything solid is an axis-aligned box. The same boxes drive the meshes,
// the movement collision, the bullet raycasts and the bots' sight lines, so
// what you see is exactly what stops you.

import * as THREE from 'three';
import { PAL } from './palette.js';
import * as TEX from './textures.js';

export const WORLD = {
  minX: -32, maxX: 32, minZ: -22, maxZ: 22,
  colliders: [], // {x0,x1,z0,z1,y0,y1,kind} kind: wall | glass
  floors: [], // raised walkable tops {x0,x1,z0,z1,top}
  glass: [], // {box, mesh, broken}
  sites: {
    A: { x: -21, z: 0, r: 5.6 },
    B: { x: 21, z: 0, r: 5.6 },
  },
  spawns: { atk: [], def: [] },
  nodes: [], // {x, z, tag, site}
  links: [], // adjacency: array of arrays of node indices
};

let mats = null;

function buildMats() {
  const std = (opts) => new THREE.MeshStandardMaterial(opts);
  return {
    floor: std({ map: TEX.slabFloor(), roughness: 0.95 }),
    tiles: std({ map: TEX.floorTiles(), roughness: 0.9 }),
    wall: std({ color: PAL.concrete, roughness: 0.92 }),
    terra: std({ color: PAL.terracotta, roughness: 0.9 }),
    terraDark: std({ color: PAL.terracottaDark, roughness: 0.9 }),
    crate: std({ map: TEX.crateWood(), roughness: 0.85 }),
    soil: std({ map: TEX.soil(), roughness: 1 }),
    metal: std({ map: TEX.grating(), roughness: 0.6, metalness: 0.55 }),
    metalPlain: std({ color: PAL.metalDark, roughness: 0.5, metalness: 0.6 }),
    bark: std({ map: TEX.bark(), roughness: 1 }),
    leaf: std({ color: PAL.leaf, roughness: 1 }),
    leafLight: std({ color: PAL.leafLight, roughness: 1 }),
    glass: std({ color: PAL.glass, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
    glassRoof: std({ color: PAL.glass, roughness: 0.12, transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
    frame: std({ color: PAL.brass, roughness: 0.4, metalness: 0.7 }),
  };
}

// One solid box: a mesh for the eye, a collider for everything else.
function solid(scene, cx, cz, w, d, h, mat, y0 = 0, kind = 'wall') {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(cx, y0 + h / 2, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (kind) {
    WORLD.colliders.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0, y1: y0 + h, kind });
  }
  return mesh;
}

// A shatterable pane in a window band: sill below, lintel above, and the
// glass itself registered so combat can break it and rounds can mend it.
function glassPane(scene, cx, cz, w, alongX) {
  const d = alongX ? w : 0.12;
  const wd = alongX ? 0.12 : w;
  solid(scene, cx, cz, alongX ? w : 0.5, alongX ? 0.5 : w, 0.95, mats.terraDark); // sill
  solid(scene, cx, cz, alongX ? w : 0.5, alongX ? 0.5 : w, 1.5, mats.terraDark, 2.55); // lintel
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(wd === 0.12 ? w : 0.1, 1.6, d === 0.12 ? w : 0.1), mats.glass);
  mesh.position.set(cx, 1.75, cz);
  scene.add(mesh);
  const box = { x0: cx - (alongX ? w / 2 : 0.06), x1: cx + (alongX ? w / 2 : 0.06), z0: cz - (alongX ? 0.06 : w / 2), z1: cz + (alongX ? 0.06 : w / 2), y0: 0.95, y1: 2.55, kind: 'glass' };
  WORLD.colliders.push(box);
  WORLD.glass.push({ box, mesh, broken: false });
}

// A planter: soil-topped box for cover, with a burst of foliage planes.
function planter(scene, cx, cz, w, d, leafTex) {
  solid(scene, cx, cz, w, d, 1.05, mats.terraDark);
  const top = new THREE.Mesh(new THREE.BoxGeometry(w - 0.15, 0.06, d - 0.15), mats.soil);
  top.position.set(cx, 1.08, cz);
  top.receiveShadow = true;
  scene.add(top);
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, transparent: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 });
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1), leafMat);
    const a = (i / 4) * Math.PI;
    p.position.set(cx + Math.cos(a) * w * 0.22, 1.65, cz + Math.sin(a) * d * 0.22);
    p.rotation.y = a + 0.6;
    p.castShadow = true;
    scene.add(p);
  }
}

function crateStack(scene, cx, cz, high) {
  solid(scene, cx, cz, 1.15, 1.15, 1.05, mats.crate);
  if (high) solid(scene, cx, cz, 1.15, 1.15, 1.05, mats.crate, 1.05);
}

function tree(scene, cx, cz, s) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.24 * s, 2.6 * s, 7), mats.bark);
  trunk.position.set(cx, 1.3 * s + 1.0, cz);
  trunk.castShadow = true;
  scene.add(trunk);
  const blobs = [[0, 3.6, 0, 1.5], [0.9, 3.1, 0.3, 1.0], [-0.8, 3.2, -0.4, 1.05], [0.2, 3.0, 0.8, 0.85]];
  for (const [ox, oy, oz, r] of blobs) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r * s, 8, 6), rngMat());
    b.position.set(cx + ox * s, oy * s + 1.0, cz + oz * s);
    b.castShadow = true;
    scene.add(b);
  }
}
let leafFlip = false;
function rngMat() { leafFlip = !leafFlip; return leafFlip ? mats.leaf : mats.leafLight; }

// A raised platform the physics treats as floor (the catwalk and its steps).
function platform(scene, cx, cz, w, d, top) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), mats.metal);
  mesh.position.set(cx, top - 0.09, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  WORLD.floors.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, top });
}

function railing(scene, cx, cz, w, d) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.85, d), mats.metalPlain);
  mesh.position.set(cx, 3.45, cz);
  scene.add(mesh);
  WORLD.colliders.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0: 3.0, y1: 3.9, kind: 'wall' });
}

export function buildMap(scene) {
  mats = buildMats();
  const leafTex = TEX.leafSprite();

  // Ground: one slab field, with the dome's terracotta tiles laid over it.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 44), mats.floor);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  mats.floor.map.repeat.set(16, 11);
  const tiles = new THREE.Mesh(new THREE.PlaneGeometry(25, 17), mats.tiles);
  tiles.rotation.x = -Math.PI / 2;
  tiles.position.y = 0.01;
  tiles.receiveShadow = true;
  scene.add(tiles);
  mats.tiles.map.repeat.set(6, 4);

  // Site roundels painted on the wing floors.
  for (const [key, css] of [['A', '#d98cb3'], ['B', '#9fd08a']]) {
    const site = WORLD.sites[key];
    const ring = new THREE.Mesh(
      new THREE.CircleGeometry(5.2, 40),
      new THREE.MeshBasicMaterial({ map: TEX.siteRoundel(key, css), transparent: true, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.02, site.z);
    scene.add(ring);
  }

  wallShell(scene);
  buildDome(scene, leafTex);
  for (const s of [-1, 1]) buildWing(scene, s, leafTex);
  dressing(scene, leafTex);
  buildNodes();
  buildSpawns();

  // Light: a low warm sun through the glass, and soft green bounce.
  const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PAL.sun, 2.0);
  sun.position.set(26, 34, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -38; sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.fog = new THREE.Fog(PAL.fog, 55, 130);
  return WORLD;
}

function wallShell(scene) {
  const H = 4.4;
  solid(scene, 0, -22.2, 65, 0.6, H, mats.wall); // north, behind the corridor
  solid(scene, 0, 22.2, 65, 0.6, H, mats.wall); // south, behind the yard
  solid(scene, -32.2, 0, 0.6, 45, H, mats.wall);
  solid(scene, 32.2, 0, 0.6, 45, H, mats.wall);
}

// The dome hall: square walls with a centre door on each side, glass window
// bands beside the doors, and the catwalk ring inside.
function buildDome(scene, leafTex) {
  const T = 0.5; // wall thickness
  // Each wall: end solids, a post, a glass window band, the centre door.
  // Spans, from the middle out: door 1.5 | post 1.2 | glass 2.4 | end 2.9.
  for (const s of [-1, 1]) {
    // west (s=-1) and east (s=1) walls at x = 12s, doors at z=0
    const x = 12 * s;
    solid(scene, x, -6.55, T, 2.9, 4, mats.terra);
    solid(scene, x, 6.55, T, 2.9, 4, mats.terra);
    solid(scene, x, -2.1, T, 1.2, 4, mats.terra);
    solid(scene, x, 2.1, T, 1.2, 4, mats.terra);
    glassPane(scene, x, -3.9, 2.4, false);
    glassPane(scene, x, 3.9, 2.4, false);
    // south (s=-1 -> z=8) and north (s=1 -> z=-8) walls, doors at x=0
    const z = s < 0 ? 8 : -8;
    solid(scene, -6.55, z, 2.9, T, 4, mats.terra);
    solid(scene, 6.55, z, 2.9, T, 4, mats.terra);
    solid(scene, -2.1, z, 1.2, T, 4, mats.terra);
    solid(scene, 2.1, z, 1.2, T, 4, mats.terra);
    glassPane(scene, -3.9, z, 2.4, true);
    glassPane(scene, 3.9, z, 2.4, true);
  }
  // The glass dome itself and its brass rim.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(13.5, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), mats.glassRoof);
  dome.position.y = 1.2;
  scene.add(dome);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(12.6, 0.16, 8, 40), mats.frame);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 4.6;
  scene.add(rim);

  // Centre planter with the big tree, and four planters around it.
  const bed = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 1.05, 18), mats.terraDark);
  bed.position.set(0, 0.53, 0);
  bed.castShadow = true; bed.receiveShadow = true;
  scene.add(bed);
  // The bed is round; its box is kept a touch inside the rim so the bots'
  // walk tests do not wall off the corners that are really open floor.
  WORLD.colliders.push({ x0: -1.55, x1: 1.55, z0: -1.55, z1: 1.55, y0: 0, y1: 1.05, kind: 'wall' });
  tree(scene, 0, 0, 1.5);
  planter(scene, -6.5, -4.5, 3.4, 1.3, leafTex);
  planter(scene, 6.5, -4.5, 3.4, 1.3, leafTex);
  planter(scene, -6.5, 4.5, 3.4, 1.3, leafTex);
  planter(scene, 6.5, 4.5, 3.4, 1.3, leafTex);
  crateStack(scene, 9.5, 5.5, true);
  crateStack(scene, -9.5, -5.5, true);
  crateStack(scene, 9.5, -5.5, false);
  crateStack(scene, -9.5, 5.5, false);

  buildCatwalk(scene);
}

function buildCatwalk(scene) {
  const Y = 3.0;
  platform(scene, 0, -6.9, 21, 1.5, Y); // north strip
  platform(scene, 0, 6.9, 21, 1.5, Y); // south strip
  // The side strips stop where their ramps land: west runs from the north
  // strip down to its ramp's top step, east from its ramp to the south strip.
  platform(scene, -10.6, -3.7, 1.5, 5.0, Y); // west strip
  platform(scene, 10.6, 3.7, 1.5, 5.0, Y); // east strip
  // Railings on the hall side of every strip.
  railing(scene, 0, -6.05, 20.6, 0.12);
  railing(scene, 0, 6.05, 20.6, 0.12);
  railing(scene, -9.75, -3.7, 0.12, 4.7);
  railing(scene, 9.75, 3.7, 0.12, 4.7);
  // Two ramps of six shallow steps: west climbs northward, east southward.
  for (let i = 0; i < 6; i++) {
    platform(scene, -10.6, 4.6 - i * 1.05, 1.5, 1.1, 0.5 * (i + 1));
    platform(scene, 10.6, -4.6 + i * 1.05, 1.5, 1.1, 0.5 * (i + 1));
  }
  // Supports.
  for (const [x, z] of [[-10.6, -6.9], [10.6, -6.9], [-10.6, 6.9], [10.6, 6.9], [-5, -6.9], [5, -6.9], [-5, 6.9], [5, 6.9]]) {
    solid(scene, x, z, 0.45, 0.45, 3.0, mats.metalPlain);
  }
}

// One site wing. s=-1 builds the Orchid House (west), s=1 the Fern Vault.
function buildWing(scene, s, leafTex) {
  const cx = 21 * s; // wing centre x
  const inner = 14 * s; // gallery-side wall x
  const outer = 30 * s;
  // Gallery wall (x = 14s): end solids, posts, a glass band in the middle,
  // and a door on each side of it (spans: end 2.2 | door 2.3 | post 1.7 |
  // glass 3.6 | post 1.7 | door 2.3 | end 2.2).
  solid(scene, inner, -6.9, 0.5, 2.2, 4, mats.terra);
  solid(scene, inner, 6.9, 0.5, 2.2, 4, mats.terra);
  solid(scene, inner, -2.65, 0.5, 1.7, 4, mats.terra);
  solid(scene, inner, 2.65, 0.5, 1.7, 4, mats.terra);
  glassPane(scene, inner, 0, 3.6, false);
  // Outer wall (x = 30s): one solid run.
  solid(scene, outer, 0, 0.5, 16.4, 4, mats.wall);
  // South and north walls (z = ±8), read from the gallery side out: a solid
  // run, a glass band, the main door at the wing's heart, then a long solid
  // run to the outer wall.
  for (const zs of [-1, 1]) {
    const z = 8 * zs;
    solid(scene, cx - 4.75 * s, z, 4.5, 0.5, 4, mats.terra);
    glassPane(scene, cx - 1.45 * s, z, 2.1, true);
    solid(scene, cx + 5.4 * s, z, 7.2, 0.5, 4, mats.terra);
  }
  // Gallery end caps, closing the 2 m gallery at z = ±8.
  solid(scene, 13 * s, -8, 2.5, 0.5, 4, mats.terra);
  solid(scene, 13 * s, 8, 2.5, 0.5, 4, mats.terra);
  // A glass roof over the wing, held by brass ribs (visual only).
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), mats.glassRoof);
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(cx, 4.35, 0);
  scene.add(roof);
  // Inside: planters along the walls, crates for the site fight, a tree.
  planter(scene, cx - 6.4 * s, -5.6, 1.3, 3.6, leafTex);
  planter(scene, cx - 6.4 * s, 5.6, 1.3, 3.6, leafTex);
  planter(scene, cx + 6.2 * s, 0, 1.3, 4.2, leafTex);
  crateStack(scene, cx - 2.6 * s, -3.4, true);
  crateStack(scene, cx + 3.1 * s, 3.8, false);
  crateStack(scene, cx - 3.4 * s, 4.4, false);
  tree(scene, cx + 5.6 * s, -5.2, 0.9);
  tree(scene, cx - 5.8 * s, 0.4, 0.8);
}

// Yard and corridor dressing: planters and crates that break the long
// sightlines without closing them.
function dressing(scene, leafTex) {
  planter(scene, -16, 15, 4.4, 1.4, leafTex);
  planter(scene, 16, 15, 4.4, 1.4, leafTex);
  planter(scene, -16, -15, 4.4, 1.4, leafTex);
  planter(scene, 16, -15, 4.4, 1.4, leafTex);
  planter(scene, -8.5, 13.5, 4.4, 1.4, leafTex);
  planter(scene, 8.5, 13.5, 4.4, 1.4, leafTex);
  planter(scene, -8.5, -13.5, 4.4, 1.4, leafTex);
  planter(scene, 8.5, -13.5, 4.4, 1.4, leafTex);
  crateStack(scene, -24, 12.5, true);
  crateStack(scene, 24, 12.5, false);
  crateStack(scene, -24, -12.5, false);
  crateStack(scene, 24, -12.5, true);
  crateStack(scene, -6, -16.5, true);
  crateStack(scene, 6, 16.5, true);
}

// Waypoints the bots walk. Edges are earned, not declared: a link exists
// when the straight walk between two nodes stays out of every solid box.
function buildNodes() {
  const N = (x, z, tag = '', site = null) => WORLD.nodes.push({ x, z, tag, site });
  N(0, 19, 'spawn'); N(0, 13.5); N(0, 9.5);
  N(0, 4.2); N(0, -4.2); N(4.2, 0); N(-4.2, 0); // a ring around the centre bed
  N(-5, 3); N(5, 3); N(-5, -3); N(5, -3);
  N(0, -9.5); N(0, -14); N(0, -19, 'spawn');
  for (const s of [-1, 1]) {
    N(13 * s, 0); N(13 * s, 5); N(13 * s, -5);
    N(17 * s, 5, '', s < 0 ? 'A' : 'B'); N(17 * s, -5, '', s < 0 ? 'A' : 'B');
    N(21 * s, 0, 'site', s < 0 ? 'A' : 'B'); N(21 * s, 6.4, '', s < 0 ? 'A' : 'B');
    N(21 * s, -6.4, '', s < 0 ? 'A' : 'B'); N(26 * s, 0, 'hold', s < 0 ? 'A' : 'B');
    N(21 * s, 9.5); N(21 * s, 14); N(21 * s, -9.5); N(21 * s, -14);
    N(14 * s, 14); N(14 * s, -14);
  }
  const blocked = (x, z) => WORLD.colliders.some((c) =>
    c.y1 > 0.55 && c.y0 < 1.4 && x > c.x0 - 0.45 && x < c.x1 + 0.45 && z > c.z0 - 0.45 && z < c.z1 + 0.45);
  const walkable = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / 0.5));
    for (let i = 0; i <= steps; i++) {
      if (blocked(a.x + (dx * i) / steps, a.z + (dz * i) / steps)) return false;
    }
    return true;
  };
  WORLD.links = WORLD.nodes.map(() => []);
  for (let i = 0; i < WORLD.nodes.length; i++) {
    for (let j = i + 1; j < WORLD.nodes.length; j++) {
      const a = WORLD.nodes[i], b = WORLD.nodes[j];
      if (Math.hypot(b.x - a.x, b.z - a.z) < 17 && walkable(a, b)) {
        WORLD.links[i].push(j);
        WORLD.links[j].push(i);
      }
    }
  }
}

function buildSpawns() {
  const xs = [-4.4, -2.2, 0, 2.2, 4.4];
  WORLD.spawns.atk = xs.map((x) => ({ x, z: 19, yaw: 0 }));
  WORLD.spawns.def = xs.map((x) => ({ x, z: -19, yaw: Math.PI }));
}

export function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = WORLD.sites[key];
    if (Math.hypot(x - s.x, z - s.z) <= s.r) return key;
  }
  return null;
}

export function breakGlass(panel) {
  panel.broken = true;
  panel.mesh.visible = false;
  panel.box.y1 = -1; // the collider stops stopping anything
}

export function resetGlass() {
  for (const p of WORLD.glass) {
    if (!p.broken) continue;
    p.broken = false;
    p.mesh.visible = true;
    p.box.y1 = 2.55;
  }
}
