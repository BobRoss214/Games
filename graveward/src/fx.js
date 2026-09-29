// Visual effects: particles, persistent gore, per-viewer screen shake/flash. Purely presentational.
import { rgb, RNG, clamp, dist } from './util.js';

const R = new RNG(1234);
const rnd = (a, b) => a + Math.random() * (b - a);
const C = {
  blood: [rgb(150, 8, 16), rgb(190, 16, 24), rgb(110, 4, 12), rgb(220, 40, 40)],
  bone: [rgb(220, 210, 180), rgb(190, 176, 146), rgb(240, 232, 205)],
  ecto: [rgb(150, 240, 240), rgb(200, 255, 255), rgb(100, 200, 210)],
  fire: [rgb(255, 90, 20), rgb(255, 170, 40), rgb(255, 230, 120)],
  spark: [rgb(255, 240, 180), rgb(255, 200, 100)],
  dust: [rgb(130, 118, 96), rgb(96, 88, 72), rgb(160, 148, 120)],
  green: [rgb(80, 200, 60), rgb(140, 240, 90), rgb(50, 130, 40)],
  gold: [rgb(255, 210, 70), rgb(255, 240, 150), rgb(210, 160, 30)],
  frost: [rgb(160, 230, 255), rgb(220, 250, 255)],
  purple: [rgb(170, 90, 255), rgb(220, 170, 255)],
  red: [rgb(255, 60, 40), rgb(255, 130, 80)],
  gore: [rgb(140, 20, 30), rgb(200, 60, 70), rgb(230, 130, 120)],
};
const pick = (a) => a[(Math.random() * a.length) | 0];

export class FX {
  constructor(settings) {
    this.parts = []; this.ground = []; this.beams = []; this.settings = settings || { gore: 2 };
    this.views = new Map(); // player -> {shake, flash:[r,g,b], flashT, flashMax, chroma, hurt}
    this.splatBudget = 0; this.motes = [];
  }
  updateMotes(dt, cams, map) {
    const want = Math.min(140, cams.length * 55);
    while (this.motes.length < want) this.motes.push({ x: 1e9, y: 0, z: 0.5, ph: Math.random() * 6.28, sp: 0.02 + Math.random() * 0.05 });
    if (this.motes.length > want) this.motes.length = want;
    for (const m of this.motes) {
      m.ph += dt * 0.7;
      m.x += Math.sin(m.ph * 1.3) * m.sp * dt * 4; m.y += Math.cos(m.ph) * m.sp * dt * 4; m.z += Math.sin(m.ph * 0.6) * m.sp * dt * 2;
      let bad = m.x > 1e8 || m.z < 0.05 || m.z > 0.98;
      if (!bad) { let near = false; for (const c of cams) if ((c.x - m.x) ** 2 + (c.y - m.y) ** 2 < 60) { near = true; break; } if (!near || map.isWall(m.x | 0, m.y | 0)) bad = true; }
      if (bad && cams.length) {
        const c = cams[(Math.random() * cams.length) | 0], a = Math.random() * 6.283, r = 1 + Math.random() * 6.5;
        const nx = c.x + Math.cos(a) * r, ny = c.y + Math.sin(a) * r;
        if (!map.isWall(nx | 0, ny | 0)) { m.x = nx; m.y = ny; m.z = 0.1 + Math.random() * 0.8; }
      }
    }
  }
  goreMul() { return [0, 0.5, 1, 2.2][clamp(this.settings.gore | 0, 0, 3)]; }
  viewOf(p) { let v = this.views.get(p); if (!v) { v = { shake: 0, flashC: [255, 255, 255], flashT: 0, flashMax: 1, chroma: 0, hurt: 0, kick: 0 }; this.views.set(p, v); } return v; }
  shake(p, amt) { const v = this.viewOf(p); v.shake = Math.max(v.shake, amt); }
  flash(p, c, t) { const v = this.viewOf(p); v.flashC = c; v.flashT = t; v.flashMax = t; }
  shakeAll(match, amt, x, y, radius) {
    for (const p of match.players) {
      const b = p.body; if (!b) continue;
      const d = x === undefined ? 0 : dist(b.x, b.y, x, y);
      if (radius && d > radius) continue;
      this.shake(p, amt * (radius ? 1 - d / radius : 1));
    }
  }
  flashAll(match, c, t) { for (const p of match.players) this.flash(p, c, t); }

