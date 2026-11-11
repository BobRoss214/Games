// Blocked senders (web/js/features/blocks.js): block the sender of a message (one address or
// the whole domain), see the list of an alias, unblock, add by hand. Mail from a blocked
// sender to that address is refused; other senders and other addresses are not touched.
import { signUp, addCredit, inApp, assert } from '../lib.mjs';

// Sends a test mail as if it came from the internet. Gives 'delivered' or the refusal.
const mail = (page, to, from, subject) => inApp(page, async ({ api }, m) => {
  try { await api.post('/api/dev/inbound-mail', m); return 'delivered'; } catch (err) { return `${err.status} ${err.message}`; }
}, { to, from, subject, text: 'Text of the test mail.' });
const REFUSED = '409 This address blocks this sender.';

async function openMessage(page, base, boxId, subject) {
  await page.goto(`${base}/mail/${boxId}`);
  await page.locator('.msg-row').filter({ hasText: subject }).click();
  await page.locator('.message-subject').filter({ hasText: subject }).waitFor();
}
const subjects = (page) => inApp(page, async ({ mail: m }) => (await m.listMessages({ direction: 'in', limit: 100 })).messages.map((x) => x.meta.subject));

export default async function (t) {
  const s = await t.open();
  const { page } = s;
  const dlg = page.getByRole('dialog');
  s.allow(/status of 409 .*\/api\/dev\/inbound-mail$/, /status of 400 .*\/api\/addresses\/[^/]+\/blocks$/); // refused on purpose
  await signUp(page, t.base);
  await addCredit(page, 10);
  const x = await inApp(page, async ({ data, api }) => {
    const box = await data.createMailbox({ label: 'Main' });
    const shop = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Shop' });
    const other = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Other' });
    await api.post('/api/dev/inbound-mail', { to: shop.address, from: 'news@mail.shop.example', fromName: 'Maple Shop', subject: 'First newsletter', text: 'hello' });
    await api.post('/api/dev/inbound-mail', { to: box.address, from: 'pest@spam.example', subject: 'To the inbox itself', text: 'x' });
    return { box: box.mailbox.id, boxAddress: box.address, shop: shop.address, other: other.address };
  });
  const shopRow = () => page.locator('.item-row[data-kind="alias"]').filter({ hasText: x.shop });

  // ---- from a message: one address ----
  await openMessage(page, t.base, x.box, 'First newsletter');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Block this sender' }).click();
  await dlg.getByRole('heading', { name: 'Block this sender' }).waitFor();
  await dlg.getByText(`Mail from this sender to ${x.shop} is refused. Everything else on this alias keeps working.`).waitFor();
  assert(await dlg.getByLabel('Only this address: news@mail.shop.example').isChecked(), 'the one address is not the first choice');
  await dlg.getByLabel('All addresses at shop.example').waitFor(); // the main domain, not the mail server name
  await dlg.getByRole('button', { name: 'Block sender' }).click();
  await page.getByText('Blocked news@mail.shop.example. Mail from it to this alias is refused.').waitFor();
  assert(await mail(page, x.shop, 'news@mail.shop.example', 'Second newsletter') === REFUSED, 'mail from the blocked address was not refused');
  assert(await mail(page, x.shop, 'NEWS@Mail.Shop.Example', 'Second newsletter, capital letters') === REFUSED, 'capital letters got around the block');
  assert(await mail(page, x.shop, 'friend@elsewhere.example', 'From a friend') === 'delivered', 'a different sender was refused');
  assert(await mail(page, x.shop, 'billing@mail.shop.example', 'From billing') === 'delivered', 'a different address of the domain was refused');
  assert(await mail(page, x.other, 'news@mail.shop.example', 'To the other alias') === 'delivered', 'the block touched a different alias');
  const got = await subjects(page);
  assert(!got.some((v) => v.startsWith('Second newsletter')) && got.includes('From a friend') && got.includes('To the other alias'), 'wrong mail in the inbox: ' + got.join(' | '));
  t.ok('block one address from a message: its mail is refused, everything else arrives');

  // ---- the row says it, and the list of the alias shows it ----
  await page.goto(t.base + '/aliases');
  await shopRow().getByText('1 blocked', { exact: true }).waitFor();
  assert(await page.locator('.item-row[data-kind="alias"]').filter({ hasText: x.other }).locator('[data-blocked]').count() === 0, 'the other alias shows a block');
  await shopRow().getByRole('button', { name: /More actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Blocked senders' }).click();
  await dlg.getByRole('heading', { name: 'Blocked senders' }).waitFor();
  const entry = (value) => dlg.locator('.phone-row').filter({ hasText: value });
  await entry('news@mail.shop.example').getByText('One address').waitFor();
  await dlg.getByRole('button', { name: 'What does a block do?' }).click();
  await dlg.locator('.why-panel').getByText('Only your browser can show the list.').waitFor();
  t.ok('the row shows "1 blocked"; the list opens the encrypted entry; the "why" button explains a block');

  // ---- add a whole domain by hand ----
  await dlg.getByLabel('Block an address or a domain').fill('not a domain');
  await dlg.getByRole('button', { name: 'Block', exact: true }).click();
  await dlg.getByText('This is not an email address or a domain.').waitFor();
  await dlg.getByLabel('Block an address or a domain').fill('Shop.Example');
  await dlg.getByRole('button', { name: 'Block', exact: true }).click();
  await entry('shop.example').filter({ hasText: 'Whole domain' }).waitFor();
  assert(await dlg.locator('.phone-row').count() === 2, 'the list does not have two entries');
  assert(await mail(page, x.shop, 'billing@mail.shop.example', 'From billing again') === REFUSED, 'the domain block does not cover a subdomain');
  assert(await mail(page, x.shop, 'owner@shop.example', 'From the owner') === REFUSED, 'the domain block does not cover the domain');
  assert(await mail(page, x.shop, 'x@myshop.example', 'From a look-alike') === 'delivered', 'the domain block covers a different domain');
  await dlg.getByRole('button', { name: 'Done' }).click();
  await shopRow().getByText('2 blocked', { exact: true }).waitFor();
  t.ok('a domain added by hand blocks the domain and its subdomains, not a look-alike');

  // ---- the list survives a reload; unblock ----
  await page.reload();
  await shopRow().getByText('2 blocked', { exact: true }).waitFor();
  await shopRow().getByRole('button', { name: /More actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Blocked senders' }).click();
  await entry('news@mail.shop.example').waitFor();
  await dlg.getByRole('button', { name: 'Unblock shop.example' }).click();
  await page.getByText('Unblocked all addresses at shop.example').waitFor();
  await dlg.getByRole('button', { name: 'Unblock news@mail.shop.example' }).click();
  await dlg.getByText('No blocked senders').waitFor();
  assert(await mail(page, x.shop, 'news@mail.shop.example', 'Third newsletter') === 'delivered', 'mail is still refused after "Unblock"');
  await dlg.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction((address) => ![...document.querySelectorAll('.item-row[data-kind="alias"]')].some((r) => r.textContent.includes(address) && r.querySelector('[data-blocked]')), x.shop);
  t.ok('the list survives a reload; after "Unblock" the mail arrives again and the mark is gone');

  // ---- the address of an inbox: block the whole domain from a message, then Undo ----
  await openMessage(page, t.base, x.box, 'To the inbox itself');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Block this sender' }).click();
  await dlg.getByText(`Everything else on this inbox keeps working.`).waitFor();
  await dlg.getByLabel('All addresses at spam.example').check();
  await dlg.getByRole('button', { name: 'Block sender' }).click();
  const notice = page.locator('.toast').filter({ hasText: 'Blocked all addresses at spam.example. Mail from them to this inbox is refused.' });
  await notice.waitFor();
  assert(await mail(page, x.boxAddress, 'other@spam.example', 'More spam') === REFUSED, 'the inbox address does not refuse the blocked domain');
  assert(await mail(page, x.shop, 'other@spam.example', 'Spam to the alias') === 'delivered', 'a block on the inbox address touched its alias');
  await page.goto(t.base + '/');
  await page.locator('.item-row[data-kind="inbox"]').getByText('1 blocked', { exact: true }).waitFor();
  t.ok('the address of an inbox blocks a domain; its aliases are not touched');
  await openMessage(page, t.base, x.box, 'To the inbox itself');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Block this sender' }).click();
  await dlg.getByRole('button', { name: 'Block sender' }).click();
  await page.locator('.toast').filter({ hasText: 'Blocked pest@spam.example.' }).getByRole('button', { name: 'Undo' }).click();
  await page.getByText('Unblocked pest@spam.example').waitFor();
  const left = await inApp(page, async ({ api, store }) => (await api.get(`/api/addresses/${store.get('mailboxes')[0].addressId}/blocks`)).blocks.length);
  assert(left === 1, `"Undo" left ${left} blocks on the inbox address`);
  // A sender that is blocked already: the notice has no "Undo", so an old block cannot go by mistake.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Block this sender' }).click();
  await dlg.getByLabel('All addresses at spam.example').check();
  await dlg.getByRole('button', { name: 'Block sender' }).click();
  const repeat = page.locator('.toast').filter({ hasText: 'Blocked all addresses at spam.example.' });
  await repeat.waitFor();
  assert(await repeat.getByRole('button', { name: 'Undo' }).count() === 0, 'a block that existed before offers "Undo"');
  t.ok('"Undo" in the notice takes the new block away, and only a new one');

  // ---- keyboard only: the row menu, the list, a new block ----
  await page.goto(t.base + '/aliases');
  await shopRow().getByRole('button', { name: /More actions for/ }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menu').waitFor();
  for (let i = 0; i < 20 && !(await page.evaluate(() => document.activeElement.textContent.trim() === 'Blocked senders')); i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await dlg.getByLabel('Block an address or a domain').waitFor();
  for (let i = 0; i < 12 && !(await page.evaluate(() => document.activeElement.tagName === 'INPUT')); i++) await page.keyboard.press('Tab');
  await page.keyboard.type('keys@typed.example');
  await page.keyboard.press('Enter');
  await entry('keys@typed.example').waitFor();
  await page.keyboard.press('Escape');
  await dlg.waitFor({ state: 'detached' });
  await shopRow().getByText('1 blocked', { exact: true }).waitFor();
  t.ok('keyboard only: menu, list, a new block, Escape');
  await s.close();

  // ---- phone screen ----
  const p = await t.open({ width: 390, height: 844 });
  await signUp(p.page, t.base);
  await addCredit(p.page, 10);
  await inApp(p.page, async ({ data, api }) => {
    const box = await data.createMailbox({ label: 'Main' });
    const a = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Shop' });
    for (const value of ['a-very-long-sender-name.for-the-phone-screen@a-long-subdomain.of-a-shop.example', 'shop.example']) {
      await api.post(`/api/addresses/${a.alias.id}/blocks`, { kind: value.includes('@') ? 'address' : 'domain', value });
    }
  });
  await p.page.goto(t.base + '/aliases');
  await p.page.locator('.item-row[data-kind="alias"]').getByText('2 blocked', { exact: true }).waitFor();
  await p.page.locator('.item-row[data-kind="alias"]').getByRole('button', { name: /More actions for/ }).click();
  await p.page.getByRole('menuitem', { name: 'Blocked senders' }).click();
  await p.page.getByRole('dialog').locator('.phone-row').nth(1).waitFor();
  const m = await p.page.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    const vw = document.documentElement.clientWidth;
    const out = [...d.querySelectorAll('*')].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 1 || b.left < -1); }).length;
    const low = [...d.querySelectorAll('button:not(.why-btn), input')].filter((el) => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 40).map((el) => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 24));
    return { out, low, scroll: document.documentElement.scrollWidth > vw || d.scrollWidth > d.clientWidth + 1 };
  });
  assert(m.out === 0 && !m.scroll, 'the list of blocked senders sticks out of the phone screen');
  assert(m.low.length === 0, 'small targets: ' + m.low.join(', '));
  t.ok('phone screen (390px): the list fits, with a long address');
  await p.close();
}
