// rounds.js — the match director: roster, phases, the bomb, the economy.
//
// One step does everything in a fixed order — combat timers, then the
// fighters think and move, then the bomb channels and win checks read the
// world the step produced. Round wins pay the side, loss bonuses climb a
// streak, and at the half the rosters swap ends and start poor again.

import { S, TEAM, TIME, MONEY, ROUNDS_HALF, ROUNDS_MAX, ROUNDS_TO_WIN, makeFighter, aliveOf, otherTeam, rand, pick } from './state.js';
import { TEAM_NAME, SITE_NAME } from './palette.js';
import { WORLD, resetGlass, siteAt } from './map.js';
import { moveFighter, dist2d } from './physics.js';
import { WEAPONS, GEAR, newLoadout, giveWeapon, switchTo } from './weapons.js';
import { stepPlayer } from './player.js';
import { BOT_NAMES, newBrain, botBuy, stepBot, pathTo } from './bots.js';
import { updateCombat, spawnParticles, applyDamage } from './combat.js';
import * as AU from './audio.js';

let plantProgress = 0;
let plantAnnounced = false;
let defuseProgress = 0;
let defuser = null;
let beepAt = 0;
let swapped = false;

export function createRoster() {
  S.players = [];
  const human = makeFighter(TEAM.ATK, 'You', true);
  S.human = human;
  S.players.push(human);
  for (const name of BOT_NAMES.atk) S.players.push(makeFighter(TEAM.ATK, name, false));
  for (const name of BOT_NAMES.def) S.players.push(makeFighter(TEAM.DEF, name, false));
  for (const f of S.players) {
    f.weapons = newLoadout();
    if (!f.isHuman) f.bot = newBrain('flex', 'A');
  }
  S.onKill = (attacker, target) => {
    const helper = target.lastDamageFrom;
    if (helper && attacker && helper !== attacker && helper.team === attacker.team && S.time - target.lastDamageAt < 4) {
      helper.assists++;
    }
  };
}