  add(o) { if (this.parts.length > 900) this.parts.splice(0, 60); this.parts.push(o); return o; }
  spray(x, y, z, n, cols, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = o.dir !== undefined ? o.dir + rnd(-(o.spread || 1), o.spread || 1) : rnd(0, 6.283), s = rnd(o.smin || 0.6, o.smax || 3.2);
      this.add({ x, y, z: z + rnd(-0.05, 0.05), vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rnd(o.vzmin ?? 0.5, o.vzmax ?? 2.6), g: o.g ?? 7, life: rnd(o.lmin || 0.5, o.lmax || 1.1), size: rnd(o.smin2 || 0.03, o.smax2 || 0.07), color: pick(cols), alpha: o.alpha ?? 1, add: !!o.add, blood: !!o.blood, drag: o.drag ?? 0.4, bounce: o.bounce ?? 0, gib: !!o.gib });
    }
  }
  blood(map, x, y, z, n, dir, big = false) {
    const m = this.goreMul(); if (m <= 0) return;
    this.spray(x, y, z, Math.ceil(n * m), C.blood, { blood: true, dir, spread: dir === undefined ? 3.14 : 0.9, smax: big ? 4.5 : 3, vzmax: big ? 3.4 : 2.4, smin2: 0.03, smax2: big ? 0.09 : 0.06, lmax: 1.3 });
  }
  gibs(map, x, y, n, type = 'flesh') {
    if (this.goreMul() < 1) return;
    const cols = type === 'bone' ? C.bone : type === 'slime' ? C.green : type === 'ecto' ? C.ecto : C.gore;
    for (let i = 0; i < Math.ceil(n * this.goreMul()); i++) {
      const a = rnd(0, 6.283), s = rnd(1.2, 4.2);
      this.add({ x, y, z: rnd(0.15, 0.5), vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rnd(1.5, 4.2), g: 9, life: rnd(1.2, 2.2), size: rnd(0.07, 0.15), color: pick(i % 3 === 0 ? C.bone : cols), alpha: 1, blood: true, bounce: 0.35, gib: true, persist: true });
    }
  }
  ring(x, y, r, cols, n = 24, o = {}) {
    for (let i = 0; i < n; i++) { const a = (i / n) * 6.283, s = r / (o.t || 0.35); this.add({ x, y, z: 0.05 + rnd(0, 0.06), vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rnd(0, 0.6), g: 0.5, life: o.t || 0.35, size: rnd(0.05, 0.11), color: pick(cols), alpha: 0.8, add: !!o.add, drag: 0.2 }); }
  }

  handle(events, match, w) {
    const map = w.map, gm = this.goreMul();
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const t = e.target; if (!t) break;
          const isHero = t.type === 'hero';
          const z = (t.h || 1) * 0.35;
          const amt = e.amount || 5;
          const nx = e.nx || 0, ny = e.ny || 0;
          const dir = (nx || ny) ? Math.atan2(ny, nx) : undefined;
          if (e.dot === 'burn') { this.spray(t.x, t.y, z, 2, C.fire, { add: true, g: -1, vzmin: 0.4, vzmax: 1.2, lmax: 0.5, smax: 0.5 }); break; }
          if (e.dot === 'poison') { this.spray(t.x, t.y, z, 2, C.green, { g: -0.5, vzmax: 0.9, smax: 0.4, lmax: 0.7 }); break; }
          const isBone = t.def && (t.defId === 'skeleton' || t.defId === 'archer' || t.defId === 'brute');
          const isStone = t.giant || t.type === 'bosspart';
          if (isStone) this.spray(t.x, t.y, z, 6, C.dust, { dir, spread: 1.2, smax: 3, alpha: 0.9 });
          if (gm > 0 && !isStone && !(t.def && t.def.swarm)) this.blood(map, t.x, t.y, z, Math.min(28, 4 + amt * 0.6), dir, amt > 20);
          else if (t.def && t.def.swarm) this.spray(t.x, t.y, z, 4, C.green, { smax: 2 });
          else if (gm <= 0) this.spray(t.x, t.y, z, 5, C.spark, { add: true, dir, spread: 1 });
          if (isBone) this.spray(t.x, t.y, z, 2, C.bone, { dir, spread: 1.2, smax: 3 });
          if (t.st && t.st.slime) this.spray(t.x, t.y, z, 3, C.green, {});
          if (gm > 0 && !isStone) { // floor & wall splatter
            if (Math.random() < 0.7) map.splatFloor(t.x + (nx || 0) * 0.5 + rnd(-0.3, 0.3), t.y + (ny || 0) * 0.5 + rnd(-0.3, 0.3), 0.28 + Math.min(0.5, amt * 0.012), 140, R);
            if (dir !== undefined && amt > 6) map.splatWall(t.x, t.y, nx, ny, 3.5, 200, R);
          }
          if (isHero && t.player) { const v = this.viewOf(t.player); v.hurt = Math.min(1, v.hurt + amt / 45); this.shake(t.player, Math.min(1, amt / 30)); this.flash(t.player, [180, 0, 0], 0.25); v.kick = 0.25; v.dirX = nx; v.dirY = ny; }
          else if (e.srcActor && e.srcActor.type === 'hero' && e.srcActor.player) { this.shake(e.srcActor.player, Math.min(0.5, amt / 60)); this.viewOf(e.srcActor.player).hitstop = 0.05; }
          if (e.boss) this.shakeAll(match, 0.1, t.x, t.y, 10);
          break;
        }
        case 'death': {
          const t = e.target; const z = (t.h || 1) * 0.3;
          if (!t) break;
          if (t.type === 'monster' || t.type === 'hero') {
            const stone = t.giant;
            if (stone) { this.spray(t.x, t.y, 0.4, 40, C.dust, { smax: 4, alpha: 0.9, lmax: 1.6 }); this.gibs(map, t.x, t.y, 8, 'bone'); this.shakeAll(match, 0.6, t.x, t.y, 12); }
            else if (t.def && t.def.swarm) { this.spray(t.x, t.y, 0.2, 20, C.green, {}); }
            else {
              this.blood(map, t.x, t.y, z, 40, undefined, true);
              const bone = ['skeleton', 'archer', 'brute'].includes(t.defId);
              this.gibs(map, t.x, t.y, bone ? 7 : 6, bone ? 'bone' : t.defId === 'slime' ? 'slime' : 'flesh');
              map.splatFloor(t.x, t.y, 0.9, 230, R);
              map.splatFloor(t.x + rnd(-0.5, 0.5), t.y + rnd(-0.5, 0.5), 0.6, 180, R);
              for (let i = 0; i < 3; i++) map.splatWall(t.x, t.y, rnd(-1, 1), rnd(-1, 1), 3, 210, R);
            }
          }
          break;
        }
        case 'projwall': this.spray(e.x, e.y, 0.35, 5, e.kind === 'fireball' ? C.fire : C.spark, { add: true, dir: Math.atan2(-e.vy, -e.vx), spread: 1.1, smax: 2.4 }); break;
        case 'projhit': if (e.kind === 'acid' || e.kind === 'gore') this.spray(e.x, e.y, 0.2, 8, e.kind === 'acid' ? C.green : C.gore, { blood: e.kind === 'gore' }); break;
        case 'explosion': {
          const r = e.radius || 1.5;
          this.spray(e.x, e.y, 0.3, 50, e.fire ? C.fire : e.gore ? C.gore : C.dust, { add: !!e.fire, smax: 5, vzmax: 4, lmax: 0.9, alpha: 0.85, smax2: 0.09, smin2: 0.03 });
          this.ring(e.x, e.y, r, e.fire ? C.fire : C.dust, 30, { add: !!e.fire });
          if (e.gore) { this.gibs(map, e.x, e.y, 10, 'flesh'); map.splatFloor(e.x, e.y, r * 0.9, 240, R); for (let i = 0; i < 4; i++) map.splatWall(e.x, e.y, rnd(-1, 1), rnd(-1, 1), 4, 230, R); }
          this.shakeAll(match, 0.55, e.x, e.y, 9); break;
        }
        case 'shockwave': this.ring(e.x, e.y, e.radius, C.dust, 32); this.shakeAll(match, 0.5, e.x, e.y, 9); break;
        case 'spawn': this.spray(e.x, e.y, 0.3, 26, C.red, { add: true, g: -1, vzmin: 0.5, vzmax: 2, smax: 1.4, lmax: 0.9 }); this.ring(e.x, e.y, 1.2, C.purple, 20, { add: true }); break;
        case 'pentagram': this.spray(e.x, e.y, 0.2, 40, C.red, { add: true, g: -2, vzmax: 3, smax: 1.5, lmax: 1.1 }); this.shakeAll(match, 0.2, e.x, e.y, 8); break;
        case 'statuewake': this.spray(e.x, e.y, 0.5, 60, C.dust, { smax: 3, alpha: 0.9, lmax: 1.6 }); this.shakeAll(match, 0.7, e.x, e.y, 14); break;
        case 'heroswap': this.flashAll(match, [255, 255, 255], 0.7); this.spray(e.x, e.y, 0.4, 50, C.gold, { add: true, g: -1, vzmax: 3, smax: 3, lmax: 1.2 }); this.shakeAll(match, 0.8); break;
        case 'herofall': this.blood(map, e.x, e.y, 0.4, 60, undefined, true); this.gibs(map, e.x, e.y, 8); map.splatFloor(e.x, e.y, 1.3, 240, R); this.shakeAll(match, 0.5, e.x, e.y, 12); break;
        case 'levelup': this.spray(e.x, e.y, 0.3, 60, C.gold, { add: true, g: -0.8, vzmin: 1, vzmax: 3.5, smax: 2.6, lmax: 1.4 }); if (e.target && e.target.player) { this.flash(e.target.player, [255, 220, 100], 0.6); } break;
        case 'chestopen': this.spray(e.x, e.y, 0.35, 30, C.gold, { add: true, g: -0.5, vzmax: 2.5, smax: 1.8, lmax: 1 }); break;
        case 'propbreak': this.spray(e.x, e.y, 0.25, 14, C.dust, { smax: 2.8 }); if (['bones', 'skullpile', 'coffin'].includes(e.sub)) this.spray(e.x, e.y, 0.25, 8, C.bone, { smax: 2.8, gib: true, bounce: 0.3 }); break;
        case 'prophit': this.spray(e.x, e.y, 0.3, 4, C.dust, { smax: 1.6 }); break;
        case 'crystalhit': this.spray(e.x, e.y, 0.4, 6, C.red, { add: true, smax: 2 }); break;
        case 'crystalbreak': this.spray(e.x, e.y, 0.4, 40, C.red, { add: true, smax: 4, vzmax: 3 }); this.shakeAll(match, 0.4, e.x, e.y, 9); break;
        case 'pickupsfx': this.spray(e.x, e.y, 0.3, 5, e.kind === 'heart' ? C.red : C.gold, { add: true, g: -1, vzmax: 1.2, smax: 0.8, lmax: 0.5 }); break;
        case 'ectopick': this.spray(e.x, e.y, 0.3, 4, C.ecto, { add: true, g: -1, smax: 0.8, lmax: 0.5 }); break;
        case 'roomlock': this.shakeAll(match, 0.7); break;
        case 'roomclear': this.shakeAll(match, 0.15); break;
        case 'torchout': this.spray(e.x, e.y, 0.4, 10, C.dust, { g: -1, vzmax: 1, alpha: 0.5, smax: 0.5, lmax: 1.2 }); break;
        case 'beamtick': this.beams.push({ x: e.x, y: e.y, angle: e.angle, len: e.len, t: 0.14, kind: e.target && e.target.defId === 'golem' ? 'soul' : 'sun' }); this.shakeAll(match, 0.05, e.x, e.y, 12); break;
        case 'flame': this.beams.push({ x: e.x, y: e.y, angle: e.angle, len: e.len, t: 0.14, kind: 'fire' }); break;
        case 'chain': case 'drain': this.beams.push({ x: e.x1, y: e.y1, angle: Math.atan2(e.y2 - e.y1, e.x2 - e.x1), len: Math.hypot(e.x2 - e.x1, e.y2 - e.y1), t: 0.22, kind: e.type === 'chain' ? 'lightning' : 'drainbeam' }); break;
        case 'frostnova': this.ring(e.x, e.y, e.radius, C.frost, 40, { add: true }); break;
        case 'rockimpact': this.spray(e.x, e.y, 0.2, 30, C.dust, { smax: 4, vzmax: 3 }); this.shakeAll(match, 0.5, e.x, e.y, 14); break;
        case 'bossdeath': for (let i = 0; i < 6; i++) { const ox = rnd(-3, 3), oy = rnd(-3, 3); this.spray(e.x + ox, e.y + oy, 0.6, 50, C.fire, { add: true, smax: 5, vzmax: 5, lmax: 1.4 }); this.spray(e.x + ox, e.y + oy, 0.6, 30, C.gore, { blood: true, smax: 5 }); } this.gibs(map, e.x, e.y, 20, 'bone'); this.shakeAll(match, 1.0); this.flashAll(match, [255, 240, 200], 1.0); break;
        case 'bossphase': this.shakeAll(match, 0.8); this.flashAll(match, [255, 60, 40], 0.5); break;
        case 'bossroar': this.shakeAll(match, 0.9); break;
        case 'suddendeath': this.shakeAll(match, 0.5); break;
        case 'dodge': if (e.target && e.target.player) this.viewOf(e.target.player).dodge = 0.3; break;
        case 'block': this.spray(e.x, e.y, 0.5, 8, C.spark, { add: true, smax: 3 }); if (e.target && e.target.player) this.shake(e.target.player, 0.2); break;
        case 'parry': this.spray(e.x, e.y, 0.5, 16, C.spark, { add: true, smax: 4 }); if (e.target && e.target.player) { this.shake(e.target.player, 0.3); this.flash(e.target.player, [255, 255, 200], 0.15); } break;
        case 'wardcast': case 'sightcast': this.ring(e.x, e.y, 1.3, e.type === 'wardcast' ? C.gold : C.purple, 20, { add: true }); break;
        case 'descend': this.flashAll(match, [0, 0, 0], 1.0); break;
        case 'chandeliercrash': this.spray(e.x, e.y, 0.3, 30, C.gold, { smax: 4 }); this.shakeAll(match, 0.5, e.x, e.y, 10); break;
        case 'spikes': this.spray(e.x, e.y, 0.1, 10, C.dust, { smax: 2 }); break;
        case 'crusher': this.ring(e.x, e.y, 1.5, C.dust, 20); this.shakeAll(match, 0.4, e.x, e.y, 9); break;
        case 'portalenter': this.flashAll(match, [90, 210, 255], 1.0); break;
        case 'portalreturn': this.flashAll(match, [90, 210, 255], 1.0); break;
        default: break;
      }
    }
  }

  update(dt, w) {
    const map = w ? w.map : null;
    for (const p of this.parts) {
      p.life -= dt;
      if (p.life <= 0) { p.dead = true; continue; }
      p.vz -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const d = Math.exp(-(p.drag || 0) * dt); p.vx *= d; p.vy *= d;
      if (map && (map.isWall(p.x | 0, p.y | 0))) { p.x -= p.vx * dt; p.y -= p.vy * dt; p.vx *= -0.3; p.vy *= -0.3; }
      if (p.z <= 0.02 && p.vz < 0) {
        if (p.bounce && Math.abs(p.vz) > 0.8) { p.vz *= -p.bounce; p.vx *= 0.6; p.vy *= 0.6; p.z = 0.02; }
        else {
          p.z = 0.02; p.dead = true;
          if (p.blood && map && this.goreMul() > 0) { this.splatBudget++; if (p.size > 0.06 || (this.splatBudget & 3) === 0) map.splatFloor(p.x, p.y, p.size * 3.5 + 0.05, 170, R); }
          if (p.persist && this.ground.length < 220) this.ground.push({ x: p.x, y: p.y, z: 0, size: p.size, color: p.color });
          if (this.ground.length >= 220) this.ground.shift();
        }
      }
    }
    if (this.parts.some((p) => p.dead)) this.parts = this.parts.filter((p) => !p.dead);
    for (const b of this.beams) b.t -= dt;
    if (this.beams.some((b) => b.t <= 0)) this.beams = this.beams.filter((b) => b.t > 0);
    for (const v of this.views.values()) {
      v.shake = Math.max(0, v.shake - dt * 2.2); v.flashT = Math.max(0, v.flashT - dt); v.hurt = Math.max(0, v.hurt - dt * 0.6); v.kick = Math.max(0, v.kick - dt); v.dodge = Math.max(0, (v.dodge || 0) - dt);
      if (v.hitstop) v.hitstop = Math.max(0, v.hitstop - dt);
    }
  }
  clear() { this.parts.length = 0; this.ground.length = 0; this.beams.length = 0; }
}
