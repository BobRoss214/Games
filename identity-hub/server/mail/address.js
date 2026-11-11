// Address rules. See docs/API.md section 4.
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
