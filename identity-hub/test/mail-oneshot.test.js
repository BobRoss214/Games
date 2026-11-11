// One-shot aliases, the count of refused mail, and "burn" (delete all mail of one address).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startTestApp, client, newAccount } from './helpers.js';
import { errorCode, newMailbox, newAlias, listMessages, openMessage, makeCopy, smtpSend, smtpTalk, databaseHas } from './mail-helpers.js';

let app;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

const now = () => Math.floor(Date.now() / 1000);
const aliasOf = async (account, id) => (await account.api.get('/api/aliases')).data.aliases.find((x) => x.id === id);
const mailboxOf = async (account, id) => (await account.api.get('/api/mailboxes')).data.mailboxes.find((x) => x.id === id);
const subjects = async (account, query = '') => (await Promise.all((await listMessages(account, query)).messages.map(async (m) => (await openMessage(account, m.id)).meta.subject))).sort();
const gone = (e) => e.responseCode === 550 && /5\.1\.1/.test(e.response);
const rawMail = (to, subject) => Buffer.from(`From: x@elsewhere.example\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\nx\r\n`);

// Runs fn and returns the events that were published during it.
async function eventsDuring(fn, target = app) {
  const events = [];
  const publish = target.events.publish;
  target.events.publish = (...args) => { events.push(args); return publish(...args); };
  try { await fn(); } finally { target.events.publish = publish; }
  return events;
}

async function setup(target = app) {
  const account = await newAccount(target, { credits: 300 });
  const box = await newMailbox(account);
  return { account, box };
}

// ---- one-shot alias ----

test('one-shot: the alias stops after the first message, in the same step that stores it', async () => {
  const { account: a, box } = await setup();
  const normal = await newAlias(a, box.mailbox.id);
  assert.equal(normal.alias.oneShot, false);
  assert.equal(normal.alias.usedUp, false);

  const res = await a.api.post('/api/aliases', { mailboxId: box.mailbox.id, oneShot: true });
  assert.equal(res.status, 201);
  const { alias, address } = res.data;
  assert.equal(alias.oneShot, true);
  assert.equal(alias.usedUp, false);
  assert.equal(alias.enabled, true);
  for (const bad of ['yes', 1, 0, null, []]) {
    if (bad === null) continue; // null means "not given"
    assert.equal((await a.api.post('/api/aliases', { mailboxId: box.mailbox.id, oneShot: bad })).status, 400, JSON.stringify(bad));
  }

  // The first message arrives. The browser is told about the mail and about the change of the alias.
  const events = await eventsDuring(() => smtpSend(app, { to: address, subject: 'the sign-up code', text: 'Your code is 482913' }));
  assert.deepEqual(events, [[a.id, 'mail', { mailboxId: box.mailbox.id }], [a.id, 'aliases']]);
  assert.deepEqual(await subjects(a), ['the sign-up code']);
  const used = await aliasOf(a, alias.id);
  assert.deepEqual({ enabled: used.enabled, oneShot: used.oneShot, usedUp: used.usedUp, received: used.received, refused: used.refused },
    { enabled: false, oneShot: true, usedUp: true, received: 1, refused: 0 });

  // Every later message is refused like mail for an alias that is turned off.
  await assert.rejects(smtpSend(app, { to: address, subject: 'spam later', text: 'x' }), gone);
  assert.deepEqual(await app.services.mail.deliverLocal({ to: [address], raw: rawMail(address, 'spam later') }), { accepted: [], rejected: [address] });
  assert.equal((await a.api.post('/api/dev/inbound-mail', { to: address, subject: 'spam later' })).status, 409);
  assert.deepEqual(await subjects(a), ['the sign-up code']);
  assert.equal((await aliasOf(a, alias.id)).refused, 3);
  // A used-up alias cannot send, like an alias that is turned off.
  const send = await a.api.post('/api/mail/send', { addressId: alias.id, from: address, to: ['x@elsewhere.example'], subject: 'x', text: 'x' });
  assert.equal(send.status, 409);
  assert.equal(errorCode(send), 'conflict');

  // The normal alias and the inbox address are not changed by all this.
  await smtpSend(app, { to: normal.address, subject: 'one', text: 'x' });
  await smtpSend(app, { to: normal.address, subject: 'two', text: 'x' });
  await smtpSend(app, { to: box.address, subject: 'three', text: 'x' });
  assert.equal((await aliasOf(a, normal.alias.id)).enabled, true);
  assert.equal((await listMessages(a)).messages.length, 4);
});

