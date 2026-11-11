// Tests for the logic of "My stats" and "Who leaked me" (web/js/features/insights/work.js):
// how the newest mail is read page by page, and what the two screens show from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readNewestMail, statsView, leakView, knownOf, MAIL_LIMIT } from '../web/js/features/insights/work.js';

// A stand-in for listMessages of lib/mail.js: `total` mails, the newest first, 100 at most in one answer.
function fakeList(total, { from = (i) => `news@sender${i % 3}.example`, addressId = () => 'alias-a' } = {}) {
  const all = Array.from({ length: total }, (_, i) => ({ id: `m${i}`, at: 100000 - i, addressId: addressId(i), meta: { from: { address: from(i) } } }));
  const calls = [];
  const list = async (query) => {
    calls.push({ ...query });
    const start = query.beforeId ? all.findIndex((m) => m.id === query.beforeId) + 1 : 0;
    const size = Math.min(query.limit, 100);
    return { messages: all.slice(start, start + size), more: start + size < all.length };
  };
  return { list, calls, all };
}

test('insights: the mail is read page by page, the newest first, until there is no more', async () => {
  const { list, calls, all } = fakeList(250);
  const progress = [];
  const res = await readNewestMail(list, { onProgress: (n) => progress.push(n) });
  assert.equal(res.read, 250);
  assert.equal(res.complete, true);
  assert.equal(res.messages.length, 250);
  assert.deepEqual(res.messages[0], { id: 'm0', addressId: 'alias-a', fromAddress: 'news@sender0.example', at: 100000 });
  assert.deepEqual(progress, [100, 200, 250]);
  assert.deepEqual(calls, [
    { direction: 'in', limit: 100, before: undefined, beforeId: undefined },
    { direction: 'in', limit: 100, before: all[99].at, beforeId: 'm99' },
    { direction: 'in', limit: 100, before: all[199].at, beforeId: 'm199' },
  ]);
});

test('insights: the read stops at the limit and says that it is not complete', async () => {
  assert.equal(MAIL_LIMIT, 1000);
  const big = fakeList(1030);
  const res = await readNewestMail(big.list);
  assert.equal(big.calls.length, 10);
  assert.equal(res.read, 1000);
  assert.equal(res.complete, false);
  assert.equal(res.messages[999].id, 'm999');

  const small = fakeList(1030);
  const part = await readNewestMail(small.list, { limit: 250 });
  assert.deepEqual(small.calls.map((c) => c.limit), [100, 100, 50]);
  assert.deepEqual([part.read, part.complete], [250, false]);

  const exact = fakeList(300);
  const all = await readNewestMail(exact.list, { limit: 300 });
  assert.deepEqual([all.read, all.complete, exact.calls.length], [300, true, 3]);

  const none = fakeList(0);
  assert.deepEqual(await readNewestMail(none.list), { messages: [], read: 0, complete: true });
  assert.equal(none.calls.length, 1);
});

test('insights: a stopped read gives nothing and asks for no more mail', async () => {
  const { list, calls } = fakeList(500);
  let stop = false;
  const res = await readNewestMail(list, { onProgress: () => { stop = true; }, stopped: () => stop });
  assert.equal(res, null);
  assert.equal(calls.length, 1); // after the stop no other page is asked for

  // A stop while the server answers: that answer is thrown away.
  const late = fakeList(500);
  let stopNow = false;
  const slow = async (query) => { const res = await late.list(query); stopNow = true; return res; };
  assert.equal(await readNewestMail(slow, { stopped: () => stopNow }), null);
  assert.equal(late.calls.length, 1);
});

test('insights: a mail that the browser cannot open is read but not counted', async () => {
  const list = async () => ({
    messages: [
      { id: 'a', at: 30, addressId: 'x', meta: { from: { address: 'a@shop.example' } } },
      { id: 'b', at: 20, addressId: 'x', broken: true, meta: { from: { address: '' } } },
      { id: 'c', at: 10, addressId: null, meta: {} },
      null,
      { id: 'd', at: 'soon', addressId: 'x', meta: { from: { address: 'd@shop.example' } } },
    ],
    more: false,
  });
  const res = await readNewestMail(list);
  assert.equal(res.read, 5);
  assert.deepEqual(res.messages, [
    { id: 'a', addressId: 'x', fromAddress: 'a@shop.example', at: 30 },
    { id: 'c', addressId: '', fromAddress: '', at: 10 },
  ]);
});

test('insights: "My stats" lists aliases with their counts; other addresses are in the total only', () => {
  const aliases = [{ id: 'shop', address: 'shop@p.test' }, { id: 'forum', address: 'forum@p.test' }, { id: 'quiet', address: 'quiet@p.test' }];
  const messages = [
    { id: '1', addressId: 'shop', fromAddress: 'orders@shop.example', at: 10 },
    { id: '2', addressId: 'shop', fromAddress: 'news@mail.shop.example', at: 40 },
    { id: '3', addressId: 'forum', fromAddress: 'no-reply@forum.example', at: 30 },
    { id: '4', addressId: 'inbox-address', fromAddress: 'lena@friends.example', at: 50 },
    { id: '5', addressId: '', fromAddress: 'old@gone.example', at: 5 },
  ];
  const view = statsView(messages, aliases);
  assert.equal(view.total, 5);
  assert.deepEqual(view.aliases, [
    { alias: aliases[0], count: 2, lastAt: 40 },
    { alias: aliases[1], count: 1, lastAt: 30 },
  ]);
  assert.deepEqual(view.senders.map((s) => [s.domain, s.count]), [['shop.example', 2], ['friends.example', 1], ['forum.example', 1], ['gone.example', 1]]);
  assert.deepEqual(statsView([], aliases), { total: 0, aliases: [], senders: [] });
  assert.deepEqual(statsView(messages, null).aliases, []);
});

