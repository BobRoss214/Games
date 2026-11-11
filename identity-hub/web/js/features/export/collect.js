// Collects the data of the account for an export file. No screen code here.
//
// Two steps:
//   1. surveyExport()  reads the lists (items, mail list, texts, calls). The result gives the
//                      counts and the sizes for the estimate before the export starts.
//   2. buildExport()   fetches each mail body, attachment and voicemail, opens it in this
//                      browser, and gives the plain bytes to the export writer, which encrypts
//                      them again for the file (lib/exportfile.js).
//
// Everything comes through the normal API routes with GET, and is opened with the helpers
// that the screens use. Nothing plain is sent to the server. Nothing is written to browser storage.
// The server gets at most CONCURRENCY requests at the same time, and a "too many requests"
// answer makes this code wait longer each time.
import { api, ApiError, query } from '../../lib/api.js';
import { store, appName } from '../../lib/store.js';
import { getKeys, openSealed } from '../../lib/session.js';
import { loadMailboxes, loadAliases, loadNumbers, loadPhones } from '../../lib/data.js';
import { loadIdentities } from '../../lib/identities.js';
import { listMessages, getMessage, getAttachment } from '../../lib/mail.js';
import { listTexts } from '../../lib/phone.js';
import { isPersona } from '../../lib/persona/index.js';
import { createExportWriter, estimateExportBytes } from '../../lib/exportfile.js';
import { loadVoicemailAudio } from '../voicemail/calls.js';
import { NEVER_INCLUDED } from '../export.js';
import { unb64u, utf8 } from '/shared/bytes.js';

export const CONCURRENCY = 3;
const MAIL_PAGE = 100;
const PHONE_PAGE = 200;
// The typical size of a mail body when the message also has attachments (for the estimate only).
const BODY_GUESS = 40 * 1024;

const cancelled = () => new DOMException('The export was cancelled.', 'AbortError');
const text = (v) => (typeof v === 'string' ? v : '');
const person = (p) => ({ name: text(p && p.name), address: text(p && p.address) });
const people = (list) => (Array.isArray(list) ? list.filter((p) => p && typeof p === 'object').map(person) : []);
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);

// Runs one request. Waits and tries again when the server says "too many requests" or cannot be reached.
function makeGentle({ signal, onWait }) {
  const state = { failed: false };
  const check = () => { if (signal && signal.aborted) throw cancelled(); if (state.failed) throw cancelled(); };
  const sleep = (ms) => new Promise((resolve, reject) => {
    const t = setTimeout(done, ms);
    function done() { if (signal) signal.removeEventListener('abort', stop); resolve(); }
    function stop() { clearTimeout(t); reject(cancelled()); }
    if (signal) signal.addEventListener('abort', stop, { once: true });
  });
  async function gentle(fn) {
    for (let attempt = 0; ; attempt++) {
      check();
      try {
        return await fn();
      } catch (err) {
        const slow = err instanceof ApiError && err.status === 429;
        const away = err instanceof ApiError && (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504);
        if ((!slow && !away) || attempt >= (slow ? 6 : 3)) throw err;
        if (onWait) onWait(true);
        try { await sleep(Math.min(30_000, 1500 * 2 ** attempt)); } finally { if (onWait) onWait(false); }
      }
    }
  }
  // Runs worker(item, index) for every item, `CONCURRENCY` at a time. The first error stops the rest.
  async function pool(items, worker) {
    let next = 0;
    const run = async () => {
      while (next < items.length) {
        check();
        const i = next++;
        try { await worker(items[i], i); } catch (err) { state.failed = true; throw err; }
      }
    };
    const runs = Array.from({ length: Math.min(CONCURRENCY, items.length) }, run);
    const results = await Promise.allSettled(runs);
    const bad = results.find((r) => r.status === 'rejected' && !(r.reason && r.reason.name === 'AbortError')) || results.find((r) => r.status === 'rejected');
    if (bad) throw bad.reason;
  }
  return { gentle, pool, check };
}

// ---------- step 1: the lists ----------

