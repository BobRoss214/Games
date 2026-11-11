// The matching of the quick jump (web/js/features/quickjump/match.js). Runs without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, digitsOf, partsOf, textScore, digitScore, prepare, rank, search, KIND_ORDER } from '../web/js/features/quickjump/match.js';

const entry = (kind, title, fields) => prepare({ kind, title, fields });
const DATA = [
  entry('page', 'Settings', [{ name: 'title', text: 'Settings', level: 0 }, { name: 'words', text: 'passkeys theme sessions', level: 2 }]),
  entry('page', 'Mail', [{ name: 'title', text: 'Mail', level: 0 }]),
  entry('inbox', 'Personal', [{ name: 'title', text: 'Personal', level: 0 }, { name: 'address', text: 'anna.reed@mail.example', level: 1 }]),
  entry('number', 'Bike line', [{ name: 'title', text: 'Bike line', level: 0 }, { name: 'number', text: '+14155550100', digits: '+14155550100', level: 1 }, { name: 'note', text: 'for the Facebook advert', level: 2 }]),
  entry('alias', 'Facebook login', [{ name: 'title', text: 'Facebook login', level: 0 }, { name: 'address', text: 'quiet.river482@mail.example', level: 1 }, { name: 'identity', text: 'Facebook', level: 2 }]),
  entry('alias', 'Maple Shop', [{ name: 'title', text: 'Maple Shop', level: 0 }, { name: 'address', text: 'green.book255@mail.example', level: 1 }, { name: 'identifiers', text: 'Kyle Miller', level: 2 }]),
  // an alias with no label: its address is not a name that the person gave, so it is level 1
  entry('alias', 'bold.surface77@mail.example', [{ name: 'address', text: 'bold.surface77@mail.example', level: 1 }]),
  entry('identity', 'Facebook', [{ name: 'title', text: 'Facebook', level: 0 }, { name: 'note', text: 'Social. Old school friends.', level: 2 }]),
  entry('identity', 'Café Zürich', [{ name: 'title', text: 'Café Zürich', level: 0 }]),
];
const titles = (query, opts) => search(DATA, query, opts).items.map((e) => `${e.kind}:${e.title}`);

test('quick jump: text is folded, digits are taken out, a query is cut into parts', () => {
  assert.equal(fold('  Café ZÜRICH '), '  cafe zurich ');
  assert.equal(fold(null), '');
  assert.equal(digitsOf('+1 (415) 555-0100'), '14155550100');
  assert.deepEqual(partsOf('  Shop   MAPLE '), ['shop', 'maple']);
  assert.deepEqual(partsOf('   '), []);
  assert.equal(partsOf('a b c d e f g h').length, 6);
});

test('quick jump: the whole text, a start, the start of a word, the inside of a word', () => {
  assert.equal(textScore('facebook', 'facebook'), 100);
  assert.equal(textScore('facebook login', 'face'), 80);
  assert.equal(textScore('my facebook', 'face'), 60);
  assert.equal(textScore('quiet.river482@mail.example', 'river'), 60);
  assert.equal(textScore('surface', 'face'), 40);
  assert.equal(textScore('surface face', 'face'), 60);
  assert.equal(textScore('mail', 'face'), 0);
  assert.equal(textScore('', 'face'), 0);
});

test('quick jump: a phone number is found by its digits, with or without spaces and signs', () => {
  const d = '14155550100';
  assert.equal(digitScore(d, '14155550100'), 100);
  assert.equal(digitScore(d, '+14155550100'), 100);
  assert.equal(digitScore(d, '4155550100'), 70);
  assert.equal(digitScore(d, '5550100'), 70);
  assert.equal(digitScore(d, '(415)'), 70);
  assert.equal(digitScore(d, '555-01'), 50);
  assert.equal(digitScore(d, '999'), 0);
  assert.equal(digitScore(d, '4'), 0, 'one digit says nothing');
  assert.equal(digitScore(d, 'bike'), 0);
  assert.equal(digitScore('', '415'), 0);
  assert.deepEqual(titles('5550100'), ['number:Bike line']);
  assert.deepEqual(titles('415 555 0100'), ['number:Bike line']);
  assert.deepEqual(titles('(415) 555-0100'), ['number:Bike line']);
  assert.deepEqual(titles('+14155550100'), ['number:Bike line']);
});

