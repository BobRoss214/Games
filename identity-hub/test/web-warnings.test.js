// Tests for the Home warnings (web/js/lib/warnings.js). It runs here in Node.js exactly as in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeWarnings, WARN_DAYS, OFFLINE_SECONDS } from '../web/js/lib/warnings.js';

const DAY = 86400;
const NOW = 1_800_000_000;
const PRICES = { mailboxMonth: 100, numberMonth: 400, textOut: 3, callMinute: 3 };
const box = (id, days, status = 'active') => ({ id, status, paidUntil: NOW + days * DAY });
const number = (id, days, status = 'active') => ({ id, status, paidUntil: NOW + days * DAY });
const run = (extra) => homeWarnings({ now: NOW, balance: 0, prices: PRICES, graceDays: 7, mailboxes: [], numbers: [], ...extra });

test('nothing to warn: empty account, or enough balance', () => {
  assert.deepEqual(run({}), { renewals: null, paused: [], offline: [] });
  assert.deepEqual(run({ balance: 500, mailboxes: [box('m1', 2)], numbers: [number('n1', 3)] }), { renewals: null, paused: [], offline: [] });
  // exactly enough is enough
  assert.equal(run({ balance: 100, mailboxes: [box('m1', 1)] }).renewals, null);
});

test('the renewals of the next 7 days cost more than the balance', () => {
  const w = run({ balance: 450, mailboxes: [box('m1', 5), box('m2', 20)], numbers: [number('n1', 2)] });
  assert.deepEqual(w.renewals, {
    items: [{ kind: 'number', id: 'n1', dueAt: NOW + 2 * DAY, cost: 400 }, { kind: 'inbox', id: 'm1', dueAt: NOW + 5 * DAY, cost: 100 }],
    total: 500, firstAt: NOW + 2 * DAY, missing: 50,
  });
  assert.deepEqual(w.paused, []);
});

test('the limit is 7 days, counted to the second', () => {
  assert.equal(WARN_DAYS, 7);
  assert.equal(run({ mailboxes: [{ id: 'm', status: 'active', paidUntil: NOW + 7 * DAY }] }).renewals.items.length, 1);
  assert.equal(run({ mailboxes: [{ id: 'm', status: 'active', paidUntil: NOW + 7 * DAY + 1 }] }).renewals, null);
  // a renewal that is late (the server job did not run yet) counts too
  assert.equal(run({ mailboxes: [box('m', -1)] }).renewals.total, 100);
});

test('a free item never warns', () => {
  assert.equal(run({ prices: { mailboxMonth: 0, numberMonth: 0 }, mailboxes: [box('m', 1)], numbers: [number('n', 1)] }).renewals, null);
  assert.equal(run({ prices: null, mailboxes: [box('m', 1)] }).renewals, null);
  assert.deepEqual(run({ prices: { mailboxMonth: 0, numberMonth: 400 }, mailboxes: [box('m', 1)], numbers: [number('n', 1)] }).renewals.items.map((i) => i.id), ['n']);
});

test('paused items: a number has a release day, an inbox has none', () => {
  const w = run({ balance: 0, mailboxes: [box('m1', -3, 'suspended')], numbers: [number('n1', -2, 'suspended')] });
  assert.equal(w.renewals, null); // a paused item is not counted as a renewal
  assert.deepEqual(w.paused, [{ kind: 'inbox', id: 'm1', releaseAt: null }, { kind: 'number', id: 'n1', releaseAt: NOW - 2 * DAY + 7 * DAY }]);
  // no grace period in the settings: no release day is promised
  assert.equal(run({ graceDays: 0, numbers: [number('n1', -2, 'suspended')] }).paused[0].releaseAt, null);
});

test('paused and due at the same time', () => {
  const w = run({ balance: 50, mailboxes: [box('m1', 1), box('m2', -1, 'suspended')] });
  assert.equal(w.renewals.total, 100);
  assert.equal(w.renewals.missing, 50);
  assert.deepEqual(w.paused.map((p) => p.id), ['m2']);
});

test('broken input does not throw and does not warn for nothing', () => {
  assert.deepEqual(homeWarnings(), { renewals: null, paused: [], offline: [] });
  assert.deepEqual(homeWarnings({ now: NaN, mailboxes: [box('m', 1)] }), { renewals: null, paused: [], offline: [] });
  const w = homeWarnings({ now: NOW, balance: 'x', prices: PRICES, graceDays: 'x', mailboxes: [null, 5, { id: 'm', status: 'active', paidUntil: null }, { id: 'k', status: 'active', paidUntil: NOW + DAY }], numbers: 'no' });
  assert.deepEqual(w.renewals.items.map((i) => i.id), ['k']);
  assert.deepEqual(w.paused, []);
});

test('own phone: a phone that is offline for more than one hour', () => {
  assert.equal(OFFLINE_SECONDS, 3600);
  const n = (id, gateway) => ({ id, status: 'active', paidUntil: NOW + 20 * DAY, gateway });
  const w = run({ balance: 9999, numbers: [
    n('online', { online: true, lastSeen: NOW - 10 }),
    n('short', { online: false, lastSeen: NOW - 3600 }),      // exactly one hour: not yet
    n('long', { online: false, lastSeen: NOW - 3601 }),
    n('never', { online: false, lastSeen: null }),
    n('other-provider', null),
    n('broken', 'x'),
  ] });
  assert.deepEqual(w.offline, [{ id: 'long', since: NOW - 3601 }, { id: 'never', since: null }]);
  assert.equal(w.renewals, null);
  assert.deepEqual(w.paused, []);
});