// onProgress({ part: 'items' | 'mail' | 'texts' | 'calls' | 'blocks', done, total? })
export async function surveyExport({ signal = null, onProgress = () => {}, onWait = null } = {}) {
  if (!getKeys()) throw new Error('The app is locked. Unlock it, then start the export again.');
  const { gentle, pool, check } = makeGentle({ signal, onWait });
  const config = store.get('config') || {};
  const phoneOn = !!(config.features && config.features.phone);

  // The items, fresh from the server and opened by the shared loaders.
  onProgress({ part: 'items', done: 0 });
  const [mailboxes, aliases, numbers, phones, identities] = await Promise.all([
    gentle(() => loadMailboxes()), gentle(() => loadAliases()), gentle(() => loadNumbers()), gentle(() => loadPhones()), gentle(() => loadIdentities()),
  ]);
  check();
  // Two fields that the shared loaders do not pass on yet: the end date of an alias and the count of blocks.
  const [rawAliases, rawBoxes] = await Promise.all([gentle(() => api.get('/api/aliases', { signal })), gentle(() => api.get('/api/mailboxes', { signal }))]);
  const aliasRaw = new Map(((rawAliases && rawAliases.aliases) || []).map((a) => [a.id, a]));
  const boxRaw = new Map(((rawBoxes && rawBoxes.mailboxes) || []).map((m) => [m.id, m]));

  // The mail list: every page, newest first. The list has the head of each message (from, subject, size).
  const mail = [];
  let brokenMail = 0;
  for (let before, beforeId, more = true; more;) {
    const page = await gentle(() => listMessages({ before, beforeId, limit: MAIL_PAGE }));
    for (const m of page.messages) { if (m.broken) brokenMail++; else mail.push(m); }
    onProgress({ part: 'mail', done: mail.length });
    const last = page.messages[page.messages.length - 1];
    more = page.more && !!last;
    if (last) { before = last.at; beforeId = last.id; }
  }

  // Texts and calls of each number.
  const texts = [];
  const calls = [];
  let brokenTexts = 0;
  if (phoneOn) {
    await pool(numbers, async (n) => {
      for (let before, more = true; more;) {
        const page = await gentle(() => listTexts(n.id, { before, limit: PHONE_PAGE }));
        for (const t of page.texts) { if (t.broken) brokenTexts++; else texts.push({ ...t, numberId: n.id }); }
        onProgress({ part: 'texts', done: texts.length });
        const last = page.texts[page.texts.length - 1];
        more = page.more && !!last;
        if (last) before = last.at;
      }
      for (let before, more = true; more;) {
        const res = await gentle(() => api.get(`/api/numbers/${n.id}/calls` + query({ before, limit: PHONE_PAGE }), { signal }));
        const rows = (res && res.calls) || [];
        for (const c of rows) {
          const open = await openSealed(c.sealed, 'call');
          const vm = c.voicemail && typeof c.voicemail === 'object' ? c.voicemail : null;
          calls.push({ id: c.id, numberId: n.id, direction: c.direction === 'out' ? 'out' : 'in', at: count(c.at), seconds: count(c.seconds), status: text(c.status), peer: open ? text(open.peer) : '', voicemail: vm });
        }
        onProgress({ part: 'calls', done: calls.length });
        const last = rows[rows.length - 1];
        more = !!(res && res.more) && !!last;
        if (last) before = last.at;
      }
    });
  }

  // Blocked senders: only for the addresses that have some.
  const blockAddresses = [
    ...mailboxes.filter((m) => (boxRaw.get(m.id) || {}).blocks > 0).map((m) => m.addressId),
    ...aliases.filter((a) => (aliasRaw.get(a.id) || {}).blocks > 0).map((a) => a.id),
  ];
  const blocks = [];
  await pool(blockAddresses, async (addressId) => {
    const res = await gentle(() => api.get(`/api/addresses/${addressId}/blocks`, { signal }));
    for (const b of (res && res.blocks) || []) {
      const open = await openSealed(b.sealed, 'block');
      if (open && typeof open.value === 'string') blocks.push({ addressId, kind: open.kind === 'domain' ? 'domain' : 'address', value: open.value });
    }
    onProgress({ part: 'blocks', done: blocks.length });
  });
  check();

  const withFiles = mail.filter((m) => m.attachments > 0);
  const voicemails = calls.filter((c) => c.voicemail);
  const sizes = {
    mailBytes: mail.reduce((n, m) => n + count(m.size), 0),
    // Without attachments: the whole size of the messages that have none, and a typical body for the others.
    mailBytesLean: mail.reduce((n, m) => n + (m.attachments > 0 ? Math.min(count(m.size), BODY_GUESS) : count(m.size)), 0),
    voicemailBytes: voicemails.reduce((n, c) => n + count(c.voicemail.size), 0),
  };
  const itemCount = mailboxes.length + aliases.length + numbers.length + phones.length + identities.length + blocks.length;
  const estimate = (lean) => estimateExportBytes({
    mailCount: mail.length, textCount: texts.length, callCount: calls.length, itemCount,
    mailBytes: lean ? sizes.mailBytesLean : sizes.mailBytes, voicemailBytes: lean ? 0 : sizes.voicemailBytes,
  });
  return {
    mailboxes, aliases, numbers, phones, identities, aliasRaw, mail, texts, calls, blocks,
    broken: { mail: brokenMail, texts: brokenTexts },
    counts: {
      inboxes: mailboxes.length, aliases: aliases.length, numbers: numbers.length, phones: phones.length, identities: identities.length,
      mail: mail.length, attachments: withFiles.reduce((n, m) => n + m.attachments, 0), texts: texts.length, calls: calls.length, voicemails: voicemails.length, blocks: blocks.length,
    },
    estimate: { full: estimate(false), lean: estimate(true) },
  };
}

