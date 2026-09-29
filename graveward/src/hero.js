// Hero: creation, stats, controls, weapons, spells, potions, inventory, interactions.
import { clamp, angleDiff, dist, dist2, TAU, RNG } from './util.js';
import { WEAPONS, SPELLS, POTIONS, ARTIFACTS, XP_TABLE, MAX_LEVEL, heroMaxHp, heroMaxMana, heroSpeed, heroDmgMult, ARTIFACT_SLOTS } from './data.js';
import { makeWeapon, rollChestLoot, itemName } from './items.js';
import { dealDamage, startAbility, updateAbility, spawnProj, applyStatus, speedMultiplier, spawnPickup, meleeSweep, hostile, applyWeaponFx, canAct } from './combat.js';

export function newHeroRecord(rng) {
  return {
    level: 1, xp: 0, gold: 0, weapons: [makeWeapon(rng, 'rusty_sword')], weaponIdx: 0, spells: [null, null], spellIdx: 0,
    potions: { health: 1 }, potionSel: 'health', artifacts: [], keys: 0, kills: 0,
  };
}

export const spellSlots = (lv) => (lv >= 7 ? 2 : lv >= 4 ? 1 : 0);

export function refreshHeroStats(a, keepFrac = true) {
  const h = a.hero;
  const frac = a.maxHp ? a.hp / a.maxHp : 1;
  a.maxHp = a.ffa ? 110 : heroMaxHp(h.level) + (h.artifacts.includes('stoneheart') ? 30 : 0);
  if (keepFrac) a.hp = clamp(frac * a.maxHp, 1, a.maxHp);
  a.maxMana = heroMaxMana(h.level);
  a.baseSpeed = heroSpeed(h.level) * (h.artifacts.includes('boots') ? 1.15 : 1) * (a.ffa ? 1.05 : 1);
  a.dmgMul = heroDmgMult(h.level) * (h.level >= 8 ? 1.15 : 1) * (h.artifacts.includes('crown') ? 1.45 : 1);
  a.lightRadius = h.artifacts.includes('lantern') ? 4.6 : 3.2;
}

export function spawnHero(w, player, x, y, angle, hpFrac = 1, opts = {}) {
  const ffa = !!opts.ffa;
  { const f = w.freeSpot(x, y, 0.32); x = f[0]; y = f[1]; }
  const a = w.spawnActor({
    type: 'hero', player, hero: player.hero, x, y, angle, r: 0.3, h: 1, team: 'hero', ctl: 'player', ffa, mana: 0, stamina: 100, charge: 0, blocking: false, blockT: 0, dodgeCd: 0, dodgeT: 0,
    swingSide: 1, sprite: 'hero', eyeZ: 0.5, room: -1, ankhUsed: false, name: player.name,
  });
  refreshHeroStats(a, false);
  a.hp = a.maxHp * hpFrac; a.mana = a.maxMana;
  a.invuln = opts.invuln || 0;
  return a;
}

// ---------------- weapons ----------------
export function currentWeapon(a) { const h = a.hero; return h.weapons[h.weaponIdx] || h.weapons[0]; }
export function weaponDef(wp) { return WEAPONS[wp.id]; }

function buildAttack(a, heavy) {
  const wp = currentWeapon(a), def = weaponDef(wp);
  const haste = a.st.speed ? 1 / (1 + a.st.speed.amt * 0.5) : 1;
  const [wu, st, rc] = def.swing;
  const mult = heavy ? def.heavy : 1;
  const dmg = wp.dmg * (heavy ? mult : 1);
  const ab = {
    id: 'weapon', kind: def.kind === 'ranged' ? 'proj' : 'melee', dmg, windup: wu * (heavy ? 2.1 : 1) * haste, strike: st, recover: rc * (heavy ? 1.3 : 1) * haste,
    reach: def.reach, arc: heavy ? Math.max(def.arc, 130) : def.arc, knock: def.knock * (heavy ? 1.7 : 1), cd: 0, proj: def.proj, speed: def.projSpeed, count: 1,
  };
  return { ab, wp, def };
}

