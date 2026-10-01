// Tutorial: a scripted solo run through a small hand-built map. Sim-side only (no DOM), so it runs headless in tests.
// The player cannot move on until they do what the panel says. Doors between rooms stay sealed until the room's last step is done.
import { angleDiff } from './util.js';
import { WALL, FLOOR, CEIL, DECAL } from './textures.js';
import { LEVEL_UNLOCKS } from './data.js';
import { baseSpecialMap, carveRoom, torchLightList } from './dungeon.js';
import { bakeTorchKernel, applyKernel } from './renderer.js';
import { applyLevelUp, giveItem } from './hero.js';
import { spawnGhost } from './ghost.js';
import { spawnMonster, spawnPickup } from './combat.js';

const RW = 11, RH = 9, STRIDE = 14, NROOMS = 7, X0 = 2, Y0 = 3;

// ---------------- the map: seven rooms in a row, joined by short corridors with sealed doors ----------------
export function buildTutorialMap() {
  const { map, th } = baseSpecialMap(X0 + NROOMS * STRIDE + 2, Y0 + RH + 4, 0);
  const floors = [FLOOR.flag, FLOOR.mossFlag, FLOOR.flag, FLOOR.flagCrack, FLOOR.wood, FLOOR.goldTile, FLOOR.altar];
  const walls = [WALL.brick, WALL.moss, WALL.brick, WALL.moss, WALL.brick, WALL.store, WALL.altar];
  const rooms = [], doors = [];
  const cy = Y0 + 4;
  for (let i = 0; i < NROOMS; i++) {
    const r = { x: X0 + i * STRIDE, y: Y0, w: RW, h: RH, id: i, type: i === 5 ? 'store' : 'tutorial' };
    carveRoom(map, r, floors[i], i === 6 ? CEIL.dark : CEIL.stone, walls[i], i);
    const torches = [];
    for (let k = 0; k < 3; k++) torches.push({ x: r.x + 2.5 + k * 3.2, y: r.y + 0.08, dir: Math.PI / 2 });
    for (let k = 0; k < 2; k++) torches.push({ x: r.x + 3.5 + k * 4, y: r.y + r.h - 0.08, dir: -Math.PI / 2 });
    Object.assign(r, { doors: [], pentagrams: [], traps: [], crystals: [], chests: [], props: [], torches, shop: [], statue: null, lights: [], links: [], free: new Set(), cx: r.x + 5, cy: r.y + 4, needsClear: false, cleared: true });
    rooms.push(r);
  }
  const prop = (r, kind, dx, dy) => r.props.push({ kind, x: r.x + dx + 0.5, y: r.y + dy + 0.5, cx: r.x + dx, cy: r.y + dy });
  prop(rooms[1], 'pot', 6, 2); prop(rooms[1], 'jar', 8, 4); prop(rooms[1], 'pot', 6, 6); prop(rooms[1], 'crate', 9, 3);
  for (const i of [0, 2, 3, 4]) { prop(rooms[i], 'pillar', 3, 1); prop(rooms[i], 'pillar', 3, 7); }
  // vault: a chest and two shop pedestals
  const v = rooms[5];
  v.chests.push({ x: v.x + 3.5, y: v.y + 1.5, cx: v.x + 3, cy: v.y + 1, tier: 0 });
  v.shop.push({ x: v.x + 8.5, y: v.y + 2.5, slot: 0 }, { x: v.x + 8.5, y: v.y + 6.5, slot: 1 });
  // ghost hall: a pentagram in the middle
  const g = rooms[6];
  g.pentagrams.push({ x: g.x + 5.5, y: g.y + 4.5, cx: g.x + 5, cy: g.y + 4 });
  // corridors + doors
  for (let i = 0; i < NROOMS - 1; i++) {
    const r = rooms[i], dx = r.x + RW + 1;
    for (let x = r.x + RW; x <= r.x + RW + 2; x++) { const ci = cy * map.w + x; map.wall[ci] = 0; map.floor[ci] = FLOOR.flag; map.ceil[ci] = CEIL.stone; }
    const d = map.addDoor(dx, cy, WALL.sealed, { room: i, locked: true });
    map.floor[cy * map.w + dx] = FLOOR.flag; map.ceil[cy * map.w + dx] = CEIL.stone;
    doors.push(d);
  }
  // baked torch light (warm) for every room
  const all = []; for (const r of rooms) for (const t of r.torches) all.push(t);
  torchLightList(map, all, [1.0, 0.55, 0.28]);
  for (const p of g.pentagrams) {
    const k = bakeTorchKernel(map, p.x, p.y, 3.4); applyKernel(map.light, k, 0.75, 0.08, 0.05, 1.0);
    const tor = { x: p.x, y: p.y, kernel: k, color: [0.75, 0.08, 0.05], phase: 1.3, cur: 1, kind: 'pent', pent: p, room: 6 }; map.torches.push(tor);
  }
  return { map, rooms, theme: th, tutorial: true, doors, floorIndex: 0 };
}

