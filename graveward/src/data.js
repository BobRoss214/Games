// All game content as data. Tune numbers here.
import { WALL, FLOOR, CEIL } from './textures.js';

// ---------------- Hero progression ----------------
export const XP_TABLE = [0, 0, 60, 150, 270, 430, 640, 900, 1220, 1600, 2050]; // cumulative xp to REACH level i
export const MAX_LEVEL = 10;
export const heroMaxHp = (lv) => 70 + lv * 13;
export const heroMaxMana = (lv) => 40 + lv * 6;
export const heroSpeed = (lv) => 3.15 + lv * 0.09;
export const heroDmgMult = (lv) => 1 + lv * 0.055;
export const LEVEL_UNLOCKS = {
  1: 'Sword swings', 2: '+HP  +Speed', 3: 'Heavy attack (hold)', 4: 'Spell slot 1', 5: 'Dodge roll',
  6: '+HP +Speed  Block/Parry', 7: 'Spell slot 2', 8: 'Weapon mastery +15% dmg', 9: '+HP +Speed', 10: 'PORTAL ACCESS',
};

// ---------------- Weapons ----------------
// swing = seconds for a light attack cycle: [windup, strike, recover]
export const WEAPONS = {
  rusty_sword: { name: 'Rusty Short Sword', kind: 'melee', dmg: 13, swing: [0.14, 0.08, 0.24], reach: 1.35, arc: 100, knock: 1.2, heavy: 2.0, price: 0, sprite: 'sword', desc: 'Balanced. Seen better days.' },
  bone_dagger: { name: 'Bone Dagger', kind: 'melee', dmg: 8, swing: [0.07, 0.05, 0.13], reach: 1.05, arc: 70, knock: 0.4, heavy: 1.7, backstab: 2.5, price: 70, sprite: 'dagger', desc: 'Very fast. Backstab x2.5.' },
  tomb_axe: { name: 'Tomb Axe', kind: 'melee', dmg: 20, swing: [0.22, 0.1, 0.38], reach: 1.4, arc: 150, knock: 1.6, heavy: 2.2, cleave: true, price: 110, sprite: 'axe', desc: 'Slow. Wide cleave hits everything.' },
  bronze_spear: { name: 'Bronze Spear', kind: 'melee', dmg: 15, swing: [0.18, 0.08, 0.3], reach: 2.1, arc: 40, knock: 1.0, heavy: 2.0, price: 90, sprite: 'spear', desc: 'Long reach thrust.' },
  iron_mace: { name: 'Iron Mace', kind: 'melee', dmg: 18, swing: [0.24, 0.1, 0.36], reach: 1.3, arc: 90, knock: 2.6, heavy: 2.0, stagger: 0.7, price: 105, sprite: 'mace', desc: 'Staggers what it hits.' },
  khopesh: { name: "Pharaoh's Khopesh", kind: 'melee', dmg: 17, swing: [0.12, 0.08, 0.22], reach: 1.4, arc: 120, knock: 1.0, heavy: 2.0, bleed: true, price: 230, sprite: 'khopesh', rare: true, desc: 'Curved blade. Wounds bleed.' },
  warhammer: { name: 'Warhammer', kind: 'melee', dmg: 27, swing: [0.34, 0.12, 0.5], reach: 1.4, arc: 100, knock: 3.0, heavy: 2.4, shockwave: true, price: 200, sprite: 'hammer', desc: 'Very slow. Heavy makes a shockwave.' },
  crossbow: { name: 'Crossbow', kind: 'ranged', dmg: 30, swing: [0.12, 0.05, 0.85], reach: 0, projSpeed: 16, knock: 1.0, heavy: 1.0, price: 140, sprite: 'crossbow', proj: 'bolt', desc: 'Slow reload, big damage.' },
  throwing_knives: { name: 'Throwing Knives', kind: 'ranged', dmg: 10, swing: [0.08, 0.04, 0.26], reach: 0, projSpeed: 14, knock: 0.3, heavy: 1.0, price: 75, sprite: 'knives', proj: 'knife', ammo: 12, desc: '12 knives. Walk over them to pick up.' },
  sling: { name: 'Sling', kind: 'ranged', dmg: 6, swing: [0.14, 0.05, 0.4], reach: 0, projSpeed: 12, knock: 0.6, heavy: 1.0, price: 30, sprite: 'sling', proj: 'stone', desc: 'Weak, but infinite ammo.' },
};
export const RARITY = {
  common: { name: 'Common', mult: 1, color: '#c8c8c8', effects: 0 },
  rare: { name: 'Rare', mult: 1.25, color: '#5a9aff', effects: 1 },
  legendary: { name: 'Legendary', mult: 1.6, color: '#ffb030', effects: 2 },
};
export const WEAPON_EFFECTS = {
  fire: { name: 'Flaming', color: '#ff7a20', desc: 'Sets foes ablaze' },
  poison: { name: 'Venomous', color: '#7ad03a', desc: 'Poisons foes' },
  vamp: { name: 'Vampiric', color: '#d02040', desc: 'Life-steal 12%' },
  lightning: { name: 'Stormcalled', color: '#8ad8ff', desc: 'Crits arc lightning' },
};

