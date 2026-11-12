// Sign-in edge cases: passkey without PRF, passkey with PRF and no stored key, the lock
// screen in a new tab, wrong keys, the Lock button, an ended session, other sessions, theme (dark by default).
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { signUp, signOut, signIn, assert } from '../lib.mjs';

export default async function (t) {
  // ---- a passkey device without PRF: it signs in, the recovery key unlocks ----
  const a = await t.open({ prf: false });
  let key = await signUp(a.page, t.base);
  await a.page.goto(t.base + '/settings');
  await a.page.getByRole('button', { name: 'Add a passkey' }).first().click();
  await a.page.getByRole('dialog').getByRole('button', { name: 'Add a passkey' }).click();
  await a.page.getByText('It can sign you in, but it cannot unlock your data alone').waitFor({ timeout: 15_000 });
  await a.page.locator('.phone-row').filter({ hasText: 'Signs in only' }).waitFor();
  t.ok('a passkey without PRF is marked "Signs in only"');
  await signOut(a.page);
  await a.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await a.page.getByRole('heading', { name: 'Unlock Postern' }).waitFor({ timeout: 15_000 });
  await a.page.getByText('This passkey cannot unlock your data').waitFor();
  await a.page.getByLabel('Recovery key').fill(key);
  await a.page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await a.page.getByRole('heading', { name: 'Home', level: 1 }).waitFor({ timeout: 15_000 });
  t.ok('sign-in with that passkey falls back to the recovery key');
  await a.close();

  // ---- a passkey with PRF but no stored key: recovery key one time, then the passkey alone ----
  const p = await t.open();
  key = await signUp(p.page, t.base, { passkey: true });
  const accountId = await p.page.evaluate(async () => (await import('/js/lib/store.js')).store.get('account').id);
  const db = new DatabaseSync(join(t.server.dataDir, 'accounts.db'));
  db.prepare('UPDATE passkeys SET wrapped_key = NULL WHERE account_id = ?').run(accountId);
  await signOut(p.page);
  await p.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await p.page.getByRole('heading', { name: 'Unlock with your recovery key' }).waitFor({ timeout: 15_000 });
  await p.page.getByText('Let this passkey unlock my data next time').waitFor();
  await p.page.getByLabel('Recovery key').fill(key);
  await p.page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await p.page.getByText('This passkey unlocks your data from now on.').waitFor({ timeout: 15_000 });
  const saved = db.prepare('SELECT length(wrapped_key) AS n FROM passkeys WHERE account_id = ?').get(accountId);
  db.close();
  assert(saved.n === 61, 'the wrapped key was not saved for the passkey');
  await signOut(p.page);
  await p.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await p.page.getByRole('heading', { name: 'Home', level: 1 }).waitFor({ timeout: 15_000 });
  t.ok('a passkey with no stored key: recovery key one time, then the passkey unlocks alone');
  await p.close();

  // ---- the lock screen ----
  const other = await t.open();
  const otherKey = await signUp(other.page, t.base);
  await other.close();
  const b = await t.open();
  b.allow(/status of 401 /, /status of 402 /); // the ended session and the "no funds" answer below
  key = await signUp(b.page, t.base, { passkey: true });
  const tab = await b.context.newPage();
  b.watch(tab);
  await tab.goto(t.base + '/aliases');
  await tab.getByRole('heading', { name: 'Unlock Postern' }).waitFor();
  assert(new URL(tab.url()).pathname === '/aliases', 'the lock screen changed the address');
  t.ok('a new tab with a valid cookie and no key shows the lock screen');
  await tab.getByLabel('Recovery key').fill(otherKey);
  await tab.getByRole('button', { name: 'Unlock', exact: true }).click();
  await tab.getByText('This recovery key belongs to a different account.').waitFor();
  t.ok('the recovery key of another account is refused');
  await tab.getByLabel('Recovery key').fill(key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A'));
  await tab.getByRole('button', { name: 'Unlock', exact: true }).click();
  await tab.getByText('This key has a typing error.').waitFor();
  t.ok('a typing error in the recovery key is found');
  await tab.getByLabel('Recovery key').fill(key);
  await tab.getByRole('button', { name: 'Unlock', exact: true }).click();
  await tab.getByRole('heading', { name: 'Aliases', level: 1 }).waitFor();
  t.ok('unlock lands on the page that was asked for');
  await tab.getByRole('button', { name: 'Lock' }).click();
  await tab.getByRole('heading', { name: 'Unlock Postern' }).waitFor();
  assert((await tab.evaluate(() => Object.keys(sessionStorage).length)) === 0, 'the key is still in sessionStorage after Lock');
  await tab.close();
  await b.page.getByRole('button', { name: 'Lock' }).click();
  await b.page.getByRole('button', { name: 'Unlock with a passkey' }).click();
  await b.page.getByRole('heading', { name: 'Home', level: 1 }).waitFor({ timeout: 15_000 });
  t.ok('Lock forgets the key; the passkey unlocks again');
  await b.page.reload();
  await b.page.getByRole('heading', { name: 'Home', level: 1 }).waitFor();
  t.ok('a reload stays unlocked');

  // ---- 402 offers "Add funds" ----
  const dlg = b.page.getByRole('dialog');
  await b.page.getByRole('button', { name: 'New', exact: true }).click();
  await dlg.locator('.choice', { hasText: /^Inbox/ }).click();
  await dlg.getByRole('button', { name: /Make inbox/ }).click();
  await b.page.getByRole('heading', { name: 'Add funds to continue' }).waitFor();
  await dlg.getByRole('button', { name: 'Add funds' }).click();
  await b.page.getByRole('heading', { name: 'Funds', level: 1 }).waitFor();
  t.ok('a low balance offers "Add funds"');

  // ---- theme: dark is the default; only the theme is in localStorage ----
  // The browser of this test has a light system theme. The default must not follow it.
  const DARK = 'rgb(15, 20, 18)';
  const LIGHT = 'rgb(246, 243, 236)';
  const look = () => b.page.evaluate(() => ({ attr: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, bar: document.querySelector('meta[name="theme-color"]').content, ls: Object.keys(localStorage) }));
  await b.page.goto(t.base + '/settings');
  await b.page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
  let theme = await look();
  assert(theme.attr === 'dark' && theme.bg === DARK && theme.bar === '#0F1412', 'the app does not start in the dark theme: ' + JSON.stringify(theme));
  assert(theme.ls.length === 0, 'localStorage is not empty with the default theme: ' + theme.ls.join());
  assert(await b.page.getByRole('radio', { name: 'Dark' }).isChecked(), 'Settings does not show "Dark" as the theme in use');
  await b.page.getByText('Light', { exact: true }).click();
  theme = await look();
  assert(theme.attr === 'light' && theme.bg === LIGHT && theme.bar === '#F6F3EC', 'the light theme did not apply: ' + JSON.stringify(theme));
  assert(theme.ls.join() === 'postern.theme', 'localStorage holds more than the theme: ' + theme.ls.join());
  await b.page.reload();
  await b.page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
  theme = await look();
  assert(theme.attr === 'light' && theme.bg === LIGHT, 'the theme was lost after a reload');
  // "System" follows the device: light here, then dark when the device changes
  await b.page.getByText('System', { exact: true }).click();
  theme = await look();
  assert(theme.attr === 'system' && theme.bg === LIGHT && theme.ls.join() === 'postern.theme', '"System" does not follow a light device: ' + JSON.stringify(theme));
  await b.page.emulateMedia({ colorScheme: 'dark' });
  await b.page.waitForFunction((dark) => getComputedStyle(document.body).backgroundColor === dark && document.querySelector('meta[name="theme-color"]').content === '#0F1412', DARK);
  await b.page.emulateMedia({ colorScheme: 'light' });
  await b.page.waitForFunction((light) => getComputedStyle(document.body).backgroundColor === light, LIGHT);
  await b.page.getByText('Dark', { exact: true }).click();
  theme = await look();
  assert(theme.attr === 'dark' && theme.bg === DARK && theme.ls.length === 0, 'back to "Dark": the theme or the storage is wrong: ' + JSON.stringify(theme));
  t.ok('theme: dark by default (also on a light device), "Light" and "System" work, survives a reload, is the only thing in localStorage');

  // ---- sessions: another browser signs this one out; the next request goes to sign-in ----
  const c = await t.open();
  await signIn(c.page, t.base, key);
  await c.page.goto(t.base + '/settings');
  await c.page.locator('.phone-row').filter({ hasText: 'Another browser or device' }).first().waitFor();
  await c.page.getByRole('button', { name: 'Sign out the others' }).click();
  await c.page.getByRole('dialog').getByRole('button', { name: 'Sign out the others' }).click();
  await c.page.getByText('The other sessions are signed out').waitFor();
  t.ok('"Sign out the others" works');
  await b.page.getByRole('link', { name: 'Funds' }).first().click();
  await b.page.getByRole('heading', { name: 'Sign in', level: 1 }).waitFor({ timeout: 10_000 });
  await b.page.getByText('You are signed out. Sign in again.').waitFor();
  assert((await b.page.evaluate(() => Object.keys(sessionStorage).length)) === 0, 'the key was not cleared after the session ended');
  t.ok('an ended session goes to sign-in and forgets the key');
}
