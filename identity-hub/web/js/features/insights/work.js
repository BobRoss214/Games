// What "My stats" and "Who leaked me" work out from the mail that the browser read.
//
// This file reads lists and counts. It has no access to the page, to the network, or to
// storage, so it also runs in Node.js, where the tests use it.
// The counting rules are in lib/stats.js. The rules for a hint are in lib/leak.js.
import { mailStats } from '../../lib/stats.js';
import { review, addKnown } from '../../lib/leak.js';

export const MAIL_LIMIT = 1000; // the two screens read the newest mails up to this number
const PAGE = 100;               // the most that the server gives in one answer

// Reads the newest incoming mail, the newest first, through `list` (listMessages of lib/mail.js).
// Keeps only what the counting needs: { id, addressId, fromAddress, at }.
// Returns { messages, read, complete }, or null when `stopped()` says that nobody waits for it.
//   read: how many mails the server gave (a mail that the browser cannot open is in `read` only).
//   complete: true = this is all the incoming mail. false = there is older mail that was not read.
export async function readNewestMail(list, { limit = MAIL_LIMIT, onProgress = () => {}, stopped = () => false } = {}) {
  const messages = [];
  let read = 0;
  let more = true;
  let before;
  let beforeId;
  while (more && read < limit) {
    if (stopped()) return null;
    const res = await list({ direction: 'in', limit: Math.min(PAGE, limit - read), before, beforeId });
    if (stopped()) return null;
    const page = res && Array.isArray(res.messages) ? res.messages : [];
    for (const m of page) {
      if (!m || m.broken || !Number.isFinite(m.at)) continue;
      const from = m.meta && m.meta.from && typeof m.meta.from.address === 'string' ? m.meta.from.address : '';
      messages.push({ id: m.id, addressId: typeof m.addressId === 'string' ? m.addressId : '', fromAddress: from, at: m.at });
    }
    read += page.length;
    more = !!(res && res.more) && page.length > 0;
    if (page.length) {
      const last = page[page.length - 1];
      before = last.at;
      beforeId = last.id;
    }
    onProgress(read);
  }
  return { messages, read, complete: !more };
}

// "My stats". aliases: the alias list of the store.
// Returns { total, aliases: [{ alias, count, lastAt }], senders: [{ domain, count, lastAt }] }, the largest count first.
// Mail to the address of an inbox, or to an alias that was deleted, is in `total` and in `senders` only.
export function statsView(messages, aliases) {
  const stats = mailStats(messages);
  const byId = new Map((Array.isArray(aliases) ? aliases : []).map((a) => [a.id, a]));
  return {
    total: stats.total,
    aliases: stats.byAddress.filter((row) => byId.has(row.addressId)).map((row) => ({ alias: byId.get(row.addressId), count: row.count, lastAt: row.lastAt })),
    senders: stats.bySender,
  };
}

// The sender domains that an alias knows (its encrypted extra field "senders"), checked:
// another version of the app may have written them.
export function knownOf(alias) {
  const list = alias && alias.extra && Array.isArray(alias.extra.senders) ? alias.extra.senders : [];
  return list.filter((d) => typeof d === 'string' && d.length <= 253).slice(0, 50);
}

// "Who leaked me". For each alias that has mail in the set: its hints, and its first sender if the alias knows nobody.
// Returns { rows: [{ alias, known, hints }], learn: [{ aliasId, senders }] }.
//   rows: only the aliases with a hint; the alias with the newest hint first. hints: see review() in lib/leak.js.
//   learn: what the caller saves as the known senders of an alias (the sender of its oldest mail).
// complete: see readNewestMail. If the set is only the newest part of the mail, an alias that knows nobody
// learns its first sender only when all its mail is in the set (alias.received = the mails that the alias got).
// If not, the alias is left out: its oldest mail in the set is possibly not its first mail.
export function leakView(messages, aliases, { complete = true } = {}) {
  const byAlias = new Map();
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || !m.addressId) continue;
    if (!byAlias.has(m.addressId)) byAlias.set(m.addressId, []);
    byAlias.get(m.addressId).push(m);
  }
  const rows = [];
  const learn = [];
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    const mail = byAlias.get(alias.id);
    if (!mail) continue;
    let known = knownOf(alias);
    if (!known.length) {
      if (!complete && mail.length < (alias.received || 0)) continue;
      const first = review([], mail).learn;
      if (!first.length) continue;
      known = first.reduce((list, domain) => addKnown(list, domain), []);
      learn.push({ aliasId: alias.id, senders: known });
    }
    const { hints } = review(known, mail);
    if (hints.length) rows.push({ alias, known, hints });
  }
  rows.sort((a, b) => b.hints[0].lastAt - a.hints[0].lastAt || (String(a.alias.address) < String(b.alias.address) ? -1 : 1));
  return { rows, learn };
}
