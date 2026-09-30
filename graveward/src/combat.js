// Combat: damage pipeline, status effects, abilities, projectiles, hazards, monster spawning.
import { clamp, angleDiff, dist, dist2, TAU, RNG, grng } from './util.js';
import { MONSTERS, TIER_MULT, GODS, heroDmgMult } from './data.js';
import { newId } from './world.js';

// ---------------- projectile definitions ----------------
export const PROJ = {
  arrow: { r: 0.12, life: 2.0, sprite: 'arrow', glow: null, size: 0.35 },
  arrowPierce: { r: 0.14, life: 2.0, sprite: 'arrow', glow: [0.6, 1, 0.8], size: 0.4, pierce: true },
  bolt: { r: 0.14, life: 2.0, sprite: 'arrow', glow: null, size: 0.4 },
  knife: { r: 0.12, life: 1.6, sprite: 'knife', glow: null, size: 0.3 },
  stone: { r: 0.12, life: 1.5, sprite: 'stone', glow: null, size: 0.2 },
  shard: { r: 0.14, life: 1.4, sprite: 'shard', glow: null, size: 0.3 },
  gore: { r: 0.16, life: 1.6, sprite: 'gore', glow: [1, 0.2, 0.2], size: 0.35, splat: true },
  wave: { r: 0.3, life: 1.4, sprite: 'wave', glow: [1, 0.4, 0.5], size: 0.7, pierce: true },
  acid: { r: 0.16, life: 1.5, sprite: 'acid', glow: [0.4, 1, 0.3], size: 0.35, splat: true, gravity: 2 },
  darkbolt: { r: 0.16, life: 1.8, sprite: 'darkbolt', glow: [0.7, 0.3, 1], size: 0.45 },
  curse: { r: 0.18, life: 1.8, sprite: 'curseorb', glow: [0.8, 0.6, 0.1], size: 0.5 },
  fireball: { r: 0.2, life: 2.0, sprite: 'fireball', glow: [1, 0.55, 0.15], size: 0.6, explode: 1.4 },
  boulder: { r: 0.3, life: 2.2, sprite: 'boulder', glow: null, size: 0.8, explode: 1.2 },
  dart: { r: 0.08, life: 1.2, sprite: 'dart', glow: null, size: 0.2 },
  spark: { r: 0.15, life: 0.5, sprite: 'spark', glow: [0.6, 0.9, 1], size: 0.4 },
  throwprop: { r: 0.22, life: 1.2, sprite: 'pot', glow: null, size: 0.4, gravity: 3 },
  ember: { r: 0.15, life: 1.0, sprite: 'fireball', glow: [1, 0.5, 0.1], size: 0.35 },
};

// ---------------- teams / hostility ----------------
export function hostile(w, srcActor, srcPlayer, target) {
  if (!target || target.dead || target.removed) return false;
  if (target.type === 'ghost' || target.ethereal || target.type === 'trapctl') return false;
  if (w.match.phase === 'opening') return srcPlayer !== target.player;
  const st = srcActor ? srcActor.team : 'ghost';
  return st !== target.team;
}

// ---------------- status ----------------
export function applyStatus(a, name, data) {
  const s = a.st;
  switch (name) {
    case 'burn': s.burn = { t: data.t, dps: data.dps, src: data.src }; break;
    case 'poison': s.poison = { t: data.t, dps: data.dps, src: data.src }; break;
    case 'bleed': s.bleed = { t: data.t, dps: data.dps, src: data.src }; break;
    case 'slow': if (!s.slow || s.slow.t < data.t || s.slow.amt < data.amt) s.slow = { t: data.t, amt: data.amt }; break;
    case 'stun': if (a.stunImmune > 0) return; s.stun = Math.max(s.stun || 0, data.t); a.stunImmune = data.t + 0.6; break;
    case 'blur': s.blur = Math.max(s.blur || 0, data.t); break;
    case 'curse': s.curse = Math.max(s.curse || 0, data.t); break;
    case 'ward': s.ward = { hp: data.hp, t: data.t }; break;
    case 'speed': s.speed = { t: data.t, amt: data.amt || 0.4 }; break;
    case 'might': s.might = data.t; break;
    case 'ironskin': s.ironskin = data.t; break;
    case 'shadow': s.shadow = data.t; break;
    case 'warcry': s.warcry = data.t; break;
    case 'sight': s.sight = data.t; break;
    default: s[name] = data.t;
  }
}

