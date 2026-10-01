// Turns world state into cameras and sprite lists for the raycaster; also drives torch flicker + dynamic lights.
import * as S from './sprites.js';
import { PROPS, TRAPS, MONSTERS } from './data.js';
import { PROJ } from './combat.js';
import { rgb, clamp, dist2 } from './util.js';
import { applyKernel, addDynLight, undoDynLights } from './renderer.js';

const RGB_RED = rgb(255, 60, 40), RGB_ORANGE = rgb(255, 150, 40), RGB_BLUE = rgb(80, 150, 255), RGB_GREEN = rgb(90, 220, 70), RGB_WHITE = rgb(255, 255, 255), RGB_PURPLE = rgb(190, 90, 255), RGB_CYAN = rgb(90, 230, 255);
const dynUndo = [];
let lastMapForDyn = null;

const FLOOR_SHADOW = 0.08;
export function makeCamera(match, player, t, fxv, opts = {}) {
  const b = player.body;
  const w = match.world;
  const cam = { x: 0, y: 0, angle: 0, z: 0.5, pitch: 0, vfov: opts.vfov || 0.95, lightR: 1, lightG: 0.82, lightB: 0.55, lightRadius: 3.2, lightPower: 0.34, ghost: false };
  if (!b) { const c = player.lastCam; if (c) return Object.assign(cam, c); return cam; }
  cam.x = b.x; cam.y = b.y; cam.angle = b.angle;
  switch (b.type) {
    case 'hero': {
      const bob = b.moving ? Math.sin(b.walkT * 5.2) * 0.022 : Math.sin(t * 1.5) * 0.004;
      cam.z = 0.5 + bob - (b.dodgeT > 0 ? 0.18 : 0) + (fxv && fxv.hurt > 0.3 ? -0.03 : 0);
      cam.lightRadius = (b.lightRadius || 3.2) * 1.1; cam.lightPower = 0.46 + (b.lightRadius > 4 ? 0.1 : 0);
      { // lantern breathes, flickers, stutters when ghosts are near and throbs when hurt
        let flick = 1 + 0.03 * Math.sin(t * 1.7) + 0.035 * Math.sin(t * 13.1) * Math.sin(t * 3.3);
        let gd = 99; if (w) for (const g of w.actors) if (g.type === 'ghost' && !g.removed) { const d = Math.hypot(g.x - b.x, g.y - b.y); if (d < gd) gd = d; }
        if (gd < 4.2) { const ch = Math.pow(1 - gd / 4.2, 1.6); flick *= 1 - ch * (0.15 + 0.4 * Math.max(0, Math.sin(t * 37))) - (ch > 0.6 && Math.sin(t * 5.1) > 0.93 ? 0.35 : 0); cam.haunt = ch; }
        if (b.hp < b.maxHp * 0.3) flick *= 1 + 0.12 * Math.sin(t * 8) ;
        cam.lightPower *= Math.max(0.3, flick);
        cam.lightG *= 1 - 0.1 * (cam.haunt || 0);
      }
      if (b.st && b.st.stun > 0) cam.angle += Math.sin(t * 40) * 0.01;
      if (b.startle > 0) cam.z += Math.sin(t * 60) * 0.01;
      break;
    }
    case 'ghost':
      cam.z = 0.52 + Math.sin(b.hoverT * 2) * 0.04; cam.ghost = true; cam.lightR = 0.6; cam.lightG = 0.72; cam.lightB = 1.0; cam.lightRadius = 5.5; cam.lightPower = 0.55; break;
    case 'trapctl':
      cam.z = b.z; cam.ghost = true; cam.lightR = 0.7; cam.lightG = 0.75; cam.lightB = 1.0; cam.lightRadius = 5; cam.lightPower = 0.5; break;
    case 'monster': case 'bosspart':
      cam.z = clamp(b.eyeZ || 0.5, 0.35, 0.85) + (b.moving ? Math.sin(b.walkT * 5) * 0.015 : 0); cam.lightR = 1; cam.lightG = 0.7; cam.lightB = 0.55; cam.lightRadius = 3.8; cam.lightPower = 0.42;
      if (b.type === 'bosspart') { cam.z = 0.75; cam.lightPower = 0.55; cam.lightRadius = 6; }
      if (b.dead) cam.z = Math.max(0.12, 0.5 - b.deadT * 0.6);
      break;
    default: break;
  }
  if (b.type === 'hero' && b.dead) cam.z = Math.max(0.1, 0.5 - b.deadT * 0.7);
  if (fxv) {
    const s = fxv.shake;
    if (s > 0.01) { cam.angle += (Math.random() - 0.5) * s * 0.05; cam.pitch += (Math.random() - 0.5) * s * 10; cam.z += (Math.random() - 0.5) * s * 0.03; }
    if (fxv.kick > 0) cam.pitch += fxv.kick * 14;
  }
  if (b.st && b.st.blur > 0) cam.blur = b.st.blur;
  player.lastCam = { x: cam.x, y: cam.y, angle: cam.angle, z: cam.z, ghost: cam.ghost };
  return cam;
}

