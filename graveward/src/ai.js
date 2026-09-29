// Bot brains: hero bot, ghost bot, trap bot, and monster AI (also used for unowned monsters and boss parts).
import { clamp, angleDiff, dist, dist2, TAU, RNG, grng } from './util.js';
import { WEAPONS, SPELLS, ARTIFACTS, POTIONS, MAX_LEVEL } from './data.js';
import { hostile, abilityReady } from './combat.js';
import { possessableList, SLIME_COST } from './ghost.js';
import { currentWeapon } from './hero.js';

const SKILL = {
  easy: { think: 0.32, aimErr: 0.30, react: 0.45, dodge: 0.18, block: 0.15, heavy: 0.1, spell: 0.25, ghostDelay: 5 },
  normal: { think: 0.16, aimErr: 0.13, react: 0.22, dodge: 0.55, block: 0.45, heavy: 0.3, spell: 0.5, ghostDelay: 2.2 },
  hard: { think: 0.08, aimErr: 0.04, react: 0.1, dodge: 0.9, block: 0.8, heavy: 0.45, spell: 0.8, ghostDelay: 0.8 },
};

const blank = () => ({
  fwd: 0, strafe: 0, turn: 0, turnRate: 0, attack: false, attackPressed: false, attackReleased: false, alt: false, altPressed: false, dodge: false, interact: false,
  spell: false, spellNext: false, potion: false, potionNext: false, swap: false, sprint: false, ability2: false, aimAngle: undefined,
});

// ---------------- navigation ----------------
class Nav {
  constructor() { this.path = null; this.i = 0; this.tx = 1e9; this.ty = 1e9; this.age = 99; this.fails = 0; }
  // returns unit direction to walk toward (tx,ty), or null if unreachable
  dir(w, a, tx, ty, dt, opts = {}) {
    this.age += dt;
    const moved = dist2(tx, ty, this.tx, this.ty) > 1.44;
    if (!this.path || moved || this.age > 0.7) {
      if (w.hasLOS(a.x, a.y, tx, ty, false) && dist(a.x, a.y, tx, ty) < 6 && this.straightOk(w, a, tx, ty)) this.path = [[tx, ty]];
      else this.path = w.path(a.x, a.y, tx, ty, opts);
      this.i = 0; this.tx = tx; this.ty = ty; this.age = 0;
      if (!this.path) this.fails++; else this.fails = 0;
    }
    if (!this.path) return null;
    while (this.i < this.path.length - 1 && dist2(a.x, a.y, this.path[this.i][0], this.path[this.i][1]) < 0.36) this.i++;
    // shortcut
    for (let k = Math.min(this.path.length - 1, this.i + 4); k > this.i; k--) {
      const p = this.path[k];
      if (dist2(a.x, a.y, p[0], p[1]) < 30 && this.straightOk(w, a, p[0], p[1])) { this.i = k; break; }
    }
    const p = this.path[this.i];
    const dx = p[0] - a.x, dy = p[1] - a.y, d = Math.hypot(dx, dy) || 1;
    return { x: dx / d, y: dy / d, d };
  }
  straightOk(w, a, tx, ty) {
    // sample circle-clear along the line
    const dx = tx - a.x, dy = ty - a.y, n = Math.ceil(Math.hypot(dx, dy) * 3);
    for (let i = 1; i <= n; i++) if (!w.canStand(a.x + (dx * i) / n, a.y + (dy * i) / n, a.r + 0.05, a.type === 'ghost')) return false;
    return true;
  }
}

function moveToward(I, a, d) { // world dir -> local fwd/strafe
  const c = Math.cos(a.angle), s = Math.sin(a.angle);
  I.fwd = d.x * c + d.y * s; I.strafe = -d.x * s + d.y * c;
}
function moveDir(I, a, dx, dy) { const n = Math.hypot(dx, dy) || 1; moveToward(I, a, { x: dx / n, y: dy / n }); }

// ---------------- Brain (per player) ----------------
export class BotBrain {
  constructor(player, skill, rng) {
    this.p = player; this.rng = rng; this.sk = SKILL[skill] || SKILL.normal;
    this.I = blank(); this.timer = rng.float(0, 0.2); this.nav = new Nav();
    this.atkPhase = 'idle'; this.atkT = 0; this.goal = null; this.goalT = 0; this.claim = null;
    this.blockT = 0; this.potionCd = 0; this.plan = {}; this.dodgeCd = 0; this.lastBody = null; this.black = new Map(); this.stuckT = 0; this.stuckChk = 0; this.lx = 0; this.ly = 0; this.wiggle = 0; this.curGoalId = null;
  }