// ---------------- Spells ----------------
export const SPELLS = {
  fire: { name: 'Fire Rune', cost: 15, cd: 0.6, price: 120, color: '#ff7a20', desc: 'Fireball. Burns.' },
  frost: { name: 'Frost Nova', cost: 20, cd: 1.0, price: 130, color: '#9ae0ff', desc: 'Slows everything nearby.' },
  chain: { name: 'Chain Lightning', cost: 25, cd: 0.8, price: 170, color: '#8ad8ff', desc: 'Jumps between enemies.' },
  drain: { name: 'Blood Drain', cost: 18, cd: 0.8, price: 150, color: '#d02040', desc: 'Steal health from one enemy.' },
  ward: { name: 'Ward', cost: 20, cd: 1.5, price: 110, color: '#ffe080', desc: 'Absorbs the next 45 damage.' },
  sight: { name: 'Spirit Sight', cost: 12, cd: 2.0, price: 100, color: '#c0a0ff', desc: 'See ghosts for 7 seconds.' },
};

// ---------------- Potions ----------------
export const POTIONS = {
  health: { name: 'Health Potion', price: 25, color: '#d02030', desc: 'Heal 50' },
  greater: { name: 'Greater Health', price: 55, color: '#ff5060', desc: 'Heal 110' },
  speed: { name: 'Speed Potion', price: 35, color: '#40d0ff', desc: '+40% speed 15s' },
  might: { name: 'Might Potion', price: 40, color: '#ff8020', desc: '+40% damage 15s' },
  ironskin: { name: 'Iron Skin', price: 40, color: '#a0a8b8', desc: '-40% damage taken 15s' },
  shadow: { name: 'Shadow Potion', price: 45, color: '#6040a0', desc: 'Ghost monsters lose you 12s' },
  clarity: { name: 'Clarity Potion', price: 30, color: '#4080ff', desc: 'Restore all mana' },
  antidote: { name: 'Antidote', price: 20, color: '#60d060', desc: 'Cure poison, curse, burn' },
};

// ---------------- Artifacts ----------------
export const ARTIFACTS = {
  ankh: { name: 'Ankh of Second Breath', price: 260, desc: 'Survive one lethal hit per floor.' },
  scarab: { name: 'Scarab Charm', price: 150, desc: '+35% gold found.' },
  bloodstone: { name: 'Bloodstone Ring', price: 220, desc: 'Heal 8% of damage dealt.' },
  lantern: { name: 'Lantern of Sight', price: 130, desc: 'Bigger light radius.' },
  boots: { name: 'Boots of the Grave-Walker', price: 170, desc: '+15% move speed.' },
  crown: { name: 'Cursed Crown', price: 60, desc: '+45% damage. Ghosts earn +60% Blood.', cursed: true },
  eye: { name: 'Eye of the Watcher', price: 200, desc: 'Glimpses ghosts near you.' },
  stoneheart: { name: 'Stone Heart', price: 180, desc: '+30 max health.' },
  canopic: { name: 'Canopic Amulet', price: 140, desc: 'Heal 25% on room clear.' },
  vaultkey: { name: 'Vault Key', price: 90, desc: 'Opens locked chests.' },
};
export const ARTIFACT_SLOTS = 4;

// ---------------- Gods and monsters ----------------
export const TIER_MULT = { hp: [1, 1.9, 3.2], dmg: [1, 1.4, 1.9], spd: [1, 1.06, 1.12] };
export const EVOLVE_COST = [null, { wrath: 45, blood: 0 }, { wrath: 95, blood: 40 }]; // cost to reach tier index 1,2 (0-based tiers)