test('insights: "Who leaked me" lists only aliases with a sender that they do not know', () => {
  const alias = (id, senders, more = {}) => ({ id, address: `${id}@p.test`, extra: senders ? { senders } : {}, received: 0, ...more });
  const aliases = [alias('shop', ['shop.example']), alias('paper', ['paper.example']), alias('quiet', null), alias('new', null)];
  const messages = [
    { id: '1', addressId: 'shop', fromAddress: 'orders@shop.example', at: 10 },
    { id: '2', addressId: 'shop', fromAddress: 'deals@other.example', at: 20 },
    { id: '3', addressId: 'shop', fromAddress: 'more@other.example', at: 30 },
    { id: '4', addressId: 'paper', fromAddress: 'news@paper.example', at: 15 },
    { id: '5', addressId: 'new', fromAddress: 'late@spam.example', at: 60 },
    { id: '6', addressId: 'new', fromAddress: 'first@club.example', at: 40 },
    { id: '7', addressId: 'deleted-alias', fromAddress: 'x@y.example', at: 70 },
  ];
  const { rows, learn } = leakView(messages, aliases);
  assert.deepEqual(rows.map((r) => r.alias.id), ['new', 'shop']); // the newest hint first
  assert.deepEqual(rows[0].known, ['club.example']);
  assert.deepEqual(rows[0].hints.map((x) => x.domain), ['spam.example']);
  assert.deepEqual(rows[1].hints, [{ domain: 'other.example', fromAddress: 'more@other.example', firstAt: 20, lastAt: 30, count: 2, messageId: '3' }]);
  assert.deepEqual(learn, [{ aliasId: 'new', senders: ['club.example'] }]);
});

test('insights: an alias with one sender learns it and gives no hint', () => {
  const aliases = [{ id: 'paper', address: 'paper@p.test', extra: {} }];
  const messages = [{ id: '1', addressId: 'paper', fromAddress: 'news@paper.example', at: 1 }, { id: '2', addressId: 'paper', fromAddress: 'more@mail.paper.example', at: 2 }];
  assert.deepEqual(leakView(messages, aliases), { rows: [], learn: [{ aliasId: 'paper', senders: ['paper.example'] }] });
});

test('insights: with only the newest part of the mail, an alias learns nothing unless all its mail is there', () => {
  const messages = [{ id: '1', addressId: 'busy', fromAddress: 'a@one.example', at: 10 }, { id: '2', addressId: 'busy', fromAddress: 'b@two.example', at: 20 }];
  const busy = (received) => [{ id: 'busy', address: 'busy@p.test', extra: {}, received }];
  // 5 mails came to the alias, 2 are in the set: its oldest mail is possibly not there.
  assert.deepEqual(leakView(messages, busy(5), { complete: false }), { rows: [], learn: [] });
  // All its mail is in the set.
  const all = leakView(messages, busy(2), { complete: false });
  assert.deepEqual(all.learn, [{ aliasId: 'busy', senders: ['one.example'] }]);
  assert.deepEqual(all.rows.map((r) => r.hints[0].domain), ['two.example']);
  // The set is all the mail of the account: the number does not matter (old mail was deleted).
  assert.equal(leakView(messages, busy(5), { complete: true }).learn.length, 1);
  // An alias that knows its senders shows hints also from a part of the mail.
  const knows = [{ id: 'busy', address: 'busy@p.test', extra: { senders: ['one.example'] }, received: 5 }];
  assert.deepEqual(leakView(messages, knows, { complete: false }).rows[0].hints.map((x) => x.domain), ['two.example']);
});

test('insights: a saved list of senders is checked before use', () => {
  assert.deepEqual(knownOf({ extra: { senders: ['shop.example', 7, null, 'x'.repeat(300), 'b.example'] } }), ['shop.example', 'b.example']);
  assert.deepEqual(knownOf({ extra: { senders: 'shop.example' } }), []);
  assert.deepEqual(knownOf({ extra: {} }), []);
  assert.deepEqual(knownOf(null), []);
  assert.equal(knownOf({ extra: { senders: Array.from({ length: 80 }, (_, i) => `d${i}.example`) } }).length, 50);
});

test('insights: the logic has no access to the page, the network or storage', () => {
  const source = readFileSync(new URL('../web/js/features/insights/work.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  for (const word of ['document', 'window', 'fetch(', 'localStorage', 'sessionStorage', 'indexedDB', 'cookie', 'XMLHttpRequest', 'navigator', 'console.']) {
    assert.ok(!source.includes(word), `work.js uses "${word}"`);
  }
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports, ['../../lib/stats.js', '../../lib/leak.js']);
});
