// Sprite registry: lazily paints and caches frames. Everything is procedural.
import * as M from './sprites_mon.js';
import * as X from './sprites_misc.js';
import { PC, H } from './pixart.js';
import { POTIONS, SPELLS, ARTIFACTS } from './data.js';

const cache = new Map();
const memo = (key, fn) => { let v = cache.get(key); if (!v) { const r = fn(); v = r.frame ? r.frame() : r; cache.set(key, v); } return v; };

const MON_PAINT = {
  skeleton: (t, p) => M.paintSkeleton(t, p), archer: (t, p) => M.paintArcher(t, p), brute: (t, p) => M.paintBrute(t, p), crawler: (t, p) => M.paintCrawler(t, p),
  screamer: (t, p) => M.paintScreamer(t, p), bloat: (t, p) => M.paintBloat(t, p), mummy: (t, p) => M.paintMummy(t, p), scarab: (t, p) => M.paintScarab(t, p),
  priest: (t, p) => M.paintPriest(t, p), slime: (t, p) => M.paintSlime(t, p), sentinel: (t, p) => M.paintSentinel(p), gargoyle: (t, p) => M.paintGargoyle(p),
  golem: (t, p) => M.paintGolem(p), wisp: (t, p) => M.paintWisp(p),
};

// state: 'idle' | 'walk' | 'atk' | 'hurt' | 'dead'; n = frame index within state
export function monsterFrame(sprite, tier, state, n) {
  const key = `m|${sprite}|${tier}|${state}|${n}`;
  const hit = cache.get(key); if (hit) return hit;
  const paint = MON_PAINT[sprite] || MON_PAINT.skeleton;
  if (state === 'dead') {
    const base = paint(tier, M.pose('idle', 0));
    const fr = M.deathFrames(base);
    for (let i = 0; i < 3; i++) cache.set(`m|${sprite}|${tier}|dead|${i}`, fr[i].frame());
    return cache.get(key);
  }
  const f = paint(tier, M.pose(state, n)).frame();
  cache.set(key, f); return f;
}
export function heroFrame(colorHex, state, n) { return memo(`h|${colorHex}|${state}|${n}`, () => M.paintHero(colorHex, M.pose(state, n))); }
export function heroDeadFrame(colorHex, n) {
  const key = `h|${colorHex}|dead|${n}`; if (cache.has(key)) return cache.get(key);
  const fr = M.deathFrames(M.paintHero(colorHex, M.pose('idle', 0)));
  for (let i = 0; i < 3; i++) cache.set(`h|${colorHex}|dead|${i}`, fr[i].frame());
  return cache.get(key);
}
export function wispFrame(n) { return memo('wisp|' + n, () => M.paintWisp(M.pose('walk', n))); }
export function statueFrame(sub) { return memo('statue|' + sub, () => X.paintStatueDormant(MON_PAINT[sub](0, M.pose('idle', 0)))); }

export function propFrame(kind, sub, state = 0, t = 0) {
  const tf = Math.floor(t * 8) % 3;
  switch (kind) {
    case 'torch': return memo('torch|' + tf, () => X.paintTorch(tf * 1.7));
    case 'sign': return memo('sign', () => X.paintSign());
    case 'chest': return memo(`chest|${state}|${sub}`, () => X.paintChest(!!state, sub));
    case 'crystal': return memo('crystal|' + tf, () => X.paintCrystal(tf * 0.9));
    case 'shop': return memo('shopstand', () => X.paintShopStand());
    case 'portal': return memo('portal|' + (Math.floor(t * 6) % 6), () => X.paintPortal((Math.floor(t * 6) % 6) * 0.5));
    case 'trap': return memo(`trap|${sub}|${state}`, () => X.paintTrap(sub, state));
    case 'fountainHeal': return memo('fountainheal|' + tf, () => X.paintFountain(tf, true));
    case 'scenery':
      switch (sub) {
        case 'pot': return memo('pot', () => X.paintPot('pot'));
        case 'jar': return memo('jar', () => X.paintPot('jar'));
        case 'crate': return memo('crate', () => X.paintCrate());
        case 'urn': return memo('urn', () => X.paintUrn());
        case 'bones': return memo('bones', () => X.paintBones('bones'));
        case 'skullpile': return memo('skullpile', () => X.paintBones('skull'));
        case 'coffin': return memo('coffin|' + state, () => X.paintCoffin(!!state));
        case 'cobweb': return memo('cobweb', () => { const pc = new PC(36, 36); for (let i = 0; i < 6; i++) { const a = i * 0.52 - 0.2; pc.line(0, 0, Math.cos(a) * 34, Math.sin(a) * 34, H('#c8c8d0')); } for (let r = 8; r < 32; r += 7) for (let i = 0; i < 5; i++) { const a0 = i * 0.52 - 0.2, a1 = a0 + 0.52; pc.line(Math.cos(a0) * r, Math.sin(a0) * r, Math.cos(a1) * r, Math.sin(a1) * r, H('#a8a8b4')); } return pc; });
        case 'pillar': return memo('pillar', () => X.paintPillar());
        case 'sarcophagus': return memo('sarco', () => X.paintSarcophagus());
        case 'chains': return memo('chains', () => X.paintChains());
        case 'fountain': return memo('fountain|' + tf, () => X.paintFountain(tf, false));
        case 'chandelier': return memo('chandelier', () => X.paintChandelier());
        case 'brazier': return memo('brazier|' + tf, () => X.paintBrazier(tf * 1.5));
        default: return memo('pot', () => X.paintPot('pot'));
      }
    default: return memo('pot', () => X.paintPot('pot'));
  }
}

