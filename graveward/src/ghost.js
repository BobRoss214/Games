// Ghost side: floating ghost form, possession (pentagram / trap / statue / prop), monster control, traps.
import { clamp, angleDiff, dist, dist2, TAU } from './util.js';
import { GODS, MONSTERS, TRAPS, PROPS } from './data.js';
import { DECAL } from './textures.js';
import { spawnMonster, startAbility, updateAbility, speedMultiplier, dealDamage, applyStatus, spawnProj, spawnPickup, hostile, abilityReady, spawnHazard } from './combat.js';
import { applyMotion } from './hero.js';

export const SLIME_COST = 6;

// ---------------- ghost form ----------------
export function spawnGhost(w, player, x, y, angle) {
  const g = w.spawnActor({
    type: 'ghost', player, x, y, angle: angle || 0, r: 0.25, h: 0.6, hp: 1, maxHp: 1, team: 'ghost', ctl: 'player', ethereal: true, z: 0.5, sprite: 'wisp', name: player.name,
    hoverT: Math.random() * 6, room: -1, eyeZ: 0.5, sightRange: 0, ecto: 0, holdInteract: 0,
  });
  player.ghostForm = g; player.body = g;
  return g;
}

export function ghostControl(w, g, intent, dt) {
  const p = g.player;
  g.hoverT += dt;
  g.angle += intent.turn + intent.turnRate * dt;
  let fwd = intent.fwd, str = intent.strafe; const mag = Math.hypot(fwd, str); if (mag > 1) { fwd /= mag; str /= mag; }
  const spd = 5.2 * (intent.sprint ? 1.7 : 1);
  const c = Math.cos(g.angle), s = Math.sin(g.angle);
  g.vx = (c * fwd - s * str) * spd; g.vy = (s * fwd + c * str) * spd;
  w.moveActor(g, g.vx * dt, g.vy * dt);
  g.moving = mag > 0.1;
  // leash to hero
  const hero = w.match.heroActor();
  if (hero && w.kind !== 'boss') {
    const d = dist(g.x, g.y, hero.x, hero.y);
    if (d > 30) { const pull = (d - 30) * 0.8 * dt; g.x += ((hero.x - g.x) / d) * pull * 4; g.y += ((hero.y - g.y) / d) * pull * 4; }
  }
  g.room = (w.roomAt(g.x, g.y) || { id: -1 }).id;
  // collect ectoplasm
  for (const pk of w.pickups) {
    if (pk.dead || pk.kind !== 'ecto') continue;
    if (dist2(g.x, g.y, pk.x, pk.y) < 1.2) { pk.dead = true; p.ghost.ecto += 1; w.emit('ectopick', { x: pk.x, y: pk.y, player: p }); }
  }
  p.ghost.ectoT = (p.ghost.ectoT || 0) + dt;
  if (p.ghost.ectoT > 14) { p.ghost.ectoT = 0; p.ghost.ecto += 1; }
  // targets
  const tgt = findPossessTarget(w, g);
  g.target = tgt;
  if (intent.interact && tgt) possess(w, p, g, tgt);
  if (intent.spellNext) hauntJump(w, p, g);
  if (intent.spell || intent.potion || intent.ability2) { if (p.ghost.ecto >= SLIME_COST) summonSlime(w, p, g); else w.emit('noecto', { player: p }); }
}

