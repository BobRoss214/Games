// Random identifiers generator (the file keeps its old name): a random name and address for an alias or a number.
// Made in the browser, saved inside the encrypted label, with copy buttons.
import { signUp, addCredit, inApp, assert } from '../lib.mjs';

const clip = (page) => page.evaluate(() => navigator.clipboard.readText());

export default async function (t) {
  const s = await t.open();
  const { page } = s;
  const dlg = page.getByRole('dialog');
  await signUp(page, t.base);
  await addCredit(page, 10);
  const ids = await inApp(page, async ({ data, phone }) => {
    const box = await data.createMailbox({ label: 'Main' });
    const a = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Forum' });
    const n = await data.buyNumber({ number: (await phone.searchNumbers('US', '415'))[0].number, label: 'Line' });
    return { alias: a.alias.id, address: a.address, number: n.number.id };
  });
  const row = () => page.locator(`.item-row[data-id="${ids.alias}"]`);
  const openDetails = async () => {
    await row().getByRole('button', { name: /More actions/ }).click();
    await page.getByRole('menuitem', { name: 'Random identifiers generator' }).click();
  };

  // empty state: one button, a real country picker, the honest line
  await page.goto(t.base + '/');
  await row().waitFor();
  await openDetails();
  const country = dlg.getByLabel('Country for new identifiers');
  assert((await country.evaluate((el) => el.tagName)) === 'SELECT', 'the country picker is not a real control');
  assert((await country.locator('option').allTextContents()).includes('United States'), 'the country list has no United States');
  await dlg.getByText('These identifiers are made up. Do not use them where the law requires your real name and address').waitFor();
  t.ok('empty state: country picker and the honest line');

  // make details
  await dlg.getByRole('button', { name: 'Make random identifiers' }).click();
  await dlg.locator('.persona-name').waitFor();
  const name1 = await dlg.locator('.persona-name').textContent();
  const lines1 = await dlg.locator('.persona-address span').allTextContents();
  assert(name1.trim().split(' ').length >= 2, 'the name is not a full name: ' + name1);
  assert(/^.+, [A-Z]{2} \d{5}$/.test(lines1[lines1.length - 2]) && lines1[lines1.length - 1] === 'United States', 'the address has no city, state and ZIP line: ' + lines1.join(' / '));
  t.ok('details are made: a full name and an address with city, state and ZIP');

  // copy buttons
  await dlg.getByRole('button', { name: 'Copy name' }).click();
  assert((await clip(page)) === name1, 'Copy name');
  await dlg.getByRole('button', { name: 'Copy address' }).click();
  assert((await clip(page)) === lines1.join(', '), 'Copy address');
  const fields = {};
  for (const [label, key] of [['first name', 'First name'], ['last name', 'Last name'], ['street', 'Street'], ['city', 'City'], ['state', 'State'], ['zip code', 'ZIP code']]) {
    await dlg.getByRole('button', { name: `Copy ${label}`, exact: true }).click();
    fields[key] = await clip(page);
    const shown = await dlg.locator('.persona-field').filter({ has: page.locator('dt', { hasText: new RegExp(`^${key}$`) }) }).locator('.persona-value').textContent();
    assert(fields[key] === shown && shown.length > 0, `Copy ${label}: "${fields[key]}" is not "${shown}"`);
  }
  assert(`${fields['First name']} ${fields['Last name']}` === name1, 'first and last name do not make the full name');
  assert(/^[A-Z]{2}$/.test(fields.State) && /^\d{5}$/.test(fields['ZIP code']), 'state or ZIP code has a wrong form');
  t.ok('a copy button for the name, the address and each field');

  // make new identifiers: asks first, then replaces
  await dlg.getByRole('button', { name: 'Make new identifiers' }).click();
  await page.getByRole('heading', { name: 'Make new identifiers?' }).waitFor();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Cancel' }).click();
  assert((await dlg.locator('.persona-name').textContent()) === name1, 'Cancel changed the details');
  await dlg.getByRole('button', { name: 'Make new identifiers' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Make new identifiers' }).click();
  await page.getByText('New identifiers made').waitFor();
  const street2 = await dlg.locator('.persona-field').filter({ has: page.locator('dt', { hasText: /^Street$/ }) }).locator('.persona-value').textContent();
  assert(street2 !== fields.Street, 'the details did not change');
  const name2 = await dlg.locator('.persona-name').textContent();
  t.ok('"Make new identifiers" asks first, then replaces');
  await dlg.getByRole('button', { name: 'Done' }).click();

  // the row shows the name; a reload keeps it; the label is still there
  await row().locator('.item-persona').filter({ hasText: name2 }).waitFor();
  await page.reload();
  await row().locator('.item-persona').filter({ hasText: name2 }).waitFor();
  await row().getByText('Forum').waitFor();
  t.ok('saved: still there after a reload, the label is kept');

  // the server stores it encrypted: the plain name is nowhere in the answer
  const raw = await page.evaluate(() => fetch('/api/aliases').then((r) => r.text()));
  assert(!raw.includes(name2.split(' ')[1]) && !raw.includes(street2), 'random identifiers are readable in the server answer');
  t.ok('the server answer holds no readable details');

  // a later rename keeps the details, and a field of a later app version is kept too
  await inApp(page, async ({ session, api, data }, id) => {
    const rows = (await api.get('/api/aliases')).aliases;
    const cur = await session.decLabel(rows.find((r) => r.id === id).enc, 'alias');
    await api.patch(`/api/aliases/${id}`, { enc: await session.encLabel({ ...cur, future: { keep: 'me' } }, 'alias') });
    await data.loadAliases();
  }, ids.alias);
  await row().getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await dlg.getByLabel('Label').fill('Forum, renamed');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await row().getByText('Forum, renamed').waitFor();
  const kept = await inApp(page, async ({ session, api }, id) => session.decLabel((await api.get('/api/aliases')).aliases.find((r) => r.id === id).enc, 'alias'), ids.alias);
  assert(kept.label === 'Forum, renamed' && kept.future && kept.future.keep === 'me' && kept.persona && kept.persona.street === street2, 'a write lost other fields: ' + JSON.stringify(Object.keys(kept)));
  t.ok('writes keep the label, the details and unknown fields');

  // details in a wrong form are ignored
  await inApp(page, async ({ session, api, data }, id) => {
    const rows = (await api.get('/api/aliases')).aliases;
    const cur = await session.decLabel(rows.find((r) => r.id === id).enc, 'alias');
    await api.patch(`/api/aliases/${id}`, { enc: await session.encLabel({ ...cur, persona: { v: 1, country: 'US', firstName: '<img src=x onerror=alert(1)>' } }, 'alias') });
    await data.loadAliases();
  }, ids.alias);
  await row().waitFor();
  assert((await row().locator('.item-persona').count()) === 0, 'details in a wrong form are shown');
  await openDetails();
  await dlg.getByRole('button', { name: 'Make random identifiers' }).waitFor();
  t.ok('stored details in a wrong form are ignored');

  // remove
  await dlg.getByRole('button', { name: 'Make random identifiers' }).click();
  await dlg.locator('.persona-name').waitFor();
  await dlg.getByRole('button', { name: 'Remove identifiers' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Remove identifiers' }).click();
  await page.getByText('Identifiers removed').waitFor();
  await dlg.getByRole('button', { name: 'Make random identifiers' }).waitFor();
  await dlg.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await row().waitFor();
  assert((await row().locator('.item-persona').count()) === 0, 'removed details came back after a reload');
  t.ok('remove: asks first, gone after a reload');

  // a number has the card on its Settings tab
  await page.goto(t.base + '/numbers/' + ids.number);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Make random identifiers' }).click();
  await page.locator('.number-settings .persona-name').waitFor();
  const numberName = await page.locator('.number-settings .persona-name').textContent();
  await page.reload();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.locator('.number-settings .persona-name').filter({ hasText: numberName }).waitFor();
  await page.goto(t.base + '/numbers');
  await page.locator(`.item-row[data-id="${ids.number}"] .item-persona`).filter({ hasText: numberName }).waitFor();
  t.ok('a number has random identifiers too');

  // nothing of it in the address bar or in browser storage
  const leak = await page.evaluate((n) => ({ url: location.href.includes(n), ls: JSON.stringify(Object.entries(localStorage)).includes(n), ss: JSON.stringify(Object.entries(sessionStorage)).includes(n) }), numberName.split(' ')[1]);
  assert(!leak.url && !leak.ls && !leak.ss, 'details leaked into the address or into storage');
  t.ok('nothing of it in the address bar or in storage');
}