export function heroAttack(w, a, heavy) {
  if (a.atk || a.st.stun > 0 || a.dead) return false;
  const { ab, wp, def } = buildAttack(a, heavy);
  if (def.ammo && wp.ammo <= 0) { w.emit('empty', { target: a }); return false; }
  const fx = wp.effects || [];
  const opts = {
    backstab: def.backstab, stagger: def.stagger ? def.stagger * (heavy ? 1.5 : 1) : undefined, cleave: true, heavy,
    vamp: fx.includes('vamp') ? 0.12 : 0,
    status: fx.includes('fire') ? { burn: { t: 3, dps: 5 * a.dmgMul, src: { actor: a, player: a.player } } } : fx.includes('poison') ? { poison: { t: 4, dps: 4, src: { actor: a, player: a.player } } } : undefined,
    onHit: fx.includes('lightning') ? (t) => { if (w.match.rng.chance(0.3)) arcLightning(w, a, t, 12, 1); } : undefined,
    weaponFx: fx, swingSide: a.swingSide,
  };
  a.cds.weapon = 0;
  const ok = startAbility(w, a, ab, opts);
  if (ok) {
    a.swingSide *= -1; a.lastSwing = { heavy, side: a.swingSide, t: 0, dur: ab.windup + ab.strike + ab.recover, weapon: def.sprite };
    if (def.ammo) wp.ammo--;
    if (ab.kind === 'proj') { a.atk.opts.projFx = fx; }
    a.atk.heavy = heavy; a.atk.def = def;
  }
  return ok;
}

// Called from the combat execute step for hero ranged attacks (weapon fx)
export function heroProjectile(w, a, at) {
  const ab = at.ab;
  const p = spawnProj(w, a, ab.proj, a.angle, ab.speed, ab.dmg, { knock: 1, weaponFx: (at.opts.projFx || []), dmgMul: 1 });
  return p;
}

export function arcLightning(w, a, from, dmg, depth) {
  const src = { actor: a, player: a.player, kind: 'spell' };
  let best = null, bd = 3.6 * 3.6;
  for (const t of w.actors) { if (t === from || t.dead || !hostile(w, a, a.player, t)) continue; const d = dist2(from.x, from.y, t.x, t.y); if (d < bd && w.hasLOS(from.x, from.y, t.x, t.y, false)) { bd = d; best = t; } }
  if (!best) return;
  w.emit('chain', { x1: from.x, y1: from.y, x2: best.x, y2: best.y });
  dealDamage(w, best, dmg, src, { type: 'aoe', noKnock: true });
  if (depth < 3) arcLightning(w, a, best, dmg * 0.8, depth + 1);
}

// ---------------- spells ----------------
export function castSpell(w, a) {
  const h = a.hero;
  if (h.level < 4 || a.atk || a.st.stun > 0) return false;
  const id = h.spells[h.spellIdx]; if (!id) { w.emit('nospell', { target: a }); return false; }
  const sp = SPELLS[id];
  if (a.mana < sp.cost) { w.emit('nomana', { target: a }); return false; }
  if (a.cds['spell_' + id] > 0) return false;
  a.mana -= sp.cost; a.cds['spell_' + id] = sp.cd + 0.4;
  const sm = 1 + (h.level - 1) * 0.07;
  const src = { actor: a, player: a.player, kind: 'spell' };
  const ab = { id: 'spell', kind: 'none', windup: 0.14, strike: 0.02, recover: 0.2, cd: 0 };
  a.cds.spell = 0;
  startAbility(w, a, ab, {});
  a.lastSwing = { spell: id, t: 0, dur: 0.36, color: sp.color };
  a.atk.onExec = () => {
    switch (id) {
      case 'fire': spawnProj(w, a, 'fireball', a.angle, 12, 24 * sm, { knock: 1.5, status: { burn: { t: 3, dps: 5 * sm, src: { actor: a, player: a.player } } } }); break;
      case 'frost': {
        for (const t of w.actorsInRadius(a.x, a.y, 3.4, (t) => hostile(w, a, a.player, t))) {
          const d = Math.hypot(t.x - a.x, t.y - a.y) || 1;
          dealDamage(w, t, 9 * sm, src, { type: 'aoe', knock: 1.2, dx: (t.x - a.x) / d, dy: (t.y - a.y) / d, status: { slow: { t: 3.5, amt: 0.6 } } });
        }
        w.emit('frostnova', { x: a.x, y: a.y, radius: 3.4 });
        break;
      }
      case 'chain': {
        let best = null, bd = 64;
        for (const t of w.actors) { if (t.dead || !hostile(w, a, a.player, t)) continue; const d = dist2(a.x, a.y, t.x, t.y); const ta = Math.atan2(t.y - a.y, t.x - a.x); if (d < bd && Math.abs(angleDiff(ta, a.angle)) < 0.7 && w.hasLOS(a.x, a.y, t.x, t.y, false)) { bd = d; best = t; } }
        if (best) { w.emit('chain', { x1: a.x, y1: a.y, x2: best.x, y2: best.y }); dealDamage(w, best, 16 * sm, src, { type: 'aoe', noKnock: true }); arcLightning(w, a, best, 13 * sm, 1); }
        else w.emit('fizzle', { target: a });
        break;
      }
      case 'drain': {
        let best = null, bd = 30;
        for (const t of w.actors) { if (t.dead || !hostile(w, a, a.player, t)) continue; const d = dist2(a.x, a.y, t.x, t.y); const ta = Math.atan2(t.y - a.y, t.x - a.x); if (d < bd && Math.abs(angleDiff(ta, a.angle)) < 0.8 && w.hasLOS(a.x, a.y, t.x, t.y, false)) { bd = d; best = t; } }
        if (best) { const done = dealDamage(w, best, 17 * sm, src, { type: 'aoe', noKnock: true }); a.hp = Math.min(a.maxHp, a.hp + done); w.emit('drain', { x1: best.x, y1: best.y, x2: a.x, y2: a.y }); }
        else w.emit('fizzle', { target: a });
        break;
      }
      case 'ward': applyStatus(a, 'ward', { hp: 45 * sm, t: 8 }); w.emit('wardcast', { x: a.x, y: a.y }); break;
      case 'sight': applyStatus(a, 'sight', { t: 7 }); w.emit('sightcast', { x: a.x, y: a.y }); break;
    }
    w.emit('spellcast', { target: a, spell: id });
  };
  return true;
}