function findPossessTarget(w, g) {
  let best = null, bd = 2.2;
  const cand = [];
  for (const pr of w.props) {
    if (!pr.alive || pr.used) continue;
    let pri = 0, ok = false;
    switch (pr.kind) {
      case 'pent': ok = !pr.usedUp; pri = 0; break;
      case 'statue': ok = !pr.awake; pri = 1; break;
      case 'trap': ok = !pr.owner; pri = 2; break;
      case 'chest': ok = pr.trapped && !pr.opened && !pr.sprung; pri = 4; break;
      case 'scenery': ok = !!pr.def.haunt && !pr.hauntedT; pri = 5; break;
      case 'torch': ok = !pr.out; pri = 6; break;
      default: break;
    }
    if (!ok) continue;
    if (pr.room !== undefined && w.rooms[pr.room] && w.rooms[pr.room].type === 'store') continue; // store is a safe zone
    const d = dist(g.x, g.y, pr.x, pr.y);
    const lim = pr.kind === 'pent' ? 1.2 : 2.0;
    if (d > lim) continue;
    cand.push({ pr, score: d + pri * 0.6 });
  }
  cand.sort((a, b) => a.score - b.score);
  return cand.length ? cand[0].pr : null;
}

export function possessableList(w, hero) {
  const out = [];
  for (const pr of w.props) {
    if (!pr.alive) continue;
    if (pr.kind === 'pent' && !pr.usedUp) out.push(pr);
    else if (pr.kind === 'trap' && !pr.owner) out.push(pr);
    else if (pr.kind === 'statue' && !pr.awake) out.push(pr);
  }
  return out;
}

function hauntJump(w, p, g) {
  const hero = w.match.heroActor();
  const list = possessableList(w, hero);
  if (hero) list.push({ x: hero.x + 1.2, y: hero.y, hero: true, kind: 'hero' });
  if (!list.length) return;
  list.sort((a, b) => (hero ? dist2(a.x, a.y, hero.x, hero.y) : 0) - (hero ? dist2(b.x, b.y, hero.x, hero.y) : 0));
  g.jumpIdx = ((g.jumpIdx || 0) + 1) % list.length;
  const t = list[g.jumpIdx];
  g.x = t.x; g.y = t.y; if (!w.canStand(g.x, g.y, g.r, true)) w.unstick(g);
  w.emit('ghostjump', { x: g.x, y: g.y, player: p });
}

export function summonSlime(w, p, g) {
  if (p.ghost.ecto < SLIME_COST) return;
  const x = g.x + Math.cos(g.angle) * 1.2, y = g.y + Math.sin(g.angle) * 1.2;
  const sx = w.canStand(x, y, 0.35) ? x : g.x, sy = w.canStand(x, y, 0.35) ? y : g.y;
  if (!w.canStand(sx, sy, 0.35)) { w.emit('noecto', { player: p }); return; }
  const owned = w.actors.filter((a) => !a.dead && a.player === p && a.defId === 'slime').length;
  if (owned >= 4) return;
  p.ghost.ecto -= SLIME_COST;
  const m = spawnMonster(w, 'slime', 0, sx, sy, p, { ctl: 'ai', depthScale: true });
  m.summoner = g.id;
  w.emit('slimesummon', { x: sx, y: sy, player: p });
}

// ---------------- possession ----------------
export function possess(w, p, g, tgt) {
  switch (tgt.kind) {
    case 'pent': usePentagram(w, p, g, tgt); break;
    case 'trap': possessTrap(w, p, g, tgt); break;
    case 'statue': possessStatue(w, p, g, tgt); break;
    case 'chest': springChest(w, p, tgt); break;
    case 'scenery': case 'torch': hauntProp(w, p, tgt); break;
  }
}

export function rosterFor(p) { return GODS[p.godId].roster; }

export function usePentagram(w, p, g, pent, forceDef) {
  const roster = rosterFor(p);
  const idx = w.match.rng.int(0, 2);
  const defId = forceDef || roster[idx];
  const tier = forceDef ? 0 : p.ghost.tiers[idx];
  pent.usedUp = true; pent.used = true;
  w.map.decal[pent.cy * w.map.w + pent.cx] = DECAL.pentagramUsed;
  const m = spawnMonster(w, defId, tier, pent.x, pent.y, p, { angle: g ? g.angle : 0, room: pent.room });
  m.pent = pent; m.rosterIdx = idx;
  m.spawnRoom = pent.room;
  becomeMonster(w, p, m);
  const room = w.rooms[pent.room]; if (room) room.spawned = (room.spawned || 0) + 1;
  w.emit('pentagram', { x: pent.x, y: pent.y, player: p, monster: m });
  return m;
}

