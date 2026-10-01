// Procedural monster / hero / statue sprites. Each painter returns a PC; poses are parameterised.
import { PC, H, GLOW, pal3, pal4, pal5, rot90, scaled } from './pixart.js';
import { RNG, clamp } from './util.js';

const BONE = pal4('#5a4e3e', '#9a8c72', '#cfc3a6', '#eee6cc');
const WRAP = pal4('#6e6248', '#a89a76', '#cbbd94', '#e6dab4');
const DARK = H('#140e0b');
const FLESH = pal5('#3a0c12', '#5c1520', '#8a2430', '#b03e44', '#d27070');
const IRON = pal4('#2a2c32', '#4a4d56', '#7a7e88', '#aab0ba');
const GOLD = pal4('#6a4a12', '#a87c24', '#d8ac3c', '#f8dc72');
const PURPLE = pal4('#20102c', '#3a1c50', '#5a2c7a', '#7c44a0');
const STONE = pal5('#26262a', '#3a3a40', '#54545c', '#74747c', '#96969e');

export function pose(name, n = 0) {
  const p = { bob: 0, ls: 0, as: 0, raise: 0, lunge: 0, lean: 0, squash: 0 };
  if (name === 'idle') { p.bob = n % 2 ? 1 : 0; p.as = n % 2 ? 0.15 : 0; }
  else if (name === 'walk') { const t = (n / 4) * Math.PI * 2; p.ls = Math.sin(t); p.as = -Math.sin(t) * 0.8; p.bob = -Math.abs(Math.cos(t)) * 1.4 + 1; p.squash = Math.abs(Math.cos(t)); }
  else if (name === 'atk') { if (n === 0) { p.raise = 1; p.lean = -2; p.bob = 1; } else { p.raise = -0.4; p.lunge = 1; p.lean = 3; p.bob = 1; } }
  else if (name === 'hurt') { p.lean = -4; p.raise = 0.3; p.bob = 1; }
  return p;
}

// ---------- shared humanoid skeleton ----------
function skull(pc, cx, cy, r, o = {}) {
  const pal = o.pal || BONE;
  pc.sell(cx, cy, r, r + 0.6, pal);
  pc.rect(cx - r + 2, cy + r - 2, r * 2 - 3, 3, pal[1]); // upper jaw
  // cheekbones and brow
  pc.set(cx - r + 0.5, cy + 1.5, pal[3]); pc.set(cx + r - 0.5, cy + 1.5, pal[0]); pc.line(cx - r + 1, cy - 2.5, cx + r - 1, cy - 2.5, pal[3]);
  // sockets (deep) and nose cavity
  pc.disc(cx - r * 0.45, cy - 0.5, r * 0.32 + 0.6, DARK); pc.disc(cx + r * 0.45, cy - 0.5, r * 0.32 + 0.6, DARK);
  const eye = o.eye || GLOW('#ff3020');
  pc.set(cx - r * 0.45, cy - 0.5, eye); pc.set(cx + r * 0.45, cy - 0.5, eye);
  if (o.big) { pc.set(cx - r * 0.45 - 1, cy - 0.5, eye); pc.set(cx + r * 0.45 + 1, cy - 0.5, eye); }
  pc.set(cx, cy + 1.5, DARK); pc.set(cx - 0.6, cy + 2.2, DARK); pc.set(cx + 0.6, cy + 2.2, DARK);
  // teeth: alternating light and dark between the jaw line and the chin
  for (let i = 0; i < r * 2 - 3; i++) pc.set(cx - r + 2 + i, cy + r, i & 1 ? DARK : pal[3]);
  for (let i = 0; i < r * 2 - 4; i++) pc.set(cx - r + 2.5 + i, cy + r + 1, i & 1 ? pal[3] : pal[0]);
  pc.set(cx - r + 1, cy + r - 1, DARK); pc.set(cx + r - 1, cy + r - 1, DARK); // jaw hinge gaps
  // a hairline crack across the cranium
  pc.set(cx + 1, cy - r + 0.5, pal[0]); pc.set(cx + 1.5, cy - r + 1.5, pal[0]); pc.set(cx + 1, cy - r + 2.5, pal[0]);
}

function skeletonBody(pc, p, o = {}) {
  const cx = 20 + p.lean * 0.4, bob = p.bob, hipY = 36 + bob;
  const limb = o.limb || BONE;
  // legs: femur + shin with a kneecap, and a foot
  for (const s of [-1, 1]) {
    const sw = s < 0 ? p.ls : -p.ls;
    const fx = cx + s * 3.5 + sw * 3.5, fy = 54 - Math.max(0, sw) * 3;
    const kx = cx + s * 3.2 + sw * 1.6, ky = (hipY + fy) / 2 + 1 - Math.max(0, sw) * 1.5;
    pc.limb(cx + s * 2.5, hipY, kx, ky, 2.9, limb);
    pc.limb(kx, ky, fx, fy, 2.2, limb);
    pc.disc(kx, ky, 1.7, limb[3]); pc.set(kx - 0.6, ky - 0.6, limb[3]);
    pc.rect(fx - 2, fy, 5, 2, limb[1]); pc.set(fx + 2, fy + 1, limb[2]); pc.set(fx - 2, fy, limb[0]);
  }
  // pelvis: iliac wings around a dark gap
  pc.sell(cx, hipY, 4.8, 2.6, limb);
  pc.tri(cx - 6, hipY - 2, cx - 2, hipY - 1, cx - 3, hipY + 3, limb[2]); pc.tri(cx + 6, hipY - 2, cx + 2, hipY - 1, cx + 3, hipY + 3, limb[1]);
  pc.set(cx, hipY + 1, DARK); pc.set(cx, hipY + 2, DARK);
  // ribcage: dark hollow, curved ribs that meet a sternum, collar bones, vertebrae
  pc.ellipse(cx, 25 + bob, 6.5, 8.5, DARK);
  for (let i = 0; i < 5; i++) {
    const y = 18.5 + bob + i * 2.9, w = 6.2 - Math.abs(i - 1.3) * 0.8 - i * 0.15;
    for (const s of [-1, 1]) {
      pc.line(cx + s * 1.2, y, cx + s * w, y + 1.4, s < 0 ? limb[2] : limb[1], 1.3);
      pc.set(cx + s * (w - 0.5), y + 1.5, limb[3]); pc.set(cx + s * (w + 0.2), y + 2.2, limb[0]);
    }
  }
  pc.line(cx - 6, 16.2 + bob, cx - 1, 17 + bob, limb[2]); pc.line(cx + 6, 16.2 + bob, cx + 1, 17 + bob, limb[1]);
  pc.line(cx, 17.5 + bob, cx, 29 + bob, limb[2], 1.2); // sternum
  for (let i = 0; i < 9; i++) pc.set(cx, 15 + bob + i * 2.1, i & 1 ? limb[3] : limb[1]); // spine (down the middle, behind the ribs)
  for (let i = 0; i < 4; i++) { pc.set(cx, 32 + bob + i * 1.2, limb[2]); } // lumbar vertebrae
  return { cx, bob, hipY };
}

