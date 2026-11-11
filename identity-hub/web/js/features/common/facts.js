// Facts about inboxes and aliases that the server knows and the store does not keep:
// how many senders an address blocks, the end date of an alias, and after how many days an
// inbox deletes old mail. The features "Blocked senders" and "Automatic deletion" share this file.
//
// - The facts come from the same two lists that the app loads (GET /api/aliases, GET /api/mailboxes).
//   They are numbers and dates of the server. Nothing here is saved in the browser.
// - A row mark must show a fact that arrives later, or that changes without a change of the
//   store. liveMark() gives a mark that paints itself again when the facts change.
import { h, replace } from '../../lib/dom.js';
import { createStore, store, bus } from '../../lib/store.js';
import { api } from '../../lib/api.js';
import { onForget, isUnlocked } from '../../lib/session.js';

// aliases: alias id -> { blocks, expiresAt }. inboxes: inbox id -> { blocks, retentionDays, addressId }.
// loaded: false until the first answer of the server.
export const facts = createStore({ aliases: new Map(), inboxes: new Map(), loaded: false });

const count = (v) => (Number.isSafeInteger(v) && v > 0 ? v : 0);
export const aliasFacts = (id) => facts.get('aliases').get(id) || { blocks: 0, expiresAt: null };
export const inboxFacts = (id) => facts.get('inboxes').get(id) || { blocks: 0, retentionDays: null, addressId: '' };

let epoch = 0;     // a sign-out or a lock ends the life of an answer that is still on its way
let asking = null;
let again = false;
// Asks the server for the facts now. Calls that come while a request runs share one more request after it.
export function refreshFacts() {
  if (!isUnlocked()) return Promise.resolve();
  if (asking) { again = true; return asking; }
  const mine = epoch;
  asking = Promise.all([api.get('/api/aliases'), api.get('/api/mailboxes')]).then(([a, m]) => {
    if (mine !== epoch) return;
    const aliases = new Map(((a && a.aliases) || []).map((x) => [x.id, { blocks: count(x.blocks), expiresAt: count(x.expiresAt) || null }]));
    const inboxes = new Map(((m && m.mailboxes) || []).map((x) => [x.id, { blocks: count(x.blocks), retentionDays: count(x.retentionDays) || null, addressId: x.addressId || '' }]));
    facts.set({ aliases, inboxes, loaded: true });
  }).catch(() => { /* the facts stay as they are; the next change asks again */ }).finally(() => {
    asking = null;
    if (again) { again = false; refreshFacts(); }
  });
  return asking;
}

// ---- when to ask ----
// 1. The lists of the app are loaded, or an item was made or deleted (new mail alone changes no fact).
// 2. The server says that an alias or an inbox changed (a block and an end date send these events).
let known = '';
function onLists(state) {
  if (state.phase !== 'in' || state.aliases === null || state.mailboxes === null) return;
  const ids = [...state.aliases.map((a) => a.id), '|', ...state.mailboxes.map((m) => m.id)].join(',');
  if (ids === known && facts.get('loaded')) return;
  known = ids;
  refreshFacts();
}
store.subscribe(['phase', 'aliases', 'mailboxes'], onLists);
bus.on('aliases', () => refreshFacts());
bus.on('mailbox', () => refreshFacts());
onForget(() => { epoch++; known = ''; facts.set({ aliases: new Map(), inboxes: new Map(), loaded: false }); });
onLists(store.get());

// ---- marks that follow the facts ----
const marks = new Set();
// make() gives the mark (an element) or null. It runs now, and again each time the facts change.
// The result is one element for a row. It takes no space while make() gives null.
export function liveMark(make) {
  const el = h('span', { hidden: true });
  el.paintMark = () => { const node = make(); replace(el, node); el.hidden = !node; };
  el.paintMark();
  marks.add(el);
  return el;
}
facts.subscribe(null, () => {
  // A mark that left the page (its row was painted again) is forgotten here.
  for (const el of [...marks]) { if (el.isConnected) el.paintMark(); else marks.delete(el); }
});

// A clock for marks with a time ("Stops in 6 days"): they paint again each minute.
setInterval(() => { for (const el of [...marks]) { if (el.isConnected) el.paintMark(); else marks.delete(el); } }, 60_000);
