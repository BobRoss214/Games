import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import { startTestApp, client, newAccount, b64u, unb64u } from './helpers.js';
import { errorCode, newMailbox, newAlias, listMessages, openMessage, makeCopy, databaseHas, smtpSend, verifyDkim } from './mail-helpers.js';
import * as C from '../shared/crypto.js';
import { ADJECTIVES, NOUNS, randomLocalPart } from '../server/mail/words.js';
import { makeSnippet, stripHtml } from '../server/mail/inbound.js';
import { parseAddress, LOCAL_PART } from '../server/mail/address.js';

let app;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
const openAddress = (account, sealed) => C.openJson(account.keys, unb64u(sealed), 'address');
const encLabel = async (account, label, aad) => b64u(await C.encryptJson(account.keys.vaultKey, { label, note: '' }, aad));

// Puts a message in a mailbox through the development route.
async function inject(account, to, mail = {}) {
  const res = await account.api.post('/api/dev/inbound-mail', { to, subject: 'Test', text: 'Hello', ...mail });
  assert.equal(res.status, 204, JSON.stringify(res.data));
}

const sendBody = (from, extra = {}) => ({
  addressId: from.id, from: from.address, fromName: '', to: [], cc: [], bcc: [], subject: 'Hi', text: 'Hello there', html: null,
  inReplyTo: null, references: [], attachments: [], ...extra,
});

test('word lists and address rules', () => {
  for (const list of [ADJECTIVES, NOUNS]) {
    assert.ok(list.length >= 150, `${list.length} words`);
    assert.equal(new Set(list).size, list.length, 'no word twice');
    for (const w of list) assert.match(w, /^[a-z]{3,8}$/);
  }
  for (let i = 0; i < 200; i++) {
    const local = randomLocalPart();
    assert.match(local, /^[a-z]+\.[a-z]+\d{3}$/);
    assert.match(local, LOCAL_PART);
  }
  for (const ok of ['a@b.co', 'first.last+tag@sub.example.org', "o'brien@example.com", 'UPPER@Example.COM']) assert.ok(parseAddress(ok), ok);
  assert.equal(parseAddress('UPPER@Example.COM').address, 'upper@example.com');
  for (const bad of ['', 'a', 'a@b', '@b.co', 'a@@b.co', 'a b@c.de', 'a@b..co', '.a@b.co', 'a.@b.co', 'a..b@c.de', 'a@-b.co', 'a@b.c', 'a<b>@c.de',
    'a@b.co\r\nBcc: x@y.zz', 'a%b@c.de', 'a!b@c.de', '"a"@b.co', 'a@[127.0.0.1]', 'a@b.co.', `${'x'.repeat(65)}@b.co`, 5, null, ['a@b.co']]) {
    assert.equal(parseAddress(bad), null, String(bad));
  }
});

test('preview text', () => {
  assert.equal(makeSnippet('  Hello\n\n   world\t! ', null), 'Hello world !');
  assert.equal(makeSnippet('x'.repeat(500), null).length, 160);
  assert.equal(Array.from(makeSnippet('😀'.repeat(300), null)).length, 160);
  assert.equal(makeSnippet('', '<p>From <b>HTML</b></p>'), 'From HTML');
  assert.equal(makeSnippet(undefined, '<HEAD><title>t</title></HEAD><STYLE>x{}</STYLE><body>A&lt;B &#38; C<!-- no --><script>bad()</script> D</body>'), 'A<B & C D');
  assert.equal(makeSnippet('', undefined), '');
  // Broken HTML does not hang and does not throw.
  const started = Date.now();
  stripHtml('<!--'.repeat(50_000));
  stripHtml('<'.repeat(100_000));
  stripHtml('<style>'.repeat(20_000));
  stripHtml('&#9999999;&#0;&#xyz;' + '<a '.repeat(30_000));
  assert.ok(Date.now() - started < 1000);
});

test('mailbox: random address, charge, sealed address, list, label', async () => {
  const a = await newAccount(app, { credits: 250 });
  assert.deepEqual((await a.api.get('/api/mailboxes')).data, { mailboxes: [] });

  const label = await encLabel(a, 'Personal', 'mailbox');
  const res = await a.api.post('/api/mailboxes', { enc: label });
  assert.equal(res.status, 201);
  const { mailbox, address } = res.data;
  assert.match(address, /^[a-z]+\.[a-z]+\d{3}@postern\.test$/);
  assert.deepEqual(Object.keys(mailbox).sort(), ['addressId', 'blocks', 'createdDay', 'enc', 'id', 'paidUntil', 'refused', 'retentionDays', 'sealedAddress', 'status', 'total', 'unread']);
  assert.match(mailbox.id, /^[A-Za-z0-9_-]{22}$/);
  assert.match(mailbox.addressId, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(mailbox.status, 'active');
  assert.equal(mailbox.unread, 0);
  assert.equal(mailbox.total, 0);
  assert.ok(Math.abs(mailbox.paidUntil - (now() + 30 * DAY)) < 10);
  assert.match(mailbox.createdDay, /^\d{4}-\d{2}-\d{2}$/);
  // Only the account can read the address again.
  assert.deepEqual(await openAddress(a, mailbox.sealedAddress), { address });
  assert.deepEqual(await C.decryptJson(a.keys.vaultKey, unb64u(mailbox.enc), 'mailbox'), { label: 'Personal', note: '' });

  // One month was charged.
  assert.equal(app.store.balance(a.id), 150);
  assert.deepEqual(app.store.ledger(a.id).map((l) => [l.delta, l.kind]), [[-100, 'mailbox'], [250, 'topup']]);

  const list = (await a.api.get('/api/mailboxes')).data.mailboxes;
  assert.deepEqual(list, [mailbox]);
  // The mailbox address is not in the alias list.
  assert.deepEqual((await a.api.get('/api/aliases')).data, { aliases: [] });

  const next = await encLabel(a, 'Work', 'mailbox');
  const patched = await a.api.patch(`/api/mailboxes/${mailbox.id}`, { enc: next });
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.data.mailbox, { ...mailbox, enc: next });
  assert.equal((await a.api.patch(`/api/mailboxes/${mailbox.id}`, { enc: null })).data.mailbox.enc, null);
  assert.equal((await a.api.patch(`/api/mailboxes/${mailbox.id}`, {})).status, 400);
  assert.equal((await a.api.patch(`/api/mailboxes/${mailbox.id}`, { enc: b64u(new Uint8Array(2049)) })).status, 400);
  assert.equal((await a.api.patch('/api/mailboxes/nope', { enc: next })).status, 404);

  assert.equal((await client(app).get('/api/mailboxes')).status, 401);
  assert.equal((await client(app).post('/api/mailboxes', {})).status, 401);
});

test('mailbox: own name and domain, bad names, reserved names, taken', async () => {
  const a = await newAccount(app, { credits: 1000 });
  const b = await newAccount(app, { credits: 1000 });

  const one = await newMailbox(a, { localPart: 'mara.custom-1', domain: 'alt.test' });
  assert.equal(one.address, 'mara.custom-1@alt.test');
  assert.deepEqual(await openAddress(a, one.mailbox.sealedAddress), { address: 'mara.custom-1@alt.test' });
  // The same name on the other domain is a different address.
  assert.equal((await newMailbox(a, { localPart: 'mara.custom-1' })).address, 'mara.custom-1@postern.test');
  // Shortest and longest names.
  assert.equal((await newMailbox(a, { localPart: 'abc' })).address, 'abc@postern.test');
  assert.equal((await newMailbox(a, { localPart: 'x'.repeat(64) })).address.length, 64 + '@postern.test'.length);
  const paid = app.store.balance(a.id);
  assert.equal(paid, 600);

  const bad = ['ab', 'x'.repeat(65), 'Upper', '.dot', 'dot.', '-dash', 'a..b', 'sp ace', 'a@b', 'ü-umlaut', 'a+b', 'semi;colon', '', 5, ['abc'], { a: 1 }];
  for (const localPart of bad) {
    const res = await a.api.post('/api/mailboxes', { localPart });
    assert.equal(res.status, 400, JSON.stringify(localPart));
    assert.equal(errorCode(res), 'bad_request');
  }
  for (const domain of ['gmail.com', 'POSTERN.TEST', '', 7, 'postern.test.']) {
    assert.equal((await a.api.post('/api/mailboxes', { localPart: 'fine-name', domain })).status, 400, String(domain));
  }

  for (const localPart of ['postmaster', 'abuse', 'admin', 'administrator', 'root', 'hostmaster', 'webmaster', 'noreply', 'no-reply', 'mailer-daemon', 'support', 'security', 'info', 'help', 'billing']) {
    const res = await a.api.post('/api/mailboxes', { localPart });
    assert.equal(res.status, 409, localPart);
    assert.equal(errorCode(res), 'taken');
  }

  // An address of a different account is taken, as a mailbox and as an alias.
  for (const who of [a, b]) {
    const res = await who.api.post('/api/mailboxes', { localPart: 'mara.custom-1', domain: 'alt.test' });
    assert.equal(res.status, 409);
    assert.equal(errorCode(res), 'taken');
    assert.equal(res.data.error.message, 'This address is taken. Choose a different one.');
  }
  const boxB = await newMailbox(b);
  assert.equal(errorCode(await b.api.post('/api/aliases', { mailboxId: boxB.mailbox.id, localPart: 'abc' })), 'taken');

  // Nothing was charged for the refused requests.
  assert.equal(app.store.balance(a.id), paid);
  assert.equal(app.store.balance(b.id), 900);
  assert.equal((await a.api.get('/api/mailboxes')).data.mailboxes.length, 4);
});

