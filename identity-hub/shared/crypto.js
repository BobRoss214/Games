// Encryption used by the browser and by the server. Only WebCrypto is used.
//
// Key tree (see docs/SECURITY.md):
//   recovery key (20 random bytes, shown to the user one time)
//     -> accountId  (public account number)
//     -> authKey    (login secret; the server stores only its SHA-256)
//     -> recoveryKek (wraps accountKey)
//   accountKey (32 random bytes, made in the browser)
//     -> vaultKey   (AES-256-GCM; encrypts labels and wraps the private key)
//   ECDH P-256 key pair: the server has the public key and uses it to "seal"
//   incoming mail and texts. Only the browser can open them.
import { utf8, fromUtf8, concat, randomBytes, hex } from './bytes.js';

const subtle = globalThis.crypto.subtle;
const V1 = 1;
const EMPTY = new Uint8Array(0);
const INFO = {
  accountId: 'postern/v1/account-id',
  auth: 'postern/v1/auth',
  kek: 'postern/v1/recovery-kek',
  vault: 'postern/v1/vault',
  prf: 'postern/v1/prf-kek',
  seal: 'postern/v1/seal',
};
const toBytes = (v) => (typeof v === 'string' ? utf8(v) : v);

export async function sha256(bytes) {
  return new Uint8Array(await subtle.digest('SHA-256', toBytes(bytes)));
}

export async function hkdf(ikm, info, length = 32, salt = EMPTY) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) }, key, length * 8);
  return new Uint8Array(bits);
}

export async function aesKey(raw) {
  if (raw.length !== 32) throw new Error('AES key must be 32 bytes');
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Output: version(1) | iv(12) | ciphertext+tag
export async function encrypt(key, plaintext, aad = EMPTY) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: toBytes(aad) }, key, toBytes(plaintext));
  return concat(new Uint8Array([V1]), iv, new Uint8Array(ct));
}

export async function decrypt(key, data, aad = EMPTY) {
  if (!(data instanceof Uint8Array) || data.length < 29 || data[0] !== V1) throw new Error('bad ciphertext');
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(1, 13), additionalData: toBytes(aad) }, key, data.subarray(13));
  return new Uint8Array(pt);
}

export const encryptJson = async (key, obj, aad) => encrypt(key, utf8(JSON.stringify(obj)), aad);
export const decryptJson = async (key, data, aad) => JSON.parse(fromUtf8(await decrypt(key, data, aad)));

// ---- Public-key sealing (ECIES: ephemeral ECDH P-256 + HKDF + AES-256-GCM) ----

export async function generateKeyPair() {
  const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    publicKey: new Uint8Array(await subtle.exportKey('raw', kp.publicKey)),
    privateKeyPkcs8: new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey)),
  };
}

export async function importPrivateKey(pkcs8) {
  return subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

async function sealKey(privateKey, peerPublicRaw, ephPublicRaw, recipientPublicRaw) {
  const peer = await subtle.importKey('raw', peerPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256));
  return aesKey(await hkdf(shared, INFO.seal, 32, concat(ephPublicRaw, recipientPublicRaw)));
}

// Output: version(1) | ephemeral public key(65) | iv(12) | ciphertext+tag
export async function seal(recipientPublicRaw, plaintext, aad = EMPTY) {
  if (recipientPublicRaw.length !== 65 || recipientPublicRaw[0] !== 4) throw new Error('bad public key');
  const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephPub = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const key = await sealKey(eph.privateKey, recipientPublicRaw, ephPub, recipientPublicRaw);
  const box = await encrypt(key, plaintext, aad);
  return concat(new Uint8Array([V1]), ephPub, box.subarray(1));
}

// keys = { privateKey: CryptoKey, publicKey: Uint8Array(65) }
export async function open(keys, sealed, aad = EMPTY) {
  if (!(sealed instanceof Uint8Array) || sealed.length < 94 || sealed[0] !== V1) throw new Error('bad sealed data');
  const ephPub = sealed.subarray(1, 66);
  const key = await sealKey(keys.privateKey, ephPub, ephPub, keys.publicKey);
  return decrypt(key, concat(new Uint8Array([V1]), sealed.subarray(66)), aad);
}

