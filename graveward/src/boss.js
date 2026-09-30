// Boss fights: one shared HP pool, three ghost-controlled parts, weak-spot rules, phase changes.
import { clamp, dist, TAU } from './util.js';
import { BOSSES } from './data.js';
import { dealDamage, hostile, spawnPickup, spawnMonster, spawnHazard } from './combat.js';

export class Boss {
  constructor(match, w, id, ghostPlayers, attempt) {
    this.match = match; this.w = w; this.id = id; this.def = BOSSES[id];
    const missing = Math.max(0, 3 - ghostPlayers.length);
    this.missing = missing;
    this.maxHp = Math.round(this.def.hp * (1 + 0.28 * missing));
    this.hp = this.maxHp; this.phase = 1; this.dormant = true; this.fighting = false;
    this.exposedT = 0; this.rockT = 6; this.heartT = 20; this.time = 0; this.dead = false; this.introT = 0;
    const ar = w.spec.arena;
    this.cx = ar.x + ar.w / 2; this.cy = ar.y + 8.5;
    this.parts = [];
    // decor core (body)
    this.core = w.spawnActor({ type: 'bosspart', core: true, x: this.cx, y: ar.y + 3.2, r: 1.5, h: 4.8, hp: 1e9, maxHp: 1e9, team: 'ghost', sprite: this.def.sprite, abilities: [], ctl: 'none', giant: true, speed: 0, name: this.def.name, eyeZ: 1, w: 6, bossId: id, ethereal: false });
    this.def.parts.forEach((pd, i) => {
      const part = w.spawnActor({
        type: 'bosspart', bossPart: pd, partIdx: i, x: this.cx + pd.pos[0] * 1.15, y: ar.y + 4 + (pd.pos[1] + 5) * 0.9 + 3.5, r: pd.r, h: pd.h, hp: 1e9, maxHp: 1e9, team: 'ghost', sprite: pd.sprite, abilities: pd.abilities, speed: pd.speed,
        giant: true, name: pd.name, ctl: 'ai', flipSprite: !!pd.flip, eyeZ: pd.h * 0.5, sw: pd.w, sh: pd.h, dmgMul: 1 + 0.16 * missing, knockRes: true, invuln: 1e6, locked: true, armor: id === 'mother' && i < 2 ? 220 : 0,
      });
      part.turnRate = 4.5;
      part.angle = Math.PI / 2;
      this.parts.push(part);
    });
    this.core.angle = Math.PI / 2;
    ghostPlayers.forEach((p, i) => {
      const part = this.parts[i % 3];
      part.player = p; part.ctl = 'player'; p.body = part; p.role = 'ghost'; p.ghostForm = null;
    });
    // ai parts for unassigned
    for (let i = ghostPlayers.length; i < 3; i++) { this.parts[i].ctl = 'ai'; this.parts[i].player = null; }
    // bot ghost players control by their brain via bosspart type
  }

  startFight() {
    this.fighting = true; this.dormant = false;
    for (const p of this.parts) { p.invuln = 0; p.locked = false; }
    this.w.emit('bossroar', { boss: this });
  }

  update(dt) {
    if (this.dead) return;
    this.time += dt;
    const w = this.w;
    if (this.exposedT > 0) this.exposedT -= dt;
    if (!this.fighting) return;
    const hero = this.match.heroActor();
    // phases
    const frac = this.hp / this.maxHp;
    const ph = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
    if (ph > this.phase) this.enterPhase(ph);
    // rock fall (phase 2+)
    if (this.phase >= 2 && hero) {
      this.rockT -= dt;
      if (this.rockT <= 0) {
        this.rockT = this.phase === 2 ? 3.6 : 2.4;
        const n = this.phase === 2 ? 1 : 2;
        for (let i = 0; i < n; i++) {
          const rx = clamp(hero.x + this.match.rng.float(-3.2, 3.2), 9.5, 36.5), ry = clamp(hero.y + this.match.rng.float(-3.2, 3.2), 7.5, 28.5);
          w.hazards.push({ id: Math.random(), kind: 'rock', x: rx, y: ry, r: 1.4, t: 1.4, warn: 1.4, age: 0, acc: 0, owner: null, perm: false });
        }
      }
    }
    // resolve rock hazards
    for (const h of w.hazards) {
      if (h.kind !== 'rock' || h.done) continue;
      if (h.age >= h.warn) {
        h.done = true; h.t = 0.3;
        for (const t of w.actorsInRadius(h.x, h.y, h.r, (t) => t.type === 'hero')) dealDamage(w, t, 22 + this.phase * 4, { actor: this.parts[0], player: null, kind: 'env' }, { type: 'aoe', stun: 0.3, noKnock: true, bypassBlock: true });
        w.emit('rockimpact', { x: h.x, y: h.y });
      }
    }
    // mercy hearts
    this.heartT -= dt;
    if (this.heartT <= 0 && hero) { this.heartT = 22; spawnPickup(w, 'heart', this.cx + this.match.rng.float(-6, 6), this.cy + this.match.rng.float(4, 12), { amount: 20 }); }
  }