  think(match, dt) {
    const I = this.I, p = this.p, a = p.body;
    // clear edge flags each tick
    I.attackPressed = false; I.attackReleased = false; I.altPressed = false; I.dodge = false; I.interact = false; I.spell = false; I.spellNext = false; I.potion = false; I.potionNext = false; I.swap = false; I.ability2 = false; I.turn = 0;
    if (!a || a.removed) { I.fwd = I.strafe = 0; I.attack = false; return I; }
    if (a !== this.lastBody) { this.lastBody = a; this.nav = new Nav(); this.timer = 0; this.goal = null; this.atkPhase = 'idle'; I.attack = false; I.alt = false; }
    this.potionCd -= dt; this.dodgeCd -= dt; this.timer -= dt;
    const w = match.world;
    const due = this.timer <= 0;
    if (due) this.timer = this.sk.think * this.rng.float(0.8, 1.2);
    switch (a.type) {
      case 'hero': this.heroThink(match, w, a, dt, due); break;
      case 'ghost': if (due) this.ghostThink(match, w, a, dt); this.ghostMove(match, w, a, dt); break;
      case 'trapctl': this.trapThink(match, w, a, dt, due); break;
      case 'monster': case 'bosspart': { const m = monsterAI(match, w, a, dt, this.sk); Object.assign(I, m); break; }
      default: break;
    }
    return I;
  }

  // ---------------- attack input simulation (tap / charge) ----------------
  driveAttack(dt, wantAttack, heavy, lvl) {
    const I = this.I;
    if (lvl < 3) { I.attack = wantAttack; return; }
    switch (this.atkPhase) {
      case 'idle': if (wantAttack) { this.atkPhase = 'hold'; this.atkT = heavy ? 0.5 : 0.06; I.attack = true; } else I.attack = false; break;
      case 'hold': I.attack = true; this.atkT -= dt; if (this.atkT <= 0) { I.attack = false; I.attackReleased = true; this.atkPhase = 'wait'; this.atkT = 0.12; } break;
      case 'wait': I.attack = false; this.atkT -= dt; if (this.atkT <= 0) this.atkPhase = 'idle'; break;
    }
  }

  aimAt(a, tx, ty, err = this.sk.aimErr) {
    const ang = Math.atan2(ty - a.y, tx - a.x);
    this.I.aimAngle = ang + (this.noise || 0);
    return ang;
  }

  // ---------------- HERO ----------------
  isBlack(id, now) { const e = this.black.get(id); return e !== undefined && e > now; }
  heroThink(match, w, a, dt, due) {
    const I = this.I, h = a.hero, sk = this.sk;
    const boss = w.kind === 'boss';
    // stuck detection: intending to move but not moving
    this.stuckChk += dt;
    if (this.stuckChk >= 0.6) {
      const moved = dist(a.x, a.y, this.lx, this.ly); this.lx = a.x; this.ly = a.y; this.stuckChk = 0;
      if ((Math.abs(I.fwd) + Math.abs(I.strafe)) > 0.5 && moved < 0.12 && !a.atk) this.stuckT += 0.6; else this.stuckT = 0;
      if (this.stuckT >= 1.8) { this.stuckT = 0; if (this.curGoalId != null) this.black.set(this.curGoalId, w.time + 40); this.nav.path = null; this.wiggle = 0.7; this.wiggleDir = this.rng.chance(0.5) ? 1 : -1; }
    }
    if (this.wiggle > 0) { this.wiggle -= dt; I.strafe = this.wiggleDir; I.fwd = -0.3; }
    if (due) { this.noise = this.rng.float(-sk.aimErr, sk.aimErr); this.decideHero(match, w, a, dt); }
    // fight execution each tick
    const t = this.plan.target;
    if (t && !t.dead && !t.removed) {
      const d = dist(a.x, a.y, t.x, t.y);
      const ang = Math.atan2(t.y - a.y, t.x - a.x);
      const def = WEAPONS[currentWeapon(a).id];
      const lvl = a.ffa ? 10 : h.level;
      const off = Math.abs(angleDiff(ang, a.angle));
      let want = false;
      if (def.kind === 'ranged') want = w.hasLOS(a.x, a.y, t.x, t.y, false) && off < 0.3 && d < 12;
      else want = d < def.reach + t.r + 0.15 && off < 0.4;
      if (this.plan.wantHeavy === undefined) this.plan.wantHeavy = this.rng.chance(sk.heavy) && lvl >= 3;
      this.driveAttack(dt, want && !a.blocking, this.plan.wantHeavy && d > 0.6, lvl);
      if (this.atkPhase === 'idle' && want) { /* new choice each swing */ this.plan.wantHeavy = undefined; }
    } else { this.driveAttack(dt, !!this.plan.propWant, false, h.level); }
    // reactive: dodge/block per tick (only when threatened)
    this.reactive(match, w, a, dt);
  }

