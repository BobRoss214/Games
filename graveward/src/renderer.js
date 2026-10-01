// Software raycaster: textured walls/floors/ceilings, baked + flickering light, billboard sprites,
// ordered-dither palette quantization. Renders into a per-viewport low-res ImageData buffer.
import { clamp } from './util.js';
import { TW, TWM } from './textures.js';

export const LS = 4; // lightmap subdivisions per cell

// 4x4 Bayer matrix, quantization tables
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const QUANT = { levels: 14, dither: 1.0 };
let QTAB = null;
export function buildQuantTable(levels = QUANT.levels, dither = QUANT.dither) {
  QUANT.levels = levels; QUANT.dither = dither;
  const t = new Uint8Array(256 * 16);
  const step = 255 / (levels - 1);
  for (let c = 0; c < 256; c++) for (let b = 0; b < 16; b++) {
    const off = ((BAYER[b] + 0.5) / 16 - 0.5) * step * dither;
    const q = Math.round((c + off) / step);
    t[(c << 4) | b] = clamp(Math.round(q * step), 0, 255);
  }
  QTAB = t;
}
buildQuantTable();

export class View {
  constructor(w, h) { this.resize(w, h); }
  resize(w, h) {
    this.w = w; this.h = h;
    this.img = typeof ImageData !== 'undefined' ? new ImageData(w, h) : { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    this.buf = new Uint32Array(this.img.data.buffer);
    this.zbuf = new Float32Array(w);
    this.doorZ = new Float32Array(w);
    this.doorBot = new Int16Array(w);
    this.wTop = new Int16Array(w);
    this.wBot = new Int16Array(w);
    this.vigX = new Uint16Array(w);
    this.vigY = new Uint16Array(h);
    this.rebuildVig(1);
    this.spriteList = [];
  }
  // corner darkening; k > 1 makes the edges of the screen fall off harder (used by the Darkness setting)
  rebuildVig(k) {
    this.vigK = k; const w = this.w, h = this.h;
    for (let x = 0; x < w; x++) { const u = (x / (w - 1)) * 2 - 1; this.vigX[x] = Math.max(0, 256 * (1 - k * (0.34 * u * u * u * u + 0.18 * u * u))) | 0; }
    for (let y = 0; y < h; y++) { const u = (y / (h - 1)) * 2 - 1; this.vigY[y] = Math.max(0, 256 * (1 - k * (0.30 * u * u * u * u + 0.16 * u * u))) | 0; }
  }
}

// ---------- lightmap ----------
export function makeLightMap(w, h) { return new Float32Array(w * h * LS * LS * 3); }

// LOS test on the wall grid (sampling), returns true when segment is clear of solid cells.
function clearLine(map, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.hypot(dx, dy) * 3) + 1;
  for (let i = 1; i < n; i++) {
    const x = x0 + (dx * i) / n, y = y0 + (dy * i) / n;
    if (map.isSolidForLight(x | 0, y | 0)) return false;
  }
  return true;
}

// Build a torch kernel: sparse list of subcell indices + intensity, respecting line of sight.
export function bakeTorchKernel(map, lx, ly, radius) {
  const idx = [], val = [];
  const x0 = Math.max(0, Math.floor(lx - radius)), x1 = Math.min(map.w - 1, Math.ceil(lx + radius));
  const y0 = Math.max(0, Math.floor(ly - radius)), y1 = Math.min(map.h - 1, Math.ceil(ly + radius));
  const lw = map.w * LS;
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (map.isSolidForLight(cx, cy)) {
      // lit walls: still receive light from the open side; handled by sampling neighbors, skip
    }
    for (let sy = 0; sy < LS; sy++) for (let sx = 0; sx < LS; sx++) {
      const px = cx + (sx + 0.5) / LS, py = cy + (sy + 0.5) / LS;
      const d = Math.hypot(px - lx, py - ly);
      if (d > radius) continue;
      if (map.isSolidForLight(cx, cy)) continue;
      if (!clearLine(map, lx, ly, px, py)) continue;
      const a = 1 - d / radius;
      idx.push(((cy * LS + sy) * lw + (cx * LS + sx)) * 3);
      val.push(a * a * (1 + 0.6 / (1 + d * d)));
    }
  }
  return { idx: Int32Array.from(idx), val: Float32Array.from(val) };
}

export function applyKernel(light, kernel, r, g, b, scale) {
  const { idx, val } = kernel;
  for (let i = 0; i < idx.length; i++) {
    const k = idx[i], v = val[i] * scale;
    light[k] += r * v; light[k + 1] += g * v; light[k + 2] += b * v;
  }
}

