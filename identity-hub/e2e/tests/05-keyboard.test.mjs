// The app with the keyboard only: skip link, focus rings, dialogs, menus, switches, tabs.
// Also: one h1 and one main on each page, and every control has a name.
import { signUp, signIn, seedAccount, assert } from '../lib.mjs';

export default async function (t) {
  const s = await t.open();
  const { page } = s;
  const key = await signUp(page, t.base);
  const ids = await seedAccount(page);
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click();

  // sign in with the keyboard
  await page.goto(t.base + '/sign-in');
  await page.getByLabel('Recovery key').waitFor();
  await page.keyboard.press('Tab');
  assert(/skip-link/.test(await page.evaluate(() => document.activeElement.className)), 'the first Tab stop is not the skip link');
  await page.getByLabel('Recovery key').focus();
  await page.keyboard.type(key);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor();
  t.ok('sign-in with the keyboard');

  const active = () => page.evaluate(() => { const e = document.activeElement; return (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40); });
  const ring = () => page.evaluate(() => { const st = getComputedStyle(document.activeElement); return st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) >= 2; });

  // every Tab stop has a visible focus ring
  await page.reload();
  await page.locator('.recent-item').first().waitFor();
  const order = [];
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    order.push(await active());
    assert(await ring(), 'no focus ring on: ' + order[order.length - 1]);
  }
  assert(/Skip to content/.test(order[0]), 'the skip link is not first');
  t.ok('a visible focus ring on every stop');

  // skip link
  await page.reload();
  await page.locator('.recent-item').first().waitFor();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  assert(/New/.test(await active()), 'the skip link did not jump to the content');
  t.ok('the skip link jumps to the content');

  // dialog: focus goes in, stays in, Escape closes, focus comes back
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();
  const inDialog = () => page.evaluate(() => !!document.activeElement.closest('dialog') || document.activeElement === document.body);
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert(await inDialog(), 'focus left the dialog'); }
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert(/New/.test(await active()), 'focus did not come back to the button');
  t.ok('dialog: focus trap, Escape, focus returns');

  // row menu
  const row = page.locator('.item-row[data-kind="alias"]').first();
  await row.getByRole('button', { name: /More actions/ }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menu').waitFor();
  assert(/Rename/.test(await active()), 'the first menu item has no focus');
  await page.keyboard.press('ArrowDown');
  assert(/Made-up details/.test(await active()), 'arrow keys do not move in the menu');
  await page.keyboard.press('End');
  assert(/Delete/.test(await active()), 'End does not go to the last item');
  await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({ state: 'detached' });
  assert(/More actions/.test(await active()), 'focus did not come back to the menu button');
  t.ok('menu: arrows, End, Escape, focus returns');

  // switch
  const sw = () => page.locator('.item-row[data-kind="alias"]').first().getByRole('switch');
  await sw().focus();
  const before = await sw().getAttribute('aria-checked');
  await page.keyboard.press('Space');
  await page.getByText(/Alias turned (on|off)/).waitFor();
  assert((await sw().getAttribute('aria-checked')) !== before, 'the switch did not change');
  await sw().focus();
  await page.keyboard.press('Space');
  await page.waitForFunction((v) => document.querySelector('.item-row[data-kind="alias"] [role=switch]').getAttribute('aria-checked') === v, before);
  t.ok('a switch works with Space');

  // filter chips and search
  await page.getByRole('button', { name: 'Numbers', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert((await page.locator('.item-row').evaluateAll((els) => [...new Set(els.map((e) => e.dataset.kind))])).join() === 'number', 'the filter shows other kinds');
  await page.getByRole('searchbox').fill('deliver');
  await page.waitForFunction(() => document.querySelectorAll('.item-row').length === 1);
  await page.getByRole('searchbox').fill('zzzz');
  await page.getByText('Nothing matches your search').waitFor();
  t.ok('filter chips and search');

  // tabs
  await page.goto(t.base + '/numbers/' + ids.n1);
  await page.getByRole('tab', { name: 'Texts' }).focus();
  await page.keyboard.press('ArrowRight');
  assert((await page.getByRole('tab', { name: 'Calls' }).getAttribute('aria-selected')) === 'true', 'arrow keys do not change the tab');
  await page.keyboard.press('End');
  await page.getByLabel('Forward to').waitFor();
  t.ok('tabs: arrow keys and End');

  // structure of each page
  for (const path of ['/', '/mail', '/aliases', '/numbers', '/numbers/' + ids.n1, '/funds', '/settings']) {
    await page.goto(t.base + path);
    await page.locator('main h1').first().waitFor({ state: 'attached' });
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => ({
      h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main').length,
      unnamed: [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')].filter((el) => el.offsetParent !== null).filter((el) => {
        if ((el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim()) return false;
        if (el.id && document.querySelector(`label[for="${el.id}"]`)) return false;
        return !el.closest('label');
      }).map((el) => el.outerHTML.slice(0, 80)),
    }));
    assert(info.h1 === 1 && info.main === 1, `${path}: ${info.h1} h1, ${info.main} main`);
    assert(info.unnamed.length === 0, `${path}: controls with no name: ${info.unnamed.join(' | ')}`);
  }
  t.ok('each page: one h1, one main, every control has a name');
}
