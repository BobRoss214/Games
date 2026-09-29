// Per-viewport HUD: hero panel, ghost panel, first-person weapon, prompts, effects overlays.
import { drawText, panel, bar, textWidth, wrapText } from './font.js';
import * as S from './sprites.js';
import { WEAPONS, SPELLS, POTIONS, ARTIFACTS, GODS, MONSTERS, XP_TABLE, MAX_LEVEL, LEVEL_UNLOCKS, EVOLVE_COST } from './data.js';
import { currentWeapon, findInteractable, spellSlots } from './hero.js';
import { SLIME_COST } from './ghost.js';
import { clamp, angleDiff, dist, TAU } from './util.js';
import { RARITY } from './data.js';

const frameCanvases = new WeakMap();
export function frameCanvas(f) {
  let c = frameCanvases.get(f);
  if (!c) {
    c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
    const g = c.getContext('2d'); const id = g.createImageData(f.w, f.h);
    const src = new Uint8ClampedArray(f.data.buffer, f.data.byteOffset, f.data.byteLength);
    id.data.set(src);
    for (let i = 3; i < id.data.length; i += 4) if (id.data[i] > 0) id.data[i] = 255;
    g.putImageData(id, 0, 0); frameCanvases.set(f, c);
  }
  return c;
}
export function blit(ctx, f, x, y, w, h) { ctx.drawImage(frameCanvas(f), x, y, w ?? f.w, h ?? f.h); }
const hexc = (h) => h;

// ---------- Doom-style face ----------
function drawFace(ctx, x, y, s, a, t, fxv, hero) {
  const hpf = a ? a.hp / a.maxHp : 1;
  const stage = hpf > 0.8 ? 0 : hpf > 0.6 ? 1 : hpf > 0.4 ? 2 : hpf > 0.2 ? 3 : 4;
  ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, 26 * s + 2, 30 * s + 2);
  ctx.fillStyle = '#2a1a12'; ctx.fillRect(x, y, 26 * s, 30 * s);
  const skin = ['#d8a880', '#d0a078', '#c89068', '#b87c58', '#a06848'][stage];
  ctx.fillStyle = skin; ctx.fillRect(x + 3 * s, y + 6 * s, 20 * s, 22 * s); ctx.fillRect(x + 5 * s, y + 4 * s, 16 * s, 2 * s);
  ctx.fillStyle = '#4a3020'; ctx.fillRect(x + 3 * s, y + 2 * s, 20 * s, 5 * s); ctx.fillRect(x + 2 * s, y + 4 * s, 3 * s, 8 * s); ctx.fillRect(x + 21 * s, y + 4 * s, 3 * s, 8 * s);
  if (hero && hero.level >= MAX_LEVEL) { ctx.fillStyle = '#ffd040'; ctx.fillRect(x + 4 * s, y + 1 * s, 18 * s, 1 * s); }
  // look direction
  let lx = 0; if (fxv && fxv.kick > 0) lx = Math.sign(fxv.dirX || 1) * s; else lx = Math.round(Math.sin(t * 0.7) * s * 0.6);
  const grim = a && a.atk && a.atk.phase < 2, dead = a && a.dead;
  ctx.fillStyle = '#f0f0e8'; ctx.fillRect(x + 6 * s, y + 12 * s, 5 * s, 3 * s); ctx.fillRect(x + 15 * s, y + 12 * s, 5 * s, 3 * s);
  ctx.fillStyle = dead ? '#000' : '#202838'; ctx.fillRect(x + (8 + lx / s) * s, y + 12 * s, 2 * s, 3 * s); ctx.fillRect(x + (17 + lx / s) * s, y + 12 * s, 2 * s, 3 * s);
  ctx.fillStyle = '#3a2418'; ctx.fillRect(x + 5 * s, y + (grim ? 10 : 9) * s, 7 * s, 2 * s); ctx.fillRect(x + 14 * s, y + (grim ? 10 : 9) * s, 7 * s, 2 * s);
  ctx.fillStyle = '#7a3a30'; ctx.fillRect(x + 8 * s, y + 21 * s, 10 * s, grim ? 4 * s : 2 * s); if (grim) { ctx.fillStyle = '#f0f0e8'; ctx.fillRect(x + 9 * s, y + 21 * s, 8 * s, 1 * s); }
  ctx.fillStyle = '#b08060'; ctx.fillRect(x + 12 * s, y + 15 * s, 2 * s, 5 * s);
  // damage
  ctx.fillStyle = '#8a0c14';
  if (stage >= 1) { ctx.fillRect(x + 5 * s, y + 7 * s, 1 * s, 5 * s); }
  if (stage >= 2) { ctx.fillRect(x + 17 * s, y + 8 * s, 4 * s, 2 * s); ctx.fillRect(x + 9 * s, y + 18 * s, 2 * s, 3 * s); }
  if (stage >= 3) { ctx.fillRect(x + 4 * s, y + 14 * s, 7 * s, 3 * s); ctx.fillRect(x + 16 * s, y + 20 * s, 5 * s, 6 * s); ctx.fillStyle = '#a01820'; ctx.fillRect(x + 12 * s, y + 6 * s, 2 * s, 8 * s); }
  if (stage >= 4) { ctx.fillStyle = '#5a0008'; ctx.fillRect(x + 3 * s, y + 6 * s, 20 * s, 5 * s); ctx.fillRect(x + 7 * s, y + 24 * s, 12 * s, 3 * s); }
  if (dead) { ctx.fillStyle = 'rgba(80,0,0,0.6)'; ctx.fillRect(x, y, 26 * s, 30 * s); }
}

