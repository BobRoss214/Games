// "Possibly leaked": an alias learns its first sender. Mail from a different sender gives a hint
// on the row and a panel in that mail, with "This sender is expected" and "Turn off this alias".
import { signUp, signIn, seedAccount, inApp, settle, assert } from '../lib.mjs';

export default async function (t) {
  const d = await t.open();
  const { page } = d;
  const key = await signUp(page, t.base);
  const ids = await seedAccount(page);
  const sendersOf = (id) => inApp(page, ({ store }, id) => (store.get('aliases').find((a) => a.id === id).extra.senders) || null, id);
  const mail = (from, subject) => inApp(page, ({ api }, m) => api.post('/api/dev/inbound-mail', { to: m.to, from: m.from, subject: m.subject, text: 'Hello.' }), { to: ids.shopAddress, from, subject });
  const waitSenders = async (id, want) => {
    for (let i = 0; i < 80; i++) { const s = await sendersOf(id); if (JSON.stringify(s) === JSON.stringify(want)) return; await page.waitForTimeout(100); }
    throw new Error(`the known senders are ${JSON.stringify(await sendersOf(id))}, not ${JSON.stringify(want)}`);
  };

  // ---- the first sender is learned; no hint ----
  await page.goto(t.base + '/aliases');
  await waitSenders(ids.shop, ['shop.example']);
  await settle(page);
  const row = page.locator(`.item-row[data-id="${ids.shop}"]`);
  await row.waitFor();
  assert(await page.locator('[data-leak]').count() === 0, 'a hint shows before any second sender wrote');
  const label = await inApp(page, ({ store }, id) => store.get('aliases').find((a) => a.id === id).label, ids.shop);
  assert(label === 'Maple Shop', 'the label was lost when the sender was saved');
  t.ok('the first sender of an alias is saved as known (encrypted), and gives no hint');

  // ---- the same company from another server name: no hint ----
  await mail('news@mail.shop.example', 'Our autumn news');
  await page.waitForTimeout(1200);
  await settle(page);
  assert(await row.locator('[data-leak]').count() === 0, 'a second address of the same domain gives a hint');
  t.ok('mail from another address of the same main domain gives no hint');

  // ---- a different sender: hint on the row, panel in the mail ----
  await mail('deals@other-seller.example', 'Cheap watches for you');
  await row.locator('[data-leak]', { hasText: 'Possibly leaked' }).waitFor();
  await page.goto(t.base + '/');
  await page.locator(`.item-row[data-id="${ids.shop}"]`).waitFor({ state: 'detached' }).catch(() => {});
  await page.goto(`${t.base}/mail/${ids.personal}`);
  await page.locator('.msg-row', { hasText: 'Cheap watches for you' }).click();
  const panel = page.locator('[data-leak-panel]');
  await panel.getByText('This alias was possibly leaked').waitFor();
  const text = (await panel.textContent()).replace(/\s+/g, ' ');
  assert(text.includes('This alias normally gets mail from shop.example. This message says that it is from other-seller.example.'), 'the panel does not name the senders: ' + text);
  assert(/possibly/.test(text) && text.includes('the From line of a mail can be forged, and one company can use several domains'), 'the panel does not say that it is only a hint: ' + text);
  // the mail of the known sender shows no panel
  await page.locator('.msg-row', { hasText: 'Your order 1042' }).click();
  await page.locator('.message-subject', { hasText: 'Your order 1042' }).waitFor();
  assert(await page.locator('[data-leak-panel]').count() === 0, 'the mail of the known sender shows the panel');
  t.ok('a new sender: "Possibly leaked" on the row; the mail names the usual sender and the new one, and says "possibly"');

  // ---- "This sender is expected", with the keyboard ----
  await page.locator('.msg-row', { hasText: 'Cheap watches for you' }).click();
  await panel.getByRole('button', { name: 'This sender is expected' }).focus();
  await page.keyboard.press('Enter');
  await page.getByText('Saved. Mail from other-seller.example gives no hint from now on.').waitFor();
  await panel.waitFor({ state: 'detached' });
  await waitSenders(ids.shop, ['shop.example', 'other-seller.example']);
  await page.goto(t.base + '/aliases');
  await page.locator(`.item-row[data-id="${ids.shop}"]`).waitFor();
  await settle(page);
  assert(await page.locator('[data-leak]').count() === 0, 'the hint stays after "This sender is expected"');
  // the server holds nothing readable about the senders
  const raw = await page.evaluate(() => fetch('/api/aliases').then((r) => r.text()));
  assert(!raw.includes('shop.example') && !raw.includes('other-seller'), 'the known senders are readable in the server answer');
  t.ok('"This sender is expected": the panel and the mark go away; the list is saved encrypted');

  // ---- a third sender: "Turn off this alias" from the panel ----
  await mail('win@prize-draw.example', 'You won');
  await page.locator(`.item-row[data-id="${ids.shop}"] [data-leak]`).waitFor();
  await page.goto(`${t.base}/mail/${ids.personal}`);
  await page.locator('.msg-row', { hasText: 'You won' }).click();
  await page.locator('[data-leak-panel="prize-draw.example"]').getByRole('button', { name: 'Turn off this alias' }).click();
  await page.getByText('Alias turned off. Mail to it is refused.').waitFor();
  await page.locator('[data-leak-panel]').getByText('This alias is off. Mail to it is refused.').waitFor();
  const enabled = await inApp(page, ({ store }, id) => store.get('aliases').find((a) => a.id === id).enabled, ids.shop);
  assert(enabled === false, 'the alias is still on');
  t.ok('"Turn off this alias" in the panel turns the alias off');
  await d.close();

  // ---- a new browser session finds the hint again; phone width ----
  const p = await t.open({ width: 360, height: 640 });
  await signIn(p.page, t.base, key);
  await p.page.goto(t.base + '/aliases');
  await p.page.locator(`.item-row[data-id="${ids.shop}"] [data-leak]`).waitFor();
  await p.page.goto(`${t.base}/mail/${ids.personal}`);
  await p.page.locator('.msg-row', { hasText: 'You won' }).click();
  await p.page.locator('[data-leak-panel]').waitFor();
  const wide = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(wide <= 0, 'the panel makes the phone screen scroll sideways');
  t.ok('phone (360px): the hint is found again after sign-in, and the panel fits');
  await p.close();
}
