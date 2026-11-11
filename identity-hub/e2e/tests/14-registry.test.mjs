// The extension points (web/js/lib/registry.js). A test-only feature file is added the same
// way a real one is: one import line in /js/features/index.js. The file registers a screen,
// a menu item, row actions and marks, parts for mail, texts and calls, sections, and a key.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, signUp, signIn, seedAccount, inApp, assert } from '../lib.mjs';

const FIXTURES = join(ROOT, 'e2e', 'fixtures');
const js = (body) => ({ status: 200, contentType: 'text/javascript; charset=utf-8', body });

// Serves the test feature files to one browser window.
async function withTestFeature(s) {
  await s.context.route('**/js/features/index.js', async (route) => {
    const res = await route.fetch();
    await route.fulfill(js(`${await res.text()}\nimport './zz-e2e.js';\n`));
  });
  await s.context.route('**/js/features/zz-e2e.js', (route) => route.fulfill(js(readFileSync(join(FIXTURES, 'zz-e2e.js'), 'utf8'))));
  await s.context.route('**/js/features/zz-e2e-screen.js', (route) => route.fulfill(js(readFileSync(join(FIXTURES, 'zz-e2e-screen.js'), 'utf8'))));
  // The test feature has one mark that throws, and one screen whose file does not exist. Both are on purpose.
  s.allow(/e2e broken badge/, /zz-e2e-missing|Failed to fetch dynamically imported module|status of 404/);
}