test('one-shot: switch it on again, make it a normal alias, make a normal alias one-shot', async () => {
  const { account: a, box } = await setup();
  const { alias, address } = (await a.api.post('/api/aliases', { mailboxId: box.mailbox.id, oneShot: true })).data;
  const patch = (body) => a.api.patch(`/api/aliases/${alias.id}`, body);
  const state = async () => { const x = await aliasOf(a, alias.id); return [x.enabled, x.oneShot, x.usedUp]; };

  await smtpSend(app, { to: address, subject: 'first', text: 'x' });
  assert.deepEqual(await state(), [false, true, true]);

  // Switched on again: it is still one-shot, so it takes one more message and stops again.
  const on = await patch({ enabled: true });
  assert.equal(on.status, 200);
  assert.deepEqual([on.data.alias.enabled, on.data.alias.oneShot, on.data.alias.usedUp], [true, true, false]);
  await smtpSend(app, { to: address, subject: 'second', text: 'x' });
  assert.deepEqual(await state(), [false, true, true]);
  await assert.rejects(smtpSend(app, { to: address, subject: 'refused', text: 'x' }), gone);

  // Made a normal alias: the "used up" state is gone. It stays off until the user turns it on.
  const normal = await patch({ oneShot: false });
  assert.deepEqual([normal.data.alias.enabled, normal.data.alias.oneShot, normal.data.alias.usedUp], [false, false, false]);
  await assert.rejects(smtpSend(app, { to: address, subject: 'still off', text: 'x' }), gone);
  await patch({ enabled: true });
  await smtpSend(app, { to: address, subject: 'third', text: 'x' });
  await smtpSend(app, { to: address, subject: 'fourth', text: 'x' });
  assert.deepEqual(await state(), [true, false, false]);

  // A normal alias made one-shot: the next message is the last one.
  assert.deepEqual([(await patch({ oneShot: true })).data.alias.oneShot, (await aliasOf(a, alias.id)).enabled], [true, true]);
  await smtpSend(app, { to: address, subject: 'fifth', text: 'x' });
  assert.deepEqual(await state(), [false, true, true]);
  // One request can do both: normal again and on.
  assert.deepEqual([(await patch({ oneShot: false, enabled: true })).status, ...(await state())], [200, true, false, false]);
  // A used-up alias that the user turns off by hand keeps nothing special.
  await patch({ oneShot: true });
  await smtpSend(app, { to: address, subject: 'sixth', text: 'x' });
  assert.deepEqual((await patch({ enabled: false })).data.alias.usedUp, true);

  assert.deepEqual(await subjects(a), ['fifth', 'first', 'fourth', 'second', 'sixth', 'third']);
  for (const bad of ['true', 1, null, {}]) assert.equal((await patch({ oneShot: bad })).status, 400, JSON.stringify(bad));
  // The address of a mailbox cannot be one-shot.
  assert.equal((await a.api.patch(`/api/aliases/${box.mailbox.addressId}`, { oneShot: true })).status, 404);
  const other = await newAccount(app);
  assert.equal((await other.api.patch(`/api/aliases/${alias.id}`, { oneShot: false })).status, 404);
});

