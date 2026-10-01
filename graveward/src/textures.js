// Procedural 64x64 pixel textures. Everything is generated in code; no image files.
import { RNG, hex, rgb, cr, cg, cb, mix, scaleColor, clamp } from './util.js';

export const TEX = 64;           // authoring size: every texture is hand-built on a 64x64 canvas
export const TW = 128;           // size actually used by the renderer: the realism pass below upscales and adds detail
export const TWM = TW - 1, TSH = 3; // TSH: blood masks are 16x16, so one mask cell = 2^TSH texels
const M = TEX - 1;

// ---------- noise helpers (tileable value noise) ----------
function lattice(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, freq, seed) { // x,y in 0..TEX ; wraps at `freq` lattice cells
  const fx = (x / TEX) * freq, fy = (y / TEX) * freq;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const w = (i) => ((i % freq) + freq) % freq;
  const a = lattice(w(x0), w(y0), seed), b = lattice(w(x0 + 1), w(y0), seed);
  const c = lattice(w(x0), w(y0 + 1), seed), d = lattice(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, seed, oct = 3, base = 4) {
  let v = 0, amp = 0.5, tot = 0, f = base;
  for (let o = 0; o < oct; o++) { v += vnoise(x, y, f, seed + o * 17) * amp; tot += amp; amp *= 0.5; f *= 2; }
  return v / tot;
}

class Canvas {
  constructor(w = TEX, h = TEX) { this.w = w; this.h = h; this.d = new Uint32Array(w * h); }
  px(x, y, c) { x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h; this.d[y * this.w + x] = c; }
  get(x, y) { x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h; return this.d[y * this.w + x]; }
  fill(fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.d[y * this.w + x] = fn(x, y); }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c); }
  line(x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= n; i++) this.px(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c);
  }
  disc(cx, cy, r, c) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.5) this.px(cx + x, cy + y, c); }
  ring(cx, cy, r, c) { const n = Math.max(12, r * 8); for (let i = 0; i < n; i++) { const a = (i / n) * 6.2832; this.px(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), c); } }
  shade(f) { for (let i = 0; i < this.d.length; i++) this.d[i] = scaleColor(this.d[i], f); }
  finish() { return { w: this.w, h: this.h, data: this.d }; }
}

const P = (s) => hex(s);
function pick(pal, t) { return pal[clamp(Math.floor(t * pal.length), 0, pal.length - 1)]; }

// ---------- generic brick generator ----------
function bricks(seed, o) {
  const rng = new RNG(seed);
  const c = new Canvas();
  const { rows = 4, cols = 2, pal, mortar, cracks = 2, moss = null, wet = 0, stagger = true, noise = 0.16 } = o;
  const rh = TEX / rows, bw = TEX / cols;
  const tint = [];
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols + 1; k++) tint.push(rng.float(-0.12, 0.12));
  c.fill((x, y) => {
    const r = Math.floor(y / rh);
    const off = stagger && r % 2 ? bw / 2 : 0;
    const xx = (x + off) % TEX;
    const k = Math.floor(xx / bw);
    const lx = xx - k * bw, ly = y - r * rh;
    let col;
    if (lx < 1.5 || ly < 1.5) col = mortar;
    else {
      const n = fbm(x, y, seed, 3, 8);
      const g = fbm(x * 1.7, y * 1.7, seed + 9, 2, 16);
      const bev = (lx < 3 ? 0.14 : 0) + (ly < 3 ? 0.14 : 0) - (lx > bw - 3 ? 0.16 : 0) - (ly > rh - 3 ? 0.2 : 0);
      col = pick(pal, clamp(n * 0.9 + g * 0.25 + tint[r * (cols + 1) + k] + bev * 0.5 + 0.05, 0, 0.999));
      col = scaleColor(col, 1 + bev + (g - 0.5) * noise);
    }
    return col;
  });
  for (let i = 0; i < cracks; i++) { // crack lines
    let x = rng.int(0, M), y = rng.int(0, M);
    const len = rng.int(8, 22);
    for (let j = 0; j < len; j++) { c.px(x, y, scaleColor(c.get(x, y), 0.45)); x += rng.int(-1, 1); y += rng.chance(0.75) ? 1 : 0; }
  }
  if (moss) {
    for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
      const m = fbm(x, y, seed + 40, 3, 4) + (y / TEX) * 0.15 + rng.float(-0.05, 0.05);
      if (m > 0.62) c.px(x, y, mix(c.get(x, y), pick(moss, (m - 0.62) * 3), 0.75));
    }
  }
  if (wet) {
    for (let x = 0; x < TEX; x++) {
      const h = Math.floor(fbm(x, 0, seed + 60, 2, 6) * wet * 20);
      for (let y = TEX - h; y < TEX; y++) c.px(x, y, mix(c.get(x, y), P('#12303a'), 0.5));
    }
  }
  return c;
}

function stoneVar(c, seed, amt) { // grit
  const rng = new RNG(seed);
  for (let i = 0; i < c.d.length * 0.12; i++) {
    const x = rng.int(0, M), y = rng.int(0, M);
    c.px(x, y, scaleColor(c.get(x, y), rng.chance(0.5) ? 1 + amt : 1 - amt));
  }
  return c;
}

