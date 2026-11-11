// Auto-delete of old mail for a mailbox, and an end date for an alias.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startTestApp, client, newAccount, b64u } from './helpers.js';
import { errorCode, newMailbox, newAlias, listMessages, openMessage, makeCopy, smtpSend, databaseHas } from './mail-helpers.js';

let app;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
const mailboxesOf = async (account) => (await account.api.get('/api/mailboxes')).data.mailboxes;
const aliasesOf = async (account) => (await account.api.get('/api/aliases')).data.aliases;
const inject = async (account, to, mail = {}) => {
  const res = await account.api.post('/api/dev/inbound-mail', { to, subject: 'Test', text: 'Hello', ...mail });
  assert.equal(res.status, 204, JSON.stringify(res.data));
};
// Gives every message with this subject an age in days.
async function age(account, days, subject) {
  for (const m of (await listMessages(account, '?limit=100')).messages) {
    if ((await openMessage(account, m.id)).meta.subject === subject) app.db.run('UPDATE messages SET at = ? WHERE id = ?', now() - days * DAY, m.id);
  }
}
const subjects = async (account, query = '') => (await Promise.all((await listMessages(account, query)).messages.map(async (m) => (await openMessage(account, m.id)).meta.subject))).sort();

test('defaults: no auto-delete and no end date', async () => {
  const a = await newAccount(app, { credits: 100 });
  const { mailbox } = await newMailbox(a);
  const { alias } = await newAlias(a, mailbox.id);
  assert.equal(mailbox.retentionDays, null);
  assert.equal(alias.expiresAt, null);
  assert.equal((await mailboxesOf(a))[0].retentionDays, null);
  assert.equal((await aliasesOf(a))[0].expiresAt, null);
  assert.equal(app.db.get('SELECT retention_days FROM mailboxes WHERE id = ?', mailbox.id).retention_days, null);
  assert.equal(app.db.get('SELECT expires_at FROM addresses WHERE id = ?', alias.id).expires_at, null);
});