test('mailbox: too little credit gives 402 and makes nothing', async () => {
  const a = await newAccount(app, { credits: 99 });
  const res = await a.api.post('/api/mailboxes', { localPart: 'no.money' });
  assert.equal(res.status, 402);
  assert.equal(errorCode(res), 'insufficient_funds');
  assert.equal(res.data.error.needed, 100);
  assert.equal(app.store.balance(a.id), 99);
  assert.deepEqual((await a.api.get('/api/mailboxes')).data.mailboxes, []);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM addresses WHERE account_id = ?', a.id).n, 0);
  // The name is still free after the failed request.
  app.store.credit(a.id, 1, 'topup');
  assert.equal((await newMailbox(a, { localPart: 'no.money' })).address, 'no.money@postern.test');
  assert.equal(app.store.balance(a.id), 0);
});

test('limits for mailboxes and aliases; a price of 0 is free', async () => {
  const small = await startTestApp({ limits: { mailboxes: 2, aliases: 3 }, prices: { mailboxMonth: 0 } });
  try {
    const a = await newAccount(small);
    const one = await newMailbox(a);
    await newMailbox(a);
    assert.deepEqual(small.store.ledger(a.id), []);
    const third = await a.api.post('/api/mailboxes', {});
    assert.equal(third.status, 409);
    assert.equal(errorCode(third), 'limit_reached');

    for (let i = 0; i < 3; i++) await newAlias(a, one.mailbox.id);
    const fourth = await a.api.post('/api/aliases', { mailboxId: one.mailbox.id });
    assert.equal(fourth.status, 409);
    assert.equal(errorCode(fourth), 'limit_reached');

    // Room comes back after a delete. A different account has its own count.
    const aliases = (await a.api.get('/api/aliases')).data.aliases;
    assert.equal((await a.api.del(`/api/aliases/${aliases[0].id}`)).status, 204);
    await newAlias(a, one.mailbox.id);
    assert.equal((await a.api.del(`/api/mailboxes/${one.mailbox.id}`)).status, 204);
    await newMailbox(a);
    await newMailbox(await newAccount(small));
  } finally {
    await small.stop();
  }
  // The default has no limit for aliases.
  assert.equal(app.config.limits.aliases, 0);
});

test('aliases: create, list, change, move, delete', async () => {
  const a = await newAccount(app, { credits: 300 });
  const first = await newMailbox(a);
  const second = await newMailbox(a);
  const before = app.store.balance(a.id);

  const label = await encLabel(a, 'Shop X', 'alias');
  const res = await a.api.post('/api/aliases', { mailboxId: first.mailbox.id, enc: label });
  assert.equal(res.status, 201);
  const { alias, address } = res.data;
  assert.match(address, /^[a-z]+\.[a-z]+\d{3}@postern\.test$/);
  assert.deepEqual(Object.keys(alias).sort(), ['blocks', 'createdDay', 'enabled', 'enc', 'expiresAt', 'id', 'mailboxId', 'oneShot', 'received', 'refused', 'sealedAddress', 'usedUp']);
  assert.equal(alias.mailboxId, first.mailbox.id);
  assert.equal(alias.enabled, true);
  assert.equal(alias.received, 0);
  assert.deepEqual(await openAddress(a, alias.sealedAddress), { address });
  assert.equal(app.store.balance(a.id), before, 'aliases are free');

  const custom = await newAlias(a, second.mailbox.id, { localPart: 'bike_sale.2026', domain: 'alt.test' });
  assert.equal(custom.address, 'bike_sale.2026@alt.test');
  assert.deepEqual((await a.api.get('/api/aliases')).data.aliases, [alias, custom.alias]);

  // Checks.
  assert.equal((await a.api.post('/api/aliases', {})).status, 400);
  assert.equal((await a.api.post('/api/aliases', { mailboxId: 'A'.repeat(22) })).status, 404);
  assert.equal((await a.api.post('/api/aliases', { mailboxId: first.mailbox.id, localPart: 'Bad Name' })).status, 400);
  assert.equal(errorCode(await a.api.post('/api/aliases', { mailboxId: first.mailbox.id, localPart: 'postmaster' })), 'taken');

  // Change.
  const off = await a.api.patch(`/api/aliases/${alias.id}`, { enabled: false });
  assert.equal(off.status, 200);
  assert.deepEqual(off.data.alias, { ...alias, enabled: false });
  const moved = await a.api.patch(`/api/aliases/${alias.id}`, { mailboxId: second.mailbox.id, enabled: true, enc: null });
  assert.deepEqual(moved.data.alias, { ...alias, mailboxId: second.mailbox.id, enc: null });
  assert.deepEqual((await a.api.get('/api/aliases')).data.aliases[0], moved.data.alias);
  assert.equal((await a.api.patch(`/api/aliases/${alias.id}`, {})).status, 400);
  assert.equal((await a.api.patch(`/api/aliases/${alias.id}`, { enabled: 'yes' })).status, 400);
  assert.equal((await a.api.patch(`/api/aliases/${alias.id}`, { mailboxId: 'B'.repeat(22) })).status, 404);
  // The address of a mailbox is not an alias.
  assert.equal((await a.api.patch(`/api/aliases/${first.mailbox.addressId}`, { enabled: false })).status, 404);
  assert.equal((await a.api.del(`/api/aliases/${first.mailbox.addressId}`)).status, 404);

  // Mail to a moved alias goes to the new mailbox.
  await inject(a, address);
  assert.equal((await listMessages(a, `?mailboxId=${second.mailbox.id}`)).messages.length, 1);
  assert.equal((await listMessages(a, `?mailboxId=${first.mailbox.id}`)).messages.length, 0);

  assert.equal((await a.api.del(`/api/aliases/${alias.id}`)).status, 204);
  assert.equal((await a.api.del(`/api/aliases/${alias.id}`)).status, 404);
  assert.deepEqual((await a.api.get('/api/aliases')).data.aliases, [custom.alias]);
});

