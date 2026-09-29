// Item instance generation: weapons (rarity + effects), chest loot, shop stock.
import { WEAPONS, RARITY, WEAPON_EFFECTS, SPELLS, POTIONS, ARTIFACTS, SHOP_POTIONS, LOOT } from './data.js';

export function makeWeapon(rng, id, rarity = 'common') {
  const base = WEAPONS[id];
  const r = RARITY[rarity];
  const effects = [];
  const pool = Object.keys(WEAPON_EFFECTS);
  for (let i = 0; i < r.effects; i++) { const e = rng.pick(pool); if (!effects.includes(e)) effects.push(e); }
  let name = base.name;
  if (effects.length) name = WEAPON_EFFECTS[effects[0]].name + ' ' + name;
  if (rarity === 'legendary') name = 'Legendary ' + name;
  return { type: 'weapon', id, rarity, effects, name, dmg: base.dmg * r.mult, ammo: base.ammo || 0, uid: rng.int(1, 1e9) };
}

export function randomWeapon(rng, depth, tier = 0) {
  const ids = Object.keys(WEAPONS).filter((k) => k !== 'rusty_sword');
  const id = rng.pick(ids);
  const roll = rng.next() + depth * 0.045 + tier * 0.12;
  const rarity = roll > 1.05 ? 'legendary' : roll > 0.68 ? 'rare' : 'common';
  return makeWeapon(rng, id, rarity);
}

export function rollChestLoot(rng, depth, tier = 0) {
  const out = [];
  const [gmin, gmax] = LOOT.goldRange(depth);
  const w = LOOT.chestWeights(depth);
  const draws = 1 + (tier > 0 ? 1 : 0) + (rng.chance(0.3) ? 1 : 0);
  for (let i = 0; i < draws; i++) {
    const kinds = Object.keys(w);
    const kind = rng.weighted(kinds, (k) => w[k]);
    if (kind === 'gold') out.push({ type: 'gold', amount: rng.int(gmin, gmax) * (1 + tier * 0.6) | 0 });
    else if (kind === 'potion') out.push({ type: 'potion', id: rng.weighted(SHOP_POTIONS, (k) => (k === 'health' ? 3 : k === 'greater' ? 1 : 1.4)) });
    else if (kind === 'weapon') out.push(randomWeapon(rng, depth, tier));
    else if (kind === 'spell') out.push({ type: 'spell', id: rng.pick(Object.keys(SPELLS)) });
    else out.push({ type: 'artifact', id: rng.pick(Object.keys(ARTIFACTS).filter((a) => a !== 'crown' || depth > 1)) });
  }
  if (rng.chance(0.35)) out.push({ type: 'heart', amount: 25 });
  return out;
}

export function itemName(it) {
  if (!it) return '';
  switch (it.type) {
    case 'weapon': return it.name;
    case 'spell': return SPELLS[it.id].name + ' Scroll';
    case 'potion': return POTIONS[it.id].name;
    case 'artifact': return ARTIFACTS[it.id].name;
    case 'gold': return it.amount + ' gold';
    case 'heart': return 'Heart';
    default: return it.type;
  }
}
export function itemPrice(it, depth) {
  const scale = 1 + depth * 0.12;
  switch (it.type) {
    case 'weapon': return Math.round(WEAPONS[it.id].price * (RARITY[it.rarity].mult ** 2) * scale);
    case 'spell': return Math.round(SPELLS[it.id].price * scale);
    case 'potion': return Math.round(POTIONS[it.id].price * (1 + depth * 0.08));
    case 'artifact': return Math.round(ARTIFACTS[it.id].price * scale);
    default: return 0;
  }
}

export function shopStock(rng, depth, count = 6) {
  const items = [];
  items.push({ type: 'potion', id: 'health' });
  items.push({ type: 'potion', id: rng.pick(['greater', 'speed', 'might', 'ironskin', 'clarity', 'shadow']) });
  items.push(randomWeapon(rng, depth, 1));
  items.push({ type: 'spell', id: rng.pick(Object.keys(SPELLS)) });
  items.push({ type: 'artifact', id: rng.pick(Object.keys(ARTIFACTS).filter((a) => a !== 'crown')) });
  while (items.length < count) {
    const roll = rng.next();
    if (roll < 0.4) items.push({ type: 'potion', id: rng.pick(SHOP_POTIONS) });
    else if (roll < 0.65) items.push(randomWeapon(rng, depth, 1));
    else if (roll < 0.85) items.push({ type: 'artifact', id: rng.pick(Object.keys(ARTIFACTS)) });
    else items.push({ type: 'spell', id: rng.pick(Object.keys(SPELLS)) });
  }
  return items.slice(0, count).map((it) => Object.assign(it, { price: itemPrice(it, depth) }));
}
