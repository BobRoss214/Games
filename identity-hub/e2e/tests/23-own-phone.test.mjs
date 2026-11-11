// The "own phone" provider: texts only, the numbers come from the phones of the server.
// The real provider is NOT connected in this test. The test changes the answers of the server on
// their way to the page (the settings, the number list, the search), as the contract says they will be.
import { signUp, signIn, seedAccount, inApp, assert } from '../lib.mjs';

const json = (body) => ({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });

// state.gateway: (number id) => { online, lastSeen } ; state.free: the numbers that the search gives
async function fakeOwnPhone(s, state) {
  await s.context.route('**/api/config', async (route) => {
    const cfg = await (await route.fetch()).json();
    cfg.features = { ...cfg.features, ownPhone: true, voice: false, voicemail: false, searchByArea: false };
    await route.fulfill(json(cfg));
  });
  await s.context.route('**/api/numbers', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const data = await (await route.fetch()).json();
    data.numbers = (data.numbers || []).map((n) => ({ ...n, voice: false, voicemail: false, gateway: state.gateway(n.id) }));
    return route.fulfill(json(data));
  });
  await s.context.route('**/api/numbers/search**', async (route) => {
    state.searches.push(new URL(route.request().url()).search);
    if (state.free === null) return route.continue();
    return route.fulfill(json({ numbers: state.free }));
  });
}

