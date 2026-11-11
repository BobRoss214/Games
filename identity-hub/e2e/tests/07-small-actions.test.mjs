// The smaller actions: own alias name, taken name, rename, move, mark unread, Cc and Bcc,
// discard question, delete text / conversation / call, passkey rename and remove, deep links.
import { signUp, addCredit, inApp, assert } from '../lib.mjs';

export default async function (t) {
  const s = await t.open();
  const { page } = s;
  const dlg = page.getByRole('dialog');
  s.allow(/status of 409 .*\/api\/aliases$/, /status of 404 .*\/api\/messages/);
  await signUp(page, t.base, { passkey: true });
  await addCredit(page, 20);
  const ids = await inApp(page, async ({ data, phone, api }) => {
    const a = await data.createMailbox({ label: 'First' });
    const b = await data.createMailbox({ label: 'Second' });
    const n = await data.buyNumber({ number: (await phone.searchNumbers('US', '212'))[0].number, label: '' });
    const text = (from, body) => api.post('/api/dev/inbound-text', { numberId: n.number.id, number: n.plain, from, body });
    await text('+14155550111', 'one'); await text('+14155550111', 'two'); await text('+14155550122', 'other thread');
    await api.post('/api/dev/inbound-call', { numberId: n.number.id, number: n.plain, from: '+14155550111', seconds: 10 });
    await api.post('/api/dev/inbound-mail', { to: a.address, from: 'x@outside.example', subject: 'Mark me', text: 'hello' });
    await api.post('/api/dev/inbound-mail', { to: a.address, from: 'y@outside.example', subject: 'Second message', text: 'hello again' });
    return { a: a.mailbox.id, b: b.mailbox.id, n: n.number.id };
  });

  // alias with my own name; Copy; a taken name
  await page.goto(t.base + '/aliases');
  await page.getByRole('button', { name: 'Make alias' }).click();
  await dlg.getByRole('button', { name: 'Choose the name myself' }).click();
  await dlg.getByLabel('Name').fill('A');
  await dlg.getByRole('button', { name: 'Make alias' }).click();
  await dlg.getByText('Use 3 characters or more.').waitFor();
  const custom = 'my.shop' + Math.floor(Math.random() * 1e6);
  await dlg.getByLabel('Name').fill(custom);
  await dlg.getByLabel('Label').fill('Custom');
  await dlg.getByRole('button', { name: 'Make alias' }).click();
  await page.getByRole('heading', { name: 'Alias made' }).waitFor();
  const made = await page.locator('.made-value').textContent();
  assert(made.startsWith(custom + '@'), 'the chosen name was not used');
  await dlg.getByRole('button', { name: 'Copy' }).click();
  assert((await page.evaluate(() => navigator.clipboard.readText())) === made, 'Copy did not put the address on the clipboard');
  await dlg.getByRole('button', { name: 'Done' }).click();
  t.ok('alias with my own name; Copy works');
  await page.getByRole('button', { name: 'New alias' }).click();
  await dlg.getByRole('button', { name: 'Choose the name myself' }).click();
  await dlg.getByLabel('Name').fill(custom);
  await dlg.getByRole('button', { name: 'Make alias' }).click();
  await dlg.locator('.field-error').filter({ hasText: 'taken' }).waitFor();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  t.ok('a taken name shows an error next to the field');

  // rename and move; both survive a reload
  const row = () => page.locator('.item-row').filter({ hasText: custom });
  await row().getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await dlg.getByLabel('Label').fill('Renamed shop');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await row().getByText('Renamed shop').waitFor();
  await row().getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Move to another inbox' }).click();
  await dlg.getByLabel('Deliver to').selectOption(ids.b);
  await dlg.getByRole('button', { name: 'Move' }).click();
  await row().getByText('Inbox Second').waitFor();
  await page.reload();
  await row().getByText('Renamed shop').waitFor();
  await row().getByText('Inbox Second').waitFor();
  t.ok('rename and move an alias');
  await page.goto(t.base + '/');
  await page.locator('.item-row[data-kind="inbox"]').first().getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await dlg.getByLabel('Label').fill('Main inbox');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await page.locator('.item-row[data-kind="inbox"]').first().getByText('Main inbox').waitFor();
  t.ok('rename an inbox');

  // mail: mark unread, back and forward, reload on a message, unknown ids
  await page.goto(t.base + '/mail/' + ids.a);
  await page.locator('.msg-row').filter({ hasText: 'Mark me' }).click();
  await page.locator('.message-subject').filter({ hasText: 'Mark me' }).waitFor();
  await page.reload();
  await page.locator('.message-subject').filter({ hasText: 'Mark me' }).waitFor();
  await page.locator('.msg-row').filter({ hasText: 'Second message' }).click();
  await page.locator('.message-subject').filter({ hasText: 'Second message' }).waitFor();
  await page.goBack();
  await page.locator('.message-subject').filter({ hasText: 'Mark me' }).waitFor();
  t.ok('a message link survives a reload; Back goes to the message before');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark as unread' }).click();
  await page.locator('.msg-row.is-unread').filter({ hasText: 'Mark me' }).waitFor();
  t.ok('mark as unread');
  await page.goto(t.base + '/mail/AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB');
  await page.locator('.msg-row').first().waitFor();
  assert(new URL(page.url()).pathname.split('/').length === 3, 'an unknown inbox id did not fall back to the first inbox');
  await page.goto(t.base + '/no/such/page');
  await page.getByRole('heading', { name: 'This page does not exist' }).waitFor();
  t.ok('unknown addresses show a clear page');

  // write: checks, Cc and Bcc, the discard question
  await page.goto(t.base + '/mail/' + ids.a);
  await page.getByRole('button', { name: 'Write' }).first().click();
  await dlg.getByRole('button', { name: 'Send' }).click();
  await dlg.getByText('Enter an address.').waitFor();
  await dlg.getByLabel('To', { exact: true }).fill('not-an-address');
  await dlg.getByRole('button', { name: 'Send' }).click();
  await dlg.getByText('is not an email address').waitFor();
  await dlg.getByLabel('To', { exact: true }).fill('one@outside.example, two@outside.example');
  await dlg.getByRole('button', { name: 'Add Cc or Bcc' }).click();
  await dlg.getByLabel('Cc (optional)', { exact: true }).fill('cc@outside.example');
  await dlg.getByLabel('Bcc').fill('bcc@outside.example');
  await dlg.getByLabel('Subject').fill('Cc and Bcc');
  await dlg.getByLabel('Message').fill('Body');
  await dlg.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('heading', { name: 'Discard this message?' }).waitFor();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Cancel' }).click();
  await dlg.getByRole('button', { name: 'Send' }).click();
  await page.getByText('Message sent').waitFor();
  await page.getByText('Sent', { exact: true }).click();
  await page.locator('.msg-row').filter({ hasText: 'Cc and Bcc' }).click();
  await page.locator('.message-lines').getByText('bcc@outside.example').waitFor();
  const out = await page.evaluate(() => fetch('/api/dev/outbox').then((r) => r.json()));
  assert(out.mail.find((m) => m.subject === 'Cc and Bcc').to.length === 4, 'not all four recipients are in the outbox');
  t.ok('a new message with To, Cc and Bcc; unsaved text asks before closing');

  // texts and calls
  await page.goto(t.base + '/numbers/' + ids.n);
  await page.locator('.thread').filter({ hasText: '415 555 0111' }).click();
  await page.locator('.bubble-row').filter({ hasText: 'one' }).hover();
  await page.locator('.bubble-row').filter({ hasText: 'one' }).getByRole('button', { name: 'Text actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page.locator('.bubble-row').filter({ hasText: 'one' }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Conversation actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete conversation' }).click();
  await dlg.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByText('Conversation deleted').waitFor();
  assert((await page.locator('.thread').count()) === 1, 'the conversation is still in the list');
  await page.getByRole('button', { name: 'New text' }).click();
  await dlg.getByLabel('To').fill('415 555 0133');
  await dlg.getByRole('button', { name: 'Continue' }).click();
  await dlg.getByText('Enter the full number').waitFor();
  await dlg.getByLabel('To').fill('+1 415 555 0133');
  await dlg.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.composer-input').fill('Hello from a new conversation');
  await page.locator('.composer-input').press('Control+Enter');
  await page.locator('.bubble-row.is-out').filter({ hasText: 'Hello from a new conversation' }).waitFor();
  t.ok('delete a text and a conversation; a new conversation; Ctrl+Enter sends');
  await page.getByRole('tab', { name: 'Calls' }).click();
  await page.locator('.call-row').first().getByRole('button', { name: 'Call actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page.getByText('No calls yet').waitFor();
  await page.getByRole('button', { name: 'Call', exact: true }).click();
  await page.getByRole('heading', { name: 'Link a real phone to call' }).waitFor();
  await dlg.getByRole('button', { name: 'Open Settings' }).click();
  await page.getByText('No real phone linked').waitFor();
  t.ok('delete a call; Call without a linked phone leads to Settings');
  await page.getByLabel('Label').fill('Tickets');
  await page.getByRole('button', { name: 'Save label' }).click();
  await page.locator('.number-sub').getByText('Tickets').waitFor();
  t.ok('number label');
  await page.goto(t.base + '/numbers/AAAAAAAAAAAAAAAAAAAAAA');
  await page.getByText('This number does not exist').waitFor();

  // passkey rename (the encrypted label survives a reload) and remove
  await page.goto(t.base + '/settings');
  await page.locator('.phone-row').filter({ hasText: 'Signs in and unlocks' }).getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await dlg.getByLabel('Name').fill('Work laptop');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await page.locator('.phone-row').filter({ hasText: 'Work laptop' }).waitFor();
  await page.reload();
  await page.locator('.phone-row').filter({ hasText: 'Work laptop' }).getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await dlg.getByRole('button', { name: 'Remove' }).click();
  await page.getByText('No passkey yet').waitFor();
  t.ok('passkey rename and remove');
}
