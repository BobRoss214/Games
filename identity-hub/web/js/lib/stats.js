// "My stats": which alias gets the most mail, and who writes the most.
//
// Rules:
// - The counting happens in the browser, on messages that the browser decrypted. The server
//   cannot do it, because the server cannot read who wrote a message.
// - Senders are counted by their main domain ("mail.shop.example" counts for "shop.example"),
//   with the same rule as the "possibly leaked" hint.
// - This file only counts. It has no access to the page, to the network, or to storage.
import { senderDomain } from './leak.js';

// The larger count first; then the newer mail first; then by name, so that the order is always the same.
const order = (key) => (a, b) => b.count - a.count || b.lastAt - a.lastAt || (String(a[key]) < String(b[key]) ? -1 : 1);

function add(map, key, at) {
  const entry = map.get(key);
  if (!entry) map.set(key, { count: 1, lastAt: at });
  else { entry.count += 1; if (at > entry.lastAt) entry.lastAt = at; }
}

// messages: [{ addressId, fromAddress, at }] (incoming messages).
// Returns { total, byAddress: [{ addressId, count, lastAt }], bySender: [{ domain, count, lastAt }], firstAt, lastAt }.
// A message without an address id (its alias was deleted) or without a usable sender is in `total` only.
export function mailStats(messages) {
  const addresses = new Map();
  const senders = new Map();
  let total = 0;
  let firstAt = null;
  let lastAt = null;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== 'object' || !Number.isFinite(m.at)) continue;
    total += 1;
    if (firstAt === null || m.at < firstAt) firstAt = m.at;
    if (lastAt === null || m.at > lastAt) lastAt = m.at;
    if (typeof m.addressId === 'string' && m.addressId) add(addresses, m.addressId, m.at);
    const domain = senderDomain(m.fromAddress);
    if (domain) add(senders, domain, m.at);
  }
  return {
    total,
    byAddress: [...addresses].map(([addressId, v]) => ({ addressId, count: v.count, lastAt: v.lastAt })).sort(order('addressId')),
    bySender: [...senders].map(([domain, v]) => ({ domain, count: v.count, lastAt: v.lastAt })).sort(order('domain')),
    firstAt,
    lastAt,
  };
}
