// HTTP routes for mailboxes, aliases, and stored messages. Contract: docs/API.md section 4.
// Every query has the account id of the session. An id of a different account gives 404.
import { fail, reply, need, b64u } from '../core/http.js';
import { nowSec, today } from '../core/db.js';
import { randomId } from '../core/keys.js';
import { PERIOD_SECONDS } from '../core/renew.js';
import { chooseAddress, taken } from './address.js';

const ID = /^[A-Za-z0-9_-]{22}$/;
const MAX_ENC_BYTES = 2048;
const MAX_ADDRESS_IDS = 50;
const MAX_RETENTION_DAYS = 3650;
const MAX_EXPIRY_SECONDS = 3650 * 86400; // an end date can be 10 years ahead at most

const notFound = () => fail(404, 'not_found', 'Not found.');
// An id that is not well formed cannot exist. It gets the same answer as an unknown id.
const idParam = (v) => { if (typeof v !== 'string' || !ID.test(v)) throw notFound(); return v; };
const encField = (v) => need.optional(v, need.bytes, 'enc', { min: 1, max: MAX_ENC_BYTES });
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// "id,id,id" from the query -> the different ids. The list must have 1 to 50 well-formed ids.
// An empty list is an error and not "no filter": a view of a group must never show all mail by mistake.
function addressIdList(value) {
  const ids = typeof value === 'string' ? value.split(',') : [];
  if (ids.length < 1 || ids.length > MAX_ADDRESS_IDS || !ids.every((id) => ID.test(id))) {
    throw fail(400, 'bad_request', 'The value "addressIds" is not valid.');
  }
  return [...new Set(ids)];
}

// The order of the message list: new to old, and the same second by id from high to low.
// Ids are ASCII text, so this is the same order that the database uses.
const newestFirst = (x, y) => y.at - x.at || (x.id < y.id ? 1 : x.id > y.id ? -1 : 0);

