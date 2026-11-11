// Payments with the mock provider: blind credit tokens from invoice to balance,
// and the separation of the payment data from the account data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestApp, client, newAccount, b64u, unb64u } from './helpers.js';
import { createApp } from '../server/app.js';
import * as blind from '../shared/blind.js';

let app;
let pay;
before(async () => {
  app = await startTestApp();
  pay = app.services.pay;
});
after(async () => { await app.stop(); });

const now = () => Math.floor(Date.now() / 1000);
const ledger = (acct, on = app) => on.store.ledger(acct.id).map((l) => `${l.kind}:${l.delta}`);
const invoiceRow = (id) => app.paydb.get('SELECT * FROM invoices WHERE id = ?', id);

// What a browser does before it asks for an invoice: make tokens and blind them.
async function makeTokens(key, units) {
  const out = [];
  for (let i = 0; i < units; i++) {
    const token = blind.newToken();
    out.push({ token, ...(await blind.blind(key, token)) });
  }
  return out;
}
const blindedOf = (tokens) => tokens.map((t) => b64u(t.blinded));
// What a browser does after the payment: remove the blinding from each signature.
async function unblindAll(key, tokens, signed) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    out.push({ token: b64u(tokens[i].token), sig: b64u(await blind.unblind(key, tokens[i].token, unb64u(signed[i]), tokens[i].r)) });
  }
  return out;
}
// The whole purchase without any cookie. Returns redeemable tokens.
async function purchase(units = 5, on = app) {
  const anon = client(on);
  const key = (await anon.get('/api/pay/info')).data.key;
  const tokens = await makeTokens(key, units);
  const made = await anon.post('/api/pay/invoices', { units, method: 'XMR-CHAIN', keyId: key.id, blinded: blindedOf(tokens) });
  assert.equal(made.status, 201);
  assert.equal((await anon.post('/api/dev/pay-invoice', { id: made.data.invoice.id })).status, 204);
  const paid = await anon.get(`/api/pay/invoices/${made.data.invoice.id}`);
  assert.equal(paid.data.invoice.status, 'paid');
  return { key, invoiceId: made.data.invoice.id, tokens: await unblindAll(key, tokens, paid.data.invoice.signed) };
}

test('info: public settings and the public key', async () => {
  const res = await client(app).get('/api/pay/info');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.data).sort(), ['enabled', 'key', 'maxUnits', 'methods', 'minUnits', 'provider', 'unitCredits']);
  assert.equal(res.data.enabled, true);
  assert.equal(res.data.provider, 'mock');
  assert.equal(res.data.unitCredits, 100);
  assert.equal(res.data.minUnits, 5);
  assert.equal(res.data.maxUnits, 200);
  assert.deepEqual(res.data.methods, [
    { id: 'BTC-LN', label: 'Bitcoin Lightning' },
    { id: 'XMR-CHAIN', label: 'Monero' },
    { id: 'BTC-CHAIN', label: 'Bitcoin on-chain' },
  ]);
  assert.deepEqual(Object.keys(res.data.key).sort(), ['e', 'id', 'n']);
  assert.equal(res.data.key.e, 65537);
  assert.equal(unb64u(res.data.key.n).length, 256);
  assert.equal(res.data.key.id, pay.signer.id);
  assert.ok(!res.headers.get('set-cookie'));
});

