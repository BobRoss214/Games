// Newsletter data of incoming mail: the "bulk" mark and the email target of "unsubscribe".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { startTestApp, newAccount } from './helpers.js';
import { newMailbox, newAlias, listMessages, openMessage, makeCopy, smtpSend, databaseHas } from './mail-helpers.js';
import { parseListUnsubscribe, listInfo } from '../server/mail/listinfo.js';

let app;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

const NOTHING = { mailto: null, subject: null, hasLink: false };
const read = (value) => parseListUnsubscribe(value);

// ---- the header parser ----

test('List-Unsubscribe: the usual forms', () => {
  assert.deepEqual(read('<mailto:leave@list.example?subject=unsubscribe>, <https://list.example/leave?u=1>'),
    { mailto: 'leave@list.example', subject: 'unsubscribe', hasLink: true });
  assert.deepEqual(read('<mailto:leave@list.example>'), { mailto: 'leave@list.example', subject: null, hasLink: false });
  assert.deepEqual(read('<https://list.example/leave?u=1>'), { mailto: null, subject: null, hasLink: true });
  assert.deepEqual(read('<http://list.example/leave>'), { mailto: null, subject: null, hasLink: true });
  // The order of the targets makes no difference.
  assert.deepEqual(read('<https://list.example/leave>,<mailto:leave@list.example?subject=bye>'), { mailto: 'leave@list.example', subject: 'bye', hasLink: true });
  // Upper case, spaces in the brackets, a comment after the target.
  assert.deepEqual(read('<MAILTO:Leave@List.Example?Subject=Stop>'), { mailto: 'leave@list.example', subject: 'Stop', hasLink: false });
  assert.deepEqual(read('  < mailto:leave@list.example >  (send an empty message) , < HTTPS://list.example/x >'), { mailto: 'leave@list.example', subject: null, hasLink: true });
  // A long header continues on the next line.
  assert.deepEqual(read('<mailto:leave@list.example?subject=bye>,\r\n\t<https://list.example/a/very/long/link>'), { mailto: 'leave@list.example', subject: 'bye', hasLink: true });
  assert.deepEqual(read('<mailto:leave@list.example\r\n ?subject=bye>'), { mailto: 'leave@list.example', subject: 'bye', hasLink: false });
  // The result has these three values and no others.
  assert.deepEqual(Object.keys(read('<mailto:leave@list.example?subject=a&body=b&cc=c@d.example>')).sort(), ['hasLink', 'mailto', 'subject']);
});

test('List-Unsubscribe: several targets, the first valid email target is used', () => {
  assert.deepEqual(read('<https://a.example/x>, <mailto:first@list.example>, <mailto:second@list.example?subject=two>, <https://b.example/y>'),
    { mailto: 'first@list.example', subject: null, hasLink: true });
  // Targets that are no valid address are passed over. The subject comes from the target that is used.
  assert.deepEqual(read('<mailto:not an address?subject=one>, <mailto:@nothing.example?subject=two>, <mailto:good@list.example?subject=three>'),
    { mailto: 'good@list.example', subject: 'three', hasLink: false });
  assert.deepEqual(read('<mailto:?subject=one>, <mailto:>, <mailto:a@b>, <mailto:a@-bad-.example>, <mailto:x..y@list.example>'), NOTHING);
  // One target with several addresses: the first address.
  assert.deepEqual(read('<mailto:a@list.example,b@list.example?subject=x>'), { mailto: 'a@list.example', subject: 'x', hasLink: false });
  assert.deepEqual(read('<mailto:a@list.example%2Cb@list.example>'), { mailto: 'a@list.example', subject: null, hasLink: false });
  // Only the first ten targets are read.
  assert.deepEqual(read(`${'<x:1>, '.repeat(9)}<mailto:tenth@list.example>, <https://list.example/eleventh>`), { mailto: 'tenth@list.example', subject: null, hasLink: false });
  assert.deepEqual(read(`${'<x:1>, '.repeat(10)}<mailto:late@list.example>`), NOTHING);
  // Other kinds of target are not used and are no "link".
  for (const other of ['<ftp://list.example/x>', '<javascript:alert(1)>', '<tel:+15551234567>', '<data:text/html,x>', '<//list.example/x>', '<file:///etc/passwd>', '<list.example/leave>', '<leave@list.example>']) {
    assert.deepEqual(read(other), NOTHING, other);
  }
});

