// Blocked senders: one address of a user refuses mail from one sender address or from a whole domain.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, client, newAccount, unb64u } from './helpers.js';
import { errorCode, newMailbox, newAlias, listMessages, openMessage, smtpSend, smtpTalk, databaseHas } from './mail-helpers.js';
import * as C from '../shared/crypto.js';
import { blockValue, senderBlockTexts } from '../server/mail/address.js';

let app;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

const openBlock = (account, block) => C.openJson(account.keys, unb64u(block.sealed), 'block');
const blocksOf = async (account, addressId) => (await account.api.get(`/api/addresses/${addressId}/blocks`)).data.blocks;
const subjects = async (account) => Promise.all((await listMessages(account)).messages.map(async (m) => (await openMessage(account, m.id)).meta.subject));

async function block(account, addressId, kind, value) {
  const res = await account.api.post(`/api/addresses/${addressId}/blocks`, { kind, value });
  assert.ok(res.status === 201 || res.status === 200, JSON.stringify(res.data));
  return res.data.block;
}

// An account with one mailbox and two aliases.
async function setup(target = app) {
  const account = await newAccount(target, { credits: 200 });
  const box = await newMailbox(account);
  const one = await newAlias(account, box.mailbox.id);
  const two = await newAlias(account, box.mailbox.id);
  return { account, box, one, two };
}

const refusedAsBlocked = (e) => e.responseCode === 550 && /5\.7\.1/.test(e.response);

test('blocks: the texts that are compared for a sender', () => {
  assert.deepEqual(senderBlockTexts('x@spam.example'), ['domain:spam.example', 'address:x@spam.example']);
  // Parent domains with two labels or more. The last label alone is never compared.
  assert.deepEqual(senderBlockTexts('News@Deep.Mail.Spam.Example'),
    ['domain:deep.mail.spam.example', 'address:news@deep.mail.spam.example', 'domain:spam.example', 'domain:mail.spam.example']);
  // Spellings of the same domain give the same texts.
  const plain = senderBlockTexts('x@mail.spam.example');
  assert.deepEqual(senderBlockTexts('X@MAIL.SPAM.EXAMPLE'), plain);
  assert.deepEqual(senderBlockTexts('x@mail.spam.example.'), plain, 'a dot at the end');
  assert.deepEqual(senderBlockTexts('x@mail.spam.example...'), plain);
  assert.deepEqual(senderBlockTexts('x@b\u00fccher.example'), senderBlockTexts('x@xn--bcher-kva.example'));
  // A very long local part gives no address text, but the domain is still compared.
  assert.deepEqual(senderBlockTexts(`${'a'.repeat(500)}@spam.example`), ['domain:spam.example']);
  assert.deepEqual(senderBlockTexts(`${'a'.repeat(100000)}@mail.spam.example`), ['domain:mail.spam.example', 'domain:spam.example']);
  // A name with many labels is followed for the 8 shortest parents only.
  const deep = senderBlockTexts(`x@${Array.from({ length: 30 }, (_, i) => `l${i}`).join('.')}.spam.example`);
  assert.equal(deep.length, 10);
  assert.ok(deep.includes('domain:spam.example') && deep.includes('domain:l29.spam.example'));
  // No sender, or a text that is no address.
  for (const none of ['', null, undefined, 'no-at-sign', '@spam.example', 'x@', 'x@.', `x@${'a'.repeat(254)}.example`]) assert.deepEqual(senderBlockTexts(none), [], String(none).slice(0, 20));
  // Odd text after the "@" is compared as it is. It is not read like a web address.
  assert.deepEqual(senderBlockTexts('x@spam.example/path'), ['domain:spam.example/path', 'address:x@spam.example/path']);
  assert.deepEqual(senderBlockTexts('x@[127.0.0.1]').slice(0, 2), ['domain:[127.0.0.1]', 'address:x@[127.0.0.1]']);

  // The value of a block and the texts of a sender meet: a stored value is always one of the texts of a matching sender.
  assert.ok(senderBlockTexts('Shop@B\u00fccher.Example.').includes(`address:${blockValue('address', 'shop@b\u00fccher.example')}`));
  assert.ok(senderBlockTexts('x@www.spam.example').includes(`domain:${blockValue('domain', 'Spam.Example')}`));
});