test('a deleted address can never be made again', async () => {
  const a = await newAccount(app, { credits: 1000 });
  const b = await newAccount(app, { credits: 1000 });
  const boxA = await newMailbox(a, { localPart: 'tomb.box' });
  const boxB = await newMailbox(b);
  const alias = await newAlias(a, boxA.mailbox.id, { localPart: 'tomb.alias' });
  const second = await newAlias(a, boxA.mailbox.id, { localPart: 'tomb.second', domain: 'alt.test' });

  const refused = async (who, mailboxId, localPart, domain) => {
    for (const res of [
      await who.api.post('/api/aliases', { mailboxId, localPart, domain }),
      await who.api.post('/api/mailboxes', { localPart, domain }),
    ]) {
      assert.equal(res.status, 409, localPart);
      assert.equal(errorCode(res), 'taken');
      assert.equal(res.data.error.message, 'This address is taken. Choose a different one.');
    }
  };

  // Deleted alias: not for the old owner and not for a new one.
  assert.equal((await a.api.del(`/api/aliases/${alias.alias.id}`)).status, 204);
  await refused(a, boxA.mailbox.id, 'tomb.alias');
  await refused(b, boxB.mailbox.id, 'tomb.alias');
  // The same name on the other domain was never used and is free.
  await newAlias(b, boxB.mailbox.id, { localPart: 'tomb.alias', domain: 'alt.test' });

  // Deleted mailbox: its own address and all its aliases.
  await inject(a, second.address);
  assert.equal((await a.api.del(`/api/mailboxes/${boxA.mailbox.id}`)).status, 204);
  assert.equal((await a.api.del(`/api/mailboxes/${boxA.mailbox.id}`)).status, 404);
  assert.deepEqual((await a.api.get('/api/aliases')).data.aliases, []);
  assert.deepEqual((await listMessages(a)).messages, []);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM message_parts p JOIN messages m ON m.id = p.message_id WHERE m.account_id = ?', a.id).n, 0);
  await refused(b, boxB.mailbox.id, 'tomb.box');
  await refused(b, boxB.mailbox.id, 'tomb.second', 'alt.test');
  await assert.rejects(smtpSend(app, { to: 'tomb.box@postern.test', subject: 'x', text: 'x' }), (e) => e.responseCode === 550);

  // Deleted account: all its addresses.
  const boxA2 = await newMailbox(a, { localPart: 'tomb.account' });
  await newAlias(a, boxA2.mailbox.id, { localPart: 'tomb.account-alias' });
  assert.equal((await a.api.del('/api/account', { confirm: 'delete my account' })).status, 204);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM addresses WHERE account_id = ?', a.id).n, 0);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM mailboxes WHERE account_id = ?', a.id).n, 0);
  await refused(b, boxB.mailbox.id, 'tomb.account');
  await refused(b, boxB.mailbox.id, 'tomb.account-alias');

  // The store can delete an account without the hooks of the app. The addresses are still protected.
  const c = await newAccount(app, { credits: 100 });
  await newMailbox(c, { localPart: 'tomb.direct' });
  app.store.deleteAccount(c.id);
  await refused(b, boxB.mailbox.id, 'tomb.direct');

  // A tombstone holds a keyed hash only.
  const stone = app.db.get('SELECT * FROM address_tombstones WHERE address_hmac = ?', app.keys.indexHmac('addr', 'tomb.box@postern.test'));
  assert.deepEqual(Object.keys(stone), ['address_hmac']);
});

test('the database has no plain address', async () => {
  const a = await newAccount(app, { credits: 500 });
  const box = await newMailbox(a, { localPart: 'plain.check.box' });
  const random = await newMailbox(a);
  const alias = await newAlias(a, box.mailbox.id, { localPart: 'plain.check.alias', domain: 'alt.test' });
  const gone = await newAlias(a, box.mailbox.id, { localPart: 'plain.check.gone' });
  await a.api.del(`/api/aliases/${gone.alias.id}`);
  await inject(a, alias.address, { subject: 'Zebra crossing 4417', text: 'kumquat-and-quince', from: 'visible.sender@elsewhere.example' });
  app.db.exec('PRAGMA wal_checkpoint(FULL)');

  for (const text of [box.address, random.address, alias.address, gone.address, 'plain.check', random.address.split('@')[0],
    'Zebra crossing', 'kumquat-and-quince', 'visible.sender']) {
    assert.equal(databaseHas(app, text), false, `"${text}" must not be in the database`);
  }
  assert.equal(databaseHas(app, box.mailbox.id), true);

  // The rows hold a hash and a sealed copy.
  const row = app.db.get('SELECT * FROM addresses WHERE id = ?', alias.alias.id);
  assert.deepEqual(Buffer.from(row.address_hmac), app.keys.indexHmac('addr', alias.address));
  assert.equal(row.address_hmac.length, 32);
  assert.deepEqual(await C.openJson(a.keys, new Uint8Array(row.sealed_address), 'address'), { address: alias.address });
});

test('messages: read, pages, filters, seen flag, delete', async () => {
  const a = await newAccount(app, { credits: 300 });
  const one = await newMailbox(a);
  const two = await newMailbox(a);
  for (let i = 0; i < 5; i++) await inject(a, one.address, { subject: `Message ${i}`, text: `Body ${i}` });
  await inject(a, two.address, { subject: 'Other box', text: 'x', fromName: 'Dev Sender', html: '<b>x</b>', attachments: [{ filename: 'a.txt', contentType: 'text/plain', content: b64u(Buffer.from('file body')) }] });

  // Give the messages known times. Two of them share one second.
  const ids = app.db.all('SELECT id FROM messages WHERE mailbox_id = ? ORDER BY rowid', one.mailbox.id).map((r) => r.id);
  const base = now() - 1000;
  [0, 1, 1, 2, 3].forEach((offset, i) => app.db.run('UPDATE messages SET at = ? WHERE id = ?', base + offset, ids[i]));

  const all = await listMessages(a, `?mailboxId=${one.mailbox.id}`);
  assert.equal(all.more, false);
  assert.equal(all.messages.length, 5);
  const sorted = [...all.messages].sort((x, y) => y.at - x.at || (x.id < y.id ? 1 : -1));
  assert.deepEqual(all.messages.map((m) => m.id), sorted.map((m) => m.id), 'newest first');

  // Pages of two. `before` and `beforeId` of the last message give the next page.
  const seen = [];
  let query = `?mailboxId=${one.mailbox.id}&limit=2`;
  for (let page = 0; page < 3; page++) {
    const res = await listMessages(a, query);
    seen.push(...res.messages.map((m) => m.id));
    assert.equal(res.more, page < 2, `page ${page}`);
    const last = res.messages[res.messages.length - 1];
    query = `?mailboxId=${one.mailbox.id}&limit=2&before=${last.at}&beforeId=${last.id}`;
  }
  assert.deepEqual(seen, all.messages.map((m) => m.id));
  // `before` alone skips the whole second.
  assert.equal((await listMessages(a, `?mailboxId=${one.mailbox.id}&before=${base + 1}`)).messages.length, 1);
  assert.equal((await listMessages(a, `?before=${base}`)).messages.length, 0);

  // Without a filter the list has both mailboxes. The default page size is 50.
  assert.equal((await listMessages(a)).messages.length, 6);
  assert.equal((await listMessages(a, '?direction=in')).messages.length, 6);
  assert.equal((await listMessages(a, '?direction=out')).messages.length, 0);
  assert.equal((await listMessages(a, `?mailboxId=${two.mailbox.id}`)).messages.length, 1);
  for (const bad of ['?limit=0', '?limit=101', '?limit=abc', '?limit=-1', '?before=x', '?direction=up', '?mailboxId=short', `?before=5&beforeId=bad`]) {
    assert.equal((await a.api.get(`/api/messages${bad}`)).status, 400, bad);
  }
  assert.equal((await a.api.get(`/api/messages?mailboxId=${'Z'.repeat(22)}`)).status, 404);

  // Content of the message from the development route.
  const other = (await listMessages(a, `?mailboxId=${two.mailbox.id}`)).messages[0];
  assert.equal(other.attachments, 1);
  const opened = await openMessage(a, other.id);
  assert.deepEqual(opened.meta.from, { name: 'Dev Sender', address: 'sender@example.com' });
  assert.equal(opened.meta.subject, 'Other box');
  assert.equal(opened.meta.deliveredTo, two.address);
  assert.equal(opened.body.html, '<b>x</b>');
  assert.equal((await opened.attachment(1)).toString(), 'file body');

  // Seen flag and the unread count.
  const boxes = async () => Object.fromEntries((await a.api.get('/api/mailboxes')).data.mailboxes.map((m) => [m.id, m]));
  assert.equal((await boxes())[one.mailbox.id].unread, 5);
  assert.equal((await a.api.patch(`/api/messages/${ids[0]}`, { seen: true })).status, 204);
  assert.equal((await a.api.get(`/api/messages/${ids[0]}`)).data.message.seen, true);
  assert.equal((await boxes())[one.mailbox.id].unread, 4);
  assert.equal((await a.api.patch(`/api/messages/${ids[0]}`, { seen: false })).status, 204);
  assert.equal((await boxes())[one.mailbox.id].unread, 5);
  assert.equal((await a.api.patch(`/api/messages/${ids[0]}`, { seen: 1 })).status, 400);
  assert.equal((await a.api.patch(`/api/messages/${ids[0]}`, {})).status, 400);

  // Delete removes the message and its parts.
  assert.equal((await a.api.del(`/api/messages/${ids[0]}`)).status, 204);
  assert.equal((await a.api.get(`/api/messages/${ids[0]}`)).status, 404);
  assert.equal((await a.api.del(`/api/messages/${ids[0]}`)).status, 404);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM message_parts WHERE message_id = ?', ids[0]).n, 0);
  const after = (await boxes())[one.mailbox.id];
  assert.equal(after.total, 4);
  assert.equal(after.unread, 4);
  assert.equal((await client(app).get('/api/messages')).status, 401);
});

