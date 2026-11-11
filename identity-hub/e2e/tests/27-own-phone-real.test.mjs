// "Own phone" in the browser with the REAL provider code. The server runs with
// PHONE_PROVIDER=ownphone and talks to the fake gateway (test/fake-smsgate.js). The operator
// tool adds a phone with two SIM cards to the pool, and the fake phone posts signed webhooks
// the way the app does. No request of the browser is intercepted here.
import { startServer, signUp, addCredit, settle, assert } from '../lib.mjs';
import { startFakeGateway } from '../../test/fake-smsgate.js';
import { openContext, addPhone, listPhones } from '../../server/tools/ownphone.js';

const SIMS = ['+14155557101', '+14155557102'];
const SHOWN = ['+1 415 555 7101', '+1 415 555 7102'];
const FRIEND = '+14155550142';

export default async function (t) {
  const gateway = await startFakeGateway();
  let server = null;
  let ctx = null;
  try {
    server = await startServer({ PHONE_PROVIDER: 'ownphone', OWNPHONE_API_URL: gateway.url });

    // The operator tool, on the database of the running server (the same DATA_DIR and secret key).
    const env = { ...process.env, DATA_DIR: server.dataDir, PHONE_PROVIDER: 'ownphone', OWNPHONE_API_URL: gateway.url, PUBLIC_URL: server.url };
    delete env.NODE_ENV;
    ctx = openContext(env);
    const user = gateway.addUser({ devices: [{ name: 'Test phone', sims: [1, 2] }] });
    const added = await addPhone(ctx, { label: 'Test phone', login: user.login, password: user.password, sims: SIMS.map((number, i) => ({ simNumber: i + 1, number })) });
    assert(added.sims.length === 2 && gateway.users.get(user.login).webhooks.size === 5, 'the tool did not set up the phone');
    const phone = gateway.phone(user.login, user.devices[0].id, server.url);

    const s = await t.open();
    const { page } = s;
    const dlg = page.getByRole('dialog');
    await signUp(page, server.url);
    await addCredit(page, 20);

    // "Get a number" shows the two free numbers of the pool at once, with no search.
    await page.goto(server.url + '/numbers');
    await page.getByRole('button', { name: 'Get a number' }).first().click();
    await dlg.locator('.number-option').first().waitFor();
    assert((await dlg.locator('.number-option-value').allTextContents()).join() === SHOWN.join(), 'the dialog does not list the two free numbers of the pool');
    await dlg.getByText('These numbers come from the phones of this server.').waitFor();
    assert(await dlg.getByLabel('Area code').count() === 0, 'a pool has no search by area code');
    t.ok('"Get a number" lists the two free numbers of the pool');

    await dlg.locator('.number-option').filter({ hasText: SHOWN[0] }).getByRole('button', { name: /^Buy/ }).click();
    await dlg.getByLabel('Label').fill('Own line');
    await dlg.getByRole('button', { name: /Buy for/ }).click();
    await page.locator('.number-heading').filter({ hasText: SHOWN[0] }).waitFor({ timeout: 10_000 });
    const numberPath = new URL(page.url()).pathname;
    // The phone was never seen: the number says so. Then the phone reports, and the mark changes by itself.
    await page.locator('[data-phone="offline"]').filter({ hasText: 'Phone offline' }).first().waitFor();
    await settle(page);
    assert((await phone.ping()).status === 200, 'the server refused the ping of the phone');
    await page.locator('[data-phone="online"]').filter({ hasText: 'Phone online' }).first().waitFor({ timeout: 10_000 });
    t.ok('a number of the pool is taken; the phone shows as offline, then as online after its first ping, with no reload');

    // Calls are not possible with this provider: no voicemail part in the settings of the number.
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Release number' }).waitFor();
    assert(await page.locator('[data-section="voicemail"]').count() === 0, 'the voicemail setting shows for a number that has no calls');
    await page.getByRole('tab', { name: 'Texts' }).click();

    // A text goes out. It waits for the phone; then the phone reports, and the words change with no reload.
    const before = gateway.messagesOf(user.login).length;
    await page.getByRole('button', { name: 'New text' }).click();
    await dlg.getByLabel('To').fill(FRIEND);
    await dlg.getByRole('button', { name: 'Continue' }).click();
    await page.locator('.composer-input').fill('Hello from the own phone');
    await page.getByRole('button', { name: 'Send' }).click();
    const status = page.locator('.bubble-row.is-out .bubble-status');
    await status.filter({ hasText: 'Waiting for the phone' }).waitFor();
    const sent = gateway.messagesOf(user.login);
    assert(sent.length === before + 1, 'the gateway did not get the text');
    const message = sent.at(-1).request;
    assert(message.phoneNumbers.join() === FRIEND && message.textMessage.text === 'Hello from the own phone' && message.simNumber === 1 && message.deviceId === user.devices[0].id && message.withDeliveryReport === true, 'the gateway got a different text');
    t.ok('a sent text reaches the gateway and says "Waiting for the phone"');
    const loads = [];
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) loads.push(f.url()); });
    assert((await phone.report('sent', sent.at(-1).id)).status === 200, 'the report "sent" was refused');
    await status.filter({ hasText: 'Sent' }).waitFor({ timeout: 10_000 });
    assert((await phone.report('delivered', sent.at(-1).id)).status === 200, 'the report "delivered" was refused');
    await status.filter({ hasText: 'Delivered' }).waitFor({ timeout: 10_000 });
    t.ok('the phone reports sent, then delivered: the status changes with no reload');

    // A text comes in through the phone.
    assert((await phone.receive({ from: FRIEND, text: 'An answer through the SIM', sim: 1 })).status === 200, 'the incoming text was refused');
    await page.locator('.bubble-row.is-in .bubble-text').filter({ hasText: 'An answer through the SIM' }).waitFor({ timeout: 10_000 });
    assert(loads.length === 0, 'the page was loaded again');
    t.ok('an incoming text of the phone appears in the conversation');

    // The list of numbers: the phone is online in the row.
    await page.goto(server.url + '/numbers');
    const row = page.locator('.item-row, .phone-row').filter({ hasText: SHOWN[0] }).first();
    await row.locator('[data-phone="online"]').filter({ hasText: 'Phone online' }).waitFor();
    // The phone goes silent: 20 minutes with no report (the limit is 15). The job tells the account, the row changes by itself.
    await settle(page);
    ctx.db.run('UPDATE own_devices SET last_seen = ?', Math.floor(Date.now() / 1000) - 20 * 60);
    assert(await page.evaluate(() => fetch('/api/dev/ownphone-jobs', { method: 'POST' }).then((r) => r.status)) === 204, 'the jobs did not run');
    await row.locator('[data-phone="offline"]').filter({ hasText: /^Phone offline since \d\d:\d\d|^Phone offline since / }).waitFor({ timeout: 10_000 });
    const tool = listPhones(ctx)[0];
    assert(tool.online === false && tool.accepted === 4 && tool.refused.signature === 0 && tool.refused.clock === 0 && tool.refused.device === 0, `the tool counts ${JSON.stringify(tool)}`);
    assert(tool.sims.map((x) => x.inUse).join() === 'true,false', 'the tool does not show which number is in use');
    t.ok('online in the row; after 20 silent minutes the row says "Phone offline since …" with no reload');

    // Release: the number is free again for "Get a number".
    await page.goto(server.url + numberPath);
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Release number' }).click();
    await dlg.getByRole('button', { name: 'Release number' }).click();
    await page.getByText('Number released', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Get a number' }).first().click();
    await dlg.locator('.number-option').first().waitFor();
    assert((await dlg.locator('.number-option-value').allTextContents()).join() === SHOWN.join(), 'the released number is not free again');
    assert(listPhones(ctx)[0].sims.every((x) => !x.inUse), 'the tool still shows a number in use');
    t.ok('a released number is back in the pool');
  } finally {
    if (ctx) ctx.close();
    await t.closeAll();
    if (server) await server.stop();
    await gateway.stop();
  }
}