test('blocks: add, list, the same again, remove; counts on aliases and mailboxes', async () => {
  const { account: a, box, one, two } = await setup();
  assert.deepEqual(await blocksOf(a, one.alias.id), []);
  assert.equal((await a.api.get('/api/aliases')).data.aliases[0].blocks, 0);
  assert.equal((await a.api.get('/api/mailboxes')).data.mailboxes[0].blocks, 0);

  const res = await a.api.post(`/api/addresses/${one.alias.id}/blocks`, { kind: 'address', value: 'Loud.Sender@Spam-Shop.Example' });
  assert.equal(res.status, 201);
  const first = res.data.block;
  assert.deepEqual(Object.keys(first).sort(), ['createdDay', 'id', 'sealed']);
  assert.match(first.id, /^[A-Za-z0-9_-]{22}$/);
  assert.match(first.createdDay, /^\d{4}-\d{2}-\d{2}$/);
  // Only the account can read what is blocked. The value is stored in lower case.
  assert.deepEqual(await openBlock(a, first), { kind: 'address', value: 'loud.sender@spam-shop.example' });

  // The same block again gives the block that exists, with 200.
  const again = await a.api.post(`/api/addresses/${one.alias.id}/blocks`, { kind: 'address', value: 'loud.sender@spam-shop.example' });
  assert.equal(again.status, 200);
  assert.equal(again.data.block.id, first.id);
  assert.equal((await blocksOf(a, one.alias.id)).length, 1);

  // A domain block, and the same address as a block of the second alias and of the inbox address.
  const domain = await block(a, one.alias.id, 'domain', 'Ads-Network.Example');
  assert.deepEqual(await openBlock(a, domain), { kind: 'domain', value: 'ads-network.example' });
  const onTwo = await block(a, two.alias.id, 'address', 'loud.sender@spam-shop.example');
  assert.notEqual(onTwo.id, first.id);
  await block(a, box.mailbox.addressId, 'domain', 'ads-network.example');
  // A domain and an address with the same text are different blocks.
  assert.deepEqual((await blocksOf(a, one.alias.id)).map((b) => b.id), [first.id, domain.id]);

  // The lists show the number of blocks of each address.
  const aliases = (await a.api.get('/api/aliases')).data.aliases;
  assert.deepEqual(aliases.map((x) => x.blocks), [2, 1]);
  assert.equal((await a.api.get('/api/mailboxes')).data.mailboxes[0].blocks, 1);
  assert.equal((await a.api.patch(`/api/aliases/${one.alias.id}`, { enabled: true })).data.alias.blocks, 2);

  // The database has a keyed hash and a sealed copy, and nothing readable.
  const row = app.db.get('SELECT * FROM address_blocks WHERE id = ?', first.id);
  assert.deepEqual(Object.keys(row).sort(), ['account_id', 'address_id', 'created_day', 'id', 'sealed', 'value_hmac']);
  assert.deepEqual(Buffer.from(row.value_hmac), app.keys.indexHmac('block', 'address:loud.sender@spam-shop.example'));
  app.db.exec('PRAGMA wal_checkpoint(FULL)');
  for (const plain of ['loud.sender', 'spam-shop.example', 'ads-network', 'Loud.Sender', 'Spam-Shop']) {
    assert.equal(databaseHas(app, plain), false, `"${plain}" must not be in the database`);
  }
  assert.equal(databaseHas(app, first.id), true);

  // Remove.
  assert.equal((await a.api.del(`/api/addresses/${one.alias.id}/blocks/${first.id}`)).status, 204);
  assert.equal((await a.api.del(`/api/addresses/${one.alias.id}/blocks/${first.id}`)).status, 404);
  assert.deepEqual((await blocksOf(a, one.alias.id)).map((b) => b.id), [domain.id]);
  assert.equal((await blocksOf(a, two.alias.id)).length, 1, 'the block of the other alias is still there');
  assert.equal((await a.api.get('/api/aliases')).data.aliases[0].blocks, 1);
  // A block is removed through its own address only.
  assert.equal((await a.api.del(`/api/addresses/${one.alias.id}/blocks/${onTwo.id}`)).status, 404);

  // When the alias is deleted, its blocks go with it.
  assert.equal((await a.api.del(`/api/aliases/${two.alias.id}`)).status, 204);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM address_blocks WHERE address_id = ?', two.alias.id).n, 0);
  assert.equal((await a.api.get(`/api/addresses/${two.alias.id}/blocks`)).status, 404);
});

