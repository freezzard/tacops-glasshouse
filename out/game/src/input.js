// input.js — keyboard and mouse, gathered in one place.
//
// The simulation polls this module each step: held keys by code, mouse
// travel accumulated since the last step, and an edge set of keys pressed
// since the last step (for one-shot actions like buying or planting).

export const input = {
  keys: Object.create(null),
  pressed: new Set(),
  dx: 0,
  dy: 0,
  firing: false,
  aiming: false, // right mouse held: the sniper's scope
  locked: false,
};

let canvas = null;
let onLockLost = null;

export function initInput(el, lockLost) {
  canvas = el;
  onLockLost = lockLost;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (!e.repeat) input.pressed.add(e.code);
    input.keys[e.code] = true;
  });
  window.addEventListener('keyup', (e) => { input.keys[e.code] = false; });
  window.addEventListener('blur', () => {
    input.keys = Object.create(null);
    input.firing = false;
    input.aiming = false;
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) {
      input.firing = false;
      input.aiming = false;
      if (onLockLost) onLockLost();
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.dx += e.movementX;
    input.dy += e.movementY;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!input.locked) return;
    if (e.button === 0) input.firing = true;
    if (e.button === 2) input.aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function lockPointer() {
  if (canvas && !input.locked) canvas.requestPointerLock();
}

// True once per physical press; the step that asks first consumes it.
export function takePress(code) {
  if (!input.pressed.has(code)) return false;
  input.pressed.delete(code);
  return true;
}

export function held(...codes) {
  return codes.some((c) => input.keys[c]);
}

// Mouse travel since the last call, for the step that turns the camera.
export function takeMouse() {
  const out = { dx: input.dx, dy: input.dy };
  input.dx = 0;
  input.dy = 0;
  return out;
}
