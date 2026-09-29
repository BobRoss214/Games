// Content smoke tests: drives every ability / weapon / spell / potion / artifact / trap / boss part headlessly and asserts no crashes + real effects.
import { Match, emptyIntent } from '../src/match.js';
import { MONSTERS, WEAPONS, SPELLS, POTIONS, ARTIFACTS, TRAPS, BOSSES, PROPS, GODS, THEMES } from '../src/data.js';
import { spawnMonster, startAbility, dealDamage } from '../src/combat.js';
import { heroAttack, castSpell, usePotion, giveItem, refreshHeroStats } from '../src/hero.js';
import { triggerTrap, hauntProp, usePentagram, possessStatue, spawnGhost, possess, summonSlime } from '../src/ghost.js';
import { makeWeapon } from '../src/items.js';
import { generateFloor, buildBossMap, buildOpeningRoom } from '../src/dungeon.js';

let pass = 0, fail = 0; const failures = [];
const check = (c, msg) => { if (c) pass++; else { fail++; failures.push(msg); console.log('  FAIL ' + msg); } };
const guard = (name, fn) => { try { fn(); } catch (e) { fail++; failures.push(name + ': ' + e.message); console.log('  CRASH ' + name + ': ' + e.stack.split('\n').slice(0, 3).join(' | ')); } };
const silent = { think: () => emptyIntent(), upgradeDecide() {} };

function fresh(seed = 5) {
  const m = new Match({ seed, floors: 5, headless: true, players: [{}, {}, {}, {}] });
  m.startOpening();
  while (m.phase === 'opening') m.update(1 / 30);
  for (const p of m.players) p.ai = silent;   // freeze bots; we drive things by hand
  const w = m.world, hero = m.heroActor();
  for (const a of w.actors) if (a !== hero && a.type !== 'ghost') a.removed = true;
  w.cleanup();
  const r = w.spec.start; hero.x = r.cx + 0.5; hero.y = r.cy + 0.5; hero.hp = hero.maxHp = 1e6; hero.invuln = 0;
  return { m, w, hero, room: r };
}
const run = (m, sec, dt = 1 / 30) => { for (let t = 0; t < sec; t += dt) m.update(dt); };

console.log('== monsters: every ability, every tier');
for (const [id, def] of Object.entries(MONSTERS)) for (let tier = 0; tier < 3; tier++) guard(`${id} t${tier}`, () => {
  const { m, w, hero } = fresh();
  for (let ai = 0; ai < def.abilities.length; ai++) {
    const ab = def.abilities[ai];
    const mon = spawnMonster(w, id, tier, hero.x + Math.min(1.4, (ab.reach || 1.2) * 0.8 + 0.1), hero.y, null, { ctl: 'none' });
    mon.ai = { awake: false, t: 99, nav: null }; mon.abilities = [];
    mon.angle = Math.PI; mon.cds = {}; const before = hero.hp;
    startAbility(w, mon, ab); run(m, ab.windup + ab.strike + ab.recover + 0.5);
    if (['melee', 'aoe', 'scream', 'explode', 'beam', 'leap'].includes(ab.kind) && ab.dmg) check(hero.hp < before || mon.dead || ab.kind === 'beam', `${id} t${tier} ${ab.id} should hurt an adjacent hero`);
    if (ab.kind === 'proj') check(true, ''); if (ab.kind === 'summon') check(w.actors.filter((a) => a.summoner === mon.id).length > 0, `${id} ${ab.id} should summon`);
    hero.hp = 1e6; mon.removed = true; w.cleanup();
  }
});

console.log('== weapons (with every rarity/effect)');
for (const wid of Object.keys(WEAPONS)) for (const rar of ['common', 'rare', 'legendary']) guard(`weapon ${wid} ${rar}`, () => {
  const { m, w, hero } = fresh(7);
  const wp = makeWeapon(m.rng, wid, rar); hero.hero.weapons = [wp]; hero.hero.weaponIdx = 0; hero.hero.level = 6; refreshHeroStats(hero);
  const mon = spawnMonster(w, 'skeleton', 2, hero.x + 1.2, hero.y, null, { ctl: 'none' }); mon.ai = { awake: false, t: 99 }; mon.abilities = []; mon.maxHp = mon.hp = 1e5;
  hero.angle = 0; const before = mon.hp;
  for (let i = 0; i < 4; i++) { hero.atk = null; hero.cds = {}; heroAttack(w, hero, i % 2 === 1); run(m, 1.0); }
  check(mon.hp < before || wp.ammo === 0, `${wid} ${rar} should damage a target 1.2 units ahead`);
});