export function updateStatus(w, a, dt) {
  const s = a.st;
  for (const k of ['burn', 'poison', 'bleed']) {
    const e = s[k]; if (!e) continue;
    e.t -= dt; e.acc = (e.acc || 0) + dt;
    if (e.acc >= 0.4) {
      e.acc -= 0.4;
      dealDamage(w, a, e.dps * 0.4, { actor: e.src ? e.src.actor : null, player: e.src ? e.src.player : null, kind: 'dot' }, { noKnock: true, dot: k, bypassBlock: true, bypassInvuln: false });
    }
    if (e.t <= 0) delete s[k];
  }
  for (const k of ['stun', 'blur', 'curse', 'might', 'ironskin', 'shadow', 'warcry', 'sight']) if (s[k] !== undefined) { s[k] -= dt; if (s[k] <= 0) delete s[k]; }
  for (const k of ['slow', 'speed', 'ward']) if (s[k]) { s[k].t -= dt; if (s[k].t <= 0) delete s[k]; }
  if (a.stunImmune > 0) a.stunImmune -= dt;
  if (a.invuln > 0) a.invuln -= dt;
  if (a.flash > 0) a.flash -= dt;
  if (a.stagger > 0) a.stagger -= dt;
}

export function speedMultiplier(a) {
  let m = a.speedMul;
  const s = a.st;
  if (s.slow) m *= 1 - s.slow.amt;
  if (s.speed) m *= 1 + s.speed.amt;
  if (s.warcry) m *= 1.2;
  if (s.stun > 0 || a.stagger > 0) m *= 0.15;
  return m;
}