test('one-shot: two messages at the same moment, and two messages in one connection', async () => {
  const { account: a, box } = await setup();
  const make = async () => (await a.api.post('/api/aliases', { mailboxId: box.mailbox.id, oneShot: true })).data;

  // Two deliveries start together. Both pass the first check; only one is stored.
  const first = await make();
  const both = await Promise.all([
    app.services.mail.deliverLocal({ to: [first.address], raw: rawMail(first.address, 'race A') }),
    app.services.mail.deliverLocal({ to: [first.address], raw: rawMail(first.address, 'race B') }),
  ]);
  assert.deepEqual(both.map((r) => r.accepted.length).sort(), [0, 1]);
  assert.equal((await listMessages(a)).messages.length, 1);
  let state = await aliasOf(a, first.alias.id);
  assert.deepEqual([state.enabled, state.usedUp, state.received, state.refused], [false, true, 1, 1]);

  // Five SMTP senders at the same moment: one message arrives, the other four get a final error.
  const second = await make();
  const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => smtpSend(app, { to: second.address, subject: `sender ${i}`, text: 'x' })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const r of results.filter((x) => x.status === 'rejected')) assert.ok(gone(r.reason), String(r.reason));
  assert.equal((await listMessages(a)).messages.length, 2);
  state = await aliasOf(a, second.alias.id);
  assert.deepEqual([state.enabled, state.usedUp, state.received, state.refused], [false, true, 1, 4]);

  // One connection, two messages one after the other: the second RCPT is refused.
  const third = await make();
  const mail = (n) => `Subject: message ${n}\r\nFrom: x@elsewhere.example\r\n\r\nbody\r\n.`;
  const replies = await smtpTalk(app, [
    'EHLO mx.sender.example',
    'MAIL FROM:<x@elsewhere.example>', `RCPT TO:<${third.address}>`, 'DATA', mail(1),
    'MAIL FROM:<x@elsewhere.example>', `RCPT TO:<${third.address}>`, 'QUIT',
  ]);
  assert.match(replies[3], /^250 /);
  assert.match(replies[5], /^250 /, 'the first message is stored');
  assert.match(replies[7], /^550 5\.1\.1 /, 'the second message is refused at RCPT');
  assert.equal((await listMessages(a)).messages.length, 3);

  // One message for a one-shot alias and a normal alias: both get it, and the one-shot alias is used up.
  const fourth = await make();
  const normal = await newAlias(a, box.mailbox.id);
  const info = await smtpSend(app, { to: [fourth.address, normal.address], subject: 'for two', text: 'x' });
  assert.equal(info.accepted.length, 2);
  assert.equal((await aliasOf(a, fourth.alias.id)).usedUp, true);
  assert.equal((await aliasOf(a, normal.alias.id)).enabled, true);
  assert.equal((await listMessages(a)).messages.length, 5);

  // A message from a blocked sender is not stored, so it does not use the alias up.
  const fifth = await make();
  await a.api.post(`/api/addresses/${fifth.alias.id}/blocks`, { kind: 'domain', value: 'spam.example' });
  await assert.rejects(smtpSend(app, { from: 'x@spam.example', to: fifth.address, subject: 'blocked', text: 'x' }), (e) => e.responseCode === 550 && /5\.7\.1/.test(e.response));
  await assert.rejects(smtpSend(app, { envelope: { from: 'b@mailer.example', to: [fifth.address] }, from: 'x@spam.example', to: fifth.address, subject: 'blocked', text: 'x' }), (e) => e.responseCode === 550);
  state = await aliasOf(a, fifth.alias.id);
  assert.deepEqual([state.enabled, state.usedUp, state.received, state.refused], [true, false, 0, 2]);
  await smtpSend(app, { from: 'ok@fine.example', to: fifth.address, subject: 'the real one', text: 'x' });
  assert.equal((await aliasOf(a, fifth.alias.id)).usedUp, true);
});

// ---- count of refused mail ----

