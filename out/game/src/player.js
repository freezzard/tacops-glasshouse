// player.js — the human: mouse look, acceleration movement, gun handling,
// footsteps, and the viewmodel that rides the camera.
//
// Movement is velocity-based with a strong ground acceleration and a weak
// air one, so counter-strafing works: let go of the key and you stop dead
// inside a step or two, which is exactly when your spread collapses.

import { S } from './state.js';
import { input, takeMouse, takePress, held } from './input.js';
import { JUMP_VEL, eyeHeight } from './physics.js';
import { currentDef, currentWeaponId, switchTo } from './weapons.js';
import { tryFire, startReload } from './combat.js';
import { buildViewmodel, setWeaponLook } from './models.js';
import * as AU from './audio.js';

let prevFiring = false;
let prevSlot = 'sidearm';
let stepAcc = 0;
let vm = null; // viewmodel group
let vmParts = {};
let bobPhase = 0;
let swayDX = 0, swayDY = 0; // raw mouse travel since the last rendered frame

export function stepPlayer(dt) {
  const f = S.human;
  if (!f.alive) { input.firing = false; return; }
  const phase = S.phase;
  const canAct = phase === 'live' || phase === 'planted' || phase === 'freeze';

  // Look.
  const m = takeMouse();
  swayDX += m.dx; swayDY += m.dy; // the viewmodel trails this in syncViewmodel
  const sens = f.scoped ? 0.0009 : 0.0021;
  f.yaw -= m.dx * sens;
  f.pitch -= m.dy * sens;
  f.pitch = Math.max(-1.45, Math.min(1.45, f.pitch));

  if (!canAct || phase === 'freeze') { f.vel.x = 0; f.vel.z = 0; return; }

  // Move: wish direction in world space from the camera yaw.
  const fw = (held('KeyW') ? 1 : 0) - (held('KeyS') ? 1 : 0);
  const st = (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0);
  const sin = Math.sin(f.yaw), cos = Math.cos(f.yaw);
  let wx = (-sin * fw + cos * st);
  let wz = (-cos * fw - sin * st);
  const wl = Math.hypot(wx, wz) || 1;
  wx /= wl; wz /= wl;
  if (!fw && !st) { wx = 0; wz = 0; }
  f.crouch = held('ControlLeft', 'ControlRight', 'KeyC');
  const walking = held('ShiftLeft', 'ShiftRight');
  const def = currentDef(f);
  let speed = def ? def.moveSpeed : 5.2;
  if (walking) speed *= 0.45;
  if (f.crouch) speed *= 0.52;
  if (f.scoped) speed *= 0.45;
  const accel = f.onGround ? 34 : 4.5;
  f.vel.x += Math.max(-accel * dt, Math.min(accel * dt, wx * speed - f.vel.x));
  f.vel.z += Math.max(-accel * dt, Math.min(accel * dt, wz * speed - f.vel.z));

  if (takePress('Space') && f.onGround && !f.crouch) {
    f.vy = JUMP_VEL;
    f.onGround = false;
    AU.jumpSound(0);
  }

  // Footsteps: a stride every couple of metres, audible to the bots when
  // you run, near-silent when you walk or crouch.
  stepAcc += f.speedNow * dt;
  const stride = f.crouch ? 3.4 : 2.3;
  if (stepAcc > stride && f.onGround) {
    stepAcc = 0;
    const quiet = walking || f.crouch || f.speedNow < 2.2;
    AU.stepSound(0, !quiet);
    if (!quiet) S.noises.push({ x: f.pos.x, z: f.pos.z, radius: 8.5, team: f.team, kind: 'step' });
  }

  // Weapons. Number keys switch directly; Q swaps back to the slot held
  // before the current one, the way a dropped-back pistol should feel.
  f.scoped = input.aiming && currentWeaponId(f) === 'sniper' && f.weapons.current === 'primary';
  if (takePress('KeyR')) startReload(f);
  const slotBefore = f.weapons.current;
  let switched = false;
  if (!S.buyOpen) {
    // While the buy menu is up, the number keys belong to the shop.
    if (takePress('Digit1')) switched = switchTo(f, 'primary');
    else if (takePress('Digit2')) switched = switchTo(f, 'sidearm');
    else if (takePress('Digit3')) switched = switchTo(f, 'melee');
    else if (takePress('Digit4')) switched = switchTo(f, 'frag') || switchTo(f, 'smoke');
    if (switched) prevSlot = slotBefore;
    if (takePress('KeyQ') && switchTo(f, prevSlot)) prevSlot = slotBefore;
  }
  if (phase === 'live' || phase === 'planted') {
    const defNow = currentDef(f);
    if (input.firing) {
      if (defNow && defNow.auto) tryFire(f);
      else if (!prevFiring) tryFire(f);
    }
  }
  prevFiring = input.firing;

  // E is the interact key: rounds.js reads this while it is held.
  f.interact = held('KeyE');
}

// ---------- viewmodel ----------

// The viewmodel is models.js work — the fighter's own arms and gun, in his
// team's sleeves. This file only poses it: a distance-driven bob, mouse
// sway on a spring, a recoil spring the shots kick, a sprint carry, an
// aim-down-sights glide, and a reload in which the support hand takes the
// magazine out and seats it again on weapons.js's own timings.
let vmTeam = null;
let swayYaw = 0, swayPitch = 0; // mouse delta captured by stepPlayer
let adsT = 0, sprintT = 0;
let kickX = 0, kickV = 0, prevRecoil = 0;