// ---------------- damage ----------------
export function dealDamage(w, target, amount, src, opts = {}) {
  if (target.dead || target.removed) return 0;
  if (amount <= 0) return 0;
  const match = w.match;
  if (target.invuln > 0 && !opts.bypassInvuln) return 0;
  if (target.ethereal) return 0;
  const srcActor = src.actor || null;
  const srcPlayer = src.player !== undefined ? src.player : srcActor ? srcActor.player : null;
  let dmg = amount;
  const isHero = target.type === 'hero';
  const isBossPart = target.type === 'bosspart';
  // attacker multipliers
  if (srcActor && !opts.raw) {
    dmg *= srcActor.dmgMul || 1;
    if (srcActor.st.might) dmg *= 1.4;
    if (srcActor.st.warcry) dmg *= 1.25;
    if (srcActor.st.curse) dmg *= 0.65;
  }
  // defender modifiers
  if (isHero) {
    const lv = target.hero ? target.hero.level : 1;
    dmg *= 1 - Math.min(0.2, lv * 0.02);
    if (target.st.ironskin) dmg *= 0.6;
    if (target.st.curse) dmg *= 1.15;
    if (target.blocking && !opts.bypassBlock && srcActor) {
      const ang = Math.atan2(srcActor.y - target.y, srcActor.x - target.x);
      if (Math.abs(angleDiff(ang, target.angle)) < 1.7) {
        if (target.blockT < 0.22 && opts.type === 'melee') { // parry
          srcActor.stagger = 0.9; applyStatus(srcActor, 'stun', { t: 0.5 });
          target.flash = 0.12; w.emit('parry', { x: target.x, y: target.y, target });
          return 0;
        }
        dmg *= 0.25; w.emit('block', { x: target.x, y: target.y, target });
      }
    }
    if (target.st.ward) {
      const ab = Math.min(dmg, target.st.ward.hp); target.st.ward.hp -= ab; dmg -= ab;
      if (target.st.ward.hp <= 0) delete target.st.ward;
      w.emit('wardhit', { x: target.x, y: target.y });
      if (dmg <= 0) return 0;
    }
  } else {
    if (target.evasion && opts.type !== 'aoe' && match.rng.chance(target.evasion)) { w.emit('miss', { x: target.x, y: target.y }); return 0; }
    if (target.st.shield) dmg *= 0.5;
  }
  if (opts.backstabMul) dmg *= opts.backstabMul;
  if (opts.crit) dmg *= opts.crit;
  dmg = Math.max(0.5, dmg);

  // boss parts route damage to boss pool
  if (isBossPart && w.boss) { return w.boss.damagePart(target, dmg, src, opts); }

  // lethal handling
  if (target.hp - dmg <= 0) {
    if (isHero && target.hero && target.hero.artifacts.includes('ankh') && !target.ankhUsed && w.match.phase !== 'opening') {
      target.ankhUsed = true; target.hp = 1; target.invuln = 1.8; w.emit('ankh', { x: target.x, y: target.y, target });
      return 0;
    }
    if (!isHero && target.deathless && !target.deathlessUsed) {
      target.deathlessUsed = true; target.hp = target.maxHp * 0.3; target.flash = 0.3; w.emit('deathless', { x: target.x, y: target.y, target });
      return 0;
    }
  }
  target.hp -= dmg;
  target.flash = 0.18;
  target.lastHit = { player: srcPlayer, actor: srcActor, t: w.time, kind: src.kind };
  if (!opts.dot) target.hurtT = 0.28;
  w.emit('hit', { x: target.x, y: target.y, target, amount: dmg, kind: opts.type || src.kind, srcActor, nx: opts.dx || 0, ny: opts.dy || 0, dot: opts.dot });
  // knockback / stun
  if (!opts.noKnock && opts.knock && !target.giant) {
    const k = opts.knock * (isHero ? 1.4 : 1) * (target.knockRes ? 0.4 : 1);
    target.knockX += (opts.dx || 0) * k * 3.2; target.knockY += (opts.dy || 0) * k * 3.2;
  }
  if (opts.stun) applyStatus(target, 'stun', { t: opts.stun });
  if (opts.stagger) target.stagger = Math.max(target.stagger, opts.stagger);
  if (opts.status) for (const [k, v] of Object.entries(opts.status)) applyStatus(target, k, v);
  // credit: blood for ghosts
  if (isHero && srcPlayer && srcPlayer.ghost) match.addBlood(srcPlayer, dmg * (opts.bloodMul || 1));
  // lifesteal
  if (srcActor && !srcActor.dead) {
    if (srcActor.lifesteal) srcActor.hp = Math.min(srcActor.maxHp, srcActor.hp + dmg * srcActor.lifesteal);
    if (srcActor.type === 'hero' && srcActor.hero) {
      const vamp = (srcActor.hero.artifacts.includes('bloodstone') ? 0.08 : 0) + (opts.vamp || 0);
      if (vamp) srcActor.hp = Math.min(srcActor.maxHp, srcActor.hp + dmg * vamp);
    }
  }
  if (target.hp <= 0) { target.hp = 0; match.onActorDeath(w, target, src, opts); }
  return dmg;
}

// ---------------- monsters ----------------
export function spawnMonster(w, defId, tier, x, y, owner = null, o = {}) {
  const def = MONSTERS[defId];
  const scale = def.scale || 1;
  const depthMul = o.depthScale ? 1 + w.depth * 0.08 : 1;
  const hp = def.hp * TIER_MULT.hp[tier] * depthMul * (o.hpMul || 1);
  const a = w.spawnActor({
    type: 'monster', defId, def, tier, name: def.names[tier], x, y, angle: o.angle || 0, r: def.r * (def.giant ? 0.8 : 1), h: def.h * scale, hp, maxHp: hp,
    team: 'ghost', player: owner, speed: def.spd * TIER_MULT.spd[tier], dmgMul: TIER_MULT.dmg[tier] * (o.dmgMul || 1) * depthMul, giant: !!def.giant, flies: !!def.flies,
    evasion: def.evasion || 0, ctl: o.ctl || (owner ? 'player' : 'ai'), sprite: def.sprite, scaleV: scale, room: w.roomAt(x, y) ? w.roomAt(x, y).id : -1, spawnRoom: o.room ?? -1,
    abilities: def.abilities.filter((ab) => (ab.tier || 0) <= tier), eyeZ: def.eye || 0.5,
  });
  if (owner && owner.godId) {
    const god = owner.godId;
    if (god === 'ossuar') a.deathless = true;
    if (god === 'vorrath') a.lifesteal = 0.3;
  }
  if (def.giant) a.knockRes = true;
  if (!o.noPuff) w.emit('spawn', { x, y, target: a });
  return a;
}

