// Passkeys (WebAuthn) written by hand: JSON options from the server become
// ArrayBuffers for the browser, and the browser result becomes JSON for the server.
//
// The PRF extension gives a secret value that only this passkey can make. The app
// uses it to wrap the account key. The PRF value never leaves the browser.
import { api } from './api.js';
import { b64u, unb64u, randomBytes } from '/shared/bytes.js';
import { sha256 } from '/shared/crypto.js';
import { encLabel } from './session.js';

export function passkeysSupported() {
  return typeof window.PublicKeyCredential === 'function' && !!navigator.credentials && window.isSecureContext;
}

const buf = (v) => unb64u(v);
const str = (v) => (v ? b64u(new Uint8Array(v)) : undefined);

let saltPromise = null;
const prfSalt = () => (saltPromise ||= sha256('postern/v1/prf-salt'));

// Only plain, public parts of the extension results go to the server.
// PRF results are secret and are removed here.
function safeExtensions(ext) {
  const out = {};
  if (!ext) return out;
  if (ext.credProps && typeof ext.credProps === 'object') out.credProps = { rk: ext.credProps.rk };
  if (ext.prf && typeof ext.prf === 'object' && typeof ext.prf.enabled === 'boolean') out.prf = { enabled: ext.prf.enabled };
  return out;
}

function prfResult(cred) {
  const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : null;
  const first = ext && ext.prf && ext.prf.results && ext.prf.results.first;
  if (!first) return null;
  const bytes = new Uint8Array(first instanceof ArrayBuffer ? first : first.buffer ? first.buffer.slice(first.byteOffset, first.byteOffset + first.byteLength) : first);
  return bytes.length >= 16 ? bytes : null;
}

function friendly(err) {
  if (err && err.name === 'NotAllowedError') return new Error('The passkey request was cancelled or it timed out. Try again.');
  if (err && err.name === 'InvalidStateError') return new Error('This device has a passkey for this account already.');
  if (err && err.name === 'SecurityError') return new Error('Passkeys do not work on this address. Open the app on its normal address.');
  if (err && err.name === 'AbortError') return new Error('The passkey request was stopped.');
  return err instanceof Error ? err : new Error('The passkey did not work.');
}

function creationOptions(o) {
  return {
    ...o,
    challenge: buf(o.challenge),
    user: { ...o.user, id: buf(o.user.id) },
    excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: buf(c.id) })),
    extensions: { ...(o.extensions || {}), prf: {} },
  };
}

function registrationJson(cred) {
  const r = cred.response;
  const response = {
    clientDataJSON: str(r.clientDataJSON),
    attestationObject: str(r.attestationObject),
    transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
  };
  if (typeof r.getPublicKeyAlgorithm === 'function') response.publicKeyAlgorithm = r.getPublicKeyAlgorithm();
  if (typeof r.getPublicKey === 'function') { const k = r.getPublicKey(); if (k) response.publicKey = str(k); }
  if (typeof r.getAuthenticatorData === 'function') response.authenticatorData = str(r.getAuthenticatorData());
  return {
    id: cred.id,
    rawId: str(cred.rawId),
    type: cred.type,
    response,
    clientExtensionResults: safeExtensions(cred.getClientExtensionResults()),
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
  };
}

function assertionJson(cred) {
  const r = cred.response;
  return {
    id: cred.id,
    rawId: str(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: str(r.clientDataJSON),
      authenticatorData: str(r.authenticatorData),
      signature: str(r.signature),
      userHandle: r.userHandle && r.userHandle.byteLength ? str(r.userHandle) : undefined,
    },
    clientExtensionResults: safeExtensions(cred.getClientExtensionResults()),
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
  };
}

// Makes a passkey for the signed-in account. Returns { passkey, prf } where prf is
// the secret PRF value (Uint8Array) or null when the passkey cannot make one.
export async function registerPasskey(label) {
  const { options } = await api.post('/api/passkeys/register/options');
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: creationOptions(options) });
  } catch (err) { throw friendly(err); }
  if (!cred) throw new Error('The passkey was not made.');
  const body = { response: registrationJson(cred) };
  if (label) body.enc = await encLabel({ label }, 'passkey');
  const { passkey } = await api.post('/api/passkeys/register/verify', body);

  // Ask the new passkey for its PRF value one time. This is a local request:
  // the challenge is random and nothing from it goes to the server.
  let prf = null;
  const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
  if (!(ext && ext.prf && ext.prf.enabled === false)) {
    try {
      const got = await navigator.credentials.get({
        publicKey: {
          challenge: randomBytes(32),
          rpId: options.rp && options.rp.id ? options.rp.id : undefined,
          allowCredentials: [{ type: 'public-key', id: new Uint8Array(cred.rawId), transports: typeof cred.response.getTransports === 'function' ? cred.response.getTransports() : undefined }],
          userVerification: 'required',
          timeout: 60000,
          extensions: { prf: { eval: { first: await prfSalt() } } },
        },
      });
      prf = got ? prfResult(got) : null;
    } catch { prf = null; }
  }
  return { passkey, prf };
}

// Signs in with a passkey. Returns { account, passkeyId, wrappedKey, prf }.
export async function passkeyAssertion() {
  const { challengeId, options } = await api.post('/api/auth/passkey/options');
  let cred;
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        ...options,
        challenge: buf(options.challenge),
        allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: buf(c.id) })),
        extensions: { ...(options.extensions || {}), prf: { eval: { first: await prfSalt() } } },
      },
    });
  } catch (err) { throw friendly(err); }
  if (!cred) throw new Error('No passkey was chosen.');
  const prf = prfResult(cred);
  const res = await api.post('/api/auth/passkey/verify', { challengeId, response: assertionJson(cred) });
  return { account: res.account, passkeyId: res.passkeyId, wrappedKey: res.wrappedKey || null, prf };
}

// Asks one existing passkey for its PRF value. This is a local request: the challenge
// is random and nothing from the answer goes to the server. Returns Uint8Array or null.
export async function passkeyPrf(credentialId) {
  let got;
  try {
    got = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: buf(credentialId) }],
        userVerification: 'required',
        timeout: 60000,
        extensions: { prf: { eval: { first: await prfSalt() } } },
      },
    });
  } catch (err) { throw friendly(err); }
  return got ? prfResult(got) : null;
}