// Attack kinds: melee, proj, aoe, leap, summon, scream, explode, buff, beam, curse, shield, blink
export const MONSTERS = {
  // ---- Ossuar ----
  skeleton: {
    god: 'ossuar', sprite: 'skeleton', names: ['Skeleton Grunt', 'Bone Knight', 'Revenant Lord'], hp: 55, spd: 2.5, r: 0.32, h: 0.95, xp: 12, gold: 6,
    abilities: [
      { id: 'slash', name: 'Slash', kind: 'melee', dmg: 9, windup: 0.3, strike: 0.08, recover: 0.3, reach: 1.15, arc: 90, cd: 0.6, knock: 1 },
      { id: 'bash', name: 'Shield Bash', kind: 'melee', dmg: 8, windup: 0.35, strike: 0.08, recover: 0.35, reach: 1.1, arc: 70, cd: 4, knock: 2.5, stun: 0.8, tier: 1 },
      { id: 'cleave', name: 'Spectral Cleave', kind: 'aoe', dmg: 18, windup: 0.5, strike: 0.1, recover: 0.4, radius: 1.9, cd: 5, knock: 2, tier: 2 },
    ],
  },
  archer: {
    god: 'ossuar', sprite: 'archer', names: ['Bone Archer', 'Skeleton Marksman', 'Deathshot Wraith'], hp: 40, spd: 2.3, r: 0.3, h: 0.95, xp: 12, gold: 6, ranged: true,
    abilities: [
      { id: 'shoot', name: 'Arrow', kind: 'proj', proj: 'arrow', dmg: 8, speed: 10, windup: 0.5, strike: 0.05, recover: 0.3, cd: 1.1, range: 11 },
      { id: 'volley', name: 'Volley', kind: 'proj', proj: 'arrow', dmg: 6, speed: 10, windup: 0.6, strike: 0.05, recover: 0.4, cd: 5, count: 3, spread: 0.18, range: 11, tier: 1 },
      { id: 'pierce', name: 'Piercing Shot', kind: 'proj', proj: 'arrowPierce', dmg: 16, speed: 15, windup: 0.7, strike: 0.05, recover: 0.4, cd: 4, pierce: true, range: 14, tier: 2 },
    ],
  },
  brute: {
    god: 'ossuar', sprite: 'brute', names: ['Ossuary Brute', 'Bone Colossus', 'Charnel Titan'], hp: 120, spd: 1.8, r: 0.44, h: 1.35, xp: 22, gold: 12,
    abilities: [
      { id: 'smash', name: 'Smash', kind: 'melee', dmg: 16, windup: 0.55, strike: 0.1, recover: 0.5, reach: 1.4, arc: 100, cd: 1.0, knock: 2.5 },
      { id: 'slam', name: 'Ground Slam', kind: 'aoe', dmg: 20, windup: 0.7, strike: 0.1, recover: 0.5, radius: 2.3, cd: 6, knock: 3, tier: 1 },
      { id: 'shards', name: 'Bone Shards', kind: 'proj', proj: 'shard', dmg: 8, speed: 8, windup: 0.5, strike: 0.05, recover: 0.4, cd: 7, count: 8, spread: 6.28, ring: true, range: 8, tier: 2 },
    ],
  },
  // ---- Vorrath ----
  crawler: {
    god: 'vorrath', sprite: 'crawler', names: ['Meat Crawler', 'Gore Hound', 'Maw Beast'], hp: 35, spd: 3.6, r: 0.3, h: 0.6, xp: 9, gold: 4,
    abilities: [
      { id: 'bite', name: 'Bite', kind: 'melee', dmg: 7, windup: 0.18, strike: 0.06, recover: 0.2, reach: 0.95, arc: 80, cd: 0.4, knock: 0.5 },
      { id: 'leap', name: 'Leap', kind: 'leap', dmg: 11, windup: 0.3, strike: 0.3, recover: 0.3, dist: 3.4, cd: 5, knock: 1.5 },
      { id: 'maul', name: 'Maul', kind: 'aoe', dmg: 20, windup: 0.4, strike: 0.1, recover: 0.4, radius: 1.6, cd: 5, knock: 2, tier: 2 },
    ],
  },
  screamer: {
    god: 'vorrath', sprite: 'screamer', names: ['Flayed Screamer', 'Wailing Horror', 'Choir of Flesh'], hp: 30, spd: 2.1, r: 0.3, h: 0.9, xp: 14, gold: 7, ranged: true, flies: true,
    abilities: [
      { id: 'gore', name: 'Gore Spit', kind: 'proj', proj: 'gore', dmg: 6, speed: 8, windup: 0.4, strike: 0.05, recover: 0.3, cd: 1.3, range: 9 },
      { id: 'scream', name: 'Scream', kind: 'scream', dmg: 4, windup: 0.5, strike: 0.2, recover: 0.4, range: 6, arc: 70, cd: 5, stun: 0.5, blur: 2.5, tier: 0 },
      { id: 'shriek', name: 'Shriek Wave', kind: 'proj', proj: 'wave', dmg: 9, speed: 7, windup: 0.6, strike: 0.05, recover: 0.4, cd: 6, count: 3, spread: 0.5, stun: 0.5, range: 9, tier: 2 },
    ],
  },
  bloat: {
    god: 'vorrath', sprite: 'bloat', names: ['Bloat Carrier', 'Rot Bomber', 'Plague Abomination'], hp: 70, spd: 1.6, r: 0.44, h: 1.1, xp: 16, gold: 8,
    abilities: [
      { id: 'slam', name: 'Slap', kind: 'melee', dmg: 8, windup: 0.4, strike: 0.08, recover: 0.4, reach: 1.15, arc: 90, cd: 1.0, knock: 1.5 },
      { id: 'burst', name: 'Burst', kind: 'explode', dmg: 30, windup: 0.6, strike: 0.1, recover: 0.1, radius: 2.5, cd: 1, pool: true, tier: 0 },
      { id: 'spew', name: 'Plague Spew', kind: 'proj', proj: 'acid', dmg: 6, speed: 7, windup: 0.5, strike: 0.05, recover: 0.4, cd: 4, count: 3, spread: 0.6, pool: true, range: 8, tier: 2 },
    ],
  },
  // ---- Ashkeleth ----
  mummy: {
    god: 'ashkeleth', sprite: 'mummy', names: ['Mummy Guard', 'Mummy Captain', 'Wrapped Pharaoh'], hp: 65, spd: 2.2, r: 0.35, h: 1.0, xp: 13, gold: 8,
    abilities: [
      { id: 'strike', name: 'Strike', kind: 'melee', dmg: 10, windup: 0.35, strike: 0.08, recover: 0.32, reach: 1.15, arc: 90, cd: 0.7, knock: 1 },
      { id: 'warcry', name: 'War Cry', kind: 'buff', windup: 0.4, strike: 0.1, recover: 0.3, cd: 12, radius: 6, dur: 6, tier: 1 },
      { id: 'curse', name: 'Pharaoh Curse', kind: 'curse', proj: 'curse', dmg: 6, speed: 9, windup: 0.5, strike: 0.05, recover: 0.4, cd: 8, range: 9, debuff: 'curse', tier: 2 },
    ],
  },
  scarab: {
    god: 'ashkeleth', sprite: 'scarab', names: ['Scarab Swarm', 'Scarab Colony', 'Devourer Swarm'], hp: 30, spd: 4.0, r: 0.3, h: 0.5, xp: 10, gold: 5, evasion: 0.35, swarm: true,
    abilities: [
      { id: 'gnaw', name: 'Gnaw', kind: 'melee', dmg: 3.2, windup: 0.06, strike: 0.04, recover: 0.12, reach: 0.85, arc: 120, cd: 0.16, knock: 0 },
      { id: 'surge', name: 'Surge', kind: 'leap', dmg: 8, windup: 0.2, strike: 0.25, recover: 0.2, dist: 3.8, cd: 4.5, knock: 0.5, tier: 1 },
      { id: 'devour', name: 'Devour', kind: 'aoe', dmg: 18, windup: 0.4, strike: 0.1, recover: 0.3, radius: 1.5, cd: 5, knock: 0, tier: 2 },
    ],
  },
  priest: {
    god: 'ashkeleth', sprite: 'priest', names: ['Curse Priest', 'High Priest', 'Hierophant Lich'], hp: 45, spd: 2.0, r: 0.32, h: 1.0, xp: 15, gold: 10, ranged: true,
    abilities: [
      { id: 'bolt', name: 'Dark Bolt', kind: 'proj', proj: 'darkbolt', dmg: 9, speed: 9, windup: 0.45, strike: 0.05, recover: 0.3, cd: 1.3, range: 10 },
      { id: 'hex', name: 'Hex', kind: 'curse', proj: 'curse', dmg: 4, speed: 9, windup: 0.5, strike: 0.05, recover: 0.4, cd: 7, range: 9, debuff: 'curse', tier: 1 },
      { id: 'raise', name: 'Raise Mummies', kind: 'summon', unit: 'minimummy', n: 2, windup: 0.8, strike: 0.1, recover: 0.4, cd: 14, tier: 2 },
    ],
  },
  // ---- Universal ----
  slime: {
    god: null, sprite: 'slime', names: ['Slime', 'Slime', 'Slime'], hp: 38, spd: 1.5, r: 0.36, h: 0.55, xp: 5, gold: 2, splits: true,
    abilities: [{ id: 'engulf', name: 'Engulf', kind: 'melee', dmg: 5, windup: 0.3, strike: 0.08, recover: 0.4, reach: 0.95, arc: 100, cd: 0.9, knock: 0.3 }],
  },
  slimelet: {
    god: null, sprite: 'slime', names: ['Slimelet', 'Slimelet', 'Slimelet'], hp: 14, spd: 1.9, r: 0.24, h: 0.35, xp: 2, gold: 0, scale: 0.6,
    abilities: [{ id: 'engulf', name: 'Nip', kind: 'melee', dmg: 3, windup: 0.3, strike: 0.08, recover: 0.4, reach: 0.8, arc: 100, cd: 0.9, knock: 0.2 }],
  },
  minimummy: {
    god: null, sprite: 'mummy', names: ['Wrapped Thrall', 'Wrapped Thrall', 'Wrapped Thrall'], hp: 24, spd: 2.3, r: 0.3, h: 0.85, xp: 4, gold: 0, scale: 0.85,
    abilities: [{ id: 'strike', name: 'Strike', kind: 'melee', dmg: 6, windup: 0.35, strike: 0.08, recover: 0.35, reach: 1.05, arc: 90, cd: 0.9, knock: 0.5 }],
  },
  hollow: { // fallback for pentagrams nobody took
    god: null, sprite: 'skeleton', names: ['Hollow Shade', 'Hollow Shade', 'Hollow Shade'], hp: 40, spd: 2.0, r: 0.32, h: 0.95, xp: 8, gold: 4, tintHollow: true,
    abilities: [{ id: 'slash', name: 'Claw', kind: 'melee', dmg: 7, windup: 0.4, strike: 0.08, recover: 0.4, reach: 1.1, arc: 90, cd: 0.9, knock: 0.8 }],
  },
  // ---- Statue giants ----
  sentinel: {
    god: null, giant: true, sprite: 'sentinel', names: ['Stone Sentinel', 'Stone Sentinel', 'Stone Sentinel'], hp: 320, spd: 1.6, r: 0.55, h: 2.1, xp: 60, gold: 40, eye: 0.72,
    abilities: [
      { id: 'smash', name: 'Overhead Smash', kind: 'melee', dmg: 22, windup: 0.8, strike: 0.1, recover: 0.6, reach: 1.7, arc: 90, cd: 1.6, knock: 4 },
      { id: 'quake', name: 'Quake', kind: 'aoe', dmg: 20, windup: 0.9, strike: 0.1, recover: 0.6, radius: 2.8, cd: 7, knock: 4 },
    ],
  },
  gargoyle: {
    god: null, giant: true, sprite: 'gargoyle', names: ['Gargoyle Titan', 'Gargoyle Titan', 'Gargoyle Titan'], hp: 260, spd: 2.4, r: 0.55, h: 2.0, xp: 60, gold: 40, eye: 0.72,
    abilities: [
      { id: 'claw', name: 'Claw', kind: 'melee', dmg: 16, windup: 0.4, strike: 0.08, recover: 0.4, reach: 1.6, arc: 110, cd: 0.9, knock: 2 },
      { id: 'pounce', name: 'Pounce', kind: 'leap', dmg: 24, windup: 0.5, strike: 0.35, recover: 0.5, dist: 5, cd: 6, knock: 4 },
    ],
  },
  golem: {
    god: null, giant: true, sprite: 'golem', names: ['Hollow Golem', 'Hollow Golem', 'Hollow Golem'], hp: 380, spd: 1.4, r: 0.58, h: 2.2, xp: 65, gold: 45, eye: 0.75,
    abilities: [
      { id: 'fist', name: 'Fist', kind: 'melee', dmg: 20, windup: 0.7, strike: 0.1, recover: 0.6, reach: 1.7, arc: 90, cd: 1.5, knock: 3.5 },
      { id: 'beam', name: 'Soul Beam', kind: 'beam', dmg: 7, windup: 0.6, strike: 1.6, recover: 0.6, range: 9, cd: 8, tick: 0.2 },
    ],
  },
};

