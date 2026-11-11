// "Own phone" provider with a fake gateway (test/fake-smsgate.js): the pool, the operator tool,
// texts out and in, the webhook of the phone, online and offline, and the privacy rules.
// No real phone and no real gateway server is used here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestApp, client, newAccount, unb64u } from './helpers.js';
import { startFakeGateway } from './fake-smsgate.js';
import { openJson } from '../shared/crypto.js';
import { contextOf, addPhone, listPhones, addSim, removeSim, removePhone, testText, runCli, parseArgs, maskNumber, ToolError, HELP } from '../server/tools/ownphone.js';
import { createGatewayClient, createOwnPhoneProvider, WEBHOOK_EVENTS } from '../server/phone/providers/ownphone.js';
import { signWebhook } from '../server/phone/ownphone.js';
import { countryOfNumber } from '../server/phone/pool.js';
import { ProviderError } from '../server/phone/providers/errors.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = 'http://localhost:8080';
const TTL = 3600;

let app;
let gateway;
let ctx;
// Everything that must never be in the database file or in the log in plain form.
const secrets = [];
const logs = [];
const published = [];
const remember = (v) => { secrets.push(v); return v; };
// The labels of the phones are secrets for the database file, but the operator's list shows them.
const labels = new Set();
let counter = 0;
const poolNumber = () => remember(`+1415555${3000 + counter++}`);
const realPhone = () => remember(`+1650555${3000 + counter++}`);
const outsider = () => remember(`+1305555${3000 + counter++}`);
const now = () => Math.floor(Date.now() / 1000);

before(async () => {
  gateway = await startFakeGateway();
  app = await startTestApp({ phone: { provider: 'ownphone', countries: ['US', 'CA', 'GB'], ownphone: { apiUrl: gateway.url, pingSeconds: 300, offlineMinutes: 15, textTtlSeconds: TTL } } });
  ctx = contextOf(app);
  for (const level of ['debug', 'info', 'warn', 'error']) {
    const real = app.log[level];
    if (typeof real === 'function') app.log[level] = (...args) => { logs.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')); return real.apply(app.log, args); };
  }
  const realPublish = app.events.publish;
  app.events.publish = (...args) => { published.push(args); return realPublish.apply(app.events, args); };
});
after(async () => { await app.stop(); await gateway.stop(); });

// Makes a login at the fake gateway and adds its phone to the pool with the tool function.
// sims: how many SIM cards. Returns { label, user, device, numbers, phone, res }.
async function addPooledPhone(label, sims = 1, extra = {}) {
  const user = gateway.addUser({ devices: [{ name: label, sims: Array.from({ length: sims }, (_, i) => i + 1) }] });
  remember(user.password);
  remember(user.login);
  const numbers = Array.from({ length: sims }, () => poolNumber());
  labels.add(label);
  const res = await addPhone(ctx, { label: remember(label), login: user.login, password: user.password, sims: numbers.map((number, i) => ({ simNumber: i + 1, number })), ...extra });
  remember(new URL(res.webhookUrl).pathname.split('/').pop());
  remember(gateway.users.get(user.login).settings.webhooks.signing_key);
  return { label, user, device: user.devices[0], numbers, phone: gateway.phone(user.login, user.devices[0].id, app.url), res };
}
async function getNumber(acct, number) {
  const s = await acct.api.get('/api/numbers/search');
  assert.equal(s.status, 200);
  assert.ok(s.data.numbers.some((n) => n.number === number), 'the number is not free');
  const res = await acct.api.post('/api/numbers', { number });
  assert.equal(res.status, 201);
  return { ...res.data.number, plain: res.data.plain };
}
async function sendText(acct, num, to, body) {
  const res = await acct.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to, body: remember(body) });
  return res;
}
const texts = async (acct, num) => (await acct.api.get(`/api/numbers/${num.id}/texts`)).data.texts;
const openText = (acct, t) => openJson(acct.keys, unb64u(t.sealed), 'text');
const ledger = (acct) => app.store.ledger(acct.id).map((l) => `${l.kind}:${l.delta}`);
const numberOf = async (acct, num) => (await acct.api.get('/api/numbers')).data.numbers.find((n) => n.id === num.id);
const requestsSince = (mark) => gateway.requests.slice(mark);
const rows = (sql, ...args) => app.db.all(sql, ...args);
const eventsFor = (acct) => published.filter((e) => e[0] === acct.id).map((e) => e[1]);

// One phone with two SIM cards that most tests share.
let one; // addPooledPhone result
test('tool: add a phone with two SIM cards; the webhooks and the settings arrive at the gateway as specified', async () => {
  const mark = gateway.requests.length;
  one = await addPooledPhone('Kitchen-drawer-Pixel', 2);
  const sent = requestsSince(mark);
  // 1 check of the login, 5 webhooks, 1 change of settings, in this order
  assert.deepEqual(sent.map((r) => `${r.method} ${r.path} ${r.status}`), ['GET /devices 200', ...WEBHOOK_EVENTS.map(() => 'POST /webhooks 201'), 'PATCH /settings 200']);
  assert.ok(sent.every((r) => r.login === one.user.login), 'a request used a different login');
  const hooks = sent.filter((r) => r.path === '/webhooks').map((r) => r.body);
  assert.deepEqual(hooks.map((h) => h.event), ['sms:received', 'sms:sent', 'sms:delivered', 'sms:failed', 'system:ping']);
  const url = hooks[0].url;
  assert.match(url, /^http:\/\/localhost:8080\/api\/hooks\/ownphone\/[A-Za-z0-9_-]{43}$/);
  assert.equal(url, one.res.webhookUrl);
  for (const h of hooks) {
    assert.deepEqual(Object.keys(h).sort(), ['deviceId', 'event', 'id', 'url']);
    assert.equal(h.url, url);
    assert.equal(h.deviceId, one.device.id);
    assert.ok(h.id.length <= 36);
  }
  assert.equal(new Set(hooks.map((h) => h.id)).size, 5);
  const settings = sent.at(-1).body;
  assert.deepEqual(Object.keys(settings).sort(), ['ping', 'webhooks']);
  assert.deepEqual(settings.ping, { interval_seconds: 300 });
  assert.deepEqual(Object.keys(settings.webhooks), ['signing_key']);
  assert.match(settings.webhooks.signing_key, /^[A-Za-z0-9_-]{43}$/);

  // The tool says what the person must know.
  assert.deepEqual(one.res.sims.map((s) => [s.simNumber, s.number, s.country]), [[1, one.numbers[0], 'US'], [2, one.numbers[1], 'US']]);
  assert.ok(one.res.warnings.some((w) => /https:\/\//.test(w)), 'no warning about PUBLIC_URL without https');
  assert.ok(!one.res.warnings.some((w) => /PHONE_PROVIDER/.test(w)));

  // The list hides the numbers unless the person asks for them.
  const listed = listPhones(ctx);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].label, 'Kitchen-drawer-Pixel');
  assert.equal(listed[0].online, false);
  assert.equal(listed[0].lastSeen, null);
  assert.deepEqual(listed[0].sims, [
    { simNumber: 1, number: '+•••••••' + one.numbers[0].slice(-4), country: 'US', inUse: false },
    { simNumber: 2, number: '+•••••••' + one.numbers[1].slice(-4), country: 'US', inUse: false },
  ]);
  assert.deepEqual(listPhones(ctx, { show: true })[0].sims.map((s) => s.number), one.numbers);
  assert.equal(maskNumber('+15551234567'), '+•••••••4567');

  // The rows: encrypted values and hashes only.
  const dev = rows('SELECT * FROM own_devices')[0];
  for (const col of ['label', 'login', 'password', 'signing_key', 'hook_hash']) assert.ok(dev[col] instanceof Uint8Array, `${col} is not binary`);
  assert.equal(dev.gateway_id, one.device.id);
  assert.equal(app.keys.srvDecrypt(dev.password, 'own-password').toString('utf8'), one.user.password);
  const sims = rows('SELECT * FROM own_sims ORDER BY sim_number');
  assert.equal(sims.length, 2);
  assert.ok(Buffer.from(sims[0].number_hmac).equals(app.keys.indexHmac('num', one.numbers[0])));
  assert.equal(app.keys.srvDecrypt(sims[0].number_srv, 'pool').toString('utf8'), one.numbers[0]);
});

