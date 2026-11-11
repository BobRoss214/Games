// Auth module: sign-up with proof of work, login with the recovery key, sessions,
// the encrypted vault, account deletion, and passkeys (see passkeys.js).
// Contract: docs/API.md section 3.
import { webcrypto } from 'node:crypto';
import { fail, reply, need, b64u } from '../core/http.js';
import { createPow } from './pow.js';
import { registerPasskeys } from './passkeys.js';
import { accountView, badLogin, notFound } from './shared.js';

const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{22}$/;
const VAULT_KEY = /^[a-z0-9-]{1,40}$/;
const VAULT_MAX_BYTES = 256 * 1024;
const VAULT_MAX_KEYS = 50;
const DELETE_PHRASE = 'delete my account';

// The server seals mail to this key. A key that is not a point on the curve would break every delivery.
async function needPublicKey(bytes) {
  try {
    await webcrypto.subtle.importKey('raw', bytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  } catch {
    throw fail(400, 'bad_request', 'The value "publicKey" is not valid.');
  }
}

export async function register(app) {
  const { http, store, config } = app;
  const pow = createPow({ keys: app.keys, config });
  app.every('auth-prune', 600, async () => pow.prune());

  // ---- sign-up and login ----

  http.post('/api/auth/pow', { rate: { max: 20, per: 60 } }, () => pow.issue());

  http.post('/api/auth/signup', { rate: { max: 5, per: 3600 } }, async (c) => {
    if (config.signup === 'closed') throw fail(403, 'signup_closed', 'Sign-up is closed on this server.');
    const b = c.body;
    const input = {
      accountId: need.string(b.accountId, 'accountId', { min: 32, max: 32, pattern: ACCOUNT_ID }),
      authKey: need.bytes(b.authKey, 'authKey', { min: 32, max: 32 }),
      publicKey: need.bytes(b.publicKey, 'publicKey', { min: 65, max: 65 }),
      encPrivateKey: need.bytes(b.encPrivateKey, 'encPrivateKey', { min: 100, max: 400 }),
      recoveryWrap: need.bytes(b.recoveryWrap, 'recoveryWrap', { min: 61, max: 61 }),
    };
    if (input.publicKey[0] !== 4) throw fail(400, 'bad_request', 'The value "publicKey" is not valid.');
    await needPublicKey(input.publicKey);
    const proof = b.pow && typeof b.pow === 'object' ? b.pow : {};
    // The challenge is used up here, also when the account exists already.
    if (!(await pow.redeem(proof.challenge, proof.nonce))) {
      throw fail(400, 'bad_pow', 'The sign-up check failed or is too old. Try again.');
    }
    const account = store.createAccount(input);
    c.setSession(store.createSession(account.id));
    return reply(201, { account: accountView(account) });
  });

  http.post('/api/auth/login', { rate: { max: 10, per: 60 } }, (c) => {
    const accountId = need.string(c.body.accountId, 'accountId', { min: 32, max: 32, pattern: ACCOUNT_ID });
    const authKey = need.bytes(c.body.authKey, 'authKey', { min: 32, max: 32 });
    const account = store.verifyAuth(accountId, authKey);
    if (!account) throw badLogin();
    c.setSession(store.createSession(account.id));
    return { account: accountView(account) };
  });

  http.post('/api/auth/logout', { auth: true }, (c) => {
    store.deleteSession(c.account.id, c.session.id);
    c.clearSession();
  });

  // ---- account ----

  http.get('/api/account', { auth: true }, (c) => ({ account: accountView(c.account) }));

  http.del('/api/account', { auth: true }, async (c) => {
    if (c.body.confirm !== DELETE_PHRASE) {
      throw fail(400, 'bad_request', `To delete the account, send the text "${DELETE_PHRASE}".`);
    }
    await app.deleteAccount(c.account.id);
    c.clearSession();
  });

  // ---- sessions ----

  http.get('/api/sessions', { auth: true }, (c) => ({
    sessions: store.listSessions(c.account.id).map((s) => ({ id: s.id, createdDay: s.createdDay, current: s.id === c.session.id })),
  }));

  http.post('/api/sessions/revoke-others', { auth: true }, (c) => {
    store.deleteOtherSessions(c.account.id, c.session.id);
  });

  http.del('/api/sessions/:id', { auth: true }, (c) => {
    if (!SESSION_ID.test(c.params.id) || !store.deleteSession(c.account.id, c.params.id)) throw notFound();
    if (c.params.id === c.session.id) c.clearSession();
  });

  // ---- vault: values that the browser encrypted. The server cannot read them. ----

  const vaultKey = (c) => need.string(c.params.key, 'key', { min: 1, max: 40, pattern: VAULT_KEY });

  http.get('/api/vault', { auth: true }, (c) => ({ keys: store.vaultKeys(c.account.id) }));

  http.get('/api/vault/:key', { auth: true }, (c) => {
    const value = store.vaultGet(c.account.id, vaultKey(c));
    if (!value) throw notFound();
    return { value: b64u(value) };
  });

  // The body limit leaves room for the base64url form of the largest value.
  http.put('/api/vault/:key', { auth: true, limit: Math.ceil(VAULT_MAX_BYTES * 4 / 3) + 1024 }, (c) => {
    const key = vaultKey(c);
    const value = need.bytes(c.body.value, 'value', { min: 1, max: Number.MAX_SAFE_INTEGER });
    if (value.length > VAULT_MAX_BYTES) throw fail(413, 'too_large', 'The value is too large.');
    // One transaction, so that two requests cannot both pass the count check.
    app.db.tx(() => {
      const keys = store.vaultKeys(c.account.id);
      if (!keys.includes(key) && keys.length >= VAULT_MAX_KEYS) {
        throw fail(409, 'limit_reached', 'The vault is full. Delete a value first.');
      }
      store.vaultPut(c.account.id, key, value);
    });
  });

  http.del('/api/vault/:key', { auth: true }, (c) => {
    store.vaultDelete(c.account.id, vaultKey(c));
  });

  registerPasskeys(app);
}
