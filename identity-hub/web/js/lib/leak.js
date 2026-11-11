// "Possibly leaked" hint for an alias.
//
// An alias is normally used with one sender: the shop or the service that got the address.
// If mail arrives from a sender that the alias does not know, the address was possibly passed on,
// sold, or stolen. This file decides when to show that hint. It runs in the browser only.
//
// Rules:
// - Senders are compared by their main domain: "news@mail.shop.example" and "billing@shop.example"
//   are the same sender, "shop.example". A look-alike name ("shop-example.net") is a different sender.
// - The main domain is found with a short built-in list of two-part endings such as "co.uk".
//   This is a heuristic. It is not the full public suffix list, so for a rare ending the main
//   domain can be one label too short.
// - An alias with no known sender learns the sender of its oldest message. That sender gives no hint.
// - Every other sender that is not known gives one hint. A known sender never gives a hint.
//
// This file has no access to the page, to the network, or to storage. The caller keeps the list
// of known senders (encrypted, with the other data of the alias).

const MAX_KNOWN = 50;

// Endings with two parts that many organisations register under.
const TWO_PART_ENDINGS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'nhs.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.nz', 'org.nz', 'net.nz', 'govt.nz', 'ac.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'com.br', 'net.br', 'org.br', 'gov.br', 'com.mx', 'org.mx',
  'co.in', 'net.in', 'org.in', 'ac.in', 'gov.in', 'co.za', 'org.za', 'com.cn', 'net.cn', 'org.cn',
  'com.tr', 'com.sg', 'com.hk', 'co.kr', 'or.kr', 'com.tw', 'com.ar', 'com.co', 'com.pl', 'co.il',
  'com.my', 'com.ph', 'co.id', 'co.th', 'com.vn', 'com.ua', 'com.eg', 'com.sa', 'com.ng', 'co.ke',
]);

const LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;

// The main domain of a host name: "mail.shop.example.co.uk" -> "example.co.uk". Returns null for text that is no domain.
export function mainDomain(host) {
  if (typeof host !== 'string' || host.length < 3 || host.length > 253) return null;
  const labels = host.toLowerCase().replace(/\.+$/, '').split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  // The last label of a real domain has a letter. This leaves out IP addresses.
  if (!/\p{L}/u.test(labels[labels.length - 1])) return null;
  const twoPart = labels.length >= 3 && TWO_PART_ENDINGS.has(labels.slice(-2).join('.'));
  return labels.slice(twoPart ? -3 : -2).join('.');
}

// The main domain of the sender of a message, in lower case. Returns null if the address is missing or broken.
export function senderDomain(address) {
  if (typeof address !== 'string' || address.length > 320) return null;
  const at = address.lastIndexOf('@');
  if (at < 1 || /\s/.test(address.trim())) return null;
  return mainDomain(address.slice(at + 1).trim());
}

// Looks at the messages of one alias.
// knownDomains: the senders that the alias knows. messages: [{ id, at, fromAddress }] in any order.
// Returns { learn, hints }:
//   learn: domains to add to the known list now (the sender of the oldest message, if the alias knew nobody).
//   hints: one entry for each unknown sender, the newest first:
//          { domain, fromAddress, firstAt, lastAt, count, messageId }. fromAddress and messageId are
//          from the newest message of that sender.
export function review(knownDomains, messages) {
  const known = new Set();
  for (const entry of Array.isArray(knownDomains) ? knownDomains : []) {
    const domain = mainDomain(entry);
    if (domain) known.add(domain);
  }
  const usable = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== 'object' || !Number.isFinite(m.at)) continue;
    const domain = senderDomain(m.fromAddress);
    if (domain) usable.push({ id: m.id, at: m.at, fromAddress: m.fromAddress, domain });
  }

  const learn = [];
  if (known.size === 0 && usable.length > 0) {
    // The first sender that ever wrote to the alias is the one the alias was made for.
    let oldest = usable[0];
    for (const m of usable) if (m.at < oldest.at) oldest = m;
    learn.push(oldest.domain);
    known.add(oldest.domain);
  }

  const byDomain = new Map();
  for (const m of usable) {
    if (known.has(m.domain)) continue;
    const hint = byDomain.get(m.domain);
    if (!hint) {
      byDomain.set(m.domain, { domain: m.domain, fromAddress: m.fromAddress, firstAt: m.at, lastAt: m.at, count: 1, messageId: m.id });
      continue;
    }
    hint.count += 1;
    if (m.at < hint.firstAt) hint.firstAt = m.at;
    if (m.at > hint.lastAt) { hint.lastAt = m.at; hint.fromAddress = m.fromAddress; hint.messageId = m.id; }
  }
  const hints = [...byDomain.values()].sort((a, b) => b.lastAt - a.lastAt || (a.domain < b.domain ? -1 : 1));
  return { learn, hints };
}

// Adds a sender to the known list. Returns a new list: lower case, each domain one time, 50 at most.
// When the list is full, the oldest entry goes. A text that is no domain changes nothing.
export function addKnown(knownDomains, domain) {
  const list = [];
  for (const entry of Array.isArray(knownDomains) ? knownDomains : []) {
    const clean = mainDomain(entry);
    if (clean && !list.includes(clean)) list.push(clean);
  }
  const added = mainDomain(domain) || senderDomain(domain);
  if (added && !list.includes(added)) list.push(added);
  return list.slice(-MAX_KNOWN);
}