  reactive(match, w, a, dt) {
    const I = this.I, sk = this.sk, lvl = a.ffa ? 10 : a.hero.level;
    let threat = null;
    for (const e of w.actors) {
      if (e.dead || !e.atk || e.atk.phase > 0 || !hostile(w, e, e.player, a)) continue;
      const d = dist(a.x, a.y, e.x, e.y);
      const reach = e.atk.ab.reach || e.atk.ab.radius || 1.5;
      if (d < reach + 1.4) { threat = e; break; }
    }
    if (threat) {
      const el = threat.atk.t;
      if (el > sk.react * 0.4 && this.dodgeCd <= 0 && lvl >= 5 && a.dodgeCd <= 0 && !a.atk && this.rng.chance(sk.dodge * 0.12)) {
        I.dodge = true; this.dodgeCd = 1.0;
        const dx = a.x - threat.x, dy = a.y - threat.y;
        const px = -dy, py = dx; const s = this.rng.chance(0.5) ? 1 : -1;
        moveDir(I, a, px * s + dx * 0.5, py * s + dy * 0.5);
      } else if (lvl >= 6 && this.rng.chance(sk.block * 0.15)) { I.alt = true; this.blockT = 0.4; }
    }
    if (this.blockT > 0) { this.blockT -= dt; if (this.blockT <= 0) I.alt = false; }
    if (!threat && this.blockT <= 0) I.alt = false;
    // potion
    if (a.hp < a.maxHp * 0.36 && this.potionCd <= 0) {
      const ids = Object.keys(a.hero.potions).filter((k) => a.hero.potions[k] > 0 && (k === 'health' || k === 'greater'));
      if (ids.length) { a.hero.potionSel = ids.includes('greater') && a.maxHp - a.hp > 80 ? 'greater' : ids[0]; I.potion = true; this.potionCd = 1.2; }
    }
  }

  decideHero(match, w, a, dt) {
    const I = this.I, h = a.hero, sk = this.sk;
    const lvl = a.ffa ? 10 : h.level;
    const boss = w.kind === 'boss';
    // enemies
    let enemies = [];
    for (const e of w.actors) {
      if (e.dead || e.removed || !hostile(w, a, a.player, e)) continue;
      if (e.core && !(w.boss && w.boss.fighting)) continue;
      const d = dist(a.x, a.y, e.x, e.y);
      if (match.phase === 'opening' || (d < 14 && (w.hasLOS(a.x, a.y, e.x, e.y, false) || d < 5))) enemies.push({ e, d });
    }
    enemies.sort((p, q) => p.d - q.d);
    const def = WEAPONS[currentWeapon(a).id];
    if (enemies.length) {
      let tgt = enemies[0].e;
      if (boss) { const nonCore = enemies.filter((x) => !x.e.core); if (nonCore.length) { const exp = w.boss.exposedT > 0 ? enemies.find((x) => x.e.core) : null; tgt = exp ? exp.e : nonCore[0].e; } }
      else { // prefer the weakest nearby
        const near = enemies.filter((x) => x.d < enemies[0].d + 1.5); near.sort((p, q) => p.e.hp - q.e.hp); tgt = near[0].e;
      }
      this.plan.target = tgt;
      const d = dist(a.x, a.y, tgt.x, tgt.y);
      this.aimAt(a, tgt.x, tgt.y);
      const reach = def.reach + tgt.r;
      const moveDirN = this.nav.dir(w, a, tgt.x, tgt.y, sk.think, {});
      if (def.kind === 'ranged') {
        const want = 5.5;
        if (d < 3.2) moveDir(I, a, a.x - tgt.x, a.y - tgt.y);
        else if (d > want + 2) { if (moveDirN) moveToward(I, a, moveDirN); }
        else { moveDir(I, a, -(tgt.y - a.y) * (this.strafeDir || 1), (tgt.x - a.x) * (this.strafeDir || 1)); }
      } else if (boss) {
        // keep out of big attack ranges: circle
        const threatened = enemies.some((x) => x.e.atk && x.d < (x.e.atk.ab.radius || x.e.atk.ab.reach || 2) + 1.8);
        if (threatened && d < 4) moveDir(I, a, a.x - tgt.x, a.y - tgt.y);
        else if (d > reach + 0.3 && moveDirN) moveToward(I, a, moveDirN);
        else moveDir(I, a, -(tgt.y - a.y) * (this.strafeDir || 1) * 0.4, (tgt.x - a.x) * (this.strafeDir || 1) * 0.4);
      } else {
        if (d > reach * 0.8) { if (moveDirN) moveToward(I, a, moveDirN); }
        else { I.fwd = 0; I.strafe = (this.strafeDir || 1) * 0.5; }
      }
      if (this.rng.chance(0.12)) this.strafeDir = this.rng.chance(0.5) ? 1 : -1;
      I.sprint = false;
      // spells
      if (lvl >= 4 && !a.ffa && this.rng.chance(sk.spell * 0.5)) {
        const id = h.spells[h.spellIdx];
        if (id) {
          const sp = SPELLS[id];
          const ok = a.mana >= sp.cost && !a.atk && (id === 'ward' ? a.hp < a.maxHp * 0.7 && !a.st.ward : id === 'frost' ? enemies.filter((x) => x.d < 3.2).length >= 2 : id === 'sight' ? false : id === 'drain' ? a.hp < a.maxHp * 0.8 && d < 4.5 : d < 9);
          if (ok) I.spell = true;
        }
        if (h.spells[0] && h.spells[1] && this.rng.chance(0.15)) I.spellNext = true;
      }
      // mana potion
      if (a.mana < 8 && h.potions.clarity && this.potionCd <= 0) { h.potionSel = 'clarity'; I.potion = true; this.potionCd = 1.5; }
      // buff potions before big fights
      if (enemies.length >= 3 && this.potionCd <= 0) { for (const k of ['might', 'ironskin', 'speed']) if (h.potions[k] && !a.st[k]) { h.potionSel = k; I.potion = true; this.potionCd = 2; break; } }
      return;
    }
    this.plan.target = null;
    if (match.phase === 'opening') { I.fwd = 0; I.strafe = 0; return; }
    this.exploreHero(match, w, a, dt);
  }

