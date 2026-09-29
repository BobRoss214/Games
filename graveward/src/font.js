// Chunky 5x7 pixel font generated in code + small drawing helpers for HUD/menus.
const GLYPHS = {
  ' ': [0, 0, 0, 0, 0], '!': [0, 0, 0x5f, 0, 0], '"': [0, 7, 0, 7, 0], '#': [0x14, 0x7f, 0x14, 0x7f, 0x14], '$': [0x24, 0x2a, 0x7f, 0x2a, 0x12], '%': [0x23, 0x13, 8, 0x64, 0x62],
  '&': [0x36, 0x49, 0x55, 0x22, 0x50], "'": [0, 5, 3, 0, 0], '(': [0, 0x1c, 0x22, 0x41, 0], ')': [0, 0x41, 0x22, 0x1c, 0], '*': [0x14, 8, 0x3e, 8, 0x14], '+': [8, 8, 0x3e, 8, 8],
  ',': [0, 0x50, 0x30, 0, 0], '-': [8, 8, 8, 8, 8], '.': [0, 0x60, 0x60, 0, 0], '/': [0x20, 0x10, 8, 4, 2], '0': [0x3e, 0x51, 0x49, 0x45, 0x3e], '1': [0, 0x42, 0x7f, 0x40, 0],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46], '3': [0x21, 0x41, 0x45, 0x4b, 0x31], '4': [0x18, 0x14, 0x12, 0x7f, 0x10], '5': [0x27, 0x45, 0x45, 0x45, 0x39], '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
  '7': [1, 0x71, 9, 5, 3], '8': [0x36, 0x49, 0x49, 0x49, 0x36], '9': [6, 0x49, 0x49, 0x29, 0x1e], ':': [0, 0x36, 0x36, 0, 0], ';': [0, 0x56, 0x36, 0, 0], '<': [8, 0x14, 0x22, 0x41, 0],
  '=': [0x14, 0x14, 0x14, 0x14, 0x14], '>': [0, 0x41, 0x22, 0x14, 8], '?': [2, 1, 0x51, 9, 6], '@': [0x32, 0x49, 0x79, 0x41, 0x3e], A: [0x7e, 0x11, 0x11, 0x11, 0x7e], B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22], D: [0x7f, 0x41, 0x41, 0x22, 0x1c], E: [0x7f, 0x49, 0x49, 0x49, 0x41], F: [0x7f, 9, 9, 9, 1], G: [0x3e, 0x41, 0x49, 0x49, 0x7a], H: [0x7f, 8, 8, 8, 0x7f],
  I: [0, 0x41, 0x7f, 0x41, 0], J: [0x20, 0x40, 0x41, 0x3f, 1], K: [0x7f, 8, 0x14, 0x22, 0x41], L: [0x7f, 0x40, 0x40, 0x40, 0x40], M: [0x7f, 2, 0x0c, 2, 0x7f], N: [0x7f, 4, 8, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e], P: [0x7f, 9, 9, 9, 6], Q: [0x3e, 0x41, 0x51, 0x21, 0x5e], R: [0x7f, 9, 0x19, 0x29, 0x46], S: [0x46, 0x49, 0x49, 0x49, 0x31], T: [1, 1, 0x7f, 1, 1],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f], V: [0x1f, 0x20, 0x40, 0x20, 0x1f], W: [0x3f, 0x40, 0x38, 0x40, 0x3f], X: [0x63, 0x14, 8, 0x14, 0x63], Y: [7, 8, 0x70, 8, 7], Z: [0x61, 0x51, 0x49, 0x45, 0x43],
  '[': [0, 0x7f, 0x41, 0x41, 0], '\\': [2, 4, 8, 0x10, 0x20], ']': [0, 0x41, 0x41, 0x7f, 0], '^': [4, 2, 1, 2, 4], _: [0x40, 0x40, 0x40, 0x40, 0x40], '|': [0, 0, 0x7f, 0, 0],
  '{': [0, 8, 0x36, 0x41, 0], '}': [0, 0x41, 0x36, 8, 0], '~': [8, 4, 8, 16, 8], '`': [0, 1, 2, 0, 0],
};
const atlases = new Map();
let mk = null;
export function setCanvasFactory(f) { mk = f; }
function atlasFor(color) {
  let a = atlases.get(color);
  if (a) return a;
  const chars = Object.keys(GLYPHS);
  const c = mk ? mk(chars.length * 6, 8) : document.createElement('canvas');
  c.width = chars.length * 6; c.height = 8;
  const g = c.getContext('2d'); g.fillStyle = color;
  chars.forEach((ch, i) => { const cols = GLYPHS[ch]; for (let x = 0; x < 5; x++) for (let y = 0; y < 7; y++) if (cols[x] & (1 << y)) g.fillRect(i * 6 + x, y, 1, 1); });
  a = { c, idx: Object.fromEntries(chars.map((ch, i) => [ch, i])) };
  atlases.set(color, a); return a;
}
export function textWidth(str, scale = 1) { return str.length * 6 * scale - scale; }

export function drawText(ctx, str, x, y, color = '#e8dcc0', scale = 1, opts = {}) {
  str = String(str).toUpperCase();
  if (opts.align === 'center') x = Math.round(x - textWidth(str, scale) / 2);
  else if (opts.align === 'right') x = Math.round(x - textWidth(str, scale));
  const shadow = opts.shadow === undefined ? '#000' : opts.shadow;
  const passes = [];
  if (shadow) passes.push([shadow, scale, scale]);
  if (opts.outline) { for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) passes.push([opts.outline, dx * scale, dy * scale]); }
  passes.push([color, 0, 0]);
  for (const [col, ox, oy] of passes) {
    const a = atlasFor(col);
    let cx = x + ox;
    for (let i = 0; i < str.length; i++) {
      const gi = a.idx[str[i]];
      if (gi !== undefined && str[i] !== ' ') ctx.drawImage(a.c, gi * 6, 0, 5, 7, cx, y + oy, 5 * scale, 7 * scale);
      cx += 6 * scale;
    }
  }
  return textWidth(str, scale);
}

export function wrapText(str, maxChars) {
  const words = String(str).split(' '); const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > maxChars) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

// filled rect with 1px border (pixel UI)
export function panel(ctx, x, y, w, h, fill = 'rgba(12,8,10,0.82)', border = '#6a5a44') {
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = border; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
}
export function bar(ctx, x, y, w, h, frac, fg, bg = '#1a0a0c', border = '#000') {
  ctx.fillStyle = border; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg; ctx.fillRect(x, y, Math.max(0, Math.round(w * Math.min(1, Math.max(0, frac)))), h);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x, y, Math.max(0, Math.round(w * Math.min(1, Math.max(0, frac)))), 1);
}
