// A server with no phone provider and no payments: those areas are hidden or explained.
import { signUp, assert } from '../lib.mjs';

export const server = { PHONE_PROVIDER: 'off', PAY_PROVIDER: 'off', PRICE_MAILBOX_MONTH: '0' };

export default async function (t) {
  for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const s = await t.open(size);
    const { page } = s;
    const dlg = page.getByRole('dialog');
    await signUp(page, t.base);
    const nav = await page.locator(size.width < 721 ? '.tabbar a' : '.nav a').allTextContents();
    assert(!nav.some((x) => /Numbers/.test(x)), 'Numbers is in the menu');
    const steps = await page.locator('.firststep-title').allTextContents();
    assert(!steps.some((x) => /Add funds|Get a number/.test(x)), 'the first steps show areas that are off');
    await page.getByRole('button', { name: 'New', exact: true }).click();
    assert((await page.locator('.choice-title').allTextContents()).join() === 'Alias,Inbox,Identity', 'the New chooser offers a number');
    await dlg.locator('.choice', { hasText: /^Inbox/ }).click();
    await dlg.getByRole('button', { name: 'Make inbox' }).click();
    await page.getByRole('heading', { name: 'Inbox made' }).waitFor();
    await dlg.getByRole('button', { name: 'Done' }).click();
    await page.goto(t.base + '/numbers');
    await page.getByText('Numbers are turned off').waitFor();
    await page.goto(t.base + '/funds');
    await page.getByText('Payments are turned off on this server.').waitFor();
    await page.goto(t.base + '/settings');
    // "What the server can and cannot see" does not name texts, numbers or voicemail on a server without phones
    await page.locator('.see-list').first().waitFor();
    const see = (await page.locator('.see-list li').allTextContents()).join(' | ');
    assert(!/texts|voicemail|numbers belong|call history|real phone|forwarding/.test(see), 'the privacy lists name phone things on a server without phones: ' + see);
    assert(see.includes('New mail for a moment when it arrives.') && see.includes('Stored mail.'), 'the privacy lists are wrong without phones: ' + see);
    await page.getByRole('button', { name: 'Open test tools' }).click();
    assert((await dlg.getByRole('tab').allTextContents()).join() === 'Mail in,Outboxes', 'test tools show phone tabs');
    t.ok(`phone and payments off (${size.width}px)`);
    await s.close();
  }
}