test('blocks: values are checked; international domains are stored in their ASCII form', async () => {
  const { account: a, one } = await setup();
  const post = (body) => a.api.post(`/api/addresses/${one.alias.id}/blocks`, body);

  for (const body of [{}, { value: 'x@y.example' }, { kind: 'person', value: 'x@y.example' }, { kind: 'Address', value: 'x@y.example' }, { kind: ['address'], value: 'x@y.example' }]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body));
  }
  const badAddresses = ['', 'no-at-sign', 'a@b', '@spam.example', 'a b@spam.example', 'a@spam..example', 'a@.spam.example', 'a@spam.example.', '.a@spam.example',
    'a..b@spam.example', 'a@b@spam.example', 'a@spam.example\r\nRCPT TO:<x@y.zz>', '<a@spam.example>', 'a@[127.0.0.1]', `${'x'.repeat(65)}@spam.example`,
    `a@${'x'.repeat(250)}.example`, 'spam.example', 5, null, ['a@spam.example'], { address: 'a@spam.example' }];
  for (const value of badAddresses) {
    const res = await post({ kind: 'address', value });
    assert.equal(res.status, 400, `address ${JSON.stringify(value)}`);
    assert.equal(errorCode(res), 'bad_request');
  }
  const badDomains = ['', 'com', 'localhost', '.spam.example', 'spam.example.', 'spam..example', 'user@spam.example', '@spam.example', 'spa m.example', '-spam.example',
    'spam-.example', 'spam.example/path', 'spam.example?x=1', 'spam.example#top', 'spam.example:25', 'https://spam.example', '*.spam.example', 'spam.1',
    '%73pam.example', 'spam%2eexample', '0x7f.1', '127.0.0.1', '[::1]', 'spam\\.example', 'spam_shop.example', `${'x'.repeat(64)}.example`, 7, null, ['spam.example']];
  for (const value of badDomains) {
    const res = await post({ kind: 'domain', value });
    assert.equal(res.status, 400, `domain ${JSON.stringify(value)}`);
    assert.equal(errorCode(res), 'bad_request');
  }
  assert.deepEqual(await blocksOf(a, one.alias.id), [], 'a refused value makes no block');

  // A name with letters outside ASCII is changed to the form that mail servers use.
  const idn = await block(a, one.alias.id, 'domain', 'Bücher.Example');
  assert.deepEqual(await openBlock(a, idn), { kind: 'domain', value: 'xn--bcher-kva.example' });
  const idnAddress = await block(a, one.alias.id, 'address', 'shop@bücher.example');
  assert.deepEqual(await openBlock(a, idnAddress), { kind: 'address', value: 'shop@xn--bcher-kva.example' });
  // Both spellings are the same block.
  assert.equal((await post({ kind: 'domain', value: 'xn--bcher-kva.example' })).status, 200);
  // The local part must be ASCII.
  assert.equal((await post({ kind: 'address', value: 'bücher@spam.example' })).status, 400);
});

