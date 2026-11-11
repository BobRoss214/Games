// Tests for the "possibly leaked" hint (web/js/lib/leak.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { senderDomain, mainDomain, review, addKnown } from '../web/js/lib/leak.js';

test('leak: the main domain of a sender', () => {
  const cases = [
    ['news@shop.example', 'shop.example'],
    ['News@Mail.Shop.Example', 'shop.example'],
    ['a@b.c.d.shop.example', 'shop.example'],
    ['news@mail.shop.example.co.uk', 'example.co.uk'],
    ['x@example.co.uk', 'example.co.uk'],
    ['x@bbc.co.uk', 'bbc.co.uk'],
    ['x@mail.example.com.au', 'example.com.au'],
    ['x@www.example.co.jp', 'example.co.jp'],
    ['x@example.com.br', 'example.com.br'],
    ['x@a.example.co.nz', 'example.co.nz'],
    ['x@example.co.in', 'example.co.in'],
    ['x@example.co.za', 'example.co.za'],
    ['x@example.com', 'example.com'],
    ['x@example.com.', 'example.com'],
    ['first.last+tag@sub.example.org', 'example.org'],
    ['"odd name"@example.net', null], // a space in the address
    ['x@xn--bcher-kva.example', 'xn--bcher-kva.example'],
    ['x@bücher.example', 'bücher.example'],
    ['x@shop-example.net', 'shop-example.net'],
  ];
  for (const [address, domain] of cases) assert.equal(senderDomain(address), domain, address);

  for (const bad of ['', 'no-at-sign', '@example.com', 'x@', 'x@localhost', 'x@example', 'x@.com', 'x@a..b.com', 'x@-a.com', 'x@a-.com', 'x@127.0.0.1', 'x@[127.0.0.1]',
    'x@exa mple.com', 'x@example.com/path', 'x@example.c_m', `x@${'a'.repeat(64)}.com`, `${'a'.repeat(400)}@example.com`, null, undefined, 5, {}, ['x@example.com']]) {
    assert.equal(senderDomain(bad), null, String(bad).slice(0, 30));
  }
  // The same rule for a host name without an address.
  assert.equal(mainDomain('Mail.Shop.Example.CO.UK'), 'example.co.uk');
  assert.equal(mainDomain('shop.example'), 'shop.example');
  assert.equal(mainDomain('example'), null);
  assert.equal(mainDomain(''), null);
  assert.equal(mainDomain(null), null);
});

test('leak: an alias with no known sender learns the sender of its oldest message', () => {
  const messages = [
    { id: 'm3', at: 300, fromAddress: 'offers@other-shop.example' },
    { id: 'm1', at: 100, fromAddress: 'welcome@mail.shop.example' },
    { id: 'm2', at: 200, fromAddress: 'news@shop.example' },
  ];
  const first = review([], messages);
  assert.deepEqual(first.learn, ['shop.example']);
  // The learned sender is no hint. The other sender is one.
  assert.deepEqual(first.hints, [{ domain: 'other-shop.example', fromAddress: 'offers@other-shop.example', firstAt: 300, lastAt: 300, count: 1, messageId: 'm3' }]);

  // The order of the messages makes no difference.
  assert.deepEqual(review([], [...messages].reverse()), first);
  assert.deepEqual(review(undefined, messages), first);

  // One message only: learned, no hint.
  assert.deepEqual(review([], [messages[1]]), { learn: ['shop.example'], hints: [] });
  // Nothing to look at.
  assert.deepEqual(review([], []), { learn: [], hints: [] });
  assert.deepEqual(review([], null), { learn: [], hints: [] });
  assert.deepEqual(review(['shop.example'], []), { learn: [], hints: [] });
});

