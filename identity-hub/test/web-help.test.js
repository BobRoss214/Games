// Tests for the words of the in-app Help (web/js/help/content.js).
// They check the shape of the data and the rules for the text: plain words, short sentences,
// no promise that the product cannot keep, and the same names as the rest of the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as help from '../web/js/help/content.js';

const { WHY_PAGE, TIPS, TIPS_NOTE, WHY, TUTORIAL, WORDS } = help;
const WEB_JS = fileURLToPath(new URL('../web/js/', import.meta.url));
const SOURCE = readFileSync(join(WEB_JS, 'help', 'content.js'), 'utf8');

const WHY_KEYS = [
  'recovery-key', 'passkey', 'inbox-vs-alias', 'identity', 'made-up-details', 'link-phone', 'forwarding',
  'payments', 'alias-off', 'deleting', 'test-mode', 'balance', 'remote-images', 'delivery-status', 'phone-by-call',
];
const STEP_IDS = [
  'welcome', 'recovery-key', 'passkey', 'funds', 'inbox', 'alias', 'first-mail', 'alias-off',
  'identity', 'made-up-details', 'number', 'first-text', 'link-phone', 'finish',
];
const STEP_TEXT_FIELDS = ['title', 'what', 'why', 'doIt', 'doItTest', 'done', 'skipNote', 'offNote'];
const STEP_FIELDS = ['id', 'needs', 'costKey', ...STEP_TEXT_FIELDS];
const GLOSSARY = [
  'inbox', 'alias', 'number', 'identity', 'made-up details', 'recovery key', 'passkey', 'funds', 'credit',
  'turn on', 'turn off', 'delete', 'release', 'paused', 'sign in', 'sign out', 'lock', 'test mode',
];

// Words that promise too much. The help must never use them, also not with "not" in front.
const FORBIDDEN_WORDS = ['invisible', 'anonymous', 'untraceable', '100%', 'guarantee', 'military-grade', 'unhackable', 'completely safe'];
// Names that the app does not use. The app says inbox, alias, and made-up details.
const FORBIDDEN_NAMES = ['mailbox', 'burner', 'fake identity'];
const PRODUCT_NAME = 'Postern';

// ---- helpers ----

// Every string that a person can see, with the place where it is.
function allTexts() {
  const out = [];
  const add = (where, value) => out.push({ where, value });
  add('WHY_PAGE.title', WHY_PAGE.title);
  add('WHY_PAGE.intro', WHY_PAGE.intro);
  WHY_PAGE.sections.forEach((s, i) => {
    add(`WHY_PAGE.sections[${i}].heading`, s.heading);
    s.paragraphs.forEach((p, j) => add(`WHY_PAGE.sections[${i}].paragraphs[${j}]`, p));
    s.bullets.forEach((b, j) => add(`WHY_PAGE.sections[${i}].bullets[${j}]`, b));
  });
  TIPS.forEach((t) => {
    for (const field of ['title', 'doThis', 'why', 'limit']) if (t[field] !== undefined) add(`TIPS.${t.id}.${field}`, t[field]);
  });
  add('TIPS_NOTE', TIPS_NOTE);
  for (const [key, entry] of Object.entries(WHY)) {
    add(`WHY.${key}.title`, entry.title);
    entry.paragraphs.forEach((p, j) => add(`WHY.${key}.paragraphs[${j}]`, p));
  }
  TUTORIAL.forEach((step) => {
    for (const field of STEP_TEXT_FIELDS) if (step[field] !== undefined && step[field] !== null) add(`TUTORIAL.${step.id}.${field}`, step[field]);
  });
  WORDS.forEach((w, i) => {
    add(`WORDS[${i}].word`, w.word);
    add(`WORDS[${i}].meaning`, w.meaning);
  });
  return out;
}

const sentences = (text) => String(text).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const countWords = (text) => String(text).split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const stepText = (step) => STEP_TEXT_FIELDS.map((f) => step[f]).filter((v) => typeof v === 'string').join(' ');
const tipText = (tip) => [tip.title, tip.doThis, tip.why, tip.limit].filter(Boolean).join(' ');
const step = (id) => TUTORIAL.find((s) => s.id === id);

