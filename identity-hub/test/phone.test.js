// Phone module with the mock provider: numbers, texts, calls, linked phones, webhooks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startTestApp, client, newAccount, b64u, unb64u } from './helpers.js';
import { createApp } from '../server/app.js';
import { openJson } from '../shared/crypto.js';
import { randomBytes } from '../shared/bytes.js';
import { ProviderError } from '../server/phone/providers/errors.js';

const PUBLIC = 'http://localhost:8080';
const STATUS_URL = PUBLIC + '/api/hooks/phone/status';
const NOT_AVAILABLE = [{ say: 'The person you called is not available.' }, { hangup: true }];

let app;
let mock;
// Every plain number and message text that the tests use. The last test looks for them in the database file.
const secrets = [];

before(async () => {
  // mockAutoAnswer off: the tests decide when a simulated phone answers.
  app = await startTestApp({ phone: { provider: 'mock', mockAutoAnswer: false, countries: ['US', 'CA', 'GB'] } });
  mock = app.services.phone.mock;
});
after(async () => { await app.stop(); });

let counter = 0;
const remember = (v) => { secrets.push(v); return v; };
// A real mobile phone of a user, and a caller from the outside world.
const realPhone = () => remember(`+1650555${2000 + counter++}`);
const outsider = () => remember(`+1305555${2000 + counter++}`);
const now = () => Math.floor(Date.now() / 1000);

async function buyNumber(acct, query = 'country=US&areaCode=415') {
  const s = await acct.api.get('/api/numbers/search?' + query);
  assert.equal(s.status, 200);
  const res = await acct.api.post('/api/numbers', { number: s.data.numbers[0].number });
  assert.equal(res.status, 201);
  return { ...res.data.number, plain: remember(res.data.plain) };
}

async function requestCode(acct, num, number, extra = {}) {
  const res = await acct.api.post('/api/phones', { number, via: { numberId: num.id, number: num.plain }, ...extra });
  if (res.status !== 201) return { res, code: null };
  const sent = mock.outbox.texts.findLast((t) => t.to === number);
  return { res, code: /code is (\d{6})\./.exec(sent.body)[1], sent };
}

async function linkPhone(acct, num, number = realPhone()) {
  const { res, code } = await requestCode(acct, num, number);
  assert.equal(res.status, 201);
  const v = await acct.api.post(`/api/phones/${res.data.phone.id}/verify`, { code });
  assert.equal(v.status, 200);
  assert.equal(v.data.phone.verified, true);
  return { ...v.data.phone, plain: number };
}

// A webhook request over HTTP, as the mock provider would send it. sig: undefined = valid, null = no header.
function hook(name, payload, sig, query = '') {
  const raw = JSON.stringify(payload);
  const headers = { 'content-type': 'application/json' };
  if (sig !== null) headers['x-mock-signature'] = sig ?? app.keys.sign('mock-hook', raw);
  return client(app).call('POST', `/api/hooks/phone/${name}${query}`, raw, headers);
}

