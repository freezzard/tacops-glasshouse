// physics.js — movement and rays against the map's boxes.
//
// Fighters are cylinders in plan view and a height in section. Horizontal
// motion resolves axis by axis so walls slide instead of sticking; the
// ground under a fighter is the highest standable top not more than a step
// above their feet, which is what lets the catwalk, the crates and the
// planter rims all work with no special cases.

import { WORLD } from './map.js';

export const RADIUS = 0.42;
export const HEIGHT = 1.8;
export const HEIGHT_CROUCH = 1.28;
export const EYE = 1.62;
export const EYE_CROUCH = 1.06;
export const STEP = 0.55;
export const GRAVITY = 13;
export const JUMP_VEL = 5.4;

export function eyeHeight(f) {
  return f.crouch ? EYE_CROUCH : EYE;
}

export function eyePos(f, out) {
  out.x = f.pos.x;
  out.y = f.pos.y + eyeHeight(f);
  out.z = f.pos.z;
  return out;
}

export function groundHeightAt(x, z, feetY) {
  let best = 0;
  for (const fl of WORLD.floors) {
    if (x >= fl.x0 && x <= fl.x1 && z >= fl.z0 && z <= fl.z1 && fl.top <= feetY + STEP && fl.top > best) {
      best = fl.top;
    }
  }
  for (const c of WORLD.colliders) {
    if (c.kind !== 'wall' || c.y1 > 2.3) continue;
    if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1 && c.y1 <= feetY + STEP && c.y1 > best) {
      best = c.y1;
    }
  }
  return best;
}

// Does a solid box block a fighter standing at feetY?
function blocksAt(c, feetY, height) {
  return c.y1 > feetY + STEP && c.y0 < feetY + height;
}

export function moveFighter(f, dt) {
  const height = f.crouch ? HEIGHT_CROUCH : HEIGHT;
  // X axis, then Z, each pushed out of anything solid.
  f.pos.x += f.vel.x * dt;
  for (const c of WORLD.colliders) {
    if (!blocksAt(c, f.pos.y, height)) continue;
    if (f.pos.x + RADIUS > c.x0 && f.pos.x - RADIUS < c.x1 && f.pos.z + RADIUS > c.z0 && f.pos.z - RADIUS < c.z1) {
      f.pos.x = f.vel.x > 0 ? c.x0 - RADIUS : c.x1 + RADIUS;
    }
  }
  f.pos.z += f.vel.z * dt;
  for (const c of WORLD.colliders) {
    if (!blocksAt(c, f.pos.y, height)) continue;
    if (f.pos.x + RADIUS > c.x0 && f.pos.x - RADIUS < c.x1 && f.pos.z + RADIUS > c.z0 && f.pos.z - RADIUS < c.z1) {
      f.pos.z = f.vel.z > 0 ? c.z0 - RADIUS : c.z1 + RADIUS;
    }
  }
  f.pos.x = Math.max(WORLD.minX + RADIUS, Math.min(WORLD.maxX - RADIUS, f.pos.x));
  f.pos.z = Math.max(WORLD.minZ + RADIUS, Math.min(WORLD.maxZ - RADIUS, f.pos.z));
  // Vertical: gravity, then land on whatever is under the feet.
  f.vy -= GRAVITY * dt;
  f.pos.y += f.vy * dt;
  const ground = groundHeightAt(f.pos.x, f.pos.z, f.pos.y);
  if (f.pos.y <= ground) {
    f.pos.y = ground;
    f.vy = 0;
    f.onGround = true;
  } else {
    f.onGround = false;
  }
  f.speedNow = Math.hypot(f.vel.x, f.vel.z);
}

// Ray versus one box, slab method. Returns the entry distance or Infinity.
export function rayVsBox(o, d, b) {
  let tmin = 0;
  let tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    const lo = ax === 'x' ? b.x0 : ax === 'y' ? b.y0 : b.z0;
    const hi = ax === 'x' ? b.x1 : ax === 'y' ? b.y1 : b.z1;
    if (Math.abs(d[ax]) < 1e-8) {
      if (o[ax] < lo || o[ax] > hi) return Infinity;
    } else {
      let t1 = (lo - o[ax]) / d[ax];
      let t2 = (hi - o[ax]) / d[ax];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// The nearest solid thing along a ray: walls and unbroken glass alike.
// Combat decides what a glass hit means.
export function raycastWorld(o, d, maxDist) {
  let best = maxDist;
  let hitBox = null;
  for (const c of WORLD.colliders) {
    if (c.y1 < 0) continue; // a broken pane, switched off by map.breakGlass
    const t = rayVsBox(o, d, c);
    if (t < best) { best = t; hitBox = c; }
  }
  return hitBox ? { dist: best, box: hitBox } : null;
}

// The two boxes a fighter presents to a bullet: legs-and-torso, and head.
// The head box rides on the crouch height, so a crouched headshot is earned.
export function fighterBoxes(f) {
  const w = 0.31;
  const top = f.pos.y + (f.crouch ? HEIGHT_CROUCH : HEIGHT);
  const neck = f.pos.y + (f.crouch ? 0.92 : 1.38);
  return {
    body: { x0: f.pos.x - w, x1: f.pos.x + w, z0: f.pos.z - w, z1: f.pos.z + w, y0: f.pos.y, y1: neck },
    head: { x0: f.pos.x - 0.21, x1: f.pos.x + 0.21, z0: f.pos.z - 0.21, z1: f.pos.z + 0.21, y0: neck, y1: top },
  };
}

// Sight line between two points: blocked by walls, never by glass (you can
// see through a greenhouse), and not by low cover a standing eye clears.
export function sightBlocked(a, b) {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const dist = Math.hypot(d.x, d.y, d.z);
  if (dist < 0.01) return false;
  d.x /= dist; d.y /= dist; d.z /= dist;
  for (const c of WORLD.colliders) {
    if (c.kind !== 'wall') continue;
    const t = rayVsBox(a, d, c);
    if (t < dist - 0.05) return true;
  }
  return false;
}

// Yaw convention for the whole game: yaw 0 looks north (-z), and the look
// direction is (-sin yaw, ..., -cos yaw). Pitch is up-positive.
export function lookDir(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

export function yawTo(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function dist2d(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