// All JavaScript files of the web app, except the help text itself.
function webSources(dir = WEB_JS) {
  let text = '';
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) { if (name !== 'help') text += webSources(file); } else if (name.endsWith('.js')) text += readFileSync(file, 'utf8') + '\n';
  }
  return text;
}

// ---- shape ----

test('help: the module is plain data', () => {
  assert.deepEqual(Object.keys(help).sort(), ['TIPS', 'TIPS_NOTE', 'TUTORIAL', 'WHY', 'WHY_PAGE', 'WORDS']);
  // Plain data stays the same after a trip through JSON: no function, no date, no undefined value.
  for (const [name, value] of Object.entries(help)) assert.deepEqual(JSON.parse(JSON.stringify(value)), value, name);
  assert.equal(typeof TIPS_NOTE, 'string');
  assert.ok(Array.isArray(TIPS) && Array.isArray(TUTORIAL) && Array.isArray(WORDS));
});

test('help: the "Why this exists" page has its parts', () => {
  assert.deepEqual(Object.keys(WHY_PAGE).sort(), ['intro', 'sections', 'title']);
  assert.equal(WHY_PAGE.sections.length, 4, 'the problem, how it helps, what it does not do, where to start');
  for (const s of WHY_PAGE.sections) {
    assert.deepEqual(Object.keys(s).sort(), ['bullets', 'heading', 'paragraphs']);
    assert.ok(Array.isArray(s.paragraphs) && s.paragraphs.length >= 1, `${s.heading}: needs a paragraph`);
    assert.ok(Array.isArray(s.bullets), `${s.heading}: bullets must be a list`);
  }
  const page = allTexts().filter((t) => t.where.startsWith('WHY_PAGE')).map((t) => t.value).join(' ');
  // The owner's words: sites leak and sell; one throwaway for each site; delete it when it goes bad.
  for (const phrase of [/leak/i, /sell/i, /throwaway/i, /each website/i, /turn it off or delete it/i]) assert.match(page, phrase);
  // The part about what it does not do names the three limits.
  const limits = [...WHY_PAGE.sections[2].paragraphs, ...WHY_PAGE.sections[2].bullets].join(' ');
  assert.match(limits, /not secret on the way/i);
  assert.match(limits, /link a real phone, the server knows/i);
  assert.match(limits, /nobody can reset/i);
});

test('help: the "why?" explanations have exactly the expected keys', () => {
  assert.deepEqual(Object.keys(WHY).sort(), [...WHY_KEYS].sort());
  for (const key of WHY_KEYS) {
    assert.deepEqual(Object.keys(WHY[key]).sort(), ['paragraphs', 'title'], key);
    assert.ok(Array.isArray(WHY[key].paragraphs) && WHY[key].paragraphs.length >= 1, key);
  }
});

test('help: the tutorial has exactly the expected steps, in order', () => {
  assert.deepEqual(TUTORIAL.map((s) => s.id), STEP_IDS);
  for (const s of TUTORIAL) {
    for (const key of Object.keys(s)) assert.ok(STEP_FIELDS.includes(key), `${s.id}: unknown field ${key}`);
    for (const field of ['title', 'what', 'why', 'doIt', 'done']) assert.equal(typeof s[field], 'string', `${s.id}.${field}`);
    for (const field of ['needs', 'costKey', 'skipNote', 'offNote']) assert.ok(field in s, `${s.id}: ${field} is missing (use null)`);
    assert.ok([null, 'pay', 'phone'].includes(s.needs), `${s.id}.needs`);
    assert.ok([null, 'mailboxMonth', 'numberMonth', 'textOut'].includes(s.costKey), `${s.id}.costKey`);
    for (const field of ['skipNote', 'offNote']) assert.ok(s[field] === null || typeof s[field] === 'string', `${s.id}.${field}`);
  }
});

