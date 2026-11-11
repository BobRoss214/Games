// Passkeys (WebAuthn). A passkey proves who the user is. With the PRF extension it also
// gives the browser a key that opens the account key (the server stores only the wrapped form).
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { fail, reply, need, b64u } from '../core/http.js';
import { today } from '../core/db.js';
import { randomId, safeEqual } from '../core/keys.js';
import { createTtlMap } from './ttl-map.js';
import { accountView, badLogin, notFound, startSession } from './shared.js';

const MAX_PASSKEYS = 10;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ENC_BYTES = 2048;
const WRAPPED_KEY_BYTES = 61; // version(1) + iv(12) + account key(32) + tag(16)
const B64U = /^[A-Za-z0-9_-]+$/;
// A credential id has at most 1023 bytes (1364 base64url characters).
const CREDENTIAL_ID = /^[A-Za-z0-9_-]{1,1364}$/;
const CHALLENGE_ID = /^[A-Za-z0-9_-]{22}$/;
const TRANSPORTS = new Set(['usb', 'nfc', 'ble', 'smart-card', 'hybrid', 'internal', 'cable']);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,              -- WebAuthn credential id, base64url
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,         -- COSE public key
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  enc BLOB,                         -- label, encrypted in the browser
  wrapped_key BLOB,                 -- account key, wrapped in the browser with the passkey PRF key
  created_day TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS passkeys_account ON passkeys(account_id);