test('refused: one number for each address, counted one time for each message and recipient', async () => {
  const { account: a, box } = await setup();
  const { account: b, box: boxB } = await setup();
  const off = await newAlias(a, box.mailbox.id);
  const ended = await newAlias(a, box.mailbox.id);
  const blocking = await newAlias(a, box.mailbox.id);
  const fine = await newAlias(a, box.mailbox.id);
  await a.api.patch(`/api/aliases/${off.alias.id}`, { enabled: false });
  app.db.run('UPDATE addresses SET expires_at = ? WHERE id = ?', now() - 10, ended.alias.id);
  await a.api.post(`/api/addresses/${blocking.alias.id}/blocks`, { kind: 'address', value: 'pest@spam.example' });
  await a.api.post(`/api/addresses/${box.mailbox.addressId}/blocks`, { kind: 'domain', value: 'spam.example' });
  const counts = async () => {
    const list = (await a.api.get('/api/aliases')).data.aliases;
    const of = (x) => list.find((y) => y.id === x.alias.id).refused;
    return { off: of(off), ended: of(ended), blocking: of(blocking), fine: of(fine), inbox: (await mailboxOf(a, box.mailbox.id)).refused };
  };
  assert.deepEqual(await counts(), { off: 0, ended: 0, blocking: 0, fine: 0, inbox: 0 });
  const total = () => app.db.get('SELECT SUM(refused) AS n FROM addresses').n;
  const before = total();

  const events = await eventsDuring(async () => {
    // Turned off, past its end date, blocked sender (envelope), blocked sender (From line), blocked on the inbox address.
    await assert.rejects(smtpSend(app, { to: off.address, subject: 'x', text: 'x' }), gone);
    await assert.rejects(smtpSend(app, { to: ended.address, subject: 'x', text: 'x' }), gone);
    await assert.rejects(smtpSend(app, { from: 'pest@spam.example', to: blocking.address, subject: 'x', text: 'x' }), (e) => e.responseCode === 550);
    await assert.rejects(smtpSend(app, { envelope: { from: 'b@mailer.example', to: [blocking.address] }, from: 'pest@spam.example', to: blocking.address, subject: 'x', text: 'x' }), (e) => e.responseCode === 550);
    await assert.rejects(smtpSend(app, { from: 'any@mail.spam.example', to: box.address, subject: 'x', text: 'x' }), (e) => e.responseCode === 550);
  });
  assert.deepEqual(events, [], 'a refusal publishes no event');
  assert.deepEqual(await counts(), { off: 1, ended: 1, blocking: 2, fine: 0, inbox: 1 });

  // The sender repeats the command for one message: counted one time. A new message counts again.
  const replies = await smtpTalk(app, [
    'EHLO mx.sender.example',
    'MAIL FROM:<x@elsewhere.example>', `RCPT TO:<${off.address}>`, `RCPT TO:<${off.address}>`, `RCPT TO:<${off.address.toUpperCase()}>`, `RCPT TO:<${ended.address}>`,
    'RSET',
    'MAIL FROM:<x@elsewhere.example>', `RCPT TO:<${off.address}>`, 'QUIT',
  ]);
  // replies[0] is the greeting, so the reply to line n is replies[n + 1].
  assert.deepEqual(replies.slice(3, 7).map((r) => r.slice(0, 9)), ['550 5.1.1', '550 5.1.1', '550 5.1.1', '550 5.1.1']);
  assert.match(replies[9], /^550 5\.1\.1/);
  assert.deepEqual(await counts(), { off: 3, ended: 2, blocking: 2, fine: 0, inbox: 1 });

  // One message for several recipients: one count for each recipient that refuses, none for the one that accepts.
  const mixed = await smtpSend(app, { to: [off.address, ended.address, fine.address], subject: 'mixed', text: 'x' });
  assert.deepEqual(mixed.accepted, [fine.address]);
  assert.deepEqual(await counts(), { off: 4, ended: 3, blocking: 2, fine: 0, inbox: 1 });

  // Mail inside the server: the send route, the service, and the development route.
  const send = (to) => b.api.post('/api/mail/send', { addressId: boxB.mailbox.addressId, from: boxB.address, to, subject: 'x', text: 'x' });
  assert.equal(errorCode(await send([off.address, ended.address, fine.address])), 'bad_recipient');
  assert.deepEqual(await counts(), { off: 5, ended: 4, blocking: 2, fine: 0, inbox: 1 });
  assert.deepEqual((await listMessages(a)).messages.length, 1, 'only the message of the mixed delivery is stored');
  await app.services.mail.deliverLocal({ to: [off.address, off.address.toUpperCase()], raw: rawMail(off.address, 'x') });
  assert.equal((await a.api.post('/api/dev/inbound-mail', { to: off.address })).status, 409);
  assert.deepEqual(await counts(), { off: 7, ended: 4, blocking: 2, fine: 0, inbox: 1 });

  // The number of delivered messages is a different count and did not move.
  assert.deepEqual((await a.api.get('/api/aliases')).data.aliases.map((x) => x.received), [0, 0, 0, 1]);
  // Only these addresses were counted. Nothing was counted for account B.
  assert.equal(total() - before, 7 + 4 + 2 + 1);
  assert.equal((await mailboxOf(b, boxB.mailbox.id)).refused, 0);
});