// ---------------- abilities ----------------
export function abilityReady(a, ab) { return !a.cds[ab.id] || a.cds[ab.id] <= 0; }
export function canAct(a) { return !a.dead && !(a.st.stun > 0) && !(a.stagger > 0 && a.type !== 'hero') && !a.atk; }

export function startAbility(w, a, ab, opts = {}) {
  if (a.atk || a.dead || a.locked) return false;
  if (!abilityReady(a, ab)) return false;
  const cdMul = a.type === 'hero' ? 1 : 1;
  a.cds[ab.id] = ab.cd * cdMul;
  a.atk = { ab, t: 0, phase: 0, opts, executed: false, hitSet: new Set(), dashDone: false, tickT: 0 };
  a.animT = 0; a.anim = 'attack';
  if (ab.kind === 'melee' || ab.kind === 'leap') a.atk.dir = a.angle;
  w.emit('windup', { x: a.x, y: a.y, target: a, ab });
  return true;
}

export function updateAbility(w, a, dt) {
  const at = a.atk; if (!at) return;
  const ab = at.ab;
  at.t += dt;
  const windup = ab.windup * (a.st.warcry ? 0.85 : 1), strike = ab.strike, recover = ab.recover;
  if (at.t < windup) { at.phase = 0; return; }
  if (!at.executed) { at.executed = true; executeAbility(w, a, ab, at); } // fires on the first tick past windup, whatever the tick size
  if (at.t < windup + strike) {
    at.phase = 1;
    tickStrike(w, a, ab, at, dt);
    return;
  }
  at.phase = 2;
  if (at.t >= windup + strike + recover) { a.atk = null; a.anim = 'idle'; }
}

function aimAngle(a, at) { return at.opts.angle !== undefined ? at.opts.angle : a.angle; }