export function registerRoutes(app, { data }) {
  const { http, db, store, config, events } = app;

  // ---- mailboxes ----

  const MAILBOX_SQL = `
    SELECT m.id, m.enc, m.status, m.paid_until, m.created_day, m.retention_days, a.id AS address_id, a.sealed_address,
      (SELECT COUNT(*) FROM messages x WHERE x.mailbox_id = m.id AND x.direction = 'in' AND x.seen = 0) AS unread,
      (SELECT COUNT(*) FROM messages x WHERE x.mailbox_id = m.id) AS total,
      (SELECT COUNT(*) FROM address_blocks k WHERE k.address_id = a.id) AS blocks
    FROM mailboxes m JOIN addresses a ON a.mailbox_id = m.id AND a.kind = 'mailbox'
    WHERE m.account_id = ?`;
  const mailboxView = (r) => ({
    id: r.id, addressId: r.address_id, sealedAddress: b64u(r.sealed_address), enc: b64u(r.enc), status: r.status,
    paidUntil: r.paid_until, createdDay: r.created_day, unread: r.unread, total: r.total,
    retentionDays: r.retention_days ?? null, blocks: r.blocks,
  });
  const getMailbox = (accountId, id) => {
    const row = db.get(`${MAILBOX_SQL} AND m.id = ?`, accountId, idParam(id));
    if (!row) throw notFound();
    return row;
  };
  const ownsMailbox = (accountId, id) => Boolean(db.get('SELECT 1 AS x FROM mailboxes WHERE account_id = ? AND id = ?', accountId, id));
  const limitReached = (what) => fail(409, 'limit_reached', `You reached the limit of ${what}. Delete one first.`);

  http.get('/api/mailboxes', { auth: true }, (c) => ({
    mailboxes: db.all(`${MAILBOX_SQL} ORDER BY m.rowid`, c.account.id).map(mailboxView),
  }));

  http.post('/api/mailboxes', { auth: true, rate: { max: 60, per: 3600 } }, async (c) => {
    const accountId = c.account.id;
    const enc = encField(c.body.enc);
    const overLimit = () => config.limits.mailboxes > 0
      && db.get('SELECT COUNT(*) AS n FROM mailboxes WHERE account_id = ?', accountId).n >= config.limits.mailboxes;
    if (overLimit()) throw limitReached('mailboxes');
    // The address is checked before the charge, so that a taken address costs nothing.
    const address = chooseAddress(c.body, config.mail.domains, data.isFree);
    const sealed = await store.sealJsonFor(accountId, { address }, 'address');
    const price = config.prices.mailboxMonth;
    const id = randomId();
    const addressId = randomId();
    try {
      // One transaction: if a later step fails, the charge is undone.
      db.tx(() => {
        if (overLimit()) throw limitReached('mailboxes');
        if (!data.isFree(address)) throw taken();
        store.charge(accountId, price, 'mailbox');
        db.run('INSERT INTO mailboxes (id, account_id, enc, status, paid_until, created_day) VALUES (?,?,?,?,?,?)',
          id, accountId, enc ?? null, 'active', nowSec() + PERIOD_SECONDS, today());
        db.run('INSERT INTO addresses (id, account_id, mailbox_id, kind, address_hmac, sealed_address, enc, enabled, created_day) VALUES (?,?,?,?,?,?,NULL,1,?)',
          addressId, accountId, id, 'mailbox', data.hmac(address), sealed, today());
      });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw taken();
      throw err;
    }
    events.publish(accountId, 'mailbox');
    if (price > 0) events.publish(accountId, 'balance');
    return reply(201, { mailbox: mailboxView(getMailbox(accountId, id)), address });
  });

  http.patch('/api/mailboxes/:id', { auth: true }, (c) => {
    const row = getMailbox(c.account.id, c.params.id);
    const b = c.body;
    if (!has(b, 'enc') && !has(b, 'retentionDays')) throw fail(400, 'bad_request', 'Send a value to change.');
    const next = { enc: row.enc, retention_days: row.retention_days };
    if (has(b, 'enc')) next.enc = encField(b.enc) ?? null; // null removes the label
    // null turns the auto-delete off. The job in retention.js does the deleting.
    if (has(b, 'retentionDays')) next.retention_days = b.retentionDays === null ? null : need.int(b.retentionDays, 'retentionDays', { min: 1, max: MAX_RETENTION_DAYS });
    db.run('UPDATE mailboxes SET enc = ?, retention_days = ? WHERE account_id = ? AND id = ?', next.enc, next.retention_days, c.account.id, row.id);
    events.publish(c.account.id, 'mailbox');
    return { mailbox: mailboxView({ ...row, ...next }) };
  });

  http.del('/api/mailboxes/:id', { auth: true }, (c) => {
    const row = getMailbox(c.account.id, c.params.id);
    db.tx(() => {
      // The addresses of the mailbox must never be given out again.
      data.tombstone('account_id = ? AND mailbox_id = ?', c.account.id, row.id);
      // The delete cascades to the addresses, the messages, and the message parts.
      db.run('DELETE FROM mailboxes WHERE account_id = ? AND id = ?', c.account.id, row.id);
    });
    events.publish(c.account.id, 'mailbox');
    events.publish(c.account.id, 'aliases');
  });

  // ---- aliases ----

  const ALIAS_SQL = `
    SELECT a.*, (SELECT COUNT(*) FROM address_blocks k WHERE k.address_id = a.id) AS blocks
    FROM addresses a WHERE a.account_id = ? AND a.kind = 'alias'`;
  const aliasView = (r) => ({
    id: r.id, mailboxId: r.mailbox_id, sealedAddress: b64u(r.sealed_address), enc: b64u(r.enc), enabled: r.enabled === 1,
    createdDay: r.created_day, received: r.received, expiresAt: r.expires_at ?? null, blocks: r.blocks,
  });
  const getAlias = (accountId, id) => {
    const row = db.get(`${ALIAS_SQL} AND a.id = ?`, accountId, idParam(id));
    if (!row) throw notFound();
    return row;
  };

  http.get('/api/aliases', { auth: true }, (c) => ({
    aliases: db.all(`${ALIAS_SQL} ORDER BY a.rowid`, c.account.id).map(aliasView),
  }));

  http.post('/api/aliases', { auth: true, rate: { max: 120, per: 3600 } }, async (c) => {
    const accountId = c.account.id;
    const mailboxId = need.string(c.body.mailboxId, 'mailboxId', { min: 22, max: 22, pattern: ID });
    const enc = encField(c.body.enc);
    if (!ownsMailbox(accountId, mailboxId)) throw notFound();
    const overLimit = () => config.limits.aliases > 0
      && db.get("SELECT COUNT(*) AS n FROM addresses WHERE account_id = ? AND kind = 'alias'", accountId).n >= config.limits.aliases;
    if (overLimit()) throw limitReached('aliases');
    const address = chooseAddress(c.body, config.mail.domains, data.isFree);
    const sealed = await store.sealJsonFor(accountId, { address }, 'address');
    const id = randomId();
    try {
      db.tx(() => {
        if (!ownsMailbox(accountId, mailboxId)) throw notFound();
        if (overLimit()) throw limitReached('aliases');
        if (!data.isFree(address)) throw taken();
        db.run('INSERT INTO addresses (id, account_id, mailbox_id, kind, address_hmac, sealed_address, enc, enabled, created_day) VALUES (?,?,?,?,?,?,?,1,?)',
          id, accountId, mailboxId, 'alias', data.hmac(address), sealed, enc ?? null, today());
      });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw taken();
      throw err;
    }
    events.publish(accountId, 'aliases');
    return reply(201, { alias: aliasView(getAlias(accountId, id)), address });
  });

  http.patch('/api/aliases/:id', { auth: true }, (c) => {
    const accountId = c.account.id;
    const row = getAlias(accountId, c.params.id);
    const b = c.body;
    const next = { enabled: row.enabled, mailbox_id: row.mailbox_id, enc: row.enc, expires_at: row.expires_at };
    if (!['enabled', 'mailboxId', 'enc', 'expiresAt'].some((key) => has(b, key))) throw fail(400, 'bad_request', 'Send a value to change.');
    if (has(b, 'enabled')) next.enabled = need.bool(b.enabled, 'enabled') ? 1 : 0;
    if (has(b, 'enc')) next.enc = encField(b.enc) ?? null;
    if (has(b, 'mailboxId')) {
      next.mailbox_id = need.string(b.mailboxId, 'mailboxId', { min: 22, max: 22, pattern: ID });
      if (!ownsMailbox(accountId, next.mailbox_id)) throw notFound();
    }
    // The end date: after it the alias behaves like an alias that is turned off. null removes the end date.
    // The date must be in the future. A new date or null makes an ended alias work again.
    if (has(b, 'expiresAt')) {
      const now = nowSec();
      next.expires_at = b.expiresAt === null ? null : need.int(b.expiresAt, 'expiresAt', { min: now + 1, max: now + MAX_EXPIRY_SECONDS });
    }
    db.run('UPDATE addresses SET enabled = ?, mailbox_id = ?, enc = ?, expires_at = ? WHERE account_id = ? AND id = ?',
      next.enabled, next.mailbox_id, next.enc, next.expires_at, accountId, row.id);
    events.publish(accountId, 'aliases');
    return { alias: aliasView({ ...row, ...next }) };
  });

  http.del('/api/aliases/:id', { auth: true }, (c) => {
    const accountId = c.account.id;
    const row = getAlias(accountId, c.params.id);
    db.tx(() => {
      data.tombstone('account_id = ? AND id = ?', accountId, row.id);
      // The messages stay in the mailbox. They only lose the link to the alias.
      db.run('UPDATE messages SET address_id = NULL WHERE account_id = ? AND address_id = ?', accountId, row.id);
      db.run('DELETE FROM addresses WHERE account_id = ? AND id = ?', accountId, row.id);
    });
    events.publish(accountId, 'aliases');
  });

  // ---- messages ----

  const MESSAGE_COLUMNS = 'id, mailbox_id, address_id, direction, at, seen, size, attachments, sealed_key, enc_meta';
  const messageView = (r) => ({
    id: r.id, mailboxId: r.mailbox_id, addressId: r.address_id, direction: r.direction, at: r.at, seen: r.seen === 1,
    size: r.size, attachments: r.attachments, sealedKey: b64u(r.sealed_key), encMeta: b64u(r.enc_meta),
  });
  const getMessage = (accountId, id) => {
    const row = db.get(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE account_id = ? AND id = ?`, accountId, idParam(id));
    if (!row) throw notFound();
    return row;
  };
  // Query values are text. This reads a whole number in a range.
  const queryInt = (v, name, min, max) => {
    if (typeof v !== 'string' || !/^\d{1,12}$/.test(v)) throw fail(400, 'bad_request', `The value "${name}" is not valid.`);
    return need.int(Number(v), name, { min, max });
  };

  http.get('/api/messages', { auth: true }, (c) => {
    const q = c.query;
    const where = ['account_id = ?'];
    const params = [c.account.id];
    if (q.mailboxId !== undefined && q.mailboxId !== '') {
      const mailboxId = need.string(q.mailboxId, 'mailboxId', { min: 22, max: 22, pattern: ID });
      if (!ownsMailbox(c.account.id, mailboxId)) throw notFound();
      where.push('mailbox_id = ?');
      params.push(mailboxId);
    }
    if (q.direction !== undefined && q.direction !== '') {
      if (q.direction !== 'in' && q.direction !== 'out') throw fail(400, 'bad_request', 'The value "direction" is not valid.');
      where.push('direction = ?');
      params.push(q.direction);
    }
    if (q.before !== undefined && q.before !== '') {
      const before = queryInt(q.before, 'before', 0, Number.MAX_SAFE_INTEGER);
      if (q.beforeId !== undefined && q.beforeId !== '') {
        // Messages of the same second are ordered by id. Both values together name an exact position.
        const beforeId = need.string(q.beforeId, 'beforeId', { min: 22, max: 22, pattern: ID });
        where.push('(at < ? OR (at = ? AND id < ?))');
        params.push(before, before, beforeId);
      } else {
        where.push('at < ?');
        params.push(before);
      }
    }
    const limit = q.limit === undefined || q.limit === '' ? 50 : queryInt(q.limit, 'limit', 1, 100);
    const addressIds = q.addressIds === undefined ? null : addressIdList(q.addressIds);
    let rows;
    if (addressIds) {
      // One query for each address. Each query has the account id, so an id of a different account matches nothing.
      // Each one reads the index (account_id, address_id, at, id) in order and stops after one page.
      // The newest messages of all lists together are the page.
      where.splice(1, 0, 'address_id = ?');
      const sql = `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT ?`;
      rows = [];
      for (const addressId of addressIds) rows.push(...db.all(sql, params[0], addressId, ...params.slice(1), limit + 1));
      rows.sort(newestFirst);
    } else {
      rows = db.all(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT ?`, ...params, limit + 1);
    }
    return { messages: rows.slice(0, limit).map(messageView), more: rows.length > limit };
  });

  http.get('/api/messages/:id', { auth: true }, (c) => {
    const row = getMessage(c.account.id, c.params.id);
    const part = db.get('SELECT data FROM message_parts WHERE message_id = ? AND idx = 0', row.id);
    return { message: { ...messageView(row), body: b64u(part ? part.data : null) } };
  });

  http.get('/api/messages/:id/parts/:index', { auth: true }, (c) => {
    const row = getMessage(c.account.id, c.params.id);
    if (!/^[1-9]\d{0,3}$/.test(c.params.index)) throw notFound();
    const part = db.get('SELECT data FROM message_parts WHERE message_id = ? AND idx = ?', row.id, Number(c.params.index));
    if (!part) throw notFound();
    return reply(200, Buffer.from(part.data), { 'content-type': 'application/octet-stream' });
  });

  http.patch('/api/messages/:id', { auth: true }, (c) => {
    const row = getMessage(c.account.id, c.params.id);
    const seen = need.bool(c.body.seen, 'seen') ? 1 : 0;
    db.run('UPDATE messages SET seen = ? WHERE account_id = ? AND id = ?', seen, c.account.id, row.id);
    if (seen !== row.seen) events.publish(c.account.id, 'mail', { mailboxId: row.mailbox_id });
  });

  http.del('/api/messages/:id', { auth: true }, (c) => {
    const row = getMessage(c.account.id, c.params.id);
    db.run('DELETE FROM messages WHERE account_id = ? AND id = ?', c.account.id, row.id);
    events.publish(c.account.id, 'mail', { mailboxId: row.mailbox_id });
  });
}
