// Recovery key text format.
// 20 random bytes -> 32 Crockford base32 characters -> 8 groups of 4,
// plus 1 check group of 4 characters to find typing errors.
// Example: 7K3M-9QWX-....-C4TZ
import { randomBytes } from './bytes.js';
import { sha256 } from './crypto.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_BYTES = 20;

function encode32(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function decode32(text) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of text) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw recoveryError('bad_format');
    value = (value << 5) | v; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    value &= (1 << bits) - 1;
  }
  return new Uint8Array(out);
}

function recoveryError(code) {
  const e = new Error(code === 'bad_checksum' ? 'The recovery key has a typing error.' : 'The recovery key format is not correct.');
  e.code = code;
  return e;
}

async function checkGroup(bytes) {
  const h = await sha256(bytes);
  return encode32(h.subarray(0, 3)).slice(0, 4);
}

export async function formatRecoveryKey(bytes) {
  if (bytes.length !== RECOVERY_BYTES) throw new Error('recovery key must be 20 bytes');
  const body = encode32(bytes) + (await checkGroup(bytes));
  return body.match(/.{4}/g).join('-');
}

export async function generateRecoveryKey() {
  const bytes = randomBytes(RECOVERY_BYTES);
  return { bytes, text: await formatRecoveryKey(bytes) };
}

// Accepts lower case, spaces, and missing dashes. O is read as 0. I and L are read as 1.
export async function parseRecoveryKey(text) {
  const clean = String(text).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== 36) throw recoveryError('bad_format');
  const bytes = decode32(clean.slice(0, 32));
  if (bytes.length !== RECOVERY_BYTES) throw recoveryError('bad_format');
  if ((await checkGroup(bytes)) !== clean.slice(32)) throw recoveryError('bad_checksum');
  return bytes;
}