export function becomeMonster(w, p, m) {
  if (p.ghostForm) { p.ghostForm.removed = true; p.ghostForm = null; }
  m.player = p; m.ctl = 'player'; p.body = m;
  m.aiIntent = null;
}

export function possessTrap(w, p, g, trap) {
  trap.owner = p;
  const proxy = { type: 'trapctl', ctl: 'player', ethereal: true, player: p, trap, x: trap.x, y: trap.y, z: trap.trap === 'spikes' || trap.trap === 'crusher' ? 1.25 : 0.55, angle: trap.trap === 'saw' || trap.trap === 'spikes' || trap.trap === 'crusher' ? g.angle : trap.dir, r: 0.1, h: 0.5, dead: false, cds: {}, st: {}, team: 'ghost', dmgMul: 1, knockX: 0, knockY: 0, holdInteract: 0, eyeZ: 0.5, id: trap.id + 100000, room: trap.room };
  trap.proxy = proxy;
  if (p.ghostForm) { p.ghostForm.removed = true; p.ghostForm = null; }
  p.body = proxy;
  w.actors.push(proxy);
  w.emit('possesstrap', { x: trap.x, y: trap.y, player: p });
}

export function releaseTrap(w, p, proxy) {
  const trap = proxy.trap; trap.owner = null; trap.proxy = null; proxy.removed = true;
  spawnGhost(w, p, trap.x, trap.y, proxy.angle);
}

export function trapControl(w, proxy, intent, dt) {
  const trap = proxy.trap, p = proxy.player;
  proxy.angle += intent.turn + intent.turnRate * dt;
  if (trap.wall) { proxy.angle = trap.dir + clamp(angleDiff(proxy.angle, trap.dir), -1.0, 1.0); }
  trap.aim = proxy.angle;
  if (intent.attack || intent.attackPressed) triggerTrap(w, trap, p);
  if (intent.interact) { proxy.holdInteract += dt; if (proxy.holdInteract > 0.6) { releaseTrap(w, p, proxy); } } else proxy.holdInteract = 0;
}

export function triggerTrap(w, trap, player) {
  if (trap.state !== 'idle') return false;
  trap.state = 'windup'; trap.t = 0; trap.by = player; trap.hitTick = 0;
  if (trap.trap === 'darts') { fireDart(w, trap, player); trap.state = 'cool'; trap.t = 0; trap.cdT = trap.tdef.cd; }
  w.emit('traptrigger', { x: trap.x, y: trap.y, trap: trap.trap, prop: trap });
  return true;
}

function trapSrc(w, trap, player) {
  const godBonus = player && player.godId === 'ashkeleth' ? 1.25 : 1;
  return { src: { actor: { team: 'ghost', st: {}, player, dmgMul: godBonus, type: 'trap' }, player, kind: 'trap' }, godBonus };
}

function fireDart(w, trap, player) {
  const ang = trap.aim !== undefined ? trap.aim : trap.dir;
  const a = { x: trap.x, y: trap.y, r: 0, h: 0.6, team: 'ghost', player, st: {}, dmgMul: player && player.godId === 'ashkeleth' ? 1.25 : 1 };
  spawnProj(w, a, 'dart', ang, trap.tdef.projSpeed, trap.tdef.dmg, { knock: 0.5, range: trap.tdef.range });
  w.emit('dartfire', { x: trap.x, y: trap.y });
}

