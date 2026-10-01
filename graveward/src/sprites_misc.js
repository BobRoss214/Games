// Props, pickups, projectiles, boss art and first-person weapon sprites (all procedural).
import { PC, H, GLOW, pal3, pal4, pal5, scaled } from './pixart.js';
import { RNG, hex } from './util.js';

const DARK = H('#140e0b');
const STONE = pal5('#26262a', '#3a3a40', '#54545c', '#74747c', '#96969e');
const BONE = pal4('#5a4e3e', '#9a8c72', '#cfc3a6', '#eee6cc');
const WOOD = pal4('#2a1a0e', '#4a3018', '#6e4a28', '#8e6438');
const IRON = pal4('#22242a', '#44474f', '#767a84', '#a8aeba');
const GOLD = pal4('#6a4a12', '#a87c24', '#d8ac3c', '#f8dc72');
const CLAY = pal4('#3a1c10', '#6a3420', '#94502e', '#bc7040');

export function flame(pc, cx, base, h, w, t) {
  const cols = ['#ff3a10', '#ff8a20', '#ffd040', '#fff8c0'];
  for (let i = 0; i < 4; i++) {
    const hh = h * (1 - i * 0.2), ww = w * (1 - i * 0.24);
    const sway = Math.sin(t * 2.2 + i) * (1.2 - i * 0.2);
    for (let y = 0; y < hh; y++) { const k = y / hh; const half = ww * Math.sin(Math.min(1, k * 1.15) * Math.PI * 0.72) * (1 - k * 0.6); for (let x = -half; x <= half; x++) pc.set(cx + x + sway * k, base - y - i, GLOW(cols[i])); }
  }
}
export function paintTorch(t) {
  const pc = new PC(20, 34);
  pc.rect(9, 17, 3, 14, WOOD[1]); pc.rect(9, 17, 1, 14, WOOD[2]);
  pc.rect(5, 24, 11, 2, IRON[2]); pc.rect(6, 22, 2, 3, IRON[1]); pc.rect(13, 22, 2, 3, IRON[1]);
  pc.sell(10, 18, 4, 2.4, IRON);
  flame(pc, 10, 17, 13, 4.5, t);
  pc.outline(DARK); return pc;
}
export function paintBrazier(t) {
  const pc = new PC(32, 44);
  pc.quad([[6, 22], [26, 22], [22, 32], [10, 32]], IRON[1]); pc.rect(4, 20, 24, 3, IRON[2]); pc.rect(15, 32, 3, 9, IRON[1]); pc.rect(9, 40, 14, 3, IRON[1]);
  flame(pc, 16, 21, 16, 7, t); pc.outline(DARK); return pc;
}
export function paintSign() {
  const pc = new PC(40, 30);
  pc.line(6, 0, 6, 6, IRON[1]); pc.line(34, 0, 34, 6, IRON[1]); pc.rect(0, 6, 40, 3, IRON[2]);
  pc.srect(3, 9, 34, 19, WOOD.slice(1)); pc.rect(3, 9, 34, 1, WOOD[3]);
  pc.rect(13, 21, 14, 3, IRON[1]); pc.rect(11, 18, 18, 3, IRON[2]); pc.rect(15, 15, 10, 3, IRON[2]); pc.rect(9, 19, 3, 2, IRON[3]);
  pc.line(29, 12, 22, 20, WOOD[3], 2); pc.rect(26, 11, 7, 4, IRON[3]);
  pc.outline(DARK); return pc;
}
export function paintPot(kind) {
  const pc = new PC(24, 28);
  const pal = kind === 'jar' ? pal4('#3a4a5a', '#5a748a', '#88a8c0', '#c0e0f0') : CLAY;
  pc.sell(12, 16, 8, 10, pal); pc.rect(7, 4, 10, 4, pal[1]); pc.rect(6, 3, 12, 2, pal[2]);
  if (kind === 'jar') { pc.rect(8, 1, 8, 3, GOLD[1]); pc.line(6, 14, 18, 14, GOLD[2]); pc.disc(12, 17, 2, GLOW('#a0ffd0')); }
  else { pc.line(6, 15, 18, 15, pal[0]); pc.line(7, 19, 17, 19, pal[3]); }
  pc.noise(3, 0.1); pc.outline(DARK); return pc;
}
export function paintCrate() {
  const pc = new PC(34, 32);
  pc.srect(1, 2, 32, 29, WOOD.slice(1)); pc.rect(1, 2, 32, 3, WOOD[3]);
  pc.rect(1, 14, 32, 3, WOOD[0]); pc.rect(15, 2, 4, 29, WOOD[0]);
  for (const [x, y] of [[4, 5], [28, 5], [4, 26], [28, 26]]) pc.set(x, y, IRON[3]);
  pc.line(1, 2, 32, 30, WOOD[0]); pc.noise(4, 0.1); pc.outline(DARK); return pc;
}
export function paintUrn() {
  const pc = new PC(28, 40);
  const pal = pal4('#4a3a10', '#7a6020', '#b09030', '#e0c060');
  pc.sell(14, 24, 10, 13, pal); pc.rect(8, 6, 12, 8, pal[1]); pc.rect(6, 4, 16, 3, pal[2]);
  pc.line(6, 22, 22, 22, pal[0]); for (let i = 0; i < 5; i++) pc.set(8 + i * 3, 27 + (i % 2), pal[3]);
  pc.ring && 0; pc.limb(4, 16, 3, 26, 2, pal.slice(0, 3)); pc.limb(24, 16, 25, 26, 2, pal.slice(0, 3));
  pc.noise(5, 0.1); pc.outline(DARK); return pc;
}
export function paintBones(kind) {
  const pc = new PC(36, 22), rng = new RNG(kind === 'skull' ? 9 : 4);
  const n = kind === 'skull' ? 6 : 4;
  for (let i = 0; i < 5; i++) { const x = rng.int(3, 24), y = rng.int(12, 19); pc.line(x, y, x + rng.int(6, 10), y + rng.int(-2, 2), BONE[2], 2); pc.disc(x, y, 1.4, BONE[3]); }
  for (let i = 0; i < n; i++) { const x = 8 + i * 5 + rng.int(-2, 2), y = 8 + rng.int(0, 5) - (kind === 'skull' ? (i % 2) * 4 : 0); pc.sell(x, y, 4.2, 4.4, BONE); pc.set(x - 1.5, y, DARK); pc.set(x + 1.5, y, DARK); pc.rect(x - 2, y + 2.5, 5, 2, BONE[1]); }
  pc.outline(DARK); return pc;
}
export function paintCoffin(open) {
  const pc = new PC(48, 32);
  pc.quad([[6, 28], [42, 28], [46, 8], [2, 8]], WOOD[1]); pc.quad([[6, 28], [24, 28], [24, 8], [2, 8]], WOOD[0]); pc.rect(2, 8, 44, 2, WOOD[3]);
  if (open) { pc.quad([[8, 26], [40, 26], [43, 11], [5, 11]], DARK); pc.disc(24, 16, 3, BONE[2]); pc.set(23, 16, GLOW('#ff4040')); pc.set(25, 16, GLOW('#ff4040')); pc.line(4, 8, 12, 2, WOOD[2], 3); }
  else { pc.line(24, 10, 24, 26, WOOD[3]); pc.line(14, 16, 34, 16, WOOD[3]); pc.disc(24, 16, 2, GOLD[2]); }
  pc.noise(6, 0.08); pc.outline(DARK); return pc;
}
export function paintSarcophagus() {
  const pc = new PC(60, 40);
  pc.quad([[6, 36], [54, 36], [58, 12], [2, 12]], pal4('#5a5a4a', '#8a8870', '#b8b498', '#dcd8be')[1]);
  pc.quad([[6, 36], [30, 36], [30, 12], [2, 12]], pal4('#5a5a4a', '#8a8870', '#b8b498', '#dcd8be')[0]);
  pc.sell(30, 14, 26, 7, pal4('#8a7440', '#b09850', '#d8bc68', '#f8e498'));
  pc.disc(30, 15, 6, pal4('#0a2a5a', '#1a4a9a', '#2a6ad0', '#5a9aff')[2]); pc.sell(30, 12, 5, 5.5, GOLD);
  pc.rect(24, 22, 12, 2, GOLD[2]); pc.rect(22, 27, 16, 2, GOLD[1]);
  pc.noise(7, 0.08); pc.outline(DARK); return pc;
}
export function paintPillar() {
  const pc = new PC(36, 64);
  pc.srect(6, 6, 24, 52, pal3('#3a362e', '#5c564a', '#8a8270'));
  for (let i = 0; i < 4; i++) pc.rect(9 + i * 6, 8, 1, 48, STONE[0]);
  pc.rect(2, 0, 32, 7, STONE[3]); pc.rect(2, 6, 32, 2, STONE[1]); pc.rect(3, 56, 30, 8, STONE[3]); pc.rect(3, 56, 30, 2, STONE[4]);
  pc.noise(8, 0.08); pc.outline(DARK); return pc;
}
export function paintChains() {
  const pc = new PC(24, 56);
  for (const x of [8, 16]) { for (let y = 0; y < 50; y += 4) { pc.ellipse(x, y + 2, 2.2, 2.6, IRON[2]); pc.ellipse(x, y + 2, 1, 1.4, DARK); } }
  pc.sell(12, 52, 4, 3, IRON); pc.outline(DARK); return pc;
}
export function paintFountain(t, tint) {
  const pc = new PC(52, 60);
  const stone = tint ? pal4('#1a2a3a', '#2a4a66', '#4a7aa0', '#90c0e0') : STONE.slice(1);
  pc.sell(26, 50, 22, 8, stone); pc.rect(22, 26, 8, 24, stone[1]); pc.sell(26, 26, 14, 5, stone);
  const wc = tint ? ['#40d0ff', '#a0f0ff', '#e0ffff'] : ['#8a0c14', '#c01820', '#ff5060'];
  for (let i = 0; i < 3; i++) for (let s = 0; s < 16; s++) { const x = 26 + Math.sin(t * 3 + i * 2.1 + s * 0.3) * (2 + s * 0.5) + (i - 1) * s * 0.5, y = 24 - s * 1.2 + s * s * 0.03; pc.set(x, y, GLOW(wc[i])); pc.set(x + 1, y, GLOW(wc[i])); }
  pc.ellipse(26, 30, 12, 2.4, GLOW(wc[0])); pc.noise(9, 0.06); pc.outline(DARK); return pc;
}
export function paintChandelier() {
  const pc = new PC(72, 44);
  pc.line(36, 0, 36, 10, IRON[2], 2); pc.ellipse(36, 22, 26, 5, GOLD[1]); pc.ellipse(36, 20, 24, 3, GOLD[2]);
  for (let i = 0; i < 6; i++) { const x = 12 + i * 9.6; pc.rect(x, 14, 2, 6, H('#e8e0c8')); flame(pc, x + 1, 14, 5, 1.6, i); }
  pc.line(14, 24, 20, 38, GOLD[2]); pc.line(58, 24, 52, 38, GOLD[2]); pc.line(36, 26, 36, 40, GOLD[2]); pc.outline(DARK); return pc;
}
export function paintChest(open, tier = 0) {
  const pc = new PC(44, 34);
  const wood = tier ? pal4('#4a3010', '#7a5a20', '#a88030', '#d8b050') : WOOD, band = tier ? GOLD : IRON;
  pc.srect(3, 14, 38, 18, wood.slice(1)); pc.rect(3, 14, 38, 2, wood[3]);
  if (open) {
    pc.quad([[5, 14], [39, 14], [36, 3], [8, 3]], wood[0]); pc.rect(8, 3, 28, 2, wood[2]);
    pc.rect(5, 14, 34, 3, DARK); for (let i = 0; i < 8; i++) pc.set(8 + i * 4, 13 - (i % 2), GLOW('#ffd860')); pc.disc(22, 12, 4, GLOW('#ffe890'));
  } else { pc.quad([[3, 15], [41, 15], [38, 5], [6, 5]], wood[2]); pc.rect(6, 5, 32, 2, wood[3]); pc.rect(6, 10, 32, 1, wood[0]); }
  for (const x of [8, 34]) pc.rect(x, 5, 3, 27, band[2]);
  pc.rect(19, 13, 6, 6, band[3]); pc.set(22, 15, DARK);
  pc.noise(10, 0.07); pc.outline(DARK); return pc;
}
export function paintCrystal(t) {
  const pc = new PC(32, 52);
  const pal = pal5('#3a0008', '#7a0a14', '#c01828', '#ff4050', '#ffa0a8');
  pc.tri(16, 0, 26, 40, 6, 40, pal[2]); pc.tri(16, 0, 26, 40, 16, 42, pal[1]); pc.tri(16, 2, 6, 40, 15, 30, pal[3]); pc.tri(6, 24, 1, 42, 10, 42, pal[2]); pc.tri(26, 20, 31, 42, 22, 42, pal[1]);
  pc.line(16, 4, 12, 36, GLOW('#ffb0b8')); pc.disc(16, 22, 3 + Math.sin(t * 4), GLOW('#ff4050'));
  pc.rect(6, 42, 20, 6, STONE[1]); pc.outline(DARK); return pc;
}
export function paintShopStand() {
  const pc = new PC(28, 34);
  pc.srect(5, 18, 18, 14, STONE.slice(1)); pc.rect(3, 16, 22, 3, STONE[4]); pc.rect(3, 31, 22, 3, STONE[2]);
  pc.outline(DARK); return pc;
}
export function paintPortal(t) {
  const pc = new PC(64, 84);
  const cols = ['#0a2a5a', '#1a5a9a', '#3aa0e0', '#a0e8ff'];
  for (let r = 0; r < 4; r++) { const rx = 26 - r * 4, ry = 36 - r * 4.5; for (let a = 0; a < 90; a++) { const ang = (a / 90) * 6.283 + t * (r % 2 ? 1 : -1) * 1.5; const w = Math.sin(a * 0.7 + t * 3) * 1.5; pc.disc(32 + Math.cos(ang) * (rx + w), 42 + Math.sin(ang) * (ry + w), 1.8 - r * 0.2, GLOW(cols[r])); } }
  pc.ellipse(32, 42, 16, 26, GLOW('#0a3060')); for (let i = 0; i < 16; i++) { const ang = i * 0.5 + t * 2; pc.set(32 + Math.cos(ang) * (i * 0.9), 42 + Math.sin(ang) * (i * 1.4), GLOW('#e0ffff')); }
  return pc;
}
export function paintTrap(kind, state) {
  if (kind === 'spikes') {
    const pc = new PC(44, 30);
    if (state) for (let i = 0; i < 6; i++) { const x = 6 + i * 6.5; pc.tri(x - 2, 28, x + 2, 28, x, 4 + (i % 2) * 3, IRON[3]); pc.line(x, 6, x, 27, IRON[1]); pc.set(x, 5, H('#a01018')); }
    return pc.outline(DARK);
  }
  if (kind === 'flame') { const pc = new PC(24, 20); pc.rect(4, 10, 16, 8, IRON[2]); pc.rect(2, 8, 20, 3, IRON[3]); pc.disc(12, 12, 4, DARK); pc.set(12, 12, GLOW('#ff8020')); pc.rect(4, 16, 16, 2, IRON[0]); return pc.outline(DARK); }
  if (kind === 'darts') { const pc = new PC(24, 16); pc.rect(2, 4, 20, 10, STONE[2]); pc.rect(2, 4, 20, 2, STONE[4]); for (let i = 0; i < 3; i++) pc.rect(6 + i * 6, 8, 3, 3, DARK); return pc.outline(DARK); }
  if (kind === 'saw') { const pc = new PC(40, 40); const n = 14; for (let i = 0; i < n; i++) { const a = (i / n) * 6.283 + (state ? 0.2 : 0); pc.tri(20 + Math.cos(a - 0.2) * 12, 20 + Math.sin(a - 0.2) * 12, 20 + Math.cos(a + 0.2) * 12, 20 + Math.sin(a + 0.2) * 12, 20 + Math.cos(a) * 19, 20 + Math.sin(a) * 19, IRON[3]); } pc.sell(20, 20, 13, 13, IRON); pc.disc(20, 20, 3, IRON[0]); for (let i = 0; i < 5; i++) pc.set(20 + Math.cos(i * 1.3) * 8, 20 + Math.sin(i * 1.3) * 8, H('#a01018')); return pc.outline(DARK); }
  if (kind === 'crusher') { const pc = new PC(48, 56); pc.srect(4, 2, 40, 24, STONE.slice(1)); for (let i = 0; i < 5; i++) pc.tri(7 + i * 8, 26, 13 + i * 8, 26, 10 + i * 8, 40, IRON[3]); pc.rect(20, 0, 8, 4, IRON[2]); if (state) { pc.rect(0, 36, 48, 6, STONE[2]); pc.rect(0, 40, 48, 4, DARK); } return pc.outline(DARK); }
  return new PC(8, 8);
}
export function paintStatueDormant(painted) {
  // greyscale/desaturate a giant painter output to look inert
  const pc = painted.clone();
  for (let i = 0; i < pc.d.length; i++) { const c = pc.d[i]; if (!(c >>> 24)) continue; const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255; const l = (r * 0.3 + g * 0.5 + b * 0.2) | 0; pc.d[i] = (0xff000000 | (Math.min(255, l * 0.95 + 6) << 16) | (Math.min(255, l * 0.95 + 4) << 8) | Math.min(255, l * 0.98)) >>> 0; }
  return pc;
}