function executeAbility(w, a, ab, at) {
  const src = { actor: a, player: a.player, kind: ab.kind };
  const ang = a.angle;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  switch (ab.kind) {
    case 'melee': {
      meleeSweep(w, a, ab, ab.dmg * (at.opts.dmgMul || 1), at.opts);
      if (a.type === 'hero') {
        w.match.smashProps(w, a, ab, at.opts);
        if (at.def && at.def.shockwave && at.opts.heavy) {
          for (const t of w.actorsInRadius(a.x, a.y, 2.6, (t) => hostile(w, a, a.player, t))) {
            const d = Math.hypot(t.x - a.x, t.y - a.y) || 1;
            dealDamage(w, t, ab.dmg * 0.5, src, { type: 'aoe', knock: 2.5, dx: (t.x - a.x) / d, dy: (t.y - a.y) / d, stagger: 0.5 });
          }
          w.emit('shockwave', { x: a.x, y: a.y, radius: 2.6, target: a });
        }
      }
      break;
    }
    case 'proj': {
      const n = ab.count || 1;
      for (let i = 0; i < n; i++) {
        let aa = ang;
        if (ab.ring) aa = ang + (i / n) * TAU; else if (n > 1) aa = ang - (ab.spread || 0.3) / 2 + ((ab.spread || 0.3) * i) / (n - 1);
        spawnProj(w, a, ab.proj, aa, ab.speed, ab.dmg, { pierce: ab.pierce, range: ab.range, pool: ab.pool, stun: ab.stun, knock: ab.knock, status: at.opts.status, dmgMul: at.opts.dmgMul, weaponFx: at.opts.projFx, vamp: at.opts.vamp });
      }
      break;
    }
    case 'curse': spawnProj(w, a, ab.proj, ang, ab.speed, ab.dmg, { debuff: ab.debuff, range: ab.range }); break;
    case 'aoe': {
      const hit = w.actorsInRadius(a.x, a.y, ab.radius, (t) => hostile(w, a, a.player, t));
      for (const t of hit) {
        if (!w.hasLOS(a.x, a.y, t.x, t.y, false)) continue;
        const d = Math.hypot(t.x - a.x, t.y - a.y) || 1;
        dealDamage(w, t, ab.dmg, src, { type: 'aoe', knock: ab.knock || 0, dx: (t.x - a.x) / d, dy: (t.y - a.y) / d, stun: ab.stun });
      }
      w.emit('shockwave', { x: a.x, y: a.y, radius: ab.radius, target: a });
      if (a.type === 'bosspart' && w.boss) w.boss.onSlam(a, ab);
      break;
    }
    case 'leap': at.dashSpeed = ab.dist / Math.max(0.05, ab.strike); at.dashDir = ang; break;
    case 'scream': {
      const hit = w.actorsInRadius(a.x, a.y, ab.range, (t) => hostile(w, a, a.player, t));
      for (const t of hit) {
        const ta = Math.atan2(t.y - a.y, t.x - a.x);
        if (Math.abs(angleDiff(ta, ang)) > (ab.arc * Math.PI) / 360 + 0.2) continue;
        dealDamage(w, t, ab.dmg, src, { type: 'aoe', stun: ab.stun, status: ab.blur ? { blur: { t: ab.blur } } : undefined, knock: 0.5, dx: Math.cos(ta), dy: Math.sin(ta) });
      }
      w.emit('scream', { x: a.x, y: a.y, angle: ang, target: a });
      break;
    }
    case 'explode': {
      const hit = w.actorsInRadius(a.x, a.y, ab.radius, (t) => hostile(w, a, a.player, t));
      for (const t of hit) { const d = Math.hypot(t.x - a.x, t.y - a.y) || 1; dealDamage(w, t, ab.dmg, src, { type: 'aoe', knock: 3, dx: (t.x - a.x) / d, dy: (t.y - a.y) / d }); }
      if (ab.pool !== false) spawnHazard(w, { kind: 'poison', x: a.x, y: a.y, r: ab.radius * 0.7, t: 6, dps: 6, owner: a });
      w.emit('explosion', { x: a.x, y: a.y, radius: ab.radius, gore: true });
      a.exploded = true; a.hp = 0; a.suicide = true; w.match.onActorDeath(w, a, { actor: a, player: a.player, kind: 'explode' }, {});
      break;
    }
    case 'summon': {
      const n = ab.n || 2;
      const owned = w.actors.filter((x) => !x.dead && x.summoner === a.id).length;
      for (let i = 0; i < n && owned + i < 6; i++) {
        const aa = ang + (ab.spawnAround ? (i / n) * TAU : (i - (n - 1) / 2) * 0.8), d = ab.spawnAround ? 2.2 : 1.1;
        let sx = a.x + Math.cos(aa) * d, sy = a.y + Math.sin(aa) * d;
        if (!w.canStand(sx, sy, 0.3)) { sx = a.x; sy = a.y; }
        const m = spawnMonster(w, ab.unit, 0, sx, sy, a.player, { ctl: 'ai' }); m.summoner = a.id; m.xpMul = 0.3;
      }
      w.emit('summon', { x: a.x, y: a.y, target: a });
      break;
    }
    case 'buff': {
      for (const t of w.actorsInRadius(a.x, a.y, ab.radius, (t) => t.team === a.team && t.type !== 'ghost')) applyStatus(t, 'warcry', { t: ab.dur });
      w.emit('warcry', { x: a.x, y: a.y, target: a });
      break;
    }
    case 'beam': at.beamAng = ang; at.beamT = 0; break;
    default: break;
  }
  if (a.type === 'monster' || a.type === 'bosspart') w.emit('attack', { x: a.x, y: a.y, target: a, ab });
}

