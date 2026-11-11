// Mail: read (decrypt) and send (with a browser-encrypted Sent copy).
import { api, query } from './api.js';
import { store } from './store.js';
import { getKeys } from './session.js';
import { b64u, unb64u } from '/shared/bytes.js';
import { openContentKey, openMeta, openBody, openAttachment, sealEnvelope } from '/shared/crypto.js';

// message id -> content key (CryptoKey). Memory only.
const contentKeys = new Map();

async function contentKey(msg) {
  if (contentKeys.has(msg.id)) return contentKeys.get(msg.id);
  const key = await openContentKey(getKeys(), unb64u(msg.sealedKey));
  if (contentKeys.size > 2000) contentKeys.clear();
  contentKeys.set(msg.id, key);
  return key;
}

const EMPTY_META = { from: { name: '', address: '' }, to: [], cc: [], subject: '', date: '', snippet: '', deliveredTo: '', attachments: [] };

async function decodeMessage(m) {
  let meta = null;
  let broken = false;
  try {
    meta = await openMeta(await contentKey(m), unb64u(m.encMeta));
  } catch { broken = true; }
  meta = { ...EMPTY_META, ...(meta && typeof meta === 'object' ? meta : {}) };
  if (!meta.from || typeof meta.from !== 'object') meta.from = { name: '', address: '' };
  for (const k of ['to', 'cc', 'attachments']) if (!Array.isArray(meta[k])) meta[k] = [];
  return {
    id: m.id, mailboxId: m.mailboxId, addressId: m.addressId, direction: m.direction, at: m.at, seen: !!m.seen,
    size: m.size || 0, attachments: m.attachments || 0, meta, broken, sealedKey: m.sealedKey,
  };
}

export async function listMessages({ mailboxId, direction, before, beforeId, limit = 50 } = {}) {
  const res = await api.get('/api/messages' + query({ mailboxId, direction, before, beforeId, limit }));
  const messages = await Promise.all((res.messages || []).map(decodeMessage));
  return { messages, more: !!res.more };
}

export async function getMessage(id) {
  const { message } = await api.get(`/api/messages/${id}`);
  const decoded = await decodeMessage(message);
  let body = { text: '', html: null, messageId: null, inReplyTo: null, references: [], replyTo: [] };
  try {
    const opened = await openBody(await contentKey(message), unb64u(message.body));
    body = { ...body, ...(opened && typeof opened === 'object' ? opened : {}) };
  } catch { decoded.broken = true; }
  if (!Array.isArray(body.references)) body.references = [];
  if (!Array.isArray(body.replyTo)) body.replyTo = [];
  return { ...decoded, body };
}

// Downloads and decrypts attachment number `index` (1 = first attachment).
export async function getAttachment(msg, index) {
  const bytes = await api.bytes(`/api/messages/${msg.id}/parts/${index}`);
  return openAttachment(await contentKey(msg), bytes, index);
}

export async function setSeen(id, seen) {
  await api.patch(`/api/messages/${id}`, { seen });
}

export async function deleteMessage(id) {
  await api.del(`/api/messages/${id}`);
  contentKeys.delete(id);
}

export const snippetOf = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);

// The largest total attachment size for one message. The request also carries the
// encrypted Sent copy, so the attachments travel two times.
export function attachmentLimit() {
  const c = store.get('config');
  const max = (c && c.limits && c.limits.maxMessageBytes) || 15 * 1024 * 1024;
  return Math.floor(max * 0.5);
}

// from = { addressId, address }. attachments = [{ filename, contentType, bytes: Uint8Array }]
export async function sendMail({ from, to, cc = [], bcc = [], subject, text, attachments = [], inReplyTo = null, references = [] }) {
  const keys = getKeys();
  const person = (address) => ({ name: '', address });
  const meta = {
    from: person(from.address),
    to: to.map(person),
    cc: cc.map(person),
    bcc: bcc.map(person),
    subject,
    date: new Date().toISOString(),
    snippet: snippetOf(text),
    deliveredTo: from.address,
    attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.bytes.length })),
  };
  const body = { text, html: null, messageId: null, inReplyTo, references, replyTo: [] };
  const env = await sealEnvelope(keys.publicKey, { meta, body, attachments: attachments.map((a) => a.bytes) });
  const res = await api.post('/api/mail/send', {
    addressId: from.addressId,
    from: from.address,
    fromName: '',
    to, cc, bcc,
    subject,
    text,
    html: null,
    inReplyTo,
    references,
    attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: b64u(a.bytes) })),
    copy: { sealedKey: b64u(env.sealedKey), encMeta: b64u(env.encMeta), parts: env.parts.map((p) => b64u(p)) },
  });
  return res ? res.id : null;
}

export const personText = (p) => {
  if (!p) return '';
  if (p.name && p.address) return `${p.name} <${p.address}>`;
  return p.name || p.address || '';
};
export const personShort = (p) => (p ? (p.name || p.address || '') : '');

// A safe file name for a download.
export function safeFilename(name, fallback = 'attachment') {
  const clean = String(name || '').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
  return clean || fallback;
}

// Types that the browser may open in a new context. Everything else is saved as a plain file.
export function downloadBlob(bytes, filename, contentType = 'application/octet-stream') {
  // The type is forced to a download type so that the browser never renders the file as a page.
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename(filename);
  a.rel = 'noopener';
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return contentType;
}