test('quick jump: "face" gives the identity first, then the alias with that label, then weaker matches', () => {
  assert.deepEqual(titles('face'), [
    'identity:Facebook',                    // the name starts with it
    'alias:Facebook login',                 // the label starts with it
    'alias:bold.surface77@mail.example',    // inside a word of the address
    'number:Bike line',                     // only in the note
  ]);
  assert.deepEqual(titles('FACE'), titles('face'));
  assert.deepEqual(titles('  face  '), titles('face'));
});

test('quick jump: parts in any order, every part must be found', () => {
  assert.deepEqual(titles('shop maple'), ['alias:Maple Shop']);
  assert.deepEqual(titles('maple shop'), ['alias:Maple Shop']);
  assert.deepEqual(titles('maple bike'), []);
  assert.deepEqual(titles('login river'), ['alias:Facebook login'], 'one part in the label, one in the address');
  assert.deepEqual(titles('zzzzqq'), []);
  assert.deepEqual(search(DATA, ''), { items: [], total: 0 });
  assert.deepEqual(search(DATA, '   '), { items: [], total: 0 });
});

test('quick jump: marks on letters make no difference', () => {
  assert.deepEqual(titles('cafe zur'), ['identity:Café Zürich']);
  assert.deepEqual(titles('ZÜRICH'), ['identity:Café Zürich']);
});

test('quick jump: a page is found by its name and by its extra words; a name beats other text', () => {
  assert.equal(titles('sett')[0], 'page:Settings');
  assert.deepEqual(titles('passkeys'), ['page:Settings']);
  // "mail": the page name is the best match; the addresses only have it as a word inside.
  assert.equal(titles('mail')[0], 'page:Mail');
  assert.ok(titles('mail').includes('inbox:Personal'));
  assert.ok(titles('mail').includes('alias:bold.surface77@mail.example'));
  // An address is found by its start too.
  assert.deepEqual(titles('bold.sur'), ['alias:bold.surface77@mail.example']);
});

test('quick jump: the order of kinds, the reason for a hidden match, the limit', () => {
  assert.deepEqual(KIND_ORDER, ['identity', 'alias', 'number', 'inbox', 'page']);
  const kyle = search(DATA, 'kyle').items;
  assert.equal(kyle.length, 1);
  assert.deepEqual(kyle[0].why, { name: 'identifiers', text: 'Kyle Miller' });
  assert.equal(search(DATA, 'maple').items[0].why, null, 'a match in the name needs no reason');
  const note = search(DATA, 'advert').items[0];
  assert.deepEqual(note.why, { name: 'note', text: 'for the Facebook advert' });
  const many = Array.from({ length: 50 }, (_, i) => entry('alias', `Shop ${i}`, [{ name: 'title', text: `Shop ${i}`, level: 0 }]));
  const res = search(many, 'shop', { limit: 20 });
  assert.equal(res.items.length, 20);
  assert.equal(res.total, 50);
  assert.equal(rank(many[0], ['nothing']), null);
  assert.equal(rank(DATA[7], ['face']).tier, 0);
  assert.equal(rank(DATA[6], ['face']).tier, 1);
  assert.equal(rank(DATA[3], ['face']).tier, 2);
});

test('quick jump: the matching code has no page, no request and no storage in it', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../web/js/features/quickjump/match.js', import.meta.url), 'utf8');
  for (const word of ['document', 'window', 'fetch', 'localStorage', 'sessionStorage', 'location', 'import ']) assert.ok(!source.replace(/\/\/.*$/gm, '').includes(word), `match.js uses ${word}`);
});
