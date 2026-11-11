// Incoming mail: parse the message, encrypt it for each recipient, store it.
// SMTP, local delivery, and the development route all use deliver().
// The plain message lives in memory only. It is never written to disk and never logged.
import { simpleParser } from 'mailparser';
import { sealEnvelope } from '../../shared/crypto.js';
import { quietError } from './errors.js';
import { listInfo } from './listinfo.js';

// The server does no conversion between text and HTML: `text` and `html` hold only what the
// sender wrote. This keeps the work for a message from a stranger small.
const PARSER_OPTIONS = {
  skipHtmlToText: true,
  skipTextToHtml: true,
  skipTextLinks: true,
  keepCidLinks: true,     // inline images stay attachments; the browser links them by `cid`
  checksumAlgo: false,
};
const MAX_PEOPLE = 100;
const SNIPPET_CHARS = 160;

const clip = (s, max) => (typeof s === 'string' ? (s.length > max ? s.slice(0, max) : s) : '');

// AddressObject | AddressObject[] | undefined -> [{ name, address }]. Groups become their members.
function people(header) {
  const out = [];
  const walk = (list) => {
    for (const entry of list || []) {
      if (out.length >= MAX_PEOPLE) return;
      if (entry.group) walk(entry.group);
      else if (entry.address || entry.name) out.push({ name: clip(entry.name, 200), address: clip(entry.address, 320).toLowerCase() });
    }
  };
  for (const obj of [].concat(header || [])) walk(obj && obj.value);
  return out;
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// Removes tags from HTML in one pass. The time is linear in the input size, also for broken HTML.
// The result is used for the short preview only, never shown as HTML.
export function stripHtml(html) {
  const src = html.length > 100_000 ? html.slice(0, 100_000) : html;
  // Lower case for ASCII letters only, so that positions stay the same in both strings.
  const lower = src.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
  let out = '';
  let i = 0;
  while (i < src.length && out.length < 20_000) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { out += src.slice(i); break; }
    out += src.slice(i, lt) + ' ';
    if (lower.startsWith('<!--', lt)) {
      const close = src.indexOf('-->', lt + 4);
      if (close < 0) break;
      i = close + 3;
      continue;
    }
    // The content of these elements is not text of the message. Skip to the closing tag.
    const block = /^<(style|script|head|title)[\s>]/.exec(lower.slice(lt, lt + 8));
    let from = lt;
    if (block) {
      from = lower.indexOf('</' + block[1], lt);
      if (from < 0) break;
    }
    const gt = src.indexOf('>', from);
    if (gt < 0) break;
    i = gt + 1;
  }
  return out
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (m, name) => ENTITIES[name.toLowerCase()])
    .replace(/&#(\d{1,7});/g, (m, n) => (Number(n) > 31 && Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : ' '));
}

// First characters of the text with white space collapsed. Falls back to the HTML when there is no text.
export function makeSnippet(text, html) {
  let source = typeof text === 'string' ? text.slice(0, 20_000) : '';
  if (!source.trim() && typeof html === 'string') source = stripHtml(html);
  // Array.from keeps characters outside the basic plane in one piece.
  return Array.from(source.replace(/\s+/g, ' ').trim()).slice(0, SNIPPET_CHARS).join('');
}

// The addresses in the From header and in the Sender header, for the check of blocked senders.
// They are taken in full length: a cut address could lose its domain.
const MAX_HEADER_SENDERS = 20;
function headerSenders(mail) {
  const found = new Set();
  const walk = (list) => {
    for (const entry of list || []) {
      if (found.size >= MAX_HEADER_SENDERS) return;
      if (entry && entry.group) walk(entry.group);
      else if (entry && typeof entry.address === 'string' && entry.address) found.add(entry.address.toLowerCase());
    }
  };
  for (const header of [mail.from, mail.headers && mail.headers.get('sender')]) {
    for (const obj of [].concat(header || [])) walk(obj && obj.value);
  }
  return [...found];
}

// A file name from a stranger: no path, no control characters.
function safeFilename(name, index) {
  const clean = clip(name, 255).replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim();
  return clean || `attachment-${index + 1}`;
}

// Turns a parsed message into the parts of the envelope (docs/API.md section 1).
function buildContent(mail) {
  const html = typeof mail.html === 'string' && mail.html ? mail.html : null;
  const text = typeof mail.text === 'string' ? mail.text : '';
  const files = mail.attachments || [];
  const date = mail.date instanceof Date && !Number.isNaN(mail.date.getTime()) ? mail.date : new Date();
  const list = listInfo(mail);
  const meta = {
    from: people(mail.from)[0] || { name: '', address: '' },
    to: people(mail.to),
    cc: people(mail.cc),
    subject: clip(mail.subject, 998),
    date: date.toISOString(),
    snippet: makeSnippet(text, html),
    deliveredTo: '',
    bulk: list.bulk,
    attachments: files.map((f, i) => {
      const item = { filename: safeFilename(f.filename, i), contentType: clip(f.contentType, 255).toLowerCase() || 'application/octet-stream', size: f.content.length };
      if (f.cid) item.cid = clip(f.cid, 255);
      return item;
    }),
  };
  const body = {
    text,
    html,
    messageId: clip(mail.messageId, 998) || null,
    inReplyTo: clip(mail.inReplyTo, 998) || null,
    references: [].concat(mail.references || []).slice(0, 100).map((r) => clip(r, 998)),
    replyTo: people(mail.replyTo),
    unsubscribe: list.unsubscribe,
  };
  return { meta, body, attachments: files.map((f) => f.content) };
}