export function pickupFrame(p, t) {
  const tf = Math.floor(t * 6) % 3;
  switch (p.kind) {
    case 'gold': return memo('gold', () => X.paintGold());
    case 'heart': return memo('heart', () => X.paintHeart());
    case 'ecto': return memo('ecto|' + tf, () => X.paintEcto(tf * 0.7));
    case 'knife': return memo('knifepick', () => X.paintKnife());
    case 'item': return itemIcon(p.data.item, t);
    default: return memo('gold', () => X.paintGold());
  }
}
export function itemIcon(it, t = 0) {
  switch (it.type) {
    case 'potion': return memo('potion|' + it.id, () => X.paintPotion(POTIONS[it.id].color));
    case 'spell': return memo('scroll|' + it.id, () => X.paintScroll(SPELLS[it.id].color));
    case 'weapon': return memo('wicon|' + it.id + it.rarity, () => X.paintWeaponIcon(it.id));
    case 'artifact': return memo('art|' + (Math.floor(t * 4) % 4), () => X.paintArtifact(Math.floor(t * 4) % 4));
    case 'gold': return memo('gold', () => X.paintGold());
    case 'heart': return memo('heart', () => X.paintHeart());
    default: return memo('gold', () => X.paintGold());
  }
}

export function projFrame(kind, t) {
  const animated = kind === 'fireball' || kind === 'curseorb' || kind === 'spark';
  return memo('proj|' + kind + (animated ? '|' + (Math.floor(t * 12) % 4) : ''), () => X.paintProj(kind, animated ? (Math.floor(t * 12) % 4) * 0.4 : 0));
}

export function bossBodyFrame(id, exposed, t) { return memo(`bb|${id}|${exposed ? 1 : 0}|${Math.floor(t * 3) % 2}`, () => X.paintBossBody(id, { exposed, t: Math.floor(t * 3) % 2 })); }
export function bossPartFrame(spriteId, atk, extra = {}) {
  const variant = spriteId === 'jackalHeadFire' ? 'fire' : spriteId === 'jackalHeadHowl' ? 'howl' : 'fang';
  const id = spriteId.startsWith('jackalHead') ? 'jackalHead' : spriteId;
  return memo(`bp|${spriteId}|${atk ? 1 : 0}|${extra.unwrapped ? 1 : 0}`, () => X.paintBossPart(id, variant, { atk, unwrapped: extra.unwrapped }));
}

export function weaponFrame(sprite, color) { return memo('w|' + sprite + (color || ''), () => X.paintWeapon(sprite, { color })); }
export function spellHandFrame(color) { return memo('w|spell' + color, () => X.paintWeapon('spell', { color })); }

// Pre-warm the most common frames so the first fight doesn't hitch.
export function warm() {
  for (const s of ['skeleton', 'archer', 'brute', 'crawler', 'screamer', 'bloat', 'mummy', 'scarab', 'priest', 'slime']) {
    for (let t = 0; t < 3; t++) { monsterFrame(s, t, 'idle', 0); monsterFrame(s, t, 'walk', 0); monsterFrame(s, t, 'atk', 0); monsterFrame(s, t, 'atk', 1); }
  }
}

export function glowFrame(colorHex) { return memo('glow|' + colorHex, () => X.paintGlow(colorHex)); }
