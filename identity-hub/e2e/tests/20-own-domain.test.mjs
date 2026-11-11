// A server with two mail domains, one of them a domain that only one person uses, and with
// another product name. The domain choice is always visible, the own domain shows its warning,
// and the name of the product comes from the server settings.
import { signUp, addCredit, assert } from '../lib.mjs';

export const server = { MAIL_DOMAINS: 'postern.test,my-own.example', MAIL_PERSONAL_DOMAINS: 'my-own.example', APP_NAME: 'Harbor' };

const WARNING = 'Only you use this domain. Websites can see that all addresses on it belong together. It helps when a website refuses alias addresses. It is worse for privacy than a shared domain.';

export default async function (t) {
  for (const size of [{ width: 1280, height: 800 }, { width: 360, height: 640 }]) {
    const s = await t.open(size);
    const { page } = s;
    const dlg = page.getByRole('dialog');

    // ---- the product name from the settings ----
    await page.goto(t.base + '/');
    await page.getByRole('heading', { name: 'A private door for your mail and calls.' }).waitFor();
    assert(await page.title() === 'Harbor', 'the tab title is not the product name: ' + await page.title());
    assert((await page.locator('.brand-name').first().textContent()) === 'Harbor', 'the page does not show the product name');
    await signUp(page, t.base);
    assert(await page.title() === 'Harbor', 'the tab title of Home is wrong: ' + await page.title());
    await page.goto(t.base + '/funds');
    await page.getByRole('heading', { name: 'Funds', level: 1 }).waitFor();
    assert(await page.title() === 'Funds · Harbor', 'the tab title of Funds is wrong: ' + await page.title());
    assert((await page.locator('.brand-name').first().textContent()) === 'Harbor', 'the frame does not show the product name');
    await page.goto(t.base + '/settings');
    await page.getByRole('button', { name: 'Why a recovery key?' }).click();
    await page.locator('.why-panel[data-why="recovery-key"]').getByText('Harbor shows it one time.').waitFor();
    if (size.width > 720) t.ok('the product name of the server shows in the tab title, the frame and the explanations');

    // ---- new inbox: the domain choice is visible at once; the own domain warns ----
    await addCredit(page, 5);
    await page.goto(t.base + '/');
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await dlg.locator('.choice', { hasText: /^Inbox/ }).click();
    const domain = dlg.getByLabel('Domain');
    await domain.waitFor(); // without "Choose the name myself"
    assert(await domain.inputValue() === 'postern.test', 'the shared domain is not the first choice');
    assert(await dlg.getByText(WARNING).count() === 0, 'the warning shows for a shared domain');
    const options = await domain.locator('option').allTextContents();
    assert(options.join('|') === '@postern.test|@my-own.example (only you use it)', 'the domain choices are wrong: ' + options.join('|'));
    await domain.focus();
    await domain.selectOption('my-own.example');
    await dlg.getByText(WARNING).waitFor();
    await domain.selectOption('postern.test');
    await dlg.getByText(WARNING).waitFor({ state: 'detached' });
    await domain.selectOption('my-own.example');
    await dlg.getByLabel('Label').fill('Own');
    const wide = await page.evaluate(() => { const d2 = document.querySelector('dialog'); return d2.scrollWidth - d2.clientWidth; });
    assert(wide <= 0, 'the dialog with the warning scrolls sideways');
    await dlg.getByRole('button', { name: /^Make inbox/ }).click();
    await page.getByRole('heading', { name: 'Inbox made' }).waitFor();
    assert((await dlg.locator('.made-value').textContent()).trim().endsWith('@my-own.example'), 'the inbox is not on the own domain');
    await dlg.getByRole('button', { name: 'Done' }).click();

    // ---- new alias: the same choice and warning; a random name on the own domain ----
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await dlg.locator('.choice', { hasText: /^Alias/ }).click();
    await dlg.getByLabel('Domain').selectOption('my-own.example');
    await dlg.getByText(WARNING).waitFor();
    await dlg.getByRole('button', { name: 'Make alias' }).click();
    await page.getByRole('heading', { name: 'Alias made' }).waitFor();
    assert((await dlg.locator('.made-value').textContent()).trim().endsWith('@my-own.example'), 'the alias is not on the own domain');
    await dlg.getByRole('button', { name: 'Done' }).click();
    // and one on the shared domain, with a name that the person types
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await dlg.locator('.choice', { hasText: /^Alias/ }).click();
    await dlg.getByRole('button', { name: 'Choose the name myself' }).click();
    await dlg.getByLabel('Name').fill(`typed.name${size.width}`);
    await dlg.getByRole('button', { name: 'Make alias' }).click();
    await page.getByRole('heading', { name: 'Alias made' }).waitFor();
    assert((await dlg.locator('.made-value').textContent()).trim() === `typed.name${size.width}@postern.test`, 'the typed alias is wrong');
    await dlg.getByRole('button', { name: 'Done' }).click();
    t.ok(`own domain: the choice is visible, the warning shows only for the own domain (${size.width}px)`);
    await s.close();
  }
}