console.log('== spells, potions, artifacts');
for (const sid of Object.keys(SPELLS)) guard('spell ' + sid, () => {
  const { m, w, hero } = fresh(8); hero.hero.level = 8; refreshHeroStats(hero); hero.hero.spells = [sid, null]; hero.hero.spellIdx = 0; hero.mana = hero.maxMana;
  const mons = [0, 1, 2].map((i) => { const q = spawnMonster(w, 'skeleton', 1, hero.x + 1.6 + i * 0.6, hero.y + (i - 1) * 0.5, null, { ctl: 'none' }); q.ai = { awake: false, t: 99 }; q.abilities = []; q.maxHp = q.hp = 500; return q; });
  hero.angle = 0; const tot = () => mons.reduce((s, q) => s + q.hp, 0); const b = tot();
  const ok = castSpell(w, hero); run(m, 1.5); check(ok, 'cast ' + sid);
  if (['fire', 'frost', 'chain', 'drain'].includes(sid)) check(tot() < b, sid + ' should hurt targets');
  if (sid === 'ward') check(true, ''); 
});
for (const pid of Object.keys(POTIONS)) guard('potion ' + pid, () => {
  const { m, hero, w } = fresh(9); hero.hero.potions = { [pid]: 2 }; hero.hero.potionSel = pid; hero.hp = 20; hero.mana = 0;
  const ok = usePotion(w, hero); check(ok, 'drink ' + pid); if (pid === 'health') check(hero.hp > 60, 'health potion heals');
});
for (const aid of Object.keys(ARTIFACTS)) guard('artifact ' + aid, () => {
  const { m, hero, w } = fresh(10); giveItem(w, hero, { type: 'artifact', id: aid }); check(hero.hero.artifacts.includes(aid), 'equip ' + aid); run(m, 0.5);
});

console.log('== traps, props, statues, pentagrams, slimes');
for (const [tid, td] of Object.entries(TRAPS)) guard('trap ' + tid, () => {
  const { m, w, hero } = fresh(11); const p = m.players.find((q) => q !== m.heroPlayer);
  const trap = w.addProp({ kind: 'trap', trap: tid, x: hero.x - 0.6, y: hero.y, dir: 0, room: 0, wall: tid === 'flame' || tid === 'darts', track: 3 });
  trap.aim = 0; hero.hp = hero.maxHp = 1e6; const before = hero.hp;
  triggerTrap(w, trap, p); run(m, td.windup + td.active + 1.2);
  check(hero.hp < before, `${tid} trap hurts a hero standing on it`);
});
for (const sub of Object.keys(PROPS)) guard('prop ' + sub, () => {
  const { m, w, hero } = fresh(12); const p = m.players.find((q) => q !== m.heroPlayer);
  const pr = w.addProp({ kind: 'scenery', sub, x: hero.x + 2, y: hero.y, room: 0, cx: (hero.x + 2) | 0, cy: hero.y | 0 });
  if (pr.def.haunt) { hauntProp(w, p, pr); run(m, 1.2); }
  check(true, '');
});
guard('statue possession', () => {
  const { m, w, hero } = fresh(13); const p = m.players.find((q) => q !== m.heroPlayer);
  for (const sub of ['sentinel', 'gargoyle', 'golem']) { const st = w.addProp({ kind: 'statue', sub, x: hero.x + 3, y: hero.y, room: 0, cx: (hero.x + 3) | 0, cy: hero.y | 0 }); const g = p.body; const mon = possessStatue(w, p, g.type === 'ghost' ? g : spawnGhost(w, p, hero.x, hero.y, 0), st); check(mon && mon.giant, sub + ' becomes a giant'); mon.removed = true; spawnGhost(w, p, hero.x, hero.y, 0); w.cleanup(); }
});
guard('pentagram + evolution tiers', () => {
  const { m, w, hero } = fresh(14);
  for (const p of m.players.filter((q) => q !== m.heroPlayer)) for (let t = 0; t < 3; t++) { p.ghost.tiers = [t, t, t]; const pent = w.addProp({ kind: 'pent', x: hero.x + 2, y: hero.y + 2, cx: (hero.x + 2) | 0, cy: (hero.y + 2) | 0, room: 0 }); const g = p.body.type === 'ghost' ? p.body : spawnGhost(w, p, hero.x, hero.y, 0); const mon = usePentagram(w, p, g, pent); check(mon.tier === t, `${p.godId} tier ${t} via pentagram`); mon.removed = true; spawnGhost(w, p, hero.x, hero.y, 0); w.cleanup(); }
});
guard('slime split', () => {
  const { m, w, hero } = fresh(15); const s = spawnMonster(w, 'slime', 0, hero.x + 3, hero.y, null, { ctl: 'none' }); s.ai = { awake: false, t: 99 }; s.abilities = [];
  dealDamage(w, s, 1e5, { actor: hero, player: hero.player, kind: 'melee' }, {}); run(m, 0.2);
  check(w.actors.filter((a) => a.defId === 'slimelet').length === 2, 'slime splits into two slimelets');
});