test('blocks: limit for one address', async () => {
  const small = await startTestApp({ limits: { addressBlocks: 3 } });
  try {
    const { account: a, one, two } = await setup(small);
    for (let i = 0; i < 3; i++) await block(a, one.alias.id, 'domain', `spam${i}.example`);
    const over = await a.api.post(`/api/addresses/${one.alias.id}/blocks`, { kind: 'domain', value: 'spam9.example' });
    assert.equal(over.status, 409);
    assert.equal(errorCode(over), 'limit_reached');
    // A block that exists is still answered. The other alias has its own limit.
    assert.equal((await a.api.post(`/api/addresses/${one.alias.id}/blocks`, { kind: 'domain', value: 'spam1.example' })).status, 200);
    assert.equal((await a.api.post(`/api/addresses/${two.alias.id}/blocks`, { kind: 'domain', value: 'spam9.example' })).status, 201);
    // Room comes back after a block is removed.
    const [first] = await blocksOf(a, one.alias.id);
    assert.equal((await a.api.del(`/api/addresses/${one.alias.id}/blocks/${first.id}`)).status, 204);
    assert.equal((await a.api.post(`/api/addresses/${one.alias.id}/blocks`, { kind: 'domain', value: 'spam9.example' })).status, 201);
    assert.equal((await blocksOf(a, one.alias.id)).length, 3);
  } finally {
    await small.stop();
  }
  // The normal limit is 200.
  const { account: a, one } = await setup();
  const hmacs = Array.from({ length: 200 }, (_, i) => app.keys.indexHmac('block', `domain:filler${i}.example`));
  for (const [i, hmac] of hmacs.entries()) {
    app.db.run('INSERT INTO address_blocks (id, account_id, address_id, value_hmac, sealed, created_day) VALUES (?,?,?,?,?,?)',
      `filler${String(i).padStart(16, '0')}`, a.id, one.alias.id, hmac, Buffer.alloc(100), '2026-01-01');
  }
  assert.equal(errorCode(await a.api.post(`/api/addresses/${one.alias.id}/blocks`, { kind: 'domain', value: 'one-more.example' })), 'limit_reached');
  assert.equal((await a.api.get('/api/aliases')).data.aliases[0].blocks, 200);
});

test('blocks: an address of a different account gives 404; accounts do not see each other', async () => {
  const { account: a, box, one } = await setup();
  const { account: b, one: oneB } = await setup();
  const mine = await block(a, one.alias.id, 'address', 'someone@spam.example');

  for (const id of [one.alias.id, box.mailbox.addressId]) {
    const tries = [
      await b.api.get(`/api/addresses/${id}/blocks`),
      await b.api.post(`/api/addresses/${id}/blocks`, { kind: 'domain', value: 'spam.example' }),
      await b.api.del(`/api/addresses/${id}/blocks/${mine.id}`),
    ];
    for (const res of tries) { assert.equal(res.status, 404); assert.equal(errorCode(res), 'not_found'); }
  }
  // B cannot remove a block of A through an own address either.
  assert.equal((await b.api.del(`/api/addresses/${oneB.alias.id}/blocks/${mine.id}`)).status, 404);
  // Unknown ids and ids that are not well formed.
  for (const id of ['Z'.repeat(22), 'short', '..', 'a'.repeat(23)]) {
    assert.equal((await a.api.get(`/api/addresses/${id}/blocks`)).status, 404, id);
    assert.equal((await a.api.del(`/api/addresses/${one.alias.id}/blocks/${id}`)).status, 404, id);
  }
  // No cookie.
  const anon = client(app);
  assert.equal((await anon.get(`/api/addresses/${one.alias.id}/blocks`)).status, 401);
  assert.equal((await anon.post(`/api/addresses/${one.alias.id}/blocks`, { kind: 'domain', value: 'spam.example' })).status, 401);
  assert.equal((await anon.del(`/api/addresses/${one.alias.id}/blocks/${mine.id}`)).status, 401);

  // The same value in account B is an own block, and B cannot open the copy of A.
  const theirs = await block(b, oneB.alias.id, 'address', 'someone@spam.example');
  assert.notEqual(theirs.id, mine.id);
  await assert.rejects(openBlock(b, mine));
  assert.deepEqual((await blocksOf(a, one.alias.id)).map((x) => x.id), [mine.id]);
  assert.deepEqual((await blocksOf(b, oneB.alias.id)).map((x) => x.id), [theirs.id]);

  // A block of B does not stop mail to A.
  await block(b, oneB.alias.id, 'domain', 'other-sender.example');
  await smtpSend(app, { from: 'x@other-sender.example', to: one.address, subject: 'for A', text: 'x' });
  assert.deepEqual(await subjects(a), ['for A']);

  // When an account is deleted, its blocks are deleted.
  assert.equal((await b.api.del('/api/account', { confirm: 'delete my account' })).status, 204);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM address_blocks WHERE account_id = ?', b.id).n, 0);
  assert.equal((await blocksOf(a, one.alias.id)).length, 1);
});