test('messages: filter by address ids (the view of an identity group)', async () => {
  const a = await newAccount(app, { credits: 300 });
  const b = await newAccount(app, { credits: 100 });
  const box1 = await newMailbox(a);
  const box2 = await newMailbox(a);
  const al1 = await newAlias(a, box1.mailbox.id);
  const al2 = await newAlias(a, box2.mailbox.id);
  const al3 = await newAlias(a, box1.mailbox.id);
  const boxB = await newMailbox(b);
  const alB = await newAlias(b, boxB.mailbox.id);

  // Incoming: 3 for alias 1, 2 for alias 2 (in the other mailbox), 1 for alias 3, 1 for the inbox address, 2 for account B.
  for (const [who, to, n] of [[a, al1.address, 3], [a, al2.address, 2], [a, al3.address, 1], [a, box1.address, 1], [b, alB.address, 2]]) {
    for (let i = 0; i < n; i++) await inject(who, to, { subject: `to ${to} ${i}` });
  }
  // One sent message from alias 2, with a Sent copy.
  const copy = await makeCopy(a, { meta: { subject: 'sent from alias 2' }, body: { text: 'x' } });
  const sent = await a.api.post('/api/mail/send', sendBody({ id: al2.alias.id, address: al2.address }, { to: ['ok@elsewhere.example'], copy }));
  assert.equal(sent.status, 201);
  // The Sent copy has the id of the from-address.
  assert.equal(app.db.get('SELECT address_id FROM messages WHERE id = ?', sent.data.id).address_id, al2.alias.id);

  // Known times: one second for each message, in the order of arrival. Two messages share a second.
  const base = now() - 1000;
  const rows = app.db.all('SELECT id FROM messages WHERE account_id = ? ORDER BY rowid', a.id);
  rows.forEach((r, i) => app.db.run('UPDATE messages SET at = ? WHERE id = ?', base + (i === 1 ? 0 : i), r.id));

  const list = (query) => listMessages(a, query);
  const idsOf = (res) => res.messages.map((m) => m.id);
  const inOrder = (messages) => [...messages].sort((x, y) => y.at - x.at || (x.id < y.id ? 1 : -1)).map((m) => m.id);

  // One id.
  const one = await list(`?addressIds=${al1.alias.id}`);
  assert.equal(one.messages.length, 3);
  assert.equal(one.more, false);
  assert.ok(one.messages.every((m) => m.addressId === al1.alias.id && m.mailboxId === box1.mailbox.id));
  assert.deepEqual(idsOf(one), inOrder(one.messages), 'newest first');

  // Several ids across two mailboxes. The Sent copy of alias 2 is in the list.
  const group = `${al1.alias.id},${al2.alias.id}`;
  const both = await list(`?addressIds=${group}`);
  assert.equal(both.messages.length, 6);
  assert.deepEqual(idsOf(both), inOrder(both.messages));
  assert.deepEqual([...new Set(both.messages.map((m) => m.mailboxId))].sort(), [box1.mailbox.id, box2.mailbox.id].sort());
  assert.ok(both.messages.every((m) => [al1.alias.id, al2.alias.id].includes(m.addressId)));
  assert.ok(idsOf(both).includes(sent.data.id));
  // The same messages as the list without a filter, minus the other addresses.
  const everything = await list('');
  assert.equal(everything.messages.length, 8);
  assert.deepEqual(idsOf(both), everything.messages.filter((m) => [al1.alias.id, al2.alias.id].includes(m.addressId)).map((m) => m.id));

  // The address of an inbox works like an alias. An id two times in the list changes nothing.
  assert.equal((await list(`?addressIds=${box1.mailbox.addressId}`)).messages.length, 1);
  assert.deepEqual(idsOf(await list(`?addressIds=${group},${al1.alias.id}`)), idsOf(both));
  assert.equal((await list(`?addressIds=${[al1, al2, al3].map((x) => x.alias.id).join(',')},${box1.mailbox.addressId}`)).messages.length, 8);

  // With `direction`.
  const incoming = await list(`?addressIds=${group}&direction=in`);
  assert.equal(incoming.messages.length, 5);
  assert.ok(incoming.messages.every((m) => m.direction === 'in'));
  assert.deepEqual(idsOf(await list(`?addressIds=${group}&direction=out`)), [sent.data.id]);
  assert.deepEqual(idsOf(await list(`?addressIds=${al1.alias.id}&direction=out`)), []);

  // With `mailboxId`: both filters apply.
  const inBox1 = await list(`?addressIds=${group}&mailboxId=${box1.mailbox.id}`);
  assert.deepEqual(idsOf(inBox1), idsOf(one));
  assert.equal((await list(`?addressIds=${al1.alias.id}&mailboxId=${box2.mailbox.id}`)).messages.length, 0);
  assert.equal((await a.api.get(`/api/messages?addressIds=${group}&mailboxId=${boxB.mailbox.id}`)).status, 404);

  // Pages across the filter: `before` and `beforeId` of the last message give the next page.
  for (const size of [1, 2, 4, 5]) {
    const seen = [];
    let query = `?addressIds=${group}&limit=${size}`;
    for (;;) {
      const res = await list(query);
      assert.ok(res.messages.length <= size);
      seen.push(...idsOf(res));
      assert.equal(res.more, seen.length < 6, `limit ${size} after ${seen.length}`);
      if (!res.more) break;
      const last = res.messages[res.messages.length - 1];
      query = `?addressIds=${group}&limit=${size}&before=${last.at}&beforeId=${last.id}`;
    }
    assert.deepEqual(seen, idsOf(both), `limit ${size}`);
  }
  assert.equal((await list(`?addressIds=${group}&before=${base}`)).messages.length, 0);
  assert.equal((await list(`?addressIds=${group}&limit=6`)).more, false);

  // An id of a different account, or an id that does not exist, matches nothing. It is no error.
  assert.deepEqual(await list(`?addressIds=${alB.alias.id}`), { messages: [], more: false });
  assert.deepEqual(await list(`?addressIds=${'Q'.repeat(22)}`), { messages: [], more: false });
  assert.deepEqual(idsOf(await list(`?addressIds=${alB.alias.id},${al1.alias.id},${'Q'.repeat(22)}`)), idsOf(one));
  // Account B asks with the ids of account A: nothing. With its own id: its own two messages.
  assert.deepEqual(await listMessages(b, `?addressIds=${group},${box1.mailbox.addressId}`), { messages: [], more: false });
  const ownB = await listMessages(b, `?addressIds=${alB.alias.id},${al1.alias.id}`);
  assert.equal(ownB.messages.length, 2);
  assert.ok(ownB.messages.every((m) => m.addressId === alB.alias.id && m.mailboxId === boxB.mailbox.id));
  assert.equal((await client(app).get(`/api/messages?addressIds=${group}`)).status, 401);

  // The list must be 1 to 50 well-formed ids.
  const many = (n) => Array.from({ length: n }, (_, i) => String(i).padStart(22, 'A')).join(',');
  assert.equal((await a.api.get(`/api/messages?addressIds=${many(49)},${al1.alias.id}`)).data.messages.length, 3);
  for (const bad of [many(51), '', ',', `${al1.alias.id},`, `,${al1.alias.id}`, 'short', `${al1.alias.id};${al2.alias.id}`, `${al1.alias.id}, ${al2.alias.id}`, 'x'.repeat(23)]) {
    const res = await a.api.get(`/api/messages?addressIds=${encodeURIComponent(bad)}`);
    assert.equal(res.status, 400, `"${bad.slice(0, 30)}"`);
    assert.equal(errorCode(res), 'bad_request');
  }

  // Messages of a deleted alias stay in the mailbox, but they have no address id and are in no such list.
  assert.equal((await a.api.del(`/api/aliases/${al1.alias.id}`)).status, 204);
  assert.deepEqual(await list(`?addressIds=${al1.alias.id}`), { messages: [], more: false });
  assert.equal((await list(`?addressIds=${group}`)).messages.length, 3);
  assert.equal((await list(`?mailboxId=${box1.mailbox.id}`)).messages.length, 5);

  // The filter has an index, and the database reads it in order (no sort step).
  const plan = app.db.all(
    'EXPLAIN QUERY PLAN SELECT id FROM messages WHERE account_id = ? AND address_id = ? AND direction = ? AND (at < ? OR (at = ? AND id < ?)) ORDER BY at DESC, id DESC LIMIT ?',
    a.id, al2.alias.id, 'in', 1, 1, 'x', 3,
  ).map((r) => r.detail).join(' | ');
  assert.match(plan, /messages_address/);
  assert.doesNotMatch(plan, /TEMP B-TREE/);
});