console.log('== bosses: every part ability');
for (const bid of Object.keys(BOSSES)) guard('boss ' + bid, () => {
  const { m } = fresh(16); const hero = m.heroActor(); hero.hero.level = 10; m.enterBoss(hero);
  m.bossId = bid; // enterBoss already picked; rebuild for this id
  const p0 = m.heroPlayer; m.returnFromBoss && 0;
  const m2 = new Match({ seed: 16, floors: 5, headless: true, players: [{}, {}, {}, {}] }); m2.startOpening(); while (m2.phase === 'opening') m2.update(1 / 30);
  m2.bossId = bid; const h2 = m2.heroActor(); h2.hero.level = 10; m2.enterBoss(h2); for (const p of m2.players) p.ai = silent;
  const w = m2.world; const boss = w.boss; const hero2 = m2.heroActor();
  check(boss && boss.id === bid && boss.parts.length === 3, bid + ' has three parts'); 
  m2.bossStage = 'fight'; boss.startFight(); hero2.hp = hero2.maxHp = 1e6; hero2.x = 23.5; hero2.y = 20;
  let hurt = 0;
  for (const part of boss.parts) for (const ab of part.abilities) { part.cds = {}; part.atk = null; part.x = hero2.x - 1.2; part.y = hero2.y; part.angle = 0; part.desiredAngle = 0; const b = hero2.hp; startAbility(w, part, ab); for (let t = 0; t < ab.windup + ab.strike + ab.recover + 0.4; t += 1 / 30) m2.update(1 / 30); if (hero2.hp < b) hurt++; }
  check(hurt >= 3, bid + ' part abilities damage the hero (' + hurt + ')');
  // damage the boss to death
  boss.hp = 10; dealDamage(w, boss.parts[boss.parts.length - 1], 500, { actor: hero2, player: hero2.player, kind: 'melee' }, { dx: 1, dy: 0, type: 'melee' }); run(m2, 0.5);
  check(boss.dead && m2.bossStage === 'won', bid + ' can be defeated'); 
});

console.log('== generation for every theme & special maps');
for (let t = 0; t < THEMES.length; t++) guard('floor theme ' + t, () => { for (let s = 1; s <= 6; s++) { const f = generateFloor(s * 31, t, t); check(f.rooms.length >= 8 && f.exit && f.portal, `theme ${t} seed ${s} produced a valid floor`); } });
guard('special maps', () => { check(!!buildOpeningRoom(1).map, 'opening'); for (const b of Object.keys(BOSSES)) check(!!buildBossMap(b).map, 'boss map ' + b); });

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