test('full flow: blind, invoice without cookie, pay, signed values, unblind, redeem, balance', async () => {
  const a = await newAccount(app);
  const anon = client(app);
  const key = (await anon.get('/api/pay/info')).data.key;
  const tokens = await makeTokens(key, 7);

  const made = await anon.post('/api/pay/invoices', { units: 7, method: 'BTC-LN', keyId: key.id, blinded: blindedOf(tokens) });
  assert.equal(made.status, 201);
  const inv = made.data.invoice;
  assert.deepEqual(Object.keys(inv).sort(), ['amountUsd', 'checkoutUrl', 'expiresAt', 'id', 'method', 'status', 'units']);
  assert.match(inv.id, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(inv.status, 'pending');
  assert.equal(inv.units, 7);
  assert.equal(inv.amountUsd, 7);
  assert.equal(inv.method, 'BTC-LN');
  assert.equal(inv.checkoutUrl, null);
  assert.ok(Math.abs(inv.expiresAt - (now() + 3600)) < 60);
  assert.ok(!made.headers.get('set-cookie'));
  assert.equal(anon.cookie, '');
  // The provider got an order for 7.00 USD.
  assert.deepEqual(pay.provider.created.at(-1), { id: inv.id, amountUsd: '7.00', method: 'BTC-LN', minutes: 60 });

  // Not paid: nothing is signed.
  const pending = await anon.get(`/api/pay/invoices/${inv.id}`);
  assert.equal(pending.status, 200);
  assert.deepEqual(pending.data.invoice, { ...inv, keyId: key.id, signed: null });
  assert.equal(invoiceRow(inv.id).signed, null);
  // settle() asks the provider and refuses.
  assert.equal(await pay.settle(inv.id), 'pending');
  assert.equal(invoiceRow(inv.id).signed, null);
  assert.equal(invoiceRow(inv.id).status, 'pending');

  // The customer pays.
  assert.equal((await anon.post('/api/dev/pay-invoice', { id: inv.id })).status, 204);
  const paid = await anon.get(`/api/pay/invoices/${inv.id}`);
  assert.equal(paid.data.invoice.status, 'paid');
  assert.equal(paid.data.invoice.keyId, key.id);
  assert.equal(paid.data.invoice.signed.length, 7);
  assert.ok(Math.abs(invoiceRow(inv.id).paid_at - now()) < 60);

  // settle() again changes nothing.
  const signedBefore = Buffer.from(invoiceRow(inv.id).signed);
  assert.equal(await pay.settle(inv.id), 'paid');
  assert.equal(await pay.settle(inv.id), 'paid');
  assert.deepEqual(Buffer.from(invoiceRow(inv.id).signed), signedBefore);

  // Unblind. The server never saw the token or the final signature.
  const ready = await unblindAll(key, tokens, paid.data.invoice.signed);
  for (let i = 0; i < 7; i++) {
    assert.notEqual(ready[i].sig, paid.data.invoice.signed[i]);
    assert.equal(await pay.signer.verify(tokens[i].token, unb64u(ready[i].sig)), true);
  }

  // Redeem needs a login.
  assert.equal((await anon.post('/api/billing/redeem', { keyId: key.id, tokens: ready })).status, 401);
  const redeemed = await a.api.post('/api/billing/redeem', { keyId: key.id, tokens: ready });
  assert.equal(redeemed.status, 200);
  assert.deepEqual(redeemed.data, { credited: 700, balance: 700 });
  assert.equal(app.store.balance(a.id), 700);

  // The ledger.
  const billing = await a.api.get('/api/billing');
  assert.equal(billing.status, 200);
  assert.equal(billing.data.balance, 700);
  assert.deepEqual(billing.data.prices, { mailboxMonth: 100, numberMonth: 400, textOut: 3, callMinute: 3 });
  assert.equal(billing.data.ledger.length, 1);
  assert.deepEqual({ ...billing.data.ledger[0] }, { delta: 700, kind: 'topup', day: new Date().toISOString().slice(0, 10) });
  assert.equal((await anon.get('/api/billing')).status, 401);

  // The spent table has hashes only.
  const spent = app.paydb.all('SELECT token_hash FROM spent');
  assert.ok(spent.length >= 7);
  for (const row of spent) assert.equal(row.token_hash.length, 32);
  for (const t of tokens) assert.ok(!spent.some((row) => Buffer.from(row.token_hash).equals(Buffer.from(t.token))));
});

test('redeem: a token works one time; a partly new set credits only the new tokens', async () => {
  const a = await newAccount(app);
  const { key, tokens } = await purchase(6);

  const first = await a.api.post('/api/billing/redeem', { keyId: key.id, tokens: tokens.slice(0, 2) });
  assert.deepEqual(first.data, { credited: 200, balance: 200 });

  // The same tokens again.
  const again = await a.api.post('/api/billing/redeem', { keyId: key.id, tokens: tokens.slice(0, 2) });
  assert.equal(again.status, 409);
  assert.equal(again.data.error.code, 'token_spent');
  assert.equal(app.store.balance(a.id), 200);

  // Two old tokens and two new ones.
  const mixed = await a.api.post('/api/billing/redeem', { keyId: key.id, tokens: tokens.slice(0, 4) });
  assert.equal(mixed.status, 200);
  assert.deepEqual(mixed.data, { credited: 200, balance: 400 });

  // The same token three times in one request counts one time.
  const triple = await a.api.post('/api/billing/redeem', { keyId: key.id, tokens: [tokens[4], tokens[4], tokens[4]] });
  assert.deepEqual(triple.data, { credited: 100, balance: 500 });

  // Two requests at the same moment with the same token: one of them wins.
  const race = await Promise.all([
    a.api.post('/api/billing/redeem', { keyId: key.id, tokens: [tokens[5]] }),
    a.api.post('/api/billing/redeem', { keyId: key.id, tokens: [tokens[5]] }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal(app.store.balance(a.id), 600);
  assert.deepEqual(ledger(a), ['topup:100', 'topup:100', 'topup:200', 'topup:200']);
});

test('redeem: a forged signature refuses the whole request and spends nothing', async () => {
  const a = await newAccount(app);
  const { key, tokens } = await purchase(5);
  const spentBefore = app.paydb.get('SELECT COUNT(*) AS n FROM spent').n;

  // A signature with one changed bit.
  const sig = unb64u(tokens[1].sig);
  sig[100] ^= 1;
  const forged = { token: tokens[1].token, sig: b64u(sig) };
  // A token that nobody paid for, with the signature of a different token.
  const swapped = { token: b64u(blind.newToken()), sig: tokens[2].sig };
  // The blind signature straight from the invoice is not a token signature.
  for (const bad of [forged, swapped]) {
    const res = await a.api.post('/api/billing/redeem', { keyId: key.id, tokens: [tokens[0], bad, tokens[3]] });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'bad_token');
  }
  assert.equal(app.store.balance(a.id), 0);
  assert.equal(app.paydb.get('SELECT COUNT(*) AS n FROM spent').n, spentBefore);

  // An unknown key.
  const unknownKey = await a.api.post('/api/billing/redeem', { keyId: '0'.repeat(16), tokens });
  assert.equal(unknownKey.status, 400);
  assert.equal(unknownKey.data.error.code, 'bad_token');

  // The good tokens of the refused requests are still good.
  const ok = await a.api.post('/api/billing/redeem', { keyId: key.id, tokens });
  assert.deepEqual(ok.data, { credited: 500, balance: 500 });
});

test('redeem: tokens are bearer values; a different account can redeem them', async () => {
  const a = await newAccount(app);
  const b = await newAccount(app);
  const { key, tokens } = await purchase(5);
  // B takes three tokens, A takes the rest. B's three cannot be used again by A.
  assert.deepEqual((await b.api.post('/api/billing/redeem', { keyId: key.id, tokens: tokens.slice(0, 3) })).data, { credited: 300, balance: 300 });
  assert.deepEqual((await a.api.post('/api/billing/redeem', { keyId: key.id, tokens })).data, { credited: 200, balance: 200 });
  assert.equal((await a.api.post('/api/billing/redeem', { keyId: key.id, tokens })).status, 409);
  assert.equal(app.store.balance(a.id), 200);
  assert.equal(app.store.balance(b.id), 300);
});

test('invoices: wrong sizes, wrong counts, and other bad input', async () => {
  const anon = client(app);
  const key = (await anon.get('/api/pay/info')).data.key;
  const tokens = await makeTokens(key, 5);
  const good = { units: 5, method: 'BTC-LN', keyId: key.id, blinded: blindedOf(tokens) };
  const rows = app.paydb.get('SELECT COUNT(*) AS n FROM invoices').n;
  const created = pay.provider.created.length;
  const n = Buffer.from(unb64u(key.n));
  const withFirst = (bytes) => [b64u(bytes), ...good.blinded.slice(1)];
  const nPlusOne = Buffer.from(n);
  nPlusOne[255] += 1; // n is odd, so this does not overflow

  const bad = [
    { ...good, units: 6 }, // units and the count of values differ
    { ...good, units: 4 },
    { ...good, blinded: good.blinded.slice(0, 4) },
    { ...good, blinded: [...good.blinded, good.blinded[0]] },
    { ...good, units: 4, blinded: good.blinded.slice(0, 4) }, // below the minimum
    { ...good, units: 201, blinded: Array(201).fill(good.blinded[0]) }, // above the maximum
    { ...good, units: 5.5 },
    { ...good, units: '5' },
    { ...good, method: 'DOGE' },
    { ...good, method: undefined },
    { ...good, keyId: '0'.repeat(16) },
    { ...good, keyId: undefined },
    { ...good, blinded: 'AAAA' },
    { ...good, blinded: withFirst(Buffer.alloc(255, 1)) }, // one byte too short
    { ...good, blinded: withFirst(Buffer.alloc(257, 1)) }, // one byte too long
    { ...good, blinded: withFirst(Buffer.alloc(0)) },
    { ...good, blinded: withFirst(n) }, // equal to the modulus
    { ...good, blinded: withFirst(nPlusOne) }, // above the modulus
    { ...good, blinded: withFirst(Buffer.alloc(256, 0xff)) },
    { ...good, blinded: ['not base64!', ...good.blinded.slice(1)] },
    { ...good, blinded: [12345, ...good.blinded.slice(1)] },
  ];
  for (const body of bad) {
    const res = await anon.post('/api/pay/invoices', body);
    assert.equal(res.status, 400, JSON.stringify(Object.keys(body)));
  }
  assert.equal(app.paydb.get('SELECT COUNT(*) AS n FROM invoices').n, rows);
  assert.equal(pay.provider.created.length, created);

  // The largest allowed purchase works and fits in the request limit.
  const big = await makeTokens(key, 200);
  const res = await anon.post('/api/pay/invoices', { units: 200, method: 'BTC-CHAIN', keyId: key.id, blinded: blindedOf(big) });
  assert.equal(res.status, 201);
  assert.equal(res.data.invoice.amountUsd, 200);
  assert.equal(invoiceRow(res.data.invoice.id).blinded.length, 200 * 256);

  // Unknown and malformed invoice IDs.
  assert.equal((await anon.get('/api/pay/invoices/' + 'A'.repeat(22))).status, 404);
  assert.equal((await anon.get('/api/pay/invoices/short')).status, 404);
  assert.equal((await anon.post('/api/dev/pay-invoice', { id: 'A'.repeat(22) })).status, 404);
  assert.equal((await anon.post('/api/dev/pay-invoice', {})).status, 400);
});

test('redeem: wrong sizes and bad input', async () => {
  const a = await newAccount(app);
  const { key, tokens } = await purchase(5);
  const t = tokens[0];
  const bad = [
    { keyId: key.id, tokens: [] },
    { keyId: key.id, tokens: 'x' },
    { keyId: key.id },
    { tokens: [t] },
    { keyId: key.id, tokens: Array(201).fill(t) },
    { keyId: key.id, tokens: [{ token: b64u(unb64u(t.token).subarray(0, 31)), sig: t.sig }] },
    { keyId: key.id, tokens: [{ token: t.token + 'AA', sig: t.sig }] },
    { keyId: key.id, tokens: [{ token: t.token, sig: b64u(unb64u(t.sig).subarray(0, 255)) }] },
    { keyId: key.id, tokens: [{ token: t.token, sig: t.sig + 'AA' }] },
    { keyId: key.id, tokens: [{ token: t.token }] },
    { keyId: key.id, tokens: [{ sig: t.sig }] },
    { keyId: key.id, tokens: [null] },
    { keyId: key.id, tokens: [t, 'x'] },
    { keyId: key.id, tokens: [{ token: t.token, sig: b64u(Buffer.alloc(256, 0xff)) }] }, // not below the modulus
    { keyId: key.id, tokens: [{ token: t.token, sig: b64u(Buffer.alloc(256)) }] },
  ];
  for (const body of bad) {
    const res = await a.api.post('/api/billing/redeem', body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    assert.ok(['bad_token', 'bad_request'].includes(res.data.error.code));
  }
  assert.equal(app.store.balance(a.id), 0);
  // 200 tokens in one request are allowed.
  const many = await purchase(200);
  const ok = await a.api.post('/api/billing/redeem', { keyId: many.key.id, tokens: many.tokens });
  assert.deepEqual(ok.data, { credited: 20000, balance: 20000 });
});

test('invoices: the provider is asked at most one time in 10 seconds for one reader', async () => {
  const anon = client(app);
  const key = (await anon.get('/api/pay/info')).data.key;
  const tokens = await makeTokens(key, 5);
  const id = (await anon.post('/api/pay/invoices', { units: 5, method: 'BTC-LN', keyId: key.id, blinded: blindedOf(tokens) })).data.invoice.id;
  const real = pay.provider.getStatus;
  let asked = 0;
  pay.provider.getStatus = async (ref) => { asked++; return real(ref); };
  try {
    for (let i = 0; i < 5; i++) assert.equal((await anon.get(`/api/pay/invoices/${id}`)).data.invoice.status, 'pending');
    assert.equal(asked, 1);
    // After 10 seconds the next read asks again.
    app.paydb.run('UPDATE invoices SET checked_at = ? WHERE id = ?', now() - 11, id);
    await anon.get(`/api/pay/invoices/${id}`);
    assert.equal(asked, 2);

    // The provider is down: the invoice can still be read.
    app.paydb.run('UPDATE invoices SET checked_at = NULL WHERE id = ?', id);
    pay.provider.getStatus = async () => { throw new Error('down'); };
    const res = await anon.get(`/api/pay/invoices/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.invoice.status, 'pending');
    await app.runJobs('pay-check');
    assert.equal(invoiceRow(id).status, 'pending');
  } finally {
    pay.provider.getStatus = real;
  }
  // The minute job finds the payment without any reader.
  pay.provider.markPaid(invoiceRow(id).provider_ref);
  assert.equal(invoiceRow(id).status, 'pending');
  await app.runJobs('pay-check');
  assert.equal(invoiceRow(id).status, 'paid');
  assert.equal(invoiceRow(id).signed.length, 5 * 256);
});

test('jobs: pending invoices expire, old invoices are deleted', async () => {
  const anon = client(app);
  const key = (await anon.get('/api/pay/info')).data.key;
  const create = async () => {
    const tokens = await makeTokens(key, 5);
    const res = await anon.post('/api/pay/invoices', { units: 5, method: 'BTC-LN', keyId: key.id, blinded: blindedOf(tokens) });
    return { id: res.data.invoice.id, tokens };
  };
  const expired = await create();
  const fresh = await create();
  const paidOld = await create();
  const paidNew = await create();
  await pay.markPaid(paidOld.id);
  await pay.markPaid(paidNew.id);

  // Not due: the job changes nothing.
  await app.runJobs('pay-check');
  assert.equal(invoiceRow(expired.id).status, 'pending');

  // Past its time: expired, and never signed.
  app.paydb.run('UPDATE invoices SET expires_at = ? WHERE id = ?', now() - 600, expired.id);
  await app.runJobs('pay-check');
  assert.equal(invoiceRow(expired.id).status, 'expired');
  assert.equal(invoiceRow(fresh.id).status, 'pending');
  const read = await anon.get(`/api/pay/invoices/${expired.id}`);
  assert.equal(read.data.invoice.status, 'expired');
  assert.equal(read.data.invoice.signed, null);

  // An invoice is also expired when a reader asks, without the job.
  const lazy = await create();
  app.paydb.run('UPDATE invoices SET expires_at = ? WHERE id = ?', now() - 600, lazy.id);
  assert.equal((await anon.get(`/api/pay/invoices/${lazy.id}`)).data.invoice.status, 'expired');

  // Purge: expired for less than a day stays, paid for less than 30 days stays.
  await app.runJobs('pay-purge');
  for (const inv of [expired, fresh, paidOld, paidNew, lazy]) assert.ok(invoiceRow(inv.id));

  app.paydb.run('UPDATE invoices SET expires_at = ? WHERE id = ?', now() - 86400 - 60, expired.id);
  app.paydb.run('UPDATE invoices SET paid_at = ? WHERE id = ?', now() - 30 * 86400 - 60, paidOld.id);
  app.paydb.run('UPDATE invoices SET paid_at = ? WHERE id = ?', now() - 29 * 86400, paidNew.id);
  await app.runJobs('pay-purge');
  assert.equal(invoiceRow(expired.id), undefined);
  assert.equal(invoiceRow(paidOld.id), undefined);
  assert.ok(invoiceRow(paidNew.id));
  assert.ok(invoiceRow(fresh.id));
  assert.ok(invoiceRow(lazy.id));
  assert.equal((await anon.get(`/api/pay/invoices/${expired.id}`)).status, 404);
  assert.equal((await anon.get(`/api/pay/invoices/${paidOld.id}`)).status, 404);

  // Tokens of a deleted invoice are still good: redeem does not need the invoice.
  const a = await newAccount(app);
  const paidRow = await anon.get(`/api/pay/invoices/${paidNew.id}`);
  const ready = await unblindAll(key, paidNew.tokens, paidRow.data.invoice.signed);
  app.paydb.run('DELETE FROM invoices WHERE id = ?', paidNew.id);
  assert.deepEqual((await a.api.post('/api/billing/redeem', { keyId: key.id, tokens: ready })).data, { credited: 500, balance: 500 });
});

test('redeem brings a suspended item back (renewal runs after the top-up)', async () => {
  const a = await newAccount(app);
  // A tiny renewable item that belongs to account A and is suspended for lack of credits.
  const item = { id: 'item-1', accountId: a.id, paidUntil: now() - 100, status: 'suspended' };
  app.renewables.register({
    kind: 'mailbox',
    price: () => 150,
    due: (t, accountId) => (item.paidUntil <= t && (!accountId || accountId === item.accountId) ? [{ ...item }] : []),
    renew: (id, paidUntil) => { item.paidUntil = paidUntil; item.status = 'active'; },
    suspend: () => { item.status = 'suspended'; },
  });
  await app.renewables.run(a.id);
  assert.equal(item.status, 'suspended');

  const { key, tokens } = await purchase(5);
  // One token is not enough for the item.
  const one = await a.api.post('/api/billing/redeem', { keyId: key.id, tokens: tokens.slice(0, 1) });
  assert.deepEqual(one.data, { credited: 100, balance: 100 });
  assert.equal(item.status, 'suspended');
  // One more is. The answer has the balance after the renewal.
  const two = await a.api.post('/api/billing/redeem', { keyId: key.id, tokens: tokens.slice(1, 2) });
  assert.deepEqual(two.data, { credited: 100, balance: 50 });
  assert.equal(item.status, 'active');
  assert.ok(item.paidUntil > now() + 29 * 86400);
  assert.deepEqual(ledger(a), ['mailbox:-150', 'topup:100', 'topup:100']);
  item.paidUntil = Number.MAX_SAFE_INTEGER; // other tests must not see this item as due
});

test('keys: the signing key survives a restart, old keys stay valid, the key is not stored in plain form', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'postern-pay-'));
  const opts = { dataDir, port: 0, host: '127.0.0.1', logLevel: 'silent', rateLimits: false, mail: { smtpPort: 0, smtpHost: '127.0.0.1', relayUrl: '' }, phone: { provider: 'off' }, pay: { provider: 'mock' } };
  try {
    let one = await createApp(opts, {});
    await one.start();
    const keyId = one.services.pay.signer.id;
    const first = await purchase(5, one);
    assert.equal(first.key.id, keyId);
    // A pending invoice from before the restart.
    const anon1 = client(one);
    const waiting = await makeTokens(first.key, 5);
    const pendingId = (await anon1.post('/api/pay/invoices', { units: 5, method: 'BTC-LN', keyId, blinded: blindedOf(waiting) })).data.invoice.id;
    await one.stop();

    // The private key is encrypted in the file.
    const bytes = Buffer.concat(['payments.db', 'payments.db-wal'].map((f) => join(dataDir, f)).filter(existsSync).map((f) => readFileSync(f)));
    assert.ok(bytes.includes(keyId));
    assert.ok(!bytes.includes('PRIVATE KEY'));
    assert.ok(!bytes.includes('MIIE'));

    const two = await createApp(opts, {});
    await two.start();
    try {
      assert.equal(two.services.pay.signer.id, keyId);
      assert.equal((await client(two).get('/api/pay/info')).data.key.n, first.key.n);
      assert.equal(two.paydb.get('SELECT COUNT(*) AS n FROM signing_keys').n, 1);
      const a = await newAccount(two);
      // Tokens from before the restart.
      assert.deepEqual((await a.api.post('/api/billing/redeem', { keyId, tokens: first.tokens })).data, { credited: 500, balance: 500 });
      // The invoice from before the restart can still be paid.
      assert.equal(await two.services.pay.markPaid(pendingId), true);
      const paid = await client(two).get(`/api/pay/invoices/${pendingId}`);
      const ready = await unblindAll(first.key, waiting, paid.data.invoice.signed);

      // A new key: new invoices must use it, and tokens of the old key are still good.
      const fresh = two.services.pay.rotateKey();
      assert.notEqual(fresh.id, keyId);
      const info = (await client(two).get('/api/pay/info')).data;
      assert.equal(info.key.id, fresh.id);
      assert.deepEqual(two.paydb.all('SELECT id, active FROM signing_keys ORDER BY rowid').map((r) => `${r.id}:${r.active}`), [`${keyId}:0`, `${fresh.id}:1`]);
      const stale = await client(two).post('/api/pay/invoices', { units: 5, method: 'BTC-LN', keyId, blinded: blindedOf(waiting) });
      assert.equal(stale.status, 400);
      assert.equal(stale.data.error.code, 'bad_key');
      assert.deepEqual((await a.api.post('/api/billing/redeem', { keyId, tokens: ready })).data, { credited: 500, balance: 1000 });
      // A signature of the old key is not valid for the new key.
      const cross = await a.api.post('/api/billing/redeem', { keyId: fresh.id, tokens: ready });
      assert.equal(cross.status, 400);
      const next = await purchase(5, two);
      assert.equal(next.key.id, fresh.id);
      assert.deepEqual((await a.api.post('/api/billing/redeem', { keyId: fresh.id, tokens: next.tokens })).data, { credited: 500, balance: 1500 });
    } finally {
      await two.stop();
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('provider off: info says so, invoices answer 503, billing and redeem still work', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'postern-pay-'));
  const opts = { dataDir, port: 0, host: '127.0.0.1', logLevel: 'silent', rateLimits: false, mail: { smtpPort: 0, smtpHost: '127.0.0.1', relayUrl: '' }, phone: { provider: 'off' } };
  try {
    // Buy tokens while payments are on.
    const on = await createApp({ ...opts, pay: { provider: 'mock' } }, {});
    await on.start();
    const bought = await purchase(5, on);
    await on.stop();

    const off = await createApp({ ...opts, pay: { provider: 'off' } }, {});
    await off.start();
    try {
      const anon = client(off);
      const info = await anon.get('/api/pay/info');
      assert.equal(info.status, 200);
      assert.equal(info.data.enabled, false);
      assert.equal(info.data.provider, 'off');
      assert.deepEqual(info.data.methods, []);
      assert.equal(info.data.unitCredits, 100);
      const res = await anon.post('/api/pay/invoices', { units: 5, method: 'BTC-LN', keyId: bought.key.id, blinded: [] });
      assert.equal(res.status, 503);
      assert.equal(res.data.error.code, 'pay_off');
      assert.equal((await anon.post('/api/dev/pay-invoice', { id: bought.invoiceId })).status, 404);
      assert.equal((await anon.post('/api/hooks/btcpay', {})).status, 404);
      // The old invoice is still readable. Nobody is asked about it.
      assert.equal((await anon.get(`/api/pay/invoices/${bought.invoiceId}`)).data.invoice.status, 'paid');
      await off.runJobs('pay-check');
      await off.runJobs('pay-purge');

      const a = await newAccount(off, { credits: 30 });
      const billing = await a.api.get('/api/billing');
      assert.equal(billing.status, 200);
      assert.equal(billing.data.balance, 30);
      assert.deepEqual(ledger(a, off), ['topup:30']);
      assert.deepEqual((await a.api.post('/api/billing/redeem', { keyId: bought.key.id, tokens: bought.tokens })).data, { credited: 500, balance: 530 });
    } finally {
      await off.stop();
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('separation: payments.db has no account ID, accounts.db has no invoice ID', async () => {
  // A full flow for one account, with a signed-in browser tab that also calls the payment routes.
  const a = await newAccount(app);
  const key = (await a.api.get('/api/pay/info')).data.key;
  const tokens = await makeTokens(key, 5);
  // The app sends these requests without the cookie. Even with the cookie nothing may be linked.
  const made = await a.api.post('/api/pay/invoices', { units: 5, method: 'BTC-LN', keyId: key.id, blinded: blindedOf(tokens) });
  assert.equal(made.status, 201);
  const invoiceId = made.data.invoice.id;
  assert.equal((await a.api.post('/api/dev/pay-invoice', { id: invoiceId })).status, 204);
  const paid = await a.api.get(`/api/pay/invoices/${invoiceId}`);
  const ready = await unblindAll(key, tokens, paid.data.invoice.signed);
  assert.deepEqual((await a.api.post('/api/billing/redeem', { keyId: key.id, tokens: ready })).data, { credited: 500, balance: 500 });
  // Things that a user stores in the account database around a purchase.
  app.store.vaultPut(a.id, 'pending-purchases', Buffer.from('encrypted in the browser'));
  const providerRef = invoiceRow(invoiceId).provider_ref;

  // Every value of every row of every table, as bytes.
  function dump(db) {
    const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
    const values = [];
    for (const table of tables) {
      for (const row of db.all(`SELECT * FROM "${table}"`)) {
        for (const [column, v] of Object.entries(row)) {
          if (v === null) continue;
          values.push({ table, column, bytes: v instanceof Uint8Array ? Buffer.from(v) : Buffer.from(String(v)) });
        }
      }
    }
    return { tables, values };
  }
  const holds = (values, needle) => values.filter((v) => v.bytes.includes(needle)).map((v) => `${v.table}.${v.column}`);

  const payDump = dump(app.paydb);
  assert.deepEqual(payDump.tables.sort(), ['invoices', 'signing_keys', 'spent']);
  assert.ok(payDump.values.length > 50);
  const accDump = dump(app.db);
  assert.ok(accDump.tables.includes('accounts'));
  assert.ok(accDump.tables.includes('ledger'));

  // The check can find things: each ID is in its own database.
  assert.deepEqual(holds(payDump.values, invoiceId), ['invoices.id']);
  assert.ok(holds(accDump.values, a.id).includes('accounts.id'));
  assert.ok(holds(accDump.values, a.id).includes('ledger.account_id'));

  // No account ID in the payment database: as text, as raw bytes, and as base64url.
  const idBytes = Buffer.from(a.id, 'hex');
  for (const needle of [a.id, a.id.toUpperCase(), idBytes, idBytes.toString('base64url'), idBytes.toString('base64')]) {
    assert.deepEqual(holds(payDump.values, needle), []);
  }
  // Nothing else of the account is there: no session, no public key, no token in plain form.
  for (const needle of [a.session.id, a.session.token, Buffer.from(a.upload.publicKey), ...tokens.map((t) => Buffer.from(t.token))]) {
    assert.deepEqual(holds(payDump.values, needle), []);
  }
  // No column of the payment database names an account.
  for (const table of payDump.tables) {
    for (const col of app.paydb.all(`SELECT name FROM pragma_table_info('${table}')`)) assert.doesNotMatch(col.name, /account|session|user/);
  }

  // No invoice ID in the account database, and no provider reference, key ID, or token hash.
  const invBytes = Buffer.from(invoiceId, 'base64url');
  for (const needle of [invoiceId, invBytes, invBytes.toString('hex'), providerRef, ...ready.map((t) => t.token), ...ready.map((t) => t.sig)]) {
    assert.deepEqual(holds(accDump.values, needle), []);
  }
  for (const row of app.paydb.all('SELECT token_hash FROM spent')) assert.deepEqual(holds(accDump.values, Buffer.from(row.token_hash)), []);
  for (const table of accDump.tables) {
    for (const col of app.db.all(`SELECT name FROM pragma_table_info('${table}')`)) assert.doesNotMatch(col.name, /invoice|payment|spent/);
  }
  // The ledger line of the top-up has an amount, a kind, and a day. Nothing more.
  const line = app.db.get('SELECT * FROM ledger WHERE account_id = ?', a.id);
  assert.deepEqual(Object.keys(line).sort(), ['account_id', 'day', 'delta', 'id', 'kind']);

  // The same on the level of the files.
  app.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  app.paydb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const read = (name) => Buffer.concat([name, name + '-wal'].map((f) => join(app.config.dataDir, f)).filter(existsSync).map((f) => readFileSync(f)));
  const payFile = read('payments.db');
  const accFile = read('accounts.db');
  assert.ok(payFile.includes(invoiceId));
  assert.ok(accFile.includes(a.id));
  assert.ok(!payFile.includes(a.id));
  assert.ok(!payFile.includes(idBytes));
  assert.ok(!accFile.includes(invoiceId));
  assert.ok(!accFile.includes(providerRef));
});
