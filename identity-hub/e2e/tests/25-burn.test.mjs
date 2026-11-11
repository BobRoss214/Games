// Burn (web/js/features/burn.js): an identity, one alias, one number. The exact list of what is
// destroyed, two confirmations, the result on the server, a burn that stops in the middle and
// is finished later, and the keyboard.
import { signUp, addCredit, inApp, assert } from '../lib.mjs';

const top = (page) => page.locator('dialog[open]').last();

// The state of the account as the server gives it.
const look = (page, ids) => inApp(page, async ({ api, mail, identities }, x) => {
  const [aliases, numbers] = await Promise.all([api.get('/api/aliases'), api.get('/api/numbers')]);
  const count = async (list) => (list.length ? (await mail.listMessages({ addressIds: list, limit: 100 })).messages.length : 0);
  const out = { on: {}, mail: {}, numbers: numbers.numbers.map((n) => n.id) };
  for (const [name, id] of Object.entries(x)) {
    const a = aliases.aliases.find((v) => v.id === id);
    if (a) { out.on[name] = a.enabled; out.mail[name] = await count([id]); }
  }
  await identities.loadIdentities();
  return out;
}, ids);
const send = (page, to) => inApp(page, async ({ api }, address) => { try { await api.post('/api/dev/inbound-mail', { to: address, subject: 'After the burn', text: 'x' }); return 'delivered'; } catch (err) { return `${err.status}`; } }, to);
const extraOf = (page, id) => inApp(page, async ({ identities }, gid) => { await identities.loadIdentities(); const g = identities.findIdentity(gid); return g ? g.extra : null; }, id);

// Step 1 and step 2 of a burn that is open on its list.
async function confirmBurn(page, name) {
  await top(page).getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: `Burn ${name}?` }).waitFor();
  const burn = top(page).getByRole('button', { name: 'Burn', exact: true });
  assert(await burn.isDisabled(), 'the last step needs no typed word');
  await top(page).getByRole('textbox').fill('BURN');
  await burn.click();
}