// ---------- torch flicker & dynamic lights ----------
export function updateLights(match, w, cams, t, fx) {
  const map = w.map;
  if (lastMapForDyn !== map) { dynUndo.length = 0; lastMapForDyn = map; }
  undoDynLights(map.light, dynUndo);
  const tors = map.torches; if (!tors) return;
  const ghosts = []; for (const g of w.actors) if (g.type === 'ghost' && !g.removed) ghosts.push(g);
  for (const tr of tors) {
    let near = false;
    for (const c of cams) if (dist2(c.x, c.y, tr.x, tr.y) < 260) { near = true; break; }
    if (!near) continue;
    const n = Math.sin(t * 9 + tr.phase) * 0.06 + Math.sin(t * 23 + tr.phase * 3) * 0.05 + Math.sin(t * 3.1 + tr.phase) * 0.04;
    let target;
    switch (tr.kind) {
      case 'curse': target = 0.7 + 0.28 * Math.sin(t * 1.7 + tr.phase) + 0.1 * Math.sin(t * 7.3) + (Math.sin(t * 2.9 + tr.phase) > 0.96 ? -0.5 : 0); break;
      case 'portal': target = 0.85 + 0.15 * Math.sin(t * 2.4 + tr.phase); break;
      case 'pent': target = tr.pent && tr.pent.prop && tr.pent.prop.usedUp ? 0 : 0.6 + 0.4 * Math.sin(t * 3 + tr.phase); break;
      case 'steady': target = 0.95 + n * 0.5; break;
      default: target = tr.out > 0 ? 0.0 : 0.84 + n + (tr.flare || 0);
    }
    if (tr.kind === 'torch' && tr.out <= 0 || !tr.kind) {
      for (const g of ghosts) { const d = Math.hypot(g.x - tr.x, g.y - tr.y); if (d < 5) { const ch = Math.pow(1 - d / 5, 1.5); target *= 1 - ch * (0.45 + 0.45 * Math.max(0, Math.sin(t * 29 + tr.phase * 7))); if (ch > 0.55 && Math.sin(t * 2.3 + tr.phase) > 0.92) target *= 0.08; } }
    }
    tr.flick = target;
    const delta = target - tr.cur;
    if (Math.abs(delta) > 0.004) { applyKernel(map.light, tr.kernel, tr.color[0], tr.color[1], tr.color[2], delta); tr.cur = target; }
  }
  // dynamic lights near cameras
  let count = 0;
  const near = (x, y) => { for (const c of cams) if (dist2(c.x, c.y, x, y) < 100) return true; return false; };
  for (const p of w.projs) {
    if (count > 10) break; if (p.dead || !p.def.glow || !near(p.x, p.y)) continue;
    const g = p.def.glow; addDynLight(map, dynUndo, p.x, p.y, 3.2, g[0], g[1], g[2], 0.85); count++;
  }
  for (const a of w.actors) {
    if (count > 12) break;
    if (a.dead || !near(a.x, a.y)) continue;
    if (a.st && a.st.burn) { addDynLight(map, dynUndo, a.x, a.y, 2.4, 1, 0.5, 0.15, 0.6); count++; }
    else if (a.type === 'monster' && a.def && (a.def.sprite === 'golem' || a.defId === 'priest')) { addDynLight(map, dynUndo, a.x, a.y, 2.6, 0.3, 0.7, 0.9, 0.4); count++; }
    else if (a.type === 'hero' && a.atk && a.atk.phase === 1) { addDynLight(map, dynUndo, a.x, a.y, 2.2, 1, 0.9, 0.7, 0.35); count++; }
  }
  for (const b of fx.beams) { if (count > 14) break; const mx = b.x + Math.cos(b.angle) * b.len * 0.5, my = b.y + Math.sin(b.angle) * b.len * 0.5; if (!near(mx, my)) continue; const col = b.kind === 'fire' ? [1, 0.5, 0.1] : b.kind === 'soul' ? [0.3, 0.8, 1] : b.kind === 'lightning' ? [0.5, 0.8, 1] : [1, 0.7, 0.2]; addDynLight(map, dynUndo, mx, my, 3.5, col[0], col[1], col[2], 0.7); count++; }
  for (const p of fx.parts) { /* particles are unlit */ }
}

