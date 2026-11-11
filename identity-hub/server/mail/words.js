// Word lists for random addresses like "quiet.river482".
// The words are short, common, and harmless. All are lower case letters only.
import { randomInt } from 'node:crypto';

export const ADJECTIVES = [
  'amber', 'ample', 'aqua', 'arctic', 'autumn', 'azure', 'balmy', 'basic', 'bold', 'brave',
  'breezy', 'brief', 'bright', 'brisk', 'broad', 'bronze', 'busy', 'calm', 'candid', 'careful',
  'casual', 'cheery', 'chief', 'civil', 'classic', 'clean', 'clear', 'clever', 'cloudy', 'coastal',
  'cobalt', 'cool', 'copper', 'cosmic', 'cozy', 'crisp', 'curious', 'daily', 'dapper', 'daring',
  'deep', 'dusty', 'eager', 'early', 'earthy', 'easy', 'elder', 'even', 'fair', 'famous',
  'fancy', 'fast', 'fine', 'firm', 'fleet', 'fond', 'formal', 'frank', 'free', 'fresh',
  'frosty', 'gentle', 'giant', 'glad', 'global', 'golden', 'good', 'grand', 'great', 'green',
  'handy', 'happy', 'hardy', 'hazy', 'humble', 'icy', 'ideal', 'indigo', 'ivory', 'jolly',
  'keen', 'kind', 'known', 'large', 'late', 'level', 'light', 'lively', 'local', 'long',
  'loyal', 'lucky', 'lunar', 'major', 'mellow', 'merry', 'mild', 'minor', 'misty', 'modern',
  'modest', 'mossy', 'narrow', 'native', 'neat', 'new', 'nimble', 'noble', 'north', 'novel',
  'open', 'orange', 'pale', 'patient', 'plain', 'polite', 'prime', 'proud', 'pure', 'quick',
  'quiet', 'rapid', 'rare', 'ready', 'regal', 'rosy', 'round', 'royal', 'rustic', 'sandy',
  'scarlet', 'serene', 'sharp', 'shiny', 'silent', 'silver', 'simple', 'smooth', 'snowy', 'solar',
  'solid', 'sound', 'spare', 'steady', 'still', 'sunny', 'swift', 'tidy', 'timely', 'tiny',
  'urban', 'vivid', 'warm', 'wise', 'young',
];

export const NOUNS = [
  'acorn', 'anchor', 'apple', 'arrow', 'aspen', 'badge', 'bagel', 'barn', 'basin', 'beach',
  'bean', 'bell', 'bench', 'berry', 'birch', 'bird', 'boat', 'book', 'bridge', 'brook',
  'brush', 'cabin', 'cactus', 'camel', 'candle', 'canoe', 'canyon', 'cedar', 'chair', 'chalk',
  'cherry', 'cliff', 'clock', 'cloud', 'clover', 'coast', 'comet', 'coral', 'cove', 'crane',
  'creek', 'crow', 'daisy', 'delta', 'desk', 'dome', 'dove', 'drum', 'dune', 'eagle',
  'ember', 'falcon', 'farm', 'fern', 'ferry', 'field', 'finch', 'fjord', 'flame', 'flute',
  'forest', 'fox', 'garden', 'gate', 'glade', 'globe', 'grove', 'harbor', 'hawk', 'hazel',
  'heron', 'hill', 'honey', 'island', 'ivy', 'jar', 'kettle', 'kite', 'lake', 'lamp',
  'lantern', 'leaf', 'lemon', 'lilac', 'lily', 'linen', 'lodge', 'lotus', 'lynx', 'mango',
  'maple', 'marble', 'meadow', 'melon', 'mill', 'mint', 'moon', 'moss', 'nest', 'oak',
  'oasis', 'ocean', 'olive', 'orchid', 'otter', 'owl', 'palm', 'panda', 'path', 'peak',
  'pear', 'pebble', 'pine', 'planet', 'plum', 'pond', 'poppy', 'prairie', 'quill', 'rain',
  'raven', 'reef', 'ridge', 'river', 'robin', 'rock', 'rose', 'sage', 'sail', 'shell',
  'shore', 'sky', 'snow', 'sparrow', 'spruce', 'star', 'stone', 'stream', 'summit', 'swan',
  'thistle', 'tiger', 'trail', 'tulip', 'valley', 'violet', 'walnut', 'wave', 'willow', 'wind',
  'wren',
];

const pick = (list) => list[randomInt(list.length)];

// About 23 million different values. The caller tries again if the address is taken.
export function randomLocalPart() {
  return `${pick(ADJECTIVES)}.${pick(NOUNS)}${String(randomInt(1000)).padStart(3, '0')}`;
}
