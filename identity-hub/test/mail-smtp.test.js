import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { startTestApp, newAccount, unb64u } from './helpers.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newMailbox, newAlias, listMessages, smtpSend, openMessage, databaseHas, smtpTalk, smtpCertificate } from './mail-helpers.js';
import * as C from '../shared/crypto.js';

let app;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

test('smtp: greeting shows no software version; no login; size is announced', async () => {
  assert.ok(Number.isInteger(app.services.mail.smtpPort) && app.services.mail.smtpPort > 0);
  const replies = await smtpTalk(app, ['EHLO mx.sender.example', 'QUIT']);
  assert.match(replies[0], /^220 \S+ ESMTP ready$/);
  assert.doesNotMatch(replies[0], /\d+\.\d+|smtp-server|node/i);
  assert.match(replies[1], new RegExp(`SIZE ${app.config.mail.maxMessageBytes}`));
  assert.doesNotMatch(replies[1], /AUTH/);
  // The server is no relay and has no login.
  const auth = await smtpTalk(app, ['EHLO mx.sender.example', 'AUTH PLAIN AGEAYg==', 'QUIT']);
  assert.match(auth[2], /^5\d\d /);
});

test('smtp: a real message is stored encrypted and the account can open it', async () => {
  const a = await newAccount(app, { credits: 500 });
  const { mailbox } = await newMailbox(a, { localPart: 'reader.one' });
  const { alias, address } = await newAlias(a, mailbox.id);
  const pdf = randomBytes(5000);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

  const events = [];
  const publish = app.events.publish;
  app.events.publish = (...args) => { events.push(args); return publish(...args); };
  let info;
  try {
    info = await smtpSend(app, {
      from: '"Shop Xavier" <orders@shop.example>',
      to: `Reader <${address}>`,
      cc: 'Other Person <other@elsewhere.example>',
      replyTo: 'help@shop.example',
      subject: 'Your order №42 is on the way',
      text: 'Hello reader,\n\n   your   order\tis on the way.\n\nThe secret word is marzipan-7731.\n',
      html: '<html><head><style>p { color: red }</style></head><body><p>Hello <b>reader</b>, the secret word is marzipan-7731.</p><img src="cid:logo@shop"></body></html>',
      inReplyTo: '<question-1@postern.test>',
      references: ['<root-0@postern.test>', '<question-1@postern.test>'],
      attachments: [
        { filename: 'invoice.pdf', contentType: 'application/pdf', content: pdf },
        { filename: 'logo.png', contentType: 'image/png', content: png, cid: 'logo@shop' },
      ],
    });
  } finally {
    app.events.publish = publish;
  }
  assert.deepEqual(info.accepted, [address]);
  assert.match(info.response, /^250 /);

  // The browser is told that mail arrived, without content.
  assert.deepEqual(events, [[a.id, 'mail', { mailboxId: mailbox.id }]]);

  const { messages, more } = await listMessages(a);
  assert.equal(more, false);
  assert.equal(messages.length, 1);
  const m = messages[0];
  assert.deepEqual(Object.keys(m).sort(), ['addressId', 'at', 'attachments', 'direction', 'encMeta', 'id', 'mailboxId', 'seen', 'sealedKey', 'size'].sort());
  assert.equal(m.mailboxId, mailbox.id);
  assert.equal(m.addressId, alias.id);
  assert.equal(m.direction, 'in');
  assert.equal(m.seen, false);
  assert.equal(m.attachments, 2);
  assert.ok(Math.abs(m.at - Date.now() / 1000) < 10);
  assert.ok(m.size > 5000);

  const opened = await openMessage(a, m.id);
  const { meta, body } = opened;
  assert.deepEqual(meta.from, { name: 'Shop Xavier', address: 'orders@shop.example' });
  assert.deepEqual(meta.to, [{ name: 'Reader', address }]);
  assert.deepEqual(meta.cc, [{ name: 'Other Person', address: 'other@elsewhere.example' }]);
  assert.equal(meta.subject, 'Your order №42 is on the way');
  assert.equal(meta.deliveredTo, address);
  assert.equal(meta.snippet, 'Hello reader, your order is on the way. The secret word is marzipan-7731.');
  assert.ok(!Number.isNaN(Date.parse(meta.date)));
  // The order is the order of the parts in the message: the inline image is inside the HTML part.
  assert.deepEqual(meta.attachments, [
    { filename: 'logo.png', contentType: 'image/png', size: png.length, cid: 'logo@shop' },
    { filename: 'invoice.pdf', contentType: 'application/pdf', size: 5000 },
  ]);
  assert.equal(body.text.trim(), 'Hello reader,\n\n   your   order\tis on the way.\n\nThe secret word is marzipan-7731.');
  assert.match(body.html, /<p>Hello <b>reader<\/b>, the secret word is marzipan-7731\.<\/p>/);
  assert.match(body.html, /src="cid:logo@shop"/); // inline images stay links to attachments
  assert.equal(body.messageId, info.messageId);
  assert.equal(body.inReplyTo, '<question-1@postern.test>');
  assert.deepEqual(body.references, ['<root-0@postern.test>', '<question-1@postern.test>']);
  assert.deepEqual(body.replyTo, [{ name: '', address: 'help@shop.example' }]);
  assert.deepEqual(await opened.attachment(1), png);
  assert.deepEqual(await opened.attachment(2), pdf);
  // A part opens only with its own index: parts cannot be swapped.
  const second = await a.api.get(`/api/messages/${m.id}/parts/2`);
  await assert.rejects(C.openAttachment(opened.key, new Uint8Array(second.data), 1));
  assert.equal((await a.api.get(`/api/messages/${m.id}/parts/3`)).status, 404);
  assert.equal((await a.api.get(`/api/messages/${m.id}/parts/0`)).status, 404);
  assert.equal((await a.api.get(`/api/messages/${m.id}/parts/x`)).status, 404);

  // Counters.
  const aliases = (await a.api.get('/api/aliases')).data.aliases;
  assert.equal(aliases.find((x) => x.id === alias.id).received, 1);
  const box = (await a.api.get('/api/mailboxes')).data.mailboxes[0];
  assert.equal(box.unread, 1);
  assert.equal(box.total, 1);

  // Nothing readable is on disk: no address, no subject, no text, no file name, no sender.
  for (const plain of [address, 'reader.one@postern.test', 'marzipan-7731', 'Your order', 'invoice.pdf', 'orders@shop.example', 'Shop Xavier']) {
    assert.equal(databaseHas(app, plain), false, `"${plain}" must not be in the database`);
  }
  assert.equal(databaseHas(app, a.id), true); // the check itself works
});