test('retentionDays: set, change, clear, and bad values', async () => {
  const a = await newAccount(app, { credits: 100 });
  const b = await newAccount(app, { credits: 100 });
  const { mailbox } = await newMailbox(a);
  const patch = (body) => a.api.patch(`/api/mailboxes/${mailbox.id}`, body);

  const set = await patch({ retentionDays: 30 });
  assert.equal(set.status, 200);
  assert.deepEqual(set.data.mailbox, { ...mailbox, retentionDays: 30 });
  assert.equal((await mailboxesOf(a))[0].retentionDays, 30);

  // The label and the setting change together or alone. One does not reset the other.
  const label = b64u(Buffer.alloc(40, 1));
  assert.deepEqual((await patch({ enc: label })).data.mailbox, { ...mailbox, enc: label, retentionDays: 30 });
  assert.deepEqual((await patch({ enc: null, retentionDays: 1 })).data.mailbox, { ...mailbox, enc: null, retentionDays: 1 });
  assert.equal((await patch({ retentionDays: 3650 })).data.mailbox.retentionDays, 3650);

  for (const bad of [0, -1, 3651, 1.5, '7', true, [], {}, 1e12]) {
    const res = await patch({ retentionDays: bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(errorCode(res), 'bad_request');
  }
  assert.equal((await patch({})).status, 400);
  assert.equal((await mailboxesOf(a))[0].retentionDays, 3650, 'a refused value changes nothing');

  // null turns the auto-delete off.
  assert.equal((await patch({ retentionDays: null })).data.mailbox.retentionDays, null);
  assert.equal((await mailboxesOf(a))[0].retentionDays, null);

  // A mailbox of a different account.
  assert.equal((await b.api.patch(`/api/mailboxes/${mailbox.id}`, { retentionDays: 1 })).status, 404);
  assert.equal((await client(app).patch(`/api/mailboxes/${mailbox.id}`, { retentionDays: 1 })).status, 401);
  assert.equal((await mailboxesOf(a))[0].retentionDays, null);
});

test('the job deletes only old messages of mailboxes that have the setting', async () => {
  const a = await newAccount(app, { credits: 400 });
  const b = await newAccount(app, { credits: 200 });
  const cleaned = await newMailbox(a);     // 7 days
  const kept = await newMailbox(a);        // no setting
  const paused = await newMailbox(a);      // 7 days, suspended
  const cleanedB = await newMailbox(b);    // 30 days
  const keptB = await newMailbox(b);       // no setting
  const alias = await newAlias(a, cleaned.mailbox.id);
  await a.api.patch(`/api/mailboxes/${cleaned.mailbox.id}`, { retentionDays: 7 });
  await a.api.patch(`/api/mailboxes/${paused.mailbox.id}`, { retentionDays: 7 });
  await b.api.patch(`/api/mailboxes/${cleanedB.mailbox.id}`, { retentionDays: 30 });

  const file = [{ filename: 'a.txt', content: b64u(Buffer.from('attachment')) }];
  await inject(a, cleaned.address, { subject: 'old', attachments: file });
  await inject(a, alias.address, { subject: 'old' });
  await inject(a, cleaned.address, { subject: 'new', attachments: file });
  await inject(a, kept.address, { subject: 'old' });
  await inject(a, paused.address, { subject: 'old' });
  await inject(a, paused.address, { subject: 'new' });
  await inject(b, cleanedB.address, { subject: 'old' });       // 8 days: younger than 30
  await inject(b, cleanedB.address, { subject: 'very old' });  // 31 days
  await inject(b, keptB.address, { subject: 'very old' });
  // A Sent copy in the mailbox with the setting. It gets old too.
  const copy = await makeCopy(a, { meta: { subject: 'old' }, body: { text: 'sent' }, attachments: [Buffer.from('sent file')] });
  const sent = await a.api.post('/api/mail/send', { addressId: cleaned.mailbox.addressId, from: cleaned.address, to: ['x@elsewhere.example'], subject: 'old', text: 'sent', copy });
  assert.equal(sent.status, 201);

  await age(a, 8, 'old');
  await age(b, 8, 'old');
  await age(b, 31, 'very old');
  app.db.run("UPDATE mailboxes SET status = 'suspended' WHERE id = ?", paused.mailbox.id);

  const oldIds = (await listMessages(a, `?mailboxId=${cleaned.mailbox.id}`)).messages.filter((m) => m.at < now() - 7 * DAY).map((m) => m.id);
  assert.equal(oldIds.length, 3, 'two incoming messages and the Sent copy');
  assert.ok(app.db.get(`SELECT COUNT(*) AS n FROM message_parts WHERE message_id IN (${oldIds.map(() => '?').join(',')})`, ...oldIds).n >= 5);
  const stay = (await listMessages(a, `?mailboxId=${cleaned.mailbox.id}`)).messages.find((m) => !oldIds.includes(m.id));

  const events = [];
  const publish = app.events.publish;
  app.events.publish = (...args) => { events.push(args); return publish(...args); };
  try {
    await app.runJobs('mail-retention');
  } finally {
    app.events.publish = publish;
  }

  // Mailbox with 7 days: the old messages are gone, incoming and sent, with their parts. The new one stays.
  assert.deepEqual(await subjects(a, `?mailboxId=${cleaned.mailbox.id}`), ['new']);
  assert.equal(app.db.get(`SELECT COUNT(*) AS n FROM message_parts WHERE message_id IN (${oldIds.map(() => '?').join(',')})`, ...oldIds).n, 0);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM message_parts WHERE message_id = ?', stay.id).n, 2);
  for (const id of oldIds) assert.equal((await a.api.get(`/api/messages/${id}`)).status, 404);
  assert.equal((await openMessage(a, stay.id)).meta.subject, 'new');
  // Suspended mailbox with the setting: cleaned too.
  assert.deepEqual(await subjects(a, `?mailboxId=${paused.mailbox.id}`), ['new']);
  // Mailboxes without the setting keep everything, however old.
  assert.deepEqual(await subjects(a, `?mailboxId=${kept.mailbox.id}`), ['old']);
  assert.deepEqual(await subjects(b, `?mailboxId=${keptB.mailbox.id}`), ['very old']);
  // 30 days: the message of 8 days stays, the message of 31 days goes.
  assert.deepEqual(await subjects(b, `?mailboxId=${cleanedB.mailbox.id}`), ['old']);

  // The counts follow.
  const boxes = Object.fromEntries((await mailboxesOf(a)).map((m) => [m.id, m]));
  assert.equal(boxes[cleaned.mailbox.id].total, 1);
  assert.equal(boxes[cleaned.mailbox.id].unread, 1);
  assert.equal(boxes[kept.mailbox.id].total, 1);
  assert.equal(boxes[paused.mailbox.id].total, 1);
  // The count of an alias says how many messages arrived. It is not changed by the clean-up.
  assert.equal((await aliasesOf(a))[0].received, 1);

  // The browser is told, for the mailboxes that lost messages only.
  const told = events.map(([accountId, type, extra]) => `${accountId} ${type} ${extra && extra.mailboxId}`).sort();
  assert.deepEqual(told, [`${a.id} mail ${cleaned.mailbox.id}`, `${a.id} mail ${paused.mailbox.id}`, `${b.id} mail ${cleanedB.mailbox.id}`].sort());

  // Deleted data does not stay on disk: the write-ahead file is empty and the ids of the deleted messages are gone.
  const wal = join(app.config.dataDir, 'accounts.db-wal');
  assert.equal(existsSync(wal) ? statSync(wal).size : 0, 0);
  for (const id of oldIds) assert.equal(databaseHas(app, id), false, 'a deleted message id is not in the database file');
  assert.equal(databaseHas(app, stay.id), true);

  // A second run finds nothing and tells nobody.
  events.length = 0;
  app.events.publish = (...args) => { events.push(args); return publish(...args); };
  try {
    await app.runJobs('mail-retention');
  } finally {
    app.events.publish = publish;
  }
  assert.deepEqual(events, []);
  assert.deepEqual(await subjects(a, `?mailboxId=${cleaned.mailbox.id}`), ['new']);

  // After the setting is turned off, old messages stay.
  await a.api.patch(`/api/mailboxes/${cleaned.mailbox.id}`, { retentionDays: null });
  app.db.run('UPDATE messages SET at = ? WHERE id = ?', now() - 400 * DAY, stay.id);
  await app.runJobs('mail-retention');
  assert.deepEqual(await subjects(a, `?mailboxId=${cleaned.mailbox.id}`), ['new']);
});

test('the job handles a mailbox with very many old messages', async () => {
  const a = await newAccount(app, { credits: 100 });
  const { mailbox } = await newMailbox(a);
  await a.api.patch(`/api/mailboxes/${mailbox.id}`, { retentionDays: 2 });
  const old = now() - 3 * DAY;
  app.db.tx(() => {
    for (let i = 0; i < 1203; i++) {
      const id = `bulk${String(i).padStart(18, '0')}`;
      // The last three rows are one hour old and must stay.
      app.db.run('INSERT INTO messages (id, account_id, mailbox_id, address_id, direction, at, seen, size, attachments, sealed_key, enc_meta) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        id, a.id, mailbox.id, mailbox.addressId, 'in', i < 1200 ? old : now() - 3600, 0, 10, 0, Buffer.alloc(4), Buffer.alloc(4));
      app.db.run('INSERT INTO message_parts (message_id, idx, data) VALUES (?,?,?)', id, 0, Buffer.alloc(2));
    }
  });
  assert.equal((await mailboxesOf(a))[0].total, 1203);
  await app.runJobs('mail-retention');
  assert.equal((await mailboxesOf(a))[0].total, 3);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM message_parts p JOIN messages m ON m.id = p.message_id WHERE m.mailbox_id = ?', mailbox.id).n, 3);
  assert.equal(app.db.get("SELECT COUNT(*) AS n FROM message_parts WHERE message_id LIKE 'bulk%'").n, 3);
});

test('expiresAt: set, change, clear, and bad values', async () => {
  const a = await newAccount(app, { credits: 100 });
  const b = await newAccount(app, { credits: 100 });
  const { mailbox } = await newMailbox(a);
  const { alias } = await newAlias(a, mailbox.id);
  const patch = (body) => a.api.patch(`/api/aliases/${alias.id}`, body);

  const inAWeek = now() + 7 * DAY;
  const set = await patch({ expiresAt: inAWeek });
  assert.equal(set.status, 200);
  assert.deepEqual(set.data.alias, { ...alias, expiresAt: inAWeek });
  assert.equal((await aliasesOf(a))[0].expiresAt, inAWeek);

  // Other changes leave the end date alone.
  assert.equal((await patch({ enabled: false })).data.alias.expiresAt, inAWeek);
  assert.deepEqual((await patch({ enabled: true, expiresAt: inAWeek + 60 })).data.alias, { ...alias, expiresAt: inAWeek + 60 });
  // Ten years ahead is the limit.
  assert.equal((await patch({ expiresAt: now() + 3650 * DAY - 5 })).status, 200);

  for (const bad of [0, 1, now() - 1, now(), now() + 3651 * DAY, now() + 0.5, String(inAWeek), true, [], {}, -inAWeek]) {
    const res = await patch({ expiresAt: bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(errorCode(res), 'bad_request');
  }
  assert.equal((await patch({})).status, 400);

  // null removes the end date.
  assert.equal((await patch({ expiresAt: null })).data.alias.expiresAt, null);
  assert.equal((await aliasesOf(a))[0].expiresAt, null);

  // The address of a mailbox has no end date. A different account gets 404.
  assert.equal((await a.api.patch(`/api/aliases/${mailbox.addressId}`, { expiresAt: inAWeek })).status, 404);
  assert.equal((await b.api.patch(`/api/aliases/${alias.id}`, { expiresAt: inAWeek })).status, 404);
  assert.equal((await aliasesOf(a))[0].expiresAt, null);
});

test('an alias after its end date behaves like an alias that is turned off', async () => {
  const a = await newAccount(app, { credits: 100 });
  const b = await newAccount(app, { credits: 100 });
  const { mailbox } = await newMailbox(a);
  const ending = await newAlias(a, mailbox.id);
  const off = await newAlias(a, mailbox.id);
  const boxB = await newMailbox(b);
  await a.api.patch(`/api/aliases/${off.alias.id}`, { enabled: false });
  const sendFrom = (who) => a.api.post('/api/mail/send', { addressId: who.alias.id, from: who.address, to: ['x@elsewhere.example'], subject: 'out', text: 'x' });
  const sendTo = (address) => b.api.post('/api/mail/send', { addressId: boxB.mailbox.addressId, from: boxB.address, to: [address], subject: 'inside', text: 'x' });

  // Before the end date everything works.
  assert.equal((await a.api.patch(`/api/aliases/${ending.alias.id}`, { expiresAt: now() + 3600 })).status, 200);
  await smtpSend(app, { to: ending.address, subject: 'before the end', text: 'x' });
  assert.equal((await sendFrom(ending)).status, 201);
  assert.equal((await sendTo(ending.address)).status, 201);
  assert.equal((await listMessages(a)).messages.length, 2);

  // The time passes.
  app.db.run('UPDATE addresses SET expires_at = ? WHERE id = ?', now() - 1, ending.alias.id);

  // Incoming mail: the same answer as for the alias that is turned off.
  for (const alias of [ending, off]) {
    await assert.rejects(smtpSend(app, { to: alias.address, subject: 'after the end', text: 'x' }), (e) => e.responseCode === 550 && /5\.1\.1/.test(e.response));
  }
  // Sending from it: the same error as for the alias that is turned off.
  const fromEnded = await sendFrom(ending);
  const fromOff = await sendFrom(off);
  assert.equal(fromEnded.status, 409);
  assert.equal(errorCode(fromEnded), 'conflict');
  assert.deepEqual(fromEnded.data, fromOff.data);
  // Mail inside the server, the service, and the development route.
  const toEnded = await sendTo(ending.address);
  assert.equal(toEnded.status, 400);
  assert.equal(toEnded.data.error.message, `This address does not exist: ${ending.address}`);
  assert.equal(toEnded.data.error.message.replace(ending.address, ''), (await sendTo(off.address)).data.error.message.replace(off.address, ''));
  const raw = Buffer.from(`From: x@elsewhere.example\r\nTo: ${ending.address}\r\nSubject: Direct\r\n\r\nx\r\n`);
  assert.deepEqual(await app.services.mail.deliverLocal({ to: [ending.address], raw }), { accepted: [], rejected: [ending.address] });
  assert.equal((await a.api.post('/api/dev/inbound-mail', { to: ending.address })).status, 409);
  assert.equal((await listMessages(a)).messages.length, 2, 'nothing new arrived');

  // The alias is still there. The user sees the end date and can change it.
  const listed = (await aliasesOf(a)).find((x) => x.id === ending.alias.id);
  assert.equal(listed.enabled, true);
  assert.ok(listed.expiresAt < now());
  assert.equal((await openMessage(a, (await listMessages(a)).messages[0].id)).meta.deliveredTo, ending.address);
  // The mailbox and its own address are not affected.
  await smtpSend(app, { to: (await newAlias(a, mailbox.id)).address, subject: 'other alias', text: 'x' });

  // No end date: it works again.
  assert.equal((await a.api.patch(`/api/aliases/${ending.alias.id}`, { expiresAt: null })).data.alias.expiresAt, null);
  await smtpSend(app, { to: ending.address, subject: 'no end date', text: 'x' });
  assert.equal((await sendFrom(ending)).status, 201);

  // A new date in the future: it works too.
  app.db.run('UPDATE addresses SET expires_at = ? WHERE id = ?', now() - 100, ending.alias.id);
  await assert.rejects(smtpSend(app, { to: ending.address, subject: 'ended again', text: 'x' }), (e) => e.responseCode === 550);
  assert.equal((await a.api.patch(`/api/aliases/${ending.alias.id}`, { expiresAt: now() + 60 })).status, 200);
  await smtpSend(app, { to: ending.address, subject: 'new date', text: 'x' });
  assert.equal((await sendTo(ending.address)).status, 201);

  // An end date does not turn on an alias that is turned off.
  assert.equal((await a.api.patch(`/api/aliases/${off.alias.id}`, { expiresAt: now() + 3600 })).status, 200);
  await assert.rejects(smtpSend(app, { to: off.address, subject: 'still off', text: 'x' }), (e) => e.responseCode === 550);

  // The ended alias can be deleted like any alias.
  app.db.run('UPDATE addresses SET expires_at = ? WHERE id = ?', now() - 100, ending.alias.id);
  assert.equal((await a.api.del(`/api/aliases/${ending.alias.id}`)).status, 204);
});

test('a database of the first version gets the new columns at the start', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'postern-old-'));
  // The two tables as the first version made them: without retention_days and without expires_at.
  const old = new DatabaseSync(join(dir, 'accounts.db'));
  old.exec(`
    CREATE TABLE mailboxes (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, enc BLOB, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      paid_until INTEGER NOT NULL, created_day TEXT NOT NULL
    ) STRICT;
    CREATE TABLE addresses (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('mailbox', 'alias')), address_hmac BLOB NOT NULL UNIQUE, sealed_address BLOB NOT NULL, enc BLOB,
      enabled INTEGER NOT NULL DEFAULT 1, received INTEGER NOT NULL DEFAULT 0, created_day TEXT NOT NULL
    ) STRICT;
    INSERT INTO mailboxes (id, account_id, paid_until, created_day) VALUES ('oldbox', 'nobody', 1, '2026-01-01');
    INSERT INTO addresses (id, account_id, mailbox_id, kind, address_hmac, sealed_address, created_day) VALUES ('oldaddress', 'nobody', 'oldbox', 'alias', x'0102', x'03', '2026-01-01');
  `);
  old.close();

  let upgraded;
  try {
    upgraded = await startTestApp({ dataDir: dir });
    const columns = (table) => upgraded.db.all(`PRAGMA table_info(${table})`).map((c) => c.name);
    assert.ok(columns('mailboxes').includes('retention_days'));
    assert.ok(columns('addresses').includes('expires_at'));
    // Rows of the old version are still there, with the settings off.
    assert.equal(upgraded.db.get("SELECT retention_days FROM mailboxes WHERE id = 'oldbox'").retention_days, null);
    assert.equal(upgraded.db.get("SELECT expires_at FROM addresses WHERE id = 'oldaddress'").expires_at, null);

    // The new settings work on this database.
    const a = await newAccount(upgraded, { credits: 100 });
    const { mailbox } = await newMailbox(a);
    const { alias, address } = await newAlias(a, mailbox.id);
    assert.equal((await a.api.patch(`/api/mailboxes/${mailbox.id}`, { retentionDays: 14 })).data.mailbox.retentionDays, 14);
    assert.equal((await a.api.patch(`/api/aliases/${alias.id}`, { expiresAt: now() + 600 })).status, 200);
    await smtpSend(upgraded, { to: address, subject: 'works', text: 'x' });
    await upgraded.runJobs('mail-retention');
    assert.equal((await listMessages(a)).messages.length, 1);

    // A second start changes nothing more.
    await upgraded.stop();
    upgraded = await startTestApp({ dataDir: dir });
    assert.equal(columns('mailboxes').filter((c) => c === 'retention_days').length, 1);
    assert.equal(upgraded.db.get('SELECT retention_days FROM mailboxes WHERE id = ?', mailbox.id).retention_days, 14);
  } finally {
    if (upgraded) await upgraded.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
