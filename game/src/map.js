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
import { makeRng } from './state.js';
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
    crateDark: std({ color: PAL.crateDark, roughness: 0.9 }),
    soil: std({ map: TEX.soil(), roughness: 1 }),
    metal: std({ map: TEX.grating(), roughness: 0.6, metalness: 0.55 }),
    metalPlain: std({ color: PAL.metalDark, roughness: 0.5, metalness: 0.6 }),
    bark: std({ map: TEX.bark(), roughness: 1 }),
    leaf: std({ color: PAL.leaf, roughness: 1 }),
    leafLight: std({ color: PAL.leafLight, roughness: 1 }),
    leafDark: std({ color: PAL.leafDark, roughness: 1 }),
    glass: std({ color: PAL.glass, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.28, side: THREE.DoubleSide, envMapIntensity: 1.3 }),
    glassRoof: std({ color: PAL.glass, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.16, side: THREE.DoubleSide, envMapIntensity: 1.1 }),
    frame: std({ color: PAL.brass, roughness: 0.35, metalness: 0.75, envMapIntensity: 1.2 }),
    water: std({ color: 0x2f5f52, roughness: 0.06, metalness: 0.05, transparent: true, opacity: 0.94, envMapIntensity: 1.6 }),
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

// Planter-top spots where buildFoliage plants its instanced shrubs.
const shrubSpots = [];

// A planter: soil-topped box for cover, with a burst of foliage planes.
function planter(scene, cx, cz, w, d, leafTex) {
  solid(scene, cx, cz, w, d, 1.05, mats.terraDark);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, 0.1, d + 0.14), mats.terra);
  rim.position.set(cx, 1.04, cz);
  rim.castShadow = true;
  rim.receiveShadow = true;
  scene.add(rim);
  const top = new THREE.Mesh(new THREE.BoxGeometry(w - 0.15, 0.06, d - 0.15), mats.soil);
  top.position.set(cx, 1.08, cz);
  top.receiveShadow = true;
  scene.add(top);
  const along = w >= d ? 'x' : 'z';
  for (const t of [-0.28, 0.05, 0.32]) {
    shrubSpots.push({
      x: cx + (along === 'x' ? w * t : (t - 0.05) * 0.8),
      y: 1.3,
      z: cz + (along === 'z' ? d * t : (t + 0.02) * 0.8),
      s: 0.66 + ((shrubSpots.length * 7) % 5) * 0.09,
    });
  }
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
  band(scene, cx, cz, 1.0);
  if (high) { solid(scene, cx, cz, 1.15, 1.15, 1.05, mats.crate, 1.05); band(scene, cx, cz, 2.05); }
}

// A dark iron band around a crate's top edge: cheap, and it makes the
// stack read as freight instead of a plain box.
function band(scene, cx, cz, y) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(1.21, 0.08, 1.21), mats.crateDark);
  b.position.set(cx, y, cz);
  b.castShadow = true;
  scene.add(b);
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
  buildFoliage(scene);
  buildNodes();
  buildSpawns();

  // Light: a low warm sun through the glass, and soft green bounce.
  const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.02);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PAL.sun, 2.3);
  sun.position.set(26, 34, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -38; sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.fog = new THREE.Fog(PAL.fog, 46, 120);
  return WORLD;
}

