// Tiny pixel-art painting toolkit used to draw every sprite in code.
import { rgb, hex, cr, cg, cb, ca, mix, scaleColor, RNG, clamp } from './util.js';

export const H = (s, a = 255) => hex(s, a);
export const GLOW = (s) => hex(s, 254); // alpha 254 == emissive pixel (ignores lighting)

export class PC {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint32Array(w * h); }
  set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = c; }
  get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.d[y * this.w + x] : 0; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  // shaded rect: light from top-left, pal = [dark, mid, light]
  srect(x, y, w, h, pal) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const t = (i / Math.max(1, w - 1)) * 0.5 + (j / Math.max(1, h - 1)) * 0.5;
      this.set(x + i, y + j, pal[t < 0.28 ? 2 : t < 0.68 ? 1 : 0]);
    }
  }
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry; if (dx * dx + dy * dy <= 1) this.set(x, y, c);
    }
  }
  // shaded ellipse with palette [dark..light]
  sell(cx, cy, rx, ry, pal, lx = -0.5, ly = -0.6) {
    const n = pal.length;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy;
      if (d > 1) continue;
      const l = clamp(0.5 + (-(dx * lx + dy * ly)) * 0.5 - d * 0.25, 0, 0.999);
      this.set(x, y, pal[Math.floor(l * n)]);
    }
  }
  line(x0, y0, x1, y1, c, th = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      if (th <= 1) this.set(x, y, c); else this.disc(x, y, th / 2, c);
    }
  }
  disc(cx, cy, r, c) { for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.25) this.set(x, y, c); }
  // limb with shading: thick line with light edge
  limb(x0, y0, x1, y1, th, pal) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      this.disc(x, y, th / 2, pal[0]);
    }
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      this.disc(x - 0.4, y - 0.4, Math.max(0.5, th / 2 - 0.6), pal[1]);
    }
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      if (th >= 3) this.set(x - th / 4, y - th / 4, pal[2]);
    }
  }
  tri(x0, y0, x1, y1, x2, y2, c) {
    const minx = Math.floor(Math.min(x0, x1, x2)), maxx = Math.ceil(Math.max(x0, x1, x2)), miny = Math.floor(Math.min(y0, y1, y2)), maxy = Math.ceil(Math.max(y0, y1, y2));
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0) || 1;
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area, w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area, w2 = 1 - w0 - w1;
      if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) this.set(x, y, c);
    }
  }
  quad(pts, c) { this.tri(pts[0][0], pts[0][1], pts[1][0], pts[1][1], pts[2][0], pts[2][1], c); this.tri(pts[0][0], pts[0][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1], c); }
  glow(x, y, r, c) { this.disc(x, y, r, c); }
  noise(seed, amt, mask = true) {
    const rng = new RNG(seed);
    for (let i = 0; i < this.d.length; i++) { const c = this.d[i]; if (ca(c) === 0 || ca(c) === 254) continue; this.d[i] = scaleColor(c, 1 + rng.float(-amt, amt)); }
    return this;
  }
  outline(col) {
    const src = this.d.slice();
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (ca(src[y * this.w + x]) !== 0) continue;
      let adj = false;
      if (x > 0 && ca(src[y * this.w + x - 1]) !== 0) adj = true; else if (x < this.w - 1 && ca(src[y * this.w + x + 1]) !== 0) adj = true; else if (y > 0 && ca(src[(y - 1) * this.w + x]) !== 0) adj = true; else if (y < this.h - 1 && ca(src[(y + 1) * this.w + x]) !== 0) adj = true;
      if (adj) this.d[y * this.w + x] = col;
    }
    return this;
  }
  // blit another PC
  blit(o, x, y, flip = false) { for (let j = 0; j < o.h; j++) for (let i = 0; i < o.w; i++) { const c = o.d[j * o.w + i]; if (ca(c)) this.set(x + (flip ? o.w - 1 - i : i), y + j, c); } }
  flipX() { const o = new PC(this.w, this.h); for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) o.d[y * this.w + x] = this.d[y * this.w + (this.w - 1 - x)]; return o; }
  // tint every opaque pixel towards colour
  tint(col, t) { for (let i = 0; i < this.d.length; i++) { const c = this.d[i]; if (ca(c) === 0 || ca(c) === 254) continue; this.d[i] = mix(c, col, t); } return this; }
  frame() { return { w: this.w, h: this.h, data: this.d }; }
  clone() { const o = new PC(this.w, this.h); o.d.set(this.d); return o; }
}

export function pal3(dark, mid, light) { return [H(dark), H(mid), H(light)]; }
export function pal4(a, b, c, d) { return [H(a), H(b), H(c), H(d)]; }
export function pal5(a, b, c, d, e) { return [H(a), H(b), H(c), H(d), H(e)]; }

// Rotate 90 degrees clockwise (used for corpses)
export function rot90(pc) {
  const o = new PC(pc.h, pc.w);
  for (let y = 0; y < pc.h; y++) for (let x = 0; x < pc.w; x++) o.d[x * o.w + (pc.h - 1 - y)] = pc.d[y * pc.w + x];
  return o;
}
// Non-uniform scale (nearest)
export function scaled(pc, nw, nh) {
  const o = new PC(nw, nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) o.d[y * nw + x] = pc.d[Math.min(pc.h - 1, Math.floor((y / nh) * pc.h)) * pc.w + Math.min(pc.w - 1, Math.floor((x / nw) * pc.w))];
  return o;
}
