// player.js — the human: mouse look, acceleration movement, gun handling,
// footsteps, and the viewmodel that rides the camera.
//
// Movement is velocity-based with a strong ground acceleration and a weak
// air one, so counter-strafing works: let go of the key and you stop dead
// inside a step or two, which is exactly when your spread collapses.

import * as THREE from 'three';
import { S } from './state.js';
import { input, takeMouse, takePress, held } from './input.js';
import { JUMP_VEL, eyeHeight } from './physics.js';
import { currentDef, currentWeaponId, switchTo } from './weapons.js';
import { tryFire, startReload } from './combat.js';
import * as AU from './audio.js';

let prevFiring = false;
let prevSlot = 'sidearm';
let stepAcc = 0;
let vm = null; // viewmodel group
let vmParts = {};
let bobPhase = 0;

export function stepPlayer(dt) {
  const f = S.human;
  if (!f.alive) { input.firing = false; return; }
  const phase = S.phase;
  const canAct = phase === 'live' || phase === 'planted' || phase === 'freeze';

  // Look.
  const m = takeMouse();
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

function buildViewmodel() {
  vm = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2e3236, roughness: 0.4, metalness: 0.55 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0x8a6d2f, roughness: 0.5, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.15, 0.52), mat);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), mat);
  barrel.position.set(0, 0.035, -0.4);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.09), matAccent);
  mag.position.set(0, -0.13, -0.05);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), mat);
  sight.position.set(0, 0.1, -0.12);
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.2), matAccent);
  pump.position.set(0, -0.04, -0.3);
  vm.add(body, barrel, mag, sight, pump);
  vmParts = { body, barrel, mag, sight, pump };
  vm.position.set(0.24, -0.22, -0.45);
  return vm;
}

export function initViewmodel(camera) {
  camera.add(buildViewmodel());
}

// Places the gun each rendered frame: bob from strides, sway from the last
// mouse move, a dip while reloading or drawing, and a kick when a shot's
// recoil is still unwinding.
export function syncViewmodel(f, dt) {
  if (!vm) return;
  const w = f.weapons;
  const id = currentWeaponId(f);
  if (!f.alive || !id) { vm.visible = false; return; }
  vm.visible = true;
  const isGun = id !== 'knife' && id !== 'frag' && id !== 'smoke';
  vmParts.barrel.visible = isGun;
  vmParts.mag.visible = isGun && id !== 'shotgun';
  vmParts.pump.visible = id === 'shotgun';
  vmParts.sight.visible = isGun;
  vmParts.body.scale.z = id === 'sniper' ? 1.35 : id === 'smg' ? 0.8 : id === 'pistol' ? 0.55 : 1;
  vmParts.body.visible = id !== 'frag' && id !== 'smoke';
  bobPhase += f.speedNow * dt * 1.9;
  const bob = Math.min(1, f.speedNow / 4) * 0.016;
  const dip = w.reloadT > 0 ? 0.09 : w.drawT > 0 ? w.drawT * 0.3 : 0;
  vm.position.x = 0.24 + Math.sin(bobPhase * 0.5) * bob * 0.5;
  vm.position.y = -0.22 + Math.abs(Math.cos(bobPhase * 0.5)) * bob - dip;
  vm.position.z = -0.45 + (f.recoil || 0) * 1.4;
  vm.rotation.x = (w.reloadT > 0 ? 0.5 : 0) + (f.recoil || 0) * 1.1;
  vm.rotation.z = f.scoped ? 0 : Math.sin(bobPhase * 0.5) * bob * 0.4;
  if (f.scoped) { vm.position.x = 0; vm.position.y = -0.148; vm.position.z = -0.3; }
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