// ---------- pickups ----------
export function paintGold() { const pc = new PC(16, 12); for (const [x, y] of [[4, 8], [9, 8], [6, 5], [11, 5], [8, 3]]) { pc.ellipse(x, y, 3.2, 2.2, GOLD[2]); pc.ellipse(x, y - 0.6, 2.6, 1.6, GOLD[3]); pc.set(x, y, GOLD[1]); } pc.set(6, 3, GLOW('#fff8c0')); return pc.outline(H('#2a1a04')); }
export function paintHeart() { const pc = new PC(18, 16); pc.disc(6, 6, 4.4, H('#d02030')); pc.disc(12, 6, 4.4, H('#d02030')); pc.tri(1.5, 8, 16.5, 8, 9, 15, H('#d02030')); pc.disc(5, 4, 1.4, H('#ff8090')); pc.set(4, 4, GLOW('#ffd0d8')); return pc.outline(H('#3a0008')); }
export function paintPotion(colorHex) { const pc = new PC(16, 22); pc.rect(6, 1, 4, 4, H('#6a5030')); pc.rect(5, 5, 6, 2, IRON[3]); pc.sell(8, 14, 6, 7, [H('#101018'), H(colorHex), H(colorHex), H(colorHex)]); pc.disc(8, 15, 5, H(colorHex)); pc.disc(6, 12, 1.4, H('#ffffff')); pc.set(9, 17, GLOW(colorHex)); return pc.outline(DARK); }
export function paintEcto(t) { const pc = new PC(16, 20); for (let s = 0; s < 8; s++) pc.disc(8 + Math.sin(s * 0.9 + t * 3) * 1.4, 10 + s * 1.2, 4 - s * 0.45, GLOW(s < 3 ? '#e0ffff' : '#7ad0d0')); pc.disc(8, 9, 4.4, GLOW('#b0f0f0')); pc.disc(8, 8, 2.2, GLOW('#ffffff')); return pc; }
export function paintScroll(colorHex) { const pc = new PC(20, 18); pc.rect(3, 4, 14, 10, H('#d8c898')); pc.rect(3, 4, 14, 1, H('#f0e0b0')); pc.rect(1, 3, 3, 12, H('#a89060')); pc.rect(16, 3, 3, 12, H('#a89060')); pc.disc(10, 9, 3, GLOW(colorHex)); pc.line(5, 6, 8, 6, H('#5a4020')); pc.line(12, 12, 15, 12, H('#5a4020')); return pc.outline(DARK); }
export function paintArtifact(t) { const pc = new PC(20, 20); pc.ellipse(10, 10, 7, 7, GOLD[2]); pc.ellipse(10, 10, 4.5, 4.5, DARK); pc.disc(10, 3, 3, GLOW('#ff5060')); pc.disc(10, 3, 1.4, GLOW('#ffd0d8')); pc.set(3 + (t | 0) % 3, 8, GLOW('#ffffff')); return pc.outline(DARK); }
export function paintWeaponIcon(kind) { const pc = new PC(24, 24); pc.line(4, 20, 20, 4, IRON[3], 3); pc.line(4, 20, 20, 4, IRON[2], 1); pc.line(3, 15, 9, 21, GOLD[2], 3); pc.set(20, 4, GLOW('#ffffff')); return pc.outline(DARK); }
export function paintKnife() { const pc = new PC(14, 14); pc.line(3, 11, 11, 3, IRON[3], 2); pc.line(2, 12, 5, 9, WOOD[2], 3); return pc.outline(DARK); }

