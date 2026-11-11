// Identities: named groups of aliases and numbers. Home shows them first; the identity
// screen shows the members, one feed with exactly their mail, texts and calls, the
// random identifiers, and a warning when something inside forwards to a real phone.
import { signUp, addCredit, inApp, assert } from '../lib.mjs';

export default async function (t) {
  const s = await t.open();
  const { page } = s;
  const dlg = page.getByRole('dialog');
  await signUp(page, t.base);
  await addCredit(page, 20);
  const x = await inApp(page, async ({ data, phone, api }) => {
    const box = await data.createMailbox({ label: 'Personal' });
    const a1 = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Facebook login' });
    const a2 = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Marketplace' });
    const a3 = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Newsletter' });
    const n1 = await data.buyNumber({ number: (await phone.searchNumbers('US', '415'))[0].number, label: 'Facebook codes' });
    const n2 = await data.buyNumber({ number: (await phone.searchNumbers('US', '212'))[0].number, label: 'Deliveries' });
    const mail = (to, subject) => api.post('/api/dev/inbound-mail', { to, from: 'sender@outside.example', subject, text: 'body of ' + subject });
    await mail(a1.address, 'Mail to the login alias');
    await mail(a2.address, 'Mail to the marketplace alias');
    await mail(a3.address, 'Mail to the newsletter alias');
    await mail(box.address, 'Mail to the inbox itself');
    const text = (n, body) => api.post('/api/dev/inbound-text', { numberId: n.number.id, number: n.plain, from: '+14155550142', body });
    await text(n1, 'Text to the codes number');
    await text(n2, 'Text to the deliveries number');
    await api.post('/api/dev/inbound-call', { numberId: n1.number.id, number: n1.plain, from: '+14155550142', seconds: 0 });
    return { box: box.mailbox.id, a1: a1.alias.id, a2: a2.alias.id, a3: a3.alias.id, a1Address: a1.address, n1: n1.number.id, n2: n2.number.id, n1Plain: n1.plain };
  });

  // Home before: an invitation, and every alias and number under "Not in an identity"
  await page.goto(t.base + '/');
  await page.getByRole('heading', { name: 'Identities', exact: true }).waitFor();
  await page.getByText('An identity is a named group').waitFor();
  assert((await page.locator('section[aria-labelledby="loose-title"] .item-row').count()) === 5, 'not all aliases and numbers are under "Not in an identity"');
  t.ok('Home: identities first, then "Not in an identity", then inboxes');

  // make an identity from the New chooser
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await dlg.getByRole('button', { name: /^Identity/ }).click();
  await dlg.getByRole('button', { name: 'Make identity' }).click();
  await dlg.getByText('Give the identity a name.').waitFor();
  await dlg.getByLabel('Name').fill('Facebook');
  await dlg.getByLabel('What it is for').fill('Marketplace account for selling furniture');
  await dlg.getByRole('button', { name: 'Make identity' }).click();
  await page.getByRole('heading', { name: 'Facebook', level: 1 }).waitFor();
  const groupId = new URL(page.url()).pathname.split('/').pop();
  assert(/^[A-Za-z0-9_-]{22}$/.test(groupId), 'the identity id has a wrong form');
  await page.getByText('Nothing in this identity yet').waitFor();
  t.ok('a new identity with a name and a note');

  // put an alias and a number in: pick from what I have
  await page.getByRole('button', { name: 'Add' }).first().click();
  await page.getByRole('menuitem', { name: 'Aliases and numbers I have' }).click();
  await dlg.locator('.pick-row').filter({ hasText: 'Facebook login' }).getByRole('checkbox').check();
  await dlg.locator('.pick-row').filter({ hasText: 'Facebook codes' }).getByRole('checkbox').check();
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator(`.item-row[data-id="${x.a1}"]`).waitFor();
  await page.locator(`.item-row[data-id="${x.n1}"]`).waitFor();
  t.ok('add an alias and a number that I have');

  // "Put in identity…" from a row menu on Home
  await page.goto(t.base + '/');
  await page.locator(`.item-row[data-id="${x.a2}"]`).getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Put in identity…' }).click();
  await dlg.getByRole('radio', { name: /Facebook/ }).check();
  await dlg.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Now in the identity Facebook').waitFor();
  const card = page.locator(`.identity-card[data-identity="${groupId}"]`);
  await card.getByText('2 addresses, 1 number').waitFor();
  await card.getByText('Marketplace account for selling furniture').waitFor();
  const loose = await page.locator('section[aria-labelledby="loose-title"] .item-row').evaluateAll((els) => els.map((e) => e.dataset.id));
  assert(loose.length === 2 && loose.includes(x.a3) && loose.includes(x.n2), '"Not in an identity" does not show exactly the ungrouped items');
  await card.locator('.badge').waitFor();
  t.ok('"Put in identity…" from a row; the Home card shows counts, note and unread');

  // search finds the identity by its name and by something inside it
  await page.getByRole('searchbox').fill('faceb');
  await card.waitFor();
  await page.getByRole('searchbox').fill(x.a1Address.slice(0, 8));
  await card.waitFor();
  await page.getByRole('searchbox').fill('deliveries');
  await page.waitForFunction((id) => !document.querySelector(`.identity-card[data-identity="${id}"]`), groupId);
  await page.getByRole('searchbox').fill('');
  t.ok('search finds an identity by name and by a member');

  // the feed: exactly the mail, texts and calls of the members
  await card.click();
  await page.locator('.feed-item').first().waitFor();
  const feed = await page.locator('.feed-item .recent-text').allTextContents();
  for (const want of ['Mail to the login alias', 'Mail to the marketplace alias', 'Text to the codes number', 'Missed call']) assert(feed.includes(want), 'the feed misses: ' + want);
  for (const not of ['Mail to the newsletter alias', 'Mail to the inbox itself', 'Text to the deliveries number']) assert(!feed.includes(not), 'the feed shows something from outside: ' + not);
  assert(feed.length === 4, 'the feed has ' + feed.length + ' entries, not 4');
  t.ok('one feed with exactly the mail, texts and calls of the members');

  // a click opens the message, or the conversation
  await page.locator('.feed-item').filter({ hasText: 'Mail to the login alias' }).click();
  await page.locator('.message-subject').filter({ hasText: 'Mail to the login alias' }).waitFor();
  await page.goBack();
  await page.locator('.feed-item').filter({ hasText: 'Text to the codes number' }).click();
  await page.locator('.bubble-row').filter({ hasText: 'Text to the codes number' }).waitFor();
  assert(!page.url().includes('4155550142') && !page.url().includes('%2B'), 'the other party is in the address bar');
  await page.goBack();
  await page.getByRole('heading', { name: 'Facebook', level: 1 }).waitFor();
  t.ok('a click in the feed opens the message or the conversation');

  // new mail arrives: the feed updates by itself
  await inApp(page, async ({ api }, to) => api.post('/api/dev/inbound-mail', { to, from: 'late@outside.example', subject: 'Late mail', text: 'x' }), x.a1Address);
  await page.locator('.feed-item').filter({ hasText: 'Late mail' }).waitFor({ timeout: 10_000 });
  assert((await page.locator('.feed-item .recent-text').first().textContent()) === 'Late mail', 'the newest entry is not first');
  t.ok('the feed updates live, newest first');

  // "Show more" with many entries
  await inApp(page, async ({ api }, to) => { for (let i = 0; i < 45; i++) await api.post('/api/dev/inbound-mail', { to, from: 'bulk@outside.example', subject: 'Bulk ' + i, text: 'x' }); }, x.a1Address);
  await page.getByRole('button', { name: 'Show more' }).waitFor({ timeout: 15_000 });
  const firstPage = await page.locator('.feed-item').count();
  await page.getByRole('button', { name: 'Show more' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.feed-item').length > n, firstPage);
  for (let i = 0; i < 5 && (await page.getByRole('button', { name: 'Show more' }).count()); i++) {
    const n = await page.locator('.feed-item').count();
    await page.getByRole('button', { name: 'Show more' }).click();
    await page.waitForFunction((k) => document.querySelectorAll('.feed-item').length > k || !document.querySelector('.list-more'), n);
  }
  const all = await page.locator('.feed-item .recent-text').allTextContents();
  assert(all.length === 50 && all.includes('Text to the codes number') && all.includes('Mail to the marketplace alias') && all.filter((v) => v.startsWith('Bulk ')).length === 45, `"Show more" did not bring everything: ${all.length} entries`);
  t.ok('"Show more" loads older entries until all are there');

  // a new alias made from the identity goes straight in
  await page.getByRole('button', { name: 'Add' }).first().click();
  await page.getByRole('menuitem', { name: 'New alias' }).click();
  await dlg.getByLabel('Label').fill('Made inside');
  await dlg.getByRole('button', { name: 'Make alias' }).click();
  await page.getByRole('heading', { name: 'Alias made' }).waitFor();
  await dlg.getByRole('button', { name: 'Done' }).click();
  await page.locator('.item-row').filter({ hasText: 'Made inside' }).waitFor();
  await page.getByText('3 addresses, 1 number').waitFor();
  t.ok('a new alias made from the identity goes straight in');

  // forwarding warning: appears in words when a number inside forwards, and goes away
  assert((await page.locator('.identity-warn .callout').count()) === 0, 'a forwarding warning shows with no forwarding');
  const phoneId = await inApp(page, async ({ data, api }, v) => {
    const p = await data.linkPhone({ number: '+14155550199', label: 'My mobile', via: { id: v.n1, number: v.n1Plain } });
    const out = await api.get('/api/dev/phone-outbox');
    const code = out.texts.map((m) => m.body).reverse().find((b) => /\b\d{6}\b/.test(b)).match(/\b(\d{6})\b/)[1];
    await data.verifyPhone(p.id, code);
    await data.updateNumber(v.n1, { forwardPhoneId: p.id, forwardTexts: true });
    return p.id;
  }, x);
  await page.getByText('This identity forwards to your real phone “My mobile”: texts.').waitFor();
  await inApp(page, async ({ data }, v) => data.updateNumber(v.n1, { forwardCalls: true }), x);
  await page.getByText('This identity forwards to your real phone “My mobile”: texts and calls.').waitFor();
  await page.goto(t.base + '/');
  await card.getByText('Forwards to real phone').waitFor();
  await inApp(page, async ({ data }, v) => data.updateNumber(v.n1, { forwardTexts: false, forwardCalls: false }), x);
  await page.waitForFunction((id) => !document.querySelector(`.identity-card[data-identity="${id}"] .identity-card-forward`), groupId);
  await card.click();
  await page.getByRole('heading', { name: 'Facebook', level: 1 }).waitFor();
  await page.locator('.item-row').first().waitFor();
  assert((await page.locator('.identity-warn .callout').count()) === 0, 'the warning stays after forwarding was turned off');
  t.ok('the forwarding warning appears in words and goes away again');
  void phoneId;

  // edit name and note in place; random identifiers of the identity; both survive a reload
  await page.getByRole('button', { name: 'Edit name and note' }).click();
  await page.getByLabel('Name').fill('Facebook Marketplace');
  await page.getByLabel('What it is for').fill('Selling the old sofa');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('heading', { name: 'Facebook Marketplace', level: 1 }).waitFor();
  await page.getByRole('button', { name: 'Make random identifiers' }).click();
  await page.locator('.identity-side .persona-name').waitFor();
  const made = await page.locator('.identity-side .persona-name').textContent();
  await page.reload();
  await page.getByRole('heading', { name: 'Facebook Marketplace', level: 1 }).waitFor();
  await page.getByText('Selling the old sofa').waitFor();
  await page.locator('.identity-side .persona-name').filter({ hasText: made }).waitFor();
  t.ok('name and note edit in place; random identifiers on the identity; all saved');

  // the server knows nothing: the vault value is one opaque blob
  const vault = await page.evaluate(() => fetch('/api/vault/identities').then((r) => r.text()));
  assert(!/Facebook|sofa/i.test(vault) && !vault.includes(made.split(' ')[1]), 'the group is readable in the server answer');
  const aliasesRaw = await page.evaluate(() => fetch('/api/aliases').then((r) => r.text()));
  assert(!aliasesRaw.includes(groupId), 'the group id is readable in the alias list of the server');
  t.ok('the server answer shows no group name, note or membership');

  // two tabs: a change in one tab does not wipe a change of the other
  await inApp(page, async ({ session, identities }) => {
    // What another tab would do: write the vault value without telling this tab.
    const cur = await session.vaultGet('identities', { fresh: true });
    await session.vaultPut('identities', { ...cur, identities: [...cur.identities, { id: 'AAAAAAAAAAAAAAAAAAAAAA', name: 'From another tab', note: '', createdDay: '2026-01-01', later: 'field' }] });
    await identities.createIdentity({ name: 'From this tab' });
  });
  const names = await inApp(page, async ({ session }) => (await session.vaultGet('identities', { fresh: true })).identities.map((g) => `${g.name}${g.later ? '+' + g.later : ''}`));
  assert(names.includes('From another tab+field') && names.includes('From this tab') && names.includes('Facebook Marketplace'), 'a write lost the change of another tab: ' + names.join(', '));
  t.ok('a write reads the newest value first: changes of another tab and unknown fields are kept');

  // take one out; it is then "not in an identity"
  await page.locator(`.item-row[data-id="${x.a2}"]`).getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Take out of this identity' }).click();
  await page.getByText('Taken out of the identity').waitFor();
  await page.locator(`.item-row[data-id="${x.a2}"]`).waitFor({ state: 'detached' });
  t.ok('"Take out of this identity"');

  // delete the identity: the dialog says that the members stay, and they do
  await page.getByRole('button', { name: 'Delete identity' }).click();
  await dlg.getByText(/stay\. They are then not in an identity/).waitFor();
  await dlg.getByRole('button', { name: 'Delete identity' }).click();
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor();
  await page.waitForFunction((id) => !document.querySelector(`.identity-card[data-identity="${id}"]`), groupId);
  const after = await page.locator('section[aria-labelledby="loose-title"] .item-row').evaluateAll((els) => els.map((e) => e.dataset.id));
  for (const id of [x.a1, x.a2, x.a3, x.n1, x.n2]) assert(after.includes(id), 'a member is gone after the identity was deleted');
  assert((await page.evaluate(() => fetch('/api/aliases').then((r) => r.json()).then((d) => d.aliases.length))) === 4, 'an alias was deleted with the identity');
  await page.goto(t.base + '/identities/' + groupId);
  await page.getByText('This identity does not exist').waitFor();
  t.ok('delete identity: members stay and are "not in an identity"');
}