function tickStrike(w, a, ab, at, dt) {
  if (ab.kind === 'leap') {
    const dirx = Math.cos(at.dashDir), diry = Math.sin(at.dashDir);
    const step = at.dashSpeed * dt;
    const moved = w.moveActor(a, dirx * step, diry * step);
    a.invuln = Math.max(a.invuln, 0);
    // contact damage once
    if (!at.dashDone) {
      const hit = w.actorsInRadius(a.x, a.y, ab.radius || 0.75, (t) => t !== a && hostile(w, a, a.player, t));
      for (const t of hit) {
        at.dashDone = true;
        dealDamage(w, t, ab.dmg, { actor: a, player: a.player, kind: 'leap' }, { type: 'melee', knock: ab.knock || 1, dx: dirx, dy: diry, stun: ab.stun });
      }
      if (at.dashDone && a.type === 'bosspart' && w.boss) w.boss.onSlam(a, ab);
    }
    if (!moved) at.t = Math.max(at.t, ab.windup + ab.strike); // stop on wall
  } else if (ab.kind === 'beam') {
    if (ab.sweep && a.desiredAngle !== undefined) at.beamAng += clamp(angleDiff(a.desiredAngle, at.beamAng), -1.2 * dt, 1.2 * dt);
    else at.beamAng = a.angle;
    a.beamAng = at.beamAng;
    at.beamT += dt;
    const tick = ab.tick || 0.2;
    if (at.beamT >= tick) {
      at.beamT -= tick;
      const dirx = Math.cos(at.beamAng), diry = Math.sin(at.beamAng);
      const maxD = Math.min(ab.range, w.rayWall(a.x, a.y, at.beamAng, ab.range));
      for (const t of w.actors) {
        if (t.dead || !hostile(w, a, a.player, t)) continue;
        const px = t.x - a.x, py = t.y - a.y;
        const along = px * dirx + py * diry; if (along < 0 || along > maxD) continue;
        const perp = Math.abs(px * diry - py * dirx); if (perp > 0.55 + t.r) continue;
        dealDamage(w, t, ab.dmg, { actor: a, player: a.player, kind: 'beam' }, { type: 'aoe', knock: 0.3, dx: dirx, dy: diry, status: ab.burn ? { burn: { t: 2, dps: 5, src: { actor: a, player: a.player } } } : undefined, bloodMul: 1 });
      }
      w.emit('beamtick', { x: a.x, y: a.y, angle: at.beamAng, len: maxD, target: a });
    }
  }
}

// Melee arc sweep (used by monsters and heroes). Returns number of hits.
export function meleeSweep(w, a, ab, dmg, opts = {}) {
  const ang = a.angle, reach = ab.reach + (opts.reachBonus || 0), half = (ab.arc * Math.PI) / 360;
  const src = { actor: a, player: a.player, kind: 'melee' };
  let hits = 0;
  const cands = w.actorsInRadius(a.x, a.y, reach, (t) => t !== a && hostile(w, a, a.player, t));
  cands.sort((p, q) => dist2(a.x, a.y, p.x, p.y) - dist2(a.x, a.y, q.x, q.y));
  const cleave = opts.cleave !== undefined ? opts.cleave : true;
  for (const t of cands) {
    const ta = Math.atan2(t.y - a.y, t.x - a.x);
    const d = Math.hypot(t.x - a.x, t.y - a.y);
    const angPad = Math.atan2(t.r, Math.max(0.1, d));
    if (Math.abs(angleDiff(ta, ang)) > half + angPad && d > 0.5) continue;
    if (!w.hasLOS(a.x, a.y, t.x, t.y, false)) continue;
    let backstab = 1;
    if (opts.backstab && t.type !== 'hero' && Math.abs(angleDiff(t.angle, ang)) < 1.0) backstab = opts.backstab;
    const res = dealDamage(w, t, dmg, src, {
      type: 'melee', knock: (opts.knock !== undefined ? opts.knock : ab.knock) || 0, dx: Math.cos(ta), dy: Math.sin(ta), backstabMul: backstab, stun: ab.stun, stagger: opts.stagger,
      status: opts.status, vamp: opts.vamp, crit: opts.crit, bloodMul: 1,
    });
    if (res > 0) { hits++; if (opts.onHit) opts.onHit(t, res); }
    if (!cleave && hits >= 1) break;
  }
  return hits;
}