test('List-Unsubscribe: no angle brackets', () => {
  assert.deepEqual(read('mailto:leave@list.example?subject=bye, https://list.example/leave'), { mailto: 'leave@list.example', subject: 'bye', hasLink: true });
  assert.deepEqual(read('mailto:leave@list.example'), { mailto: 'leave@list.example', subject: null, hasLink: false });
  assert.deepEqual(read('https://list.example/leave'), { mailto: null, subject: null, hasLink: true });
  assert.deepEqual(read('leave@list.example'), NOTHING);
  // Brackets that do not close are no brackets.
  assert.deepEqual(read('<mailto:leave@list.example'), NOTHING);
  assert.deepEqual(read('mailto:leave@list.example>'), NOTHING);
});

test('List-Unsubscribe: encoded text in the address and in the subject', () => {
  assert.deepEqual(read('<mailto:leave@list.example?subject=Unsubscribe%20me%20%231234%20%C3%A4%E2%82%AC>'),
    { mailto: 'leave@list.example', subject: 'Unsubscribe me #1234 ä€', hasLink: false });
  // Spaces that the sender did not encode stay in the subject.
  assert.equal(read('<mailto:leave@list.example?subject=please remove me>').subject, 'please remove me');
  // "+" is a plus sign in an email target, not a space.
  assert.equal(read('<mailto:leave@list.example?subject=a+b>').subject, 'a+b');
  assert.equal(read('<mailto:leave%40list.example?subject=x>').mailto, 'leave@list.example');
  assert.equal(read('<mailto:leave%2Bid-123=abc@list.example>').mailto, 'leave+id-123=abc@list.example');
  assert.equal(read('<mailto:leave+id-123@list.example?%73ubject=x>').subject, 'x');

  // The subject is found between other values. The other values are not used.
  assert.deepEqual(read('<mailto:leave@list.example?body=remove%20me&subject=stop&cc=other@x.example>'), { mailto: 'leave@list.example', subject: 'stop', hasLink: false });
  assert.equal(read('<mailto:leave@list.example?body=remove%20me>').subject, null);
  assert.equal(read('<mailto:leave@list.example?subject=first&subject=second>').subject, 'first');
  assert.equal(read('<mailto:leave@list.example?subject=a=b=c>').subject, 'a=b=c');
  for (const empty of ['?', '?subject', '?subject=', '?subject=%20%20', '?subject=%0D%0A', '?=x', '?&&&']) {
    assert.deepEqual(read(`<mailto:leave@list.example${empty}>`), { mailto: 'leave@list.example', subject: null, hasLink: false }, empty);
  }

  // The subject becomes the subject of a message. A line break in it could add a header line.
  const sneaky = read('<mailto:leave@list.example?subject=hi%0D%0ABcc:%20victim@x.example%0Ax%00y%1Bz%7F>').subject;
  assert.equal(sneaky, 'hi Bcc: victim@x.example x y z');
  const separators = read('<mailto:leave@list.example?subject=a%E2%80%A8b%E2%80%A9c%C2%85d>').subject;
  assert.equal(separators, 'a b c d');
  for (const text of [sneaky, separators]) {
    for (const ch of text) assert.ok(ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f && ch.charCodeAt(0) !== 0x2028 && ch.charCodeAt(0) !== 0x2029);
  }
  // A line break in the address makes the target not valid.
  assert.deepEqual(read('<mailto:leave@list.example%0D%0ABcc:victim@x.example>'), NOTHING);
  assert.deepEqual(read('<mailto:leave@list.example%00>'), NOTHING);

  // Text that is not well formed is not decoded.
  assert.equal(read('<mailto:leave@list.example?subject=100%>').subject, '100%');
  assert.equal(read('<mailto:leave@list.example?subject=%ZZ%20x>').subject, '%ZZ%20x');
  assert.deepEqual(read('<mailto:le%ave@list.example>'), NOTHING);

  // Lengths have a limit.
  assert.equal(read(`<mailto:leave@list.example?subject=${'s'.repeat(500)}>`).subject, 's'.repeat(200));
  assert.equal(read(`<mailto:leave@list.example?subject=${'%C3%A4'.repeat(150)}>`).subject, 'ä'.repeat(150));
  assert.deepEqual(read(`<mailto:${'a'.repeat(64)}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.example>`), NOTHING, 'an address of more than 254 characters');
  assert.deepEqual(read(`<mailto:${'a'.repeat(65)}@list.example>`), NOTHING, 'a name of more than 64 characters');
});