export const GODS = {
  ossuar: {
    name: 'Ossuar', title: 'the Bone Sovereign', color: '#d8ccaa', roster: ['skeleton', 'archer', 'brute'],
    passive: 'Deathless: each monster shrugs off its first killing blow.', sigil: 'skull',
  },
  vorrath: {
    name: 'Vorrath', title: 'the Flesh Mother', color: '#c83a4a', roster: ['crawler', 'screamer', 'bloat'],
    passive: 'Gore-Fed: monsters heal 30% of damage they deal.', sigil: 'maw',
  },
  ashkeleth: {
    name: 'Ashkeleth', title: 'Lord of the Sun-Cursed Tomb', color: '#e0b04a', roster: ['mummy', 'scarab', 'priest'],
    passive: 'Sun-Cursed: +25% trap damage. Curses last longer.', sigil: 'sun',
  },
};
export const GOD_IDS = Object.keys(GODS);

// ---------------- Traps ----------------
export const TRAPS = {
  spikes: { name: 'Spike Plate', dmg: 22, windup: 0.55, active: 0.4, cd: 2.2, radius: 1.15, sprite: 'spikeplate' },
  flame: { name: 'Flame Vent', dmg: 7, windup: 0.4, active: 1.4, cd: 4.0, range: 4.2, width: 0.9, burn: true, sprite: 'flamevent', tick: 0.2 },
  saw: { name: 'Buzzsaw', dmg: 18, windup: 0.3, active: 2.4, cd: 3.5, radius: 0.6, track: 3, sprite: 'saw', tick: 0.25 },
  darts: { name: 'Dart Wall', dmg: 8, windup: 0.15, active: 0, cd: 0.7, range: 12, sprite: 'darts', projSpeed: 14 },
  crusher: { name: 'Bone Crusher', dmg: 35, windup: 0.8, active: 0.25, cd: 4.5, radius: 1.3, sprite: 'crusher' },
};

