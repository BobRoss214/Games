// BTCPay adapter against a local fake BTCPay Server. No internet is used.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { startTestApp, client, newAccount, b64u, unb64u } from './helpers.js';
import * as blind from '../shared/blind.js';
import { createBtcpay, btcpaySignature } from '../server/pay/providers/btcpay.js';

const API_KEY = 'btcpay-api-key-7d1e';
const STORE = 'Store1AbCdEf';
const SECRET = 'webhook-secret-93aa';
const PUBLIC = 'http://localhost:8080';
const INVOICES = `/api/v1/stores/${STORE}/invoices`;

// A small BTCPay Server: makes invoices and shows their state.
function startFakeBtcpay() {
  const requests = [];
  const states = new Map(); // BTCPay invoice id -> state
  const orders = new Map(); // BTCPay invoice id -> { amount, currency } as BTCPay reports them
  const fake = { requests, states, orders, down: false, nextLink: undefined };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url, 'http://fake');
      let json = null;
      try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
      requests.push({ method: req.method, path: url.pathname, headers: req.headers, raw, json });
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (fake.down) return send(503, { message: 'down' });
      if (req.headers.authorization !== `token ${API_KEY}`) return send(401, { code: 'unauthenticated' });
      if (req.method === 'POST' && url.pathname === INVOICES) {
        const id = 'BP' + randomBytes(10).toString('hex');
        states.set(id, 'New');
        orders.set(id, { amount: json.amount, currency: json.currency });
        const checkoutLink = fake.nextLink === undefined ? `${fake.url}/i/${id}` : fake.nextLink;
        fake.nextLink = undefined;
        return send(200, { id, storeId: STORE, amount: json.amount, currency: json.currency, checkoutLink, status: 'New', additionalStatus: 'None', metadata: json.metadata });
      }
      if (req.method === 'GET' && url.pathname.startsWith(INVOICES + '/')) {
        const id = decodeURIComponent(url.pathname.slice(INVOICES.length + 1));
        if (!states.has(id)) return send(404, { code: 'invoice-not-found' });
        return send(200, { id, storeId: STORE, status: states.get(id), additionalStatus: 'None', ...orders.get(id) });
      }
      return send(404, { code: 'not-found' });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      fake.url = `http://127.0.0.1:${server.address().port}`;
      fake.last = () => requests.at(-1);
      fake.close = () => new Promise((done) => { server.closeAllConnections(); server.close(done); });
      resolve(fake);
    });
  });
}

let fake;
let app;
let key;
before(async () => {
  fake = await startFakeBtcpay();
  app = await startTestApp({
    pay: { provider: 'btcpay', btcpay: { url: fake.url + '/', apiKey: API_KEY, storeId: STORE, webhookSecret: SECRET, methods: ['BTC-LN', 'XMR-CHAIN', 'LTC-CHAIN'] } },
  });
  key = (await client(app).get('/api/pay/info')).data.key;
});
after(async () => {
  await app.stop();
  await fake.close();
});

const now = () => Math.floor(Date.now() / 1000);
const row = (id) => app.paydb.get('SELECT * FROM invoices WHERE id = ?', id);
const read = async (id) => (await client(app).get(`/api/pay/invoices/${id}`)).data.invoice;

async function createInvoice(units = 5, method = 'BTC-LN') {
  const tokens = [];
  for (let i = 0; i < units; i++) {
    const token = blind.newToken();
    tokens.push({ token, ...(await blind.blind(key, token)) });
  }
  const res = await client(app).post('/api/pay/invoices', { units, method, keyId: key.id, blinded: tokens.map((t) => b64u(t.blinded)) });
  return { res, tokens, id: res.data.invoice && res.data.invoice.id, ref: res.data.invoice && row(res.data.invoice.id).provider_ref };
}

// A webhook delivery as BTCPay sends it. sig: undefined = valid, null = no header.
function webhook(body, sig) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = { 'content-type': 'application/json' };
  const value = sig === undefined ? 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex') : sig;
  if (value !== null) headers['btcpay-sig'] = value;
  return client(app).call('POST', '/api/hooks/btcpay', raw, headers);
}
const settledEvent = (ref) => ({ deliveryId: 'D1', webhookId: 'W1', isRedelivery: false, type: 'InvoiceSettled', timestamp: now(), storeId: STORE, invoiceId: ref, manuallyMarked: false });