`;

const badPasskey = () => fail(400, 'bad_passkey', 'The passkey check failed. Try again.');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, name, max) => need.string(v, name, { min: 1, max, pattern: B64U });

// Copies only the fields that the check needs, with size limits. Extension results are
// dropped here: a PRF result is a secret of the browser and must not reach the server code.
function cleanCredential(v) {
  if (!isObject(v) || !isObject(v.response)) throw fail(400, 'bad_request', 'The value "response" is not valid.');
  if (v.type !== 'public-key') throw fail(400, 'bad_request', 'The value "response.type" is not valid.');
  return {
    id: need.string(v.id, 'response.id', { min: 1, max: 1364, pattern: CREDENTIAL_ID }),
    rawId: need.string(v.rawId, 'response.rawId', { min: 1, max: 1364, pattern: CREDENTIAL_ID }),
    type: 'public-key',
    clientExtensionResults: {},
  };
}

function cleanRegistration(v) {
  const out = cleanCredential(v);
  const r = v.response;
  const transports = Array.isArray(r.transports) ? r.transports.filter((t) => TRANSPORTS.has(t)).slice(0, TRANSPORTS.size) : [];
  out.response = {
    clientDataJSON: text(r.clientDataJSON, 'response.clientDataJSON', 4096),
    attestationObject: text(r.attestationObject, 'response.attestationObject', 32768),
    transports: [...new Set(transports)],
  };
  return out;
}

function cleanAssertion(v) {
  const out = cleanCredential(v);
  const r = v.response;
  out.response = {
    clientDataJSON: text(r.clientDataJSON, 'response.clientDataJSON', 4096),
    authenticatorData: text(r.authenticatorData, 'response.authenticatorData', 4096),
    signature: text(r.signature, 'response.signature', 8192),
  };
  if (r.userHandle !== undefined && r.userHandle !== null && r.userHandle !== '') {
    out.response.userHandle = text(r.userHandle, 'response.userHandle', 128);
  }
  return out;
}

export function registerPasskeys(app) {
  const { http, db, store, config } = app;
  db.exec(SCHEMA);

  // Challenges stay in memory and work one time. A restart cancels open requests.
  const regChallenges = createTtlMap({ ttlMs: CHALLENGE_TTL_MS, max: 50_000 }); // account id -> challenge
  const loginChallenges = createTtlMap({ ttlMs: CHALLENGE_TTL_MS, max: 50_000 }); // challenge id -> challenge
  app.onAccountDelete((accountId) => { regChallenges.delete(accountId); });
  app.every('passkey-prune', 600, async () => { regChallenges.prune(); loginChallenges.prune(); });

  const view = (r) => ({ id: r.id, enc: b64u(r.enc), createdDay: r.created_day, hasKey: r.wrapped_key !== null });
  const getOwn = (c) => {
    const row = CREDENTIAL_ID.test(c.params.id) ? db.get('SELECT * FROM passkeys WHERE account_id = ? AND id = ?', c.account.id, c.params.id) : null;
    if (!row) throw notFound();
    return row;
  };
  const count = (accountId) => db.get('SELECT COUNT(*) AS n FROM passkeys WHERE account_id = ?', accountId).n;
  const needRoom = (accountId) => {
    if (count(accountId) >= MAX_PASSKEYS) throw fail(409, 'limit_reached', `You can have ${MAX_PASSKEYS} passkeys. Delete one first.`);
  };
  const transportsOf = (row) => {
    try { return JSON.parse(row.transports); } catch { return []; }
  };

  // ---- manage passkeys (signed in) ----

  http.get('/api/passkeys', { auth: true }, (c) => ({
    passkeys: db.all('SELECT * FROM passkeys WHERE account_id = ? ORDER BY rowid', c.account.id).map(view),
  }));

  http.post('/api/passkeys/register/options', { auth: true, rate: { max: 20, per: 60 } }, async (c) => {
    needRoom(c.account.id);
    const existing = db.all('SELECT id, transports FROM passkeys WHERE account_id = ?', c.account.id);
    const options = await generateRegistrationOptions({
      rpName: config.appName,
      rpID: config.rpId,
      userID: new Uint8Array(c.account.userHandle),
      // The same text for every account. The passkey must not hold an identifier of the person.
      userName: 'Postern account',
      userDisplayName: 'Postern account',
      timeout: CHALLENGE_TTL_MS,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: existing.map((r) => ({ id: r.id, transports: transportsOf(r) })),
      extensions: { prf: {} },
    });
    regChallenges.set(c.account.id, options.challenge);
    return { options };
  });

  http.post('/api/passkeys/register/verify', { auth: true, rate: { max: 20, per: 60 } }, async (c) => {
    const response = cleanRegistration(c.body.response);
    const enc = need.optional(c.body.enc, need.bytes, 'enc', { min: 1, max: MAX_ENC_BYTES });
    const expectedChallenge = regChallenges.take(c.account.id);
    if (!expectedChallenge) throw fail(400, 'bad_passkey', 'The passkey request is too old. Start again.');

    let info;
    try {
      const result = await verifyRegistrationResponse({
        response, expectedChallenge, expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: true,
      });
      if (!result.verified) throw new Error('not verified');
      info = result.registrationInfo;
    } catch {
      throw badPasskey();
    }
    const cred = info.credential;
    // The id in the answer must be the id inside the signed authenticator data.
    if (cred.id !== response.id) throw badPasskey();

    try {
      db.tx(() => {
        needRoom(c.account.id);
        db.run(
          'INSERT INTO passkeys (id, account_id, public_key, counter, transports, enc, wrapped_key, created_day) VALUES (?,?,?,?,?,?,NULL,?)',
          cred.id, c.account.id, Buffer.from(cred.publicKey), cred.counter, JSON.stringify(response.response.transports), enc ?? null, today(),
        );
      });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw fail(409, 'conflict', 'This passkey is registered already.');
      throw err;
    }
    return reply(201, { passkey: view(db.get('SELECT * FROM passkeys WHERE account_id = ? AND id = ?', c.account.id, cred.id)) });
  });

  http.put('/api/passkeys/:id/key', { auth: true }, (c) => {
    const row = getOwn(c);
    const wrappedKey = need.bytes(c.body.wrappedKey, 'wrappedKey', { min: WRAPPED_KEY_BYTES, max: WRAPPED_KEY_BYTES });
    db.run('UPDATE passkeys SET wrapped_key = ? WHERE account_id = ? AND id = ?', wrappedKey, c.account.id, row.id);
  });

  http.patch('/api/passkeys/:id', { auth: true }, (c) => {
    const row = getOwn(c);
    if (!Object.prototype.hasOwnProperty.call(c.body, 'enc')) throw fail(400, 'bad_request', 'The value "enc" is not valid.');
    const enc = need.optional(c.body.enc, need.bytes, 'enc', { min: 1, max: MAX_ENC_BYTES }) ?? null; // null removes the label
    db.run('UPDATE passkeys SET enc = ? WHERE account_id = ? AND id = ?', enc, c.account.id, row.id);
    return { passkey: view({ ...row, enc }) };
  });

  http.del('/api/passkeys/:id', { auth: true }, (c) => {
    const row = getOwn(c);
    db.run('DELETE FROM passkeys WHERE account_id = ? AND id = ?', c.account.id, row.id);
  });

  // ---- sign in with a passkey (not signed in) ----

  http.post('/api/auth/passkey/options', { rate: { max: 20, per: 60 } }, async () => {
    // No credential list: the passkey itself knows the account (discoverable credential).
    const options = await generateAuthenticationOptions({
      rpID: config.rpId, allowCredentials: [], userVerification: 'required', timeout: CHALLENGE_TTL_MS,
    });
    const challengeId = randomId();
    loginChallenges.set(challengeId, options.challenge);
    return { challengeId, options };
  });

  http.post('/api/auth/passkey/verify', { rate: { max: 10, per: 60 } }, async (c) => {
    const challengeId = need.string(c.body.challengeId, 'challengeId', { min: 22, max: 22, pattern: CHALLENGE_ID });
    const response = cleanAssertion(c.body.response);
    // The challenge is removed before the check. A failed try cannot be repeated with the same challenge.
    const expectedChallenge = loginChallenges.take(challengeId);
    if (!expectedChallenge) throw badLogin();

    const row = db.get('SELECT * FROM passkeys WHERE id = ?', response.id);
    const account = row ? store.getAccount(row.account_id) : null;
    if (!account) throw badLogin();
    // A passkey sends back the user handle that it stored. It must be the handle of this account.
    if (response.response.userHandle && !safeEqual(Buffer.from(response.response.userHandle, 'base64url'), account.userHandle)) throw badLogin();

    let newCounter;
    try {
      const result = await verifyAuthenticationResponse({
        response, expectedChallenge, expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: true,
        credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: row.counter, transports: transportsOf(row) },
      });
      if (!result.verified) throw new Error('not verified');
      newCounter = result.authenticationInfo.newCounter;
    } catch {
      throw badLogin();
    }

    // The counter must go up. A copy of the passkey with an old counter is refused by the check above.
    const updated = db.run('UPDATE passkeys SET counter = ? WHERE id = ? AND account_id = ? AND counter = ?', newCounter, row.id, account.id, row.counter).changes;
    if (!updated) throw badLogin(); // the passkey changed or was deleted during the check
    startSession(store, c, account.id);
    return { account: accountView(account), passkeyId: row.id, wrappedKey: b64u(row.wrapped_key) };
  });
}