  enterPhase(n) {
    this.phase = n;
    this.match.setBanner('PHASE ' + n, this.def.name, '#e04030', 2);
    this.w.emit('bossphase', { phase: n });
    for (const p of this.parts) { p.speed *= 1.15; p.dmgMul *= 1.12; for (const k in p.cds) p.cds[k] = 0; }
    if (this.id === 'jackal' && n === 3) for (let i = 0; i < 2; i++) spawnMonster(this.w, 'minimummy', 0, this.cx + (i ? 4 : -4), this.cy + 6, null, { ctl: 'ai', depthScale: true });
    if (this.id === 'colossus') this.exposedT = Math.max(this.exposedT, 3);
    if (this.id === 'sand') { // the floor collapses into quicksand
      const ar = this.w.spec.arena;
      for (let i = 0; i < 2 + n; i++) {
        const x = ar.x + 4 + this.match.rng.float(0, ar.w - 8), y = ar.y + 8 + this.match.rng.float(0, ar.h - 12);
        this.w.hazards.push({ id: Math.random(), kind: 'pit', x, y, r: 2.0, t: 1e9, perm: true, age: 0, acc: 0, owner: null });
      }
      this.w.emit('rockimpact', { x: this.cx, y: this.cy });
    }
    if (this.id === 'heart') for (let i = 0; i < 3; i++) this.w.hazards.push({ id: Math.random(), kind: 'poison', x: this.cx + this.match.rng.float(-7, 7), y: this.cy + this.match.rng.float(2, 12), r: 1.6, t: 25, dps: 6, owner: this.parts[0], age: 0, acc: 0 });
  }

  onSlam(part, ab) {
    if ((this.id === 'sand' || this.id === 'heart') && ab.exposes) { this.exposedT = this.id === 'sand' ? 3.0 : 3.5; this.w.emit('bossexpose', {}); }
    if (this.id === 'colossus' && ab.exposes) { this.exposedT = 4.0; this.w.emit('bossexpose', {}); }
    if (this.id === 'mother' && ab.exposes) { /* arms unwrapped by damage, not slams */ }
  }

  damagePart(part, dmg, src, opts) {
    if (this.dead || this.dormant) return 0;
    let mul = 1;
    if (part.core) {
      mul = 0.4;
      if (this.id === 'colossus') mul = this.exposedT > 0 ? 3.0 : 0.3;
      if (this.id === 'mother') mul = this.armsUnwrapped() ? 2.5 : 0.25;
      if (this.id === 'heart') mul = this.exposedT > 0 ? 3.0 : 0.35;
      if (this.id === 'sand') mul = 0.3;
      if (this.id === 'jackal') mul = 0.5;
    } else {
      if (this.id === 'colossus') mul = part.bossPart.id === 'face' ? 1.0 : 0.6;
      if (this.id === 'jackal') mul = part.atk && part.atk.phase < 2 ? 2.0 : 1.0;
      if (this.id === 'sand') mul = part.bossPart.id === 'head' ? (this.exposedT > 0 ? 2.4 : 0.6) : 0.8;
      if (this.id === 'heart') mul = 0.6;
      if (this.id === 'mother') {
        if (part.bossPart.id === 'mouth') mul = this.armsUnwrapped() ? 1.4 : 1.0;
        else { // arms: chew through wrapping first
          if (part.armor > 0) { part.armor -= dmg; part.flash = 0.2; this.w.emit('hit', { x: part.x, y: part.y, target: part, amount: dmg, kind: 'proj', boss: true }); if (part.armor <= 0) { this.w.emit('unwrap', { x: part.x, y: part.y }); this.match.toast('An arm unwraps!', '#e0c080'); const over = -part.armor * 1.5; part.armor = 0; this.hp -= over; if (this.hp <= 0) this.defeat(); } return dmg; }
          mul = 1.5;
        }
      }
    }
    const dealt = dmg * mul;
    this.hp -= dealt; part.flash = 0.18; this.lastHitT = this.time;
    part.lastHit = { player: src.player, t: this.w.time };
    this.w.emit('hit', { x: part.x, y: part.y, target: part, amount: dealt, kind: opts.type || 'melee', boss: true, big: true, nx: opts.dx || 0, ny: opts.dy || 0 });
    if (this.hp <= 0) this.defeat();
    return dealt;
  }
  armsUnwrapped() { return this.parts.filter((p) => p.bossPart.id.endsWith('arm')).every((p) => p.armor <= 0); }

  defeat() {
    if (this.dead) return;
    this.dead = true; this.hp = 0;
    for (const p of this.parts.concat([this.core])) { p.dead = true; p.deadT = 0; p.anim = 'dead'; p.invuln = 0; }
    this.w.emit('bossdeath', { boss: this, x: this.cx, y: this.cy });
    // release ghost players
    for (const p of this.parts) if (p.player) { p.player.role = 'ghost'; }
    this.match.onBossDefeated();
  }

  onPartDeath() {}
}