test('List-Unsubscribe: junk input gives an empty result, fast', () => {
  for (const junk of ['', ' ', ',', ',,,,', '<>', '<<<<>>>>', '< >', '<,>', '?', 'mailto:', 'mailto', 'https://', '<https://>', '<http:///x>', '<https://?x=1>', '<mailto:>', '<mailto:?>', '<mailto:@>', '\u0000\u0001\u0002', '\r\n', '<\r\n>', 'unsubscribe', '%', '%%%', '<%00>', 'null', '{}', '[object Object]']) {
    assert.deepEqual(read(junk), NOTHING, JSON.stringify(junk));
  }
  for (const notText of [null, undefined, 0, 42, true, {}, [], ['<mailto:a@list.example>'], { toString: () => '<mailto:a@list.example>' }, Symbol('x'), () => '<mailto:a@list.example>']) {
    assert.deepEqual(read(notText), NOTHING);
  }
  // Very long input from a stranger. Only the start of the header is read.
  const long = [
    '<'.repeat(200000), '>'.repeat(200000), ','.repeat(200000), '<>'.repeat(100000), '<mailto:'.repeat(50000), 'mailto:a@list.example?'.repeat(20000),
    `<mailto:a@list.example?${'subject=x&'.repeat(50000)}>`, `<mailto:a@list.example?${'&'.repeat(200000)}>`, `<mailto:${'a@'.repeat(100000)}list.example>`,
    `<mailto:a@list.example?subject=${'%'.repeat(200000)}>`, `<${'a'.repeat(200000)}`, `${'<mailto:a@b.example?subject='.repeat(40)}${'%0A'.repeat(60000)}`,
    ' '.repeat(200000), '\r\n '.repeat(60000), `${'<x:1>,'.repeat(50000)}<mailto:a@list.example>`,
  ];
  const start = process.hrtime.bigint();
  for (const text of long) {
    const result = read(text);
    assert.deepEqual(Object.keys(result).sort(), ['hasLink', 'mailto', 'subject']);
    assert.ok(result.mailto === null || result.mailto === 'a@list.example');
    assert.ok(result.subject === null || result.subject.length <= 200);
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 1000, `${ms} ms`);
  // A target after the first 4,000 characters of the header is not read.
  assert.deepEqual(read(`${' '.repeat(4000)}<mailto:a@list.example>`), NOTHING);
  assert.equal(read(`${' '.repeat(3000)}<mailto:a@list.example>`).mailto, 'a@list.example');
});

