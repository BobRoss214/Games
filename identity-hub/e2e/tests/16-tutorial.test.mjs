// The guided tutorial (web/js/features/tutorial.js): the offer on Home, all 14 steps with the
// real actions in test mode, the saved progress (encrypted, the same size each time), a second
// device that continues, a zero balance, a server with phones and payments off, the keyboard,
// a phone screen, "Not now", and "Start again" from Settings.
import { TUTORIAL } from '../../web/js/help/content.js';
import { signUp, signIn, startServer, makeContext, lastPhoneCode, inApp, assert } from '../lib.mjs';

const TOTAL = TUTORIAL.length;
const usd = (credits) => `$${(credits / 100).toFixed(2)}`;

// The words of one step, as the screen shows them (the tokens are filled in).
function wordsFor(config) {
  return (id, part) => {
    const step = TUTORIAL.find((s) => s.id === id);
    const price = step.costKey ? usd(config.prices[step.costKey] || 0) : usd(0);
    return String(step[part]).replaceAll('{app}', config.appName).replaceAll('{price}', price);
  };
}

const card = (page, id) => page.locator(`section[data-step="${id}"]`);
const next = (page) => page.getByRole('button', { name: 'Next', exact: true }).click();
const skip = (page) => page.getByRole('button', { name: 'Skip this step' }).click();

// The screen shows the step with this number: the words, the bar, and the title.
async function atStep(page, n, id, words) {
  await card(page, id).waitFor();
  await page.getByText(`Step ${n} of ${TOTAL}`, { exact: true }).waitFor();
  const bar = page.getByRole('progressbar', { name: 'Tutorial' });
  assert(await bar.getAttribute('aria-valuenow') === String(n) && await bar.getAttribute('aria-valuemax') === String(TOTAL), `the bar does not say step ${n}`);
  assert(await bar.getAttribute('aria-valuetext') === `Step ${n} of ${TOTAL}`, 'the bar has no words');
  const share = await bar.evaluate((el) => el.firstElementChild.getBoundingClientRect().width / el.getBoundingClientRect().width);
  assert(Math.abs(share - n / TOTAL) < 0.04, `the bar is ${Math.round(share * 100)}% wide at step ${n}`);
  await card(page, id).getByRole('heading', { name: words(id, 'title'), level: 2 }).waitFor();
  assert(new URL(page.url()).pathname === '/tutorial', 'the address has more than /tutorial: ' + page.url());
}
// The step shows as done, with the sentence of the content file.
async function isDone(page, id, words) {
  await page.locator(`section[data-step="${id}"][data-status="done"]`).getByText(words(id, 'done'), { exact: true }).waitFor({ timeout: 15_000 });
  await page.locator(`.f-tutorial-steps li[data-step="${id}"][data-status="done"]`).waitFor();
}
// The notice on a different screen: the step is done, and the way back.
async function backFromNotice(page, id, words) {
  const notice = page.locator('.toast').filter({ hasText: words(id, 'done') });
  await notice.waitFor({ timeout: 30_000 });
  await notice.getByRole('button', { name: 'Back to the tutorial' }).click();
}

// Every request for the progress, with what the server gets.
function watchVault(page) {
  const puts = [];
  page.on('request', (r) => { if (r.method() === 'PUT' && /\/api\/vault\/tutorial$/.test(r.url())) puts.push(r.postData() || ''); });
  return puts;
}
const saved = (page) => inApp(page, async ({ session }) => session.vaultGet('tutorial', { fresh: true }));
// Does something that changes the progress, and waits until the server has the new value.
// (A page that is loaded again right after a click would stop the write.)
async function andSaved(page, act) {
  const wrote = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/vault\/tutorial$/.test(r.url()) && r.ok(), { timeout: 15_000 });
  await act();
  await wrote;
}