// ---------- projectiles ----------
export function paintProj(kind, t) {
  const pc = new PC(20, 20);
  const g = (c) => GLOW(c);
  switch (kind) {
    case 'arrow': pc.line(3, 10, 17, 10, H('#c8b898'), 2); pc.tri(17, 6, 20, 10, 17, 14, IRON[3]); pc.tri(3, 7, 3, 13, 0, 10, H('#a04030')); return pc;
    case 'knife': pc.line(4, 14, 16, 6, IRON[3], 2.4); pc.line(3, 15, 7, 11, WOOD[3], 3); pc.set(16, 6, g('#ffffff')); return pc;
    case 'stone': pc.disc(10, 10, 3.6, H('#8a8478')); pc.disc(9, 9, 1.6, H('#b8b2a4')); return pc;
    case 'shard': pc.tri(10, 1, 15, 17, 5, 17, BONE[3]); pc.tri(10, 1, 10, 17, 5, 17, BONE[2]); return pc;
    case 'gore': pc.disc(10, 10, 5, H('#8a0c18')); pc.disc(9, 9, 2.5, H('#e03848')); pc.disc(13, 12, 2, g('#ff3050')); for (let i = 0; i < 4; i++) pc.set(3 + i * 4, 15 + (i % 2), H('#c01828')); return pc;
    case 'wave': for (let r = 0; r < 3; r++) for (let a = -1.1; a <= 1.1; a += 0.15) pc.set(10 + Math.sin(a) * (4 + r * 3), 10 - Math.cos(a) * (4 + r * 3) + 8, g(['#ffd0d8', '#ff6080', '#c02040'][r])); return pc;
    case 'acid': pc.disc(10, 10, 5, H('#3a8a1a')); pc.disc(9, 9, 2.5, g('#a0ff60')); pc.disc(13, 13, 1.5, g('#d0ff90')); return pc;
    case 'darkbolt': pc.disc(10, 10, 5.5, g('#5a1a8a')); pc.disc(10, 10, 3.6, g('#a050f0')); pc.disc(10, 10, 1.8, g('#f0d0ff')); return pc;
    case 'curseorb': pc.disc(10, 10, 5.5, g('#8a6a10')); pc.disc(10, 10, 3.6, g('#e0b020')); pc.disc(10, 10, 1.8, g('#fff8c0')); for (let i = 0; i < 6; i++) pc.set(10 + Math.cos(i + t * 4) * 7, 10 + Math.sin(i + t * 4) * 7, g('#ffe060')); return pc;
    case 'fireball': flame(pc, 10, 16, 14, 5.5 + Math.sin(t * 9), t * 2); pc.disc(10, 11, 2.4, g('#ffffff')); return pc;
    case 'boulder': pc.sell(10, 10, 8, 8, STONE); pc.noise(1, 0.1); return pc.outline(DARK);
    case 'dart': pc.line(3, 10, 15, 10, H('#d8d0b8'), 1.4); pc.tri(15, 8, 18, 10, 15, 12, IRON[3]); pc.set(4, 9, H('#a04030')); pc.set(4, 11, H('#a04030')); return pc;
    case 'spark': pc.disc(10, 10, 3, g('#c0f0ff')); for (let i = 0; i < 5; i++) pc.line(10, 10, 10 + Math.cos(i * 1.3 + t * 12) * 8, 10 + Math.sin(i * 1.3 + t * 12) * 8, g('#80d0ff')); return pc;
    case 'pot': return paintPot('pot');
    default: pc.disc(10, 10, 4, g('#ffffff')); return pc;
  }
}