export function updateTraps(w, dt) {
  for (const trap of w.props) {
    if (trap.kind !== 'trap' || !trap.alive) continue;
    const td = trap.tdef;
    if (trap.state === 'idle') continue;
    trap.t += dt;
    const player = trap.by || trap.owner;
    const { src } = trapSrc(w, trap, player);
    const mul = src.actor.dmgMul;
    if (trap.state === 'windup') {
      if (trap.t >= td.windup) {
        trap.state = 'active'; trap.t = 0; trap.hitTick = 0; trap.hitDone = false;
        if (trap.trap === 'spikes') {
          for (const h of w.actorsInRadius(trap.x, trap.y, td.radius, (t) => hostile(w, src.actor, player, t))) dealDamage(w, h, td.dmg * mul, src, { type: 'aoe', knock: 0.8, dx: 0, dy: 0, noKnock: true, bloodMul: 1.2 });
          w.emit('spikes', { x: trap.x, y: trap.y });
        } else if (trap.trap === 'crusher') {
          for (const h of w.actorsInRadius(trap.x, trap.y, td.radius, (t) => hostile(w, src.actor, player, t))) dealDamage(w, h, td.dmg * mul, src, { type: 'aoe', noKnock: true, stun: 0.6, bloodMul: 1.2 });
          w.emit('crusher', { x: trap.x, y: trap.y });
        }
      }
    } else if (trap.state === 'active') {
      trap.hitTick += dt;
      if (trap.trap === 'flame') {
        if (trap.hitTick >= td.tick) {
          trap.hitTick -= td.tick;
          const ang = trap.aim !== undefined ? trap.aim : trap.dir;
          const dx = Math.cos(ang), dy = Math.sin(ang);
          const range = Math.min(td.range, w.rayWall(trap.x, trap.y, ang, td.range));
          for (const t of w.actors) {
            if (t.dead || !hostile(w, src.actor, player, t)) continue;
            const px = t.x - trap.x, py = t.y - trap.y, along = px * dx + py * dy; if (along < 0 || along > range) continue;
            if (Math.abs(px * dy - py * dx) > td.width / 2 + t.r) continue;
            dealDamage(w, t, td.dmg * mul, src, { type: 'aoe', noKnock: true, status: { burn: { t: 2.5, dps: 4 * mul, src } }, bloodMul: 1 });
          }
          w.emit('flame', { x: trap.x, y: trap.y, angle: ang, len: range });
        }
      } else if (trap.trap === 'saw') {
        trap.sawPos += trap.sawDir * 2.2 * dt;
        if (trap.sawPos > td.track) { trap.sawPos = td.track; trap.sawDir = -1; } else if (trap.sawPos < 0) { trap.sawPos = 0; trap.sawDir = 1; }
        const sx = trap.x + trap.sawPos, sy = trap.y;
        if (trap.hitTick >= td.tick) {
          trap.hitTick -= td.tick;
          for (const t of w.actorsInRadius(sx, sy, td.radius, (t) => hostile(w, src.actor, player, t))) dealDamage(w, t, td.dmg * mul * 0.7, src, { type: 'aoe', knock: 1, dx: t.x > sx ? 1 : -1, dy: 0, status: { bleed: { t: 3, dps: 3, src } }, bloodMul: 1 });
        }
      }
      if (trap.t >= td.active) { trap.state = 'cool'; trap.t = 0; trap.cdT = td.cd; }
    } else if (trap.state === 'cool') {
      if (trap.t >= trap.cdT) { trap.state = 'idle'; trap.t = 0; }
    }
  }
}

// ---------------- statue ----------------
export function possessStatue(w, p, g, statue) {
  statue.awake = true; statue.used = true;
  w.removeProp(statue);
  const tier = Math.min(2, Math.floor(w.match.avgTier(p)));
  const m = spawnMonster(w, statue.sub, 0, statue.x, statue.y, p, { angle: g.angle, hpMul: 1 + (w.match.heroLevel() - 1) * 0.06, dmgMul: 1 + (w.match.heroLevel() - 1) * 0.03 });
  m.statue = statue;
  becomeMonster(w, p, m);
  w.emit('statuewake', { x: statue.x, y: statue.y, player: p, monster: m });
  return m;
}