// ---------- individual wall textures ----------
function boneWall(seed) {
  const rng = new RNG(seed);
  const c = new Canvas();
  c.fill((x, y) => scaleColor(P('#2a2019'), 0.7 + fbm(x, y, seed, 3, 8) * 0.6));
  const bone = [P('#8d826c'), P('#b3a78c'), P('#d2c7aa'), P('#e6dcc0')];
  const dark = P('#150e0c');
  // femurs rows behind
  for (let i = 0; i < 6; i++) {
    const y = rng.int(0, M), x = rng.int(0, M), l = rng.int(14, 26);
    for (let j = 0; j < l; j++) { c.px(x + j, y, bone[1]); c.px(x + j, y + 1, bone[0]); }
    c.disc(x, y, 1, bone[2]); c.disc(x + l, y, 1, bone[2]);
  }
  // skulls in staggered grid 4 cols x 4 rows of 16px
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
    if (rng.chance(0.12)) continue;
    const cx = k * 16 + (r % 2 ? 16 : 8), cy = r * 16 + 8 + rng.int(-1, 1);
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
      const e = (x * x) / 30 + (y * y) / 34;
      if (e <= 1) {
        const lit = clamp(1 - e * 0.55 + (x < 0 ? 0.15 : -0.1) + (y < 0 ? 0.1 : 0), 0, 0.999);
        c.px(cx + x, cy + y - 1, pick(bone, lit * lit + rng.float(-0.06, 0.06)));
      }
    }
    c.rect(cx - 3, cy + 4, 7, 3, bone[1]);
    for (let t = 0; t < 4; t++) c.px(cx - 2 + t * 2, cy + 5, dark);
    c.disc(cx - 3, cy - 2, 2, dark); c.disc(cx + 3, cy - 2, 2, dark);
    c.px(cx, cy + 1, dark); c.px(cx - 1, cy + 2, dark); c.px(cx + 1, cy + 2, dark);
    if (rng.chance(0.15)) c.px(cx - 3, cy - 2, P('#7a1010'));
  }
  return c;
}

function glyphWall(seed, ornate) {
  const rng = new RNG(seed);
  const c = bricks(seed, { rows: 2, cols: 2, pal: [P('#7d6440'), P('#98784a'), P('#b28c58'), P('#c9a16a')], mortar: P('#3a2a18'), cracks: 1 });
  const ink = P('#3a2412'), gold = P('#e0b04a'), teal = P('#2a8a80');
  const glyph = (cx, cy, kind, col) => {
    switch (kind) {
      case 0: c.ring(cx, cy, 3, col); c.px(cx, cy, col); c.line(cx - 5, cy, cx - 3, cy, col); c.line(cx + 3, cy, cx + 5, cy, col); break; // eye
      case 1: c.ring(cx, cy - 3, 2, col); c.line(cx, cy - 1, cx, cy + 5, col); c.line(cx - 3, cy + 1, cx + 3, cy + 1, col); break; // ankh-ish
      case 2: for (let i = 0; i < 4; i++) c.line(cx - 4 + i * 2, cy + 3, cx - 3 + i * 2, cy - 3 + (i % 2) * 2, col); break; // zigzag
      case 3: c.line(cx - 4, cy + 4, cx, cy - 4, col); c.line(cx, cy - 4, cx + 4, cy + 4, col); c.line(cx - 2, cy + 1, cx + 2, cy + 1, col); break; // pyramid
      default: c.disc(cx, cy, 2, col); c.line(cx - 4, cy + 4, cx + 4, cy + 4, col); c.line(cx, cy + 2, cx, cy - 5, col); break; // sun
    }
  };
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
    if (!ornate && rng.chance(0.4)) continue;
    glyph(k * 16 + 8, r * 16 + 9, rng.int(0, 4), ornate && rng.chance(0.4) ? teal : ink);
  }
  if (ornate) { c.rect(0, 0, TEX, 2, gold); c.rect(0, 62, TEX, 2, gold); }
  return c;
}

function goldTrim(seed) {
  const c = bricks(seed, { rows: 4, cols: 2, pal: [P('#2a1a1e'), P('#3d222a'), P('#4d2a30'), P('#5c3238')], mortar: P('#110a0c'), cracks: 1 });
  const gold = [P('#8a6420'), P('#c79a32'), P('#f0cf62')];
  for (const y of [0, 30, 60]) { c.rect(0, y, TEX, 3, gold[1]); c.rect(0, y, TEX, 1, gold[2]); c.rect(0, y + 2, TEX, 1, gold[0]); }
  for (let k = 0; k < 8; k++) { // diamonds
    const cx = k * 8 + 4, cy = 16;
    for (let i = -3; i <= 3; i++) { const w = 3 - Math.abs(i); for (let j = -w; j <= w; j++) c.px(cx + j, cy + i, gold[(i + j + 8) % 3]); }
    const cy2 = 46;
    for (let i = -3; i <= 3; i++) { const w = 3 - Math.abs(i); for (let j = -w; j <= w; j++) c.px(cx + j, cy2 + i, gold[(i - j + 8) % 3]); }
  }
  return c;
}