function armPair(pc, p, cx, bob, o = {}) {
  const limb = o.limb || BONE;
  const sy = 17 + bob;
  // left arm (viewer's left): swing
  const lax = cx - 9 - p.as * 1.5, lay = 33 + p.as * 2;
  pc.limb(cx - 7.5, sy, lax, lay, 2.4, limb); pc.disc(lax, lay, 1.6, limb[2]);
  // right arm (weapon arm)
  let rax, ray;
  if (p.raise > 0.5) { rax = cx + 9; ray = 8 + bob; }
  else if (p.lunge) { rax = cx + 10; ray = 30; }
  else { rax = cx + 9 + p.as * 1.5; ray = 33 - p.as * 2; }
  pc.limb(cx + 7.5, sy, rax, ray, 2.4, limb); pc.disc(rax, ray, 1.6, limb[2]);
  return { lax, lay, rax, ray };
}

function sword(pc, x, y, ang, len, col, glow) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  pc.line(x, y, x + dx * len, y + dy * len, col[1], 2.4);
  pc.line(x + dx * 1, y + dy * 1, x + dx * len, y + dy * len, col[2], 1);
  pc.line(x - dy * 2.6 + dx * 1.5, y + dx * 2.6 + dy * 1.5, x + dy * 2.6 + dx * 1.5, y - dx * 2.6 + dy * 1.5, col[0], 1.6); // guard
  if (glow) pc.set(x + dx * len, y + dy * len, glow);
}

export function paintSkeleton(tier, p) {
  const pc = new PC(44, 60);
  const oc = 2; // offset so we have room for weapon reach
  const g = new PC(40, 56);
  const cape = tier >= 2;
  if (cape) { g.tri(12 + p.lean * 0.3, 16 + p.bob, 28 + p.lean * 0.3, 16 + p.bob, 20, 52, PURPLE[1]); g.tri(12, 16, 20, 16, 15, 52, PURPLE[0]); }
  const b = skeletonBody(g, p);
  if (tier >= 1) { // breastplate
    g.sell(b.cx, 24 + b.bob, 6.2, 7.6, IRON); g.line(b.cx, 17 + b.bob, b.cx, 31 + b.bob, IRON[0]);
    g.rect(b.cx - 5, 30 + b.bob, 10, 2, IRON[0]);
  }
  const arms = armPair(g, p, b.cx, b.bob);
  const hx = b.cx, hy = 10 + b.bob;
  skull(g, hx, hy, 5.6, { eye: tier >= 2 ? GLOW('#ffd040') : GLOW('#ff3020'), big: tier >= 2 });
  if (tier >= 1) { // iron helm
    g.sell(hx, hy - 2, 6.4, 4.6, IRON); g.rect(hx - 6, hy - 1, 13, 1, IRON[0]); g.rect(hx - 1, hy - 1, 2, 6, IRON[1]);
  }
  if (tier >= 2) { // horns / crown
    g.tri(hx - 6, hy - 4, hx - 9, hy - 10, hx - 3, hy - 5, GOLD[2]); g.tri(hx + 6, hy - 4, hx + 9, hy - 10, hx + 3, hy - 5, GOLD[2]);
    for (let i = 0; i < 4; i++) g.tri(hx - 4 + i * 2.7, hy - 5, hx - 3 + i * 2.7, hy - 8, hx - 2 + i * 2.7, hy - 5, GOLD[3]);
    g.disc(arms.lax - 1, 18 + b.bob, 2.6, PURPLE[2]); g.disc(arms.rax - 4, 18 + b.bob, 2.6, PURPLE[2]); // spectral pauldrons
  }
  // shield (left) for tier1+
  if (tier >= 1) { g.sell(arms.lax - 2, arms.lay - 4, 6.5, 7.5, IRON); g.disc(arms.lax - 2, arms.lay - 4, 2, GOLD[2]); g.ring && 0; g.line(arms.lax - 8, arms.lay - 4, arms.lax + 4, arms.lay - 4, IRON[0]); }
  // sword
  const ang = p.raise > 0.5 ? -1.9 : p.lunge ? -0.6 : -1.35;
  sword(g, arms.rax, arms.ray, ang, tier >= 2 ? 19 : tier >= 1 ? 16 : 14, tier >= 2 ? pal4('#1a5a3a', '#3adf8a', '#a0ffd0', '#e0fff0') : tier >= 1 ? IRON : pal4('#3a2a1a', '#7a5a3a', '#a8987a', '#cfc3a6'), tier >= 2 ? GLOW('#a0ffd0') : null);
  g.noise(3 + tier, 0.06);
  pc.blit(g, 2, 4); pc.outline(DARK); return pc;
}

export function paintArcher(tier, p) {
  const pc = new PC(44, 60), g = new PC(40, 56);
  const ghost = tier >= 2;
  if (tier >= 1) { g.tri(13, 15 + p.bob, 27, 15 + p.bob, 20, ghost ? 50 : 40, pal3('#1a2a1a', '#2a4a2a', '#3a6a3a')[1]); }
  if (ghost) { for (let i = 0; i < 6; i++) g.tri(12 + i * 3, 38, 15 + i * 3, 38, 13.5 + i * 3 + (i % 2) * 1.5, 52 - (i % 3) * 3, H('#2a6a4a')); }
  const b = skeletonBody(g, p, { limb: ghost ? pal4('#1a4a3a', '#3a8a6a', '#7ad0a8', '#c8ffe0') : BONE });
  const hx = b.cx, hy = 10 + b.bob;
  skull(g, hx, hy, 5.4, { eye: ghost ? GLOW('#40ffb0') : GLOW('#ffb030'), pal: ghost ? pal4('#1a4a3a', '#3a8a6a', '#7ad0a8', '#c8ffe0') : BONE });
  if (tier >= 1) { g.sell(hx, hy - 1, 7, 6, pal3('#101c10', '#1e3a1e', '#2e5a2e')); g.disc(hx, hy + 1, 4, DARK); g.set(hx - 2, hy + 1, GLOW('#ffb030')); g.set(hx + 2, hy + 1, GLOW('#ffb030')); }
  const sy = 17 + b.bob;
  // bow held in left hand extends forward; right pulls string
  const pull = p.raise > 0.5 ? 1 : p.lunge ? 0 : 0.4;
  g.limb(b.cx - 7, sy, b.cx - 12, 22 + b.bob, 2.2, BONE);
  g.limb(b.cx + 7, sy, b.cx + 3 - pull * 2, 22 + b.bob, 2.2, BONE);
  const bx = b.cx - 13;
  for (let i = 0; i <= 14; i++) { const t = i / 14, yy = 10 + b.bob + t * 24, off = Math.sin(t * Math.PI) * 5; g.disc(bx - off + 6, yy, 1, H('#6a4a2a')); }
  g.line(bx + 6, 10 + b.bob, b.cx + 3 - pull * 2, 22 + b.bob, H('#d8d0b0')); g.line(bx + 6, 34 + b.bob, b.cx + 3 - pull * 2, 22 + b.bob, H('#d8d0b0'));
  if (!p.lunge) g.line(bx + 4, 22 + b.bob, b.cx + 3 - pull * 2, 22 + b.bob, ghost ? H('#a0ffd0') : H('#a8987a'), 1);
  g.rect(b.cx + 8, 12 + b.bob, 3, 10, H('#4a3220')); for (let i = 0; i < 3; i++) g.set(b.cx + 8 + i, 11 + b.bob, H('#cfc3a6')); // quiver
  g.noise(9 + tier, 0.06);
  pc.blit(g, 2, 4); pc.outline(DARK); return pc;
}

