// "Who leaked me" (web/js/features/insights.js): the aliases with a "possibly leaked" hint and the
// sender that caused it; "This sender is expected" (saved encrypted, stays after a reload);
// "Turn off this alias"; an alias with one sender is not in the list; requests, keyboard, phone.
import { signUp, signIn, addCredit, inApp, settle, assert } from '../lib.mjs';

function watchRequests(page) {
  const list = [];
  const fn = (r) => { const u = new URL(r.url()); list.push(`${r.method()} ${u.pathname}${u.search}`); };
  page.on('request', fn);
  return { list, stop() { page.off('request', fn); return list; } };
}
const isMailList = (r) => /^GET \/api\/messages\?/.test(r) && r.includes('direction=in');
const kept = (page) => page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie]));
const done = (page) => page.locator('[data-report="done"]').waitFor();
const clean = (text) => text.replace(/\s+/g, ' ').trim();

export default async function (t) {
  const d = await t.open();
  const { page } = d;
  const key = await signUp(page, t.base);
  await addCredit(page, 20);
  const mail = (to, from, subject = 'Hello') => inApp(page, ({ api }, m) => api.post('/api/dev/inbound-mail', { ...m, text: 'Hello.' }), { to, from, subject });
  const made = await inApp(page, async ({ data, identities }) => {
    const box = await data.createMailbox({ label: 'Personal' });
    const shop = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Maple Shop' });
    const paper = await data.createAlias({ mailboxId: box.mailbox.id, label: 'One sender' });
    await data.createAlias({ mailboxId: box.mailbox.id, label: 'No mail' });
    const group = await identities.createIdentity({ name: 'Shopping' });
    await data.setItemIdentity('alias', shop.alias.id, group);
    return { shop: shop.alias.id, shopAddress: shop.address, paper: paper.alias.id, paperAddress: paper.address, group };
  });
  const sendersOf = (id) => inApp(page, ({ store }, id) => { const a = (store.get('aliases') || []).find((x) => x.id === id); return (a && a.extra.senders) || null; }, id);
  const waitSenders = async (id, want) => {
    for (let i = 0; i < 80; i++) { if (JSON.stringify(await sendersOf(id)) === JSON.stringify(want)) return; await page.waitForTimeout(100); }
    throw new Error(`the known senders are ${JSON.stringify(await sendersOf(id))}, not ${JSON.stringify(want)}`);
  };
  const today = await page.evaluate(async () => {
    const { dayText } = await import('/js/lib/format.js');
    const now = new Date();
    return dayText(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  });

  // The shop alias: first mail from shop.example. Later: the same company, then other.example two times.
  await mail(made.shopAddress, 'orders@shop.example', 'Your order');
  await mail(made.paperAddress, 'news@paper.example', 'Morning news');
  await page.waitForTimeout(1200); // the next mails are later on the clock of the server (it counts in seconds)
  await mail(made.shopAddress, 'news@mail.shop.example', 'Our news');
  await mail(made.shopAddress, 'deals@other.example', 'Cheap watches');
  await mail(made.shopAddress, 'Deals@Other.Example', 'Cheap watches again');
  await mail(made.paperAddress, 'news@paper.example', 'Evening news');
  await page.goto(t.base + '/');
  await waitSenders(made.shop, ['shop.example']);
  await waitSenders(made.paper, ['paper.example']);
  await settle(page);

  // ---- Home: the link shows the number that the app has in memory already ----
  const link = page.locator('[data-section="insights"]').getByRole('link', { name: 'Who leaked me' });
  await link.locator('[data-leaks="1"]').waitFor();
  assert(clean(await link.textContent()) === 'Who leaked me1 alias possibly leaked', 'the link on Home is wrong: ' + clean(await link.textContent()));
  t.ok('Home: "Who leaked me" shows 1, from the hints that the app has in memory');

  // ---- the list: the alias, its label and identity, the sender that caused the hint ----
  const before = await kept(page);
  let seen = watchRequests(page);
  await link.click();
  await page.getByRole('heading', { name: 'Who leaked me', level: 1 }).waitFor();
  await done(page);
  await page.waitForTimeout(500);
  let requests = seen.stop();
  assert(requests.length === 1 && isMailList(requests[0]), 'the screen made other requests than one read of the mail list: ' + requests.join(', '));
  assert(await kept(page) === before, 'the screen changed what the browser keeps (storage or cookie)');
  assert(await page.evaluate(() => location.pathname + location.search + location.hash) === '/leaks', 'the address holds more than the name of the screen');
  assert(await page.locator('.sidebar .nav-item[aria-current="page"]').textContent() === 'Home', 'Home is not the marked place');
  const cards = page.locator('[data-list="leaks"] article');
  assert(await cards.count() === 1, `the list has ${await cards.count()} aliases, not 1`);
  const card = page.locator(`article[data-alias="${made.shop}"]`);
  await card.getByRole('heading', { name: made.shopAddress, level: 2 }).waitFor();
  const marks = await card.locator('.item-sub > *').allTextContents();
  assert(marks.join('|') === 'Maple Shop|Possibly leaked|Shopping', 'the label, the mark or the identity is wrong: ' + marks.join('|'));
  assert(await card.getByRole('link', { name: 'Shopping' }).getAttribute('href') === `/identities/${made.group}`, 'the identity does not link to its screen');
  assert(clean(await card.textContent()).includes('Expected: shop.example'), 'the card does not name the expected sender');
  const hints = card.locator('[data-hint]');
  assert(await hints.count() === 1 && await hints.first().getAttribute('data-hint') === 'other.example', 'the hint is not for other.example');
  const hintText = clean(await hints.first().textContent());
  assert(hintText.startsWith(`Mail from other.exampleSender: deals@other.example2 mails. First: ${today}. Last: ${today}.`), 'the hint does not show the sender, the count and the days: ' + hintText);
  const page1 = clean(await page.locator('main').textContent());
  assert(page1.includes('Worked out in this browser from all your 6 mails.'), 'the screen does not say what it looked at');
  assert(/[Pp]ossibly/.test(page1) && page1.includes('is only a hint: a company can use several sender names, and the From line can be forged.'), 'the honest line is missing');
  assert(!page1.includes(made.paperAddress) && !page1.includes('paper.example'), 'an alias with one sender is in the list');
  assert(await page.locator('h1').count() === 1, 'the screen does not have exactly one h1');
  t.ok('an alias that first got mail from shop.example and later from other.example is in the list, with other.example as the cause');
  t.ok('an alias with one sender, and an alias with no mail, are not in the list');
  t.ok('the screen makes one request, for the mail list, and stores nothing');

  // ---- the "Why?" button opens its answer in place, with no request ----
  seen = watchRequests(page);
  await page.getByRole('button', { name: 'How does "Who leaked me" work?' }).click();
  await page.locator('.why-panel[data-why="who-leaked-me"]').getByText('A hint is not proof.').waitFor();
  await page.locator('.why-panel[data-why="who-leaked-me"]').getByRole('button', { name: 'Close' }).click();
  assert(seen.stop().length === 0, 'the "Why?" button made a request');
  t.ok('the "Why?" button of the page opens the answer in place and asks the server for nothing');

  // ---- an alias that knows nobody yet: this screen saves its first sender (encrypted) ----
  await inApp(page, ({ data }, id) => data.setItemExtra('alias', id, { senders: null }), made.shop);
  await waitSenders(made.shop, null);
  seen = watchRequests(page);
  await page.getByRole('button', { name: 'Check again' }).click();
  await waitSenders(made.shop, ['shop.example']);
  await done(page);
  await page.waitForTimeout(300);
  requests = seen.stop();
  const other = requests.filter((r) => !isMailList(r) && r !== 'GET /api/aliases' && r !== `PATCH /api/aliases/${made.shop}`);
  assert(other.length === 0 && requests.filter((r) => r.startsWith('PATCH')).length === 1, 'saving the first sender made unexpected requests: ' + requests.join(', '));
  assert(await card.locator('[data-hint="other.example"]').count() === 1 && await card.locator('[data-hint]').count() === 1, 'after the first sender was saved, the hint is not for other.example only');
  t.ok('an alias with no saved sender: the sender of its oldest mail is saved (one encrypted change), and the newer sender is the hint');

  // ---- keyboard only: Home -> Who leaked me -> "This sender is expected" ----
  await page.goto(t.base + '/');
  await link.waitFor();
  await settle(page);
  const focusText = () => page.evaluate(() => `${document.activeElement.tagName}:${(document.activeElement.textContent || '').trim()}`);
  const tabTo = async (want) => {
    for (let i = 0; i < 80; i++) { await page.keyboard.press('Tab'); if ((await focusText()).startsWith(want)) return; }
    throw new Error(`the keyboard did not reach ${want}`);
  };
  await tabTo('A:Who leaked me');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Who leaked me', level: 1 }).waitFor();
  await done(page);
  await tabTo('BUTTON:This sender is expected');
  assert(await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'This sender is expected: other.example', 'the button does not name its sender');
  await page.keyboard.press('Enter');
  await page.getByText('Saved. Mail from other.example gives no hint from now on.').waitFor();
  await page.getByRole('heading', { name: 'No alias looks leaked' }).waitFor();
  assert(await cards.count() === 0, 'the alias is still in the list');
  assert(await focusText() === 'H1:Who leaked me', 'after the last hint went away the focus is not on the heading: ' + await focusText());
  await waitSenders(made.shop, ['shop.example', 'other.example']);
  t.ok('keyboard only: from Home to the list; "This sender is expected" takes the hint away; the screen then says "No alias looks leaked"');

  // ---- it stays after a reload; the server cannot read the list ----
  await page.reload();
  await page.getByRole('heading', { name: 'Who leaked me', level: 1 }).waitFor();
  await done(page);
  await page.getByRole('heading', { name: 'No alias looks leaked' }).waitFor();
  assert(JSON.stringify(await sendersOf(made.shop)) === JSON.stringify(['shop.example', 'other.example']), 'the expected sender was lost after a reload');
  const raw = await page.evaluate(() => fetch('/api/aliases').then((r) => r.text()));
  assert(!raw.includes('other.example') && !raw.includes('shop.example'), 'the known senders are readable in the answer of the server');
  await page.goto(t.base + '/');
  await link.waitFor();
  await settle(page);
  assert(await link.locator('[data-leaks]').count() === 0, 'Home still shows a number after the sender was expected');
  t.ok('the expected sender is saved encrypted and stays after a reload; Home shows no number then');

  // ---- a third sender: "Turn off this alias" ----
  await mail(made.shopAddress, 'win@prize.example', 'You won');
  await link.locator('[data-leaks="1"]').waitFor();
  await link.click();
  await done(page);
  await card.locator('[data-hint="prize.example"]').waitFor();
  assert(clean(await card.textContent()).includes('Expected: shop.example, other.example'), 'the card does not list both expected senders');
  const off = card.getByRole('button', { name: 'Turn off this alias' });
  assert(await off.getAttribute('aria-label') === `Turn off this alias: ${made.shopAddress}`, 'the button does not name its alias');
  await off.click();
  await page.getByText('Alias turned off. Mail to it is refused.').first().waitFor();
  await card.getByText('This alias is off. Mail to it is refused.').waitFor();
  assert((await card.locator('.item-sub > *').allTextContents()).join('|') === 'Maple Shop|Possibly leaked|Off|Shopping', 'the card does not show that the alias is off');
  assert(await card.getByRole('button', { name: 'Turn off this alias' }).count() === 0, 'the button is still there');
  assert(await inApp(page, ({ store }, id) => store.get('aliases').find((a) => a.id === id).enabled, made.shop) === false, 'the alias is still on');
  assert(await focusText() === `H2:${made.shopAddress}`, 'after "Turn off this alias" the focus is not on the card: ' + await focusText());
  t.ok('"Turn off this alias" turns the alias off; the card stays and says that the alias is off');
  await d.close();

  // ---- phone: 390px and 360px, in a new session ----
  const p = await t.open({ width: 390, height: 844 });
  await signIn(p.page, t.base, key);
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await p.page.setViewportSize(size);
    await p.page.goto(t.base + '/leaks');
    await done(p.page);
    await p.page.locator(`article[data-alias="${made.shop}"] [data-hint="prize.example"]`).waitFor();
    const m = await p.page.evaluate(() => {
      const box = (el) => el.getBoundingClientRect();
      const wide = document.documentElement.clientWidth;
      return {
        overflow: document.documentElement.scrollWidth - wide,
        // A small mark that is a link (the identity) and the small "Why?" button have a 44px touch area around them
        // (.tag-link and .why-btn in components.css).
        small: [...document.querySelectorAll('#main a, #main button')].filter((el) => !el.classList.contains('tag-link') && !el.classList.contains('why-btn') && box(el).height > 0 && box(el).height < 44).map((el) => `${el.textContent.trim().slice(0, 24)} (${Math.round(box(el).height)}px)`),
        outside: [...document.querySelectorAll('#main article, #main article *')].filter((el) => box(el).width > 0 && (box(el).left < 0 || box(el).right > wide + 0.5)).length,
      };
    });
    assert(m.overflow <= 0, `"Who leaked me" scrolls sideways at ${size.width}px (${m.overflow}px)`);
    assert(m.outside === 0, `"Who leaked me": ${m.outside} part(s) of a card do not fit at ${size.width}px`);
    assert(m.small.length === 0, `"Who leaked me": targets under 44px at ${size.width}px: ${m.small.join(', ')}`);
    t.ok(`phone ${size.width}px: a new session finds the hint again; no sideways scroll, the card fits, targets are 44px high`);
  }
  await p.close();

  // ---- a new account: nothing looks leaked ----
  const n = await t.open();
  await signUp(n.page, t.base);
  await n.page.goto(t.base + '/leaks');
  await n.page.getByRole('heading', { name: 'No alias looks leaked' }).waitFor();
  t.ok('a new account: "No alias looks leaked"');
  await n.close();
}