test('refused: nothing is counted for unknown addresses and for temporary refusals', async () => {
  const { account: a, box } = await setup();
  const made = await newAlias(a, box.mailbox.id);
  const alias = { id: made.alias.id, address: made.address };
  const total = () => app.db.get('SELECT SUM(refused) AS n FROM addresses').n;
  const before = total();

  // Unknown addresses, a deleted address, a domain that is not ours.
  const deleted = await newAlias(a, box.mailbox.id);
  await a.api.del(`/api/aliases/${deleted.alias.id}`);
  for (const to of ['nobody.here808@postern.test', deleted.address, 'x@elsewhere.example']) {
    await assert.rejects(smtpSend(app, { to, subject: 'x', text: 'x' }), (e) => e.responseCode === 550);
  }
  await app.services.mail.deliverLocal({ to: ['nobody.here808@postern.test'], raw: rawMail('nobody.here808@postern.test', 'x') });
  assert.equal(total(), before);

  // A suspended mailbox answers "try again later". That is no refusal of the address.
  app.db.run("UPDATE mailboxes SET status = 'suspended' WHERE id = ?", box.mailbox.id);
  await assert.rejects(smtpSend(app, { to: alias.address, subject: 'x', text: 'x' }), (e) => e.responseCode === 450);
  await assert.rejects(smtpSend(app, { to: box.address, subject: 'x', text: 'x' }), (e) => e.responseCode === 450);
  assert.equal(total(), before);
  app.db.run("UPDATE mailboxes SET status = 'active' WHERE id = ?", box.mailbox.id);

  // A message that the parser refuses is no refusal of the address either.
  const parts = Array.from({ length: 1100 }, (_, i) => `--b\r\nContent-Type: text/plain\r\n\r\npart ${i}\r\n`).join('');
  const raw = `From: x@elsewhere.example\r\nTo: ${alias.address}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n${parts}--b--\r\n`;
  await assert.rejects(smtpSend(app, { envelope: { from: 'x@elsewhere.example', to: [alias.address] }, raw }), (e) => e.responseCode === 554);
  assert.equal(total(), before);
  assert.equal((await aliasOf(a, alias.id)).refused, 0);

  // A full mailbox: also temporary.
  const tight = await startTestApp({ limits: { mailboxBytes: 2000 } });
  try {
    const t = await setup(tight);
    await smtpSend(tight, { to: t.box.address, subject: 'fills it', text: 'x'.repeat(3000) });
    await assert.rejects(smtpSend(tight, { to: t.box.address, subject: 'x', text: 'x' }), (e) => e.responseCode === 452);
    assert.equal((await mailboxOf(t.account, t.box.mailbox.id)).refused, 0);
  } finally {
    await tight.stop();
  }

  // The whole record of refused mail is this one number. There is no sender and no time.
  const columns = app.db.all('PRAGMA table_info(addresses)').map((c) => c.name);
  assert.ok(columns.includes('refused'));
  assert.deepEqual(columns.filter((c) => /refus|reject|sender|from/.test(c)), ['refused']);
  await assert.rejects(smtpSend(app, { from: 'tracked.sender@watch.example', to: deleted.address, subject: 'x', text: 'x' }), (e) => e.responseCode === 550);
  await a.api.patch(`/api/aliases/${alias.id}`, { enabled: false });
  await assert.rejects(smtpSend(app, { from: 'tracked.sender@watch.example', to: alias.address, subject: 'x', text: 'x' }), (e) => e.responseCode === 550);
  assert.equal((await aliasOf(a, alias.id)).refused, 1);
  app.db.exec('PRAGMA wal_checkpoint(FULL)');
  assert.equal(databaseHas(app, 'tracked.sender'), false);
  assert.equal(databaseHas(app, 'watch.example'), false);
});

