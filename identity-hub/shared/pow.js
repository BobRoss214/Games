// Proof of work for sign-up. It slows down robots and needs no CAPTCHA and no tracking.
// The client must find a nonce so that SHA-256(challenge + ":" + nonce)
// starts with `bits` zero bits.
import { utf8 } from './bytes.js';
import { sha256 } from './crypto.js';

function leadingZeroBits(h) {
  let n = 0;
  for (const b of h) {
    if (b === 0) { n += 8; continue; }
    n += Math.clz32(b) - 24;
    break;
  }
  return n;
}

export async function verifyPow(challenge, nonce, bits) {
  if (typeof challenge !== 'string' || typeof nonce !== 'string' || nonce.length > 32) return false;
  return leadingZeroBits(await sha256(utf8(challenge + ':' + nonce))) >= bits;
}

export async function solvePow(challenge, bits, onProgress) {
  for (let i = 0; ; i++) {
    const nonce = i.toString(36);
    if (leadingZeroBits(await sha256(utf8(challenge + ':' + nonce))) >= bits) return nonce;
    if (onProgress && i % 2000 === 0) onProgress(i);
  }
}