function mural(seed) {
  const rng = new RNG(seed);
  const c = bricks(seed, { rows: 1, cols: 1, pal: [P('#a8895a'), P('#bb9a66'), P('#c9ab76')], mortar: P('#4a3620'), cracks: 3 });
  const col = [P('#a32a22'), P('#1f7a78'), P('#d8b04a'), P('#20140e')];
  c.rect(0, 8, TEX, 2, col[3]); c.rect(0, 54, TEX, 2, col[3]);
  for (let k = 0; k < 5; k++) { // procession of stick-figures
    const x = 6 + k * 12, y = 20 + rng.int(-1, 1), cc = col[rng.int(0, 2)];
    c.disc(x, y, 2, cc); c.rect(x - 1, y + 2, 3, 12, cc);
    c.line(x - 5, y + 6, x + 5, y + 4 + rng.int(-2, 4), col[3]); c.line(x - 2, y + 14, x - 4, y + 22, col[3]); c.line(x + 2, y + 14, x + 4, y + 22, col[3]);
  }
  for (let x = 0; x < TEX; x += 4) { c.px(x, 12, col[0]); c.px(x + 1, 12, col[0]); c.px(x, 50, col[1]); c.px(x + 1, 50, col[1]); }
  // weathering
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) if (fbm(x, y, seed + 5, 3, 6) > 0.66) c.px(x, y, mix(c.get(x, y), P('#b09468'), 0.6));
  return c;
}

function fleshWall(seed) {
  const c = new Canvas();
  const pal = [P('#3a0d12'), P('#55131a'), P('#7a1c24'), P('#9c2e34'), P('#b8534f')];
  c.fill((x, y) => {
    const n = fbm(x, y, seed, 4, 4), v = Math.abs(fbm(x + 20, y + 5, seed + 3, 3, 6) - 0.5);
    let col = pick(pal, n * 0.95);
    if (v < 0.03) col = mix(col, P('#c8202a'), 0.7);
    return col;
  });
  const rng = new RNG(seed);
  for (let i = 0; i < 6; i++) { const cx = rng.int(4, 60), cy = rng.int(4, 60); c.disc(cx, cy, rng.int(2, 4), P('#3a0d12')); c.disc(cx, cy - 1, 1, P('#c28080')); }
  return c;
}

function pillarTex(seed) {
  const c = new Canvas();
  c.fill((x, y) => {
    const flute = Math.sin((x / TEX) * Math.PI * 8); // 4 rounded flutes
    const shade = 0.82 + flute * 0.2 + (x % 16 === 0 ? -0.25 : 0);
    const n = 0.38 + fbm(x * 0.5, y * 2, seed, 3, 8) * 0.34;
    return scaleColor(pick([P('#4a4640'), P('#5f5a50'), P('#77705f'), P('#8d8570')], n), shade);
  });
  for (let y = 0; y < 7; y++) c.rect(0, y, TEX, 1, scaleColor(P('#7a705a'), y === 6 ? 0.5 : 1.0 - y * 0.03)); // capital
  for (let y = 57; y < 64; y++) c.rect(0, y, TEX, 1, scaleColor(P('#7a705a'), y === 57 ? 0.5 : 0.8));   // base
  return c;
}

function woodDoor(seed) {
  const rng = new RNG(seed);
  const c = new Canvas();
  const wood = [P('#3a2414'), P('#4c301a'), P('#5c3c20'), P('#6e4828')];
  c.fill((x, y) => {
    const plank = Math.floor(x / 8), lx = x % 8;
    const g = fbm(x * 0.4, y * 3, seed + plank, 3, 4);
    let col = pick(wood, g * 0.9 + (plank % 2) * 0.08);
    if (lx === 0) col = P('#1c110a');
    return col;
  });
  const iron = [P('#1a1a1e'), P('#33343a'), P('#4d4f57')];
  for (const y of [8, 50]) { c.rect(0, y, TEX, 5, iron[1]); c.rect(0, y, TEX, 1, iron[2]); c.rect(0, y + 4, TEX, 1, iron[0]); for (let x = 4; x < TEX; x += 12) c.disc(x, y + 2, 1, iron[2]); }
  c.ring(48, 34, 4, iron[2]); c.ring(48, 34, 3, iron[1]);
  c.rect(0, 0, 2, TEX, iron[0]); c.rect(62, 0, 2, TEX, iron[0]);
  return c;
}