// ---------- first-person weapon ----------
function drawWeapon(ctx, vw, vh, a, t, fxv, player) {
  if (!a || a.dead) return;
  const h = a.hero; const wp = currentWeapon(a); const def = WEAPONS[wp.id];
  const sc = (vh * 0.68) / 112;
  let px = vw * 0.68, py = vh + 6 * sc, rot = 0.12, dx = 0, dy = 0, scaleK = 1;
  const moving = a.moving && !a.atk, bobT = a.walkT * 5.2;
  if (moving) { dx += Math.sin(bobT) * 7 * sc * 0.6; dy += Math.abs(Math.cos(bobT)) * 6 * sc * 0.6; rot += Math.sin(bobT) * 0.02; }
  else { dy += Math.sin(t * 1.6) * 1.5 * sc; rot += Math.sin(t * 1.1) * 0.01; }
  let sprite = def.sprite, color;
  const swing = a.lastSwing;
  const at = a.atk;
  const kind = def.kind === 'ranged' ? 'ranged' : (wp.id === 'bronze_spear' || wp.id === 'bone_dagger') ? 'thrust' : 'slash';
  if (at && at.ab.id === 'weapon') {
    const ab = at.ab; const wu = ab.windup, st = ab.strike, rc = ab.recover;
    const heavy = at.heavy; const side = swing ? swing.side : 1;
    let p;
    if (at.t < wu) { p = at.t / wu; if (kind === 'slash') { rot = 0.12 + (-1.0 * side - 0.12) * ease(p) * (heavy ? 1.25 : 1); dx += -side * 20 * sc * ease(p); dy += 22 * sc * ease(p); } else if (kind === 'thrust') { dy += 30 * sc * ease(p); scaleK = 1 - 0.08 * p; } else { dy += 10 * sc * p; } }
    else if (at.t < wu + st + 0.03) { p = clamp((at.t - wu) / (st + 0.03), 0, 1); if (kind === 'slash') { rot = (-1.0 * side) + (1.6 * side) * ease(p); dx += side * 40 * sc * ease(p) - side * 20 * sc; dy += 22 * sc - 52 * sc * Math.sin(p * Math.PI); } else if (kind === 'thrust') { dy += 30 * sc - 120 * sc * ease(p); scaleK = 0.92 + 0.28 * p; } else { dy += 30 * sc * (1 - p); rot -= 0.15 * (1 - p); } }
    else { p = clamp((at.t - wu - st - 0.03) / rc, 0, 1); if (kind === 'slash') { rot = 0.6 * side * (1 - ease(p)) + 0.12; dx += side * 20 * sc * (1 - ease(p)); dy += 10 * sc * (1 - p); } else if (kind === 'thrust') { dy += -12 * sc * (1 - p); scaleK = 1.05 - 0.05 * p; } else { dy += 14 * sc * (1 - p); } }
  } else if (a.charge > 0.06) {
    const c = clamp(a.charge / 0.42, 0, 1); rot = 0.12 - 0.95 * c; dx += -18 * sc * c + Math.sin(t * 50) * 1.2 * c * sc; dy += 20 * sc * c;
  } else if (a.blocking) { rot = -0.25; dx = -vw * 0.14; dy -= 20 * sc; if (kind === 'ranged') sprite = def.sprite; }
  else if (at && at.ab.id === 'spell' && a.lastSwing && a.lastSwing.spell) { sprite = 'spell'; color = a.lastSwing.color; rot = 0; dx = -vw * 0.08; dy = -8 * sc + Math.sin(t * 30) * 2; scaleK = 1 + 0.15 * Math.sin(a.lastSwing.t * 9); }
  if (a.dodgeT > 0) dy += 40 * sc;
  if (fxv && fxv.kick > 0) dy += fxv.kick * 20 * sc;
  const f = sprite === 'spell' ? S.spellHandFrame(color || '#8a40ff') : S.weaponFrame(sprite);
  ctx.save();
  ctx.translate(Math.round(px + dx), Math.round(py + dy));
  ctx.rotate(rot); ctx.scale(sc * scaleK, sc * scaleK);
  if (a.invuln > 0 && (Math.floor(t * 20) & 1) && a.spawnFlash) ctx.globalAlpha = 0.7;
  ctx.drawImage(frameCanvas(f), -32, -104);
  // blood on blade
  const bl = fxv ? fxv.blade || 0 : 0;
  if (bl > 0.05 && sprite !== 'spell' && def.kind === 'melee') {
    ctx.fillStyle = 'rgba(120,8,14,0.85)';
    const n = Math.ceil(bl * 9);
    for (let i = 0; i < n; i++) { const yy = -96 + ((i * 37) % 60) + 8, xx = -3 + ((i * 53) % 7); ctx.fillRect(xx, yy, 2 + (i % 3), 2 + ((i * 3) % 4)); }
  }
  ctx.restore();
}
const ease = (p) => p * p * (3 - 2 * p);

