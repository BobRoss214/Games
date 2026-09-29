// Small shared helpers: seeded RNG, math, color packing.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const wrapAngle = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };
export const angleDiff = (a, b) => wrapAngle(a - b);
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export class RNG {
  constructor(seed = 1) { this.s = (seed >>> 0) || 1; }
  next() { // mulberry32
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); } // inclusive
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  weighted(items, weightFn) {
    let total = 0; for (const it of items) total += weightFn(it);
    let r = this.next() * total;
    for (const it of items) { r -= weightFn(it); if (r <= 0) return it; }
    return items[items.length - 1];
  }
  fork(salt = 0) { return new RNG((this.s ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0); }
}

// Pack r,g,b (0-255) into a little-endian ABGR uint32 (canvas ImageData order).
export const rgb = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
export function hex(str, a = 255) {
  const n = parseInt(str.replace('#', ''), 16);
  return rgb((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}
export const cr = (c) => c & 255;
export const cg = (c) => (c >> 8) & 255;
export const cb = (c) => (c >> 16) & 255;
export const ca = (c) => (c >>> 24) & 255;
export function mix(c1, c2, t) {
  return rgb(
    (cr(c1) + (cr(c2) - cr(c1)) * t) | 0,
    (cg(c1) + (cg(c2) - cg(c1)) * t) | 0,
    (cb(c1) + (cb(c2) - cb(c1)) * t) | 0,
    ca(c1),
  );
}
export function scaleColor(c, f) {
  return rgb(clamp(cr(c) * f, 0, 255) | 0, clamp(cg(c) * f, 0, 255) | 0, clamp(cb(c) * f, 0, 255) | 0, ca(c));
}

export const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
