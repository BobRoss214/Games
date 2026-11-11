// Quick jump: "/" (or Ctrl+K) opens a search, a few letters find an identity, an alias, a number,
// an inbox or a page, Enter goes there. The search asks the server for nothing and stores nothing.
import { signUp, addCredit, inApp, settle, assert } from '../lib.mjs';

// An account with two identities, aliases with labels, random identifiers and a number.
function fill(page) {
  return inApp(page, async ({ data, phone, identities, persona }) => {
    const box = await data.createMailbox({ label: 'Personal' });
    const facebook = await identities.createIdentity({ name: 'Facebook', note: 'Old school friends' });
    const surface = await identities.createIdentity({ name: 'Surface shop' });
    const login = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Facebook login', identityId: facebook });
    const maple = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Maple Shop' });
    const madeUp = await persona.generatePersona('US');
    await data.setItemPersona('alias', maple.alias.id, madeUp);
    const found = await phone.searchNumbers('US', '415');
    const n = await data.buyNumber({ number: found[0].number, label: 'Bike line' });
    await data.setPref('hideChecklist', true);
    await data.loadAll();
    return {
      boxId: box.mailbox.id, boxAddress: box.address, facebook, surface, loginId: login.alias.id, loginAddress: login.address,
      mapleId: maple.alias.id, mapleAddress: maple.address, madeUpLast: madeUp.lastName, madeUpName: persona.fullName(madeUp),
      numberId: n.number.id, plain: n.plain,
    };
  });
}

const path = (page) => new URL(page.url()).pathname;
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const storageNow = (page) => page.evaluate(() => JSON.stringify([Object.entries(localStorage).sort(), Object.entries(sessionStorage).sort(), document.cookie]));