test('smtp: a blocked envelope sender gets 550 5.7.1 for this address only', async () => {
  const { account: a, box, one, two } = await setup();
  await block(a, one.alias.id, 'address', 'pest@spam.example');

  const events = [];
  const publish = app.events.publish;
  app.events.publish = (...args) => { events.push(args); return publish(...args); };
  try {
    // The answer comes at RCPT time, before the message is sent. The other alias and the inbox address accept.
    const replies = await smtpTalk(app, ['EHLO mx.spam.example', 'MAIL FROM:<pest@spam.example>', `RCPT TO:<${one.address}>`, `RCPT TO:<${two.address}>`, `RCPT TO:<${box.address}>`, 'QUIT']);
    assert.match(replies[3], /^550 5\.7\.1 /);
    assert.doesNotMatch(replies[3], /pest|spam\.example/, 'the answer does not repeat the sender');
    assert.match(replies[4], /^250 /);
    assert.match(replies[5], /^250 /);

    await assert.rejects(smtpSend(app, { from: 'pest@spam.example', to: one.address, subject: 'blocked', text: 'x' }), refusedAsBlocked);
    // Upper case in the sender makes no difference.
    await assert.rejects(smtpSend(app, { from: 'PEST@Spam.Example', to: one.address, subject: 'blocked', text: 'x' }), refusedAsBlocked);
    assert.deepEqual(events, [], 'blocked mail publishes no event');
  } finally {
    app.events.publish = publish;
  }
  assert.deepEqual(await subjects(a), []);
  assert.equal((await a.api.get('/api/aliases')).data.aliases[0].received, 0, 'blocked mail is not counted');

  // The same sender reaches the other alias. A different sender reaches the alias with the block.
  await smtpSend(app, { from: 'pest@spam.example', to: two.address, subject: 'to the other alias', text: 'x' });
  await smtpSend(app, { from: 'friend@spam.example', to: one.address, subject: 'from a friend', text: 'x' });
  assert.deepEqual((await subjects(a)).sort(), ['from a friend', 'to the other alias']);
  assert.deepEqual((await a.api.get('/api/aliases')).data.aliases.map((x) => x.received), [1, 1]);
});