export function paintBrute(tier, p) {
  const pc = new PC(64, 72), g = new PC(60, 68);
  const bob = p.bob, cx = 30 + p.lean * 0.5;
  const pal = tier >= 2 ? pal4('#4a3a2a', '#8a7454', '#c8b68c', '#f0e0b0') : BONE;
  for (const s of [-1, 1]) { const sw = s < 0 ? p.ls : -p.ls; g.limb(cx + s * 6, 46 + bob, cx + s * 8 + sw * 4, 66 - Math.max(0, sw) * 3, 6, pal); g.rect(cx + s * 8 + sw * 4 - 4, 65 - Math.max(0, sw) * 3, 9, 3, pal[0]); }
  g.sell(cx, 32 + bob, 15, 15, pal); // hulking torso
  for (let i = 0; i < 4; i++) { g.line(cx - 12, 24 + bob + i * 4, cx + 12, 24 + bob + i * 4 + 1, DARK, 1); } // rib gaps
  g.line(cx, 18 + bob, cx, 46 + bob, pal[0], 2);
  if (tier >= 2) { g.ellipse(cx, 32 + bob, 6, 8, DARK); g.disc(cx, 32 + bob, 4, GLOW('#ff7020')); g.disc(cx, 32 + bob, 2, GLOW('#ffd060')); }
  // shoulder skulls
  for (const s of [-1, 1]) { g.sell(cx + s * 17, 20 + bob, 8, 7, pal); g.disc(cx + s * 17 - 2, 19 + bob, 1.8, DARK); g.disc(cx + s * 17 + 2, 19 + bob, 1.8, DARK); if (tier >= 1) g.tri(cx + s * 22, 17 + bob, cx + s * 27, 9 + bob, cx + s * 20, 22 + bob, pal[3]); }
  // head
  g.sell(cx, 14 + bob, 7, 6.5, pal); g.disc(cx - 3, 13 + bob, 2, DARK); g.disc(cx + 3, 13 + bob, 2, DARK); g.set(cx - 3, 13 + bob, GLOW('#ff5020')); g.set(cx + 3, 13 + bob, GLOW('#ff5020'));
  g.rect(cx - 4, 18 + bob, 9, 2, DARK);
  if (tier >= 1) { g.tri(cx - 6, 10 + bob, cx - 10, 1 + bob, cx - 3, 9 + bob, pal[3]); g.tri(cx + 6, 10 + bob, cx + 10, 1 + bob, cx + 3, 9 + bob, pal[3]); }
  // arms with femur club
  const raise = p.raise > 0.5, lunge = p.lunge;
  g.limb(cx - 20, 24 + bob, cx - 24 - p.as * 2, 44 + p.as * 2, 6, pal); g.sell(cx - 24 - p.as * 2, 46 + p.as * 2, 5, 5, pal);
  const rx = raise ? cx + 24 : lunge ? cx + 26 : cx + 24 + p.as * 2, ry = raise ? 6 : lunge ? 44 : 44 - p.as * 2;
  g.limb(cx + 20, 24 + bob, rx, ry, 6, pal); g.sell(rx, ry, 5, 5, pal);
  // club (big femur)
  const cang = raise ? -2.2 : lunge ? -0.2 : -1.55;
  g.line(rx, ry, rx + Math.cos(cang) * 22, ry + Math.sin(cang) * 22, pal[2], 4.5); g.line(rx, ry, rx + Math.cos(cang) * 22, ry + Math.sin(cang) * 22, pal[1], 2);
  g.disc(rx + Math.cos(cang) * 23, ry + Math.sin(cang) * 23, 3.5, pal[3]);
  g.noise(21 + tier, 0.07);
  pc.blit(g, 2, 2); pc.outline(DARK); return pc;
}

export function paintCrawler(tier, p) {
  const pc = new PC(56, 40), g = new PC(52, 36);
  const sc = 1 + tier * 0.12, bob = p.bob * 0.6, sq = p.squash * 1.2;
  const cx = 26 + p.lean * 0.5 + p.lunge * 3;
  // legs
  for (let i = 0; i < 4; i++) { const s = i < 2 ? -1 : 1, far = i % 2; const sw = Math.sin((p.ls ? 1 : 0) * 0 + (i * 1.7) + p.ls * 2.2) * 2.5; g.limb(cx + s * 9 * sc - far * 3, 24, cx + s * 11 * sc + sw - far * 3, 34, 3, FLESH.slice(1, 4)); g.rect(cx + s * 11 * sc + sw - far * 3 - 2, 33, 4, 2, DARK); }
  g.sell(cx, 20 - bob, 14 * sc, 9.5 * sc - sq, FLESH);
  for (let i = 0; i < 5 + tier * 2; i++) g.disc(cx - 10 + i * (20 / (5 + tier * 2)), 21 - bob + ((i * 7) % 5 - 2), 1.3, FLESH[1]);
  if (tier >= 1) for (let i = 0; i < 6; i++) g.tri(cx - 10 + i * 4, 13 - bob, cx - 8 + i * 4, 6 - bob - tier, cx - 6 + i * 4, 13 - bob, pal3('#a89878', '#d8ccb0', '#f4ecd4')[1]);
  // head + jaw
  const hx = cx + 12 * sc + p.lunge * 2, hy = 19 - bob, open = p.raise > 0.5 || p.lunge ? 1 : 0.3 + tier * 0.15;
  g.sell(hx, hy - 2, 7 * sc, 6 * sc, FLESH);
  g.ellipse(hx + 2, hy + 1, 5 * sc, (2.5 + open * 4) * sc, H('#1a0508'));
  for (let i = 0; i < 4 + tier; i++) { const x = hx - 2 + i * 2.6 * sc; g.tri(x, hy - 1.2 * sc, x + 1.4, hy - 1 * sc, x + 0.7, hy + 2 * sc, pal3('#a89878', '#e8e0c8', '#fffbe8')[1]); g.tri(x + 1, hy + (1 + open * 3.6) * sc, x + 2.4, hy + (1 + open * 3.6) * sc, x + 1.7, hy + (open * 3.6 - 1) * sc, pal3('#a89878', '#e8e0c8', '#fffbe8')[1]); }
  g.disc(hx - 1, hy - 4 * sc, 1.6, GLOW('#ffe030')); g.disc(hx + 4, hy - 4 * sc, 1.6, GLOW('#ffe030'));
  g.noise(31 + tier, 0.08);
  pc.blit(g, 2, 2); pc.outline(DARK); return pc;
}