test('help: the tips and the word list have the expected shape', () => {
  assert.ok(TIPS.length >= 12 && TIPS.length <= 16, `there are ${TIPS.length} tips; the range is 12 to 16`);
  assert.equal(new Set(TIPS.map((t) => t.id)).size, TIPS.length, 'each tip has its own id');
  for (const t of TIPS) {
    assert.match(t.id, /^[a-z0-9-]+$/);
    for (const key of Object.keys(t)) assert.ok(['id', 'title', 'doThis', 'why', 'limit'].includes(key), `${t.id}: unknown field ${key}`);
    for (const field of ['title', 'doThis', 'why']) assert.equal(typeof t[field], 'string', `${t.id}.${field}`);
  }
  for (const w of WORDS) assert.deepEqual(Object.keys(w).sort(), ['meaning', 'word']);
  const listed = WORDS.map((w) => w.word).join(', ');
  for (const word of GLOSSARY) assert.ok(listed.includes(word), `the word list has no entry for "${word}"`);
});

// ---- rules for every string ----

test('help: every string is plain text', () => {
  for (const { where, value } of allTexts()) {
    assert.equal(typeof value, 'string', where);
    assert.ok(value.length > 0, `${where} is empty`);
    assert.equal(value, value.trim(), `${where} has space at the start or the end`);
    assert.doesNotMatch(value, /[<>]/, `${where} has < or >`);
    assert.doesNotMatch(value, /[\n\r\t]/, `${where} has a line break or a tab`);
    assert.doesNotMatch(value, / {2,}/, `${where} has two spaces together`);
    // Markdown markers: emphasis, code, links, headings, lists, tables.
    assert.doesNotMatch(value, /[*`_~|[\]\\]/, `${where} has a markdown marker`);
    assert.doesNotMatch(value, /^\s*(#|-\s|\+\s|\d+[.)]\s)/, `${where} starts like a markdown heading or list`);
    // The only tokens are {app} and {price}.
    assert.equal(value.replace(/\{app\}|\{price\}/g, '').search(/[{}]/), -1, `${where} has an unknown token`);
  }
});

test('help: no sentence has more than 25 words', () => {
  for (const { where, value } of allTexts()) {
    for (const sentence of sentences(value)) {
      const n = countWords(sentence);
      assert.ok(n <= 25, `${where}: ${n} words in "${sentence}"`);
    }
  }
});

test('help: no word that promises too much, and only the names that the app uses', () => {
  for (const { where, value } of allTexts()) {
    const low = value.toLowerCase();
    for (const word of FORBIDDEN_WORDS) assert.ok(!low.includes(word), `${where} has the forbidden word "${word}"`);
    for (const name of FORBIDDEN_NAMES) assert.ok(!low.includes(name), `${where} has the name "${name}"; the app does not use it`);
    assert.doesNotMatch(value, /\b(masks?|phone lines?)\b/i, `${where}: say alias and number`);
    // "identity" is the name of a group of aliases and numbers, and of nothing else.
    assert.doesNotMatch(value, /\b(real|true|fake|false|your own|personal) identit/i, `${where}: "identity" means a group only`);
    assert.ok(!value.includes(PRODUCT_NAME), `${where} has the product name; write {app}`);
  }
  // The file itself, with its comments, also does not have the name.
  assert.ok(!SOURCE.includes(PRODUCT_NAME), 'content.js has the product name; write {app}');
});

test('help: money is written like $1.00', () => {
  for (const { where, value } of allTexts()) {
    for (const amount of value.match(/\$\S*/g) || []) assert.match(amount, /^\$\d+\.\d\d[.,;:)]?$/, `${where}: write money like $1.00, not "${amount}"`);
    assert.doesNotMatch(value, /\b\d+(\.\d+)?\s?(USD|dollars?)\b/i, `${where}: write money like $1.00`);
  }
});

// ---- the "Why this exists" page ----

test('help: the "Why this exists" page has 350 to 500 words', () => {
  const n = countWords(allTexts().filter((t) => t.where.startsWith('WHY_PAGE')).map((t) => t.value).join(' '));
  assert.ok(n >= 350 && n <= 500, `the page has ${n} words`);
});

// ---- tips ----

test('help: each tip is one instruction with a short reason', () => {
  for (const t of TIPS) {
    assert.equal(sentences(t.doThis).length, 1, `${t.id}.doThis must be one sentence`);
    const why = sentences(t.why).length;
    assert.ok(why >= 1 && why <= 3, `${t.id}.why has ${why} sentences; the range is 1 to 3`);
    if (t.limit !== undefined) assert.ok(sentences(t.limit).length <= 2, `${t.id}.limit must be short`);
  }
});

test('help: the three limits that the owner named are each the subject of a tip', () => {
  const titled = (pattern) => TIPS.find((t) => pattern.test(t.title));
  const way = titled(/not secret on the way in/i);
  assert.ok(way, 'a tip about mail and texts that are not secret on the way in');
  assert.match(tipText(way), /server sees each new message/i);
  const phone = titled(/linked real phone is known to the server/i);
  assert.ok(phone, 'a tip about the linked real phone');
  assert.match(tipText(phone), /server must know your real phone number/i);
  const key = titled(/nobody can reset a lost recovery key/i);
  assert.ok(key, 'a tip about the recovery key that nobody can reset');
  assert.match(tipText(key), /nobody can reset/i);
  assert.match(tipText(key), /lost/i);
});

test('help: the tips cover the subjects that the owner listed', () => {
  const all = TIPS.map(tipText);
  const subjects = {
    'one alias for each website': /alias for each website/i,
    'turn an alias off': /turn off the alias/i,
    'keep the recovery key safe and test it': /recovery key in a safe place.*test/i,
    'add a passkey': /add a passkey/i,
    'think before you link a real phone': /think before you link a real phone/i,
    'made-up details and the law': /made-up details only.*legal|law requires your real name/i,
    'pay first, add credit later': /pay.*later/i,
    'numbers are for convenience': /convenience, not for secrets/i,
    'remote images': /remote images are blocked/i,
    'delete what you do not need': /delete old mail/i,
    'lock on a shared computer': /"Lock".*sign out/i,
  };
  for (const [subject, pattern] of Object.entries(subjects)) assert.ok(all.some((text) => pattern.test(text)), `no tip about: ${subject}`);
});

test('help: the tips end with the note about legal advice', () => {
  assert.match(TIPS_NOTE, /general advice/i);
  assert.match(TIPS_NOTE, /not legal advice/i);
});

// ---- "why?" explanations ----

test('help: each "why?" explanation has 40 to 90 words', () => {
  for (const key of WHY_KEYS) {
    const n = countWords(WHY[key].paragraphs.join(' '));
    assert.ok(n >= 40 && n <= 90, `WHY.${key} has ${n} words`);
  }
});

test('help: the "why?" explanations state their limits', () => {
  const text = (key) => WHY[key].paragraphs.join(' ');
  assert.match(text('recovery-key'), /lose it and all your passkeys, your data is lost/i);
  assert.match(text('passkey'), /cannot unlock your data alone/i);
  assert.match(text('link-phone'), /server must know your real phone number/i);
  assert.match(text('link-phone'), /optional/i);
  assert.match(text('forwarding'), /phone company sees/i);
  assert.match(text('payments'), /compare the times/i);
  assert.match(text('identity'), /server still knows/i);
  assert.match(text('made-up-details'), /law requires your real name and address/i);
  assert.match(text('deleting'), /backup/i);
  assert.match(text('alias-off'), /turn the alias on again/i);
  // The four words that the app shows under a sent text.
  for (const word of ['"Sending"', '"Sent"', '"Delivered"', '"Not delivered"']) assert.ok(text('delivery-status').includes(word), word);
  assert.match(text('phone-by-call'), /call still works/i);
  assert.match(text('test-mode'), /no real money/i);
});

// ---- tutorial ----

test('help: each tutorial step is short', () => {
  for (const s of TUTORIAL) {
    for (const field of ['what', 'why']) {
      const n = sentences(s[field]).length;
      assert.ok(n >= 1 && n <= 2, `${s.id}.${field} has ${n} sentences; the range is 1 to 2`);
    }
    assert.equal(sentences(s.doIt).length, 1, `${s.id}.doIt must be one sentence`);
    assert.equal(sentences(s.done).length, 1, `${s.id}.done must be one sentence`);
    if (s.doItTest !== undefined) assert.equal(sentences(s.doItTest).length, 1, `${s.id}.doItTest must be one sentence`);
    if (s.offNote !== null) assert.equal(sentences(s.offNote).length, 1, `${s.id}.offNote must be one line`);
  }
});

test('help: a step that costs credit shows the price and can be skipped', () => {
  for (const s of TUTORIAL) {
    const text = stepText(s);
    if (s.costKey) {
      assert.ok(text.includes('{price}'), `${s.id} costs credit but has no {price}`);
      assert.equal(typeof s.skipNote, 'string', `${s.id} costs credit but has no skipNote`);
    } else {
      assert.ok(!text.includes('{price}'), `${s.id} has {price} but no costKey`);
    }
    if (s.needs) assert.equal(typeof s.offNote, 'string', `${s.id} needs "${s.needs}" but has no offNote`);
    else assert.equal(s.offNote, null, `${s.id} has an offNote but needs nothing`);
  }
  // {price} is a tutorial token only.
  for (const { where, value } of allTexts()) if (!where.startsWith('TUTORIAL.')) assert.ok(!value.includes('{price}'), `${where} has {price}`);
});

test('help: the steps name the right part of the server and the right price', () => {
  assert.equal(step('funds').needs, 'pay');
  for (const id of ['number', 'first-text', 'link-phone']) assert.equal(step(id).needs, 'phone', id);
  for (const id of STEP_IDS.filter((x) => !['funds', 'number', 'first-text', 'link-phone'].includes(x))) assert.equal(step(id).needs, null, id);
  assert.equal(step('inbox').costKey, 'mailboxMonth');
  assert.equal(step('number').costKey, 'numberMonth');
  assert.equal(step('first-text').costKey, 'textOut');
  assert.equal(step('link-phone').costKey, 'textOut');
  for (const id of ['welcome', 'recovery-key', 'passkey', 'funds', 'alias', 'first-mail', 'alias-off', 'identity', 'made-up-details', 'finish']) assert.equal(step(id).costKey, null, id);
});

test('help: the tutorial works with no credit, in test mode, and with parts turned off', () => {
  const funds = step('funds');
  assert.match(stepText(funds), /with no credit/i, 'the funds step must make sense with no credit');
  assert.match(funds.doItTest, /test mode uses pretend money/i);
  assert.match(funds.doItTest, /"Simulate payment/);
  assert.match(funds.offNote, /payments are turned off/i);
  const mail = step('first-mail');
  assert.match(mail.doIt, /from a different mail account/i);
  assert.match(mail.doItTest, /"Test tools"/);
  for (const id of ['number', 'first-text', 'link-phone']) assert.match(step(id).offNote, /numbers are turned off/i, id);
  const link = step('link-phone');
  assert.match(stepText(link), /optional/i);
  assert.match(stepText(link), /server must know your real phone number/i);
  const finish = step('finish');
  assert.match(stepText(finish), /"Help"/);
  assert.match(finish.done, /"Help" or from "Settings"/);
});

// ---- the same names as the rest of the app ----

test('help: a name in quotation marks is a real name in the app', () => {
  const app = webSources();
  // Names of screens that are built after this text. Take a name out of this list when its screen exists.
  const notBuiltYet = ['Help', 'why?'];
  const examples = ['Facebook'];
  for (const { where, value } of allTexts()) {
    for (const [, name] of value.matchAll(/"([^"]+)"/g)) {
      if (notBuiltYet.includes(name) || examples.includes(name)) continue;
      assert.ok(app.includes(`'${name}'`), `${where}: the app has no text "${name}"`);
    }
  }
});