function sealedDoor(seed) {
  const c = bricks(seed, { rows: 1, cols: 1, pal: [P('#3a3438'), P('#4a4448'), P('#5a5458')], mortar: P('#141014'), cracks: 3 });
  const red = [P('#5a0d0d'), P('#a01818'), P('#ff4a3a')];
  c.ring(32, 32, 16, red[1]); c.ring(32, 32, 17, red[0]); c.ring(32, 32, 15, red[2]);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.2832 - 1.5708, b = ((i + 2) / 5) * 6.2832 - 1.5708; c.line(Math.round(32 + Math.cos(a) * 15), Math.round(32 + Math.sin(a) * 15), Math.round(32 + Math.cos(b) * 15), Math.round(32 + Math.sin(b) * 15), red[2]); }
  c.rect(0, 0, 3, TEX, P('#1a1418')); c.rect(61, 0, 3, TEX, P('#1a1418'));
  return c;
}

function barsTex(seed) {
  const c = new Canvas();
  c.fill((x, y) => {
    const bar = x % 10 < 3;
    if (bar) { const l = x % 10; return l === 0 ? P('#6a6c74') : l === 1 ? P('#4a4c54') : P('#2a2b30'); }
    return P('#08060a');
  });
  c.rect(0, 12, TEX, 3, P('#3a3c44')); c.rect(0, 48, TEX, 3, P('#3a3c44'));
  return c;
}

function altarWall(seed) {
  const c = bricks(seed, { rows: 4, cols: 2, pal: [P('#241a1c'), P('#2f2224'), P('#3d2a2c'), P('#4b3234')], mortar: P('#0c0708'), cracks: 3 });
  const rng = new RNG(seed);
  for (let i = 0; i < 6; i++) { // blood drips
    const x = rng.int(0, M); let y = rng.int(0, 20); const l = rng.int(10, 40);
    for (let j = 0; j < l; j++) { c.px(x, y + j, j < l - 2 ? P('#6a0e12') : P('#a01820')); if (rng.chance(0.3)) c.px(x + 1, y + j, P('#4a0a0c')); }
  }
  return c;
}

function storeWall(seed) {
  const c = new Canvas();
  const wood = [P('#4c321c'), P('#5e3f24'), P('#704b2c'), P('#835a36')];
  c.fill((x, y) => {
    const plank = Math.floor(y / 10), ly = y % 10;
    let col = pick(wood, fbm(x * 3, y * 0.5, seed + plank, 3, 4) * 0.9 + (plank % 3) * 0.05);
    if (ly === 0) col = P('#24160c');
    return col;
  });
  for (let x = 6; x < TEX; x += 26) for (const y of [4, 24, 44, 58]) { c.disc(x, y, 1, P('#a8a8b0')); }
  return c;
}

function portalWall(seed) {
  const c = bricks(seed, { rows: 4, cols: 2, pal: [P('#232a3a'), P('#2c364a'), P('#38445c'), P('#455470')], mortar: P('#0a0e18'), cracks: 2 });
  const rune = P('#5ad0ff');
  for (let k = 0; k < 2; k++) for (let r = 0; r < 4; r++) { const cx = k * 32 + 16, cy = r * 16 + 8; c.px(cx, cy, rune); c.px(cx + 1, cy, rune); c.line(cx - 3, cy + 2, cx + 3, cy + 2, scaleColor(rune, 0.6)); }
  return c;
}

function nicheWall(seed) { // coffin niches
  const c = bricks(seed, { rows: 4, cols: 2, pal: [P('#3c3830'), P('#4b463b'), P('#5c5546'), P('#6e6654')], mortar: P('#14110c'), cracks: 2, moss: [P('#28381c'), P('#38502a')] });
  for (const [x, y] of [[10, 6], [38, 6]]) { c.rect(x, y, 16, 22, P('#0a0806')); c.rect(x + 1, y + 1, 14, 20, P('#15100c')); c.rect(x + 3, y + 5, 10, 14, P('#5a4a34')); c.rect(x + 4, y + 6, 8, 12, P('#7a6644')); c.disc(x + 8, y + 9, 2, P('#b0a080')); }
  return c;
}