// ---------- bosses ----------
const ROCK = pal5('#1e2226', '#323a40', '#4a545c', '#66727c', '#8a98a4');
export function paintBossBody(id, p = {}) {
  if (id === 'colossus') {
    const pc = new PC(132, 140), t = p.t || 0;
    // body: big coffin golem torso
    pc.quad([[26, 132], [106, 132], [116, 34], [16, 34]], ROCK[2]); pc.quad([[26, 132], [66, 132], [66, 34], [16, 34]], ROCK[1]);
    pc.srect(12, 10, 108, 30, ROCK.slice(0, 4).reverse().slice(0, 3).reverse());
    for (let i = 0; i < 8; i++) pc.line(24 + i * 12, 40, 30 + i * 11, 130, ROCK[0], 1);
    for (const y of [50, 70, 90, 110]) pc.rect(20, y, 92, 3, ROCK[0]);
    // chest cracks (exposed glow)
    const exp = p.exposed ? 1 : 0.25;
    pc.ellipse(66, 82, 20, 22, H('#04121a'));
    pc.disc(66, 82, 12 * exp + 3, GLOW('#ff8a30')); pc.disc(66, 82, 6 * exp + 1.5, GLOW('#ffe8a0'));
    for (let i = 0; i < 8; i++) { const a = i * 0.785; pc.line(66 + Math.cos(a) * 12, 82 + Math.sin(a) * 14, 66 + Math.cos(a) * (18 + 8 * exp), 82 + Math.sin(a) * (22 + 8 * exp), GLOW('#ff7a20'), 1); }
    // shoulders with hieroglyph
    for (const s of [-1, 1]) { pc.sell(66 + s * 54, 30, 20, 16, ROCK); for (let i = 0; i < 3; i++) pc.set(66 + s * 54 - 6 + i * 6, 30, GLOW('#ffb040')); }
    // sarcophagus head-lid
    pc.srect(46, 0, 40, 32, pal3('#6a5a3a', '#a08850', '#d8bc68')); pc.sell(66, 14, 12, 12, pal4('#8a7440', '#b09850', '#d8bc68', '#f8e498'));
    pc.noise(2, 0.08); return pc.outline(DARK);
  }
  if (id === 'jackal') {
    const pc = new PC(140, 120), t = p.t || 0;
    // bone body: spine + ribcage, hunched
    const bone = pal4('#5a4e3e', '#9a8c72', '#cfc3a6', '#eee6cc');
    pc.sell(70, 84, 44, 30, bone);
    for (let i = 0; i < 6; i++) { pc.line(30 + i * 4, 60 + i * 5, 110 - i * 4, 60 + i * 5, DARK, 2); pc.line(30 + i * 4, 62 + i * 5, 110 - i * 4, 62 + i * 5, bone[3], 1); }
    pc.line(70, 54, 70, 112, bone[0], 4);
    pc.ellipse(70, 84, 14, 16, H('#1a0a08')); pc.disc(70, 84, 8, GLOW('#7a20ff')); pc.disc(70, 84, 4, GLOW('#d0a0ff'));
    for (const s of [-1, 1]) { pc.limb(70 + s * 34, 100, 70 + s * 46, 116, 8, bone); pc.rect(70 + s * 46 - 7, 114, 15, 5, bone[1]); }
    pc.sell(70, 50, 20, 12, bone); // shoulders bones
    for (let i = 0; i < 5; i++) pc.tri(50 + i * 10, 44, 54 + i * 10, 44, 52 + i * 10, 26 + (i % 2) * 4, bone[3]);
    pc.noise(3, 0.07); return pc.outline(DARK);
  }
  if (id === 'sand') {
    const pc = new PC(140, 120); const sand = pal5('#4a3418', '#7a5a30', '#a8844c', '#cfaa6a', '#ecd090');
    pc.sell(70, 92, 62, 30, sand); // dune
    for (let i = 0; i < 9; i++) pc.line(14 + i * 14, 108 - (i % 3) * 4, 30 + i * 12, 84 - (i % 4) * 3, sand[1], 2);
    pc.ellipse(70, 70, 34, 16, H('#120a04')); pc.ellipse(70, 66, 28, 11, H('#000000')); // burrow
    for (let i = 0; i < 14; i++) { const a = (i / 14) * 6.283; pc.tri(70 + Math.cos(a) * 33, 70 + Math.sin(a) * 15.5, 70 + Math.cos(a + 0.22) * 33, 70 + Math.sin(a + 0.22) * 15.5, 70 + Math.cos(a + 0.11) * 21, 70 + Math.sin(a + 0.11) * 9, BONE[3]); }
    const glow = p.exposed ? 1 : 0.3; pc.disc(70, 68, 5 * glow + 2, GLOW('#ff9030'));
    pc.noise(8, 0.07); return pc.outline(DARK);
  }
  if (id === 'heart') {
    const pc = new PC(140, 140), fl = pal5('#3a0610', '#661020', '#961a2e', '#c8283e', '#ff6a78');
    const beat = 1 + 0.05 * Math.sin((p.t || 0) * 3.1);
    pc.sell(70, 74, 50 * beat, 52 * beat, fl); pc.sell(44, 50, 28, 26, fl); pc.sell(96, 50, 28, 26, fl);
    pc.limb(62, 28, 54, 6, 12, fl.slice(0, 4)); pc.limb(82, 28, 92, 4, 12, fl.slice(0, 4)); // vessels
    for (let i = 0; i < 12; i++) pc.line(30 + (i * 11) % 80, 40 + (i * 17) % 70, 50 + (i * 13) % 60, 60 + (i * 7) % 60, i % 3 ? fl[0] : fl[4], 2);
    const ex = p.exposed ? 1 : 0.25; pc.ellipse(70, 86, 16, 20, H('#1a0206')); pc.disc(70, 86, 9 * ex + 3, GLOW('#ff3050')); pc.disc(70, 86, 4 * ex + 1.5, GLOW('#ffc0c8'));
    pc.noise(6, 0.08); return pc.outline(DARK);
  }
  // mother
  const pc = new PC(140, 140), t = p.t || 0;
  const wrap = pal5('#4e4634', '#7a6e52', '#a89a76', '#cbbd94', '#e6dab4');
  pc.sell(70, 84, 56, 52, wrap);
  for (let i = 0; i < 14; i++) pc.line(18 + (i * 9) % 100, 40 + (i * 13) % 80, 50 + (i * 11) % 90, 60 + (i * 7) % 70, i % 2 ? wrap[0] : wrap[4], 2);
  const rng = new RNG(4);
  for (let i = 0; i < 9; i++) { const x = rng.int(24, 116), y = rng.int(36, 124); pc.sell(x, y, 8, 9, wrap); pc.disc(x - 2, y - 1, 1.6, DARK); pc.disc(x + 2, y - 1, 1.6, DARK); pc.set(x - 2, y - 1, GLOW('#ffb030')); pc.set(x + 2, y - 1, GLOW('#ffb030')); }
  const core = p.exposed ? 1 : 0.2;
  pc.disc(70, 88, 10 * core + 4, GLOW('#ff3050')); pc.disc(70, 88, 5 * core + 2, GLOW('#ffc0c8'));
  pc.noise(5, 0.07); return pc.outline(DARK);
}
export function paintBossPart(id, variant, p = {}) {
  if (id === 'sandHead') {
    const pc = new PC(90, 98), sand = pal5('#4a3418', '#7a5a30', '#a8844c', '#cfaa6a', '#ecd090');
    pc.limb(45, 96, 45, 50, 40, sand.slice(0, 4)); for (let i = 0; i < 6; i++) pc.line(24, 92 - i * 12, 66, 88 - i * 12, sand[0], 2);
    pc.sell(45, 38, 34, 32, sand); const open = p.atk ? 16 : 8;
    pc.ellipse(45, 40, 26, 22 + open * 0.3, H('#0a0402'));
    for (let r = 0; r < 3; r++) for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283 + r * 0.26, rr = 22 - r * 6; pc.tri(45 + Math.cos(a) * rr, 40 + Math.sin(a) * (rr * 0.85), 45 + Math.cos(a + 0.2) * rr, 40 + Math.sin(a + 0.2) * (rr * 0.85), 45 + Math.cos(a + 0.1) * (rr - 8), 40 + Math.sin(a + 0.1) * ((rr - 8) * 0.85), BONE[3]); }
    pc.disc(45, 40, 5, GLOW(p.atk ? '#ff5020' : '#ff9030')); pc.disc(20, 16, 3, GLOW('#ffcc60')); pc.disc(70, 16, 3, GLOW('#ffcc60'));
    pc.noise(4, 0.07); return pc.outline(DARK);
  }
  if (id === 'sandTendril' || id === 'heartTendril') {
    const heart = id === 'heartTendril', pc = new PC(72, 110);
    const pal = heart ? pal5('#3a0610', '#661020', '#961a2e', '#c8283e', '#ff6a78') : pal5('#4a3418', '#7a5a30', '#a8844c', '#cfaa6a', '#ecd090');
    const sway = p.atk ? 10 : 0;
    for (let s = 0; s < 22; s++) { const t = s / 21, x = 36 + Math.sin(t * 5 + (p.atk ? 1 : 0)) * (7 + sway * t), y = 106 - s * 4.6, r = 12 - t * 8; pc.sell(x, y, r, r * 0.9, pal); if (s % 3 === 1) { pc.disc(x - r * 0.6, y, 1.6, heart ? GLOW('#ff9090') : BONE[3]); pc.disc(x + r * 0.6, y, 1.6, heart ? GLOW('#ff9090') : BONE[3]); } }
    pc.tri(28, 12, 44, 12, 36, -2 + 0, heart ? pal[4] : BONE[3]); if (heart) { pc.tri(24, 20, 30, 14, 26, 6, pal[4]); pc.tri(48, 20, 42, 14, 46, 6, pal[4]); }
    pc.noise(5, 0.07); return pc.outline(DARK);
  }
  if (id === 'colossusFist') { const pc = new PC(72, 80); pc.srect(8, 10, 56, 58, ROCK.slice(0, 4).slice(0, 3).map((c, i, a) => a[i])); pc.sell(36, 40, 28, 30, ROCK); for (let i = 0; i < 4; i++) { pc.rect(10 + i * 13, 6, 10, 20, ROCK[3]); pc.rect(10 + i * 13, 6, 10, 2, ROCK[4]); pc.rect(10 + i * 13, 24, 10, 2, ROCK[0]); } pc.rect(6, 62, 60, 12, ROCK[1]); for (let i = 0; i < 4; i++) pc.set(16 + i * 13, 40, GLOW('#ffb040')); if (p.atk) { pc.disc(36, 40, 8, GLOW('#ff8a30')); } pc.noise(2, 0.08); return pc.outline(DARK); }
  if (id === 'colossusFace') { const pc = new PC(84, 84); pc.srect(8, 4, 68, 72, pal3('#6a5a3a', '#a08850', '#d8bc68')); pc.rect(8, 4, 68, 5, GOLD[3]); pc.rect(8, 71, 68, 5, GOLD[1]); pc.rect(16, 22, 20, 8, DARK); pc.rect(48, 22, 20, 8, DARK); const beam = p.atk ? 1 : 0.6; pc.rect(18, 24, 16, 4, GLOW('#ffd040')); pc.rect(50, 24, 16, 4, GLOW('#ffd040')); pc.disc(42, 46, 6 * beam, GLOW('#ffa020')); pc.rect(28, 56, 28, 8, DARK); for (let i = 0; i < 6; i++) pc.rect(30 + i * 4, 56, 2, 4, H('#c8c0a0')); pc.rect(38, 8, 8, 10, pal4('#0a2a5a', '#1a4a9a', '#2a6ad0', '#5a9aff')[2]); pc.noise(3, 0.06); return pc.outline(DARK); }
  if (id === 'jackalHead') { return jackal(variant, p); }
  if (id === 'motherArm') { const pc = new PC(72, 108); const wrap = pal5('#4e4634', '#7a6e52', '#a89a76', '#cbbd94', '#e6dab4'); const un = p.unwrapped; pc.limb(36, 104, 36, 40, 26, un ? pal3('#5a0c14', '#8a1a24', '#b8343c') : wrap.slice(0, 4)); for (let i = 0; i < 9; i++) pc.line(24, 100 - i * 8, 48, 94 - i * 8, un ? H('#c04050') : wrap[0], 2); pc.sell(36, 24, 22, 20, un ? pal5('#3a0c12', '#5c1520', '#8a2430', '#b03e44', '#d27070') : wrap); for (let i = 0; i < 4; i++) { const x = 18 + i * 12; pc.limb(x, 14, x + (i - 1.5) * 3, 0, 6, wrap.slice(0, 4)); } pc.noise(4, 0.07); return pc.outline(DARK); }
  if (id === 'motherMouth') { const pc = new PC(80, 72); const wrap = pal5('#4e4634', '#7a6e52', '#a89a76', '#cbbd94', '#e6dab4'); pc.sell(40, 36, 34, 30, wrap); const open = p.atk ? 20 : 12; pc.ellipse(40, 42, 22, open, H('#12030a')); for (let i = 0; i < 9; i++) { pc.tri(20 + i * 5, 42 - open + 2, 24 + i * 5, 42 - open + 2, 22 + i * 5, 42 - open + 9, H('#e8e0c8')); pc.tri(20 + i * 5, 42 + open - 2, 24 + i * 5, 42 + open - 2, 22 + i * 5, 42 + open - 9, H('#e8e0c8')); } pc.disc(40, 44, 6, GLOW('#ff3050')); pc.disc(22, 18, 3, GLOW('#ffb030')); pc.disc(58, 18, 3, GLOW('#ffb030')); pc.noise(5, 0.07); return pc.outline(DARK); }
  return new PC(8, 8);
}
function jackal(variant, p) {
  const pc = new PC(84, 92);
  const bone = pal4('#5a4e3e', '#9a8c72', '#cfc3a6', '#eee6cc');
  pc.limb(42, 90, 42, 56, 16, bone); // neck
  pc.sell(42, 40, 26, 22, bone); // cranium
  pc.tri(20, 26, 12, 0, 32, 20, bone[2]); pc.tri(64, 26, 72, 0, 52, 20, bone[2]); pc.tri(21, 24, 15, 6, 30, 20, DARK); pc.tri(63, 24, 69, 6, 54, 20, DARK); // ears
  const open = p.atk ? 20 : 8;
  pc.quad([[26, 44], [58, 44], [50, 74], [34, 74]], bone[2]); // snout
  pc.ellipse(42, 62, 12, open, H('#12030a'));
  for (let i = 0; i < 6; i++) { pc.tri(32 + i * 4, 56, 35 + i * 4, 56, 33.5 + i * 4, 62, H('#f2ead2')); pc.tri(32 + i * 4, 62 + open, 35 + i * 4, 62 + open, 33.5 + i * 4, 56 + open, H('#f2ead2')); }
  const eye = variant === 'fire' ? '#ff6020' : variant === 'howl' ? '#60ffb0' : '#ff2020';
  pc.disc(30, 36, 5, DARK); pc.disc(54, 36, 5, DARK); pc.disc(30, 36, 3, GLOW(eye)); pc.disc(54, 36, 3, GLOW(eye));
  pc.tri(40, 46, 44, 46, 42, 52, DARK);
  if (variant === 'fire') { flame(pc, 42, 26, 16, 8, p.t || 0); if (p.atk) for (let i = 0; i < 6; i++) pc.disc(42 + (i - 2.5) * 5, 66 + open, 3, GLOW('#ff8a20')); }
  if (variant === 'howl') { pc.rect(30, 12, 24, 2, GLOW('#60ffb0')); for (let i = 0; i < 3; i++) pc.ring && 0; }
  pc.noise(6, 0.06); return pc.outline(DARK);
}