test('smtp: the From line and the Sender line are checked too', async () => {
  const { account: a, one } = await setup();
  await block(a, one.alias.id, 'address', 'pest@spam.example');
  const to = one.address;
  const envelope = (from) => ({ from, to: [to] });

  // The envelope sender is a mailing service. The From line names the blocked sender.
  await assert.rejects(smtpSend(app, { envelope: envelope('bounces@mailer.example'), from: 'The Pest <pest@spam.example>', to, subject: 'hidden behind a service', text: 'x' }), refusedAsBlocked);
  // Blocked sender in the Sender line.
  await assert.rejects(smtpSend(app, { envelope: envelope('bounces@mailer.example'), from: 'nice@fine.example', sender: 'pest@spam.example', to, subject: 'sender line', text: 'x' }), refusedAsBlocked);
  // Two addresses in the From line, one of them blocked.
  await assert.rejects(smtpSend(app, { envelope: envelope('bounces@mailer.example'), from: 'nice@fine.example, PEST@SPAM.EXAMPLE', to, subject: 'two writers', text: 'x' }), refusedAsBlocked);
  // A bounce has no envelope sender. Its From line is checked.
  await assert.rejects(smtpSend(app, { envelope: envelope(''), from: 'pest@spam.example', to, subject: 'bounce from the pest', text: 'x' }), refusedAsBlocked);
  assert.deepEqual(await subjects(a), []);
  assert.equal((await a.api.get('/api/aliases')).data.aliases[0].received, 0);

  // The same shapes with senders that are not blocked arrive.
  await smtpSend(app, { envelope: envelope('bounces@mailer.example'), from: 'nice@fine.example', to, subject: 'through a service', text: 'x' });
  await smtpSend(app, { envelope: envelope(''), from: 'mailer-daemon@fine.example', to, subject: 'a real bounce', text: 'x' });
  // The blocked address in To, Cc, or Reply-To is no reason to refuse.
  await smtpSend(app, { from: 'nice@fine.example', to, cc: 'pest@spam.example', replyTo: 'pest@spam.example', subject: 'only mentioned', text: 'x' });
  assert.deepEqual((await subjects(a)).sort(), ['a real bounce', 'only mentioned', 'through a service']);
});

test('smtp: a domain block catches subdomains and no look-alike', async () => {
  const { account: a, one } = await setup();
  await block(a, one.alias.id, 'domain', 'spam.example');
  const to = one.address;

  for (const from of ['x@spam.example', 'y@mail.spam.example', 'z@deep.mail.spam.example', 'Z@Deep.MAIL.Spam.Example']) {
    await assert.rejects(smtpSend(app, { from, to, subject: `from ${from}`, text: 'x' }), refusedAsBlocked, from);
  }
  // Also behind a different envelope sender.
  await assert.rejects(smtpSend(app, { envelope: { from: 'b@mailer.example', to: [to] }, from: 'news@offers.spam.example', to, subject: 'header', text: 'x' }), refusedAsBlocked);

  // Names that only look similar are different domains.
  const fine = ['x@notspam.example', 'x@spam.example.org', 'x@spam-example.example', 'x@example', 'spam.example@elsewhere.example', 'x@myspam.example'];
  for (const from of fine) await smtpSend(app, { from, to, subject: `from ${from}`, text: 'x' });
  assert.deepEqual((await subjects(a)).sort(), fine.map((f) => `from ${f}`).sort());

  // An address block is for one address. Others at the same domain still arrive.
  const { account: b, one: oneB } = await setup();
  await block(b, oneB.alias.id, 'address', 'one@firm.example');
  await assert.rejects(smtpSend(app, { from: 'one@firm.example', to: oneB.address, subject: 'no', text: 'x' }), refusedAsBlocked);
  await smtpSend(app, { from: 'two@firm.example', to: oneB.address, subject: 'yes', text: 'x' });
  await smtpSend(app, { from: 'one@mail.firm.example', to: oneB.address, subject: 'yes too', text: 'x' });
  assert.deepEqual((await subjects(b)).sort(), ['yes', 'yes too']);

  // Spellings that mean the same domain do not get around the block: a dot at the end, a very long name before the "@".
  const longName = await app.services.mail.deliverLocal({ to: [to], raw: Buffer.from(`From: <${'a'.repeat(400)}@mail.spam.example>\r\nTo: ${to}\r\n\r\nx\r\n`) });
  assert.deepEqual(longName, { accepted: [], rejected: [to] });
  const dotted = await app.services.mail.deliverLocal({ from: 'x@spam.example.', to: [to], raw: Buffer.from(`From: x@elsewhere.example\r\nTo: ${to}\r\n\r\nx\r\n`) });
  assert.deepEqual(dotted, { accepted: [], rejected: [to] });
  const dottedHeader = await app.services.mail.deliverLocal({ to: [to], raw: Buffer.from(`From: <x@Mail.Spam.Example.>\r\nTo: ${to}\r\n\r\nx\r\n`) });
  assert.deepEqual(dottedHeader, { accepted: [], rejected: [to] });

  // An international domain is matched in both spellings.
  await block(b, oneB.alias.id, 'domain', 'bücher.example');
  await assert.rejects(smtpSend(app, { from: 'x@xn--bcher-kva.example', to: oneB.address, subject: 'no', text: 'x' }), refusedAsBlocked);
  await assert.rejects(smtpSend(app, { envelope: { from: 'b@mailer.example', to: [oneB.address] }, from: 'x@shop.xn--bcher-kva.example', to: oneB.address, subject: 'no', text: 'x' }), refusedAsBlocked);
});