  exploreHero(match, w, a, dt) {
    const I = this.I, h = a.hero, sk = this.sk;
    this.plan.propWant = false; this.plan.wantHeavy = undefined;
    const spec = w.spec;
    const lvl = a.ffa ? 10 : h.level;
    I.aimAngle = undefined;
    // boss pre-stage
    if (w.kind === 'boss') {
      const ar = spec.arena;
      if (match.bossStage === 'pre') {
        if (a.hp < a.maxHp * 0.97) { this.walkTo(w, a, spec.preRoom.cx + 0.5, spec.preRoom.cy + 0.5, sk); return; }
        this.walkTo(w, a, 23.5, ar.y + ar.h - 3, sk); return;
      }
      this.walkTo(w, a, this.plan.bossX || 23.5, this.plan.bossY || 20, sk); return;
    }
    const room = w.rooms[a.room] || null;
    // potions maintenance
    if (a.hp < a.maxHp * 0.6 && a.hero.potions.health && room && room.locked === false && this.potionCd <= 0 && a.hp < a.maxHp * 0.45) { h.potionSel = 'health'; I.potion = true; this.potionCd = 1; }
    // 1. crystals in room
    if (room && room.crystals.some((c) => c.prop.alive)) {
      const c = room.crystals.filter((c) => c.prop.alive).sort((p, q) => dist2(a.x, a.y, p.x, p.y) - dist2(a.x, a.y, q.x, q.y))[0];
      this.attackProp(w, a, c.prop, sk); return;
    }
    // 2. pickups
    let best = null, bd = 100;
    this.curGoalId = null;
    for (const p of w.pickups) { if (p.dead || p.kind === 'ecto' || this.isBlack(p.id, w.time)) continue; if (p.kind === 'heart' && a.hp > a.maxHp * 0.92) continue; const d = dist2(a.x, a.y, p.x, p.y); if (d < bd && d < 64) { bd = d; best = p; } }
    if (best) { this.curGoalId = best.id; this.walkTo(w, a, best.x, best.y, sk); return; }
    // 3. chest in current room
    const chest = w.props.find((p) => p.kind === 'chest' && p.alive && !p.opened && !this.isBlack(p.id, w.time) && p.room === a.room && (!p.locked || h.artifacts.includes('vaultkey') || h.keys > 0));
    if (chest) { this.curGoalId = chest.id; this.interactWith(w, a, chest, sk); return; }
    // 4. shop
    if (room && room.type === 'store') {
      const stands = w.props.filter((p) => p.kind === 'shop' && !p.sold && p.alive);
      const pick = this.pickPurchase(a, stands);
      if (pick) { this.interactWith(w, a, pick, sk); return; }
    }
    // 5. smash scenery in locked room (waiting on ghosts) or nearby for gold
    if (room && room.locked) {
      const st = match.roomState(w, room);
      const pr = w.props.filter((p) => p.alive && p.destructible && p.room === a.room).sort((p, q) => dist2(a.x, a.y, p.x, p.y) - dist2(a.x, a.y, q.x, q.y))[0];
      if (pr && st.pents + st.mons > 0) { this.attackProp(w, a, pr, sk); return; }
      // wait near center facing the door
      this.walkTo(w, a, room.cx + 0.5, room.cy + 0.5, sk);
      if (dist(a.x, a.y, room.cx + 0.5, room.cy + 0.5) < 1.5) { I.fwd = 0; I.strafe = 0; I.turn = 0.02; }
      return;
    }
    // 6. goal room
    const goal = this.chooseGoal(match, w, a);
    if (goal.prop && goal.kind === 'portal') { this.interactWith(w, a, goal.prop, sk); return; }
    this.walkTo(w, a, goal.x, goal.y, sk);
  }

