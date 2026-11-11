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
import { createDelivery } from './delivery.js';
import { createHooks } from './hooks.js';
import { registerRoutes } from './routes.js';
import { registerDevRoutes } from './dev.js';
import { E164 } from './common.js';

// The tables. A column that was added after the first version is also in MIGRATIONS below,
// because CREATE TABLE IF NOT EXISTS does not change a table that exists already.
const TABLES = `
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
  created_day TEXT NOT NULL,
  retention_days INTEGER              -- delete the texts of this number after so many days; NULL = keep them
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
  msg_hmac BLOB,                      -- incoming only: HMAC of the provider's message id
  status TEXT                         -- outgoing only: 'queued' | 'sent' | 'delivered' | 'failed'
) STRICT;
CREATE INDEX IF NOT EXISTS texts_number ON texts(number_id, at);
CREATE INDEX IF NOT EXISTS texts_account ON texts(account_id);
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
-- Texts that the provider accepted and that wait for their final status (see delivery.js).
-- The final status removes the row.
CREATE TABLE IF NOT EXISTS text_sends (
  ref_hmac BLOB PRIMARY KEY,          -- keys.indexHmac('sent', message id of the provider)
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  text_id TEXT,                       -- the row in "texts"; NULL for a forwarded text or a code text
  charged INTEGER NOT NULL,           -- credits that go back to the account if the text fails
  status TEXT NOT NULL,               -- 'queued' | 'sent'
  at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS text_sends_account ON text_sends(account_id);
`;
// Columns that an older database does not have: [table, column, type].
const MIGRATIONS = [
  ['texts', 'msg_hmac', 'BLOB'],
  ['calls', 'call_hmac', 'BLOB'],
  ['texts', 'status', 'TEXT'],
  ['numbers', 'retention_days', 'INTEGER'],
];
// Indexes on those columns. They can be made only after the columns exist.
const INDEXES = `
-- A provider can deliver one webhook two times. The second copy must not be stored or forwarded again.
CREATE UNIQUE INDEX IF NOT EXISTS texts_msg ON texts(msg_hmac) WHERE msg_hmac IS NOT NULL;
-- One call has one line in the log, also when the provider reports it two times.
CREATE UNIQUE INDEX IF NOT EXISTS calls_call ON calls(call_hmac) WHERE call_hmac IS NOT NULL;
`;

const OFFER_SECONDS = 30 * 60;
const OFFERS_MAX = 20_000;
const BRIDGE_SECONDS = 5 * 60;
const SAY_CODE_SECONDS = 5 * 60;
const LIVE_CALL_SECONDS = 12 * 3600;
const TEXT_SEND_SECONDS = 7 * 86400;
const NO_CAPABILITIES = { voice: false, asyncText: false, searchByArea: false };

