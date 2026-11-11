// Payments (docs/API.md section 6).
//
// The design keeps payments and accounts apart:
// - The invoice routes do not use the login cookie. They never learn who pays.
// - The payment database (app.paydb) has no account IDs. The account database has no invoice IDs.
// - The browser pays for blinded credit tokens. The server signs them without seeing them.
//   When an account redeems a token, nobody can tell which invoice paid for it.
import { createSigner } from '../core/blindsign.js';
import { fail, reply, need, b64u } from '../core/http.js';
import { nowSec, today } from '../core/db.js';
import { randomId, sha256 } from '../core/keys.js';
import { createMockPay } from './providers/mock.js';
import { createBtcpay } from './providers/btcpay.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS signing_keys (
  id TEXT PRIMARY KEY,
  pem TEXT NOT NULL,            -- private key (PEM), encrypted with the server data key
  created_day TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,          -- 22 random characters: the only way to read the invoice
  provider TEXT NOT NULL,
  provider_ref TEXT NOT NULL,   -- invoice id at the provider
  units INTEGER NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'expired')),
  key_id TEXT NOT NULL,
  blinded BLOB NOT NULL,        -- units x blinded value, concatenated
  signed BLOB,                  -- units x signature on a blinded value, set when paid
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  paid_at INTEGER,
  checked_at INTEGER,           -- last question to the provider
  checkout_url TEXT
) STRICT;
-- One invoice of the provider pays for one invoice here, never for two.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_provider_ref ON invoices(provider, provider_ref);
CREATE INDEX IF NOT EXISTS invoices_status ON invoices(status);
CREATE TABLE IF NOT EXISTS spent (
  token_hash BLOB PRIMARY KEY   -- SHA-256(token). No time, no account.
) STRICT, WITHOUT ROWID;
`;

const TOKEN_BYTES = 32;
const MAX_REDEEM = 200;
const CHECK_SECONDS = 10; // a reader can make us ask the provider once in this time
const EXPIRY_MARGIN = 120; // our clock and the clock of the provider can differ
const PAID_KEEP = 30 * 86400;
const EXPIRED_KEEP = 86400;
const PEM_AAD = 'pay-signing-key';
const BAD_TOKEN = 'A credit token is not valid.';

export async function register(app) {
  const { config, paydb, http, store, keys, log } = app;
  paydb.exec(SCHEMA);

  const name = config.pay.provider;
  let provider = null;
  if (name === 'mock') provider = createMockPay();
  else if (name === 'btcpay') provider = createBtcpay(config.pay.btcpay, { publicUrl: config.publicUrl });
  else if (name !== 'off') throw new Error('PAY_PROVIDER must be mock, btcpay, or off');

  // ---- signing keys ----
  // The private key can make credits from nothing. It is encrypted in the database,
  // so that a copy of payments.db alone is not enough to use it.
  const lockPem = (pem) => 'v1:' + keys.srvEncrypt(pem, PEM_AAD).toString('base64');
  const openPem = (text) => (text.startsWith('v1:') ? keys.srvDecrypt(Buffer.from(text.slice(3), 'base64'), PEM_AAD).toString('utf8') : text);

  const signers = new Map(); // key id -> { id, signer, nBytes, len }. Old keys stay, so that old tokens can be redeemed.
  let active = null;
  function addSigner(signer) {
    const nBytes = Buffer.from(signer.publicKey.n, 'base64url');
    const entry = { id: signer.id, signer, nBytes, len: nBytes.length };
    signers.set(signer.id, entry);
    return entry;
  }
  // Makes a new key and uses it for new invoices. The first start calls this one time.
  function rotateKey() {
    const signer = createSigner();
    paydb.tx(() => {
      paydb.run('UPDATE signing_keys SET active = 0');
      paydb.run('INSERT INTO signing_keys (id, pem, created_day, active) VALUES (?,?,?,1)', signer.id, lockPem(signer.pem), today());
    });
    active = addSigner(signer);
    return signer;
  }
  for (const row of paydb.all('SELECT pem, active FROM signing_keys ORDER BY rowid')) {
    const entry = addSigner(createSigner(openPem(row.pem)));
    if (row.active) active = entry;
  }
  if (!active) rotateKey();

  // ---- invoices ----
  const getInvoice = (id) => paydb.get('SELECT * FROM invoices WHERE id = ?', id) || null;
  const split = (blob, len) => {
    const out = [];
    for (let i = 0; i + len <= blob.length; i += len) out.push(Buffer.from(blob.buffer, blob.byteOffset + i, len));
    return out;
  };
  function view(row, full) {
    const out = { id: row.id, status: row.status, units: row.units, amountUsd: row.units, method: row.method, checkoutUrl: row.checkout_url, expiresAt: row.expires_at };
    if (!full) return out;
    const key = signers.get(row.key_id);
    out.keyId = row.key_id;
    out.signed = row.status === 'paid' && row.signed && key ? split(row.signed, key.len).map(b64u) : null;
    return out;
  }
  const ours = (row) => Boolean(provider) && row.provider === provider.name;

  // The ONLY place that signs blinded values.
  // 1. The provider itself must say that the invoice is settled. A webhook or a caller is not enough.
  // 2. Sign every blinded value of the invoice.
  // 3. Store the signatures and the status 'paid' in one transaction.
  // It is safe to call this many times: a paid invoice is left alone.
  // Returns 'paid', or the state that the provider gave, or null.
  async function settle(invoiceId) {
    const row = getInvoice(invoiceId);
    if (!row || !ours(row)) return null;
    if (row.status === 'paid') return 'paid';
    const state = await provider.getStatus(row.provider_ref);
    if (state !== 'paid') return state;
    const key = signers.get(row.key_id);
    if (!key) throw new Error('the signing key of an invoice is missing');
    const signed = Buffer.concat(split(row.blinded, key.len).map((b) => key.signer.sign(b)));
    paydb.tx(() => {
      paydb.run("UPDATE invoices SET status = 'paid', signed = ?, paid_at = ? WHERE id = ? AND status <> 'paid'", signed, nowSec(), invoiceId);
    });
    return 'paid';
  }

  // Asks the provider about one invoice and updates our copy: settle it or expire it.
  async function refresh(invoiceId) {
    const row = getInvoice(invoiceId);
    if (!row || row.status === 'paid' || !ours(row)) return row;
    const now = nowSec();
    paydb.run('UPDATE invoices SET checked_at = ? WHERE id = ?', now, invoiceId);
    const state = await settle(invoiceId);
    // 'processing' never expires here: a payment is on its way and the provider decides.
    if (state === 'expired' || (state === 'pending' && now > row.expires_at + EXPIRY_MARGIN)) {
      paydb.run("UPDATE invoices SET status = 'expired' WHERE id = ? AND status = 'pending'", invoiceId);
    }
    return getInvoice(invoiceId);
  }

  let checking = false;
  async function checkPending() {
    if (!provider || checking) return;
    checking = true;
    try {
      const rows = paydb.all("SELECT id FROM invoices WHERE status = 'pending' AND provider = ? ORDER BY COALESCE(checked_at, 0) LIMIT 500", provider.name);
      let failed = 0;
      for (const r of rows) {
        try { await refresh(r.id); } catch { failed++; }
      }
      if (failed) log.warn(`the payment provider did not answer for ${failed} invoice(s)`);
    } finally {
      checking = false;
    }
  }

  function purge() {
    const now = nowSec();
    paydb.run("DELETE FROM invoices WHERE status = 'paid' AND paid_at < ?", now - PAID_KEEP);
    paydb.run("DELETE FROM invoices WHERE status = 'expired' AND expires_at < ?", now - EXPIRED_KEEP);
    // An invoice that no provider decided for a month will not be decided.
    paydb.run("DELETE FROM invoices WHERE status = 'pending' AND expires_at < ?", now - PAID_KEEP);
  }

  const requireOn = () => {
    if (!provider) throw fail(503, 'pay_off', 'Payments are not available on this server.');
  };

  // ---- routes without login. They have no auth option: the cookie is not even read. ----

  http.get('/api/pay/info', () => ({
    enabled: Boolean(provider),
    provider: provider ? provider.name : 'off',
    unitCredits: config.pay.unitCredits,
    minUnits: config.pay.minUnits,
    maxUnits: config.pay.maxUnits,
    methods: provider ? provider.methods : [],
    key: active.signer.publicKey,
  }));

  http.post('/api/pay/invoices', { rate: { max: 10, per: 3600 }, limit: 16 * 1024 + config.pay.maxUnits * 400 }, async (c) => {
    requireOn();
    const units = need.int(c.body.units, 'units', { min: config.pay.minUnits, max: config.pay.maxUnits });
    const method = need.string(c.body.method, 'method', { max: 40 });
    if (!provider.methods.some((m) => m.id === method)) throw fail(400, 'bad_request', 'This payment method is not available.');
    const key = active;
    if (need.string(c.body.keyId, 'keyId', { max: 64 }) !== key.id) throw fail(400, 'bad_key', 'The payment key changed. Load the page again, then try again.');
    const list = c.body.blinded;
    if (!Array.isArray(list) || list.length !== units) throw fail(400, 'bad_request', 'The count of tokens does not match the amount.');
    const blinded = list.map((v) => {
      const b = need.bytes(v, 'blinded', { min: key.len, max: key.len });
      // A value that is not below the modulus is not a valid RSA input.
      if (Buffer.compare(b, key.nBytes) >= 0) throw fail(400, 'bad_request', 'The value "blinded" is not valid.');
      return b;
    });

    const id = randomId();
    let made;
    try {
      made = await provider.createInvoice({ id, amountUsd: `${units}.00`, method, minutes: config.pay.invoiceMinutes });
    } catch (err) {
      log.error('the payment provider did not make an invoice', err);
      throw fail(502, 'provider_error', 'The payment provider is not available. Try again later.');
    }
    const now = nowSec();
    try {
      paydb.run(
        `INSERT INTO invoices (id, provider, provider_ref, units, method, status, key_id, blinded, created_at, expires_at, checkout_url)
         VALUES (?,?,?,?,?,'pending',?,?,?,?,?)`,
        id, provider.name, made.ref, units, method, key.id, Buffer.concat(blinded), now, now + config.pay.invoiceMinutes * 60, made.checkoutUrl ?? null,
      );
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err;
      // Two of our invoices must never share one invoice of the provider: one payment would sign both.
      log.error('the payment provider gave an invoice id that is in use already');
      throw fail(502, 'provider_error', 'The payment provider is not available. Try again later.');
    }
    return reply(201, { invoice: view(getInvoice(id), false) });
  });

  http.get('/api/pay/invoices/:id', async (c) => {
    let row = /^[A-Za-z0-9_-]{22}$/.test(c.params.id) ? getInvoice(c.params.id) : null;
    if (!row) throw fail(404, 'not_found', 'This invoice does not exist.');
    if (row.status === 'pending' && ours(row) && (!row.checked_at || nowSec() - row.checked_at >= CHECK_SECONDS)) {
      try { row = (await refresh(row.id)) || row; } catch { log.warn('the payment provider did not answer'); }
    }
    return { invoice: view(row, true) };
  });

  if (name === 'btcpay') {
    // The webhook only says "look at this invoice". The body is not trusted:
    // refresh() asks BTCPay itself before anything is signed.
    http.post('/api/hooks/btcpay', { body: 'raw' }, async (c) => {
      if (!provider.verifyWebhook(c.raw, c.headers['btcpay-sig'])) throw fail(403, 'bad_signature', 'The signature is not valid.');
      let event = null;
      try { event = JSON.parse(c.raw.toString('utf8')); } catch { event = null; }
      const ref = event && typeof event.invoiceId === 'string' ? event.invoiceId : '';
      const row = ref ? paydb.get("SELECT id FROM invoices WHERE provider = 'btcpay' AND provider_ref = ?", ref) : null;
      if (row) {
        // This also looks at an invoice that we expired: the provider can settle it late.
        try { await refresh(row.id); } catch { log.warn('the payment provider did not answer after a webhook'); }
      }
      return {};
    });
  }

  // ---- routes of the signed-in account ----

  http.post('/api/billing/redeem', { auth: true, rate: { max: 30, per: 60 }, limit: 160 * 1024 }, async (c) => {
    const accountId = c.account.id;
    const key = signers.get(need.string(c.body.keyId, 'keyId', { max: 64 }));
    const list = c.body.tokens;
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_REDEEM) throw fail(400, 'bad_request', `Send 1 to ${MAX_REDEEM} credit tokens.`);
    if (!key) throw fail(400, 'bad_token', BAD_TOKEN);
    const exact = (v, len) => {
      const b = typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v) ? Buffer.from(v, 'base64url') : null;
      if (!b || b.length !== len) throw fail(400, 'bad_token', BAD_TOKEN);
      return b;
    };
    // Check every signature first. One bad token refuses the whole request, and nothing is spent.
    const hashes = new Map(); // a token that is in the request two times counts one time
    for (const item of list) {
      if (!item || typeof item !== 'object') throw fail(400, 'bad_token', BAD_TOKEN);
      const token = exact(item.token, TOKEN_BYTES);
      const sig = exact(item.sig, key.len);
      if (!(await key.signer.verify(token, sig))) throw fail(400, 'bad_token', BAD_TOKEN);
      const hash = sha256(token);
      hashes.set(hash.toString('hex'), hash);
    }
    // One transaction marks the tokens as spent. A token that was spent before is skipped.
    const fresh = paydb.tx(() => [...hashes.values()].filter((h) => paydb.run('INSERT OR IGNORE INTO spent (token_hash) VALUES (?)', h).changes > 0));
    if (fresh.length === 0) throw fail(409, 'token_spent', 'These credits were used before.');
    const credited = fresh.length * config.pay.unitCredits;
    try {
      store.credit(accountId, credited, 'topup');
    } catch (err) {
      // The credits did not arrive. Free the tokens, so that the user can try again.
      paydb.tx(() => { for (const h of fresh) paydb.run('DELETE FROM spent WHERE token_hash = ?', h); });
      throw err;
    }
    // New credits can bring suspended items back.
    await app.renewables.run(accountId);
    app.events.publish(accountId, 'balance');
    return { credited, balance: store.balance(accountId) };
  });

  http.get('/api/billing', { auth: true }, (c) => ({
    balance: store.balance(c.account.id),
    prices: config.prices,
    ledger: store.ledger(c.account.id),
  }));

  // ---- service, jobs, development ----

  const service = {
    get signer() { return active.signer; },
    provider,
    settle,
    refresh,
    checkPending,
    purge,
    rotateKey,
    // Mock provider only: the simulated customer pays the invoice. False if there is no such invoice.
    async markPaid(invoiceId) {
      const row = typeof invoiceId === 'string' ? getInvoice(invoiceId) : null;
      if (!row || name !== 'mock' || row.provider !== 'mock') return false;
      provider.markPaid(row.provider_ref);
      await settle(row.id);
      return true;
    },
  };
  app.services.pay = service;

  app.every('pay-check', 60, checkPending);
  app.every('pay-purge', 3600, async () => purge());

  if (config.dev && name === 'mock') {
    http.post('/api/dev/pay-invoice', async (c) => {
      const ok = await service.markPaid(need.string(c.body.id, 'id', { max: 64 }));
      if (!ok) throw fail(404, 'not_found', 'This invoice does not exist.');
    });
  }
}
