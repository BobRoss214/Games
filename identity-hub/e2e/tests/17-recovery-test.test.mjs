// "Test my recovery key" in Settings (web/js/features/recovery-test.js): the right key, a typing
// error, a valid key of a different account. The proof for "nothing is sent to the server":
// every request of the page is recorded during the tests, and there must be none.
import { signUp, assert } from '../lib.mjs';

const RIGHT = 'This is the right key for this account.';
const TYPO = 'This key has a typing error.';
const OTHER = 'This is a valid key, but for a different account.';

// Settings is loaded and quiet: its lists are painted and no request is on its way.
async function settingsIdle(page, base) {
  await page.goto(base + '/settings');
  await page.locator('[data-section="recovery-test"]').getByRole('heading', { name: 'Test my recovery key', level: 2 }).waitFor();
  await page.getByText('No passkey yet').waitFor();
  await page.getByText('This browser', { exact: true }).first().waitFor();
  let last = Date.now();
  const mark = () => { last = Date.now(); };
  page.on('request', mark);
  page.on('requestfinished', mark);
  while (Date.now() - last < 1500) await page.waitForTimeout(200);
  page.off('request', mark);
  page.off('requestfinished', mark);
}

export default async function (t) {
  // A second account gives a key that is valid, but for a different account.
  const o = await t.open();
  const otherKey = await signUp(o.page, t.base);
  await o.close();

  const s = await t.open();
  const { page } = s;
  const key = await signUp(page, t.base);
  assert(key !== otherKey && /^([0-9A-Z]{4}-){8}[0-9A-Z]{4}$/.test(key), 'the recovery key has a different form than this test expects');
  await settingsIdle(page, t.base);

  const part = page.locator('[data-section="recovery-test"]');
  const field = part.getByRole('textbox', { name: 'Recovery key' });
  const test = part.getByRole('button', { name: 'Test the key' });
  const answer = part.locator('.f-rtest-answer');
  assert(await answer.getAttribute('role') === 'status', 'the answer is not announced');
  await part.getByText('Nothing is sent to the server.').waitFor();

  // From here on every request counts.
  const requests = [];
  const listen = (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`);
  page.on('request', listen);

  // the right key, typed in lower case with spaces
  await field.fill(key.toLowerCase().replace(/-/g, ' '));
  await test.click();
  await answer.getByText(RIGHT, { exact: true }).waitFor();
  assert(await field.inputValue() === '', 'the key is still in the field after the test');
  t.ok('the right key: the app says so and empties the field');

  // one wrong character
  const typo = key.slice(0, 5) + (key[5] === 'A' ? 'B' : 'A') + key.slice(6);
  await field.fill(typo);
  assert(await answer.textContent() === '', 'the old answer stays while a new key is typed');
  await test.click();
  await answer.getByText(TYPO).waitFor();
  assert(await field.inputValue() === typo, 'a key with a typing error must stay, so that the person can correct it');
  // text that is no key at all
  await field.fill('my dog');
  await test.click();
  await answer.getByText('A recovery key has 36 letters and numbers, in 9 groups of 4.').waitFor();
  await field.fill('');
  await test.click();
  await answer.getByText('Enter your recovery key.').waitFor();
  t.ok('a typing error, a text that is no key, and an empty field get plain answers');

  // a valid key of a different account
  await field.fill(otherKey);
  await test.click();
  await answer.getByText(OTHER, { exact: true }).waitFor();
  assert(await field.inputValue() === '', 'the key of the other account is still in the field');
  t.ok('a valid key of a different account is told apart');

  // the keyboard only
  await field.focus();
  await page.keyboard.type(key);
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const e = document.activeElement; const st = getComputedStyle(e); return e.textContent.trim() === 'Test the key' && st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) >= 2; });
  assert(ring, 'Tab does not go from the field to the button with a focus ring');
  await page.keyboard.press('Enter');
  await answer.getByText(RIGHT, { exact: true }).waitFor();
  t.ok('the test works with the keyboard only');

  // Nothing was sent, and nothing was kept.
  await page.waitForTimeout(1000);
  page.off('request', listen);
  assert(requests.length === 0, 'the test made requests: ' + requests.join(', '));
  const kept = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]) + document.cookie + location.href);
  for (const secret of [key, otherKey]) {
    assert(!kept.includes(secret.slice(0, 14)) && !kept.includes(secret.replace(/-/g, '').slice(0, 12)), 'a recovery key is in the browser storage or in the address');
  }
  t.ok('no request during the tests; no key in storage, cookies or the address');
  await s.close();

  // phone screen: no sideways scroll, the controls are large enough
  const p = await t.open({ width: 390, height: 844 });
  await signUp(p.page, t.base);
  await p.page.goto(t.base + '/settings');
  const small = p.page.locator('[data-section="recovery-test"]');
  await small.getByRole('textbox', { name: 'Recovery key' }).fill(otherKey);
  await small.getByRole('button', { name: 'Test the key' }).click();
  await small.getByText(OTHER, { exact: true }).waitFor();
  const m = await p.page.evaluate(() => {
    const root = document.querySelector('[data-section="recovery-test"]');
    const vw = document.documentElement.clientWidth;
    const out = [...root.querySelectorAll('*')].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 1 || b.left < -1); }).length;
    const low = [...root.querySelectorAll('button:not(.why-btn), textarea')].filter((el) => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 40).map((el) => el.textContent.trim().slice(0, 20));
    return { out, low };
  });
  assert(m.out === 0, 'a part of the test sticks out of the phone screen');
  assert(m.low.length === 0, 'small targets: ' + m.low.join(', '));
  t.ok('phone screen (390px): the test fits');
  await p.close();
}
