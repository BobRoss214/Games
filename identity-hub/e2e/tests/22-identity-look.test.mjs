// How an identity looks: the door (open = on, shut = off, bricked up = burned) with the word
// next to it, the colour dot, and the small history. All of it is saved encrypted with the identity.
import { signUp, signIn, seedAccount, inApp, assert } from '../lib.mjs';

export default async function (t) {
  const d = await t.open();
  const { page } = d;
  const key = await signUp(page, t.base);
  const ids = await seedAccount(page);
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const id = await inApp(page, ({ identities }) => identities.createIdentity({ name: 'Maple', note: 'Orders' }));
  const stored = () => inApp(page, ({ store }, id) => store.get('identities').find((g) => g.id === id), id);
  const history = () => page.locator('.history-list li').evaluateAll((els) => els.map((el) => [...el.children].map((c) => c.textContent.trim()).join(' ')));

  // ---- an empty identity: door shut, "Off"; history starts with "Made" ----
  await page.goto(t.base + '/');
  const card = page.locator(`.identity-card[data-identity="${id}"]`);
  await card.locator('[data-door="off"]').waitFor();
  assert((await card.locator('.identity-card-count').textContent()) === 'Off · Empty', 'the card of an empty identity is wrong: ' + await card.locator('.identity-card-count').textContent());
  await card.click();
  await page.getByRole('heading', { name: 'Maple', level: 1 }).waitFor();
  await page.locator('.page-head [data-door="off"]').waitFor();
  assert((await page.locator('.page-head .identity-state').textContent()) === 'Off', 'the screen does not say "Off"');
  assert((await history()).join('|') === `${today} Made`, 'the history does not start with "Made": ' + (await history()).join('|'));
  t.ok('empty identity: door shut with the word "Off"; the history starts with "Made"');

  // ---- an alias that is on: door open, "On" ----
  await inApp(page, ({ data }, a) => data.setItemIdentity('alias', a.alias, a.id), { alias: ids.shop, id });
  await page.locator('.page-head [data-door="on"]').waitFor();
  assert((await page.locator('.page-head .identity-state').textContent()) === 'On', 'the screen does not say "On"');
  // the mail of the alias shows in the feed: the history gets "First mail"
  await page.locator('.feed-item').first().waitFor();
  await page.locator('.history-list li[data-event="first-mail"]').waitFor();
  t.ok('an alias that is on opens the door ("On"); the first mail in the feed is written to the history');

  // ---- colour, with the keyboard; the focus stays in the choice ----
  const picker = page.getByRole('radiogroup', { name: 'Colour' });
  const names = await picker.locator('label').allTextContents();
  assert(names.join('|') === 'No colour|Red|Orange|Gold|Green|Teal|Blue|Purple|Pink', 'the colour choices are wrong: ' + names.join('|'));
  await picker.getByLabel('No colour').focus();
  await page.keyboard.press('ArrowRight'); // Red
  await page.getByText('Colour saved: red').waitFor();
  await page.locator('.page-head .dot[data-colour="red"]').waitFor();
  await page.keyboard.press('ArrowRight'); // Orange
  await page.getByText('Colour saved: orange').waitFor();
  await page.locator('.page-head .dot[data-colour="orange"]').waitFor();
  assert(await page.evaluate(() => document.activeElement.type === 'radio' && document.activeElement.checked && !!document.activeElement.closest('.colour-picker')), 'the focus left the colour choice');
  await picker.getByText('Blue', { exact: true }).click();
  await page.getByText('Colour saved: blue').waitFor();
  const dot = page.locator('.page-head .dot[data-colour="blue"]');
  await dot.waitFor();
  assert(await dot.getAttribute('aria-label') === 'Colour: blue' && await dot.getAttribute('role') === 'img', 'the dot has no name for screen readers');
  assert((await stored()).extra.colour === 'blue', 'the colour is not saved with the identity');
  // the dot is real colour, and different in the dark theme
  const light = await dot.evaluate((el) => getComputedStyle(el).backgroundColor);
  assert(light === 'rgb(47, 99, 184)', 'the blue dot has a wrong colour: ' + light);
  t.ok('colour: eight named colours, picked with the keyboard, saved encrypted; the dot has a name for screen readers');

  // ---- the dot and the door on Home, and the dot on the row of a member ----
  await page.goto(t.base + '/aliases');
  await page.locator(`.item-row[data-id="${ids.shop}"] .item-group .dot[data-colour="blue"]`).waitFor();
  await page.goto(t.base + '/');
  await card.locator('.dot[data-colour="blue"]').waitFor();
  await card.locator('[data-door="on"]').waitFor();
  assert((await card.locator('.identity-card-count').textContent()).startsWith('On · 1 address'), 'the card does not say "On": ' + await card.locator('.identity-card-count').textContent());
  assert((await card.locator('.identity-card-name').textContent()) === 'Maple', 'the name is not next to the dot');
  t.ok('Home card: door open, the word "On", the dot next to the name; the row of a member shows the dot too');

  // ---- turn the alias off and on again on the identity screen: door, word, history ----
  await card.click();
  const row = page.locator(`.item-row[data-id="${ids.shop}"]`);
  await row.getByRole('switch').click();
  await page.locator('.page-head [data-door="off"]').waitFor();
  await page.locator('.history-list li[data-event="turned-off"]').waitFor();
  await row.getByRole('switch').click();
  await page.locator('.page-head [data-door="on"]').waitFor();
  await page.locator('.history-list li[data-event="turned-on"]').waitFor();
  await page.reload();
  await page.locator('.history-list li').nth(3).waitFor();
  const list = await history();
  assert(list.length === 4 && /Made$/.test(list[0]) && /First mail$/.test(list[1]) && /All aliases turned off$/.test(list[2]) && /An alias turned on again$/.test(list[3]), 'the history is wrong after a reload: ' + list.join('|'));
  assert(list[2].startsWith(today), 'the day of an event is wrong: ' + list[2]);
  const events = (await stored()).extra.events;
  assert(events.length === 4 && events.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.day)) && events.map((e) => e.type).join() === 'made,first-mail,turned-off,turned-on', 'the saved events are wrong: ' + JSON.stringify(events));
  t.ok('history: made, first mail, turned off, turned on again; kept after a reload');

  // ---- burned (the burn feature of another file marks it): bricked-up door, "Burned" ----
  await inApp(page, async ({ identities }, id) => { await identities.setIdentityExtra(id, { burned: { day: new Date().toISOString().slice(0, 10) } }); await identities.addIdentityEvent(id, 'burned'); }, id);
  await page.locator('.page-head [data-door="burned"]').waitFor();
  assert((await page.locator('.page-head .identity-state').textContent()) === 'Burned', 'the screen does not say "Burned"');
  await page.locator('.history-list li[data-event="burned"]', { hasText: 'Burned' }).waitFor();
  await page.goto(t.base + '/');
  await card.locator('[data-door="burned"]').waitFor();
  assert((await card.locator('.identity-card-count').textContent()).startsWith('Burned · '), 'the card does not say "Burned"');
  // "No colour" takes the dot away
  await card.click();
  await page.getByRole('radiogroup', { name: 'Colour' }).getByText('No colour', { exact: true }).click();
  await page.getByText('Colour removed').waitFor();
  assert(await page.locator('.page-head .dot').count() === 0, 'the dot stays after "No colour"');
  await page.getByRole('radiogroup', { name: 'Colour' }).getByText('Green', { exact: true }).click();
  await page.getByText('Colour saved: green').waitFor();
  t.ok('burned: bricked-up door with the word "Burned" on the screen and on the card; "No colour" removes the dot');
  await d.close();

  // ---- dark theme and phone ----
  const p = await t.open({ width: 360, height: 640, dark: true });
  await signIn(p.page, t.base, key);
  const pcard = p.page.locator(`.identity-card[data-identity="${id}"]`);
  await pcard.locator('.dot[data-colour="green"]').waitFor();
  const darkGreen = await pcard.locator('.dot').evaluate((el) => getComputedStyle(el).backgroundColor);
  assert(darkGreen === 'rgb(127, 208, 160)', 'the dot does not change with the dark theme: ' + darkGreen);
  await pcard.click();
  await p.page.locator('.history-list li').first().waitFor();
  const wide = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(wide <= 0, 'the identity screen scrolls sideways on a phone');
  const small = await p.page.locator('.colour-option label').evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height < 44).length);
  assert(small === 0, 'a colour choice is too small for a finger');
  t.ok('dark theme: the dot has its dark colour; phone (360px): the screen fits and the colour choices are large enough');
  await p.close();
}
