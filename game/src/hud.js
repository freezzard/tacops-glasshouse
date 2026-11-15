// hud.js — everything drawn over the canvas: vitals, the clock, the feed,
// the buy menu, the scoreboard, and the little arrows that tell you where
// the bullet came from. It only reads the store and the DOM; the simulation
// never waits on it.

import { S, TEAM } from './state.js';
import { TEAM_NAME } from './palette.js';
import { input, takePress } from './input.js';
import { WEAPONS, GEAR, BUY_ORDER, currentDef, currentWeaponId, spreadFor } from './weapons.js';
import { buyItem, resetMatch } from './rounds.js';
import { yawTo } from './physics.js';

const el = {};
let feedSeen = 0;
let feedNodes = [];
let bannerFor = null;
let bannerAt = 0;
let buySignature = '';
let endShown = false;
let scopeEl = null;

function $(id) { return document.getElementById(id); }

export function initHud() {
  for (const id of ['hud', 'atkScore', 'defScore', 'clockTime', 'clockLabel', 'clock', 'seal',
    'hpnum', 'apnum', 'hpbar', 'apbar', 'money', 'kit', 'wname', 'ammo', 'slots',
    'cross', 'hitmark', 'dmgdir', 'vig', 'prompt', 'plantwrap', 'plantlabel', 'plantbar',
    'feed', 'banner', 'bannerTitle', 'bannerSub', 'buy', 'buysub', 'buygrid',
    'board', 'boardTitle', 'boardBody', 'end', 'endTitle', 'endSub']) {
    el[id] = $(id);
  }
  // Crosshair: four ticks around a dot, rebuilt once, moved per frame.
  const mk = (parent, w, h) => {
    const i = document.createElement('i');
    i.style.width = w + 'px'; i.style.height = h + 'px';
    parent.appendChild(i);
    return i;
  };
  el.ticks = [mk(el.cross, 2, 9), mk(el.cross, 2, 9), mk(el.cross, 9, 2), mk(el.cross, 9, 2), mk(el.cross, 3, 3)];
  el.hitTicks = [mk(el.hitmark, 11, 2), mk(el.hitmark, 11, 2), mk(el.hitmark, 11, 2), mk(el.hitmark, 11, 2)];
  el.hitTicks.forEach((t, i) => {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    t.style.transform = `translate(${Math.cos(a) * 11 - 5}px, ${Math.sin(a) * 11 - 1}px) rotate(${a}rad)`;
  });
  scopeEl = document.createElement('div');
  scopeEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;display:none;background:radial-gradient(circle at 50% 50%, transparent 26%, rgba(0,0,0,.92) 27%);';
  document.body.appendChild(scopeEl);
  $('again').addEventListener('click', (ev) => {
    ev.currentTarget.blur();
    el.end.style.display = 'none';
    endShown = false;
    resetMatch();
  });
}

