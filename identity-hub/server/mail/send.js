// POST /api/mail/send: outgoing mail.
// Recipients on our own domains are delivered inside the server. All other recipients go to the
// relay, or to the simulated outbox if no relay is configured.
import nodemailer from 'nodemailer';
import { fail, reply, need } from '../core/http.js';
import { nowSec, today } from '../core/db.js';
import { safeEqual } from '../core/keys.js';
import { parseAddress } from './address.js';
import { MAX_RECIPIENTS, readMessageFields } from './compose.js';

const ID = /^[A-Za-z0-9_-]{22}$/;
const OUTBOX_MAX = 200;
const OUTBOX_MAX_BYTES = 64 * 1024 * 1024;
const SEALED_KEY_BYTES = 126; // version(1) + ephemeral key(65) + iv(12) + content key(32) + tag(16)
const MAX_META_BYTES = 64 * 1024;
const MAX_COPY_PARTS = 51; // the body and up to 50 attachments

const notFound = () => fail(404, 'not_found', 'Not found.');

// The Sent copy that the browser encrypted. The server cannot read it; it checks sizes only.
function readCopy(value, maxBytes) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.parts) || value.parts.length < 1 || value.parts.length > MAX_COPY_PARTS) {
    throw fail(400, 'bad_request', 'The value "copy" is not valid.');
  }
  const copy = {
    sealedKey: need.bytes(value.sealedKey, 'copy.sealedKey', { min: SEALED_KEY_BYTES, max: SEALED_KEY_BYTES }),
    encMeta: need.bytes(value.encMeta, 'copy.encMeta', { min: 29, max: MAX_META_BYTES }),
    parts: value.parts.map((p) => need.bytes(p, 'copy.parts', { min: 29, max: maxBytes + 1024 })),
  };
  let size = copy.encMeta.length;
  for (const p of copy.parts) size += p.length;
  if (size > maxBytes + MAX_META_BYTES) throw fail(413, 'too_large', 'The message is too large.');
  copy.size = size + copy.sealedKey.length;
  return copy;
}