// ---- burn ----

test('burn: deletes every message of one address and nothing else', async () => {
  const { account: a, box } = await setup();
  const { account: b } = await setup();
  const second = await newMailbox(a);
  const burned = await newAlias(a, box.mailbox.id);
  const kept = await newAlias(a, box.mailbox.id);
  const gone2 = await newAlias(a, box.mailbox.id);

  // Three incoming messages with an attachment, then the alias moves and gets two more, and it sent one message.
  for (let i = 0; i < 3; i++) await smtpSend(app, { to: burned.address, subject: `burn ${i}`, text: 'x', attachments: [{ filename: 'f.txt', content: 'file' }] });
  await a.api.patch(`/api/aliases/${burned.alias.id}`, { mailboxId: second.mailbox.id });
  for (let i = 3; i < 5; i++) await smtpSend(app, { to: burned.address, subject: `burn ${i}`, text: 'x' });
  const copy = await makeCopy(a, { meta: { subject: 'burn sent' }, body: { text: 'x' }, attachments: [Buffer.from('sent file')] });
  assert.equal((await a.api.post('/api/mail/send', { addressId: burned.alias.id, from: burned.address, to: ['x@elsewhere.example'], subject: 'burn sent', text: 'x', copy })).status, 201);
  // Other mail of the account.
  await smtpSend(app, { to: kept.address, subject: 'keep alias', text: 'x' });
  await smtpSend(app, { to: box.address, subject: 'keep inbox', text: 'x' });
  await smtpSend(app, { to: gone2.address, subject: 'keep deleted alias', text: 'x' });
  await a.api.del(`/api/aliases/${gone2.alias.id}`); // its message has no address id now

  const burnIds = (await listMessages(a, `?addressIds=${burned.alias.id}`)).messages.map((m) => m.id);
  assert.equal(burnIds.length, 6);
  assert.ok(app.db.get(`SELECT COUNT(*) AS n FROM message_parts WHERE message_id IN (${burnIds.map(() => '?').join(',')})`, ...burnIds).n >= 10);

  // A different account, an unknown id, no login.
  assert.equal((await b.api.del(`/api/addresses/${burned.alias.id}/messages`)).status, 404);
  assert.equal((await a.api.del(`/api/addresses/${'Q'.repeat(22)}/messages`)).status, 404);
  assert.equal((await a.api.del('/api/addresses/short/messages')).status, 404);
  assert.equal((await a.api.del(`/api/addresses/${gone2.alias.id}/messages`)).status, 404, 'a deleted alias');
  assert.equal((await client(app).del(`/api/addresses/${burned.alias.id}/messages`)).status, 401);
  assert.equal((await listMessages(a)).messages.length, 9);

  let res;
  const events = await eventsDuring(async () => { res = await a.api.del(`/api/addresses/${burned.alias.id}/messages`); });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { deleted: 6 });
  // The browser is told for both mailboxes that lost messages.
  assert.deepEqual(events.map((e) => `${e[0]} ${e[1]} ${e[2].mailboxId}`).sort(), [`${a.id} mail ${box.mailbox.id}`, `${a.id} mail ${second.mailbox.id}`].sort());

  // Nothing of the address is left: no message, no part, nothing in the write-ahead file, no id in the database file.
  const wal = join(app.config.dataDir, 'accounts.db-wal');
  assert.equal(existsSync(wal) ? statSync(wal).size : 0, 0);
  assert.deepEqual((await listMessages(a, `?addressIds=${burned.alias.id}`)).messages, []);
  assert.equal(app.db.get(`SELECT COUNT(*) AS n FROM message_parts WHERE message_id IN (${burnIds.map(() => '?').join(',')})`, ...burnIds).n, 0);
  for (const id of burnIds) {
    assert.equal((await a.api.get(`/api/messages/${id}`)).status, 404);
    assert.equal(databaseHas(app, id), false);
  }
  // Everything else is still there.
  assert.deepEqual(await subjects(a), ['keep alias', 'keep deleted alias', 'keep inbox']);
  // The alias itself stays and works. Its count of delivered messages is a count of arrivals and stays.
  const after = await aliasOf(a, burned.alias.id);
  assert.equal(after.enabled, true);
  assert.equal(after.received, 5);
  await smtpSend(app, { to: burned.address, subject: 'after the burn', text: 'x' });
  assert.equal((await listMessages(a, `?addressIds=${burned.alias.id}`)).messages.length, 1);

  // A second burn deletes the new message. A third finds nothing and tells nobody.
  assert.deepEqual((await a.api.del(`/api/addresses/${burned.alias.id}/messages`)).data, { deleted: 1 });
  const quiet = await eventsDuring(async () => { res = await a.api.del(`/api/addresses/${burned.alias.id}/messages`); });
  assert.deepEqual(res.data, { deleted: 0 });
  assert.deepEqual(quiet, []);

  // The address of a mailbox can be burned too. Mail of its aliases stays.
  assert.deepEqual((await a.api.del(`/api/addresses/${box.mailbox.addressId}/messages`)).data, { deleted: 1 });
  assert.deepEqual(await subjects(a), ['keep alias', 'keep deleted alias']);
});

