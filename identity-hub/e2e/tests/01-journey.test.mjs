// The whole journey of one person, through the screens only:
// sign-up, passkey, sign-in both ways, funds, inbox, alias, mail in and out, a second
// account, a number, texts, a real phone, forwarding, a call, and deleting everything.
import { readFileSync } from 'node:fs';
import { signUp, signOut, assert } from '../lib.mjs';

async function addFundsOnScreen(page, base, amount) {
  await page.goto(base + '/funds');
  await page.getByLabel('Amount in US dollars').fill(String(amount));
  await page.getByRole('button', { name: 'Add funds' }).click();
  await page.getByRole('button', { name: 'Simulate payment (test mode)' }).click({ timeout: 30_000 });
  await page.getByText('Done', { exact: true }).waitFor({ timeout: 30_000 });
}
async function makeInbox(page, base, label) {
  await page.goto(base + '/');
  const dlg = page.getByRole('dialog');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await dlg.locator('.choice', { hasText: /^Inbox/ }).click();
  await dlg.getByLabel('Label').fill(label);
  await dlg.getByRole('button', { name: /Make inbox/ }).click();
  await page.getByRole('heading', { name: 'Inbox made' }).waitFor();
  const address = await page.locator('.made-value').textContent();
  await dlg.getByRole('button', { name: 'Done' }).click();
  return address;
}

