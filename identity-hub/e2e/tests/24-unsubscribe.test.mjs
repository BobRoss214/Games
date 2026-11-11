// The newsletter panel (web/js/features/unsubscribe.js). Mail arrives over real SMTP with a
// List-Unsubscribe header. "Unsubscribe by email" sends a normal mail from the alias to the
// address that the newsletter names; the app never opens the web link of the header.
import nodemailer from 'nodemailer';
import { signUp, addCredit, inApp, settle, assert } from '../lib.mjs';

async function openMessage(page, base, boxId, subject) {
  await page.goto(`${base}/mail/${boxId}`);
  await page.locator('.msg-row').filter({ hasText: subject }).click({ timeout: 15_000 });
  await page.locator('.message-subject').filter({ hasText: subject }).waitFor();
}
const outbox = (page) => inApp(page, async ({ api }) => (await api.get('/api/dev/outbox')).mail);

export default async function (t) {
  const s = await t.open();
  const { page } = s;
  const dlg = page.getByRole('dialog');
  const app = (await (await fetch(t.base + '/api/config')).json()).appName;
  await signUp(page, t.base);
  await addCredit(page, 10);
  const x = await inApp(page, async ({ data }) => {
    const box = await data.createMailbox({ label: 'Main' });
    const news = await data.createAlias({ mailboxId: box.mailbox.id, label: 'News' });
    const shop = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Shop' });
    return { box: box.mailbox.id, boxAddress: box.address, news: news.address, newsId: news.alias.id, shop: shop.address };
  });

  // Mail as newsletters send it: over SMTP, with list headers.
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port: t.server.smtpPort, secure: false, ignoreTLS: true });
  const send = async (to, subject, headers) => {
    const info = await transport.sendMail({ from: '"Weekly News" <news@list.example>', to, subject, text: 'This week: nothing new.', headers });
    assert(info.accepted.length === 1, 'the SMTP server did not accept: ' + subject);
  };
  await send(x.news, 'With an email target', { 'List-Unsubscribe': '<mailto:leave-123@list.example?subject=unsubscribe%20123>, <https://list.example/leave?u=1>', 'List-Id': 'Weekly <weekly.list.example>' });
  await send(x.news, 'With a link only', { 'List-Unsubscribe': '<https://list.example/leave?u=2>' });
  await send(x.news, 'With no way out', { 'List-Id': 'Weekly <weekly.list.example>' });
  await send(x.shop, 'A normal mail', {});
  await send(x.boxAddress, 'To the inbox address', { 'List-Unsubscribe': '<mailto:leave-456@list.example>' });
  transport.close();

  // The app must never ask another site for anything.
  const outside = [];
  page.on('request', (r) => { if (!r.url().startsWith(t.base) && !/^(data|about|blob):/.test(r.url())) outside.push(r.url()); });
  const panel = page.locator('[data-newsletter]');
  const actions = panel.locator('button:not(.why-btn):not(.why-close)'); // the buttons that do something (not the "why" button)

  // ---- an email target: ask, cancel, ask again, send ----
  await openMessage(page, t.base, x.box, 'With an email target');
  await panel.getByText('This looks like a newsletter').waitFor();
  await panel.getByText('You can ask the sender by email to stop. If the mail keeps coming, turn off this alias.').waitFor();
  await panel.getByRole('button', { name: 'Unsubscribe by email' }).click();
  await dlg.getByRole('heading', { name: 'Unsubscribe by email?' }).waitFor();
  await dlg.getByText(`${app} sends an empty mail from this alias to the newsletter. The sender learns that this alias is in use.`, { exact: true }).waitFor();
  const lines = await dlg.locator('dl.kv dd').allTextContents();
  assert(lines.join('|') === `${x.news}|leave-123@list.example|unsubscribe 123`, 'the dialog shows other values: ' + lines.join('|'));
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  assert((await outbox(page)).length === 0, '"Cancel" sent a mail');
  await panel.getByRole('button', { name: 'Unsubscribe by email' }).click();
  await dlg.getByRole('button', { name: 'Send unsubscribe mail' }).click();
  await page.getByText('Unsubscribe mail sent', { exact: true }).waitFor();
  await panel.getByText(`${app} sent the unsubscribe mail. It can take some days until the newsletter stops.`).waitFor();
  assert(await actions.count() === 0, 'the button is still there after the mail was sent');
  const sent = await outbox(page);
  assert(sent.length === 1 && sent[0].from === x.news && sent[0].to.join() === 'leave-123@list.example' && sent[0].subject === 'unsubscribe 123', 'the simulated outbox has a different mail: ' + JSON.stringify(sent));
  const copies = await inApp(page, async ({ mail }) => (await mail.listMessages({ direction: 'out' })).messages.map((m) => `${m.meta.subject} to ${m.meta.to.map((p) => p.address).join()}`));
  assert(copies.join() === 'unsubscribe 123 to leave-123@list.example', 'no copy in "Sent": ' + copies.join());
  t.ok('"Unsubscribe by email": the question says what happens; the mail goes from the alias to the address of the newsletter; a copy is in Sent');

  // ---- a web link only: words, no button, and the one "Turn off this alias" of the message ----
  await openMessage(page, t.base, x.box, 'With a link only');
  await panel.getByText(`This newsletter can only be stopped through a web link. ${app} does not open such links. To stop it, turn off this alias.`, { exact: true }).waitFor();
  assert(await actions.count() === 0 && await panel.getByRole('link').count() === 0, 'the panel of a link-only newsletter has a button or a link');
  // The explanation opens in place. It asks the server for nothing.
  await settle(page); // the app finished its own work for the opened message
  const asked = [];
  const listen = (r) => asked.push(r.url());
  page.on('request', listen);
  await panel.getByRole('button', { name: /Why/ }).click();
  await panel.locator('.why-panel').getByText('never opens such a link').waitFor();
  await page.waitForTimeout(300);
  page.off('request', listen);
  assert(asked.length === 0, 'the explanation made a request: ' + asked.join(', '));
  assert(await page.getByRole('button', { name: 'Turn off this alias' }).count() === 1, 'there is not exactly one "Turn off this alias" on the message');
  await openMessage(page, t.base, x.box, 'With no way out');
  await panel.getByText('It names no way to unsubscribe. To stop it, turn off this alias.', { exact: true }).waitFor();
  t.ok('a newsletter with a web link only, or with nothing: the reason in words, no button');

  // ---- a normal mail has no panel ----
  await openMessage(page, t.base, x.box, 'A normal mail');
  await page.locator('.mail-text, iframe.mail-frame').first().waitFor();
  assert(await panel.count() === 0, 'a normal mail shows the newsletter panel');
  t.ok('a normal mail has no panel');

  // ---- mail to the address of the inbox: no alias to turn off; the default subject ----
  await openMessage(page, t.base, x.box, 'To the inbox address');
  await panel.getByText('If the mail keeps coming, select "Block this sender" in "More actions".').waitFor();
  await panel.getByRole('button', { name: 'Unsubscribe by email' }).focus();
  await page.keyboard.press('Enter'); // the keyboard only from here
  await dlg.getByText(`${app} sends an empty mail from this inbox to the newsletter. The sender learns that this inbox is in use.`, { exact: true }).waitFor();
  assert((await page.evaluate(() => document.activeElement.textContent.trim())) === 'Cancel', 'the focus is not on "Cancel" first');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.getByText('Unsubscribe mail sent', { exact: true }).waitFor();
  const second = (await outbox(page)).find((m) => m.to.join() === 'leave-456@list.example');
  assert(second && second.from === x.boxAddress && second.subject === 'unsubscribe', 'the mail from the inbox address is wrong: ' + JSON.stringify(second));
  t.ok('mail to the inbox address: sent from the inbox with the subject "unsubscribe", with the keyboard only');

  // ---- an alias that is off needs nothing ----
  await inApp(page, async ({ data }, id) => data.updateAlias(id, { enabled: false }), x.newsId);
  await openMessage(page, t.base, x.box, 'With a link only');
  await panel.getByText('This alias is off. Mail to it is refused.', { exact: true }).waitFor();
  assert(await actions.count() === 0, 'the panel of an alias that is off has a button');
  assert(outside.length === 0, 'the app asked another site: ' + outside.join(', '));
  t.ok('an alias that is off: one line, no button; no request left the app in the whole test');
  await s.close();

  // ---- phone screen ----
  const p = await t.open({ width: 390, height: 844 });
  await signUp(p.page, t.base);
  await addCredit(p.page, 10);
  const y = await inApp(p.page, async ({ data }) => {
    const box = await data.createMailbox({ label: 'Main' });
    const a = await data.createAlias({ mailboxId: box.mailbox.id, label: 'News', localPart: 'a.very.long.alias.name.for.the.newsletter.test' + Math.floor(Math.random() * 9000 + 1000) });
    return { box: box.mailbox.id, alias: a.address };
  });
  const t2 = nodemailer.createTransport({ host: '127.0.0.1', port: t.server.smtpPort, secure: false, ignoreTLS: true });
  await t2.sendMail({ from: 'news@list.example', to: y.alias, subject: 'Phone newsletter', text: 'x', headers: { 'List-Unsubscribe': '<mailto:a-very-long-unsubscribe-address-for-the-phone-screen-0123456789@bounces.mail.list.example?subject=unsubscribe>' } });
  t2.close();
  await openMessage(p.page, t.base, y.box, 'Phone newsletter');
  await p.page.locator('[data-newsletter]').getByRole('button', { name: 'Unsubscribe by email' }).click();
  await p.page.getByRole('dialog').getByText('The sender learns that this alias is in use.').waitFor();
  const m = await p.page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const parts = [document.querySelector('[data-newsletter]'), document.querySelector('dialog[open]')];
    const out = parts.flatMap((el) => [...el.querySelectorAll('*')]).filter((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 1 || b.left < -1); }).length;
    // (a "why" button is small, with a touch area of 44px around it)
    const low = parts.flatMap((el) => [...el.querySelectorAll('button:not(.why-btn)')]).filter((n) => n.getBoundingClientRect().height > 0 && n.getBoundingClientRect().height < 40).map((n) => n.textContent.trim().slice(0, 24));
    return { out, low, scroll: document.documentElement.scrollWidth > vw };
  });
  assert(m.out === 0 && !m.scroll, 'the panel or the dialog sticks out of the phone screen');
  assert(m.low.length === 0, 'small targets: ' + m.low.join(', '));
  t.ok('phone screen (390px): the panel and the question fit, with long addresses');
  await p.close();
}