// ---------- sprite collection ----------
const ASPECT = (f) => f.w / f.h;

function statusTint(a, t) {
  const s = a.st; if (!s) return null;
  if (a.flash > 0) return [RGB_WHITE, Math.min(0.75, a.flash * 5)];
  if (s.burn) return [RGB_ORANGE, 0.28 + Math.sin(t * 20) * 0.1];
  if (s.poison) return [RGB_GREEN, 0.3];
  if (s.slow) return [RGB_BLUE, 0.3];
  if (s.stun > 0) return [RGB_WHITE, Math.sin(t * 30) > 0 ? 0.45 : 0];
  if (s.curse > 0) return [RGB_PURPLE, 0.28];
  if (s.ward) return [RGB_CYAN, 0.25];
  if (s.warcry) return [RGB_RED, 0.18];
  if (a.tintHollow) return [RGB_PURPLE, 0.35];
  return null;
}

export function collectSprites(match, w, viewer, t, fx, out) {
  out.length = 0;
  const vb = viewer.body;
  const vx = vb ? vb.x : 0, vy = vb ? vb.y : 0;
  const viewerIsGhostSide = viewer.role === 'ghost' || (vb && (vb.type === 'ghost' || vb.type === 'trapctl' || vb.type === 'monster' || vb.type === 'bosspart'));
  const heroSees = vb && vb.type === 'hero' && (vb.st.sight > 0 || (vb.hero && vb.hero.artifacts.includes('eye')));
  const map = w.map;
  const FAR = 34 * 34;
  // --- actors
  for (const a of w.actors) {
    if (a === vb || a.removed) continue;
    if (dist2(a.x, a.y, vx, vy) > FAR) continue;
    if (a.type === 'trapctl') continue;
    if (a.type === 'ghost') {
      const eye = vb && vb.type === 'hero' && vb.hero && vb.hero.artifacts.includes('eye') && dist2(a.x, a.y, vx, vy) < 40;
      if (!viewerIsGhostSide && !(vb && vb.st.sight > 0) && !eye) continue;
      const f = S.wispFrame(Math.floor(t * 4 + a.id) % 4);
      const h = 0.5, wd = h * ASPECT(f);
      out.push({ x: a.x, y: a.y, z: 0.25 + Math.sin(a.hoverT * 2) * 0.05, w: wd, h, frame: f, alpha: viewerIsGhostSide ? 0.55 : (heroSees ? 0.7 : 0.35 + Math.sin(t * 20) * 0.15), add: true, fullbright: true });
      continue;
    }
    if (a.type === 'hero') {
      const col = a.player ? a.player.color : '#cc4444';
      let f;
      if (a.dead) f = S.heroDeadFrame(col, a.deadT < 0.25 ? 0 : a.deadT < 0.7 ? 1 : 2);
      else if (a.atk && a.atk.phase < 2) f = S.heroFrame(col, 'atk', a.atk.phase);
      else if (a.hurtT > 0) f = S.heroFrame(col, 'hurt', 0);
      else if (a.moving) f = S.heroFrame(col, 'walk', Math.floor(a.walkT * 3) % 4);
      else f = S.heroFrame(col, 'idle', Math.floor(t * 1.6 + a.id) % 2);
      const h = a.dead && a.deadT > 0.25 ? 0.4 : 0.62;
      const tint = statusTint(a, t);
      out.push({ x: a.x, y: a.y, z: 0, w: h * ASPECT(f), h, frame: f, tint: tint ? tint[0] : 0, tintAmt: tint ? tint[1] : 0, alpha: a.invuln > 0 && !a.dead ? 0.6 + Math.sin(t * 30) * 0.3 : 1, emit: 0.1 });
      continue;
    }
    if (a.type === 'monster') {
      const def = a.def;
      let state, n = 0;
      if (a.dead) { state = 'dead'; n = a.deadT < 0.22 ? 0 : a.deadT < 0.7 ? 1 : 2; }
      else if (a.atk && a.atk.phase < 2) { state = 'atk'; n = a.atk.phase; }
      else if (a.hurtT > 0) { state = 'hurt'; }
      else if (a.moving) { state = 'walk'; n = Math.floor(a.walkT * 3) % 4; }
      else { state = 'idle'; n = Math.floor(t * 1.6 + a.id) % 2; }
      const wound = a.maxHp > 0 ? (a.hp / a.maxHp > 0.75 ? 0 : a.hp / a.maxHp > 0.5 ? 1 : a.hp / a.maxHp > 0.25 ? 2 : 3) : 0;
      const f = S.monsterFrame(def.sprite, a.tier, state, n, wound);
      let h = a.giant ? Math.min(1.05, a.h * 0.5) : a.h * 0.62;
      if (state === 'dead' && n > 0) h = h * (f.h / (S.monsterFrame(def.sprite, a.tier, 'idle', 0).h)) * 0.95;
      const tint = statusTint(a, t);
      const z = a.flies ? 0.22 + Math.sin(t * 2 + a.id) * 0.05 : 0;
      out.push({ x: a.x, y: a.y, z, w: h * ASPECT(f), h, frame: f, tint: tint ? tint[0] : 0, tintAmt: tint ? tint[1] : 0, emit: a.giant ? 0.18 : 0.08, flip: (a.id & 1) === 1 && state === 'idle' });
      if (a.atk && a.atk.phase === 0 && a.atk.ab.kind !== 'melee' && !a.dead) { /* windup telegraph: little glow */ out.push({ x: a.x, y: a.y, z: h * 0.7, w: 0.16, h: 0.16, color: a.atk.ab.kind === 'beam' ? RGB_ORANGE : RGB_RED, alpha: 0.6, add: true, fullbright: true }); }
      continue;
    }
    if (a.type === 'bosspart') {
      if (!w.boss) continue;
      let f, h, wd;
      if (a.core) {
        f = S.bossBodyFrame(w.boss.id, w.boss.exposedT > 0 || (w.boss.id === 'mother' && w.boss.armsUnwrapped()), t);
        h = 1.6; wd = h * ASPECT(f);
        out.push({ x: a.x, y: a.y, z: 0, w: wd, h, frame: f, emit: 0.25, tint: a.flash > 0 ? RGB_WHITE : 0, tintAmt: a.flash > 0 ? 0.5 : 0 });
        continue;
      }
      const atk = !!(a.atk && a.atk.phase < 2);
      f = S.bossPartFrame(a.sprite, atk, { unwrapped: a.armor !== undefined && a.armor <= 0 && a.bossPart.id.endsWith('arm') });
      h = a.sh * 0.45; wd = h * ASPECT(f);
      const lift = a.bossPart.id === 'face' || a.bossPart.id === 'mouth' ? 0.15 : 0;
      out.push({ x: a.x, y: a.y, z: lift + (a.atk && a.atk.ab.kind === 'leap' ? 0.2 : 0), w: wd, h, frame: f, flip: !!a.flipSprite, emit: 0.22, tint: a.flash > 0 ? RGB_WHITE : (a.locked ? RGB_BLUE : 0), tintAmt: a.flash > 0 ? 0.5 : (a.locked ? 0.2 : 0) });
      if (atk) out.push({ x: a.x, y: a.y, z: h * 0.5, w: 0.3, h: 0.3, color: RGB_RED, alpha: 0.5, add: true, fullbright: true });
      continue;
    }
  }
  // --- props
  for (const p of w.props) {
    if (!p.alive) continue;
    if (dist2(p.x, p.y, vx, vy) > FAR) continue;
    switch (p.kind) {
      case 'torch': {
        const on = !(p.out > 0);
        const f = on ? S.propFrame('torch', '', 0, t) : S.propFrame('torch', '', 0, 0);
        out.push({ x: p.x, y: p.y, z: 0.35, w: 0.3, h: 0.5, frame: f, emit: on ? 0.9 : 0 , tint: on ? 0 : rgb(20, 20, 30), tintAmt: on ? 0 : 0.5 });
        if (on) { const cur = p.light ? Math.max(0, p.light.cur) : 1; out.push({ x: p.x, y: p.y, z: 0.28, w: 1.1, h: 1.1, frame: S.glowFrame('#ff8a30'), add: true, fullbright: true, alpha: 0.42 * cur, ignoreDepth: false }); }
        break;
      }
      case 'sign': out.push({ x: p.x, y: p.y, z: 0.55, w: 0.42, h: 0.32, frame: S.propFrame('sign'), emit: 0.3 }); break;
      case 'scenery': {
        const def = p.def; const isPillar = p.sub === 'pillar';
        const st = p.sub === 'coffin' ? (p.openT > 0 ? 1 : 0) : 0;
        const f = S.propFrame('scenery', p.sub, st, t);
        let h = isPillar ? 1.0 : def.h * (p.sub === 'sarcophagus' ? 0.75 : 0.85);
        let z = def.z || 0;
        if (p.sub === 'chandelier') { z = p.falling > 0 ? 0.62 * (p.falling / 0.5) : 0.62; }
        out.push({ x: p.x, y: p.y, z, w: h * ASPECT(f), h, frame: f, emit: p.sub === 'brazier' ? 0.7 : 0.05, tint: p.hitT > 0 ? RGB_WHITE : 0, tintAmt: p.hitT > 0 ? 0.5 : 0 });
        if (p.sub === 'brazier') out.push({ x: p.x, y: p.y, z: 0.25, w: 1.2, h: 1.2, frame: S.glowFrame('#ff7a20'), add: true, fullbright: true, alpha: 0.4 + Math.sin(t * 11 + p.id) * 0.06 });
        if (p.hitT > 0) p.hitT -= 1 / 60;
        break;
      }
      case 'chest': {
        const f = S.propFrame('chest', p.tier ? 1 : 0, p.opened ? 1 : 0);
        out.push({ x: p.x, y: p.y, z: 0, w: 0.5, h: 0.4, frame: f, emit: p.opened ? 0.5 : 0.06 });
        if (p.trapped && !p.opened && viewerIsGhostSide) out.push({ x: p.x, y: p.y, z: 0.5, w: 0.14, h: 0.14, color: RGB_RED, alpha: 0.7, add: true, fullbright: true });
        break;
      }
      case 'crystal': out.push({ x: p.x, y: p.y, z: 0.1, w: 1.0, h: 1.0, frame: S.glowFrame('#ff2030'), add: true, fullbright: true, alpha: 0.35 + Math.sin(t * 4 + p.id) * 0.1 }); out.push({ x: p.x, y: p.y, z: 0, w: 0.45, h: 0.72, frame: S.propFrame('crystal', '', 0, t), emit: 0.7, tint: p.hitT > 0 ? RGB_WHITE : 0, tintAmt: p.hitT > 0 ? 0.6 : 0 }); if (p.hitT > 0) p.hitT -= 1 / 60; break;
      case 'statue': { const f = S.statueFrame(p.sub); const h = Math.min(1.0, MONSTERS[p.sub].h * 0.5); out.push({ x: p.x, y: p.y, z: 0, w: h * ASPECT(f), h, frame: f, emit: 0.03 }); if (viewerIsGhostSide) out.push({ x: p.x, y: p.y, z: h * 0.85, w: 0.16, h: 0.08, color: RGB_ORANGE, alpha: 0.55 + Math.sin(t * 4) * 0.3, add: true, fullbright: true }); break; }
      case 'shop': {
        if (p.sold) break;
        out.push({ x: p.x, y: p.y, z: 0, w: 0.42, h: 0.5, frame: S.propFrame('shop'), emit: 0.2 });
        const f = S.itemIcon(p.item, t);
        out.push({ x: p.x, y: p.y, z: 0.5 + Math.sin(t * 2 + p.slot) * 0.03, w: 0.26 * ASPECT(f), h: 0.26, frame: f, emit: 0.6 });
        break;
      }
      case 'portal': {
        const lvl10 = match.heroPlayer && match.heroPlayer.hero.level >= 10;
        const f = S.propFrame('portal', '', 0, t);
        out.push({ x: p.x, y: p.y, z: 0, w: 0.75, h: 0.98, frame: f, alpha: lvl10 ? 0.95 : 0.4, add: true, fullbright: true });
        out.push({ x: p.x, y: p.y, z: 0, w: 2.0, h: 2.0, frame: S.glowFrame('#2a8aff'), add: true, fullbright: true, alpha: lvl10 ? 0.5 : 0.2 });
        break;
      }
      case 'fountainHeal': out.push({ x: p.x, y: p.y, z: 0, w: 0.8, h: 0.9, frame: S.propFrame('fountainHeal', '', 0, t), emit: 0.6 }); break;
      case 'trap': {
        const td = p.tdef; const active = p.state === 'active' || p.state === 'windup';
        if (p.trap === 'spikes') { if (active) out.push({ x: p.x, y: p.y, z: 0, w: 0.9, h: 0.5, frame: S.propFrame('trap', 'spikes', 1), emit: 0.1 }); else if (viewerIsGhostSide) out.push({ x: p.x, y: p.y, z: 0.05, w: 0.14, h: 0.14, color: RGB_RED, alpha: 0.5, add: true, fullbright: true }); }
        else if (p.trap === 'flame') out.push({ x: p.x, y: p.y, z: 0.15, w: 0.3, h: 0.25, frame: S.propFrame('trap', 'flame', 0), emit: p.state === 'windup' ? 1 : 0.1 });
        else if (p.trap === 'darts') out.push({ x: p.x, y: p.y, z: 0.3, w: 0.32, h: 0.22, frame: S.propFrame('trap', 'darts', 0), emit: 0.1 });
        else if (p.trap === 'saw') { out.push({ x: p.x + p.sawPos, y: p.y, z: 0.02, w: 0.6, h: 0.6, frame: S.propFrame('trap', 'saw', p.state === 'active' && Math.floor(t * 20) % 2 ? 1 : 0), emit: 0.1 }); for (let i = 0; i <= td.track; i++) out.push({ x: p.x + i, y: p.y, z: 0.0, w: 0.9, h: 0.04, color: rgb(30, 30, 34), alpha: 0.9 }); }
        else if (p.trap === 'crusher') out.push({ x: p.x, y: p.y, z: p.state === 'windup' ? 0.5 : p.state === 'active' ? 0.02 : 0.55, w: 0.75, h: 0.85, frame: S.propFrame('trap', 'crusher', p.state === 'active' ? 1 : 0), emit: 0.1 });
        if (p.owner && viewerIsGhostSide) out.push({ x: p.x, y: p.y, z: 0.6, w: 0.18, h: 0.18, color: p.owner.color ? rgb(...hexToRgb(p.owner.color)) : RGB_PURPLE, alpha: 0.7, add: true, fullbright: true });
        break;
      }
      case 'pent': if (!p.usedUp && viewerIsGhostSide) out.push({ x: p.x, y: p.y, z: 0.15 + Math.sin(t * 3 + p.id) * 0.05, w: 0.22, h: 0.4, color: RGB_RED, alpha: 0.35, add: true, fullbright: true }); break;
      default: break;
    }
  }
  // --- pickups
  for (const p of w.pickups) {
    if (p.dead) continue;
    if (p.kind === 'ecto' && !viewerIsGhostSide) continue;
    if (dist2(p.x, p.y, vx, vy) > FAR) continue;
    const f = S.pickupFrame(p, t);
    const size = p.kind === 'item' ? 0.3 : p.kind === 'gold' ? 0.22 : p.kind === 'ecto' ? 0.3 : 0.24;
    const bob = p.z <= 0.19 ? 0.16 + Math.sin(t * 3 + p.bob) * 0.035 : p.z;
    out.push({ x: p.x, y: p.y, z: bob - 0.14, w: size * ASPECT(f), h: size, frame: f, emit: 0.5, alpha: p.kind === 'ecto' ? 0.8 : 1 });
  }
  // --- projectiles
  for (const p of w.projs) {
    if (p.dead) continue;
    if (dist2(p.x, p.y, vx, vy) > FAR) continue;
    const f = S.projFrame(p.def.sprite, t);
    const sz = p.def.size;
    if (p.gravity && !p.rest && p.z > FLOOR_SHADOW) { // ground shadow: shows where the arc will land; fades as it rises
      const sh = S.shadowFrame(), k = Math.max(0.35, 1 - p.z * 0.6);
      out.push({ x: p.x, y: p.y, z: 0.015, w: sz * 1.5 * k, h: sz * 0.5 * k, frame: sh, alpha: 0.5, emit: 0 });
    }
    out.push({ x: p.x, y: p.y, z: Math.max(0.05, p.z - sz / 2), w: sz * ASPECT(f), h: sz, frame: f, add: !!p.def.glow && p.kind !== 'boulder', fullbright: !!p.def.glow, emit: 0.4, alpha: p.rest ? 0.9 : 1 });
    if (p.def.glow) { const g = p.def.glow; out.push({ x: p.x, y: p.y, z: Math.max(0, p.z - sz), w: sz * 3, h: sz * 3, frame: S.glowFrame(rgbHex(g)), add: true, fullbright: true, alpha: 0.55 }); }
  }
  // --- corpses & gibs & hazards
  for (const c of w.corpses) {
    if (dist2(c.x, c.y, vx, vy) > FAR) continue;
    const f = c.defId === 'hero' ? S.heroDeadFrame('#884444', 2) : S.monsterFrame(c.sprite, c.tier, 'dead', 2);
    const idle = c.defId === 'hero' ? S.heroFrame('#884444', 'idle', 0) : S.monsterFrame(c.sprite, c.tier, 'idle', 0);
    const base = (c.defId !== 'hero' && MONSTERS[c.defId] && MONSTERS[c.defId].giant) ? Math.min(1.05, MONSTERS[c.defId].h * 0.5) : ((MONSTERS[c.defId] ? MONSTERS[c.defId].h * (c.scale > 0 ? 1 : 1) : 1) * 0.62);
    const h = base * (f.h / idle.h) * 0.95;
    out.push({ x: c.x, y: c.y, z: 0, w: h * ASPECT(f), h, frame: f, emit: 0.02 });
  }
  for (const g of fx.ground) { if (dist2(g.x, g.y, vx, vy) > 400) continue; if (g.spr) { const f = S.gibFrame(g.spr.kind, g.spr.seed, g.v); out.push({ x: g.x, y: g.y, z: 0, w: g.size * ASPECT(f), h: g.size, frame: f, emit: 0.03 }); continue; } out.push({ x: g.x, y: g.y, z: 0, w: g.size, h: g.size * 0.7, color: g.color, alpha: 1 }); }
  for (const h of w.hazards) {
    if (dist2(h.x, h.y, vx, vy) > FAR) continue;
    if (h.kind === 'poison') out.push({ x: h.x, y: h.y, z: 0, w: h.r * 2, h: 0.03, color: rgb(70, 200, 50), alpha: 0.32 + Math.sin(t * 4 + h.x) * 0.06, add: false, fullbright: true });
    else if (h.kind === 'pit') out.push({ x: h.x, y: h.y, z: 0, w: h.r * 2, h: 0.03, color: rgb(40, 26, 12), alpha: 0.85, fullbright: false });
    else if (h.kind === 'rock') { const k = clamp(h.age / h.warn, 0, 1); if (!h.done) out.push({ x: h.x, y: h.y, z: 0, w: h.r * 2 * (0.4 + k * 0.6), h: 0.03, color: RGB_RED, alpha: 0.35 + k * 0.4, add: true, fullbright: true }); }
  }
  // --- particles
  for (const p of fx.parts) {
    if (dist2(p.x, p.y, vx, vy) > 900) continue;
    if (p.spr) { const f = S.gibFrame(p.spr.kind, p.spr.seed, p.spr.v + ((p.spinT || 0) | 0) * 2); out.push({ x: p.x, y: p.y, z: Math.max(0, p.z), w: p.size * ASPECT(f), h: p.size, frame: f, emit: 0.05, alpha: Math.min(1, p.life * 3) }); continue; }
    out.push({ x: p.x, y: p.y, z: Math.max(0, p.z), w: p.size, h: p.size, color: p.color, alpha: p.alpha * Math.min(1, p.life * 2), add: p.add, fullbright: !!p.add });
  }
  // --- dust motes drifting in the air (lit, so they only show inside light pools)
  for (const m of fx.motes || []) {
    if (dist2(m.x, m.y, vx, vy) > 90) continue;
    out.push({ x: m.x, y: m.y, z: m.z, w: 0.012, h: 0.012, color: rgb(220, 200, 170), alpha: 0.55, emit: 0.1 });
  }
  // --- beams
  for (const b of fx.beams) {
    const step = 0.16;
    const col = b.kind === 'fire' ? RGB_ORANGE : b.kind === 'soul' ? RGB_CYAN : b.kind === 'lightning' ? rgb(160, 220, 255) : b.kind === 'drainbeam' ? RGB_RED : rgb(255, 220, 90);
    const zBase = b.kind === 'sun' ? 0.7 : 0.32;
    for (let d = b.owner && b.owner === vb ? 1.6 : 0.6; d < b.len; d += step) {
      const wob = (b.kind === 'lightning' ? Math.sin(d * 9 + t * 60) * 0.12 : 0);
      const jit = Math.sin(d * 17 + t * 55); out.push({ x: b.x + Math.cos(b.angle) * d - Math.sin(b.angle) * wob, y: b.y + Math.sin(b.angle) * d + Math.cos(b.angle) * wob, z: zBase - 0.06 + Math.sin(d * 3 + t * 20) * 0.03 + jit * 0.02, w: b.kind === 'fire' ? 0.14 + d * 0.03 : 0.09 + Math.abs(jit) * 0.05, h: b.kind === 'fire' ? 0.14 + d * 0.03 : 0.09 + Math.abs(jit) * 0.05, color: col, alpha: 0.55, add: true, fullbright: true });
    }
  }
  return out;
}

function hexToRgb(s) { const n = parseInt(s.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

function rgbHex(g) { const h = (v) => Math.round(v * 255).toString(16).padStart(2, '0'); return '#' + h(g[0]) + h(g[1]) + h(g[2]); }
