// Tests for the made-up details module (web/js/lib/persona). The module is plain JavaScript
// with no browser feature, so it runs here in Node.js exactly as it runs in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COUNTRIES, generatePersona, fullName, addressLines, singleLine, isPersona, randomInt } from '../web/js/lib/persona/index.js';
import * as US from '../web/js/lib/persona/us.js';

const STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN',
  'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
];

// Words of the most common real street names in the US. An invented street must not use them.
const COMMON_STREET_WORDS = [
  'main', 'oak', 'maple', 'washington', 'park', 'pine', 'cedar', 'elm', 'lake', 'hill', 'church', 'high', 'walnut', 'spring', 'sunset',
  'lincoln', 'jackson', 'jefferson', 'madison', 'franklin', 'adams', 'river', 'forest', 'view', 'center', 'mill', 'willow', 'cherry', 'chestnut',
  'broadway', 'highland', 'dogwood', 'hickory', 'sycamore', 'poplar', 'birch', 'spruce', 'locust', 'magnolia', 'school', 'college', 'market',
  'state', 'union', 'railroad', 'north', 'south', 'east', 'west', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth',
  'ninth', 'tenth',
];

const STREET = /^([1-9][0-9]{0,3}) ([A-Z][a-z]+) ([A-Z][a-z]+) (St|Ave|Rd|Ln|Dr|Ct|Way|Pl|Ter|Cir)$/;
const UNIT = /^(Apt [1-9][0-9]?[A-D]?|Unit [1-9][0-9]{0,2})$/;

const SAMPLE = {
  v: 1, country: 'US', firstName: 'Dana', lastName: 'Example', street: '4821 Quiet Meadow Ln', unit: 'Apt 4B',
  city: 'Springfield', region: 'IL', regionName: 'Illinois', postalCode: '62701',
};

const inRanges = (prefix, ranges) => ranges.some(([from, to]) => prefix >= from && prefix <= to);

test('countries: the list has the United States', () => {
  assert.deepEqual(COUNTRIES, [{ code: 'US', label: 'United States' }]);
});

test('US data: state table and ZIP prefix table', () => {
  assert.deepEqual(Object.keys(US.STATES).sort(), [...STATE_CODES].sort(), '50 states and DC');
  assert.equal(new Set(Object.values(US.STATES)).size, 51, 'no state name two times');
  for (const name of Object.values(US.STATES)) assert.match(name, /^[A-Z][A-Za-z ]+$/);

  assert.deepEqual(Object.keys(US.ZIP_PREFIXES).sort(), [...STATE_CODES].sort(), 'a prefix range for every state');
  const owner = new Map(); // prefix -> state
  for (const [state, ranges] of Object.entries(US.ZIP_PREFIXES)) {
    assert.ok(Array.isArray(ranges) && ranges.length >= 1, state);
    for (const range of ranges) {
      assert.equal(range.length, 2, state);
      const [from, to] = range;
      assert.ok(Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to <= 999 && from <= to, `${state} ${from}-${to}`);
      for (let prefix = from; prefix <= to; prefix++) {
        // One prefix belongs to one state. The only exception: 063 is Connecticut, and also Fishers Island in New York.
        if (owner.has(prefix) && prefix !== 63) assert.fail(`prefix ${prefix} is in ${owner.get(prefix)} and in ${state}`);
        owner.set(prefix, state);
      }
    }
  }
  // Some ranges that are well known.
  for (const [zip, state] of [['60601', 'IL'], ['90012', 'CA'], ['02108', 'MA'], ['78701', 'TX'], ['88595', 'TX'], ['10001', 'NY'], ['00501', 'NY'], ['20001', 'DC'], ['99501', 'AK'], ['96813', 'HI']]) {
    assert.ok(inRanges(Number(zip.slice(0, 3)), US.ZIP_PREFIXES[state]), `${zip} is in ${state}`);
  }
  for (const [zip, state] of [['60601', 'IN'], ['90012', 'NV'], ['02108', 'NH'], ['78701', 'OK'], ['10001', 'NJ'], ['20001', 'VA'], ['05401', 'MA'], ['73301', 'OK']]) {
    assert.equal(inRanges(Number(zip.slice(0, 3)), US.ZIP_PREFIXES[state]), false, `${zip} is not in ${state}`);
  }
});

