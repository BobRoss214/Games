// "Possibly leaked": watches the mail of the aliases for senders that an alias does not know.
//
// The rules are in lib/leak.js (pure). This file feeds them:
// - The senders that an alias knows are in its encrypted extra field "senders" (a list of
//   main domains, for example ["shop.example"]). The server cannot read it.
// - When mail of an alias is loaded and the alias knows nobody yet, the sender of its oldest
//   message is saved as known (review().learn).
// - Every other unknown sender is a hint. The hints are kept in memory only:
//   store.get('leaks') = { [aliasId]: [{ domain, fromAddress, firstAt, lastAt, count, messageId }] }.
// Everything happens in the browser. Nothing about senders is sent to the server in plain.
import { store, bus } from './store.js';
import { listMessages } from './mail.js';
import { setItemExtra } from './data.js';
import { review, addKnown } from './leak.js';
import { isUnlocked } from './session.js';

const CHUNK = 50;       // the server takes 50 address ids in one request
const PAGE = 100;
const MAX_PAGES = 5;    // for one alias that knows nobody yet: look back this far for its oldest message

// The known sender domains of an alias, checked (another version of the app may have written them).
export function knownSenders(alias) {
  const list = alias && alias.extra && Array.isArray(alias.extra.senders) ? alias.extra.senders : [];
  return list.filter((d) => typeof d === 'string' && d.length <= 253).slice(0, 50);
}

const asEntry = (m) => ({ id: m.id, at: m.at, fromAddress: m.meta && m.meta.from ? m.meta.from.address : '' });

// Is this message from a sender that its alias does not know? Returns a hint or null.
// An alias that knows nobody yet gives no hint (its first sender is the one it was made for).
export function leakOf(message, alias) {
  if (!message || !alias || message.direction !== 'in' || message.broken) return null;
  const known = knownSenders(alias);
  if (!known.length) return null;
  return review(known, [asEntry(message)]).hints[0] || null;
}

// "This sender is expected": the alias knows the domain from now on.
export async function expectSender(alias, domain) {
  await setItemExtra('alias', alias.id, { senders: addKnown(knownSenders(alias), domain) });
  const leaks = { ...store.get('leaks') };
  const clean = addKnown([], domain)[0] || domain;
  const left = (leaks[alias.id] || []).filter((hint) => hint.domain !== clean);
  if (left.length) leaks[alias.id] = left; else delete leaks[alias.id];
  store.set({ leaks });
}

async function allMailOf(aliasId) {
  const out = [];
  let before;
  let beforeId;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await listMessages({ addressIds: [aliasId], direction: 'in', limit: PAGE, before, beforeId });
    out.push(...res.messages);
    if (!res.more || !res.messages.length) break;
    const last = res.messages[res.messages.length - 1];
    before = last.at;
    beforeId = last.id;
  }
  return out;
}

let running = false;
let again = false;
let waiting = false; // a check is planned
// Resolves when no check runs and none is planned (for tests that count requests).
export async function whenIdle() {
  while (running || waiting) await new Promise((r) => setTimeout(r, 50));
}
async function check() {
  if (running) { again = true; return; }
  running = true;
  try {
    const aliases = (store.get('aliases') || []).filter((a) => a.received > 0);
    const leaks = {};
    for (let i = 0; i < aliases.length; i += CHUNK) {
      const part = aliases.slice(i, i + CHUNK);
      const res = await listMessages({ addressIds: part.map((a) => a.id), direction: 'in', limit: PAGE });
      const byAlias = new Map();
      for (const m of res.messages) {
        if (m.broken || !m.addressId) continue;
        if (!byAlias.has(m.addressId)) byAlias.set(m.addressId, []);
        byAlias.get(m.addressId).push(m);
      }
      for (const alias of part) {
        let mail = byAlias.get(alias.id) || [];
        if (!mail.length) continue;
        let known = knownSenders(alias);
        let hints;
        if (!known.length) {
          // The oldest message decides who is known. If this request did not reach it, load the mail of this alias alone.
          if (res.more && part.length > 1) mail = await allMailOf(alias.id);
          const r = review([], mail.map(asEntry));
          hints = r.hints;
          if (r.learn.length && isUnlocked()) {
            known = addKnown([], r.learn[0]);
            for (const d of r.learn.slice(1)) known = addKnown(known, d);
            await setItemExtra('alias', alias.id, { senders: known });
          }
        } else hints = review(known, mail.map(asEntry)).hints;
        if (hints.length) leaks[alias.id] = hints;
      }
    }
    if (isUnlocked() && JSON.stringify(leaks) !== JSON.stringify(store.get('leaks'))) store.set({ leaks });
  } catch { /* a hint is an extra; the next mail event tries again */ } finally {
    running = false;
    if (again) { again = false; check(); }
  }
}

// Starts the watch: one check when the aliases are loaded after sign-in, and one after each new mail.
let started = false;
export function startLeakWatch() {
  if (started) return;
  started = true;
  let timer = 0;
  let checkedFor = null; // the account that had its first check
  const soon = (ms) => { clearTimeout(timer); waiting = true; timer = setTimeout(() => { waiting = false; if (store.get('phase') === 'in' && isUnlocked()) check(); }, ms); };
  const look = (s) => {
    if (s.phase !== 'in') { checkedFor = null; return; }
    const id = s.account && s.account.id;
    if (s.aliases !== null && id && checkedFor !== id) { checkedFor = id; soon(400); }
  };
  store.subscribe(['aliases', 'phase'], look);
  look(store.get()); // the lists may be loaded already
  bus.on('mail', () => soon(600));
}
