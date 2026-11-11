// Username and password maker on the "Random identifiers generator" card.
// The username is saved encrypted with the card. A password is made and shown, and saved nowhere.
import { signUp, signIn, seedAccount, inApp, settle, assert } from '../lib.mjs';

export default async function (t) {
  const d = await t.open();
  const { page } = d;
  const dlg = page.getByRole('dialog');
  const key = await signUp(page, t.base);
  const ids = await seedAccount(page);
  const clip = () => page.evaluate(() => navigator.clipboard.readText());

  // ---- on an alias ----
  await page.goto(t.base + '/aliases');
  const row = page.locator(`.item-row[data-id="${ids.shop}"]`);
  await row.getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Random identifiers generator' }).click();
  assert(await dlg.getByText('Username and password').count() === 0, 'the username part shows before there are identifiers');
  await dlg.getByRole('button', { name: 'Make random identifiers' }).click();
  await dlg.locator('.persona-card').waitFor();
  await dlg.getByRole('heading', { name: 'Username and password' }).waitFor();
  await dlg.getByText('The username is saved with these identifiers, encrypted. A password is never saved.').waitFor();

  // username: make, copy, make new; saved encrypted in the alias
  await dlg.getByRole('button', { name: 'Make a username' }).click();
  await page.getByText('Username made').waitFor();
  const name1 = await dlg.locator('.persona-username').textContent();
  assert(/^[a-z][a-z0-9_]{7,19}$/.test(name1), 'the username has a wrong form: ' + name1);
  await dlg.getByRole('button', { name: 'Copy username' }).click();
  assert(await clip() === name1, 'the clipboard has not the username');
  const saved = await inApp(page, ({ store }, id) => { const a = store.get('aliases').find((x) => x.id === id); return { username: a.extra.username, label: a.label, persona: !!a.persona }; }, ids.shop);
  assert(saved.username === name1 && saved.label === 'Maple Shop' && saved.persona, 'the username is not saved with the alias, or something else was lost: ' + JSON.stringify(saved));
  const raw = await page.evaluate(() => fetch('/api/aliases').then((r) => r.text()));
  assert(!raw.includes(name1), 'the username is readable in the server answer');
  await dlg.getByRole('button', { name: 'Make new username' }).click();
  await page.getByText('New username made').waitFor();
  const name2 = await dlg.locator('.persona-username').textContent();
  assert(name2 !== name1 && /^[a-z][a-z0-9_]{7,19}$/.test(name2), 'the new username is wrong: ' + name2);
  t.ok('username: make, copy, make new; saved encrypted in the alias, the label and the identifiers stay');

  // password: made in the browser, shown with the sentence, options, strength; no request, nothing stored
  await settle(page);
  const requests = [];
  const onRequest = (r) => { if (!r.url().includes('/api/events')) requests.push(`${r.method()} ${r.url()}`); };
  page.on('request', onRequest);
  await dlg.getByRole('button', { name: 'Make a password' }).focus();
  await page.keyboard.press('Enter');
  const value = dlg.locator('.password-value');
  const pw1 = await value.textContent();
  assert(pw1.length === 20 && /[a-z]/.test(pw1) && /[A-Z]/.test(pw1) && /[0-9]/.test(pw1) && /[^A-Za-z0-9]/.test(pw1), 'the password has a wrong form');
  await dlg.getByText('Postern does not save this password. Save it in your password manager now.').waitFor();
  await dlg.getByText('Strength: Very strong.').waitFor();
  await dlg.getByRole('button', { name: 'Copy password' }).click();
  assert(await clip() === pw1, 'the clipboard has not the password');
  await dlg.getByLabel('Length').selectOption('12');
  const pw2 = await value.textContent();
  assert(pw2.length === 12 && pw2 !== pw1, 'the length choice did not make a new password');
  await dlg.getByLabel('With symbols').uncheck();
  const pw3 = await value.textContent();
  assert(pw3.length === 12 && /^[A-Za-z0-9]+$/.test(pw3), 'a password without symbols has symbols');
  await dlg.getByText('Strength: Good for most websites.').waitFor();
  await dlg.getByLabel('Length').selectOption('32');
  await dlg.getByRole('button', { name: 'Make another password' }).click();
  const pw4 = await value.textContent();
  assert(pw4.length === 32, 'the password is not 32 characters long');
  await page.waitForTimeout(300);
  page.off('request', onRequest);
  assert(requests.length === 0, 'making a password made a request: ' + requests.join(', '));
  const kept = await page.evaluate((list) => {
    const all = JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie, location.href]);
    return list.filter((p) => all.includes(p));
  }, [pw1, pw2, pw3, pw4]);
  assert(kept.length === 0, 'a password is in the browser storage, a cookie or the address');
  t.ok('password: made in the browser with length and symbols options and the strength in words; no request; in no storage');

  // the password goes away: Hide, a new username keeps it, closing the card drops it
  await dlg.getByRole('button', { name: 'Make new username' }).click();
  await page.getByText('New username made').waitFor();
  assert(await value.textContent() === pw4, 'a new username took the password off the screen');
  await dlg.getByRole('button', { name: 'Hide' }).click();
  assert(await dlg.locator('.password-value').count() === 0, '"Hide" left the password on the screen');
  await dlg.getByRole('button', { name: 'Make a password' }).click();
  const pw5 = await dlg.locator('.password-value').textContent();
  await dlg.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog'));
  const where = await page.evaluate((pw) => { const hit = [...document.querySelectorAll('*')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes(pw)) || [...el.attributes].some((a) => a.value.includes(pw))); return hit.map((el) => el.outerHTML.slice(0, 200)); }, pw5);
  assert(where.length === 0, 'the password is still in the page after the card closed: ' + where.join(' || '));
  await row.locator('.item-persona').click();
  await dlg.locator('.persona-username').waitFor();
  assert(await dlg.locator('.password-value').count() === 0, 'the password shows again when the card opens again');
  const name3 = await dlg.locator('.persona-username').textContent();
  t.ok('the password stays while the card is open, and is gone after "Hide" or when the card closes; the username is kept');

  // remove the identifiers: the username goes with them
  await dlg.getByRole('button', { name: 'Remove identifiers' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Remove identifiers' }).click();
  await page.getByText('Identifiers removed').waitFor();
  const after = await inApp(page, ({ store }, id) => { const a = store.get('aliases').find((x) => x.id === id); return { username: a.extra.username || null, persona: a.persona }; }, ids.shop);
  assert(after.username === null && after.persona === null, 'the username stayed after the identifiers were removed: ' + JSON.stringify(after));
  assert(name3.length > 0, 'no username was shown');
  await dlg.getByRole('button', { name: 'Done' }).click();
  t.ok('"Remove identifiers" removes the username too');

  // ---- on a number: the password stays while the number changes; a new screen drops it ----
  await page.goto(`${t.base}/numbers/${ids.n1}`);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Make random identifiers' }).click();
  await page.locator('.persona-card').waitFor();
  await page.getByRole('button', { name: 'Make a password' }).click();
  const npw = await page.locator('.password-value').textContent();
  await page.getByRole('button', { name: 'Make a username' }).click();
  await page.getByText('Username made').waitFor();
  await page.locator('.persona-username').waitFor();
  assert(await page.locator('.password-value').textContent() === npw, 'saving the username of a number took the password off the screen');
  await page.getByRole('tab', { name: 'Texts' }).click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.locator('.persona-username').waitFor();
  await page.locator('.sidebar .nav-item', { hasText: 'Home' }).click();
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor();
  assert(!(await page.content()).includes(npw), 'the password is still in the page after a screen change');
  await page.goBack();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.locator('.persona-username').waitFor();
  assert(await page.locator('.password-value').count() === 0, 'the password came back after a screen change');
  t.ok('number: the username is saved; the password is gone after a screen change');

  // ---- on an identity ----
  const identityId = await inApp(page, ({ identities }) => identities.createIdentity({ name: 'Forum', note: '' }));
  await page.goto(`${t.base}/identities/${identityId}`);
  await page.getByRole('button', { name: 'Make random identifiers' }).click();
  await page.locator('.persona-card').waitFor();
  await page.getByRole('button', { name: 'Make a username' }).click();
  await page.locator('.persona-username').waitFor();
  const iname = await page.locator('.persona-username').textContent();
  const istored = await inApp(page, ({ store }, id) => store.get('identities').find((g) => g.id === id).extra.username, identityId);
  assert(istored === iname, 'the username of the identity is not saved');
  t.ok('identity: the card has the username and the password maker too');
  await d.close();

  // ---- phone ----
  const p = await t.open({ width: 360, height: 640 });
  await signIn(p.page, t.base, key);
  await p.page.goto(`${t.base}/identities/${identityId}`);
  await p.page.locator('.persona-username').waitFor();
  assert(await p.page.locator('.persona-username').textContent() === iname, 'a new browser session does not show the saved username');
  await p.page.getByRole('button', { name: 'Make a password' }).click();
  await p.page.locator('.password-value').waitFor();
  const wide = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(wide <= 0, 'the card with a password makes the phone screen scroll sideways');
  const small = await p.page.locator('.persona-login button:visible').evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height < 40).map((el) => el.textContent));
  assert(small.length === 0, 'buttons on the card are too small for a finger: ' + small.join(', '));
  t.ok('phone (360px): the card with username and password fits');
  await p.close();
}