test('smtp: one message to two accounts; each account opens only its own copy', async () => {
  const a = await newAccount(app, { credits: 500 });
  const b = await newAccount(app, { credits: 500 });
  const boxA = await newMailbox(a);
  const boxB = await newMailbox(b);
  const info = await smtpSend(app, { to: [boxA.address, boxB.address], subject: 'For both', text: 'Shared news' });
  assert.deepEqual(info.accepted.sort(), [boxA.address, boxB.address].sort());

  const listA = (await listMessages(a)).messages;
  const listB = (await listMessages(b)).messages;
  assert.equal(listA.length, 1);
  assert.equal(listB.length, 1);
  assert.notEqual(listA[0].id, listB[0].id);
  const openA = await openMessage(a, listA[0].id);
  const openB = await openMessage(b, listB[0].id);
  assert.equal(openA.meta.subject, 'For both');
  assert.equal(openA.meta.deliveredTo, boxA.address);
  assert.equal(openB.meta.deliveredTo, boxB.address);
  assert.equal(openB.body.text.trim(), 'Shared news');

  // B cannot read the message of A: not over HTTP and not with its keys.
  assert.equal((await b.api.get(`/api/messages/${listA[0].id}`)).status, 404);
  await assert.rejects(C.openContentKey(b.keys, unb64u(listA[0].sealedKey)));
  assert.notEqual(listA[0].sealedKey, listB[0].sealedKey);
});