export default async function (t) {
  const d = await t.open();
  const { page } = d;
  await withTestFeature(d);

  // ---- signed out: only the screen with signedOut: true opens ----
  await page.goto(t.base + '/e2e-open');
  await page.getByRole('heading', { name: 'Test place', level: 1 }).waitFor();
  assert(await page.locator('.sidebar').count() === 0, 'a signed-out feature screen shows the shell');
  await page.getByRole('link', { name: 'Sign in' }).waitFor();
  assert(await page.title() === 'Open test place · Postern', 'the title of a feature screen is wrong: ' + await page.title());
  await page.goto(t.base + '/e2e/apple');
  await page.getByRole('heading', { name: 'Sign in', level: 1 }).waitFor();
  assert(new URL(page.url()).pathname === '/sign-in', 'a feature screen that needs an account opened without one');
  t.ok('signed out: the open feature screen shows, the other one asks to sign in');

  // ---- signed in: menu item, lazy screen, update in place ----
  const key = await signUp(page, t.base);
  const ids = await seedAccount(page);
  assert(await page.evaluate(() => window.e2eScreenLoads || 0) === 0, 'the screen file loaded before its path was opened');
  const navLink = page.locator('.sidebar .nav-item', { hasText: 'Test place' });
  const order = await page.locator('.sidebar .nav-item').allTextContents();
  assert(order.join('|').replace(/\d+/g, '') === 'Home|Mail|Aliases|Numbers|Funds|Test place|Settings', 'the menu order is wrong: ' + order.join('|'));
  await navLink.click();
  await page.getByRole('heading', { name: 'Test place', level: 1 }).waitFor();
  assert(await navLink.getAttribute('aria-current') === 'page', 'the menu item of the feature is not marked');
  assert(await page.locator('.sidebar').count() === 1, 'a signed-in feature screen is outside the shell');
  assert(await page.locator('.e2e-word').textContent() === 'none', 'the screen got wrong params');
  await page.goto(t.base + '/e2e/apple');
  await page.locator('.e2e-word', { hasText: 'apple' }).waitFor();
  await page.locator('.e2e-word').evaluate((el) => { el.dataset.kept = 'yes'; });
  await page.getByRole('link', { name: 'Go to pear' }).click();
  await page.locator('.e2e-word', { hasText: 'pear' }).waitFor();
  assert(await page.locator('.e2e-word').getAttribute('data-kept') === 'yes', 'the screen was made again in place of update()');
  assert(await navLink.getAttribute('aria-current') === 'page', 'the menu item is not marked on a deeper path');
  t.ok('signed in: menu item in order, screen file loads on demand, params update in place');

  await page.goto(t.base + '/e2e-broken');
  await page.getByText('This page did not load.').waitFor();
  await page.getByRole('button', { name: 'Try again' }).waitFor();
  t.ok('a screen file that does not load shows a message and a way to try again');

  // ---- Home: sections, row action with a field of its own, marks, a mark that throws ----
  await page.goto(t.base + '/');
  await page.locator('.e2e-home', { hasText: /E2E home: \d aliases/ }).waitFor();
  const top = await page.evaluate(() => {
    const y = (sel) => document.querySelector(sel).getBoundingClientRect().top;
    return { home: y('.e2e-home'), stats: y('.stats'), grid: y('.home-grid'), end: y('.e2e-home-end') };
  });
  assert(top.home < top.stats && top.stats < top.grid && top.grid < top.end, 'home sections are in the wrong order: ' + JSON.stringify(top));
  await page.locator('.item-row[data-kind="inbox"]').first().waitFor(); // rows show although the inbox mark throws
  const shop = page.locator(`.item-row[data-id="${ids.shop}"]`);
  await shop.getByRole('button', { name: /More actions/ }).click();
  const entries = await page.getByRole('menu').getByRole('menuitem').allTextContents();
  assert(entries.indexOf('Test mark') > 0 && entries.indexOf('Test mark') < entries.indexOf('Test danger') && entries.indexOf('Test danger') < entries.indexOf('Delete'), 'the row menu order is wrong: ' + entries.join('|'));
  await page.getByRole('menuitem', { name: 'Test mark' }).click();
  await shop.getByText('E2E marked').waitFor();
  assert((await shop.locator('.item-label').textContent()) === 'Maple Shop', 'the label was lost when a feature saved its field');
  const saved = await inApp(page, ({ store }, id) => { const a = store.get('aliases').find((x) => x.id === id); return { extra: a.extra, label: a.label }; }, ids.shop);
  assert(saved.extra.e2eMark === 'yes' && saved.label === 'Maple Shop', 'the field of the feature is not in the item: ' + JSON.stringify(saved));
  await shop.getByRole('button', { name: /More actions/ }).click();
  assert(!(await page.getByRole('menu').getByRole('menuitem').allTextContents()).includes('Test mark'), 'an action that returns null still shows');
  await page.getByRole('menuitem', { name: 'Test danger' }).click();
  await page.getByText('Test danger: Maple Shop').waitFor();
  await page.locator('.item-row[data-kind="number"]').first().getByText('E2E number').waitFor();
  t.ok('Home: sections in order, row action saves its own field and keeps the label, marks, a broken mark does not break rows');

  // ---- a key for the whole app: not while typing ----
  await page.getByRole('searchbox').fill('j');
  await page.getByRole('searchbox').press('j');
  assert(new URL(page.url()).pathname === '/', 'a global key ran while the person typed in a field');
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('j');
  assert(new URL(page.url()).pathname === '/', 'a global key ran while a dialog was open');
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Home', level: 1 }).focus();
  await page.keyboard.press('Control+j');
  assert(new URL(page.url()).pathname === '/', 'a global key ran with Ctrl');
  await page.keyboard.press('j');
  await page.locator('.e2e-word', { hasText: 'key' }).waitFor();
  t.ok('a global key runs, but not in a field, not with a dialog open, not with Ctrl');

  // ---- identity: action in the "More" menu, mark on the screen and on the Home card ----
  const identityId = await inApp(page, async ({ identities, data }, aliasId) => {
    const id = await identities.createIdentity({ name: 'Maple', note: '' });
    await data.setItemIdentity('alias', aliasId, id);
    return id;
  }, ids.shop);
  await page.goto(`${t.base}/identities/${identityId}`);
  await page.getByRole('heading', { name: 'Maple', level: 1 }).waitFor();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Test colour' }).click();
  await page.locator('.page-head').getByText('E2E green').waitFor();
  await page.goto(t.base + '/');
  await page.locator(`.identity-card[data-identity="${identityId}"]`).getByText('E2E green').waitFor();
  const kept = await inApp(page, ({ store }, id) => store.get('identities').find((g) => g.id === id), identityId);
  assert(kept.name === 'Maple' && kept.extra.e2eColour === 'green', 'the field of the feature is not on the identity: ' + JSON.stringify(kept));
  t.ok('identity: feature action in the More menu, its own field saved, mark on the screen and on the Home card');

  // ---- Settings: section between Theme and "What the server can see" ----
  await page.goto(t.base + '/settings');
  await page.locator('.e2e-settings').waitFor();
  const titles = await page.locator('.section-title').allTextContents();
  assert(titles.indexOf('Test section') === titles.indexOf('Theme') + 1, 'the settings section is in the wrong place: ' + titles.join('|'));
  assert(titles.includes('Test tools'), 'the Test tools section (a feature file of the app) is missing');
  t.ok('Settings: registered section in its place; the app\'s own Test tools section comes from a feature file');

  // ---- mail: panel and menu entry ----
  await page.goto(`${t.base}/mail/${ids.personal}`);
  await page.locator('.msg-row', { hasText: 'Your order 1042' }).click();
  await page.locator('.e2e-panel', { hasText: 'E2E panel for Your order 1042 is on its way' }).waitFor();
  await page.locator('.message-bar').getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Test message action' }).click();
  await page.getByText('Test message: Your order 1042 is on its way / Maple Shop').waitFor();
  t.ok('mail: panel above the text, entry in the More actions menu, both get the message and its alias');

  // ---- number: tab, setting, part under a text and under a call ----
  await page.goto(`${t.base}/numbers/${ids.n1}`);
  await page.locator('.thread').first().click();
  await page.locator('.bubble-addons', { hasText: 'E2E text in Selling the bike' }).first().waitFor();
  await page.getByRole('button', { name: 'Back' }).or(page.getByRole('link', { name: 'Numbers' })).first().waitFor();
  await page.goto(`${t.base}/numbers/${ids.n1}`);
  const tabNames = await page.getByRole('tab').allTextContents();
  assert(tabNames.map((x) => x.replace(/\d+/g, '')).join('|') === 'Texts|Calls|Test tab|Settings', 'the tab order is wrong: ' + tabNames.join('|'));
  await page.getByRole('tab', { name: 'Test tab' }).click();
  await page.locator('.e2e-tab', { hasText: 'E2E tab for Selling the bike' }).waitFor();
  await page.getByRole('tab', { name: 'Calls' }).click();
  await page.locator('.call-row').first().getByRole('button', { name: 'E2E call' }).click();
  await page.getByText('Test call in').waitFor();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.locator('.e2e-number-setting', { hasText: 'E2E setting for Selling the bike' }).waitFor();
  const heads = await page.locator('.number-settings .section-title').allTextContents();
  assert(heads.indexOf('Test setting') === heads.indexOf('Old texts') + 1, 'the number setting is in the wrong place: ' + heads.join('|'));
  t.ok('number: registered tab, setting, part under a text, part under a call');

  assert(d.errors.some((e) => /e2e broken badge/.test(e)), 'the error of a broken feature part is hidden; it must still show in the console');
  await d.close();

  // ---- phone: five places in the bar; the rest is under "More" ----
  const p = await t.open({ width: 390, height: 844 });
  await withTestFeature(p);
  await signIn(p.page, t.base, key);
  const bar = p.page.locator('.tabbar');
  const places = (await bar.locator('.tab-link').allTextContents()).map((x) => x.replace(/\d+/g, ''));
  assert(places.join('|') === 'Home|Mail|Aliases|Numbers|More', 'the phone bar is wrong: ' + places.join('|'));
  await bar.getByRole('button', { name: 'More' }).click();
  const more = await p.page.getByRole('menu').getByRole('menuitem').allTextContents();
  assert(more.join('|') === 'Funds|Test place', 'the More list is wrong: ' + more.join('|'));
  const box = await p.page.getByRole('menu').boundingBox();
  assert(box.y >= 0 && box.y + box.height <= 844 - 60 + 1 && box.x >= 0 && box.x + box.width <= 390, 'the More list is off the screen or over the bar: ' + JSON.stringify(box));
  const small = await p.page.getByRole('menu').getByRole('menuitem').evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height < 44).length);
  assert(small === 0, 'entries of the More list are smaller than 44px');
  await p.page.getByRole('menuitem', { name: 'Test place' }).click();
  await p.page.getByRole('heading', { name: 'Test place', level: 1 }).waitFor();
  assert(await bar.getByRole('button', { name: 'More' }).getAttribute('aria-current') === 'page', 'More is not marked when one of its places is open');
  await bar.getByRole('button', { name: 'More' }).focus();
  await p.page.keyboard.press('Enter');
  await p.page.keyboard.press('ArrowDown');
  await p.page.keyboard.press('Escape');
  assert(await p.page.evaluate(() => document.activeElement && document.activeElement.textContent) === 'More', 'Escape did not give the focus back to More');
  await p.page.keyboard.press('Enter');
  await p.page.keyboard.press('Enter');
  await p.page.getByRole('heading', { name: 'Funds', level: 1 }).waitFor();
  const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 0, 'the phone screen scrolls sideways with the More place');
  t.ok('phone: four places and "More"; the list opens above the bar, works with the keyboard, marks the open place');
  await p.close();

  // Without a registered menu item the phone bar stays as it was (five places, no "More").
  const q = await t.open({ width: 390, height: 844 });
  await signIn(q.page, t.base, key);
  const plain = (await q.page.locator('.tabbar .tab-link').allTextContents()).map((x) => x.replace(/\d+/g, ''));
  assert(plain.join('|') === 'Home|Mail|Aliases|Numbers|Funds', 'the phone bar without extra places is wrong: ' + plain.join('|'));
  t.ok('phone: no "More" when everything fits');
  await q.close();
}
