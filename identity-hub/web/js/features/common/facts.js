// Facts about inboxes and aliases that the features "Blocked senders" and "Automatic deletion"
// show: how many senders an address blocks, the end date of an alias, and after how many days
// an inbox deletes old mail. The store has them (lib/data.js loads them with the lists), so this
// file asks the server for nothing. It checks what it reads, and it gives one helper for marks
// that change with the clock.
import { findAlias, findMailbox } from '../../lib/data.js';

const count = (v) => (Number.isSafeInteger(v) && v > 0 ? v : 0);

// item: the store object of an alias or an inbox (or its id).
export function aliasFacts(item) {
  const a = typeof item === 'string' ? findAlias(item) : item;
  return { blocks: count(a && a.blocks), expiresAt: count(a && a.expiresAt) || null };
}
export function inboxFacts(item) {
  const m = typeof item === 'string' ? findMailbox(item) : item;
  return { blocks: count(m && m.blocks), retentionDays: count(m && m.retentionDays) || null };
}

// ---- a mark that changes with the clock ----
// A row is painted again when the store changes, not when time passes. "Stops in 2 hours" must
// become "Ended" by itself. paint(el) sets the words of the mark; it runs now and again each
// minute while the mark is on the page. Returns el.
const marks = new Map();
export function keepCurrent(el, paint) {
  paint(el);
  marks.set(el, paint);
  return el;
}
setInterval(() => {
  // A mark that left the page (its row was painted again) is forgotten here.
  for (const [el, paint] of [...marks]) { if (el.isConnected) paint(el); else marks.delete(el); }
}, 60_000);