test('smtp: unknown recipients get 550; the server is not a relay', async () => {
  const a = await newAccount(app, { credits: 500 });
  const { address } = await newMailbox(a);

  await assert.rejects(smtpSend(app, { to: 'nobody.here999@postern.test', subject: 'x', text: 'x' }), (e) => e.responseCode === 550 && /5\.1\.1/.test(e.response));
  await assert.rejects(smtpSend(app, { to: 'someone@gmail.example', subject: 'x', text: 'x' }), (e) => e.responseCode === 550);

  // A mix: the known address gets the message, the unknown one is refused.
  const info = await smtpSend(app, { to: [address, 'ghost.address000@postern.test'], subject: 'Mixed', text: 'x' });
  assert.deepEqual(info.accepted, [address]);
  assert.deepEqual(info.rejected, ['ghost.address000@postern.test']);
  assert.equal((await listMessages(a)).messages.length, 1);

  // Upper case in the address is accepted. The stored address is lower case.
  await smtpSend(app, { to: address.toUpperCase(), subject: 'Loud', text: 'x' });
  const list = (await listMessages(a)).messages;
  assert.equal(list.length, 2);
  assert.equal((await openMessage(a, list[0].id)).meta.deliveredTo, address);

  // Many wrong guesses on one connection end the connection.
  const guesses = Array.from({ length: 12 }, (_, i) => `RCPT TO:<guess${i}.nobody@postern.test>`);
  const replies = await smtpTalk(app, ['EHLO mx.sender.example', 'MAIL FROM:<x@elsewhere.example>', ...guesses, 'QUIT']);
  assert.ok(replies.slice(3, 13).every((r) => r.startsWith('550 5.1.1')));
  assert.ok(replies.some((r) => r.startsWith('421 ')));
});

test('smtp: a disabled alias refuses mail; an enabled alias accepts it again', async () => {
  const a = await newAccount(app, { credits: 500 });
  const { mailbox } = await newMailbox(a);
  const { alias, address } = await newAlias(a, mailbox.id);
  await smtpSend(app, { to: address, subject: 'one', text: 'x' });

  assert.equal((await a.api.patch(`/api/aliases/${alias.id}`, { enabled: false })).data.alias.enabled, false);
  await assert.rejects(smtpSend(app, { to: address, subject: 'two', text: 'x' }), (e) => e.responseCode === 550);

  assert.equal((await a.api.patch(`/api/aliases/${alias.id}`, { enabled: true })).data.alias.enabled, true);
  await smtpSend(app, { to: address, subject: 'three', text: 'x' });

  const list = (await listMessages(a)).messages;
  assert.equal(list.length, 2);
  assert.equal((await a.api.get('/api/aliases')).data.aliases[0].received, 2);

  // After the alias is deleted the address is gone, but the messages stay.
  assert.equal((await a.api.del(`/api/aliases/${alias.id}`)).status, 204);
  await assert.rejects(smtpSend(app, { to: address, subject: 'four', text: 'x' }), (e) => e.responseCode === 550);
  const kept = (await listMessages(a)).messages;
  assert.equal(kept.length, 2);
  assert.deepEqual(kept.map((m) => m.addressId), [null, null]);
  assert.equal((await openMessage(a, kept[0].id)).meta.deliveredTo, address);
});