test('tool: plain errors, and nothing is stored when a step fails', async () => {
  const count = () => rows('SELECT COUNT(*) AS n FROM own_devices')[0].n;
  const start = count();
  const user = gateway.addUser({ devices: [{ name: 'Spare', sims: [1] }] });
  const good = { label: 'Spare', login: user.login, password: user.password, sims: [{ simNumber: 1, number: poolNumber() }] };
  const refuses = async (args, pattern) => assert.rejects(() => addPhone(ctx, { ...good, ...args }), (err) => { assert.ok(err instanceof ToolError, String(err)); assert.match(err.message, pattern); return true; });

  await refuses({ label: 'kitchen-drawer-pixel' }, /is in the pool already/);
  await refuses({ label: '' }, /label/);
  await refuses({ password: 'wrong' }, /did not accept this login and password/);
  await refuses({ login: 'nobody' }, /did not accept this login and password/);
  await refuses({ password: '' }, /login and the password/);
  await refuses({ sims: [] }, /at least one SIM/);
  await refuses({ sims: [{ simNumber: 4, number: good.sims[0].number }] }, /1, 2 or 3/);
  await refuses({ sims: [{ simNumber: 1, number: '4155550100' }] }, /country code/);
  await refuses({ sims: [{ simNumber: 1, number: one.numbers[0] }] }, /in the pool already/);
  await refuses({ sims: [{ simNumber: 1, number: good.sims[0].number }, { simNumber: 1, number: poolNumber() }] }, /one time/);
  await refuses({ sims: [{ simNumber: 1, number: '+99812345678' }] }, /--country/);
  await refuses({ deviceId: 'no-such-device' }, /no phone with the device id/);
  // the same phone a second time (the login of the first phone)
  await refuses({ label: 'Again', login: one.user.login, password: one.user.password }, /in the pool already, with the label "Kitchen-drawer-Pixel"/);
  assert.equal(count(), start);

  // The gateway does not answer well: nothing stays in the pool.
  gateway.failNext(500);
  await refuses({}, /not reachable at http:\/\/127\.0\.0\.1:\d+\/api\/3rdparty\/v1/);
  assert.equal(count(), start);
  // The settings fail after the webhooks were made: the phone is taken out again, and the webhooks are removed.
  const mark = gateway.requests.length;
  gateway.failIf = (r) => (r.method === 'PATCH' && r.path === '/settings' ? 500 : 0);
  try { await refuses({}, /not reachable/); } finally { gateway.failIf = null; }
  assert.equal(count(), start);
  assert.equal(rows('SELECT COUNT(*) AS n FROM own_sims')[0].n, 2);
  assert.equal(requestsSince(mark).filter((r) => r.method === 'DELETE' && /^\/webhooks\//.test(r.path) && r.status === 204).length, 5);
  assert.equal(gateway.users.get(user.login).webhooks.size, 0);

  // A login with two phones: the tool lists them and adds nothing. With the device id it works.
  const twin = gateway.addUser({ devices: [{ name: 'Twin A', sims: [1] }, { name: 'Twin B', sims: [1] }] });
  const asked = await addPhone(ctx, { label: 'Twin A', login: twin.login, password: twin.password, sims: [{ simNumber: 1, number: poolNumber() }] });
  assert.equal(asked.needDevice, true);
  assert.deepEqual(asked.devices.map((d) => [d.id, d.name]), twin.devices.map((d) => [d.id, d.name]));
  assert.equal(count(), start);

  // The country of a number, and a number in a country that the web app does not offer.
  assert.equal(countryOfNumber('+442079460000'), 'GB');
  assert.equal(countryOfNumber('+4915112345678'), 'DE');
  assert.equal(countryOfNumber('+99812345678'), '');
  const de = gateway.addUser({ devices: [{ name: 'Berlin', sims: [{ simNumber: 1, slotIndex: 0, phoneNumber: '+4915100000001', carrierName: 'X', iccid: null }] }] });
  const deNumber = remember('+4915112345678');
  const res = await addPhone(ctx, { label: remember('Berlin phone'), login: remember(de.login), password: remember(de.password), sims: [{ simNumber: 1, number: deNumber }] });
  assert.equal(res.sims[0].country, 'DE');
  assert.ok(res.warnings.some((w) => /PHONE_COUNTRIES does not have DE/.test(w)));
  assert.ok(res.warnings.some((w) => /reports a different number for SIM 1 \(it ends in 0001\)/.test(w)));
  // It is found with no country and with its own country, not with another one.
  const a = await newAccount(app);
  assert.ok((await a.api.get('/api/numbers/search')).data.numbers.some((n) => n.number === deNumber && n.country === 'DE'));
  assert.deepEqual((await a.api.get('/api/numbers/search?country=DE')).data.numbers.map((n) => n.number), [deNumber]);
  assert.ok(!(await a.api.get('/api/numbers/search?country=US')).data.numbers.some((n) => n.number === deNumber));
  // Free numbers leave with the tool, with no --force.
  const gone = await removePhone(ctx, { label: 'berlin PHONE' });
  assert.deepEqual(gone, { label: 'Berlin phone', sims: 1, takenBack: 0, gatewayCleaned: true });
  assert.equal(count(), start);
});

test('numbers: the search shows the free pool numbers; "get a number" takes one; nothing else can be bought', async () => {
  assert.deepEqual(app.services.phone.capabilities, { voice: false, voicemail: false, asyncText: true, searchByArea: false, pool: true });
  assert.equal(app.services.phone.name, 'ownphone');
  const a = await newAccount(app, { credits: 2000 });
  const b = await newAccount(app, { credits: 2000 });
  const mark = gateway.requests.length;

  const s = await a.api.get('/api/numbers/search');
  assert.equal(s.status, 200);
  assert.deepEqual(s.data.numbers, one.numbers.map((number) => ({ number, locality: '', region: '', country: 'US', sms: true, voice: false })));
  assert.deepEqual((await a.api.get('/api/numbers/search?country=US&areaCode=212')).data.numbers.map((n) => n.number), one.numbers, 'a pool has no area search');
  assert.deepEqual((await a.api.get('/api/numbers/search?country=GB')).data.numbers, []);
  assert.equal((await a.api.get('/api/numbers/search?country=XYZ')).status, 400);

  // A number that is not in the pool, and a pool number that was not offered to this account.
  assert.equal((await a.api.post('/api/numbers', { number: '+14155550999' })).status, 409);
  assert.equal((await b.api.post('/api/numbers', { number: one.numbers[0] })).status, 409);

  const res = await a.api.post('/api/numbers', { number: one.numbers[0] });
  assert.equal(res.status, 201);
  const n = res.data.number;
  assert.equal(res.data.plain, one.numbers[0]);
  assert.equal(n.voice, false);
  assert.equal(n.sms, true);
  assert.equal(n.country, 'US');
  assert.deepEqual(n.gateway, { online: false, lastSeen: null });
  assert.deepEqual(await openJson(a.keys, unb64u(n.sealedNumber), 'number'), { number: one.numbers[0] });
  assert.deepEqual(ledger(a), ['number:-400', 'topup:2000']);
  // The provider reference is the SIM of the pool, encrypted.
  const row = rows('SELECT * FROM numbers WHERE id = ?', n.id)[0];
  assert.equal(app.keys.srvDecrypt(row.provider_ref, 'ref').toString('utf8'), rows('SELECT id FROM own_sims WHERE sim_number = 1')[0].id);

  // It is not free any more: not in the search of anybody, and nobody else can take it.
  assert.deepEqual((await b.api.get('/api/numbers/search')).data.numbers.map((x) => x.number), [one.numbers[1]]);
  assert.equal((await b.api.post('/api/numbers', { number: one.numbers[0] })).status, 409);
  assert.deepEqual(listPhones(ctx)[0].sims.map((x) => x.inUse), [true, false]);
  // Search and "get a number" ask the gateway for nothing.
  assert.equal(requestsSince(mark).length, 0);
  // The webhook routes of the other providers do not exist here.
  for (const name of ['text', 'text-status', 'voice', 'status', 'recording']) assert.equal((await client(app).post(`/api/hooks/phone/${name}`, {})).status, 404);

  await a.api.del(`/api/numbers/${n.id}`);
});

test('a text goes out: queued, then the phone reports sent, then delivered', async () => {
  const a = await newAccount(app, { credits: 2000 });
  const num = await getNumber(a, one.numbers[0]);
  const to = outsider();
  const mark = gateway.requests.length;
  const res = await sendText(a, num, to, 'Is the bike still for sale? ownphone-out-1');
  assert.equal(res.status, 201);
  assert.equal(res.data.text.status, 'queued');
  assert.equal(res.data.text.direction, 'out');

  // Exactly one request, with the login of this phone and the body of the brief.
  const sent = requestsSince(mark);
  assert.equal(sent.length, 1);
  assert.deepEqual([sent[0].method, sent[0].path, sent[0].status, sent[0].login], ['POST', '/messages', 202, one.user.login]);
  const body = sent[0].body;
  assert.deepEqual(Object.keys(body).sort(), ['deviceId', 'id', 'phoneNumbers', 'simNumber', 'textMessage', 'ttl', 'withDeliveryReport']);
  assert.match(body.id, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual({ ...body, id: '' }, { id: '', deviceId: one.device.id, phoneNumbers: [to], textMessage: { text: 'Is the bike still for sale? ownphone-out-1' }, simNumber: 1, ttl: TTL, withDeliveryReport: true });
  assert.deepEqual(ledger(a), ['text:-3', 'number:-400', 'topup:2000']);

  // The reports of the phone.
  published.length = 0;
  assert.equal((await one.phone.report('sent', body.id)).status, 200);
  assert.equal((await texts(a, num))[0].status, 'sent');
  assert.equal((await one.phone.report('delivered', body.id)).status, 200);
  assert.equal((await texts(a, num))[0].status, 'delivered');
  assert.ok(eventsFor(a).filter((e) => e === 'text').length >= 2);
  // Late and repeated reports change nothing and pay nothing back.
  assert.equal((await one.phone.report('failed', body.id)).status, 200);
  assert.equal((await one.phone.report('sent', body.id)).status, 200);
  assert.equal((await texts(a, num))[0].status, 'delivered');
  assert.deepEqual(ledger(a), ['text:-3', 'number:-400', 'topup:2000']);
  assert.deepEqual(await openText(a, (await texts(a, num))[0]), { peer: to, body: 'Is the bike still for sale? ownphone-out-1' });
  // A report for an id that this server never sent does nothing.
  assert.equal((await one.phone.report('failed', 'not-one-of-ours')).status, 200);

  // SIM 2 of the same phone sends with simNumber 2.
  const b = await newAccount(app, { credits: 2000 });
  const num2 = await getNumber(b, one.numbers[1]);
  assert.equal((await sendText(b, num2, to, 'from the second SIM ownphone-out-2')).status, 201);
  assert.equal(gateway.lastMessage(one.user.login).request.simNumber, 2);
  await b.api.del(`/api/numbers/${num2.id}`);
  await a.api.del(`/api/numbers/${num.id}`);
});

test('a text fails: the phone reports it, the text shows "failed", and the charge comes back one time', async () => {
  const a = await newAccount(app, { credits: 2000 });
  const num = await getNumber(a, one.numbers[0]);
  const res = await sendText(a, num, outsider(), 'this one fails ownphone-out-3');
  assert.equal(res.data.text.status, 'queued');
  const id = gateway.lastMessage(one.user.login).id;
  logs.length = 0;
  assert.equal((await one.phone.report('failed', id, { reason: 'RESULT_ERROR_NO_SERVICE' })).status, 200);
  assert.equal((await texts(a, num))[0].status, 'failed');
  assert.deepEqual(ledger(a), ['refund:3', 'text:-3', 'number:-400', 'topup:2000']);
  assert.ok(logs.some((l) => /did not deliver a text \(RESULT_ERROR_NO_SERVICE\)/.test(l)), 'the reason is not in the log');
  // The same report again, and a late "delivered": no second refund, no change.
  await one.phone.report('failed', id);
  await one.phone.report('delivered', id);
  assert.equal((await texts(a, num))[0].status, 'failed');
  assert.deepEqual(ledger(a), ['refund:3', 'text:-3', 'number:-400', 'topup:2000']);
  await a.api.del(`/api/numbers/${num.id}`);
});

test('no report at all: after the time to live plus 10 minutes a job fails the text and gives the charge back', async () => {
  const a = await newAccount(app, { credits: 2000 });
  const num = await getNumber(a, one.numbers[0]);
  await sendText(a, num, outsider(), 'the phone is gone ownphone-out-4');
  await sendText(a, num, outsider(), 'this one was sent ownphone-out-5');
  const sentId = gateway.lastMessage(one.user.login).id;
  await one.phone.report('sent', sentId);
  await app.runJobs('ownphone-unsent');
  assert.deepEqual((await texts(a, num)).map((t) => t.status).sort(), ['queued', 'sent']);

  // Not yet: one second before the limit.
  app.db.run('UPDATE text_sends SET at = ? WHERE account_id = ?', now() - (TTL + 600) + 5, a.id);
  await app.runJobs('ownphone-unsent');
  assert.deepEqual((await texts(a, num)).map((t) => t.status).sort(), ['queued', 'sent']);
  // Now.
  app.db.run('UPDATE text_sends SET at = ? WHERE account_id = ?', now() - (TTL + 600) - 5, a.id);
  published.length = 0;
  await app.runJobs('ownphone-unsent');
  // The queued text failed. The text that the phone reported as sent stays as it is.
  assert.deepEqual((await texts(a, num)).map((t) => t.status).sort(), ['failed', 'sent']);
  assert.deepEqual(ledger(a), ['refund:3', 'text:-3', 'text:-3', 'number:-400', 'topup:2000']);
  assert.deepEqual(eventsFor(a).sort(), ['balance', 'text']);
  await app.runJobs('ownphone-unsent');
  assert.deepEqual(ledger(a), ['refund:3', 'text:-3', 'text:-3', 'number:-400', 'topup:2000']);
  // A very late report of the phone for the failed text changes nothing.
  await one.phone.report('delivered', gateway.messagesOf(one.user.login).at(-2).id);
  assert.deepEqual((await texts(a, num)).map((t) => t.status).sort(), ['failed', 'sent']);
  await a.api.del(`/api/numbers/${num.id}`);
});

let two; // a second phone with one SIM
test('texts come in: by SIM slot, by the number of the SIM, on a phone with one SIM, and for a number that nobody holds', async () => {
  two = await addPooledPhone('Second phone', 1);
  const a = await newAccount(app, { credits: 2000 });
  const b = await newAccount(app, { credits: 2000 });
  const c = await newAccount(app, { credits: 2000 });
  const n1 = await getNumber(a, one.numbers[0]);
  const n2 = await getNumber(b, one.numbers[1]);
  const n3 = await getNumber(c, two.numbers[0]);
  const from = outsider();
  const bodies = async (acct, num) => Promise.all((await texts(acct, num)).map(async (t) => (await openText(acct, t)).body));
  const total = () => rows('SELECT COUNT(*) AS n FROM texts')[0].n;

  // By the SIM slot.
  published.length = 0;
  assert.equal((await one.phone.receive({ from, text: remember('to SIM two own-in-1'), sim: 2 })).status, 200);
  assert.deepEqual(await bodies(b, n2), ['to SIM two own-in-1']);
  assert.deepEqual(await bodies(a, n1), []);
  assert.deepEqual(published.filter((e) => e[1] === 'text'), [[b.id, 'text', { numberId: n2.id }]]);
  const got = (await texts(b, n2))[0];
  assert.deepEqual([got.direction, got.seen, got.status], ['in', false, null]);
  assert.deepEqual(await openText(b, got), { peer: from, body: 'to SIM two own-in-1' });

  // No SIM slot, but the phone knows the number of the SIM (with spaces, as a phone can write it).
  await one.phone.receive({ from, text: remember('by recipient own-in-2'), sim: null, recipient: `${one.numbers[0].slice(0, 2)} ${one.numbers[0].slice(2, 5)} ${one.numbers[0].slice(5)}` });
  assert.deepEqual(await bodies(a, n1), ['by recipient own-in-2']);
  // No SIM slot and no number, on a phone with two SIM cards: nobody can say whose text it is. It is dropped.
  let count = total();
  logs.length = 0;
  assert.equal((await one.phone.receive({ from, text: remember('whose is it own-in-3'), sim: null, recipient: null })).status, 200);
  assert.deepEqual(logs, ['a text arrived at a phone of the pool, and its SIM is not known or not in the pool; it was dropped'], 'the operator is not told about a text that was dropped');
  // The recipient is a pool number of a DIFFERENT phone: not used.
  assert.equal((await one.phone.receive({ from, text: remember('wrong phone own-in-4'), sim: null, recipient: two.numbers[0] })).status, 200);
  // A SIM slot that is not in the pool: never given to another SIM.
  assert.equal((await two.phone.receive({ from, text: remember('slot three own-in-5'), sim: 3 })).status, 200);
  assert.equal((await one.phone.receive({ from, text: remember('slot three own-in-6'), sim: 3, recipient: one.numbers[0] })).status, 200);
  assert.equal(total(), count);

  // A phone with one SIM: neither is needed.
  await two.phone.receive({ from, text: remember('one SIM own-in-7'), sim: null, recipient: null });
  assert.deepEqual(await bodies(c, n3), ['one SIM own-in-7']);

  // The same webhook two times (the phone tries again): stored one time.
  const again = { from, text: remember('only once own-in-8'), sim: 1, messageId: 'a1b2c3d4', receivedAt: '2026-11-11T10:00:00.000+00:00' };
  await one.phone.receive(again);
  await one.phone.receive(again);
  assert.deepEqual(await bodies(a, n1), ['only once own-in-8', 'by recipient own-in-2']);
  // The short id of the phone with a different time is a different text.
  await one.phone.receive({ ...again, text: remember('same id later own-in-9'), receivedAt: '2026-11-11T10:05:00.000+00:00' });
  assert.equal((await bodies(a, n1)).length, 3);

  // A sender that is a name, a very long text, and a text that is not a string.
  await one.phone.receive({ from: 'MapleShop', text: 'x'.repeat(5000), sim: 1 });
  const long = await openText(a, (await texts(a, n1))[0]);
  assert.deepEqual([long.peer, long.body.length], ['MapleShop', 1600]);
  count = total();
  assert.equal((await one.phone.post('sms:received', { messageId: 'zz', phoneNumber: from, simNumber: 1, message: { not: 'text' } })).status, 200);
  assert.equal((await one.phone.post('sms:received', null)).status, 200);
  assert.equal(total(), count);

  // A pool number that no account holds: the text is dropped, nothing is stored.
  await b.api.del(`/api/numbers/${n2.id}`);
  count = total();
  assert.equal((await one.phone.receive({ from, text: remember('nobody home own-in-10'), sim: 2 })).status, 200);
  assert.equal(total(), count);
  // A suspended number gets nothing either.
  app.db.run("UPDATE numbers SET status = 'suspended' WHERE id = ?", n3.id);
  await two.phone.receive({ from, text: remember('paused own-in-11'), sim: 1 });
  assert.equal(total(), count);
  app.db.run("UPDATE numbers SET status = 'active' WHERE id = ?", n3.id);

  await a.api.del(`/api/numbers/${n1.id}`);
  await c.api.del(`/api/numbers/${n3.id}`);
});

test('the webhook: a wrong token is 404; a wrong signature or an old time is 403; nothing of that marks the phone as seen', async () => {
  const seen = () => rows('SELECT last_seen FROM own_devices WHERE gateway_id = ?', two.device.id)[0].last_seen;
  app.db.run('UPDATE own_devices SET last_seen = NULL, online = 0 WHERE gateway_id = ?', two.device.id);
  const ping = (opt) => two.phone.ping(opt);
  const goodUrl = gateway.users.get(two.user.login).webhooks.values().next().value.url;

  assert.equal((await ping({ url: goodUrl.replace(/[^/]+$/, 'A'.repeat(43)) })).status, 404);
  assert.equal((await ping({ url: goodUrl.replace(/[^/]+$/, 'short') })).status, 404);
  // the token of a different phone with the key of this one
  assert.equal((await ping({ url: gateway.users.get(one.user.login).webhooks.values().next().value.url })).status, 403);
  assert.equal((await ping({ signature: 'ab'.repeat(32) })).status, 403);
  assert.equal((await ping({ signature: 'not hex' })).status, 403);
  assert.equal((await ping({ key: 'a-different-signing-key' })).status, 403);
  assert.equal((await ping({ key: '' })).status, 403, 'a request with no signature was accepted');
  assert.equal((await ping({ timestamp: now() - 301 })).status, 403, 'a request that is 5 minutes old was accepted');
  assert.equal((await ping({ timestamp: now() + 301 })).status, 403);
  assert.equal((await ping({ timestamp: 'abc' })).status, 403);
  // The signature must cover the body: a changed body with the old signature is refused.
  const stamp = String(now());
  const key = gateway.users.get(two.user.login).settings.webhooks.signing_key;
  const signed = signWebhook(key, '{"event":"system:ping"}', stamp);
  const target = app.url + new URL(goodUrl).pathname;
  const raw = (body, headers) => fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  assert.equal((await raw('{"event":"sms:received"}', { 'x-timestamp': stamp, 'x-signature': signed })).status, 403);
  assert.equal(seen(), null);
  // The same value in capital letters is the same signature. A body that is not JSON is 400.
  assert.equal((await raw('{"event":"system:ping"}', { 'x-timestamp': stamp, 'x-signature': signed.toUpperCase() })).status, 200);
  assert.equal((await raw('not json', { 'x-timestamp': stamp, 'x-signature': signWebhook(key, 'not json', stamp) })).status, 400);
  assert.equal((await client(app).get(new URL(goodUrl).pathname)).status, 405);
  // (the JSON above had no deviceId: it was signed well, but it is not this phone, so the phone is still not "seen")
  assert.equal(seen(), null);

  // Signed well, but the body names a different phone of the gateway: ignored.
  const total = rows('SELECT COUNT(*) AS n FROM texts')[0].n;
  assert.equal((await two.phone.receive({ from: outsider(), text: 'other device', sim: 1 }, { deviceId: 'AnotherDeviceOfThatLogin' })).status, 200);
  assert.equal(seen(), null);
  assert.equal(rows('SELECT COUNT(*) AS n FROM texts')[0].n, total);

  // A good request: 200, and the phone is seen now. Times up to 5 minutes off are fine.
  assert.equal((await ping({ timestamp: now() - 290 })).status, 200);
  assert.ok(Math.abs(seen() - now()) <= 2);
  // An event that this server does not use is answered with 200, so that the phone does not try again.
  assert.equal((await two.phone.post('sms:data-received', { messageId: 'x' }, { url: goodUrl })).status, 200);
});

test('online and offline: a ping makes the phone online, silence makes it offline, the number shows it, and the holders are told', async () => {
  const a = await newAccount(app, { credits: 2000 });
  const other = await newAccount(app, { credits: 2000 });
  const fresh = await addPooledPhone('Third phone', 1);
  const num = await getNumber(a, fresh.numbers[0]);
  const elsewhere = await getNumber(other, one.numbers[0]);
  assert.deepEqual((await numberOf(a, num)).gateway, { online: false, lastSeen: null });
  assert.equal(listPhones(ctx).find((p) => p.label === 'Third phone').online, false);

  // The first ping: online at once, and the holder gets an event.
  published.length = 0;
  assert.equal((await fresh.phone.ping()).status, 200);
  let g = (await numberOf(a, num)).gateway;
  assert.equal(g.online, true);
  assert.ok(Math.abs(g.lastSeen - now()) <= 2);
  assert.deepEqual(published, [[a.id, 'number', { numberId: num.id }]]);
  assert.equal(listPhones(ctx).find((p) => p.label === 'Third phone').online, true);
  // More pings and the job: no more events while nothing changes.
  published.length = 0;
  await fresh.phone.ping();
  await app.runJobs('ownphone-online');
  assert.deepEqual(published, []);

  // 14 minutes of silence: still online. 16 minutes: offline, and only the holder is told.
  const setSeen = (minutes) => app.db.run('UPDATE own_devices SET last_seen = ? WHERE gateway_id = ?', now() - minutes * 60, fresh.device.id);
  setSeen(14);
  await app.runJobs('ownphone-online');
  assert.equal((await numberOf(a, num)).gateway.online, true);
  assert.deepEqual(published, []);
  setSeen(16);
  logs.length = 0;
  await app.runJobs('ownphone-online');
  g = (await numberOf(a, num)).gateway;
  assert.equal(g.online, false);
  assert.ok(Math.abs(g.lastSeen - (now() - 16 * 60)) <= 2);
  assert.deepEqual(published, [[a.id, 'number', { numberId: num.id }]]);
  assert.ok(logs.some((l) => /1 phone\(s\) of the pool went offline/.test(l)));
  await app.runJobs('ownphone-online');
  assert.equal(published.length, 1, 'the job told the account a second time');
  assert.equal(listPhones(ctx).find((p) => p.label === 'Third phone').online, false);

  // Sending while the phone is offline is allowed: the gateway keeps the text for the phone.
  const res = await sendText(a, num, outsider(), 'sent while offline ownphone-out-6');
  assert.equal(res.status, 201);
  assert.equal(res.data.text.status, 'queued');

  // Any valid webhook brings the phone back, and the holder is told again.
  published.length = 0;
  await fresh.phone.report('sent', gateway.lastMessage(fresh.user.login).id);
  assert.equal((await numberOf(a, num)).gateway.online, true);
  assert.ok(published.some((e) => e[0] === a.id && e[1] === 'number'));
  assert.ok(!published.some((e) => e[0] === other.id), 'an account with a number of a different phone got an event');
  // With the other providers the field is null: test/phone.test.js checks it at each purchase.
  await a.api.del(`/api/numbers/${num.id}`);
  await other.api.del(`/api/numbers/${elsewhere.id}`);
});

test('release puts the number back in the pool; the next account gets it and sees none of the old texts', async () => {
  const a = await newAccount(app, { credits: 2000 });
  const b = await newAccount(app, { credits: 2000 });
  const num = await getNumber(a, one.numbers[0]);
  const from = outsider();
  await one.phone.receive({ from, text: remember('for the first owner own-in-12'), sim: 1, messageId: 'feed0001', receivedAt: '2026-11-11T11:00:00.000+00:00' });
  await sendText(a, num, from, 'answer of the first owner ownphone-out-7');
  const oldSend = gateway.lastMessage(one.user.login).id;
  assert.equal((await texts(a, num)).length, 2);

  const mark = gateway.requests.length;
  assert.equal((await a.api.del(`/api/numbers/${num.id}`)).status, 204);
  assert.equal(requestsSince(mark).length, 0, 'release asked the gateway for something');
  assert.equal(rows('SELECT COUNT(*) AS n FROM texts WHERE number_id = ?', num.id)[0].n, 0);
  assert.equal(rows('SELECT COUNT(*) AS n FROM numbers WHERE id = ?', num.id)[0].n, 0);
  assert.equal((await a.api.get(`/api/numbers/${num.id}/texts`)).status, 404);
  assert.ok((await b.api.get('/api/numbers/search')).data.numbers.some((n) => n.number === one.numbers[0]));

  const next = await getNumber(b, one.numbers[0]);
  assert.notEqual(next.id, num.id);
  assert.deepEqual(await texts(b, next), []);
  assert.equal((await numberOf(b, next)).unread, 0);
  // New texts go to the new holder only. The id of an old text does not hide a new one.
  await one.phone.receive({ from, text: remember('for the second owner own-in-13'), sim: 1, messageId: 'feed0001', receivedAt: '2026-11-11T11:00:00.000+00:00' });
  assert.deepEqual(await Promise.all((await texts(b, next)).map(async (t) => (await openText(b, t)).body)), ['for the second owner own-in-13']);
  // A late "failed" for the old owner's text: the old owner gets the charge back, the new holder sees nothing of it.
  await one.phone.report('failed', oldSend);
  assert.deepEqual(ledger(a), ['refund:3', 'text:-3', 'number:-400', 'topup:2000']);
  assert.equal((await texts(b, next)).length, 1);
  assert.deepEqual(ledger(b), ['number:-400', 'topup:2000']);

  // Deleting the account gives the number back too.
  await app.deleteAccount(b.id);
  const c = await newAccount(app, { credits: 2000 });
  assert.ok((await c.api.get('/api/numbers/search')).data.numbers.some((n) => n.number === one.numbers[0]));
});

test('two phones: each number sends through its own phone, login and SIM', async () => {
  const a = await newAccount(app, { credits: 2000 });
  const n1 = await getNumber(a, one.numbers[1]);
  const n3 = await getNumber(a, two.numbers[0]);
  const to = outsider();
  let mark = gateway.requests.length;
  await sendText(a, n1, to, 'through the first phone ownphone-out-8');
  assert.deepEqual(requestsSince(mark).map((r) => [r.login, r.body.deviceId, r.body.simNumber]), [[one.user.login, one.device.id, 2]]);
  mark = gateway.requests.length;
  await sendText(a, n3, to, 'through the second phone ownphone-out-9');
  assert.deepEqual(requestsSince(mark).map((r) => [r.login, r.body.deviceId, r.body.simNumber]), [[two.user.login, two.device.id, 1]]);
  // A report with the token of the other phone's webhook but its own signing key is refused (see the webhook test);
  // a report of the right phone works.
  const id = gateway.lastMessage(two.user.login).id;
  await two.phone.report('delivered', id);
  assert.equal((await texts(a, n3))[0].status, 'delivered');

  // Two phones on ONE login of the gateway share the signing key of that login.
  const twin = gateway.addUser({ devices: [{ name: 'Twin A', sims: [1] }, { name: 'Twin B', sims: [1] }] });
  remember(twin.password);
  const tA = await addPhone(ctx, { label: 'Twin A', login: twin.login, password: twin.password, deviceId: twin.devices[0].id, sims: [{ simNumber: 1, number: poolNumber() }] });
  const keyA = remember(gateway.users.get(twin.login).settings.webhooks.signing_key);
  const tB = await addPhone(ctx, { label: 'Twin B', login: twin.login, password: twin.password, deviceId: twin.devices[1].id, sims: [{ simNumber: 1, number: poolNumber() }] });
  assert.equal(gateway.users.get(twin.login).settings.webhooks.signing_key, keyA, 'the second phone of a login changed the signing key of the first one');
  assert.notEqual(tA.webhookUrl, tB.webhookUrl);
  remember(tA.webhookUrl.split('/').pop());
  remember(tB.webhookUrl.split('/').pop());
  const phoneA = gateway.phone(twin.login, twin.devices[0].id, app.url);
  const phoneB = gateway.phone(twin.login, twin.devices[1].id, app.url);
  const nA = await getNumber(a, tA.sims[0].number);
  const nB = await getNumber(a, tB.sims[0].number);
  await phoneA.receive({ from: to, text: remember('twin A own-in-14') });
  await phoneB.receive({ from: to, text: remember('twin B own-in-15') });
  assert.deepEqual((await openText(a, (await texts(a, nA))[0])).body, 'twin A own-in-14');
  assert.deepEqual((await openText(a, (await texts(a, nB))[0])).body, 'twin B own-in-15');
  for (const n of [n1, n3, nA, nB]) await a.api.del(`/api/numbers/${n.id}`);
  await removePhone(ctx, { label: 'Twin A' });
  await removePhone(ctx, { label: 'Twin B' });
});

test('the gateway refuses or does not answer: 502 with plain words, and the charge comes back', async () => {
  const a = await newAccount(app, { credits: 2000 });
  const num = await getNumber(a, one.numbers[0]);
  const to = outsider();
  const expectFail = async (message) => {
    const before = ledger(a).length;
    const res = await sendText(a, num, to, 'does not leave ownphone-out-10');
    assert.equal(res.status, 502);
    assert.deepEqual(res.data.error, { code: 'provider_error', message });
    assert.deepEqual(ledger(a).slice(0, ledger(a).length - before), ['refund:3', 'text:-3']);
    assert.deepEqual(await texts(a, num), []);
  };
  gateway.failNext(500);
  await expectFail('The phone gateway is not reachable.');
  gateway.failNext(502);
  await expectFail('The phone gateway is not reachable.');
  gateway.failNext(503); // "queue limits exceeded"
  await expectFail('The phone did not accept this text.');
  gateway.failNext(409);
  await expectFail('The phone did not accept this text.');
  gateway.users.get(one.user.login).badNumbers.add(to); // the real gateway checks each number
  await expectFail('The phone did not accept this text.');
  gateway.users.get(one.user.login).badNumbers.delete(to);
  // The password of the phone changed at the gateway: the same plain words, and a line in the log with no data.
  const realPassword = gateway.users.get(one.user.login).password;
  gateway.users.get(one.user.login).password = 'changed';
  logs.length = 0;
  await expectFail('The phone did not accept this text.');
  gateway.users.get(one.user.login).password = realPassword;
  assert.ok(logs.some((l) => /did not accept the credentials/.test(l)));
  assert.equal(rows('SELECT COUNT(*) AS n FROM text_sends WHERE account_id = ?', a.id)[0].n, 0);

  // No answer at all (nothing listens there): the client and the adapter say "not reachable".
  const dead = createGatewayClient({ apiUrl: 'http://127.0.0.1:9/api/3rdparty/v1', timeoutMs: 2000 });
  await assert.rejects(() => dead.devices({ login: 'x', password: 'y' }), (err) => err instanceof ProviderError && err.status === 0 && err.message === 'The phone gateway is not reachable.');
  const stubPool = { simByNumber: () => ({ deviceId: 'd', simNumber: 1 }), device: () => ({ login: 'x', password: 'y', gatewayId: 'g' }) };
  const lonely = createOwnPhoneProvider({ apiUrl: 'http://127.0.0.1:9/api/3rdparty/v1', textTtlSeconds: TTL }, { pool: stubPool, timeoutMs: 2000 });
  await assert.rejects(() => lonely.sendText({ from: '+14155550100', to, body: 'x' }), (err) => err instanceof ProviderError && err.message === 'The phone gateway is not reachable.');
  // A number whose SIM left the pool cannot send.
  const none = createOwnPhoneProvider({ apiUrl: gateway.url, textTtlSeconds: TTL }, { pool: { simByNumber: () => null, device: () => null } });
  await assert.rejects(() => none.sendText({ from: '+14155550100', to, body: 'x' }), (err) => err instanceof ProviderError && /not connected to a phone/.test(err.message));
  await assert.rejects(() => none.buy('+14155550100'), (err) => err instanceof ProviderError && err.unavailable === true);

  // After all that, a text goes out again.
  assert.equal((await sendText(a, num, to, 'leaves again ownphone-out-11')).status, 201);
  await a.api.del(`/api/numbers/${num.id}`);
});

test('no calls: a real phone is linked by text only; forwarding of texts works; every call function says no_voice', async () => {
  const a = await newAccount(app, { credits: 2000 });
  const num = await getNumber(a, one.numbers[0]);
  const real = realPhone();
  const via = { numberId: num.id, number: num.plain };

  // By call: refused, and nothing is charged.
  const byCall = await a.api.post('/api/phones', { number: real, via, method: 'call' });
  assert.equal(byCall.status, 409);
  assert.equal(byCall.data.error.code, 'no_voice');
  assert.deepEqual(ledger(a), ['number:-400', 'topup:2000']);
  // By text: the code goes out through the phone of the pool.
  const link = await a.api.post('/api/phones', { number: real, via });
  assert.equal(link.status, 201);
  const codeText = gateway.lastMessage(one.user.login).request;
  assert.deepEqual(codeText.phoneNumbers, [real]);
  const code = /code is (\d{6})\./.exec(codeText.textMessage.text)[1];
  const v = await a.api.post(`/api/phones/${link.data.phone.id}/verify`, { code });
  assert.equal(v.data.phone.verified, true);

  // Forwarding of texts on; forwarding of calls, voicemail and click-to-call are refused.
  assert.equal((await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: link.data.phone.id, forwardTexts: true })).status, 200);
  for (const [body, codeWanted] of [[{ forwardCalls: true }, 'no_voice'], [{ voicemail: true }, 'no_voice']]) {
    const res = await a.api.patch(`/api/numbers/${num.id}`, body);
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, codeWanted);
  }
  const call = await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to: outsider() });
  assert.equal(call.status, 409);
  assert.equal(call.data.error.code, 'no_voice');
  const n = await numberOf(a, num);
  assert.deepEqual([n.voice, n.forwardTexts, n.forwardCalls, n.voicemail], [false, true, false, false]);
  assert.deepEqual((await a.api.get(`/api/numbers/${num.id}/calls`)).data.calls, []);

  // An incoming text is stored for the account and a copy goes to the real phone, from the same number.
  const from = outsider();
  const mark = gateway.requests.length;
  await one.phone.receive({ from, text: remember('please forward own-in-16'), sim: 1 });
  const fwd = requestsSince(mark);
  assert.equal(fwd.length, 1);
  assert.deepEqual([fwd[0].body.phoneNumbers, fwd[0].body.textMessage.text, fwd[0].body.simNumber], [[real], `${from}: please forward own-in-16`, 1]);
  assert.deepEqual(ledger(a), ['text:-3', 'text:-3', 'number:-400', 'topup:2000']);
  // The copy fails at the phone: its charge comes back.
  await one.phone.report('failed', fwd[0].body.id);
  assert.deepEqual(ledger(a)[0], 'refund:3');
  // A text from the linked phone itself is not sent back to it.
  const mark2 = gateway.requests.length;
  await one.phone.receive({ from: real, text: remember('from my own phone own-in-17'), sim: 1 });
  assert.equal(requestsSince(mark2).length, 0);
  await a.api.del(`/api/numbers/${num.id}`);
});

