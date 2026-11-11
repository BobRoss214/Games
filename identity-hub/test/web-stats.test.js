// Tests for "My stats" (web/js/lib/stats.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mailStats } from '../web/js/lib/stats.js';

test('stats: counts by alias and by sender', () => {
  const messages = [
    { addressId: 'alias-shop', fromAddress: 'orders@shop.example', at: 100 },
    { addressId: 'alias-shop', fromAddress: 'news@mail.shop.example', at: 300 },
    { addressId: 'alias-shop', fromAddress: 'offers@spam.example.co.uk', at: 200 },
    { addressId: 'alias-bank', fromAddress: 'alerts@bank.example', at: 250 },
    { addressId: 'alias-forum', fromAddress: 'noreply@forum.example', at: 50 },
    { addressId: 'alias-forum', fromAddress: 'NoReply@Forum.Example', at: 400 },
    { addressId: 'alias-bank', fromAddress: 'news@shop.example', at: 150 },
  ];
  assert.deepEqual(mailStats(messages), {
    total: 7,
    byAddress: [
      { addressId: 'alias-shop', count: 3, lastAt: 300 },
      { addressId: 'alias-forum', count: 2, lastAt: 400 },
      { addressId: 'alias-bank', count: 2, lastAt: 250 },
    ],
    bySender: [
      { domain: 'shop.example', count: 3, lastAt: 300 },
      { domain: 'forum.example', count: 2, lastAt: 400 },
      { domain: 'bank.example', count: 1, lastAt: 250 },
      { domain: 'example.co.uk', count: 1, lastAt: 200 },
    ],
    firstAt: 50,
    lastAt: 400,
  });
  // The order of the messages makes no difference.
  assert.deepEqual(mailStats([...messages].reverse()), mailStats(messages));
  // The input is not changed.
  assert.equal(messages.length, 7);
  assert.equal(messages[0].at, 100);
});

test('stats: nothing to count, and messages that are not complete', () => {
  const empty = { total: 0, byAddress: [], bySender: [], firstAt: null, lastAt: null };
  assert.deepEqual(mailStats([]), empty);
  for (const bad of [null, undefined, 'text', 5, {}]) assert.deepEqual(mailStats(bad), empty);

  const result = mailStats([
    { addressId: null, fromAddress: 'x@shop.example', at: 10 },        // the alias was deleted: counted for the sender only
    { addressId: 'alias-a', fromAddress: '', at: 20 },                 // no sender: counted for the alias only
    { addressId: 'alias-a', fromAddress: 'broken address', at: 30 },
    { addressId: 'alias-a', at: 40 },
    { addressId: 'alias-b', fromAddress: 'x@shop.example', at: 'yesterday' }, // no usable time: not counted at all
    { addressId: 'alias-b', fromAddress: 'x@shop.example' },
    null, 'text', 3,
  ]);
  assert.deepEqual(result, {
    total: 4,
    byAddress: [{ addressId: 'alias-a', count: 3, lastAt: 40 }],
    bySender: [{ domain: 'shop.example', count: 1, lastAt: 10 }],
    firstAt: 10,
    lastAt: 40,
  });
});

test('stats: equal counts are ordered by the newest mail, then by name', () => {
  const result = mailStats([
    { addressId: 'b', fromAddress: 'x@two.example', at: 5 },
    { addressId: 'a', fromAddress: 'x@one.example', at: 5 },
    { addressId: 'c', fromAddress: 'x@three.example', at: 9 },
  ]);
  assert.deepEqual(result.byAddress.map((x) => x.addressId), ['c', 'a', 'b']);
  assert.deepEqual(result.bySender.map((x) => x.domain), ['three.example', 'one.example', 'two.example']);
});

test('stats: many messages are counted fast', () => {
  const messages = Array.from({ length: 50000 }, (_, i) => ({ addressId: `alias-${i % 40}`, fromAddress: `x@sender${i % 300}.example`, at: 1000 + i }));
  const started = Date.now();
  const result = mailStats(messages);
  assert.ok(Date.now() - started < 1000);
  assert.equal(result.total, 50000);
  assert.equal(result.byAddress.length, 40);
  assert.equal(result.bySender.length, 300);
  assert.equal(result.byAddress.reduce((n, x) => n + x.count, 0), 50000);
  assert.equal(result.firstAt, 1000);
  assert.equal(result.lastAt, 50999);
});

test('stats: the source uses no page, no network, and no storage', () => {
  const source = readFileSync(new URL('../web/js/lib/stats.js', import.meta.url), 'utf8');
  for (const word of ['document', 'window', 'fetch', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'navigator', 'require', 'eval']) {
    assert.equal(new RegExp(`\\b${word}\\b`).test(source), false, `stats.js must not use "${word}"`);
  }
  assert.equal(/Math\s*\.\s*random|https?:\/\//.test(source), false);
  assert.deepEqual([...source.matchAll(/\bimport\b[^'"\n]*['"]([^'"]+)['"]/g)].map((m) => m[1]), ['./leak.js']);
});