test('smtp: HTML-only mail gets a preview; a message with almost nothing in it is stored', async () => {
  const a = await newAccount(app, { credits: 500 });
  const { address } = await newMailbox(a);
  await smtpSend(app, {
    to: address, subject: 'Newsletter',
    html: '<!-- hidden --><style>.a{}</style><script>alert(1)</script><div>Big &amp; small&nbsp;news <i>today</i></div>',
  });
  // No subject, no body, no From name, a group in To.
  await smtpSend(app, { from: 'bare@elsewhere.example', to: address, envelope: { from: '', to: [address] }, headers: { 'X-Odd': 'ü'.repeat(200) } });

  const list = (await listMessages(a)).messages;
  assert.equal(list.length, 2);
  const html = await openMessage(a, list.find((m) => m.size === Math.max(...list.map((x) => x.size))).id);
  assert.equal(html.meta.subject, 'Newsletter');
  assert.equal(html.meta.snippet, 'Big & small news today');
  assert.match(html.body.html, /<script>alert\(1\)<\/script>/); // stored as it came; the browser shows it in a sandbox
  assert.equal(html.body.text, ''); // the server makes no text from HTML; the preview is enough

  const empty = await openMessage(a, list.find((m) => m.id !== html.message.id).id);
  assert.equal(empty.meta.subject, '');
  assert.equal(empty.meta.snippet, '');
  assert.deepEqual(empty.meta.from, { name: '', address: 'bare@elsewhere.example' });
  assert.equal(empty.body.html, null);
  assert.equal(empty.body.text.trim(), '');
  assert.deepEqual(empty.meta.attachments, []);
});

test('smtp: a message over the size limit gets 552 and is not stored', async () => {
  const small = await startTestApp({ mail: { maxMessageBytes: 64 * 1024 } });
  try {
    const a = await newAccount(small, { credits: 500 });
    const { address } = await newMailbox(a);
    await assert.rejects(
      smtpSend(small, { to: address, subject: 'Huge', text: 'x', attachments: [{ filename: 'big.bin', content: randomBytes(200 * 1024) }] }),
      (e) => e.responseCode === 552,
    );
    assert.equal((await listMessages(a)).messages.length, 0);
    // A message under the limit still works on the same server.
    await smtpSend(small, { to: address, subject: 'Small', text: 'x', attachments: [{ filename: 'ok.bin', content: randomBytes(20 * 1024) }] });
    assert.equal((await listMessages(a)).messages.length, 1);
  } finally {
    await small.stop();
  }
});

test('smtp: a full mailbox answers 452', async () => {
  const tight = await startTestApp({ limits: { mailboxBytes: 3000 } });
  try {
    const a = await newAccount(tight, { credits: 500 });
    const { address } = await newMailbox(a);
    await smtpSend(tight, { to: address, subject: 'fits', text: 'x'.repeat(4000) });
    await assert.rejects(smtpSend(tight, { to: address, subject: 'no room', text: 'x' }), (e) => e.responseCode === 452 && /4\.2\.2/.test(e.response));
    const list = (await listMessages(a)).messages;
    assert.equal(list.length, 1);
    // Room comes back when the user deletes mail.
    assert.equal((await a.api.del(`/api/messages/${list[0].id}`)).status, 204);
    await smtpSend(tight, { to: address, subject: 'room again', text: 'x' });
  } finally {
    await tight.stop();
  }
});

test('smtp: suspended mailbox answers 450 and comes back after renewal', async () => {
  const a = await newAccount(app, { credits: 100 }); // pays for the first month only
  const { mailbox, address } = await newMailbox(a);
  const { address: aliasAddress } = await newAlias(a, mailbox.id);
  await smtpSend(app, { to: address, subject: 'before', text: 'x' });

  app.db.run('UPDATE mailboxes SET paid_until = ? WHERE id = ?', Math.floor(Date.now() / 1000) - 10, mailbox.id);
  await app.runJobs('renew');
  assert.equal((await a.api.get('/api/mailboxes')).data.mailboxes[0].status, 'suspended');

  for (const to of [address, aliasAddress]) {
    await assert.rejects(smtpSend(app, { to, subject: 'during', text: 'x' }), (e) => e.responseCode === 450 && /4\.2\.1/.test(e.response));
  }
  // A suspended mailbox is still readable.
  assert.equal((await listMessages(a)).messages.length, 1);

  app.store.credit(a.id, 100, 'topup');
  await app.renewables.run(a.id);
  assert.equal((await a.api.get('/api/mailboxes')).data.mailboxes[0].status, 'active');
  await smtpSend(app, { to: aliasAddress, subject: 'after', text: 'x' });
  assert.equal((await listMessages(a)).messages.length, 2);
});