// Cheap radial dynamic light (no LOS); records deltas for undo.
export function addDynLight(map, list, x, y, radius, r, g, b, intensity) {
  const lw = map.w * LS, light = map.light;
  const x0 = Math.max(0, Math.floor(x - radius)), x1 = Math.min(map.w - 1, Math.ceil(x + radius));
  const y0 = Math.max(0, Math.floor(y - radius)), y1 = Math.min(map.h - 1, Math.ceil(y + radius));
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (map.isSolidForLight(cx, cy)) continue;
    for (let sy = 0; sy < LS; sy++) for (let sx = 0; sx < LS; sx++) {
      const px = cx + (sx + 0.5) / LS, py = cy + (sy + 0.5) / LS;
      const d = Math.hypot(px - x, py - y);
      if (d > radius) continue;
      const a = 1 - d / radius, v = a * a * intensity;
      const k = ((cy * LS + sy) * lw + (cx * LS + sx)) * 3;
      light[k] += r * v; light[k + 1] += g * v; light[k + 2] += b * v;
      list.push(k, r * v, g * v, b * v);
    }
  }
}
export function undoDynLights(light, list) {
  for (let i = 0; i < list.length; i += 4) { const k = list[i]; light[k] -= list[i + 1]; light[k + 1] -= list[i + 2]; light[k + 2] -= list[i + 3]; }
  list.length = 0;
}

// ---------- shading tables ----------
const SHADE_STEPS = 1024;
const shadeTab = new Float32Array(SHADE_STEPS);
function buildShadeTab(radius) { for (let i = 0; i < SHADE_STEPS; i++) { const d = (i / SHADE_STEPS) * 40; const t = d / radius; shadeTab[i] = 1 / (1 + t * t * 1.3); } }
buildShadeTab(3.2);

// contrast curve: deepens shadows so light pools feel real
const GAM = new Float32Array(2048);
// Darkness (0 = the original look, 1 = default, 1.5 = very dark): one number scales ambient light, the contrast curve,
// fog, lantern power and the corner vignette together, so the dark stays moody but torches still pop.
let DARK = 0, AMB_MUL = 1, VL_MUL = 1, FOG_MUL = 1, FOGCOL_MUL = 1, VIG_K = 1;
export function setDarkness(d) {
  d = Math.max(0, Math.min(1.6, +d || 0)); if (d === DARK && GAM[1024] > 0) return; DARK = d;
  AMB_MUL = Math.pow(0.62, d); VL_MUL = 1 - 0.12 * d; FOG_MUL = 1 + 0.5 * d; FOGCOL_MUL = Math.pow(0.7, d); VIG_K = 1 + 0.55 * d;
  const e = 1.22 + 0.38 * d; for (let i = 0; i < 2048; i++) GAM[i] = Math.pow(i / 512, e);
}
export function darkness() { return DARK; }
setDarkness(1);
const gam = (v) => { const i = (v * 512) | 0; return i >= 2047 ? GAM[2047] : i < 0 ? 0 : GAM[i]; };
// vertical ambient occlusion along a wall texture (darker at the floor/ceiling joins)
const AOV = new Uint16Array(64);
for (let i = 0; i < 64; i++) { const k = Math.sin(((i + 0.5) / 64) * Math.PI); AOV[i] = (256 * (0.62 + 0.38 * Math.pow(k, 0.55))) | 0; }
const tmpSprites = [];

