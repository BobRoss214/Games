// Blind RSA signatures (full-domain hash). Client side. Runs in the browser and in Node.js.
//
// Purpose: the payment system signs "credit tokens" but cannot see them.
// When an account redeems a token, the payment system cannot tell which
// invoice paid for it. Payments and accounts stay separate.
//
//   client: token t (32 random bytes), m = FDH(t), blinded = m * r^e mod n
//   signer: blindSig = blinded^d mod n            (after the invoice is paid)
//   client: sig = blindSig * r^-1 mod n           (now sig^e = m mod n)
//   redeem: server checks sig^e mod n === FDH(t) and that t was not used before
import { utf8, concat, randomBytes, b64u, unb64u } from './bytes.js';
import { sha256 } from './crypto.js';

const DOMAIN = utf8('postern/v1/credit-token');

export function bytesToBig(bytes) {
  let h = '';
  for (const b of bytes) h += b.toString(16).padStart(2, '0');
  return h ? BigInt('0x' + h) : 0n;
}

export function bigToBytes(n, len) {
  let h = n.toString(16);
  if (h.length > len * 2) throw new Error('number too large');
  h = h.padStart(len * 2, '0');
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

export function modPow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

export function modInv(a, mod) {
  let [r0, r1] = [((a % mod) + mod) % mod, mod];
  let [s0, s1] = [1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error('not invertible');
  return ((s0 % mod) + mod) % mod;
}

// Public key in transport form: { id, n: base64url, e: number }
export function parsePublicKey(pub) {
  const nBytes = unb64u(pub.n);
  return { id: pub.id, n: bytesToBig(nBytes), e: BigInt(pub.e), len: nBytes.length };
}
const toKey = (pub) => (typeof pub.n === 'bigint' ? pub : parsePublicKey(pub));

// Full-domain hash: MGF1-SHA256 expanded to the modulus length, top bit cleared so m < n.
export async function fdh(token, len) {
  const blocks = [];
  for (let counter = 0; blocks.length * 32 < len; counter++) {
    const c = new Uint8Array([counter >>> 24, counter >>> 16, counter >>> 8, counter]);
    blocks.push(await sha256(concat(DOMAIN, token, c)));
  }
  const out = concat(...blocks).subarray(0, len);
  out[0] &= 0x7f;
  return bytesToBig(out);
}

export const newToken = () => randomBytes(32);

// Returns { blinded: Uint8Array (send to the signer), r: Uint8Array (keep secret) }
export async function blind(pub, token) {
  const key = toKey(pub);
  const m = await fdh(token, key.len);
  let r;
  for (;;) {
    r = bytesToBig(randomBytes(key.len)) % key.n;
    if (r < 2n) continue;
    try { modInv(r, key.n); break; } catch { /* try again */ }
  }
  const blinded = (m * modPow(r, key.e, key.n)) % key.n;
  return { blinded: bigToBytes(blinded, key.len), r: bigToBytes(r, key.len) };
}

export async function unblind(pub, token, blindSig, r) {
  const key = toKey(pub);
  const sig = (bytesToBig(blindSig) * modInv(bytesToBig(r), key.n)) % key.n;
  const out = bigToBytes(sig, key.len);
  if (!(await verify(key, token, out))) throw new Error('The signature from the payment server is not valid.');
  return out;
}

export async function verify(pub, token, sig) {
  const key = toKey(pub);
  if (sig.length !== key.len || token.length !== 32) return false;
  const s = bytesToBig(sig);
  if (s >= key.n) return false;
  return modPow(s, key.e, key.n) === (await fdh(token, key.len));
}

export { b64u, unb64u };