test('tool: remove a SIM and a phone; --force takes the numbers away from accounts; a test text', async () => {
  const a = await newAccount(app, { credits: 2000 });
  const extra = await addPooledPhone('Leaving phone', 2);
  const num = await getNumber(a, extra.numbers[0]);
  await extra.phone.receive({ from: outsider(), text: remember('will be deleted own-in-18'), sim: 1 });
  await sendText(a, num, outsider(), 'waits for a report ownphone-out-12');
  const waiting = gateway.lastMessage(extra.user.login).id;
  const refused = (fn, pattern) => assert.rejects(fn, (err) => err instanceof ToolError && pattern.test(err.message));

  // A test text: through the gateway, with no account and no row.
  const before = rows('SELECT COUNT(*) AS n FROM texts')[0].n;
  const to = outsider();
  const t = await testText(ctx, { label: 'Leaving phone', to, simNumber: 2 });
  const sentTest = gateway.lastMessage(extra.user.login).request;
  assert.deepEqual([sentTest.id, sentTest.deviceId, sentTest.phoneNumbers, sentTest.simNumber, sentTest.textMessage.text, sentTest.ttl, sentTest.withDeliveryReport], [t.id, extra.device.id, [to], 2, 'Test text from Postern.', TTL, true]);
  assert.equal(rows('SELECT COUNT(*) AS n FROM texts')[0].n, before);
  assert.equal((await extra.phone.report('delivered', t.id)).status, 200);
  await refused(() => testText(ctx, { label: 'Leaving phone', to: '4155550100' }), /country code/);
  await refused(() => testText(ctx, { label: 'No such phone', to }), /No phone has the label/);
  await refused(() => testText(ctx, { label: 'Leaving phone', to, simNumber: 3 }), /no SIM 3/);

  // add-sim and remove-sim
  await refused(async () => addSim(ctx, { label: 'Leaving phone', simNumber: 2, number: poolNumber() }), /has a SIM 2 in the pool already/);
  await refused(async () => removeSim(ctx, { label: 'Leaving phone', simNumber: 3 }), /no SIM 3/);
  await refused(async () => removeSim(ctx, { label: 'Leaving phone', simNumber: 1 }), /An account uses this number\. Nothing was changed/);
  assert.equal((await numberOf(a, num)).id, num.id);
  assert.deepEqual(removeSim(ctx, { label: 'Leaving phone', simNumber: 2 }), { label: 'Leaving phone', simNumber: 2, number: maskNumber(extra.numbers[1]), takenBack: 0 });
  const third = poolNumber();
  assert.deepEqual(addSim(ctx, { label: 'leaving PHONE', simNumber: 3, number: third }), { label: 'Leaving phone', simNumber: 3, number: third, country: 'US', warnings: [] });
  assert.ok((await a.api.get('/api/numbers/search')).data.numbers.some((n) => n.number === third), 'the server does not see a SIM that the tool added');
  assert.ok(!(await a.api.get('/api/numbers/search')).data.numbers.some((n) => n.number === extra.numbers[1]));

  // The phone has a number in use: refused. With force the number and its texts leave the account.
  await refused(() => removePhone(ctx, { label: 'Leaving phone' }), /Accounts use 1 number\(s\) of this phone\. Nothing was changed/);
  assert.equal(rows('SELECT COUNT(*) AS n FROM own_devices WHERE gateway_id = ?', extra.device.id)[0].n, 1);
  const mark = gateway.requests.length;
  const gone = await removePhone(ctx, { label: 'Leaving phone', force: true });
  assert.deepEqual(gone, { label: 'Leaving phone', sims: 2, takenBack: 1, gatewayCleaned: true });
  assert.equal(requestsSince(mark).filter((r) => r.method === 'DELETE' && r.status === 204).length, 5);
  assert.equal(gateway.users.get(extra.user.login).webhooks.size, 0);
  assert.equal(await numberOf(a, num), undefined);
  assert.equal(rows('SELECT COUNT(*) AS n FROM texts WHERE number_id = ?', num.id)[0].n, 0);
  assert.equal(rows('SELECT COUNT(*) AS n FROM own_sims s JOIN own_devices d ON d.id = s.device_id WHERE d.gateway_id = ?', extra.device.id)[0].n, 0);
  // The text that waited for a report still gets its charge back when no report comes (the send row stayed).
  app.db.run('UPDATE text_sends SET at = ? WHERE account_id = ?', now() - (TTL + 601), a.id);
  await app.runJobs('ownphone-unsent');
  assert.deepEqual(ledger(a), ['refund:3', 'text:-3', 'number:-400', 'topup:2000']);
  // The old webhook address of the removed phone is gone.
  assert.equal((await fetch(app.url + new URL(extra.res.webhookUrl).pathname, { method: 'POST', body: '{}' })).status, 404);
  assert.ok(waiting);

  // The gateway is away when a phone is removed: the pool is cleaned anyway, and the tool says what is left.
  const lost = await addPooledPhone('Lost phone', 1);
  gateway.failIf = (r) => (r.method === 'DELETE' ? 502 : 0);
  try {
    assert.deepEqual(await removePhone(ctx, { label: 'Lost phone' }), { label: 'Lost phone', sims: 1, takenBack: 0, gatewayCleaned: false });
  } finally { gateway.failIf = null; }
  assert.ok(!listPhones(ctx).some((p) => p.label === 'Lost phone'));
  assert.ok(lost.res.id);
});