  chooseGoal(match, w, a) {
    const spec = w.spec, h = a.hero, rooms = w.rooms;
    // portal at level 10
    if (h.level >= MAX_LEVEL && match.bossAttempts < 3 && spec.portal) { const pr = spec.portal.portalProp; return { kind: 'portal', x: spec.portal.cx + 0.5, y: spec.portal.cy + 1.4, prop: pr }; }
    // shop if enough gold
    if (spec.store && !spec.store.entered && h.gold >= 60) return { kind: 'room', x: spec.store.cx + 0.5, y: spec.store.cy + 0.5 };
    // unentered rooms by graph distance
    const cur = a.room >= 0 ? a.room : (this.lastRoom ?? 0); this.lastRoom = cur;
    const dist = new Array(rooms.length).fill(-1); dist[cur] = 0; const q = [cur];
    while (q.length) { const u = q.shift(); for (const v of rooms[u].links) if (dist[v] < 0) { dist[v] = dist[u] + 1; q.push(v); } }
    let best = null, bd = 99;
    for (const r of rooms) {
      if (r.entered || r.id === spec.exit.id) continue;
      if (r.type === 'store' && h.gold < 60) continue;
      if (dist[r.id] >= 0 && dist[r.id] < bd) { bd = dist[r.id]; best = r; }
    }
    if (best) return { kind: 'room', x: best.cx + 0.5, y: best.cy + 0.5 };
    // exit
    const t = spec.exit.trapdoor;
    return { kind: 'exit', x: t.x, y: t.y };
  }

  pickPurchase(a, stands) {
    const h = a.hero; let best = null, bs = 0;
    for (const s of stands) {
      const it = s.item; if (it.price > h.gold) continue;
      let score = 0;
      if (it.type === 'potion') score = (it.id === 'health' ? 6 : it.id === 'greater' ? 7 : 3) / (1 + (h.potions[it.id] || 0));
      else if (it.type === 'weapon') score = it.dmg > currentWeapon(a).dmg * 1.2 && WEAPONS[it.id].kind === 'melee' ? 8 : 1;
      else if (it.type === 'artifact') score = h.artifacts.includes(it.id) ? 0 : ({ stoneheart: 8, ankh: 9, bloodstone: 7, boots: 6, canopic: 5, crown: 4, lantern: 3 }[it.id] || 2);
      else if (it.type === 'spell') score = h.spells.includes(it.id) ? 0 : (h.level >= 4 ? 6 : 2);
      if (score > bs) { bs = score; best = s; }
    }
    return bs >= 3 ? best : null;
  }