// ---------- main entry ----------
// cam: {x,y,angle,z,pitch,vfov,lightR,lightG,lightB,lightRadius,lightPower,ghost,flashR,flashG,flashB}
export function renderView(view, scene, cam, time) {
  const { map, textures } = scene;
  const W = view.w, H = view.h, buf = view.buf, zbuf = view.zbuf;
  const theme = map.theme;
  const dirX = Math.cos(cam.angle), dirY = Math.sin(cam.angle);
  const aspect = W / H;
  const tanHalfV = Math.tan(cam.vfov / 2);
  const projScale = H / (2 * tanHalfV);
  const planeLen = tanHalfV * aspect;
  const planeX = -dirY * planeLen, planeY = dirX * planeLen;
  const horizon = (H / 2 + cam.pitch) | 0;
  const camZ = cam.z;
  const posX = cam.x, posY = cam.y;
  const mw = map.w, mh = map.h, wallArr = map.wall, floorArr = map.floor, ceilArr = map.ceil, decalArr = map.decal;
  const doorIdx = map.doorIdx, doors = map.doors;
  const light = map.light, lw = mw * LS;
  const ghostBoost = 1 - 0.3 * Math.min(DARK, 1); // ghosts keep most of their spectral sight in the dark
  const amb = cam.ghost ? [theme.ambient[0] * AMB_MUL + 0.14 * ghostBoost, theme.ambient[1] * AMB_MUL + 0.2 * ghostBoost, theme.ambient[2] * AMB_MUL + 0.34 * ghostBoost] : [theme.ambient[0] * AMB_MUL, theme.ambient[1] * AMB_MUL, theme.ambient[2] * AMB_MUL];
  const ambR = amb[0], ambG = amb[1], ambB = amb[2];
  const fogR = theme.fog[0] * FOGCOL_MUL, fogG = theme.fog[1] * FOGCOL_MUL, fogB = theme.fog[2] * FOGCOL_MUL, fogD = theme.fogDensity * FOG_MUL;
  const vlR = cam.lightR * cam.lightPower * VL_MUL, vlG = cam.lightG * cam.lightPower * VL_MUL, vlB = cam.lightB * cam.lightPower * VL_MUL;
  const vlRadius = cam.lightRadius * (1 - 0.08 * DARK);
  if (view.vigK !== VIG_K) view.rebuildVig(VIG_K);
  const dyn = cam.dynamicGlow || 0;
  const Q = QTAB;
  const vigX = view.vigX, vigY = view.vigY;
  const wTop = view.wTop, wBot = view.wBot, doorZ = view.doorZ, doorBot = view.doorBot;
  const time8 = (time * 8) | 0;
  if (!map.aoBits) map.computeAO();
  if (!map.grime) map.computeGrime();
  const aoBits = map.aoBits;

  buildShadeTabIfNeeded(vlRadius);

  // clear to black
  buf.fill(0xff000000);

  // ---------- walls ----------
  for (let x = 0; x < W; x++) {
    const camX = (2 * x) / W - 1;
    const rdx = dirX + planeX * camX, rdy = dirY + planeY * camX;
    let mapX = posX | 0, mapY = posY | 0;
    const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx), ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
    let stepX, stepY, sdx, sdy;
    if (rdx < 0) { stepX = -1; sdx = (posX - mapX) * ddx; } else { stepX = 1; sdx = (mapX + 1 - posX) * ddx; }
    if (rdy < 0) { stepY = -1; sdy = (posY - mapY) * ddy; } else { stepY = 1; sdy = (mapY + 1 - posY) * ddy; }
    let side = 0, hit = 0, steps = 0;
    let dHit = 0, dSide = 0, dOpen = 0, dDist = 0, dWX = 0, dTex = 0, dSX = 0, dSY = 0, doorHit = 0, hitCell = -1;
    while (steps++ < 72) {
      if (sdx < sdy) { sdx += ddx; mapX += stepX; side = 0; } else { sdy += ddy; mapY += stepY; side = 1; }
      if (mapX < 0 || mapY < 0 || mapX >= mw || mapY >= mh) { hit = 0; break; }
      const mi = mapY * mw + mapX;
      const wv = wallArr[mi];
      if (wv !== 0) {
        const di = doorIdx[mi];
        if (di >= 0) {
          const op = doors[di].open;
          if (op >= 0.97) continue;
          if (op > 0.03) {
            if (!doorHit) {
              doorHit = 1; dOpen = op; dSide = side; dTex = wv;
              dDist = side === 0 ? sdx - ddx : sdy - ddy;
              dSX = mapX; dSY = mapY;
              const wxx = side === 0 ? posY + dDist * rdy : posX + dDist * rdx;
              dWX = wxx - Math.floor(wxx);
            }
            continue;
          }
        }
        hit = wv; hitCell = mi; break;
      }
    }
    let perp = 0;
    if (hit) {
      perp = side === 0 ? sdx - ddx : sdy - ddy;
      if (perp < 0.0005) perp = 0.0005;
    } else perp = 60;
    zbuf[x] = perp;
    let lineH = projScale / perp;
    let top = (horizon - (1 - camZ) * lineH) | 0;
    let bot = (horizon + camZ * lineH) | 0;
    wTop[x] = top < 0 ? 0 : top; wBot[x] = bot > H ? H : bot;
    doorZ[x] = 1e9; doorBot[x] = 0;
    if (hit) {
      let wx = side === 0 ? posY + perp * rdy : posX + perp * rdx;
      wx -= Math.floor(wx);
      const tex = textures[hit];
      let tx = (wx * TW) | 0;
      if (side === 0 && rdx > 0) tx = TWM - tx;
      if (side === 1 && rdy < 0) tx = TWM - tx;
      const tdata = tex.data;
      // light sample in front of face
      const hx = posX + perp * rdx - (side === 0 ? stepX * 0.03 : 0), hy = posY + perp * rdy - (side === 1 ? stepY * 0.03 : 0);
      let lsx = (hx * LS) | 0, lsy = (hy * LS) | 0;
      if (lsx < 0) lsx = 0; else if (lsx >= lw) lsx = lw - 1;
      if (lsy < 0) lsy = 0; else if (lsy >= mh * LS) lsy = mh * LS - 1;
      const lk = (lsy * lw + lsx) * 3;
      const vs = shadeAt(perp);
      const sideDim = side === 1 ? 0.86 : 1.0;
      const fog = Math.min(0.75, 1 - Math.exp(-perp * fogD));
      const baseR = (ambR + light[lk] + vlR * vs) * sideDim, baseG = (ambG + light[lk + 1] + vlG * vs) * sideDim, baseB = (ambB + light[lk + 2] + vlB * vs) * sideDim;
      const glow = wallGlow(map, hit);
      const lr = (gam(baseR + glow) * (1 - fog) * 256) | 0, lg = (gam(baseG + glow * 0.6) * (1 - fog) * 256) | 0, lb = (gam(baseB + glow * 0.5) * (1 - fog) * 256) | 0;
      const fr = (fogR * fog * 255) | 0, fgc = (fogG * fog * 255) | 0, fb = (fogB * fog * 255) | 0;
      const vx = vigX[x];
      const wallGrimeMask = map.grime.get(hitCell * 4 + (side === 0 ? (stepX > 0 ? 0 : 1) : (stepY > 0 ? 2 : 3)));
      const wallBloodMask = map.wallBlood ? map.wallBlood.get(hitCell * 4 + (side === 0 ? (stepX > 0 ? 0 : 1) : (stepY > 0 ? 2 : 3))) : null;
      const y0 = top < 0 ? 0 : top, y1 = bot > H ? H : bot;
      const invLine = TW / (bot - top || 1);
      let ty = (y0 - top) * invLine;
      for (let y = y0; y < y1; y++) {
        const c = tdata[(ty | 0) * TW + tx];
        let r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
        if (wallGrimeMask) {
          const gm = wallGrimeMask[(((ty | 0) >> 2) << 5) + (tx >> 2)];
          if (gm) { if (gm < 128) { const k = 1 - gm * 0.0042; r *= k; g *= k; b *= k * 1.02; } else { const a = (gm - 128) * 0.0063; r += (34 - r) * a; g += (62 - g) * a; b += (24 - b) * a; } }
        }
        if (wallBloodMask) {
          const m = wallBloodMask[(((ty | 0) >> 2) << 5) + (tx >> 2)];
          if (m > 22) { const th = m > 200 ? 1 : m / 200, a = th * th * (3 - 2 * th) * 0.93, lm = 0.55 + 0.9 * ((r + g + b) / 765), rim = m < 80 ? 0.55 : 1; r = r + (118 * lm * rim - r) * a; g = g + (9 * lm * rim - g) * a; b = b + (14 * lm * rim - b) * a; }
        }
        const tq = ty | 0; const vg = (((vx * vigY[y]) >> 8) * AOV[tq >= TW ? 63 : tq >> 1]) >> 8;
        // ambient occlusion: darker toward ceiling & floor joins
        let R = ((r * lr) >> 8) + fr, G = ((g * lg) >> 8) + fgc, B = ((b * lb) >> 8) + fb;
        R = (R * vg) >> 8; G = (G * vg) >> 8; B = (B * vg) >> 8;
        if (R > 255) R = 255; if (G > 255) G = 255; if (B > 255) B = 255;
        const bi = ((x & 3) | ((y & 3) << 2));
        buf[y * W + x] = 0xff000000 | (Q[(B << 4) | bi] << 16) | (Q[(G << 4) | bi] << 8) | Q[(R << 4) | bi];
        ty += invLine;
      }
    }
    if (doorHit) {
      // draw the partially-open door strip on top of what is behind it
      const dl = projScale / Math.max(dDist, 0.001);
      const dtop = (horizon - (1 - camZ) * dl) | 0;
      const dbotFull = (horizon + camZ * dl) | 0;
      const dbot = (dbotFull - dOpen * (dbotFull - dtop)) | 0;
      const tex = textures[dTex];
      let tx = (dWX * TW) | 0;
      const tdata = tex.data;
      const hx = posX + dDist * rdx, hy = posY + dDist * rdy;
      let lsx = ((hx - (dSide === 0 ? stepX * 0.03 : 0)) * LS) | 0, lsy = ((hy - (dSide === 1 ? stepY * 0.03 : 0)) * LS) | 0;
      lsx = clamp(lsx, 0, lw - 1); lsy = clamp(lsy, 0, mh * LS - 1);
      const lk = (lsy * lw + lsx) * 3;
      const vs = shadeAt(dDist), fog = Math.min(0.75, 1 - Math.exp(-dDist * fogD));
      const lr = (gam(ambR + light[lk] + vlR * vs) * (1 - fog) * 256) | 0, lg = (gam(ambG + light[lk + 1] + vlG * vs) * (1 - fog) * 256) | 0, lb = (gam(ambB + light[lk + 2] + vlB * vs) * (1 - fog) * 256) | 0;
      const y0 = Math.max(0, dtop), y1 = Math.min(H, dbot);
      const invLine = TW / (dbotFull - dtop || 1);
      let ty = (y0 - dtop) * invLine;
      for (let y = y0; y < y1; y++) {
        const c = tdata[(Math.min(TWM, ty | 0)) * TW + tx];
        const bi = ((x & 3) | ((y & 3) << 2));
        let R = ((c & 255) * lr) >> 8, G = (((c >> 8) & 255) * lg) >> 8, B = (((c >> 16) & 255) * lb) >> 8;
        if (R > 255) R = 255; if (G > 255) G = 255; if (B > 255) B = 255;
        buf[y * W + x] = 0xff000000 | (Q[(B << 4) | bi] << 16) | (Q[(G << 4) | bi] << 8) | Q[(R << 4) | bi];
        ty += invLine;
      }
      doorZ[x] = dDist; doorBot[x] = dbot;
      if (!hit) { wTop[x] = Math.max(0, dtop); }
    }
  }

  // ---------- floor & ceiling (row casting, only where walls do not cover) ----------
  const stepXf = (2 * planeX) / W, stepYf = (2 * planeY) / W;
  const waterId = 33;
  for (let y = 0; y < H; y++) {
    const isFloor = y > horizon;
    const pdist = isFloor ? y - horizon : horizon - y;
    if (pdist === 0) continue;
    const rowDist = ((isFloor ? camZ : 1 - camZ) * projScale) / pdist;
    if (rowDist > 60) continue;
    let fx = posX + rowDist * (dirX - planeX), fy = posY + rowDist * (dirY - planeY);
    const dx = rowDist * stepXf, dy = rowDist * stepYf;
    const vs = shadeAt(rowDist * (isFloor ? 1 : 1.15));
    const fog = Math.min(0.75, 1 - Math.exp(-rowDist * fogD));
    const vyv = vigY[y];
    const fr = (fogR * fog * 255) | 0, fgc = (fogG * fog * 255) | 0, fb = (fogB * fog * 255) | 0;
    const inv = (1 - fog) * 256;
    const vlrr = vlR * vs, vlgg = vlG * vs, vlbb = vlB * vs;
    const rowOff = y * W;
    const by = y & 3;
    for (let x = 0; x < W; x++, fx += dx, fy += dy) {
      if (isFloor ? y < wBot[x] : y >= wTop[x]) continue;
      const cx = fx | 0, cy = fy | 0;
      if (fx < 0 || fy < 0 || cx >= mw || cy >= mh) continue;
      const ci = cy * mw + cx;
      const tid = isFloor ? floorArr[ci] : ceilArr[ci];
      if (tid === 0) continue;
      const tex = textures[tid];
      let u = ((fx - cx) * TW) | 0, v = ((fy - cy) * TW) | 0;
      if (tid === waterId && isFloor) { u = (u + ((Math.sin(fy * 5 + time * 2.2) * 5) | 0)) & TWM; v = (v + ((Math.cos(fx * 5 + time * 1.7) * 5) | 0)) & TWM; }
      let c = tex.data[v * TW + u];
      let r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
      let emissive = 0;
      if (isFloor) {
        const dc = decalArr[ci];
        if (dc) {
          const dt = textures[dc].data[v * TW + u];
          if (dt !== 0) {
            const pulse = 0.65 + 0.35 * Math.sin(time * 3 + ci);
            r = dt & 255; g = (dt >> 8) & 255; b = (dt >> 16) & 255;
            emissive = (dc === 70 || dc === 72 ? 0.9 * pulse : dc >= 75 ? 0.5 : 0.1) * (cam.ghost && dc === 70 ? 1.6 : 1);
          }
        }
        const si = map.floorStainIdx[ci];
        if (si) { const sm = map.floorStains[si][((v >> 2) << 5) + (u >> 2)]; if (sm) { const k = 1 - sm * 0.0058; r *= k; g *= k; b *= k * 1.03; } }
        const bi2 = map.bloodIdx[ci];
        if (bi2) {
          const m = map.bloodMasks[bi2][((v >> 2) << 5) + (u >> 2)];
          if (m > 22) { const th = m > 200 ? 1 : m / 200, a = th * th * (3 - 2 * th) * 0.94, lm = 0.55 + 0.9 * ((r + g + b) / 765), rim = m < 80 ? 0.55 : m > 235 ? 1.25 : 1; r = r + (112 * lm * rim - r) * a; g = g + (8 * lm * rim - g) * a; b = b + (13 * lm * rim - b) * a; }
        }
      }
      let lsx = (fx * LS) | 0, lsy = (fy * LS) | 0;
      const lk = (lsy * lw + lsx) * 3;
      const ceilK = isFloor ? 1 : 0.55;
      let lr = (gam(ambR + (light[lk] + vlrr) * ceilK + emissive) * inv) | 0;
      let lg = (gam(ambG + (light[lk + 1] + vlgg) * ceilK + emissive * 0.4) * inv) | 0;
      let lb = (gam(ambB + (light[lk + 2] + vlbb) * ceilK + emissive * 0.3) * inv) | 0;
      let vg = (vigX[x] * vyv) >> 8;
      const bits = aoBits[ci];
      if (bits) {
        const fu = fx - cx, fv = fy - cy; let a = 1;
        if ((bits & 1) && fu < 0.4) a *= 0.5 + 1.25 * fu; if ((bits & 2) && fu > 0.6) a *= 0.5 + 1.25 * (1 - fu);
        if ((bits & 4) && fv < 0.4) a *= 0.5 + 1.25 * fv; if ((bits & 8) && fv > 0.6) a *= 0.5 + 1.25 * (1 - fv);
        vg = (vg * a) | 0;
      }
      let R = (((r * lr) >> 8) + fr), G = (((g * lg) >> 8) + fgc), B = (((b * lb) >> 8) + fb);
      R = (R * vg) >> 8; G = (G * vg) >> 8; B = (B * vg) >> 8;
      if (R > 255) R = 255; if (G > 255) G = 255; if (B > 255) B = 255;
      const bi = ((x & 3) | (by << 2));
      buf[rowOff + x] = 0xff000000 | (Q[(B << 4) | bi] << 16) | (Q[(G << 4) | bi] << 8) | Q[(R << 4) | bi];
    }
  }

  // ---------- sprites ----------
  const list = scene.sprites;
  const invDet = 1 / (planeX * dirY - dirX * planeY);
  const vis = tmpSprites; vis.length = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.hidden) continue;
    const sx = s.x - posX, sy = s.y - posY;
    const tX = invDet * (dirY * sx - dirX * sy);
    const tY = invDet * (-planeY * sx + planeX * sy);
    if (tY < 0.08 || tY > 40) continue;
    s._tx = tX; s._ty = tY;
    vis.push(s);
  }
  vis.sort((a, b) => b._ty - a._ty);
  for (let i = 0; i < vis.length; i++) drawSprite(view, vis[i], scene, cam, projScale, horizon, camZ, light, lw, ambR, ambG, ambB, vlR, vlG, vlB, fogR, fogG, fogB, fogD, time);
  if (BLOOM) bloomPass(view);
}