// ---------------- projectiles ----------------
export function spawnProj(w, a, kind, ang, speed, dmg, o = {}) {
  const def = PROJ[kind] || PROJ.arrow;
  const p = {
    id: newId(), kind, def, x: a.x + Math.cos(ang) * (a.r + 0.15), y: a.y + Math.sin(ang) * (a.r + 0.15), z: (a.h || 1) * 0.6, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, vz: 0, angle: ang,
    r: def.r, dmg, life: o.range ? o.range / speed : def.life, team: a.team, srcActor: a, player: a.player, pierce: !!(o.pierce || def.pierce), hitSet: new Set(), dead: false,
    knock: o.knock ?? 0.6, stun: o.stun, status: o.status, debuff: o.debuff, pool: o.pool, dmgMul: o.dmgMul || 1, weaponFx: o.weaponFx, vamp: o.vamp, crit: o.crit, ffaPlayer: a.player, gravity: def.gravity || 0,
    explode: def.explode, splat: def.splat, homing: o.homing, spellKind: o.spellKind,
  };
  w.projs.push(p);
  return p;
}

export function updateProjs(w, dt) {
  for (const p of w.projs) {
    if (p.dead) continue;
    p.life -= dt; if (p.life <= 0) { projDie(w, p, false); continue; }
    if (p.gravity) { p.vz -= p.gravity * dt; p.z += p.vz * dt; if (p.z <= 0.05) { projDie(w, p, true); continue; } }
    const steps = Math.ceil(Math.hypot(p.vx, p.vy) * dt / 0.12) || 1;
    const sdt = dt / steps;
    for (let s = 0; s < steps && !p.dead; s++) {
      p.x += p.vx * sdt; p.y += p.vy * sdt;
      if (w.blockedAt(p.x | 0, p.y | 0, true)) {
        const ci = (p.y | 0) * w.map.w + (p.x | 0);
        const di = w.map.doorIdx[ci];
        if (!(di >= 0 && w.map.doors[di].open >= 0.5) && w.map.wall[ci] !== 0) { w.emit('projwall', { x: p.x - p.vx * sdt, y: p.y - p.vy * sdt, vx: p.vx, vy: p.vy, kind: p.kind, proj: p }); projDie(w, p, true); break; }
      }
      if (w.map.solidProps[(p.y | 0) * w.map.w + (p.x | 0)]) {
        const pr = w.propAtCell(p.x | 0, p.y | 0);
        if (pr && (pr.kind === 'scenery' || pr.kind === 'crystal')) {
          if (p.player && p.srcActor && p.srcActor.type === 'hero' && (pr.destructible || pr.kind === 'crystal')) w.match.hitProp(w, pr, p.dmg, p.srcActor);
          if (pr.kind === 'scenery' && !pr.destructible) { projDie(w, p, true); break; }
          if (pr.kind === 'crystal') { projDie(w, p, true); break; }
        }
      }
      for (const t of w.actors) {
        if (t.dead || p.hitSet.has(t.id)) continue;
        if (!hostile(w, p.srcActor, p.player, t)) continue;
        const rr = p.r + t.r;
        if (dist2(p.x, p.y, t.x, t.y) > rr * rr) continue;
        const d = Math.hypot(p.vx, p.vy) || 1;
        const status = Object.assign({}, p.status || {});
        if (p.debuff === 'curse') status.curse = { t: 8 * (p.player && p.player.godId === 'ashkeleth' ? 1.5 : 1) };
        dealDamage(w, t, p.dmg * p.dmgMul, { actor: p.srcActor, player: p.player, kind: 'proj' }, {
          type: 'proj', knock: p.knock, dx: p.vx / d, dy: p.vy / d, stun: p.stun, status, vamp: p.vamp, crit: p.crit, bloodMul: 1,
        });
        if (p.weaponFx) applyWeaponFx(w, p.srcActor, t, p.weaponFx);
        p.hitSet.add(t.id);
        if (!p.pierce) { projDie(w, p, true); break; }
      }
    }
  }
}

export function applyWeaponFx(w, src, t, effects) {
  if (!effects || t.dead) return;
  const s = { actor: src, player: src.player };
  if (effects.includes('fire')) applyStatus(t, 'burn', { t: 3, dps: 5 * (src.dmgMul || 1), src: s });
  if (effects.includes('poison')) applyStatus(t, 'poison', { t: 4, dps: 4, src: s });
}

