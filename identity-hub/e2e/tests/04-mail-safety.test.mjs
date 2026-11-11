// Mail that arrives over real SMTP with hostile HTML and an inline image.
// Nothing active may reach the page, nothing may load from the network, and the image
// inside the message must still show (from the decrypted attachment).
import nodemailer from 'nodemailer';
import { signUp, addCredit, inApp, assert } from '../lib.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mNkYPhfz0AEYBxVMKoAHwAAl8MCAQ1gBYkAAAAASUVORK5CYII=', 'base64');
const HOSTILE = `<html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example/"><link rel="stylesheet" href="https://evil.example/x.css">
<style>@import url(https://evil.example/i.css); body{background:url(https://evil.example/bg.png)}</style>
<style>.ok{color:#1f5e4b;background-image:url('https://evil.example/t.gif')}</style></head>
<body onload="alert(1)" background="https://evil.example/b.png">
<p class="ok" style="background:url(https://evil.example/s.png)">Inline logo: <img src="cid:logo@postern" alt="Logo" width="16" height="16"></p>
<a href="javascript:alert(1)" id="js">js link</a> <a href="https://example.com/ok" onclick="steal()" id="good">good link</a> <a href="data:text/html,<script>1</script>" id="data">data link</a>
<form action="https://evil.example/post"><input name="password"><button>Send</button></form>
<iframe src="https://evil.example/frame"></iframe><object data="https://evil.example/o"></object><embed src="https://evil.example/e">
<svg onload="alert(2)"><script>alert(3)</script></svg><img src="https://evil.example/pixel.gif" width="1" height="1"><img src="//evil.example/proto-relative.png" alt="Remote picture">
<img srcset="https://evil.example/a.png 1x" alt="Srcset picture"><video src="https://evil.example/v.mp4" poster="https://evil.example/p.png"></video>
<script>document.title='pwned'</script><div id="end">END OF MESSAGE</div></body></html>`;

export default async function (t) {
  const s = await t.open();
  const { page } = s;
  const dlg = page.getByRole('dialog');
  await signUp(page, t.base);
  await addCredit(page, 10);
  const made = await inApp(page, async ({ data, api }) => {
    const box = await data.createMailbox({ label: 'Main' });
    const shop = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Shop' });
    const news = await data.createAlias({ mailboxId: box.mailbox.id, label: 'News' });
    await api.post('/api/dev/inbound-mail', { to: news.address, from: 'b@outside.example', subject: 'To the news alias', html: '<p>Only <b>HTML</b> here.</p><p>Second line.</p>' });
    await api.post('/api/dev/inbound-mail', { to: box.address, from: 'c@outside.example', subject: 'To the inbox itself', text: 'y' });
    return { box: box.mailbox.id, shop: shop.address };
  });

  // real SMTP delivery
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port: t.server.smtpPort, secure: false, ignoreTLS: true });
  const info = await transport.sendMail({
    from: '"Careful Sender" <careful@outside.example>', to: made.shop, subject: 'Hostile HTML and an inline image', text: 'Plain part.', html: HOSTILE,
    attachments: [{ filename: 'logo.png', content: PNG, cid: 'logo@postern', contentType: 'image/png' }, { filename: 'notes.txt', content: 'notes' }],
  });
  assert(info.accepted.length === 1, 'the SMTP server did not accept the message');
  t.ok('mail arrives over SMTP');

  const outside = [];
  page.on('request', (r) => { if (!r.url().startsWith(t.base) && !r.url().startsWith('data:') && !r.url().startsWith('about:')) outside.push(r.url()); });
  await page.goto(t.base + '/');
  await page.locator('.recent-item').filter({ hasText: 'Hostile HTML' }).first().click();
  await page.locator('iframe.mail-frame').waitFor();
  await page.waitForFunction(() => /data:image\/png;base64/.test(document.querySelector('iframe.mail-frame')?.getAttribute('srcdoc') || ''), null, { timeout: 10_000 });
  const srcdoc = (await page.locator('iframe.mail-frame').getAttribute('srcdoc')).toLowerCase();
  const bad = ['evil.example', '<script', 'javascript:', 'onload', 'onclick', '<form', '<iframe', '<object', '<embed', '<svg', '<base', 'http-equiv="refresh"', '<link', '@import', '<video', 'srcset=', 'data:text/html'].filter((x) => srcdoc.includes(x));
  assert(bad.length === 0, 'unsafe content is left in the mail frame: ' + bad.join(', '));
  t.ok('hostile HTML is cleaned');
  await page.getByText('Remote images are blocked to stop tracking.').waitFor();
  t.ok('the note about blocked remote images shows');
  assert(!/pwned/.test(await page.title()), 'a script from the mail ran');
  await page.waitForTimeout(600);
  assert(outside.length === 0, 'requests left the origin: ' + outside.join(', '));
  t.ok('no script ran and no request left the origin');

  // From here the test looks inside the sandboxed frame. The driver's own script is refused
  // there and the browser logs that, so console errors are judged up to this point only.
  s.freeze();
  const frame = page.frameLocator('iframe.mail-frame');
  await frame.locator('#end').waitFor();
  assert(await frame.locator('img[alt="Logo"]').evaluate((img) => img.complete && img.naturalWidth === 16), 'the inline image did not show');
  t.ok('the image inside the message shows from the decrypted attachment');
  const [popup] = await Promise.all([s.context.waitForEvent('page', { timeout: 8000 }), frame.locator('#good').click()]);
  assert(await popup.evaluate(() => window.opener === null).catch(() => true), 'the new tab can reach the app');
  assert(new URL(page.url()).pathname.startsWith('/mail/'), 'the app page was navigated by a link in the mail');
  await popup.close();
  t.ok('a link opens a new tab with no way back to the app');

  // the list can show one address only
  await page.goto(t.base + '/aliases');
  await page.locator('.item-row').filter({ hasText: 'Shop' }).getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Show its mail' }).click();
  await page.locator('.msg-row').first().waitFor();
  assert((await page.locator('.msg-subject').allTextContents()).join('|') === 'Hostile HTML and an inline image', 'the alias filter shows other mail');
  await page.getByLabel('Show mail of').selectOption({ label: 'Inbox address only' });
  await page.locator('.msg-row').filter({ hasText: 'To the inbox itself' }).waitFor();
  assert((await page.locator('.msg-row').count()) === 1, 'the inbox-only filter shows other mail');
  await page.getByLabel('Show mail of').selectOption({ label: 'All addresses' });
  await page.waitForFunction(() => document.querySelectorAll('.msg-row').length === 3);
  t.ok('the mail list can show the mail of one address');

  // a message with HTML only: plain view and reply quote are made from the HTML
  await page.locator('.msg-row').filter({ hasText: 'To the news alias' }).click();
  await page.locator('iframe.mail-frame').waitFor();
  await page.getByText('Plain text', { exact: true }).click();
  await page.locator('pre.mail-text').filter({ hasText: 'Only HTML here.' }).waitFor();
  await page.getByRole('button', { name: 'Reply' }).click();
  const quoted = await dlg.getByLabel('Message').inputValue();
  assert(/> Only HTML here\./.test(quoted) && /> Second line\./.test(quoted), 'the reply does not quote the text of an HTML-only message');
  await dlg.getByRole('button', { name: 'Discard' }).click();
  t.ok('HTML-only mail: plain view and reply quote come from the HTML');
}
