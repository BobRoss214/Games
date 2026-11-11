// Mail tables and the queries that more than one mail file needs.
// The plain address is never stored: the tables hold a keyed hash for lookup and a
// copy that only the browser of the account can open.
import { nowSec } from '../core/db.js';
import { randomId } from '../core/keys.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  enc BLOB,                               -- label and note, encrypted in the browser
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  paid_until INTEGER NOT NULL,
  created_day TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS mailboxes_account ON mailboxes(account_id);
CREATE INDEX IF NOT EXISTS mailboxes_due ON mailboxes(paid_until);

CREATE TABLE IF NOT EXISTS addresses (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('mailbox', 'alias')),
  address_hmac BLOB NOT NULL UNIQUE,      -- keys.indexHmac('addr', address)
  sealed_address BLOB NOT NULL,           -- { address }, sealed to the account
  enc BLOB,                               -- label and note, encrypted in the browser
  enabled INTEGER NOT NULL DEFAULT 1,
  received INTEGER NOT NULL DEFAULT 0,
  created_day TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS addresses_account ON addresses(account_id);
CREATE INDEX IF NOT EXISTS addresses_mailbox ON addresses(mailbox_id);

-- An address that was deleted. Nobody can make it again, so a new owner cannot get old mail.
CREATE TABLE IF NOT EXISTS address_tombstones (
  address_hmac BLOB PRIMARY KEY
) STRICT;
-- Safety net: every way to delete an address row leaves a tombstone, also a cascade.
CREATE TRIGGER IF NOT EXISTS addresses_tombstone BEFORE DELETE ON addresses
BEGIN
  INSERT OR IGNORE INTO address_tombstones (address_hmac) VALUES (OLD.address_hmac);
END;

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  address_id TEXT,                        -- no foreign key: the message stays when the alias is deleted
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL,                  -- stored bytes (encrypted)
  attachments INTEGER NOT NULL DEFAULT 0,
  sealed_key BLOB NOT NULL,
  enc_meta BLOB NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS messages_account ON messages(account_id, at, id);
CREATE INDEX IF NOT EXISTS messages_mailbox ON messages(mailbox_id, at, id);
CREATE INDEX IF NOT EXISTS messages_unread ON messages(mailbox_id, direction, seen);
CREATE INDEX IF NOT EXISTS messages_size ON messages(mailbox_id, size);

CREATE TABLE IF NOT EXISTS message_parts (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (message_id, idx)
) STRICT;

CREATE TABLE IF NOT EXISTS send_counts (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (account_id, day)
) STRICT;
`;

export function createMailData(app) {
  const { db, keys, config } = app;
  db.exec(SCHEMA);

  const data = {
    hmac: (address) => keys.indexHmac('addr', address),

    // True if the address does not exist now and never existed before.
    isFree(address) {
      const h = data.hmac(address);
      return !db.get('SELECT 1 AS x FROM addresses WHERE address_hmac = ?', h) && !db.get('SELECT 1 AS x FROM address_tombstones WHERE address_hmac = ?', h);
    },

    mailboxBytes(mailboxId) {
      return db.get('SELECT COALESCE(SUM(size), 0) AS n FROM messages WHERE mailbox_id = ?', mailboxId).n;
    },
    // True if the mailbox has room for `extra` more bytes. A limit of 0 means no limit.
    hasRoom(mailboxId, extra = 0) {
      const limit = config.limits.mailboxBytes;
      return !limit || data.mailboxBytes(mailboxId) + extra <= limit;
    },

    // Finds the destination of an address. This is the one lookup that has no account id:
    // incoming mail knows only the address.
    route(address) {
      return db.get(
        `SELECT a.id AS addressId, a.account_id AS accountId, a.mailbox_id AS mailboxId, a.enabled, m.status
         FROM addresses a JOIN mailboxes m ON m.id = a.mailbox_id WHERE a.address_hmac = ?`,
        data.hmac(address),
      ) || null;
    },

    // Stores one encrypted message. `env` is the result of sealEnvelope() or the browser copy.
    // Runs inside the transaction of the caller, or in its own.
    insertMessage({ accountId, mailboxId, addressId, direction, seen, env }) {
      const id = randomId();
      let size = env.sealedKey.length + env.encMeta.length;
      for (const part of env.parts) size += part.length;
      db.tx(() => {
        db.run(
          'INSERT INTO messages (id, account_id, mailbox_id, address_id, direction, at, seen, size, attachments, sealed_key, enc_meta) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          id, accountId, mailboxId, addressId, direction, nowSec(), seen ? 1 : 0, size, env.parts.length - 1, env.sealedKey, env.encMeta,
        );
        env.parts.forEach((part, idx) => db.run('INSERT INTO message_parts (message_id, idx, data) VALUES (?,?,?)', id, idx, part));
      });
      return id;
    },

    // Writes tombstones for every address that matches. `where` is a fixed SQL condition.
    tombstone(where, ...params) {
      db.run(`INSERT OR IGNORE INTO address_tombstones (address_hmac) SELECT address_hmac FROM addresses WHERE ${where}`, ...params);
    },
  };
  return data;
}
