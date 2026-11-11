import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, client, newAccount } from './helpers.js';
import * as C from '../shared/crypto.js';
import { generateRecoveryKey, parseRecoveryKey, formatRecoveryKey } from '../shared/recovery.js';
import { solvePow, verifyPow } from '../shared/pow.js';
import * as blind from '../shared/blind.js';
import { createSigner } from '../server/core/blindsign.js';
import { utf8, fromUtf8, b64u, unb64u, randomBytes } from '../shared/bytes.js';
import { createKeys } from '../server/core/keys.js';

let app;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

test('bytes: base64url round trip', () => {
  for (const n of [0, 1, 2, 3, 31, 32, 33, 70000]) {
    const b = randomBytes(n > 65536 ? 65536 : n);
    assert.deepEqual(unb64u(b64u(b)), b);
  }
  assert.throws(() => unb64u('a+b'));
});

test('recovery key: format, parse, typing errors', async () => {
  const k = await generateRecoveryKey();
  assert.match(k.text, /^([0-9A-HJKMNP-TV-Z]{4}-){8}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.deepEqual(await parseRecoveryKey(k.text), k.bytes);
  assert.deepEqual(await parseRecoveryKey(k.text.toLowerCase().replace(/-/g, ' ')), k.bytes);
  const chars = k.text.split('');
  chars[0] = chars[0] === 'A' ? 'B' : 'A';
  await assert.rejects(parseRecoveryKey(chars.join('')), { code: 'bad_checksum' });
  await assert.rejects(parseRecoveryKey('ABCD'), { code: 'bad_format' });
  assert.equal(await formatRecoveryKey(k.bytes), k.text);
});

test('crypto: encrypt/decrypt and tamper detection', async () => {
  const key = await C.aesKey(randomBytes(32));
  const box = await C.encrypt(key, 'hello', 'aad');
  assert.equal(fromUtf8(await C.decrypt(key, box, 'aad')), 'hello');
  await assert.rejects(C.decrypt(key, box, 'other'));
  box[box.length - 1] ^= 1;
  await assert.rejects(C.decrypt(key, box, 'aad'));
});

test('crypto: account keys, seal/open, recovery and envelopes', async () => {
  const rk = await generateRecoveryKey();
  const made = await C.createAccountKeys(rk.bytes);
  const sealed = await C.sealJson(made.upload.publicKey, { a: 1 });
  assert.deepEqual(await C.openJson(made.local, sealed), { a: 1 });

  // A second device has only the recovery key and the server copy.
  const again = await C.unlockWithRecoveryKey(rk.bytes, made.upload);
  assert.deepEqual(await C.openJson(again, sealed), { a: 1 });
  const d = await C.deriveFromRecoveryKey(rk.bytes);
  assert.equal(d.accountId, made.upload.accountId);

  // The wrong recovery key cannot open the account.
  const other = await generateRecoveryKey();
  await assert.rejects(C.unlockWithRecoveryKey(other.bytes, made.upload));
  // Another account cannot open the sealed data.
  const stranger = await C.createAccountKeys(other.bytes);
  await assert.rejects(C.openJson(stranger.local, sealed));

  const env = await C.sealEnvelope(made.upload.publicKey, { meta: { subject: 'Hi' }, body: { text: 'Body' }, attachments: [utf8('file')] });
  const ck = await C.openContentKey(again, env.sealedKey);
  assert.deepEqual(await C.openMeta(ck, env.encMeta), { subject: 'Hi' });
  assert.deepEqual(await C.openBody(ck, env.parts[0]), { text: 'Body' });
  assert.equal(fromUtf8(await C.openAttachment(ck, env.parts[1], 1)), 'file');
  await assert.rejects(C.openAttachment(ck, env.parts[1], 2));

  // Passkey wrap of the account key.
  const kek = await C.prfKek(randomBytes(32));
  const wrapped = await C.wrapAccountKey(kek, made.local.accountKey);
  const unlocked = await C.unlockWithAccountKey(await C.unwrapAccountKey(kek, wrapped), made.upload);
  assert.deepEqual(await C.openJson(unlocked, sealed), { a: 1 });
});

test('proof of work', async () => {
  const nonce = await solvePow('challenge', 8);
  assert.equal(await verifyPow('challenge', nonce, 8), true);
  assert.equal(await verifyPow('other', nonce, 20), false);
});

test('blind signatures: sign, unblind, verify, and no link to the blinded value', async () => {
  const signer = createSigner();
  const restored = createSigner(signer.pem);
  assert.equal(restored.id, signer.id);
  const token = blind.newToken();
  const { blinded, r } = await blind.blind(signer.publicKey, token);
  const blindSig = signer.sign(blinded);
  const sig = await blind.unblind(signer.publicKey, token, new Uint8Array(blindSig), r);
  assert.equal(await signer.verify(token, sig), true);
  assert.equal(await signer.verify(blind.newToken(), sig), false);
  assert.notDeepEqual(Buffer.from(sig), Buffer.from(blindSig));
  const bad = Uint8Array.from(sig); bad[10] ^= 1;
  assert.equal(await signer.verify(token, bad), false);
  assert.throws(() => signer.sign(Buffer.alloc(256, 0xff)));
  assert.throws(() => signer.sign(Buffer.alloc(10)));
});

test('server keys: index hash and data encryption', () => {
  const keys = createKeys(Buffer.alloc(32, 7));
  assert.deepEqual(keys.indexHmac('addr', 'a@b.c'), keys.indexHmac('addr', 'a@b.c'));
  assert.notDeepEqual(keys.indexHmac('addr', 'a@b.c'), keys.indexHmac('num', 'a@b.c'));
  const box = keys.srvEncrypt(Buffer.from('+15550001111'), 'phone');
  assert.equal(keys.srvDecrypt(box, 'phone').toString(), '+15550001111');
  assert.throws(() => keys.srvDecrypt(box, 'x'));
});

test('http: config, security headers, 404, auth, sessions', async () => {
  const anon = client(app);
  const cfg = await anon.get('/api/config');
  assert.equal(cfg.status, 200);
  assert.equal(cfg.data.appName, 'Postern');
  assert.match(cfg.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(cfg.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await anon.get('/api/nope')).status, 404);
  assert.equal((await anon.post('/api/config')).status, 405);
  const page = await anon.get('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal((await anon.get('/shared/bytes.js')).status, 200);
  assert.equal((await anon.get('/package.json')).status, 404);
  assert.equal((await anon.get('/some/app/page')).status, 200); // single-page app route
  assert.equal((await anon.get('/%2e%2e/%2e%2e/package.json')).status, 404);
  assert.equal((await anon.get('/shared/%2e%2e/package.json')).status, 404);
  assert.equal((await anon.get('/api/events')).status, 401);
});

test('store: accounts, sessions, credits, vault, seal', async () => {
  const a = await newAccount(app, { credits: 500 });
  assert.equal(app.store.balance(a.id), 500);
  assert.equal(app.store.charge(a.id, 120, 'mailbox'), 380);
  assert.throws(() => app.store.charge(a.id, 1000, 'number'), { status: 402 });
  assert.equal(app.store.balance(a.id), 380);
  assert.deepEqual(app.store.ledger(a.id).map((l) => l.delta), [-120, 500]);
  assert.ok(app.store.verifyAuth(a.id, a.upload.authKey));
  assert.equal(app.store.verifyAuth(a.id, randomBytes(32)), null);
  assert.equal(app.store.verifyAuth('0'.repeat(32), a.upload.authKey), null);
  assert.throws(() => app.store.createAccount(a.upload), { status: 409 });

  const sealed = await app.store.sealJsonFor(a.id, { secret: 'x' });
  assert.deepEqual(await C.openJson(a.keys, new Uint8Array(sealed)), { secret: 'x' });

  app.store.vaultPut(a.id, 'k', Buffer.from('v1'));
  app.store.vaultPut(a.id, 'k', Buffer.from('v2'));
  assert.equal(Buffer.from(app.store.vaultGet(a.id, 'k')).toString(), 'v2');

  assert.ok(app.store.getSession(a.session.token));
  await app.deleteAccount(a.id);
  assert.equal(app.store.getAccount(a.id), null);
  assert.equal(app.store.getSession(a.session.token), null);
  assert.equal(app.store.vaultGet(a.id, 'k'), null);
});