// ---------- floors & ceilings ----------
function flagFloor(seed, pal, mortar, cracks = 2) {
  const c = bricks(seed, { rows: 2, cols: 2, pal, mortar, cracks, stagger: false, noise: 0.22 });
  return c;
}
function sandFloor(seed) {
  const c = new Canvas();
  c.fill((x, y) => {
    const n = fbm(x, y, seed, 3, 8), rip = Math.sin((y + fbm(x, y, seed + 2, 2, 4) * 20) * 0.6) * 0.06;
    return pick([P('#8a6c40'), P('#a5834e'), P('#b8955c'), P('#c9a76e')], n + rip);
  });
  const rng = new RNG(seed);
  for (let i = 0; i < 60; i++) c.px(rng.int(0, M), rng.int(0, M), P('#5a4428'));
  return c;
}
function waterFloor(seed) {
  const c = new Canvas();
  c.fill((x, y) => {
    const n = fbm(x, y, seed, 3, 4), w = Math.sin((x + n * 30) * 0.4) * Math.sin((y + n * 20) * 0.4);
    return pick([P('#0e2a32'), P('#14404a'), P('#1c5660'), P('#2c7480'), P('#58a0a8')], clamp(0.3 + n * 0.4 + w * 0.25, 0, 0.99));
  });
  return c;
}
function goldTile(seed) {
  const c = new Canvas();
  c.fill((x, y) => {
    const chk = ((x >> 4) + (y >> 4)) & 1, e = (x & 15) === 0 || (y & 15) === 0;
    const n = fbm(x, y, seed, 3, 8);
    if (e) return P('#f0cf62');
    return chk ? pick([P('#1a1014'), P('#2a1a20'), P('#382229')], n) : pick([P('#8a6420'), P('#b58a2c'), P('#d2a840')], n);
  });
  return c;
}
function boneFloor(seed) {
  const c = flagFloor(seed, [P('#3a342a'), P('#4a4234'), P('#5a5040')], P('#16120c'), 2);
  const rng = new RNG(seed);
  for (let i = 0; i < 10; i++) { const x = rng.int(0, M), y = rng.int(0, M), l = rng.int(4, 9); for (let j = 0; j < l; j++) c.px(x + j, y, P('#cfc4a4')); c.px(x, y, P('#efe6c8')); c.px(x + l, y, P('#efe6c8')); }
  return c;
}
function fleshFloor(seed) {
  const c = fleshWall(seed + 3); c.shade(0.75); return c;
}
function altarFloor(seed) {
  const c = flagFloor(seed, [P('#2a1c1e'), P('#382426'), P('#452c2e')], P('#0c0708'), 2);
  const rng = new RNG(seed);
  for (let i = 0; i < 500; i++) { const x = rng.int(0, M), y = rng.int(0, M); if (fbm(x, y, seed + 7, 3, 4) > 0.55) c.px(x, y, mix(c.get(x, y), P('#7a1216'), 0.6)); }
  return c;
}
function woodFloor(seed) {
  const c = new Canvas();
  const wood = [P('#3a2414'), P('#4c301a'), P('#5c3c20'), P('#6e4828')];
  c.fill((x, y) => { const p = Math.floor(x / 10); if (x % 10 === 0) return P('#1a0f08'); return pick(wood, fbm(x * 0.3, y * 2, seed + p, 3, 4) * 0.9 + (p % 3) * 0.07); });
  return c;
}
function ceilTex(seed, pal, mortar) {
  const c = bricks(seed, { rows: 2, cols: 2, pal, mortar, cracks: 1, stagger: false });
  c.shade(0.85); return c;
}
function ceilBone(seed) { const c = boneWall(seed); c.shade(0.7); return c; }
function ceilFlesh(seed) { const c = fleshWall(seed + 9); c.shade(0.6); return c; }
function ceilDrip(seed) {
  const c = ceilTex(seed, [P('#1c2a2e'), P('#24363a'), P('#2e444a')], P('#080e10'));
  const rng = new RNG(seed);
  for (let i = 0; i < 14; i++) c.disc(rng.int(0, M), rng.int(0, M), 1, P('#4a8890'));
  return c;
}

// ---------- decals (alpha textures, drawn over floors) ----------
function pentagramDecal(used) {
  const c = new Canvas();
  const col = used ? P('#3a1a1a') : P('#ff3a2a'), col2 = used ? P('#2a1212') : P('#ffb060');
  c.ring(32, 32, 27, col); c.ring(32, 32, 26, col); c.ring(32, 32, 22, col2);
  const pts = []; for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; pts.push([32 + Math.cos(a) * 25, 32 + Math.sin(a) * 25]); }
  for (let i = 0; i < 5; i++) { const a = pts[i], b = pts[(i + 2) % 5]; c.line(Math.round(a[0]), Math.round(a[1]), Math.round(b[0]), Math.round(b[1]), col); }
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; c.disc(Math.round(32 + Math.cos(a) * 25), Math.round(32 + Math.sin(a) * 25), 2, col2); }
  return c;
}
function portalDecal() {
  const c = new Canvas();
  const col = P('#5ad0ff'), dim = P('#2a6a90');
  c.ring(32, 32, 28, dim); c.ring(32, 32, 27, col); c.ring(32, 32, 20, dim);
  for (let t = 0; t < 3; t++) { // three triangles
    const a0 = -Math.PI / 2 + (t * 2 * Math.PI) / 3;
    const p = [0, 1, 2].map((k) => { const a = a0 + (k * 2 * Math.PI) / 3; return [32 + Math.cos(a) * 12 + Math.cos(a0) * 8, 32 + Math.sin(a) * 12 + Math.sin(a0) * 8]; });
    for (let k = 0; k < 3; k++) c.line(Math.round(p[k][0]), Math.round(p[k][1]), Math.round(p[(k + 1) % 3][0]), Math.round(p[(k + 1) % 3][1]), col);
  }
  return c;
}
function trapdoorDecal() {
  const c = new Canvas();
  c.rect(4, 4, 56, 56, P('#0a0608'));
  for (let i = 0; i < 6; i++) c.rect(6, 6 + i * 9, 52, 2, P('#3a2a20'));
  c.rect(4, 4, 56, 2, P('#6a5030')); c.rect(4, 58, 56, 2, P('#6a5030')); c.rect(4, 4, 2, 56, P('#6a5030')); c.rect(58, 4, 2, 56, P('#6a5030'));
  c.disc(32, 32, 4, P('#a08040')); c.disc(32, 32, 2, P('#0a0608'));
  return c;
}
function spikePlateDecal() {
  const c = new Canvas();
  c.rect(6, 6, 52, 52, P('#2a2c30'));
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) { const cx = 12 + x * 10, cy = 12 + y * 10; c.disc(cx, cy, 2, P('#0a0a0c')); c.px(cx, cy, P('#7a7c84')); }
  c.rect(6, 6, 52, 1, P('#54565e')); c.rect(6, 57, 52, 1, P('#141518'));
  return c;
}
function sigilDecal(col) {
  const c = new Canvas();
  c.ring(32, 32, 22, col); c.ring(32, 32, 10, col);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.2832; c.line(Math.round(32 + Math.cos(a) * 10), Math.round(32 + Math.sin(a) * 10), Math.round(32 + Math.cos(a) * 22), Math.round(32 + Math.sin(a) * 22), col); }
  return c;
}