  walkTo(w, a, tx, ty, sk) {
    const I = this.I;
    const d = this.nav.dir(w, a, tx, ty, sk.think);
    if (!d) { I.fwd = 0; I.strafe = 0; return false; }
    if (dist(a.x, a.y, tx, ty) < 0.5) { I.fwd = 0; I.strafe = 0; return true; }
    I.aimAngle = Math.atan2(d.y, d.x);
    moveToward(I, a, d);
    I.sprint = a.stamina > 30 && dist(a.x, a.y, tx, ty) > 6;
    return false;
  }
  interactWith(w, a, prop, sk) {
    const I = this.I;
    const d = dist(a.x, a.y, prop.x, prop.y);
    if (d > 0.95) { this.walkTo(w, a, prop.x, prop.y, sk); return; }
    I.fwd = 0; I.strafe = 0; this.aimAt(a, prop.x, prop.y);
    if (Math.abs(angleDiff(Math.atan2(prop.y - a.y, prop.x - a.x), a.angle)) < 0.4 && (this.iCd = (this.iCd || 0) - 1) <= 0) { I.interact = true; this.iCd = 10; }
  }
  attackProp(w, a, prop, sk) {
    const I = this.I;
    const d = dist(a.x, a.y, prop.x, prop.y);
    const def = WEAPONS[currentWeapon(a).id];
    if (d > Math.max(0.9, def.reach - 0.15)) { this.walkTo(w, a, prop.x, prop.y, sk); return; }
    I.fwd = 0; I.strafe = 0; const ang = this.aimAt(a, prop.x, prop.y);
    this.plan.propWant = Math.abs(angleDiff(ang, a.angle)) < 0.3;
  }

  // ---------------- GHOST ----------------
  ghostMove(match, w, g, dt) {
    const I = this.I;
    if (this.gTarget && this.gTarget.x !== undefined) {
      const tx = this.gTarget.x, ty = this.gTarget.y, d = dist(g.x, g.y, tx, ty);
      if (d > 0.35) {
        const dx = (tx - g.x) / d, dy = (ty - g.y) / d;
        // ghosts pass doors but not walls: use path
        const nd = this.nav.dir(w, g, tx, ty, dt, { ghost: true });
        const dir = nd || { x: dx, y: dy };
        I.aimAngle = Math.atan2(dir.y, dir.x);
        moveToward(I, g, dir);
        I.sprint = d > 4;
      } else { I.fwd = 0; I.strafe = 0; }
    } else { I.fwd = 0; I.strafe = 0; }
  }

  ghostThink(match, w, g, dt) {
    const I = this.I, p = this.p, sk = this.sk;
    const hero = match.heroActor();
    if (!hero || w.kind === 'boss') { this.gTarget = hero ? { x: hero.x, y: hero.y } : null; return; }
    if (p.spectator && match.phase === 'opening') { this.gTarget = null; return; }
    this.gDelay = (this.gDelay ?? sk.ghostDelay);
    const hroom = w.rooms[hero.room] || null;
    const cands = possessableList(w, hero);
    const claimOK = (pr) => !pr.claim || pr.claim.p === p || pr.claim.until < w.time || !pr.claim.p.body || pr.claim.p.body.type !== 'ghost';
    const near = (pr, r) => dist(hero.x, hero.y, pr.x, pr.y) < r;
    // pentagram: hero in same room or close
    let target = null;
    const pents = cands.filter((c) => c.kind === 'pent' && claimOK(c) && (c.room === hero.room || near(c, 13)) && !(w.rooms[c.room] && w.rooms[c.room].type === 'store'));
    pents.sort((a, b) => dist2(g.x, g.y, a.x, a.y) - dist2(g.x, g.y, b.x, b.y));
    const monsterCount = w.actors.filter((a) => !a.dead && a.type === 'monster' && a.player === p).length;
    if (pents.length) {
      target = pents[0];
      // easy bots hesitate
      if (this.gDelay > 0) { this.gDelay -= sk.think; }
    }
    // statue when hero in room and no pentagrams
    if (!target) {
      const st = cands.filter((c) => c.kind === 'statue' && claimOK(c) && c.room === hero.room && hero.room >= 0);
      if (st.length && hero.hp > hero.maxHp * 0.3 && this.rng.chance(0.5)) target = st[0];
    }
    // traps in hero's room
    if (!target && hroom) {
      const traps = cands.filter((c) => c.kind === 'trap' && claimOK(c) && c.room === hero.room);
      traps.sort((a, b) => dist2(hero.x, hero.y, a.x, a.y) - dist2(hero.x, hero.y, b.x, b.y));
      if (traps.length) target = traps[0];
    }
    // slime: if ecto available and hero in a room (drop beside hero)
    if (!target && p.ghost.ecto >= SLIME_COST && hroom && hroom.type !== 'store') {
      const slimes = w.actors.filter((a) => !a.dead && a.defId === 'slime' && a.player === p).length;
      if (slimes < 2) { this.gTarget = { x: hero.x + Math.cos(hero.angle) * 3.2, y: hero.y + Math.sin(hero.angle) * 3.2, slime: true }; if (dist(g.x, g.y, this.gTarget.x, this.gTarget.y) < 1.2) { I.ability2 = true; g.angle = Math.atan2(hero.y - g.y, hero.x - g.x); } return; }
    }
    // ectoplasm collection
    if (!target) {
      const ec = w.pickups.filter((pk) => !pk.dead && pk.kind === 'ecto').sort((a, b) => dist2(g.x, g.y, a.x, a.y) - dist2(g.x, g.y, b.x, b.y))[0];
      if (ec && dist2(hero.x, hero.y, ec.x, ec.y) < 400) { this.gTarget = { x: ec.x, y: ec.y }; return; }
      // haunt props near hero
      const props = w.props.filter((pr) => pr.alive && pr.kind === 'scenery' && pr.def.haunt && !pr.hauntedT && near(pr, 9) && !(w.rooms[pr.room] && w.rooms[pr.room].type === 'store')).sort((a, b) => dist2(g.x, g.y, a.x, a.y) - dist2(g.x, g.y, b.x, b.y));
      if (props.length && (this.rng.chance(0.55) || props[0].def.haunt === 'chandelier')) { target = props[0]; }
    }
    if (!target) { // hover near hero, near unused content
      this.gTarget = { x: hero.x - Math.cos(hero.angle) * 3, y: hero.y - Math.sin(hero.angle) * 3 };
      if (!w.canStand(this.gTarget.x, this.gTarget.y, 0.25, true)) this.gTarget = { x: hero.x, y: hero.y };
      return;
    }
    target.claim = { p, until: w.time + 12 };
    this.gTarget = { x: target.x, y: target.y };
    const d = dist(g.x, g.y, target.x, target.y);
    if (d < (target.kind === 'pent' ? 1.0 : 1.6) && this.gDelay <= 0 || d < 0.6) {
      if (target.kind === 'pent') { this.gDelay = sk.ghostDelay; }
      I.interact = true;
    }
  }

