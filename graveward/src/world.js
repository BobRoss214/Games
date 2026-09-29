// World: holds one map's entities and provides physics/queries. Presentation reads it; Match drives it.
import { RNG, clamp, dist2, TAU } from './util.js';
import { DECAL, WALL } from './textures.js';
import { PROPS, TRAPS, MONSTERS } from './data.js';
import { shopStock } from './items.js';

let NEXT_ID = 1;
export const newId = () => NEXT_ID++;

export class World {
  constructor(match, spec, kind, seed) {
    this.match = match; this.spec = spec; this.kind = kind; // 'opening' | 'floor' | 'boss'
    this.map = spec.map; this.rooms = spec.rooms; this.theme = spec.theme;
    this.rng = new RNG(seed);
    this.time = 0;
    this.actors = []; this.projs = []; this.props = []; this.pickups = []; this.corpses = []; this.hazards = [];
    this.events = []; this.headless = !!match.headless;
    this.depth = spec.floorIndex || 0;
    this.pathCache = new Map();
    this._pathBuf = { g: new Float32Array(this.map.w * this.map.h), from: new Int32Array(this.map.w * this.map.h), seen: new Uint32Array(this.map.w * this.map.h), stamp: 0 };
    this.heroLocked = null;
    this.build();
  }

  emit(type, data = {}) { const c = this.match.counts; if (c) c[type] = (c[type] || 0) + 1; data.type = type; if (this.events.length < 400) this.events.push(data); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ---------- building ----------
  build() {
    const spec = this.spec, map = this.map;
    for (const r of this.rooms) {
      r.world = this;
      for (const t of r.torches || []) this.addProp({ kind: 'torch', x: t.x, y: t.y, dir: t.dir, room: r.id, light: t.light });
      for (const p of r.props || []) {
        if (p.kind === 'sign') { this.addProp({ kind: 'sign', x: p.x, y: p.y, room: r.id, doorX: p.doorX, doorY: p.doorY }); continue; }
        const def = PROPS[p.kind]; if (!def) continue;
        this.addProp({ kind: 'scenery', sub: p.kind, x: p.x, y: p.y, room: r.id, cx: p.cx, cy: p.cy });
      }
      for (const c of r.chests || []) c.prop = this.addProp({ kind: 'chest', x: c.x, y: c.y, room: r.id, cx: c.cx, cy: c.cy, tier: c.tier || 0, locked: !!c.locked, trapped: !!c.trapped, guarded: !!c.guarded });
      for (const p of r.pentagrams || []) { p.prop = this.addProp({ kind: 'pent', x: p.x, y: p.y, room: r.id, cx: p.cx, cy: p.cy }); map.decal[p.cy * map.w + p.cx] = DECAL.pentagram; p.room = r.id; }
      for (const c of r.crystals || []) c.prop = this.addProp({ kind: 'crystal', x: c.x, y: c.y, room: r.id, cx: c.cx, cy: c.cy, hp: 45 });
      for (const t of r.traps || []) { t.prop = this.addProp({ kind: 'trap', trap: t.kind, x: t.x, y: t.y, dir: t.dir, room: r.id, track: t.track || 0, wall: !!t.wall }); if (t.kind === 'spikes') map.decal[(t.y | 0) * map.w + (t.x | 0)] = DECAL.spikePlate; }
      if (r.statue) r.statue.prop = this.addProp({ kind: 'statue', sub: r.statue.kind, x: r.statue.x, y: r.statue.y, room: r.id, cx: r.statue.cx, cy: r.statue.cy });
      if (r.trapdoor) { r.trapdoor.prop = this.addProp({ kind: 'trapdoor', x: r.trapdoor.x, y: r.trapdoor.y, room: r.id, cx: r.trapdoor.cx, cy: r.trapdoor.cy }); map.decal[r.trapdoor.cy * map.w + r.trapdoor.cx] = DECAL.trapdoor; }
      if (r.portalPos) { r.portalProp = this.addProp({ kind: 'portal', x: r.portalPos.x, y: r.portalPos.y, room: r.id, cx: r.portalPos.cx, cy: r.portalPos.cy }); map.decal[r.portalPos.cy * map.w + r.portalPos.cx] = DECAL.portal; }
      if (r.type === 'store' && r.shop.length) {
        const stock = shopStock(this.rng, this.depth, r.shop.length);
        r.shop.forEach((s, i) => { s.item = stock[i]; s.prop = this.addProp({ kind: 'shop', x: s.x, y: s.y, room: r.id, cx: Math.floor(s.x), cy: Math.floor(s.y), item: stock[i], slot: i }); });
      }
    }
    // doors -> room links
    for (const r of this.rooms) for (const d of r.doors || []) { d.roomRef = r; }
  }

  addProp(o) {
    const p = Object.assign({ id: newId(), alive: true, hp: 0, maxHp: 0, solid: false, z: 0, t: 0, state: 0, used: false }, o);
    if (p.kind === 'scenery') {
      const def = PROPS[p.sub]; p.def = def; p.hp = p.maxHp = def.hp; p.solid = def.solid; p.z = def.z || 0;
      p.destructible = def.hp > 0;
    } else if (p.kind === 'chest') { p.solid = true; p.hp = p.maxHp = 0; }
    else if (p.kind === 'crystal') { p.solid = true; p.maxHp = p.hp; }
    else if (p.kind === 'statue') { p.solid = true; }
    else if (p.kind === 'shop') { p.solid = true; }
    else if (p.kind === 'trap') { p.tdef = TRAPS[p.trap]; p.state = 'idle'; p.cdT = 0; p.fired = 0; p.sawPos = 0; p.sawDir = 1; }
    else if (p.kind === 'torch') { p.z = 0.35; }
    if (p.solid && p.cx !== undefined) this.map.solidProps[p.cy * this.map.w + p.cx] = 1;
    this.props.push(p);
    return p;
  }
  removeProp(p) {
    p.alive = false;
    if (p.solid && p.cx !== undefined) this.map.solidProps[p.cy * this.map.w + p.cx] = 0;
  }

  // ---------- actors ----------
  spawnActor(o) {
    const a = Object.assign({
      id: newId(), type: 'monster', x: 0, y: 0, z: 0, angle: 0, vx: 0, vy: 0, r: 0.32, h: 1, hp: 50, maxHp: 50, dead: false, deadT: 0,
      team: 'ghost', player: null, atk: null, cds: {}, st: {}, flash: 0, invuln: 0, anim: 'idle', animT: 0, walkT: 0, room: -1, speedMul: 1, dmgMul: 1,
      lastHit: null, age: 0, stagger: 0, aiT: 0, knockX: 0, knockY: 0, bobT: 0,
    }, o);
    this.actors.push(a);
    return a;
  }
  removeActor(a) { a.removed = true; }
  cleanup() {
    if (this.actors.some((a) => a.removed)) this.actors = this.actors.filter((a) => !a.removed);
    if (this.projs.some((p) => p.dead)) this.projs = this.projs.filter((p) => !p.dead);
    if (this.pickups.some((p) => p.dead)) this.pickups = this.pickups.filter((p) => !p.dead);
    if (this.props.some((p) => p.removed)) this.props = this.props.filter((p) => !p.removed);
  }

  // ---------- collision ----------
  blockedAt(cx, cy, ghost) {
    const m = this.map;
    if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return true;
    const i = cy * m.w + cx;
    if (m.solidProps[i] && !ghost) return true;
    if (m.wall[i] === 0) return false;
    const di = m.doorIdx[i];
    if (di >= 0) { if (ghost) return false; return m.doors[di].open < 0.6; }
    return true;
  }
  canStand(x, y, r, ghost = false) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!this.blockedAt(cx, cy, ghost)) continue;
      const nx = clamp(x, cx, cx + 1), ny = clamp(y, cy, cy + 1);
      if ((x - nx) * (x - nx) + (y - ny) * (y - ny) < r * r) return false;
    }
    return true;
  }
  moveActor(a, dx, dy) {
    const ghost = a.type === 'ghost';
    let moved = false;
    if (dx !== 0) { if (this.canStand(a.x + dx, a.y, a.r, ghost)) { a.x += dx; moved = true; } else a.hitWall = true; }
    if (dy !== 0) { if (this.canStand(a.x, a.y + dy, a.r, ghost)) { a.y += dy; moved = true; } else a.hitWall = true; }
    return moved;
  }
  // Nearest walkable point to (x,y) for items that must be reachable.
  freeSpot(x, y, r = 0.15) {
    if (this.canStand(x, y, r, false)) return [x, y];
    for (let d = 0.25; d < 3; d += 0.25) for (let k = 0; k < 12; k++) {
      const nx = x + Math.cos((k / 12) * TAU) * d, ny = y + Math.sin((k / 12) * TAU) * d;
      if (this.canStand(nx, ny, r, false)) return [nx, ny];
    }
    return [x, y];
  }
  // Push out of walls if somehow embedded.
  unstick(a) {
    if (this.canStand(a.x, a.y, a.r, a.type === 'ghost')) return;
    for (let d = 0.1; d < 2; d += 0.1) for (let k = 0; k < 8; k++) {
      const nx = a.x + Math.cos((k / 8) * TAU) * d, ny = a.y + Math.sin((k / 8) * TAU) * d;
      if (this.canStand(nx, ny, a.r, a.type === 'ghost')) { a.x = nx; a.y = ny; return; }
    }
  }
  hasLOS(x0, y0, x1, y1, tall = true) {
    const m = this.map, dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.hypot(dx, dy) * 4) + 1;
    let lastC = -1;
    for (let i = 1; i < n; i++) {
      const x = x0 + (dx * i) / n, y = y0 + (dy * i) / n;
      const cx = x | 0, cy = y | 0; if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return false;
      const ci = cy * m.w + cx; if (ci === lastC) continue; lastC = ci;
      if (m.wall[ci] !== 0) { const di = m.doorIdx[ci]; if (di < 0 || m.doors[di].open < 0.5) return false; }
      if (tall && m.solidProps[ci]) { const pr = this.propAtCell(cx, cy); if (pr && (pr.kind === 'scenery' && pr.sub === 'pillar' || pr.kind === 'statue')) return false; }
    }
    return true;
  }
  propAtCell(cx, cy) { for (const p of this.props) if (p.alive && p.cx === cx && p.cy === cy && p.solid) return p; return null; }
  rayWall(x, y, ang, maxD) { // distance to first wall along ray
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let d = 0; d < maxD; d += 0.1) { const px = x + dx * d, py = y + dy * d; if (this.blockedAt(px | 0, py | 0, true) && !(this.map.doorIdx[(py | 0) * this.map.w + (px | 0)] >= 0 && this.map.doors[this.map.doorIdx[(py | 0) * this.map.w + (px | 0)]].open >= 0.5)) return d; }
    return maxD;
  }

  roomAt(x, y) { const m = this.map; const cx = x | 0, cy = y | 0; if (!m.inBounds(cx, cy)) return null; const id = m.roomId[cy * m.w + cx]; return id >= 0 ? this.rooms[id] : null; }

  // ---------- queries ----------
  actorsInRadius(x, y, r, filter) {
    const out = [];
    for (const a of this.actors) {
      if (a.dead || a.removed) continue;
      const rr = r + a.r;
      if (dist2(x, y, a.x, a.y) <= rr * rr && (!filter || filter(a))) out.push(a);
    }
    return out;
  }
  nearestActor(x, y, maxD, filter) {
    let best = null, bd = maxD * maxD;
    for (const a of this.actors) {
      if (a.dead || a.removed || (filter && !filter(a))) continue;
      const d = dist2(x, y, a.x, a.y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  propsInRadius(x, y, r, filter) {
    const out = [];
    for (const p of this.props) { if (!p.alive || (filter && !filter(p))) continue; if (dist2(x, y, p.x, p.y) <= r * r) out.push(p); }
    return out;
  }

  // ---------- pathfinding (A* on grid) ----------
  path(ax, ay, bx, by, opts = {}) {
    const m = this.map, W = m.w, H = m.h;
    const sx = clamp(ax | 0, 0, W - 1), sy = clamp(ay | 0, 0, H - 1), gx = clamp(bx | 0, 0, W - 1), gy = clamp(by | 0, 0, H - 1);
    const buf = this._pathBuf; buf.stamp++;
    const stamp = buf.stamp, g = buf.g, from = buf.from, seen = buf.seen;
    const ghost = !!opts.ghost, passDoors = opts.passDoors !== false;
    const s = sy * W + sx, goal = gy * W + gx;
    if (s === goal) return [[bx, by]];
    // binary heap of [f, idx]
    const heapF = [], heapI = [];
    const push = (f, i) => { let n = heapF.length; heapF.push(f); heapI.push(i); while (n > 0) { const p = (n - 1) >> 1; if (heapF[p] <= f) break; heapF[n] = heapF[p]; heapI[n] = heapI[p]; heapF[p] = f; heapI[p] = i; n = p; } };
    const pop = () => {
      const i0 = heapI[0], last = heapF.length - 1; const lf = heapF[last], li = heapI[last]; heapF.pop(); heapI.pop();
      if (last > 0) { heapF[0] = lf; heapI[0] = li; let n = 0; for (;;) { let c = n * 2 + 1; if (c >= last) break; if (c + 1 < last && heapF[c + 1] < heapF[c]) c++; if (heapF[c] >= lf) break; heapF[n] = heapF[c]; heapI[n] = heapI[c]; heapF[c] = lf; heapI[c] = li; n = c; } }
      return i0;
    };
    seen[s] = stamp; g[s] = 0; from[s] = -1; push(0, s);
    let found = false, iter = 0;
    const dirs = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];
    while (heapF.length && iter++ < 20000) {
      const cur = pop(); if (cur === goal) { found = true; break; }
      const cx = cur % W, cy = (cur / W) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + dirs[d * 2], ny = cy + dirs[d * 2 + 1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        const diag = d >= 4;
        let blocked = false;
        if (ni !== goal) {
          if (this.pathBlocked(nx, ny, ghost, passDoors, opts)) blocked = true;
        }
        if (blocked) continue;
        if (diag && (this.pathBlocked(cx + dirs[d * 2], cy, ghost, passDoors, opts) || this.pathBlocked(cx, cy + dirs[d * 2 + 1], ghost, passDoors, opts))) continue;
        const ng = g[cur] + (diag ? 1.41 : 1) + (opts.avoid && opts.avoid(nx, ny) ? 3 : 0);
        if (seen[ni] !== stamp || ng < g[ni]) {
          seen[ni] = stamp; g[ni] = ng; from[ni] = cur;
          push(ng + Math.hypot(gx - nx, gy - ny) * 1.05, ni);
        }
      }
    }
    if (!found) return null;
    const out = [];
    for (let i = goal; i !== -1; i = from[i]) out.push([(i % W) + 0.5, ((i / W) | 0) + 0.5]);
    out.reverse();
    if (out.length) out[out.length - 1] = [bx, by];
    return out;
  }
  pathBlocked(cx, cy, ghost, passDoors, opts) {
    const m = this.map, i = cy * m.w + cx;
    if (m.solidProps[i]) return true;
    if (m.wall[i] === 0) return false;
    const di = m.doorIdx[i];
    if (di >= 0) { if (ghost) return false; const d = m.doors[di]; if (!passDoors) return true; return d.locked && !opts.ignoreLocks; }
    return true;
  }
}
