// Username and password maker.
//
// Rules:
// - It only makes them. Nothing here stores a password, sends it, or writes it to a log.
//   The user copies the password into a password manager.
// - All random choices come from the secure generator of the platform (randomInt), without bias.
// - A password has at least one small letter, one capital letter, one digit, and (if wanted) one symbol.
//   The symbols are the ones that sign-up forms usually accept. Characters that look alike are left
//   out (0 O o, 1 l I, |), so that a password can be read and typed.
// - A username is plain: small letters, digits, and "_". It never ends like a year of birth.
//
// This file has no access to the page, to the network, or to storage.
import { randomInt } from './persona/index.js';

const LOWER = 'abcdefghijkmnpqrstuvwxyz'; // no l, no o
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, no O
const DIGITS = '23456789';                // no 0, no 1
const SYMBOLS = '!@#$%^&*-_=+?';
export const MIN_LENGTH = 12;
export const MAX_LENGTH = 64;

// One item of a list, or one character of a text.
const pick = (items) => items[randomInt(items.length)];

// Puts the items in a random order. Every order has the same chance (Fisher-Yates).
export function shuffle(items) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function checkLength(length) {
  if (!Number.isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) {
    throw new RangeError(`A password has ${MIN_LENGTH} to ${MAX_LENGTH} characters.`);
  }
}

// Makes a password. length: 12 to 64. symbols: false leaves the symbols out.
export function makePassword({ length = 20, symbols = true } = {}) {
  checkLength(length);
  const classes = symbols ? [LOWER, UPPER, DIGITS, SYMBOLS] : [LOWER, UPPER, DIGITS];
  const all = classes.join('');
  // One character of each kind, the rest from all kinds, then a random order.
  const chars = classes.map(pick);
  while (chars.length < length) chars.push(pick(all));
  return shuffle(chars).join('');
}

// About how many bits of randomness a password from makePassword() has, rounded down.
// The number is a little low on purpose: it counts the choices before the order is mixed.
export function passwordStrength(length = 20, symbols = true) {
  checkLength(length);
  const classes = symbols ? [LOWER, UPPER, DIGITS, SYMBOLS] : [LOWER, UPPER, DIGITS];
  const all = classes.reduce((n, c) => n + c.length, 0);
  let bits = (length - classes.length) * Math.log2(all);
  for (const c of classes) bits += Math.log2(c.length);
  return Math.floor(bits);
}

// Short words for usernames, in the style of the invented street names.
const FIRST_WORDS = [
  'quiet', 'amber', 'russet', 'indigo', 'ivory', 'misty', 'mellow', 'dusky', 'copper', 'cobalt',
  'velvet', 'pewter', 'topaz', 'garnet', 'opal', 'jasper', 'cinder', 'ember', 'clover', 'fennel',
  'linden', 'alder', 'rowan', 'aster', 'briar', 'sorrel', 'yarrow', 'saffron', 'azure', 'pebble',
  'flint', 'slate', 'frosty', 'breezy', 'sunny', 'rustic', 'gentle', 'lively', 'nimble', 'steady',
];
const SECOND_WORDS = [
  'meadow', 'hollow', 'ridge', 'glen', 'dell', 'vale', 'knoll', 'bluff', 'crest', 'harbor',
  'haven', 'bend', 'trace', 'notch', 'hearth', 'quarry', 'ledge', 'marsh', 'heath', 'brook',
  'pond', 'cove', 'reach', 'arbor', 'bower', 'dale', 'glade', 'hedge', 'mesa', 'canyon',
  'tide', 'drift', 'echo', 'feather', 'lantern', 'finch', 'heron', 'wren', 'otter', 'falcon',
];

// 2 to 4 digits. `count` fixes the number of digits.
function digits(count) {
  let out = '';
  for (let i = 0; i < count; i++) out += String(randomInt(10));
  return out;
}

// The letters a to z of a name: "O'Brien" -> "obrien", "José" -> "jose".
const plainLetters = (text) => String(text || '').normalize('NFD').toLowerCase().replace(/[^a-z]/g, '');

// Makes a username: 8 to 20 characters of a-z, 0-9, and "_", with a letter first.
// With a persona it sometimes uses the first letter of the first name and the last name ("dexample482").
// It never uses the full name, and it never ends with a number that looks like a year (19xx, 20xx).
export function makeUsername(persona) {
  const initial = persona ? plainLetters(persona.firstName).slice(0, 1) : '';
  const family = persona ? plainLetters(persona.lastName).slice(0, 12) : '';
  const fromName = initial && family.length >= 3 && randomInt(2) === 0;
  const base = fromName
    ? initial + family
    : `${pick(FIRST_WORDS)}${randomInt(2) === 0 ? '_' : ''}${pick(SECOND_WORDS)}`;
  // Enough digits to reach 8 characters, and never more than 4.
  const fewest = Math.max(2, 8 - base.length);
  for (;;) {
    const name = base + digits(fewest + randomInt(4 - fewest + 1));
    if (!/(?:19|20)[0-9]{2}$/.test(name)) return name;
  }
}