export default async function (t) {
  const s = await t.open();
  const { page } = s;
  const dlg = page.getByRole('dialog');
  s.allow(/status of 400 .*\/api\/phones\/[^/]+\/verify$/); // the wrong code on purpose

  // sign-up, save key, add passkey
  const key = await signUp(page, t.base, { passkey: true });
  t.ok('sign-up with a passkey');

  // sign out: nothing is left in storage; passkey sign-in unlocks alone
  await signOut(page);
  const stored = await page.evaluate(() => ({ s: Object.keys(sessionStorage), l: Object.keys(localStorage) }));
  assert(!stored.s.length && !stored.l.length, 'storage is not empty after sign-out: ' + JSON.stringify(stored));
  t.ok('sign-out clears storage');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor({ timeout: 15_000 });
  t.ok('passkey sign-in unlocks without the recovery key');

  // recovery-key sign-in (lower case, spaces)
  await signOut(page);
  await page.getByRole('link', { name: 'Use my recovery key' }).click();
  await page.getByLabel('Recovery key').fill('wrong-key');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText('A recovery key has 36 letters').waitFor();
  await page.getByLabel('Recovery key').fill(key.toLowerCase().replace(/-/g, ' '));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor({ timeout: 15_000 });
  t.ok('recovery-key sign-in');

  // funds
  await addFundsOnScreen(page, t.base, 25);
  await page.locator('.balance-value').filter({ hasText: '$25.00' }).waitFor();
  t.ok('add funds with a simulated private payment');

  // inbox and alias
  await makeInbox(page, t.base, 'Personal');
  t.ok('inbox made');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await dlg.locator('.choice', { hasText: /^Alias/ }).click();
  await dlg.getByLabel('Label').fill('Maple Shop');
  await dlg.getByRole('button', { name: 'Make alias' }).click();
  await page.getByRole('heading', { name: 'Alias made' }).waitFor();
  const alias = await page.locator('.made-value').textContent();
  await dlg.getByRole('button', { name: 'Done' }).click();
  t.ok('alias made');

  // simulated incoming mail (HTML + attachment) shows on Home by a live update
  await page.getByRole('button', { name: 'Test tools' }).click();
  await dlg.getByLabel('To (one of your addresses)').selectOption(alias);
  await dlg.getByRole('button', { name: 'Simulate incoming mail' }).click();
  await page.getByText('Test mail delivered').waitFor();
  await dlg.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.recent-item').filter({ hasText: 'Your order 1042' }).waitFor({ timeout: 10_000 });
  t.ok('incoming mail shows on Home without a reload');

  // read it: sandboxed frame, cleaned HTML
  await page.locator('.recent-item').filter({ hasText: 'Your order 1042' }).click();
  await page.locator('.message-subject').filter({ hasText: 'Your order 1042' }).waitFor();
  await page.getByText('Remote images are blocked to stop tracking.').waitFor();
  const frame = page.locator('iframe.mail-frame');
  assert((await frame.getAttribute('sandbox')) === 'allow-popups allow-popups-to-escape-sandbox', 'wrong sandbox on the mail frame');
  const srcdoc = await frame.getAttribute('srcdoc');
  assert(!/<script/i.test(srcdoc) && !/tracker\.example/.test(srcdoc) && !/banner\.png/.test(srcdoc), 'unsafe content in the mail frame');
  assert(/target="_blank"/.test(srcdoc) && /rel="noopener noreferrer"/.test(srcdoc), 'links are not hardened');
  t.ok('message view: sandboxed frame, no script, no remote image, hardened links');
  await page.getByText('Plain text', { exact: true }).click();
  await page.locator('pre.mail-text').filter({ hasText: 'Thank you for your order.' }).waitFor();
  t.ok('plain text view');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  assert(/Receipt 1042/.test(readFileSync(await download.path(), 'utf8')), 'the attachment did not decrypt to the right content');
  t.ok('attachment downloaded and decrypted');

  // reply from the alias, with an attachment; Sent copy
  await page.getByRole('button', { name: 'Reply' }).click();
  const from = await dlg.getByLabel('From').evaluate((el) => el.options[el.selectedIndex].textContent);
  assert(from.includes(alias), 'the reply is not sent from the alias: ' + from);
  assert((await dlg.getByLabel('To', { exact: true }).inputValue()) === 'orders@shop.example', 'wrong reply address');
  await dlg.getByLabel('Message').fill('Thank you. When does it arrive?\n\n' + await dlg.getByLabel('Message').inputValue());
  await page.setInputFiles('input[type=file]', { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello attachment') });
  await page.locator('.attach-item').filter({ hasText: 'note.txt' }).waitFor();
  await dlg.getByRole('button', { name: 'Send' }).click();
  await page.getByText('Message sent').waitFor();
  t.ok('reply sent from the alias');
  await page.getByText('Sent', { exact: true }).click();
  await page.locator('.msg-row').filter({ hasText: 'Re: Your order 1042' }).click();
  await page.locator('pre.mail-text').filter({ hasText: 'When does it arrive?' }).waitFor();
  const [sentFile] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  assert(readFileSync(await sentFile.path(), 'utf8') === 'hello attachment', 'the attachment of the Sent copy is wrong');
  t.ok('Sent copy opens with its attachment');
  const outbox = await page.evaluate(() => fetch('/api/dev/outbox').then((r) => r.json()));
  assert(outbox.mail.some((m) => m.subject.startsWith('Re: Your order 1042') && m.to.includes('orders@shop.example')), 'the reply is not in the simulated outbox');
  t.ok('the reply left through the simulated outbox');

  // a second account sends to the alias: delivered inside the server, arrives live
  const s2 = await t.open();
  s2.allow(/status of 400 .*\/api\/mail\/send$/); // the send to the turned-off alias
  const d2 = s2.page.getByRole('dialog');
  await signUp(s2.page, t.base);
  await addFundsOnScreen(s2.page, t.base, 10);
  await makeInbox(s2.page, t.base, 'Second');
  const send = async (subject) => {
    await s2.page.goto(t.base + '/mail');
    await s2.page.getByRole('button', { name: 'Write' }).first().click();
    await d2.getByLabel('To', { exact: true }).fill(alias);
    await d2.getByLabel('Subject').fill(subject);
    await d2.getByLabel('Message').fill('This mail stays inside the server.');
    await d2.getByRole('button', { name: 'Send' }).click();
  };
  await send('Hello from the second account');
  await s2.page.getByText('Message sent').waitFor();
  await page.getByText('Inbox', { exact: true }).first().click();
  await page.locator('.msg-row').filter({ hasText: 'Hello from the second account' }).waitFor({ timeout: 10_000 });
  t.ok('mail from a second account arrives live');

  // turn the alias off from the message; the next mail is refused
  await page.locator('.msg-row').filter({ hasText: 'Hello from the second account' }).click();
  await page.locator('.message-via').getByRole('button', { name: 'Turn off this alias' }).click();
  await page.getByText('Alias turned off. Mail to it is refused.').waitFor();
  await page.locator('.message-via').getByText('Alias, off').waitFor();
  await send('Second try');
  await d2.locator('.form-error').filter({ hasText: 'This address does not exist' }).waitFor();
  assert((await page.locator('.msg-row').filter({ hasText: 'Second try' }).count()) === 0, 'mail to a turned-off alias arrived');
  t.ok('alias turned off; mail to it is refused');
  await s2.close();

  // number
  await page.goto(t.base + '/numbers');
  await page.getByRole('button', { name: 'Get a number' }).first().click();
  await dlg.locator('.number-option').first().getByRole('button', { name: /^Buy/ }).click();
  await dlg.getByLabel('Label').fill('Selling the bike');
  await dlg.getByRole('button', { name: /Buy for/ }).click();
  await page.locator('.number-heading').waitFor({ timeout: 10_000 });
  t.ok('number bought');

  // incoming text, reply
  await page.getByRole('button', { name: 'Simulate a text' }).click();
  await dlg.getByRole('button', { name: 'Simulate incoming text' }).click();
  await page.getByText('Test text delivered').waitFor();
  await dlg.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.thread').filter({ hasText: 'is the bike still for sale' }).click({ timeout: 10_000 });
  await page.locator('.bubble-row.is-in').filter({ hasText: 'Hi, is the bike still for sale?' }).waitFor();
  await page.locator('.composer-input').fill('Yes. You can see it on Saturday.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('.bubble-row.is-out').filter({ hasText: 'Yes. You can see it on Saturday.' }).waitFor({ timeout: 10_000 });
  t.ok('incoming text and reply');

  // link a real phone: wrong code refused, right code from the simulated outbox
  await page.goto(t.base + '/numbers');
  await page.getByRole('button', { name: 'Link a phone' }).first().click();
  await dlg.getByLabel('Your real phone number').fill('+1 (415) 555-0199');
  await dlg.getByLabel('Label').fill('My mobile');
  await dlg.getByRole('button', { name: 'Send code' }).click();
  await page.getByRole('heading', { name: 'Enter the code' }).waitFor();
  const po = await page.evaluate(() => fetch('/api/dev/phone-outbox').then((r) => r.json()));
  const code = po.texts.map((x) => x.body).reverse().find((b) => /\b\d{6}\b/.test(b)).match(/\b(\d{6})\b/)[1];
  await dlg.getByLabel('Code').fill(code === '000000' ? '111111' : '000000');
  await dlg.getByRole('button', { name: 'Link phone' }).click();
  await dlg.locator('.field-error').filter({ hasText: /./ }).waitFor();
  await dlg.getByLabel('Code').fill(code);
  await dlg.getByRole('button', { name: 'Link phone' }).click();
  await page.getByText('Phone linked', { exact: true }).waitFor();
  await page.locator('.phone-row').filter({ hasText: 'My mobile' }).getByText('Linked').waitFor();
  t.ok('real phone linked with the code (a wrong code is refused)');

  // forwarding on
  await page.locator('.item-row[data-kind="number"] a.item-value').click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Forward to').selectOption({ index: 1 });
  await page.getByText('Forwarding phone saved').waitFor();
  await page.getByRole('switch', { name: 'Forward texts' }).click();
  await page.getByRole('switch', { name: 'Forward calls' }).click();
  await page.locator('.number-route').filter({ hasText: 'forwards to My mobile' }).waitFor();
  t.ok('forwarding turned on');

  // a simulated call is answered and logged; click-to-call is accepted
  await page.getByRole('tab', { name: 'Calls' }).click();
  await page.getByRole('button', { name: 'Simulate a call' }).click();
  await dlg.getByRole('button', { name: 'Simulate incoming call' }).click();
  await page.getByText('Test call done').waitFor();
  await dlg.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.call-row').filter({ hasText: 'Incoming call' }).waitFor({ timeout: 10_000 });
  t.ok('a forwarded call is in the call log');
  await page.getByRole('button', { name: 'Call', exact: true }).click();
  await dlg.getByLabel('Number to call').fill('+14155550177');
  await dlg.getByRole('button', { name: 'Call', exact: true }).click();
  await page.getByText('We are calling your phone now').waitFor();
  t.ok('click-to-call accepted');

  // delete things
  await page.goto(t.base + '/mail');
  await page.locator('.msg-row').filter({ hasText: 'Hello from the second account' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await dlg.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByText('Message deleted').waitFor();
  t.ok('message deleted');
  await page.goto(t.base + '/aliases');
  await page.locator('.item-row').first().getByRole('button', { name: /More actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await dlg.getByRole('button', { name: 'Delete alias' }).click();
  await page.getByText('Alias deleted').waitFor();
  t.ok('alias deleted');
  await page.goto(t.base + '/numbers');
  await page.locator('.phone-row').getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await dlg.getByRole('button', { name: 'Remove' }).click();
  await page.getByText('Phone removed').waitFor();
  t.ok('real phone removed');
  await page.locator('.item-row[data-kind="number"]').getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Release number' }).click();
  await dlg.getByRole('button', { name: 'Release number' }).click();
  await page.getByText('Number released').waitFor();
  t.ok('number released');
  await page.goto(t.base + '/');
  await page.locator('.item-row[data-kind="inbox"]').getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await dlg.getByRole('button', { name: 'Delete inbox' }).click();
  await page.getByText('Inbox deleted').waitFor();
  t.ok('inbox deleted');

  // delete the account: the phrase is needed; the key signs in no more
  s.allow(/status of 401 .*\/api\/auth\/login$/);
  await page.goto(t.base + '/settings');
  await page.getByRole('button', { name: 'Delete account' }).click();
  const confirm = dlg.getByRole('button', { name: 'Delete account' });
  assert(await confirm.isDisabled(), 'account deletion must need the typed phrase');
  await dlg.getByRole('textbox').fill('delete my account');
  await confirm.click();
  await page.getByRole('heading', { name: 'A private door for your mail and calls.' }).waitFor();
  await page.goto(t.base + '/sign-in');
  await page.getByLabel('Recovery key').fill(key);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText('No account matches this recovery key.').waitFor();
  t.ok('account deleted; its recovery key signs in no more');
}