// ---------- first-person weapons (upright, hand at bottom) ----------
const LEATHER = pal4('#1a1008', '#3a2412', '#5a3a1e', '#7c5230');
export function hand(pc, x, y, open = false) {
  pc.limb(x + 8, y + 38, x + 6, y + 6, 15, LEATHER); pc.sell(x + 4, y + 2, 10, 8, pal4('#5a3a20', '#8a5a30', '#b98050', '#e0a878'));
  for (let i = 0; i < 4; i++) pc.rect(x - 4 + i * 4, y - 5, 3, 8, pal4('#5a3a20', '#8a5a30', '#b98050', '#e0a878')[1 + (i % 2)]);
  pc.rect(x - 6, y + 10, 26, 3, IRON[2]);
}
export function paintWeapon(kind, fx = {}) {
  const pc = new PC(64, 112);
  const cx = 32;
  const blade = fx.color ? pal4('#101820', fx.color, fx.color, '#ffffff') : IRON;
  switch (kind) {
    case 'sword': { // worn short sword: bevelled blade with a fuller, nicked edge, brass guard, wrapped grip, round pommel
      pc.quad([[cx - 5, 62], [cx + 5, 62], [cx + 3, 8], [cx - 3, 8]], IRON[2]);
      pc.quad([[cx - 5, 62], [cx, 62], [cx, 8], [cx - 3, 8]], IRON[3]); // lit bevel
      pc.tri(cx - 3, 8, cx + 3, 8, cx, -3, IRON[2]); pc.tri(cx - 3, 8, cx, 8, cx, -3, IRON[3]);
      pc.line(cx + 0.5, 12, cx + 0.5, 58, IRON[1], 1.6); pc.line(cx - 1, 12, cx - 1, 58, IRON[3], 1); // fuller
      pc.line(cx - 5, 62, cx - 3, 8, IRON[3], 1); pc.line(cx + 5, 62, cx + 3, 8, IRON[0], 1); // edges
      const rust = [H('#6a3a22'), H('#8a4a2a'), H('#a8683a')];
      for (let i = 0; i < 14; i++) { const y = 14 + ((i * 29) % 46), x = cx + (((i * 7) % 9) - 4) * 0.8; pc.set(x, y, rust[i % 3]); if (i % 3 === 0) pc.set(x + 1, y + 1, rust[0]); }
      for (const [y, d] of [[22, 1], [37, -1], [49, 1]]) { pc.set(cx + 5 * d - d, y, 0); pc.set(cx + 4 * d - d, y + 1, 0); } // nicks in the edge
      pc.rect(cx - 13, 62, 26, 5, GOLD[1]); pc.rect(cx - 13, 62, 26, 1, GOLD[3]); pc.rect(cx - 13, 66, 26, 1, GOLD[0]);
      pc.disc(cx - 11, 64.5, 1.6, GOLD[2]); pc.disc(cx + 11, 64.5, 1.6, GOLD[2]); pc.set(cx, 64, DARK);
      pc.rect(cx - 3, 67, 6, 13, WOOD[1]); for (let i = 0; i < 6; i++) pc.line(cx - 3, 68 + i * 2, cx + 3, 70 + i * 2, WOOD[0], 1); pc.rect(cx - 3, 67, 1, 13, WOOD[2]);
      pc.disc(cx, 83, 4, GOLD[1]); pc.disc(cx - 1, 82, 1.8, GOLD[3]);
      break;
    }
    case 'dagger': pc.quad([[cx - 4, 70], [cx + 4, 70], [cx + 2, 30], [cx - 2, 30]], BONE[2]); pc.tri(cx - 2, 30, cx + 2, 30, cx, 20, BONE[3]); pc.rect(cx - 1, 30, 2, 40, BONE[3]); pc.rect(cx - 8, 70, 16, 4, IRON[2]); pc.rect(cx - 2, 74, 5, 10, LEATHER[2]); pc.disc(cx, 86, 3, IRON[2]); break;
    case 'axe': pc.rect(cx - 2, 20, 5, 70, WOOD[2]); pc.rect(cx - 2, 20, 1, 70, WOOD[3]); pc.quad([[cx + 2, 12], [cx + 26, 6], [cx + 30, 40], [cx + 2, 36]], IRON[2]); pc.quad([[cx + 2, 12], [cx + 26, 6], [cx + 24, 14], [cx + 2, 20]], IRON[3]); pc.line(cx + 30, 8, cx + 30, 40, IRON[3], 2); pc.rect(cx - 3, 26, 8, 4, IRON[1]); pc.rect(cx - 3, 32, 8, 4, IRON[1]); break;
    case 'spear': pc.rect(cx - 2, 16, 5, 80, WOOD[2]); pc.rect(cx - 2, 16, 1, 80, WOOD[3]); pc.tri(cx - 6, 20, cx + 7, 20, cx, -6, IRON[3]); pc.tri(cx, 20, cx + 7, 20, cx, -6, IRON[2]); pc.rect(cx - 4, 20, 9, 4, GOLD[2]); pc.rect(cx - 3, 26, 7, 2, H('#a02020')); break;
    case 'mace': pc.rect(cx - 2, 30, 5, 60, WOOD[2]); pc.sell(cx, 18, 14, 14, IRON); for (let i = 0; i < 8; i++) { const a = i * 0.785; pc.tri(cx + Math.cos(a) * 12, 18 + Math.sin(a) * 12, cx + Math.cos(a + 0.3) * 12, 18 + Math.sin(a + 0.3) * 12, cx + Math.cos(a + 0.15) * 20, 18 + Math.sin(a + 0.15) * 20, IRON[3]); } pc.rect(cx - 4, 28, 9, 4, IRON[1]); break;
    case 'khopesh': pc.rect(cx - 3, 54, 6, 30, GOLD[2]); pc.limb(cx, 56, cx - 2, 22, 7, pal4('#8a6420', '#d8ac3c', '#f8dc72', '#ffffff')); pc.limb(cx - 2, 24, cx + 20, 8, 9, pal4('#8a6420', '#d8ac3c', '#f8dc72', '#ffffff')); pc.limb(cx + 19, 10, cx + 26, 24, 7, pal4('#8a6420', '#d8ac3c', '#f8dc72', '#ffffff')); pc.rect(cx - 7, 56, 14, 4, GOLD[1]); pc.set(cx + 24, 18, GLOW('#ffffff')); break;
    case 'hammer': pc.rect(cx - 2, 26, 5, 68, WOOD[2]); pc.rect(cx - 2, 26, 1, 68, WOOD[3]); pc.srect(cx - 18, 4, 36, 26, IRON.slice(1)); pc.rect(cx - 18, 4, 36, 3, IRON[3]); pc.rect(cx - 18, 27, 36, 3, IRON[0]); pc.rect(cx - 16, 12, 4, 10, IRON[0]); pc.rect(cx + 12, 12, 4, 10, IRON[0]); break;
    case 'crossbow': pc.rect(cx - 3, 20, 6, 60, WOOD[2]); pc.rect(cx - 3, 20, 1, 60, WOOD[3]); pc.limb(cx - 24, 34, cx, 26, 5, WOOD.slice(1)); pc.limb(cx + 24, 34, cx, 26, 5, WOOD.slice(1)); pc.line(cx - 24, 36, cx, 46, H('#d8d0b0')); pc.line(cx + 24, 36, cx, 46, H('#d8d0b0')); pc.rect(cx - 1, 6, 3, 26, IRON[3]); pc.tri(cx - 3, 6, cx + 4, 6, cx, -2, IRON[3]); pc.rect(cx - 5, 44, 10, 4, IRON[2]); break;
    case 'knives': for (const [ox, oy, r] of [[-8, 10, -0.2], [0, 0, 0], [8, 10, 0.2]]) { pc.line(cx + ox, 56 + oy, cx + ox + r * 30, 20 + oy, IRON[3], 5); pc.line(cx + ox, 56 + oy, cx + ox + r * 30, 20 + oy, BONE[3], 2); pc.limb(cx + ox, 66 + oy, cx + ox, 56 + oy, 5, WOOD.slice(1)); } break;
    case 'sling': pc.line(cx - 16, 60, cx - 4, 20, LEATHER[3], 3); pc.line(cx + 16, 60, cx + 4, 20, LEATHER[3], 3); pc.sell(cx, 16, 7, 6, LEATHER); pc.disc(cx, 16, 4, H('#8a8478')); pc.rect(cx - 3, 60, 6, 20, LEATHER[2]); break;
    case 'spell': pc.disc(cx, 40, 16, GLOW(fx.color || '#8a40ff')); pc.disc(cx, 40, 10, GLOW('#ffffff')); for (let i = 0; i < 10; i++) { const a = i * 0.63; pc.line(cx, 40, cx + Math.cos(a) * 22, 40 + Math.sin(a) * 22, GLOW(fx.color || '#8a40ff')); } break;
    default: break;
  }
  pc.noise(kind.length, 0.05);
  pc.outline(DARK);
  if (kind !== 'spell') hand(pc, 22, 84);
  else hand(pc, 22, 84, true);
  return pc;
}

export function paintFaceIcon() { return new PC(1, 1); }

// soft radial glow used for additive halos (intensity is baked into the colour)
// soft contact shadow: alpha falls off from the middle; the renderer dithers partial alpha
export function paintSoftShadow(w = 28, h = 12) {
  const pc = new PC(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2), d = dx * dx + dy * dy;
    if (d < 1) pc.set(x, y, ((Math.round(215 * Math.pow(1 - d, 0.9)) << 24) | 0x0a0808) >>> 0);
  }
  return pc;
}
// small dark ellipse: the ground shadow under airborne objects (drawn with partial alpha)
export function paintShadow(w = 16, h = 8) {
  const pc = new PC(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2);
    if (dx * dx + dy * dy <= 1) pc.set(x, y, 0xff0c0a0a);
  }
  return pc;
}

export function paintGlow(colorHex, size = 32) {
  const pc = new PC(size, size), n = parseInt(colorHex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - c, y - c) / c; if (d >= 1) continue;
    const v = Math.pow(1 - d, 2.2);
    pc.set(x, y, ((255 << 24) | (Math.round(b * v) << 16) | (Math.round(g * v) << 8) | Math.round(r * v)) >>> 0);
  }
  return pc;
}
