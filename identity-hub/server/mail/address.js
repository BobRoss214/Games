// Address rules. See docs/API.md section 4.
import { domainToASCII } from 'node:url';
import { fail, need } from '../core/http.js';
import { randomLocalPart } from './words.js';

// Local part of our own addresses: 3 to 64 characters.
export const LOCAL_PART = /^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])$/;

// Names that mail systems and certificate authorities use. A user must not get them.
export const RESERVED = new Set([
  'postmaster', 'abuse', 'admin', 'administrator', 'root', 'hostmaster', 'webmaster', 'noreply',
  'no-reply', 'mailer-daemon', 'support', 'security', 'info', 'help', 'billing',
]);

// A careful pattern for recipients on any server. It allows fewer characters than the
// standard, so that an address can never break a header or an SMTP command.
const ANY_LOCAL = /^[a-z0-9_+='&~#-](?:[a-z0-9._+='&~#-]{0,62}[a-z0-9_+='&~#-])?$/;
const ANY_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/;

// Returns { address, local, domain } in lower case, or null if the text is not a usable address.
export function parseAddress(value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 254) return null;
  const address = value.toLowerCase();
  const at = address.lastIndexOf('@');
  if (at < 1) return null;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (!ANY_LOCAL.test(local) || local.includes('..') || domain.length > 253 || !ANY_DOMAIN.test(domain)) return null;
  return { address, local, domain };
}

export const taken = () => fail(409, 'taken', 'This address is taken. Choose a different one.');

// ---- blocked senders ----

// Only letters, digits, hyphens, and dots can be in a domain name. The check comes before the
// conversion, because the conversion function reads its input like a web address: it would drop
// a path, decode "%41", and turn "0x7f.1" into an IP address.
const DOMAIN_TEXT = /^[\p{L}\p{N}\p{M}.-]+$/u;
const toAscii = (domain) => (DOMAIN_TEXT.test(domain) ? domainToASCII(domain) : '');

// A domain in the ASCII form that mail servers use ("xn--..." for international names), lower case.
// Returns '' if the text is not a domain.
function asciiDomain(text) {
  const domain = toAscii(String(text).toLowerCase());
  return domain.length <= 253 && ANY_DOMAIN.test(domain) ? domain : '';
}

// Checks the value of a block from a request. Returns the value in its stored form:
// lower case and ASCII. A domain has at least one dot, no "@", and no dot at the start.
export function blockValue(kind, value) {
  const bad = () => fail(400, 'bad_request', 'The value "value" is not valid.');
  if (typeof value !== 'string' || value.length < 3 || value.length > 254) throw bad();
  if (kind === 'domain') {
    const domain = value.includes('@') ? '' : asciiDomain(value);
    if (!domain) throw bad();
    return domain;
  }
  const at = value.lastIndexOf('@');
  const parsed = at > 0 ? parseAddress(`${value.slice(0, at)}@${asciiDomain(value.slice(at + 1))}`) : null;
  if (!parsed) throw bad();
  return parsed.address;
}

const MAX_PARENT_DOMAINS = 8;

// The texts that can block a sender: its address, its domain, and the parent domains
// ("mail.shop.example" is also blocked by a block of "shop.example"). Each text has its kind in front.
// The sender comes from a stranger, so it is not checked against the strict pattern. It is only compared.
// Spellings that mean the same domain give the same texts: upper case, a dot at the end, the
// international form. A very long local part does not hide the domain.
export function senderBlockTexts(sender) {
  const address = String(sender || '').toLowerCase();
  const at = address.lastIndexOf('@');
  const rawDomain = address.slice(at + 1).replace(/\.+$/, '');
  if (at < 1 || rawDomain.length < 1 || rawDomain.length > 253) return [];
  const domain = toAscii(rawDomain) || rawDomain;
  const labels = domain.split('.');
  const texts = [`domain:${domain}`];
  if (at <= 64) texts.push(`address:${address.slice(0, at)}@${domain}`);
  // Parent domains with two labels or more, the shortest first. A very long name is not followed to the end.
  for (let i = labels.length - 2; i >= 1 && texts.length < 2 + MAX_PARENT_DOMAINS; i--) texts.push(`domain:${labels.slice(i).join('.')}`);
  return texts;
}

// Makes the address for a new mailbox or alias from the request body.
// isFree(address) tells if the address was never used. Returns the full address.
export function chooseAddress(body, domains, isFree) {
  let domain = domains[0];
  if (!domain) throw fail(503, 'mail_off', 'Mail is not set up on this server.');
  if (body.domain !== undefined && body.domain !== null) {
    domain = need.string(body.domain, 'domain', { min: 1, max: 253 });
    if (!domains.includes(domain)) throw fail(400, 'bad_request', 'This domain is not available. Choose one from the list.');
  }
  if (body.localPart === undefined || body.localPart === null) {
    for (let i = 0; i < 20; i++) {
      const address = `${randomLocalPart()}@${domain}`;
      if (isFree(address)) return address;
    }
    throw fail(503, 'busy', 'The server found no free address. Try again.');
  }
  const local = need.string(body.localPart, 'localPart', { min: 3, max: 64, pattern: LOCAL_PART });
  if (local.includes('..')) throw fail(400, 'bad_request', 'The value "localPart" is not valid.');
  if (RESERVED.has(local)) throw fail(409, 'taken', 'This name is reserved. Choose a different one.');
  const address = `${local}@${domain}`;
  if (!isFree(address)) throw taken();
  return address;
}
