// Code helper: a text or an email with a sign-up code shows "Code … Copy".
// The code is found in the browser and is sent nowhere.
import { signUp, signIn, seedAccount, inApp, settle, assert } from '../lib.mjs';

export default async function (t) {
  const d = await t.open();
  const { page } = d;
  const key = await signUp(page, t.base);
  const ids = await seedAccount(page);
  // An email with a code to the shop alias; the alias and the first number go into one identity.
  const identityId = await inApp(page, async ({ api, identities, data }, ids) => {
    await api.post('/api/dev/inbound-mail', { to: ids.shopAddress, from: 'no-reply@shop.example', fromName: 'Maple Shop', subject: 'Your verification code', text: 'Hello,\n\nYour verification code is 482913.\nIt is valid for 10 minutes.\n' });
    const id = await identities.createIdentity({ name: 'Maple', note: '' });
    await data.setItemIdentity('alias', ids.shop, id);
    await data.setItemIdentity('number', ids.n1, id);
    await data.loadAll();
    return id;
  }, ids);
  const clip = () => page.evaluate(() => navigator.clipboard.readText());

  // ---- Home "Recent" ----
  await page.goto(t.base + '/');
  const recent = page.locator('.home-recent');
  const mailRow = recent.locator('li', { hasText: 'Your verification code' });
  await mailRow.locator('.code-chip', { hasText: '482913' }).waitFor();
  const textRow = recent.locator('li', { hasText: 'Your code is 448 201' });
  await textRow.locator('.code-chip', { hasText: '448 201' }).waitFor();
  assert(await recent.locator('li', { hasText: 'Your order 1042' }).locator('.code-chip').count() === 0, 'an order number is shown as a code');
  assert(await recent.locator('li', { hasText: 'Dinner on Friday' }).locator('.code-chip').count() === 0, 'a normal mail has a code chip');
  // Copy: the clipboard gets the digits; no request is made; the row is not opened
  await settle(page);
  const requests = [];
  const onRequest = (r) => { if (!r.url().includes('/api/events')) requests.push(r.url()); };
  page.on('request', onRequest);
  await textRow.getByRole('button', { name: 'Copy the code 448 201' }).click();
  await page.getByText('Code copied').waitFor();
  assert(await clip() === '448201', 'the clipboard has not the code: ' + await clip());
  await page.waitForTimeout(300);
  page.off('request', onRequest);
  assert(requests.length === 0, 'copying a code made a request: ' + requests.join(', '));
  assert(new URL(page.url()).pathname === '/', 'copying a code opened the message');
  t.ok('Home "Recent": chips for the text and the email with a code, none for other messages; copy makes no request');

  // keyboard: Tab from the row link reaches the Copy button, Enter copies
  await mailRow.getByRole('link').focus();
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement.classList.contains('code-copy')), 'Tab does not reach the Copy button after the row');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => navigator.clipboard.readText().then((v) => v === '482913'));
  t.ok('keyboard: Tab to "Copy", Enter copies');

  // ---- the email itself ----
  await mailRow.getByRole('link').click();
  const panel = page.locator('.message-panels .code-chip');
  await panel.getByText('482913').waitFor();
  await page.evaluate(() => navigator.clipboard.writeText('x'));
  await panel.getByRole('button', { name: /Copy the code/ }).click();
  await page.waitForFunction(() => navigator.clipboard.readText().then((v) => v === '482913'));
  await page.goto(`${t.base}/mail/${ids.personal}`);
  await page.locator('.msg-row', { hasText: 'Your order 1042' }).click();
  await page.locator('.message-subject', { hasText: 'Your order 1042' }).waitFor();
  await page.locator('.mail-body').waitFor();
  assert(await page.locator('.message .code-chip').count() === 0, 'the order mail shows a code');
  t.ok('email: the code shows above the text with Copy; a mail with an order number shows none');

  // ---- text bubble ----
  await page.goto(`${t.base}/numbers/${ids.n1}`);
  await page.locator('.thread', { hasText: '555 0188' }).click();
  await page.locator('.bubble .code-chip', { hasText: '448 201' }).waitFor();
  await page.goto(`${t.base}/numbers/${ids.n1}`);
  await page.locator('.thread', { hasText: '555 0142' }).click();
  await page.locator('.bubble').first().waitFor();
  assert(await page.locator('.bubble .code-chip').count() === 0, 'a text without a code shows a chip');
  t.ok('texts: the chip is under the text with the code only');

  // ---- identity feed ----
  await page.goto(`${t.base}/identities/${identityId}`);
  const feed = page.locator('.feed-list');
  await feed.locator('li', { hasText: 'Your verification code' }).locator('.code-chip', { hasText: '482913' }).waitFor();
  await feed.locator('li', { hasText: 'Your code is 448 201' }).locator('.code-chip', { hasText: '448 201' }).waitFor();
  assert(await feed.locator('.code-chip').count() === 2, 'the feed shows a wrong number of chips');
  await page.evaluate(() => navigator.clipboard.writeText('x'));
  await feed.getByRole('button', { name: 'Copy the code 448 201' }).click();
  await page.waitForFunction(() => navigator.clipboard.readText().then((v) => v === '448201'));
  assert(new URL(page.url()).pathname.startsWith('/identities/'), 'copying a code in the feed opened the item');
  t.ok('identity feed: chips with Copy');
  await d.close();

  // ---- phone ----
  const p = await t.open({ width: 360, height: 640 });
  await signIn(p.page, t.base, key);
  await p.page.locator('.home-recent .code-chip').first().waitFor();
  for (const path of ['/', `/identities/${identityId}`]) {
    await p.page.goto(t.base + path);
    await p.page.locator('.code-chip').first().waitFor();
    const wide = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(wide <= 0, `the chip makes the phone screen scroll sideways on ${path}`);
    const small = await p.page.locator('.code-copy').evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height < 44).length);
    assert(small === 0, `"Copy" is under 44px on ${path}`);
  }
  t.ok('phone (360px): chips fit and "Copy" is large enough');
  await p.close();
}
