// anim.js — procedural animation: the rigs models.js builds, posed from
// fighter state every rendered frame.
//
// There are no animation clips. The gait cycle advances by distance
// travelled, so feet cannot skate; the aim pivot carries arms and gun as
// one assembly, so the two-handed hold never drifts; crouch, reload,
// channel work, hit flinches and death are blends between poses computed
// from the same state the simulation already keeps. Everything eases with
// frame-rate-independent exponentials, and the hot path allocates nothing.

import { S } from './state.js';
import { currentDef, currentWeaponId } from './weapons.js';
import { setWeaponLook } from './models.js';

const ap = (v, goal, k, dt) => v + (goal - v) * (1 - Math.exp(-k * dt));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);

// The fixed hold inside the aim pivot, as solved in models.js. Reload and
// channel work depart from it and return; death abandons it.
const HOLD = {
  L: { shX: 1.02, shZ: 0.46, elX: 0.5 },
  R: { shX: 0.38, shZ: 0.3, elX: 1.62 },
};
const SLACK = { shX: 0.14, elX: 0.12 };

export function poseFigure(f, dt) {
  const rig = f.rig;
  if (!rig) return;
  const A = rig.anim;
  if (A.deadFrozen) return;
  const g = rig.root;
  g.position.set(f.pos.x, f.pos.y, f.pos.z);
  g.rotation.y = f.yaw;

  const wid = currentWeaponId(f);
  if (wid !== A.weaponId) { A.weaponId = wid; setWeaponLook(rig.gunParts, wid); }
  rig.helmet.visible = !!f.helmet;

  if (!f.alive) { poseDeath(f, rig, dt); return; }

  // --- blends -------------------------------------------------------------
  const w = f.weapons;
  const channeling = S.botPlanting === f || S.botDefusing === f ||
    (f.isHuman && !!S.channel && f.interact);
  A.crouchT = ap(A.crouchT, f.crouch ? 1 : 0, 12, dt);
  let aimGoal = 0.38; // patrol carry: muzzle low, both hands on the gun
  if (channeling) aimGoal = 0.1;
  else if (f.isHuman) aimGoal = 1;
  else if (f.bot && f.bot.target) aimGoal = 1;
  else if (f.bot && f.bot.state === 'hold') aimGoal = 0.82;
  A.aimT = ap(A.aimT, aimGoal, 8, dt);
  const aimT = A.aimT, crT = A.crouchT;

  // --- gait ---------------------------------------------------------------
  const speed = f.speedNow;
  const moveBlend = clamp01(speed / 3.2);
  const runF = clamp01((speed - 2.4) / 3);
  const stride = 1.45 + runF * 0.6;
  A.phase += (speed * dt * Math.PI * 2) / stride;
  const q = A.phase;
  const amp = (0.44 + runF * 0.3) * (1 - 0.55 * aimT) * (1 - crT * 0.75);
  const kneeAmp = 0.68 + runF * 0.37;
  const gait = 1 - crT;
  rig.legL.thigh.rotation.x = amp * Math.sin(q) * gait + 1.06 * crT;
  rig.legR.thigh.rotation.x = amp * Math.sin(q + Math.PI) * gait + 1.06 * crT;
  rig.legL.shin.rotation.x = -(0.05 + kneeAmp * Math.max(0, -Math.sin(q - 0.6))) * gait - 1.78 * crT;
  rig.legR.shin.rotation.x = -(0.05 + kneeAmp * Math.max(0, -Math.sin(q + Math.PI - 0.6))) * gait - 1.78 * crT;
  const bob = 0.03 * ((1 - Math.cos(2 * q)) / 2) * moveBlend * gait;
  rig.hips.position.y = 0.94 - 0.34 * crT + bob - (f.onGround ? 0 : 0.045);
  rig.hips.rotation.z = 0.05 * Math.sin(q) * moveBlend * gait;

  // --- spine, head ----------------------------------------------------------
  const tau = S.time - f.lastDamageAt;
  const flinch = tau >= 0 && tau < 0.6 ? 0.13 * Math.exp(-10 * tau) * Math.sin(26 * tau) : 0;
  const breathe = Math.sin(S.time * 1.5 + A.seed) * 0.013 * (1 - moveBlend);
  rig.spine.rotation.x = -0.16 * runF * moveBlend - 0.3 * crT + breathe + flinch;
  rig.spine.rotation.z = -rig.hips.rotation.z * 0.6;
  rig.head.rotation.x = f.pitch * 0.5 * aimT + 0.22 * crT + (channeling ? -0.38 : 0);
  rig.neck.rotation.x = f.pitch * 0.2 * aimT;

  // --- reload timeline ------------------------------------------------------
  let relP = -1, relBump = 0, magBump = 0;
  if (w && w.reloadT > 0) {
    const def = currentDef(f);
    if (def && def.reload > 0) {
      relP = 1 - w.reloadT / def.reload;
      relBump = Math.sin(Math.PI * clamp01(relP));
      magBump = Math.sin(Math.PI * clamp01((relP - 0.25) / 0.6));
    }
  }

  // --- the aim assembly -------------------------------------------------------
  const kick = f.recoil || 0;
  rig.aim.rotation.x = (-0.42 + (f.pitch + 0.42) * aimT) - 0.3 * relBump + kick * 0.55 +
    (channeling ? -0.12 : 0);
  rig.aim.rotation.z = 0.1 * (1 - aimT) + 0.3 * relBump;
  rig.aim.position.z = -0.03 + kick * 0.3;
  rig.gunParts.mag.position.y = -0.125 - 0.12 * Math.max(0, magBump);

  // Arms: the solved hold, bent by the two jobs that break it — the reload
  // (support hand leaves the forend for the magazine) and channel work
  // (both hands down at the charge).
  let lShX = HOLD.L.shX, lElX = HOLD.L.elX, rShX = HOLD.R.shX, rElX = HOLD.R.elX;
  if (relP >= 0) {
    lShX += (0.52 - HOLD.L.shX) * relBump;
    lElX += (1.25 - HOLD.L.elX) * relBump;
  }
  if (channeling) { lShX = 0.3; lElX = 0.42; rShX = 0.26; rElX = 0.5; }
  const ka = 1 - Math.exp(-16 * dt);
  rig.armL.sh.rotation.x += (lShX - rig.armL.sh.rotation.x) * ka;
  rig.armL.el.rotation.x += (lElX - rig.armL.el.rotation.x) * ka;
  rig.armR.sh.rotation.x += (rShX - rig.armR.sh.rotation.x) * ka;
  rig.armR.el.rotation.x += (rElX - rig.armR.el.rotation.x) * ka;
  rig.armL.sh.rotation.z = HOLD.L.shZ;
  rig.armR.sh.rotation.z = HOLD.R.shZ;
}

// Death: a 0.65-second smoothstep onto the back, limbs going slack, then
// the pose freezes — a corpse is never posed again.
function poseDeath(f, rig, dt) {
  const A = rig.anim;
  A.deathT = Math.min(1, A.deathT + dt / 0.65);
  const s = smooth(A.deathT);
  const g = rig.root;
  g.rotation.x = 1.45 * s;
  g.position.y = f.pos.y + 0.07 * s;
  rig.spine.rotation.x = -0.18 * s;
  rig.head.rotation.x = 0.38 * s;
  rig.hips.position.y = 0.94 - 0.1 * s;
  for (const [arm, hold] of [[rig.armL, HOLD.L], [rig.armR, HOLD.R]]) {
    arm.sh.rotation.x = hold.shX + (SLACK.shX - hold.shX) * s;
    arm.el.rotation.x = hold.elX + (SLACK.elX - hold.elX) * s;
  }
  rig.legL.thigh.rotation.x *= 1 - s;
  rig.legR.thigh.rotation.x *= 1 - s;
  rig.legL.shin.rotation.x *= 1 - s;
  rig.legR.shin.rotation.x *= 1 - s;
  if (A.deathT >= 1) A.deadFrozen = true;
}
