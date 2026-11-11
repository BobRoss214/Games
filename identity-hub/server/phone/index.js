// Phone module: VoIP numbers, texts, calls, and linked real phones (docs/API.md section 5).
//
// Privacy rules of this module:
// - A VoIP number is never stored in plain form. The database has HMAC(number) for
//   lookup and a copy that is sealed to the account. Only the browser can open it.
// - A real phone number is stored with server encryption, because the server must
//   read it to forward calls and texts.
// - Texts and call peers are sealed to the account as soon as they arrive.
// - Nothing here writes a number or a message text to the log.
import { fail } from '../core/http.js';
import { nowSec } from '../core/db.js';
import { safeEqual } from '../core/keys.js';
import { createMockProvider } from './providers/mock.js';
import { createTwilioProvider } from './providers/twilio.js';
import { ProviderError } from './providers/errors.js';
import { createHooks } from './hooks.js';
import { registerRoutes } from './routes.js';
import { registerDevRoutes } from './dev.js';
import { E164 } from './common.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS phones (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  number_hmac BLOB NOT NULL,          -- keys.indexHmac('phone', number): finds a phone that is linked already
  number_srv BLOB NOT NULL,           -- keys.srvEncrypt(number, 'phone'): the server reads it to forward
  sealed_number BLOB NOT NULL,        -- copy for display, sealed to the account
  enc BLOB,                           -- label, encrypted in the browser
  verified INTEGER NOT NULL DEFAULT 0,
  code_hash BLOB,                     -- SHA-256("<phone id>:<code>")
  code_expires INTEGER,
  code_tries INTEGER NOT NULL DEFAULT 0,
  created_day TEXT NOT NULL,
  UNIQUE (account_id, number_hmac)
) STRICT;
CREATE TABLE IF NOT EXISTS numbers (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  number_hmac BLOB NOT NULL UNIQUE,   -- keys.indexHmac('num', number)
  sealed_number BLOB NOT NULL,        -- { number }, sealed to the account
  provider_ref BLOB NOT NULL,         -- keys.srvEncrypt(ref, 'ref')
  country TEXT NOT NULL,
  sms INTEGER NOT NULL,
  voice INTEGER NOT NULL,
  enc BLOB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  paid_until INTEGER NOT NULL,
  forward_phone_id TEXT,
  forward_texts INTEGER NOT NULL DEFAULT 0,
  forward_calls INTEGER NOT NULL DEFAULT 0,
  created_day TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS numbers_account ON numbers(account_id);
CREATE INDEX IF NOT EXISTS numbers_due ON numbers(paid_until);
CREATE TABLE IF NOT EXISTS texts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  number_id TEXT NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  sealed BLOB NOT NULL,               -- { peer, body }, sealed to the account
  msg_hmac BLOB                       -- incoming only: HMAC of the provider's message id
) STRICT;
CREATE INDEX IF NOT EXISTS texts_number ON texts(number_id, at);
CREATE INDEX IF NOT EXISTS texts_account ON texts(account_id);
-- A provider can deliver one webhook two times. The second copy must not be stored or forwarded again.
CREATE UNIQUE INDEX IF NOT EXISTS texts_msg ON texts(msg_hmac) WHERE msg_hmac IS NOT NULL;
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  number_id TEXT NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  at INTEGER NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('answered', 'missed', 'failed')),
  sealed BLOB NOT NULL,               -- { peer }, sealed to the account
  call_hmac BLOB                      -- keys.indexHmac('call', call id of the provider)
) STRICT;
CREATE INDEX IF NOT EXISTS calls_number ON calls(number_id, at);
CREATE INDEX IF NOT EXISTS calls_account ON calls(account_id);
-- One call has one line in the log, also when the provider reports it two times.
CREATE UNIQUE INDEX IF NOT EXISTS calls_call ON calls(call_hmac) WHERE call_hmac IS NOT NULL;
-- Calls that started and did not end yet. The status webhook moves a row to "calls"
-- and charges it. A second status report for the same call finds no row and does nothing.
CREATE TABLE IF NOT EXISTS live_calls (
  call_hmac BLOB PRIMARY KEY,         -- keys.indexHmac('call', call id of the provider)
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  number_id TEXT NOT NULL REFERENCES numbers(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  at INTEGER NOT NULL,
  sealed BLOB NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS live_calls_account ON live_calls(account_id);
CREATE INDEX IF NOT EXISTS live_calls_number ON live_calls(number_id);
-- Numbers that we could not give back to the provider when their row went away.
-- There is no account here. A job tries again, so that the service does not pay for them forever.
CREATE TABLE IF NOT EXISTS release_later (
  id INTEGER PRIMARY KEY,
  provider_ref BLOB NOT NULL,
  since INTEGER NOT NULL
) STRICT;
`;

const OFFER_SECONDS = 30 * 60;
const OFFERS_MAX = 20_000;
const BRIDGE_SECONDS = 5 * 60;
const LIVE_CALL_SECONDS = 12 * 3600;

export async function register(app) {
  const { config, db, keys, log } = app;
  db.exec(SCHEMA);

  const name = config.phone.provider;
  const off = name === 'off';
  const numberByPlain = (number) => (typeof number === 'string' && E164.test(number)
    ? db.get('SELECT * FROM numbers WHERE number_hmac = ?', keys.indexHmac('num', number)) || null
    : null);

  let provider = null;
  if (name === 'mock') {
    const auto = config.phone.mockAutoAnswer;
    provider = createMockProvider({
      sign: (raw) => app.keys.sign('mock-hook', raw),
      isTaken: (number) => numberByPlain(number) !== null,
      // In development a click-to-call ends by itself, so that the call log shows something.
      // Tests set phone.mockAutoAnswer to false and decide themselves when a phone answers.
      autoAnswerMs: !config.dev || auto === false ? null : (Number.isInteger(auto) ? auto : 800),
    });
  } else if (name === 'twilio') {
    provider = createTwilioProvider(config.phone.twilio);
  } else if (!off) {
    throw new Error('PHONE_PROVIDER must be mock, twilio, or off');
  }

  // Search results that an account may buy. Key: HMAC of account + number, so that
  // no plain number waits in memory. A number that was not offered cannot be bought.
  const offers = new Map();
  const offerKey = (accountId, number) => keys.indexHmac('offer', accountId + '\0' + number).toString('base64');
  // Click-to-call: token -> { accountId, numberId, number, to, expires }. The plain numbers
  // stay in memory for a few minutes only.
  const bridges = new Map();
  const queues = new Map();

  function sweep(map, now) {
    for (const [k, v] of map) if (v.expires <= now) map.delete(k);
  }

  // The shared tools of this module (routes.js, hooks.js, dev.js use them).
  const ph = {
    provider,
    off,
    bridges,
    // Webhook addresses come from the configuration. The Host header is never used.
    urls: {
      text: `${config.publicUrl}/api/hooks/phone/text`,
      voice: `${config.publicUrl}/api/hooks/phone/voice`,
      status: `${config.publicUrl}/api/hooks/phone/status`,
      bridge: (token) => `${config.publicUrl}/api/hooks/phone/bridge?t=${encodeURIComponent(token)}`,
    },
    numberByPlain,

    requireOn() {
      if (off) throw fail(503, 'phone_off', 'Phone numbers are not available on this server.');
    },
    // The row of a number of this account. Unknown and foreign IDs give the same 404.
    ownNumber(accountId, id) {
      const row = typeof id === 'string' ? db.get('SELECT * FROM numbers WHERE id = ? AND account_id = ?', id, accountId) : null;
      if (!row) throw fail(404, 'not_found', 'This number does not exist.');
      return row;
    },
    // The browser sends the plain number. It must be the number of the row.
    matchPlain(row, number) {
      if (!safeEqual(keys.indexHmac('num', number), row.number_hmac)) throw fail(400, 'bad_request', 'The number does not match.');
    },
    requireActive(row) {
      if (row.status !== 'active') throw fail(409, 'suspended', 'This number is suspended. Add funds to use it again.');
    },
    // Turns an adapter error into an answer for the browser.
    providerFail(err) {
      if (err instanceof ProviderError) {
        if (err.status === 401) log.error('the telephone provider did not accept the credentials');
        return fail(502, 'provider_error', err.message);
      }
      return err;
    },
    // Runs fn alone for one key. Two requests of one account cannot both pass a limit check.
    lock(key, fn) {
      const run = (queues.get(key) || Promise.resolve()).then(fn);
      const tail = run.catch(() => {});
      queues.set(key, tail);
      tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
      return run;
    },

    addOffer(accountId, n) {
      const now = nowSec();
      if (offers.size >= OFFERS_MAX) sweep(offers, now);
      if (offers.size >= OFFERS_MAX) offers.delete(offers.keys().next().value);
      offers.set(offerKey(accountId, n.number), { country: n.country, sms: n.sms, voice: n.voice, expires: now + OFFER_SECONDS });
    },
    getOffer(accountId, number) {
      const o = offers.get(offerKey(accountId, number));
      return o && o.expires > nowSec() ? o : null;
    },
    dropOffer(accountId, number) { offers.delete(offerKey(accountId, number)); },

    addBridge(token, entry) {
      const now = nowSec();
      sweep(bridges, now);
      bridges.set(token, { ...entry, expires: now + BRIDGE_SECONDS });
    },
    getBridge(token) {
      const b = typeof token === 'string' ? bridges.get(token) : null;
      return b && b.expires > nowSec() ? b : null;
    },

    // Gives the number back to the provider. "Not found" means that it is gone already.
    async releaseAtProvider(row) {
      const ref = keys.srvDecrypt(row.provider_ref, 'ref').toString('utf8');
      try {
        await provider.release(ref);
      } catch (err) {
        if (err instanceof ProviderError && err.notFound) return;
        throw err;
      }
    },
    releaseLater(providerRef) {
      db.run('INSERT INTO release_later (provider_ref, since) VALUES (?, ?)', providerRef, nowSec());
    },
  };

  registerRoutes(app, ph);

  const service = { provider, name };
  app.services.phone = service;
  if (off) return;

  const hooks = createHooks(app, ph);
  if (name === 'mock') {
    provider.attach(hooks);
    app.onStop(() => provider.stop());
    // Helpers for tests and for the development routes.
    service.mock = provider;
    service.simulateText = provider.simulateText;
    service.simulateCall = provider.simulateCall;
    service.answerCall = provider.answerCall;
    service.outbox = provider.outbox;
    if (config.dev) registerDevRoutes(app, ph);
  }

  app.renewables.register({
    kind: 'number',
    price: () => config.prices.numberMonth,
    due: (now, accountId) => (accountId
      ? db.all('SELECT id, account_id AS accountId, paid_until AS paidUntil, status FROM numbers WHERE paid_until <= ? AND account_id = ?', now, accountId)
      : db.all('SELECT id, account_id AS accountId, paid_until AS paidUntil, status FROM numbers WHERE paid_until <= ?', now)),
    renew: (id, paidUntil) => { db.run("UPDATE numbers SET paid_until = ?, status = 'active' WHERE id = ?", paidUntil, id); },
    suspend: (id) => { db.run("UPDATE numbers SET status = 'suspended' WHERE id = ?", id); },
    // After the grace period the number goes back to the provider. If the provider
    // fails, the row stays and the next run tries again.
    expire: async (id, accountId) => {
      const row = db.get('SELECT * FROM numbers WHERE id = ? AND account_id = ?', id, accountId);
      if (!row) return;
      await ph.releaseAtProvider(row);
      db.run('DELETE FROM numbers WHERE id = ? AND account_id = ?', id, accountId);
    },
  });

  // The rows go away with the account. The numbers must go back to the provider first.
  app.onAccountDelete(async (accountId) => {
    for (const row of db.all('SELECT id, provider_ref FROM numbers WHERE account_id = ?', accountId)) {
      try {
        await ph.releaseAtProvider(row);
      } catch {
        ph.releaseLater(row.provider_ref);
        log.warn('a number could not be released at the provider; a job tries again');
      }
    }
    for (const [token, b] of bridges) if (b.accountId === accountId) bridges.delete(token);
  });

  app.every('phone-cleanup', 3600, async () => {
    const now = nowSec();
    sweep(offers, now);
    sweep(bridges, now);
    // A call with no status report after many hours will not get one.
    db.run('DELETE FROM live_calls WHERE at < ?', now - LIVE_CALL_SECONDS);
    for (const row of db.all('SELECT id, provider_ref FROM release_later ORDER BY RANDOM() LIMIT 50')) {
      try {
        await ph.releaseAtProvider(row);
        db.run('DELETE FROM release_later WHERE id = ?', row.id);
      } catch { /* the next run tries again */ }
    }
  });
}