export default async function (t) {
  const s = await t.open();
  const { page } = s;
  s.allow(/status of 409 .*\/api\/dev\/inbound-mail$/, /net::ERR_FAILED/); // mail to a burned alias, and a request that this test stops
  await signUp(page, t.base);
  await addCredit(page, 30);
  const x = await inApp(page, async ({ data, api, phone, mail, identities }) => {
    const box = await data.createMailbox({ label: 'Main' });
    const alias = async (label) => { const a = await data.createAlias({ mailboxId: box.mailbox.id, label }); return { id: a.alias.id, address: a.address }; };
    const [a1, a2, b1, b2, solo, keep] = [await alias('Marketplace login'), await alias('Marketplace offers'), await alias('Second one'), await alias('Second two'), await alias('Alone'), await alias('Keep')];
    const inMail = (to, n) => Promise.all(Array.from({ length: n }, (_, i) => api.post('/api/dev/inbound-mail', { to, from: 'a@outside.example', subject: `Mail ${i + 1}`, text: 'x' })));
    await inMail(a1.address, 3); await inMail(a2.address, 2); await inMail(b1.address, 1); await inMail(b2.address, 2); await inMail(solo.address, 2); await inMail(keep.address, 1); await inMail(box.address, 1);
    await mail.sendMail({ from: { addressId: a1.id, address: a1.address }, to: ['buyer@outside.example'], subject: 'An answer', text: 'Yes.' });
    const buy = async (code, label) => { const n = await data.buyNumber({ number: (await phone.searchNumbers('US', code))[0].number, label }); return { id: n.number.id, plain: n.plain }; };
    const n1 = await buy('415', 'Marketplace phone');
    const n2 = await buy('212', 'Alone');
    const text = (n, body) => api.post('/api/dev/inbound-text', { numberId: n.id, number: n.plain, from: '+14155550142', body });
    await text(n1, 'One'); await text(n1, 'Two'); await text(n2, 'Other');
    await api.post(`/api/numbers/${n1.id}/texts`, { number: n1.plain, to: '+14155550142', body: 'An answer' });
    await api.post('/api/dev/inbound-call', { numberId: n1.id, number: n1.plain, from: '+14155550142', seconds: 0 });
    const g1 = await identities.createIdentity({ name: 'Marketplace' });
    const g2 = await identities.createIdentity({ name: 'Second' });
    await data.setItemIdentity('alias', a1.id, g1); await data.setItemIdentity('alias', a2.id, g1); await data.setItemIdentity('number', n1.id, g1);
    await data.setItemIdentity('alias', b1.id, g2); await data.setItemIdentity('alias', b2.id, g2);
    await data.loadAll();
    return { box: box.mailbox.id, a1, a2, b1, b2, solo, keep, n1, n2, g1, g2 };
  });
  const ids = { a1: x.a1.id, a2: x.a2.id, b1: x.b1.id, b2: x.b2.id, solo: x.solo.id, keep: x.keep.id };
  const before = await look(page, ids);
  assert(before.mail.a1 === 4 && before.mail.a2 === 2 && before.numbers.length === 2, 'the test data is not as planned: ' + JSON.stringify(before));

  // ---- an identity: the list says exactly what is destroyed ----
  const openBurn = async (group, name) => {
    await page.goto(`${t.base}/identities/${group}`);
    await page.locator('.page-actions').getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Burn', exact: true }).click();
    await page.getByRole('heading', { name: `Burn “${name}”`, exact: true }).waitFor();
    await top(page).locator('.f-burn-list').waitFor();
  };
  await openBurn(x.g1, 'Marketplace');
  const lines = top(page).locator('.f-burn-list > li');
  assert(await lines.count() === 4, 'the list does not have four lines');
  await top(page).locator('[data-burns="aliases"]').getByText('Turns off 2 aliases', { exact: true }).waitFor();
  for (const a of [x.a1, x.a2]) await top(page).locator('[data-burns="aliases"]').getByText(a.address, { exact: true }).waitFor();
  await top(page).locator('[data-burns="mail"]').getByText('Deletes 6 mails', { exact: true }).waitFor();
  await top(page).locator('[data-burns="numbers"]').getByText('Releases 1 number', { exact: true }).waitFor();
  await top(page).locator('[data-burns="numbers"]').getByText('You cannot get this number back.', { exact: true }).waitFor();
  await top(page).locator('[data-burns="phone"]').getByText('Deletes 3 texts and 1 call', { exact: true }).waitFor();
  await top(page).getByText('This cannot be undone', { exact: true }).waitFor();
  assert(!(await top(page).textContent()).includes(x.keep.address), 'the list names an alias that is not in the identity');
  t.ok('identity: the list names each alias and the number, with the exact counts of mail, texts and calls');

  // ---- "Cancel" at the list and at the word changes nothing ----
  await top(page).getByRole('button', { name: 'Cancel' }).click();
  await openBurn(x.g1, 'Marketplace');
  await top(page).getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Burn “Marketplace”?' }).waitFor();
  await top(page).getByRole('textbox').fill('BUR');
  assert(await top(page).getByRole('button', { name: 'Burn', exact: true }).isDisabled(), 'a wrong word turns the button on');
  await top(page).getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(400);
  assert(JSON.stringify(await look(page, ids)) === JSON.stringify(before), '"Cancel" changed something');
  assert(!('burning' in (await extraOf(page, x.g1))) && !('burned' in (await extraOf(page, x.g1))), '"Cancel" marked the identity');
  t.ok('"Cancel" at the list and at the last step changes nothing');

  // ---- burn ----
  await openBurn(x.g1, 'Marketplace');
  await confirmBurn(page, '“Marketplace”');
  await page.getByRole('heading', { name: 'Burning “Marketplace”' }).waitFor();
  await top(page).getByText('This identity is burned. Its aliases are off, their mail is deleted, and its numbers are released.').waitFor({ timeout: 30_000 });
  await top(page).getByRole('button', { name: 'Done' }).click();
  let now = await look(page, ids);
  assert(now.on.a1 === false && now.on.a2 === false && now.mail.a1 === 0 && now.mail.a2 === 0, 'the aliases are not off and empty: ' + JSON.stringify(now));
  assert(!now.numbers.includes(x.n1.id) && now.numbers.includes(x.n2.id), 'the wrong numbers are left: ' + now.numbers.join());
  assert(now.on.keep === true && now.mail.keep === 1 && now.mail.solo === 2 && now.mail.b1 === 1, 'the burn touched things outside the identity: ' + JSON.stringify(now));
  assert(await send(page, x.a1.address) === '409' && await send(page, x.keep.address) === 'delivered', 'a burned alias takes mail, or another alias refuses it');
  const extra = await extraOf(page, x.g1);
  assert(extra.burned && /^\d{4}-\d{2}-\d{2}$/.test(extra.burned.day) && !('burning' in extra) && extra.events.some((e) => e.type === 'burned'), 'the identity is not marked as burned: ' + JSON.stringify(extra));
  await page.reload();
  await page.locator('.page-head [data-door="burned"]').waitFor();
  assert((await page.locator('.page-head .identity-state').textContent()) === 'Burned', 'the identity does not say "Burned" after a reload');
  assert(await page.locator('[data-burn="open"]').count() === 0, 'a finished burn shows "Burn not finished"');
  t.ok('burn: the aliases are off, empty and refuse mail; the number is gone; the rest is untouched; the identity says "Burned" after a reload');

  // ---- a burn that stops in the middle is finished later ----
  await page.route(`**/api/addresses/${x.b2.id}/messages`, (route) => route.abort());
  await openBurn(x.g2, 'Second');
  await top(page).locator('[data-burns="mail"]').getByText('Deletes 3 mails', { exact: true }).waitFor();
  await confirmBurn(page, '“Second”');
  await top(page).getByText('The burn did not finish').waitFor({ timeout: 30_000 });
  await top(page).getByText('What is done stays done. Try again now, or open the identity later and select "Finish the burn".').waitFor();
  await top(page).getByRole('button', { name: 'Close' }).click();
  now = await look(page, ids);
  assert(now.mail.b1 === 0 && now.on.b1 === false && now.mail.b2 === 2, 'the stopped burn is not half done: ' + JSON.stringify(now));
  const half = await extraOf(page, x.g2);
  assert(half.burning && half.burning.aliasIds.join() === `${x.b1.id},${x.b2.id}` && !half.burned, 'the identity does not remember the burn: ' + JSON.stringify(half));
  await page.unroute(`**/api/addresses/${x.b2.id}/messages`);
  await page.goto(t.base + '/'); // as after a closed page: everything is read again
  await page.locator(`.identity-card[data-identity="${x.g2}"]`).getByText('Burn not finished', { exact: true }).waitFor();
  await page.goto(`${t.base}/identities/${x.g2}`);
  await page.locator('.page-head').getByText('Burn not finished', { exact: true }).waitFor();
  await page.locator('.page-actions').getByRole('button', { name: 'More', exact: true }).click();
  assert(await page.getByRole('menuitem', { name: 'Burn', exact: true }).count() === 0, 'a burn that is not finished offers a new "Burn"');
  await page.getByRole('menuitem', { name: 'Finish the burn' }).click();
  await page.getByRole('heading', { name: 'Finish the burn of “Second”?' }).waitFor();
  await top(page).getByText('Turns off 2 aliases and deletes their mail').waitFor();
  await top(page).getByRole('button', { name: 'Finish the burn' }).click();
  await top(page).getByText('This identity is burned.').waitFor({ timeout: 30_000 });
  await top(page).getByRole('button', { name: 'Done' }).click();
  now = await look(page, ids);
  const done = await extraOf(page, x.g2);
  assert(now.mail.b2 === 0 && now.on.b2 === false && done.burned && !('burning' in done), 'the burn is not finished: ' + JSON.stringify([now, done]));
  await page.locator('.page-head [data-door="burned"]').waitFor();
  assert(await page.locator('[data-burn="open"]').count() === 0, '"Burn not finished" stays after the end');
  t.ok('a burn that stops says so; after a reload the identity shows "Burn not finished", and "Finish the burn" completes it');

  // ---- one alias ----
  await page.goto(t.base + '/aliases');
  const soloRow = page.locator('.item-row[data-kind="alias"]').filter({ hasText: x.solo.address });
  await soloRow.getByRole('button', { name: /More actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Burn', exact: true }).click();
  await page.getByRole('heading', { name: `Burn ${x.solo.address}`, exact: true }).waitFor();
  await top(page).getByText('Turns off this alias', { exact: true }).waitFor();
  await top(page).getByText('Deletes 2 mails', { exact: true }).waitFor();
  assert(await top(page).locator('.f-burn-list > li').count() === 2, 'the list of one alias has lines about numbers');
  await confirmBurn(page, x.solo.address);
  await top(page).getByText('This alias is burned. It is off, and its mail is deleted.').waitFor({ timeout: 30_000 });
  await top(page).getByRole('button', { name: 'Done' }).click();
  await soloRow.getByText('Burned', { exact: true }).waitFor();
  now = await look(page, ids);
  assert(now.on.solo === false && now.mail.solo === 0 && now.mail.keep === 2, 'one alias: wrong result: ' + JSON.stringify(now));
  await page.reload();
  await soloRow.getByText('Burned', { exact: true }).waitFor();
  t.ok('one alias: it is off, its mail is gone, and the row says "Burned", also after a reload');

  // ---- one number, with the keyboard only ----
  await page.goto(t.base + '/numbers');
  const numberRow = page.locator('.item-row[data-kind="number"]');
  await numberRow.getByRole('button', { name: /More actions for/ }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menu').waitFor();
  await page.keyboard.press('End');
  for (let i = 0; i < 20 && !(await page.evaluate(() => document.activeElement.textContent.trim() === 'Burn')); i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await top(page).getByText('Releases this number', { exact: true }).waitFor();
  await top(page).getByText('Deletes 1 text and 0 calls', { exact: true }).waitFor();
  assert((await page.evaluate(() => document.activeElement.textContent.trim())) === 'Cancel', 'the focus of the list is not on "Cancel"');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter'); // Continue
  await page.getByRole('heading', { name: /^Burn .*\?$/ }).waitFor();
  assert((await page.evaluate(() => document.activeElement.tagName)) === 'INPUT', 'the focus of the last step is not in the field');
  await page.keyboard.press('Enter'); // nothing typed: nothing happens
  await page.waitForTimeout(300);
  assert((await look(page, ids)).numbers.includes(x.n2.id), 'Enter with no word burned the number');
  await page.keyboard.type('BURN');
  await page.keyboard.press('Enter');
  await top(page).getByText('This number is released. Its texts and calls are deleted.').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.activeElement && document.activeElement.textContent.trim() === 'Done');
  await page.keyboard.press('Enter');
  await numberRow.waitFor({ state: 'detached' });
  assert((await look(page, ids)).numbers.length === 0, 'the number is still there');
  t.ok('one number with the keyboard only: menu, list, the typed word, done');
  await s.close();

  // ---- phone screen ----
  const p = await t.open({ width: 390, height: 844 });
  await signUp(p.page, t.base);
  await addCredit(p.page, 10);
  const y = await inApp(p.page, async ({ data, api, identities }) => {
    const box = await data.createMailbox({ label: 'Main' });
    const g = await identities.createIdentity({ name: 'An identity with a rather long name for the phone' });
    for (const label of ['One', 'Two']) {
      const a = await data.createAlias({ mailboxId: box.mailbox.id, label, localPart: `a.very.long.alias.name.for.the.burn.list.${label.toLowerCase()}` + Math.floor(Math.random() * 9000 + 1000) });
      await api.post('/api/dev/inbound-mail', { to: a.address, subject: 'x', text: 'x' });
      await data.setItemIdentity('alias', a.alias.id, g);
    }
    await data.loadAll();
    return g;
  });
  await p.page.goto(`${t.base}/identities/${y}`);
  await p.page.locator('.page-actions').getByRole('button', { name: 'More', exact: true }).click();
  await p.page.getByRole('menuitem', { name: 'Burn', exact: true }).click();
  await top(p.page).locator('.f-burn-list').waitFor();
  const fits = () => p.page.evaluate(() => {
    const d = [...document.querySelectorAll('dialog[open]')].pop();
    const vw = document.documentElement.clientWidth;
    const out = [...d.querySelectorAll('*')].filter((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 1 || b.left < -1); }).length;
    const low = [...d.querySelectorAll('button, input')].filter((n) => n.getBoundingClientRect().height < 40).map((n) => (n.textContent || n.tagName).trim().slice(0, 20));
    return { out, low, scroll: document.documentElement.scrollWidth > vw };
  });
  let m = await fits();
  assert(m.out === 0 && !m.scroll && m.low.length === 0, 'the list on the phone: ' + JSON.stringify(m));
  await top(p.page).getByRole('button', { name: 'Continue' }).click();
  await top(p.page).getByRole('textbox').waitFor();
  m = await fits();
  assert(m.out === 0 && !m.scroll && m.low.length === 0, 'the last step on the phone: ' + JSON.stringify(m));
  t.ok('phone screen (390px): the list and the last step fit, with long names');
  await p.close();
}