export function paintScreamer(tier, p) {
  const pc = new PC(52, 60), g = new PC(48, 56);
  const bob = p.bob * 1.5 + Math.sin(p.ls * 2) * 1.5, cx = 24;
  const heads = tier >= 2 ? 3 : 1;
  for (let h = 0; h < heads; h++) {
    const ox = heads === 1 ? 0 : (h - 1) * 13, oy = heads === 1 ? 0 : (h === 1 ? -3 : 3);
    // tendrils
    for (let t = 0; t < 3 + tier; t++) { const bx = cx + ox - 6 + t * (12 / (2 + tier)); for (let s = 0; s < 14; s++) { const yy = 30 + oy + s * 1.8 + bob, xx = bx + Math.sin(s * 0.6 + t + p.ls * 3) * 2.2; g.disc(xx, yy, 1.6 - s * 0.07, FLESH[s % 3 + 1]); } }
    g.sell(cx + ox, 20 + oy + bob, 11, 13, FLESH); // flayed head
    for (let i = 0; i < 6; i++) g.line(cx + ox - 8 + i * 3, 10 + oy + bob, cx + ox - 9 + i * 3.4, 26 + oy + bob, FLESH[1]); // muscle striations
    const open = p.raise > 0.5 || p.lunge ? 1 : 0.55;
    g.ellipse(cx + ox, 26 + oy + bob, 6, 3 + open * 5, H('#12030a'));
    for (let i = 0; i < 5; i++) g.set(cx + ox - 4 + i * 2, 24 + oy + bob + (i % 2), H('#e8e0c8'));
    g.disc(cx + ox - 5, 16 + oy + bob, 3, H('#f0e8d8')); g.disc(cx + ox + 5, 16 + oy + bob, 3, H('#f0e8d8'));
    g.set(cx + ox - 5, 16 + oy + bob, DARK); g.set(cx + ox + 5, 16 + oy + bob, DARK);
    g.set(cx + ox - 5, 15 + oy + bob, GLOW('#ff5060')); g.set(cx + ox + 5, 15 + oy + bob, GLOW('#ff5060'));
    if (tier >= 1) for (let i = 0; i < 5; i++) g.tri(cx + ox - 8 + i * 4, 8 + oy + bob, cx + ox - 7 + i * 4, 1 + oy + bob, cx + ox - 5 + i * 4, 8 + oy + bob, FLESH[4]);
  }
  g.noise(41 + tier, 0.07);
  pc.blit(g, 2, 2); pc.outline(DARK); return pc;
}

export function paintBloat(tier, p) {
  const pc = new PC(60, 68), g = new PC(56, 64);
  const bob = p.bob, sq = p.squash;
  const sick = pal5('#2a3a12', '#46601c', '#6a8a2a', '#98b040', '#c4d068');
  const cx = 28 + p.lean * 0.4, r = 15 + tier * 2.5;
  for (const s of [-1, 1]) { const sw = s < 0 ? p.ls : -p.ls; g.limb(cx + s * 7, 50, cx + s * 9 + sw * 3, 62 - Math.max(0, sw) * 2, 5, sick.slice(1, 4)); g.rect(cx + s * 9 + sw * 3 - 3, 61 - Math.max(0, sw) * 2, 7, 3, DARK); }
  g.sell(cx, 36 + bob, r, r - 1 - sq, sick);
  for (let i = 0; i < 7 + tier * 3; i++) { const a = i * 2.4, rr = (i % 4) * (r / 5); const bx = cx + Math.cos(a) * rr, by = 36 + bob + Math.sin(a) * rr * 0.9; g.disc(bx, by, 1.6 + (i % 3) * 0.6, tier >= 1 && i % 3 === 0 ? GLOW('#ffd840') : sick[1]); if (tier >= 1 && i % 3 === 0) g.disc(bx, by, 0.8, GLOW('#fffbb0')); }
  for (let i = 0; i < 5; i++) g.line(cx - r + 4 + i * 6, 30 + bob, cx - r + 8 + i * 6, 44 + bob, H('#7a2a3a')); // veins
  g.sell(cx, 15 + bob, 6, 5.5, pal4('#5a6a2a', '#8a9a3a', '#b0c058', '#d8e488')); g.disc(cx - 2, 14 + bob, 1.4, DARK); g.disc(cx + 2, 14 + bob, 1.4, DARK); g.set(cx - 2, 14 + bob, GLOW('#fff060')); g.set(cx + 2, 14 + bob, GLOW('#fff060'));
  g.rect(cx - 3, 17 + bob, 7, 2, DARK);
  const ax = p.raise > 0.5 ? cx + r + 2 : p.lunge ? cx + r + 5 : cx + r + p.as * 2, ay = p.raise > 0.5 ? 20 : 38 - p.as * 2;
  g.limb(cx + r - 4, 32 + bob, ax, ay, 5, sick.slice(1, 4)); g.disc(ax, ay, 3, sick[3]);
  g.limb(cx - r + 4, 32 + bob, cx - r - 3 - p.as * 2, 44 + p.as * 2, 5, sick.slice(1, 4));
  if (tier >= 2) for (let i = 0; i < 3; i++) { g.limb(cx - r + 3, 40 + i * 5 + bob, cx - r - 8, 46 + i * 7 + Math.sin(p.ls * 3 + i) * 2, 3, sick.slice(1, 4)); }
  for (let i = 0; i < 3; i++) g.set(cx - 6 + i * 6, 52 + bob + (i % 2) * 2, H('#6a8a20')); // drips
  g.noise(51 + tier, 0.07);
  pc.blit(g, 2, 2); pc.outline(DARK); return pc;
}