test('send: from an alias to an alias of a different account (inside the server)', async () => {
  const a = await newAccount(app, { credits: 200 });
  const b = await newAccount(app, { credits: 200 });
  const boxA = await newMailbox(a);
  const boxB = await newMailbox(b);
  const aliasA = await newAlias(a, boxA.mailbox.id);
  const aliasB = await newAlias(b, boxB.mailbox.id);
  const file = randomBytes(3000);
  const outboxBefore = app.services.mail.outbox.length;

  const res = await a.api.post('/api/mail/send', sendBody({ id: aliasA.alias.id, address: aliasA.address }, {
    fromName: 'Ana A.', to: [aliasB.address], subject: 'Lunch on Friday?', text: 'Are you free?', html: '<p>Are you <i>free</i>?</p>',
    inReplyTo: '<earlier@elsewhere.example>', references: ['<first@elsewhere.example>', 'not a message id', '<earlier@elsewhere.example>'],
    attachments: [{ filename: 'menu.pdf', contentType: 'application/pdf', content: b64u(file) }],
  }));
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.deepEqual(res.data, { id: null }); // no Sent copy was given
  assert.equal(app.services.mail.outbox.length, outboxBefore, 'local mail does not leave the server');

  const inbox = (await listMessages(b)).messages;
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].direction, 'in');
  assert.equal(inbox[0].mailboxId, boxB.mailbox.id);
  assert.equal(inbox[0].addressId, aliasB.alias.id);
  const opened = await openMessage(b, inbox[0].id);
  assert.deepEqual(opened.meta.from, { name: 'Ana A.', address: aliasA.address });
  assert.deepEqual(opened.meta.to, [{ name: '', address: aliasB.address }]);
  assert.equal(opened.meta.subject, 'Lunch on Friday?');
  assert.equal(opened.meta.deliveredTo, aliasB.address);
  assert.equal(opened.meta.snippet, 'Are you free?');
  assert.equal(opened.body.text.trim(), 'Are you free?');
  assert.equal(opened.body.html.trim(), '<p>Are you <i>free</i>?</p>');
  assert.match(opened.body.messageId, /^<[0-9a-f]{32}@postern\.test>$/);
  assert.equal(opened.body.inReplyTo, '<earlier@elsewhere.example>');
  assert.deepEqual(opened.body.references, ['<first@elsewhere.example>', '<earlier@elsewhere.example>']);
  assert.deepEqual(opened.meta.attachments, [{ filename: 'menu.pdf', contentType: 'application/pdf', size: 3000 }]);
  assert.deepEqual(await opened.attachment(1), file);
  assert.equal((await b.api.get('/api/aliases')).data.aliases[0].received, 1);
  // The sender has no copy and cannot see the message of the recipient.
  assert.deepEqual((await listMessages(a)).messages, []);
  assert.equal((await a.api.get(`/api/messages/${inbox[0].id}`)).status, 404);

  // A message to an own address works too, and a mailbox address can send.
  const self = await a.api.post('/api/mail/send', sendBody({ id: boxA.mailbox.addressId, address: boxA.address }, { to: [aliasA.address], cc: [aliasB.address] }));
  assert.equal(self.status, 201);
  assert.equal((await listMessages(a)).messages.length, 1);
  assert.equal((await listMessages(b)).messages.length, 2);
});

