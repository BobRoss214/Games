// Server side of the blind signature system (see shared/blind.js).
// The private key signs blinded values only. The raw RSA operation runs in OpenSSL.
import { generateKeyPairSync, createPrivateKey, createPublicKey, privateDecrypt, constants, createHash } from 'node:crypto';
import { verify as verifyToken, parsePublicKey } from '../../shared/blind.js';

export function createSigner(pem) {
  const privateKey = pem
    ? createPrivateKey(pem)
    : generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 }).privateKey;
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
  const nBytes = Buffer.from(jwk.n, 'base64url');
  const id = createHash('sha256').update(nBytes).digest('hex').slice(0, 16);
  const publicKey = { id, n: jwk.n, e: 65537 };
  const parsed = parsePublicKey(publicKey);
  if (Buffer.from(jwk.e, 'base64url').readUIntBE(0, Buffer.from(jwk.e, 'base64url').length) !== 65537) throw new Error('unexpected RSA exponent');

  return {
    id,
    publicKey, // { id, n, e } safe to give to clients
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    // blinded: Buffer with the same length as the modulus. Returns blinded^d mod n.
    sign(blinded) {
      const buf = Buffer.from(blinded);
      if (buf.length !== nBytes.length || Buffer.compare(buf, nBytes) >= 0) throw new Error('bad blinded value');
      return privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, buf);
    },
    // token: 32 bytes, sig: modulus length. Resolves to true if the signature is valid.
    verify(token, sig) {
      return verifyToken(parsed, new Uint8Array(token), new Uint8Array(sig));
    },
  };
}
