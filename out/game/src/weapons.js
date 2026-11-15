// weapons.js — the armoury: six guns, a knife, two grenades, and the
// numbers that make them feel different.
//
// Accuracy is the game's thesis: every gun has a base spread that blooms as
// you hold the trigger and multiplies while you move, so the player who
// stops, crouches and taps beats the player who sprays on the run. Damage
// falls off with range, and heads pay a multiplier.

export const WEAPONS = {
  knife: {
    name: 'Field Knife', slot: 'melee', price: 0, damage: 55, headMult: 1,
    rpm: 130, mag: 0, reserve: 0, reload: 0, melee: 1.9,
    falloffFrom: 0, falloffTo: 1, falloffMin: 1, spread: 0, bloom: 0,
    recoil: 0, auto: false, pellets: 0, moveSpeed: 5.6, noise: 2, sound: 'knife',
  },
  pistol: {
    name: 'Sparrow P9', slot: 'sidearm', price: 0, damage: 27, headMult: 3,
    rpm: 340, mag: 12, reserve: 60, reload: 1.5,
    falloffFrom: 16, falloffTo: 38, falloffMin: 0.55, spread: 0.010, bloom: 0.006,
    recoil: 0.011, auto: false, pellets: 1, moveSpeed: 5.3, noise: 30, sound: 'pistol',
  },
  smg: {
    name: 'Vole-9', slot: 'primary', price: 1500, damage: 21, headMult: 2.5,
    rpm: 820, mag: 32, reserve: 128, reload: 2.1,
    falloffFrom: 12, falloffTo: 30, falloffMin: 0.45, spread: 0.021, bloom: 0.004,
    recoil: 0.006, auto: true, pellets: 1, moveSpeed: 5.5, noise: 34, sound: 'smg',
  },
  shotgun: {
    name: 'Breach-8', slot: 'primary', price: 1800, damage: 9, headMult: 2,
    rpm: 68, mag: 6, reserve: 30, reload: 3.1,
    falloffFrom: 6, falloffTo: 18, falloffMin: 0.25, spread: 0.052, bloom: 0.01,
    recoil: 0.05, auto: false, pellets: 8, moveSpeed: 5.1, noise: 38, sound: 'shotgun',
  },
  rifle: {
    name: 'Thorn RK', slot: 'primary', price: 2700, damage: 34, headMult: 3.2,
    rpm: 600, mag: 30, reserve: 90, reload: 2.4,
    falloffFrom: 24, falloffTo: 55, falloffMin: 0.6, spread: 0.0075, bloom: 0.005,
    recoil: 0.014, auto: true, pellets: 1, moveSpeed: 5.0, noise: 42, sound: 'rifle',
  },
  sniper: {
    name: 'Longbow', slot: 'primary', price: 4750, damage: 97, headMult: 2,
    rpm: 38, mag: 5, reserve: 20, reload: 3.0,
    falloffFrom: 40, falloffTo: 90, falloffMin: 0.9, spread: 0.0012, bloom: 0.01,
    recoil: 0.06, auto: false, pellets: 1, moveSpeed: 4.8, noise: 48, sound: 'sniper',
    scopedSpread: 0.0012, hipSpread: 0.055,
  },
};

// Gear sold beside the guns. Helmet only counts with a vest under it.
export const GEAR = {
  armor: { name: 'Kevlar Vest', price: 650 },
  helmet: { name: 'Vest + Helmet', price: 1000 },
  kit: { name: 'Defuse Kit', price: 200 },
  frag: { name: 'Frag Grenade', price: 300 },
  smoke: { name: 'Smoke Grenade', price: 300 },
};

export const BUY_ORDER = ['rifle', 'smg', 'shotgun', 'sniper', 'armor', 'helmet', 'frag', 'smoke', 'kit'];

// A fighter's hands. Ammo is tracked per gun; switching is instant to draw
// but the draw timer still gates the next shot, as it should.
export function newLoadout() {
  return {
    primary: null,
    sidearm: 'pistol',
    melee: 'knife',
    grenades: { frag: 0, smoke: 0 },
    ammo: { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } },
    current: 'sidearm', // 'primary' | 'sidearm' | 'melee' | 'frag' | 'smoke'
    fireT: 0, // seconds until the trigger works again
    reloadT: 0,
    drawT: 0,
    bloom: 0, // accumulated spread from sustained fire
  };
}

export function currentWeaponId(f) {
  const w = f.weapons;
  if (w.current === 'primary') return w.primary;
  if (w.current === 'sidearm') return w.sidearm;
  if (w.current === 'melee') return w.melee;
  return w.current; // 'frag' | 'smoke': the grenade in hand
}

export function currentDef(f) {
  const id = currentWeaponId(f);
  return id ? WEAPONS[id] : null;
}

export function giveWeapon(f, id) {
  const def = WEAPONS[id];
  f.weapons.primary = id;
  f.weapons.ammo[id] = { mag: def.mag, reserve: def.reserve };
}

export function switchTo(f, slot) {
  const w = f.weapons;
  if (slot === 'primary' && !w.primary) return false;
  if ((slot === 'frag' || slot === 'smoke') && w.grenades[slot] <= 0) return false;
  if (w.current === slot) return true;
  w.current = slot;
  w.reloadT = 0;
  w.drawT = 0.28;
  w.bloom = 0;
  return true;
}

// Damage after range falloff, before the head multiplier and armour.
export function damageAt(def, dist) {
  if (dist <= def.falloffFrom) return def.damage;
  if (dist >= def.falloffTo) return def.damage * def.falloffMin;
  const t = (dist - def.falloffFrom) / (def.falloffTo - def.falloffFrom);
  return def.damage * (1 - t * (1 - def.falloffMin));
}

// Total spread in radians for this fighter holding this gun right now.
export function spreadFor(f, def) {
  let base = def.spread;
  if (def === WEAPONS.sniper) base = f.scoped ? def.scopedSpread : def.hipSpread;
  let s = base + f.weapons.bloom;
  const move = f.speedNow / 5.0;
  s *= 1 + move * 2.6; // running triples a rifle's cone
  if (!f.onGround) s *= 3;
  if (f.crouch) s *= 0.72;
  if (f.scoped) s *= 0.5;
  return s;
}