test('signature: a hand-computed vector', () => {
  // printf '%s' '{"type":"InvoiceSettled","invoiceId":"abc"}' | openssl dgst -sha256 -hmac 'whsec_test' -hex
  const body = '{"type":"InvoiceSettled","invoiceId":"abc"}';
  assert.equal(btcpaySignature('whsec_test', Buffer.from(body)), 'sha256=955e602726c5b0989f80697929b609d6da4afa1d635a332e74db0358090ca17a');
  assert.throws(() => createBtcpay({ url: fake.url, apiKey: '', storeId: STORE, webhookSecret: SECRET }, { publicUrl: PUBLIC }), /BTCPAY_/);
  assert.throws(() => createBtcpay({ url: fake.url, apiKey: API_KEY, storeId: STORE, webhookSecret: '' }, { publicUrl: PUBLIC }), /BTCPAY_/);
});

test('info: only the configured methods, with labels', async () => {
  const info = (await client(app).get('/api/pay/info')).data;
  assert.equal(info.enabled, true);
  assert.equal(info.provider, 'btcpay');
  // An ID with no known label uses the ID as its label.
  assert.deepEqual(info.methods, [{ id: 'BTC-LN', label: 'Bitcoin Lightning' }, { id: 'XMR-CHAIN', label: 'Monero' }, { id: 'LTC-CHAIN', label: 'LTC-CHAIN' }]);
  // The development route of the mock provider does not exist here.
  assert.equal((await client(app).post('/api/dev/pay-invoice', { id: 'x' })).status, 404);
  assert.equal(await app.services.pay.markPaid('x'), false);
});

test('create: request path, auth header, and JSON body', async () => {
  const count = fake.requests.length;
  const { res, id, ref } = await createInvoice(12, 'XMR-CHAIN');
  assert.equal(res.status, 201);
  assert.equal(fake.requests.length, count + 1);
  const req = fake.last();
  assert.equal(req.method, 'POST');
  assert.equal(req.path, `/api/v1/stores/${STORE}/invoices`);
  assert.equal(req.headers.authorization, `token ${API_KEY}`);
  assert.equal(req.headers['content-type'], 'application/json');
  assert.deepEqual(req.json, {
    amount: '12.00',
    currency: 'USD',
    metadata: { orderId: id },
    checkout: { paymentMethods: ['XMR-CHAIN'], expirationMinutes: 60, redirectURL: `${PUBLIC}/funds` },
  });
  // No cookie and no account data go to BTCPay.
  assert.equal(req.headers.cookie, undefined);

  assert.match(ref, /^BP[0-9a-f]{20}$/);
  assert.deepEqual(res.data.invoice, { id, status: 'pending', units: 12, amountUsd: 12, method: 'XMR-CHAIN', checkoutUrl: `${fake.url}/i/${ref}`, expiresAt: res.data.invoice.expiresAt });
  assert.equal(row(id).provider, 'btcpay');

  // A method that is not configured is refused before BTCPay is asked.
  const before = fake.requests.length;
  assert.equal((await createInvoice(5, 'BTC-CHAIN')).res.status, 400);
  assert.equal(fake.requests.length, before);

  // Reading the invoice asks BTCPay for the state.
  const inv = await read(id);
  assert.equal(inv.status, 'pending');
  assert.equal(inv.signed, null);
  assert.equal(fake.last().method, 'GET');
  assert.equal(fake.last().path, `/api/v1/stores/${STORE}/invoices/${ref}`);
  assert.equal(fake.last().headers.authorization, `token ${API_KEY}`);

  // A payment link that is not a web address does not reach the browser.
  fake.nextLink = 'javascript:alert(1)';
  assert.equal((await createInvoice()).res.data.invoice.checkoutUrl, null);
  fake.nextLink = null;
  assert.equal((await createInvoice()).res.data.invoice.checkoutUrl, null);
});

test('webhook: a bad signature is refused with 403 and changes nothing', async () => {
  const { id, ref } = await createInvoice();
  // BTCPay really has the money. Only the webhook is forged.
  fake.states.set(ref, 'Settled');
  const event = settledEvent(ref);
  const raw = JSON.stringify(event);
  const count = fake.requests.length;
  const bad = [
    'sha256=' + createHmac('sha256', 'wrong-secret').update(raw).digest('hex'),
    'sha256=' + createHmac('sha256', SECRET).update(raw + ' ').digest('hex'),
    createHmac('sha256', SECRET).update(raw).digest('hex'), // no "sha256=" prefix
    'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex').toUpperCase(),
    'sha256=',
    '',
    null,
  ];
  for (const sig of bad) {
    const res = await webhook(event, sig);
    assert.equal(res.status, 403);
    assert.equal(res.data.error.code, 'bad_signature');
  }
  // BTCPay was not asked, and nothing was signed.
  assert.equal(fake.requests.length, count);
  assert.equal(row(id).status, 'pending');
  assert.equal(row(id).signed, null);
});