test('send: to an outside address; headers; Bcc; Sent copy', async () => {
  const a = await newAccount(app, { credits: 200 });
  const b = await newAccount(app, { credits: 200 });
  const box = await newMailbox(a, { localPart: 'out.sender' });
  const boxB = await newMailbox(b);
  const alias = await newAlias(a, box.mailbox.id);
  const outbox = app.services.mail.outbox;
  const start = outbox.length;

  const meta = { from: { name: 'Ana', address: alias.address }, to: [{ name: '', address: 'friend@elsewhere.example' }], cc: [], subject: 'Trip photos', date: new Date().toISOString(), snippet: 'See the file', deliveredTo: alias.address, attachments: [{ filename: 'p.jpg', contentType: 'image/jpeg', size: 4 }] };
  const body = { text: 'See the file', html: null, messageId: null, inReplyTo: null, references: [], replyTo: [] };
  const copy = await makeCopy(a, { meta, body, attachments: [Buffer.from('JPEG')] });

  const res = await a.api.post('/api/mail/send', sendBody({ id: alias.alias.id, address: alias.address }, {
    fromName: 'Ana "the" Ünïcode', to: ['Friend@Elsewhere.example', boxB.address], cc: ['second@other.example'], bcc: ['hidden@secret.example'],
    subject: 'Trip photos – ünïcode', text: 'See the file', attachments: [{ filename: 'p.jpg', contentType: 'image/jpeg', content: b64u(Buffer.from('JPEG')) }],
    copy,
  }), { 'user-agent': 'SecretBrowser/9.9', 'x-forwarded-for': '203.0.113.77' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.match(res.data.id, /^[A-Za-z0-9_-]{22}$/);

  // Outside recipients are in the simulated outbox. The local recipient got the message directly.
  assert.equal(outbox.length, start + 1);
  const sent = outbox[outbox.length - 1];
  assert.equal(sent.accountId, a.id);
  assert.equal(sent.from, alias.address);
  assert.deepEqual(sent.to, ['friend@elsewhere.example', 'second@other.example', 'hidden@secret.example']);
  assert.equal(sent.subject, 'Trip photos – ünïcode');
  assert.ok(Math.abs(sent.at - now()) < 10);
  assert.equal((await listMessages(b)).messages.length, 1);

  // Headers of the raw message.
  const rawText = sent.raw.toString('latin1');
  const parsed = await simpleParser(sent.raw);
  assert.deepEqual(parsed.from.value, [{ address: alias.address, name: 'Ana "the" Ünïcode' }]);
  assert.deepEqual(parsed.to.value.map((v) => v.address), ['friend@elsewhere.example', boxB.address]);
  assert.deepEqual(parsed.cc.value.map((v) => v.address), ['second@other.example']);
  assert.equal(parsed.subject, 'Trip photos – ünïcode');
  assert.match(parsed.messageId, /^<[0-9a-f]{32}@postern\.test>$/);
  assert.ok(parsed.date instanceof Date);
  assert.equal(parsed.attachments[0].content.toString(), 'JPEG');
  const names = parsed.headerLines.map((h) => h.key);
  for (const header of ['x-mailer', 'user-agent', 'received', 'bcc', 'x-originating-ip', 'x-forwarded-for', 'sender']) {
    assert.ok(!names.includes(header), `no ${header} header`);
  }
  for (const secret of ['hidden@secret.example', 'SecretBrowser', '203.0.113.77', '127.0.0.1', a.id, 'out.sender', 'nodemailer', 'Nodemailer']) {
    assert.ok(!rawText.includes(secret), `"${secret}" must not be in the message`);
  }
  assert.deepEqual([...new Set(names)].sort(), ['cc', 'content-type', 'date', 'from', 'message-id', 'mime-version', 'subject', 'to']);

  // The Sent copy is in the mailbox of the from-address. Only the account can open it.
  const stored = (await listMessages(a, '?direction=out')).messages;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, res.data.id);
  assert.equal(stored[0].direction, 'out');
  assert.equal(stored[0].seen, true);
  assert.equal(stored[0].mailboxId, box.mailbox.id);
  assert.equal(stored[0].addressId, alias.alias.id);
  assert.equal(stored[0].attachments, 1);
  const opened = await openMessage(a, res.data.id);
  assert.deepEqual(opened.meta, meta);
  assert.deepEqual(opened.body, body);
  assert.equal((await opened.attachment(1)).toString(), 'JPEG');
  const boxNow = (await a.api.get('/api/mailboxes')).data.mailboxes[0];
  assert.equal(boxNow.total, 1);
  assert.equal(boxNow.unread, 0);

  // The development outbox route shows own messages only, without the content.
  const mine = await a.api.get('/api/dev/outbox');
  assert.deepEqual(mine.data, { mail: [{ from: sent.from, to: sent.to, subject: sent.subject, at: sent.at }] });
  assert.deepEqual((await b.api.get('/api/dev/outbox')).data, { mail: [] });
  assert.equal((await client(app).get('/api/dev/outbox')).status, 401);
});

test('send: checks; a refused message sends nothing', async () => {
  const a = await newAccount(app, { credits: 300 });
  const b = await newAccount(app, { credits: 100 });
  const box = await newMailbox(a);
  const boxB = await newMailbox(b);
  const alias = await newAlias(a, box.mailbox.id);
  const from = { id: alias.alias.id, address: alias.address };
  const outbox = app.services.mail.outbox;
  const start = outbox.length;
  const send = (extra, f = from) => a.api.post('/api/mail/send', sendBody(f, { to: ['ok@elsewhere.example'], ...extra }));
  const expectError = async (promise, status, code) => {
    const res = await promise;
    assert.equal(res.status, status, JSON.stringify(res.data));
    assert.equal(errorCode(res), code);
    return res;
  };

  // The from-address must be the address of addressId, and both must belong to the account.
  await expectError(send({}, { id: alias.alias.id, address: box.address }), 400, 'bad_request');
  await expectError(send({}, { id: alias.alias.id, address: 'someone@elsewhere.example' }), 400, 'bad_request');
  await expectError(send({}, { id: boxB.mailbox.addressId, address: boxB.address }), 404, 'not_found');
  await expectError(send({}, { id: 'C'.repeat(22), address: alias.address }), 404, 'not_found');
  await expectError(send({}, { id: 'short', address: alias.address }), 400, 'bad_request');
  await expectError(b.api.post('/api/mail/send', sendBody(from, { to: ['ok@elsewhere.example'] })), 404, 'not_found');
  assert.equal((await client(app).post('/api/mail/send', sendBody(from, { to: ['ok@elsewhere.example'] }))).status, 401);

  // Recipients.
  await expectError(send({ to: [] }), 400, 'bad_recipient');
  await expectError(send({ to: ['not an address'] }), 400, 'bad_recipient');
  await expectError(send({ to: ['a@b.co\r\nBcc: victim@x.example'] }), 400, 'bad_recipient');
  await expectError(send({ to: 'ok@elsewhere.example' }), 400, 'bad_request');
  const many = Array.from({ length: 21 }, (_, i) => `r${i}@elsewhere.example`);
  await expectError(send({ to: many.slice(0, 10), cc: many.slice(10, 20), bcc: many.slice(20) }), 400, 'bad_recipient');
  await expectError(send({ to: many }), 400, 'bad_recipient');

  // An unknown address on our own domain: the error names it and nothing is sent, also not to the other recipients.
  const unknown = await expectError(send({ to: ['ok@elsewhere.example', boxB.address], cc: ['nobody.home123@postern.test'] }), 400, 'bad_recipient');
  assert.equal(unknown.data.error.message, 'This address does not exist: nobody.home123@postern.test');
  assert.equal(outbox.length, start);
  assert.deepEqual((await listMessages(b)).messages, []);

  // Other fields.
  await expectError(send({ subject: 'x'.repeat(999) }), 400, 'bad_request');
  await expectError(send({ subject: 'two\r\nlines' }), 400, 'bad_request');
  await expectError(send({ fromName: 'x'.repeat(101) }), 400, 'bad_request');
  await expectError(send({ fromName: 'a\nb' }), 400, 'bad_request');
  await expectError(send({ text: 5 }), 400, 'bad_request');
  await expectError(send({ html: ['<p>'] }), 400, 'bad_request');
  await expectError(send({ attachments: [{ filename: 'a', content: 'not+base64' }] }), 400, 'bad_request');
  await expectError(send({ attachments: [{ filename: '', content: 'AAAA' }] }), 400, 'bad_request');
  await expectError(send({ attachments: [{ filename: 'a\r\nX-Evil: 1', content: 'AAAA' }] }), 400, 'bad_request');
  await expectError(send({ attachments: [{ filename: 'a', contentType: 7, content: 'AAAA' }] }), 400, 'bad_request');
  await expectError(send({ attachments: 'x' }), 400, 'bad_request');
  await expectError(send({ references: 'x'.repeat(1000) }), 400, 'bad_request');
  await expectError(send({ copy: { sealedKey: 'AAAA', encMeta: 'AAAA', parts: ['AAAA'] } }), 400, 'bad_request');
  await expectError(send({ copy: { sealedKey: b64u(new Uint8Array(126)), encMeta: b64u(new Uint8Array(40)), parts: [] } }), 400, 'bad_request');
  await expectError(send({ copy: 'x' }), 400, 'bad_request');

  // A disabled alias cannot send.
  await a.api.patch(`/api/aliases/${alias.alias.id}`, { enabled: false });
  await expectError(send({}), 409, 'conflict');
  await a.api.patch(`/api/aliases/${alias.alias.id}`, { enabled: true });

  // None of the refused requests sent mail, stored a copy, or used the daily allowance.
  assert.equal(outbox.length, start);
  assert.deepEqual((await listMessages(a)).messages, []);
  assert.equal(app.db.get('SELECT COALESCE(SUM(n), 0) AS n FROM send_counts WHERE account_id = ?', a.id).n, 0);
  assert.equal((await send({})).status, 201);
  assert.equal(outbox.length, start + 1);
  assert.equal(app.db.get('SELECT n FROM send_counts WHERE account_id = ?', a.id).n, 1);
  // The file type of an attachment is cleaned: parameters are removed, and a type that is not well formed becomes the generic type.
  const types = ['text/plain; charset=utf-8', '', 'TEXT/CSV', 'text/plain\r\nX-Evil: 1', 'nonsense'];
  assert.equal((await send({ attachments: types.map((contentType, i) => ({ filename: `f${i}`, contentType, content: 'AAAA' })) })).status, 201);
  const typed = outbox[outbox.length - 1].raw;
  assert.deepEqual((await simpleParser(typed)).attachments.map((f) => f.contentType), ['text/plain', 'application/octet-stream', 'text/csv', 'application/octet-stream', 'application/octet-stream']);
  assert.ok(!typed.toString('latin1').includes('X-Evil'));
  // A message with no subject and no text is allowed.
  assert.equal((await send({ subject: '', text: '', fromName: undefined, cc: undefined, bcc: null, references: null, attachments: null })).status, 201);
  const bare = await simpleParser(outbox[outbox.length - 1].raw);
  assert.equal(bare.subject, undefined);
  assert.equal((bare.text || '').trim(), '');
});

test('send: size limits', async () => {
  const small = await startTestApp({ mail: { maxMessageBytes: 100 * 1024 } });
  try {
    const a = await newAccount(small, { credits: 100 });
    const box = await newMailbox(a);
    const from = { id: box.mailbox.addressId, address: box.address };
    const send = (extra) => a.api.post('/api/mail/send', sendBody(from, { to: ['ok@elsewhere.example'], ...extra }));
    const file = (n) => [{ filename: 'f.bin', content: b64u(Buffer.alloc(n, 7)) }];

    assert.equal((await send({ attachments: file(60 * 1024) })).status, 201);
    // The content fits the request, but the encoded message is larger than the limit.
    const encoded = await send({ attachments: file(90 * 1024) });
    assert.equal(encoded.status, 413);
    assert.equal(errorCode(encoded), 'too_large');
    // The content alone is over the limit.
    assert.equal((await send({ text: 'x'.repeat(101 * 1024) })).status, 413);
    assert.equal((await send({ text: 'x'.repeat(60 * 1024), html: 'y'.repeat(60 * 1024) })).status, 413);
    // The whole request is over the limit of the route (1.5 times the message limit).
    assert.equal((await send({ attachments: file(140 * 1024) })).status, 413);
    assert.equal(small.services.mail.outbox.length, 1);
    assert.equal(small.db.get('SELECT n FROM send_counts WHERE account_id = ?', a.id).n, 1);
  } finally {
    await small.stop();
  }
});

test('send: the Sent copy needs room in the mailbox', async () => {
  const tight = await startTestApp({ limits: { mailboxBytes: 2000 } });
  try {
    const a = await newAccount(tight, { credits: 100 });
    const box = await newMailbox(a);
    const send = (extra) => a.api.post('/api/mail/send', sendBody({ id: box.mailbox.addressId, address: box.address }, { to: ['ok@elsewhere.example'], ...extra }));
    const big = await makeCopy(a, { meta: { subject: 'Hi' }, body: { text: 'x'.repeat(3000) } });
    const res = await send({ copy: big });
    assert.equal(res.status, 409);
    assert.equal(errorCode(res), 'limit_reached');
    assert.equal(tight.services.mail.outbox.length, 0, 'nothing was sent');
    // A small copy fits. The same message without a copy goes out too.
    const small = await makeCopy(a, { meta: { subject: 'Hi' }, body: { text: 'short' } });
    assert.match((await send({ copy: small })).data.id, /^[A-Za-z0-9_-]{22}$/);
    assert.deepEqual((await send({})).data, { id: null });
    assert.equal(tight.services.mail.outbox.length, 2);
  } finally {
    await tight.stop();
  }
});

test('send: daily limit', async () => {
  const limited = await startTestApp({ limits: { sendPerDay: 3 } });
  try {
    const a = await newAccount(limited, { credits: 100 });
    const b = await newAccount(limited, { credits: 100 });
    const box = await newMailbox(a);
    const boxB = await newMailbox(b);
    const send = (who, bx) => who.api.post('/api/mail/send', sendBody({ id: bx.mailbox.addressId, address: bx.address }, { to: ['ok@elsewhere.example'] }));
    for (let i = 0; i < 3; i++) assert.equal((await send(a, box)).status, 201);
    const res = await send(a, box);
    assert.equal(res.status, 429);
    assert.equal(errorCode(res), 'send_limit');
    assert.equal(limited.services.mail.outbox.length, 3);
    // The limit is for each account.
    assert.equal((await send(b, boxB)).status, 201);
    // A new day gives a new allowance. The old counter is removed.
    limited.db.run("UPDATE send_counts SET day = '2000-01-01' WHERE account_id = ?", a.id);
    assert.equal((await send(a, box)).status, 201);
    assert.deepEqual(limited.db.all('SELECT n FROM send_counts WHERE account_id = ?', a.id).map((r) => r.n), [1]);
    await limited.runJobs('mail-send-counts');
  } finally {
    await limited.stop();
  }
});

test('send: the outbox keeps the newest 200 messages', async () => {
  const outbox = app.services.mail.outbox;
  const a = await newAccount(app, { credits: 100 });
  const box = await newMailbox(a);
  for (let i = 0; i < 205; i++) outbox.push({ accountId: 'filler', from: 'x@postern.test', to: ['y@elsewhere.example'], subject: `filler ${i}`, at: 0, raw: Buffer.alloc(0) });
  const res = await a.api.post('/api/mail/send', sendBody({ id: box.mailbox.addressId, address: box.address }, { to: ['ok@elsewhere.example'], subject: 'newest' }));
  assert.equal(res.status, 201);
  assert.equal(outbox.length, 200);
  assert.equal(outbox[outbox.length - 1].subject, 'newest');
  outbox.length = 0;
});

test('renewal: a due mailbox is charged, or suspended when the credit is too low', async () => {
  const rich = await newAccount(app, { credits: 350 });
  const poor = await newAccount(app, { credits: 100 });
  const boxRich = await newMailbox(rich);
  const boxPoor = await newMailbox(poor);
  const notDue = await newMailbox(rich);
  const past = now() - 5;
  app.db.run('UPDATE mailboxes SET paid_until = ? WHERE id IN (?, ?)', past, boxRich.mailbox.id, boxPoor.mailbox.id);

  await app.runJobs('renew');

  const richBoxes = (await rich.api.get('/api/mailboxes')).data.mailboxes;
  const renewed = richBoxes.find((m) => m.id === boxRich.mailbox.id);
  assert.equal(renewed.status, 'active');
  assert.ok(Math.abs(renewed.paidUntil - (now() + 30 * DAY)) < 10);
  assert.equal(richBoxes.find((m) => m.id === notDue.mailbox.id).paidUntil, notDue.mailbox.paidUntil);
  assert.equal(app.store.balance(rich.id), 350 - 100 - 100 - 100); // two mailboxes and one renewal
  assert.deepEqual(app.store.ledger(rich.id).map((l) => l.kind), ['mailbox', 'mailbox', 'mailbox', 'topup']);

  const suspended = (await poor.api.get('/api/mailboxes')).data.mailboxes[0];
  assert.equal(suspended.status, 'suspended');
  assert.equal(suspended.paidUntil, past);
  assert.equal(app.store.balance(poor.id), 0);

  // A suspended mailbox cannot send and gets no mail. It is still readable and can be managed.
  const send = () => poor.api.post('/api/mail/send', sendBody({ id: boxPoor.mailbox.addressId, address: boxPoor.address }, { to: ['ok@elsewhere.example'] }));
  const refused = await send();
  assert.equal(refused.status, 409);
  assert.equal(errorCode(refused), 'conflict');
  await assert.rejects(smtpSend(app, { to: boxPoor.address, subject: 'x', text: 'x' }), (e) => e.responseCode === 450);
  const fromRich = await rich.api.post('/api/mail/send', sendBody({ id: boxRich.mailbox.addressId, address: boxRich.address }, { to: [boxPoor.address] }));
  assert.equal(fromRich.status, 400);
  assert.equal(errorCode(fromRich), 'bad_recipient');
  assert.equal(fromRich.data.error.message, `This address cannot receive mail now: ${boxPoor.address}`);
  assert.equal((await poor.api.get('/api/messages')).status, 200);
  await newAlias(poor, boxPoor.mailbox.id);

  // A second run changes nothing. Mailboxes do not expire.
  app.db.run('UPDATE mailboxes SET paid_until = ? WHERE id = ?', now() - 400 * DAY, boxPoor.mailbox.id);
  await app.runJobs('renew');
  assert.equal((await poor.api.get('/api/mailboxes')).data.mailboxes[0].status, 'suspended');

  // After a top-up the renewal for this account makes it active again.
  app.store.credit(poor.id, 150, 'topup');
  await app.renewables.run(poor.id);
  const back = (await poor.api.get('/api/mailboxes')).data.mailboxes[0];
  assert.equal(back.status, 'active');
  assert.ok(Math.abs(back.paidUntil - (now() + 30 * DAY)) < 10);
  assert.equal(app.store.balance(poor.id), 50);
  assert.equal((await send()).status, 201);
  await smtpSend(app, { to: boxPoor.address, subject: 'x', text: 'x' });
});

test('cross-account isolation: account B gets 404 for every id of account A', async () => {
  const a = await newAccount(app, { credits: 300 });
  const b = await newAccount(app, { credits: 300 });
  const boxA = await newMailbox(a);
  const boxB = await newMailbox(b);
  const aliasA = await newAlias(a, boxA.mailbox.id);
  await inject(a, aliasA.address, { attachments: [{ filename: 'a.txt', content: b64u(Buffer.from('secret file')) }] });
  const message = (await listMessages(a)).messages[0];

  const tries = [
    b.api.patch(`/api/mailboxes/${boxA.mailbox.id}`, { enc: b64u(randomBytes(40)) }),
    b.api.del(`/api/mailboxes/${boxA.mailbox.id}`),
    b.api.post('/api/aliases', { mailboxId: boxA.mailbox.id }),
    b.api.patch(`/api/aliases/${aliasA.alias.id}`, { enabled: false }),
    b.api.patch(`/api/aliases/${aliasA.alias.id}`, { mailboxId: boxB.mailbox.id }),
    b.api.del(`/api/aliases/${aliasA.alias.id}`),
    b.api.get(`/api/messages?mailboxId=${boxA.mailbox.id}`),
    b.api.get(`/api/messages/${message.id}`),
    b.api.get(`/api/messages/${message.id}/parts/1`),
    b.api.patch(`/api/messages/${message.id}`, { seen: true }),
    b.api.del(`/api/messages/${message.id}`),
    b.api.post('/api/mail/send', sendBody({ id: aliasA.alias.id, address: aliasA.address }, { to: ['x@elsewhere.example'] })),
    b.api.post('/api/dev/inbound-mail', { to: aliasA.address, subject: 'forged' }),
  ];
  for (const res of await Promise.all(tries)) {
    assert.equal(res.status, 404, JSON.stringify(res.data));
    assert.equal(errorCode(res), 'not_found');
  }
  // B cannot move an own alias into a mailbox of A.
  const aliasB = await newAlias(b, boxB.mailbox.id);
  assert.equal((await b.api.patch(`/api/aliases/${aliasB.alias.id}`, { mailboxId: boxA.mailbox.id })).status, 404);

  // The lists of B have only the data of B.
  assert.deepEqual((await b.api.get('/api/mailboxes')).data.mailboxes.map((m) => m.id), [boxB.mailbox.id]);
  assert.deepEqual((await b.api.get('/api/aliases')).data.aliases.map((x) => x.id), [aliasB.alias.id]);
  assert.deepEqual((await listMessages(b)).messages, []);

  // Nothing of A changed.
  const boxNow = (await a.api.get('/api/mailboxes')).data.mailboxes[0];
  assert.deepEqual(boxNow, { ...boxA.mailbox, unread: 1, total: 1 });
  assert.deepEqual((await a.api.get('/api/aliases')).data.aliases, [{ ...aliasA.alias, received: 1 }]);
  const still = (await listMessages(a)).messages;
  assert.equal(still.length, 1);
  assert.equal(still[0].seen, false);
  assert.equal((await (await openMessage(a, message.id)).attachment(1)).toString(), 'secret file');

  // When A deletes the account, the mail data of A is gone and B is not touched.
  assert.equal((await a.api.del('/api/account', { confirm: 'delete my account' })).status, 204);
  for (const table of ['mailboxes', 'addresses', 'messages', 'send_counts']) {
    assert.equal(app.db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`, a.id).n, 0, table);
  }
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM message_parts WHERE message_id = ?', message.id).n, 0);
  assert.equal((await b.api.get('/api/mailboxes')).data.mailboxes.length, 1);
});

test('service: deliverLocal accepts own addresses and reports the others', async () => {
  const a = await newAccount(app, { credits: 100 });
  const box = await newMailbox(a);
  const raw = Buffer.from(`From: Robot <robot@elsewhere.example>\r\nTo: ${box.address}\r\nSubject: Direct\r\n\r\nLine one\r\n`);
  const result = await app.services.mail.deliverLocal({ from: 'robot@elsewhere.example', to: [box.address, box.address.toUpperCase(), 'nobody.here321@postern.test', 'x@elsewhere.example'], raw });
  assert.deepEqual(result, { accepted: [box.address], rejected: ['nobody.here321@postern.test', 'x@elsewhere.example'] });
  const list = (await listMessages(a)).messages;
  assert.equal(list.length, 1);
  const opened = await openMessage(a, list[0].id);
  assert.equal(opened.meta.subject, 'Direct');
  assert.deepEqual(opened.meta.from, { name: 'Robot', address: 'robot@elsewhere.example' });
  assert.equal(opened.body.text.trim(), 'Line one');
  await assert.rejects(app.services.mail.deliverLocal({ to: box.address, raw: 'text' }), TypeError);
  assert.deepEqual(await app.services.mail.deliverLocal({ to: [], raw }), { accepted: [], rejected: [] });
});

test('development routes: inbound mail only for own addresses; no routes outside development', async () => {
  const a = await newAccount(app, { credits: 100 });
  const box = await newMailbox(a);
  assert.equal((await a.api.post('/api/dev/inbound-mail', { to: 'nobody.home555@postern.test' })).status, 404);
  assert.equal((await a.api.post('/api/dev/inbound-mail', { to: 'x@elsewhere.example' })).status, 404);
  assert.equal((await a.api.post('/api/dev/inbound-mail', {})).status, 400);
  assert.equal((await a.api.post('/api/dev/inbound-mail', { to: box.address, from: 'not an address' })).status, 400);
  assert.equal((await client(app).post('/api/dev/inbound-mail', { to: box.address })).status, 401);
  assert.equal((await a.api.post('/api/dev/inbound-mail', { to: box.address })).status, 204);
  assert.equal((await listMessages(a)).messages.length, 1);

  const production = await startTestApp({ dev: false });
  try {
    const p = await newAccount(production, { credits: 100 });
    const pBox = await newMailbox(p);
    assert.equal((await p.api.post('/api/dev/inbound-mail', { to: pBox.address })).status, 404);
    assert.equal((await p.api.get('/api/dev/outbox')).status, 404);
    assert.equal((await client(production).get('/api/config')).data.dev, false);

    // Without a relay and outside development, mail to other servers is refused with a clear error.
    // The server does not answer "sent" for a message that goes nowhere.
    const from = { id: pBox.mailbox.addressId, address: pBox.address };
    const out = await p.api.post('/api/mail/send', sendBody(from, { to: ['far@elsewhere.example', pBox.address] }));
    assert.equal(out.status, 503);
    assert.equal(errorCode(out), 'no_relay');
    assert.equal(production.services.mail.outbox.length, 0);
    assert.deepEqual((await listMessages(p)).messages, []);
    // Mail between addresses of this server still works.
    assert.equal((await p.api.post('/api/mail/send', sendBody(from, { to: [pBox.address] }))).status, 201);
    assert.equal((await listMessages(p)).messages.length, 1);
  } finally {
    await production.stop();
  }
});

test('send: relay and DKIM signature when they are configured', async () => {
  // A local SMTP server stands in for the relay of the operator.
  const received = [];
  const relay = new SMTPServer({
    authOptional: true, disabledCommands: ['AUTH', 'STARTTLS'], logger: false, disableReverseLookup: true,
    onData(stream, session, done) {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => { received.push({ from: session.envelope.mailFrom.address, to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks) }); done(); });
    },
    onRcptTo(address, session, done) {
      if (address.address.startsWith('reject')) { const e = new Error('5.1.1 no'); e.responseCode = 550; return done(e); }
      done();
    },
  });
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve));
  const dir = mkdtempSync(join(tmpdir(), 'postern-dkim-'));
  const keyFile = join(dir, 'dkim.pem');
  const dkimKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(keyFile, dkimKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const dkimPublic = dkimKeys.publicKey.export({ type: 'spki', format: 'pem' });

  const relayed = await startTestApp({
    mail: { relayUrl: `smtp://127.0.0.1:${relay.server.address().port}?ignoreTLS=true`, dkimSelector: 'sel2026', dkimKeyFile: keyFile },
  });
  try {
    const a = await newAccount(relayed, { credits: 200 });
    const b = await newAccount(relayed, { credits: 200 });
    const box = await newMailbox(a, { domain: 'alt.test' });
    const boxB = await newMailbox(b);
    const from = { id: box.mailbox.addressId, address: box.address };

    const res = await a.api.post('/api/mail/send', sendBody(from, { to: ['far@elsewhere.example', boxB.address], bcc: ['quiet@elsewhere.example'], subject: 'Through the relay' }));
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(received.length, 1);
    assert.equal(received[0].from, box.address);
    // Only the outside recipients go to the relay.
    assert.deepEqual(received[0].to, ['far@elsewhere.example', 'quiet@elsewhere.example']);
    assert.equal(relayed.services.mail.outbox.length, 0);
    assert.equal((await listMessages(b)).messages.length, 1);

    const text = received[0].raw.toString('latin1');
    const parsed = await simpleParser(received[0].raw);
    assert.equal(parsed.subject, 'Through the relay');
    assert.match(parsed.messageId, /@alt\.test>$/);
    assert.ok(!text.includes('quiet@elsewhere.example'));
    const dkim = parsed.headers.get('dkim-signature');
    assert.ok(dkim, 'the message has a DKIM signature');
    assert.equal(dkim.params.d, 'alt.test'); // the domain of the from-address
    assert.equal(dkim.params.s, 'sel2026');
    assert.equal(dkim.params.a, 'rsa-sha256');
    assert.ok(dkim.params.b.length > 100);
    assert.match(dkim.params.h, /from/i);
    // The signature is correct after the trip through the relay: the message was not changed on the way.
    const check = verifyDkim(received[0].raw, dkimPublic);
    assert.equal(check.tags.c, 'relaxed/relaxed');
    assert.equal(check.bodyHashOk, true, 'DKIM body hash');
    assert.equal(check.signatureOk, true, 'DKIM header signature');
    const tampered = Buffer.from(received[0].raw.toString('latin1').replace('Through the relay', 'Through the delay'), 'latin1');
    assert.equal(verifyDkim(tampered, dkimPublic).signatureOk, false);
    // The relay path adds no header of its own.
    assert.deepEqual([...new Set(parsed.headerLines.map((h) => h.key))].sort(), ['content-transfer-encoding', 'content-type', 'date', 'dkim-signature', 'from', 'message-id', 'mime-version', 'subject', 'to']);
    // The local copy has the signature too.
    assert.match((await openMessage(b, (await listMessages(b)).messages[0].id)).body.text, /Hello there/);

    // The relay refuses every recipient: the user gets an error, nothing is delivered, the allowance is given back.
    const failed = await a.api.post('/api/mail/send', sendBody(from, { to: ['reject@elsewhere.example', boxB.address] }));
    assert.equal(failed.status, 502);
    assert.equal(errorCode(failed), 'send_failed');
    assert.ok(!JSON.stringify(failed.data).includes('reject@'));
    assert.equal((await listMessages(b)).messages.length, 1);
    assert.equal(relayed.db.get('SELECT n FROM send_counts WHERE account_id = ?', a.id).n, 1);
    assert.equal((await client(relayed).get('/api/config')).data.features.mockMail, false);
  } finally {
    await relayed.stop();
    await new Promise((resolve) => relay.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
