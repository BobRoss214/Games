// Tests for the username and password maker (web/js/lib/credentials.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePassword, makeUsername, passwordStrength, shuffle, MIN_LENGTH, MAX_LENGTH } from '../web/js/lib/credentials.js';
import { generatePersona } from '../web/js/lib/persona/index.js';

const SYMBOLS = '!@#$%^&*-_=+?';
const LOOK_ALIKE = /[0Oo1lI|]/;

test('password: every kind of character is there, and no look-alike character', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const password = makePassword();
    assert.equal(password.length, 20);
    assert.match(password, /[a-z]/, password);
    assert.match(password, /[A-Z]/, password);
    assert.match(password, /[0-9]/, password);
    assert.ok([...password].some((c) => SYMBOLS.includes(c)), password);
    assert.equal(LOOK_ALIKE.test(password), false, password);
    assert.ok([...password].every((c) => /[a-zA-Z0-9]/.test(c) || SYMBOLS.includes(c)), password);
    for (const c of password) seen.add(c);
  }
  // Over many passwords every allowed character comes up: 24 + 24 + 8 + 13.
  assert.equal(seen.size, 69);
});

test('password: without symbols, and the lengths', () => {
  for (let i = 0; i < 2000; i++) {
    const password = makePassword({ length: 12, symbols: false });
    assert.match(password, /^[a-zA-Z0-9]{12}$/);
    assert.match(password, /[a-z]/);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[0-9]/);
    assert.equal(LOOK_ALIKE.test(password), false);
  }
  for (const length of [12, 13, 20, 32, 63, 64]) {
    assert.equal(makePassword({ length }).length, length);
    assert.equal(makePassword({ length, symbols: false }).length, length);
  }
  assert.equal(makePassword({}).length, 20);
  assert.equal(makePassword({ symbols: false }).length, 20);
  assert.equal(MIN_LENGTH, 12);
  assert.equal(MAX_LENGTH, 64);
  for (const bad of [0, 4, 11, 65, 1000, 12.5, '20', null, NaN, -20, Infinity]) {
    assert.throws(() => makePassword({ length: bad }), RangeError, String(bad));
  }
  // Two passwords are never the same.
  const many = new Set(Array.from({ length: 2000 }, () => makePassword({ length: 12 })));
  assert.equal(many.size, 2000);
});

test('password: the required characters are at no fixed place', () => {
  // The four required characters are put in first and then mixed. If the mixing was wrong,
  // a symbol would be at one place more often than at the others.
  const runs = 20000;
  const length = 12;
  const symbolAt = new Array(length).fill(0);
  const digitAt = new Array(length).fill(0);
  for (let i = 0; i < runs; i++) {
    const password = makePassword({ length });
    for (let p = 0; p < length; p++) {
      if (SYMBOLS.includes(password[p])) symbolAt[p]++;
      if (/[0-9]/.test(password[p])) digitAt[p]++;
    }
  }
  for (const counts of [symbolAt, digitAt]) {
    const mean = counts.reduce((a, b) => a + b, 0) / length;
    for (const [place, n] of counts.entries()) assert.ok(Math.abs(n - mean) < mean * 0.08, `place ${place}: ${n}, mean ${Math.round(mean)}`);
  }
});