// ---------- registry ----------
// Transparent = 0 alpha. Non-decal textures are fully opaque.
export const WALL = {
  brick: 1, moss: 2, bone: 3, sand: 4, glyph: 5, wet: 6, gold: 7, mural: 8, flesh: 9, pillar: 10, door: 11, sealed: 12, bars: 13,
  altar: 14, store: 15, portal: 16, niche: 17, royalGlyph: 18, deepFlesh: 19, ossuaryBrick: 20,
};
export const FLOOR = { flag: 30, flagCrack: 31, sand: 32, water: 33, goldTile: 34, bone: 35, flesh: 36, altar: 37, wood: 38, mossFlag: 39, royalFlag: 40, wetFlag: 41 };
export const CEIL = { stone: 50, bone: 51, sand: 52, drip: 53, royal: 54, flesh: 55, dark: 56 };
export const DECAL = { pentagram: 70, pentagramUsed: 71, portal: 72, trapdoor: 73, spikePlate: 74, sigilRed: 75, sigilBlue: 76, sigilGold: 77 };

// ---------- realism pass: 64x64 art -> 128x128 with baked relief, grime and a muted grade ----------
let FIELDS = null;
function fields() { // shared tileable noise fields, sampled with a per-texture offset (cheap)
  if (FIELDS) return FIELDS;
  const mk = (seed, base, oct) => { const f = new Float32Array(TW * TW); for (let y = 0; y < TW; y++) for (let x = 0; x < TW; x++) f[y * TW + x] = fbm(x * 0.5, y * 0.5, seed, oct, base); return f; };
  const grain = new Float32Array(TW * TW); { const r = new RNG(777); for (let i = 0; i < grain.length; i++) grain[i] = r.next(); }
  const streak = new Float32Array(TW); { const r = new RNG(991); let v = 0.5; for (let i = 0; i < TW; i++) { v = v * 0.6 + r.next() * 0.4; streak[i] = v; } }
  FIELDS = { mottle: mk(31, 6, 3), mottle2: mk(57, 3, 2), fine: mk(83, 16, 2), grain, streak };
  return FIELDS;
}
const KIND = (id) => (id >= 70 && id < 78 ? 'decal' : id >= 50 && id < 60 ? 'ceil' : id >= 30 && id < 50 ? (id === 33 ? 'water' : 'floor') : [11, 12, 13, 16, 18].includes(id) ? 'special' : 'wall');
function realism(tex, id) {
  const kind = KIND(id), S = TW, N = S * S, src = tex.data, SW = tex.w;
  const out = new Uint32Array(N);
  if (kind === 'decal') { // keep decals crisp: nearest-neighbour, transparency preserved
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) out[y * S + x] = src[((y * SW / S) | 0) * SW + ((x * SW / S) | 0)];
    return { w: S, h: S, data: out };
  }
  const F = fields(), R = new RNG(id * 7919 + 13);
  const ox = R.int(0, S - 1), oy = R.int(0, S - 1), sOff = R.int(0, S - 1);
  // 1) bilinear upscale (tileable)
  const cr_ = new Float32Array(N), cg_ = new Float32Array(N), cb_ = new Float32Array(N), H = new Float32Array(N);
  for (let y = 0; y < S; y++) {
    const fy = (y + 0.5) * SW / S - 0.5, y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < S; x++) {
      const fx = (x + 0.5) * SW / S - 0.5, x0 = Math.floor(fx), tx = fx - x0;
      const a = src[(((y0 % SW) + SW) % SW) * SW + (((x0 % SW) + SW) % SW)], b = src[(((y0 % SW) + SW) % SW) * SW + ((((x0 + 1) % SW) + SW) % SW)];
      const c = src[((((y0 + 1) % SW) + SW) % SW) * SW + (((x0 % SW) + SW) % SW)], d = src[((((y0 + 1) % SW) + SW) % SW) * SW + ((((x0 + 1) % SW) + SW) % SW)];
      const lerp2 = (sh) => { const A = (a >> sh) & 255, B = (b >> sh) & 255, C = (c >> sh) & 255, D = (d >> sh) & 255; return (A + (B - A) * tx) * (1 - ty) + (C + (D - C) * tx) * ty; };
      const i = y * S + x; cr_[i] = lerp2(0); cg_[i] = lerp2(8); cb_[i] = lerp2(16);
    }
  }
  // 2) height estimate: brightness plus fine noise; crisp mortar / carved edges come from the source brightness
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, ni = ((y + oy) & TWM) * S + ((x + ox) & TWM);
    H[i] = (cr_[i] * 0.3 + cg_[i] * 0.59 + cb_[i] * 0.11) / 255 * 0.78 + (F.fine[ni] - 0.5) * 0.3 + (F.grain[ni] - 0.5) * 0.1;
  }
  // 3) blurred height (box, separable r=3) for crevice darkening
  const T = new Float32Array(N), B = new Float32Array(N), r = 3;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let a = 0; for (let k = -r; k <= r; k++) a += H[y * S + ((x + k) & TWM)]; T[y * S + x] = a / (2 * r + 1); }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let a = 0; for (let k = -r; k <= r; k++) a += T[((y + k) & TWM) * S + x]; B[y * S + x] = a / (2 * r + 1); }
  const k = kind === 'wall' ? 1.5 : kind === 'floor' ? 1.1 : kind === 'ceil' ? 0.8 : kind === 'water' ? 0.35 : 0.8;
  const grimeAmt = kind === 'wall' ? 1 : kind === 'ceil' ? 0.7 : kind === 'special' ? 0.35 : kind === 'water' ? 0 : 0.5;
  for (let y = 0; y < S; y++) {
    const fy = y / S;
    for (let x = 0; x < S; x++) {
      const i = y * S + x, ni = ((y + oy) & TWM) * S + ((x + ox) & TWM), n2 = ((y + sOff) & TWM) * S + ((x * 3 + ox) & TWM);
      let rr = cr_[i], gg = cg_[i], bb = cb_[i];
      const relief = 1 + (H[((y - 1) & TWM) * S + ((x - 1) & TWM)] - H[((y + 1) & TWM) * S + ((x + 1) & TWM)]) * k;           // light from the upper left
      const ao = 1 - Math.min(0.42, Math.max(0, (B[i] - H[i]) * 1.7));                                                         // crevices and mortar sink into shadow
      const mott = 1 + (F.mottle[ni] - 0.5) * 0.4, grain = 1 + (F.grain[ni] - 0.5) * 0.16;
      let grime = 1;
      if (grimeAmt > 0) {
        if (kind === 'wall' || kind === 'special') {
          grime *= 1 - 0.3 * grimeAmt * Math.pow(Math.max(0, (fy - 0.55) / 0.45), 1.5);                                       // dirt gathers toward the floor
          grime *= 1 - 0.18 * grimeAmt * Math.pow(Math.max(0, (0.14 - fy) / 0.14), 1.3);                                      // soot under the ceiling
          const s = F.streak[(x + sOff) & TWM]; if (s > 0.62) grime *= 1 - Math.min(0.4, (s - 0.62) * 1.6) * grimeAmt * (1 - fy * 0.55); // drip streaks
        } else grime *= 1 - 0.1 * grimeAmt * F.mottle2[n2];
        const st = F.mottle2[ni]; if (st > 0.66) { const a = Math.min(1, (st - 0.66) * 4) * 0.35 * grimeAmt; rr = rr * (1 - a) + 70 * a; gg = gg * (1 - a) + 38 * a; bb = bb * (1 - a) + 30 * a; } // old stains
      }
      let f = relief * ao * mott * grain * grime; f = Math.max(0.55, Math.min(1.45, f));
      rr *= f; gg *= f; bb *= f;
      // muted grade: desaturate a little, cool the shadows, warm the lights
      const l = rr * 0.3 + gg * 0.59 + bb * 0.11, ds = kind === 'special' ? 0.08 : 0.22;
      rr += (l - rr) * ds; gg += (l - gg) * ds; bb += (l - bb) * ds;
      if (l < 70) { const t = 1 - l / 70; rr *= 1 - 0.1 * t; bb *= 1 + 0.06 * t; } else { const t = Math.min(1, (l - 140) / 115); rr *= 1 + 0.05 * t; bb *= 1 - 0.05 * t; }
      out[i] = (0xff000000 | (Math.min(255, Math.max(0, bb)) << 16) | (Math.min(255, Math.max(0, gg)) << 8) | Math.min(255, Math.max(0, rr))) >>> 0;
    }
  }
  return { w: S, h: S, data: out };
}