// ---- bloom: bright pixels (torches, fire, magic) bleed a soft glow into the dark. Works on a 1/4-size copy, so it costs little. ----
let BLOOM = true;
export function setBloom(on) { BLOOM = !!on; }
let bloomLow = null, bloomTmp = null, bloomW = 0, bloomH = 0;
function bloomPass(view) {
  const W = view.w, H = view.h, w = W >> 2, h = H >> 2, buf = view.buf;
  if (!bloomLow || bloomW !== w || bloomH !== h) { bloomW = w; bloomH = h; bloomLow = new Float32Array(w * h * 3); bloomTmp = new Float32Array(w * h * 3); }
  const lo = bloomLow, tmp = bloomTmp; let any = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0; const o = (y * 4 + 1) * W + x * 4 + 1;
    for (let k = 0; k < 4; k++) { const c = buf[o + (k >> 1) * 2 * W + (k & 1) * 2]; r += c & 255; g += (c >> 8) & 255; b += (c >> 16) & 255; }
    r = r * 0.25 - 110; g = g * 0.25 - 110; b = b * 0.25 - 110; const i = (y * w + x) * 3;
    lo[i] = r > 0 ? r : 0; lo[i + 1] = g > 0 ? g : 0; lo[i + 2] = b > 0 ? b : 0; any += lo[i] + lo[i + 1] + lo[i + 2];
  }
  if (any < 40) return;
  for (let pass = 0; pass < 2; pass++) { // separable 5-tap blur, twice
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let k = -2; k <= 2; k++) { const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k; s += lo[(y * w + xx) * 3 + c]; } tmp[(y * w + x) * 3 + c] = s * 0.2; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let k = -2; k <= 2; k++) { const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k; s += tmp[(yy * w + x) * 3 + c]; } lo[(y * w + x) * 3 + c] = s * 0.2; }
  }
  const gain = 2.0 + 0.6 * DARK;
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) / 4 - 0.5, y0 = fy < 0 ? 0 : fy >= h - 1 ? h - 2 : Math.floor(fy), ty = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / 4 - 0.5, x0 = fx < 0 ? 0 : fx >= w - 1 ? w - 2 : Math.floor(fx), tx = Math.min(1, Math.max(0, fx - x0));
      const i00 = (y0 * w + x0) * 3, i10 = i00 + 3, i01 = i00 + w * 3, i11 = i01 + 3;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const ar = (lo[i00] * w00 + lo[i10] * w10 + lo[i01] * w01 + lo[i11] * w11) * gain;
      if (ar < 0.5 && lo[i00 + 1] + lo[i11 + 1] + lo[i00 + 2] < 1) continue;
      const ag = (lo[i00 + 1] * w00 + lo[i10 + 1] * w10 + lo[i01 + 1] * w01 + lo[i11 + 1] * w11) * gain, ab = (lo[i00 + 2] * w00 + lo[i10 + 2] * w10 + lo[i01 + 2] * w01 + lo[i11 + 2] * w11) * gain;
      const c = buf[y * W + x]; let r = (c & 255) + ar, g = ((c >> 8) & 255) + ag, b = ((c >> 16) & 255) + ab;
      buf[y * W + x] = 0xff000000 | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
    }
  }
}