export function paintMummy(tier, p) {
  const pc = new PC(44, 60), g = new PC(40, 56);
  const cx = 20 + p.lean * 0.4, bob = p.bob, hipY = 36 + bob;
  const rng = new RNG(77 + tier);
  // trailing bandages
  if (p.ls !== 0 || p.as !== 0) for (let i = 0; i < 3; i++) g.line(cx - 8 + i * 3, 40 + bob, cx - 10 + i * 3 - p.ls * 3, 52 + i, WRAP[1], 1);
  for (const s of [-1, 1]) { const sw = s < 0 ? p.ls : -p.ls; const fx = cx + s * 3.5 + sw * 3, fy = 54 - Math.max(0, sw) * 3; g.limb(cx + s * 2.5, hipY, fx, fy, 4.4, WRAP); g.rect(fx - 2, fy, 5, 2, DARK); }
  g.sell(cx, 26 + bob, 8, 11, WRAP);
  for (let i = 0; i < 9; i++) { const y = 17 + bob + i * 2.4; g.line(cx - 8, y + (i % 2), cx + 8, y - 1 + ((i + 1) % 2) * 2, WRAP[0], 1); if (i % 3 === 0) g.line(cx - 7, y + 1, cx + 7, y, WRAP[3], 1); }
  if (tier >= 1) { g.sell(cx, 24 + bob, 7.2, 8, GOLD); g.line(cx - 6, 20 + bob, cx + 6, 20 + bob, GOLD[0]); g.line(cx, 16 + bob, cx, 32 + bob, GOLD[0]); g.rect(cx - 7, 31 + bob, 14, 2, GOLD[0]); }
  // head
  g.sell(cx, 10 + bob, 6.5, 7, WRAP);
  for (let i = 0; i < 5; i++) g.line(cx - 6, 6 + bob + i * 2, cx + 6, 5 + bob + i * 2 + 1, WRAP[0], 1);
  g.rect(cx - 5, 9 + bob, 11, 3, DARK); g.set(cx - 3, 10 + bob, GLOW('#ffc030')); g.set(cx + 3, 10 + bob, GLOW('#ffc030')); g.set(cx - 2, 10 + bob, GLOW('#ffe080')); g.set(cx + 4, 10 + bob, GLOW('#ffe080'));
  if (tier >= 1) { g.sell(cx, 6 + bob, 7, 4.5, GOLD); g.rect(cx - 6, 6 + bob, 13, 1, GOLD[0]); g.tri(cx - 1, 0 + bob, cx + 2, 0 + bob, cx + 0.5, 6 + bob, GOLD[3]); }
  if (tier >= 2) { // pharaoh mask + nemes
    g.sell(cx, 10 + bob, 6, 7.4, GOLD); g.quad([[cx - 7, 8 + bob], [cx - 12, 24 + bob], [cx - 7, 24 + bob], [cx - 5, 12 + bob]], pal4('#0a2a5a', '#1a4a9a', '#2a6ad0', '#5a9aff')[1]); g.quad([[cx + 7, 8 + bob], [cx + 12, 24 + bob], [cx + 7, 24 + bob], [cx + 5, 12 + bob]], pal4('#0a2a5a', '#1a4a9a', '#2a6ad0', '#5a9aff')[1]);
    g.rect(cx - 4, 9 + bob, 9, 2, DARK); g.set(cx - 2, 10 + bob, GLOW('#40ffe0')); g.set(cx + 2, 10 + bob, GLOW('#40ffe0'));
    g.line(cx, 14 + bob, cx, 22 + bob, pal4('#0a2a5a', '#1a4a9a', '#2a6ad0', '#5a9aff')[2], 2);
  }
  // arms: outstretched
  const sy = 18 + bob;
  const lax = cx - 10 - p.as * 1.5, lay = 32 + p.as * 2;
  g.limb(cx - 7, sy, lax, lay, 4, WRAP); g.disc(lax, lay, 2.2, WRAP[2]);
  const rax = p.raise > 0.5 ? cx + 10 : p.lunge ? cx + 12 : cx + 10 + p.as * 1.5, ray = p.raise > 0.5 ? 8 + bob : p.lunge ? 26 : 33 - p.as * 2;
  g.limb(cx + 7, sy, rax, ray, 4, WRAP); g.disc(rax, ray, 2.2, WRAP[2]);
  if (tier >= 1) { // khopesh / staff
    const ang = p.raise > 0.5 ? -1.9 : p.lunge ? -0.5 : -1.3;
    if (tier === 1) { g.line(rax, ray, rax + Math.cos(ang) * 14, ray + Math.sin(ang) * 14, GOLD[2], 2.4); g.line(rax + Math.cos(ang) * 14, ray + Math.sin(ang) * 14, rax + Math.cos(ang + 1.1) * 18, ray + Math.sin(ang + 1.1) * 18, GOLD[3], 2); }
    else { g.line(rax, ray + 8, rax, ray - 18, GOLD[1], 2); g.ring && 0; g.disc(rax, ray - 20, 3, GLOW('#40ffe0')); g.line(rax - 3, ray - 16, rax + 3, ray - 16, GOLD[3], 1.5); }
  }
  g.noise(61 + tier, 0.06);
  pc.blit(g, 2, 4); pc.outline(DARK); return pc;
}

export function paintScarab(tier, p) {
  const pc = new PC(60, 40), rng = new RNG(88 + tier);
  const shell = [pal4('#0a3a3a', '#146a6a', '#22a8a0', '#60e0d0'), pal4('#1a2a6a', '#2a48b0', '#4a80e0', '#90c0ff'), pal4('#5a1a6a', '#9a2ab0', '#d05ae0', '#ff9aff')][tier];
  const n = 8 + tier * 4;
  const t = p.ls * 2 + p.bob;
  const list = [];
  for (let i = 0; i < n; i++) list.push({ x: 8 + rng.float(0, 42), y: 14 + rng.float(0, 20), s: 0.9 + rng.float(0, 0.5) + tier * 0.2 });
  list.sort((a, b) => a.y - b.y);
  for (const b of list) {
    const jx = Math.sin(t + b.x) * 1.5, jy = Math.cos(t * 1.3 + b.y) * 1;
    const x = b.x + jx + p.lunge * 3, y = b.y + jy - (p.raise > 0.5 ? 2 : 0);
    for (const d of [-1, 1]) { pc.line(x - 3 * b.s, y + d, x - 5 * b.s, y + d * 2.4 + Math.sin(t * 3 + b.x) * 0.8, DARK); pc.line(x + 3 * b.s, y + d, x + 5 * b.s, y + d * 2.4, DARK); }
    pc.sell(x, y, 3.6 * b.s, 2.8 * b.s, shell);
    pc.line(x, y - 2.6 * b.s, x, y + 2.6 * b.s, shell[0]);
    pc.set(x - 1.5, y - 3 * b.s, GLOW(tier >= 1 ? '#ff4040' : '#ffe040')); pc.set(x + 1.5, y - 3 * b.s, GLOW(tier >= 1 ? '#ff4040' : '#ffe040'));
  }
  pc.outline(DARK); return pc;
}

