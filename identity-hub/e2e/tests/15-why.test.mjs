// "Why?" buttons: a short explanation opens in place and closes again. Opening one asks
// the server for nothing and saves nothing ("do not track what I read").
import { signUp, signIn, seedAccount, inApp, settle, assert } from '../lib.mjs';

const KEYS = ['recovery-key', 'passkey', 'inbox-vs-alias', 'identity', 'made-up-details', 'link-phone', 'forwarding', 'payments',
  'alias-off', 'deleting', 'test-mode', 'balance', 'remote-images', 'delivery-status', 'phone-by-call'];

export default async function (t) {
  const d = await t.open();
  const { page } = d;
  const seen = new Set();
  const note = async () => { for (const k of await page.locator('.why-btn').evaluateAll((els) => els.map((el) => el.dataset.why))) seen.add(k); };

  // ---- sign-up: recovery key and passkey ----
  await page.goto(t.base + '/create');
  await page.getByRole('button', { name: 'Make my account' }).click();
  await page.getByRole('heading', { name: 'Save your recovery key' }).waitFor({ timeout: 60_000 });
  const key = (await page.locator('.keycard-group').allTextContents()).join('-');
  await note();
  const whyKey = page.getByRole('button', { name: 'Why a recovery key?' });
  assert(await whyKey.getAttribute('aria-expanded') === 'false', 'the explanation starts open');
  await whyKey.focus();
  await page.keyboard.press('Enter');
  assert(await whyKey.getAttribute('aria-expanded') === 'true', 'Enter did not open the explanation');
  const panel = page.locator('.why-panel[data-why="recovery-key"]');
  await panel.getByText('Postern shows it one time.').waitFor();
  assert(!(await panel.textContent()).includes('{app}'), 'the app name is not filled in');
  assert(new URL(page.url()).pathname === '/create', 'opening an explanation changed the address');
  await page.keyboard.press('Escape');
  assert(await panel.isHidden() && await whyKey.getAttribute('aria-expanded') === 'false', 'Escape did not close the explanation');
  assert(await page.evaluate(() => document.activeElement.classList.contains('why-btn')), 'the focus is lost after Escape');
  await page.keyboard.press('Space');
  await panel.getByRole('button', { name: 'Close' }).click();
  assert(await panel.isHidden(), 'the Close button did not close the explanation');
  t.ok('sign-up: "Why a recovery key?" opens in place with Enter, closes with Escape and with Close, the focus stays');
  await page.getByLabel('I saved my recovery key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Add a passkey' }).waitFor({ timeout: 60_000 });
  await note();
  await page.getByRole('button', { name: 'Why passkeys?' }).waitFor();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor();
  const ids = await seedAccount(page);

  // ---- no request, nothing saved ----
  await page.goto(t.base + '/settings');
  await page.getByRole('button', { name: 'Why passkeys?' }).waitFor();
  await settle(page); // the app finished its own loading
  const requests = [];
  const onRequest = (r) => { if (!r.url().includes('/api/events')) requests.push(r.url()); };
  page.on('request', onRequest);
  const before = await page.evaluate(() => JSON.stringify([Object.keys(localStorage).sort(), Object.keys(sessionStorage).sort(), document.cookie]));
  await page.getByRole('button', { name: 'Why passkeys?' }).click();
  await page.getByRole('button', { name: 'Why a recovery key?' }).click();
  await page.locator('.why-panel[data-why="passkey"]').getByText('A passkey works only on the real website of Postern.').waitFor();
  await page.locator('.why-panel[data-why="recovery-key"]').waitFor();
  await page.getByRole('button', { name: 'Why passkeys?' }).click();
  await page.waitForTimeout(400);
  page.off('request', onRequest);
  const after = await page.evaluate(() => JSON.stringify([Object.keys(localStorage).sort(), Object.keys(sessionStorage).sort(), document.cookie]));
  assert(requests.length === 0, 'opening an explanation made a request: ' + requests.join(', '));
  assert(before === after, 'opening an explanation saved something in the browser');
  assert(new URL(page.url()).pathname === '/settings' && !page.url().includes('#') && !page.url().includes('?'), 'opening an explanation changed the address');
  t.ok('opening and closing explanations makes no request, saves nothing, changes no address');
  await note();
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'What happens when I delete?' }).click();
  // Escape closes the explanation first, then the dialog.
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor();
  assert(await page.locator('dialog .why-panel').isHidden(), 'Escape in a dialog did not close the explanation');
  await note();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  t.ok('in a dialog: the first Escape closes the explanation, the second closes the dialog');

  // ---- every explanation has a place ----
  await page.goto(t.base + '/');
  await page.locator('.item-row').first().waitFor();
  await note();
  // the one on Home stays open when the list paints again
  await page.getByRole('button', { name: 'Why? Why identities?' }).click();
  await inApp(page, ({ data }) => data.loadAll());
  await page.getByRole('searchbox').fill('maple');
  await page.locator('.why-panel[data-why="identity"]').getByText('An identity is a named group').waitFor();
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Inbox or alias?' }).waitFor();
  await note();
  await page.getByRole('dialog').getByRole('button', { name: /^Alias/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Inbox or alias?' }).click();
  await page.getByRole('dialog').getByText('An alias is one more address.').waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.goto(t.base + '/aliases');
  await page.getByRole('button', { name: 'What happens when I turn off an alias?' }).click();
  await page.getByText('Postern refuses all mail to an alias that is off.').waitFor();
  await note();
  const row = page.locator(`.item-row[data-id="${ids.reg}"]`);
  await row.getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Random identifiers generator' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Why random identifiers?' }).click();
  await page.getByRole('dialog').getByText('Your browser makes them.').waitFor();
  await note();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await row.getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'What happens when I delete?' }).click();
  await page.getByRole('dialog').getByText('A deleted alias leaves its mail in your inbox.').waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.goto(t.base + '/numbers');
  await page.getByRole('button', { name: 'Why link a real phone?' }).waitFor();
  await page.getByRole('button', { name: 'Link a phone' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Why can the code come by a call?' }).click();
  await page.getByRole('dialog').getByText('A voice says the code two times.').waitFor();
  // the explanation stays open when the choice above it changes
  await page.getByRole('dialog').getByText('Call that says the code').click();
  assert(await page.getByRole('dialog').locator('.why-panel[data-why="phone-by-call"]').isVisible(), 'the explanation closed when the choice changed');
  await note();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.goto(`${t.base}/numbers/${ids.n1}`);
  await page.locator('.thread', { hasText: '555 0142' }).click();
  await page.getByRole('button', { name: /What does this mean\?/ }).click();
  await page.getByText('"Delivered": the phone company reports that the text arrived.').waitFor();
  assert(await page.locator('.bubble .why-btn').count() === 1, 'more than one text explains its status');
  await note();
  await page.goto(`${t.base}/numbers/${ids.n1}`);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'What is forwarding?' }).click();
  await page.getByText('Each forwarded text costs credit.').waitFor();
  await note();
  await page.goto(t.base + '/funds');
  await page.getByRole('button', { name: 'What is credit?' }).click();
  await page.locator('.why-panel[data-why="balance"]').getByText('The server can see your credit.').waitFor();
  await page.getByRole('button', { name: /How does this work/ }).click();
  await page.getByText('Your browser makes secret credit tokens.').waitFor();
  await note();
  await page.goto(`${t.base}/mail/${ids.personal}`);
  await page.locator('.msg-row', { hasText: 'Your order 1042' }).click();
  await page.locator('.mail-note .why-btn').click();
  await page.getByText('Postern does not load these remote images.').waitFor();
  await page.locator('.message-via .why-btn').click();
  await page.locator('.why-panel[data-why="alias-off"]').getByText('You can turn the alias on again at any time.').waitFor();
  await note();
  await page.locator('.banner .why-btn').click();
  await page.locator('.banner-wrap .why-panel').getByText('No real money moves, and no message leaves the server.').waitFor();
  const missing = KEYS.filter((k) => !seen.has(k));
  assert(missing.length === 0, 'these explanations have no place in the app: ' + missing.join(', '));
  t.ok('all 15 explanations have a place; each opens next to its thing');
  await d.close();

  // ---- phone ----
  const p = await t.open({ width: 360, height: 640 });
  await signIn(p.page, t.base, key);
  for (const path of ['/', '/aliases', '/funds', '/settings', `/numbers/${ids.n1}`]) {
    await p.page.goto(t.base + path);
    if (path.startsWith('/numbers/')) await p.page.getByRole('tab', { name: 'Settings' }).click();
    await p.page.locator('main .why-btn').first().waitFor();
    for (const b of await p.page.locator('main .why-btn:visible, .banner .why-btn').all()) await b.click();
    const wide = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(wide <= 0, `open explanations make the phone screen scroll sideways on ${path}`);
    const small = await p.page.locator('.why-btn:visible').evaluateAll((els) => els.filter((el) => { const r = getComputedStyle(el, '::before'); return parseFloat(r.height) < 44; }).length);
    assert(small === 0, `a "Why?" button has a touch area under 44px on ${path}`);
  }
  t.ok('phone (360px): explanations open without sideways scroll; touch areas are 44px');
  await p.close();
}