let shadeRadius = 3.2;
function buildShadeTabIfNeeded(r) { if (r !== shadeRadius) { shadeRadius = r; buildShadeTab(r); } }
function shadeAt(d) { const i = (d * (SHADE_STEPS / 40)) | 0; return shadeTab[i >= SHADE_STEPS ? SHADE_STEPS - 1 : i]; }
function wallGlow(map, tid) { return tid === 12 ? 0.35 : tid === 16 ? 0.18 : 0; } // sealed doors & portal runes glow

function drawSprite(view, s, scene, cam, projScale, horizon, camZ, light, lw, ambR, ambG, ambB, vlR, vlG, vlB, fogR, fogG, fogB, fogD, time) {
  const W = view.w, H = view.h, buf = view.buf, zbuf = view.zbuf, doorZ = view.doorZ, doorBot = view.doorBot;
  const ty = s._ty, tx = s._tx;
  let sh = projScale * s.h / ty, sw = projScale * s.w / ty;
  if (!s.frame && s.w <= 0.3 && s.h <= 0.3) { const cap = W * 0.018; if (sw > cap) sw = cap; if (sh > cap) sh = cap; }
  const cxs = (W / 2) * (1 + tx / ty);
  const bottom = horizon + (camZ - s.z) * projScale / ty;
  const top = bottom - sh;
  const left = cxs - sw / 2;
  let x0 = Math.max(0, Math.floor(left)), x1 = Math.min(W - 1, Math.ceil(left + sw) - 1);
  let y0 = Math.max(0, Math.floor(top)), y1 = Math.min(H - 1, Math.ceil(bottom) - 1);
  if (x0 > x1 || y0 > y1) return;
  const Q = QTAB;
  // lighting for this sprite
  let lsx = clamp((s.x * LS) | 0, 0, lw - 1), lsy = clamp((s.y * LS) | 0, 0, scene.map.h * LS - 1);
  const lk = (lsy * lw + lsx) * 3;
  const vs = shadeAt(ty);
  const fog = Math.min(0.75, 1 - Math.exp(-ty * fogD));
  const em = s.emit || 0;
  const inv = (1 - fog) * 256;
  const tint = s.tint;
  let lr = (gam(ambR + light[lk] * 0.9 + vlR * vs + em) * inv) | 0, lg = (gam(ambG + light[lk + 1] * 0.9 + vlG * vs + em) * inv) | 0, lb = (gam(ambB + light[lk + 2] * 0.9 + vlB * vs + em) * inv) | 0;
  if (s.fullbright) { lr = lg = lb = 256; }
  const fr = (fogR * fog * 255) | 0, fgc = (fogG * fog * 255) | 0, fb = (fogB * fog * 255) | 0;
  const alpha = s.alpha === undefined ? 1 : s.alpha;
  const add = s.add;
  if (!s.frame) { // solid particle / quad
    if (ty < 0.45) return; // near-clip: particles brushing the lens would fill the screen
    const col = s.color;
    let cr = col & 255, cg = (col >> 8) & 255, cb = (col >>> 16) & 255;
    if (!s.fullbright) { cr = (cr * lr) >> 8; cg = (cg * lg) >> 8; cb = (cb * lb) >> 8; if (cr > 255) cr = 255; if (cg > 255) cg = 255; if (cb > 255) cb = 255; }
    const aa = (alpha * 256) | 0;
    for (let x = x0; x <= x1; x++) {
      if (ty >= zbuf[x] || (ty > doorZ[x])) continue;
      for (let y = y0; y <= y1; y++) {
        if (ty > doorZ[x] && y < doorBot[x]) continue;
        const i = y * W + x, d = buf[i];
        let R = d & 255, G = (d >> 8) & 255, B = (d >> 16) & 255;
        if (add) { R = Math.min(255, R + ((cr * aa) >> 8)); G = Math.min(255, G + ((cg * aa) >> 8)); B = Math.min(255, B + ((cb * aa) >> 8)); }
        else { R += ((cr - R) * aa) >> 8; G += ((cg - G) * aa) >> 8; B += ((cb - B) * aa) >> 8; }
        buf[i] = 0xff000000 | (B << 16) | (G << 8) | R;
      }
    }
    return;
  }
  const fw = s.frame.w, fh = s.frame.h, fdata = s.frame.data;
  const flip = s.flip;
  const aa = (alpha * 256) | 0;
  const tr = tint ? (tint & 255) : 0, tg = tint ? (tint >> 8) & 255 : 0, tb = tint ? (tint >>> 16) & 255 : 0, ta = s.tintAmt || 0;
  const invW = fw / sw, invH = fh / sh;
  for (let x = x0; x <= x1; x++) {
    if (ty >= zbuf[x] && !s.ignoreDepth) continue;
    const dz = doorZ[x];
    let u = ((x + 0.5 - left) * invW) | 0;
    if (u < 0) u = 0; else if (u >= fw) u = fw - 1;
    if (flip) u = fw - 1 - u;
    for (let y = y0; y <= y1; y++) {
      let v = ((y + 0.5 - top) * invH) | 0;
      if (v < 0) v = 0; else if (v >= fh) v = fh - 1;
      const c = fdata[v * fw + u];
      const ca = c >>> 24;
      if (ca === 0) continue;
      if (ca < 250 && ((BAYER[(x & 3) | ((y & 3) << 2)] + 0.5) * 16 > ca)) continue; // partial alpha = ordered-dither coverage (soft shadows that stay pixelated)
      if (ty > dz && y < doorBot[x]) continue;
      let r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
      let R, G, B;
      if (ca === 254 || s.fullbright) { R = r; G = g; B = b; }
      else { R = ((r * lr) >> 8) + fr; G = ((g * lg) >> 8) + fgc; B = ((b * lb) >> 8) + fb; }
      if (ta) { R += ((tr - R) * ta) | 0; G += ((tg - G) * ta) | 0; B += ((tb - B) * ta) | 0; }
      if (R > 255) R = 255; if (G > 255) G = 255; if (B > 255) B = 255;
      if (R < 0) R = 0; if (G < 0) G = 0; if (B < 0) B = 0;
      const bi = ((x & 3) | ((y & 3) << 2));
      R = Q[(R << 4) | bi]; G = Q[(G << 4) | bi]; B = Q[(B << 4) | bi];
      const i = y * W + x;
      if (add) {
        const d = buf[i];
        R = Math.min(255, (d & 255) + ((R * aa) >> 8)); G = Math.min(255, ((d >> 8) & 255) + ((G * aa) >> 8)); B = Math.min(255, ((d >> 16) & 255) + ((B * aa) >> 8));
      } else if (aa < 256) {
        const d = buf[i];
        R = (d & 255) + (((R - (d & 255)) * aa) >> 8); G = ((d >> 8) & 255) + (((G - ((d >> 8) & 255)) * aa) >> 8); B = ((d >> 16) & 255) + (((B - ((d >> 16) & 255)) * aa) >> 8);
      }
      buf[i] = 0xff000000 | (B << 16) | (G << 8) | R;
    }
  }
}

// Screen-space projection helper (for HUD markers): returns {x,y,depth} or null when behind camera.
export function projectPoint(view, cam, px, py, pz) {
  const H = view.h, W = view.w;
  const dirX = Math.cos(cam.angle), dirY = Math.sin(cam.angle);
  const tanHalfV = Math.tan(cam.vfov / 2), projScale = H / (2 * tanHalfV), planeLen = tanHalfV * (W / H);
  const planeX = -dirY * planeLen, planeY = dirX * planeLen;
  const invDet = 1 / (planeX * dirY - dirX * planeY);
  const sx = px - cam.x, sy = py - cam.y;
  const tX = invDet * (dirY * sx - dirX * sy), tY = invDet * (-planeY * sx + planeX * sy);
  if (tY < 0.05) return null;
  return { x: (W / 2) * (1 + tX / tY), y: H / 2 + cam.pitch + (cam.z - pz) * projScale / tY, depth: tY };
}
