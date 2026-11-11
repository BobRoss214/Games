// Encrypted export: "Download my data" builds one file in the browser, and /open-export reads
// it again with the recovery key, signed out, with no request to the server.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signUp, addCredit, inApp, assert } from '../lib.mjs';
import { generateRecoveryKey } from '../../shared/recovery.js';

const MARK = {
  label: 'Maple MARKLABEL7',
  identity: 'Zebra MARKIDENT3',
  identityNote: 'Club MARKNOTE8 cards',
  subject: 'Order MARKSUBJ4410 is on its way',
  html: 'MARKHTML2203',
  attachment: 'MARKATTACH7731 receipt line',
  text: 'MARKTEXT5582 see you at ten',
  reply: 'MARKREPLY6 fine with me',
  blocked: 'spam@markblock.example',
  sent: 'MARKSENT9 thanks',
};
const MAGIC = Buffer.from([0x89, 0x50, 0x53, 0x54, 0x52, 0x4e, 0x58, 0x0a]);
const b64u = (text) => Buffer.from(text, 'utf8').toString('base64url');
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// An account with every kind of data that an export holds. Returns the values that the test looks for.
function fill(page) {
  return inApp(page, async ({ data, phone, api, identities, persona, mail }, M) => {
    const box = await data.createMailbox({ label: 'Home box' });
    const shop = await data.createAlias({ mailboxId: box.mailbox.id, label: M.label });
    const plain = await data.createAlias({ mailboxId: box.mailbox.id, label: 'Newsletter' });
    const groupId = await identities.createIdentity({ name: M.identity, note: M.identityNote });
    const groupPersona = await persona.generatePersona('US');
    await identities.updateIdentity(groupId, { persona: groupPersona });
    const aliasPersona = await persona.generatePersona('US');
    await data.setItemPersona('alias', shop.alias.id, aliasPersona);
    await data.setItemIdentity('alias', shop.alias.id, groupId);
    await api.patch(`/api/aliases/${plain.alias.id}`, { expiresAt: Math.floor(Date.now() / 1000) + 40 * 86400 });
    await api.post(`/api/addresses/${shop.alias.id}/blocks`, { kind: 'address', value: M.blocked });
    await api.post('/api/dev/inbound-mail', {
      to: shop.address, from: 'orders@mapleshop.example', fromName: 'Maple Shop', subject: M.subject, text: 'Thank you for your order.',
      html: `<div><h1>Your order</h1><p id="mark">${M.html}</p><p><img src="https://tracker.example/pixel.png" alt="banner" width="20" height="20"></p></div>`,
      attachments: [{ filename: 'receipt.txt', contentType: 'text/plain', content: M.attachmentB64 }],
    });
    await api.post('/api/dev/inbound-mail', { to: box.address, from: 'lena@friends.example', fromName: 'Lena Fischer', subject: 'Dinner on Friday?', text: 'Are you free at seven?' });
    await mail.sendMail({ from: { addressId: shop.alias.id, address: shop.address }, to: ['friend@elsewhere.example'], subject: M.sent, text: 'Sent from the alias.' });
    const found = await phone.searchNumbers('US', '415');
    const n = await data.buyNumber({ number: found[0].number, label: 'Bike line' });
    await data.setItemIdentity('number', n.number.id, groupId);
    await api.post('/api/dev/inbound-text', { numberId: n.number.id, number: n.plain, from: '+14155550142', body: M.text });
    await api.post(`/api/numbers/${n.number.id}/texts`, { number: n.plain, to: '+14155550142', body: M.reply });
    await api.post('/api/dev/inbound-text', { numberId: n.number.id, number: n.plain, from: '+12125550188', body: 'Your code is 448 201.' });
    await api.patch(`/api/numbers/${n.number.id}`, { voicemail: true });
    await api.post('/api/dev/inbound-call', { numberId: n.number.id, number: n.plain, from: '+14155550142', voicemail: true, seconds: 5 });
    await api.post('/api/dev/inbound-call', { numberId: n.number.id, number: n.plain, from: '+16465550111', seconds: 30 });
    await data.setPref('hideChecklist', true);
    await data.loadAll();
    // Wait until the voicemail is stored.
    for (let i = 0; i < 50; i++) {
      const { calls } = await api.get(`/api/numbers/${n.number.id}/calls`);
      if (calls.some((c) => c.voicemail)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return {
      aliasAddress: shop.address, boxAddress: box.address, number: n.plain,
      groupName: persona.fullName(groupPersona), aliasName: persona.fullName(aliasPersona),
    };
  }, { ...MARK, attachmentB64: b64u(MARK.attachment) });
}

// Chooses a file on the viewer page and waits for the key step.
async function chooseFile(page, path) {
  await page.locator('[data-export="viewer"] input[type=file]').setInputFiles(path);
}
async function openWithKey(page, path, key) {
  await chooseFile(page, path);
  await page.getByLabel('Recovery key').fill(key);
  await page.getByRole('button', { name: 'Open the file' }).click();
  await page.locator('[data-export="banner"]').waitFor();
}

export default async function (t) {
  const dir = mkdtempSync(join(tmpdir(), 'postern-export-test-'));
  try {
    // ---------- make the account and the export ----------
    const s = await t.open();
    const { page } = s;
    const dlg = page.getByRole('dialog');
    const key = await signUp(page, t.base);
    await addCredit(page, 20);
    const made = await fill(page);
    const plainMarks = [...Object.values(MARK), made.aliasAddress, made.boxAddress, made.number, made.groupName, made.aliasName, 'mapleshop.example', 'Lena Fischer'];

    await page.goto(t.base + '/settings');
    const section = page.locator('[data-export="section"]');
    await section.waitFor();
    const words = await section.innerText();
    assert(/random identifiers/.test(words) && /attachments/.test(words) && /call history/.test(words), 'the section does not say what is in the file');
    assert(/numbers as working numbers/.test(words) && /credit/i.test(words) && /Passkeys/.test(words) && /cannot be loaded back/.test(words), 'the section does not say what is not in the file');
    assert(/recovery key/.test(words) && /about 256 MB/.test(words) && /phone can fail earlier/.test(words), 'the section does not name the key and the size limits');
    t.ok('Settings says what is in the file, what is not, which key opens it, and the size limits');

    // Every request from the click to the download: only reads, and no plain data in them.
    // First wait until the app itself is quiet (another feature saves encrypted notes about senders after mail loads).
    await page.evaluate(async () => { try { const m = await import('/js/lib/leakwatch.js'); if (m.whenIdle) await m.whenIdle(); } catch { /* no such file */ } });
    await page.waitForLoadState('networkidle');
    const requests = [];
    const record = (r) => requests.push({ method: r.method(), url: r.url(), body: r.postData() || '' });
    page.on('request', record);
    await section.getByRole('button', { name: 'Download my data' }).click();
    await dlg.locator('[data-export="estimate"]').waitFor();
    const summary = await dlg.innerText();
    assert(/3 messages, 1 attachment/.test(summary) && /2, 1 with voicemail/.test(summary), `the dialog counts are wrong: ${summary}`);
    assert(/^about \d+(\.\d)? KB$/.test((await dlg.locator('[data-export="estimate"]').innerText()).trim()), 'the estimate does not show as a size');
    await dlg.getByLabel('Leave out attachments and voicemail').waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Build the file' }).click()]);
    await dlg.getByText('Your file is ready').waitFor();
    page.off('request', record);
    const name = download.suggestedFilename();
    assert(/^postern-export-\d{4}-\d{2}-\d{2}\.postern$/.test(name), `the file name is ${name}`);
    assert((await dlg.locator('[data-export="filename"]').innerText()).trim() === name, 'the dialog shows a different file name');
    const fullPath = join(dir, name);
    await download.saveAs(fullPath);
    const file = readFileSync(fullPath);
    assert(file.subarray(0, 8).equals(MAGIC), 'the download is not an export file');
    for (const mark of plainMarks) assert(!file.includes(Buffer.from(mark, 'utf8')), `the file holds plain data: ${mark}`);
    t.ok('the export downloads as postern-export-<day>.postern, and the file holds no plain data');

    const api = requests.filter((r) => new URL(r.url).pathname.startsWith('/api/'));
    assert(api.length >= 10, `the export made only ${api.length} requests`);
    assert(api.every((r) => r.method === "GET" && !r.body), `the export sent data to the server: ${api.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url} ${r.body.slice(0, 300)}`).join(", ")}`);
    for (const r of requests) {
      const where = decodeURIComponent(r.url) + '\n' + r.body;
      for (const mark of plainMarks) assert(!where.includes(mark), `a request during the export holds plain data (${mark}): ${r.method} ${r.url}`);
    }
    assert(await page.evaluate(() => Object.keys(localStorage).length === 0 || !Object.values(localStorage).join(' ').includes('MARK')), 'plain data went into localStorage');
    t.ok(`the export only reads (${api.length} GET requests); no request holds a plain value`);
    await dlg.getByRole('button', { name: 'Close' }).last().click();

    // ---------- leave out attachments and voicemail (keyboard only) ----------
    await section.getByRole('button', { name: 'Download my data' }).focus();
    await page.keyboard.press('Enter');
    const build = dlg.getByRole('button', { name: 'Build the file' });
    await build.waitFor();
    assert(await build.evaluate((el) => el === document.activeElement), 'the focus is not on "Build the file"');
    const sizeFull = (await dlg.locator('[data-export="estimate"]').innerText()).trim();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Space');
    assert(await dlg.getByLabel('Leave out attachments and voicemail').isChecked(), 'Space did not tick the option');
    const sizeLean = (await dlg.locator('[data-export="estimate"]').innerText()).trim();
    assert(sizeLean !== sizeFull, 'the estimate did not change with the option');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const [leanDownload] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
    const leanPath = join(dir, 'lean.postern');
    await leanDownload.saveAs(leanPath);
    assert(readFileSync(leanPath).length < file.length - 16000, 'the file without attachments and voicemail is not smaller');
    await dlg.getByText('Your file is ready').waitFor();
    await page.keyboard.press('Enter'); // the focus is on Close
    await dlg.waitFor({ state: 'hidden' });
    t.ok('keyboard only: "Leave out attachments and voicemail" gives a smaller file');

    // ---------- Cancel ----------
    let extraDownload = false;
    const noteDownload = () => { extraDownload = true; };
    page.on('download', noteDownload);
    await page.route('**/api/messages/*', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue().catch(() => {}); });
    await section.getByRole('button', { name: 'Download my data' }).click();
    await build.click();
    await dlg.locator('[data-export="progress"]').waitFor();
    assert(/^(Starting…|Mail \d of 3)$/.test((await dlg.locator('[data-export="progress"]').innerText()).trim()), 'the progress does not show in words');
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await dlg.waitFor({ state: 'hidden' });
    await page.getByText('Export cancelled. No file was saved.').waitFor();
    await page.waitForTimeout(2500);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    page.off('download', noteDownload);
    assert(!extraDownload, 'a cancelled export saved a file');
    t.ok('Cancel stops the export; nothing is saved');

    // Progress in words on a slower run: "Mail 1 of 3" shows before the end.
    // The three messages answer one after the other, 700 ms apart.
    let slow = 0;
    await page.route('**/api/messages/*', async (route) => { slow += 700; await new Promise((r) => setTimeout(r, slow)); await route.continue().catch(() => {}); });
    await section.getByRole('button', { name: 'Download my data' }).click();
    const [third] = await Promise.all([
      page.waitForEvent('download'),
      build.click().then(() => dlg.locator('[data-export="progress"]').filter({ hasText: /^Mail [12] of 3$/ }).first().waitFor()),
    ]);
    await third.cancel().catch(() => {});
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await dlg.getByText('Your file is ready').waitFor();
    // "Open an export file" in the dialog goes to the viewer. Signed in, the account key opens the file.
    await dlg.getByRole('link', { name: 'Open an export file' }).click();
    await page.getByRole('heading', { name: 'Open an export file', level: 1 }).waitFor();
    assert(new URL(page.url()).pathname === '/open-export', 'the button did not open the viewer');
    await chooseFile(page, fullPath);
    await page.getByRole('button', { name: 'Open with this account' }).click();
    await page.locator('[data-export="banner"]').waitFor();
    t.ok('progress shows as "Mail 1 of 3"; signed in, "Open with this account" opens the file');
    await s.close();

    // ---------- the viewer, signed out, in a fresh browser ----------
    const v = await t.open();
    const vp = v.page;
    // The start page for people without an account has a link to the viewer.
    await vp.goto(t.base + '/');
    await vp.getByRole('link', { name: 'Open an export file' }).click();
    await vp.getByRole('heading', { name: 'Open an export file', level: 1 }).waitFor();
    assert(new URL(vp.url()).pathname === '/open-export', 'the link on the start page does not open the viewer');
    await vp.waitForLoadState('networkidle');
    await vp.waitForTimeout(500);
    // From here on the page must ask no server for anything.
    const later = [];
    v.context.on('request', (r) => { if (/^https?:/i.test(r.url())) later.push(`${r.method()} ${r.url()}`); });

    const junk = join(dir, 'notes.postern');
    writeFileSync(junk, 'These are my notes. They are not an export.');
    await chooseFile(vp, junk);
    await vp.getByText('This is not an export file from this app.').waitFor();
    t.ok('a file that is not an export gets a plain message');

    await chooseFile(vp, fullPath);
    const head = vp.locator('[data-export="header"]');
    await head.waitFor();
    const headText = await head.innerText();
    assert(headText.includes(name) && /Postern/.test(headText) && /\b20\d\d\b/.test(headText), `the header does not show the app name and the day: ${headText}`);
    assert(await vp.getByRole('button', { name: 'Open with this account' }).count() === 0, 'a signed-out page offers the account key');
    const keyField = vp.getByLabel('Recovery key');
    const openBtn = vp.getByRole('button', { name: 'Open the file' });
    await keyField.fill('ABCD-EFGH');
    await openBtn.click();
    await vp.getByText('A recovery key has 36 letters and numbers, in 9 groups of 4.').waitFor();
    await keyField.fill(key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A'));
    await openBtn.click();
    await vp.getByText('This key has a typing error. Check each group of four characters.').waitFor();
    await keyField.fill((await generateRecoveryKey()).text);
    await openBtn.click();
    await vp.getByText('This key does not open this file.').waitFor();
    t.ok('typing mistakes and a wrong recovery key get plain messages');

    await keyField.fill(key.toLowerCase().replace(/-/g, ' '));
    await keyField.press('Enter');
    const banner = vp.locator('[data-export="banner"]');
    await banner.waitFor();
    assert(/Read-only copy from [A-Z][a-z]{2} \d{1,2}, 20\d\d/.test(await banner.innerText()), 'the banner does not say "Read-only copy from <day>"');
    const viewer = vp.locator('[data-export="viewer"]');
    const counts = (await vp.locator('[data-export="counts"]').innerText()).replace(/\s+/g, ' ');
    assert(/Inboxes 1 Aliases 2 Numbers 1 Real phones 0 Identities 1 Messages 3 Texts 3 Calls 2 Blocked senders 1/.test(counts), `the counts are wrong: ${counts}`);
    const identity = vp.locator('[data-export="identity"]');
    const identityText = await identity.innerText();
    for (const want of [MARK.identity, MARK.identityNote, made.groupName, made.aliasAddress, MARK.label, 'Bike line']) assert(identityText.includes(want), `the identity does not show ${want}`);
    const notIn = await viewer.innerText();
    assert(/numbers as working numbers/.test(notIn) && /Your credit/.test(notIn), 'the file does not say what is not in it');
    await vp.locator('[data-export="check"]').filter({ hasText: 'Checked. Every part of the file is complete and unchanged.' }).waitFor();
    t.ok('the recovery key opens the file: banner, counts, the identity with its random identifiers and items, the file check');

    await vp.getByRole('tab', { name: 'Aliases and numbers' }).click();
    const items = await vp.locator('[data-export="items"]').innerText();
    for (const want of [made.boxAddress, made.aliasAddress, MARK.label, made.aliasName, 'Random identifiers', 'Ends on', MARK.identity, 'Bike line']) assert(items.includes(want), `the items do not show ${want}`);
    assert(items.replace(/\s/g, '').includes(made.number.replace(/\s/g, '')), 'the number does not show');
    t.ok('aliases and numbers show with labels, end date, identity and random identifiers');

    // Mail: list, search, message, attachment.
    await vp.getByRole('tab', { name: 'Mail', exact: true }).click();
    const mailPart = vp.locator('[data-export="mail"]');
    assert(await mailPart.locator('.msg-row').count() === 3, 'the mail list does not have 3 rows');
    const search = vp.getByLabel('Search mail by sender or subject');
    await search.fill('zzzz');
    await mailPart.getByText('No message matches').waitFor();
    await search.fill('lena');
    await vp.waitForFunction(() => document.querySelectorAll('[data-export="mail"] .msg-row').length === 1);
    assert((await mailPart.locator('.msg-row').innerText()).includes('Dinner on Friday?'), 'the search by sender found the wrong message');
    await search.fill('marksubj');
    await vp.waitForFunction(() => document.querySelectorAll('[data-export="mail"] .msg-row').length === 1);
    await search.fill('');
    await mailPart.getByRole('button', { name: 'Sent', exact: true }).click();
    await vp.waitForFunction(() => document.querySelectorAll('[data-export="mail"] .msg-row').length === 1);
    assert((await mailPart.locator('.msg-row').innerText()).includes(MARK.sent), 'the Sent filter does not show the sent message');
    await mailPart.getByRole('button', { name: 'All', exact: true }).click();
    await mailPart.locator('.msg-row', { hasText: MARK.subject }).click();
    const message = vp.locator('[data-export="message"]');
    await message.locator('iframe.mail-frame').waitFor();
    const messageText = await message.innerText();
    assert(messageText.includes(MARK.subject) && messageText.includes('Maple Shop') && messageText.includes(made.aliasAddress) && messageText.includes(`${MARK.label}, ${made.aliasAddress}`), 'the message head is not complete');
    assert(await message.locator('iframe.mail-frame').getAttribute('sandbox') === 'allow-popups allow-popups-to-escape-sandbox', 'the mail frame has a different sandbox');
    await message.getByText('Remote images are blocked to stop tracking.').waitFor();
    const [att] = await Promise.all([vp.waitForEvent('download'), message.getByRole('button', { name: 'Download receipt.txt' }).click()]);
    assert(readFileSync(await att.path(), 'utf8') === MARK.attachment, 'the attachment from the file has different bytes');
    assert(att.suggestedFilename() === 'receipt.txt', 'the attachment has a different name');
    await message.getByText('Plain text', { exact: true }).click();
    await message.locator('.mail-text').filter({ hasText: 'Thank you for your order.' }).waitFor();
    await vp.getByRole('button', { name: 'Back to the list' }).click();
    assert(await mailPart.locator('.msg-row').count() === 3, 'Back does not show the list again');
    t.ok('mail: list, search by sender and subject, Sent filter, the message, the attachment bytes');

    // Texts and calls.
    await vp.getByRole('tab', { name: 'Texts' }).click();
    const textsPart = vp.locator('[data-export="texts"]');
    assert(await textsPart.locator('.thread').count() === 2, 'the texts are not in 2 conversations');
    await textsPart.locator('.thread', { hasText: '+1 415 555 0142' }).click();
    const bubbles = await vp.locator('[data-export="bubbles"]').innerText();
    assert(bubbles.includes(MARK.text) && bubbles.includes(MARK.reply) && !bubbles.includes('448 201'), 'the conversation does not show its texts');
    assert(await vp.locator('[data-export="bubbles"] .bubble-row.is-out').count() === 1, 'the sent text is not on the other side');
    await vp.getByRole('tab', { name: 'Calls' }).click();
    const callsPart = vp.locator('[data-export="calls"]');
    assert(await callsPart.locator('.call-row').count() === 2, 'the call list does not have 2 calls');
    const vm = callsPart.locator('.f-vm');
    assert((await vm.innerText()).includes('Voicemail · 0:05'), 'the voicemail line is not there');
    await vm.getByRole('button', { name: /^Play/ }).click();
    await vp.waitForFunction(() => { const a = document.querySelector('.f-vm audio'); return a && Number.isFinite(a.duration) && Math.abs(a.duration - 1) < 0.2 && a.src.startsWith('blob:'); }, null, { timeout: 10_000 });
    await vp.getByRole('tab', { name: 'Blocked senders' }).click();
    const blocks = await vp.locator('[data-export="blocks"]').innerText();
    assert(blocks.includes(MARK.blocked) && blocks.includes(made.aliasAddress), 'the blocked sender does not show');
    t.ok('texts by conversation, calls, the voicemail plays from the file, blocked senders');

    // The file without attachments and voicemail.
    await vp.getByRole('button', { name: 'Close the file' }).click();
    await openWithKey(vp, leanPath, key);
    assert(/Attachments and voicemail sound\. You chose to leave them out\./.test(await viewer.innerText()), 'the lean file does not say what was left out');
    await vp.getByRole('tab', { name: 'Mail', exact: true }).click();
    await vp.locator('[data-export="mail"] .msg-row', { hasText: MARK.subject }).click();
    const leanAtt = vp.locator('[data-export="attachment"]');
    await leanAtt.waitFor();
    assert(/receipt\.txt/.test(await leanAtt.innerText()) && /Not in this file/.test(await leanAtt.innerText()) && await leanAtt.getByRole('button').count() === 0, 'a left-out attachment offers a download');
    await vp.getByRole('tab', { name: 'Calls' }).click();
    assert(/The sound is not in this file\./.test(await vp.locator('[data-export="calls"] .f-vm').innerText()), 'a left-out voicemail does not say so');
    t.ok('a file without attachments and voicemail lists them and says that they are not in it');

    // Damaged and cut files.
    await vp.getByRole('button', { name: 'Close the file' }).click();
    const damaged = Buffer.from(file);
    damaged[damaged.length - 40] ^= 0x01;
    const damagedPath = join(dir, 'damaged.postern');
    writeFileSync(damagedPath, damaged);
    await chooseFile(vp, damagedPath);
    await keyField.fill(key);
    await openBtn.click();
    await vp.getByText('This file is damaged or was changed. It cannot be opened safely.').waitFor();
    await vp.getByRole('button', { name: 'Choose a different file' }).click();
    const cutPath = join(dir, 'cut.postern');
    writeFileSync(cutPath, file.subarray(0, file.length - 300));
    await chooseFile(vp, cutPath);
    await vp.getByText('This file is not complete', { exact: true }).waitFor();
    await keyField.fill(key);
    await openBtn.click();
    await vp.locator('.form-error').filter({ hasText: /This file is (not complete|damaged)/ }).waitFor();
    assert(await vp.locator('[data-export="banner"]').count() === 0, 'a cut file opened');
    t.ok('a damaged file and a cut file get plain messages and do not open');

    // The HTML of a message, inside the sandboxed frame (the remote image must not load).
    await vp.getByRole('button', { name: 'Choose a different file' }).click();
    await openWithKey(vp, fullPath, key);
    await vp.getByRole('tab', { name: 'Mail', exact: true }).click();
    await vp.locator('[data-export="mail"] .msg-row', { hasText: MARK.subject }).click();
    await vp.locator('iframe.mail-frame').waitFor();
    v.freeze(); // Playwright's own script is refused inside the sandboxed frame, and the browser logs that
    await vp.frameLocator('iframe.mail-frame').locator('#mark').filter({ hasText: MARK.html }).waitFor();
    assert(await vp.frameLocator('iframe.mail-frame').locator('img').count() === 0 || !(await vp.frameLocator('iframe.mail-frame').locator('img').first().getAttribute('src') || '').startsWith('http'), 'the remote image is still in the message');
    await vp.waitForTimeout(500);
    assert(later.length === 0, `the viewer asked the server for something after it had loaded:\n${later.join('\n')}`);
    assert(await vp.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0), 'the viewer wrote to browser storage');
    t.ok('zero network requests after the viewer page had loaded; nothing in browser storage');
    await v.close();

    // ---------- phone, 390 px: a different account, then the recovery key ----------
    const m = await t.open({ width: 390, height: 844 });
    const mp = m.page;
    await signUp(mp, t.base);
    await mp.goto(t.base + '/settings');
    const mSection = mp.locator('[data-export="section"]');
    await mSection.scrollIntoViewIfNeeded();
    assert(await noSidewaysScroll(mp), 'Settings scrolls sideways at 390px');
    assert((await mSection.getByRole('button', { name: 'Download my data' }).boundingBox()).height >= 44, 'the export button is lower than 44px at 390px');
    await mSection.getByRole('link', { name: 'Open an export file' }).click();
    await mp.getByRole('heading', { name: 'Open an export file', level: 1 }).waitFor();
    assert((await mp.getByRole('button', { name: 'Choose a file' }).boundingBox()).height >= 44, '"Choose a file" is lower than 44px at 390px');
    await chooseFile(mp, fullPath);
    await mp.getByRole('button', { name: 'Open with this account' }).click();
    await mp.getByText('This file is from a different account. Use the recovery key of the account that made the file.').waitFor();
    await mp.getByLabel('Recovery key').fill(key);
    await mp.getByRole('button', { name: 'Open the file' }).click();
    await mp.locator('[data-export="banner"]').waitFor();
    for (const tab of ['Overview', 'Mail', 'Texts', 'Calls', 'Aliases and numbers', 'Blocked senders']) {
      await mp.getByRole('tab', { name: tab, exact: true }).click();
      await mp.waitForTimeout(150);
      assert(await noSidewaysScroll(mp), `the viewer scrolls sideways at 390px on ${tab}`);
    }
    await mp.getByRole('tab', { name: 'Mail', exact: true }).click();
    const row = mp.locator('[data-export="mail"] .msg-row', { hasText: MARK.subject });
    assert((await row.boundingBox()).height >= 44, 'a mail row is lower than 44px at 390px');
    await row.click();
    await mp.locator('[data-export="message"] iframe.mail-frame').waitFor();
    assert(await noSidewaysScroll(mp), 'an open message scrolls sideways at 390px');
    assert((await mp.getByRole('button', { name: 'Download receipt.txt' }).boundingBox()).height >= 40, 'the attachment button is too low at 390px');
    t.ok('390px: a file of a different account needs its recovery key; no sideways scroll; large targets');
    await m.close();

    // ---------- the viewer with the keyboard only ----------
    const k = await t.open();
    const kp = k.page;
    await kp.goto(t.base + '/open-export');
    await kp.getByRole('heading', { name: 'Open an export file', level: 1 }).waitFor();
    for (let i = 0; i < 12 && !(await kp.getByRole('button', { name: 'Choose a file' }).evaluate((el) => el === document.activeElement)); i++) await kp.keyboard.press('Tab');
    assert(await kp.getByRole('button', { name: 'Choose a file' }).evaluate((el) => el === document.activeElement), 'Tab does not reach "Choose a file"');
    await chooseFile(kp, fullPath); // the file window of the system cannot be driven by a test
    await kp.getByLabel('Recovery key').waitFor();
    assert(await kp.getByLabel('Recovery key').evaluate((el) => el === document.activeElement), 'the focus is not in the key field');
    await kp.keyboard.type(key);
    await kp.keyboard.press('Enter');
    await kp.locator('[data-export="banner"]').waitFor();
    const active = (selector) => kp.evaluate((sel) => !!document.activeElement && document.activeElement.matches(sel), selector);
    for (let i = 0; i < 12 && !(await active('[role="tab"]')); i++) await kp.keyboard.press('Tab');
    await kp.keyboard.press('ArrowRight'); // Mail
    await kp.locator('[data-export="mail"]').waitFor();
    for (let i = 0; i < 6 && !(await active('input[type="search"]')); i++) await kp.keyboard.press('Tab');
    await kp.keyboard.type('marksubj');
    await kp.waitForFunction(() => document.querySelectorAll('[data-export="mail"] .msg-row').length === 1);
    for (let i = 0; i < 8 && !(await active('.msg-row')); i++) await kp.keyboard.press('Tab');
    await kp.keyboard.press('Enter');
    await kp.locator('[data-export="message"]').waitFor();
    assert(await active('.message-subject'), 'the focus is not on the subject of the open message');
    await kp.keyboard.press('Shift+Tab');
    assert(await kp.getByRole('button', { name: 'Back to the list' }).evaluate((el) => el === document.activeElement), 'Shift+Tab does not reach "Back to the list"');
    await kp.keyboard.press('Enter');
    await kp.locator('[data-export="mail"] .msg-row').first().waitFor();
    assert(await active('.msg-row'), 'the focus does not go back to the row of the message');
    t.ok('keyboard only: the key field, Enter opens the file, tabs with arrows, search, open a message, back');
    await k.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
