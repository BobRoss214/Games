// A 360px wide phone: no page may scroll sideways, nothing may stick out, and every
// control must be large enough for a finger (44px; a checkbox has a larger touch area than its box).
import { signUp, seedAccount, inApp, assert } from '../lib.mjs';

async function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.sr-only')) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (b.right > vw + 1 || b.left < -1) {
        let p = el.parentElement;
        let clipped = false;
        while (p && p !== document.body) { if (/(hidden|auto|scroll|clip)/.test(getComputedStyle(p).overflowX)) { clipped = true; break; } p = p.parentElement; }
        if (!clipped) wide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} [${Math.round(b.left)}..${Math.round(b.right)}]`);
      }
    }
    const small = [];
    for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, [role=switch]')) {
      if (el.closest('.sr-only') || el.classList.contains('sr-only') || el.classList.contains('skip-link') || el.closest('[inert]')) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue; // a link inside a sentence
      if (el.classList.contains('tag-link') || el.classList.contains('why-btn')) continue; // small, with a 44px touch area around it (CSS ::before)
      if (b.height < 40) small.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')} ${Math.round(b.width)}x${Math.round(b.height)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`);
    }
    return { scrollW: document.documentElement.scrollWidth, vw, wide: wide.slice(0, 5), small: [...new Set(small)].slice(0, 8) };
  });
}

export default async function (t) {
  // Fill an account on a desktop window, then look at it on the phone.
  const d = await t.open();
  const key = await signUp(d.page, t.base);
  const ids = await seedAccount(d.page);
  const group = await inApp(d.page, async ({ data, identities, persona }, x) => {
    const id = await identities.createIdentity({ name: 'Selling things online with a rather long name', note: 'Marketplace account for selling furniture and the bike' });
    await data.setItemIdentity('alias', x.shop, id);
    await data.setItemIdentity('number', x.n1, id);
    await data.setItemPersona('alias', x.shop, await persona.generatePersona('US'));
    await identities.updateIdentity(id, { persona: await persona.generatePersona('US') });
    return id;
  }, ids);
  await d.close();

  const s = await t.open({ width: 360, height: 740 });
  const { page } = s;
  const dlg = page.getByRole('dialog');
  const problems = [];
  const check = async (name) => {
    await page.waitForTimeout(250);
    const r = await measure(page);
    if (r.scrollW > r.vw) problems.push(`${name}: the page scrolls sideways (${r.scrollW} > ${r.vw}) ${r.wide.join(' | ')}`);
    else if (r.wide.length) problems.push(`${name}: outside the screen: ${r.wide.join(' | ')}`);
    if (r.small.length) problems.push(`${name}: small targets: ${r.small.join(' | ')}`);
    t.ok(name);
  };

  await page.goto(t.base + '/'); await page.getByRole('heading', { level: 1 }).waitFor(); await check('welcome');
  await page.goto(t.base + '/create'); await page.getByRole('button', { name: 'Make my account' }).click();
  await page.getByRole('heading', { name: 'Save your recovery key' }).waitFor({ timeout: 60_000 }); await check('save recovery key');
  await page.goto(t.base + '/sign-in'); await page.getByLabel('Recovery key').fill(key); await check('sign in');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor(); await page.locator('.recent-item').first().waitFor(); await page.locator('.identity-card').first().waitFor(); await check('home');
  await page.getByRole('button', { name: 'New', exact: true }).click(); await check('new chooser');
  await dlg.getByRole('button', { name: /^Alias/ }).click();
  await dlg.getByRole('button', { name: 'Choose the name myself' }).click(); await check('new alias');
  await dlg.getByRole('button', { name: 'Cancel' }).click();

  await page.goto(t.base + '/identities/' + group); await page.locator('.item-row').first().waitFor(); await page.locator('.feed-item').first().waitFor(); await check('identity');
  await page.getByRole('button', { name: 'Edit name and note' }).click(); await check('identity edit');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('.item-row').first().getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Random identifiers generator' }).click(); await dlg.locator('.persona-card').waitFor(); await check('random identifiers');
  await dlg.getByRole('button', { name: 'Done' }).click();
  await page.locator('.item-row').first().getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Move to another identity…' }).click(); await check('put in identity');
  await dlg.getByRole('button', { name: 'Cancel' }).click();

  await page.goto(t.base + '/mail/' + ids.personal); await page.locator('.msg-row').first().waitFor(); await check('mail list');
  await page.locator('.msg-row').filter({ hasText: 'Your order 1042' }).click(); await page.locator('iframe.mail-frame').waitFor(); await check('mail message');
  await page.getByRole('button', { name: 'Reply' }).click(); await dlg.getByLabel('Message').waitFor(); await check('write');
  await dlg.getByRole('button', { name: 'Discard' }).click();
  await page.goto(t.base + '/aliases'); await page.locator('.item-row').first().waitFor(); await check('aliases');
  await page.goto(t.base + '/numbers'); await page.locator('.phone-row').first().waitFor(); await check('numbers');
  await page.getByRole('button', { name: 'Get a number' }).first().click(); await dlg.locator('.number-option').first().waitFor(); await check('get a number');
  await dlg.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Link a phone' }).first().click(); await check('link a phone');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await page.goto(t.base + '/numbers/' + ids.n1); await page.locator('.thread').first().waitFor(); await check('conversations');
  await page.locator('.thread').first().click(); await page.locator('.bubble-row').first().waitFor(); await check('one conversation');
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  await page.getByRole('tab', { name: 'Calls' }).click(); await page.locator('.call-row').first().waitFor(); await check('calls');
  await page.getByRole('tab', { name: 'Settings' }).click(); await page.getByLabel('Forward to').waitFor(); await check('number settings');
  await page.goto(t.base + '/funds'); await page.getByRole('button', { name: 'Add funds' }).waitFor(); await page.locator('.ledger tbody tr').first().waitFor(); await check('funds');
  await page.goto(t.base + '/settings'); await page.locator('.phone-row').first().waitFor(); await check('settings');
  await page.getByRole('button', { name: 'Open test tools' }).click(); await check('test tools');
  await dlg.getByRole('button', { name: 'Close', exact: true }).click();

  assert(problems.length === 0, problems.join('\n      '));
}