export function paintPriest(tier, p) {
  const pc = new PC(48, 64), g = new PC(44, 60);
  const cx = 22 + p.lean * 0.4, bob = p.bob;
  const robe = tier === 0 ? PURPLE : tier === 1 ? pal4('#3a0c10', '#6a1a20', '#9a2a30', '#c84a48') : pal4('#0c2a1a', '#1a5a34', '#2a9a58', '#60e090');
  g.quad([[cx - 6, 14 + bob], [cx + 6, 14 + bob], [cx + 12 + p.ls, 56], [cx - 12 + p.ls, 56]], robe[1]);
  g.quad([[cx - 6, 14 + bob], [cx, 14 + bob], [cx + 1 + p.ls, 56], [cx - 12 + p.ls, 56]], robe[0]);
  for (let i = 0; i < 5; i++) g.line(cx - 10 + i * 4 + p.ls, 56, cx - 4 + i * 2, 24 + bob, robe[2], 1);
  if (tier >= 1) { g.rect(cx - 6, 30 + bob, 12, 2, GOLD[2]); g.line(cx, 16 + bob, cx, 55, GOLD[2], 1.5); for (let i = 0; i < 6; i++) g.set(cx - 11 + i * 4 + p.ls, 54, GOLD[3]); }
  if (tier >= 2) for (let i = 0; i < 6; i++) g.tri(cx - 12 + i * 4.5 + p.ls, 56, cx - 10 + i * 4.5 + p.ls, 56, cx - 11 + i * 4.5 + p.ls, 60 - (i % 3), robe[3]);
  // head
  if (tier === 2) { skull(g, cx, 10 + bob, 5.2, { eye: GLOW('#60ffa0'), pal: pal4('#4a5a4a', '#8aa08a', '#c0d8c0', '#eefaee'), big: true }); g.line(cx - 6, 5 + bob, cx + 6, 5 + bob, GOLD[3], 2); for (let i = 0; i < 4; i++) g.tri(cx - 6 + i * 4, 5 + bob, cx - 4 + i * 4, 0 + bob, cx - 2 + i * 4, 5 + bob, GOLD[3]); }
  else {
    g.sell(cx, 10 + bob, 8, 8, robe); g.disc(cx, 12 + bob, 5, DARK);
    g.set(cx - 2, 12 + bob, GLOW(tier ? '#ffe040' : '#ff40ff')); g.set(cx + 2, 12 + bob, GLOW(tier ? '#ffe040' : '#ff40ff')); g.set(cx - 3, 12 + bob, GLOW(tier ? '#ffe040' : '#ff40ff')); g.set(cx + 3, 12 + bob, GLOW(tier ? '#ffe040' : '#ff40ff'));
    if (tier === 1) { g.tri(cx - 6, 5 + bob, cx - 8, -1 + bob, cx - 3, 4 + bob, GOLD[2]); g.tri(cx + 6, 5 + bob, cx + 8, -1 + bob, cx + 3, 4 + bob, GOLD[2]); g.rect(cx - 4, 16 + bob, 9, 2, GOLD[2]); }
  }
  // arms + staff
  const sy = 20 + bob;
  const lax = cx - 9 - p.as * 1.5, lay = 32 + p.as * 2; g.limb(cx - 6, sy, lax, lay, 3.6, robe); g.disc(lax, lay, 2, tier === 2 ? BONE[2] : WRAP[2]);
  const rax = p.raise > 0.5 ? cx + 10 : p.lunge ? cx + 12 : cx + 9, ray = p.raise > 0.5 ? 10 + bob : p.lunge ? 22 : 30 - p.as;
  g.limb(cx + 6, sy, rax, ray, 3.6, robe); g.disc(rax, ray, 2, tier === 2 ? BONE[2] : WRAP[2]);
  g.line(rax, ray + 12, rax, ray - 20, H('#4a3220'), 2);
  const orb = tier === 0 ? '#ff40ff' : tier === 1 ? '#ffd040' : '#60ffa0';
  g.disc(rax, ray - 22, 3.2, GLOW(orb)); g.disc(rax, ray - 22, 1.6, GLOW('#ffffff'));
  if (tier >= 1) g.ring && 0;
  if (tier === 2) for (let i = 0; i < 3; i++) { const a = i * 2.1 + p.ls * 2 + 1, ox = cx + Math.cos(a) * 14, oy = 24 + Math.sin(a) * 6 + bob; g.disc(ox, oy, 2, GLOW('#60ffa0')); }
  g.noise(71 + tier, 0.06);
  pc.blit(g, 2, 2); pc.outline(DARK); return pc;
}

export function paintSlime(tier, p) {
  const pc = new PC(44, 34), g = new PC(40, 30);
  const sq = 1 + p.squash * 0.18 - (p.raise > 0.5 ? 0.15 : 0), cx = 20;
  const pal = pal5('#0c3a1a', '#1a6a2c', '#2ea04a', '#66d878', '#b8ffc0');
  g.sell(cx, 20, 17 * sq, 11 / sq + (p.raise > 0.5 ? 2 : 0), pal, -0.5, -0.8);
  g.ellipse(cx, 28, 15, 3, pal[0]);
  g.ellipse(cx - 8, 15, 3, 2, pal[4]); g.disc(cx - 10, 13, 1, H('#ffffff'));
  g.disc(cx - 5, 19, 3, H('#eaffea')); g.disc(cx + 6, 19, 3, H('#eaffea')); g.set(cx - 5, 19, DARK); g.set(cx + 6, 19, DARK);
  g.rect(cx - 3, 24, 8, 2, pal[0]);
  for (let i = 0; i < 4; i++) g.disc(6 + i * 9, 24 + (i % 2) * 2, 1.3, pal[2]);
  g.noise(5, 0.05);
  pc.blit(g, 2, 2); pc.outline(H('#06200e')); return pc;
}