// ---------------- Props ----------------
// destructible: hp; haunt kinds: throw | scare | chandelier | fountain | coffin | torch | chain
export const PROPS = {
  pot: { hp: 1, ecto: 1, gold: 0.25, haunt: 'throw', w: 0.45, h: 0.5, solid: false },
  jar: { hp: 1, ecto: 1, gold: 0.3, haunt: 'throw', w: 0.4, h: 0.55, solid: false },
  crate: { hp: 2, ecto: 1, gold: 0.3, haunt: 'throw', w: 0.7, h: 0.7, solid: true },
  urn: { hp: 2, ecto: 2, gold: 0.35, haunt: 'throw', w: 0.55, h: 0.8, solid: true },
  bones: { hp: 1, ecto: 1, gold: 0.1, haunt: 'throw', w: 0.6, h: 0.3, solid: false },
  coffin: { hp: 4, ecto: 3, gold: 0.5, haunt: 'coffin', w: 0.9, h: 0.6, solid: true },
  cobweb: { hp: 1, ecto: 1, gold: 0, haunt: 'scare', w: 0.9, h: 0.9, solid: false, z: 0.1 },
  skullpile: { hp: 2, ecto: 2, gold: 0.2, haunt: 'throw', w: 0.6, h: 0.5, solid: false },
  // indestructible
  pillar: { hp: 0, haunt: null, w: 0.8, h: 1.0, solid: true },
  sarcophagus: { hp: 0, haunt: 'coffin', w: 1.0, h: 0.75, solid: true },
  torch: { hp: 0, haunt: 'torch', w: 0.35, h: 0.6, solid: false, z: 0.4 },
  chains: { hp: 0, haunt: 'chain', w: 0.5, h: 0.9, solid: false, z: 0.1 },
  fountain: { hp: 0, haunt: 'fountain', w: 0.8, h: 0.9, solid: true },
  chandelier: { hp: 0, haunt: 'chandelier', w: 0.9, h: 0.5, solid: false, z: 0.62 },
  brazier: { hp: 0, haunt: 'torch', w: 0.5, h: 0.6, solid: true },
};