// Runs the real command-line tool in its own process, on the database of the running app.
function cli(args, { input = '', env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'server/tools/ownphone.js', ...args], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, DATA_DIR: app.config.dataDir, PHONE_PROVIDER: 'ownphone', OWNPHONE_API_URL: gateway.url, PUBLIC_URL: 'https://postern.example', PHONE_COUNTRIES: 'us,ca,gb', ...env },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.end(input);
  });
}

test('tool: the command line works in its own process, on the same database, and the server sees it with no restart', async () => {
  // help needs no database
  const help = await cli(['help']);
  assert.equal(help.code, 0);
  assert.ok(help.out.includes('OWNPHONE_PASSWORD') && help.out.includes('--password-stdin') && help.out.includes('--password <pass>'));
  assert.equal(help.out.trim(), HELP.trim());
  assert.equal((await cli([])).code, 2);
  assert.equal((await cli(['dance'])).code, 2);

  // add: the password comes from the standard input; PUBLIC_URL is https here, so no warning about it.
  const user = gateway.addUser({ devices: [{ name: 'CLI phone', sims: [1, 2] }] });
  remember(user.password);
  const n1 = poolNumber();
  const n2 = poolNumber();
  const added = await cli(['add', '--label', 'CLI phone', '--login', user.login, '--password-stdin', '--sim', `1=${n1}`], { input: user.password + '\n' });
  assert.equal(added.code, 0, added.out + added.err);
  assert.match(added.out, /Added the phone "CLI phone" with 1 SIM card\(s\):/);
  assert.ok(added.out.includes(`SIM 1: ${maskNumber(n1)} (US)`));
  assert.ok(!added.out.includes(n1), 'the tool printed a full number');
  assert.ok(!added.out.includes(user.password), 'the tool printed the password');
  assert.ok(!/Warning: PUBLIC_URL/.test(added.out));
  assert.match(added.out, /Check on the phone:/);
  const hooks = [...gateway.users.get(user.login).webhooks.values()];
  assert.equal(hooks.length, 5);
  assert.match(hooks[0].url, /^https:\/\/postern\.example\/api\/hooks\/ownphone\/[A-Za-z0-9_-]{43}$/);
  assert.ok(!added.out.includes(hooks[0].url.split('/').pop()), 'the tool printed the webhook token');
  remember(hooks[0].url.split('/').pop());
  remember(gateway.users.get(user.login).settings.webhooks.signing_key);
  assert.equal(gateway.users.get(user.login).settings.ping.interval_seconds, 300);

  // The running server sees the new phone at once: search, get, send, receive.
  const a = await newAccount(app, { credits: 2000 });
  const num = await getNumber(a, n1);
  assert.equal((await sendText(a, num, outsider(), 'through the CLI phone ownphone-out-13')).status, 201);
  const phone = gateway.phone(user.login, user.devices[0].id, app.url);
  assert.equal((await phone.receive({ from: outsider(), text: remember('to the CLI phone own-in-19'), sim: 1 })).status, 200);
  assert.equal((await texts(a, num)).length, 2);

  // add-sim, list, list --show
  const sim = await cli(['add-sim', '--label', 'CLI phone', `--sim=2=${n2}`]);
  assert.equal(sim.code, 0, sim.out + sim.err);
  assert.ok((await a.api.get('/api/numbers/search')).data.numbers.some((n) => n.number === n2));
  const list = await cli(['list']);
  assert.equal(list.code, 0);
  assert.match(list.out, /CLI phone {3}online, last seen a moment ago/);
  assert.match(list.out, /Kitchen-drawer-Pixel {3}/);
  assert.ok(list.out.includes(`SIM 1: ${maskNumber(n1)} (US)   in use`) && list.out.includes(`SIM 2: ${maskNumber(n2)} (US)   free`));
  for (const s of secrets) if (!labels.has(s)) assert.ok(!list.out.includes(s), 'the list shows something that it must hide');
  const shown = await cli(['list', '--show']);
  assert.ok(shown.out.includes(`SIM 1: ${n1} (US)   in use`));

  // wrong use: plain words and exit code 1; nothing changes
  const bad = await cli(['add', '--label', 'CLI phone', '--login', user.login, '--password', 'x', '--sim', `1=${poolNumber()}`]);
  assert.deepEqual([bad.code, bad.out.trim()], [1, 'Error: A phone with the label "CLI phone" is in the pool already. Choose a different label.']);
  const wrongPw = await cli(['add', '--label', 'Other', '--login', user.login, '--sim', `1=${poolNumber()}`], { env: { OWNPHONE_PASSWORD: 'wrong' } });
  assert.equal(wrongPw.code, 1);
  assert.match(wrongPw.out, /did not accept this login and password/);
  const inUse = await cli(['remove', '--label', 'CLI phone']);
  assert.equal(inUse.code, 1);
  assert.match(inUse.out, /Accounts use 1 number\(s\) of this phone/);
  const noSim = await cli(['remove-sim', '--label', 'CLI phone']);
  assert.equal(noSim.code, 1);

  // test, remove-sim, remove --force
  const tested = await cli(['test', '--label', 'CLI phone', '--to', outsider()]);
  assert.equal(tested.code, 0, tested.out + tested.err);
  assert.match(tested.out, /The gateway took the test text for SIM 1\./);
  assert.equal((await cli(['remove-sim', '--label', 'CLI phone', '--sim', '2'])).code, 0);
  const removed = await cli(['remove', '--label', 'CLI phone', '--force']);
  assert.equal(removed.code, 0, removed.out + removed.err);
  assert.match(removed.out, /1 number\(s\) were taken away from accounts/);
  assert.equal(await numberOf(a, num), undefined);
  assert.equal(gateway.users.get(user.login).webhooks.size, 0);

  // The functions behind the command line, in this process: the password from the environment.
  const lines = [];
  const user2 = gateway.addUser({ devices: [{ name: 'Env phone', sims: [1] }, { name: 'Env phone B', sims: [1] }] });
  remember(user2.password);
  const io = { env: { OWNPHONE_PASSWORD: user2.password }, out: (l) => lines.push(l), open: () => contextOf(app) };
  assert.equal(await runCli(['add', '--label', 'Env phone', '--login', user2.login, '--sim', `1=${poolNumber()}`], io), 2);
  assert.ok(lines.join('\n').includes('more than one phone') && lines.join('\n').includes(user2.devices[1].id));
  assert.equal(await runCli(['add', '--label', 'Env phone', '--login', user2.login, '--sim', `1=${poolNumber()}`, '--device-id', user2.devices[1].id], io), 0);
  assert.ok(lines.some((l) => /^Warning: PUBLIC_URL is http:\/\/localhost:8080/.test(l)));
  remember(gateway.users.get(user2.login).settings.webhooks.signing_key);
  remember([...gateway.users.get(user2.login).webhooks.values()][0].url.split('/').pop());
  assert.equal(await runCli(['remove', '--label', 'Env phone'], io), 0);
  assert.deepEqual(parseArgs(['--label', 'A b', '--sim', '1=+15551234567', '--sim=2=+15557654321', '--force']), { opts: { label: 'A b', force: true }, sims: ['1=+15551234567', '2=+15557654321'] });
  assert.throws(() => parseArgs(['label']), ToolError);
  assert.throws(() => parseArgs(['--label']), ToolError);
});