export function paintSentinel(p) {
  const pc = new PC(72, 104), g = new PC(68, 100);
  const cx = 34 + p.lean * 0.4, bob = p.bob;
  for (const s of [-1, 1]) { const sw = s < 0 ? p.ls : -p.ls; g.limb(cx + s * 8, 62 + bob, cx + s * 9 + sw * 5, 96 - Math.max(0, sw) * 4, 10, STONE.slice(0, 4)); g.rect(cx + s * 9 + sw * 5 - 6, 94 - Math.max(0, sw) * 4, 13, 5, STONE[0]); }
  g.sell(cx, 46 + bob, 19, 22, STONE);
  g.rect(cx - 12, 38 + bob, 24, 3, STONE[0]); g.line(cx, 26 + bob, cx, 66 + bob, STONE[0], 2);
  for (const y of [34, 44, 54]) g.line(cx - 14, y + bob, cx - 6, y + 3 + bob, GLOW('#ff7a20'), 1);
  g.line(cx + 6, 40 + bob, cx + 15, 47 + bob, GLOW('#ff7a20'), 1);
  for (const s of [-1, 1]) { g.sell(cx + s * 22, 28 + bob, 10, 9, STONE); g.tri(cx + s * 27, 24 + bob, cx + s * 33, 14 + bob, cx + s * 21, 27 + bob, STONE[4]); }
  g.sell(cx, 15 + bob, 11, 11, STONE); g.rect(cx - 9, 13 + bob, 19, 4, DARK); g.rect(cx - 8, 14 + bob, 6, 2, GLOW('#ff8a30')); g.rect(cx + 3, 14 + bob, 6, 2, GLOW('#ff8a30'));
  g.tri(cx - 3, 3 + bob, cx + 4, 3 + bob, cx, -4 + bob, STONE[3]);
  const raise = p.raise > 0.5, lunge = p.lunge;
  g.limb(cx - 22, 34 + bob, cx - 28 - p.as * 2, 60 + p.as * 2, 9, STONE.slice(0, 4)); g.sell(cx - 28 - p.as * 2, 62, 6, 6, STONE);
  const rx = raise ? cx + 28 : lunge ? cx + 26 : cx + 28 + p.as * 2, ry = raise ? 8 : lunge ? 62 : 62 - p.as * 2;
  g.limb(cx + 22, 34 + bob, rx, ry, 9, STONE.slice(0, 4)); g.sell(rx, ry, 6, 6, STONE);
  const ang = raise ? -2.0 : lunge ? -0.1 : -1.5;
  g.line(rx, ry, rx + Math.cos(ang) * 30, ry + Math.sin(ang) * 30, STONE[2], 8); g.line(rx, ry, rx + Math.cos(ang) * 30, ry + Math.sin(ang) * 30, STONE[3], 3);
  g.noise(101, 0.09);
  pc.blit(g, 2, 2); pc.outline(DARK); return pc;
}

export function paintGargoyle(p) {
  const pc = new PC(84, 96), g = new PC(80, 92);
  const cx = 40, bob = p.bob;
  const wing = p.raise > 0.5 ? -14 : p.lunge ? 6 : Math.sin(p.ls * 2) * 3;
  for (const s of [-1, 1]) {
    g.tri(cx + s * 10, 34 + bob, cx + s * 38, 8 + wing, cx + s * 30, 40 + bob, STONE[2]);
    g.tri(cx + s * 10, 34 + bob, cx + s * 38, 8 + wing, cx + s * 20, 20 + bob, STONE[3]);
    for (let i = 0; i < 3; i++) g.line(cx + s * 12, 36 + bob, cx + s * (34 - i * 2), 12 + i * 10 + wing * (1 - i * 0.3), STONE[0], 1);
  }
  for (const s of [-1, 1]) { const sw = s < 0 ? p.ls : -p.ls; g.limb(cx + s * 11, 66 + bob, cx + s * 14 + sw * 4, 88 - Math.max(0, sw) * 3, 9, STONE.slice(0, 4)); for (let k = -1; k <= 1; k++) g.tri(cx + s * 14 + sw * 4 + k * 3 - 1, 87, cx + s * 14 + sw * 4 + k * 3 + 1, 87, cx + s * 14 + sw * 4 + k * 3, 91, STONE[4]); }
  g.sell(cx, 50 + bob, 17, 21, STONE);
  for (let i = 0; i < 5; i++) g.line(cx - 10, 38 + i * 6 + bob, cx + 10, 40 + i * 6 + bob, STONE[0], 1);
  g.sell(cx, 22 + bob, 11, 10, STONE); g.tri(cx - 9, 16 + bob, cx - 15, 2 + bob, cx - 4, 14 + bob, STONE[4]); g.tri(cx + 9, 16 + bob, cx + 15, 2 + bob, cx + 4, 14 + bob, STONE[4]);
  g.rect(cx - 8, 20 + bob, 6, 3, GLOW('#ff5030')); g.rect(cx + 3, 20 + bob, 6, 3, GLOW('#ff5030'));
  const open = p.raise > 0.5 || p.lunge; g.ellipse(cx, 29 + bob, 5, 2 + (open ? 3 : 0), DARK); for (let i = 0; i < 4; i++) g.set(cx - 4 + i * 2.5, 27 + bob, H('#e8e0c8'));
  const rx = p.raise > 0.5 ? cx + 24 : p.lunge ? cx + 28 : cx + 22, ry = p.raise > 0.5 ? 20 : p.lunge ? 56 : 58 - p.as * 2;
  g.limb(cx + 15, 40 + bob, rx, ry, 8, STONE.slice(0, 4)); for (let k = -1; k <= 1; k++) g.tri(rx + k * 3 - 1, ry + 2, rx + k * 3 + 1, ry + 2, rx + k * 3 + 1, ry + 9, STONE[4]);
  g.limb(cx - 15, 40 + bob, cx - 22 - p.as * 2, 58 + p.as * 2, 8, STONE.slice(0, 4));
  g.noise(111, 0.09);
  pc.blit(g, 2, 2); pc.outline(DARK); return pc;
}

export function paintGolem(p) {
  const pc = new PC(76, 108), g = new PC(72, 104);
  const cx = 36 + p.lean * 0.4, bob = p.bob;
  const rock = pal5('#1e2226', '#323a40', '#4a545c', '#66727c', '#8a98a4');
  for (const s of [-1, 1]) { const sw = s < 0 ? p.ls : -p.ls; g.limb(cx + s * 9, 64 + bob, cx + s * 10 + sw * 5, 100 - Math.max(0, sw) * 4, 12, rock.slice(0, 4)); g.rect(cx + s * 10 + sw * 5 - 7, 98 - Math.max(0, sw) * 4, 15, 5, rock[0]); }
  g.sell(cx, 46 + bob, 22, 24, rock);
  g.ellipse(cx, 46 + bob, 10, 13, H('#04151c'));
  const pulse = 0.7 + 0.3 * Math.sin(p.ls * 3 + 1 + p.bob);
  g.disc(cx, 46 + bob, 8, GLOW('#1a8aa8')); g.disc(cx, 46 + bob, 5.5, GLOW('#40d0f0')); g.disc(cx, 46 + bob, 2.5, GLOW('#d8ffff'));
  for (let i = 0; i < 8; i++) { const a = i * 0.785; g.line(cx + Math.cos(a) * 9, 46 + bob + Math.sin(a) * 12, cx + Math.cos(a) * 14, 46 + bob + Math.sin(a) * 17, GLOW('#1a8aa8'), 1); }
  for (const s of [-1, 1]) g.sell(cx + s * 25, 26 + bob, 11, 10, rock);
  g.sell(cx, 14 + bob, 10, 9, rock); g.rect(cx - 7, 12 + bob, 5, 3, GLOW('#40d0f0')); g.rect(cx + 3, 12 + bob, 5, 3, GLOW('#40d0f0'));
  const raise = p.raise > 0.5, lunge = p.lunge;
  g.limb(cx - 25, 32 + bob, cx - 30 - p.as * 2, 66 + p.as * 2, 11, rock.slice(0, 4)); g.sell(cx - 30 - p.as * 2, 70, 8, 8, rock);
  const rx = raise ? cx + 30 : lunge ? cx + 32 : cx + 30 + p.as * 2, ry = raise ? 16 : lunge ? 66 : 70 - p.as * 2;
  g.limb(cx + 25, 32 + bob, rx, ry, 11, rock.slice(0, 4)); g.sell(rx, ry, 8, 8, rock);
  for (let i = 0; i < 6; i++) g.line(cx - 16 + i * 6, 30 + bob, cx - 14 + i * 6, 62 + bob, rock[0], 1);
  g.noise(121, 0.09);
  pc.blit(g, 2, 2); pc.outline(DARK); return pc;
}