// ---------------- potions ----------------
export function usePotion(w, a) {
  const h = a.hero, id = h.potionSel;
  if (!id || !h.potions[id]) { // pick another
    const ids = Object.keys(h.potions).filter((k) => h.potions[k] > 0);
    if (!ids.length) { w.emit('nopotion', { target: a }); return false; }
    h.potionSel = ids[0];
    return usePotion(w, a);
  }
  if (a.cds.potion > 0) return false;
  h.potions[id]--; if (h.potions[id] <= 0) delete h.potions[id];
  a.cds.potion = 0.6;
  const src = { actor: a };
  switch (id) {
    case 'health': a.hp = Math.min(a.maxHp, a.hp + 50); break;
    case 'greater': a.hp = Math.min(a.maxHp, a.hp + 110); break;
    case 'speed': applyStatus(a, 'speed', { t: 15, amt: 0.4 }); break;
    case 'might': applyStatus(a, 'might', { t: 15 }); break;
    case 'ironskin': applyStatus(a, 'ironskin', { t: 15 }); break;
    case 'shadow': applyStatus(a, 'shadow', { t: 12 }); break;
    case 'clarity': a.mana = a.maxMana; break;
    case 'antidote': delete a.st.poison; delete a.st.burn; delete a.st.curse; delete a.st.bleed; delete a.st.blur; break;
  }
  if (!h.potions[h.potionSel]) { const ids = Object.keys(h.potions); h.potionSel = ids[0] || null; }
  w.emit('potion', { target: a, potion: id });
  return true;
}
export function cyclePotion(a) {
  const h = a.hero; const ids = Object.keys(h.potions).filter((k) => h.potions[k] > 0); if (!ids.length) return;
  const i = ids.indexOf(h.potionSel); h.potionSel = ids[(i + 1) % ids.length];
}

// ---------------- progression ----------------
export function grantXp(match, player, amount) {
  const h = player.hero; if (!h || h.level >= MAX_LEVEL) return;
  h.xp += amount;
  while (h.level < MAX_LEVEL && h.xp >= XP_TABLE[h.level + 1]) { h.level++; match.onLevelUp(player); }
}
export function applyLevelUp(w, a) {
  const h = a.hero;
  const oldMax = a.maxHp;
  refreshHeroStats(a, false);
  a.hp = Math.min(a.maxHp, a.hp + (a.maxHp - oldMax) + a.maxHp * 0.25);
  a.mana = a.maxMana;
  if (h.level === 4 && !h.spells[0]) h.spells[0] = w.match.rng.pick(['fire', 'frost', 'chain', 'drain']);
  w.emit('levelup', { target: a, level: h.level, x: a.x, y: a.y });
}