// The living layer, instanced: leafy shrub blobs and crossed leaf cards on
// every planter the builders registered, ground shrubs in the quiet
// corners, and vines hanging from the dome rim. Four draw calls for all of
// it, matrices written once at build, and nothing where a waypoint walks —
// the gameplay map underneath is untouched.
function buildFoliage(scene) {
  const rng = makeRng(20240);
  const dummy = new THREE.Object3D();
  const spots = shrubSpots.slice();
  for (const [x, z] of [[-11, 7.1], [11, 7.1], [-11, -7.1], [11, -7.1],
    [-28.5, 19], [28.5, 19], [-28.5, -19], [28.5, -19], [-19, 0.5], [19, -6.8]]) {
    spots.push({ x, y: 0.42, z, s: 1.25 });
  }
  const blobGeo = new THREE.SphereGeometry(0.5, 7, 5);
  const halves = [[], []];
  spots.forEach((sp, i) => halves[i % 2].push(sp));
  [mats.leafDark, mats.leafLight].forEach((mat, h) => {
    const im = new THREE.InstancedMesh(blobGeo, mat, halves[h].length);
    halves[h].forEach((sp, i) => {
      dummy.position.set(sp.x, sp.y + 0.18, sp.z);
      dummy.scale.set(sp.s * (0.9 + rng() * 0.4), sp.s * 0.72, sp.s * (0.9 + rng() * 0.4));
      dummy.rotation.set(0, rng() * Math.PI, 0);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.castShadow = true;
    scene.add(im);
  });
  // Crossed leaf cards above the planter shrubs, reusing the planter
  // canopy texture: two instanced planes per spot, crossed at 90 degrees.
  const cardMat = new THREE.MeshStandardMaterial({
    map: TEX.leafSprite(), transparent: true, alphaTest: 0.45,
    side: THREE.DoubleSide, roughness: 1,
  });
  const cards = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.35, 0.95), cardMat, spots.length * 2);
  spots.forEach((sp, i) => {
    for (let k = 0; k < 2; k++) {
      dummy.position.set(sp.x, sp.y + 0.42, sp.z);
      dummy.scale.setScalar(sp.s * 1.5);
      dummy.rotation.set(0, rng() * Math.PI + (k * Math.PI) / 2, 0);
      dummy.updateMatrix();
      cards.setMatrixAt(i * 2 + k, dummy.matrix);
    }
  });
  cards.castShadow = true;
  scene.add(cards);
  // Vines down from the dome rim, on an ellipse that hugs the hall.
  const NV = 26;
  const vines = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.028, 0.042, 1, 5), mats.leafDark, NV);
  const tips = new THREE.InstancedMesh(blobGeo, mats.leaf, NV);
  for (let i = 0; i < NV; i++) {
    const a = (i / NV) * Math.PI * 2 + rng() * 0.2;
    const x = Math.cos(a) * 11.6, z = Math.sin(a) * 7.4;
    const len = 1.1 + rng() * 1.3;
    dummy.position.set(x, 4.35 - len / 2, z);
    dummy.scale.set(1, len, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    vines.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 4.35 - len, z);
    dummy.scale.setScalar(0.34 + rng() * 0.2);
    dummy.updateMatrix();
    tips.setMatrixAt(i, dummy.matrix);
  }
  scene.add(vines, tips);
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
  // The dome's skeleton: four meridian ribs and two latitude rings of
  // brass, riding just under the glass so the shell reads as engineering,
  // not a bubble. Visual only — the colliders stay as they were.
  const ribGeo = new THREE.TorusGeometry(13.42, 0.07, 6, 42, Math.PI * 0.84);
  for (let k = 0; k < 4; k++) {
    const rib = new THREE.Mesh(ribGeo, mats.frame);
    rib.rotation.order = 'YXZ';
    rib.rotation.y = (k * Math.PI) / 4 + Math.PI / 8;
    rib.rotation.z = Math.PI / 2 - Math.PI * 0.42;
    rib.position.y = 1.2;
    scene.add(rib);
  }
  for (const th of [0.2, 0.33]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(13.42 * Math.sin(th * Math.PI), 0.055, 6, 48), mats.frame);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.2 + 13.42 * Math.cos(th * Math.PI);
    scene.add(ring);
  }

  // Centre planter with the big tree, and four planters around it.
  const bed = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 1.05, 18), mats.terraDark);
  bed.position.set(0, 0.53, 0);
  bed.castShadow = true; bed.receiveShadow = true;
  scene.add(bed);
  // The bed is round; its box is kept a touch inside the rim so the bots'
  // walk tests do not wall off the corners that are really open floor.
  WORLD.colliders.push({ x0: -1.55, x1: 1.55, z0: -1.55, z1: 1.55, y0: 0, y1: 1.05, kind: 'wall' });
  tree(scene, 0, 0, 1.5);
  // A shallow rill pond rings the centre bed: flat enough to wade through
  // in a fight, glossy enough to throw the dome back at the player.
  const pond = new THREE.Mesh(new THREE.CircleGeometry(3.35, 36), mats.water);
  pond.rotation.x = -Math.PI / 2;
  pond.position.y = 0.025;
  pond.receiveShadow = true;
  scene.add(pond);
  const pondRim = new THREE.Mesh(new THREE.TorusGeometry(3.35, 0.045, 6, 40), mats.frame);
  pondRim.rotation.x = Math.PI / 2;
  pondRim.position.y = 0.03;
  scene.add(pondRim);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    shrubSpots.push({ x: Math.cos(a) * 1.55, y: 1.28, z: Math.sin(a) * 1.55, s: 0.6 });
  }
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
  for (const off of [-6, -2, 2, 6]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 16.8), mats.frame);
    rib.position.set(cx + off, 4.38, 0);
    scene.add(rib);
  }
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
