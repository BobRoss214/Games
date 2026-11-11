// Help (web/js/features/help.js): the place in the menu, the five screens with their full text,
// "do not track what I read" (no request, no storage, nothing in the address), the keyboard,
// and a phone screen.
import { signUp, signIn, assert } from '../lib.mjs';
import { WHY_PAGE, TIPS, TIPS_NOTE, WHY, WORDS } from '../../web/js/help/content.js';

const PATHS = ['/help', '/help/why', '/help/tips', '/help/answers', '/help/words'];

export default async function (t) {
  const { appName } = await (await fetch(t.base + '/api/config')).json();
  const fill = (text) => text.split('{app}').join(appName);
  const h1 = (page, name) => page.getByRole('heading', { name, level: 1, exact: true }).waitFor();
  const pathOf = (page) => page.evaluate(() => location.pathname + location.search + location.hash);
  // No token of the help text may show on a screen.
  const noTokens = async (page, where) => {
    const text = await page.locator('body').innerText();
    assert(!/\{app\}|\{price\}|[{}]/.test(text), `${where}: a token of the help text shows on the screen`);
  };
  const focusText = (page) => page.evaluate(() => `${document.activeElement.tagName}:${(document.activeElement.textContent || '').trim()}`);
  // Presses Tab until the focus is on the link with this name (the start of its text).
  const tabTo = async (page, name, key = 'Tab') => {
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(key);
      if ((await focusText(page)).startsWith(`A:${name}`)) return;
    }
    throw new Error(`the keyboard did not reach the link "${name}"`);
  };

  // ================= desktop =================
  const d = await t.open();
  const { page } = d;
  const key = await signUp(page, t.base);
  await page.getByRole('heading', { name: 'First steps' }).waitFor(); // the lists of Home are loaded

  const menu = (await page.locator('.sidebar .nav-item').allTextContents()).map((x) => x.replace(/\d+/g, '').trim());
  assert(menu.includes('Help'), 'Help is not in the menu: ' + menu.join('|'));
  assert(menu.indexOf('Funds') < menu.indexOf('Help') && menu.indexOf('Help') < menu.indexOf('Settings'), 'Help is not between Funds and Settings: ' + menu.join('|'));
  t.ok('desktop: Help is in the main menu, before Settings');

  // ---- from here on: every request, and everything that the browser keeps ----
  await page.waitForTimeout(600);
  const kept = () => page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie]));
  const keptBefore = await kept();
  const requests = [];
  const record = (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`);
  page.on('request', record);

  // ---- /help ----
  const helpLink = page.locator('.sidebar .nav-item', { hasText: 'Help' });
  await helpLink.click();
  await h1(page, 'Help');
  assert(await helpLink.getAttribute('aria-current') === 'page', 'the menu item Help is not marked');
  assert((await page.title()).startsWith('Help · '), 'the title of Help is wrong: ' + await page.title());
  assert(await page.locator('h1').count() === 1, 'Help does not have exactly one h1');
  const start = page.getByRole('link', { name: 'Start the tutorial' });
  assert(await start.getAttribute('href') === '/tutorial', 'the button "Start the tutorial" does not go to /tutorial');
  const topics = await page.locator('main a.f-help-link').evaluateAll((els) => els.map((a) => a.getAttribute('href')));
  assert(topics.join() === PATHS.slice(1).join(), 'the topics of Help are wrong: ' + topics.join());
  await page.getByText('The app does not record what you read').waitFor();
  await noTokens(page, '/help');
  t.ok('/help: the tutorial button, four topics, a note about reading in private');

  // ---- /help/why ----
  await page.getByRole('link', { name: fill(WHY_PAGE.title) }).click();
  await h1(page, fill(WHY_PAGE.title));
  assert(await pathOf(page) === '/help/why', 'the address of the why page is wrong: ' + await pathOf(page));
  assert(await helpLink.getAttribute('aria-current') === 'page', 'Help is not marked on a page under it');
  const whyText = await page.locator('main').innerText();
  assert(whyText.includes(fill(WHY_PAGE.intro)), 'the why page does not show its first lines');
  for (const s of WHY_PAGE.sections) {
    await page.getByRole('heading', { name: fill(s.heading), level: 2, exact: true }).waitFor();
    for (const line of [...(s.paragraphs || []), ...(s.bullets || [])]) assert(whyText.includes(fill(line)), `the why page does not show: ${line}`);
  }
  const bullets = WHY_PAGE.sections.reduce((n, s) => n + (s.bullets || []).length, 0);
  assert(await page.locator('main .prose li').count() === bullets, 'the why page does not show every list entry');
  assert(whyText.includes(`You sign up with no name, no email address and no phone number.`), 'a known sentence of the why page is missing');
  assert(await page.locator('h1').count() === 1, 'the why page does not have exactly one h1');
  await noTokens(page, '/help/why');
  t.ok('/help/why: every heading, paragraph and list entry of the text');

  // ---- /help/tips ----
  await page.locator('main a.back-link', { hasText: 'Help' }).click();
  await h1(page, 'Help');
  await page.getByRole('link', { name: /^Privacy tips/ }).click();
  await h1(page, 'Privacy tips');
  const cards = page.locator('main article.f-help-tip');
  assert(await cards.count() === TIPS.length && TIPS.length === 15, `the tips page shows ${await cards.count()} cards, not ${TIPS.length}`);
  const shown = await cards.evaluateAll((els) => els.map((el) => ({
    title: el.querySelector('h2').textContent,
    labels: [...el.querySelectorAll('dt')].map((x) => x.textContent),
    texts: [...el.querySelectorAll('dd')].map((x) => x.textContent),
    named: el.getAttribute('aria-labelledby') === el.querySelector('h2').id,
  })));
  TIPS.forEach((tip, i) => {
    const card = shown[i];
    assert(card.title === fill(tip.title) && card.named, `tip ${tip.id}: the title is wrong`);
    assert(card.labels.join('|') === (tip.limit ? 'Do this|Here is why|The limit' : 'Do this|Here is why'), `tip ${tip.id}: the parts are wrong: ${card.labels.join('|')}`);
    assert(card.texts.join('|') === [tip.doThis, tip.why, tip.limit].filter(Boolean).map(fill).join('|'), `tip ${tip.id}: the text is wrong`);
  });
  await page.getByText('Make a new alias for each website.', { exact: true }).waitFor();
  await page.getByText(TIPS_NOTE, { exact: true }).waitFor();
  // The "Do this" line stands out: larger and heavier than the reason.
  const weight = await cards.first().evaluate((el) => {
    const size = (sel) => { const cs = getComputedStyle(el.querySelector(sel)); return [parseFloat(cs.fontSize), Number(cs.fontWeight)]; };
    return { act: size('.f-help-do dd'), reason: size('.f-help-why dd') };
  });
  assert(weight.act[0] > weight.reason[0] && weight.act[1] > weight.reason[1], 'the "Do this" line does not stand out: ' + JSON.stringify(weight));
  await noTokens(page, '/help/tips');
  t.ok('/help/tips: 15 cards; each has "Do this", then "Here is why", then the limit if there is one; the note at the end');

  // ---- /help/answers ----
  await page.getByRole('link', { name: /^Questions and answers/ }).click();
  await h1(page, 'Questions and answers');
  const keys = Object.keys(WHY);
  const ids = await page.locator('main h2.f-help-answer').evaluateAll((els) => els.map((el) => el.id));
  assert(ids.join() === keys.join(), 'the answers are not the "Why?" texts in sequence: ' + ids.join());
  const answersText = await page.locator('main').innerText();
  for (const k of keys) {
    assert(await page.locator(`#${k}`).textContent() === fill(WHY[k].title), `the answer ${k} has a wrong title`);
    for (const p of WHY[k].paragraphs) assert(answersText.includes(fill(p)), `the answer ${k} does not show: ${p}`);
  }
  assert(answersText.includes('Random identifiers are a random name and address for sign-up forms.'), 'a known sentence of the answers is missing');
  const questions = page.getByRole('navigation', { name: 'Questions' }).getByRole('link');
  assert(await questions.count() === keys.length, 'the list of questions is not complete');
  // A question moves the view and the focus to its answer. The address does not change.
  await questions.filter({ hasText: fill(WHY.balance.title) }).click();
  const jumped = await page.evaluate(() => ({ id: document.activeElement.id, top: document.getElementById('balance').getBoundingClientRect().top, y: window.scrollY }));
  assert(jumped.id === 'balance' && jumped.y > 0 && jumped.top >= 0 && jumped.top < 200, 'a question did not move the view to its answer: ' + JSON.stringify(jumped));
  assert(await pathOf(page) === '/help/answers', 'reading one answer changed the address: ' + await pathOf(page));
  await noTokens(page, '/help/answers');
  t.ok('/help/answers: all 15 "Why?" texts with an anchor each; a question moves to its answer and leaves the address as it is');

  // ---- /help/words ----
  await page.getByRole('link', { name: /^Words/ }).click();
  await h1(page, 'Words');
  const words = await page.locator('main dl.f-help-words > div').evaluateAll((els) => els.map((el) => [el.querySelector('dt').textContent, el.querySelector('dd').textContent]));
  assert(JSON.stringify(words) === JSON.stringify(WORDS.map((w) => [fill(w.word), fill(w.meaning)])), 'the word list is not complete or not in sequence');
  await page.getByText('Locked so that only you can read it.', { exact: true }).waitFor();
  await noTokens(page, '/help/words');
  t.ok(`/help/words: ${WORDS.length} words with their meaning`);

  // ---- do not track ----
  await page.waitForTimeout(400);
  page.off('request', record);
  assert(requests.length === 0, `Help caused ${requests.length} request(s): ${requests.slice(0, 6).join(', ')}`);
  assert(await kept() === keptBefore, 'Help changed what the browser keeps (storage or cookie)');
  t.ok('do not track: five screens and a jump to one answer cause no request at all, and store nothing');

  // ---- keyboard only: menu -> Help -> Privacy tips -> back ----
  await page.goto(t.base + '/');
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor();
  await tabTo(page, 'Help');
  await page.keyboard.press('Enter');
  await h1(page, 'Help');
  assert(await focusText(page) === 'H1:Help', 'the focus is not on the heading of Help: ' + await focusText(page));
  await tabTo(page, 'Privacy tips');
  await page.keyboard.press('Enter');
  await h1(page, 'Privacy tips');
  assert(await pathOf(page) === '/help/tips', 'the keyboard did not open the tips: ' + await pathOf(page));
  assert(await focusText(page) === 'H1:Privacy tips', 'the focus is not on the heading of the tips: ' + await focusText(page));
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.getElementById('main').contains(document.activeElement) && document.activeElement.tagName === 'A'), 'Tab after the heading does not go to a link of the screen');
  await tabTo(page, 'Help', 'Shift+Tab'); // the back link is before the heading
  assert(await page.evaluate(() => document.activeElement.classList.contains('back-link')), 'Shift+Tab did not reach the back link');
  await page.keyboard.press('Enter');
  await h1(page, 'Help');
  assert(await pathOf(page) === '/help', 'the back link did not go to Help');
  t.ok('keyboard only: the menu, Help, the tips and back; the focus goes to the heading of each screen');
  await d.close();

  // ================= phone =================
  const p = await t.open({ width: 390, height: 844 });
  await signIn(p.page, t.base, key);
  const bar = p.page.locator('.tabbar');
  if (await bar.getByRole('link', { name: 'Help' }).count()) await bar.getByRole('link', { name: 'Help' }).click();
  else {
    await bar.getByRole('button', { name: 'More' }).click();
    await p.page.getByRole('menuitem', { name: 'Help' }).click();
  }
  await h1(p.page, 'Help');
  t.ok('phone: Help opens from the bottom bar (directly or under "More")');

  const measure = () => p.page.evaluate(() => {
    const box = (el) => el.getBoundingClientRect();
    const wide = document.documentElement.clientWidth;
    return {
      overflow: document.documentElement.scrollWidth - wide,
      small: [...document.querySelectorAll('#main a, #main button')].filter((el) => box(el).height > 0 && box(el).height < 44).map((el) => `${el.textContent.trim().slice(0, 24)} (${Math.round(box(el).height)}px)`),
      outside: [...document.querySelectorAll('#main .sheet, #main .f-help-link, #main .prose > *')].filter((el) => box(el).left < 0 || box(el).right > wide + 0.5 || el.scrollWidth > el.clientWidth + 1).length,
    };
  });
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await p.page.setViewportSize(size);
    for (const path of PATHS) {
      await p.page.goto(t.base + path);
      await p.page.locator('main h1').waitFor();
      const m = await measure();
      assert(m.overflow <= 0, `${path} scrolls sideways at ${size.width}px (${m.overflow}px)`);
      assert(m.outside === 0, `${path}: ${m.outside} block(s) do not fit at ${size.width}px`);
      assert(m.small.length === 0, `${path}: targets under 44px at ${size.width}px: ${m.small.join(', ')}`);
    }
    // The tips are one column of cards that use the width of the screen.
    await p.page.goto(t.base + '/help/tips');
    await p.page.locator('main h1').waitFor();
    const column = await p.page.locator('main article.f-help-tip').evaluateAll((els) => els.every((el) => el.getBoundingClientRect().width >= 300 && el.getBoundingClientRect().left === els[0].getBoundingClientRect().left));
    assert(column, `the tips are not one readable column at ${size.width}px`);
    t.ok(`phone ${size.width}px: no sideways scroll on the five screens, every block fits, targets are 44px high`);
  }
  await p.close();

  // ================= without an account =================
  const o = await t.open();
  await o.page.goto(t.base + '/help/why');
  await h1(o.page, fill(WHY_PAGE.title));
  assert(await o.page.locator('.sidebar').count() === 0, 'Help without an account shows the shell');
  await o.page.getByRole('link', { name: 'Sign in' }).waitFor();
  await noTokens(o.page, '/help/why without an account');
  await o.page.locator('main a.back-link', { hasText: 'Help' }).click();
  await h1(o.page, 'Help');
  // The tutorial belongs to another feature file. Here: the button is there and it goes to its path.
  await o.page.getByRole('link', { name: 'Start the tutorial' }).click();
  await o.page.waitForFunction(() => location.pathname !== '/help');
  const went = await o.page.evaluate(() => location.pathname);
  assert(went.startsWith('/tutorial') || went === '/sign-in', 'the tutorial button went to ' + went);
  t.ok('without an account: Help opens on a plain page; the tutorial button navigates');
  await o.close();
}