test('leak: known senders give no hint, also from a subdomain; other senders give one hint each', () => {
  const known = ['shop.example'];
  const messages = [
    { id: 'a', at: 10, fromAddress: 'orders@shop.example' },
    { id: 'b', at: 20, fromAddress: 'news@mail.shop.example' },       // a subdomain of the known sender
    { id: 'c', at: 30, fromAddress: 'promo@deep.mail.SHOP.example' },
    { id: 'd', at: 40, fromAddress: 'win@shop-example.net' },          // a look-alike
    { id: 'e', at: 50, fromAddress: 'x@shopexample.example' },         // a look-alike
    { id: 'f', at: 60, fromAddress: 'again@mail.shop-example.net' },
    { id: 'g', at: 45, fromAddress: 'first@list.spammer.example.co.uk' },
    { id: 'h', at: 70, fromAddress: 'second@spammer.example.co.uk' },
    { id: 'i', at: 65, fromAddress: 'third@other.example.co.uk' },     // "example.co.uk" is the main domain of all three
  ];
  const result = review(known, messages);
  assert.deepEqual(result.learn, [], 'nothing is learned when a sender is known');
  assert.deepEqual(result.hints, [
    { domain: 'example.co.uk', fromAddress: 'second@spammer.example.co.uk', firstAt: 45, lastAt: 70, count: 3, messageId: 'h' },
    { domain: 'shop-example.net', fromAddress: 'again@mail.shop-example.net', firstAt: 40, lastAt: 60, count: 2, messageId: 'f' },
    { domain: 'shopexample.example', fromAddress: 'x@shopexample.example', firstAt: 50, lastAt: 50, count: 1, messageId: 'e' },
  ]);
  // The newest hint is first.
  assert.deepEqual(result.hints.map((h) => h.lastAt), [70, 60, 50]);

  // After the user says "this sender is fine", the hint is gone.
  const more = addKnown(known, 'shop-example.net');
  assert.deepEqual(review(more, messages).hints.map((h) => h.domain), ['example.co.uk', 'shopexample.example']);
  // The known list can hold the name in any spelling, also with a subdomain.
  assert.deepEqual(review(['Mail.Shop.Example', 'EXAMPLE.CO.UK', 'shop-example.net', 'shopexample.example'], messages).hints, []);
  // A known sender on a different ending is not the same sender.
  assert.equal(review(['shop.example'], [{ id: 'z', at: 1, fromAddress: 'x@shop.example.org' }]).hints.length, 1);
});

test('leak: messages with a missing or broken sender are ignored', () => {
  const messages = [
    { id: 'a', at: 5, fromAddress: '' },
    { id: 'b', at: 6, fromAddress: null },
    { id: 'c', at: 7 },
    { id: 'd', at: 8, fromAddress: 'not an address' },
    { id: 'e', at: 9, fromAddress: 'x@localhost' },
    { id: 'f', at: 'soon', fromAddress: 'x@time.example' },
    null, 'text', 7,
    { id: 'g', at: 50, fromAddress: 'real@shop.example' },
    { id: 'h', at: 60, fromAddress: 'other@elsewhere.example' },
  ];
  // The oldest message WITH a usable sender is learned.
  assert.deepEqual(review([], messages), {
    learn: ['shop.example'],
    hints: [{ domain: 'elsewhere.example', fromAddress: 'other@elsewhere.example', firstAt: 60, lastAt: 60, count: 1, messageId: 'h' }],
  });
  assert.deepEqual(review([], messages.slice(0, 9)), { learn: [], hints: [] });
  // Entries of the known list that are no domains are ignored. The alias then counts as an alias that knows nobody.
  assert.deepEqual(review(['', null, 'nonsense', 5], [{ id: 'g', at: 50, fromAddress: 'real@shop.example' }]), { learn: ['shop.example'], hints: [] });
  // The function does not change what it gets.
  const frozen = Object.freeze([Object.freeze({ id: 'a', at: 1, fromAddress: 'x@shop.example' })]);
  const knownFrozen = Object.freeze([]);
  assert.deepEqual(review(knownFrozen, frozen).learn, ['shop.example']);
});

test('leak: the list of known senders', () => {
  assert.deepEqual(addKnown([], 'Shop.Example'), ['shop.example']);
  assert.deepEqual(addKnown(['shop.example'], 'mail.shop.example'), ['shop.example'], 'a subdomain is the same sender');
  assert.deepEqual(addKnown(['shop.example'], 'news@other.example'), ['shop.example', 'other.example'], 'an address works too');
  assert.deepEqual(addKnown(['Shop.Example', 'shop.example', 'x'], 'other.example.co.uk'), ['shop.example', 'example.co.uk']);
  // Text that is no domain changes nothing.
  for (const bad of ['', 'nonsense', null, undefined, 5, 'x@localhost']) assert.deepEqual(addKnown(['shop.example'], bad), ['shop.example']);
  assert.deepEqual(addKnown(null, 'shop.example'), ['shop.example']);

  // 50 at most. The oldest entry goes.
  let list = [];
  for (let i = 0; i < 50; i++) list = addKnown(list, `sender${i}.example`);
  assert.equal(list.length, 50);
  const next = addKnown(list, 'newest.example');
  assert.equal(next.length, 50);
  assert.equal(next[0], 'sender1.example');
  assert.equal(next[49], 'newest.example');
  assert.equal(list.length, 50, 'the old list is not changed');
  assert.equal(list[0], 'sender0.example');
  // A domain that is in the list stays where it is.
  assert.deepEqual(addKnown(next, 'sender1.example'), next);
});

test('leak: the source uses no page, no network, and no storage', () => {
  const source = readFileSync(new URL('../web/js/lib/leak.js', import.meta.url), 'utf8');
  for (const word of ['document', 'window', 'fetch', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'navigator', 'import', 'require', 'eval']) {
    assert.equal(new RegExp(`\\b${word}\\b`).test(source), false, `leak.js must not use "${word}"`);
  }
  assert.equal(/Math\s*\.\s*random|https?:\/\//.test(source), false);
});