test('smtp: two recipients, one blocks the sender, the other still gets the mail', async () => {
  const { account: a, one } = await setup();
  const { account: b, one: oneB } = await setup();
  await block(a, one.alias.id, 'domain', 'spam.example');

  // Blocked by the envelope sender: refused for A at RCPT, accepted for B.
  const first = await smtpSend(app, { from: 'x@spam.example', to: [one.address, oneB.address], subject: 'envelope', text: 'x' });
  assert.deepEqual(first.accepted, [oneB.address]);
  assert.deepEqual(first.rejected, [one.address]);

  // Blocked by the From line only: both are accepted at RCPT, the message is answered with 250, and only B gets a copy.
  const second = await smtpSend(app, { envelope: { from: 'b@mailer.example', to: [one.address, oneB.address] }, from: 'x@spam.example', to: [one.address, oneB.address], subject: 'header', text: 'x' });
  assert.deepEqual(second.accepted.sort(), [one.address, oneB.address].sort());
  assert.match(second.response, /^250 /);

  assert.deepEqual(await subjects(a), []);
  assert.deepEqual((await subjects(b)).sort(), ['envelope', 'header']);
  assert.equal((await a.api.get('/api/aliases')).data.aliases[0].received, 0);
  assert.equal((await b.api.get('/api/aliases')).data.aliases[0].received, 2);
});

test('smtp: after the block is removed, mail arrives again', async () => {
  const { account: a, one } = await setup();
  const made = await block(a, one.alias.id, 'address', 'pest@spam.example');
  await assert.rejects(smtpSend(app, { from: 'pest@spam.example', to: one.address, subject: 'during', text: 'x' }), refusedAsBlocked);
  assert.equal((await a.api.del(`/api/addresses/${one.alias.id}/blocks/${made.id}`)).status, 204);
  await smtpSend(app, { from: 'pest@spam.example', to: one.address, subject: 'after', text: 'x' });
  assert.deepEqual(await subjects(a), ['after']);
  // A block can be made again.
  await block(a, one.alias.id, 'address', 'pest@spam.example');
  await assert.rejects(smtpSend(app, { from: 'pest@spam.example', to: one.address, subject: 'again', text: 'x' }), refusedAsBlocked);
});