// ---------- overlays ----------
function drawOverlays(ctx, vw, vh, fxv, cam, body) {
  if (fxv) {
    if (fxv.hurt > 0.02) { const g = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.25, vw / 2, vh / 2, vh * 0.85); g.addColorStop(0, 'rgba(120,0,0,0)'); g.addColorStop(1, `rgba(150,0,8,${Math.min(0.75, fxv.hurt * 0.8)})`); ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh); }
    if (fxv.flashT > 0) { const c = fxv.flashC; ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${Math.min(0.9, (fxv.flashT / fxv.flashMax) * 0.8)})`; ctx.fillRect(0, 0, vw, vh); }
  }
  if (cam && cam.ghost) { ctx.fillStyle = 'rgba(40,70,140,0.13)'; ctx.fillRect(0, 0, vw, vh); }
  if (body && body.st) {
    if (body.st.blur > 0) { ctx.globalAlpha = Math.min(0.55, body.st.blur * 0.4); ctx.drawImage(ctx.canvas, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(200,40,60,0.15)'; ctx.fillRect(0, 0, vw, vh); }
    if (body.st.burn) { ctx.fillStyle = `rgba(255,120,20,${0.08 + 0.05 * Math.sin(performance.now() / 60)})`; ctx.fillRect(0, 0, vw, vh); }
    if (body.st.poison) { ctx.fillStyle = 'rgba(60,200,40,0.08)'; ctx.fillRect(0, 0, vw, vh); }
    if (body.st.slow) { ctx.fillStyle = 'rgba(100,160,255,0.1)'; ctx.fillRect(0, 0, vw, vh); }
    if (body.st.stun > 0) { ctx.fillStyle = 'rgba(255,255,200,0.08)'; ctx.fillRect(0, 0, vw, vh); }
    if (body.st.curse > 0) { ctx.fillStyle = 'rgba(160,80,220,0.1)'; ctx.fillRect(0, 0, vw, vh); }
    if (body.st.ward) { ctx.strokeStyle = 'rgba(255,230,140,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(2, 2, vw - 4, vh - 4); }
  }
}

function statusIcons(ctx, x, y, body) {
  if (!body || !body.st) return;
  const list = [];
  const s = body.st;
  if (s.burn) list.push(['BURN', '#ff8a20']); if (s.poison) list.push(['PSN', '#70d040']); if (s.bleed) list.push(['BLD', '#d02040']); if (s.slow) list.push(['SLOW', '#80b0ff']);
  if (s.stun > 0) list.push(['STUN', '#ffff80']); if (s.curse > 0) list.push(['CURSE', '#c080ff']); if (s.might) list.push(['MIGHT', '#ff9030']); if (s.speed) list.push(['HASTE', '#40e0ff']);
  if (s.ironskin) list.push(['IRON', '#b0b8c8']); if (s.shadow) list.push(['SHADOW', '#8060c0']); if (s.ward) list.push(['WARD', '#ffe080']); if (s.sight) list.push(['SIGHT', '#c0a0ff']);
  let cx = x;
  for (const [n, c] of list) { cx += drawText(ctx, n, cx, y, c, 1) + 5; }
}

// ---------- hero HUD ----------
function heroHUD(ctx, vw, vh, m, p, a, t, fxv, compact) {
  const h = a.hero, s = compact ? 1 : 1;
  const pad = 3;
  // bottom bar
  const BH = compact ? 25 : 34, barY = vh - BH;
  ctx.fillStyle = 'rgba(8,4,6,0.78)'; ctx.fillRect(0, barY - 2, vw, BH + 2); ctx.fillStyle = '#4a3a2a'; ctx.fillRect(0, barY - 2, vw, 1);
  const faceS = compact ? 0.8 : 1.05, faceW = Math.round(26 * faceS), faceH = Math.round(30 * faceS);
  const faceX = Math.round(vw / 2 - faceW / 2), faceY = vh - faceH - 1;
  drawFace(ctx, faceX, faceY, faceS, a, t, fxv, h);
  const lx0 = pad + 1, lw = faceX - 5 - lx0, rx0 = faceX + faceW + 4, rw = vw - pad - rx0;
  // health segments
  const segs = Math.ceil(a.maxHp / 10), shown = Math.max(1, Math.min(segs, Math.floor(lw / 4))), k = segs / shown;
  const segW = Math.max(2, Math.floor((lw - shown) / shown)), sh = compact ? 6 : 9, hy = barY + 2;
  const filled = a.hp / 10;
  ctx.fillStyle = '#000'; ctx.fillRect(lx0 - 1, hy - 1, shown * (segW + 1) + 1, sh + 2);
  for (let i = 0; i < shown; i++) {
    const f = clamp(filled / k - i, 0, 1), sx = lx0 + i * (segW + 1);
    ctx.fillStyle = '#2a0808'; ctx.fillRect(sx, hy, segW, sh);
    if (f > 0) { ctx.fillStyle = a.st.poison ? '#60c030' : a.hp < a.maxHp * 0.3 ? '#ff3030' : '#d02020'; ctx.fillRect(sx, hy, Math.ceil(segW * f), sh); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(sx, hy, Math.ceil(segW * f), 1); }
  }
  drawText(ctx, Math.ceil(a.hp) + '/' + Math.ceil(a.maxHp), lx0, hy + sh + 3, '#e8c8c0', 1);
  bar(ctx, lx0, hy + sh + 13, Math.min(lw, 72), 2, a.mana / a.maxMana, '#3070e0', '#0a1430');
  // level / gold / xp / weapon
  const nextXp = h.level >= MAX_LEVEL ? XP_TABLE[MAX_LEVEL] : XP_TABLE[h.level + 1], prevXp = XP_TABLE[h.level];
  drawText(ctx, 'LV' + h.level, rx0, barY + 2, h.level >= MAX_LEVEL ? '#ffd040' : '#e8dcc0', 1);
  drawText(ctx, '$' + h.gold, vw - pad - 1, barY + 2, '#ffd860', 1, { align: 'right' });
  bar(ctx, rx0, barY + 11, Math.max(10, rw - 1), 3, h.level >= MAX_LEVEL ? 1 : (h.xp - prevXp) / (nextXp - prevXp), '#c0a020', '#201808');
  const wpn = currentWeapon(a); const maxc = Math.max(4, Math.floor(rw / 6));
  drawText(ctx, wpn.name.toUpperCase().slice(0, maxc), rx0, barY + 17, RARITY[wpn.rarity].color, 1);
  if (WEAPONS[wpn.id].ammo) drawText(ctx, 'X' + wpn.ammo, rx0, barY + 25, '#d0d0d0', 1);
  // potion + spell icons above bar (right)
  const iy = barY - 17;
  const pot = h.potionSel; if (pot) { blit(ctx, S.itemIcon({ type: 'potion', id: pot }), vw - 14, iy, 11, 15); drawText(ctx, 'X' + h.potions[pot], vw - 16, iy + 5, '#e8dcc0', 1, { align: 'right' }); }
  const sl = spellSlots(h.level);
  for (let i = 0; i < 2; i++) {
    const id = h.spells[i]; const x = vw - 32 - i * 17 - (pot ? 16 : 0);
    const act = i === h.spellIdx && i < Math.max(1, sl);
    ctx.fillStyle = i < sl ? (act ? '#4a3a70' : '#241a30') : '#141010'; ctx.fillRect(x, iy, 15, 15); ctx.fillStyle = act ? '#c0a0ff' : '#4a3a4a'; ctx.fillRect(x, iy, 15, 1); ctx.fillRect(x, iy + 14, 15, 1);
    if (i < sl && id) { ctx.fillStyle = SPELLS[id].color; ctx.fillRect(x + 4, iy + 4, 7, 7); if (a.mana < SPELLS[id].cost) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x, iy, 15, 15); } }
    else if (i >= sl) drawText(ctx, 'L' + (i ? 7 : 4), x + 2, iy + 4, '#5a4a4a', 1);
  }
  h.artifacts.forEach((id, i) => { ctx.fillStyle = '#d8ac3c'; ctx.fillRect(4 + i * 7, barY - 8, 5, 5); ctx.fillStyle = '#ff5060'; ctx.fillRect(5 + i * 7, barY - 7, 3, 2); });
  // top: role & compass
  drawText(ctx, 'YOU ARE THE HERO', pad + 2, 3, '#ffd060', 1, { outline: '#300' });
  const w = m.world;
  if (w.kind === 'floor') drawText(ctx, 'FLOOR ' + (m.floorIndex + 1) + '  ' + (w.spec.theme.name || '').toUpperCase(), pad + 2, 12, '#b0a088', 1);
  else if (w.kind === 'boss') drawText(ctx, 'ATTEMPT ' + (m.bossAttempts + 1) + '/3', pad + 2, 12, '#e06050', 1);
  compass(ctx, vw, a.angle);
  // portal arrow at level 10
  if (h.level >= MAX_LEVEL && w.kind === 'floor' && w.spec.portal) {
    const pr = w.spec.portal; const ang = Math.atan2(pr.cy + 0.5 - a.y, pr.cx + 0.5 - a.x); const rel = angleDiff(ang, a.angle);
    const cx = vw - 22, cy = 24, d = dist(a.x, a.y, pr.cx, pr.cy);
    ctx.fillStyle = 'rgba(10,30,60,0.7)'; ctx.beginPath(); ctx.arc(cx, cy, 13, 0, TAU); ctx.fill(); ctx.strokeStyle = '#5ad0ff'; ctx.lineWidth = 1; ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rel + Math.PI / 2); ctx.fillStyle = '#7ae0ff'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.restore();
    drawText(ctx, Math.round(d) + 'M', cx, cy + 15, '#7ae0ff', 1, { align: 'center' });
  }
  if (w.kind === 'floor' && w.spec.exit && w.spec.exit.cleared) { /* exit hint */ }
  statusIcons(ctx, pad + 2, 22, a);
  // interaction prompt
  const tgt = findInteractable(w, a);
  if (tgt) {
    let msg = '';
    if (tgt.kind === 'chest') msg = tgt.locked && !h.artifacts.includes('vaultkey') && h.keys <= 0 ? 'LOCKED (VAULT KEY)' : 'E: OPEN CHEST';
    else if (tgt.kind === 'shop') msg = tgt.item.price + ' GOLD: ' + shortItem(tgt.item);
    else if (tgt.kind === 'portal') msg = h.level >= MAX_LEVEL ? 'E: ENTER PORTAL' : 'PORTAL DORMANT (LV 10)';
    if (msg) { const col = tgt.kind === 'shop' ? (h.gold >= tgt.item.price ? '#ffd860' : '#a06060') : '#e8dcc0'; drawText(ctx, msg, vw / 2, vh * 0.58, col, 1, { align: 'center', outline: '#000' }); if (tgt.kind === 'shop') drawText(ctx, itemDesc(tgt.item), vw / 2, vh * 0.58 + 9, '#a09080', 1, { align: 'center' }); }
  }
  // crosshair
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(Math.round(vw / 2) - 1, Math.round(vh / 2 - (compact ? 10 : 14)), 2, 2);
  // charge indicator
  if (a.charge > 0.08 && h.level >= 3) { bar(ctx, vw / 2 - 14, vh * 0.62, 28, 2, clamp(a.charge / 0.42, 0, 1), a.charge >= 0.42 ? '#ffd040' : '#c0c0c0', '#1a1a1a'); }
  if (a.dodgeCd > 0 && h.level >= 5) { bar(ctx, vw / 2 - 14, vh * 0.62 + 5, 28, 1, 1 - a.dodgeCd / 1.1, '#60a0ff', '#101020'); }
  // low HP pulse
  if (a.hp < a.maxHp * 0.25) { ctx.fillStyle = `rgba(160,0,0,${0.08 + 0.06 * Math.sin(t * 8)})`; ctx.fillRect(0, 0, vw, vh); }
}
function weaponLabel(wp) { return wp.name; }
function shortItem(it) { switch (it.type) { case 'weapon': return it.name; case 'potion': return POTIONS[it.id].name; case 'spell': return SPELLS[it.id].name + ' SCROLL'; case 'artifact': return ARTIFACTS[it.id].name; default: return it.type; } }
function itemDesc(it) { switch (it.type) { case 'weapon': return WEAPONS[it.id].desc + ' (DMG ' + Math.round(it.dmg) + ')'; case 'potion': return POTIONS[it.id].desc; case 'spell': return SPELLS[it.id].desc; case 'artifact': return ARTIFACTS[it.id].desc; default: return ''; } }

function compass(ctx, vw, angle) {
  const cx = vw / 2, y = 3, w = 90;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(cx - w / 2, y, w, 9);
  const dirs = [['N', -Math.PI / 2], ['E', 0], ['S', Math.PI / 2], ['W', Math.PI]];
  for (const [n, a] of dirs) { const rel = angleDiff(a, angle); if (Math.abs(rel) < 1.0) drawText(ctx, n, cx + rel * (w / 2), y + 1, n === 'N' ? '#ff6050' : '#c8bca0', 1, { align: 'center' }); }
  ctx.fillStyle = '#ffd060'; ctx.fillRect(cx, y + 9, 1, 2);
}

// ---------- ghost HUD ----------
function ghostHUD(ctx, vw, vh, m, p, b, t, fxv, compact, w) {
  const pad = 3;
  const BH = compact ? 24 : 30, barY = vh - BH;
  ctx.fillStyle = 'rgba(8,6,16,0.78)'; ctx.fillRect(0, barY - 2, vw, BH + 2); ctx.fillStyle = '#3a3a5a'; ctx.fillRect(0, barY - 2, vw, 1);
  const god = GODS[p.godId];
  if (!compact) drawText(ctx, god.name.toUpperCase(), pad + 2, barY + 1, god.color, 1);
  const tw = compact ? 25 : 30, th = compact ? 19 : 17, ry0 = compact ? barY + 2 : barY + 11;
  god.roster.forEach((id, i) => {
    const x = pad + 2 + i * (tw + 2), y = ry0;
    const tier = p.ghost.tiers[i]; const f = S.monsterFrame(MONSTERS[id].sprite, tier, 'idle', 0);
    ctx.fillStyle = '#12101c'; ctx.fillRect(x, y, tw, th); const sc = Math.min((th - 2) / f.h, (tw - 10) / f.w); ctx.drawImage(frameCanvas(f), x + 1, y + th - 1 - f.h * sc, f.w * sc, f.h * sc);
    for (let kk = 0; kk <= tier; kk++) { ctx.fillStyle = '#e0c040'; ctx.fillRect(x + tw - 7, y + 2 + kk * 4, 5, 2); }
  });
  const rx = vw - 4;
  if (compact) {
    drawText(ctx, 'E' + Math.min(99, p.ghost.ecto) + (p.ghost.ecto >= SLIME_COST ? '*' : '') + ' B' + Math.round(p.ghost.blood), rx, barY + 3, p.ghost.ecto >= SLIME_COST ? '#a0ffff' : '#d04050', 1, { align: 'right' });
    drawText(ctx, 'WRATH ' + Math.round(p.ghost.wrath), rx, barY + 13, '#e09040', 1, { align: 'right' });
  } else {
    drawText(ctx, 'ECTO ' + Math.min(99, p.ghost.ecto) + (p.ghost.ecto >= SLIME_COST ? ' *' : ''), rx, barY + 2, p.ghost.ecto >= SLIME_COST ? '#a0ffff' : '#6a9a9a', 1, { align: 'right' });
    drawText(ctx, 'BLOOD ' + Math.round(p.ghost.blood), rx, barY + 11, '#d04050', 1, { align: 'right' });
    drawText(ctx, 'WRATH ' + Math.round(p.ghost.wrath), rx, barY + 20, '#e09040', 1, { align: 'right' });
  }
  // top banner
  const hero = m.heroPlayer;
  if (hero) drawText(ctx, 'HERO: ' + hero.name.toUpperCase() + ' LV' + hero.hero.level, pad + 2, 3, hero.color, 1, { outline: '#000' });
  else drawText(ctx, 'SPECTATING', pad + 2, 3, '#a0a0c0', 1);
  if (w.kind === 'floor') drawText(ctx, 'FLOOR ' + (m.floorIndex + 1), pad + 2, 12, '#8a88a8', 1);
  // direction to hero
  const ha = m.heroActor();
  if (ha && b) {
    const ang = Math.atan2(ha.y - b.y, ha.x - b.x), rel = angleDiff(ang, b.angle), d = dist(ha.x, ha.y, b.x, b.y);
    const cx = vw - 20, cy = 22; ctx.fillStyle = 'rgba(20,10,30,0.6)'; ctx.beginPath(); ctx.arc(cx, cy, 12, 0, TAU); ctx.fill(); ctx.strokeStyle = hero.color; ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rel + Math.PI / 2); ctx.fillStyle = hero.color; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
    drawText(ctx, Math.round(d) + 'M', cx, cy + 14, '#c0c0e0', 1, { align: 'center' });
  }
  compass(ctx, vw, b ? b.angle : 0);
  if (b && b.type === 'ghost') {
    const tg = b.target;
    let msg = '';
    if (tg) {
      switch (tg.kind) {
        case 'pent': msg = 'E: BECOME A MONSTER'; break; case 'trap': msg = 'E: POSSESS ' + tg.tdef.name.toUpperCase(); break; case 'statue': msg = 'E: WAKE THE STATUE'; break;
        case 'chest': msg = 'E: SPRING TRAPPED CHEST'; break; case 'scenery': msg = 'E: HAUNT ' + tg.sub.toUpperCase(); break; case 'torch': msg = 'E: SNUFF TORCH'; break; default: break;
      }
    }
    if (msg) drawText(ctx, msg, vw / 2, vh * 0.55, '#c0b0ff', 1, { align: 'center', outline: '#000' });
    drawText(ctx, p.ghost.ecto >= SLIME_COST ? 'R: SUMMON SLIME' : compact ? 'SMASH SCENERY: ECTO' : 'SMASH SCENERY FOR ECTOPLASM', vw / 2, barY - 10, '#7a9a9a', 1, { align: 'center' });
    if (!compact) drawText(ctx, 'T: JUMP', vw / 2, barY - 19, '#6a6a8a', 1, { align: 'center' });
  } else if (b && b.type === 'trapctl') {
    const trap = b.trap;
    drawText(ctx, trap.tdef.name.toUpperCase() + (trap.state !== 'idle' ? ' ...' : ''), vw / 2, vh * 0.15, '#ffb060', 1, { align: 'center', outline: '#000' });
    drawText(ctx, 'ATTACK: TRIGGER   HOLD E: RELEASE', vw / 2, barY - 10, '#a0a0c0', 1, { align: 'center' });
  } else if (b && (b.type === 'monster' || b.type === 'bosspart')) {
    // monster hp + abilities
    if (b.type === 'monster') bar(ctx, 4, barY - 9, Math.min(60, vw / 3), 4, b.hp / b.maxHp, '#40c040', '#102010');
    drawText(ctx, b.name.toUpperCase(), 4, barY - 18, '#e8dcc0', 1);
    const abs = b.abilities;
    const labels = ['ATK', 'ALT', 'R'];
    abs.slice(0, 3).forEach((ab, i) => {
      const x = vw / 2 - 40 + i * 30, y = barY - 12;
      const cd = b.cds[ab.id] > 0 ? b.cds[ab.id] / ab.cd : 0;
      ctx.fillStyle = '#12101c'; ctx.fillRect(x, y, 27, 9); ctx.fillStyle = cd > 0 ? '#302848' : '#5a4a90'; ctx.fillRect(x, y, Math.round(27 * (1 - cd)), 9);
      drawText(ctx, ab.name.slice(0, 5), x + 2, y + 1, '#e8e0f0', 1, { shadow: '#000' });
    });
    if (b.type === 'monster' && b.age < 9) drawText(ctx, 'HOLD E: LEAVE BODY', vw / 2, barY - 22, '#8a8aaa', 1, { align: 'center' });
    if (b.type === 'bosspart') drawText(ctx, w.boss && w.boss.dormant ? 'WAITING...' : 'CONTROL A PART OF THE BOSS', vw / 2, vh * 0.12, '#e8a080', 1, { align: 'center', outline: '#000' });
  }
  statusIcons(ctx, pad + 2, 22, b);
}

// ---------- entry ----------
export function drawViewportHUD(ctx, vw, vh, match, player, cam, t, fxv, opts = {}) {
  const compact = vw < 300 || vh < 160;
  const b = player.body; const w = match.world;
  ctx.imageSmoothingEnabled = false;
  if (b && b.type === 'hero') { drawWeapon(ctx, vw, vh, b, t, fxv, player); }
  drawOverlays(ctx, vw, vh, fxv, cam, b);
  if (!b) return;
  if (b.type === 'hero') heroHUD(ctx, vw, vh, match, player, b, t, fxv, compact);
  else ghostHUD(ctx, vw, vh, match, player, b, t, fxv, compact, w);
  // boss bar
  if (w.boss && w.boss.fighting && !w.boss.dead) {
    const bw = Math.min(vw - 40, 180), bx = Math.round(vw / 2 - bw / 2);
    drawText(ctx, w.boss.def.name.toUpperCase(), vw / 2, compact ? 13 : 16, '#e8b0a0', 1, { align: 'center', outline: '#300' });
    bar(ctx, bx, compact ? 22 : 26, bw, 4, w.boss.hp / w.boss.maxHp, w.boss.phase === 3 ? '#ff3020' : '#c02020', '#200808');
    if (w.boss.exposedT > 0) drawText(ctx, 'EXPOSED!', vw / 2, compact ? 29 : 33, '#ffd040', 1, { align: 'center' });
  }
  // toasts (per player)
  let ty = compact ? 32 : 40;
  for (const tt of player.toasts.slice(0, compact ? 1 : 2)) { const a = clamp(1 - (tt.t - 3.5) / 1, 0, 1); if (tt.t < 4.5) { ctx.globalAlpha = a; drawText(ctx, tt.text, vw / 2, ty, tt.color, 1, { align: 'center', outline: '#000' }); ctx.globalAlpha = 1; ty += 9; } }
}

// Global overlays drawn over the whole canvas: feed, banner
export function drawGlobalHUD(ctx, W, Hh, match, t) {
  ctx.imageSmoothingEnabled = false;
  const b = match.banner;
  if (b) {
    const p = b.t / b.dur; const a = p < 0.12 ? p / 0.12 : p > 0.8 ? (1 - p) / 0.2 : 1;
    ctx.globalAlpha = clamp(a, 0, 1);
    const y = Math.round(Hh * 0.36);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, y - 8, W, b.sub ? 40 : 28);
    drawText(ctx, b.text, W / 2, y, b.color, 3, { align: 'center', outline: '#000', shadow: '#000' });
    if (b.sub) drawText(ctx, b.sub, W / 2, y + 26, '#e8dcc0', 1, { align: 'center' });
    ctx.globalAlpha = 1;
  }
  // kill feed (top-right on the whole screen)
  let y = 30;
  for (const f of match.feed.slice(0, 3)) { if (f.t < 6) { const a = clamp(1 - (f.t - 5) / 1, 0, 1); ctx.globalAlpha = a * 0.95; drawText(ctx, f.text, W / 2, y, f.color, 1, { align: 'center', outline: '#000' }); ctx.globalAlpha = 1; y += 9; } }
}