// ---------------- inventory ----------------
export function giveItem(w, a, it) {
  const h = a.hero;
  switch (it.type) {
    case 'gold': { const amt = Math.round(it.amount * (h.artifacts.includes('scarab') ? 1.35 : 1)); h.gold += amt; w.emit('pickup', { target: a, what: 'gold', amount: amt }); return true; }
    case 'heart': a.hp = Math.min(a.maxHp, a.hp + (it.amount || 25)); w.emit('pickup', { target: a, what: 'heart' }); return true;
    case 'potion': h.potions[it.id] = (h.potions[it.id] || 0) + 1; if (!h.potionSel) h.potionSel = it.id; w.emit('pickup', { target: a, what: 'potion', name: POTIONS[it.id].name }); return true;
    case 'spell': {
      const slots = spellSlots(h.level);
      if (h.spells.includes(it.id)) { a.mana = a.maxMana; w.emit('pickup', { target: a, what: 'spell', name: SPELLS[it.id].name + ' (recharged)' }); return true; }
      let placed = false;
      for (let i = 0; i < 2; i++) if (!h.spells[i] && (i < Math.max(1, slots) || true)) { h.spells[i] = it.id; placed = true; break; }
      if (!placed) h.spells[h.spellIdx] = it.id;
      w.emit('pickup', { target: a, what: 'spell', name: SPELLS[it.id].name });
      return true;
    }
    case 'weapon': {
      if (h.weapons.length >= 4) { // drop weakest non-equipped
        let worst = -1, wd = 1e9; h.weapons.forEach((x, i) => { if (i !== h.weaponIdx && x.dmg < wd) { wd = x.dmg; worst = i; } });
        if (worst >= 0) h.weapons.splice(worst, 1); if (h.weaponIdx >= h.weapons.length) h.weaponIdx = 0;
      }
      h.weapons.push(it);
      const cur = currentWeapon(a);
      if (it.dmg > cur.dmg * 1.15 && WEAPONS[it.id].kind === WEAPONS[cur.id].kind) h.weaponIdx = h.weapons.length - 1;
      w.emit('pickup', { target: a, what: 'weapon', name: it.name });
      return true;
    }
    case 'artifact': {
      if (h.artifacts.includes(it.id)) { h.gold += 50; return true; }
      if (h.artifacts.length >= ARTIFACT_SLOTS) h.artifacts.shift();
      h.artifacts.push(it.id); refreshHeroStats(a);
      w.emit('pickup', { target: a, what: 'artifact', name: ARTIFACTS[it.id].name });
      return true;
    }
    case 'knife': { const wp = h.weapons.find((x) => x.id === 'throwing_knives'); if (wp) { wp.ammo = Math.min(20, wp.ammo + (it.amount || 1)); return true; } return false; }
    default: return false;
  }
}

export function collectPickups(w, a) {
  const h = a.hero;
  for (const p of w.pickups) {
    if (p.dead || p.kind === 'ecto') continue;
    const d2 = dist2(a.x, a.y, p.x, p.y);
    const magnet = p.kind === 'gold' || p.kind === 'heart' ? 2.2 : 0.9;
    if (d2 < magnet * magnet && p.z <= 0.25) { // drift toward hero
      const d = Math.sqrt(d2) || 1; p.x += ((a.x - p.x) / d) * 0.09; p.y += ((a.y - p.y) / d) * 0.09;
    }
    if (d2 < 0.5 * 0.5) {
      let ok = true;
      switch (p.kind) {
        case 'gold': ok = giveItem(w, a, { type: 'gold', amount: p.data.amount }); break;
        case 'heart': if (a.hp >= a.maxHp) ok = false; else ok = giveItem(w, a, { type: 'heart', amount: p.data.amount }); break;
        case 'knife': ok = giveItem(w, a, { type: 'knife', amount: 1 }); break;
        case 'item': ok = giveItem(w, a, p.data.item); break;
        default: ok = false;
      }
      if (ok) { p.dead = true; w.emit('pickupsfx', { x: p.x, y: p.y, kind: p.kind }); }
    }
  }
}

