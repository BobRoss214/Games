// An alias that stops after the first mail ("Used up", "Turn on again", "Make it a normal alias"),
// and the number of mails that an address refused.
import nodemailer from 'nodemailer';
import { signUp, signIn, addCredit, inApp, assert } from '../lib.mjs';

export default async function (t) {
  const d = await t.open();
  const { page } = d;
  const dlg = page.getByRole('dialog');
  const key = await signUp(page, t.base);
  await addCredit(page, 5);
  await inApp(page, ({ data }) => data.createMailbox({ label: 'Main' }));
  const reload = () => inApp(page, ({ data }) => data.loadAliases());
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port: t.server.smtpPort, secure: false, ignoreTLS: true });
  const smtp = (to, subject) => transport.sendMail({ from: 'shop@outside.example', to, subject, text: 'Hello.' }).then(() => 'taken', () => 'refused');

  // ---- make it, with the keyboard ----
  await page.goto(t.base + '/aliases');
  await page.getByRole('button', { name: 'Make alias' }).first().click();
  await dlg.getByLabel('Label').fill('Sign-up at a forum');
  const box = dlg.getByLabel('Stop after the first mail');
  await box.focus();
  await page.keyboard.press('Space');
  assert(await box.isChecked(), 'Space does not check "Stop after the first mail"');
  await dlg.getByText('Good when you only need a sign-up code.').waitFor();
  await dlg.getByRole('button', { name: 'Make alias' }).click();
  await page.getByRole('heading', { name: 'Alias made' }).waitFor();
  await dlg.getByText('Then the alias stops.').waitFor();
  const address = (await dlg.locator('.made-value').textContent()).trim();
  await dlg.getByRole('button', { name: 'Done' }).click();
  const row = page.locator('.item-row', { hasText: address.split('@')[0] });
  await row.getByText('One mail only').waitFor();
  const first = await inApp(page, ({ store }) => { const a = store.get('aliases')[0]; return { oneShot: a.oneShot, usedUp: a.usedUp, enabled: a.enabled }; });
  assert(first.oneShot && !first.usedUp && first.enabled, 'the new alias is not a one-mail alias: ' + JSON.stringify(first));
  t.ok('new alias: "Stop after the first mail" with one line of explanation; the row says "One mail only"');

  // ---- the first mail arrives: used up. The next ones are refused and counted ----
  assert(await smtp(address, 'Your code is 482913') === 'taken', 'the first mail was refused');
  await row.getByText('Used up').waitFor();
  assert(await row.getByText('One mail only').count() === 0, 'a used-up alias still says "One mail only"');
  assert(await row.getByRole('switch').getAttribute('aria-checked') === 'false', 'a used-up alias looks on');
  assert(await smtp(address, 'Second mail') === 'refused', 'a used-up alias took a second mail');
  await reload();
  await row.getByText('Refused 1 mail', { exact: true }).waitFor();
  assert(await smtp(address, 'Third mail') === 'refused', 'a used-up alias took a third mail');
  await reload();
  await row.getByText('Refused 2 mails', { exact: true }).waitFor();
  t.ok('after the first mail the row says "Used up"; refused mail is counted: "Refused 2 mails"');

  // the open mail says it too
  await page.goto(t.base + '/mail');
  await page.locator('.msg-row', { hasText: 'Your code is 482913' }).click();
  await page.locator('.message-via').getByText('Alias, used up').waitFor();
  assert(await page.locator('.message-via').getByRole('button', { name: 'Turn off this alias' }).count() === 0, 'a used-up alias offers "Turn off"');

  // ---- "Turn on again" from the menu, with the keyboard ----
  await page.goto(t.base + '/aliases');
  await row.getByRole('button', { name: /More actions/ }).focus();
  await page.keyboard.press('Enter');
  const entries = await page.getByRole('menu').getByRole('menuitem').allTextContents();
  assert(entries[0] === 'Turn on again', '"Turn on again" is not the first entry: ' + entries.join('|'));
  await page.keyboard.press('Enter');
  await page.getByText('Alias turned on. It stops again after the next mail.').waitFor();
  await row.getByText('One mail only').waitFor();
  assert(await row.getByText('Used up').count() === 0, 'the row still says "Used up"');
  assert(await smtp(address, 'After turning on') === 'taken', 'the alias did not take mail after "Turn on again"');
  await row.getByText('Used up').waitFor();
  t.ok('"Turn on again": the alias takes one more mail, then it is used up again');

  // ---- "Make it a normal alias" ----
  await row.getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Make it a normal alias' }).click();
  await page.getByText('This is a normal alias now. It is off. Turn it on to get mail.').waitFor();
  await row.getByText('Off', { exact: true }).waitFor();
  assert(await row.getByText('Used up').count() === 0 && await row.getByText('One mail only').count() === 0, 'a normal alias still shows the one-mail words');
  await row.getByRole('switch').click();
  await page.getByText('Alias turned on', { exact: true }).waitFor();
  assert(await smtp(address, 'Normal 1') === 'taken' && await smtp(address, 'Normal 2') === 'taken', 'a normal alias refused mail');
  await row.getByRole('button', { name: /More actions/ }).click();
  assert(!(await page.getByRole('menu').getByRole('menuitem').allTextContents()).some((x) => /normal alias|Turn on again/.test(x)), 'a normal alias has one-mail entries in its menu');
  await page.keyboard.press('Escape');
  await row.getByText('Refused 2 mails', { exact: true }).waitFor(); // the number stays
  t.ok('"Make it a normal alias": no more stop; the refused number stays');

  // an address that refused nothing shows no number
  await inApp(page, ({ data, store }) => data.createAlias({ mailboxId: store.get('mailboxes')[0].id, label: 'Plain' }));
  await page.locator('.item-row', { hasText: 'Plain' }).waitFor();
  assert(await page.locator('.item-row', { hasText: 'Plain' }).locator('.item-refused').count() === 0, 'an alias that refused nothing shows a number');
  await d.close();

  // ---- phone ----
  const p = await t.open({ width: 360, height: 640 });
  await signIn(p.page, t.base, key);
  await p.page.goto(t.base + '/aliases');
  await p.page.locator('.item-refused').first().waitFor();
  const wide = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(wide <= 0, 'the alias rows make the phone screen scroll sideways');
  await p.page.getByRole('button', { name: 'New alias' }).first().click();
  await p.page.getByRole('dialog').getByLabel('Stop after the first mail').check();
  const wide2 = await p.page.evaluate(() => { const d2 = document.querySelector('dialog'); return d2.scrollWidth - d2.clientWidth; });
  assert(wide2 <= 0, 'the new alias dialog scrolls sideways on a phone');
  t.ok('phone (360px): the rows and the dialog fit');
  await p.close();
}