export function initViewmodel(camera) {
  const built = buildViewmodel(S.human.team);
  vm = built.group;
  vmParts = built.parts;
  vmTeam = S.human.team;
  vm.position.set(0.24, -0.22, -0.45);
  camera.add(vm);
}

const clampN = (v, n) => Math.max(-n, Math.min(n, v));

export function syncViewmodel(f, dt) {
  if (!vm) return;
  const w = f.weapons;
  const id = currentWeaponId(f);
  if (!f.alive || !id || S.phase === 'menu' || S.phase === 'matchover') { vm.visible = false; return; }
  vm.visible = true;
  if (f.team !== vmTeam) { // halftime swap: the sleeves change sides too
    vmTeam = f.team;
    const suit = vmParts.teamMats[f.team].suit;
    for (const s of vmParts.sleeves) s.material = suit;
  }
  if (id !== syncViewmodel._id) { syncViewmodel._id = id; setWeaponLook(vmParts.gunParts, id); }

  // Distance-driven bob, dying away as the sights come up.
  bobPhase += f.speedNow * dt * 3.4;
  const adsGoal = f.scoped ? 1 : input.aiming ? 0.55 : 0;
  adsT += (adsGoal - adsT) * (1 - Math.exp(-16 * dt));
  const bobAmp = Math.min(1, f.speedNow / 4.5) * (1 - 0.9 * adsT);
  const bobX = 0.009 * Math.sin(bobPhase) * bobAmp;
  const bobY = 0.01 * Math.abs(Math.sin(bobPhase)) * bobAmp;

  // Mouse sway: the gun trails the look by a few hundredths of a radian.
  swayYaw = clampN(swayYaw * Math.exp(-11 * dt) + clampN(swayDX, 60) * 0.00045, 0.035);
  swayPitch = clampN(swayPitch * Math.exp(-11 * dt) + clampN(swayDY, 60) * 0.00045, 0.03);
  swayDX = 0; swayDY = 0;

  // Recoil spring: combat only reports f.recoil; a fresh rise means a shot
  // was fired, and the spring turns it into a kick that settles.
  const rec = f.recoil || 0;
  if (rec > prevRecoil + 0.002) kickV += 2.1;
  prevRecoil = rec;
  kickV += (-130 * kickX - 20 * kickV) * dt;
  kickX += kickV * dt;

  // Sprint carry: gun canted and low while running with no shot in flight.
  const sprintGoal = f.speedNow > 4.4 && !input.firing && !input.aiming &&
    w.reloadT <= 0 && rec < 0.01 && f.onGround ? 1 : 0;
  sprintT += (sprintGoal - sprintT) * (1 - Math.exp(-9 * dt));

  // Reload, on the weapon's own clock: tilt, support hand down with the
  // magazine, both back by the end.
  let relBump = 0, magBump = 0;
  if (w.reloadT > 0) {
    const def = currentDef(f);
    if (def && def.reload > 0) {
      const p = 1 - w.reloadT / def.reload;
      relBump = Math.sin(Math.PI * Math.max(0, Math.min(1, p)));
      magBump = Math.sin(Math.PI * Math.max(0, Math.min(1, (p - 0.25) / 0.6)));
    }
  }
  const dip = w.drawT > 0 ? w.drawT * 0.3 : 0;
  vmParts.gunParts.mag.position.y = -0.125 - 0.13 * Math.max(0, magBump);
  vmParts.armL.position.y = -0.14 - 0.11 * relBump;
  vmParts.armL.position.z = -0.34 + 0.05 * relBump;
  vmParts.armL.rotation.x = -0.3 * relBump;

  const hipX = 0.24, hipY = -0.22, hipZ = -0.45;
  const adsX = 0, adsY = -0.148, adsZ = -0.3;
  vm.position.x = hipX + (adsX - hipX) * adsT + bobX - swayYaw * 1.4 - sprintT * 0.07;
  vm.position.y = hipY + (adsY - hipY) * adsT + bobY - dip - relBump * 0.05 - sprintT * 0.02;
  vm.position.z = hipZ + (adsZ - hipZ) * adsT + kickX * 0.05 + rec * 0.9;
  vm.rotation.x = kickX * 0.55 + rec * 0.8 + relBump * 0.38 - sprintT * 0.22 - swayPitch * 1.2;
  vm.rotation.y = -swayYaw * 1.6 - sprintT * 0.55;
  vm.rotation.z = Math.sin(bobPhase) * 0.012 * bobAmp + sprintT * 0.3;
}

// Where the camera sits this frame, including recoil and shake. Spectating
// after death rides on the first living teammate's shoulder.
export function cameraPose(f, out) {
  if (f.alive) {
    out.x = f.pos.x;
    out.y = f.pos.y + eyeHeight(f);
    out.z = f.pos.z;
    out.yaw = f.yaw;
    out.pitch = f.pitch + (f.recoil || 0);
    return out;
  }
  const mate = S.players.find((p) => p.team === f.team && p.alive);
  if (mate) {
    out.x = mate.pos.x;
    out.y = mate.pos.y + eyeHeight(mate);
    out.z = mate.pos.z;
    out.yaw = mate.yaw;
    out.pitch = mate.pitch;
  } else {
    out.x = f.pos.x; out.y = f.pos.y + 6; out.z = f.pos.z + 6;
    out.yaw = f.yaw; out.pitch = -0.7;
  }
  return out;
}
