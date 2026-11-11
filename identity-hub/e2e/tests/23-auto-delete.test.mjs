// Automatic deletion (web/js/features/autodelete.js): old mail of an inbox, the end date of an
// alias, and the list in Settings. The plain warning with the count of old mail, what the
// server has saved, the real deletion (a job on the server that runs each hour; the test starts
// it through POST /api/dev/run-mail-retention), and an alias past its end date that refuses mail.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { signUp, addCredit, inApp, assert } from '../lib.mjs';

const DAY = 86400;
const WARNING = (n) => `Mail older than ${n} days is deleted for good. This cannot be undone. The first deletion happens within one hour.`;

export default async function (t) {
  const sql = (text, ...args) => { const db = new DatabaseSync(join(t.server.dataDir, 'accounts.db')); try { return db.prepare(text).run(...args); } finally { db.close(); } };
  const s = await t.open();
  const { page } = s;
  const dlg = page.getByRole('dialog');
  const top = page.locator('dialog[open]').last(); // the warning lies on top of the dialog that asked for it
  s.allow(/status of 409 .*\/api\/dev\/inbound-mail$/); // mail to an alias that ended, on purpose
  await signUp(page, t.base);
  await addCredit(page, 20);
  const x = await inApp(page, async ({ data, api, phone, mail }) => {
    const box = await data.createMailbox({ label: 'Main' });
    const shop = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Shop' });
    const trial = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Free trial' });
    for (const subject of ['Old one', 'Old two', 'New one']) await api.post('/api/dev/inbound-mail', { to: box.address, from: 'a@outside.example', subject, text: 'x' });
    const n = await data.buyNumber({ number: (await phone.searchNumbers('US', '415'))[0].number, label: 'Codes' });
    const list = (await mail.listMessages({ mailboxId: box.mailbox.id })).messages;
    return { box: box.mailbox.id, boxAddress: box.address, shop: shop.address, shopId: shop.alias.id, trial: trial.address, trialId: trial.alias.id, number: n.number.id,
      old: list.filter((m) => m.meta.subject.startsWith('Old')).map((m) => m.id) };
  });
  // Two of the three mails are 40 days old.
  for (const id of x.old) sql('UPDATE messages SET at = at - ? WHERE id = ?', 40 * DAY, id);
  const state = () => inApp(page, async ({ api }) => {
    const [m, a] = await Promise.all([api.get('/api/mailboxes'), api.get('/api/aliases')]);
    return { days: m.mailboxes[0].retentionDays, ends: Object.fromEntries(a.aliases.map((v) => [v.id, v.expiresAt])) };
  });
  const send = (to) => inApp(page, async ({ api }, address) => { try { await api.post('/api/dev/inbound-mail', { to: address, subject: 'Probe', text: 'x' }); return 'delivered'; } catch (err) { return `${err.status} ${err.message}`; } }, to);
  const inboxRow = () => page.locator('.item-row[data-kind="inbox"]');
  const aliasRow = (address) => page.locator('.item-row[data-kind="alias"]').filter({ hasText: address });
  const menu = async (row, name) => { await row.getByRole('button', { name: /More actions for/ }).click(); await page.getByRole('menuitem', { name }).click(); };

  // ---- Settings says that nothing is on ----
  await page.goto(t.base + '/settings');
  const part = page.locator('[data-section="autodelete"]');
  await part.getByRole('heading', { name: 'Automatic deletion', level: 2 }).waitFor();
  await part.getByText('Nothing is deleted automatically').waitFor();
  t.ok('Settings: "Nothing is deleted automatically" at the start');

  // ---- inbox: turn it on; the warning comes first, with the count ----
  await page.goto(t.base + '/');
  await menu(inboxRow(), 'Delete old mail automatically');
  await dlg.getByRole('heading', { name: 'Delete old mail automatically' }).waitFor();
  assert(await dlg.getByLabel('Off').isChecked(), 'the setting is not off by default');
  await dlg.getByLabel('30 days', { exact: true }).check();
  await dlg.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('heading', { name: 'Delete old mail?' }).waitFor();
  await top.getByText(WARNING(30), { exact: true }).waitFor();
  await top.getByText('2 mails are that old in this inbox now.', { exact: true }).waitFor();
  await top.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('heading', { name: 'Delete old mail?' }).waitFor({ state: 'detached' });
  await dlg.getByRole('heading', { name: 'Delete old mail automatically' }).waitFor();
  assert((await state()).days === null, '"Cancel" in the warning saved the setting');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await top.getByRole('button', { name: 'Delete old mail' }).click();
  await page.getByText('Mail older than 30 days is deleted from now on').waitFor();
  await inboxRow().getByText('Deletes mail after 30 days', { exact: true }).waitFor();
  assert((await state()).days === 30, 'the server did not save 30 days');
  t.ok('inbox: the warning says what is lost and counts the old mail; "Cancel" saves nothing');

  // ---- it survives a reload; longer needs no warning, shorter does; own number; off ----
  await page.reload();
  await inboxRow().getByText('Deletes mail after 30 days', { exact: true }).waitFor();
  await menu(inboxRow(), 'Delete old mail automatically');
  assert(await dlg.getByLabel('30 days', { exact: true }).isChecked(), 'the dialog does not show the saved value');
  await dlg.getByLabel('90 days', { exact: true }).check();
  await dlg.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Mail older than 90 days is deleted from now on').waitFor(); // keeps more: no warning
  await menu(inboxRow(), 'Delete old mail automatically');
  await dlg.getByLabel('My own number of days').check();
  await dlg.getByRole('textbox', { name: 'Days' }).fill('0');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await dlg.getByText('Enter a whole number from 1 to 3650.').waitFor();
  await dlg.getByRole('textbox', { name: 'Days' }).fill('45');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await top.getByText(WARNING(45), { exact: true }).waitFor(); // shorter than 90: the warning again
  await top.getByText('No mail in this inbox is that old now.', { exact: true }).waitFor();
  await top.getByRole('button', { name: 'Delete old mail' }).click();
  await inboxRow().getByText('Deletes mail after 45 days', { exact: true }).waitFor();
  assert((await state()).days === 45, 'the server did not save 45 days');
  await menu(inboxRow(), 'Delete old mail automatically');
  assert(await dlg.getByLabel('My own number of days').isChecked() && await dlg.getByRole('textbox', { name: 'Days' }).inputValue() === '45', 'the own number is not shown');
  await dlg.getByLabel('Off').check();
  await dlg.getByRole('button', { name: 'Save' }).click();
  await page.getByText('All mail is kept from now on').waitFor();
  await page.waitForFunction(() => !document.querySelector('.item-row[data-kind="inbox"] [data-autodelete]'));
  assert((await state()).days === null, 'the server did not turn the setting off');
  t.ok('inbox: the value survives a reload; a shorter time warns again; own number; off');
  await menu(inboxRow(), 'Delete old mail automatically');
  await dlg.getByLabel('30 days', { exact: true }).check();
  await dlg.getByRole('button', { name: 'Save' }).click();
  await top.getByRole('button', { name: 'Delete old mail' }).click();
  await inboxRow().getByText('Deletes mail after 30 days', { exact: true }).waitFor();

  // ---- the job of the server deletes the old mail; the open list follows without a reload ----
  await page.goto(`${t.base}/mail/${x.box}`);
  const rows = page.locator('.msg-row');
  await rows.filter({ hasText: 'Old one' }).waitFor();
  assert(await rows.count() === 3, 'the inbox does not show three mails before the job');
  await inApp(page, async ({ api }) => api.post('/api/dev/run-mail-retention'));
  await rows.filter({ hasText: 'Old one' }).waitFor({ state: 'detached', timeout: 10_000 });
  await rows.filter({ hasText: 'Old two' }).waitFor({ state: 'detached' });
  await rows.filter({ hasText: 'New one' }).waitFor();
  const left = await inApp(page, async ({ mail }, id) => (await mail.listMessages({ mailboxId: id })).messages.map((m) => m.meta.subject), x.box);
  assert(left.join() === 'New one', 'the job left other mail: ' + left.join());
  await page.reload();
  await rows.filter({ hasText: 'New one' }).waitFor();
  assert(await rows.count() === 1, 'the old mail is back after a reload');
  t.ok('the job deletes the two mails that are 40 days old and keeps the new one; the open list follows by itself');
  await page.goto(t.base + '/');

  // ---- alias: an end date ----
  await menu(aliasRow(x.shop), 'Set an end date');
  await dlg.getByRole('heading', { name: 'Set an end date' }).waitFor();
  await dlg.getByText('After the end date the alias refuses mail, like an alias that is turned off. Its mail stays.').waitFor();
  assert(await dlg.getByLabel('In 7 days').isChecked(), '"In 7 days" is not the first choice');
  await dlg.getByRole('button', { name: 'Set end date' }).click();
  await page.getByText(/^This alias stops on /).waitFor();
  await aliasRow(x.shop).getByText('Stops in 7 days', { exact: true }).waitFor();
  const in7 = (await state()).ends[x.shopId];
  assert(Math.abs(in7 - (Date.now() / 1000 + 7 * DAY)) < 120, 'the end date is not 7 days from now: ' + in7);
  assert(await send(x.shop) === 'delivered', 'an alias with an end date in the future refuses mail');
  // a day that the person chooses: the alias works until the end of that day
  await menu(aliasRow(x.shop), 'Change the end date');
  await dlg.getByText(/^This alias stops on /).waitFor();
  await dlg.getByLabel('On a day that I choose').check();
  const pick = new Date(); pick.setDate(pick.getDate() + 2);
  const value = `${pick.getFullYear()}-${String(pick.getMonth() + 1).padStart(2, '0')}-${String(pick.getDate()).padStart(2, '0')}`;
  await dlg.getByLabel('Last day').fill(value);
  await dlg.getByRole('button', { name: 'Set end date' }).click();
  await aliasRow(x.shop).getByText('Stops in 3 days', { exact: true }).waitFor();
  const endOfDay = new Date(pick.getFullYear(), pick.getMonth(), pick.getDate() + 1).getTime() / 1000;
  assert((await state()).ends[x.shopId] === endOfDay, 'the chosen day does not end at midnight');
  await page.reload();
  await aliasRow(x.shop).getByText('Stops in 3 days', { exact: true }).waitFor();
  t.ok('alias: "In 7 days" and a chosen day; the row says "Stops in … days", also after a reload');

  // ---- an alias past its end date: "Ended", mail refused; remove the date: mail again ----
  sql('UPDATE addresses SET expires_at = ? WHERE id = ?', Math.floor(Date.now() / 1000) - 60, x.trialId);
  await page.reload();
  await aliasRow(x.trial).getByText('Ended', { exact: true }).waitFor();
  assert(await send(x.trial) === '409 This address cannot receive mail now.', 'an alias past its end date took mail');
  await page.goto(t.base + '/settings');
  await part.locator('.phone-row').filter({ hasText: x.boxAddress }).getByText('Mail older than 30 days is deleted').waitFor();
  await part.locator('.phone-row').filter({ hasText: x.shop }).getByText(/^Stops on /).waitFor();
  await part.locator('.phone-row').filter({ hasText: x.trial }).getByText(/^Ended on .* It refuses mail\.$/).waitFor();
  assert(await part.locator('.phone-row').count() === 3, 'the list in Settings has a wrong number of lines');
  // a number that deletes old texts (its setting is on the screen of the number) is in the list too
  await inApp(page, async ({ data }, id) => data.updateNumber(id, { retentionDays: 14 }), x.number);
  const numberLine = part.locator('.phone-row').filter({ hasText: 'Texts older than 14 days are deleted' });
  await numberLine.waitFor();
  assert(await numberLine.getByRole('link', { name: 'Open number' }).getAttribute('href') === `/numbers/${x.number}`, 'the number line does not lead to the number');
  t.ok('Settings lists the inbox, the number and both aliases with their settings');
  await part.getByRole('button', { name: `Change the end date of ${x.trial}` }).click();
  await dlg.getByText(/^This alias ended on /).waitFor();
  await dlg.getByRole('button', { name: 'Remove the end date' }).click();
  await page.getByText('End date removed. The alias works again.').waitFor();
  await part.locator('.phone-row').filter({ hasText: x.trial }).waitFor({ state: 'detached' });
  assert(await send(x.trial) === 'delivered', 'the alias refuses mail after the end date was removed');
  assert((await state()).ends[x.trialId] === null, 'the server still has the end date');
  t.ok('an alias past its end date says "Ended" and refuses mail; "Remove the end date" makes it work again');

  // ---- keyboard only: the menu, the choice with the arrow keys, Enter ----
  await page.goto(t.base + '/aliases');
  await aliasRow(x.trial).getByRole('button', { name: /More actions for/ }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menu').waitFor();
  for (let i = 0; i < 20 && !(await page.evaluate(() => document.activeElement.textContent.trim() === 'Set an end date')); i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await dlg.getByLabel('In 7 days').waitFor();
  for (let i = 0; i < 12 && !(await page.evaluate(() => document.activeElement.type === 'radio')); i++) await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown'); // from "In 7 days" to "In 30 days"
  assert(await dlg.getByLabel('In 30 days').isChecked(), 'the arrow key does not move the choice');
  await page.keyboard.press('Enter');
  await aliasRow(x.trial).getByText('Stops in 30 days', { exact: true }).waitFor();
  t.ok('keyboard only: menu, choice with the arrow keys, Enter');
  await s.close();

  // ---- phone screen ----
  const p = await t.open({ width: 390, height: 844 });
  await signUp(p.page, t.base);
  await addCredit(p.page, 10);
  await inApp(p.page, async ({ data, api }) => {
    const box = await data.createMailbox({ label: 'Main', localPart: 'a.rather.long.inbox.name.for.the.phone' + Math.floor(Math.random() * 9000 + 1000) });
    const a = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Shop' });
    await api.patch(`/api/mailboxes/${box.mailbox.id}`, { retentionDays: 365 });
    await api.patch(`/api/aliases/${a.alias.id}`, { expiresAt: Math.floor(Date.now() / 1000) + 86400 * 9 });
  });
  const fits = (root) => p.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const vw = document.documentElement.clientWidth;
    const out = [...el.querySelectorAll('*')].filter((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 1 || b.left < -1); }).length;
    const low = [...el.querySelectorAll('button:not(.why-btn), a.btn, input:not([type=radio])')].filter((n) => n.getBoundingClientRect().height > 0 && n.getBoundingClientRect().height < 40).map((n) => (n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 24));
    return { out, low, scroll: document.documentElement.scrollWidth > vw };
  }, root);
  await p.page.goto(t.base + '/settings');
  await p.page.locator('[data-section="autodelete"] .phone-row').nth(1).waitFor();
  let m = await fits('[data-section="autodelete"]');
  assert(m.out === 0 && !m.scroll && m.low.length === 0, 'Settings list on the phone: ' + JSON.stringify(m));
  await p.page.locator('[data-section="autodelete"]').getByRole('button', { name: /^Change the automatic deletion of/ }).click();
  await p.page.getByRole('dialog').getByLabel('365 days', { exact: true }).waitFor();
  m = await fits('dialog[open]');
  assert(m.out === 0 && !m.scroll && m.low.length === 0, 'the dialog on the phone: ' + JSON.stringify(m));
  t.ok('phone screen (390px): the list in Settings and the dialog fit');
  await p.close();
}