export function buildTextures() {
  const t = new Array(90).fill(null);
  const set = (id, canvas) => { t[id] = canvas.finish(); };
  const stone = [P('#3c3a38'), P('#4a4744'), P('#59554f'), P('#6a655c')];
  const mossPal = [P('#22301a'), P('#33471f'), P('#4a6a2c')];
  set(WALL.brick, stoneVar(bricks(101, { rows: 4, cols: 2, pal: stone, mortar: P('#141212'), cracks: 3 }), 11, 0.1));
  set(WALL.moss, stoneVar(bricks(102, { rows: 4, cols: 2, pal: stone, mortar: P('#111311'), cracks: 3, moss: mossPal }), 12, 0.1));
  set(WALL.bone, boneWall(103));
  set(WALL.sand, stoneVar(bricks(104, { rows: 4, cols: 2, pal: [P('#7d6440'), P('#98784a'), P('#b28c58'), P('#c9a16a')], mortar: P('#3a2a18'), cracks: 2 }), 13, 0.12));
  set(WALL.glyph, glyphWall(105, false));
  set(WALL.royalGlyph, glyphWall(106, true));
  set(WALL.wet, stoneVar(bricks(107, { rows: 4, cols: 2, pal: [P('#1e2c30'), P('#28383c'), P('#344a4e'), P('#42585a')], mortar: P('#080e10'), cracks: 3, moss: [P('#123a30'), P('#1a5040')], wet: 0.8 }), 14, 0.1));
  set(WALL.gold, goldTrim(108));
  set(WALL.mural, mural(109));
  set(WALL.flesh, fleshWall(110));
  set(WALL.deepFlesh, (() => { const c = fleshWall(111); c.shade(0.85); return c; })());
  set(WALL.pillar, pillarTex(112));
  set(WALL.door, woodDoor(113));
  set(WALL.sealed, sealedDoor(114));
  set(WALL.bars, barsTex(115));
  set(WALL.altar, altarWall(116));
  set(WALL.store, storeWall(117));
  set(WALL.portal, portalWall(118));
  set(WALL.niche, nicheWall(119));
  set(WALL.ossuaryBrick, stoneVar(bricks(120, { rows: 4, cols: 2, pal: [P('#3a3428'), P('#4a4234'), P('#5c5240'), P('#6e6450')], mortar: P('#110e0a'), cracks: 3 }), 15, 0.1));

  set(FLOOR.flag, flagFloor(201, stone.map((c) => scaleColor(c, 0.8)), P('#0c0b0b')));
  set(FLOOR.flagCrack, flagFloor(202, stone.map((c) => scaleColor(c, 0.75)), P('#0c0b0b'), 7));
  set(FLOOR.mossFlag, bricks(203, { rows: 2, cols: 2, pal: stone.map((c) => scaleColor(c, 0.75)), mortar: P('#0a0c0a'), cracks: 3, moss: mossPal, stagger: false }));
  set(FLOOR.sand, sandFloor(204));
  set(FLOOR.water, waterFloor(205));
  set(FLOOR.goldTile, goldTile(206));
  set(FLOOR.bone, boneFloor(207));
  set(FLOOR.flesh, fleshFloor(208));
  set(FLOOR.altar, altarFloor(209));
  set(FLOOR.wood, woodFloor(210));
  set(FLOOR.royalFlag, flagFloor(211, [P('#2a1c22'), P('#38242c'), P('#463038')], P('#0c0608'), 3));
  set(FLOOR.wetFlag, flagFloor(212, [P('#1c2a2e'), P('#26383c'), P('#324a4e')], P('#060c0e'), 3));

  set(CEIL.stone, ceilTex(301, stone.map((c) => scaleColor(c, 0.7)), P('#0a0909')));
  set(CEIL.bone, ceilBone(302));
  set(CEIL.sand, ceilTex(303, [P('#5a4630'), P('#6a5238'), P('#7a5e40')], P('#20160c')));
  set(CEIL.drip, ceilDrip(304));
  set(CEIL.royal, ceilTex(305, [P('#2a1a20'), P('#382229'), P('#442a32')], P('#0a0508')));
  set(CEIL.flesh, ceilFlesh(306));
  set(CEIL.dark, ceilTex(307, [P('#14120f'), P('#1c1a16'), P('#24211c')], P('#050505')));

  set(DECAL.pentagram, pentagramDecal(false));
  set(DECAL.pentagramUsed, pentagramDecal(true));
  set(DECAL.portal, portalDecal());
  set(DECAL.trapdoor, trapdoorDecal());
  set(DECAL.spikePlate, spikePlateDecal());
  set(DECAL.sigilRed, sigilDecal(P('#a01818')));
  set(DECAL.sigilBlue, sigilDecal(P('#3a90c0')));
  set(DECAL.sigilGold, sigilDecal(P('#d0a030')));
  // decals: black = transparent
  for (let id = 70; id < 78; id++) {
    const tx = t[id]; if (!tx) continue;
    for (let i = 0; i < tx.data.length; i++) if (tx.data[i] === 0 || (tx.data[i] & 0xffffff) === 0) tx.data[i] = 0;
  }
  for (let id = 0; id < t.length; id++) if (t[id]) t[id] = realism(t[id], id); // 64x64 art -> 128x128 with detail
  return t;
}

// Fix: Canvas.fill leaves untouched pixels 0 (transparent); ensure opaque textures have alpha.
export function opaque(tex) {
  for (let i = 0; i < tex.data.length; i++) tex.data[i] = (tex.data[i] | 0xff000000) >>> 0;
  return tex;
}