export function registerSend(app, { data, inbound, compose, outbox }) {
  const { http, db, config, events, log } = app;
  const maxBytes = config.mail.maxMessageBytes;
  const ownDomains = new Set(config.mail.domains);

  const relay = config.mail.relayUrl
    ? nodemailer.createTransport({
      url: config.mail.relayUrl, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
      disableFileAccess: true, disableUrlAccess: true,
    })
    : null;
  if (relay) app.onStop(() => relay.close());
  else if (config.production) log.warn('No mail relay is set (SMTP_RELAY_URL). Mail to other servers is not sent.');

  // The simulated outbox lives in memory. It keeps the newest messages, within a size limit.
  function trimOutbox() {
    let bytes = 0;
    for (const m of outbox) bytes += m.raw.length;
    while (outbox.length > OUTBOX_MAX || (bytes > OUTBOX_MAX_BYTES && outbox.length > 1)) bytes -= outbox.shift().raw.length;
  }

  // Takes one send from the daily allowance. Throws 429 when the allowance is used up.
  function countSend(accountId) {
    const day = today();
    db.tx(() => {
      db.run('DELETE FROM send_counts WHERE account_id = ? AND day < ?', accountId, day);
      const row = db.get('SELECT n FROM send_counts WHERE account_id = ? AND day = ?', accountId, day);
      const limit = config.limits.sendPerDay; // 0 means no limit
      if (limit > 0 && row && row.n >= limit) {
        throw fail(429, 'send_limit', 'You reached the limit of messages for today. Try again tomorrow.');
      }
      db.run('INSERT INTO send_counts (account_id, day, n) VALUES (?,?,1) ON CONFLICT (account_id, day) DO UPDATE SET n = n + 1', accountId, day);
    });
    return () => db.run('UPDATE send_counts SET n = n - 1 WHERE account_id = ? AND day = ? AND n > 0', accountId, day);
  }
  // Counters of past days have no use.
  app.every('mail-send-counts', 86400, async () => { db.run('DELETE FROM send_counts WHERE day < ?', today()); });

  http.post('/api/mail/send', { auth: true, limit: Math.ceil(maxBytes * 1.5), rate: { max: 30, per: 60 } }, async (c) => {
    const b = c.body;
    const accountId = c.account.id;
    const addressId = need.string(b.addressId, 'addressId', { min: 22, max: 22, pattern: ID });
    const from = parseAddress(need.string(b.from, 'from', { min: 3, max: 254 }));
    if (!from || !ownDomains.has(from.domain)) throw fail(400, 'bad_request', 'The value "from" is not valid.');
    const fields = readMessageFields(b, maxBytes);
    const copy = readCopy(b.copy, maxBytes);

    // All recipients, each one time.
    const recipients = [...new Map([...fields.to, ...fields.cc, ...fields.bcc].map((r) => [r.address, r])).values()];
    if (recipients.length === 0) throw fail(400, 'bad_recipient', 'Add a recipient.');
    if (recipients.length > MAX_RECIPIENTS) throw fail(400, 'bad_recipient', `A message can have ${MAX_RECIPIENTS} recipients at most.`);

    // The browser sends the plain address. The server has only its keyed hash and compares.
    const sender = db.get(
      `SELECT a.address_hmac AS hmac, a.enabled, a.mailbox_id AS mailboxId, m.status
       FROM addresses a JOIN mailboxes m ON m.id = a.mailbox_id WHERE a.id = ? AND a.account_id = ?`,
      addressId, accountId,
    );
    if (!sender) throw notFound();
    if (!safeEqual(sender.hmac, data.hmac(from.address))) throw fail(400, 'bad_request', 'The value "from" does not match the address.');
    if (!sender.enabled) throw fail(409, 'conflict', 'This address is turned off. Turn it on to send mail.');
    if (sender.status !== 'active') throw fail(409, 'conflict', 'This mailbox is suspended. Add funds to send mail.');
    if (copy && !data.hasRoom(sender.mailboxId, copy.size)) throw fail(409, 'limit_reached', 'This mailbox is full. Delete messages first.');

    // Our own addresses are checked before anything is sent.
    const local = recipients.filter((r) => ownDomains.has(r.domain)).map((r) => r.address);
    const external = recipients.filter((r) => !ownDomains.has(r.domain)).map((r) => r.address);
    for (const address of local) {
      const verdict = inbound.check(address);
      if (verdict.ok) continue;
      throw fail(400, 'bad_recipient', verdict.reason === 'unknown'
        ? `This address does not exist: ${address}`
        : `This address cannot receive mail now: ${address}`);
    }

    const raw = await compose({
      from: from.address, fromName: fields.fromName,
      to: fields.to.map((r) => r.address), cc: fields.cc.map((r) => r.address),
      envelopeTo: recipients.map((r) => r.address),
      subject: fields.subject, text: fields.text, html: fields.html,
      inReplyTo: fields.inReplyTo, references: fields.references, attachments: fields.attachments,
    });

    const undoCount = countSend(accountId);

    // The relay goes first. If it fails, nothing was delivered and the user can try again.
    if (external.length > 0) {
      if (relay) {
        try {
          await relay.sendMail({ envelope: { from: from.address, to: external }, raw });
        } catch (err) {
          undoCount();
          // The error text of the relay can hold addresses. Log the codes only.
          log.error('mail relay failed', { code: err && err.code, responseCode: err && err.responseCode });
          throw fail(502, 'send_failed', 'The message was not sent. Try again later.');
        }
      } else {
        outbox.push({ accountId, from: from.address, to: external, subject: fields.subject, at: nowSec(), raw });
        trimOutbox();
      }
    }

    if (local.length > 0) {
      const result = await inbound.deliver({ from: from.address, to: local, raw });
      // An address was deleted in the last moment and no other recipient got the message.
      if (result.accepted.length === 0 && external.length === 0) {
        undoCount();
        throw fail(400, 'bad_recipient', `This address does not exist: ${result.rejected[0]}`);
      }
    }

    let id = null;
    if (copy) {
      try {
        id = data.insertMessage({ accountId, mailboxId: sender.mailboxId, addressId, direction: 'out', seen: true, env: copy });
        events.publish(accountId, 'mail', { mailboxId: sender.mailboxId });
      } catch (err) {
        // The message is out already. A mailbox that was deleted in the last moment must not turn that into an error.
        if (!String(err && err.message).includes('FOREIGN KEY')) throw err;
      }
    }
    return reply(201, { id });
  });
}