// ---------------- Themes (floors) ----------------
export const THEMES = [
  { name: 'Crypt Gate', wall: [WALL.brick, WALL.moss], accent: WALL.niche, floor: [FLOOR.flag, FLOOR.mossFlag], ceil: CEIL.stone, ambient: [0.05, 0.05, 0.075], fog: [0.02, 0.025, 0.04], fogDensity: 0.055, torch: [1.0, 0.62, 0.28], music: 0, props: ['pot', 'crate', 'bones', 'cobweb', 'jar'], blood: 1 },
  { name: 'The Ossuary', wall: [WALL.bone, WALL.ossuaryBrick], accent: WALL.bone, floor: [FLOOR.bone, FLOOR.flagCrack], ceil: CEIL.bone, ambient: [0.06, 0.05, 0.05], fog: [0.03, 0.02, 0.02], fogDensity: 0.06, torch: [1.0, 0.7, 0.35], music: 1, props: ['bones', 'skullpile', 'coffin', 'urn', 'cobweb'], blood: 1 },
  { name: 'Sandbound Halls', wall: [WALL.sand, WALL.glyph], accent: WALL.mural, floor: [FLOOR.sand, FLOOR.flag], ceil: CEIL.sand, ambient: [0.075, 0.06, 0.04], fog: [0.06, 0.04, 0.02], fogDensity: 0.05, torch: [1.0, 0.65, 0.22], music: 2, props: ['urn', 'jar', 'pot', 'crate', 'bones'], blood: 1 },
  { name: 'Flooded Crypts', wall: [WALL.wet, WALL.moss], accent: WALL.niche, floor: [FLOOR.wetFlag, FLOOR.water], ceil: CEIL.drip, ambient: [0.03, 0.06, 0.08], fog: [0.01, 0.04, 0.05], fogDensity: 0.065, torch: [0.5, 0.9, 0.85], music: 3, props: ['pot', 'jar', 'coffin', 'bones', 'cobweb'], blood: 1 },
  { name: 'The Royal Tomb', wall: [WALL.gold, WALL.royalGlyph], accent: WALL.mural, floor: [FLOOR.royalFlag, FLOOR.goldTile], ceil: CEIL.royal, ambient: [0.075, 0.04, 0.05], fog: [0.05, 0.015, 0.02], fogDensity: 0.05, torch: [1.0, 0.45, 0.25], music: 4, props: ['urn', 'jar', 'coffin', 'skullpile', 'crate'], blood: 1 },
  { name: 'The Deep Reliquary', wall: [WALL.flesh, WALL.deepFlesh], accent: WALL.flesh, floor: [FLOOR.flesh, FLOOR.altar], ceil: CEIL.flesh, ambient: [0.09, 0.03, 0.04], fog: [0.06, 0.005, 0.01], fogDensity: 0.06, torch: [1.0, 0.25, 0.2], music: 5, props: ['skullpile', 'urn', 'bones', 'coffin'], blood: 1 },
];
export function themesForFloors(n) {
  if (n >= 6) return [0, 1, 2, 3, 4, 5];
  if (n === 5) return [0, 1, 2, 3, 4];
  if (n === 4) return [0, 1, 3, 4];
  if (n === 3) return [0, 2, 4];
  return [0, 4].slice(0, n).concat([1, 2, 3]).slice(0, n);
}