// ---------- step 2: the file ----------

export function exportFilename(appName, day) {
  const name = String(appName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'postern';
  return `${name}-export-${day}.postern`;
}
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// survey: the result of surveyExport(). lean: true leaves out attachments and voicemail audio.
// onProgress({ part: 'mail' | 'voicemail' | 'file', done, total })
// Returns { blob, filename, day, skipped: { mail, attachments, voicemails } }.
export async function buildExport(survey, { lean = false, signal = null, onProgress = () => {}, onWait = null } = {}) {
  const keys = getKeys();
  const account = store.get('account');
  if (!keys || !account) throw new Error('The app is locked. Unlock it, then start the export again.');
  const { gentle, pool, check } = makeGentle({ signal, onWait });
  const config = store.get('config') || {};
  // The header of the file has room for a short name.
  const app = appName().slice(0, 40);
  const day = localDay();
  const writer = createExportWriter({ accountKey: keys.accountKey, recoveryWrap: unb64u(account.recoveryWrap), appName: app, createdDay: day });
  const skipped = { mail: 0, attachments: 0, voicemails: 0 };

  // Mail: the body and each attachment of every message.
  const mailOut = new Array(survey.mail.length).fill(null);
  let mailDone = 0;
  onProgress({ part: 'mail', done: 0, total: survey.mail.length });
  await pool(survey.mail, async (m, i) => {
    let full;
    try {
      full = await gentle(() => getMessage(m.id));
    } catch (err) {
      // Deleted while the export ran (by the person in another tab, or by the automatic delete).
      if (!(err instanceof ApiError && err.status === 404)) throw err;
      full = null;
    }
    if (!full || full.broken) {
      skipped.mail++;
    } else {
      const meta = full.meta;
      const body = await writer.addBlob(utf8(JSON.stringify({ text: text(full.body.text), html: typeof full.body.html === 'string' ? full.body.html : null })));
      const attachments = [];
      for (let k = 0; k < full.attachments; k++) {
        const a = (meta.attachments && meta.attachments[k]) || {};
        const entry = { filename: text(a.filename) || `attachment-${k + 1}`, contentType: text(a.contentType) || 'application/octet-stream', size: count(a.size), blob: null };
        if (typeof a.cid === 'string' && a.cid) entry.cid = a.cid; // a picture that the message shows inside its text
        if (!lean) {
          try {
            const bytes = await gentle(() => getAttachment(full, k + 1));
            entry.blob = await writer.addBlob(bytes);
            entry.size = bytes.length;
          } catch (err) {
            if (err && err.name === 'AbortError') throw err;
            if (err instanceof ApiError && err.status !== 404) throw err;
            skipped.attachments++; // gone, or it does not open with the key
          }
        }
        attachments.push(entry);
      }
      mailOut[i] = {
        id: m.id, inboxId: text(m.mailboxId), addressId: m.addressId || null, direction: m.direction === 'out' ? 'out' : 'in', at: count(m.at), seen: !!m.seen,
        from: meta.from && (meta.from.name || meta.from.address) ? person(meta.from) : null, to: people(meta.to), cc: people(meta.cc), bcc: people(meta.bcc),
        subject: text(meta.subject), snippet: text(meta.snippet), deliveredTo: text(meta.deliveredTo), date: text(meta.date),
        body, attachments,
      };
    }
    mailDone++;
    onProgress({ part: 'mail', done: mailDone, total: survey.mail.length });
  });

  // Voicemail audio.
  const withVoicemail = survey.calls.filter((c) => c.voicemail);
  const audioOf = new Map(); // call id -> { contentType, blob }
  if (!lean && withVoicemail.length) {
    let done = 0;
    onProgress({ part: 'voicemail', done: 0, total: withVoicemail.length });
    await pool(withVoicemail, async (c) => {
      try {
        const audio = await gentle(() => loadVoicemailAudio(c.id, c.voicemail));
        audioOf.set(c.id, { contentType: audio.contentType || 'application/octet-stream', blob: await writer.addBlob(audio.bytes) });
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        if (err instanceof ApiError && err.status !== 404) throw err;
        skipped.voicemails++;
      }
      done++;
      onProgress({ part: 'voicemail', done, total: withVoicemail.length });
    });
  }
  check();

  // The list of contents.
  onProgress({ part: 'file', done: 0, total: 1 });
  const notIncluded = [...NEVER_INCLUDED];
  const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;
  if (lean && (survey.counts.attachments || survey.counts.voicemails)) notIncluded.push('Attachments and voicemail sound. You chose to leave them out. The file lists their names and sizes.');
  const lostMail = survey.broken.mail + skipped.mail;
  if (lostMail) notIncluded.push(`${many(lostMail, 'message', 'messages')} that this browser could not open, or that went away while the file was made.`);
  if (survey.broken.texts) notIncluded.push(`${many(survey.broken.texts, 'text', 'texts')} that this browser could not open.`);
  if (skipped.attachments) notIncluded.push(`${many(skipped.attachments, 'attachment', 'attachments')} that could not be read. The file lists the name.`);
  if (skipped.voicemails) notIncluded.push(`The sound of ${many(skipped.voicemails, 'voicemail', 'voicemails')} that could not be read.`);

  const identityIds = new Set(survey.identities.map((g) => g.id));
  const inGroup = (id) => (id && identityIds.has(id) ? id : null);
  const index = {
    v: 1, app, createdDay: day,
    inboxes: survey.mailboxes.map((m) => ({ id: m.id, address: text(m.address), label: text(m.label), note: text(m.note), status: text(m.status), addressId: text(m.addressId), createdDay: text(m.createdDay) })),
    aliases: survey.aliases.map((a) => {
      const raw = survey.aliasRaw.get(a.id) || {};
      return {
        id: a.id, address: text(a.address), inboxId: text(a.mailboxId), label: text(a.label), note: text(a.note), enabled: !!a.enabled,
        identityId: inGroup(a.identityId), persona: isPersona(a.persona) ? a.persona : null, expiresAt: Number.isSafeInteger(raw.expiresAt) && raw.expiresAt > 0 ? raw.expiresAt : null,
        createdDay: text(a.createdDay), oneShot: !!raw.oneShot,
      };
    }),
    numbers: survey.numbers.map((n) => ({
      id: n.id, number: text(n.number), label: text(n.label), note: text(n.note), identityId: inGroup(n.identityId), persona: isPersona(n.persona) ? n.persona : null,
      country: text(n.country), status: text(n.status), createdDay: text(n.createdDay),
    })),
    phones: survey.phones.map((p) => ({ id: p.id, number: text(p.number), label: text(p.label) })),
    identities: survey.identities.map((g) => ({ id: g.id, name: text(g.name), note: text(g.note), persona: isPersona(g.persona) ? g.persona : null, createdDay: text(g.createdDay) })),
    mail: mailOut.filter(Boolean),
    texts: survey.texts.map((t) => ({ id: t.id, numberId: t.numberId, direction: t.direction === 'out' ? 'out' : 'in', at: count(t.at), peer: text(t.peer), body: text(t.body), status: t.status || null })),
    calls: survey.calls.map((c) => {
      const audio = audioOf.get(c.id);
      return {
        id: c.id, numberId: c.numberId, direction: c.direction, at: c.at, seconds: c.seconds, status: c.status, peer: c.peer,
        voicemail: c.voicemail ? { seconds: count(c.voicemail.seconds), contentType: audio ? audio.contentType : '', blob: audio ? audio.blob : null } : null,
      };
    }),
    blocks: survey.blocks,
    notIncluded,
  };
  const blob = await writer.finish(index);
  check();
  onProgress({ part: 'file', done: 1, total: 1 });
  return { blob, filename: exportFilename(app, day), day, skipped, counts: { mail: index.mail.length, texts: index.texts.length, calls: index.calls.length } };
}
