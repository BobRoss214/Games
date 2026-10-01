// "Realism" pass for sprites: takes a hand-drawn low-res frame and returns a 2x frame with
// form shading, edge darkening, grain, grime and (optionally) wounds that grow as HP drops.
// Pure functions on pixel buffers (runs in Node as well). Deterministic per seed.
import { PC } from './pixart.js';
import { RNG, clamp, rgb, cr, cg, cb, ca } from './util.js';

const K = 2; // upscale factor

function blur(src, w, h, passes) {
  let a = src, b = new Float32Array(w * h);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += a[yy * w + xx]; n++; } }
      b[y * w + x] = s / n;
    }
    const t = a; a = b; b = t === src ? new Float32Array(w * h) : t;
  }
  return a;
}

// colours for blood / gore
const BLOOD = [rgb(46, 4, 8), rgb(84, 8, 14), rgb(128, 12, 20), rgb(168, 22, 30)];
const WET = rgb(214, 70, 78);
const MEAT = [rgb(70, 10, 16), rgb(110, 20, 28), rgb(150, 36, 44)];

// kind: 'bone' | 'flesh' | 'ooze'; wound: 0..3
export function realize(base, { seed = 1, kind = 'flesh', wound = 0, gore = 0 } = {}) {
  const sw = base.w, sh = base.h, W = sw * K, Hh = sh * K, rng = new RNG(seed * 7919 + 13);
  const out = new PC(W, Hh);
  // 1. smooth upscale: coverage (alpha) + premultiplied colour
  const cov = new Float32Array(W * Hh), R = new Float32Array(W * Hh), G = new Float32Array(W * Hh), B = new Float32Array(W * Hh), emis = new Uint8Array(W * Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const fx = (x + 0.5) / K - 0.5, fy = (y + 0.5) / K - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    let c = 0, r = 0, g = 0, b = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const xx = x0 + i, yy = y0 + j; if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue;
      const px = base.d[yy * sw + xx]; if (!ca(px)) continue;
      const wt = (i ? tx : 1 - tx) * (j ? ty : 1 - ty); c += wt; r += wt * cr(px); g += wt * cg(px); b += wt * cb(px);
    }
    const o = y * W + x; cov[o] = c;
    const nx = clamp(Math.floor((x) / K), 0, sw - 1), ny = clamp(Math.floor((y) / K), 0, sh - 1), np = base.d[ny * sw + nx];
    if (ca(np)) { R[o] = cr(np); G[o] = cg(np); B[o] = cb(np); } else if (c > 0) { R[o] = r / c; G[o] = g / c; B[o] = b / c; }
    if (ca(np) === 254) emis[o] = 1;
  }
  // silhouette: keep it crisp (hard threshold), so it still reads as pixel art
  const mask = new Float32Array(W * Hh); for (let i = 0; i < mask.length; i++) mask[i] = cov[i] >= 0.5 ? 1 : 0;
  // 2. height field: inflated silhouette + luminance detail
  const lum = new Float32Array(W * Hh); for (let i = 0; i < lum.length; i++) lum[i] = mask[i] ? (0.3 * R[i] + 0.59 * G[i] + 0.11 * B[i]) / 255 : 0;
  const infl = blur(mask, W, Hh, 4), lumB = blur(lum, W, Hh, 1), lumBB = blur(lum, W, Hh, 3);
  const hgt = new Float32Array(W * Hh); for (let i = 0; i < hgt.length; i++) hgt[i] = infl[i] * 2.2 + lumB[i] * 1.3;
  const gl = (x, y) => hgt[clamp(y, 0, Hh - 1) * W + clamp(x, 0, W - 1)];
  // 3. shade
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const o = y * W + x; if (!mask[o]) continue;
    if (emis[o]) { out.d[o] = rgb(R[o], G[o], B[o], 254); continue; }
    const dx = gl(x + 1, y) - gl(x - 1, y), dy = gl(x, y + 1) - gl(x, y - 1);
    const lit = clamp(-(dx * 0.7 + dy * 0.7) * 1.1, -0.6, 0.6); // light from the upper left
    const edge = clamp(infl[o] * 1.35, 0, 1); // darker near the silhouette
    const crev = clamp((lumBB[o] - lum[o]) * 2.2, 0, 0.5); // crevice AO from detail darker than neighbourhood
    const grain = (rng.next() - 0.5) * 0.14;
    const grime = clamp((y / Hh - 0.55) * 0.5, 0, 0.22); // dirt creeps up from the feet
    let f = (0.98 + lit * 0.8) * (0.72 + 0.28 * edge) * (1 - crev) * (1 - grime) * (1 + grain);
    let r = R[o], g = G[o], b = B[o];
    const l = 0.3 * r + 0.59 * g + 0.11 * b, ds = 0.18; r += (l - r) * ds; g += (l - g) * ds; b += (l - b) * ds; // desaturate a little
    if (f < 1) { r *= f * 0.98; g *= f; b *= f * 1.04; } else { r *= f; g *= f * 0.97; b *= f * 0.92; } // cool shadows, warm lights
    out.d[o] = rgb(clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255));
  }
  // 3b. age: pitting, cracks and stains on bone, pores and mottling on flesh
  if (kind === 'bone') {
    for (let i = 0; i < W * Hh * 0.012; i++) { const x = rng.int(0, W - 1), y = rng.int(0, Hh - 1), o = y * W + x; if (mask[o] && !emis[o] && lum[o] > 0.3) { const c = out.d[o]; out.d[o] = rgb(cr(c) * 0.55, cg(c) * 0.5, cb(c) * 0.45); } }
    for (let k = 0; k < 3; k++) { let x = rng.int(Math.floor(W * 0.3), Math.floor(W * 0.7)), y = rng.int(Math.floor(Hh * 0.08), Math.floor(Hh * 0.3)); for (let i = 0; i < 6 + rng.int(0, 6); i++) { const o = y * W + x; if (mask[o] && !emis[o] && lum[o] > 0.3) out.d[o] = rgb(40, 30, 24); x += rng.int(-1, 1); y += 1; } }
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const o = y * W + x; if (!mask[o] || emis[o]) continue; const st = Math.sin(x * 0.31 + y * 0.12) * Math.sin(y * 0.23 - x * 0.07); if (st > 0.55) { const c = out.d[o]; out.d[o] = rgb(cr(c) * 0.88, cg(c) * 0.84, cb(c) * 0.72); } }
  }
  // 4. wounds & gore
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < Hh && mask[y * W + x] > 0 && !emis[y * W + x];
  const body = []; for (let y = Math.floor(Hh * 0.22); y < Hh * 0.78; y++) for (let x = 0; x < W; x++) if (solid(x, y) && infl[y * W + x] > 0.55) body.push([x, y]);
  const paint = (x, y, c) => { if (solid(x, y)) out.d[y * W + x] = c; };
  const drip = (x, y, len) => { for (let i = 0; i < len; i++) { if (!solid(x, y + i)) break; paint(x, y + i, BLOOD[i < 3 ? 3 : 2]); paint(x + 1, y + i, BLOOD[1]); if (i > 1 && rng.next() < 0.3) paint(x + (rng.next() < 0.5 ? -1 : 1), y + i, BLOOD[1]); } paint(x, y + len, WET); };
  const nW = Math.max(wound, gore ? 1 : 0);
  const blob = (cx, cy, rx, ry) => { // torn-open flesh with a lit lip and dark depth
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy + (rng.next() - 0.5) * 0.35; if (d > 1) continue;
      paint(x, y, d > 0.72 ? BLOOD[3] : d > 0.35 ? MEAT[2 - ((x + y) & 1)] : d > 0.12 ? MEAT[0] : BLOOD[0]);
    }
    paint(Math.round(cx - rx * 0.4), Math.round(cy - ry * 0.55), WET); paint(Math.round(cx + rx * 0.2), Math.round(cy - ry * 0.5), WET);
  };
  if (body.length && nW > 0 && kind !== 'ooze') {
    const count = nW + (nW > 2 ? 1 : 0);
    for (let k = 0; k < count; k++) {
      const [sx, sy] = body[rng.int(0, body.length - 1)];
      const ang = (rng.next() < 0.5 ? 0.9 : -0.9) + (rng.next() - 0.5) * 0.7, len = 9 + rng.int(0, 8) + nW * 2;
      for (let i = 0; i < len; i++) {
        const x = Math.round(sx + Math.cos(ang) * i), y = Math.round(sy + Math.sin(ang) * i * 0.9), mid = Math.sin((i / len) * Math.PI);
        if (kind === 'bone') { paint(x, y, rgb(14, 9, 8)); paint(x + 1, y, rgb(30, 20, 16)); if (mid > 0.5) { paint(x, y + 1, BLOOD[1]); paint(x - 1, y, BLOOD[2]); } }
        else { const wd = mid > 0.6 ? 2 : 1; for (let q = -wd; q <= wd; q++) paint(x, y + q, Math.abs(q) === wd ? BLOOD[3] : q === 0 ? BLOOD[0] : MEAT[1]); }
      }
      if (kind === 'flesh' && nW >= 2) blob(sx + Math.cos(ang) * len * 0.5, sy + Math.sin(ang) * len * 0.45, 4 + nW, 3 + nW * 0.7);
      else if (kind === 'bone' && nW >= 2) { blob(sx + Math.cos(ang) * len * 0.5, sy + Math.sin(ang) * len * 0.45, 2.5 + nW * 0.5, 2 + nW * 0.5); }
      paint(sx, sy, WET);
      if (rng.next() < 0.9) drip(Math.round(sx + Math.cos(ang) * len * 0.6), Math.round(sy + Math.sin(ang) * len * 0.55), 6 + rng.int(0, 10) + nW * 3);
      if (rng.next() < 0.6) drip(Math.round(sx + Math.cos(ang) * len * 0.3) + 2, Math.round(sy + Math.sin(ang) * len * 0.28), 4 + rng.int(0, 7) + nW * 2);
      for (let s2 = 0; s2 < 8 + nW * 4; s2++) { const px = sx + rng.int(-10, 10), py = sy + rng.int(-10, 10); paint(px, py, BLOOD[rng.int(1, 3)]); if (rng.next() < 0.4) { paint(px + 1, py, BLOOD[2]); paint(px, py + 1, BLOOD[1]); } }
    }
    if (nW >= 3) { // heavily wounded: a big dark blood sheet down the torso
      const [cx, cy] = body[Math.floor(body.length * 0.45)];
      for (let j = 0; j < Hh * 0.3; j++) for (let i = -6; i <= 6; i++) { if (rng.next() < 0.75 - Math.abs(i) * 0.07 - j / (Hh * 0.45)) paint(cx + i + Math.round(Math.sin(j * 0.4) * 1.5), cy + j, BLOOD[(i + j) & 1 ? 1 : 2]); }
    }
  }
  if (kind === 'ooze' && nW > 0) { // slimes: darker torn patches, no blood lines
    for (let k = 0; k < nW * 4; k++) { const [sx, sy] = body.length ? body[rng.int(0, body.length - 1)] : [0, 0]; for (let s = 0; s < 6; s++) paint(sx + rng.int(-3, 3), sy + rng.int(-3, 3), rgb(20, 40, 16)); }
  }
  out.outline(rgb(14, 9, 8));
  return out;
}