// ---------------- Bosses ----------------
// parts: each is controlled by one ghost; positions relative to arena center
export const BOSSES = {
  colossus: {
    name: 'The Sarcophagus Colossus', hp: 1500, sprite: 'colossus', color: '#8a8070',
    parts: [
      { id: 'lfist', name: 'Left Fist', sprite: 'colossusFist', w: 2.2, h: 2.2, pos: [-3.0, -2.5], r: 0.9, speed: 1.6, abilities: [
        { id: 'slam', name: 'Ground Slam', kind: 'aoe', dmg: 30, windup: 0.9, strike: 0.15, recover: 0.7, radius: 3.0, cd: 2.5, knock: 5, exposes: true },
        { id: 'punch', name: 'Rocket Punch', kind: 'leap', dmg: 26, windup: 0.6, strike: 0.4, recover: 0.6, dist: 6, cd: 6, knock: 5 } ] },
      { id: 'rfist', name: 'Right Fist', sprite: 'colossusFist', flip: true, w: 2.2, h: 2.2, pos: [3.0, -2.5], r: 0.9, speed: 1.6, abilities: [
        { id: 'sweep', name: 'Sweep', kind: 'aoe', dmg: 24, windup: 0.7, strike: 0.15, recover: 0.6, radius: 3.4, cd: 2.5, knock: 5 },
        { id: 'slam', name: 'Ground Slam', kind: 'aoe', dmg: 30, windup: 0.9, strike: 0.15, recover: 0.7, radius: 3.0, cd: 4, knock: 5, exposes: true } ] },
      { id: 'face', name: 'Face', sprite: 'colossusFace', w: 3.0, h: 3.0, pos: [0, -5.0], r: 1.1, speed: 1.0, abilities: [
        { id: 'beam', name: 'Sun Beam', kind: 'beam', dmg: 9, windup: 0.8, strike: 2.2, recover: 0.7, range: 14, cd: 6, tick: 0.2, sweep: true },
        { id: 'rocks', name: 'Falling Rocks', kind: 'proj', proj: 'boulder', dmg: 14, speed: 6, windup: 0.6, strike: 0.05, recover: 0.5, cd: 4, count: 4, spread: 0.9, range: 14 } ] },
    ],
    weakSpot: 'Cracks in the chest open after fist slams: hit the body for triple damage.',
  },
  jackal: {
    name: 'The Jackal King', hp: 1400, sprite: 'jackalBody', color: '#c8b890',
    parts: [
      { id: 'h1', name: 'Fang Head', sprite: 'jackalHead', w: 2.2, h: 2.4, pos: [-3.2, -4.0], r: 0.9, speed: 2.3, abilities: [
        { id: 'bite', name: 'Bite Lunge', kind: 'leap', dmg: 28, windup: 0.5, strike: 0.35, recover: 0.6, dist: 6, cd: 3, knock: 4, exposes: true },
        { id: 'snap', name: 'Snap', kind: 'melee', dmg: 18, windup: 0.3, strike: 0.08, recover: 0.4, reach: 1.9, arc: 90, cd: 1.0, knock: 2 } ] },
      { id: 'h2', name: 'Flame Head', sprite: 'jackalHeadFire', w: 2.2, h: 2.4, pos: [0, -5.0], r: 0.9, speed: 1.4, abilities: [
        { id: 'breath', name: 'Cursed Flame', kind: 'beam', dmg: 8, windup: 0.6, strike: 2.0, recover: 0.6, range: 11, cd: 5.5, tick: 0.2, burn: true },
        { id: 'fireball', name: 'Ember Burst', kind: 'proj', proj: 'fireball', dmg: 16, speed: 8, windup: 0.5, strike: 0.05, recover: 0.4, cd: 2.5, count: 3, spread: 0.5, range: 14 } ] },
      { id: 'h3', name: 'Howl Head', sprite: 'jackalHeadHowl', w: 2.2, h: 2.4, pos: [3.2, -4.0], r: 0.9, speed: 1.6, abilities: [
        { id: 'howl', name: 'Summoning Howl', kind: 'summon', unit: 'minimummy', n: 3, windup: 0.9, strike: 0.1, recover: 0.6, cd: 12, spawnAround: true },
        { id: 'sonic', name: 'Sonic Howl', kind: 'scream', dmg: 10, windup: 0.6, strike: 0.2, recover: 0.5, range: 9, arc: 120, cd: 5, stun: 0.6, blur: 2 } ] },
    ],
    weakSpot: 'Heads take double damage mid-attack.',
  },
  mother: {
    name: 'The Bandage Mother', hp: 1600, sprite: 'motherBody', color: '#c8bca0',
    parts: [
      { id: 'larm', name: 'Grasping Arm', sprite: 'motherArm', w: 2.2, h: 3.0, pos: [-3.2, -3.5], r: 0.9, speed: 1.7, abilities: [
        { id: 'grab', name: 'Grab & Throw', kind: 'leap', dmg: 22, windup: 0.6, strike: 0.45, recover: 0.6, dist: 7, cd: 4, knock: 8, exposes: true },
        { id: 'lash', name: 'Bandage Lash', kind: 'melee', dmg: 15, windup: 0.3, strike: 0.08, recover: 0.4, reach: 2.4, arc: 100, cd: 1.1, knock: 2 } ] },
      { id: 'rarm', name: 'Crushing Arm', sprite: 'motherArm', flip: true, w: 2.2, h: 3.0, pos: [3.2, -3.5], r: 0.9, speed: 1.7, abilities: [
        { id: 'crush', name: 'Crush', kind: 'aoe', dmg: 30, windup: 0.9, strike: 0.15, recover: 0.7, radius: 3.0, cd: 3, knock: 4, exposes: true },
        { id: 'lash', name: 'Bandage Lash', kind: 'melee', dmg: 15, windup: 0.3, strike: 0.08, recover: 0.4, reach: 2.4, arc: 100, cd: 1.1, knock: 2 } ] },
      { id: 'mouth', name: 'Mouth', sprite: 'motherMouth', w: 2.6, h: 2.4, pos: [0, -5.0], r: 1.0, speed: 0.9, abilities: [
        { id: 'larvae', name: 'Spit Larvae', kind: 'summon', unit: 'slimelet', n: 3, windup: 0.6, strike: 0.1, recover: 0.5, cd: 5, spawnAround: true },
        { id: 'acid', name: 'Acid Spit', kind: 'proj', proj: 'acid', dmg: 12, speed: 8, windup: 0.5, strike: 0.05, recover: 0.4, cd: 2.2, count: 3, spread: 0.6, range: 14 } ] },
    ],
    weakSpot: 'Damage the arms to unwrap them and expose the core: everything hurts more.',
  },
};
export const BOSS_IDS = Object.keys(BOSSES);

// ---------------- Room types & floor recipe ----------------
export const ROOM_TYPES = {
  start: { lock: false }, monster: { lock: true }, trap: { lock: true }, mixed: { lock: true }, treasure: { lock: false },
  curse: { lock: true }, store: { lock: false }, portal: { lock: false }, exit: { lock: true }, plain: { lock: false },
};

// ---------------- Loot ----------------
export const LOOT = {
  goldRange: (depth) => [10 + depth * 8, 30 + depth * 20],
  chestWeights: (depth) => ({ gold: 40, potion: 28, weapon: 8 + depth * 2, spell: 6 + depth, artifact: 5 + depth * 2 }),
};
export const SHOP_POTIONS = ['health', 'greater', 'speed', 'might', 'ironskin', 'clarity', 'antidote', 'shadow'];
