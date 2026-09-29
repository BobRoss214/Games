// GameMap: the tile grid + everything the renderer reads (textures ids, lights, blood, doors).
import { LS, makeLightMap } from './renderer.js';

export class GameMap {
  constructor(w, h, theme) {
    this.w = w; this.h = h; this.theme = theme;
    const n = w * h;
    this.wall = new Uint8Array(n);
    this.floor = new Uint8Array(n);
    this.ceil = new Uint8Array(n);
    this.decal = new Uint8Array(n);
    this.doorIdx = new Int16Array(n).fill(-1);
    this.doors = [];
    this.light = makeLightMap(w, h);
    this.bloodIdx = new Uint16Array(n);
    this.bloodMasks = [null];
    this.wallBlood = new Map();
    this.solidProps = new Uint8Array(n); // dynamic blockers (pillars, sarcophagi)
    this.roomId = new Int16Array(n).fill(-1);
    this.torches = [];
  }
  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  isWall(x, y) { return !this.inBounds(x, y) || this.wall[y * this.w + x] !== 0; }
  isSolidForLight(x, y) {
    if (!this.inBounds(x, y)) return true;
    const i = y * this.w + x;
    if (this.wall[i] === 0) return false;
    const d = this.doorIdx[i];
    if (d >= 0 && this.doors[d].open > 0.5) return false;
    return true;
  }
  // Movement blocking for a cell
  blocked(x, y) {
    if (!this.inBounds(x, y)) return true;
    const i = y * this.w + x;
    if (this.solidProps[i]) return true;
    if (this.wall[i] === 0) return false;
    const d = this.doorIdx[i];
    if (d >= 0 && this.doors[d].open > 0.6) return false;
    return true;
  }
  addDoor(x, y, tex, extra = {}) {
    const door = Object.assign({ x, y, open: 0, target: 0, locked: false, tex, roomA: -1, roomB: -1, speed: 1.6 }, extra);
    this.wall[y * this.w + x] = tex;
    this.doorIdx[y * this.w + x] = this.doors.length;
    this.doors.push(door);
    return door;
  }
  setDoorTex(door, tex) { door.tex = tex; this.wall[door.y * this.w + door.x] = tex; }
  updateDoors(dt) {
    for (const d of this.doors) {
      if (d.open !== d.target) {
        const dir = d.target > d.open ? 1 : -1;
        d.open += dir * d.speed * dt;
        if ((dir > 0 && d.open > d.target) || (dir < 0 && d.open < d.target)) d.open = d.target;
      }
    }
  }
  // ---------- blood ----------
  _mask(ci) {
    let bi = this.bloodIdx[ci];
    if (!bi) { bi = this.bloodMasks.length; if (bi > 65000) return null; this.bloodMasks.push(new Uint8Array(256)); this.bloodIdx[ci] = bi; }
    return this.bloodMasks[bi];
  }
  splatFloor(x, y, radius, amount = 200, rng = null) {
    const x0 = Math.floor(x - radius), x1 = Math.floor(x + radius), y0 = Math.floor(y - radius), y1 = Math.floor(y + radius);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!this.inBounds(cx, cy) || this.wall[cy * this.w + cx] !== 0 || !this.floor[cy * this.w + cx]) continue;
      const m = this._mask(cy * this.w + cx); if (!m) continue;
      for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
        const wx = cx + (px + 0.5) / 16, wy = cy + (py + 0.5) / 16;
        const d = Math.hypot(wx - x, wy - y);
        if (d > radius) continue;
        const jitter = rng ? rng.next() : (((px * 7 + py * 13 + cx * 3 + cy) % 5) / 5);
        const f = (1 - d / radius) * 1.4 + jitter * 0.3 - 0.25;
        if (f <= 0) continue;
        const v = m[py * 16 + px] + amount * Math.min(1, f);
        m[py * 16 + px] = v > 255 ? 255 : v;
      }
    }
  }
  // Splat on the nearest wall face along (x,y)+dir; used for hit sprays.
  splatWall(x, y, dx, dy, maxDist, amount = 220, rng = null) {
    const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
    let px = x, py = y;
    for (let d = 0; d < maxDist; d += 0.1) {
      px = x + dx * d; py = y + dy * d;
      const cx = Math.floor(px), cy = Math.floor(py);
      if (!this.inBounds(cx, cy)) return;
      const ci = cy * this.w + cx;
      if (this.wall[ci] !== 0 && !(this.doorIdx[ci] >= 0 && this.doors[this.doorIdx[ci]].open > 0.5)) {
        const fx = px - cx, fy = py - cy;
        // decide which face was hit from entry point
        let face, u;
        const ex = Math.min(fx, 1 - fx), ey = Math.min(fy, 1 - fy);
        if (ex < ey) { face = fx < 0.5 ? 0 : 1; u = fy; } else { face = fy < 0.5 ? 2 : 3; u = fx; }
        const key = ci * 4 + face;
        let m = this.wallBlood.get(key);
        if (!m) { m = new Uint8Array(256); this.wallBlood.set(key, m); }
        const vc = 4 + (rng ? rng.float(-3, 3) : 0), uc = u * 16;
        const rad = 1.8 + (rng ? rng.float(0, 2) : 1);
        for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
          const dd = Math.hypot(i - uc, (j - vc) * 1.2);
          if (dd < rad) m[j * 16 + i] = Math.min(255, m[j * 16 + i] + amount * (1 - dd / rad));
        }
        // drip
        const len = 2 + ((rng ? rng.int(0, 5) : 2) | 0);
        for (let j = Math.floor(vc); j < Math.min(16, vc + len); j++) { const ii = Math.min(15, Math.max(0, Math.floor(uc))); m[j * 16 + ii] = Math.min(255, m[j * 16 + ii] + 140); }
        return;
      }
    }
  }
  clearBlood() { this.bloodIdx.fill(0); this.bloodMasks = [null]; this.wallBlood.clear(); }
}

export { LS };
