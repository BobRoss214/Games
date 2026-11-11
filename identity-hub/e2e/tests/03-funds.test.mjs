// Private payments: no cookie on payment requests, a purchase survives a reload and is
// finished in the background, the largest amount, several waiting payments, remove.
import { signUp, inApp, assert } from '../lib.mjs';

export default async function (t) {
  const s = await t.open();
  const { page } = s;
  await signUp(page, t.base);
  await page.goto(t.base + '/funds');

  await page.getByLabel('Amount in US dollars').fill('201');
  await page.getByRole('button', { name: 'Add funds' }).click();
  await page.getByText('Enter whole dollars from $5 to $200.').waitFor();
  t.ok('an amount outside the limits is refused on the screen');

  // payment requests carry no cookie
  const seen = [];
  page.on('request', (r) => { if (/\/api\/(pay\/|dev\/pay-invoice)/.test(r.url())) seen.push(r); });
  await page.getByLabel('Amount in US dollars').fill('7');
  await page.getByText('Monero', { exact: true }).click();
  await page.getByRole('button', { name: 'Add funds' }).click();
  await page.getByText('Waiting for payment').waitFor({ timeout: 30_000 });

  // reload: the purchase is read from the vault again
  await page.reload();
  await page.getByText('Waiting for payment').waitFor({ timeout: 15_000 });
  t.ok('a waiting payment is still there after a reload');

  // paid from outside the screen: the app finishes it by itself and empties the vault entry
  const invoiceId = await inApp(page, async ({ session }) => (await session.vaultGet('pending-purchases', { fresh: true }))[0].invoiceId);
  await page.evaluate((id) => fetch('/api/dev/pay-invoice', { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }), invoiceId);
  await page.getByText('Done', { exact: true }).waitFor({ timeout: 30_000 });
  await page.locator('.balance-value').filter({ hasText: '$7.00' }).waitFor();
  assert((await inApp(page, async ({ session }) => session.vaultGet('pending-purchases', { fresh: true }))) === null, 'the vault entry was not removed');
  t.ok('a payment made in the background becomes credit; the saved secrets are removed');
  for (const r of seen) assert(!(await r.allHeaders()).cookie, 'a payment request carried the login cookie: ' + r.url());
  assert(seen.length >= 3, 'no payment requests were seen');
  t.ok('payment requests carry no cookie');

  // the largest amount, and three payments waiting together
  await page.getByLabel('Amount in US dollars').fill('200');
  await page.getByRole('button', { name: 'Add funds' }).click();
  await page.locator('.pay-row').filter({ hasText: '$200.00' }).filter({ hasText: 'Waiting for payment' }).waitFor({ timeout: 60_000 });
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('Amount in US dollars').fill('200');
    await page.getByRole('button', { name: 'Add funds' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('.pay-row .btn-primary').length >= n, i + 2, { timeout: 60_000 });
  }
  t.ok('three large payments can wait at the same time');
  await page.getByRole('button', { name: 'Simulate payment (test mode)' }).first().click();
  await page.locator('.balance-value').filter({ hasText: '$207.00' }).waitFor({ timeout: 60_000 });
  t.ok('a $200 payment becomes $200.00 of credit');
  const before = await page.locator('.pay-row').count();
  await page.getByRole('button', { name: 'Remove' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.pay-row').length === n - 1, before);
  t.ok('a waiting payment can be removed');

  // history
  await page.locator('.ledger tbody tr').filter({ hasText: 'Funds added' }).first().waitFor();
  t.ok('the history lists the top-ups');
}
