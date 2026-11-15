// state.js — the one store every module reads and writes.
//
// Nothing in the game keeps a private copy of match data: the phase clock,
// the bomb, both rosters and every combatant live here, so a round reset is
// a single function and the HUD can never disagree with the simulation.

export const TEAM = { ATK: 'atk', DEF: 'def' };

// Phase timings in seconds, and the shape of a match: sixteen rounds at
// most, sides swap after eight, first to nine takes it.
export const TIME = {
  freeze: 15,
  round: 100,
  bomb: 40,
  plant: 3.2,
  roundEnd: 5,
  matchEnd: 8,
};
export const ROUNDS_MAX = 16;
export const ROUNDS_HALF = 8;
export const ROUNDS_TO_WIN = 9;

// CS-style money. Awards land in rounds.js; prices live in weapons.js.
export const MONEY = {
  start: 800,
  cap: 16000,
  kill: 300,
  winElimination: 3250,
  winObjective: 3500, // detonation, or a purge for the Curators
  planterBonus: 300,
  lossBase: 1400,
  lossStep: 500,
  lossMax: 2900,
};

export const S = {
  time: 0, // seconds of simulation since boot; the one clock effects read
  phase: 'menu', // menu | freeze | live | planted | roundover | matchover
  phaseT: 0, // seconds left in the current phase
  round: 0,
  half: 1,
  score: { atk: 0, def: 0 },
  lossStreak: { atk: 0, def: 0 },
  lastRoundWinner: null,
  players: [], // every combatant, the human first (see fighters below)
  human: null,
  bomb: {
    state: 'carried', // carried | dropped | planted | exploding | done
    carrier: null,
    pos: { x: 0, y: 0, z: 0 },
    site: null, // 'A' | 'B' once planted
    planter: null,
  },
  glassBroken: 0, // panes broken this round (map.js breakGlass counts)
  sealPct: 100, // Dome Seal Pressure: max(60, 100 - 40 * broken/total)
  noises: [], // {x, z, radius, team, kind} heard this step, drained by bots
  feed: [], // kill-feed lines waiting for the HUD
  banner: null, // {title, sub} the HUD shows until replaced
  shake: 0, // camera shake impulse, decays in the render loop
  rng: null, // seeded in main.js so ?shot= scenes are reproducible
  seed: 1,
  shot: null, // ?shot=<mode> capture mode, or null in a normal game
  over: null, // {winner, atk, def} once the match is decided
};

// A combatant. One shape for the human and the nine bots; `bot` carries the
// AI's working memory for bot fighters and stays null for the human.
export function makeFighter(team, name, isHuman) {
  return {
    team, name, isHuman,
    pos: { x: 0, y: 0, z: 0 }, // feet position; y is the floor height
    vel: { x: 0, z: 0 },
    vy: 0,
    yaw: 0, pitch: 0,
    crouch: false, onGround: true,
    hp: 100, armor: 0, helmet: false, alive: true,
    money: MONEY.start,
    kills: 0, deaths: 0, assists: 0,
    weapons: null, // filled by weapons.newLoadout
    hasKit: false,
    speedNow: 0, // metres per second, for spread and footsteps
    lastDamageFrom: null, // fighter, for the damage-direction arrow
    lastDamageAt: -9,
    visible: new Set(), // opponents this fighter can currently see (bots)
    bot: null,
  };
}

export function aliveOf(team) {
  return S.players.filter((p) => p.team === team && p.alive);
}

export function otherTeam(team) {
  return team === TEAM.ATK ? TEAM.DEF : TEAM.ATK;
}

// mulberry32: small, fast, and good enough that a fixed seed rebuilds the
// same match for screenshots.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rand(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}