// ---------------- interaction ----------------
export function findInteractable(w, a) {
  let best = null, bd = 1.5;
  for (const p of w.props) {
    if (!p.alive) continue;
    if (p.kind !== 'chest' && p.kind !== 'shop' && p.kind !== 'portal' && p.kind !== 'fountainHeal') continue;
    if (p.kind === 'chest' && p.opened) continue;
    if (p.kind === 'shop' && p.sold) continue;
    const d = dist(a.x, a.y, p.x, p.y) - (p.kind === 'portal' ? 0.8 : 0);
    if (d > bd) continue;
    const ang = Math.atan2(p.y - a.y, p.x - a.x);
    if (Math.abs(angleDiff(ang, a.angle)) > 1.1 && d > 0.7) continue;
    bd = d; best = p;
  }
  return best;
}

export function heroInteract(w, a) {
  const p = findInteractable(w, a); if (!p) return false;
  const h = a.hero;
  if (p.kind === 'chest') {
    if (p.locked && !h.artifacts.includes('vaultkey') && h.keys <= 0) { w.match.toastFor(a.player, 'Locked. Needs a Vault Key.'); w.emit('locked', { target: a }); return true; }
    if (p.locked && !h.artifacts.includes('vaultkey')) h.keys--;
    p.opened = true; p.locked = false; p.openT = 0;
    const loot = rollChestLoot(w.match.rng, w.depth, p.tier || 0);
    if (p.trapped && w.match.rng.chance(0.6)) { dealDamage(w, a, 14, { actor: null, player: null, kind: 'env' }, { noKnock: true, bypassBlock: true }); applyStatus(a, 'poison', { t: 4, dps: 4, src: {} }); w.emit('chesttrap', { x: p.x, y: p.y }); }
    for (const it of loot) {
      if (it.type === 'gold') { const n = 3 + ((it.amount / 15) | 0) % 4; for (let i = 0; i < n; i++) spawnPickup(w, 'gold', p.x, p.y, { amount: Math.max(1, Math.round(it.amount / n)) }); }
      else if (it.type === 'heart') spawnPickup(w, 'heart', p.x, p.y, { amount: it.amount });
      else spawnPickup(w, 'item', p.x, p.y, { item: it });
    }
    w.emit('chestopen', { x: p.x, y: p.y, target: a, prop: p });
    w.match.stats.chests++;
    return true;
  }
  if (p.kind === 'shop') {
    const it = p.item;
    if (h.gold < it.price) { w.match.toastFor(a.player, 'Not enough gold (' + it.price + ')'); w.emit('nogold', { target: a }); return true; }
    h.gold -= it.price; p.sold = true; giveItem(w, a, it); w.emit('buy', { target: a, x: p.x, y: p.y, item: it });
    w.match.toastFor(a.player, 'Bought ' + itemName(it)); return true;
  }
  if (p.kind === 'portal') { w.match.tryEnterPortal(w, a, p); return true; }
  return false;
}

