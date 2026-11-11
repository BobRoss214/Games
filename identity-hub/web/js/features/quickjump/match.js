// The matching of the quick jump. Pure functions: no page, no store, no request.
// test/web-quickjump.test.js checks them.
//
// An entry is one place to go: { kind, title, fields: [{ name, text, level, digits? }], ... }.
//   level 0 = a name that the person gave, or the name of a page (identity name, label, page name)
//   level 1 = the address or the number
//   level 2 = other text (note, random identifiers, the identity of an item, extra words of a page)
//   digits  = the digits of a phone number, for a query such as "5550100" or "(415) 555"
// A query is cut into parts at spaces. Every part must be found in some field; the order is free.

export const KIND_ORDER = ['identity', 'alias', 'number', 'inbox', 'page'];
const MAX_PARTS = 6;
const MARKS = /[̀-ͯ]/g;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const PHONE_PART = /^[+()\d.-]+$/;
const WEIGHT = [1, 0.9, 0.5];

// Small letters, and letters with marks become plain letters ("Café" -> "cafe").
export const fold = (text) => String(text === null || text === undefined ? '' : text).normalize('NFKD').replace(MARKS, '').toLowerCase();
export const digitsOf = (text) => String(text === null || text === undefined ? '' : text).replace(/\D/g, '');
export const partsOf = (query) => fold(query).split(/\s+/).filter(Boolean).slice(0, MAX_PARTS);

// How well one part matches one text: 100 the whole text, 80 its start, 60 the start of a word in it, 40 inside a word, 0 not found.
export function textScore(hay, part) {
  if (!hay || !part) return 0;
  if (hay === part) return 100;
  if (hay.startsWith(part)) return 80;
  let inside = false;
  for (let i = hay.indexOf(part); i !== -1; i = hay.indexOf(part, i + 1)) {
    inside = true;
    if (!WORD_CHAR.test(hay[i - 1])) return 60;
  }
  return inside ? 40 : 0;
}

// The same for the digits of a phone number. "+1 415 555 0100" is found by "4155550100", "5550100" and "(415)".
export function digitScore(digits, part) {
  if (!digits || !PHONE_PART.test(part)) return 0;
  const want = digitsOf(part);
  if (want.length < 2) return 0;
  if (digits === want) return 100;
  if (digits.endsWith(want) || digits.startsWith(want) || digits.slice(1).startsWith(want)) return 70;
  return digits.includes(want) ? 50 : 0;
}

// The fields of an entry, made ready one time: text folded, digits kept.
export function prepare(entry) {
  const fields = (entry.fields || []).filter((f) => f && f.text).map((f) => ({ name: f.name, level: f.level, text: fold(f.text), digits: f.digits ? digitsOf(f.digits) : '', shown: String(f.text) }));
  return { ...entry, fields };
}

// Gives { tier, score, why } for an entry that matches all parts, or null.
//   tier 0 = every part starts the name or a word of the name (or is a clear part of the number)
//   tier 1 = every part is in the name, the address or the number
//   tier 2 = at least one part was found only in other text; "why" is that field
export function rank(entry, parts) {
  let tier = 0;
  let score = 0;
  let why = null;
  for (const part of parts) {
    let best = null;
    for (const f of entry.fields) {
      const byDigits = f.digits ? digitScore(f.digits, part) : 0;
      const raw = Math.max(textScore(f.text, part), byDigits);
      if (!raw) continue;
      const value = raw * WEIGHT[f.level];
      if (!best || value > best.value) best = { value, raw, level: f.level, field: f, strong: raw >= 60 };
    }
    if (!best) return null;
    score += best.value;
    const partTier = best.level === 2 ? 2 : (best.strong && (best.level === 0 || best.field.digits) ? 0 : 1);
    if (partTier > tier) tier = partTier;
    if (best.level === 2 && !why) why = { name: best.field.name, text: best.field.shown };
  }
  return { tier, score, why };
}

// entries: prepared entries (see prepare). Returns { items, total }: the best `limit` entries, each with
// "why" (a field that is not in sight and made the match, or null), and how many matched in all.
// Order: the tier, then identities, aliases, numbers, inboxes, pages, then the better score, then the name.
export function search(entries, query, { limit = 20 } = {}) {
  const parts = partsOf(query);
  if (!parts.length) return { items: [], total: 0 };
  const found = [];
  for (const entry of entries) {
    const r = rank(entry, parts);
    if (r) found.push({ entry, ...r });
  }
  const kind = (e) => { const i = KIND_ORDER.indexOf(e.kind); return i < 0 ? KIND_ORDER.length : i; };
  found.sort((a, b) => a.tier - b.tier || kind(a.entry) - kind(b.entry) || b.score - a.score || fold(a.entry.title).localeCompare(fold(b.entry.title)));
  return { items: found.slice(0, limit).map((f) => ({ ...f.entry, why: f.why })), total: found.length };
}