test('shuffle: every order has the same chance', () => {
  const counts = new Map();
  const runs = 24000;
  for (let i = 0; i < runs; i++) {
    const order = shuffle(['a', 'b', 'c', 'd']).join('');
    counts.set(order, (counts.get(order) || 0) + 1);
  }
  assert.equal(counts.size, 24, 'all 24 orders of 4 items come up');
  for (const [order, n] of counts) assert.ok(n > 800 && n < 1200, `${order}: ${n} of about 1000`);
  // The input is not changed, and nothing is lost.
  const input = [1, 2, 3, 4, 5];
  assert.deepEqual(shuffle(input).sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
  assert.deepEqual(shuffle([]), []);
  assert.deepEqual(shuffle(['x']), ['x']);
});

test('password strength: an honest number of bits', () => {
  assert.equal(passwordStrength(20, true), 121);
  assert.equal(passwordStrength(12, false), 68);
  assert.equal(passwordStrength(12, true), 71);
  assert.equal(passwordStrength(), passwordStrength(20, true));
  // Longer is stronger. Symbols add a little.
  for (let length = 12; length < 64; length++) assert.ok(passwordStrength(length + 1, true) > passwordStrength(length, true));
  for (const length of [12, 20, 40, 64]) {
    assert.ok(passwordStrength(length, true) > passwordStrength(length, false));
    // Never more than the number for free choice of every character.
    assert.ok(passwordStrength(length, true) <= length * Math.log2(69));
    assert.ok(passwordStrength(length, false) <= length * Math.log2(56));
    assert.ok(passwordStrength(length, true) >= length * 5.5);
    // Close to the free choice: the required characters cost less than 3 bits.
    assert.ok(length * Math.log2(69) - passwordStrength(length, true) < 3);
  }
  assert.throws(() => passwordStrength(8, true), RangeError);
  assert.throws(() => passwordStrength(65, false), RangeError);
});

test('username: plain, 8 to 20 characters, and no year at the end', async () => {
  const persona = await generatePersona('US');
  const withName = new Set();
  const withWords = new Set();
  for (let i = 0; i < 2000; i++) {
    for (const name of [makeUsername(), makeUsername(persona)]) {
      assert.match(name, /^[a-z][a-z0-9_]{7,19}$/, name);
      assert.match(name, /[0-9]{2,4}$/, name);
      assert.equal(/(?:19|20)[0-9]{2}$/.test(name), false, `${name} ends like a year`);
      assert.equal(/[0-9]{5,}$/.test(name), false, name);
      assert.equal(name.includes('__'), false, name);
    }
    withWords.add(makeUsername());
    withName.add(makeUsername(persona));
  }
  assert.ok(withWords.size > 1900, 'usernames are different');
  // With a persona, both styles come up: the letter of the first name with the last name, and two words.
  const first = persona.firstName.toLowerCase().replace(/[^a-z]/g, '');
  const last = persona.lastName.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12);
  const fromName = [...withName].filter((n) => n.startsWith(first[0] + last));
  assert.ok(fromName.length > 100 && fromName.length < withName.size);
  // Never the full first name with the last name.
  for (const name of withName) assert.equal(name.startsWith(first + last) && first.length > 1, false, name);
});

test('username: names with other letters, short names, and input that is no persona', () => {
  const cases = [
    { firstName: 'José', lastName: "O'Brien-Müller" },
    { firstName: 'Mei', lastName: 'Li' },                 // too short for the name style: two words are used
    { firstName: '', lastName: '' },
    { firstName: 'Dana' },
    { lastName: 'Example' },
    { firstName: 5, lastName: null },
    { firstName: 'X', lastName: 'Abcdefghijklmnopqrstuvwxyz' },
    {}, null, undefined, 'text', 7,
  ];
  for (const persona of cases) {
    for (let i = 0; i < 200; i++) {
      const name = makeUsername(persona);
      assert.match(name, /^[a-z][a-z0-9_]{7,19}$/, `${JSON.stringify(persona)} -> ${name}`);
      assert.equal(/(?:19|20)[0-9]{2}$/.test(name), false);
    }
  }
  const accents = new Set(Array.from({ length: 300 }, () => makeUsername({ firstName: 'José', lastName: "O'Brien-Müller" })));
  assert.ok([...accents].some((n) => /^jobrienmuller[0-9]+$/.test(n)), 'accents and signs are removed from the name');
});

test('credentials: the source stores nothing and uses the secure generator only', () => {
  const source = readFileSync(new URL('../web/js/lib/credentials.js', import.meta.url), 'utf8');
  for (const word of ['document', 'window', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'XMLHttpRequest', 'navigator', 'console', 'require', 'eval']) {
    assert.equal(new RegExp(`\\b${word}\\b`).test(source), false, `credentials.js must not use "${word}"`);
  }
  assert.equal(/Math\s*\.\s*random/.test(source), false);
  assert.equal(/https?:\/\//.test(source), false);
  assert.deepEqual([...source.matchAll(/\bimport\b[^'"\n]*['"]([^'"]+)['"]/g)].map((m) => m[1]), ['./persona/index.js']);
});