// ---------------- the lesson script ----------------
const enterRoom = (n) => ({ id: 'enter' + n, title: 'NEXT ROOM', text: () => 'WALK THROUGH THE OPEN DOOR.', check: (t) => t.inRoom(n) });
const STEPS = [
  { id: 'look', title: 'LOOK AROUND', text: (K) => `TURN THE CAMERA WITH ${K('look')}. LOOK ALL THE WAY AROUND.`, progress: (t) => t.turned / 5.5, check: (t) => t.turned >= 5.5 },
  { id: 'move', title: 'MOVE', text: (K) => `WALK WITH ${K('move')}. GO FORWARD AND SIDEWAYS A FEW STEPS.` + (/MOUSE/.test(K('look')) ? ` LAPTOP TOUCHPAD DEAD WHILE YOU WALK? TURN WITH THE ARROW KEYS, OR PRESS ${K('autorun')} TO AUTO-WALK.` : ''), progress: (t) => t.walked / 7, check: (t) => t.walked >= 7, open: 0 },
  enterRoom(1),
  { id: 'smash', title: 'SMASH THINGS', text: (K) => `SWING WITH ${K('attack')} AND SMASH A POT. THEY HOLD GOLD.`, check: (t) => t.delta('propbreak') >= 1 },
  { id: 'gold', title: 'GRAB THE GOLD', text: () => 'WALK OVER THE GOLD ON THE FLOOR TO PICK IT UP.', enter: (t) => t.dropGold(), check: (t) => t.p.hero.gold > t.gold0, open: 1 },
  enterRoom(2),
  { id: 'kill', title: 'FIGHT', text: (K) => `A SKELETON! KILL IT WITH ${K('attack')}. SWING WHEN IT IS CLOSE.`, enter: (t) => t.spawnSkeleton(4), check: (t) => t.monstersAlive() === 0 && t.spawned > 0, open: 2 },
  enterRoom(3),
  { id: 'heavy', title: 'HEAVY ATTACK', text: (K) => `LEVEL 3! HOLD ${K('attack')} FOR A MOMENT, THEN LET GO. THAT IS A HEAVY ATTACK.`, enter: (t) => t.setLevel(3), check: (t) => t.heavy >= 1 },
  { id: 'dodge', title: 'DODGE ROLL', text: (K) => `LEVEL 5! MOVE AND PRESS ${K('dodge')} TO ROLL. YOU CANNOT BE HURT WHILE ROLLING.`, enter: (t) => t.setLevel(5), check: (t) => t.delta('dodge') >= 1 },
  { id: 'block', title: 'BLOCK', text: (K) => `LEVEL 6! FACE THE SKELETON AND HOLD ${K('alt')} TO BLOCK ITS SWING. TAP RIGHT AS IT HITS TO PARRY.`, enter: (t) => { t.setLevel(6); t.spawnSkeleton(4, true); }, tick: (t) => t.keepSkeleton(), check: (t) => t.delta('block') + t.delta('parry') >= 1, exit: (t) => t.clearMonsters(), open: 3 },
  enterRoom(4),
  { id: 'potion', title: 'POTIONS', text: (K) => `YOU ARE HURT. PRESS ${K('potion')} TO DRINK YOUR HEALTH POTION.`, enter: (t) => t.hurt(), check: (t) => t.delta('potion') >= 1 },
  { id: 'spell', title: 'MAGIC', text: (K) => `LEVEL 7! YOU HAVE A FIRE SPELL. PRESS ${K('spell')} TO CAST IT. IT USES MANA (BLUE BAR).`, enter: (t) => { t.setLevel(7); t.giveSpell(); }, check: (t) => t.delta('spellcast') >= 1, open: 4 },
  enterRoom(5),
  { id: 'chest', title: 'CHESTS', text: (K) => `WALK UP TO THE CHEST AND PRESS ${K('interact')} TO OPEN IT.`, check: (t) => t.delta('chestopen') >= 1 },
  { id: 'shop', title: 'THE SHOP', text: (K) => `YOU HAVE 500 GOLD. WALK UP TO AN ITEM AND PRESS ${K('interact')} TO BUY IT.`, enter: (t) => { t.p.hero.gold = Math.max(t.p.hero.gold, 500); }, check: (t) => t.delta('buy') >= 1, open: 5 },
  { id: 'ghostintro', title: 'NOW THE OTHER SIDE', text: () => 'THE HERO CAN FALL. THEN EVERYONE ELSE IS A GHOST. YOU ARE A GHOST NOW. GHOSTS ARE INVISIBLE TO THE HERO.', enter: (t) => t.toGhost(), check: (t) => t.stepT > 5.5 },
  { id: 'ghostmove', title: 'FLOAT', text: (K) => `FLOAT WITH ${K('move')}, LOOK WITH ${K('look')}. GO TO THE RED PENTAGRAM IN THE MIDDLE.`, check: (t) => t.nearPent() },
  { id: 'possess', title: 'POSSESS', text: (K) => `PRESS ${K('interact')} ON THE PENTAGRAM TO BECOME A MONSTER.`, check: (t) => t.delta('pentagram') >= 1 },
  { id: 'attack', title: 'HAUNT THE HERO', text: (K) => `NOW YOU ARE A MONSTER. WALK AT THE HERO AND HIT HIM WITH ${K('attack')}. ${K('alt')} AND ${K('spell')} ARE YOUR OTHER MOVES.`, progress: (t) => t.dummyDmg / 40, tick: (t) => t.keepMonster(), check: (t) => t.dummyDmg >= 40 },
  { id: 'finish', title: 'THAT IS THE GAME', text: () => 'IN A REAL MATCH THE KILLING BLOW MAKES YOU THE NEW HERO. HERO REACHES LEVEL 10, KILLS THE BOSS, WINS.', check: (t) => t.stepT > 6 },
];
export const TUTORIAL_STEPS = STEPS.length;

