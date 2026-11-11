import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, client, newAccount, b64u, unb64u } from './helpers.js';
import { createAuthenticator } from './auth-webauthn.js';
import * as C from '../shared/crypto.js';
import { generateRecoveryKey } from '../shared/recovery.js';
import { solvePow, verifyPow } from '../shared/pow.js';
import { utf8, randomBytes } from '../shared/bytes.js';

let app;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

const ORIGIN = 'http://localhost:8080';
const RP_ID = 'localhost';

// The sign-up values in the JSON form that the browser sends.
const uploadJson = (u) => ({
  accountId: u.accountId, authKey: b64u(u.authKey), publicKey: b64u(u.publicKey),
  encPrivateKey: b64u(u.encPrivateKey), recoveryWrap: b64u(u.recoveryWrap),
});

async function solvedPow(api) {
  const res = await api.post('/api/auth/pow');
  assert.equal(res.status, 200);
  return { challenge: res.data.challenge, nonce: await solvePow(res.data.challenge, res.data.bits) };
}

async function newKeys() {
  const recovery = await generateRecoveryKey();
  return { recovery, keys: await C.createAccountKeys(recovery.bytes) };
}

// Full sign-up over HTTP, with the shared modules that the browser uses.
async function signUp(target = app) {
  const api = client(target);
  const { recovery, keys } = await newKeys();
  const res = await api.post('/api/auth/signup', { ...uploadJson(keys.upload), pow: await solvedPow(api) });
  return { api, recovery, keys, res, id: keys.upload.accountId };
}

const err = (res) => res.data && res.data.error && res.data.error.code;