test('listInfo: which headers make a message "bulk"', () => {
  const mail = (...lines) => ({ headerLines: lines.map((line) => ({ key: line.slice(0, line.indexOf(':')).toLowerCase(), line })) });
  assert.deepEqual(listInfo(mail('Subject: hello', 'From: a@b.example')), { bulk: false, unsubscribe: null });
  assert.deepEqual(listInfo(mail('List-Id: News <news.list.example>')), { bulk: true, unsubscribe: null });
  assert.deepEqual(listInfo(mail('List-ID:')), { bulk: true, unsubscribe: null });
  for (const value of ['bulk', 'list', 'Bulk', 'LIST', '  bulk  ']) assert.equal(listInfo(mail(`Precedence: ${value}`)).bulk, true, value);
  for (const value of ['', 'first-class', 'special-delivery', 'normal', 'bulky', 'not bulk', 'junk']) assert.equal(listInfo(mail(`Precedence: ${value}`)).bulk, false, value);
  assert.deepEqual(listInfo(mail('List-Unsubscribe: <mailto:leave@list.example>')), { bulk: true, unsubscribe: { mailto: 'leave@list.example', subject: null, hasLink: false } });
  // A header that says nothing useful still shows that the sender is a list.
  assert.deepEqual(listInfo(mail('List-Unsubscribe:')), { bulk: true, unsubscribe: NOTHING });
  assert.deepEqual(listInfo(mail('List-Unsubscribe: call us')), { bulk: true, unsubscribe: NOTHING });
  // Two headers with this name: the first one is read.
  assert.equal(listInfo(mail('List-Unsubscribe: <mailto:one@list.example>', 'List-Unsubscribe: <mailto:two@list.example>')).unsubscribe.mailto, 'one@list.example');
  // Headers with similar names are not read.
  assert.deepEqual(listInfo(mail('List-Unsubscribe-Post: List-Unsubscribe=One-Click', 'List-Help: <https://list.example>', 'X-List-Unsubscribe: <mailto:a@list.example>', 'List-Post: <mailto:post@list.example>')), { bulk: false, unsubscribe: null });
  // A parsed message without header lines.
  for (const odd of [{}, { headerLines: null }, { headerLines: [] }, { headerLines: [{ key: 'list-unsubscribe' }] }, { headerLines: [{ key: 'list-unsubscribe', line: 42 }] }]) {
    assert.deepEqual(listInfo(odd), { bulk: false, unsubscribe: null });
  }
});

// ---- from the SMTP port to the browser ----

const seen = new Set();
// Sends a message with these extra header lines and opens it as the browser does.
async function deliver(account, to, headers) {
  const raw = `From: News <news@list.example>\r\nTo: ${to}\r\nSubject: news\r\n${headers.map((h) => `${h}\r\n`).join('')}MIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nHello\r\n`;
  await smtpSend(app, { envelope: { from: 'bounce-5521@bounces.list.example', to: [to] }, raw });
  const fresh = (await listMessages(account)).messages.filter((m) => !seen.has(m.id));
  assert.equal(fresh.length, 1);
  seen.add(fresh[0].id);
  return openMessage(account, fresh[0].id);
}