export class Tutorial {
  constructor(match, world, spec) {
    this.m = match; this.w = world; this.spec = spec; this.p = match.players[0]; this.d = match.players[1];
    this.i = -1; this.done = false; this.wait = 0; this.flash = 0; this.stepT = 0; this.t = 0;
    this.turned = 0; this.walked = 0; this.heavy = 0; this.heavyLatch = false; this.dummy = null; this.dummyDmg = 0; this.dummyLast = 0;
    this.last = null; this.c0 = {}; this.gold0 = 0; this.spawned = 0; this.skelT = 0;
  }
  begin() { this.advance(); }
  get step() { return STEPS[this.i]; }
  hero() { return this.m.heroActor(); }
  delta(type) { return (this.m.counts[type] || 0) - (this.c0[type] || 0); }
  inRoom(n) { const h = this.p.body; return !!h && !h.dead && this.w.roomAt(h.x, h.y) === this.spec.rooms[n]; }
  key(act) { return this.m.key(this.p, act); }

  // panel data for the HUD
  panel() {
    const s = this.step; if (!s) return null;
    return { n: this.i + 1, total: STEPS.length, title: s.title, text: s.text((a) => this.key(a)), progress: s.progress ? Math.max(0, Math.min(1, s.progress(this))) : null, complete: this.wait > 0 };
  }

  advance() {
    const prev = this.step;
    if (prev && prev.exit) prev.exit(this);
    this.i++;
    if (this.i >= STEPS.length) { this.done = true; this.clearMonsters(); return; }
    this.stepT = 0; this.wait = 0; this.c0 = Object.assign({}, this.m.counts); this.gold0 = this.p.hero.gold;
    this.turned = 0; this.walked = 0; this.heavy = 0; this.dummyDmg = 0; this.spawned = 0; this.last = null;
    const s = this.step;
    if (s.enter) s.enter(this);
  }
  complete() {
    const s = this.step;
    if (s.open !== undefined) this.openDoor(s.open);
    this.wait = 1.3; this.w.emit('tutstep', {});
  }
  skip() { if (this.done) return; if (this.wait <= 0) { const s = this.step; if (s.open !== undefined) this.openDoor(s.open); } this.advance(); }
  gotoStep(id) { const n = STEPS.findIndex((s) => s.id === id); if (n < 0) return; this.i = n - 1; this.advance(); }

  openDoor(n) { const d = this.spec.doors[n]; if (!d) return; d.locked = false; this.w.map.setDoorTex(d, 11); }

  update(dt) {
    this.t += dt; this.stepT += dt;
    if (this.done) { this.guard(); return; }
    this.track();
    this.guard();
    if (this.wait > 0) { this.wait -= dt; if (this.wait <= 0) this.advance(); return; }
    const s = this.step; if (!s) return;
    if (s.tick) s.tick(this, dt);
    if (s.check(this)) this.complete();
  }