// ---------------- props ----------------
export function springChest(w, p, chest) {
  chest.sprung = true;
  const hero = w.match.heroActor();
  chest.biteT = 0.6;
  if (hero && dist(hero.x, hero.y, chest.x, chest.y) < 3.2) {
    const src = { actor: { team: 'ghost', st: {}, player: p, dmgMul: 1, type: 'trap' }, player: p, kind: 'trap' };
    dealDamage(w, hero, 20, src, { type: 'aoe', knock: 1.2, dx: hero.x - chest.x, dy: hero.y - chest.y, bloodMul: 1.2 });
  }
  w.emit('chestbite', { x: chest.x, y: chest.y, player: p });
}

export function hauntProp(w, p, pr) {
  const hero = w.match.heroActor();
  const src = { actor: { team: 'ghost', st: {}, player: p, dmgMul: 1, type: 'trap' }, player: p, kind: 'trap' };
  if (pr.kind === 'torch') { pr.out = 9; if (pr.light) pr.light.out = 9; w.emit('torchout', { x: pr.x, y: pr.y, player: p }); return; }
  const kind = pr.def.haunt;
  pr.hauntedT = 12;
  switch (kind) {
    case 'throw': {
      if (hero && dist(hero.x, hero.y, pr.x, pr.y) < 11 && w.hasLOS(pr.x, pr.y, hero.x, hero.y, false)) {
        const ang = Math.atan2(hero.y - pr.y, hero.x - pr.x);
        const a = { x: pr.x, y: pr.y, r: 0, h: 0.7, team: 'ghost', player: p, st: {}, dmgMul: 1 };
        spawnProj(w, a, 'throwprop', ang, 9, 7, { knock: 0.7 });
      }
      destroyProp(w, pr, { fromGhost: true });
      break;
    }
    case 'chandelier':
      pr.falling = 0.5; pr.used = true;
      w.emit('chandelier', { x: pr.x, y: pr.y });
      pr.player = p;
      break;
    case 'fountain':
      if (hero && dist(hero.x, hero.y, pr.x, pr.y) < 6) applyStatus(hero, 'blur', { t: 2.2 });
      w.emit('bloodspray', { x: pr.x, y: pr.y });
      for (let i = 0; i < 3; i++) spawnPickup(w, 'ecto', pr.x, pr.y, {});
      break;
    case 'coffin':
      pr.openT = 1; w.emit('coffinopen', { x: pr.x, y: pr.y });
      if (hero && dist(hero.x, hero.y, pr.x, pr.y) < 3.5) applyStatus(hero, 'stun', { t: 0.35 });
      for (let i = 0; i < 2; i++) spawnPickup(w, 'ecto', pr.x, pr.y, {});
      break;
    case 'chain': case 'scare':
      w.emit('rattle', { x: pr.x, y: pr.y });
      if (hero && dist(hero.x, hero.y, pr.x, pr.y) < 4) hero.startle = 0.5;
      spawnPickup(w, 'ecto', pr.x, pr.y, {});
      break;
    default: break;
  }
}

export function updateProps(w, dt) {
  for (const pr of w.props) {
    if (!pr.alive) continue;
    if (pr.hauntedT > 0) pr.hauntedT -= dt;
    if (pr.out > 0) { pr.out -= dt; if (pr.light) pr.light.out = pr.out; }
    if (pr.biteT > 0) pr.biteT -= dt;
    if (pr.openT > 0 && pr.kind === 'scenery') pr.openT -= dt * 0.3;
    if (pr.falling > 0) {
      pr.falling -= dt;
      if (pr.falling <= 0) {
        const src = { actor: { team: 'ghost', st: {}, player: pr.player, dmgMul: 1, type: 'trap' }, player: pr.player, kind: 'trap' };
        for (const t of w.actorsInRadius(pr.x, pr.y, 1.3, (t) => hostile(w, src.actor, pr.player, t))) dealDamage(w, t, 24, src, { type: 'aoe', stun: 0.5, noKnock: true, bloodMul: 1.2 });
        w.emit('chandeliercrash', { x: pr.x, y: pr.y });
        pr.alive = false; pr.removed = true;
      }
    }
  }
}

