// Numbers: search, a refused destination, phone link by call, a new code, the status of a
// sent text, automatic deletion of old texts, older texts on demand.
import { signUp, addCredit, inApp, lastPhoneCode, assert } from '../lib.mjs';

export default async function (t) {
  const s = await t.open();
  const { page } = s;
  const dlg = page.getByRole('dialog');
  s.allow(/status of 400 .*\/api\/phones/); // the refused destination and the old code, on purpose
  await signUp(page, t.base);
  await addCredit(page, 20);

  // search by country and area code, then buy on the screen
  await page.goto(t.base + '/numbers');
  await page.getByRole('button', { name: 'Get a number' }).first().click();
  await dlg.locator('.number-option').first().waitFor();
  await dlg.getByLabel('Area code').fill('abc');
  await dlg.getByRole('button', { name: 'Search' }).click();
  await dlg.getByText('Use numbers only.').waitFor();
  await dlg.getByLabel('Area code').fill('212');
  await dlg.getByRole('button', { name: 'Search' }).click();
  await dlg.locator('.number-option').filter({ hasText: '+1 212' }).first().getByRole('button', { name: /^Buy/ }).click();
  await dlg.getByLabel('Label').fill('Line');
  await dlg.getByRole('button', { name: /Buy for/ }).click();
  await page.locator('.number-heading').filter({ hasText: '+1 212' }).waitFor({ timeout: 10_000 });
  const numberId = new URL(page.url()).pathname.split('/').pop();
  t.ok('number search by area code, and purchase');

  // link a phone: a refused number, then by call (spoken code), then a new code by text
  await page.goto(t.base + '/numbers');
  await page.getByRole('button', { name: 'Link a phone' }).first().click();
  await dlg.getByLabel('Your real phone number').fill('+1 900 555 0100');
  await dlg.getByRole('button', { name: 'Send code' }).click();
  await dlg.locator('.field-error').filter({ hasText: /./ }).waitFor();
  t.ok('a destination that the server does not allow is refused with a clear message');
  await dlg.getByLabel('Your real phone number').fill('+14155550188');
  await dlg.getByText('Call that says the code').click();
  await dlg.getByText('The call with the code costs $0.03.').waitFor();
  await dlg.getByRole('button', { name: 'Send code' }).click();
  await page.getByRole('heading', { name: 'Enter the code' }).waitFor();
  await dlg.getByText('A voice says the code two times.').waitFor();
  let spoken = '';
  for (let i = 0; i < 30 && !spoken; i++) { await page.waitForTimeout(200); spoken = (await lastPhoneCode(page)).spoken; }
  assert(spoken.length === 6, 'the simulated call did not speak a code');
  await dlg.getByRole('button', { name: 'Send a new code' }).click();
  await page.getByText('New code sent').waitFor();
  await dlg.getByLabel('Code').fill(spoken);
  await dlg.getByRole('button', { name: 'Link phone' }).click();
  await dlg.locator('.field-error').filter({ hasText: /./ }).waitFor();
  await dlg.getByLabel('Code').fill((await lastPhoneCode(page)).text);
  await dlg.getByRole('button', { name: 'Link phone' }).click();
  await page.getByText('Phone linked', { exact: true }).waitFor();
  t.ok('phone link by call; a new code by text; the old code stops working');

  // status of a sent text
  await page.goto(t.base + '/numbers/' + numberId);
  await page.getByRole('button', { name: 'New text' }).click();
  await dlg.getByLabel('To').fill('+14155550123');
  await dlg.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.composer-input').fill('Status check');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('.bubble-row.is-out .bubble-status').filter({ hasText: 'Sent' }).waitFor();
  t.ok('a sent text shows its status');

  // automatic deletion of old texts
  await page.getByRole('tab', { name: 'Settings' }).click();
  const keep = page.getByLabel('Delete old texts', { exact: true });
  await keep.selectOption('30');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.number-settings select')].every((x) => x.value !== '30'));
  await page.getByLabel('Delete old texts', { exact: true }).selectOption('30');
  await dlg.getByRole('button', { name: 'Turn on' }).click();
  await page.getByText('Old texts are deleted from now on').waitFor();
  assert((await page.evaluate(() => fetch('/api/numbers').then((r) => r.json()).then((d) => d.numbers[0].retentionDays))) === 30, 'the server did not get the setting');
  await page.getByLabel('Delete old texts', { exact: true }).selectOption('');
  await page.getByText('All texts are kept from now on').waitFor();
  t.ok('automatic deletion of old texts: asks first, saves, can be turned off');

  // more than one page of texts
  await inApp(page, async ({ api, store, wait }, id) => {
    const n = store.get('numbers').find((x) => x.id === id);
    const send = (from, body) => api.post('/api/dev/inbound-text', { numberId: id, number: n.number, from, body });
    for (let i = 0; i < 30; i++) await send('+14155550900', 'old ' + i);
    await wait(1100);
    for (let i = 0; i < 100; i++) await send('+14155550901', 'mid ' + i);
    await wait(1100);
    for (let i = 0; i < 110; i++) await send('+14155550902', 'new ' + i);
  }, numberId);
  await page.goto(t.base + '/numbers/' + numberId);
  await page.locator('.thread').first().waitFor();
  assert((await page.locator('.thread').filter({ hasText: '555 0900' }).count()) === 0, 'the oldest texts are on the first page');
  await page.getByRole('button', { name: 'Show older texts' }).click();
  await page.locator('.thread').filter({ hasText: '555 0900' }).waitFor();
  t.ok('older texts load on demand');
}