  // movement / swing metrics for the current body
  track() {
    const b = this.p.body; if (!b) { this.last = null; return; }
    if (this.last && this.last.b === b) { this.turned += Math.abs(angleDiff(b.angle, this.last.a)); this.walked += Math.hypot(b.x - this.last.x, b.y - this.last.y); }
    this.last = { b, x: b.x, y: b.y, a: b.angle };
    if (b.type === 'hero') {
      if (b.atk && b.atk.heavy) { if (!this.heavyLatch) { this.heavyLatch = true; this.heavy++; } } else if (!b.atk) this.heavyLatch = false;
    }
  }
  // the learner cannot die and the practice hero cannot die
  guard() {
    const me = this.p.body;
    if (me && me.type === 'hero' && !me.dead && me.hp < me.maxHp * 0.35 && this.step && this.step.id !== 'potion') me.hp = me.maxHp;
    const d = this.dummy;
    if (d && !d.dead) {
      if (d.hp < this.dummyLast) this.dummyDmg += this.dummyLast - d.hp;
      if (d.hp < d.maxHp * 0.5) d.hp = d.maxHp;
      this.dummyLast = d.hp;
    }
  }
  onHeroDeath(w, hero) { // revive instead of the normal fall-and-swap
    hero.dead = false; hero.deadT = 0; hero.anim = 'idle'; hero.hp = hero.maxHp; hero.invuln = 1.5; hero.atk = null;
  }

  // ---- helpers used by steps ----
  setLevel(lv) {
    const h = this.hero(); if (!h) return;
    this.p.hero.level = lv; applyLevelUp(this.w, h);
    this.m.toastFor(this.p, `LEVEL ${lv}: ${(LEVEL_UNLOCKS[lv] || '').toUpperCase()}`, '#ffe080', 5);
  }
  giveSpell() { const h = this.hero(); if (h) { giveItem(this.w, h, { type: 'spell', id: 'fire' }); h.mana = h.maxMana; } }
  hurt() { const h = this.hero(); if (!h) return; h.hp = h.maxHp * 0.45; this.p.hero.potions.health = Math.max(1, this.p.hero.potions.health || 0); this.p.hero.potionSel = 'health'; }
  dropGold() {
    const h = this.hero(); if (!h) return;
    for (let k = -1; k <= 1; k++) spawnPickup(this.w, 'gold', h.x + Math.cos(h.angle + k * 0.5) * 1.8, h.y + Math.sin(h.angle + k * 0.5) * 1.8, { amount: 5 });
  }
  spawnSkeleton(dy, durable) {
    const n = this.p.body && this.p.body.room >= 0 ? this.p.body.room : this.roomOfHero();
    const r = this.spec.rooms[n];
    const m = spawnMonster(this.w, 'skeleton', 0, r.x + RW - 2.5, r.y + dy + 0.5, null, { ctl: 'ai', hpMul: durable ? 3 : 0.7, dmgMul: durable ? 0.5 : 0.4, room: n });
    m.angle = Math.PI; this.spawned++;
  }
  roomOfHero() { const b = this.p.body; const r = b && this.w.roomAt(b.x, b.y); return r ? r.id : 0; }
  monstersAlive() { let n = 0; for (const a of this.w.actors) if (a.type === 'monster' && !a.dead && !a.removed) n++; return n; }
  clearMonsters() { for (const a of this.w.actors) if (a.type === 'monster' && a.team === 'ghost' && !a.player) a.removed = true; }
  keepSkeleton() { // block lesson needs something to swing at the player, forever
    if (this.monstersAlive() === 0) { this.skelT += 1 / 60; if (this.skelT > 1.2) { this.skelT = 0; this.spawnSkeleton(4, true); } }
  }
  keepMonster() { // if the player's monster dies or they leave the body, give the pentagram back
    const b = this.p.body;
    if (b && b.type === 'ghost') { this.resetPent(); this.gotoStep('possess'); }
  }
  resetPent() {
    const p = this.spec.rooms[6].pentagrams[0]; if (!p || !p.prop) return;
    p.prop.usedUp = false; p.prop.used = false; this.w.map.decal[p.cy * this.w.map.w + p.cx] = DECAL.pentagram;
  }
  nearPent() { const b = this.p.body; const p = this.spec.rooms[6].pentagrams[0]; return !!b && !!p && Math.hypot(b.x - p.x, b.y - p.y) < 1.0; }

  toGhost() {
    const m = this.m, w = this.w, r = this.spec.rooms[6];
    const old = this.p.body; if (old) old.removed = true;
    this.clearMonsters();
    this.p.role = 'ghost';
    spawnGhost(w, this.p, r.x + 2.5, r.y + 4.5, 0);
    // a practice hero stands still at the far end of the hall
    const d = this.d; d.role = 'hero'; m.heroPlayer = d;
    d.hero = Object.assign({}, this.p.hero, { level: 3, gold: 0 });
    const h = m.spawnDummyHero(w, d, r.x + RW - 2.5, r.y + 4.5, Math.PI);
    this.dummy = h; this.dummyLast = h.hp; this.dummyDmg = 0;
    m.setBanner('YOU ARE A GHOST', '', '#8090e0', 3);
  }
}