export default async function (t) {
  // An account with numbers and texts, made on the normal test server.
  const first = await t.open();
  const key = await signUp(first.page, t.base);
  const ids = await seedAccount(first.page);
  await first.close();

  const now = Math.floor(Date.now() / 1000);
  const state = { searches: [], free: [], gateway: (id) => (id === ids.n1 ? { online: true, lastSeen: now - 20 } : { online: false, lastSeen: now - 2 * 3600 }) };
  const d = await t.open();
  const { page } = d;
  const dlg = page.getByRole('dialog');
  await fakeOwnPhone(d, state);
  await signIn(page, t.base, key);

  // ---- Home: the rows say it in words; a warning for the phone that is offline for more than one hour ----
  const row1 = page.locator(`.item-row[data-id="${ids.n1}"]`);
  const row2 = page.locator(`.item-row[data-id="${ids.n2}"]`);
  await row1.locator('[data-phone="online"]', { hasText: 'Phone online' }).waitFor();
  await row2.locator('[data-phone="offline"]', { hasText: /^Phone offline since \d\d:\d\d$|^Phone offline since Yesterday$/ }).waitFor();
  const warn = page.locator('.home-slot[data-section="warnings"] [data-warning="offline"]');
  await warn.getByText('A phone is offline').waitFor();
  const wtext = (await warn.textContent()).replace(/\s+/g, ' ');
  assert(wtext.includes('(Deliveries): the phone for this number is offline since') && wtext.includes('Texts wait until it is online again.'), 'the Home warning is wrong: ' + wtext);
  assert(!wtext.includes('Selling the bike'), 'the Home warning names a number whose phone is online');
  t.ok('rows: "Phone online" and "Phone offline since …" in words; Home warns about the phone that is offline for more than one hour');

  // a phone that is offline for less than one hour: words on the row, no warning
  state.gateway = (id) => (id === ids.n1 ? { online: true, lastSeen: now - 20 } : { online: false, lastSeen: now - 600 });
  await inApp(page, ({ data }) => data.loadNumbers());
  await warn.waitFor({ state: 'detached' });
  await row2.locator('[data-phone="offline"]').waitFor();
  state.gateway = (id) => (id === ids.n1 ? { online: true, lastSeen: now - 20 } : { online: false, lastSeen: now - 2 * 3600 });
  t.ok('offline for less than one hour: the row says it, Home does not warn yet');

  // ---- the number screen of the offline phone ----
  await page.goto(`${t.base}/numbers/${ids.n2}`);
  await page.locator('.page-head [data-phone="offline"]', { hasText: 'Phone offline since' }).waitFor();
  await page.locator('[data-warning="offline"]').getByText('The phone for this number is offline. Texts wait until it is online again.').waitFor();
  // Calls: no call list, one short explanation
  await page.getByRole('tab', { name: 'Calls' }).click();
  await page.getByText('This number cannot make or get calls through Postern. To get calls, set call forwarding on the SIM card. Help explains how.').waitFor();
  assert(await page.locator('.call-list, .calls-head').count() === 0 && await page.getByRole('button', { name: 'Call', exact: true }).count() === 0, 'the Calls tab of an own-phone number shows call parts');
  // Settings: no call forwarding and no voicemail
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Forwarding' }).waitFor();
  const settings = (await page.locator('.number-settings').innerText()).replace(/\s+/g, ' '); // what a person sees
  // (The "Voicemail" section belongs to the voicemail feature file. It is not checked here.)
  const own = settings.split('Voicemail')[0];
  const hit = /.{0,60}(Forward calls|calls).{0,60}/.exec(own);
  assert(!hit, 'the settings of an own-phone number show call parts: ' + (hit && hit[0]));
  t.ok('number screen: "Phone offline since …", the warning, a Calls tab with one explanation, no call forwarding');

  // ---- a text that waits: "Waiting for the phone" ----
  await d.context.route(`**/api/numbers/${ids.n1}/texts**`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const data = await (await route.fetch()).json();
    data.texts = (data.texts || []).map((x) => (x.direction === 'out' ? { ...x, status: 'queued' } : x));
    return route.fulfill(json(data));
  });
  await page.goto(`${t.base}/numbers/${ids.n1}`);
  await page.locator('.page-head [data-phone="online"]', { hasText: 'Phone online' }).waitFor();
  assert(await page.locator('[data-warning="offline"]').count() === 0, 'a number whose phone is online shows the offline warning');
  await page.locator('.thread', { hasText: '555 0142' }).click();
  await page.locator('.bubble-status', { hasText: 'Waiting for the phone' }).waitFor();
  assert(await page.locator('.bubble-status', { hasText: 'Sending' }).count() === 0, 'a waiting text says "Sending"');
  t.ok('a text that waits says "Waiting for the phone"');

  // ---- Get a number: the free numbers at once, no country and no area code ----
  state.free = [
    { number: '+14155550170', country: 'US', region: 'CA', locality: 'San Francisco', sms: true, voice: false },
    { number: '+14155550171', country: 'US', region: 'CA', locality: 'San Francisco', sms: true, voice: false },
  ];
  state.searches.length = 0;
  await page.goto(t.base + '/numbers');
  await page.getByRole('button', { name: 'Get a number' }).first().click();
  await dlg.getByText('These numbers come from the phones of this server.').waitFor();
  await dlg.locator('.number-option').nth(1).waitFor();
  assert(await dlg.getByLabel('Country').count() === 0 && await dlg.getByLabel('Area code').count() === 0, 'the dialog asks for a country or an area code');
  assert(state.searches.length === 1 && !/areaCode|country/.test(state.searches[0]), 'the search sent a country or an area code: ' + state.searches.join(' '));
  assert(await dlg.locator('.number-option').count() === 2, 'the free numbers are not listed');
  assert(await dlg.locator('.number-option', { hasText: 'Calls' }).count() === 0, 'a number of an own phone is offered with calls');
  // nothing free
  state.free = [];
  await dlg.getByRole('button', { name: 'Look again' }).click();
  await dlg.getByText('No number is free now.').waitFor();
  await page.keyboard.press('Escape');
  t.ok('Get a number: the free numbers of the server at once, with one line of explanation; "No number is free now." when the pool is empty');
  await d.close();

  // ---- phone width ----
  const p = await t.open({ width: 360, height: 640 });
  await fakeOwnPhone(p, state);
  await signIn(p.page, t.base, key);
  await p.page.locator('[data-warning="offline"]').waitFor();
  await p.page.locator('[data-phone="offline"]').first().waitFor();
  let wide = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(wide <= 0, 'Home with the phone words scrolls sideways on a phone');
  await p.page.goto(`${t.base}/numbers/${ids.n2}`);
  await p.page.locator('[data-warning="offline"]').waitFor();
  wide = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(wide <= 0, 'the number screen with the offline warning scrolls sideways on a phone');
  t.ok('phone (360px): the own-phone words and warnings fit');
  await p.close();
}