test('webhook: "settled" in the body is not trusted while BTCPay says New or Processing', async () => {
  const { id, ref } = await createInvoice();
  for (const state of ['New', 'Processing']) {
    fake.states.set(ref, state);
    const count = fake.requests.length;
    const res = await webhook(settledEvent(ref));
    assert.equal(res.status, 200);
    // The server asked BTCPay itself.
    assert.equal(fake.requests.length, count + 1);
    assert.equal(fake.last().method, 'GET');
    assert.equal(fake.last().path, `${INVOICES}/${ref}`);
    assert.equal(row(id).status, 'pending');
    assert.equal(row(id).signed, null);
    assert.equal((await read(id)).signed, null);
  }
  // settle() directly: the same answer.
  assert.equal(await app.services.pay.settle(id), 'processing');
  assert.equal(row(id).signed, null);

  // A valid delivery for an invoice that we do not have, and a body that is not JSON.
  assert.equal((await webhook(settledEvent('BPunknown'))).status, 200);
  assert.equal((await webhook('not json')).status, 200);
  assert.equal((await webhook({ type: 'InvoiceSettled' })).status, 200);
  assert.equal(row(id).status, 'pending');
});

test('webhook: a settled invoice is signed, and the tokens redeem', async () => {
  const { id, ref, tokens } = await createInvoice(6);
  fake.states.set(ref, 'Settled');
  // Any signed event makes the server look. The type in the body does not matter.
  const res = await webhook({ ...settledEvent(ref), type: 'InvoiceReceivedPayment' });
  assert.equal(res.status, 200);
  assert.equal(row(id).status, 'paid');
  const inv = await read(id);
  assert.equal(inv.status, 'paid');
  assert.equal(inv.signed.length, 6);

  // A second delivery changes nothing.
  const signed = Buffer.from(row(id).signed);
  const paidAt = row(id).paid_at;
  assert.equal((await webhook({ ...settledEvent(ref), isRedelivery: true })).status, 200);
  assert.deepEqual(Buffer.from(row(id).signed), signed);
  assert.equal(row(id).paid_at, paidAt);

  const ready = [];
  for (let i = 0; i < tokens.length; i++) ready.push({ token: b64u(tokens[i].token), sig: b64u(await blind.unblind(key, tokens[i].token, unb64u(inv.signed[i]), tokens[i].r)) });
  const a = await newAccount(app);
  assert.deepEqual((await a.api.post('/api/billing/redeem', { keyId: key.id, tokens: ready })).data, { credited: 600, balance: 600 });
});

test('no webhook: the reader and the minute job find the payment', async () => {
  const one = await createInvoice();
  const two = await createInvoice();
  fake.states.set(one.ref, 'Settled');
  fake.states.set(two.ref, 'Settled');
  assert.equal((await read(one.id)).status, 'paid');
  assert.equal(row(two.id).status, 'pending');
  await app.runJobs('pay-check');
  assert.equal(row(two.id).status, 'paid');
  assert.equal(row(two.id).signed.length, 5 * 256);
});

test('expiry: BTCPay decides; a late settlement is still honoured', async () => {
  const expired = await createInvoice();
  const invalid = await createInvoice();
  const processing = await createInvoice();
  const gone = await createInvoice();
  const slow = await createInvoice();
  fake.states.set(expired.ref, 'Expired');
  fake.states.set(invalid.ref, 'Invalid');
  fake.states.set(processing.ref, 'Processing');
  fake.states.delete(gone.ref);
  // Our time is over for these two, but BTCPay sees a payment that is on its way for one of them.
  app.paydb.run('UPDATE invoices SET expires_at = ? WHERE id IN (?, ?)', now() - 600, processing.id, slow.id);

  await app.runJobs('pay-check');
  assert.equal(row(expired.id).status, 'expired');
  assert.equal(row(invalid.id).status, 'expired');
  assert.equal(row(gone.id).status, 'expired');
  assert.equal(row(processing.id).status, 'pending');
  assert.equal(row(slow.id).status, 'expired');
  for (const inv of [expired, invalid, gone, slow]) assert.equal(row(inv.id).signed, null);

  // The payment that was on its way arrives.
  fake.states.set(processing.ref, 'Settled');
  await app.runJobs('pay-check');
  assert.equal(row(processing.id).status, 'paid');

  // An expired invoice is not asked about again by a reader.
  const count = fake.requests.length;
  assert.equal((await read(expired.id)).status, 'expired');
  assert.equal(fake.requests.length, count);

  // The shop owner marks an expired invoice as settled in BTCPay. The webhook brings it back.
  fake.states.set(expired.ref, 'Settled');
  assert.equal((await webhook(settledEvent(expired.ref))).status, 200);
  assert.equal(row(expired.id).status, 'paid');
  assert.equal((await read(expired.id)).signed.length, 5);
});

