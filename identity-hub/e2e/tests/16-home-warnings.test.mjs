// Home warnings: the balance will not cover the next renewals, and paused inboxes and numbers.
// The test sets the states in the database of its temporary server.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { signUp, signIn, seedAccount, inApp, assert } from '../lib.mjs';

const DAY = 86400;

export default async function (t) {
  const d = await t.open();
  const { page } = d;
  const key = await signUp(page, t.base);
  const ids = await seedAccount(page);
  const accountId = await inApp(page, ({ store }) => store.get('account').id);
  const now = Math.floor(Date.now() / 1000);
  const sql = (text, ...args) => { const db = new DatabaseSync(join(t.server.dataDir, 'accounts.db')); try { db.prepare(text).run(...args); } finally { db.close(); } };
  const reload = () => inApp(page, ({ data }) => data.loadAll());
  const slot = page.locator('.home-slot[data-section="warnings"]');
  const dayText = (at) => new Date(at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  // (c) nothing to warn about: nothing shows, and it takes no space
  await page.goto(t.base + '/');
  await page.locator('.item-row').first().waitFor();
  assert(await slot.evaluate((el) => el.getBoundingClientRect().height) === 0, 'a warning block shows when there is nothing to warn about');
  t.ok('no warning when the balance covers everything');

  // (a) renewals in the next 7 days cost more than the balance
  const dueBox = now + 3 * DAY;
  const dueNumber = now + 5 * DAY;
  sql('UPDATE mailboxes SET paid_until = ? WHERE id = ?', dueBox, ids.personal);
  sql('UPDATE numbers SET paid_until = ? WHERE id = ?', dueNumber, ids.n1);
  sql('UPDATE accounts SET balance = ? WHERE id = ?', 300, accountId);
  await reload();
  const renew = slot.locator('[data-warning="renewals"]');
  await renew.getByText('Your balance does not cover the next renewals').waitFor();
  const text = (await renew.textContent()).replace(/\s+/g, ' ');
  assert(text.includes('2 renewals in the next 7 days cost $5.00. Your balance is $3.00.'), 'the total or the balance is wrong: ' + text);
  assert(text.includes(`Inbox Personal: $1.00 on ${dayText(dueBox)}`), 'the inbox is not named with its price and day: ' + text);
  assert(text.includes(`+1 415 555 0100 (Selling the bike): $4.00 on ${dayText(dueNumber)}`), 'the number is not named with its price and day: ' + text);
  assert(text.includes(`The first one is on ${dayText(dueBox)}.`), 'the day of the first renewal is missing: ' + text);
  assert(text.indexOf('Inbox Personal') < text.indexOf('+1 415 555 0100'), 'the earliest renewal is not first');
  assert(await slot.locator('[data-warning="paused"]').count() === 0, 'a paused warning shows for active items');
  const above = await page.evaluate(() => document.querySelector('.home-slot[data-section="warnings"]').getBoundingClientRect().bottom <= document.querySelector('.stats').getBoundingClientRect().top);
  assert(above, 'the warning is not above the counts');
  t.ok('renewals: names the items, the total, the balance and the first day');

  // "Add funds" works with the keyboard
  await renew.getByRole('link', { name: 'Add funds' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Funds', level: 1 }).waitFor();
  await page.goBack();
  await slot.locator('[data-warning="renewals"]').waitFor();
  t.ok('"Add funds" in the warning opens Funds');

  // enough balance again: the warning goes away
  sql('UPDATE accounts SET balance = ? WHERE id = ?', 500, accountId);
  await reload();
  await slot.locator('[data-warning="renewals"]').waitFor({ state: 'detached' });
  t.ok('the renewal warning goes away when the balance covers the total');

  // (b) paused: an inbox and a number (with its release day)
  const numberPaid = now - 2 * DAY;
  const graceDays = await inApp(page, ({ store }) => store.get('config').graceDays);
  sql("UPDATE mailboxes SET status = 'suspended', paid_until = ? WHERE id = ?", now - DAY, ids.side);
  sql("UPDATE numbers SET status = 'suspended', paid_until = ? WHERE id = ?", numberPaid, ids.n2);
  await reload();
  const paused = slot.locator('[data-warning="paused"]');
  await paused.getByText('2 things are paused').waitFor();
  const ptext = (await paused.textContent()).replace(/\s+/g, ' ');
  assert(ptext.includes('Inbox Side project is paused. It receives no mail.'), 'the paused inbox is not explained: ' + ptext);
  assert(ptext.includes('+1 212 555 0100 (Deliveries) is paused. It receives no texts and no calls.'), 'the paused number is not explained: ' + ptext);
  assert(ptext.includes(`It is released on ${dayText(numberPaid + graceDays * DAY)} if the balance stays too low.`), 'the release day is wrong: ' + ptext);
  assert(!/Inbox Side project[^.]*\.[^.]*\.[^.]*released/.test(ptext.split('+1 212')[0]), 'an inbox is said to be released');
  await paused.getByRole('link', { name: 'Add funds' }).waitFor();
  // a paused item is not counted as a renewal
  assert(await slot.locator('[data-warning="renewals"]').count() === 0, 'a paused item is counted as a renewal');
  t.ok('paused: says what it means for an inbox and for a number, with the release day of the number');
  await d.close();

  // phone: both warnings at once, no sideways scroll, a large enough "Add funds"
  sql('UPDATE accounts SET balance = ? WHERE id = ?', 0, accountId);
  const p = await t.open({ width: 360, height: 640 });
  await signIn(p.page, t.base, key);
  const pslot = p.page.locator('.home-slot[data-section="warnings"]');
  await pslot.locator('[data-warning="paused"]').waitFor();
  await pslot.locator('[data-warning="renewals"]').waitFor();
  const wide = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(wide <= 0, 'the warnings make the phone screen scroll sideways');
  const small = await pslot.getByRole('link', { name: 'Add funds' }).evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height < 40).length);
  assert(small === 0, '"Add funds" is too small for a finger');
  t.ok('phone (360px): both warnings fit');
  await p.close();
}