test('privacy: no pool number, password, login, signing key, webhook token, label or text is in the database files or in the log in plain form', async () => {
  // What the tests used must be in the list, or this test proves nothing.
  assert.ok(secrets.length > 60, `only ${secrets.length} values to look for`);
  assert.ok(secrets.includes(one.numbers[0]) && secrets.includes(one.user.password) && secrets.includes('Kitchen-drawer-Pixel'));
  assert.ok(rows('SELECT COUNT(*) AS n FROM own_sims')[0].n >= 3 && rows('SELECT COUNT(*) AS n FROM own_devices')[0].n >= 2);
  // Rows that hold data of this run exist (a number in use with texts), so the files are not empty of it.
  const a = await newAccount(app, { credits: 2000 });
  const num = await getNumber(a, one.numbers[0]);
  await one.phone.receive({ from: outsider(), text: remember('the last text own-in-20'), sim: 1 });
  await sendText(a, num, outsider(), 'the last answer ownphone-out-14');
  assert.equal((await texts(a, num)).length, 2);

  const files = ['accounts.db', 'accounts.db-wal', 'payments.db', 'payments.db-wal'].map((f) => join(app.config.dataDir, f)).filter((f) => existsSync(f));
  assert.ok(files.length >= 2);
  const bytes = Buffer.concat(files.map((f) => readFileSync(f)));
  assert.ok(bytes.length > 100_000);
  for (const s of new Set(secrets)) {
    assert.ok(s && s.length >= 6, `a value to look for is too short: ${s}`);
    assert.ok(!bytes.includes(Buffer.from(s, 'utf8')), `the database files hold a plain value (${s.slice(0, 4)}…, ${s.length} characters)`);
  }
  // The digits of a number without the plus sign are not there either.
  for (const n of [...one.numbers, ...two.numbers]) assert.ok(!bytes.includes(Buffer.from(n.slice(1), 'utf8')));
  // The log of the whole run.
  const log = logs.join('\n');
  for (const s of new Set(secrets)) assert.ok(!log.includes(s), 'the log holds a plain value');
  assert.ok(!/\+?\d{10,}/.test(log), 'the log holds something that looks like a phone number');
});