function fmtClock(t) {
  t = Math.max(0, Math.ceil(t));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function setText(node, text) {
  if (node.__last !== text) { node.__last = text; node.textContent = text; }
}

export function frameHud() {
  const f = S.human;
  if (!f) return;
  const inGame = S.phase !== 'menu';
  el.hud.hidden = !inGame;
  if (!inGame) return;

  // Top bar.
  setText(el.atkScore, String(S.score.atk));
  setText(el.defScore, String(S.score.def));
  setText(el.clockTime, fmtClock(S.phaseT));
  const labels = { freeze: 'Buy time', live: 'Round', planted: 'Cryo-Core anchored', roundover: 'Round over', matchover: 'Match over' };
  setText(el.clockLabel, labels[S.phase] || '');
  setText(el.seal, `DOME SEAL: ${Math.round(S.sealPct)}%`);
  el.clock.classList.toggle('hot', S.phase === 'planted' || (S.phase === 'live' && S.phaseT < 10));

  // Vitals.
  const hp = Math.max(0, Math.ceil(f.hp));
  setText(el.hpnum, f.alive ? String(hp) : '—');
  setText(el.apnum, f.armor > 0 ? `Armor ${Math.ceil(f.armor)}${f.helmet ? ' + helmet' : ''}` : '');
  el.hpbar.style.width = `${hp}%`;
  el.hpbar.style.background = hp > 50 ? '#7dd069' : hp > 25 ? '#e8c33d' : '#e85d3d';
  el.apbar.style.width = `${Math.max(0, f.armor)}%`;
  setText(el.money, `G${f.money}`);
  setText(el.kit, f.hasKit ? 'Purge kit carried' : (S.bomb.carrier === f && S.bomb.state === 'carried') ? 'You carry the Cryo-Core' : '');

  // Arms.
  const def = currentDef(f);
  const id = currentWeaponId(f);
  setText(el.wname, def ? def.name : '');
  if (def && def.mag) {
    const ammo = f.weapons.ammo[id];
    el.ammo.innerHTML = `${ammo.mag} <small>/ ${ammo.reserve}</small>`;
    el.ammo.classList.toggle('low', ammo.mag <= Math.ceil(def.mag * 0.25));
  } else {
    setText(el.ammo, '—');
    el.ammo.classList.remove('low');
  }
  const slots = [
    f.weapons.primary ? `1 ${WEAPONS[f.weapons.primary].name}` : null,
    '2 Sparrow', '3 Knife',
    f.weapons.grenades.frag ? '4 Frag' : f.weapons.grenades.smoke ? '4 Smoke' : null,
  ].filter(Boolean).join(' · ');
  setText(el.slots, slots);

  // Crosshair spread follows the same number the bullets use.
  const spread = def && !def.melee ? spreadFor(f, def) : 0.004;
  const gap = 5 + spread * 1250;
  const [t0, t1, t2, t3, dot] = el.ticks;
  t0.style.transform = `translate(-1px, ${-gap - 9}px)`;
  t1.style.transform = `translate(-1px, ${gap}px)`;
  t2.style.transform = `translate(${-gap - 9}px, -1px)`;
  t3.style.transform = `translate(${gap}px, -1px)`;
  dot.style.transform = 'translate(-1px, -1px)';
  el.cross.style.display = f.alive && !f.scoped ? 'block' : 'none';
  scopeEl.style.display = f.scoped && f.alive ? 'block' : 'none';

  // Hitmarker: combat stamps S.hitMark when the human connects.
  const hm = S.hitMark;
  const hmAge = hm ? S.time - hm.at : 9;
  el.hitmark.style.opacity = hmAge < 0.22 ? String(1 - hmAge / 0.22) : '0';
  el.hitmark.classList.toggle('kill', !!(hm && hm.kill));

  // Damage direction: an arc swung toward whoever hurt the human last.
  const sinceHit = S.time - f.lastDamageAt;
  if (f.lastDamageFrom && sinceHit < 1.1 && f.alive) {
    const want = yawTo(f.pos, f.lastDamageFrom.pos);
    let rel = want - f.yaw;
    el.dmgdir.firstElementChild.style.transform = `rotate(${rel}rad)`;
    el.dmgdir.firstElementChild.style.opacity = String(0.9 * (1 - sinceHit / 1.1));
  } else {
    el.dmgdir.firstElementChild.style.opacity = '0';
  }
  const lowHp = f.alive && f.hp < 35 ? (35 - f.hp) / 35 * 0.5 : 0;
  const flash = Math.max(0, 0.45 - sinceHit) * 0.7;
  el.vig.style.boxShadow = `inset 0 0 140px rgba(200,20,10,${Math.max(lowHp, flash).toFixed(3)})`;

  // Kill feed.
  while (feedSeen < S.feed.length) {
    const line = S.feed[feedSeen++];
    const div = document.createElement('div');
    const a = line.a, v = line.v;
    div.innerHTML = `<span class="${a && a.team === TEAM.ATK ? 'a' : 'd'}">${a ? a.name : '—'}</span>` +
      ` ${WEAPONS[line.weapon] ? WEAPONS[line.weapon].name : line.weapon}${line.head ? ' <span class="hs">HS</span>' : ''} ` +
      `<span class="${v.team === TEAM.ATK ? 'a' : 'd'}">${v.name}</span>`;
    el.feed.prepend(div);
    feedNodes.push({ node: div, until: S.time + 4.5 });
    while (el.feed.children.length > 5) el.feed.lastElementChild.remove();
  }
  feedNodes = feedNodes.filter((x) => {
    if (S.time > x.until) { x.node.remove(); return false; }
    return true;
  });
  if (S.round !== (el.__round || 0)) { el.__round = S.round; feedSeen = 0; feedNodes = []; el.feed.innerHTML = ''; }

  // Banner.
  if (S.banner !== bannerFor) {
    bannerFor = S.banner;
    bannerAt = S.time;
    if (S.banner) {
      setText(el.bannerTitle, S.banner.title);
      setText(el.bannerSub, S.banner.sub || '');
      el.banner.style.display = 'block';
    }
  }
  if (S.banner && S.time - bannerAt > 3.6) el.banner.style.display = 'none';
  if (!S.banner) el.banner.style.display = 'none';

  // Context prompt and the plant/defuse bar.
  el.prompt.style.display = promptFor(f) ? 'block' : 'none';
  if (promptFor(f)) setText(el.prompt, promptFor(f));
  if (S.channel) {
    el.plantwrap.style.display = 'block';
    setText(el.plantlabel, S.channel.label);
    el.plantbar.style.width = `${Math.round(S.channel.frac * 100)}%`;
  } else {
    el.plantwrap.style.display = 'none';
  }

  frameBuy(f);
  frameBoard(f);
  frameEnd(f);
}

function promptFor(f) {
  if (!f.alive) return 'Down — spectating a teammate until the round ends';
  if (S.phase === 'live' && S.bomb.carrier === f) {
    return 'Carry the Cryo-Core into a marked site and hold E to anchor';
  }
  if (S.phase === 'planted' && f.team === TEAM.DEF) return 'Reach the Cryo-Core and hold E to purge';
  if (S.phase === 'freeze') return 'Buy with B — the round starts when the clock does';
  return null;
}

function frameBuy(f) {
  if (takePress('KeyB') && S.phase === 'freeze') S.buyOpen = !S.buyOpen;
  if (takePress('Escape')) S.buyOpen = false;
  const open = S.buyOpen && S.phase === 'freeze' && f.alive;
  el.buy.style.display = open ? 'block' : 'none';
  if (!open) return;
  // Number keys buy while the menu is up (the simulation leaves them alone).
  for (let i = 0; i < BUY_ORDER.length; i++) {
    if (takePress('Digit' + (i + 1))) buyItem(f, BUY_ORDER[i]);
  }
  const signature = [f.money, f.weapons.primary, f.armor, f.helmet, f.hasKit, f.weapons.grenades.frag, f.weapons.grenades.smoke].join('|');
  if (signature === buySignature) return;
  buySignature = signature;
  setText(el.buysub, `You have G${f.money} in Grants — press a number to buy, B to close. Unspent Grants carry over.`);
  el.buygrid.innerHTML = '';
  BUY_ORDER.forEach((id, i) => {
    const isGun = !!WEAPONS[id];
    const name = isGun ? WEAPONS[id].name : GEAR[id].name;
    const price = isGun ? WEAPONS[id].price : id === 'helmet' ? GEAR.helmet.price - GEAR.armor.price : GEAR[id].price;
    const owned = (isGun && f.weapons.primary === id) ||
      (id === 'armor' && f.armor >= 100) || (id === 'helmet' && f.helmet) ||
      (id === 'kit' && f.hasKit) || ((id === 'frag' || id === 'smoke') && f.weapons.grenades[id] > 0);
    const blocked = (id === 'kit' && f.team !== TEAM.DEF) ? 'Curators only'
      : (id === 'helmet' && f.armor <= 0) ? 'Needs vest' : null;
    const btn = document.createElement('button');
    btn.innerHTML = `<span class="key">${i + 1}</span> ${name} <b>${owned ? 'owned' : blocked || 'G' + price}</b>`;
    btn.disabled = owned || !!blocked || f.money < price;
    btn.addEventListener('click', () => buyItem(f, id));
    el.buygrid.appendChild(btn);
  });
}

function frameBoard(f) {
  const show = !!input.keys['Tab'] && S.phase !== 'menu';
  el.board.style.display = show ? 'block' : 'none';
  if (!show) return;
  setText(el.boardTitle, `FROSTBLOOM — Round ${S.round} · ${TEAM_NAME.atk} ${S.score.atk} : ${S.score.def} ${TEAM_NAME.def}`);
  const rows = [...S.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  let html = '<table><tr><th>Fighter</th><th>Side</th><th class="n">K</th><th class="n">D</th><th class="n">A</th><th class="n">G</th></tr>';
  for (const p of rows) {
    html += `<tr class="${p === f ? 'me' : ''}"><td>${p.name}${p.alive ? '' : ' — down'}</td>` +
      `<td>${TEAM_NAME[p.team]}</td><td class="n">${p.kills}</td><td class="n">${p.deaths}</td>` +
      `<td class="n">${p.assists}</td><td class="n">${p.money}</td></tr>`;
  }
  el.boardBody.innerHTML = html + '</table>';
}

function frameEnd(f) {
  if (!S.over || endShown) return;
  endShown = true;
  const won = S.over.winner === f.team;
  setText(el.endTitle, won ? 'VICTORY' : 'DEFEAT');
  setText(el.endSub, `${TEAM_NAME.atk} ${S.score.atk} — ${S.score.def} ${TEAM_NAME.def} over ${S.round} rounds. ` +
    (won ? 'The canopy breathes on.' : 'The dome seals in silence.'));
  el.end.style.display = 'flex';
}