test('smtp: STARTTLS works with the default certificate of the library', async () => {
  const a = await newAccount(app, { credits: 100 });
  const { address } = await newMailbox(a);
  const info = await smtpSend(app, { to: address, subject: 'Over TLS', text: 'encrypted on the way' }, { requireTLS: true, tls: { rejectUnauthorized: false } });
  assert.deepEqual(info.accepted, [address]);
  const list = (await listMessages(a)).messages;
  assert.equal((await openMessage(a, list[0].id)).meta.subject, 'Over TLS');
  assert.match((await smtpCertificate(app)).protocol, /^TLSv1\.[23]$/);
});

// The certificate for this test is made with the openssl program. Without it the test is skipped.
function makeCertificate(dir) {
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '2',
      '-subj', '/CN=mx.postern.test', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('smtp: STARTTLS uses the configured key and certificate', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'postern-tls-'));
  let secured;
  try {
    if (!makeCertificate(dir)) return t.skip('the openssl program is not available');
    secured = await startTestApp({ mail: { tlsKeyFile: join(dir, 'key.pem'), tlsCertFile: join(dir, 'cert.pem') } });
    const shown = await smtpCertificate(secured);
    assert.equal(shown.subject.CN, 'mx.postern.test');
    // The default server shows a different certificate.
    assert.notEqual((await smtpCertificate(app)).fingerprint256, shown.fingerprint256);

    const a = await newAccount(secured, { credits: 100 });
    const { address } = await newMailbox(a);
    await smtpSend(secured, { to: address, subject: 'Own certificate', text: 'x' }, { requireTLS: true, tls: { rejectUnauthorized: false } });
    assert.equal((await listMessages(a)).messages.length, 1);
  } finally {
    if (secured) await secured.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('smtp: one address can hold 10 connections; closed connections are counted off', async () => {
  const greeting = (socket) => new Promise((resolve, reject) => {
    socket.once('data', (d) => resolve(d.toString()));
    socket.once('error', reject);
  });
  const open = () => connect(app.services.mail.smtpPort, '127.0.0.1');
  const closed = (socket) => new Promise((resolve) => { socket.once('close', resolve); socket.destroy(); });

  for (let round = 0; round < 2; round++) {
    const held = [];
    for (let i = 0; i < 10; i++) {
      const socket = open();
      held.push(socket);
      assert.match(await greeting(socket), /^220 /, `connection ${i} of round ${round}`);
    }
    const extra = open();
    assert.match(await greeting(extra), /^421 4\.7\.0 Too many connections/);
    await closed(extra);
    await Promise.all(held.map(closed));
    // The server sees the close a moment later.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // After all that, normal delivery still works.
  const a = await newAccount(app, { credits: 100 });
  const { address } = await newMailbox(a);
  await smtpSend(app, { to: address, subject: 'still open', text: 'x' });
});

test('smtp: a message that the parser refuses gets a final error and is not stored', async () => {
  const a = await newAccount(app, { credits: 100 });
  const { address } = await newMailbox(a);
  // More MIME parts than the parser allows.
  const parts = Array.from({ length: 1100 }, (_, i) => `--b\r\nContent-Type: text/plain\r\n\r\npart ${i}\r\n`).join('');
  const raw = `From: x@elsewhere.example\r\nTo: ${address}\r\nSubject: Too many parts\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n${parts}--b--\r\n`;
  await assert.rejects(smtpSend(app, { envelope: { from: 'x@elsewhere.example', to: [address] }, raw }), (e) => e.responseCode === 554 && /5\.6\.0/.test(e.response));
  await assert.rejects(app.services.mail.deliverLocal({ to: [address], raw: Buffer.from(raw) }), (e) => e.code === 'EPARSE' && !e.message.includes('part'));
  assert.equal((await listMessages(a)).messages.length, 0);
  // The connection limit and the memory count are not stuck after the error.
  await smtpSend(app, { to: address, subject: 'fine', text: 'x' });
  assert.equal((await listMessages(a)).messages.length, 1);
});