// The page must not scroll sideways, and the controls of the tutorial must be large enough for a finger.
// (Only the parts of this feature are measured: other parts of a shared screen have their own tests.)
async function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const small = [];
    const mine = ['.f-tutorial', '.f-tutorial-card', '[data-section="tutorial"]', 'dialog[open]'];
    const controls = mine.flatMap((root) => [...document.querySelectorAll(`${root} button, ${root} a[href], ${root} input, ${root} select, ${root} textarea`)]);
    for (const el of controls) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0 || el.closest('.sr-only')) continue;
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue;
      if (b.height < 40) small.push(`${el.tagName.toLowerCase()} ${Math.round(b.width)}x${Math.round(b.height)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`);
    }
    return { scrollW: document.documentElement.scrollWidth, vw, small: [...new Set(small)] };
  });
}

// ---- 1. a new account does every step for real (test mode, simulated providers) ----
async function everyStep(t, words) {
  const s = await t.open();
  const { page } = s;
  const dlg = page.getByRole('dialog');
  const puts = watchVault(page);
  const key = await signUp(page, t.base);

  // The offer shows right after sign-up, above the counts.
  await page.getByRole('heading', { name: 'Take the tutorial' }).waitFor();
  assert(await page.evaluate(() => document.querySelector('.f-tutorial-card').getBoundingClientRect().bottom <= document.querySelector('.stats').getBoundingClientRect().top), 'the offer is not above the counts');
  assert(puts.length === 0, 'the offer alone saved something');
  await page.getByRole('button', { name: 'Start the tutorial' }).click();
  await atStep(page, 1, 'welcome', words);
  await card(page, 'welcome').getByText(words('welcome', 'what'), { exact: true }).waitFor();
  await card(page, 'welcome').getByText(words('welcome', 'why'), { exact: true }).waitFor();
  t.ok('the offer on Home starts the tutorial at step 1');

  await next(page);
  await atStep(page, 2, 'recovery-key', words);
  await page.locator('.f-tutorial-steps li[data-step="welcome"][data-status="done"]').waitFor();
  await page.getByRole('button', { name: 'Test my recovery key' }).click();
  await dlg.getByLabel('Recovery key').fill(key);
  await dlg.getByRole('button', { name: 'Test the key' }).click();
  await dlg.getByText('This is the right key for this account.').waitFor();
  await dlg.getByRole('button', { name: 'Done' }).click();
  await isDone(page, 'recovery-key', words);
  t.ok('step 2: the recovery key is tested');

  await next(page);
  await atStep(page, 3, 'passkey', words);
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await page.getByRole('button', { name: 'Add a passkey' }).first().click();
  await dlg.getByRole('button', { name: 'Add a passkey' }).click();
  await page.getByText(/^Passkey added/).waitFor({ timeout: 15_000 });
  const inSettings = page.locator('[data-section="tutorial"]');
  await inSettings.getByText(`You are at step 3 of ${TOTAL}: ${words('passkey', 'title')}.`).waitFor();
  await inSettings.getByRole('button', { name: 'Continue the tutorial' }).click();
  await atStep(page, 3, 'passkey', words);
  await isDone(page, 'passkey', words);
  t.ok('step 3: a passkey is added in Settings; Settings leads back');

  await next(page);
  await atStep(page, 4, 'funds', words);
  await card(page, 'funds').getByText(words('funds', 'doItTest'), { exact: true }).waitFor(); // the words for test mode
  await page.getByRole('button', { name: 'Open Funds' }).click();
  await page.getByLabel('Amount in US dollars').fill('25');
  await page.getByRole('button', { name: 'Add funds' }).click();
  await page.getByRole('button', { name: 'Simulate payment (test mode)' }).click({ timeout: 30_000 });
  await backFromNotice(page, 'funds', words);
  await atStep(page, 4, 'funds', words);
  await isDone(page, 'funds', words);
  t.ok('step 4: a simulated payment; the notice leads back');

  await next(page);
  await atStep(page, 5, 'inbox', words);
  const price = usd(t.config.prices.mailboxMonth);
  await card(page, 'inbox').getByText(`This step costs ${price}. Your balance is $25.00.`).waitFor(); // the price shows before the button
  await card(page, 'inbox').getByText(words('inbox', 'skipNote'), { exact: true }).waitFor();
  await card(page, 'inbox').getByRole('button', { name: 'Skip this step' }).waitFor();
  await page.getByRole('button', { name: 'Make inbox', exact: true }).click();
  await dlg.getByRole('button', { name: /^Make inbox/ }).click();
  await page.getByRole('heading', { name: 'Inbox made' }).waitFor();
  await dlg.getByRole('button', { name: 'Done' }).click();
  await isDone(page, 'inbox', words);
  // A screen reader hears the sentence: it is in the line that stays on the page.
  assert(await page.locator('.f-tutorial > [role="status"]').textContent() === words('inbox', 'done'), 'the done sentence is not announced');
  t.ok('step 5: the price shows first; an inbox is made');

  await next(page);
  await atStep(page, 6, 'alias', words);
  await page.getByRole('button', { name: 'Make alias', exact: true }).click();
  await dlg.getByRole('button', { name: 'Make alias' }).click();
  await page.getByRole('heading', { name: 'Alias made' }).waitFor();
  await dlg.getByRole('button', { name: 'Done' }).click();
  await isDone(page, 'alias', words);
  t.ok('step 6: an alias is made');

  await next(page);
  await atStep(page, 7, 'first-mail', words);
  await page.getByRole('button', { name: 'Open test tools' }).click();
  await dlg.getByRole('button', { name: 'Simulate incoming mail' }).click();
  await page.getByText('Test mail delivered').waitFor();
  await dlg.getByRole('button', { name: 'Close', exact: true }).click();
  await isDone(page, 'first-mail', words); // from the live update, without a reload
  t.ok('step 7: a test mail arrives on the alias');

  await next(page);
  await atStep(page, 8, 'alias-off', words);
  await page.getByRole('button', { name: 'Open Aliases' }).click();
  await page.locator('.item-row[data-kind="alias"]').getByRole('switch').click();
  await backFromNotice(page, 'alias-off', words);
  await atStep(page, 8, 'alias-off', words);
  await isDone(page, 'alias-off', words);
  t.ok('step 8: the alias is turned off on Aliases');

  await next(page);
  await atStep(page, 9, 'identity', words);
  await page.getByRole('button', { name: 'Make identity', exact: true }).click();
  await dlg.getByLabel('Name').fill('Maple Shop');
  await dlg.getByRole('button', { name: 'Make identity' }).click();
  await isDone(page, 'identity', words);
  await atStep(page, 9, 'identity', words); // the person stays in the tutorial
  t.ok('step 9: an identity is made');

  await next(page);
  await atStep(page, 10, 'made-up-details', words);
  await page.getByRole('button', { name: 'Open the random identifiers generator' }).click();
  await dlg.getByRole('button', { name: 'Make random identifiers' }).click();
  await dlg.locator('.persona-name').waitFor();
  await dlg.getByRole('button', { name: 'Done' }).click();
  await isDone(page, 'made-up-details', words);
  t.ok('step 10: random identifiers are made for the alias');

  await next(page);
  await atStep(page, 11, 'number', words);
  await card(page, 'number').getByText(`This step costs ${usd(t.config.prices.numberMonth)}. Your balance is $24.00.`).waitFor();
  await page.getByRole('button', { name: 'Get a number', exact: true }).click();
  await dlg.locator('.number-option').first().getByRole('button', { name: /^Buy/ }).click();
  await dlg.getByRole('button', { name: /Buy for/ }).click();
  await page.locator('.number-heading').waitFor({ timeout: 10_000 }); // the app opens the new number
  await backFromNotice(page, 'number', words);
  await atStep(page, 11, 'number', words);
  await isDone(page, 'number', words);
  t.ok('step 11: a number is bought; the notice leads back from its screen');

  await next(page);
  await atStep(page, 12, 'first-text', words);
  await page.getByRole('button', { name: 'Open my number' }).click();
  await page.getByRole('button', { name: 'New text' }).click();
  await dlg.getByLabel('To').fill('+14155550142');
  await dlg.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.composer-input').fill('Hello from the tutorial');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('.bubble-row.is-out').filter({ hasText: 'Hello from the tutorial' }).waitFor({ timeout: 10_000 });
  await backFromNotice(page, 'first-text', words);
  await atStep(page, 12, 'first-text', words);
  await isDone(page, 'first-text', words);
  t.ok('step 12: a text is sent from the number');

  await next(page);
  await atStep(page, 13, 'link-phone', words);
  await page.getByRole('button', { name: 'Link a phone', exact: true }).click();
  await dlg.getByLabel('Your real phone number').fill('+14155550199');
  await dlg.getByRole('button', { name: 'Send code' }).click();
  await page.getByRole('heading', { name: 'Enter the code' }).waitFor();
  await dlg.getByLabel('Code').fill((await lastPhoneCode(page)).text);
  await dlg.getByRole('button', { name: 'Link phone' }).click();
  await isDone(page, 'link-phone', words);
  t.ok('step 13: a real phone is linked with the code from the test outbox');

  await next(page);
  await atStep(page, TOTAL, 'finish', words);
  await andSaved(page, () => page.getByRole('button', { name: 'Finish the tutorial' }).click());
  await isDone(page, 'finish', words);
  await card(page, 'finish').getByText(`You did ${TOTAL} of ${TOTAL} steps.`).waitFor();
  assert(await page.locator('.f-tutorial-steps li[data-status="done"]').count() === TOTAL, 'not every step of the list is done');
  await page.getByRole('button', { name: 'Go to Home' }).click();
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor();
  await page.locator('.stats').waitFor();
  await page.waitForTimeout(600);
  assert(await page.locator('.f-tutorial-card').count() === 0, 'Home still shows the tutorial card after the end');
  t.ok('step 14: the end; Home shows the card no more');

  // What the server got: encrypted, the same size each time, no step name in it.
  const value = await saved(page);
  assert(value.state === 'finished' && value.step === 'finish', 'the saved progress is not finished: ' + JSON.stringify(value));
  assert(TUTORIAL.every((x) => value.done.includes(x.id)) && value.skipped.length === 0, 'the saved progress misses steps: ' + JSON.stringify(value.done));
  assert(puts.length >= TOTAL, `only ${puts.length} writes of the progress`);
  for (const body of puts) {
    const keys = Object.keys(JSON.parse(body));
    assert(keys.join() === 'value', 'the write has more than the encrypted value: ' + keys.join());
    // Long words only: a short word can be in random text by chance.
    const plain = body + Buffer.from(JSON.parse(body).value, 'base64url').toString('latin1');
    for (const word of [...TUTORIAL.map((x) => x.id).filter((id) => id.length >= 7), 'finished', 'skipped', '"state"', '"done"']) assert(!plain.includes(word), `the plain word "${word}" is in a request`);
    assert(body.length === puts[0].length, `the saved value changed its size: ${body.length} and ${puts[0].length}`);
  }
  const stored = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.keys(sessionStorage)]));
  assert(!/tutorial|welcome|first-mail|"step|finished/i.test(stored), 'tutorial data is in the browser storage: ' + stored);
  t.ok('the progress is one encrypted value of a fixed size; nothing is in browser storage');
  await s.close();
}