export function createInbound(app, data) {
  const { db, store, events } = app;

  // Tells if an address can get mail now. reason: 'unknown' | 'blocked' | 'suspended' | 'full'.
  // An alias that is turned off, used up, or past its end date answers like an address that does not exist.
  // `sender` is the envelope sender, if there is one. The address can have a block for it.
  // A refusal that is final for an address that exists has `countable: true` (see countRefusal).
  function check(address, sender = '') {
    if (typeof address !== 'string' || address.length < 3 || address.length > 254) return { ok: false, reason: 'unknown' };
    const row = data.route(address);
    if (!row) return { ok: false, reason: 'unknown' };
    if (!data.isOn(row)) return { ok: false, reason: 'unknown', addressId: row.addressId, countable: true };
    // A block is final, so it is answered before the states that can change (suspended, full).
    if (sender && data.isBlocked(row.addressId, sender)) return { ok: false, reason: 'blocked', addressId: row.addressId, countable: true };
    if (row.status !== 'active') return { ok: false, reason: 'suspended' };
    if (!data.hasRoom(row.mailboxId)) return { ok: false, reason: 'full' };
    return { ok: true, addressId: row.addressId, accountId: row.accountId, mailboxId: row.mailboxId };
  }

  // Counts one refused message for the address of a refusal. The caller calls it one time for each
  // message and recipient. Nothing is counted for an unknown address or for a temporary refusal.
  function countRefusal(verdict) {
    if (verdict && verdict.countable && verdict.addressId) data.countRefused(verdict.addressId);
  }

  // Stores the sealed message if the address can still get mail. The address can change
  // while the message is parsed and encrypted, so the check runs again in the transaction.
  // A one-shot alias is turned off in the same transaction: a second message that arrives at the
  // same moment finds it off. Returns { id, mailboxId, usedUp } or { off } if nothing was stored.
  function storeFor(target, env) {
    return db.tx(() => {
      const now = db.get(
        `SELECT a.mailbox_id AS mailboxId, a.enabled, a.expires_at AS expiresAt, a.one_shot AS oneShot, m.status
         FROM addresses a JOIN mailboxes m ON m.id = a.mailbox_id WHERE a.id = ? AND a.account_id = ?`,
        target.addressId, target.accountId,
      );
      if (!now) return { off: false };                       // deleted in the meantime
      if (!data.isOn(now)) return { off: true };              // turned off, used up, or ended in the meantime
      if (now.status !== 'active') return { off: false };     // suspended in the meantime
      const id = data.insertMessage({ accountId: target.accountId, mailboxId: now.mailboxId, addressId: target.addressId, direction: 'in', seen: false, env });
      const usedUp = now.oneShot === 1;
      db.run(
        usedUp
          ? 'UPDATE addresses SET received = received + 1, enabled = 0, used_up = 1 WHERE id = ? AND account_id = ?'
          : 'UPDATE addresses SET received = received + 1 WHERE id = ? AND account_id = ?',
        target.addressId, target.accountId,
      );
      return { id, mailboxId: now.mailboxId, usedUp };
    });
  }

  // Delivers one raw message to our own addresses in `to`. `from` is the envelope sender ('' for a bounce).
  // Returns { accepted: [address], rejected: [address], reasons: { address: reason } }.
  async function deliver({ from = '', to, raw }) {
    const accepted = [];
    const rejected = [];
    const reasons = {};
    const targets = [];
    const refuse = (address, reason) => { rejected.push(address); reasons[address] = reason; };
    const envelopeSender = typeof from === 'string' ? from : '';
    for (const item of new Set([].concat(to || []).map((a) => String(a).toLowerCase()))) {
      const verdict = check(item, envelopeSender);
      if (verdict.ok) targets.push({ address: item, ...verdict });
      else { countRefusal(verdict); refuse(item, verdict.reason); }
    }
    if (targets.length === 0) return { accepted, rejected, reasons };

    let content;
    let writers;
    try {
      const mail = await simpleParser(Buffer.isBuffer(raw) ? raw : Buffer.from(raw), PARSER_OPTIONS);
      content = buildContent(mail);
      writers = headerSenders(mail);
    } catch {
      // For example: more MIME parts than the parser allows. To try again does not help.
      throw quietError('The message could not be parsed.', 'EPARSE');
    }
    for (const target of targets) {
      // The From line can name a different sender than the envelope. A block counts for both.
      if (writers.some((sender) => data.isBlocked(target.addressId, sender))) {
        data.countRefused(target.addressId);
        refuse(target.address, 'blocked');
        continue;
      }
      const account = store.getAccount(target.accountId);
      if (!account) { refuse(target.address, 'unknown'); continue; }
      // Each recipient gets an own content key. One account cannot open the copy of another account.
      const env = await sealEnvelope(account.publicKey, {
        meta: { ...content.meta, deliveredTo: target.address }, body: content.body, attachments: content.attachments,
      });
      const stored = storeFor(target, env);
      if (!stored.id) {
        if (stored.off) data.countRefused(target.addressId);
        refuse(target.address, 'unknown');
        continue;
      }
      accepted.push(target.address);
      events.publish(target.accountId, 'mail', { mailboxId: stored.mailboxId });
      // The list of aliases shows a one-shot alias as used up now.
      if (stored.usedUp) events.publish(target.accountId, 'aliases');
    }
    return { accepted, rejected, reasons };
  }

  return { check, countRefusal, deliver };
}