export const sealJson = async (pub, obj, aad) => seal(pub, utf8(JSON.stringify(obj)), aad);
export const openJson = async (keys, sealed, aad) => JSON.parse(fromUtf8(await open(keys, sealed, aad)));

// ---- Account keys ----

export async function deriveFromRecoveryKey(recoveryBytes) {
  const [id, authKey, kek] = await Promise.all([
    hkdf(recoveryBytes, INFO.accountId, 16),
    hkdf(recoveryBytes, INFO.auth, 32),
    hkdf(recoveryBytes, INFO.kek, 32),
  ]);
  return { accountId: hex(id), authKey, recoveryKek: await aesKey(kek) };
}

export async function deriveVaultKey(accountKey) {
  return aesKey(await hkdf(accountKey, INFO.vault, 32));
}

export async function prfKek(prfOutput) {
  return aesKey(await hkdf(new Uint8Array(prfOutput), INFO.prf, 32));
}

// Makes all keys for a new account. The result has the values for sign-up
// ("upload") and the values that stay in the browser ("local").
export async function createAccountKeys(recoveryBytes) {
  const d = await deriveFromRecoveryKey(recoveryBytes);
  const accountKey = randomBytes(32);
  const vaultKey = await deriveVaultKey(accountKey);
  const pair = await generateKeyPair();
  return {
    upload: {
      accountId: d.accountId,
      authKey: d.authKey,
      publicKey: pair.publicKey,
      encPrivateKey: await encrypt(vaultKey, pair.privateKeyPkcs8, 'private-key'),
      recoveryWrap: await encrypt(d.recoveryKek, accountKey, 'account-key'),
    },
    local: {
      accountId: d.accountId,
      accountKey,
      vaultKey,
      publicKey: pair.publicKey,
      privateKey: await importPrivateKey(pair.privateKeyPkcs8),
    },
  };
}

// Opens the account keys from accountKey and the server copy of the wrapped private key.
export async function unlockWithAccountKey(accountKey, { publicKey, encPrivateKey }) {
  const vaultKey = await deriveVaultKey(accountKey);
  const pkcs8 = await decrypt(vaultKey, encPrivateKey, 'private-key');
  return { accountKey, vaultKey, publicKey, privateKey: await importPrivateKey(pkcs8) };
}

export async function unlockWithRecoveryKey(recoveryBytes, { publicKey, encPrivateKey, recoveryWrap }) {
  const d = await deriveFromRecoveryKey(recoveryBytes);
  const accountKey = await decrypt(d.recoveryKek, recoveryWrap, 'account-key');
  return unlockWithAccountKey(accountKey, { publicKey, encPrivateKey });
}

export const wrapAccountKey = async (kek, accountKey) => encrypt(kek, accountKey, 'account-key');
export const unwrapAccountKey = async (kek, wrapped) => decrypt(kek, wrapped, 'account-key');

// ---- Message envelopes ----
// A message has one random content key K. K is sealed to the account public key.
// meta = encrypt(K, json, "meta"); part 0 = encrypt(K, json, "body");
// part i = encrypt(K, attachment bytes, "att:" + i).

export async function newContentKey() {
  const raw = randomBytes(32);
  return { raw, key: await aesKey(raw) };
}

export async function sealEnvelope(recipientPublicRaw, { meta, body, attachments = [] }) {
  const ck = await newContentKey();
  const parts = [await encryptJson(ck.key, body, 'body')];
  for (let i = 0; i < attachments.length; i++) parts.push(await encrypt(ck.key, attachments[i], 'att:' + (i + 1)));
  return {
    sealedKey: await seal(recipientPublicRaw, ck.raw, 'content-key'),
    encMeta: await encryptJson(ck.key, meta, 'meta'),
    parts,
  };
}

export async function openContentKey(keys, sealedKey) {
  return aesKey(await open(keys, sealedKey, 'content-key'));
}
export const openMeta = (contentKey, encMeta) => decryptJson(contentKey, encMeta, 'meta');
export const openBody = (contentKey, part0) => decryptJson(contentKey, part0, 'body');
export const openAttachment = (contentKey, part, index) => decrypt(contentKey, part, 'att:' + index);