export function paintHero(colorHex, p, weapon = true) {
  const pc = new PC(44, 60), g = new PC(40, 56);
  const col = pal4(shade(colorHex, 0.4), shade(colorHex, 0.7), colorHex, shade(colorHex, 1.3));
  const skin = pal4('#6a4a30', '#a87c58', '#d0a880', '#eccfa8');
  const cx = 20 + p.lean * 0.4, bob = p.bob, hipY = 36 + bob;
  for (const s of [-1, 1]) { const sw = s < 0 ? p.ls : -p.ls; const fx = cx + s * 3.5 + sw * 3.5, fy = 54 - Math.max(0, sw) * 3; g.limb(cx + s * 2.5, hipY, fx, fy, 4, pal4('#1a1410', '#3a2c20', '#5a4634', '#7a6248')); g.rect(fx - 2, fy - 1, 6, 3, DARK); }
  g.sell(cx, 26 + bob, 8, 10.5, col);
  g.rect(cx - 8, 33 + bob, 16, 3, pal4('#1a1410', '#3a2c20', '#5a4634', '#7a6248')[1]); g.rect(cx - 1, 33 + bob, 3, 3, GOLD[2]);
  g.sell(cx, 11 + bob, 5.6, 6, skin); g.sell(cx, 8 + bob, 7, 5, IRON); g.rect(cx - 1, 8 + bob, 3, 8, IRON[1]); // helm with nasal
  g.set(cx - 3, 12 + bob, DARK); g.set(cx + 3, 12 + bob, DARK);
  const sy = 18 + bob;
  const lax = cx - 10 - p.as * 1.5, lay = 32 + p.as * 2; g.limb(cx - 7, sy, lax, lay, 4, col); g.disc(lax, lay, 2, skin[2]);
  const rax = p.raise > 0.5 ? cx + 10 : p.lunge ? cx + 12 : cx + 10 + p.as * 1.5, ray = p.raise > 0.5 ? 9 + bob : p.lunge ? 28 : 33 - p.as * 2;
  g.limb(cx + 7, sy, rax, ray, 4, col); g.disc(rax, ray, 2, skin[2]);
  if (weapon) sword(g, rax, ray, p.raise > 0.5 ? -1.9 : p.lunge ? -0.5 : -1.35, 15, IRON, null);
  g.noise(131, 0.05);
  pc.blit(g, 2, 4); pc.outline(DARK); return pc;
}
function shade(hexs, f) { const n = parseInt(hexs.slice(1), 16); const r = Math.min(255, ((n >> 16) & 255) * f | 0), gg = Math.min(255, ((n >> 8) & 255) * f | 0), b = Math.min(255, (n & 255) * f | 0); return '#' + ((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1); }

export function paintWisp(p) {
  const pc = new PC(36, 48);
  const cx = 18, bob = p.bob;
  for (let s = 0; s < 22; s++) { const t = s / 22, xx = cx + Math.sin(s * 0.5 + p.ls * 3) * (2 + t * 3), yy = 24 + s * 1.05 + bob; pc.disc(xx, yy, 8 * (1 - t) + 1, mixc('#bfe6ff', '#4a6a9a', t)); }
  pc.sell(cx, 18 + bob, 9, 10, pal4('#6a8ab0', '#a8c8ea', '#d8f0ff', '#ffffff'));
  pc.disc(cx - 3, 17 + bob, 2, H('#0a1428')); pc.disc(cx + 3, 17 + bob, 2, H('#0a1428')); pc.ellipse(cx, 23 + bob, 2.5, 3, H('#0a1428'));
  pc.set(cx - 3, 17 + bob, GLOW('#9ad0ff')); pc.set(cx + 3, 17 + bob, GLOW('#9ad0ff'));
  return pc;
}
function mixc(a, b, t) { const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16); const f = (s) => ((A >> s) & 255) + ((((B >> s) & 255) - ((A >> s) & 255)) * t); return H('#' + ((1 << 24) | (f(16) << 16) | (f(8) << 8) | f(0) | 0).toString(16).slice(1)); }

// ---------- generic death frames from a live sprite ----------
export function deathFrames(base) {
  const f0 = new PC(base.w, base.h); // stagger: shear + darken
  for (let y = 0; y < base.h; y++) { const sh = Math.round(((y / base.h) - 0.5) * -5 + 2); for (let x = 0; x < base.w; x++) { const c = base.d[y * base.w + x]; if (c >>> 24) f0.set(x + sh, y + 3, c); } }
  const rot = rot90(base); const low = scaled(rot, Math.round(base.h * 0.95), Math.max(6, Math.round(base.w * 0.55)));
  const f1 = new PC(base.w + 14, Math.max(14, low.h + 8));
  f1.ellipse(f1.w / 2, f1.h - 5, f1.w / 2 - 1, 4, H('#5a0a10')); f1.ellipse(f1.w / 2, f1.h - 5, f1.w / 2 - 6, 3, H('#7a1018'));
  f1.blit(low, Math.floor((f1.w - low.w) / 2), f1.h - low.h - 3);
  f1.outline(DARK);
  const f2 = f1.clone(); const rng = new RNG(7);
  for (let i = 0; i < 12; i++) f2.disc(rng.int(2, f2.w - 3), f2.h - 4 + rng.int(-2, 1), 1 + rng.int(0, 1), H(['#7a1018', '#a01820', '#4a0a0e', '#d8ccb0'][i % 4]));
  return [f0.outline(DARK), f1, f2];
}