// ---- 2. leave at step 6; a reload and a second device continue there ----
async function leaveAndContinue(t, words) {
  const s = await t.open();
  const key = await signUp(s.page, t.base);
  await s.page.getByRole('button', { name: 'Start the tutorial' }).click();
  for (let n = 1; n < 6; n++) { await atStep(s.page, n, TUTORIAL[n - 1].id, words); await andSaved(s.page, () => next(s.page)); }
  await atStep(s.page, 6, 'alias', words);
  await s.page.reload();
  await atStep(s.page, 6, 'alias', words);
  await s.close();

  const d = await t.open();
  await signIn(d.page, t.base, key);
  const homeCard = d.page.locator('.f-tutorial-card');
  await homeCard.getByRole('heading', { name: 'Continue the tutorial' }).waitFor();
  await homeCard.getByText(`Step 6 of ${TOTAL}: ${words('alias', 'title')}`).waitFor();
  await homeCard.getByRole('button', { name: 'Continue the tutorial' }).click();
  await atStep(d.page, 6, 'alias', words);
  t.ok('a reload and a second sign-in continue at step 6');

  // "Stop the tutorial" takes the card away. The step stays saved.
  await d.page.goto(t.base + '/');
  await andSaved(d.page, () => homeCard.getByRole('button', { name: 'Stop the tutorial' }).click());
  await homeCard.waitFor({ state: 'detached' });
  await d.page.goto(t.base + '/settings');
  await d.page.locator('[data-section="tutorial"]').getByText(`You stopped at step 6 of ${TOTAL}: ${words('alias', 'title')}.`).waitFor();
  t.ok('"Stop the tutorial" hides the card and keeps the step');
  await d.close();
}

