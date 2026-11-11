// Sign-in state and the account key.
//
// The account key opens everything. It lives in memory and in sessionStorage
// (this tab only) so that a reload does not lock the app. It is never written to
// localStorage, never put in a URL and never logged. Sign-out removes it.
import { api } from './api.js';
import { store } from './store.js';
import { b64u, unb64u } from '/shared/bytes.js';
import {
  createAccountKeys, deriveFromRecoveryKey, unlockWithAccountKey, unlockWithRecoveryKey,
  prfKek, wrapAccountKey, unwrapAccountKey, encryptJson, decryptJson, openJson,
} from '/shared/crypto.js';
import { generateRecoveryKey, parseRecoveryKey } from '/shared/recovery.js';
import { solvePow } from '/shared/pow.js';

const STORAGE_KEY = 'postern.account-key';
let keys = null; // { accountKey, vaultKey, publicKey, privateKey }
const sealedCache = new Map();

// A passkey sign-in that gave a PRF value but had no stored key yet. Kept in memory
// only, so that the unlock screen can save the wrapped key for the next time.
let pendingPrf = null; // { passkeyId, prf: Uint8Array }
// Why the unlock screen shows: 'passkey-no-prf' = the passkey signed in but cannot make a key.
let lockReason = null;
export const getLockReason = () => lockReason;

export const getKeys = () => keys;
export const isUnlocked = () => keys !== null;
export const getPendingPrf = () => pendingPrf;
export const clearPendingPrf = () => { pendingPrf = null; };

function remember(accountKey) {
  try { sessionStorage.setItem(STORAGE_KEY, b64u(accountKey)); } catch { /* private mode: stay in memory */ }
}
function recall() {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    return v ? unb64u(v) : null;
  } catch { return null; }
}
// Other modules keep decrypted keys in memory too (for example message keys).
// They register here and are emptied on lock and on sign-out.
const forgetHooks = new Set();
export function onForget(fn) { forgetHooks.add(fn); }

function forget() {
  for (const fn of forgetHooks) { try { fn(); } catch { /* keep going */ } }
  keys = null;
  pendingPrf = null;
  lockReason = null;
  vaultKeyList = null;
  vaultValues.clear();
  sealedCache.clear();
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* nothing to remove */ }
}

// The account object from the server has base64url key fields.
function accountBytes(account) {
  return {
    publicKey: unb64u(account.publicKey),
    encPrivateKey: unb64u(account.encPrivateKey),
    recoveryWrap: unb64u(account.recoveryWrap),
  };
}

function setAccount(account) {
  store.set({ account, balance: account.balance || 0 });
}

function resetData() {
  store.set({ mailboxes: null, aliases: null, numbers: null, phones: null, identities: null, leaks: {}, passkeyCount: null, purchases: [], prefs: {} });
}

// Called once at start. Decides: signed out, locked, or signed in.
export async function boot() {
  let account = null;
  try {
    const res = await api.get('/api/account', { quiet401: true });
    account = res && res.account;
  } catch (err) {
    if (err.status !== 401 && err.status !== 404) throw err;
  }
  if (!account) {
    forget();
    store.set({ phase: 'out', account: null });
    return;
  }
  setAccount(account);
  const saved = recall();
  if (saved) {
    try {
      keys = await unlockWithAccountKey(saved, accountBytes(account));
      store.set({ phase: 'in' });
      return;
    } catch {
      forget(); // the saved key belongs to another account, or is damaged
    }
  }
  store.set({ phase: 'locked' });
}

// ---- sign-up ----

// Step 1: proof of work and new keys. Nothing is sent to the server yet except the
// request for a challenge. onProgress gets a number between 0 and 1.
export async function prepareSignup(onProgress) {
  const pow = await solveChallenge(onProgress);
  const recovery = await generateRecoveryKey();
  const made = await createAccountKeys(recovery.bytes);
  return { pow, recovery, made };
}