// ---------------- per-tick control ----------------
export function heroControl(w, a, intent, dt) {
  const h = a.hero, lv = a.ffa ? 10 : h.level;
  // cooldown decay
  for (const k in a.cds) if (a.cds[k] > 0) a.cds[k] -= dt;
  if (a.dodgeCd > 0) a.dodgeCd -= dt;
  if (a.mana < a.maxMana) a.mana = Math.min(a.maxMana, a.mana + (2.6 + h.level * 0.25) * dt);
  a.swingT = (a.swingT || 0) + dt;
  if (a.lastSwing) a.lastSwing.t += dt;
  if (a.hurtT > 0) a.hurtT -= dt;

  // look
  if (intent.aimAngle !== undefined) { const lim = 8 * dt; a.angle += clamp(angleDiff(intent.aimAngle, a.angle), -lim, lim); }
  else a.angle += intent.turn + intent.turnRate * dt;
  a.angle = a.angle > Math.PI ? a.angle - TAU : a.angle < -Math.PI ? a.angle + TAU : a.angle;

  updateAbility(w, a, dt);
  if (a.atk && a.atk.executed && !a.atk.execHero) {
    a.atk.execHero = true;
    if (a.atk.ab.kind === 'proj' && a.atk.ab.id === 'weapon') { /* projectile already spawned by executeAbility */ }
    if (a.atk.onExec) a.atk.onExec();
  }

  // stun / dead
  const stunned = a.st.stun > 0;
  // block
  const canBlock = (lv >= 6 || a.ffa) && !a.atk && !stunned && a.dodgeT <= 0;
  const wasBlocking = a.blocking;
  a.blocking = canBlock && intent.alt;
  if (a.blocking) a.blockT = wasBlocking ? a.blockT + dt : 0; else a.blockT = 99;

  // spell input takes priority over swings that would otherwise claim the ability slot
  if (intent.spell && !stunned) castSpell(w, a);
  // attack input
  const def = weaponDef(currentWeapon(a));
  if (!stunned && !a.atk && a.dodgeT <= 0) {
    if (def.kind === 'ranged') {
      if (intent.attack) heroAttack(w, a, false);
    } else if (lv < 3 && !a.ffa) {
      if (intent.attack) heroAttack(w, a, false);
    } else {
      if (intent.attack && !a.blocking) a.charge = (a.charge || 0) + dt; // charging
      if (intent.attackReleased && (a.charge || 0) > 0) {
        const heavy = a.charge >= 0.42;
        heroAttack(w, a, heavy);
        a.charge = 0;
      }
      if (!intent.attack && !intent.attackReleased) a.charge = 0;
    }
  } else if (!intent.attack) a.charge = 0;
  if (intent.spellNext) { h.spellIdx = (h.spellIdx + 1) % 2; if (!h.spells[h.spellIdx] && h.spells[1 - h.spellIdx]) h.spellIdx = 1 - h.spellIdx; }
  if (intent.potion && !stunned) usePotion(w, a);
  if (intent.potionNext) cyclePotion(a);
  if (intent.swap && !a.atk) { h.weaponIdx = (h.weaponIdx + 1) % h.weapons.length; w.emit('swap', { target: a }); a.charge = 0; }
  if (intent.interact && !stunned) heroInteract(w, a);

  // movement
  let fwd = intent.fwd, str = intent.strafe;
  const mag = Math.hypot(fwd, str);
  if (mag > 1) { fwd /= mag; str /= mag; }
  let spd = a.baseSpeed * speedMultiplier(a);
  const sprinting = intent.sprint && mag > 0.1 && a.stamina > 0 && !a.atk && !a.blocking && fwd > 0;
  if (sprinting) { spd *= 1.35; a.stamina = Math.max(0, a.stamina - 22 * dt); a.sprintRest = 1.0; }
  else { a.sprintRest = Math.max(0, (a.sprintRest || 0) - dt); if (a.sprintRest <= 0) a.stamina = Math.min(100, a.stamina + 30 * dt); }
  if (a.atk) spd *= a.atk.phase === 1 ? 0.35 : 0.7;
  if (a.blocking) spd *= 0.5;
  if ((a.charge || 0) > 0.05) spd *= 0.6;
  if (stunned) spd *= 0.1;
  const c = Math.cos(a.angle), s = Math.sin(a.angle);
  let vx = (c * fwd - s * str) * spd, vy = (s * fwd + c * str) * spd;
  // dodge
  if ((lv >= 5 || a.ffa) && intent.dodge && a.dodgeCd <= 0 && !stunned && a.dodgeT <= 0) {
    let dx = c * fwd - s * str, dy = s * fwd + c * str;
    if (Math.hypot(dx, dy) < 0.1) { dx = -c; dy = -s; }
    const n = Math.hypot(dx, dy); a.dodgeDir = [dx / n, dy / n]; a.dodgeT = 0.24; a.dodgeCd = 1.1; a.invuln = Math.max(a.invuln, 0.28); a.atk = null; a.charge = 0;
    w.emit('dodge', { target: a });
  }
  if (a.dodgeT > 0) { a.dodgeT -= dt; vx = a.dodgeDir[0] * 9.5; vy = a.dodgeDir[1] * 9.5; }
  a.moving = mag > 0.1 || a.dodgeT > 0;
  a.vx = vx; a.vy = vy;
  applyMotion(w, a, dt);
  w.unstick(a);
  if (a.moving) a.walkT += dt * (sprinting ? 1.4 : 1) * (spd / 3.5);
  collectPickups(w, a);
}

export function applyMotion(w, a, dt) {
  const kx = a.knockX * dt, ky = a.knockY * dt;
  w.moveActor(a, a.vx * dt + kx, a.vy * dt + ky);
  const decay = Math.exp(-9 * dt);
  a.knockX *= decay; a.knockY *= decay;
  if (Math.abs(a.knockX) < 0.02) a.knockX = 0; if (Math.abs(a.knockY) < 0.02) a.knockY = 0;
}