export function destroyProp(w, pr, o = {}) {
  if (!pr.alive) return;
  w.removeProp(pr); pr.removed = true;
  const def = pr.def || {};
  for (let i = 0; i < (def.ecto || 0); i++) spawnPickup(w, 'ecto', pr.x, pr.y, {});
  if (!o.fromGhost && def.gold && w.match.rng.chance(def.gold)) spawnPickup(w, 'gold', pr.x, pr.y, { amount: w.match.rng.int(3, 8 + w.depth * 3) });
  w.emit('propbreak', { x: pr.x, y: pr.y, sub: pr.sub, prop: pr });
}

// ---------------- monster (and boss part) control ----------------
export function monsterControl(w, a, intent, dt) {
  for (const k in a.cds) if (a.cds[k] > 0) a.cds[k] -= dt;
  a.age += dt;
  if (a.hurtT > 0) a.hurtT -= dt;
  const stunned = a.st.stun > 0 || a.stagger > 0;
  // facing
  if (intent.aimAngle !== undefined) {
    const d = angleDiff(intent.aimAngle, a.angle), lim = (a.turnRate || 7) * dt;
    a.angle += clamp(d, -lim, lim);
  } else a.angle += intent.turn + intent.turnRate * dt;
  a.angle = a.angle > Math.PI ? a.angle - TAU : a.angle < -Math.PI ? a.angle + TAU : a.angle;
  a.desiredAngle = intent.aimAngle !== undefined ? intent.aimAngle : a.angle;
  updateAbility(w, a, dt);
  if (a.atk && a.atk.ab.kind === 'melee' && !stunned) { /* melee tracking: keep aim */ }
  // abilities
  if (!a.atk && !stunned) {
    const abs = a.abilities;
    const tryAb = (ab) => ab && startAbility(w, a, ab);
    if (intent.attack) tryAb(abs[0]);
    else if (intent.alt && abs[1]) tryAb(abs[1]);
    else if ((intent.spell || intent.ability2) && abs[2]) tryAb(abs[2]);
    else if (intent.altPressed && abs[1]) tryAb(abs[1]);
  }
  // movement
  let fwd = intent.fwd, str = intent.strafe; const mag = Math.hypot(fwd, str); if (mag > 1) { fwd /= mag; str /= mag; }
  let spd = a.speed * speedMultiplier(a);
  if (a.atk) spd *= a.atk.phase === 1 ? (a.atk.ab.kind === 'leap' ? 0 : 0.2) : 0.45;
  if (intent.sprint) spd *= 1.0;
  const c = Math.cos(a.angle), s = Math.sin(a.angle);
  a.vx = (c * fwd - s * str) * spd; a.vy = (s * fwd + c * str) * spd;
  a.moving = mag > 0.1 && spd > 0.05;
  if (a.atk && a.atk.ab.kind === 'leap' && a.atk.phase === 1) { a.vx = 0; a.vy = 0; }
  applyMotion(w, a, dt);
  if (a.moving) a.walkT += dt * (spd / 2.2);
  a.room = (w.roomAt(a.x, a.y) || { id: -1 }).id;
  // release
  if (a.ctl === 'player' && a.player && a.type === 'monster') {
    if (intent.interact) { a.holdInteract = (a.holdInteract || 0) + dt; if (a.holdInteract > 0.9) { w.match.releaseMonster(a); a.holdInteract = 0; } } else a.holdInteract = 0;
  }
  w.unstick(a);
  // separation
  for (const o of w.actors) {
    if (o === a || o.dead || o.ethereal || o.type === 'ghost' || o.type === 'trapctl') continue;
    const dx = a.x - o.x, dy = a.y - o.y, rr = a.r + o.r, d2 = dx * dx + dy * dy;
    if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2), push = (rr - d) * 0.35; w.moveActor(a, (dx / d) * push, (dy / d) * push); }
  }
}