test('incoming mail: "bulk" and "unsubscribe" are in the sealed envelope and nowhere else', async () => {
  const a = await newAccount(app, { credits: 300 });
  const box = await newMailbox(a);
  const alias = await newAlias(a, box.mailbox.id);

  // A normal message from a person.
  let m = await deliver(a, alias.address, []);
  assert.equal(m.meta.bulk, false);
  assert.equal(m.body.unsubscribe, null);

  // A newsletter with both kinds of target.
  m = await deliver(a, alias.address, [
    'List-Id: Weekly News <weekly.list.example>',
    'List-Unsubscribe: <mailto:leave-7781@list.example?subject=unsubscribe%20user%207781>,\r\n <https://list.example/leave?token=tok7781secret>',
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
  ]);
  assert.equal(m.meta.bulk, true);
  assert.deepEqual(m.body.unsubscribe, { mailto: 'leave-7781@list.example', subject: 'unsubscribe user 7781', hasLink: true });
  // The web link itself is not kept, not even inside the envelope.
  assert.ok(!JSON.stringify(m.body.unsubscribe).includes('tok7781secret'));
  assert.ok(!JSON.stringify(m.meta).includes('tok7781secret'));

  // Only a web link: the browser can say that an email target is missing.
  m = await deliver(a, alias.address, ['List-Unsubscribe: <https://list.example/leave?token=tok7781secret>']);
  assert.equal(m.meta.bulk, true);
  assert.deepEqual(m.body.unsubscribe, { mailto: null, subject: null, hasLink: true });

  // Only List-Id, only Precedence.
  m = await deliver(a, alias.address, ['List-Id: <weekly.list.example>']);
  assert.deepEqual([m.meta.bulk, m.body.unsubscribe], [true, null]);
  m = await deliver(a, alias.address, ['Precedence: bulk']);
  assert.deepEqual([m.meta.bulk, m.body.unsubscribe], [true, null]);
  m = await deliver(a, alias.address, ['precedence: List']);
  assert.deepEqual([m.meta.bulk, m.body.unsubscribe], [true, null]);
  m = await deliver(a, alias.address, ['Precedence: first-class', 'X-Mailer: bulk list sender', 'List-Help: <https://list.example/help>']);
  assert.deepEqual([m.meta.bulk, m.body.unsubscribe], [false, null]);

  // Junk in the header, and a header that tries to add a line to the subject.
  m = await deliver(a, alias.address, ['List-Unsubscribe: <<<>>>, ???, <mailto:nobody>']);
  assert.deepEqual([m.meta.bulk, m.body.unsubscribe], [true, NOTHING]);
  m = await deliver(a, alias.address, ['List-Unsubscribe: <mailto:leave-7781@list.example?subject=x%0D%0ABcc:%20victim@x.example>']);
  assert.deepEqual(m.body.unsubscribe, { mailto: 'leave-7781@list.example', subject: 'x Bcc: victim@x.example', hasLink: false });
  // Two headers: the first one counts.
  m = await deliver(a, alias.address, ['List-Unsubscribe: <mailto:one-7781@list.example>', 'List-Unsubscribe: <mailto:two-7781@list.example>']);
  assert.equal(m.body.unsubscribe.mailto, 'one-7781@list.example');

  // A message for the inbox address, and a message through the development route.
  m = await deliver(a, box.address, ['List-Unsubscribe: <mailto:leave-7781@list.example>']);
  assert.deepEqual([m.meta.bulk, m.body.unsubscribe], [true, { mailto: 'leave-7781@list.example', subject: null, hasLink: false }]);
  assert.equal((await a.api.post('/api/dev/inbound-mail', { to: alias.address, subject: 'dev', text: 'x' })).status, 204);
  const dev = (await listMessages(a)).messages.find((x) => !seen.has(x.id));
  const opened = await openMessage(a, dev.id);
  assert.deepEqual([opened.meta.bulk, opened.body.unsubscribe], [false, null]);

  // The list view tells nothing about newsletters: the server cannot see the mark.
  for (const item of (await listMessages(a)).messages) {
    assert.deepEqual(Object.keys(item).filter((k) => /bulk|unsub|list/i.test(k)), []);
  }
  // Nothing of the header is readable in the database.
  app.db.exec('PRAGMA wal_checkpoint(FULL)');
  for (const text of ['leave-7781', 'one-7781', 'list.example', 'tok7781secret', 'unsubscribe', 'Unsubscribe', 'weekly', 'bounce-5521', 'mailto:']) {
    assert.equal(databaseHas(app, text), false, text);
  }
  const columns = ['addresses', 'messages', 'message_parts', 'mailboxes'].flatMap((t) => app.db.all(`PRAGMA table_info(${t})`).map((c) => c.name));
  assert.deepEqual(columns.filter((c) => /bulk|unsub|list|precedence/i.test(c)), []);
});

test('unsubscribe is a normal message through the send route; the server opens no web link', async () => {
  const a = await newAccount(app, { credits: 300 });
  const box = await newMailbox(a);
  const alias = await newAlias(a, box.mailbox.id);
  const m = await deliver(a, alias.address, ['List-Unsubscribe: <mailto:leave-9902@list.example?subject=unsubscribe%209902>, <https://list.example/leave>']);
  const target = m.body.unsubscribe;

  // What the web app does with the two values: a message from the alias to the address of the list.
  const copy = await makeCopy(a, { meta: { subject: target.subject }, body: { text: '' } });
  const res = await a.api.post('/api/mail/send', { addressId: alias.alias.id, from: alias.address, to: [target.mailto], subject: target.subject, text: 'unsubscribe', copy });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const outbox = (await a.api.get('/api/dev/outbox')).data.mail;
  assert.deepEqual(outbox.map((x) => [x.from, x.to, x.subject]), [[alias.address, ['leave-9902@list.example'], 'unsubscribe 9902']]);

  // There is no route for unsubscribe, and no code in the mail module that can open a web address.
  for (const path of ['/api/unsubscribe', `/api/messages/${m.message.id}/unsubscribe`]) {
    assert.equal((await a.api.post(path, {})).status, 404, path);
  }
  const dir = new URL('../server/mail/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    assert.ok(!/\bfetch\s*\(|node:https?['"]|from ['"]https?['"]|node:http2|undici/.test(source), `${file} must not make web requests`);
  }
});
