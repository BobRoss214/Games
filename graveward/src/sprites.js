// Sprite registry: lazily paints and caches frames. Everything is procedural.
import * as M from './sprites_mon.js';
import * as X from './sprites_misc.js';
import { PC, H } from './pixart.js';
import { paintGib } from './sprites_gore.js';
import { shadeBase, woundify } from './sprites_real.js';
import { hashSeed } from './util.js';
import { POTIONS, SPELLS, ARTIFACTS } from './data.js';

const WEB1 = ((130 << 24) | (0xd0 << 16) | (0xc8 << 8) | 0xc8) >>> 0, WEB2 = ((95 << 24) | (0xb4 << 16) | (0xa8 << 8) | 0xa8) >>> 0; // thin, see-through (the renderer dithers partial alpha)
const cache = new Map();
const memo = (key, fn) => { let v = cache.get(key); if (!v) { const r = fn(); v = r.frame ? r.frame() : r; cache.set(key, v); } return v; };

const MON_PAINT = {
  skeleton: (t, p) => M.paintSkeleton(t, p), archer: (t, p) => M.paintArcher(t, p), brute: (t, p) => M.paintBrute(t, p), crawler: (t, p) => M.paintCrawler(t, p),
  screamer: (t, p) => M.paintScreamer(t, p), bloat: (t, p) => M.paintBloat(t, p), mummy: (t, p) => M.paintMummy(t, p), scarab: (t, p) => M.paintScarab(t, p),
  priest: (t, p) => M.paintPriest(t, p), slime: (t, p) => M.paintSlime(t, p), sentinel: (t, p) => M.paintSentinel(p), gargoyle: (t, p) => M.paintGargoyle(p),
  golem: (t, p) => M.paintGolem(p), wisp: (t, p) => M.paintWisp(p),
};

const KIND = { bone: 'bone', prop: 'plain', hero: 'plain', weapon: 'plain', skeleton: 'bone', archer: 'bone', sentinel: 'bone', gargoyle: 'bone', golem: 'bone', slime: 'ooze', wisp: 'ooze', mummy: 'cloth', priest: 'cloth' };
export const REALISM = { on: true }; // flip off to see the original flat sprites
const baseCache = new Map(); // shaded sprite, before wounds: new wound levels only redo the cheap part
const real = (pc, key, sprite, wound) => {
  if (!REALISM.on) return (typeof pc === 'function' ? pc() : pc).frame();
  let ctx = baseCache.get(key);
  if (!ctx) { ctx = shadeBase(typeof pc === 'function' ? pc() : pc, { seed: hashSeed(key), kind: KIND[sprite] || 'flesh' }); baseCache.set(key, ctx); }
  return woundify(ctx, { seed: hashSeed(key), wound }).frame();
};

// state: 'idle' | 'walk' | 'atk' | 'hurt' | 'dead'; n = frame index within state; wound 0..3 = how torn up it looks
export function monsterFrame(sprite, tier, state, n, wound = 0) {
  if (state === 'dead') wound = 3;
  const key = `m|${sprite}|${tier}|${state}|${n}|${wound}`;
  const hit = cache.get(key); if (hit) return hit;
  const paint = MON_PAINT[sprite] || MON_PAINT.skeleton;
  if (state === 'dead') {
    const base = paint(tier, M.pose('idle', 0));
    const fr = M.deathFrames(base);
    for (let i = 0; i < 3; i++) cache.set(`m|${sprite}|${tier}|dead|${i}|3`, real(fr[i], `${sprite}${tier}dead${i}`, sprite, 3));
    return cache.get(key);
  }
  const f = real(() => paint(tier, M.pose(state, n)), `${sprite}${tier}${state}${n}`, sprite, wound);
  cache.set(key, f); return f;
}
export function heroFrame(colorHex, state, n) { return memo(`h|${colorHex}|${state}|${n}`, () => ({ frame: () => real(M.paintHero(colorHex, M.pose(state, n)), `hero${colorHex}${state}${n}`, 'hero', 0) })); }
export function heroDeadFrame(colorHex, n) {
  const key = `h|${colorHex}|dead|${n}`; if (cache.has(key)) return cache.get(key);
  const fr = M.deathFrames(M.paintHero(colorHex, M.pose('idle', 0)));
  for (let i = 0; i < 3; i++) cache.set(`h|${colorHex}|dead|${i}`, real(fr[i], `herodead${colorHex}${i}`, 'hero', 3));
  return cache.get(key);
}
export function wispFrame(n) { return memo('wisp|' + n, () => M.paintWisp(M.pose('walk', n))); }
export function statueFrame(sub) { return rp('statue|' + sub, () => X.paintStatueDormant(MON_PAINT[sub](0, M.pose('idle', 0))), 'bone'); }