function projDie(w, p, hit) {
  p.dead = true;
  if (p.explode) {
    for (const t of w.actorsInRadius(p.x, p.y, p.explode, (t) => hostile(w, p.srcActor, p.player, t))) {
      const d = Math.hypot(t.x - p.x, t.y - p.y) || 1;
      if (p.hitSet.has(t.id)) continue;
      dealDamage(w, t, p.dmg * 0.6 * p.dmgMul, { actor: p.srcActor, player: p.player, kind: 'aoe' }, { type: 'aoe', knock: 1.5, dx: (t.x - p.x) / d, dy: (t.y - p.y) / d, status: p.kind === 'fireball' ? { burn: { t: 3, dps: 5, src: { actor: p.srcActor, player: p.player } } } : undefined });
    }
    w.emit('explosion', { x: p.x, y: p.y, radius: p.explode, fire: p.kind === 'fireball' });
  }
  if (p.pool) spawnHazard(w, { kind: 'poison', x: p.x, y: p.y, r: 0.9, t: 4.5, dps: 5, owner: p.srcActor });
  if (hit || p.splat) w.emit('projhit', { x: p.x, y: p.y, kind: p.kind, proj: p });
  if (p.kind === 'knife' && p.srcActor && p.srcActor.type === 'hero' && hit) { spawnPickup(w, 'knife', p.x, p.y, { amount: 1 }); }
}

// ---------------- hazards (poison pools, sudden-death spikes, fire) ----------------
export function spawnHazard(w, h) { h.id = newId(); h.age = 0; h.acc = 0; w.hazards.push(h); return h; }
export function updateHazards(w, dt) {
  for (const h of w.hazards) {
    h.age += dt; h.t -= dt; h.acc += dt;
    if (h.acc >= 0.5) {
      h.acc -= 0.5;
      if (h.kind === 'poison') {
        for (const t of w.actorsInRadius(h.x, h.y, h.r, (t) => hostile(w, h.owner, h.owner ? h.owner.player : null, t))) applyStatus(t, 'poison', { t: 2.5, dps: h.dps, src: { actor: h.owner, player: h.owner ? h.owner.player : null } });
      } else if (h.kind === 'pit') {
        for (const t of w.actorsInRadius(h.x, h.y, h.r, (t) => t.type === 'hero')) { applyStatus(t, 'slow', { t: 1.0, amt: 0.55 }); dealDamage(w, t, 5, { actor: null, player: null, kind: 'env' }, { type: 'aoe', noKnock: true, bypassBlock: true }); }
      } else if (h.kind === 'spikes') {
        for (const t of w.actors) if (!t.dead && t.type === 'hero' && Math.abs(t.x - h.x) < 0.7 && Math.abs(t.y - h.y) < 0.7) dealDamage(w, t, h.dps * 0.5, { actor: null, player: null, kind: 'env' }, { type: 'aoe', noKnock: true, bypassBlock: true });
      }
    }
  }
  if (w.hazards.some((h) => h.t <= 0 && !h.perm)) w.hazards = w.hazards.filter((h) => h.t > 0 || h.perm);
}

// ---------------- pickups ----------------
export function spawnPickup(w, kind, x, y, data = {}) {
  if (kind !== 'ecto') { const f = w.freeSpot(x, y); x = f[0]; y = f[1]; }
  const p = { id: newId(), kind, x, y, z: 0.4, vz: 2.5 + grng.next() * 1.5, vx: (grng.next() - 0.5) * 1.6, vy: (grng.next() - 0.5) * 1.6, data, dead: false, age: 0, life: kind === 'ecto' ? 25 : 90, bob: grng.next() * 6 };
  w.pickups.push(p);
  return p;
}
export function updatePickups(w, dt) {
  for (const p of w.pickups) {
    p.age += dt;
    if (p.age > p.life) { p.dead = true; continue; }
    if (p.z > 0.18 || p.vz > 0) {
      p.vz -= 9 * dt; p.z += p.vz * dt;
      if (p.z < 0.18) { p.z = 0.18; p.vz *= -0.35; if (Math.abs(p.vz) < 0.6) p.vz = 0; }
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
      const gh = p.kind === 'ecto'; if (w.canStand(nx, p.y, 0.1, gh)) p.x = nx; if (w.canStand(p.x, ny, 0.1, gh)) p.y = ny;
      p.vx *= 0.97; p.vy *= 0.97;
    }
  }
}