test('BTCPay is down or refuses the key: plain errors, nothing is signed', async () => {
  const { id, ref } = await createInvoice();
  fake.down = true;
  try {
    const res = (await createInvoice()).res;
    assert.equal(res.status, 502);
    assert.deepEqual(res.data.error, { code: 'provider_error', message: 'The payment provider is not available. Try again later.' });
    // The invoice can be read, the webhook is accepted, the job does not crash.
    assert.equal((await read(id)).status, 'pending');
    assert.equal((await webhook(settledEvent(ref))).status, 200);
    await app.runJobs('pay-check');
    assert.equal(row(id).status, 'pending');
    assert.equal(row(id).signed, null);
  } finally {
    fake.down = false;
  }
  // A wrong API key.
  const wrong = createBtcpay({ url: fake.url, apiKey: 'wrong', storeId: STORE, webhookSecret: SECRET, methods: ['BTC-LN'] }, { publicUrl: PUBLIC });
  await assert.rejects(wrong.createInvoice({ id: 'x', amountUsd: '5.00', method: 'BTC-LN', minutes: 60 }), /status 401/);
  await assert.rejects(wrong.getStatus(ref), /status 401/);
  // An unknown state is never "paid".
  fake.states.set(ref, 'SomethingNew');
  assert.deepEqual(await app.services.pay.provider.getStatus(ref), { state: 'pending', amount: '5.00', currency: 'USD' });
  fake.states.set(ref, 'constructor');
  assert.equal((await app.services.pay.provider.getStatus(ref)).state, 'pending');
  const dead = createBtcpay({ url: 'http://127.0.0.1:1', apiKey: API_KEY, storeId: STORE, webhookSecret: SECRET }, { publicUrl: PUBLIC });
  await assert.rejects(dead.getStatus(ref), /did not answer/);
});

test('settle: the amount and the currency at BTCPay must be what we asked for', async () => {
  const warnings = [];
  const realWarn = app.log.warn;
  app.log.warn = (message) => warnings.push(message);
  try {
    const wrong = [
      { amount: '1.00', currency: 'USD' }, // a cheaper invoice
      { amount: '4.99', currency: 'USD' },
      { amount: '5.01', currency: 'USD' },
      { amount: '50.00', currency: 'USD' },
      { amount: '5.00', currency: 'EUR' }, // the right figure in a different currency
      { amount: '5.00', currency: 'BTC' },
      { amount: '5.00' }, // no currency in the answer
      { currency: 'USD' }, // no amount in the answer
      { amount: 'five', currency: 'USD' },
      { amount: '5e0', currency: 'USD' },
      { amount: '-5.00', currency: 'USD' },
      {},
    ];
    const { id, ref, tokens } = await createInvoice(5);
    fake.states.set(ref, 'Settled');
    for (const order of wrong) {
      fake.orders.set(ref, order);
      // Every way to settle: the webhook, the function itself, a reader, the minute job.
      assert.equal((await webhook(settledEvent(ref))).status, 200);
      assert.equal(await app.services.pay.settle(id), 'mismatch');
      app.paydb.run('UPDATE invoices SET checked_at = NULL WHERE id = ?', id);
      assert.equal((await read(id)).status, 'pending');
      await app.runJobs('pay-check');
      // Nothing is signed and nothing is marked.
      const r = row(id);
      assert.equal(r.status, 'pending', JSON.stringify(order));
      assert.equal(r.signed, null);
      assert.equal(r.paid_at, null);
    }
    // One warning for this invoice, with the invoice id and nothing else that identifies anyone.
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes(id));
    assert.match(warnings[0], /different amount or currency/);
    assert.ok(!warnings[0].includes(ref));

    // The same invoice with the right amount is signed. BTCPay can write the amount in more than one way.
    fake.orders.set(ref, { amount: '5.00', currency: 'USD' });
    assert.equal(await app.services.pay.settle(id), 'paid');
    assert.equal(row(id).status, 'paid');
    assert.equal((await read(id)).signed.length, 5);
    assert.equal(tokens.length, 5);
    for (const order of [{ amount: '6', currency: 'USD' }, { amount: 6, currency: 'usd' }, { amount: '6.0000', currency: 'USD' }]) {
      const next = await createInvoice(6);
      fake.states.set(next.ref, 'Settled');
      fake.orders.set(next.ref, order);
      assert.equal(await app.services.pay.settle(next.id), 'paid', JSON.stringify(order));
    }
    assert.equal(warnings.length, 1);
  } finally {
    app.log.warn = realWarn;
  }
});