  // ---------------- TRAP ----------------
  trapThink(match, w, proxy, dt, due) {
    const I = this.I, trap = proxy.trap, hero = match.heroActor();
    I.attack = false; I.attackPressed = false; I.interact = false;
    this.trapT = (this.trapT || 0) + dt;
    if (!hero) return;
    const td = trap.tdef;
    const dx = hero.x - trap.x, dy = hero.y - trap.y, d = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    if (trap.wall || trap.trap === 'saw') I.aimAngle = ang; else I.aimAngle = undefined;
    if (I.aimAngle !== undefined) { const da = angleDiff(ang, proxy.angle); I.turn = clamp(da, -0.08, 0.08); I.aimAngle = undefined; }
    let fire = false;
    if (trap.state === 'idle') {
      switch (trap.trap) {
        case 'spikes': fire = d < 1.35; break;
        case 'crusher': fire = d < 1.15; break;
        case 'flame': fire = d < td.range - 0.4 && Math.abs(angleDiff(ang, proxy.angle)) < 0.25 && w.hasLOS(trap.x, trap.y, hero.x, hero.y, false); break;
        case 'darts': fire = d < 12 && Math.abs(angleDiff(ang, proxy.angle)) < 0.14 && w.hasLOS(trap.x, trap.y, hero.x, hero.y, false); break;
        case 'saw': fire = d < 4.5 && Math.abs(hero.y - trap.y) < 1.6; break;
      }
    }
    if (fire && this.rng.chance(this.sk.react > 0.3 ? 0.4 : 0.9)) { I.attack = true; I.attackPressed = true; this.trapT = 0; }
    if ((this.trapT > 26 && d > 8) || hero.room !== trap.room && this.trapT > 6) { I.interact = true; proxy.holdInteract = 1; }
  }

  // ---------------- UPGRADE ----------------
  upgradeDecide(match) {
    const p = this.p;
    for (let guard = 0; guard < 8; guard++) {
      // evolve the lowest-tier affordable monster first
      const idxs = [0, 1, 2].sort((a, b) => p.ghost.tiers[a] - p.ghost.tiers[b]);
      let did = false;
      for (const i of idxs) if (match.canEvolve(p, i)) { match.evolve(p, i); did = true; break; }
      if (!did) break;
    }
  }
}