function migrate(db) {
  db.exec(TABLES);
  for (const [table, column, type] of MIGRATIONS) {
    if (db.all(`PRAGMA table_info(${table})`).some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    // Outgoing texts from before the status column went to the provider without an error.
    if (table === 'texts' && column === 'status') db.exec("UPDATE texts SET status = 'sent' WHERE direction = 'out'");
  }
  db.exec(INDEXES);
}

export async function register(app) {
  const { config, db, keys, log } = app;
  migrate(db);

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
    provider = createTwilioProvider(config.phone.twilio, { warn: (message) => log.warn(message) });
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
  // Phone link by call: token -> { accountId, code, expires }. The say-code webhook speaks the code.
  const sayCodes = new Map();
  const queues = new Map();
  // "+1" and "1" mean the same prefix. An empty entry would match every number: drop it.
  const prefixes = (list) => (Array.isArray(list) ? list : []).map((p) => String(p).trim()).filter(Boolean).map((p) => (p.startsWith('+') ? p : '+' + p));

  function sweep(map, now) {
    for (const [k, v] of map) if (v.expires <= now) map.delete(k);
  }

  // The shared tools of this module (routes.js, hooks.js, dev.js use them).
  const ph = {
    provider,
    off,
    bridges,
    sayCodes,
    // What the provider can do. With no provider, nothing.
    capabilities: provider ? provider.capabilities : NO_CAPABILITIES,
    // Webhook addresses come from the configuration. The Host header is never used.
    urls: {
      text: `${config.publicUrl}/api/hooks/phone/text`,
      textStatus: `${config.publicUrl}/api/hooks/phone/text-status`,
      voice: `${config.publicUrl}/api/hooks/phone/voice`,
      status: `${config.publicUrl}/api/hooks/phone/status`,
      bridge: (token) => `${config.publicUrl}/api/hooks/phone/bridge?t=${encodeURIComponent(token)}`,
      sayCode: (token) => `${config.publicUrl}/api/hooks/phone/say-code?token=${encodeURIComponent(token)}`,
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
    // Calls need a provider with voice and a number with voice.
    hasVoice(row) {
      return ph.capabilities.voice === true && row.voice === 1;
    },
    requireVoice(row) {
      if (!ph.hasVoice(row)) throw fail(409, 'no_voice', 'This number cannot make or get calls through Postern.');
    },
    // A number that the user wants to text, call, or link. The operator pays the provider
    // for each text and call, so expensive destinations can be closed in the configuration.
    checkDestination(number) {
      const allowed = prefixes(config.phone.allowedPrefixes);
      const blocked = prefixes(config.phone.blockedPrefixes);
      if ((allowed.length > 0 && !allowed.some((p) => number.startsWith(p))) || blocked.some((p) => number.startsWith(p))) {
        throw fail(400, 'bad_destination', 'You cannot text or call this number from here.');
      }
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
    addSayCode(token, entry) {
      const now = nowSec();
      sweep(sayCodes, now);
      sayCodes.set(token, { ...entry, expires: now + SAY_CODE_SECONDS });
    },
    getSayCode(token) {
      const s = typeof token === 'string' ? sayCodes.get(token) : null;
      return s && s.expires > nowSec() ? s : null;
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

    // Deletes texts of one number: one text (textId), or all texts older than a time (before).
    // A send that still waits for its delivery status must not point at a text that is gone.
    // The send itself stays: if the provider reports later that the text failed, the charge
    // still comes back, one time. Returns the count of deleted texts.
    deleteTexts(accountId, numberId, { textId, before }) {
      const which = textId !== undefined ? 'id = ?' : 'at < ?';
      const value = textId !== undefined ? textId : before;
      return db.tx(() => {
        db.run(`UPDATE text_sends SET text_id = NULL WHERE account_id = ? AND text_id IN (SELECT id FROM texts WHERE account_id = ? AND number_id = ? AND ${which})`,
          accountId, accountId, numberId, value);
        return db.run(`DELETE FROM texts WHERE account_id = ? AND number_id = ? AND ${which}`, accountId, numberId, value).changes;
      });
    },
    // Deletes the row of a number. Its texts and calls go with it.
    deleteNumber(accountId, numberId) {
      db.tx(() => {
        ph.deleteTexts(accountId, numberId, { before: Number.MAX_SAFE_INTEGER });
        db.run('DELETE FROM numbers WHERE id = ? AND account_id = ?', numberId, accountId);
      });
    },
  };

  // Charge, send, and delivery status of outgoing texts.
  const delivery = createDelivery(app, ph);
  ph.sendPaidText = delivery.sendPaidText;
  ph.trackSend = delivery.trackSend;
  ph.reportTextStatus = delivery.reportTextStatus;

  registerRoutes(app, ph);

  // Auto-delete: the user can ask that the texts of a number go away after some days.
  // The server does it, because the browser is not always open. This also runs with no
  // provider. Calls are not touched.
  app.every('phone-retention', 3600, async () => {
    const now = nowSec();
    let total = 0;
    for (const num of db.all('SELECT id, account_id, retention_days FROM numbers WHERE retention_days IS NOT NULL')) {
      const deleted = ph.deleteTexts(num.account_id, num.id, { before: now - num.retention_days * 86400 });
      if (deleted) app.events.publish(num.account_id, 'text', { numberId: num.id });
      total += deleted;
    }
    // The database overwrites deleted rows (secure_delete). Old copies can still be in the
    // write-ahead file. Fold it into the database now and cut it, so that they are gone too.
    if (total) {
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* a later checkpoint does it */ }
    }
  });

  // reportTextStatus is for a provider that learns the result of a text in its own way (not by our webhook).
  const service = { provider, name, capabilities: ph.capabilities, reportTextStatus: delivery.reportTextStatus };
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
    service.reportText = provider.reportText;
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
      ph.deleteNumber(accountId, id);
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
    for (const [token, s] of sayCodes) if (s.accountId === accountId) sayCodes.delete(token);
  });

  app.every('phone-cleanup', 3600, async () => {
    const now = nowSec();
    sweep(offers, now);
    sweep(bridges, now);
    sweep(sayCodes, now);
    delivery.sweep();
    // A text with no final status after a week will not get one.
    db.run('DELETE FROM text_sends WHERE at < ?', now - TEXT_SEND_SECONDS);
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