// ---- 3. no credit: every step that costs is skipped, and the end still makes sense ----
async function zeroBalance(t, words) {
  const s = await t.open();
  const { page } = s;
  const dlg = page.getByRole('dialog');
  const puts = watchVault(page);
  await signUp(page, t.base);

  // To open the tutorial and to read a step saves nothing.
  await page.goto(t.base + '/tutorial');
  await atStep(page, 1, 'welcome', words);
  await page.waitForTimeout(700);
  assert(puts.length === 0, 'to look at a step wrote to the server');
  // One click on Next: the requests are the read and the write of the one encrypted value, nothing else.
  const requests = [];
  const listen = (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`);
  page.on('request', listen);
  await next(page);
  await atStep(page, 2, 'recovery-key', words);
  await page.waitForTimeout(700);
  page.off('request', listen);
  assert(requests.includes('PUT /api/vault/tutorial') && requests.every((r) => /^(GET \/api\/vault|GET \/api\/vault\/tutorial|PUT \/api\/vault\/tutorial)$/.test(r)), 'a step made other requests: ' + requests.join(', '));
  t.ok('to read a step sends nothing; a change of step is one encrypted write');

  await next(page);
  await atStep(page, 3, 'passkey', words);
  await card(page, 'passkey').getByText(words('passkey', 'skipNote'), { exact: true }).waitFor();
  await skip(page);
  await atStep(page, 4, 'funds', words);
  await card(page, 'funds').getByText(words('funds', 'skipNote'), { exact: true }).waitFor();
  await skip(page);

  // An inbox costs credit: the price, the balance, and two ways on.
  await atStep(page, 5, 'inbox', words);
  await card(page, 'inbox').getByText('Your balance is too low for this step').waitFor();
  await card(page, 'inbox').getByText(`This step costs ${usd(t.config.prices.mailboxMonth)}. Your balance is $0.00.`).waitFor();
  await card(page, 'inbox').getByRole('button', { name: 'Add funds' }).waitFor();
  assert(await page.getByRole('button', { name: 'Make inbox', exact: true }).count() === 0, 'the step offers the purchase with no credit');
  await skip(page);
  await page.locator('.f-tutorial-steps li[data-step="inbox"][data-status="skipped"]').getByText('Skipped').waitFor();

  // The steps that build on the inbox say what is missing.
  await atStep(page, 6, 'alias', words);
  await card(page, 'alias').getByText('This step needs an inbox').waitFor();
  await card(page, 'alias').getByText('You have no inbox yet.').waitFor();
  await card(page, 'alias').getByRole('button', { name: `Go to “${words('inbox', 'title')}”` }).click();
  await atStep(page, 5, 'inbox', words);
  await next(page);
  await atStep(page, 6, 'alias', words);
  await skip(page);
  await atStep(page, 7, 'first-mail', words);
  await card(page, 'first-mail').getByText('This step needs an alias').waitFor();
  await skip(page);
  await atStep(page, 8, 'alias-off', words);
  await skip(page);

  // A free step still works.
  await atStep(page, 9, 'identity', words);
  await page.getByRole('button', { name: 'Make identity', exact: true }).click();
  await dlg.getByLabel('Name').fill('No credit');
  await dlg.getByRole('button', { name: 'Make identity' }).click();
  await isDone(page, 'identity', words);
  await next(page);
  await atStep(page, 10, 'made-up-details', words);
  await skip(page);
  await atStep(page, 11, 'number', words);
  await card(page, 'number').getByText(`This step costs ${usd(t.config.prices.numberMonth)}. Your balance is $0.00.`).waitFor();
  await skip(page);
  await atStep(page, 12, 'first-text', words);
  await card(page, 'first-text').getByText('This step needs a number').waitFor();
  await skip(page);
  await atStep(page, 13, 'link-phone', words);
  await skip(page);
  await atStep(page, TOTAL, 'finish', words);
  await andSaved(page, () => page.getByRole('button', { name: 'Finish the tutorial' }).click());
  await isDone(page, 'finish', words);
  await card(page, 'finish').getByText(`You did 3 of ${TOTAL} steps. 11 steps are not done. To do one later, select it in the list below.`).waitFor();
  const value = await saved(page);
  assert(value.state === 'finished' && value.done.sort().join() === 'finish,identity,welcome', 'wrong done steps: ' + value.done.join());
  assert(value.skipped.length === 10, 'wrong skipped steps: ' + value.skipped.join());
  t.ok('with no credit every step can be skipped; the end says what is not done');

  // Later: a skipped step is opened from the list, credit is added, and the step can be done.
  await page.getByRole('button', { name: `Open step 5: ${words('inbox', 'title')}` }).click();
  await atStep(page, 5, 'inbox', words);
  await card(page, 'inbox').getByRole('button', { name: 'Add funds' }).click();
  await page.getByLabel('Amount in US dollars').fill('5');
  await page.getByRole('button', { name: 'Add funds' }).click();
  await page.getByRole('button', { name: 'Simulate payment (test mode)' }).click({ timeout: 30_000 });
  await backFromNotice(page, 'funds', words);
  await atStep(page, 5, 'inbox', words);
  await card(page, 'inbox').getByText(`This step costs ${usd(t.config.prices.mailboxMonth)}. Your balance is $5.00.`).waitFor();
  await page.getByRole('button', { name: 'Make inbox', exact: true }).waitFor();
  t.ok('"Add funds" from a step with a price leads back to that step');
  await s.close();
}

// ---- 4. a server with phones and payments off ----
async function partsOff(t) {
  const off = await startServer({ PHONE_PROVIDER: 'off', PAY_PROVIDER: 'off' });
  const first = await t.open();
  const t2 = makeContext({ browser: first.context.browser(), server: off, name: t.name });
  await first.close();
  try {
    const config = await (await fetch(off.url + '/api/config')).json();
    const words = wordsFor(config);
    const s = await t2.open();
    const { page } = s;
    await signUp(page, off.url);
    await page.getByRole('button', { name: 'Start the tutorial' }).click();
    await atStep(page, 1, 'welcome', words);
    // The four steps are grey in the list, with "Turned off" and one line that says why. They cannot be opened.
    for (const id of ['funds', 'number', 'first-text', 'link-phone']) {
      const row = page.locator(`.f-tutorial-steps li[data-step="${id}"]`);
      assert(await row.getAttribute('data-status') === 'off', `${id} is not off`);
      await row.getByText('Turned off', { exact: true }).waitFor();
      await row.getByText(words(id, 'offNote'), { exact: true }).waitFor();
      assert(await row.getByRole('button').count() === 0, `${id} can be opened`);
      const grey = await row.locator('.item-value').evaluate((el) => getComputedStyle(el).color === getComputedStyle(document.querySelector('.f-tutorial-steps li[data-status="todo"] .item-value')).color);
      assert(!grey, `${id} is not grey`);
    }
    assert(await page.locator('.f-tutorial-steps li[data-status="off"]').count() === 4, 'more or fewer than 4 steps are off');
    await next(page);
    await next(page);
    await atStep(page, 3, 'passkey', words);
    await next(page); // past "Add funds"
    await atStep(page, 5, 'inbox', words);
    // No credit and no way to add it: the step says so and can be skipped.
    await card(page, 'inbox').getByText('Your balance is too low for this step').waitFor();
    await card(page, 'inbox').getByText(words('funds', 'offNote'), { exact: true }).waitFor();
    assert(await card(page, 'inbox').getByRole('button', { name: 'Add funds' }).count() === 0, '"Add funds" shows with payments off');
    await skip(page);
    for (const [n, id] of [[6, 'alias'], [7, 'first-mail'], [8, 'alias-off'], [9, 'identity'], [10, 'made-up-details']]) { await atStep(page, n, id, words); await next(page); }
    await atStep(page, TOTAL, 'finish', words); // past the three steps about numbers
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await atStep(page, 10, 'made-up-details', words);
    await next(page);
    await page.getByRole('button', { name: 'Finish the tutorial' }).click();
    await card(page, 'finish').getByText('4 steps are turned off on this server.').waitFor();
    const errors = t2.unexpectedErrors();
    assert(errors.length === 0, 'the page logged errors: ' + errors.join(' | '));
    t.ok('phones and payments off: four steps are grey with the reason, and Next and Back go past them');
  } finally {
    await t2.closeAll();
    await off.stop();
  }
}

// ---- 5. the keyboard only, on a phone screen ----
async function keyboardAndPhone(t, words) {
  const s = await t.open({ width: 390, height: 844 });
  const { page } = s;
  const key = await signUp(page, t.base);
  const problems = [];
  const look = async (name) => {
    await page.waitForTimeout(250);
    const r = await measure(page);
    if (r.scrollW > r.vw) problems.push(`${name}: the page scrolls sideways (${r.scrollW} > ${r.vw})`);
    if (r.small.length) problems.push(`${name}: small targets: ${r.small.join(' | ')}`);
  };
  await page.getByRole('heading', { name: 'Take the tutorial' }).waitFor();
  await look('the offer on Home');

  const active = () => page.evaluate(() => { const e = document.activeElement; return { key: e.dataset.key || '', id: e.id, text: (e.textContent || '').trim().slice(0, 40), ring: getComputedStyle(e).outlineStyle !== 'none' && parseFloat(getComputedStyle(e).outlineWidth) >= 2 }; });
  // Tab until the control with this key has the focus. Every stop on the way has a focus ring.
  const tabTo = async (wanted) => {
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const a = await active();
      assert(a.ring, 'no focus ring on: ' + a.text);
      if (a.key === wanted) return;
    }
    throw new Error(`the keyboard did not reach "${wanted}"`);
  };

  await page.getByRole('button', { name: 'Start the tutorial' }).focus();
  await page.keyboard.press('Enter');
  await atStep(page, 1, 'welcome', words);
  await look('step 1');
  await tabTo('next');
  await page.keyboard.press('Enter');
  await atStep(page, 2, 'recovery-key', words);
  assert((await active()).id === 'tutorial-step-title', 'the focus is not on the title of the new step');

  // The real action of step 2 with the keyboard: the dialog, the key, the answer, Escape.
  await tabTo('action');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').getByLabel('Recovery key').waitFor();
  await page.keyboard.type(key);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').getByText('This is the right key for this account.').waitFor();
  await look('the test dialog');
  await page.keyboard.press('Escape');
  await isDone(page, 'recovery-key', words);
  // The button of the step is gone. The focus is on "Next", not lost.
  await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.key === 'next');
  await page.keyboard.press('Enter');
  await atStep(page, 3, 'passkey', words);
  await tabTo('skip');
  await page.keyboard.press('Enter');
  await atStep(page, 4, 'funds', words);
  await tabTo('back');
  await page.keyboard.press('Enter');
  await atStep(page, 3, 'passkey', words);
  await page.locator('.f-tutorial-steps li[data-step="passkey"][data-status="skipped"]').waitFor();
  t.ok('keyboard only: start, Next, the real action in a dialog, Skip, Back; the focus is never lost');

  await page.getByRole('button', { name: `Open step 5: ${words('inbox', 'title')}` }).click();
  await atStep(page, 5, 'inbox', words);
  await look('step 5 with a balance that is too low');
  await page.getByRole('button', { name: `Open step ${TOTAL}: ${words('finish', 'title')}` }).click();
  await atStep(page, TOTAL, 'finish', words);
  await look('the last step');
  await page.goto(t.base + '/');
  await page.getByRole('heading', { name: 'Continue the tutorial' }).waitFor();
  await look('the card "Continue the tutorial" on Home');
  await page.goto(t.base + '/settings');
  await page.locator('[data-section="tutorial"]').getByRole('button', { name: 'Start again' }).waitFor();
  await look('Settings');
  assert(problems.length === 0, problems.join('\n      '));
  t.ok('phone screen (390px): no sideways scroll and every target is large enough');
  await s.close();
}

// ---- 6. "Not now", and the tutorial again from Settings ----
async function notNowAndAgain(t, words) {
  const s = await t.open();
  const { page } = s;
  await signUp(page, t.base);
  await page.getByRole('heading', { name: 'Take the tutorial' }).waitFor();
  await andSaved(page, () => page.getByRole('button', { name: 'Not now' }).click());
  await page.locator('.f-tutorial-card').waitFor({ state: 'detached' });
  await page.reload();
  await page.getByRole('heading', { name: 'First steps' }).waitFor();
  await page.waitForTimeout(800);
  assert(await page.locator('.f-tutorial-card').count() === 0, 'the offer is back after a reload');
  t.ok('"Not now" hides the offer, also after a reload');

  await page.goto(t.base + '/settings');
  const part = page.locator('[data-section="tutorial"]');
  await part.getByRole('heading', { name: 'Tutorial', level: 2 }).waitFor();
  await part.getByText('You did not start the tutorial yet.').waitFor();
  await part.getByRole('button', { name: 'Start the tutorial' }).click();
  await atStep(page, 1, 'welcome', words);
  await next(page);
  await next(page);
  await atStep(page, 3, 'passkey', words);
  await page.goto(t.base + '/settings');
  await andSaved(page, () => part.getByRole('button', { name: 'Start again' }).click());
  await atStep(page, 1, 'welcome', words);
  await page.locator('.f-tutorial-steps li[data-step="welcome"][data-status="todo"]').waitFor();
  const value = await saved(page);
  assert(value.state === 'active' && value.step === 'welcome' && value.done.length === 0, '"Start again" did not empty the progress: ' + JSON.stringify(value));
  t.ok('Settings starts the tutorial, and starts it again from step 1');

  // The Help page leads to the tutorial too (when the Help feature is in the app).
  await page.goto(t.base + '/help');
  await page.locator('main h1').first().waitFor();
  const link = page.locator('main a[href="/tutorial"]').first();
  if (await link.count()) {
    await link.click();
    await atStep(page, 1, 'welcome', words);
    t.ok('Help links to the tutorial');
  }
  await s.close();
}

export default async function (t) {
  t.config = await (await fetch(t.base + '/api/config')).json();
  assert(t.config.dev && t.config.features.phone && t.config.features.pay, 'this test needs test mode with simulated providers');
  assert(TOTAL === 14, `the tutorial has ${TOTAL} steps, the test knows 14`);
  const words = wordsFor(t.config);
  await everyStep(t, words);
  await leaveAndContinue(t, words);
  await zeroBalance(t, words);
  await partsOff(t);
  await keyboardAndPhone(t, words);
  await notNowAndAgain(t, words);
}