const texts = async (acct, num, query = '') => (await acct.api.get(`/api/numbers/${num.id}/texts${query}`)).data;
const calls = async (acct, num) => (await acct.api.get(`/api/numbers/${num.id}/calls`)).data.calls;
const openText = (acct, t) => openJson(acct.keys, unb64u(t.sealed), 'text');
const openCall = (acct, k) => openJson(acct.keys, unb64u(k.sealed), 'call');
const ledger = (acct) => app.store.ledger(acct.id).map((l) => `${l.kind}:${l.delta}`);
const unread = async (acct, num) => (await acct.api.get('/api/numbers')).data.numbers.find((n) => n.id === num.id).unread;
const countRows = (table, accountId) => app.db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`, accountId).n;

test('numbers: search, buy, list; the sealed number opens with the account keys', async () => {
  const a = await newAccount(app, { credits: 1000 });
  const b = await newAccount(app, { credits: 1000 });
  assert.equal((await client(app).get('/api/numbers/search?country=US')).status, 401);
  assert.equal((await a.api.get('/api/numbers/search?country=XX')).status, 400);
  assert.equal((await a.api.get('/api/numbers/search?country=US&areaCode=41a')).status, 400);

  const s = await a.api.get('/api/numbers/search?country=US&areaCode=212');
  assert.equal(s.status, 200);
  assert.equal(s.data.numbers.length, 20);
  for (const n of s.data.numbers) {
    assert.match(n.number, /^\+1212555\d{4}$/);
    assert.deepEqual(Object.keys(n).sort(), ['country', 'locality', 'number', 'region', 'sms', 'voice']);
    assert.equal(n.country, 'US');
  }
  const gb = await a.api.get('/api/numbers/search?country=gb');
  assert.match(gb.data.numbers[0].number, /^\+447700900\d{3}$/);

  const pick = remember(s.data.numbers[3].number);
  const enc = b64u(randomBytes(48));
  const made = await a.api.post('/api/numbers', { number: pick, enc });
  assert.equal(made.status, 201);
  assert.equal(made.data.plain, pick);
  const n = made.data.number;
  assert.match(n.id, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(n.enc, enc);
  assert.equal(n.country, 'US');
  assert.equal(n.sms, true);
  assert.equal(n.voice, true);
  assert.equal(n.status, 'active');
  assert.ok(Math.abs(n.paidUntil - (now() + 30 * 86400)) < 60);
  assert.match(n.createdDay, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(n.forwardPhoneId, null);
  assert.equal(n.forwardTexts, false);
  assert.equal(n.forwardCalls, false);
  assert.equal(n.unread, 0);

  // Only the account can read the number.
  assert.deepEqual(await openJson(a.keys, unb64u(n.sealedNumber), 'number'), { number: pick });
  await assert.rejects(openJson(b.keys, unb64u(n.sealedNumber), 'number'));

  const list = await a.api.get('/api/numbers');
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.numbers, [n]);
  assert.deepEqual((await b.api.get('/api/numbers')).data.numbers, []);
  assert.equal((await client(app).get('/api/numbers')).status, 401);

  // The charge.
  assert.equal(app.store.balance(a.id), 600);
  assert.deepEqual(ledger(a), ['number:-400', 'topup:1000']);
  assert.ok([...mock.owned.values()].includes(pick));

  // A number that is owned is not offered again and cannot be bought again.
  const again = await b.api.get('/api/numbers/search?country=US&areaCode=212');
  assert.equal(again.data.numbers.length, 20);
  assert.ok(!again.data.numbers.some((x) => x.number === pick));
  for (const who of [a, b]) {
    const dup = await who.api.post('/api/numbers', { number: pick });
    assert.equal(dup.status, 409);
    assert.equal(dup.data.error.code, 'taken');
  }
  // A number that no search offered to this account cannot be bought.
  const cold = await b.api.post('/api/numbers', { number: '+18005550123' });
  assert.equal(cold.status, 409);
  assert.equal(cold.data.error.code, 'taken');
  assert.equal(app.store.balance(b.id), 1000);
  assert.equal((await a.api.post('/api/numbers', { number: '4155550100' })).status, 400);
  assert.equal((await a.api.post('/api/numbers', { number: pick, enc: b64u(randomBytes(2049)) })).status, 400);
});

test('numbers: 402 when the balance is too low, refund when the provider fails', async () => {
  const poor = await newAccount(app, { credits: 399 });
  const s = await poor.api.get('/api/numbers/search?country=US&areaCode=312');
  const number = s.data.numbers[0].number;
  const owned = mock.owned.size;
  const res = await poor.api.post('/api/numbers', { number });
  assert.equal(res.status, 402);
  assert.equal(res.data.error.code, 'insufficient_funds');
  assert.equal(res.data.error.needed, 400);
  assert.equal(mock.owned.size, owned);
  assert.equal(app.store.balance(poor.id), 399);

  const a = await newAccount(app, { credits: 500 });
  await a.api.get('/api/numbers/search?country=US&areaCode=312');
  mock.failNext('buy');
  const failed = await a.api.post('/api/numbers', { number });
  assert.equal(failed.status, 502);
  assert.equal(failed.data.error.code, 'provider_error');
  assert.equal(app.store.balance(a.id), 500);
  assert.deepEqual(ledger(a), ['refund:400', 'number:-400', 'topup:500']);
  assert.deepEqual((await a.api.get('/api/numbers')).data.numbers, []);

  // The provider says that the number is gone: 409, and the charge comes back too.
  mock.failNext('buy', new ProviderError('gone', { unavailable: true }));
  const gone = await a.api.post('/api/numbers', { number });
  assert.equal(gone.status, 409);
  assert.equal(gone.data.error.code, 'taken');
  assert.equal(app.store.balance(a.id), 500);

  // The offer is still good after a failure.
  assert.equal((await a.api.post('/api/numbers', { number })).status, 201);
  assert.equal(app.store.balance(a.id), 100);
  remember(number);
});

test('numbers: limit', async () => {
  const a = await newAccount(app, { credits: 2000 });
  const old = app.config.limits.numbers;
  app.config.limits.numbers = 2;
  try {
    await buyNumber(a, 'country=US&areaCode=512');
    await buyNumber(a, 'country=US&areaCode=512');
    const s = await a.api.get('/api/numbers/search?country=US&areaCode=512');
    const res = await a.api.post('/api/numbers', { number: s.data.numbers[0].number });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, 'limit_reached');
    assert.equal(app.store.balance(a.id), 1200);

    // Two requests at the same time cannot both pass the limit.
    const c = await newAccount(app, { credits: 2000 });
    await buyNumber(c, 'country=US&areaCode=512');
    const offer = (await c.api.get('/api/numbers/search?country=US&areaCode=512')).data.numbers;
    const both = await Promise.all([c.api.post('/api/numbers', { number: offer[0].number }), c.api.post('/api/numbers', { number: offer[1].number })]);
    assert.deepEqual(both.map((r) => r.status).sort(), [201, 409]);
    assert.equal(countRows('numbers', c.id), 2);
    assert.equal(app.store.balance(c.id), 1200);
    remember(both.find((r) => r.status === 201).data.plain);
  } finally {
    app.config.limits.numbers = old;
  }
});

test('texts: send; charged, in the provider outbox, stored sealed', async () => {
  const a = await newAccount(app, { credits: 500 });
  const num = await buyNumber(a);
  const to = outsider();
  const body = remember('Is the bike still for sale? 7f3a');
  const res = await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to, body });
  assert.equal(res.status, 201);
  const t = res.data.text;
  assert.equal(t.direction, 'out');
  assert.equal(t.seen, true);
  assert.ok(Math.abs(t.at - now()) < 60);
  assert.deepEqual(await openText(a, t), { peer: to, body });

  assert.equal(app.store.balance(a.id), 500 - 400 - 3);
  assert.equal(ledger(a)[0], 'text:-3');
  const sent = mock.outbox.texts.at(-1);
  assert.equal(sent.from, num.plain);
  assert.equal(sent.to, to);
  assert.equal(sent.body, body);

  const list = await texts(a, num);
  assert.deepEqual(list, { texts: [t], more: false });
  assert.equal(await unread(a, num), 0);

  // The stored row has no plain text.
  const row = app.db.get('SELECT * FROM texts WHERE id = ?', t.id);
  assert.ok(!Buffer.from(row.sealed).includes(body));
  assert.ok(!Buffer.from(row.sealed).includes(to));

  // Bad input costs nothing and sends nothing.
  const sentCount = mock.outbox.texts.length;
  assert.equal((await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: '4155550100', body })).status, 400);
  assert.equal((await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to, body: '' })).status, 400);
  assert.equal((await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to, body: 'x'.repeat(1601) })).status, 400);
  assert.equal((await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to, body: 'x'.repeat(1600) })).status, 201);
  assert.equal(mock.outbox.texts.length, sentCount + 1);

  // The provider refuses: 502 with a plain message, and the charge comes back.
  const before = app.store.balance(a.id);
  mock.failNext('sendText', new ProviderError('The telephone provider refused this text.', { status: 400, code: 21610 }));
  const refused = await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to, body: 'again' });
  assert.equal(refused.status, 502);
  assert.deepEqual(refused.data.error, { code: 'provider_error', message: 'The telephone provider refused this text.' });
  assert.equal(app.store.balance(a.id), before);
  assert.deepEqual(ledger(a).slice(0, 2), ['refund:3', 'text:-3']);
  assert.equal((await texts(a, num)).texts.length, 2);

  // No credits: 402.
  const poor = await newAccount(app, { credits: 402 });
  const pn = await buyNumber(poor);
  const no = await poor.api.post(`/api/numbers/${pn.id}/texts`, { number: pn.plain, to, body: 'hi' });
  assert.equal(no.status, 402);
  assert.equal(no.data.error.needed, 3);
});

test('texts: the plain number must match the stored HMAC', async () => {
  const a = await newAccount(app, { credits: 1000 });
  const num = await buyNumber(a);
  const other = await buyNumber(a);
  const sent = mock.outbox.texts.length;
  for (const wrong of [other.plain, '+14155559999']) {
    const res = await a.api.post(`/api/numbers/${num.id}/texts`, { number: wrong, to: '+14155550001', body: 'hi' });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'bad_request');
  }
  const call = await a.api.post(`/api/numbers/${num.id}/calls`, { number: other.plain, to: '+14155550001' });
  assert.equal(call.status, 400);
  const link = await a.api.post('/api/phones', { number: realPhone(), via: { numberId: num.id, number: other.plain } });
  assert.equal(link.status, 400);
  assert.equal(mock.outbox.texts.length, sent);
  assert.equal(app.store.balance(a.id), 200);
});

test('webhook: incoming text with a valid signature; 403 with a bad one', async () => {
  const a = await newAccount(app, { credits: 500 });
  const num = await buyNumber(a);
  const from = outsider();
  const body = remember('Yes, it is. Come at five. 91bc');

  const ok = await hook('text', { to: num.plain, from, body });
  assert.equal(ok.status, 200);
  let list = await texts(a, num);
  assert.equal(list.texts.length, 1);
  assert.equal(list.texts[0].direction, 'in');
  assert.equal(list.texts[0].seen, false);
  assert.deepEqual(await openText(a, list.texts[0]), { peer: from, body });
  assert.equal(await unread(a, num), 1);
  // Receiving is free.
  assert.equal(app.store.balance(a.id), 100);

  // Wrong signature, signature of a different body, no signature.
  const raw = JSON.stringify({ to: num.plain, from, body: 'other' });
  for (const sig of ['AAAA', app.keys.sign('mock-hook', raw), app.keys.sign('other-purpose', JSON.stringify({ to: num.plain, from, body })), null, '']) {
    const bad = await hook('text', { to: num.plain, from, body }, sig);
    assert.equal(bad.status, 403);
    assert.equal(bad.data.error.code, 'bad_signature');
  }
  for (const name of ['voice', 'bridge', 'status']) assert.equal((await hook(name, { to: num.plain, from, callId: 'x' }, 'AAAA')).status, 403);
  assert.equal((await texts(a, num)).texts.length, 1);
  assert.equal(countRows('calls', a.id), 0);

  // A number that nobody has: the same answer as for a good one, and nothing is stored.
  const total = app.db.get('SELECT COUNT(*) AS n FROM texts').n;
  const unknown = await hook('text', { to: '+14155559876', from, body });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.data, ok.data);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM texts').n, total);

  // The provider delivers one message two times (same message id): it is stored one time.
  const twice = { to: num.plain, from, body: 'Only once, please', id: 'msg-777' };
  assert.equal((await hook('text', twice)).status, 200);
  assert.equal((await hook('text', twice)).status, 200);
  assert.equal((await texts(a, num)).texts.length, 2);
  assert.equal((await a.api.del(`/api/texts/${(await texts(a, num)).texts[0].id}`)).status, 204);

  // Mark as seen, then delete.
  assert.equal((await a.api.post(`/api/numbers/${num.id}/texts/seen`)).status, 204);
  assert.equal(await unread(a, num), 0);
  list = await texts(a, num);
  assert.equal(list.texts[0].seen, true);
  assert.equal((await a.api.del(`/api/texts/${list.texts[0].id}`)).status, 204);
  assert.equal((await a.api.del(`/api/texts/${list.texts[0].id}`)).status, 404);
  assert.equal((await texts(a, num)).texts.length, 0);
});

test('texts: pages with before and limit', async () => {
  const a = await newAccount(app, { credits: 500 });
  const num = await buyNumber(a);
  const from = outsider();
  for (let i = 0; i < 5; i++) await hook('text', { to: num.plain, from, body: `m${i}` });
  // Give the rows different times: m0 is the oldest. m1 and m2 arrive in the same second.
  const rows = app.db.all('SELECT id FROM texts WHERE number_id = ? ORDER BY rowid', num.id);
  [100, 200, 200, 300, 400].forEach((at, i) => app.db.run('UPDATE texts SET at = ? WHERE id = ?', at, rows[i].id));
  const bodies = async (list) => Promise.all(list.map(async (t) => (await openText(a, t)).body));

  const all = await texts(a, num);
  assert.deepEqual(await bodies(all.texts), ['m4', 'm3', 'm2', 'm1', 'm0']);
  assert.equal(all.more, false);

  const p1 = await texts(a, num, '?limit=2');
  assert.deepEqual(await bodies(p1.texts), ['m4', 'm3']);
  assert.equal(p1.more, true);
  // The page would end between m2 and m1, which have the same time. It takes both, so that `before` skips nothing.
  const p2 = await texts(a, num, `?limit=1&before=${p1.texts.at(-1).at}`);
  assert.deepEqual(await bodies(p2.texts), ['m2', 'm1']);
  assert.equal(p2.more, true);
  const p3 = await texts(a, num, `?limit=2&before=${p2.texts.at(-1).at}`);
  assert.deepEqual(await bodies(p3.texts), ['m0']);
  assert.equal(p3.more, false);

  assert.equal((await a.api.get(`/api/numbers/${num.id}/texts?limit=0`)).status, 400);
  assert.equal((await a.api.get(`/api/numbers/${num.id}/texts?before=abc`)).status, 400);
  assert.equal((await a.api.get(`/api/numbers/${num.id}/texts?limit=9999`)).status, 200);
});

test('texts: two accounts on this server text each other', async () => {
  const a = await newAccount(app, { credits: 500 });
  const b = await newAccount(app, { credits: 500 });
  const na = await buyNumber(a);
  const nb = await buyNumber(b);
  const hello = remember('Hello B, this is A. c41d');
  const reply = remember('Hello A, B here. e02f');

  assert.equal((await a.api.post(`/api/numbers/${na.id}/texts`, { number: na.plain, to: nb.plain, body: hello })).status, 201);
  let inbox = await texts(b, nb);
  assert.equal(inbox.texts.length, 1);
  assert.equal(inbox.texts[0].direction, 'in');
  assert.deepEqual(await openText(b, inbox.texts[0]), { peer: na.plain, body: hello });
  assert.equal(await unread(b, nb), 1);

  assert.equal((await b.api.post(`/api/numbers/${nb.id}/texts`, { number: nb.plain, to: na.plain, body: reply })).status, 201);
  inbox = await texts(a, na);
  assert.deepEqual(inbox.texts.map((t) => t.direction).sort(), ['in', 'out']);
  assert.deepEqual(await openText(a, inbox.texts.find((t) => t.direction === 'in')), { peer: nb.plain, body: reply });
  // A cannot open what was sealed for B.
  await assert.rejects(openText(a, (await texts(b, nb)).texts[0]));
  // Only the sender pays.
  assert.equal(app.store.balance(a.id), 97);
  assert.equal(app.store.balance(b.id), 97);
});

test('phones: link with a code from a text, verify, wrong codes, expiry, limit', async () => {
  const a = await newAccount(app, { credits: 1000 });
  const number = realPhone();

  // No VoIP number yet.
  const none = await a.api.post('/api/phones', { number, via: { numberId: 'x'.repeat(22), number: '+14155550100' } });
  assert.equal(none.status, 409);
  assert.equal(none.data.error.code, 'no_number');

  const num = await buyNumber(a);
  assert.equal((await a.api.post('/api/phones', { number })).status, 400);
  assert.equal((await a.api.post('/api/phones', { number: '0123', via: { numberId: num.id, number: num.plain } })).status, 400);
  assert.equal((await a.api.post('/api/phones', { number, via: { numberId: 'A'.repeat(22), number: num.plain } })).status, 404);
  // One of the account's own VoIP numbers is not a real phone.
  assert.equal((await a.api.post('/api/phones', { number: num.plain, via: { numberId: num.id, number: num.plain } })).status, 400);
  assert.equal(app.store.balance(a.id), 600);

  const enc = b64u(randomBytes(30));
  const { res, code, sent } = await requestCode(a, num, number, { enc });
  assert.equal(res.status, 201);
  const phone = res.data.phone;
  assert.deepEqual(Object.keys(phone).sort(), ['createdDay', 'enc', 'id', 'sealedNumber', 'verified']);
  assert.equal(phone.verified, false);
  assert.equal(phone.enc, enc);
  assert.deepEqual(await openJson(a.keys, unb64u(phone.sealedNumber), 'phone'), { number });
  assert.equal(sent.from, num.plain);
  assert.equal(sent.body, `Your Postern code is ${code}. Do not share it.`);
  assert.equal(app.store.balance(a.id), 597);
  assert.equal(ledger(a)[0], 'text:-3');
  assert.deepEqual((await a.api.get('/api/phones')).data.phones, [phone]);

  // The database has a hash of the code, not the code. The number is encrypted for the server.
  const row = app.db.get('SELECT * FROM phones WHERE id = ?', phone.id);
  assert.equal(row.code_hash.length, 32);
  assert.ok(Math.abs(row.code_expires - (now() + 600)) < 60);
  assert.equal(app.keys.srvDecrypt(row.number_srv, 'phone').toString(), number);

  // A phone that is not verified cannot be a forward target.
  const early = await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: phone.id });
  assert.equal(early.status, 409);

  // Wrong code, malformed code.
  const wrong = code === '000000' ? '000001' : '000000';
  const bad = await a.api.post(`/api/phones/${phone.id}/verify`, { code: wrong });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error.code, 'bad_code');
  for (const c of ['12345', 'abcdef', 123456, undefined]) {
    const r = await a.api.post(`/api/phones/${phone.id}/verify`, { code: c });
    assert.equal(r.status, 400);
    assert.equal(r.data.error.code, 'bad_code');
  }
  assert.equal(app.db.get('SELECT code_tries FROM phones WHERE id = ?', phone.id).code_tries, 1);

  // The right code.
  const good = await a.api.post(`/api/phones/${phone.id}/verify`, { code });
  assert.equal(good.status, 200);
  assert.equal(good.data.phone.verified, true);
  assert.equal(app.db.get('SELECT code_hash FROM phones WHERE id = ?', phone.id).code_hash, null);
  // A verified phone cannot be linked a second time.
  const dup = await requestCode(a, num, number);
  assert.equal(dup.res.status, 409);
  assert.equal(dup.res.data.error.code, 'conflict');
  assert.equal(app.store.balance(a.id), 597);

  // Too many tries: after 5 wrong codes the right code does not work any more.
  const second = realPhone();
  const p2 = await requestCode(a, num, second);
  const wrong2 = p2.code === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await a.api.post(`/api/phones/${p2.res.data.phone.id}/verify`, { code: wrong2 })).status, 400);
  const locked = await a.api.post(`/api/phones/${p2.res.data.phone.id}/verify`, { code: p2.code });
  assert.equal(locked.status, 400);
  assert.equal(locked.data.error.code, 'bad_code');
  assert.equal((await a.api.get('/api/phones')).data.phones.find((p) => p.id === p2.res.data.phone.id).verified, false);

  // The same request again sends a new code for the same phone. The old code is dead.
  const p2b = await requestCode(a, num, second);
  assert.equal(p2b.res.status, 201);
  assert.equal(p2b.res.data.phone.id, p2.res.data.phone.id);
  assert.equal((await a.api.get('/api/phones')).data.phones.length, 2);

  // Expired code.
  app.db.run('UPDATE phones SET code_expires = ? WHERE id = ?', now() - 1, p2.res.data.phone.id);
  const late = await a.api.post(`/api/phones/${p2.res.data.phone.id}/verify`, { code: p2b.code });
  assert.equal(late.status, 400);
  assert.equal(late.data.error.code, 'bad_code');
  const p2c = await requestCode(a, num, second);
  assert.equal((await a.api.post(`/api/phones/${p2.res.data.phone.id}/verify`, { code: p2c.code })).status, 200);

  // Limit.
  const old = app.config.limits.phones;
  app.config.limits.phones = 2;
  try {
    const over = await requestCode(a, num, realPhone());
    assert.equal(over.res.status, 409);
    assert.equal(over.res.data.error.code, 'limit_reached');
  } finally {
    app.config.limits.phones = old;
  }

  // The provider cannot send the code: nothing is linked and the charge comes back.
  const balance = app.store.balance(a.id);
  mock.failNext('sendText');
  const failed = await requestCode(a, num, realPhone());
  assert.equal(failed.res.status, 502);
  assert.equal(app.store.balance(a.id), balance);
  assert.equal((await a.api.get('/api/phones')).data.phones.length, 2);

  // Delete clears the forwarding that used the phone.
  await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: phone.id, forwardTexts: true, forwardCalls: true });
  assert.equal((await a.api.del(`/api/phones/${phone.id}`)).status, 204);
  const after = (await a.api.get('/api/numbers')).data.numbers[0];
  assert.equal(after.forwardPhoneId, null);
  assert.equal(after.forwardTexts, false);
  assert.equal(after.forwardCalls, false);
  assert.equal((await a.api.del(`/api/phones/${phone.id}`)).status, 404);
});

test('forwarding: texts go to the verified phone and are charged; not when the balance is too low', async () => {
  // Credits for the number, the code text, and exactly one forwarded text.
  const a = await newAccount(app, { credits: 400 + 3 + 3 });
  const num = await buyNumber(a);
  const phone = await linkPhone(a, num);
  const stranger = await newAccount(app, { credits: 500 });
  const sn = await buyNumber(stranger);
  const foreign = await linkPhone(stranger, sn);

  // The forward target must be a phone of this account.
  assert.equal((await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: foreign.id })).status, 404);
  assert.equal((await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: 'nope' })).status, 404);
  assert.equal((await a.api.patch(`/api/numbers/${num.id}`, { forwardTexts: 'yes' })).status, 400);
  const enc = b64u(randomBytes(20));
  const set = await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: phone.id, forwardTexts: true, enc });
  assert.equal(set.status, 200);
  assert.equal(set.data.number.forwardPhoneId, phone.id);
  assert.equal(set.data.number.forwardTexts, true);
  assert.equal(set.data.number.forwardCalls, false);
  assert.equal(set.data.number.enc, enc);

  const from = outsider();
  const first = remember('First message 5a5a');
  const sent = mock.outbox.texts.length;
  assert.equal((await hook('text', { to: num.plain, from, body: first })).status, 200);
  assert.equal(mock.outbox.texts.length, sent + 1);
  const forwarded = mock.outbox.texts.at(-1);
  assert.deepEqual({ from: forwarded.from, to: forwarded.to, body: forwarded.body }, { from: num.plain, to: phone.plain, body: `${from}: ${first}` });
  assert.equal(app.store.balance(a.id), 0);
  assert.equal(ledger(a)[0], 'text:-3');

  // The provider repeats a webhook (same message id): no second copy, no second forward, no second charge.
  app.store.credit(a.id, 3, 'topup');
  const repeat = { to: num.plain, from, body: remember('Repeated message 7c7c'), id: 'msg-fwd-1' };
  await hook('text', repeat);
  await hook('text', repeat);
  assert.equal(mock.outbox.texts.length, sent + 2);
  assert.equal((await texts(a, num)).texts.length, 2);
  assert.equal(app.store.balance(a.id), 0);

  // The balance is 0 now: the text is stored but not forwarded.
  const second = remember('Second message 6b6b');
  assert.equal((await hook('text', { to: num.plain, from, body: second })).status, 200);
  assert.equal(mock.outbox.texts.length, sent + 2);
  assert.equal((await texts(a, num)).texts.length, 3);
  assert.equal(await unread(a, num), 3);

  // A text from the linked phone itself is not sent back to it.
  app.store.credit(a.id, 100, 'topup');
  assert.equal((await hook('text', { to: num.plain, from: phone.plain, body: 'from my own phone' })).status, 200);
  assert.equal(mock.outbox.texts.length, sent + 2);
  assert.equal(app.store.balance(a.id), 100);

  // The provider refuses the forward: the text stays and the charge comes back.
  mock.failNext('sendText');
  assert.equal((await hook('text', { to: num.plain, from, body: 'third' })).status, 200);
  assert.equal(app.store.balance(a.id), 100);
  assert.equal((await texts(a, num)).texts.length, 5);
  assert.deepEqual(ledger(a).slice(0, 2), ['refund:3', 'text:-3']);

  // Forwarding off: nothing goes out.
  assert.equal((await a.api.patch(`/api/numbers/${num.id}`, { forwardTexts: false })).data.number.forwardTexts, false);
  await hook('text', { to: num.plain, from, body: 'fourth' });
  assert.equal(mock.outbox.texts.length, sent + 2);

  // Clearing the phone also clears the switches.
  await a.api.patch(`/api/numbers/${num.id}`, { forwardTexts: true, forwardCalls: true });
  const cleared = await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: null });
  assert.equal(cleared.data.number.forwardPhoneId, null);
  assert.equal(cleared.data.number.forwardTexts, false);
  assert.equal(cleared.data.number.forwardCalls, false);
});

test('forwarding: an incoming call rings the verified phone; the status webhook writes the log and charges', async () => {
  // After the number and the code text, 4 credits are left.
  const a = await newAccount(app, { credits: 400 + 3 + 4 + 6 });
  const num = await buyNumber(a);
  const phone = await linkPhone(a, num);
  const caller = outsider();

  // No forwarding yet: the caller hears a message, and a missed call is recorded.
  const v0 = await hook('voice', { to: num.plain, from: caller, callId: 'call-0' });
  assert.equal(v0.status, 200);
  assert.deepEqual(v0.data.actions, NOT_AVAILABLE);
  let log = await calls(a, num);
  assert.equal(log.length, 1);
  assert.deepEqual({ direction: log[0].direction, seconds: log[0].seconds, status: log[0].status }, { direction: 'in', seconds: 0, status: 'missed' });
  assert.deepEqual(await openCall(a, log[0]), { peer: caller });
  // A late status report for that call changes nothing. A repeated webhook adds no second line.
  await hook('status', { callId: 'call-0', status: 'answered', seconds: 500 });
  assert.deepEqual((await hook('voice', { to: num.plain, from: caller, callId: 'call-0' })).data.actions, NOT_AVAILABLE);
  assert.equal((await calls(a, num)).length, 1);
  assert.equal(app.store.balance(a.id), 10);

  await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: phone.id, forwardCalls: true });
  const v1 = await hook('voice', { to: num.plain, from: caller, callId: 'call-1' });
  assert.equal(v1.status, 200);
  // The real phone rings for 25 seconds and shows the original caller.
  // The balance (10) pays for 3 minutes: the provider ends the call after 180 seconds.
  assert.deepEqual(v1.data.actions, [{ dial: { number: phone.plain, callerId: caller, timeout: 25, timeLimit: 180, actionUrl: STATUS_URL } }]);
  assert.equal((await calls(a, num)).length, 1);

  const st = await hook('status', { callId: 'call-1', status: 'answered', seconds: 61 });
  assert.equal(st.status, 200);
  assert.deepEqual(st.data.actions, [{ hangup: true }]);
  log = await calls(a, num);
  assert.equal(log.length, 2);
  assert.deepEqual({ direction: log[0].direction, seconds: log[0].seconds, status: log[0].status }, { direction: 'in', seconds: 61, status: 'answered' });
  assert.deepEqual(await openCall(a, log[0]), { peer: caller });
  // 61 seconds are 2 minutes.
  assert.equal(app.store.balance(a.id), 4);
  assert.equal(ledger(a)[0], 'call:-6');

  // The provider reports the end of the same call again: no second charge, no second row.
  await hook('status', { callId: 'call-1', status: 'answered', seconds: 600 });
  assert.equal(app.store.balance(a.id), 4);
  assert.equal((await calls(a, num)).length, 2);
  // The voice webhook of a call that is finished comes again: no new ringing, no new line.
  assert.deepEqual((await hook('voice', { to: num.plain, from: caller, callId: 'call-1' })).data.actions, NOT_AVAILABLE);
  await hook('status', { callId: 'call-1', status: 'answered', seconds: 600 });
  assert.equal((await calls(a, num)).length, 2);
  assert.equal(app.store.balance(a.id), 4);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM live_calls').n, 0);
  // A status for a call that never started does nothing.
  await hook('status', { callId: 'call-unknown', status: 'answered', seconds: 600 });
  assert.equal(app.store.balance(a.id), 4);

  // A long call with a small balance: the charge is never more than the balance.
  await hook('voice', { to: num.plain, from: caller, callId: 'call-2' });
  await hook('status', { callId: 'call-2', status: 'answered', seconds: 240 });
  assert.equal(app.store.balance(a.id), 0);
  assert.equal(ledger(a)[0], 'call:-4');

  // Balance below one minute: not forwarded, recorded as missed.
  const v3 = await hook('voice', { to: num.plain, from: caller, callId: 'call-3' });
  assert.deepEqual(v3.data.actions, NOT_AVAILABLE);
  log = await calls(a, num);
  assert.equal(log.length, 4);
  assert.equal(log[0].status, 'missed');

  // Forwarded but nobody answers: missed, no charge.
  app.store.credit(a.id, 50, 'topup');
  await hook('voice', { to: num.plain, from: caller, callId: 'call-4' });
  await hook('status', { callId: 'call-4', status: 'missed', seconds: 0 });
  log = await calls(a, num);
  assert.equal(log[0].status, 'missed');
  assert.equal(app.store.balance(a.id), 50);

  // A hidden caller: forwarded with no caller ID.
  const v5 = await hook('voice', { to: num.plain, from: 'anonymous', callId: 'call-5' });
  assert.deepEqual(v5.data.actions, [{ dial: { number: phone.plain, callerId: null, timeout: 25, timeLimit: 960, actionUrl: STATUS_URL } }]);
  await hook('status', { callId: 'call-5', status: 'failed', seconds: 0 });
  log = await calls(a, num);
  assert.equal(log[0].status, 'failed');
  assert.deepEqual(await openCall(a, log[0]), { peer: 'anonymous' });

  // The caller tries to talk for an hour. The provider cuts the call at the time limit (50 credits = 16 minutes).
  const long = await mock.simulateCall({ to: num.plain, from: caller, seconds: 3600 });
  assert.equal(long.forwarded, true);
  log = await calls(a, num);
  assert.deepEqual({ seconds: log[0].seconds, status: log[0].status }, { seconds: 960, status: 'answered' });
  assert.equal(app.store.balance(a.id), 2);

  // A call to a number that nobody has gets the same neutral answer, and nothing is stored.
  const total = app.db.get('SELECT COUNT(*) AS n FROM calls').n;
  const vx = await hook('voice', { to: '+14155559876', from: caller, callId: 'call-x' });
  assert.equal(vx.status, 200);
  assert.deepEqual(vx.data.actions, NOT_AVAILABLE);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM calls').n, total);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM live_calls').n, 0);

  // Delete a call from the log.
  assert.equal((await a.api.del(`/api/calls/${log[0].id}`)).status, 204);
  assert.equal((await a.api.del(`/api/calls/${log[0].id}`)).status, 404);
  assert.equal((await calls(a, num)).length, 6);
});

test('click-to-call: the real phone rings first, the bridge webhook connects it with the VoIP number as caller ID', async () => {
  const a = await newAccount(app, { credits: 400 + 3 + 2 });
  const num = await buyNumber(a);
  const to = outsider();

  // No verified phone on this number.
  const early = await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to });
  assert.equal(early.status, 409);
  assert.equal(early.data.error.code, 'no_phone');

  const phone = await linkPhone(a, num);
  await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: phone.id });
  assert.equal((await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to: 'abc' })).status, 400);

  // 2 credits are less than one minute.
  const poor = await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to });
  assert.equal(poor.status, 402);
  assert.equal(poor.data.error.needed, 3);
  assert.equal(mock.ringing.size, 0);

  app.store.credit(a.id, 98, 'topup');
  const res = await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to });
  assert.equal(res.status, 201);
  assert.deepEqual(res.data, { ok: true });

  // The provider calls the real phone from the VoIP number.
  const first = mock.outbox.calls.at(-1);
  assert.equal(first.from, num.plain);
  assert.equal(first.to, phone.plain);
  const ringing = mock.ringing.get(first.ref);
  const answerUrl = new URL(ringing.answerUrl);
  assert.equal(answerUrl.origin, PUBLIC);
  assert.equal(answerUrl.pathname, '/api/hooks/phone/bridge');
  assert.match(answerUrl.searchParams.get('t'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(ringing.statusUrl, STATUS_URL);
  assert.equal((await calls(a, num)).length, 0);

  // The real phone answers: the provider asks the bridge webhook what to do.
  const wrongToken = await hook('bridge', { callId: 'some-other-call' }, undefined, '?t=' + 'A'.repeat(43));
  assert.equal(wrongToken.status, 200);
  assert.deepEqual(wrongToken.data.actions, [{ hangup: true }]);
  assert.deepEqual((await hook('bridge', { callId: 'some-other-call' })).data.actions, [{ hangup: true }]);
  const bridge = await hook('bridge', { callId: first.ref }, undefined, answerUrl.search);
  assert.equal(bridge.status, 200);
  assert.deepEqual(bridge.data.actions, [{ dial: { number: to, callerId: num.plain, timeout: 25, timeLimit: 1980, actionUrl: STATUS_URL } }]);

  // The call ends after 130 seconds: 3 minutes.
  const st = await hook('status', { callId: first.ref, status: 'answered', seconds: 130 });
  assert.equal(st.status, 200);
  const log = await calls(a, num);
  assert.equal(log.length, 1);
  assert.deepEqual({ direction: log[0].direction, seconds: log[0].seconds, status: log[0].status }, { direction: 'out', seconds: 130, status: 'answered' });
  assert.deepEqual(await openCall(a, log[0]), { peer: to });
  assert.equal(app.store.balance(a.id), 100 - 9);
  assert.equal(ledger(a)[0], 'call:-9');

  // The same flow with the mock helper; the destination does not answer.
  await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to });
  const ref2 = mock.outbox.calls.at(-1).ref;
  const out = await mock.answerCall(ref2, { peerAnswered: false });
  assert.equal(out.bridged, true);
  assert.deepEqual({ ...mock.outbox.calls.at(-1), at: 0 }, { from: num.plain, to, at: 0, ref: ref2 });
  assert.equal((await calls(a, num))[0].status, 'missed');
  assert.equal(app.store.balance(a.id), 91);

  // The real phone does not answer at all.
  await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to });
  await mock.answerCall(mock.outbox.calls.at(-1).ref, { answered: false });
  assert.equal((await calls(a, num)).length, 3);
  assert.equal(app.store.balance(a.id), 91);

  // The provider cannot start the call.
  mock.failNext('startCall');
  const failed = await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to });
  assert.equal(failed.status, 502);
  assert.equal(failed.data.error.code, 'provider_error');
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM live_calls').n, 0);

  // The real phone answers, but the call cannot be connected any more (the number was suspended in
  // between). The call is logged as failed. The seconds that the real phone was on the line cost nothing.
  await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to });
  const ref5 = mock.outbox.calls.at(-1).ref;
  const url5 = new URL(mock.ringing.get(ref5).answerUrl);
  app.db.run("UPDATE numbers SET status = 'suspended' WHERE id = ?", num.id);
  const refusedBridge = await hook('bridge', { callId: ref5 }, undefined, url5.search);
  app.db.run("UPDATE numbers SET status = 'active' WHERE id = ?", num.id);
  assert.deepEqual(refusedBridge.data.actions, [{ say: 'This call cannot be connected.' }, { hangup: true }]);
  await hook('status', { callId: ref5, status: 'answered', seconds: 8 });
  const log5 = await calls(a, num);
  assert.equal(log5.length, 4);
  assert.deepEqual({ direction: log5[0].direction, seconds: log5[0].seconds, status: log5[0].status }, { direction: 'out', seconds: 0, status: 'failed' });
  assert.equal(app.store.balance(a.id), 91);
});

test('delete: the number is released at the provider; its texts and calls go away', async () => {
  const a = await newAccount(app, { credits: 1000 });
  const num = await buyNumber(a);
  const keep = await buyNumber(a);
  await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: outsider(), body: 'bye' });
  await hook('voice', { to: num.plain, from: outsider(), callId: 'del-1' });
  assert.equal(countRows('texts', a.id), 1);
  assert.equal(countRows('calls', a.id), 1);
  const ref = [...mock.owned.entries()].find(([, n]) => n === num.plain)[0];

  // The provider fails: 502, and the number stays.
  mock.failNext('release');
  const failed = await a.api.del(`/api/numbers/${num.id}`);
  assert.equal(failed.status, 502);
  assert.equal(failed.data.error.code, 'provider_error');
  assert.equal((await a.api.get('/api/numbers')).data.numbers.length, 2);
  assert.ok(mock.owned.has(ref));

  assert.equal((await a.api.del(`/api/numbers/${num.id}`)).status, 204);
  assert.ok(mock.released.includes(ref));
  assert.ok(!mock.owned.has(ref));
  assert.deepEqual((await a.api.get('/api/numbers')).data.numbers.map((n) => n.id), [keep.id]);
  assert.equal(countRows('texts', a.id), 0);
  assert.equal(countRows('calls', a.id), 0);
  assert.equal((await a.api.del(`/api/numbers/${num.id}`)).status, 404);
  assert.equal((await a.api.get(`/api/numbers/${num.id}/texts`)).status, 404);

  // A text to the deleted number goes nowhere.
  const total = app.db.get('SELECT COUNT(*) AS n FROM texts').n;
  assert.equal((await hook('text', { to: num.plain, from: outsider(), body: 'anyone?' })).status, 200);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM texts').n, total);

  // The provider does not know the number any more: that counts as released.
  mock.failNext('release', new ProviderError('gone', { notFound: true, status: 404 }));
  assert.equal((await a.api.del(`/api/numbers/${keep.id}`)).status, 204);
  assert.deepEqual((await a.api.get('/api/numbers')).data.numbers, []);
  // No refund for the rest of the month.
  assert.equal(app.store.balance(a.id), 197);
});

test('renewal: charge when due, suspend without credits, expire after the grace period', async () => {
  const a = await newAccount(app, { credits: 400 + 3 + 400 });
  const num = await buyNumber(a);
  const phone = await linkPhone(a, num);
  await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: phone.id, forwardTexts: true, forwardCalls: true });
  const state = async () => (await a.api.get('/api/numbers')).data.numbers.find((n) => n.id === num.id);

  // Not due: nothing happens.
  await app.runJobs('renew');
  assert.equal(app.store.balance(a.id), 400);

  // Due, and the balance is enough: one more period.
  app.db.run('UPDATE numbers SET paid_until = ? WHERE id = ?', now() - 10, num.id);
  await app.runJobs('renew');
  assert.equal(app.store.balance(a.id), 0);
  assert.equal(ledger(a)[0], 'number:-400');
  assert.equal((await state()).status, 'active');
  assert.ok(Math.abs((await state()).paidUntil - (now() + 30 * 86400)) < 60);

  // Due again with no credits: suspended.
  app.db.run('UPDATE numbers SET paid_until = ? WHERE id = ?', now() - 10, num.id);
  await app.runJobs('renew');
  assert.equal((await state()).status, 'suspended');

  // A suspended number receives nothing and cannot send.
  app.store.credit(a.id, 50, 'topup');
  const sent = mock.outbox.texts.length;
  assert.equal((await hook('text', { to: num.plain, from: outsider(), body: 'hello?' })).status, 200);
  assert.equal((await texts(a, num)).texts.length, 0);
  assert.equal(mock.outbox.texts.length, sent);
  assert.deepEqual((await hook('voice', { to: num.plain, from: outsider(), callId: 'sus-1' })).data.actions, NOT_AVAILABLE);
  assert.equal((await calls(a, num)).length, 0);
  for (const path of ['texts', 'calls']) {
    const res = await a.api.post(`/api/numbers/${num.id}/${path}`, { number: num.plain, to: outsider(), body: 'x' });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, 'suspended');
  }
  const link = await requestCode(a, num, realPhone());
  assert.equal(link.res.status, 409);
  assert.equal(link.res.data.error.code, 'no_number');
  assert.equal(app.store.balance(a.id), 50);

  // New credits bring it back.
  app.store.credit(a.id, 350, 'topup');
  await app.renewables.run(a.id);
  assert.equal((await state()).status, 'active');
  assert.equal(app.store.balance(a.id), 0);
  assert.equal((await hook('text', { to: num.plain, from: outsider(), body: 'hello again' })).status, 200);
  assert.equal((await texts(a, num)).texts.length, 1);

  // Suspended and still inside the grace period: the number stays.
  const grace = app.config.graceDays * 86400;
  app.db.run('UPDATE numbers SET paid_until = ? WHERE id = ?', now() - 10, num.id);
  await app.runJobs('renew');
  assert.equal((await state()).status, 'suspended');
  app.db.run('UPDATE numbers SET paid_until = ? WHERE id = ?', now() - grace + 3600, num.id);
  await app.runJobs('renew');
  assert.equal((await state()).status, 'suspended');

  // After the grace period: the provider fails first, so the row stays for the next run.
  const ref = [...mock.owned.entries()].find(([, n]) => n === num.plain)[0];
  app.db.run('UPDATE numbers SET paid_until = ? WHERE id = ?', now() - grace - 3600, num.id);
  mock.failNext('release');
  await app.runJobs('renew');
  assert.ok(await state());
  assert.ok(mock.owned.has(ref));
  await app.runJobs('renew');
  assert.equal(await state(), undefined);
  assert.ok(mock.released.includes(ref));
  assert.equal(countRows('texts', a.id), 0);
});

test('account delete: all numbers go back to the provider', async () => {
  const a = await newAccount(app, { credits: 1300 });
  const n1 = await buyNumber(a);
  const n2 = await buyNumber(a);
  const n3 = await buyNumber(a);
  await linkPhone(a, n1);
  await hook('text', { to: n1.plain, from: outsider(), body: 'before the end' });
  const refOf = (n) => [...mock.owned.entries()].find(([, v]) => v === n.plain)[0];
  const refs = [refOf(n1), refOf(n2), refOf(n3)];

  // One release fails. The number is remembered (with no account) and a job tries again.
  mock.failNext('release');
  await app.deleteAccount(a.id);
  assert.equal(refs.filter((r) => mock.released.includes(r)).length, 2);
  for (const table of ['numbers', 'phones', 'texts', 'calls', 'live_calls']) assert.equal(countRows(table, a.id), 0);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM release_later').n, 1);
  await app.runJobs('phone-cleanup');
  assert.equal(refs.filter((r) => mock.released.includes(r)).length, 3);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM release_later').n, 0);
  assert.equal((await a.api.get('/api/numbers')).status, 401);

  // The numbers are free again.
  const b = await newAccount(app, { credits: 500 });
  const s = await b.api.get('/api/numbers/search?country=US&areaCode=415');
  assert.ok(s.data.numbers.some((n) => n.number === n1.plain));
});

test('isolation: another account gets 404 for every ID', async () => {
  const a = await newAccount(app, { credits: 1000 });
  const b = await newAccount(app, { credits: 1000 });
  const num = await buyNumber(a);
  const phone = await linkPhone(a, num);
  const bn = await buyNumber(b);
  await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: outsider(), body: 'private' });
  await hook('voice', { to: num.plain, from: outsider(), callId: 'iso-1' });
  const textId = (await texts(a, num)).texts[0].id;
  const callId = (await calls(a, num))[0].id;
  const pending = await requestCode(a, num, realPhone());
  const sent = mock.outbox.texts.length;

  const tries = [
    b.api.get(`/api/numbers/${num.id}/texts`),
    b.api.get(`/api/numbers/${num.id}/calls`),
    b.api.patch(`/api/numbers/${num.id}`, { forwardTexts: true }),
    b.api.del(`/api/numbers/${num.id}`),
    b.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: '+14155550001', body: 'spoof' }),
    b.api.post(`/api/numbers/${num.id}/texts/seen`),
    b.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to: '+14155550001' }),
    b.api.del(`/api/texts/${textId}`),
    b.api.del(`/api/calls/${callId}`),
    b.api.post(`/api/phones/${pending.res.data.phone.id}/verify`, { code: pending.code }),
    b.api.del(`/api/phones/${phone.id}`),
    b.api.patch(`/api/numbers/${bn.id}`, { forwardPhoneId: phone.id }),
    b.api.post('/api/phones', { number: realPhone(), via: { numberId: num.id, number: num.plain } }),
    b.api.post('/api/dev/inbound-text', { numberId: num.id, number: num.plain, from: '+14155550001', body: 'x' }),
  ];
  for (const res of await Promise.all(tries)) {
    assert.equal(res.status, 404);
    assert.equal(res.data.error.code, 'not_found');
  }
  // Nothing of A changed, and nothing went out.
  assert.equal(mock.outbox.texts.length, sent);
  assert.equal((await texts(a, num)).texts.length, 1);
  assert.equal((await calls(a, num)).length, 1);
  assert.equal((await a.api.get('/api/phones')).data.phones.length, 2);
  assert.equal((await a.api.get('/api/numbers')).data.numbers.length, 1);
  assert.deepEqual((await b.api.get('/api/phones')).data.phones, []);
  assert.equal((await b.api.get('/api/numbers')).data.numbers.length, 1);
  // B cannot use A's plain number with its own number ID.
  const spoof = await b.api.post(`/api/numbers/${bn.id}/texts`, { number: num.plain, to: '+14155550001', body: 'spoof' });
  assert.equal(spoof.status, 400);
  // No cookie at all.
  for (const path of ['/api/numbers', '/api/phones', `/api/numbers/${num.id}/texts`, `/api/numbers/${num.id}/calls`, '/api/dev/phone-outbox']) {
    assert.equal((await client(app).get(path)).status, 401);
  }
});

test('dev routes: simulated text and call, and the outbox shows own entries only', async () => {
  const a = await newAccount(app, { credits: 1000 });
  const b = await newAccount(app, { credits: 1000 });
  const num = await buyNumber(a);
  const bn = await buyNumber(b);
  const phone = await linkPhone(a, num);
  const from = outsider();
  const body = remember('Simulated hello d00d');

  assert.equal((await a.api.post('/api/dev/inbound-text', { numberId: num.id, number: num.plain, from, body })).status, 204);
  const list = await texts(a, num);
  assert.deepEqual(await openText(a, list.texts[0]), { peer: from, body });
  assert.equal((await a.api.post('/api/dev/inbound-text', { numberId: num.id, number: bn.plain, from, body })).status, 400);

  // Without forwarding the simulated call is missed.
  assert.equal((await a.api.post('/api/dev/inbound-call', { numberId: num.id, number: num.plain, from })).status, 204);
  assert.equal((await calls(a, num))[0].status, 'missed');
  // With forwarding it is answered and charged.
  await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: phone.id, forwardCalls: true });
  const before = app.store.balance(a.id);
  assert.equal((await a.api.post('/api/dev/inbound-call', { numberId: num.id, number: num.plain, from, seconds: 90 })).status, 204);
  const log = await calls(a, num);
  assert.deepEqual({ seconds: log[0].seconds, status: log[0].status }, { seconds: 90, status: 'answered' });
  assert.equal(app.store.balance(a.id), before - 6);

  await b.api.post(`/api/numbers/${bn.id}/texts`, { number: bn.plain, to: outsider(), body: 'from B' });
  const outA = await a.api.get('/api/dev/phone-outbox');
  assert.equal(outA.status, 200);
  // A sees its code text and its forwarded call, not the text of B.
  assert.equal(outA.data.texts.length, 1);
  assert.match(outA.data.texts[0].body, /^Your Postern code is \d{6}\./);
  assert.deepEqual(Object.keys(outA.data.texts[0]).sort(), ['at', 'body', 'from', 'to']);
  assert.deepEqual(outA.data.calls.map((k) => ({ from: k.from, to: k.to })), [{ from, to: phone.plain }]);
  const outB = await b.api.get('/api/dev/phone-outbox');
  assert.deepEqual(outB.data.texts.map((t) => t.body), ['from B']);
  assert.deepEqual(outB.data.calls, []);
});

test('texts: delivery status moves forward only; a failed text gives its charge back one time', async () => {
  const a = await newAccount(app, { credits: 500 });
  const num = await buyNumber(a);
  const to = outsider();
  const send = async (body) => (await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to, body })).data.text;
  const statusOf = async (id) => (await texts(a, num)).texts.find((t) => t.id === id).status;
  const refOf = (body) => mock.outbox.texts.findLast((t) => t.body === body).ref;
  const refunds = () => ledger(a).filter((l) => l === 'refund:3').length;

  // The mock sends at once. An incoming text has no status.
  const t1 = await send('one');
  assert.equal(t1.status, 'sent');
  await hook('text', { to: num.plain, from: to, body: 'incoming' });
  const list = (await texts(a, num)).texts;
  assert.equal(list.find((t) => t.direction === 'in').status, null);
  assert.equal(list.find((t) => t.id === t1.id).status, 'sent');
  assert.equal(app.db.get('SELECT status FROM texts WHERE direction = ? AND account_id = ?', 'in', a.id).status, null);

  // The provider reports the delivery.
  await mock.reportText(refOf('one'), 'delivered');
  assert.equal(await statusOf(t1.id), 'delivered');
  // "delivered" is final. A later report changes nothing, and a late "failed" pays nothing back.
  let balance = app.store.balance(a.id);
  for (const s of ['sent', 'queued', 'failed', 'delivered']) await mock.reportText(refOf('one'), s);
  assert.equal(await statusOf(t1.id), 'delivered');
  assert.equal(app.store.balance(a.id), balance);
  assert.equal(refunds(), 0);

  // A text that the provider only queued. The hook is for one text.
  mock.queueNextText();
  const t2 = await send('two');
  assert.equal(t2.status, 'queued');
  assert.equal(await statusOf(t2.id), 'queued');
  const t3 = await send('three');
  assert.equal(t3.status, 'sent');
  await mock.reportText(refOf('two'), 'sent');
  assert.equal(await statusOf(t2.id), 'sent');
  // Not backwards.
  await mock.reportText(refOf('two'), 'queued');
  assert.equal(await statusOf(t2.id), 'sent');

  // The carrier refuses it: the status is "failed" and the charge comes back.
  balance = app.store.balance(a.id);
  await mock.reportText(refOf('two'), 'failed', 'carrier error 30034');
  assert.equal(await statusOf(t2.id), 'failed');
  assert.equal(app.store.balance(a.id), balance + 3);
  assert.equal(ledger(a)[0], 'refund:3');
  // The same report again, and a late "delivered": no second refund, no change.
  await mock.reportText(refOf('two'), 'failed');
  await mock.reportText(refOf('two'), 'delivered');
  assert.equal(app.services.phone.reportTextStatus({ ref: refOf('two'), status: 'failed' }), false);
  assert.equal(await statusOf(t2.id), 'failed');
  assert.equal(app.store.balance(a.id), balance + 3);
  assert.equal(refunds(), 1);

  // The webhook route over HTTP: a valid signature works, a bad one gets 403.
  const ok = await hook('text-status', { ref: refOf('three'), status: 'delivered' });
  assert.equal(ok.status, 200);
  assert.equal(await statusOf(t3.id), 'delivered');
  const t4 = await send('four');
  for (const sig of ['AAAA', null]) {
    const bad = await hook('text-status', { ref: refOf('four'), status: 'failed' }, sig);
    assert.equal(bad.status, 403);
  }
  // An id that we never sent, and a status word that does not exist.
  assert.equal((await hook('text-status', { ref: 'MTunknown', status: 'failed' })).status, 200);
  assert.equal((await hook('text-status', { ref: refOf('four'), status: 'exploded' })).status, 200);
  assert.equal(app.services.phone.reportTextStatus({ ref: refOf('four'), status: 'exploded' }), false);
  assert.equal(app.services.phone.reportTextStatus({}), false);
  assert.equal(await statusOf(t4.id), 'sent');
  assert.equal(refunds(), 1);

  // The user deleted the text. A failure after that still gives the charge back.
  assert.equal((await a.api.del(`/api/texts/${t4.id}`)).status, 204);
  balance = app.store.balance(a.id);
  assert.equal(app.services.phone.reportTextStatus({ ref: refOf('four'), status: 'failed' }), true);
  assert.equal(app.store.balance(a.id), balance + 3);
  assert.equal(refunds(), 2);

  // The report is faster than our own request: it arrives before the send call has returned.
  const realSend = mock.sendText;
  mock.sendText = async (args) => {
    const out = await realSend(args);
    await mock.reportText(out.ref, 'failed');
    return out;
  };
  try {
    balance = app.store.balance(a.id);
    const res = await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to, body: 'five' });
    assert.equal(res.status, 201);
    assert.equal(res.data.text.status, 'failed');
    assert.equal(app.store.balance(a.id), balance);
    assert.deepEqual(ledger(a).slice(0, 2), ['refund:3', 'text:-3']);
  } finally {
    mock.sendText = realSend;
  }
  // Every text of this test has its final status. Nothing waits any more.
  assert.equal(countRows('text_sends', a.id), 0);
  // A send with no final status waits, and the cleanup job removes it after a week.
  await send('six');
  assert.equal(countRows('text_sends', a.id), 1);
  await app.runJobs('phone-cleanup');
  assert.equal(countRows('text_sends', a.id), 1);
  app.db.run('UPDATE text_sends SET at = ? WHERE account_id = ?', now() - 8 * 86400, a.id);
  await app.runJobs('phone-cleanup');
  assert.equal(countRows('text_sends', a.id), 0);
});

test('texts: a code text or a forwarded text that fails later gives its charge back', async () => {
  const a = await newAccount(app, { credits: 500 });
  const num = await buyNumber(a);
  const number = realPhone();

  // The code text. It has no row in the list of texts.
  const { res, code, sent } = await requestCode(a, num, number);
  assert.equal(res.status, 201);
  assert.equal(app.store.balance(a.id), 97);
  await mock.reportText(sent.ref, 'failed');
  assert.equal(app.store.balance(a.id), 100);
  assert.equal(ledger(a)[0], 'refund:3');
  await mock.reportText(sent.ref, 'failed');
  assert.equal(app.store.balance(a.id), 100);
  assert.equal((await texts(a, num)).texts.length, 0);
  assert.equal((await a.api.post(`/api/phones/${res.data.phone.id}/verify`, { code })).status, 200);

  // Forwarded copies.
  await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: res.data.phone.id, forwardTexts: true });
  const from = outsider();
  await hook('text', { to: num.plain, from, body: 'first' });
  const copy1 = mock.outbox.texts.at(-1);
  assert.equal(copy1.to, number);
  assert.equal(app.store.balance(a.id), 97);
  await mock.reportText(copy1.ref, 'delivered');
  await mock.reportText(copy1.ref, 'failed');
  assert.equal(app.store.balance(a.id), 97);

  await hook('text', { to: num.plain, from, body: 'second' });
  const copy2 = mock.outbox.texts.at(-1);
  assert.equal(app.store.balance(a.id), 94);
  await mock.reportText(copy2.ref, 'failed');
  await mock.reportText(copy2.ref, 'failed');
  assert.equal(app.store.balance(a.id), 97);
  assert.deepEqual(ledger(a).slice(0, 2), ['refund:3', 'text:-3']);
  // The two incoming texts are stored, with no status.
  assert.deepEqual((await texts(a, num)).texts.map((t) => t.status), [null, null]);
  assert.equal(countRows('text_sends', a.id), 0);
});

test('capabilities: a provider with no voice refuses every call with 409 no_voice', async () => {
  assert.deepEqual(app.services.phone.capabilities, { voice: true, asyncText: false, searchByArea: true });
  const a = await newAccount(app, { credits: 2000 });
  const num = await buyNumber(a);
  const phone = await linkPhone(a, num);
  await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: phone.id, forwardCalls: true });
  const to = outsider();
  const noVoice = (res) => {
    assert.equal(res.status, 409);
    assert.deepEqual(res.data.error, { code: 'no_voice', message: 'This number cannot make or get calls through Postern.' });
  };
  let second;
  const callsBefore = mock.outbox.calls.length;

  mock.capabilities.voice = false;
  try {
    assert.equal(app.services.phone.capabilities.voice, false);
    // Numbers show no voice, in the search and in the list.
    const s = await a.api.get('/api/numbers/search?country=US&areaCode=206');
    assert.ok(s.data.numbers.every((n) => n.voice === false && n.sms === true));
    assert.equal((await a.api.get('/api/numbers')).data.numbers[0].voice, false);

    noVoice(await a.api.patch(`/api/numbers/${num.id}`, { forwardCalls: true }));
    noVoice(await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to }));
    noVoice(await a.api.post('/api/phones', { number: realPhone(), method: 'call', via: { numberId: num.id, number: num.plain } }));
    assert.equal(mock.outbox.calls.length, callsBefore);
    // To switch call forwarding off is still possible. Texts work as before.
    assert.equal((await a.api.patch(`/api/numbers/${num.id}`, { forwardCalls: false, forwardTexts: true })).status, 200);
    assert.equal((await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to, body: 'texts work' })).status, 201);
    assert.equal((await requestCode(a, num, realPhone())).res.status, 201);

    // A number that was set to forward calls before: the call is not forwarded.
    app.db.run('UPDATE numbers SET forward_calls = 1 WHERE id = ?', num.id);
    assert.deepEqual((await hook('voice', { to: num.plain, from: to, callId: 'novoice-1' })).data.actions, NOT_AVAILABLE);
    assert.equal((await calls(a, num))[0].status, 'missed');

    // A number that is bought now is stored as a number with no voice.
    const made = await a.api.post('/api/numbers', { number: s.data.numbers[0].number });
    assert.equal(made.status, 201);
    assert.equal(made.data.number.voice, false);
    second = { ...made.data.number, plain: remember(made.data.plain) };
    assert.equal(app.db.get('SELECT voice FROM numbers WHERE id = ?', second.id).voice, 0);
  } finally {
    mock.capabilities.voice = true;
  }
  // Voice is back. The first number can call again. The second number has no voice of its own.
  const list = (await a.api.get('/api/numbers')).data.numbers;
  assert.equal(list.find((n) => n.id === num.id).voice, true);
  assert.equal(list.find((n) => n.id === second.id).voice, false);
  assert.equal((await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to })).status, 201);
  noVoice(await a.api.post(`/api/numbers/${second.id}/calls`, { number: second.plain, to }));
  noVoice(await a.api.patch(`/api/numbers/${second.id}`, { forwardPhoneId: phone.id, forwardCalls: true }));
  noVoice(await a.api.post('/api/phones', { number: realPhone(), method: 'call', via: { numberId: second.id, number: second.plain } }));
  assert.deepEqual((await hook('voice', { to: second.plain, from: to, callId: 'novoice-2' })).data.actions, NOT_AVAILABLE);

  // A provider that cannot search by area code gets no area code.
  mock.capabilities.searchByArea = false;
  try {
    const s = await a.api.get('/api/numbers/search?country=US&areaCode=206');
    assert.ok(s.data.numbers.every((n) => n.number.startsWith('+1415')));
  } finally {
    mock.capabilities.searchByArea = true;
  }
});

test('phones: link with a call that speaks the code', async () => {
  const a = await newAccount(app, { credits: 400 + 3 + 3 + 2 });
  const num = await buyNumber(a);
  const number = realPhone();
  const via = { numberId: num.id, number: num.plain };
  const texts0 = mock.outbox.texts.length;

  assert.equal((await a.api.post('/api/phones', { number, method: 'fax', via })).status, 400);
  assert.equal((await a.api.post('/api/phones', { number, method: 7, via })).status, 400);

  const res = await a.api.post('/api/phones', { number, method: 'call', via });
  assert.equal(res.status, 201);
  assert.equal(res.data.phone.verified, false);
  // One fixed charge of one call minute. No text went out.
  assert.equal(app.store.balance(a.id), 5);
  assert.equal(ledger(a)[0], 'call:-3');
  assert.equal(mock.outbox.texts.length, texts0);

  // The provider calls the real phone from the VoIP number.
  const entry = mock.outbox.calls.at(-1);
  assert.deepEqual({ from: entry.from, to: entry.to, say: entry.say }, { from: num.plain, to: number, say: undefined });
  const ringing = mock.ringing.get(entry.ref);
  const answerUrl = new URL(ringing.answerUrl);
  assert.equal(answerUrl.origin + answerUrl.pathname, PUBLIC + '/api/hooks/phone/say-code');
  assert.match(answerUrl.searchParams.get('token'), /^[A-Za-z0-9_-]{43}$/);

  // The webhook over HTTP: a bad signature is refused, an unknown token ends the call.
  assert.equal((await hook('say-code', { callId: entry.ref }, 'AAAA', answerUrl.search)).status, 403);
  assert.deepEqual((await hook('say-code', { callId: entry.ref }, undefined, '?token=' + 'A'.repeat(43))).data.actions, [{ hangup: true }]);
  assert.deepEqual((await hook('say-code', { callId: entry.ref })).data.actions, [{ hangup: true }]);
  const spoken = await hook('say-code', { callId: entry.ref }, undefined, answerUrl.search);
  assert.equal(spoken.status, 200);
  const line = spoken.data.actions[0].say;
  // The code is spoken digit by digit, two times. Then the call ends.
  assert.match(line, /^Your Postern code is \d, \d, \d, \d, \d, \d\.$/);
  assert.deepEqual(spoken.data.actions, [{ say: line }, { say: line }, { hangup: true }]);

  // The phone answers (mock helper). The outbox entry of the call has the spoken text.
  const heard = await mock.answerCall(entry.ref);
  assert.equal(heard.bridged, false);
  assert.equal(heard.say, `${line} ${line}`);
  assert.equal(entry.say, `${line} ${line}`);
  const code = line.replace(/\D/g, '');
  assert.equal(code.length, 6);
  // The development outbox shows it to the owner only.
  const outbox = (await a.api.get('/api/dev/phone-outbox')).data.calls;
  assert.deepEqual(outbox.map((k) => ({ from: k.from, to: k.to, say: k.say })), [{ from: num.plain, to: number, say: `${line} ${line}` }]);
  // A verification call is not in the call log and costs nothing more, also after its status report.
  assert.equal((await calls(a, num)).length, 0);
  assert.equal(app.store.balance(a.id), 5);

  // The same code rules as for a text.
  const wrong = code === '000000' ? '000001' : '000000';
  assert.equal((await a.api.post(`/api/phones/${res.data.phone.id}/verify`, { code: wrong })).data.error.code, 'bad_code');
  const good = await a.api.post(`/api/phones/${res.data.phone.id}/verify`, { code });
  assert.equal(good.status, 200);
  assert.equal(good.data.phone.verified, true);

  // A new call for a second phone gives a new code. The provider cannot start the next one: refund.
  const other = realPhone();
  const again = await a.api.post('/api/phones', { number: other, method: 'call', via });
  assert.equal(again.status, 201);
  assert.equal(app.store.balance(a.id), 2);
  const line2 = (await mock.answerCall(mock.outbox.calls.at(-1).ref)).say;
  assert.match(line2, /^Your Postern code is (\d, ){5}\d\. Your Postern code is (\d, ){5}\d\.$/);
  // 2 credits are less than one call minute.
  const poor = await a.api.post('/api/phones', { number: other, method: 'call', via });
  assert.equal(poor.status, 402);
  assert.equal(poor.data.error.needed, 3);
  app.store.credit(a.id, 10, 'topup');
  mock.failNext('startCall');
  const failed = await a.api.post('/api/phones', { number: other, method: 'call', via });
  assert.equal(failed.status, 502);
  assert.equal(app.store.balance(a.id), 12);
  assert.deepEqual(ledger(a).slice(0, 2), ['refund:3', 'call:-3']);
  // The code of the call that worked is still the valid one.
  assert.equal((await a.api.post(`/api/phones/${again.data.phone.id}/verify`, { code: line2.slice(0, 40).replace(/\D/g, '') })).status, 200);
});

test('destinations: only allowed prefixes, and no blocked prefix', async () => {
  const a = await newAccount(app, { credits: 1000 });
  const num = await buyNumber(a);
  const phone = await linkPhone(a, num);
  await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: phone.id });
  const via = { numberId: num.id, number: num.plain };
  const refused = (res) => {
    assert.equal(res.status, 400);
    assert.deepEqual(res.data.error, { code: 'bad_destination', message: 'You cannot text or call this number from here.' });
  };
  const tries = (to) => [
    a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to, body: 'hello' }),
    a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to }),
    a.api.post('/api/phones', { number: to, via }),
    a.api.post('/api/phones', { number: to, method: 'call', via }),
  ];
  const balance = app.store.balance(a.id);
  const sent = mock.outbox.texts.length;
  const called = mock.outbox.calls.length;

  // The default configuration: +1 only, and not the premium and Caribbean codes inside +1.
  assert.deepEqual(app.config.phone.allowedPrefixes, ['+1']);
  assert.ok(app.config.phone.blockedPrefixes.includes('+1900'));
  for (const to of ['+447700900123', '+4915112345678', '+19005550100', '+19765550100', '+18765550100', '+12425550100']) {
    for (const res of await Promise.all(tries(to))) refused(res);
  }
  // Nothing was charged, sent, or called, and no phone was added.
  assert.equal(app.store.balance(a.id), balance);
  assert.equal(mock.outbox.texts.length, sent);
  assert.equal(mock.outbox.calls.length, called);
  assert.equal((await a.api.get('/api/phones')).data.phones.length, 1);
  // A normal +1 number works.
  assert.equal((await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: '+12125550100', body: 'hello' })).status, 201);

  const saved = { allowed: app.config.phone.allowedPrefixes, blocked: app.config.phone.blockedPrefixes };
  try {
    // An empty allowed list allows every country. The blocked list still counts.
    app.config.phone.allowedPrefixes = [];
    assert.equal((await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: '+447700900123', body: 'hello' })).status, 201);
    refused(await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: '+19005550100', body: 'hello' }));
    // Prefixes with and without "+" mean the same. More than one allowed prefix.
    app.config.phone.allowedPrefixes = ['44', '+1212'];
    app.config.phone.blockedPrefixes = ['4477009001'];
    assert.equal((await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: '+447700900200', body: 'hello' })).status, 201);
    assert.equal((await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: '+12125550101', body: 'hello' })).status, 201);
    refused(await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: '+447700900123', body: 'hello' }));
    refused(await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: '+13055550100', body: 'hello' }));
    refused(await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to: '+13055550100' }));
    // The check is for numbers that the user chooses. A text from a blocked number still arrives.
    assert.equal((await hook('text', { to: num.plain, from: '+19005550100', body: 'from a premium number' })).status, 200);
    assert.ok((await texts(a, num)).texts.some((t) => t.direction === 'in'));
  } finally {
    app.config.phone.allowedPrefixes = saved.allowed;
    app.config.phone.blockedPrefixes = saved.blocked;
  }
});

test('auto-delete: old texts of a number go away when its retention is on; nothing else is touched', async () => {
  const a = await newAccount(app, { credits: 2000 });
  const b = await newAccount(app, { credits: 1000 });
  const n1 = await buyNumber(a); // retention 7 days
  const n2 = await buyNumber(a); // retention off
  const m1 = await buyNumber(b); // a different account, retention 30 days
  const state = async (acct, num) => (await acct.api.get('/api/numbers')).data.numbers.find((n) => n.id === num.id);
  const DAY = 86400;

  // Off by default.
  assert.equal(n1.retentionDays, null);
  assert.equal((await state(a, n1)).retentionDays, null);
  assert.equal(app.db.get('SELECT retention_days FROM numbers WHERE id = ?', n1.id).retention_days, null);

  // Bad values change nothing.
  for (const bad of [0, -1, 3651, 1.5, '7', true, [7], {}]) {
    const res = await a.api.patch(`/api/numbers/${n1.id}`, { retentionDays: bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.data.error.code, 'bad_request');
  }
  assert.equal((await state(a, n1)).retentionDays, null);

  // Set, change, clear, set again.
  for (const days of [1, 3650, 7]) {
    const res = await a.api.patch(`/api/numbers/${n1.id}`, { retentionDays: days });
    assert.equal(res.status, 200);
    assert.equal(res.data.number.retentionDays, days);
  }
  // A change of a different field keeps the setting, and the setting changes no other field.
  assert.equal((await a.api.patch(`/api/numbers/${n1.id}`, { forwardTexts: true })).data.number.retentionDays, 7);
  const cleared = await a.api.patch(`/api/numbers/${n1.id}`, { retentionDays: null });
  assert.equal(cleared.data.number.retentionDays, null);
  assert.equal(cleared.data.number.forwardTexts, true);
  assert.equal((await a.api.patch(`/api/numbers/${n1.id}`, { retentionDays: 7 })).data.number.retentionDays, 7);
  assert.equal((await state(a, n2)).retentionDays, null);
  // A different account cannot set it.
  assert.equal((await b.api.patch(`/api/numbers/${n1.id}`, { retentionDays: 1 })).status, 404);
  assert.equal((await b.api.patch(`/api/numbers/${m1.id}`, { retentionDays: 30 })).data.number.retentionDays, 30);

  // Each number gets four texts: an old and a new one in each direction.
  // "Old" is a little more than 7 days, "new" is a little less.
  const peer = outsider();
  const t = now();
  const ages = { 'old out': t - 7 * DAY - 100, 'new out': t - 7 * DAY + 100, 'old in': t - 7 * DAY - 100, 'new in': t - 7 * DAY + 100 };
  const fill = async (acct, num, tag) => {
    for (const kind of ['old out', 'new out']) {
      // The old sent text of the first number still waits for its delivery status.
      if (tag === 'n1' && kind === 'old out') mock.queueNextText();
      const res = await acct.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: peer, body: `${tag} ${kind}` });
      assert.equal(res.status, 201);
      app.db.run('UPDATE texts SET at = ? WHERE id = ?', ages[kind], res.data.text.id);
    }
    for (const kind of ['old in', 'new in']) {
      await hook('text', { to: num.plain, from: peer, body: `${tag} ${kind}` });
      const row = app.db.get('SELECT id FROM texts WHERE number_id = ? ORDER BY rowid DESC LIMIT 1', num.id);
      app.db.run('UPDATE texts SET at = ? WHERE id = ?', ages[kind], row.id);
    }
  };
  await fill(a, n1, 'n1');
  await fill(a, n2, 'n2');
  await fill(b, m1, 'm1');
  const bodies = async (acct, num) => (await Promise.all((await texts(acct, num)).texts.map(async (x) => (await openText(acct, x)).body))).sort();
  assert.equal((await bodies(a, n1)).length, 4);
  // An old call of the first number. The auto-delete is for texts only.
  await hook('voice', { to: n1.plain, from: peer, callId: 'retention-call' });
  app.db.run('UPDATE calls SET at = ? WHERE number_id = ?', t - 400 * DAY, n1.id);
  // The old queued text is tracked and points at its row.
  const oldRef = mock.outbox.texts.find((x) => x.body === 'n1 old out').ref;
  const oldId = app.db.get("SELECT text_id FROM text_sends WHERE account_id = ? AND status = 'queued'", a.id).text_id;
  assert.ok(oldId);

  // Run the job. Watch the events that it publishes.
  const published = [];
  const realPublish = app.events.publish;
  app.events.publish = (...args) => { published.push(args); return realPublish(...args); };
  try {
    await app.runJobs('phone-retention');
    // One event, for the account and the number that lost texts.
    assert.deepEqual(published, [[a.id, 'text', { numberId: n1.id }]]);
    // The write-ahead file of the database is empty: no old copy of a deleted row is in it.
    assert.equal(statSync(join(app.config.dataDir, 'accounts.db-wal')).size, 0);

    // Only the old texts of the number with retention are gone, in both directions.
    assert.deepEqual(await bodies(a, n1), ['n1 new in', 'n1 new out']);
    assert.equal(await unread(a, n1), 1);
    // The number with no retention, the number of the other account (30 days), and the call: all there.
    assert.deepEqual(await bodies(a, n2), ['n2 new in', 'n2 new out', 'n2 old in', 'n2 old out']);
    assert.deepEqual(await bodies(b, m1), ['m1 new in', 'm1 new out', 'm1 old in', 'm1 old out']);
    assert.equal((await calls(a, n1)).length, 1);
    assert.equal(app.db.get('SELECT COUNT(*) AS n FROM texts WHERE id = ?', oldId).n, 0);

    // A second run finds nothing and publishes nothing.
    published.length = 0;
    await app.runJobs('phone-retention');
    assert.deepEqual(published, []);
    assert.deepEqual(await bodies(a, n1), ['n1 new in', 'n1 new out']);
  } finally {
    app.events.publish = realPublish;
  }

  // The send of the deleted text still waits for its status, and points at no text.
  const waiting = app.db.all('SELECT text_id, charged, status FROM text_sends WHERE account_id = ?', a.id);
  assert.equal(waiting.filter((w) => w.status === 'queued').length, 1);
  assert.equal(waiting.find((w) => w.status === 'queued').text_id, null);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM text_sends WHERE text_id IS NOT NULL AND text_id NOT IN (SELECT id FROM texts)').n, 0);
  // The provider reports late that this text failed: the charge comes back, one time.
  const balance = app.store.balance(a.id);
  await mock.reportText(oldRef, 'failed');
  assert.equal(app.store.balance(a.id), balance + 3);
  assert.equal(ledger(a)[0], 'refund:3');
  await mock.reportText(oldRef, 'failed');
  await mock.reportText(oldRef, 'delivered');
  assert.equal(app.store.balance(a.id), balance + 3);
  assert.equal(ledger(a).filter((l) => l === 'refund:3').length, 1);
  assert.deepEqual(await bodies(a, n1), ['n1 new in', 'n1 new out']);

  // Time passes: the other texts get old too. A suspended number is cleaned as well.
  app.db.run('UPDATE texts SET at = at - 200 WHERE number_id = ?', n1.id);
  app.db.run("UPDATE numbers SET status = 'suspended' WHERE id = ?", n1.id);
  await app.runJobs('phone-retention');
  assert.deepEqual(await bodies(a, n1), []);
  assert.equal(await unread(a, n1), 0);
  assert.equal((await bodies(a, n2)).length, 4);
  // 30 days for the other account: its texts stay until they are older than that.
  app.db.run('UPDATE texts SET at = ? WHERE number_id = ? AND direction = ?', t - 31 * DAY, m1.id, 'in');
  await app.runJobs('phone-retention');
  assert.deepEqual(await bodies(b, m1), ['m1 new out', 'm1 old out']);
  // Retention off again: nothing more is deleted.
  await b.api.patch(`/api/numbers/${m1.id}`, { retentionDays: null });
  app.db.run('UPDATE texts SET at = ? WHERE number_id = ?', t - 4000 * DAY, m1.id);
  await app.runJobs('phone-retention');
  assert.equal((await bodies(b, m1)).length, 2);

  // A text that the user deletes by hand, and a number that is deleted, leave no send that points at them.
  mock.queueNextText();
  const manual = await a.api.post(`/api/numbers/${n2.id}/texts`, { number: n2.plain, to: peer, body: 'by hand' });
  assert.equal((await a.api.del(`/api/texts/${manual.data.text.id}`)).status, 204);
  assert.equal((await a.api.del(`/api/numbers/${n2.id}`)).status, 204);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM text_sends WHERE text_id IS NOT NULL AND text_id NOT IN (SELECT id FROM texts)').n, 0);
  const before = app.store.balance(a.id);
  await mock.reportText(mock.outbox.texts.find((x) => x.body === 'by hand').ref, 'failed');
  assert.equal(app.store.balance(a.id), before + 3);
});

test('migration: an older database gets the new columns, and old sent texts get a status', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'postern-phone-'));
  const opts = { dataDir, port: 0, host: '127.0.0.1', logLevel: 'silent', rateLimits: false, mail: { smtpPort: 0, smtpHost: '127.0.0.1', relayUrl: '' }, phone: { provider: 'mock', mockAutoAnswer: false }, pay: { provider: 'off' } };
  try {
    const one = await createApp(opts, {});
    await one.start();
    const a = await newAccount(one, { credits: 1000 });
    const s = await a.api.get('/api/numbers/search?country=US&areaCode=604');
    const made = await a.api.post('/api/numbers', { number: s.data.numbers[0].number });
    const num = { id: made.data.number.id, plain: made.data.plain };
    assert.equal((await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: '+13055550111', body: 'old text' })).status, 201);
    await one.services.phone.simulateText({ to: num.plain, from: '+13055550111', body: 'old answer' });
    await one.services.phone.simulateCall({ to: num.plain, from: '+13055550111' });
    await one.stop();

    // Make the file look like a database from before these columns existed.
    const raw = new DatabaseSync(join(dataDir, 'accounts.db'));
    raw.exec('DROP INDEX texts_msg; DROP INDEX calls_call; DROP TABLE text_sends;');
    raw.exec('ALTER TABLE texts DROP COLUMN status; ALTER TABLE texts DROP COLUMN msg_hmac; ALTER TABLE calls DROP COLUMN call_hmac;');
    raw.exec('ALTER TABLE numbers DROP COLUMN retention_days;');
    const columns = (table) => raw.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    assert.ok(!columns('numbers').includes('retention_days'));
    assert.ok(!columns('texts').includes('status'));
    assert.ok(!columns('texts').includes('msg_hmac'));
    assert.ok(!columns('calls').includes('call_hmac'));
    raw.close();

    const two = await createApp(opts, {});
    await two.start();
    try {
      const cols = (table) => two.db.all(`PRAGMA table_info(${table})`).map((c) => c.name);
      assert.ok(cols('texts').includes('status'));
      assert.ok(cols('texts').includes('msg_hmac'));
      assert.ok(cols('calls').includes('call_hmac'));
      assert.ok(cols('numbers').includes('retention_days'));
      const api = client(two);
      api.setCookie(`postern=${a.session.token}`);
      // The old number has no auto-delete, and the setting works on the old database.
      assert.equal((await api.get('/api/numbers')).data.numbers[0].retentionDays, null);
      await two.runJobs('phone-retention');
      assert.equal((await api.patch(`/api/numbers/${num.id}`, { retentionDays: 30 })).data.number.retentionDays, 30);
      await two.runJobs('phone-retention');
      // The old rows are there. The old sent text counts as sent, the old incoming text has no status.
      const list = (await api.get(`/api/numbers/${num.id}/texts`)).data.texts;
      assert.deepEqual(list.map((t) => `${t.direction}:${t.status}`).sort(), ['in:null', 'out:sent']);
      assert.equal((await api.get(`/api/numbers/${num.id}/calls`)).data.calls.length, 1);
      // The new functions work on the old database: status reports, and webhook repeats.
      two.services.phone.mock.queueNextText();
      const sent = await api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: '+13055550111', body: 'new text' });
      assert.equal(sent.data.text.status, 'queued');
      await two.services.phone.reportText(two.services.phone.outbox.texts.at(-1).ref, 'delivered');
      const after = (await api.get(`/api/numbers/${num.id}/texts`)).data.texts;
      assert.equal(after.find((t) => t.id === sent.data.text.id).status, 'delivered');
      assert.equal(two.db.get('SELECT COUNT(*) AS n FROM texts WHERE msg_hmac IS NOT NULL').n, 0);
    } finally {
      await two.stop();
    }
    // A third start changes nothing more.
    const three = await createApp(opts, {});
    await three.start();
    assert.equal(three.db.get('SELECT COUNT(*) AS n FROM texts').n, 3);
    await three.stop();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('mock provider: a click-to-call ends by itself when auto answer is on', async () => {
  const dev = await startTestApp({ phone: { provider: 'mock', mockAutoAnswer: 5 } });
  try {
    const m = dev.services.phone.mock;
    const a = await newAccount(dev, { credits: 1000 });
    const s = await a.api.get('/api/numbers/search?country=CA');
    const made = await a.api.post('/api/numbers', { number: s.data.numbers[0].number });
    const num = { ...made.data.number, plain: made.data.plain };
    const number = '+16505550001';
    const linked = await a.api.post('/api/phones', { number, via: { numberId: num.id, number: num.plain } });
    const code = /code is (\d{6})/.exec(m.outbox.texts.at(-1).body)[1];
    await a.api.post(`/api/phones/${linked.data.phone.id}/verify`, { code });
    await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: linked.data.phone.id });
    assert.equal((await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to: '+13055550001' })).status, 201);
    let log = [];
    for (let i = 0; i < 200 && log.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
      log = (await a.api.get(`/api/numbers/${num.id}/calls`)).data.calls;
    }
    assert.equal(log.length, 1);
    assert.equal(log[0].status, 'answered');
    assert.equal(log[0].direction, 'out');
  } finally {
    await dev.stop();
  }
});

test('provider off: lists work and are empty; search and create answer 503', async () => {
  const off = await startTestApp({ phone: { provider: 'off' } });
  try {
    assert.equal(off.services.phone.provider, null);
    const a = await newAccount(off, { credits: 1000 });
    assert.deepEqual((await a.api.get('/api/numbers')).data, { numbers: [] });
    assert.deepEqual((await a.api.get('/api/phones')).data, { phones: [] });
    const tries = [
      a.api.get('/api/numbers/search?country=US'),
      a.api.post('/api/numbers', { number: '+14155550100' }),
      a.api.post('/api/phones', { number: '+16505550001', via: { numberId: 'x', number: '+14155550100' } }),
    ];
    for (const res of await Promise.all(tries)) {
      assert.equal(res.status, 503);
      assert.equal(res.data.error.code, 'phone_off');
    }
    // No webhook and no development route without a provider.
    assert.equal((await client(off).post('/api/hooks/phone/text', {})).status, 404);
    assert.equal((await a.api.get('/api/dev/phone-outbox')).status, 404);
    assert.equal(off.store.balance(a.id), 1000);
    // The cleanup jobs run with no provider too.
    await off.runJobs('phone-retention');
  } finally {
    await off.stop();
  }
});

test('database file: no plain number and no message text on the disk', async () => {
  // One more full round, so that every kind of row is in the file.
  const a = await newAccount(app, { credits: 1000 });
  const num = await buyNumber(a);
  const phone = await linkPhone(a, num);
  await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: phone.id, forwardTexts: true, forwardCalls: true });
  const peer = outsider();
  const body = remember('The last secret text 0c0c');
  await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: peer, body });
  await hook('text', { to: num.plain, from: peer, body });
  await mock.simulateCall({ to: num.plain, from: peer, seconds: 20 });
  await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to: peer });
  assert.ok(app.db.get('SELECT COUNT(*) AS n FROM live_calls').n >= 1);

  app.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const files = ['accounts.db', 'accounts.db-wal'].map((f) => join(app.config.dataDir, f)).filter(existsSync);
  const bytes = Buffer.concat(files.map((f) => readFileSync(f)));
  assert.ok(bytes.length > 50_000);
  // The search works: the account ID is in the file in plain form.
  assert.ok(bytes.includes(a.id));
  assert.ok(secrets.length > 40);
  for (const s of new Set(secrets)) {
    assert.ok(!bytes.includes(s), 'found a plain value in the database file');
    // Also without the "+" of a phone number.
    if (s.startsWith('+')) assert.ok(!bytes.includes(s.slice(1)), 'found the digits of a number in the database file');
  }
  // The provider reference of a number is not there in plain form.
  for (const ref of mock.owned.keys()) assert.ok(!bytes.includes(ref));
});