test('burn: very many messages', async () => {
  const { account: a, box } = await setup();
  const alias = await newAlias(a, box.mailbox.id);
  const other = await newAlias(a, box.mailbox.id);
  app.db.tx(() => {
    for (let i = 0; i < 1105; i++) {
      const id = `burnbulk${String(i).padStart(14, '0')}`;
      // The last five rows belong to the other alias.
      app.db.run('INSERT INTO messages (id, account_id, mailbox_id, address_id, direction, at, seen, size, attachments, sealed_key, enc_meta) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        id, a.id, box.mailbox.id, i < 1100 ? alias.alias.id : other.alias.id, i % 7 === 0 ? 'out' : 'in', now() - i, 0, 10, 0, Buffer.alloc(4), Buffer.alloc(4));
      app.db.run('INSERT INTO message_parts (message_id, idx, data) VALUES (?,?,?)', id, 0, Buffer.alloc(2));
    }
  });
  assert.deepEqual((await a.api.del(`/api/addresses/${alias.alias.id}/messages`)).data, { deleted: 1100 });
  assert.equal((await mailboxOf(a, box.mailbox.id)).total, 5);
  assert.equal(app.db.get("SELECT COUNT(*) AS n FROM message_parts WHERE message_id LIKE 'burnbulk%'").n, 5);
});