// ---------------- monster AI ----------------
export function monsterAI(match, w, a, dt, sk) {
  const I = a.aiIntent || (a.aiIntent = blank());
  I.attack = false; I.alt = false; I.spell = false; I.ability2 = false; I.interact = false; I.attackPressed = false; I.altPressed = false;
  if (a.core || a.dead) { I.fwd = I.strafe = 0; return I; }
  sk = sk || SKILL.normal;
  const ai = a.ai || (a.ai = { t: 0, nav: new Nav(), strafe: grng.next() < 0.5 ? 1 : -1, awake: false, tgt: null, sT: 0 });
  ai.t -= dt; ai.sT -= dt;
  if (ai.t <= 0) {
    ai.t = 0.12 + grng.next() * 0.06;
    // pick target
    let best = null, bd = 1e9;
    for (const e of w.actors) {
      if (e.dead || e.removed || !hostile(w, a, a.player, e) || e.core) continue;
      if (e.st && e.st.shadow > 0 && dist(a.x, a.y, e.x, e.y) > 3) continue;
      const d = dist2(a.x, a.y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    ai.tgt = best;
    if (best) {
      const d = Math.sqrt(bd);
      if (!ai.awake && (w.kind === 'boss' || (d < 14 && (w.hasLOS(a.x, a.y, best.x, best.y, false) || a.room === best.room)))) ai.awake = true;
    }
  }
  const t = ai.tgt;
  if (!t || t.dead || !ai.awake) { I.fwd = 0; I.strafe = 0; I.aimAngle = undefined; return I; }
  const dx = t.x - a.x, dy = t.y - a.y, d = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const los = w.hasLOS(a.x, a.y, t.x, t.y, false);
  I.aimAngle = ang + (ai.noise || 0);
  if (ai.sT <= 0) { ai.sT = 0.6 + grng.next(); ai.noise = (grng.next() - 0.5) * sk.aimErr * 2; if (grng.next() < 0.3) ai.strafe *= -1; }
  const abs = a.abilities;
  // choose ability
  let use = -1;
  for (let i = abs.length - 1; i >= 0; i--) {
    const ab = abs[i];
    if (!abilityReady(a, ab) || a.atk || a.st.stun > 0) continue;
    const off = Math.abs(angleDiff(ang, a.angle));
    let ok = false;
    switch (ab.kind) {
      case 'melee': ok = d < ab.reach + t.r + 0.25 && off < 0.5; break;
      case 'aoe': ok = d < (ab.radius || 2) * 0.8 + t.r && (i === 0 || grng.next() < 0.06); break;
      case 'leap': ok = los && d > 1.6 && d < ab.dist * 0.9 && off < 0.3 && grng.next() < 0.08; break;
      case 'proj': case 'curse': ok = los && d < (ab.range || 10) * 0.95 && off < 0.3 && (i === 0 || grng.next() < 0.12); break;
      case 'scream': ok = d < ab.range * 0.85 && off < 0.4 && grng.next() < 0.08; break;
      case 'beam': ok = los && d < ab.range * 0.9 && off < 0.25 && grng.next() < 0.1; break;
      case 'summon': ok = d < 12 && grng.next() < 0.1; break;
      case 'buff': ok = d < 10 && w.actors.some((x) => x !== a && !x.dead && x.team === a.team && x.type === 'monster' && dist(a.x, a.y, x.x, x.y) < ab.radius) && grng.next() < 0.05; break;
      case 'explode': ok = d < ab.radius * 0.7 && (a.hp < a.maxHp * 0.45 || grng.next() < 0.02); break;
    }
    if (ok) { use = i; break; }
  }
  if (use === 0) I.attack = true; else if (use === 1) I.alt = true; else if (use >= 2) I.spell = true;
  // movement
  const ranged = a.def && a.def.ranged || (abs[0] && (abs[0].kind === 'proj'));
  const moveDirN = ai.nav.dir(w, a, t.x, t.y, 0.016, {});
  if (a.type === 'bosspart') {
    const want = abs[0].kind === 'melee' || abs[0].kind === 'aoe' || abs[0].kind === 'leap' ? 2.0 : 6;
    if (d > want + 0.8 && moveDirN) moveToward(I, a, moveDirN);
    else if (d < want - 0.8) moveDir(I, a, -dx, -dy);
    else { moveDir(I, a, -dy * ai.strafe, dx * ai.strafe); }
    return I;
  }
  if (ranged) {
    const want = (abs[0].range || 9) * 0.6;
    if (d < want * 0.6) moveDir(I, a, -dx, -dy);
    else if (d > want || !los) { if (moveDirN) moveToward(I, a, moveDirN); else { I.fwd = 0; I.strafe = 0; } }
    else moveDir(I, a, -dy * ai.strafe, dx * ai.strafe);
  } else if (a.atk && a.atk.phase < 2 && a.atk.ab.kind !== 'leap') { I.fwd = 0; I.strafe = 0; }
  else {
    const reach = abs[0].reach || 1.0;
    if (d > reach * 0.85 + t.r) { if (moveDirN) moveToward(I, a, moveDirN); }
    else { I.fwd = 0.1; I.strafe = ai.strafe * 0.4; }
  }
  return I;
}
