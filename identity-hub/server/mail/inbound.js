// Incoming mail: parse the message, encrypt it for each recipient, store it.
// SMTP, local delivery, and the development route all use deliver().
// The plain message lives in memory only. It is never written to disk and never logged.
import { simpleParser } from 'mailparser';
import { sealEnvelope } from '../../shared/crypto.js';
import { quietError } from './errors.js';

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
  const meta = {
    from: people(mail.from)[0] || { name: '', address: '' },
    to: people(mail.to),
    cc: people(mail.cc),
    subject: clip(mail.subject, 998),
    date: date.toISOString(),
    snippet: makeSnippet(text, html),
    deliveredTo: '',
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
  };
  return { meta, body, attachments: files.map((f) => f.content) };
}

export function createInbound(app, data) {
  const { db, store, events } = app;

  // Tells if an address can get mail now. reason: 'unknown' | 'suspended' | 'full'.
  // A disabled alias answers like an address that does not exist.
  function check(address) {
    if (typeof address !== 'string' || address.length < 3 || address.length > 254) return { ok: false, reason: 'unknown' };
    const row = data.route(address);
    if (!row || !row.enabled) return { ok: false, reason: 'unknown' };
    if (row.status !== 'active') return { ok: false, reason: 'suspended' };
    if (!data.hasRoom(row.mailboxId)) return { ok: false, reason: 'full' };
    return { ok: true, addressId: row.addressId, accountId: row.accountId, mailboxId: row.mailboxId };
  }

  // Stores the sealed message if the address can still get mail. The address can change
  // while the message is parsed and encrypted, so the check runs again in the transaction.
  function storeFor(target, env) {
    return db.tx(() => {
      const now = db.get(
        `SELECT a.mailbox_id AS mailboxId, a.enabled, m.status FROM addresses a JOIN mailboxes m ON m.id = a.mailbox_id
         WHERE a.id = ? AND a.account_id = ?`,
        target.addressId, target.accountId,
      );
      if (!now || !now.enabled || now.status !== 'active') return null;
      const id = data.insertMessage({ accountId: target.accountId, mailboxId: now.mailboxId, addressId: target.addressId, direction: 'in', seen: false, env });
      db.run('UPDATE addresses SET received = received + 1 WHERE id = ? AND account_id = ?', target.addressId, target.accountId);
      return { id, mailboxId: now.mailboxId };
    });
  }

  // Delivers one raw message to our own addresses in `to`.
  // Returns { accepted: [address], rejected: [address], reasons: { address: reason } }.
  async function deliver({ to, raw }) {
    const accepted = [];
    const rejected = [];
    const reasons = {};
    const targets = [];
    const refuse = (address, reason) => { rejected.push(address); reasons[address] = reason; };
    for (const item of new Set([].concat(to || []).map((a) => String(a).toLowerCase()))) {
      const verdict = check(item);
      if (verdict.ok) targets.push({ address: item, ...verdict });
      else refuse(item, verdict.reason);
    }
    if (targets.length === 0) return { accepted, rejected, reasons };

    let content;
    try {
      content = buildContent(await simpleParser(Buffer.isBuffer(raw) ? raw : Buffer.from(raw), PARSER_OPTIONS));
    } catch {
      // For example: more MIME parts than the parser allows. To try again does not help.
      throw quietError('The message could not be parsed.', 'EPARSE');
    }
    for (const target of targets) {
      const account = store.getAccount(target.accountId);
      if (!account) { refuse(target.address, 'unknown'); continue; }
      // Each recipient gets an own content key. One account cannot open the copy of another account.
      const env = await sealEnvelope(account.publicKey, {
        meta: { ...content.meta, deliveredTo: target.address }, body: content.body, attachments: content.attachments,
      });
      const stored = storeFor(target, env);
      if (!stored) { refuse(target.address, 'unknown'); continue; }
      accepted.push(target.address);
      events.publish(target.accountId, 'mail', { mailboxId: stored.mailboxId });
    }
    return { accepted, rejected, reasons };
  }

  return { check, deliver };
}
