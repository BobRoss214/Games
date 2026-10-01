// Gib sprites: severed limbs, skulls, ribs, bones and meat chunks. Small, shaded, wet-looking.
// Drawn at 20x16 and rotated in 90-degree steps (+ flip) to fake tumbling.
import { PC, H, rot90, pal4, pal5 } from './pixart.js';
import { RNG } from './util.js';

const BONE = pal4('#5a4e3e', '#9a8c72', '#cfc3a6', '#eee6cc');
const MEAT = pal5('#2a060a', '#52101a', '#7e1a24', '#a82a34', '#d04a54');
const SKIN = pal5('#3a2a24', '#5a4034', '#7e5a48', '#a07860', '#c09a80');
const SLIME = pal4('#14341a', '#28602a', '#44a040', '#8ae070');
const ECTO = pal4('#1a3a5a', '#2a7aa8', '#6ac8ee', '#c8f4ff');
const DARK = H('#120808');
const WET = H('#e86470');
const CUT = H('#8a1620');

function dressed(pc, seed) { pc.noise(seed, 0.07); pc.outline(DARK); return pc; }

function meatChunk(rng, pal) {
  const pc = new PC(16, 14);
  const cx = 8, cy = 7, rx = rng.float(4, 6), ry = rng.float(3, 5);
  pc.sell(cx, cy, rx, ry, pal);
  for (let i = 0; i < 3; i++) pc.sell(cx + rng.float(-3, 3), cy + rng.float(-2, 2), rng.float(1.5, 3), rng.float(1.2, 2.5), pal);
  pc.set(cx - 2, cy - 2, WET); pc.set(cx - 1, cy - 2, WET);
  return pc;
}
function organ(rng) {
  const pc = new PC(16, 14);
  pc.sell(8, 7, 5, 3.6, MEAT); pc.line(4, 8, 12, 6, MEAT[1], 1); pc.line(5, 5, 11, 9, MEAT[2], 1);
  pc.set(6, 5, WET); pc.set(7, 5, WET);
  return pc;
}
function limb(rng, pal, bonePal, leg) {
  const pc = new PC(22, 14), len = leg ? 15 : 13, y = 7;
  pc.limb(3, y, 3 + len, y + rng.float(-1, 1), leg ? 4.2 : 3.4, pal);
  pc.disc(3 + len, y, leg ? 2.4 : 1.9, pal[2]); // hand/foot
  if (!leg) for (let i = 0; i < 3; i++) pc.set(3 + len + 2, y - 1 + i, pal[1]); // fingers
  pc.disc(3, y, leg ? 2.4 : 2, CUT); pc.disc(3, y, 1, BONE[3]); pc.set(2, y - 1, WET); // torn end with a bone stub
  for (let i = 0; i < 4; i++) pc.set(4 + i * 2, y + 2 + (i & 1), MEAT[1]);
  return pc;
}
function skull(rng) {
  const pc = new PC(14, 14);
  pc.sell(7, 6, 5, 5, BONE); pc.rect(4, 9, 6, 3, BONE[1]);
  pc.disc(5, 6, 1.4, DARK); pc.disc(9, 6, 1.4, DARK); pc.set(7, 8, DARK);
  for (let i = 0; i < 4; i++) pc.set(4 + i * 2, 11, DARK);
  if (rng.next() < 0.7) { pc.set(10, 3, CUT); pc.set(10, 4, CUT); pc.set(9, 3, MEAT[3]); }
  return pc;
}
function bone(rng) {
  const pc = new PC(22, 10);
  pc.line(3, 5, 18, 5 + rng.float(-1, 1), BONE[2], 2.2); pc.line(3, 4.4, 18, 4.4, BONE[3], 1);
  for (const x of [3, 18]) { pc.disc(x, 3.8, 1.6, BONE[2]); pc.disc(x, 6.4, 1.6, BONE[1]); }
  if (rng.next() < 0.6) pc.disc(18, 5, 1.5, CUT);
  return pc;
}
function ribs(rng) {
  const pc = new PC(24, 16);
  pc.line(4, 3, 4, 13, BONE[1], 2);
  for (let i = 0; i < 4; i++) { const y = 3 + i * 3; pc.line(5, y, 12 + (i === 1 || i === 2 ? 4 : 2), y + 2 + (i & 1), BONE[2], 1.6); pc.set(7 + i, y, BONE[3]); }
  pc.set(4, 4, CUT); pc.set(4, 12, CUT);
  return pc;
}
function tendrils(rng, pal) {
  const pc = new PC(16, 12);
  for (let i = 0; i < 4; i++) { pc.limb(3 + i * 2.5, 2 + (i & 1), 4 + i * 2 + rng.float(-1, 1), 10, 2.2, pal); }
  pc.sell(8, 4, 5, 2.6, pal); pc.set(6, 3, WET);
  return pc;
}

const KINDS = {
  flesh: (r) => meatChunk(r, r.next() < 0.3 ? SKIN : MEAT), organ, limb: (r) => limb(r, r.next() < 0.5 ? SKIN : MEAT, BONE, false), leg: (r) => limb(r, r.next() < 0.5 ? SKIN : MEAT, BONE, true),
  skull, bone, ribs, slime: (r) => meatChunk(r, SLIME), ecto: (r) => meatChunk(r, ECTO), guts: (r) => tendrils(r, MEAT),
};
export const GIB_KINDS = Object.keys(KINDS);

// variant 0..7: rotation steps and flips. seed picks the drawing.
export function paintGib(kind, seed, variant) {
  let pc = dressed(KINDS[kind](new RNG(seed * 31 + 7)), seed);
  for (let i = 0; i < (variant & 3); i++) pc = rot90(pc);
  if (variant & 4) pc = pc.flipX();
  return pc;
}
