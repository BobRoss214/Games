// "My stats" (web/js/features/insights.js): the counts match the mail exactly, the screen asks
// the server only for the mail list and stores nothing, "Cancel", an error, the limit of
// 1,000 mails, the keyboard, and a phone screen.
import { signUp, signIn, addCredit, inApp, settle, assert } from '../lib.mjs';

// Records every request of a page from now on. Each entry: "GET /path?query".
function watchRequests(page) {
  const list = [];
  const fn = (r) => { const u = new URL(r.url()); list.push(`${r.method()} ${u.pathname}${u.search}`); };
  page.on('request', fn);
  return { list, stop() { page.off('request', fn); return list; } };
}
const onlyMailList = (list) => list.every((r) => /^GET \/api\/messages\?/.test(r) && r.includes('direction=in'));
const kept = (page) => page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie]));
const rowsOf = (page, name) => page.locator(`[data-list="${name}"] > li`).evaluateAll((els) => els.map((el) => ({
  value: el.querySelector('.item-value').textContent,
  sub: [...el.querySelectorAll('.item-sub > *')].map((x) => x.textContent),
  count: el.querySelector('[data-count]').textContent,
})));
const done = (page) => page.locator('[data-report="done"]').waitFor();

export default async function (t) {
  const d = await t.open();
  const { page } = d;
  const key = await signUp(page, t.base);
  await addCredit(page, 20);
  const made = await inApp(page, async ({ data, api }) => {
    const box = await data.createMailbox({ label: 'Personal' });
    const shop = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Maple Shop' });
    const forum = await data.createAlias({ mailboxId: box.mailbox.id, label: '' });
    await data.createAlias({ mailboxId: box.mailbox.id, label: 'No mail here' });
    const long = await data.createAlias({ mailboxId: box.mailbox.id, label: 'A long one', localPart: 'this.is.a-very-long_address.that.goes.on.and.on.for.testing' + Math.floor(Math.random() * 900 + 100) });
    const mail = (to, from) => api.post('/api/dev/inbound-mail', { to, from, subject: 'Hello', text: 'Hello.' });
    for (let i = 0; i < 3; i++) await mail(shop.address, 'orders@shop.example');
    await mail(shop.address, 'news@mail.shop.example');           // the same main domain as orders@shop.example
    for (let i = 0; i < 2; i++) await mail(forum.address, 'no-reply@forum.example');
    await mail(long.address, 'Offers@List-Broker.Example');
    await mail(box.address, 'lena@friends.example');              // to the address of the inbox: no alias
    await data.updateAlias(forum.alias.id, { enabled: false });
    await data.loadAll();
    return { shop: shop.address, forum: forum.address, long: long.address };
  });
  const today = await page.evaluate(async () => {
    const { dayText } = await import('/js/lib/format.js');
    const now = new Date();
    return dayText(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  });
  const last = `Last mail ${today}`;

  // ---- Home: two plain links, low on the page, no menu item ----
  await page.goto(t.base + '/');
  const block = page.locator('[data-section="insights"]');
  await block.getByRole('link', { name: 'My stats' }).waitFor();
  await block.getByRole('link', { name: 'Who leaked me' }).waitFor();
  const low = await page.evaluate(() => document.querySelector('[data-section="insights"]').getBoundingClientRect().top >= document.querySelector('.home-grid').getBoundingClientRect().bottom);
  assert(low, 'the links are not at the end of Home');
  const menu = await page.locator('.sidebar .nav-item').allTextContents();
  assert(!menu.some((x) => /stats|leaked/i.test(x)), 'the feature added a place to the main menu: ' + menu.join('|'));
  t.ok('Home has the links "My stats" and "Who leaked me" at its end; the main menu is as before');

  // ---- the counts; only the mail list is asked for; nothing is stored ----
  await settle(page);
  const before = await kept(page);
  let seen = watchRequests(page);
  await block.getByRole('link', { name: 'My stats' }).click();
  await page.getByRole('heading', { name: 'My stats', level: 1 }).waitFor();
  await done(page);
  await page.waitForTimeout(300);
  let requests = seen.stop();
  assert(requests.length === 1 && onlyMailList(requests), 'the screen made other requests than one read of the mail list: ' + requests.join(', '));
  assert(await kept(page) === before, 'the screen changed what the browser keeps (storage or cookie)');
  assert(await page.evaluate(() => location.pathname + location.search + location.hash) === '/stats', 'the address holds more than the name of the screen');
  assert((await page.title()).startsWith('My stats · '), 'the title is wrong: ' + await page.title());
  assert(await page.locator('.sidebar .nav-item[aria-current="page"]').textContent() === 'Home', 'Home is not the marked place');
  assert(await page.locator('h1').count() === 1, 'the screen does not have exactly one h1');
  await page.getByText('Counted in this browser. The server keeps no stats.').waitFor();
  assert(await page.locator('[data-basis]').textContent() === 'Counted from all your 8 mails.', 'the line about the counted mail is wrong: ' + await page.locator('[data-basis]').textContent());
  await page.getByRole('heading', { name: 'Aliases with the most mail', level: 2 }).waitFor();
  await page.getByRole('heading', { name: 'Who mails you most', level: 2 }).waitFor();
  await page.getByText('A sender name can be forged. This is a count of what the mails say.').waitFor();
  const aliases = await rowsOf(page, 'aliases');
  assert(JSON.stringify(aliases) === JSON.stringify([
    { value: made.shop, sub: ['Maple Shop', last], count: '4 mails' },
    { value: made.forum, sub: ['No label', 'Off', last], count: '2 mails' },
    { value: made.long, sub: ['A long one', last], count: '1 mail' },
  ]), 'the list of aliases is wrong: ' + JSON.stringify(aliases));
  const senders = await rowsOf(page, 'senders');
  assert(JSON.stringify(senders.map((r) => [r.value, r.count])) === JSON.stringify([['shop.example', '4 mails'], ['forum.example', '2 mails'], ['friends.example', '1 mail'], ['list-broker.example', '1 mail']]), 'the list of senders is wrong: ' + JSON.stringify(senders));
  t.ok('the counts match the mail: 4, 2 and 1 for the aliases (an alias with no mail and the inbox address are not in the list); senders by main domain');
  t.ok('the screen makes one request, for the mail list, and stores nothing');

  // ---- "Count again" counts again ----
  await inApp(page, ({ api }, to) => api.post('/api/dev/inbound-mail', { to, from: 'deals@other.example', subject: 'Deals', text: 'Hello.' }), made.shop);
  await settle(page);
  seen = watchRequests(page);
  await page.getByRole('button', { name: 'Count again' }).click();
  await page.locator('[data-basis]', { hasText: 'Counted from all your 9 mails.' }).waitFor();
  await page.waitForTimeout(300);
  requests = seen.stop();
  assert(requests.length === 1 && onlyMailList(requests), '"Count again" made other requests than one read of the mail list: ' + requests.join(', '));
  assert((await rowsOf(page, 'aliases'))[0].count === '5 mails', '"Count again" did not count the new mail');
  assert((await rowsOf(page, 'senders')).some((r) => r.value === 'other.example' && r.count === '1 mail'), 'the new sender is not in the list');
  t.ok('"Count again" reads the mail again and shows the new mail');

  // ---- progress in words and "Cancel", with the keyboard ----
  let slow = true;
  await page.route('**/api/messages?*', async (route) => { if (slow) await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  await page.getByRole('button', { name: 'Count again' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('status').filter({ hasText: 'Reading your mail' }).waitFor();
  await page.getByRole('button', { name: 'Cancel' }).focus();
  await page.keyboard.press('Enter');
  await page.getByText('Stopped. Nothing was counted.').waitFor();
  assert(await page.evaluate(() => document.activeElement.textContent) === 'Count again', 'after "Cancel" the focus is not on "Count again"');
  await page.waitForTimeout(1900); // the answer of the stopped read arrives now; it must not show
  assert(await page.locator('[data-report]').getAttribute('data-report') === 'stopped' && await page.locator('[data-list]').count() === 0, 'a stopped read still showed its result');
  slow = false;
  await page.keyboard.press('Enter');
  await done(page);
  assert((await rowsOf(page, 'aliases')).length === 3, 'the count after a stop is wrong');
  t.ok('while it reads, the screen says so and has "Cancel"; a stopped read shows nothing; the keyboard starts it again');

  // ---- the server does not answer: an error with "Try again" ----
  d.allow(/ERR_FAILED|Failed to load resource/);
  let broken = true;
  await page.unroute('**/api/messages?*');
  await page.route('**/api/messages?*', (route) => (broken ? route.abort() : route.continue()));
  await page.getByRole('button', { name: 'Count again' }).click();
  await page.getByText('Cannot reach the server. Check your connection, then try again.').waitFor();
  broken = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await done(page);
  await page.unroute('**/api/messages?*');
  t.ok('an error shows in plain words with "Try again"');

  // ---- keyboard only: Home -> My stats -> Count again -> back to Home ----
  await page.goto(t.base + '/');
  await block.getByRole('link', { name: 'My stats' }).waitFor();
  const focusText = () => page.evaluate(() => `${document.activeElement.tagName}:${(document.activeElement.textContent || '').trim()}`);
  const tabTo = async (want, press = 'Tab') => {
    for (let i = 0; i < 80; i++) { await page.keyboard.press(press); if (await focusText() === want) return; }
    throw new Error(`the keyboard did not reach ${want}`);
  };
  await tabTo('A:My stats');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'My stats', level: 1 }).waitFor();
  await done(page);
  await tabTo('BUTTON:Count again');
  await page.keyboard.press('Enter');
  await done(page);
  await tabTo('A:Home', 'Shift+Tab');
  assert(await page.evaluate(() => document.activeElement.classList.contains('back-link')), 'Shift+Tab did not reach the back link');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor();
  t.ok('keyboard only: from Home to "My stats", "Count again", and back');
  await d.close();

  // ---- phone: 390px and 360px ----
  const p = await t.open({ width: 390, height: 844 });
  await signIn(p.page, t.base, key);
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await p.page.setViewportSize(size);
    await p.page.goto(t.base + '/stats');
    await done(p.page);
    const m = await p.page.evaluate(() => {
      const box = (el) => el.getBoundingClientRect();
      const wide = document.documentElement.clientWidth;
      return {
        overflow: document.documentElement.scrollWidth - wide,
        small: [...document.querySelectorAll('#main a, #main button')].filter((el) => box(el).height > 0 && box(el).height < 44).map((el) => `${el.textContent.trim().slice(0, 24)} (${Math.round(box(el).height)}px)`),
        outside: [...document.querySelectorAll('#main li, #main .item-value, #main [data-count]')].filter((el) => box(el).left < 0 || box(el).right > wide + 0.5).length,
      };
    });
    assert(m.overflow <= 0, `"My stats" scrolls sideways at ${size.width}px (${m.overflow}px)`);
    assert(m.outside === 0, `"My stats": ${m.outside} part(s) of a row do not fit at ${size.width}px`);
    assert(m.small.length === 0, `"My stats": targets under 44px at ${size.width}px: ${m.small.join(', ')}`);
    t.ok(`phone ${size.width}px: no sideways scroll, the long address wraps, targets are 44px high`);
  }
  await p.close();

  // ---- a new account: nothing to count; then more mail than the limit ----
  const n = await t.open();
  await signUp(n.page, t.base);
  await n.page.getByRole('heading', { name: 'Home', level: 1 }).waitFor();
  assert(await n.page.locator('[data-section="insights"] a').count() === 0, 'Home shows the links before there is an inbox');
  await n.page.goto(t.base + '/stats');
  await n.page.getByRole('heading', { name: 'No mail yet' }).waitFor();
  t.ok('a new account: Home has no links yet, and the screen says "No mail yet"');

  await addCredit(n.page, 20);
  await inApp(n.page, async ({ data, api }) => {
    const box = await data.createMailbox({ label: 'Box' });
    const busy = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Busy' });
    let next = 0;
    const worker = async () => { while (next < 1030) { const i = next++; await api.post('/api/dev/inbound-mail', { to: busy.address, from: `news@sender${i % 7}.example`, subject: `Mail ${i}`, text: 'x' }); } };
    await Promise.all(Array.from({ length: 12 }, worker));
    await data.loadAll();
  });
  await settle(n.page);
  seen = watchRequests(n.page);
  await n.page.getByRole('button', { name: 'Count again' }).click();
  await n.page.locator('[data-basis]', { hasText: 'Counted from your newest 1,000 mails.' }).waitFor({ timeout: 60_000 });
  await n.page.waitForTimeout(300);
  requests = seen.stop();
  assert(requests.length === 10 && onlyMailList(requests), `1,000 mails were not read in 10 requests for the mail list: ${requests.length} request(s)`);
  assert((await rowsOf(n.page, 'aliases'))[0].count === '1,000 mails', 'the count of the busy alias is not 1,000');
  const sum = (await rowsOf(n.page, 'senders')).reduce((total, r) => total + Number(r.count.replace(/\D/g, '')), 0);
  assert(sum === 1000, `the senders add up to ${sum}, not to 1,000`);
  t.ok('1,030 mails: the screen reads the newest 1,000 in 10 requests, and says "Counted from your newest 1,000 mails."');
  await n.close();
}