async function solveChallenge(onProgress) {
  const { challenge, bits } = await api.post('/api/auth/pow');
  const expected = 2 ** bits;
  const nonce = await solvePow(challenge, bits, (i) => { if (onProgress) onProgress(1 - Math.exp(-i / expected)); });
  if (onProgress) onProgress(1);
  return { challenge, nonce };
}

// Step 2: the person saved the recovery key. Now the account is made on the server.
export async function finishSignup(prepared, onProgress) {
  const upload = prepared.made.upload;
  const body = () => ({
    accountId: upload.accountId,
    authKey: b64u(upload.authKey),
    publicKey: b64u(upload.publicKey),
    encPrivateKey: b64u(upload.encPrivateKey),
    recoveryWrap: b64u(upload.recoveryWrap),
    pow: prepared.pow,
  });
  let res;
  try {
    res = await api.post('/api/auth/signup', body());
  } catch (err) {
    if (err.code !== 'bad_pow') throw err;
    // The challenge is valid for ten minutes. Solve a new one and try one more time.
    prepared.pow = await solveChallenge(onProgress);
    res = await api.post('/api/auth/signup', body());
  }
  const local = prepared.made.local;
  keys = { accountKey: local.accountKey, vaultKey: local.vaultKey, publicKey: local.publicKey, privateKey: local.privateKey };
  remember(keys.accountKey);
  resetData();
  setAccount(res.account);
  store.set({ phase: 'in' });
  return res.account;
}

// ---- sign-in with the recovery key ----
export async function signInWithRecoveryKey(text) {
  const bytes = await parseRecoveryKey(text);
  const d = await deriveFromRecoveryKey(bytes);
  const res = await api.post('/api/auth/login', { accountId: d.accountId, authKey: b64u(d.authKey) });
  keys = await unlockWithRecoveryKey(bytes, accountBytes(res.account));
  remember(keys.accountKey);
  resetData();
  setAccount(res.account);
  store.set({ phase: 'in' });
}

// ---- unlock (the cookie is valid, the key is missing in this tab) ----
export async function unlockWithRecovery(text) {
  const account = store.get('account');
  const bytes = await parseRecoveryKey(text);
  const d = await deriveFromRecoveryKey(bytes);
  if (d.accountId !== account.id) {
    const e = new Error('This recovery key belongs to a different account.');
    e.code = 'wrong_account';
    throw e;
  }
  keys = await unlockWithRecoveryKey(bytes, accountBytes(account));
  remember(keys.accountKey);
  store.set({ phase: 'in' });
}

// After a passkey sign-in: open the account key with the passkey's PRF value.
// Returns true if the app is unlocked now.
export async function finishPasskeySignIn({ account, passkeyId, wrappedKey, prf }) {
  forget();
  resetData();
  setAccount(account);
  if (wrappedKey && prf) {
    try {
      const accountKey = await unwrapAccountKey(await prfKek(prf), unb64u(wrappedKey));
      keys = await unlockWithAccountKey(accountKey, accountBytes(account));
      remember(keys.accountKey);
      store.set({ phase: 'in' });
      return true;
    } catch { /* fall through to the unlock screen */ }
  }
  pendingPrf = prf ? { passkeyId, prf } : null;
  lockReason = prf ? 'passkey-no-key' : 'passkey-no-prf';
  store.set({ phase: 'locked' });
  return false;
}

// Stores the account key wrapped with a passkey's PRF value, so that this passkey
// can unlock the data the next time.
export async function saveKeyForPasskey(passkeyId, prf) {
  if (!keys) throw new Error('locked');
  const wrapped = await wrapAccountKey(await prfKek(prf), keys.accountKey);
  await api.put(`/api/passkeys/${encodeURIComponent(passkeyId)}/key`, { wrappedKey: b64u(wrapped) });
}

// ---- sign-out ----
export async function signOut() {
  try { await api.post('/api/auth/logout', undefined, { quiet401: true }); } catch { /* the local sign-out still happens */ }
  dropLocal();
}