test('sign-up: proof of work, cookie, account object, unlock with the recovery key', async () => {
  const { api, recovery, keys, res } = await signUp();
  assert.equal(res.status, 201);
  assert.match(res.headers.get('set-cookie'), /^postern=[A-Za-z0-9_-]{20,}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
  const account = res.data.account;
  assert.deepEqual(Object.keys(account).sort(), ['balance', 'createdDay', 'encPrivateKey', 'id', 'publicKey', 'recoveryWrap']);
  assert.equal(account.id, keys.upload.accountId);
  assert.equal(account.publicKey, b64u(keys.upload.publicKey));
  assert.equal(account.balance, 0);
  assert.match(account.createdDay, /^\d{4}-\d{2}-\d{2}$/);

  const me = await api.get('/api/account');
  assert.equal(me.status, 200);
  assert.deepEqual(me.data.account, account);

  // A new browser has only the recovery key and the server copy. It can open sealed data.
  const unlocked = await C.unlockWithRecoveryKey(recovery.bytes, {
    publicKey: unb64u(account.publicKey), encPrivateKey: unb64u(account.encPrivateKey), recoveryWrap: unb64u(account.recoveryWrap),
  });
  const sealed = await app.store.sealJsonFor(account.id, { hello: 'you' }, 'address');
  assert.deepEqual(await C.openJson(unlocked, new Uint8Array(sealed), 'address'), { hello: 'you' });

  // The server keeps only a hash of the login secret.
  const row = app.db.get('SELECT auth_hash FROM accounts WHERE id = ?', account.id);
  assert.notDeepEqual(Buffer.from(row.auth_hash), Buffer.from(keys.upload.authKey));
});

test('sign-up: bad proof of work is refused', async () => {
  const api = client(app);
  const { keys } = await newKeys();
  const body = uploadJson(keys.upload);
  const { data } = await api.post('/api/auth/pow');
  assert.equal(data.bits, app.config.powBits);

  // A nonce that does not solve the puzzle.
  let wrong = 0;
  while (await verifyPow(data.challenge, 'x' + wrong, data.bits)) wrong++;
  let res = await api.post('/api/auth/signup', { ...body, pow: { challenge: data.challenge, nonce: 'x' + wrong } });
  assert.equal(res.status, 400);
  assert.equal(err(res), 'bad_pow');

  // A challenge that the server did not sign.
  const forged = data.challenge.slice(0, -2) + (data.challenge.endsWith('AA') ? 'BB' : 'AA');
  res = await api.post('/api/auth/signup', { ...body, pow: { challenge: forged, nonce: await solvePow(forged, data.bits) } });
  assert.equal(err(res), 'bad_pow');

  // A challenge with a valid signature that is too old.
  const payload = `${Math.floor(Date.now() / 1000) - 5}.${b64u(randomBytes(16))}`;
  const old = `${payload}.${app.keys.sign('pow', payload)}`;
  res = await api.post('/api/auth/signup', { ...body, pow: { challenge: old, nonce: await solvePow(old, data.bits) } });
  assert.equal(err(res), 'bad_pow');

  // No proof at all, and wrong types.
  assert.equal(err(await api.post('/api/auth/signup', body)), 'bad_pow');
  assert.equal(err(await api.post('/api/auth/signup', { ...body, pow: { challenge: 7, nonce: ['a'] } })), 'bad_pow');

  // No account was made and no cookie was set.
  assert.equal(app.store.getAccount(keys.upload.accountId), null);
  assert.equal(api.cookie, '');
  // The correct solution still works after the failed tries.
  res = await api.post('/api/auth/signup', { ...body, pow: { challenge: data.challenge, nonce: await solvePow(data.challenge, data.bits) } });
  assert.equal(res.status, 201);
});

test('sign-up: a challenge works one time; an account cannot be made twice', async () => {
  const api = client(app);
  const first = await newKeys();
  const pow = await solvedPow(api);
  assert.equal((await api.post('/api/auth/signup', { ...uploadJson(first.keys.upload), pow })).status, 201);

  const second = await newKeys();
  const again = await client(app).post('/api/auth/signup', { ...uploadJson(second.keys.upload), pow });
  assert.equal(again.status, 400);
  assert.equal(err(again), 'bad_pow');
  assert.equal(app.store.getAccount(second.keys.upload.accountId), null);

  // Two requests at the same moment with one challenge: one wins.
  const racePow = await solvedPow(api);
  const racers = await Promise.all([await newKeys(), await newKeys()].map((k) => client(app).post('/api/auth/signup', { ...uploadJson(k.keys.upload), pow: racePow })));
  assert.deepEqual(racers.map((r) => r.status).sort(), [201, 400]);

  const dup = await client(app).post('/api/auth/signup', { ...uploadJson(first.keys.upload), pow: await solvedPow(api) });
  assert.equal(dup.status, 409);
  assert.equal(err(dup), 'account_exists');
});

test('sign-up: input checks', async () => {
  const api = client(app);
  const { keys } = await newKeys();
  const good = uploadJson(keys.upload);
  const cases = [
    { accountId: 'ABC' }, { accountId: good.accountId.toUpperCase() }, { authKey: b64u(randomBytes(31)) }, { authKey: 'not base64!' },
    { publicKey: b64u(randomBytes(65)) }, { publicKey: b64u(new Uint8Array(65).fill(4)) }, { encPrivateKey: b64u(randomBytes(10)) },
    { recoveryWrap: b64u(randomBytes(60)) }, { recoveryWrap: null },
  ];
  for (const change of cases) {
    const res = await api.post('/api/auth/signup', { ...good, ...change, pow: await solvedPow(api) });
    assert.equal(res.status, 400, JSON.stringify(change));
    assert.equal(err(res), 'bad_request');
  }
  assert.equal(app.store.getAccount(keys.upload.accountId), null);
  // The body must be JSON.
  const form = await api.call('POST', '/api/auth/signup', 'a=b', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415);
});

test('sign-up: closed', async () => {
  const closed = await startTestApp({ signup: 'closed' });
  try {
    const { res, id } = await signUp(closed);
    assert.equal(res.status, 403);
    assert.equal(err(res), 'signup_closed');
    assert.equal(closed.store.getAccount(id), null);
    assert.equal((await client(closed).get('/api/config')).data.signup, 'closed');
    // Accounts that exist already can still sign in.
    const a = await newAccount(closed);
    const login = await client(closed).post('/api/auth/login', { accountId: a.id, authKey: b64u(a.upload.authKey) });
    assert.equal(login.status, 200);
  } finally {
    await closed.stop();
  }
});

test('login: correct key; one error for a wrong key and for an unknown account', async () => {
  const { keys, id } = await signUp();
  const api = client(app);
  const ok = await api.post('/api/auth/login', { accountId: id, authKey: b64u(keys.upload.authKey) });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.account.id, id);
  assert.ok(api.cookie.startsWith('postern='));
  assert.equal((await api.get('/api/account')).status, 200);

  // The browser derives the same login values from the recovery key alone.
  const anon = client(app);
  const wrongKey = await anon.post('/api/auth/login', { accountId: id, authKey: b64u(randomBytes(32)) });
  const unknown = await anon.post('/api/auth/login', { accountId: 'f'.repeat(32), authKey: b64u(keys.upload.authKey) });
  assert.equal(wrongKey.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(err(wrongKey), 'bad_login');
  assert.deepEqual(wrongKey.data, unknown.data);
  assert.equal(anon.cookie, '');
  assert.equal(wrongKey.headers.get('set-cookie'), null);

  assert.equal((await anon.post('/api/auth/login', { accountId: id })).status, 400);
  assert.equal((await anon.post('/api/auth/login', { accountId: { $ne: '' }, authKey: b64u(keys.upload.authKey) })).status, 400);
  assert.equal((await anon.get('/api/account')).status, 401);
});

test('login: rate limit', async () => {
  const limited = await startTestApp({ rateLimits: true });
  try {
    const api = client(limited);
    const body = { accountId: '0'.repeat(32), authKey: b64u(randomBytes(32)) };
    for (let i = 0; i < 10; i++) assert.equal((await api.post('/api/auth/login', body)).status, 401);
    const res = await api.post('/api/auth/login', body);
    assert.equal(res.status, 429);
    assert.equal(err(res), 'rate_limited');
  } finally {
    await limited.stop();
  }
});

test('logout deletes the session', async () => {
  const { api, id } = await signUp();
  const token = api.cookie.split('=')[1];
  assert.ok(app.store.getSession(token));
  const out = await api.post('/api/auth/logout');
  assert.equal(out.status, 204);
  assert.match(out.headers.get('set-cookie'), /^postern=; .*Max-Age=0/);
  assert.equal(api.cookie, '');
  assert.equal(app.store.getSession(token), null);
  assert.equal(app.store.listSessions(id).length, 0);
  // The old cookie value does not work again.
  api.setCookie(`postern=${token}`);
  assert.equal((await api.get('/api/account')).status, 401);
  assert.equal((await client(app).post('/api/auth/logout')).status, 401);
});

test('sessions: list, revoke one, revoke others', async () => {
  const { api: one, keys, id } = await signUp();
  const login = { accountId: id, authKey: b64u(keys.upload.authKey) };
  const two = client(app);
  const three = client(app);
  await two.post('/api/auth/login', login);
  await three.post('/api/auth/login', login);

  const list = (await one.get('/api/sessions')).data.sessions;
  assert.equal(list.length, 3);
  assert.equal(list.filter((s) => s.current).length, 1);
  for (const s of list) {
    assert.deepEqual(Object.keys(s).sort(), ['createdDay', 'current', 'id']);
    assert.match(s.id, /^[A-Za-z0-9_-]{22}$/);
  }
  const mine = list.find((s) => s.current).id;
  const twoId = (await two.get('/api/sessions')).data.sessions.find((s) => s.current).id;
  assert.notEqual(mine, twoId);

  assert.equal((await one.del(`/api/sessions/${twoId}`)).status, 204);
  assert.equal((await two.get('/api/account')).status, 401);
  assert.equal((await one.del(`/api/sessions/${twoId}`)).status, 404);
  assert.equal((await one.del('/api/sessions/not-an-id')).status, 404);

  assert.equal((await three.post('/api/sessions/revoke-others')).status, 204);
  assert.equal((await one.get('/api/account')).status, 401);
  const left = (await three.get('/api/sessions')).data.sessions;
  assert.equal(left.length, 1);
  assert.equal(left[0].current, true);

  // To delete the current session signs the browser out.
  const self = await three.del(`/api/sessions/${left[0].id}`);
  assert.equal(self.status, 204);
  assert.equal(three.cookie, '');
});

test('vault: put, get, list, delete, limits', async () => {
  const a = await newAccount(app);
  const box = await C.encryptJson(a.keys.vaultKey, { pending: [1, 2, 3] }, 'vault:pending-purchases');
  assert.deepEqual((await a.api.get('/api/vault')).data, { keys: [] });
  assert.equal((await a.api.get('/api/vault/pending-purchases')).status, 404);

  assert.equal((await a.api.put('/api/vault/pending-purchases', { value: b64u(box) })).status, 204);
  assert.equal((await a.api.put('/api/vault/a-1', { value: b64u(randomBytes(40)) })).status, 204);
  assert.deepEqual((await a.api.get('/api/vault')).data, { keys: ['a-1', 'pending-purchases'] });
  const got = await a.api.get('/api/vault/pending-purchases');
  assert.equal(got.status, 200);
  assert.deepEqual(await C.decryptJson(a.keys.vaultKey, unb64u(got.data.value), 'vault:pending-purchases'), { pending: [1, 2, 3] });

  // Replace a value.
  const next = randomBytes(64);
  await a.api.put('/api/vault/a-1', { value: b64u(next) });
  assert.equal((await a.api.get('/api/vault/a-1')).data.value, b64u(next));

  // Key names and values are checked.
  for (const key of ['UPPER', 'a_b', 'a'.repeat(41), 'a.b', '%20']) {
    assert.equal((await a.api.put(`/api/vault/${key}`, { value: b64u(randomBytes(8)) })).status, 400, key);
    assert.equal((await a.api.get(`/api/vault/${key}`)).status, 400, key);
  }
  assert.equal((await a.api.put('/api/vault/k', {})).status, 400);
  assert.equal((await a.api.put('/api/vault/k', { value: '' })).status, 400);
  assert.equal((await a.api.put('/api/vault/k', { value: 'a+b/' })).status, 400);

  // Size: 256 KB is the largest value.
  assert.equal((await a.api.put('/api/vault/big', { value: b64u(new Uint8Array(256 * 1024).fill(7)) })).status, 204);
  const tooBig = await a.api.put('/api/vault/big', { value: b64u(new Uint8Array(256 * 1024 + 1).fill(7)) });
  assert.equal(tooBig.status, 413);
  assert.equal(err(tooBig), 'too_large');
  assert.equal((await a.api.put('/api/vault/big', { value: 'A'.repeat(600 * 1024) })).status, 413);

  assert.equal((await a.api.del('/api/vault/big')).status, 204);
  assert.equal((await a.api.get('/api/vault/big')).status, 404);
  assert.equal((await a.api.del('/api/vault/big')).status, 204); // delete is safe to repeat

  // 50 keys at most. A value that exists can still be replaced.
  for (let i = 0; i < 48; i++) assert.equal((await a.api.put(`/api/vault/k${i}`, { value: 'AAAA' })).status, 204);
  assert.equal((await a.api.get('/api/vault')).data.keys.length, 50);
  const full = await a.api.put('/api/vault/one-more', { value: 'AAAA' });
  assert.equal(full.status, 409);
  assert.equal(err(full), 'limit_reached');
  assert.equal((await a.api.put('/api/vault/k0', { value: 'BBBB' })).status, 204);
  assert.equal((await client(app).get('/api/vault')).status, 401);
});

test('account: delete needs the confirm text and removes everything', async () => {
  const { api, keys, id } = await signUp();
  await api.put('/api/vault/note', { value: 'AAAA' });
  assert.equal((await api.del('/api/account')).status, 400);
  assert.equal((await api.del('/api/account', { confirm: 'yes' })).status, 400);
  assert.ok(app.store.getAccount(id));

  const res = await api.del('/api/account', { confirm: 'delete my account' });
  assert.equal(res.status, 204);
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(app.store.getAccount(id), null);
  assert.equal(app.store.vaultGet(id, 'note'), null);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?', id).n, 0);
  const login = await client(app).post('/api/auth/login', { accountId: id, authKey: b64u(keys.upload.authKey) });
  assert.equal(login.status, 401);
  assert.equal((await client(app).del('/api/account', { confirm: 'delete my account' })).status, 401);
});

test('requests from a different website are refused', async () => {
  const a = await newAccount(app);
  const res = await a.api.put('/api/vault/x', { value: 'AAAA' }, { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  assert.equal(err(res), 'bad_origin');
  assert.equal((await a.api.put('/api/vault/x', { value: 'AAAA' }, { origin: ORIGIN })).status, 204);
});

// ---- passkeys ----

async function addPasskey(account, device, { enc } = {}) {
  const opts = await account.api.post('/api/passkeys/register/options');
  assert.equal(opts.status, 200);
  const response = device.create(opts.data.options);
  const res = await account.api.post('/api/passkeys/register/verify', { response, enc });
  return { opts: opts.data.options, response, res };
}

async function passkeyLogin(device, extra = {}, api = client(app)) {
  const opts = await api.post('/api/auth/passkey/options');
  assert.equal(opts.status, 200);
  const response = device.get(opts.data.options, extra);
  const res = await api.post('/api/auth/passkey/verify', { challengeId: opts.data.challengeId, response });
  return { api, opts: opts.data, response, res };
}

test('passkeys: register, store the wrapped key, sign in, unlock', async () => {
  const a = await signUp();
  const device = createAuthenticator({ origin: ORIGIN, rpId: RP_ID });
  assert.deepEqual((await a.api.get('/api/passkeys')).data, { passkeys: [] });

  const label = await C.encryptJson(a.keys.local.vaultKey, { label: 'Laptop' }, 'passkey');
  const { opts, response, res } = await addPasskey(a, device, { enc: b64u(label) });

  // Creation options as the contract describes them.
  assert.equal(opts.rp.id, RP_ID);
  assert.equal(opts.rp.name, 'Postern');
  assert.equal(opts.user.name, 'Postern account');
  assert.equal(opts.user.id, b64u(app.store.getAccount(a.id).userHandle));
  assert.equal(opts.attestation, 'none');
  assert.equal(opts.authenticatorSelection.residentKey, 'required');
  assert.equal(opts.authenticatorSelection.userVerification, 'required');
  assert.deepEqual(opts.extensions.prf, {});
  assert.deepEqual(opts.excludeCredentials, []);
  assert.ok(opts.pubKeyCredParams.some((p) => p.alg === -7));
  assert.ok(!JSON.stringify(opts).includes(a.id), 'the options must not hold the account number');

  assert.equal(res.status, 201);
  const passkey = res.data.passkey;
  assert.deepEqual(Object.keys(passkey).sort(), ['createdDay', 'enc', 'hasKey', 'id']);
  assert.equal(passkey.id, response.id);
  assert.equal(passkey.hasKey, false);
  assert.deepEqual(await C.decryptJson(a.keys.local.vaultKey, unb64u(passkey.enc), 'passkey'), { label: 'Laptop' });

  // The browser wraps the account key with the PRF value of the passkey.
  const salt = await C.sha256('postern/v1/prf-salt');
  const wrapped = await C.wrapAccountKey(await C.prfKek(device.prf(passkey.id, salt)), a.keys.local.accountKey);
  assert.equal(wrapped.length, 61);
  assert.equal((await a.api.put(`/api/passkeys/${passkey.id}/key`, { wrappedKey: b64u(wrapped) })).status, 204);
  assert.equal((await a.api.put(`/api/passkeys/${passkey.id}/key`, { wrappedKey: b64u(randomBytes(60)) })).status, 400);
  const listed = (await a.api.get('/api/passkeys')).data.passkeys;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].hasKey, true);
  assert.equal(listed[0].wrappedKey, undefined);

  // The next options exclude the passkey that exists.
  const second = await a.api.post('/api/passkeys/register/options');
  assert.deepEqual(second.data.options.excludeCredentials.map((c) => c.id), [passkey.id]);

  assert.equal((await a.api.post('/api/auth/logout')).status, 204);

  // Sign in with the passkey in a new browser.
  const login = await passkeyLogin(device);
  assert.equal(login.opts.options.rpId, RP_ID);
  assert.equal(login.opts.options.userVerification, 'required');
  assert.deepEqual(login.opts.options.allowCredentials, []);
  assert.match(login.opts.challengeId, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(login.res.status, 200);
  assert.equal(login.res.data.account.id, a.id);
  assert.equal(login.res.data.passkeyId, passkey.id);
  assert.equal(login.res.data.wrappedKey, b64u(wrapped));
  assert.ok(login.api.cookie.startsWith('postern='));
  assert.equal((await login.api.get('/api/account')).status, 200);

  // The browser opens the account key with the same PRF value and can read sealed data.
  const acct = login.res.data.account;
  const accountKey = await C.unwrapAccountKey(await C.prfKek(device.prf(passkey.id, salt)), unb64u(login.res.data.wrappedKey));
  const unlocked = await C.unlockWithAccountKey(accountKey, { publicKey: unb64u(acct.publicKey), encPrivateKey: unb64u(acct.encPrivateKey) });
  const sealed = await app.store.sealJsonFor(a.id, { address: 'x@postern.test' }, 'address');
  assert.deepEqual(await C.openJson(unlocked, new Uint8Array(sealed), 'address'), { address: 'x@postern.test' });

  // The counter of the passkey is stored.
  assert.equal(app.db.get('SELECT counter FROM passkeys WHERE id = ?', passkey.id).counter, 1);
  assert.equal((await passkeyLogin(device)).res.status, 200);
  assert.equal(app.db.get('SELECT counter FROM passkeys WHERE id = ?', passkey.id).counter, 2);
});

test('passkeys: a passkey without a wrapped key signs in with wrappedKey null', async () => {
  const a = await signUp();
  const device = createAuthenticator({ origin: ORIGIN, rpId: RP_ID });
  const { res } = await addPasskey(a, device);
  assert.equal(res.status, 201);
  assert.equal(res.data.passkey.enc, null);
  const login = await passkeyLogin(device);
  assert.equal(login.res.status, 200);
  assert.equal(login.res.data.wrappedKey, null);
});

test('passkeys: failed sign-in attempts all give the same error', async () => {
  const a = await signUp();
  const device = createAuthenticator({ origin: ORIGIN, rpId: RP_ID });
  const { res: reg } = await addPasskey(a, device);
  const id = reg.data.passkey.id;
  const refused = [];

  // Wrong signature: the attacker knows the credential id but not the private key.
  refused.push((await passkeyLogin(device, { badSignature: true })).res);
  // Unknown passkey.
  const stranger = createAuthenticator({ origin: ORIGIN, rpId: RP_ID });
  stranger.create({ rp: { id: RP_ID }, user: { id: b64u(randomBytes(16)) }, challenge: 'x' });
  refused.push((await passkeyLogin(stranger)).res);
  // The answer was made for a different website (phishing).
  refused.push((await passkeyLogin(device, { origin: 'https://postern.evil.example' })).res);
  // The user was not verified (no PIN or biometric check).
  refused.push((await passkeyLogin(device, { flags: 0x01 })).res);
  // The user handle belongs to a different account.
  const other = await newAccount(app);
  const api = client(app);
  let opts = (await api.post('/api/auth/passkey/options')).data;
  let response = device.get(opts.options);
  response.response.userHandle = b64u(app.store.getAccount(other.id).userHandle);
  refused.push(await api.post('/api/auth/passkey/verify', { challengeId: opts.challengeId, response }));
  // Unknown challenge id.
  opts = (await api.post('/api/auth/passkey/options')).data;
  response = device.get(opts.options);
  refused.push(await api.post('/api/auth/passkey/verify', { challengeId: 'A'.repeat(22), response }));
  // A challenge from a different request.
  const otherOpts = (await api.post('/api/auth/passkey/options')).data;
  refused.push(await api.post('/api/auth/passkey/verify', { challengeId: otherOpts.challengeId, response }));

  for (const res of refused) {
    assert.equal(res.status, 401);
    assert.deepEqual(res.data, refused[0].data);
    assert.equal(err(res), 'bad_login');
    assert.equal(res.headers.get('set-cookie'), null);
  }

  // A challenge works one time, also after a correct sign-in.
  const good = await passkeyLogin(device);
  assert.equal(good.res.status, 200);
  const replay = await client(app).post('/api/auth/passkey/verify', { challengeId: good.opts.challengeId, response: good.response });
  assert.equal(replay.status, 401);
  // An old answer with a new challenge id fails: the signature covers the old challenge.
  const fresh = (await api.post('/api/auth/passkey/options')).data;
  assert.equal((await api.post('/api/auth/passkey/verify', { challengeId: fresh.challengeId, response: good.response })).status, 401);

  // Malformed input.
  assert.equal((await api.post('/api/auth/passkey/verify', {})).status, 400);
  assert.equal((await api.post('/api/auth/passkey/verify', { challengeId: fresh.challengeId, response: 'x' })).status, 400);
  assert.equal((await api.post('/api/auth/passkey/verify', { challengeId: fresh.challengeId, response: { id, rawId: id, type: 'public-key', response: {} } })).status, 400);

  // A deleted passkey cannot sign in.
  assert.equal((await a.api.del(`/api/passkeys/${id}`)).status, 204);
  assert.equal((await passkeyLogin(device)).res.status, 401);
  assert.equal((await a.api.del(`/api/passkeys/${id}`)).status, 404);
});

test('passkeys: registration checks', async () => {
  const a = await signUp();
  const device = createAuthenticator({ origin: ORIGIN, rpId: RP_ID });
  const bad = async (res) => { assert.equal(res.status, 400); assert.equal(err(res), 'bad_passkey'); };

  // No options request before the answer.
  const stale = device.create({ rp: { id: RP_ID }, user: { id: 'AAAA' }, challenge: b64u(randomBytes(32)) });
  await bad(await a.api.post('/api/passkeys/register/verify', { response: stale }));

  // Wrong website.
  let opts = (await a.api.post('/api/passkeys/register/options')).data.options;
  await bad(await a.api.post('/api/passkeys/register/verify', { response: device.create(opts, { origin: 'https://evil.example' }) }));

  // The failed try used up the challenge.
  await bad(await a.api.post('/api/passkeys/register/verify', { response: device.create(opts) }));

  // No user verification.
  opts = (await a.api.post('/api/passkeys/register/options')).data.options;
  await bad(await a.api.post('/api/passkeys/register/verify', { response: device.create(opts, { flags: 0x41 }) }));

  // The challenge of account A does not work for account B.
  const b = await signUp();
  opts = (await a.api.post('/api/passkeys/register/options')).data.options;
  await bad(await b.api.post('/api/passkeys/register/verify', { response: device.create(opts) }));

  // Input checks.
  assert.equal((await a.api.post('/api/passkeys/register/verify', {})).status, 400);
  opts = (await a.api.post('/api/passkeys/register/options')).data.options;
  const response = device.create(opts);
  assert.equal((await a.api.post('/api/passkeys/register/verify', { response, enc: b64u(randomBytes(2049)) })).status, 400);

  assert.deepEqual((await a.api.get('/api/passkeys')).data.passkeys, []);
  assert.equal((await client(app).post('/api/passkeys/register/options')).status, 401);
  assert.equal((await client(app).get('/api/passkeys')).status, 401);
});

test('passkeys: label change, limit of 10, same passkey cannot be added twice', async () => {
  const a = await signUp();
  const device = createAuthenticator({ origin: ORIGIN, rpId: RP_ID });
  const first = await addPasskey(a, device);
  const id = first.res.data.passkey.id;

  const label = await C.encryptJson(a.keys.local.vaultKey, { label: 'Phone' }, 'passkey');
  const patched = await a.api.patch(`/api/passkeys/${id}`, { enc: b64u(label) });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.passkey.enc, b64u(label));
  assert.equal(patched.data.passkey.id, id);
  assert.equal((await a.api.patch(`/api/passkeys/${id}`, {})).status, 400);
  assert.equal((await a.api.patch('/api/passkeys/unknown', { enc: b64u(label) })).status, 404);

  // The id in the answer must match the id inside the signed data.
  let opts = (await a.api.post('/api/passkeys/register/options')).data.options;
  const mixed = device.create({ ...opts, excludeCredentials: [] });
  device.credentials.delete(mixed.id);
  mixed.id = id; mixed.rawId = id;
  const mismatch = await a.api.post('/api/passkeys/register/verify', { response: mixed });
  assert.equal(mismatch.status, 400);
  assert.equal(err(mismatch), 'bad_passkey');

  // The same credential cannot be stored twice, not by this account and not by a different account.
  for (const who of [a, await signUp()]) {
    opts = (await who.api.post('/api/passkeys/register/options')).data.options;
    const dup = await who.api.post('/api/passkeys/register/verify', { response: device.create(opts, { reuse: id }) });
    assert.equal(dup.status, 409);
    assert.equal(err(dup), 'conflict');
  }
  assert.equal(app.db.get('SELECT account_id FROM passkeys WHERE id = ?', id).account_id, a.id);

  // One device refuses a second passkey for the same account (excludeCredentials), so each one is a new device.
  opts = (await a.api.post('/api/passkeys/register/options')).data.options;
  assert.throws(() => device.create(opts), /InvalidStateError/);
  for (let i = 1; i < 10; i++) {
    assert.equal((await addPasskey(a, createAuthenticator({ origin: ORIGIN, rpId: RP_ID }))).res.status, 201);
  }
  assert.equal((await a.api.get('/api/passkeys')).data.passkeys.length, 10);
  const full = await a.api.post('/api/passkeys/register/options');
  assert.equal(full.status, 409);
  assert.equal(err(full), 'limit_reached');
  // After one is deleted there is room again.
  assert.equal((await a.api.del(`/api/passkeys/${id}`)).status, 204);
  assert.equal((await addPasskey(a, createAuthenticator({ origin: ORIGIN, rpId: RP_ID }))).res.status, 201);
});

test('cross-account isolation', async () => {
  const a = await signUp();
  const b = await signUp();
  const device = createAuthenticator({ origin: ORIGIN, rpId: RP_ID });
  const passkeyId = (await addPasskey(a, device)).res.data.passkey.id;
  await a.api.put('/api/vault/secret', { value: b64u(utf8('only for a')) });
  const sessionA = (await a.api.get('/api/sessions')).data.sessions[0].id;

  // B sees nothing of A and cannot change it.
  assert.deepEqual((await b.api.get('/api/vault')).data.keys, []);
  assert.equal((await b.api.get('/api/vault/secret')).status, 404);
  assert.equal((await b.api.del('/api/vault/secret')).status, 204);
  assert.equal((await a.api.get('/api/vault/secret')).status, 200);
  assert.deepEqual((await b.api.get('/api/passkeys')).data.passkeys, []);
  assert.equal((await b.api.put(`/api/passkeys/${passkeyId}/key`, { wrappedKey: b64u(randomBytes(61)) })).status, 404);
  assert.equal((await b.api.patch(`/api/passkeys/${passkeyId}`, { enc: b64u(randomBytes(40)) })).status, 404);
  assert.equal((await b.api.del(`/api/passkeys/${passkeyId}`)).status, 404);
  assert.equal((await b.api.del(`/api/sessions/${sessionA}`)).status, 404);
  assert.equal((await b.api.get('/api/sessions')).data.sessions.length, 1);
  assert.equal((await b.api.get('/api/account')).data.account.id, b.id);
  await b.api.post('/api/sessions/revoke-others');
  assert.equal((await a.api.get('/api/account')).status, 200);

  // A is not changed.
  const pk = (await a.api.get('/api/passkeys')).data.passkeys;
  assert.equal(pk.length, 1);
  assert.equal(pk[0].hasKey, false);

  // When B deletes the account, A stays. The passkey of A still signs in to A.
  assert.equal((await b.api.del('/api/account', { confirm: 'delete my account' })).status, 204);
  const login = await passkeyLogin(device);
  assert.equal(login.res.status, 200);
  assert.equal(login.res.data.account.id, a.id);

  // When A deletes the account, the passkey is gone.
  assert.equal((await a.api.del('/api/account', { confirm: 'delete my account' })).status, 204);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM passkeys WHERE id = ?', passkeyId).n, 0);
  assert.equal((await passkeyLogin(device)).res.status, 401);
});
