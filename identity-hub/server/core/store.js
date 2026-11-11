// Accounts, sessions, credit balance, and the encrypted key-value vault.
// Other modules use this store. They do not touch these tables directly.
import { seal } from '../../shared/crypto.js';
import { nowSec, today } from './db.js';
import { sha256, randomId, randomToken, safeEqual } from './keys.js';
import { fail } from './http.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,              -- 32 hex characters, derived from the recovery key in the browser
  user_handle BLOB NOT NULL UNIQUE, -- random handle for passkeys
  auth_hash BLOB NOT NULL,          -- SHA-256 of the login secret
  public_key BLOB NOT NULL,         -- ECDH P-256 public key (65 bytes)
  enc_private_key BLOB NOT NULL,    -- private key, encrypted in the browser
  recovery_wrap BLOB NOT NULL,      -- account key, encrypted in the browser with the recovery key
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_day TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash BLOB NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_day TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL,
  day TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ledger_account ON ledger(account_id, id);
CREATE TABLE IF NOT EXISTS vault (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value BLOB NOT NULL,
  PRIMARY KEY (account_id, key)
) STRICT;
`;

const isBytes = (v, min, max = min) => v instanceof Uint8Array && v.length >= min && v.length <= max;

export function createStore({ db, config }) {
  db.exec(SCHEMA);

  const store = {
    createAccount({ accountId, authKey, publicKey, encPrivateKey, recoveryWrap }) {
      if (typeof accountId !== 'string' || !/^[0-9a-f]{32}$/.test(accountId)) throw fail(400, 'bad_request', 'The account number is not valid.');
      if (!isBytes(authKey, 32)) throw fail(400, 'bad_request', 'The login key is not valid.');
      if (!isBytes(publicKey, 65) || publicKey[0] !== 4) throw fail(400, 'bad_request', 'The public key is not valid.');
      if (!isBytes(encPrivateKey, 100, 400) || !isBytes(recoveryWrap, 61)) throw fail(400, 'bad_request', 'The key data is not valid.');
      try {
        db.run(
          'INSERT INTO accounts (id, user_handle, auth_hash, public_key, enc_private_key, recovery_wrap, created_day) VALUES (?,?,?,?,?,?,?)',
          accountId, sha256(randomToken()).subarray(0, 16), sha256(authKey), publicKey, encPrivateKey, recoveryWrap, today(),
        );
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) throw fail(409, 'account_exists', 'This account exists already.');
        throw err;
      }
      return store.getAccount(accountId);
    },

    getAccount(id) {
      const r = db.get('SELECT * FROM accounts WHERE id = ?', id);
      if (!r) return null;
      return {
        id: r.id, userHandle: r.user_handle, publicKey: r.public_key, encPrivateKey: r.enc_private_key,
        recoveryWrap: r.recovery_wrap, balance: r.balance, createdDay: r.created_day,
      };
    },

    getAccountByHandle(userHandle) {
      const r = db.get('SELECT id FROM accounts WHERE user_handle = ?', userHandle);
      return r ? store.getAccount(r.id) : null;
    },

    // Returns the account if the login secret is correct. If not, returns null.
    verifyAuth(id, authKey) {
      if (typeof id !== 'string' || !isBytes(authKey, 32)) return null;
      const r = db.get('SELECT auth_hash FROM accounts WHERE id = ?', id);
      // Compare also when the account does not exist. The time must not show if an account exists.
      const ok = safeEqual(sha256(authKey), r ? r.auth_hash : Buffer.alloc(32));
      return r && ok ? store.getAccount(id) : null;
    },

    deleteAccount(id) {
      db.run('DELETE FROM accounts WHERE id = ?', id);
    },

    // ---- sessions ----
    createSession(accountId) {
      const token = randomToken();
      const id = randomId();
      const expiresAt = nowSec() + config.sessionDays * 86400;
      db.run('INSERT INTO sessions (id, token_hash, account_id, created_day, expires_at) VALUES (?,?,?,?,?)', id, sha256(token), accountId, today(), expiresAt);
      return { id, token, expiresAt };
    },
    getSession(token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
      const r = db.get('SELECT id, account_id, expires_at FROM sessions WHERE token_hash = ?', sha256(token));
      if (!r) return null;
      if (r.expires_at <= nowSec()) { db.run('DELETE FROM sessions WHERE id = ?', r.id); return null; }
      return { id: r.id, accountId: r.account_id, expiresAt: r.expires_at };
    },
    listSessions(accountId) {
      return db.all('SELECT id, created_day AS createdDay, expires_at AS expiresAt FROM sessions WHERE account_id = ? AND expires_at > ? ORDER BY rowid DESC', accountId, nowSec());
    },
    deleteSession(accountId, sessionId) {
      return db.run('DELETE FROM sessions WHERE account_id = ? AND id = ?', accountId, sessionId).changes > 0;
    },
    deleteOtherSessions(accountId, keepSessionId = '') {
      db.run('DELETE FROM sessions WHERE account_id = ? AND id <> ?', accountId, keepSessionId);
    },
    purgeExpiredSessions() {
      db.run('DELETE FROM sessions WHERE expires_at <= ?', nowSec());
    },

    // ---- credits (100 credits = 1.00 USD) ----
    balance(accountId) {
      const r = db.get('SELECT balance FROM accounts WHERE id = ?', accountId);
      return r ? r.balance : 0;
    },
    // Takes credits. Throws 402 if the balance is too low. An amount of 0 does nothing.
    charge(accountId, amount, kind) {
      if (!Number.isInteger(amount) || amount < 0) throw new Error('bad amount');
      if (amount === 0) return store.balance(accountId);
      return db.tx(() => {
        const done = db.run('UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?', amount, accountId, amount).changes;
        if (!done) throw fail(402, 'insufficient_funds', 'Your balance is too low. Add funds first.', { needed: amount });
        db.run('INSERT INTO ledger (account_id, delta, kind, day) VALUES (?,?,?,?)', accountId, -amount, kind, today());
        return store.balance(accountId);
      });
    },
    canAfford(accountId, amount) {
      return store.balance(accountId) >= amount;
    },
    credit(accountId, amount, kind) {
      if (!Number.isInteger(amount) || amount < 0) throw new Error('bad amount');
      if (amount === 0) return store.balance(accountId);
      return db.tx(() => {
        db.run('UPDATE accounts SET balance = balance + ? WHERE id = ?', amount, accountId);
        db.run('INSERT INTO ledger (account_id, delta, kind, day) VALUES (?,?,?,?)', accountId, amount, kind, today());
        return store.balance(accountId);
      });
    },
    ledger(accountId, limit = 100) {
      return db.all('SELECT delta, kind, day FROM ledger WHERE account_id = ? ORDER BY id DESC LIMIT ?', accountId, limit);
    },

    // ---- sealing: encrypt for one account. Only the browser of that account can decrypt. ----
    async sealFor(accountId, bytes, aad) {
      const r = db.get('SELECT public_key FROM accounts WHERE id = ?', accountId);
      if (!r) throw new Error('unknown account');
      return seal(r.public_key, bytes, aad);
    },
    async sealJsonFor(accountId, obj, aad) {
      return store.sealFor(accountId, new TextEncoder().encode(JSON.stringify(obj)), aad);
    },

    // ---- vault: small values that the browser encrypts. The server cannot read them. ----
    vaultGet(accountId, key) {
      const r = db.get('SELECT value FROM vault WHERE account_id = ? AND key = ?', accountId, key);
      return r ? r.value : null;
    },
    vaultPut(accountId, key, value) {
      db.run('INSERT INTO vault (account_id, key, value) VALUES (?,?,?) ON CONFLICT (account_id, key) DO UPDATE SET value = excluded.value', accountId, key, value);
    },
    vaultDelete(accountId, key) {
      db.run('DELETE FROM vault WHERE account_id = ? AND key = ?', accountId, key);
    },
    vaultKeys(accountId) {
      return db.all('SELECT key FROM vault WHERE account_id = ? ORDER BY key', accountId).map((r) => r.key);
    },
  };
  return store;
}