const rp = (key, fn, kind) => memo(key, () => ({ frame: () => real(fn(), key, kind, 0) })); // props get the same shading pass as creatures
export function propFrame(kind, sub, state = 0, t = 0) {
  const tf = Math.floor(t * 8) % 3;
  switch (kind) {
    case 'torch': return memo('torch|' + tf, () => X.paintTorch(tf * 1.7));
    case 'sign': return memo('sign', () => X.paintSign());
    case 'chest': return rp(`chest|${state}|${sub}`, () => X.paintChest(!!state, sub), 'prop');
    case 'crystal': return memo('crystal|' + tf, () => X.paintCrystal(tf * 0.9));
    case 'shop': return rp('shopstand', () => X.paintShopStand(), 'prop');
    case 'portal': return memo('portal|' + (Math.floor(t * 6) % 6), () => X.paintPortal((Math.floor(t * 6) % 6) * 0.5));
    case 'trap': return rp(`trap|${sub}|${state}`, () => X.paintTrap(sub, state), 'prop');
    case 'fountainHeal': return memo('fountainheal|' + tf, () => X.paintFountain(tf, true));
    case 'scenery':
      switch (sub) {
        case 'pot': return rp('pot', () => X.paintPot('pot'), 'prop');
        case 'jar': return rp('jar', () => X.paintPot('jar'), 'prop');
        case 'crate': return rp('crate', () => X.paintCrate(), 'prop');
        case 'urn': return rp('urn', () => X.paintUrn(), 'bone');
        case 'bones': return rp('bones', () => X.paintBones('bones'), 'bone');
        case 'skullpile': return rp('skullpile', () => X.paintBones('skull'), 'bone');
        case 'coffin': return rp('coffin|' + state, () => X.paintCoffin(!!state), 'bone');
        case 'cobweb': return memo('cobweb', () => { const pc = new PC(36, 36); for (let i = 0; i < 6; i++) { const a = i * 0.52 - 0.2; pc.line(0, 0, Math.cos(a) * 34, Math.sin(a) * 34, WEB1); } for (let r = 8; r < 32; r += 7) for (let i = 0; i < 5; i++) { const a0 = i * 0.52 - 0.2, a1 = a0 + 0.52; pc.line(Math.cos(a0) * r, Math.sin(a0) * r, Math.cos(a1) * r, Math.sin(a1) * r, WEB2); } return pc; });
        case 'pillar': return rp('pillar', () => X.paintPillar(), 'bone');
        case 'sarcophagus': return rp('sarco', () => X.paintSarcophagus(), 'bone');
        case 'chains': return rp('chains', () => X.paintChains(), 'prop');
        case 'fountain': return rp('fountain|' + tf, () => X.paintFountain(tf, false), 'bone');
        case 'chandelier': return rp('chandelier', () => X.paintChandelier(), 'prop');
        case 'brazier': return rp('brazier|' + tf, () => X.paintBrazier(tf * 1.5), 'prop');
        default: return rp('pot', () => X.paintPot('pot'), 'prop');
      }
    default: return rp('pot', () => X.paintPot('pot'), 'prop');
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

export function bossBodyFrame(id, exposed, t) { const tt = Math.floor(t * 3) % 2; return memo(`bb|${id}|${exposed ? 1 : 0}|${tt}`, () => ({ frame: () => real(X.paintBossBody(id, { exposed, t: tt }), `boss${id}${exposed}${tt}`, 'golem', 0) })); }
export function bossPartFrame(spriteId, atk, extra = {}) {
  const variant = spriteId === 'jackalHeadFire' ? 'fire' : spriteId === 'jackalHeadHowl' ? 'howl' : 'fang';
  const id = spriteId.startsWith('jackalHead') ? 'jackalHead' : spriteId;
  return memo(`bp|${spriteId}|${atk ? 1 : 0}|${extra.unwrapped ? 1 : 0}`, () => ({ frame: () => real(X.paintBossPart(id, variant, { atk, unwrapped: extra.unwrapped }), `bp${spriteId}${atk}`, 'golem', 0) }));
}

export function weaponFrame(sprite, color) { return memo('w|' + sprite + (color || ''), () => ({ frame: () => real(X.paintWeapon(sprite, { color }), 'weapon' + sprite, 'weapon', 0) })); }
export function spellHandFrame(color) { return memo('w|spell' + color, () => ({ frame: () => real(X.paintWeapon('spell', { color }), 'weaponspell', 'weapon', 0) })); }

// Pre-warm the most common frames so the first fight doesn't hitch.
export function warm() {
  for (const s of ['skeleton', 'archer', 'brute', 'crawler', 'screamer', 'bloat', 'mummy', 'scarab', 'priest', 'slime']) {
    for (let t = 0; t < 3; t++) { monsterFrame(s, t, 'idle', 0); monsterFrame(s, t, 'walk', 0); monsterFrame(s, t, 'atk', 0); monsterFrame(s, t, 'atk', 1); monsterFrame(s, t, 'hurt', 0); }
  }
}

export function gibFrame(kind, seed, variant) { return memo(`gib|${kind}|${seed & 7}|${variant & 7}`, () => paintGib(kind, seed & 7, variant & 7)); }
export function softShadowFrame() { return memo('softshadow', () => X.paintSoftShadow()); }
export function shadowFrame() { return memo('shadow', () => X.paintShadow()); }
export function glowFrame(colorHex) { return memo('glow|' + colorHex, () => X.paintGlow(colorHex)); }