// Removes everything this tab knows. Used after sign-out, account deletion, or a 401.
export function dropLocal() {
  forget();
  resetData();
  store.set({ phase: 'out', account: null, balance: 0 });
}

// Locks this tab but keeps the cookie session.
export function lock() {
  forget();
  resetData();
  store.set({ phase: 'locked' });
}

// ---- encryption helpers for the rest of the app ----
const need = () => { if (!keys) throw new Error('The app is locked.'); return keys; };

// Label blobs ("enc" fields). Returns a base64url string.
export async function encLabel(obj, aad) {
  return b64u(await encryptJson(need().vaultKey, obj, aad));
}
export async function decLabel(enc, aad) {
  if (!enc) return {};
  try { return (await decryptJson(need().vaultKey, unb64u(enc), aad)) || {}; } catch { return {}; }
}

// Values the server sealed to this account ("sealed…" fields). Results are cached in
// memory because each one costs a key agreement.
export async function openSealed(sealed, aad) {
  if (!sealed) return null;
  const k = aad + ':' + sealed;
  if (sealedCache.has(k)) return sealedCache.get(k);
  try {
    const v = await openJson(need(), unb64u(sealed), aad);
    if (sealedCache.size > 5000) sealedCache.clear();
    sealedCache.set(k, v);
    return v;
  } catch { return null; }
}

// The encrypted key-value vault. The list of keys is asked first, so that the
// browser does not log a "404" for a value that was never saved.
let vaultKeyList = null;
// The last value that this tab read or wrote for each key (kept as text, so that nobody changes it by accident).
const vaultValues = new Map();
async function vaultHas(key, fresh) {
  if (!vaultKeyList || fresh) vaultKeyList = ((await api.get('/api/vault')) || {}).keys || [];
  return vaultKeyList.includes(key);
}
// fresh: ask the server for the key list again (another tab may have saved a value).
export async function vaultGet(key, { fresh = false } = {}) {
  if (!(await vaultHas(key, fresh))) { vaultValues.set(key, 'null'); return null; }
  let res;
  try { res = await api.get(`/api/vault/${key}`); } catch (err) { if (err.status === 404) return null; throw err; }
  if (!res || !res.value) return null;
  try {
    const value = await decryptJson(need().vaultKey, unb64u(res.value), `vault:${key}`);
    vaultValues.set(key, JSON.stringify(value === undefined ? null : value));
    return value;
  } catch { return null; }
}
export async function vaultPut(key, value) {
  const blob = b64u(await encryptJson(need().vaultKey, value, `vault:${key}`));
  await api.put(`/api/vault/${key}`, { value: blob });
  if (vaultKeyList && !vaultKeyList.includes(key)) vaultKeyList.push(key);
  vaultValues.set(key, JSON.stringify(value === undefined ? null : value));
  return blob.length;
}
// Read the newest value, change it, write it: change(current) gets the stored value (or null)
// and returns the new one. Changes to one key in this tab run one after the other.
// A write costs three requests (the key list, the value, the write). fresh: false is the cheap
// path for a key that only one feature writes: after the first read, a change is one request
// (the value that this tab read or wrote last is used). A second tab that writes the same key
// is then not seen until the next load of the page.
const vaultChains = new Map();
export function vaultChange(key, change, { fresh = true } = {}) {
  const run = (vaultChains.get(key) || Promise.resolve()).then(async () => {
    const current = !fresh && vaultValues.has(key) ? JSON.parse(vaultValues.get(key)) : await vaultGet(key, { fresh });
    const next = await change(current);
    await vaultPut(key, next);
    return next;
  });
  vaultChains.set(key, run.catch(() => {}));
  return run;
}
export async function vaultDelete(key) {
  if (!(await vaultHas(key, true))) return;
  try { await api.del(`/api/vault/${key}`); } catch (err) { if (err.status !== 404) throw err; }
  vaultKeyList = (vaultKeyList || []).filter((k) => k !== key);
  vaultValues.delete(key);
}