function nodeAt(x, z) {
  let best = -1, bd = Infinity;
  WORLD.nodes.forEach((n, i) => {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return WORLD.nodes[best];
}

function freshRoundFighter(f, spawn) {
  f.pos.x = spawn.x + rand(S.rng, -0.4, 0.4);
  f.pos.z = spawn.z + rand(S.rng, -0.4, 0.4);
  f.pos.y = 0;
  f.vel.x = 0; f.vel.z = 0; f.vy = 0;
  f.yaw = spawn.yaw;
  f.pitch = 0;
  f.crouch = false;
  f.scoped = false;
  f.hp = 100;
  f.alive = true;
  f.interact = false;
  if (!f.survived) {
    // Death last round costs the guns and the vest; survival keeps both.
    const money = f.money;
    f.weapons = newLoadout();
    f.money = money;
    f.armor = 0;
    f.helmet = false;
    f.hasKit = false;
  }
  f.survived = false;
}

export function resetMatch() {
  S.score.atk = 0;
  S.score.def = 0;
  S.lossStreak.atk = 0;
  S.lossStreak.def = 0;
  S.round = 0;
  S.half = 1;
  S.over = null;
  swapped = false;
  for (const f of S.players) {
    f.money = MONEY.start;
    f.kills = 0; f.deaths = 0; f.assists = 0;
    f.survived = false;
  }
  startRound();
}

function swapSides() {
  for (const f of S.players) {
    f.team = otherTeam(f.team);
    f.money = MONEY.start;
    f.weapons = newLoadout();
    f.armor = 0;
    f.helmet = false;
    f.hasKit = false;
    f.survived = false;
  }
  S.lossStreak.atk = 0;
  S.lossStreak.def = 0;
  if (S.rebuildBodies) S.rebuildBodies();
}

export function startRound() {
  S.round++;
  if (S.round === ROUNDS_HALF + 1 && !swapped) {
    swapped = true;
    S.half = 2;
    swapSides();
  }
  resetGlass();
  plantProgress = 0;
  plantAnnounced = false;
  defuseProgress = 0;
  defuser = null;
  S.feed.length = 0;
  S.channel = null;

  const atkSpawns = WORLD.spawns.atk;
  const defSpawns = WORLD.spawns.def;
  let ai = 0, di = 0;
  for (const f of S.players) {
    freshRoundFighter(f, f.team === TEAM.ATK ? atkSpawns[ai++ % atkSpawns.length] : defSpawns[di++ % defSpawns.length]);
  }
  // The charge goes to the human when they attack, else to a Raider bot.
  const attackers = S.players.filter((p) => p.team === TEAM.ATK);
  S.bomb.carrier = S.human.team === TEAM.ATK ? S.human : pick(S.rng, attackers.filter((p) => !p.isHuman));
  S.bomb.state = 'carried';
  S.bomb.site = null;
  S.bomb.planter = null;

  planBots();
  for (const f of S.players) if (!f.isHuman) botBuy(f);
  S.phase = 'freeze';
  S.phaseT = TIME.freeze;
  S.buyOpen = true;
  S.banner = {
    title: `Round ${S.round}`,
    sub: S.human.team === TEAM.ATK
      ? (S.bomb.carrier === S.human ? 'You have the charge — plant it at a site. B buys.' : 'Escort the charge to a site. B buys.')
      : 'Hold the sites. B buys.',
  };
}

function planBots() {
  const site = S.rng() < 0.55 ? 'A' : 'B';
  const other = site === 'A' ? 'B' : 'A';
  const S_ = WORLD.sites[site];
  const O_ = WORLD.sites[other];
  let atkBots = S.players.filter((p) => !p.isHuman && p.team === TEAM.ATK);
  let defBots = S.players.filter((p) => !p.isHuman && p.team === TEAM.DEF);
  // Raiders: the carrier plants, two enter with them, one lurks wide.
  atkBots.forEach((f, i) => {
    const b = f.bot;
    b.sitePref = site;
    b.careful = false;
    if (S.bomb.carrier === f) {
      b.state = 'advance'; b.afterAdvance = 'plant';
      pathTo(f, S_.x, S_.z);
    } else if (i === atkBots.length - 1) {
      b.state = 'advance'; b.afterAdvance = 'hold';
      pathTo(f, O_.x, O_.z);
    } else {
      b.state = 'advance'; b.afterAdvance = 'hold';
      pathTo(f, S_.x + rand(S.rng, -2.5, 2.5), S_.z + rand(S.rng, -2.5, 2.5));
    }
  });
  // Wardens: two hold each site, the fifth prowls the dome ring.
  defBots.forEach((f, i) => {
    const b = f.bot;
    b.afterAdvance = 'hold';
    b.state = 'advance';
    b.careful = true;
    if (i < 2) { b.sitePref = 'A'; pathTo(f, WORLD.sites.A.x + (i ? 4 : -3), WORLD.sites.A.z + (i ? 3 : -3)); }
    else if (i < 4) { b.sitePref = 'B'; pathTo(f, WORLD.sites.B.x + (i % 2 ? 4 : -3), WORLD.sites.B.z + (i % 2 ? -3 : 3)); }
    else { b.sitePref = 'A'; pathTo(f, 4.2, 0); }
  });
}

function planRetake() {
  const site = WORLD.sites[S.bomb.site];
  let sent = 0;
  for (const f of S.players) {
    if (f.isHuman || !f.alive || f.team !== TEAM.DEF) continue;
    f.bot.state = 'advance';
    f.bot.careful = false;
    if (sent === 0) { f.bot.afterAdvance = 'defuse'; sent++; }
    else f.bot.afterAdvance = 'hold';
    pathTo(f, site.x + rand(S.rng, -2, 2), site.z + rand(S.rng, -2, 2));
  }
  for (const f of S.players) {
    if (f.isHuman || !f.alive || f.team !== TEAM.ATK) continue;
    f.bot.state = 'advance';
    f.bot.afterAdvance = 'hold';
    pathTo(f, site.x + rand(S.rng, -4, 4), site.z + rand(S.rng, -4, 4));
  }
}

// ---------- the shop ----------

export function buyItem(f, id) {
  if (S.phase !== 'freeze') return false;
  const w = f.weapons;
  if (WEAPONS[id]) {
    const def = WEAPONS[id];
    if (w.primary === id || f.money < def.price) { AU.deniedSound(); return false; }
    f.money -= def.price;
    giveWeapon(f, id);
    switchTo(f, 'primary');
  } else if (id === 'armor') {
    if (f.armor >= 100 || f.money < GEAR.armor.price) { AU.deniedSound(); return false; }
    f.money -= GEAR.armor.price;
    f.armor = 100;
  } else if (id === 'helmet') {
    if (f.helmet || f.armor <= 0 || f.money < GEAR.helmet.price - GEAR.armor.price) { AU.deniedSound(); return false; }
    f.money -= GEAR.helmet.price - GEAR.armor.price;
    f.helmet = true;
  } else if (id === 'kit') {
    if (f.hasKit || f.team !== TEAM.DEF || f.money < GEAR.kit.price) { AU.deniedSound(); return false; }
    f.money -= GEAR.kit.price;
    f.hasKit = true;
  } else if (id === 'frag' || id === 'smoke') {
    if (w.grenades[id] >= 1 || f.money < GEAR[id].price) { AU.deniedSound(); return false; }
    f.money -= GEAR[id].price;
    w.grenades[id]++;
  } else return false;
  AU.buySound();
  return true;
}

// ---------- the step ----------

export function step(dt) {
  S.time += dt;
  updateCombat(dt);
  S.botPlanting = null;
  S.botDefusing = null;
  S.channel = null;

  if (S.phase === 'freeze' || S.phase === 'live' || S.phase === 'planted' || S.phase === 'roundover') {
    stepPlayer(dt);
    for (const f of S.players) if (!f.isHuman) stepBot(f, dt);
    for (const f of S.players) if (f.alive) moveFighter(f, dt);
  }

  switch (S.phase) {
    case 'freeze':
      S.phaseT -= dt;
      if (S.phaseT <= 0) {
        S.phase = 'live';
        S.phaseT = TIME.round;
        S.buyOpen = false;
        S.banner = null;
      }
      break;
    case 'live': stepLive(dt); break;
    case 'planted': stepPlanted(dt); break;
    case 'roundover':
      S.phaseT -= dt;
      if (S.phaseT <= 0) {
        if (S.score.atk >= ROUNDS_TO_WIN || S.score.def >= ROUNDS_TO_WIN || S.round >= ROUNDS_MAX) {
          S.phase = 'matchover';
          S.phaseT = TIME.matchEnd;
          S.over = { winner: S.score.atk === S.score.def ? TEAM.DEF : (S.score.atk > S.score.def ? TEAM.ATK : TEAM.DEF) };
        } else {
          startRound();
        }
      }
      break;
  }
  S.noises.length = 0;
}

function stepLive(dt) {
  S.phaseT -= dt;
  // Elimination ends it at once.
  if (aliveOf(TEAM.ATK).length === 0) return endRound(TEAM.DEF, 'elimination');
  if (aliveOf(TEAM.DEF).length === 0) return endRound(TEAM.ATK, 'elimination');

  // A dropped charge waits for a Raider to walk over it.
  if (S.bomb.state === 'dropped') {
    for (const f of S.players) {
      if (f.alive && f.team === TEAM.ATK && dist2d(f.pos, S.bomb.pos) < 1.5) {
        S.bomb.carrier = f;
        S.bomb.state = 'carried';
        if (!f.isHuman) { f.bot.state = 'advance'; f.bot.afterAdvance = 'plant'; f.bot.sitePref = f.bot.sitePref || 'A'; pathTo(f, WORLD.sites[f.bot.sitePref].x, WORLD.sites[f.bot.sitePref].z); }
        break;
      }
    }
  }
  // The plant channel: carrier still, on a site, holding the action.
  const c = S.bomb.carrier;
  if (S.bomb.state === 'carried' && c && c.alive) {
    const at = siteAt(c.pos.x, c.pos.z);
    const holding = c.isHuman ? c.interact && c.speedNow < 1 : S.botPlanting === c;
    if (at && holding) {
      if (!plantAnnounced) { plantAnnounced = true; AU.plantStartSound(); }
      plantProgress += dt;
      S.channel = { label: 'Planting the charge', frac: plantProgress / TIME.plant };
      if (plantProgress >= TIME.plant) return plantBomb(c, at);
    } else {
      plantProgress = Math.max(0, plantProgress - dt * 2);
    }
  }
  if (S.phaseT <= 0) endRound(TEAM.DEF, 'time');
}

function plantBomb(c, at) {
  S.bomb.state = 'planted';
  S.bomb.site = at;
  S.bomb.planter = c;
  S.bomb.pos = { x: c.pos.x, y: c.pos.y, z: c.pos.z };
  S.bomb.carrier = null;
  c.money = Math.min(MONEY.cap, c.money + MONEY.planterBonus);
  S.phase = 'planted';
  S.phaseT = TIME.bomb;
  beepAt = S.time + 1;
  S.noises.push({ x: S.bomb.pos.x, z: S.bomb.pos.z, radius: 70, team: TEAM.ATK, kind: 'plant' });
  S.banner = { title: 'The charge is planted', sub: `${SITE_NAME[at]} — ${TIME.bomb} seconds.` };
  AU.plantBeep(false);
  planRetake();
}

function stepPlanted(dt) {
  S.phaseT -= dt;
  if (aliveOf(TEAM.DEF).length === 0) return endRound(TEAM.ATK, 'elimination');
  // The beeper quickens as the timer runs down.
  if (S.time >= beepAt) {
    AU.plantBeep(false);
    beepAt = S.time + (S.phaseT > 20 ? 1 : S.phaseT > 10 ? 0.5 : 0.25);
  }
  // The defuse channel: a Warden at the charge, holding the action.
  let channeling = null;
  for (const f of S.players) {
    if (!f.alive || f.team !== TEAM.DEF) continue;
    const holding = f.isHuman ? f.interact : S.botDefusing === f;
    if (holding && dist2d(f.pos, S.bomb.pos) < 1.7) { channeling = f; break; }
  }
  if (channeling) {
    if (defuser !== channeling) { defuser = channeling; defuseProgress = 0; AU.defuseSound(); }
    defuseProgress += dt;
    const need = channeling.hasKit ? 5 : 10;
    S.channel = { label: channeling.hasKit ? 'Defusing (kit)' : 'Defusing — no kit', frac: defuseProgress / need };
    if (defuseProgress >= need) return endRound(TEAM.DEF, 'defuse');
  } else {
    defuser = null;
    defuseProgress = 0;
  }
  if (S.phaseT <= 0) {
    // Detonation: lethal at the heart of the site, and the round is the
    // Raiders' however many of them are left standing.
    const at = { x: S.bomb.pos.x, y: S.bomb.pos.y + 0.5, z: S.bomb.pos.z };
    AU.explosionSound(6);
    spawnParticles(at.x, at.y, at.z, 0xff9a3c, 42, 7, 0.9, 1);
    S.shake = 0.9;
    for (const f of S.players) {
      if (!f.alive) continue;
      const d = dist2d(f.pos, at);
      if (d < 7) applyDamage(S.bomb.planter, f, 160 * (1 - d / 8), false, 'bomb');
    }
    S.bomb.state = 'done';
    endRound(TEAM.ATK, 'detonation');
  }
}

function endRound(winner, how) {
  const loser = otherTeam(winner);
  S.score[winner]++;
  S.lossStreak[winner] = 0;
  S.lossStreak[loser]++;
  const winPay = how === 'detonation' || how === 'defuse' ? MONEY.winObjective : MONEY.winElimination;
  const lossPay = Math.min(MONEY.lossMax, MONEY.lossBase + MONEY.lossStep * (S.lossStreak[loser] - 1));
  for (const f of S.players) {
    f.survived = f.alive;
    f.money = Math.min(MONEY.cap, f.money + (f.team === winner ? winPay : lossPay));
  }
  const reasons = {
    elimination: `${TEAM_NAME[loser]} eliminated`,
    time: 'The round clock ran out',
    defuse: 'The charge was defused',
    detonation: 'The charge detonated',
  };
  S.lastRoundWinner = winner;
  S.banner = { title: `${TEAM_NAME[winner]} win the round`, sub: reasons[how] || '' };
  AU.roundSting(S.human.team === winner);
  S.phase = 'roundover';
  S.phaseT = TIME.roundEnd;
  S.buyOpen = false;
}