test('US data: every city has a known state and ZIP codes inside the range of that state', () => {
  assert.ok(US.CITIES.length >= 120, `${US.CITIES.length} cities`);
  const seenCity = new Set();
  const seenZip = new Map();
  for (const entry of US.CITIES) {
    const label = `${entry.city}, ${entry.state}`;
    assert.deepEqual(Object.keys(entry).sort(), ['city', 'state', 'zips'], label);
    assert.match(entry.city, /^[A-Z][A-Za-z.' -]{1,40}$/, label);
    assert.ok(Object.prototype.hasOwnProperty.call(US.STATES, entry.state), `${label}: the state is in the state table`);
    assert.ok(Array.isArray(entry.zips) && entry.zips.length >= 1 && entry.zips.length <= 3, `${label}: 1 to 3 ZIP codes`);
    assert.equal(new Set(entry.zips).size, entry.zips.length, `${label}: no ZIP code two times`);
    for (const zip of entry.zips) {
      assert.match(zip, /^[0-9]{5}$/, `${label}: ${zip} has exactly 5 digits`);
      // The accuracy check: the first three digits must be in the range that the post office gave to this state.
      assert.ok(inRanges(Number(zip.slice(0, 3)), US.ZIP_PREFIXES[entry.state]), `${label}: ${zip} is not a ZIP code of ${entry.state}`);
      // One ZIP code is the code of one city.
      assert.equal(seenZip.has(zip), false, `${zip} is used for ${label} and for ${seenZip.get(zip)}`);
      seenZip.set(zip, label);
    }
    assert.equal(seenCity.has(label), false, `${label} is in the list two times`);
    seenCity.add(label);
  }
  const covered = new Set(US.CITIES.map((c) => c.state));
  assert.deepEqual([...covered].sort(), [...STATE_CODES].sort(), 'all 50 states and DC have a city');
});

test('US data: name lists', () => {
  for (const [label, list] of [['first names', US.FIRST_NAMES], ['last names', US.LAST_NAMES]]) {
    assert.ok(list.length >= 150 && list.length <= 200, `${label}: ${list.length}`);
    assert.equal(new Set(list.map((n) => n.toLowerCase())).size, list.length, `${label}: no name two times`);
    for (const name of list) {
      assert.match(name, /^[A-Za-z' -]+$/, `${label}: "${name}" has only letters, apostrophes, hyphens, and spaces`);
      assert.match(name, /^[A-Z]/, `${label}: "${name}" starts with a capital letter`);
      assert.equal(name, name.trim());
      assert.ok(name.length >= 2 && name.length <= 20, name);
    }
  }
});

test('US data: words for invented streets', () => {
  for (const [label, list] of [['first words', US.STREET_FIRST], ['second words', US.STREET_SECOND]]) {
    assert.ok(list.length >= 60, `${label}: ${list.length}`);
    assert.equal(new Set(list).size, list.length, `${label}: no word two times`);
    for (const word of list) {
      assert.match(word, /^[A-Z][a-z]+$/, word);
      assert.equal(COMMON_STREET_WORDS.includes(word.toLowerCase()), false, `"${word}" is a common real street name`);
    }
  }
  assert.deepEqual(US.STREET_FIRST.filter((w) => US.STREET_SECOND.includes(w)), [], 'no word in both lists');
  assert.deepEqual(US.STREET_SUFFIXES, ['St', 'Ave', 'Rd', 'Ln', 'Dr', 'Ct', 'Way', 'Pl', 'Ter', 'Cir']);
});

test('generatePersona: 2000 results are valid, consistent, and different', async () => {
  const zipsOf = new Map(US.CITIES.map((c) => [`${c.city}|${c.state}`, new Set(c.zips)]));
  const firstNames = new Set(US.FIRST_NAMES);
  const lastNames = new Set(US.LAST_NAMES);
  const distinct = new Set();
  const statesSeen = new Set();
  let withUnit = 0;
  let longNumbers = 0;
  let shortNumbers = 0;

  for (let i = 0; i < 2000; i++) {
    const p = await generatePersona('US');
    assert.equal(isPersona(p), true, JSON.stringify(p));
    assert.deepEqual(Object.keys(p), ['v', 'country', 'firstName', 'lastName', 'street', 'unit', 'city', 'region', 'regionName', 'postalCode']);
    assert.equal(p.v, 1);
    assert.equal(p.country, 'US');
    assert.ok(firstNames.has(p.firstName) && lastNames.has(p.lastName));

    // City, state, and ZIP code come from one entry of the city list.
    const zips = zipsOf.get(`${p.city}|${p.region}`);
    assert.ok(zips, `${p.city}, ${p.region} is a city of the list`);
    assert.ok(zips.has(p.postalCode), `${p.postalCode} belongs to ${p.city}, ${p.region}`);
    assert.equal(p.regionName, US.STATES[p.region]);
    statesSeen.add(p.region);

    // The street is invented: number, two words, suffix. No word of a common real street name.
    const street = STREET.exec(p.street);
    assert.ok(street, p.street);
    const number = Number(street[1]);
    assert.ok(number >= 1 && number <= 9999);
    if (street[1].length >= 3) longNumbers++; else shortNumbers++;
    assert.ok(US.STREET_FIRST.includes(street[2]) && US.STREET_SECOND.includes(street[3]), p.street);
    for (const word of p.street.toLowerCase().split(' ')) assert.equal(COMMON_STREET_WORDS.includes(word), false, p.street);

    if (p.unit !== '') { withUnit++; assert.match(p.unit, UNIT); }
    distinct.add(JSON.stringify(p));
  }

  assert.ok(withUnit >= 200 && withUnit <= 600, `${withUnit} of 2000 results have a unit (about 1 in 5)`);
  assert.ok(longNumbers >= 1400, `${longNumbers} of 2000 house numbers have 3 or 4 digits`);
  assert.ok(shortNumbers >= 1, 'short house numbers exist too');
  assert.ok(distinct.size >= 1500, `${distinct.size} different results`);
  assert.ok(statesSeen.size >= 45, `${statesSeen.size} states in 2000 results`);

  // The country is 'US' if none is given.
  assert.equal((await generatePersona()).country, 'US');
});

test('generatePersona: a country that is not in the list gives a plain error', async () => {
  for (const bad of ['XX', 'us', '', 'USA', 'United States', null, 5, {}, ['US'], '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    await assert.rejects(generatePersona(bad), (err) => err instanceof Error && err.message === 'This country is not available.', String(bad));
  }
});

test('randomInt: range, bad values, and no number more likely than the others', () => {
  for (const n of [1, 2, 3, 7, 10, 251, 1000, 65536, 2 ** 31, 2 ** 32]) {
    for (let i = 0; i < 200; i++) {
      const value = randomInt(n);
      assert.ok(Number.isInteger(value) && value >= 0 && value < n, `randomInt(${n}) gave ${value}`);
    }
  }
  assert.equal(randomInt(1), 0);
  for (const bad of [0, -1, 1.5, NaN, Infinity, 2 ** 32 + 1, '5', null, undefined, [], {}, 5n]) {
    assert.throws(() => randomInt(bad), RangeError, String(bad));
  }

  // 100,000 draws from 10 numbers: each number comes about 10,000 times (within 5 %).
  const counts = new Array(10).fill(0);
  for (let i = 0; i < 100000; i++) counts[randomInt(10)]++;
  for (const [value, count] of counts.entries()) assert.ok(count > 9500 && count < 10500, `${value} came ${count} times`);
  // Small and large results both happen for a large range (the high bits are used too).
  const big = Array.from({ length: 200 }, () => randomInt(2 ** 32));
  assert.ok(big.some((v) => v < 2 ** 31) && big.some((v) => v >= 2 ** 31));
});

test('randomInt: a draw that would favor small numbers is thrown away', () => {
  // With n = 3 the largest usable 32-bit value is 4294967294. The value 4294967295 must be drawn again.
  const queue = [0xffffffff, 0xffffffff, 5, 0xfffffffe, 7];
  let calls = 0;
  Object.defineProperty(globalThis.crypto, 'getRandomValues', {
    configurable: true,
    value(array) { calls++; array[0] = queue.shift(); return array; },
  });
  try {
    assert.equal(randomInt(3), 5 % 3);
    assert.equal(calls, 3, 'two draws were refused');
    assert.equal(randomInt(3), 0xfffffffe % 3);
    assert.equal(randomInt(2 ** 32), 7);
    assert.equal(calls, 5);
  } finally {
    delete globalThis.crypto.getRandomValues;
  }
  // The real generator is back.
  assert.ok(randomInt(1000) < 1000);
  assert.equal(queue.length, 0);
});

test('isPersona: accepts results and refuses every wrong shape', async () => {
  assert.equal(isPersona(SAMPLE), true);
  assert.equal(isPersona({ ...SAMPLE, unit: '' }), true);
  assert.equal(isPersona(JSON.parse(JSON.stringify(await generatePersona('US')))), true, 'a result that was stored and read again');

  const wrong = {
    'not an object': [null, undefined, 'text', 5, true, [], [SAMPLE], () => SAMPLE],
    'wrong version': [{ ...SAMPLE, v: 2 }, { ...SAMPLE, v: '1' }, { ...SAMPLE, v: 0 }, { ...SAMPLE, v: undefined }],
    'unknown country': [{ ...SAMPLE, country: 'XX' }, { ...SAMPLE, country: 'us' }, { ...SAMPLE, country: '' }, { ...SAMPLE, country: 5 },
      { ...SAMPLE, country: '__proto__' }, { ...SAMPLE, country: 'constructor' }],
    'a field is not text': [{ ...SAMPLE, firstName: 5 }, { ...SAMPLE, lastName: null }, { ...SAMPLE, street: ['x'] }, { ...SAMPLE, unit: undefined },
      { ...SAMPLE, city: {} }, { ...SAMPLE, postalCode: 62701 }],
    'a text is empty': [{ ...SAMPLE, firstName: '' }, { ...SAMPLE, lastName: '' }, { ...SAMPLE, street: '' }, { ...SAMPLE, city: '' },
      { ...SAMPLE, region: '' }, { ...SAMPLE, regionName: '' }, { ...SAMPLE, postalCode: '' }],
    'a text is too long': [{ ...SAMPLE, firstName: 'x'.repeat(41) }, { ...SAMPLE, lastName: 'x'.repeat(41) }, { ...SAMPLE, street: 'x'.repeat(81) },
      { ...SAMPLE, unit: 'x'.repeat(21) }, { ...SAMPLE, city: 'x'.repeat(61) }, { ...SAMPLE, regionName: 'x'.repeat(61) },
      { ...SAMPLE, firstName: 'x'.repeat(100000) }],
    'a text has a line break or space at the ends': [{ ...SAMPLE, street: '1 Quiet Meadow Ln\nExtra line' }, { ...SAMPLE, city: 'Spring\tfield' },
      { ...SAMPLE, firstName: ' Dana' }, { ...SAMPLE, lastName: 'Example ' }, { ...SAMPLE, unit: ' ' }, { ...SAMPLE, city: 'A\u2028B' }, { ...SAMPLE, city: 'A\u0000B' }],
    'region or postal code has the wrong form': [{ ...SAMPLE, region: 'Il' }, { ...SAMPLE, region: 'ILL' }, { ...SAMPLE, region: 'I' },
      { ...SAMPLE, postalCode: '6270' }, { ...SAMPLE, postalCode: '627011' }, { ...SAMPLE, postalCode: '62701-1234' }, { ...SAMPLE, postalCode: 'ABCDE' }],
    'an extra field': [{ ...SAMPLE, extra: 'x' }, { ...SAMPLE, html: '<b>x</b>' }],
  };
  for (const [why, values] of Object.entries(wrong)) {
    for (const value of values) assert.equal(isPersona(value), false, `${why}: ${JSON.stringify(value)?.slice(0, 120)}`);
  }
  // A missing field, one after the other.
  for (const key of Object.keys(SAMPLE)) {
    const copy = { ...SAMPLE };
    delete copy[key];
    assert.equal(isPersona(copy), false, `without ${key}`);
  }
  // A field that only the prototype has does not count.
  const inherited = Object.create({ unit: '' });
  Object.assign(inherited, { ...SAMPLE });
  delete inherited.unit;
  assert.equal(isPersona(inherited), false);
});

test('formatting: name, address lines, and one line', () => {
  assert.equal(fullName(SAMPLE), 'Dana Example');
  assert.deepEqual(addressLines(SAMPLE), ['4821 Quiet Meadow Ln', 'Apt 4B', 'Springfield, IL 62701', 'United States']);
  assert.equal(singleLine(SAMPLE), '4821 Quiet Meadow Ln, Apt 4B, Springfield, IL 62701, United States');

  // Without a unit there is no empty line and no double comma.
  const plain = { ...SAMPLE, unit: '' };
  assert.deepEqual(addressLines(plain), ['4821 Quiet Meadow Ln', 'Springfield, IL 62701', 'United States']);
  assert.equal(singleLine(plain), '4821 Quiet Meadow Ln, Springfield, IL 62701, United States');

  const other = { ...SAMPLE, firstName: 'Mei', lastName: "O'Brien", street: '7 Wren Tarn Ct', unit: 'Unit 12', city: "Coeur d'Alene", region: 'ID', regionName: 'Idaho', postalCode: '83814' };
  assert.equal(fullName(other), "Mei O'Brien");
  assert.deepEqual(addressLines(other), ['7 Wren Tarn Ct', 'Unit 12', "Coeur d'Alene, ID 83814", 'United States']);
  // The functions change nothing in the object.
  assert.deepEqual(other.unit, 'Unit 12');
  assert.equal(Object.keys(other).length, 10);
});

test('formatting: results of the generator', async () => {
  for (let i = 0; i < 200; i++) {
    const p = await generatePersona('US');
    const lines = addressLines(p);
    assert.equal(lines.length, p.unit ? 4 : 3);
    assert.equal(lines[0], p.street);
    assert.match(lines[lines.length - 2], /^[A-Z][A-Za-z.' -]+, [A-Z]{2} [0-9]{5}$/);
    assert.equal(lines[lines.length - 1], 'United States');
    assert.equal(singleLine(p), lines.join(', '));
    assert.match(fullName(p), /^[A-Z][A-Za-z' -]+ [A-Z][A-Za-z' -]+$/);
    for (const line of [...lines, fullName(p), singleLine(p)]) assert.equal(/[\n\r\t]/.test(line), false);
  }
});

test('source files: no browser page, no network, no weak random numbers, no other modules', () => {
  const files = ['../web/js/lib/persona/index.js', '../web/js/lib/persona/us.js'];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const word of ['document', 'window', 'fetch', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'WebSocket', 'navigator', 'require', 'eval']) {
      assert.equal(new RegExp(`\\b${word}\\b`).test(source), false, `${file} must not use "${word}"`);
    }
    assert.equal(/Math\s*\.\s*random/.test(source), false, `${file} must not use Math.random`);
    assert.equal(/https?:\/\//.test(source), false, `${file} must have no web address`);
    // The only import is the data file of a country, from the same folder.
    const imports = [...source.matchAll(/\bimport\b[^'"\n]*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.deepEqual(imports, file.endsWith('index.js') ? ['./us.js'] : [], file);
  }
});
