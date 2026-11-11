// Newsletter data of an incoming message, for a safe "unsubscribe".
//
// Decision: this server never opens an unsubscribe web link. To open a link from a stranger
// would tell the sender that the address is read, and it would make the server fetch addresses
// that a stranger chose. Unsubscribing works by email only: the web app sends a normal message
// to the "mailto:" address of the List-Unsubscribe header.
//
// Everything that is read here goes into the encrypted envelope of the message and nowhere else.
import { parseAddress } from './address.js';

const MAX_HEADER_CHARS = 4000;
const MAX_TARGETS = 10;
const MAX_SUBJECT_CHARS = 200;

// "%41" -> "A". Text that is not well formed stays as it is.
function decode(text) {
  try { return decodeURIComponent(text); } catch { return text; }
}

// The subject of a "mailto:" target: mailto:leave@list.example?subject=unsubscribe
function subjectOf(query) {
  for (const part of query.split('&').slice(0, MAX_TARGETS)) {
    const eq = part.indexOf('=');
    if (eq < 0 || decode(part.slice(0, eq)).trim().toLowerCase() !== 'subject') continue;
    // No line breaks and no control characters: the text becomes the subject of a message.
    const subject = decode(part.slice(eq + 1)).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
    return subject ? subject.slice(0, MAX_SUBJECT_CHARS) : null;
  }
  return null;
}

// Reads the value of a List-Unsubscribe header:  <mailto:leave@list.example?subject=unsubscribe>, <https://list.example/leave?u=1>
// Returns { mailto, subject, hasLink }: the first valid email target with its subject, and whether a web link exists.
export function parseListUnsubscribe(value) {
  const result = { mailto: null, subject: null, hasLink: false };
  if (typeof value !== 'string') return result;
  // A long header continues on the next lines. The targets stand in angle brackets.
  const text = value.slice(0, MAX_HEADER_CHARS).replace(/\r?\n[ \t]+/g, ' ');
  let targets = [...text.matchAll(/<([^<>]{1,1000})>/g)].map((m) => m[1]);
  // Some senders leave the brackets out.
  if (targets.length === 0) targets = text.split(',');
  for (const raw of targets.slice(0, MAX_TARGETS)) {
    const target = raw.replace(/\s+/g, '');
    if (/^https?:\/\//i.test(target)) { result.hasLink = true; continue; }
    if (result.mailto !== null || !/^mailto:/i.test(target)) continue;
    const rest = target.slice('mailto:'.length);
    const q = rest.indexOf('?');
    // A target can name several addresses. The first one is used. It must pass the strict address check.
    const address = parseAddress(decode(q < 0 ? rest : rest.slice(0, q)).split(',')[0].trim());
    if (!address) continue;
    result.mailto = address.address;
    // The subject is read from the text with its spaces, as the sender wrote it.
    const query = raw.indexOf('?') < 0 ? '' : raw.slice(raw.indexOf('?') + 1).trim();
    result.subject = subjectOf(query);
  }
  return result;
}

// The raw text of the first header with this name ("list-unsubscribe"), without the name. null if there is none.
function rawHeader(mail, key) {
  const found = (mail.headerLines || []).find((h) => h.key === key);
  if (!found || typeof found.line !== 'string') return null;
  return found.line.slice(found.line.indexOf(':') + 1).trim();
}

// Returns { bulk, unsubscribe } for a parsed message.
// bulk: the message is from a mailing list or a bulk sender.
// unsubscribe: null if the message has no List-Unsubscribe header.
export function listInfo(mail) {
  const unsubscribeHeader = rawHeader(mail, 'list-unsubscribe');
  const precedence = String(rawHeader(mail, 'precedence') || '').toLowerCase();
  return {
    bulk: unsubscribeHeader !== null || rawHeader(mail, 'list-id') !== null || precedence === 'bulk' || precedence === 'list',
    unsubscribe: unsubscribeHeader === null ? null : parseListUnsubscribe(unsubscribeHeader),
  };
}
