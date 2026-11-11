// Voicemail: the price and the notes before the switch, a call with a message, Play with a
// real duration, Download, the charge in the ledger, a phone screen, the keyboard, and a
// server with phones off.
import { readFileSync } from 'node:fs';
import { signUp, addCredit, inApp, assert, startServer } from '../lib.mjs';

const GREETING = 'The person you called is not available. Please leave a message after the tone.';
const CALLER = '+14155550142';

// Buys a number through the app's own code. Returns { id, plain }.
function buyNumber(page, label) {
  return inApp(page, async ({ data, phone }, text) => {
    const found = await phone.searchNumbers('US', '415');
    const res = await data.buyNumber({ number: found[0].number, label: text });
    await data.setPref('hideChecklist', true);
    return { id: res.number.id, plain: res.plain };
  }, label);
}
// A caller who reaches nobody and leaves a message (the dev route of the simulated provider).
const leaveVoicemail = (page, n, seconds) => inApp(page, ({ api }, a) => api.post('/api/dev/inbound-call', { numberId: a.id, number: a.plain, from: a.from, voicemail: true, seconds: a.seconds }), { ...n, from: CALLER, seconds });
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

export default async function (t) {
  // ---------- desktop ----------
  const s = await t.open();
  const { page } = s;
  await signUp(page, t.base);
  await addCredit(page, 20);
  const n = await buyNumber(page, 'Shop line');

  await page.goto(`${t.base}/numbers/${n.id}`);
  await page.getByRole('tab', { name: 'Settings' }).click();
  const section = page.locator('[data-section="voicemail"]');
  const toggle = section.getByRole('switch', { name: 'Voicemail' });
  await toggle.waitFor();
  assert(await toggle.getAttribute('aria-checked') === 'false', 'voicemail is on for a new number');
  const before = await section.innerText();
  assert(before.includes('$0.05'), 'the price does not show before voicemail is turned on');
  assert(before.includes('2 minutes'), 'the longest message does not show');
  assert(before.includes(GREETING), 'the greeting does not show');
  assert(/What the phone company hears and keeps/.test(before) && /hears the whole message/.test(before) && /deletes the recording at the phone company/.test(before) && /call records/.test(before), 'the note about the phone company is not complete');
  t.ok('price, longest message, greeting and the phone-company note show before the switch is on');

  // A call before voicemail is on: a missed call with no voicemail line.
  await inApp(page, ({ api }, a) => api.post('/api/dev/inbound-call', { numberId: a.id, number: a.plain, from: a.from, voicemail: true }), { ...n, from: CALLER });
  await page.getByRole('tab', { name: 'Calls' }).click();
  await page.locator('.call-row').first().waitFor();
  await page.waitForTimeout(600);
  assert(await page.locator('.call-row').count() === 1 && await page.locator('.f-vm').count() === 0, 'a call got a voicemail line with voicemail off');
  t.ok('with voicemail off a missed call has no voicemail');

  await page.getByRole('tab', { name: 'Settings' }).click();
  await toggle.click();
  await page.getByText('Voicemail turned on', { exact: true }).waitFor();
  assert(await toggle.getAttribute('aria-checked') === 'true', 'the switch did not go on');
  await page.reload();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.locator('[data-section="voicemail"]').getByRole('switch', { name: 'Voicemail' }).waitFor();
  assert(await toggle.getAttribute('aria-checked') === 'true', 'the switch is off again after a reload');
  t.ok('voicemail turned on; the server keeps the setting');

  // A caller leaves a message of 7 seconds. The Calls tab is open: the line comes by itself.
  await page.getByRole('tab', { name: 'Calls' }).click();
  await page.locator('.call-row').first().waitFor();
  await leaveVoicemail(page, n, 7);
  const line = page.locator('.call-row .f-vm').first();
  await line.waitFor({ timeout: 10_000 });
  assert(await page.locator('.call-row').count() === 2 && await page.locator('.f-vm').count() === 1, 'the wrong calls have a voicemail line');
  assert((await line.innerText()).includes('Voicemail · 0:07'), 'the voicemail line does not say "Voicemail · 0:07"');
  assert(/Missed call/.test(await page.locator('.call-row').first().innerText()), 'the call with the voicemail is not a missed call');
  t.ok('the call row shows "Voicemail · 0:07"');

  // Play: the audio element gets the decrypted sound from a blob: URL.
  await line.getByRole('button', { name: /^Play/ }).click();
  const audio = line.locator('audio');
  await audio.waitFor();
  await page.waitForFunction(() => { const a = document.querySelector('.f-vm audio'); return a && Number.isFinite(a.duration) && a.duration > 0.5; }, null, { timeout: 10_000 });
  const playing = await audio.evaluate((a) => ({ duration: a.duration, src: a.src, error: a.error ? a.error.code : 0 }));
  assert(playing.src.startsWith('blob:'), 'the audio does not come from a blob: URL');
  assert(Math.abs(playing.duration - 1) < 0.2 && !playing.error, `the audio has no real duration (${playing.duration})`);
  await page.waitForFunction(() => { const a = document.querySelector('.f-vm audio'); return a && (a.currentTime > 0 || a.ended); }, null, { timeout: 10_000 });
  t.ok('Play loads the voicemail; the audio has a real duration (1 s) and plays');

  // The list paints again (a new call): the same player stays.
  await inApp(page, ({ api }, a) => api.post('/api/dev/inbound-call', { numberId: a.id, number: a.plain, from: '+14155550177', seconds: 12 }), n);
  await page.waitForFunction(() => document.querySelectorAll('.call-row').length === 3, null, { timeout: 10_000 });
  await page.waitForTimeout(400);
  assert(await page.locator('.f-vm audio').count() === 1 && (await audio.evaluate((a) => a.src)).startsWith('blob:'), 'the player went away when the list painted again');
  t.ok('the player stays when the call list paints again');

  // Download: the decrypted file is the WAV of the simulated provider.
  const [download] = await Promise.all([page.waitForEvent('download'), line.getByRole('button', { name: 'Download the voicemail' }).click()]);
  const wav = readFileSync(await download.path());
  assert(/^voicemail-\d{4}-\d{2}-\d{2}\.wav$/.test(download.suggestedFilename()), `the file name is ${download.suggestedFilename()}`);
  assert(wav.length === 16044 && wav.subarray(0, 4).toString('latin1') === 'RIFF', 'the download is not the recorded sound');
  t.ok('Download gives the decrypted sound');

  // Delete the call: the voicemail goes with it, on the server too.
  const callId = await line.getAttribute('data-vm');
  await page.locator('.call-row', { has: page.locator('.f-vm') }).getByRole('button', { name: 'Call actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.call-row').length === 2 && !document.querySelector('.f-vm'), null, { timeout: 10_000 });
  s.allow(/status of 404 .*\/api\/calls\/[^/]+\/voicemail/); // asked on purpose, after the delete
  const gone = await page.evaluate((id) => fetch(`/api/calls/${id}/voicemail`).then((r) => r.status), callId);
  assert(gone === 404, 'the voicemail is still on the server after the call was deleted');
  t.ok('deleting the call removes the voicemail');

  // The ledger has the charge.
  const bill = await inApp(page, ({ api }) => api.get('/api/billing'));
  assert(bill.ledger.filter((l) => l.kind === 'voicemail' && l.delta === -5).length === 1, 'the ledger has no voicemail charge of $0.05');
  await page.goto(t.base + '/funds');
  await page.locator('.ledger tr', { hasText: /voicemail/i }).filter({ hasText: '$0.05' }).first().waitFor();
  t.ok('the ledger shows one voicemail charge of $0.05');

  await s.close();

  // ---------- phone, 390 px ----------
  const m = await t.open({ width: 390, height: 844 });
  await signUp(m.page, t.base);
  await addCredit(m.page, 20);
  const n2 = await buyNumber(m.page, 'Phone line');
  await m.page.goto(`${t.base}/numbers/${n2.id}`);
  await m.page.getByRole('tab', { name: 'Settings' }).click();
  const toggle2 = m.page.locator('[data-section="voicemail"]').getByRole('switch', { name: 'Voicemail' });
  await toggle2.scrollIntoViewIfNeeded();
  assert(await noSidewaysScroll(m.page), 'the voicemail setting scrolls sideways at 390px');
  assert((await toggle2.boundingBox()).height >= 44, 'the voicemail switch is lower than 44px at 390px');
  await toggle2.click();
  await m.page.getByText('Voicemail turned on', { exact: true }).waitFor();
  await m.page.getByRole('tab', { name: 'Calls' }).click();
  await leaveVoicemail(m.page, n2, 65);
  const line2 = m.page.locator('.call-row .f-vm').first();
  await line2.waitFor({ timeout: 10_000 });
  assert((await line2.innerText()).includes('Voicemail · 1:05'), 'a message of 65 seconds does not show as 1:05');
  for (const name of [/^Play/, 'Download the voicemail']) {
    const box = await line2.getByRole('button', { name }).boundingBox();
    assert(box.height >= 40, `a voicemail button is ${box.height}px high at 390px`);
  }
  await line2.getByRole('button', { name: /^Play/ }).click();
  await line2.locator('audio').waitFor();
  await m.page.waitForFunction(() => { const a = document.querySelector('.f-vm audio'); return a && a.duration > 0.5; }, null, { timeout: 10_000 });
  assert(await noSidewaysScroll(m.page), 'the call list with a player scrolls sideways at 390px');
  t.ok('390px: no sideways scroll, large targets, the player fits');
  await m.close();

  // ---------- keyboard only ----------
  const k = await t.open();
  await signUp(k.page, t.base);
  await addCredit(k.page, 20);
  const n3 = await buyNumber(k.page, 'Keyboard line');
  await k.page.goto(`${t.base}/numbers/${n3.id}`);
  await k.page.getByRole('tab', { name: 'Settings' }).focus();
  await k.page.keyboard.press('Enter');
  const toggle3 = k.page.locator('[data-section="voicemail"]').getByRole('switch', { name: 'Voicemail' });
  await toggle3.focus();
  await k.page.keyboard.press('Space');
  await k.page.getByText('Voicemail turned on', { exact: true }).waitFor();
  await leaveVoicemail(k.page, n3, 5);
  await k.page.getByRole('tab', { name: 'Settings' }).focus();
  await k.page.keyboard.press('ArrowLeft'); // to the Calls tab
  const play3 = k.page.locator('.call-row .f-vm').getByRole('button', { name: /^Play/ });
  await play3.waitFor({ timeout: 10_000 });
  for (let i = 0; i < 20 && !(await play3.evaluate((el) => el === document.activeElement)); i++) await k.page.keyboard.press('Tab');
  assert(await play3.evaluate((el) => el === document.activeElement), 'Tab does not reach the Play button');
  await k.page.keyboard.press('Enter');
  await k.page.waitForFunction(() => { const a = document.querySelector('.f-vm audio'); return a && a.duration > 0.5; }, null, { timeout: 10_000 });
  t.ok('keyboard only: turn voicemail on, reach Play, start it');
  await k.close();

  // ---------- a server with phones off ----------
  const off = await startServer({ PHONE_PROVIDER: 'off' });
  try {
    const o = await t.open();
    await signUp(o.page, off.url);
    await o.page.goto(off.url + '/numbers');
    await o.page.getByText('Numbers are turned off').waitFor();
    assert(await o.page.locator('[data-section="voicemail"], .f-vm').count() === 0, 'voicemail parts show on a server with phones off');
    // The export section and its dialog do not offer voicemail there.
    await o.page.goto(off.url + '/settings');
    const ex = o.page.locator('[data-export="section"]');
    await ex.waitFor();
    assert(!/voicemail|texts|call history|real phone/i.test(await ex.innerText()), 'the export section talks about phone data on a server with phones off');
    await ex.getByRole('button', { name: 'Download my data' }).click();
    const odlg = o.page.getByRole('dialog');
    await odlg.locator('[data-export="estimate"]').waitFor();
    await odlg.getByLabel('Leave out attachments', { exact: true }).waitFor();
    assert(!/voicemail|Texts|Calls/.test(await odlg.innerText()), 'the export dialog talks about phone data on a server with phones off');
    await odlg.getByRole('button', { name: 'Cancel' }).click();
    t.ok('a server with phones off shows no voicemail');
    await o.close();
  } finally {
    await off.stop();
  }
}