export default async function (t) {
  // ---------- desktop ----------
  const s = await t.open();
  const { page } = s;
  const dlg = page.getByRole('dialog', { name: 'Search' });
  const field = dlg.getByRole('combobox');
  const options = dlg.locator('[role="option"]');
  const kinds = () => options.evaluateAll((els) => els.map((el) => `${el.dataset.kind}:${el.querySelector('.f-quickjump-value').textContent}`));
  const selected = () => dlg.locator('[role="option"][aria-selected="true"]');
  // Types a query and waits until the list shows the result for it.
  const type = async (text) => { await field.fill(text); await page.waitForTimeout(60); };
  const jump = async (text) => { await page.keyboard.press('/'); await field.waitFor(); await type(text); await page.keyboard.press('Enter'); await dlg.waitFor({ state: 'hidden' }); };

  await signUp(page, t.base);
  await addCredit(page, 20);
  const made = await fill(page);
  await page.goto(t.base + '/');
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor();
  await settle(page);

  // From here to the end of the searching: no request, no change in browser storage, the address stays.
  const requests = [];
  const record = (r) => { if (/^https?:/i.test(r.url())) requests.push(`${r.method()} ${r.url()}`); };
  s.context.on('request', record);
  const storageBefore = await storageNow(page);
  const urlBefore = page.url();

  await page.keyboard.press('/');
  await field.waitFor();
  assert(await field.evaluate((el) => el === document.activeElement), 'the focus is not in the search field');
  const atStart = await kinds();
  assert(atStart[0] === 'identity:Facebook' && atStart.includes('identity:Surface shop') && atStart.includes('page:Settings') && atStart.includes('page:Home'), `the list with no letters is ${atStart.join(', ')}`);
  for (const name of ['Mail', 'Aliases', 'Numbers', 'Funds', 'Help', 'Settings', 'Tutorial', 'My stats', 'Who leaked me', 'Download my data']) assert(atStart.includes(`page:${name}`), `the page ${name} is not in the list`);
  t.ok('"/" opens the search; with no letters it lists the identities and every page that exists');

  await type('face');
  const face = await kinds();
  assert(face[0] === 'identity:Facebook', `"face" gives ${face.join(', ')}`);
  assert(face[1] === `alias:${made.loginAddress}` && face[2] === 'identity:Surface shop', `the order for "face" is ${face.join(', ')}`);
  assert((await selected().getAttribute('data-kind')) === 'identity' && /Facebook/.test(await selected().innerText()) && /Identity/.test(await selected().innerText()), 'the first result is not marked');
  assert(/Facebook login/.test(await options.nth(1).innerText()) && /Alias/.test(await options.nth(1).innerText()), 'the alias does not show its label and the word Alias');
  t.ok('"face": the Facebook identity first, then the alias with that label, then a name with the letters inside');

  // A number by its digits, with and without spaces and signs.
  const digits = made.plain.replace(/\D/g, '');
  for (const q of [digits.slice(-7), digits.slice(1), `${digits.slice(1, 4)} ${digits.slice(4, 7)}`, `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`, made.plain]) {
    await type(q);
    const got = await kinds();
    assert(got.length === 1 && got[0].startsWith('number:'), `the digits "${q}" give ${got.join(', ') || 'nothing'}`);
  }
  assert(/Bike line/.test(await options.first().innerText()) && /Number/.test(await options.first().innerText()), 'the number does not show its label');
  // An alias by its label (parts in any order), by its address, by its random identifiers.
  for (const q of ['maple', 'shop MAPLE', made.mapleAddress.split('@')[0].slice(0, 6), made.madeUpLast]) {
    await type(q);
    assert((await kinds()).includes(`alias:${made.mapleAddress}`), `"${q}" does not find the alias`);
  }
  assert((await options.first().innerText()).includes(`Random identifiers: ${made.madeUpName}`), 'a match in the random identifiers does not say why');
  // An inbox, a page, and nothing.
  await type('personal');
  assert((await kinds())[0] === `inbox:${made.boxAddress}`, 'the inbox is not found by its label');
  await type('sett');
  assert((await kinds())[0] === 'page:Settings', 'the page Settings is not found');
  await type('passkeys');
  assert((await kinds())[0] === 'page:Settings', 'the page Settings is not found by a word of it');
  await type('zzzzqq');
  await dlg.getByText('Nothing found.', { exact: true }).waitFor();
  assert(await options.count() === 0, 'a search with no result shows places');
  // The arrow keys move the mark; the field keeps the focus.
  await type('face');
  const first = await field.getAttribute('aria-activedescendant');
  await page.keyboard.press('ArrowDown');
  const second = await field.getAttribute('aria-activedescendant');
  assert(first && second && first !== second && (await selected().getAttribute('id')) === second && (await selected().getAttribute('data-kind')) === 'alias', 'ArrowDown does not move to the second result');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  assert((await selected().getAttribute('id')) === await options.last().getAttribute('id'), 'ArrowUp from the first result does not go to the last');
  assert(await field.evaluate((el) => el === document.activeElement), 'the arrow keys took the focus out of the field');
  await page.keyboard.press('Escape');
  await dlg.waitFor({ state: 'hidden' });

  await page.waitForTimeout(300);
  s.context.off('request', record);
  assert(requests.length === 0, `the search asked the server for something:\n${requests.join('\n')}`);
  assert(await storageNow(page) === storageBefore, 'the search changed browser storage');
  assert(page.url() === urlBefore, 'the search changed the address');
  t.ok('a number by its digits, an alias by label, address and random identifiers, an inbox, a page, "Nothing found."');
  t.ok('no request, no storage write and no change of the address while searching');

  // Enter goes there.
  await jump('face');
  await page.getByRole('heading', { name: 'Facebook', level: 1 }).waitFor();
  assert(path(page) === `/identities/${made.facebook}`, `"face" + Enter went to ${path(page)}`);
  t.ok('"face" + Enter lands on the Facebook identity');
  await jump(digits.slice(-7));
  await page.locator('.number-heading').waitFor();
  assert(path(page) === `/numbers/${made.numberId}`, `the digits + Enter went to ${path(page)}`);
  await jump('maple');
  await page.getByLabel('Show mail of').waitFor();
  assert(path(page) === `/mail/${made.boxId}`, `the alias + Enter went to ${path(page)}`);
  assert(await page.getByLabel('Show mail of').inputValue() === made.mapleId, 'the mail of the alias is not chosen');
  // Mail is open on this inbox already: a second alias of the same inbox is chosen there too.
  await jump('facebook login');
  await page.waitForFunction((id) => { const el = document.querySelector('.mail-address-filter select'); return el && el.value === id; }, made.loginId);
  assert(path(page) === `/mail/${made.boxId}`, `the second alias went to ${path(page)}`);
  t.ok('a number found by its digits opens the number; an alias found by its label opens its mail');

  // Pages by name. Ctrl+K is the second way to open the search.
  for (const [q, want, heading] of [['sett', '/settings', 'Settings'], ['who leak', '/leaks', 'Who leaked me'], ['my stats', '/stats', 'My stats'], ['tutor', '/tutorial', null], ['funds', '/funds', 'Funds'], ['help', '/help', 'Help']]) {
    await page.keyboard.press('Control+k');
    await field.waitFor();
    await type(q);
    await page.keyboard.press('Enter');
    await dlg.waitFor({ state: 'hidden' });
    if (heading) await page.getByRole('heading', { name: heading, level: 1 }).waitFor();
    assert(path(page) === want, `"${q}" + Enter went to ${path(page)}`);
  }
  await jump('download');
  assert(path(page) === '/settings' && new URL(page.url()).hash === '#download-my-data', `"download" went to ${page.url()}`);
  await page.waitForFunction(() => { const el = document.getElementById('download-my-data'); if (!el) return false; const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; });
  t.ok('pages are found by name (Ctrl+K opens the search too); "Download my data" lands on that part of Settings');

  // "/" does nothing while the person types in a field: it is a letter there.
  await page.goto(t.base + '/aliases');
  const aliasSearch = page.getByLabel('Search aliases and labels');
  await aliasSearch.click();
  await page.keyboard.type('a/b');
  await page.waitForTimeout(300);
  assert(await aliasSearch.inputValue() === 'a/b' && await page.locator('dialog[open]').count() === 0, '"/" opened the search while the person typed in a field');
  // Ctrl+K types nothing, so it opens the search from a field too. Escape puts the focus back in the field.
  await page.keyboard.press('Control+k');
  await field.waitFor();
  await page.keyboard.press('Escape');
  await dlg.waitFor({ state: 'hidden' });
  assert(await aliasSearch.evaluate((el) => el === document.activeElement) && await aliasSearch.inputValue() === 'a/b', 'after Ctrl+K and Escape the focus is not back in the field');
  t.ok('"/" does nothing while the person types in a field; Ctrl+K opens the search from there');

  // Escape closes, and the focus goes back to where it was. Inside the search, "/" is a letter.
  const navLink = page.locator('.nav a', { hasText: 'Aliases' });
  await navLink.focus();
  await page.keyboard.press('/');
  await field.waitFor();
  await page.keyboard.type('a/b');
  assert(await field.inputValue() === 'a/b' && await page.locator('dialog[open]').count() === 1, '"/" inside the search is not a letter');
  await page.keyboard.press('Escape');
  await dlg.waitFor({ state: 'hidden' });
  assert(await navLink.evaluate((el) => el === document.activeElement), 'Escape did not put the focus back');
  assert(path(page) === '/aliases', 'Escape changed the screen');
  t.ok('Escape closes the search and the focus goes back to where it was');

  // The Search entry of the sidebar shows the key and opens the search. A click on a result goes there.
  await page.goto(t.base + '/');
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor();
  const sideSearch = page.locator('.sidebar [data-side-action="quick-jump"]');
  assert(/Search/.test(await sideSearch.innerText()) && (await sideSearch.locator('kbd').innerText()).trim() === '/', 'the sidebar has no Search entry with its key');
  await sideSearch.click();
  await field.waitFor();
  await type('bike');
  await options.first().click();
  await page.locator('.number-heading').waitFor();
  assert(path(page) === `/numbers/${made.numberId}`, 'a click on a result did not go there');
  t.ok('the Search entry of the sidebar opens the search; a click on a result goes there');

  // Keyboard only, from Home: open, type, move, go. The focus lands on the title of the new screen.
  await page.goto(t.base + '/');
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor();
  await page.keyboard.press('/');
  await field.waitFor();
  await page.keyboard.type('face');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.getByLabel('Show mail of').waitFor();
  assert(path(page) === `/mail/${made.boxId}` && await page.getByLabel('Show mail of').inputValue() === made.loginId, 'the second result did not open');
  assert(await page.evaluate(() => !!document.activeElement && document.activeElement.matches('h1, .page-title, #main, #main *')), 'after the jump the focus is not in the new screen');
  t.ok('keyboard only: "/", type, ArrowDown, Enter');
  await s.close();

  // ---------- signed out: the key does nothing ----------
  const o = await t.open();
  await o.page.goto(t.base + '/');
  await o.page.getByRole('heading', { name: 'A private door for your mail and calls.' }).waitFor();
  await o.page.keyboard.press('/');
  await o.page.keyboard.press('Control+k');
  await o.page.waitForTimeout(300);
  assert(await o.page.locator('dialog[open]').count() === 0, 'the search opens for a person who is signed out');
  t.ok('signed out, the keys do nothing');
  await o.close();

  // ---------- phone, 390 px ----------
  const m = await t.open({ width: 390, height: 844 });
  const mp = m.page;
  await signUp(mp, t.base);
  await addCredit(mp, 20);
  const made2 = await fill(mp);
  await mp.goto(t.base + '/');
  await mp.getByRole('heading', { name: 'Home', level: 1 }).waitFor();
  const mButton = mp.locator('.topbar').getByRole('button', { name: 'Search' });
  await mButton.waitFor();
  const size = await mButton.boundingBox();
  assert(size.height >= 44 && size.width >= 44, `the search button is ${size.width} x ${size.height} at 390px`);
  assert(await noSidewaysScroll(mp), 'Home scrolls sideways at 390px');
  await mButton.tap();
  const mDlg = mp.getByRole('dialog', { name: 'Search' });
  const mField = mDlg.getByRole('combobox');
  await mField.waitFor();
  await mp.waitForTimeout(400);
  const sheet = await mDlg.boundingBox();
  assert(sheet.y < 60 && sheet.width >= 388, `the search sheet is not at the top of the phone screen (y ${sheet.y}, width ${sheet.width})`);
  assert((await mField.boundingBox()).height >= 44, 'the search field is lower than 44px at 390px');
  await mField.fill('face');
  const mOptions = mDlg.locator('[role="option"]');
  await mOptions.first().waitFor();
  for (const box of await mOptions.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) assert(box >= 44, `a result is ${box}px high at 390px`);
  assert(await noSidewaysScroll(mp), 'the search scrolls sideways at 390px');
  await mOptions.first().tap();
  await mp.getByRole('heading', { name: 'Facebook', level: 1 }).waitFor();
  assert(path(mp) === `/identities/${made2.facebook}`, 'a tap on a result did not go there');
  assert(await mp.locator('dialog[open]').count() === 0 && await noSidewaysScroll(mp), 'the search did not close after the tap');
  // Closed with the X: the focus goes back to the search button. It is there on every screen.
  await mButton.tap();
  await mField.waitFor();
  await mDlg.getByRole('button', { name: 'Close' }).tap();
  await mDlg.waitFor({ state: 'hidden' });
  assert(await mButton.evaluate((el) => el === document.activeElement), 'after Close the focus is not on the search button');
  t.ok('390px: the search button in the top bar opens the search at the top of the screen; a tap on a result goes there');
  await m.close();
}
