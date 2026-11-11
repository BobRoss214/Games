// A software passkey for tests. It does what a browser plus a platform authenticator do:
// it makes a P-256 key, builds the WebAuthn data structures by hand, and signs challenges.
// It follows the WebAuthn rules that the server checks: rpIdHash, flags, counter, attestation "none".
import { createHash, createHmac, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const sha256 = (v) => createHash('sha256').update(v).digest();
const b64u = (v) => Buffer.from(v).toString('base64url');
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

// ---- minimal CBOR encoder (RFC 8949): integers, byte strings, text strings, arrays, maps ----
function head(major, n) {
  const m = major << 5;
  if (n < 24) return Buffer.from([m | n]);
  if (n < 0x100) return Buffer.from([m | 24, n]);
  if (n < 0x10000) return Buffer.concat([Buffer.from([m | 25]), u16(n)]);
  return Buffer.concat([Buffer.from([m | 26]), u32(n)]);
}
export function cbor(v) {
  if (Number.isInteger(v)) return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), v]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor: unsupported value');
}

// Authenticator data flags
const UP = 0x01; // user present
const UV = 0x04; // user verified
const AT = 0x40; // attested credential data follows

export function createAuthenticator({ origin, rpId }) {
  const credentials = new Map(); // credential id (base64url) -> { privateKey, userHandle, counter, prfSecret }
  const rpIdHash = sha256(rpId);
  const clientData = (type, challenge, from = origin) => Buffer.from(JSON.stringify({ type, challenge, origin: from, crossOrigin: false }));

  return {
    credentials,

    // Like navigator.credentials.create({ publicKey: options }). Returns the JSON form of the result.
    // `reuse` makes a second answer for a credential that exists (a real authenticator does not do this).
    create(options, { origin: from, flags = UP | UV | AT, reuse } = {}) {
      if (options.rp.id !== rpId) throw new Error('wrong rp id');
      const id = reuse || b64u(randomBytes(32));
      if (!reuse && (options.excludeCredentials || []).some((c) => credentials.has(c.id))) throw new Error('InvalidStateError: already registered');
      const { privateKey, publicKey } = reuse ? { privateKey: credentials.get(id).privateKey, publicKey: createPublicKey(credentials.get(id).privateKey) } : generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = publicKey.export({ format: 'jwk' });
      // COSE_Key for ES256: kty 2 (EC2), alg -7 (ES256), crv 1 (P-256), x, y
      const coseKey = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
      const rawId = Buffer.from(id, 'base64url');
      const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), u32(0), Buffer.alloc(16) /* aaguid */, u16(rawId.length), rawId, coseKey]);
      const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      if (!reuse) credentials.set(id, { privateKey, userHandle: options.user.id, counter: 0, prfSecret: randomBytes(32) });
      return {
        id, rawId: id, type: 'public-key', authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientData('webauthn.create', options.challenge, from)), attestationObject: b64u(attestationObject), transports: ['internal'] },
        clientExtensionResults: { prf: { enabled: true } },
      };
    },

    // Like navigator.credentials.get({ publicKey: options }) with a discoverable credential.
    get(options, { credentialId, origin: from, flags = UP | UV, badSignature = false } = {}) {
      if (options.rpId !== rpId) throw new Error('wrong rp id');
      const id = credentialId || [...credentials.keys()][0];
      const cred = credentials.get(id);
      if (!cred) throw new Error('NotAllowedError: no passkey');
      cred.counter += 1;
      const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), u32(cred.counter)]);
      const cdj = clientData('webauthn.get', options.challenge, from);
      const signed = Buffer.concat([authData, sha256(cdj)]);
      // A second key stands in for an attacker who knows the credential id but not the private key.
      const key = badSignature ? generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey : cred.privateKey;
      return {
        id, rawId: id, type: 'public-key', authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(cdj), authenticatorData: b64u(authData), signature: b64u(sign('sha256', signed, key)), userHandle: cred.userHandle },
        clientExtensionResults: {},
      };
    },

    // The PRF value of a passkey for a salt. The browser gets it from the passkey. It never goes to the server.
    prf(credentialId, salt) {
      return new Uint8Array(createHmac('sha256', credentials.get(credentialId).prfSecret).update(salt).digest());
    },
  };
}