test('mail inside the server honours the block: send route, service, and development route', async () => {
  const { account: a, one, two } = await setup();
  const { account: b, one: oneB, two: twoB } = await setup();
  await block(b, oneB.alias.id, 'address', one.address);
  const body = (from, to) => ({ addressId: from.alias.id, from: from.address, to, subject: 'Hello', text: 'x' });

  // A sends from the blocked address: refused, with a plain reason. Nothing is sent, also not to the other recipient.
  const refused = await a.api.post('/api/mail/send', body(one, [twoB.address, oneB.address]));
  assert.equal(refused.status, 400);
  assert.equal(errorCode(refused), 'bad_recipient');
  assert.equal(refused.data.error.message, `This address does not accept mail from your address: ${oneB.address}`);
  assert.deepEqual(await subjects(b), []);
  assert.equal(app.db.get('SELECT COALESCE(SUM(n), 0) AS n FROM send_counts WHERE account_id = ?', a.id).n, 0);

  // The other alias of B accepts the same sender. A different alias of A reaches the alias with the block.
  assert.equal((await a.api.post('/api/mail/send', body(one, [twoB.address]))).status, 201);
  assert.equal((await a.api.post('/api/mail/send', body(two, [oneB.address]))).status, 201);
  assert.equal((await listMessages(b)).messages.length, 2);

  // A block of our own domain stops every address of this server, and no other.
  await block(b, twoB.alias.id, 'domain', 'postern.test');
  assert.equal(errorCode(await a.api.post('/api/mail/send', body(two, [twoB.address]))), 'bad_recipient');
  await smtpSend(app, { from: 'x@elsewhere.example', to: twoB.address, subject: 'from outside', text: 'x' });
  assert.equal((await listMessages(b)).messages.length, 3);

  // The service for other modules gives the address back as rejected.
  const raw = Buffer.from(`From: ${one.address}\r\nTo: ${oneB.address}\r\nSubject: Direct\r\n\r\nx\r\n`);
  assert.deepEqual(await app.services.mail.deliverLocal({ from: one.address, to: [oneB.address], raw }), { accepted: [], rejected: [oneB.address] });
  // Without an envelope sender the From line decides.
  assert.deepEqual(await app.services.mail.deliverLocal({ to: [oneB.address], raw }), { accepted: [], rejected: [oneB.address] });
  assert.equal((await listMessages(b)).messages.length, 3);

  // The development route says why the test mail did not arrive.
  const dev = await b.api.post('/api/dev/inbound-mail', { to: oneB.address, from: one.address, subject: 'simulated' });
  assert.equal(dev.status, 409);
  assert.equal(dev.data.error.message, 'This address blocks this sender.');
  assert.equal((await b.api.post('/api/dev/inbound-mail', { to: oneB.address, from: 'ok@elsewhere.example', subject: 'simulated' })).status, 204);
  assert.equal((await listMessages(b)).messages.length, 4);
});

test('blocks: a block does not stop sending to the blocked address, and a suspended mailbox still answers the block first', async () => {
  const { account: a, box, one } = await setup();
  await block(a, one.alias.id, 'address', 'pest@spam.example');
  // The user can still write to the blocked address.
  const sent = await a.api.post('/api/mail/send', { addressId: one.alias.id, from: one.address, to: ['pest@spam.example'], subject: 'Stop writing', text: 'x' });
  assert.equal(sent.status, 201);

  // Suspended mailbox: a blocked sender gets the final answer, other senders the temporary one.
  app.db.run("UPDATE mailboxes SET status = 'suspended' WHERE id = ?", box.mailbox.id);
  await assert.rejects(smtpSend(app, { from: 'pest@spam.example', to: one.address, subject: 'x', text: 'x' }), refusedAsBlocked);
  await assert.rejects(smtpSend(app, { from: 'friend@fine.example', to: one.address, subject: 'x', text: 'x' }), (e) => e.responseCode === 450);
  // The block list can be changed while the mailbox is suspended.
  assert.equal((await a.api.post(`/api/addresses/${one.alias.id}/blocks`, { kind: 'domain', value: 'more.example' })).status, 201);
  assert.equal((await blocksOf(a, one.alias.id)).length, 2);
});
