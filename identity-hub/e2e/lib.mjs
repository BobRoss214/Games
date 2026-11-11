// Helpers for the browser tests. No test framework: plain functions and Playwright.
//
// Playwright is not a dependency of this project. It comes from the global install
// (NODE_PATH), so it is loaded with require().
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    throw new Error('Playwright is not installed. Install it globally (npm install -g playwright) and set NODE_PATH to the global node_modules folder.');
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

// Starts the real server on a free port with a temporary data folder and simulated providers.
export async function startServer(extraEnv = {}) {
  const port = await freePort();
  const smtpPort = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'postern-e2e-'));
  const env = { ...process.env, PORT: String(port), SMTP_PORT: String(smtpPort), PUBLIC_URL: `http://localhost:${port}`, DATA_DIR: dataDir, RATE_LIMITS: 'false', POW_BITS: '10', LOG_LEVEL: 'warn', ...extraEnv };
  delete env.NODE_ENV; // never the production settings
  const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  let exited = false;
  child.once('exit', () => { exited = true; });
  const url = `http://localhost:${port}`;
  const started = Date.now();
  for (;;) {
    if (exited) throw new Error('The server did not start:\n' + output);
    try { const res = await fetch(url + '/api/config'); if (res.ok) break; } catch { /* not ready yet */ }
    if (Date.now() - started > 20_000) { child.kill(); throw new Error('The server did not answer in 20 seconds:\n' + output); }
    await sleep(100);
  }
  return {
    url, port, smtpPort, dataDir,
    output: () => output,
    async stop() {
      if (!exited) { child.kill('SIGTERM'); await new Promise((r) => { child.once('exit', r); setTimeout(r, 3000); }); }
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Network notices that every test may see: a signed-out visit asks for the account and gets 401.
const ALWAYS_ALLOWED = [/status of 401 .*\/api\/account$/];

// One test file gets one context object "t".
export function makeContext({ browser, server, name }) {
  const sessions = [];
  const t = {
    base: server.url,
    server,
    checks: 0,
    // Counts one checked fact. Prints nothing: the runner prints one line per file.
    ok(_what) { t.checks++; },
    // Opens a new browser window with its own storage (like a different person or device).
    // passkeys: add a virtual passkey device. prf: false = a device without the PRF extension.
    async open({ width = 1280, height = 800, dark = false, passkeys = true, prf = true } = {}) {
      const phone = width < 721;
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light', acceptDownloads: true, hasTouch: phone, isMobile: phone });
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });
      const page = await context.newPage();
      const s = { context, page, errors: [], allowed: [...ALWAYS_ALLOWED] };
      // allow(/pattern/): a console error that this test causes on purpose (for example a refused request).
      s.allow = (...patterns) => { s.allowed.push(...patterns); return s; };
      s.watch = (p) => {
        p.on('console', (m) => { if (m.type() === 'error') s.errors.push(`console: ${m.text()} @ ${m.location().url || ''}`); });
        p.on('pageerror', (e) => s.errors.push(`pageerror: ${e.message}`));
      };
      s.watch(page);
      if (passkeys) {
        s.cdp = await context.newCDPSession(page);
        await s.cdp.send('WebAuthn.enable');
        await s.cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: prf } });
      }
      // freeze(): stop collecting console errors (before the test drives a sandboxed frame, where Playwright's own script is refused and logged).
      s.freeze = () => { s.frozen = [...s.errors]; };
      s.unexpected = () => (s.frozen || s.errors).filter((e) => !s.allowed.some((re) => re.test(e)));
      s.close = () => context.close();
      sessions.push(s);
      return s;
    },
    unexpectedErrors() { return sessions.flatMap((s) => s.unexpected()); },
    async closeAll() { for (const s of sessions) { try { await s.close(); } catch { /* closed already */ } } },
  };
  t.name = name;
  return t;
}

// ---------- steps that many tests share ----------

// Goes through sign-up in the app. Returns the recovery key text.
export async function signUp(page, base, { passkey = false } = {}) {
  await page.goto(base + '/create');
  await page.getByRole('button', { name: 'Make my account' }).click();
  await page.getByRole('heading', { name: 'Save your recovery key' }).waitFor({ timeout: 60_000 });
  const key = (await page.locator('.keycard-group').allTextContents()).join('-');
  await page.getByLabel('I saved my recovery key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Add a passkey' }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: passkey ? 'Add a passkey' : 'Skip for now' }).click();
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor({ timeout: 20_000 });
  return key;
}

export async function signIn(page, base, key) {
  await page.goto(base + '/sign-in');
  await page.getByLabel('Recovery key').fill(key);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Home', level: 1 }).waitFor({ timeout: 20_000 });
}

export async function signOut(page) {
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('heading', { name: 'A private door for your mail and calls.' }).waitFor();
}

// Runs code inside the app page. The code gets the app's own modules, so that a test can
// make data fast through the same code paths as the screens (encryption included).
// fn: async ({ data, pay, phone, api, store, mail, identities, persona }, arg) => result
export function inApp(page, fn, arg) {
  // The text is run by the test driver, not by the page, so the page policy (no eval) stays untouched.
  const source = `(async (arg) => {
    const [data, pay, phone, apiMod, storeMod, mail, identities, persona, session] = await Promise.all([
      import('/js/lib/data.js'), import('/js/lib/pay.js'), import('/js/lib/phone.js'), import('/js/lib/api.js'), import('/js/lib/store.js'),
      import('/js/lib/mail.js'), import('/js/lib/identities.js'), import('/js/lib/persona/index.js'), import('/js/lib/session.js'),
    ]);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    return (${fn.toString()})({ data, pay, phone, api: apiMod.api, store: storeMod.store, mail, identities, persona, session, wait }, arg);
  })(${JSON.stringify(arg === undefined ? null : arg)})`;
  return page.evaluate(source);
}

// Adds credit fast (a simulated private payment through the app's own code).
export function addCredit(page, dollars = 20) {
  return inApp(page, async ({ pay, store, wait }, units) => {
    const target = store.get('balance') + units * 100;
    const p = await pay.startPurchase({ units, method: 'BTC-LN' });
    await pay.simulatePayment(p.localId);
    for (let i = 0; i < 150 && store.get('balance') < target; i++) await wait(100);
    if (store.get('balance') < target) throw new Error('credit did not arrive');
  }, dollars);
}

// The newest 6-digit code that the simulated phone provider "sent" (text or spoken).
export async function lastPhoneCode(page) {
  const po = await page.evaluate(() => fetch('/api/dev/phone-outbox').then((r) => r.json()));
  const said = (po.calls || []).map((c) => c.say).filter(Boolean).pop();
  const text = (po.texts || []).map((x) => x.body).filter((b) => /\b\d{6}\b/.test(b)).pop();
  return { text: text ? text.match(/\b(\d{6})\b/)[1] : '', spoken: said ? said.replace(/\D/g, '').slice(0, 6) : '' };
}

export function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// Makes a filled account for layout and keyboard tests: two inboxes, aliases (one off,
// one very long), mail, two numbers with texts, a linked real phone with forwarding, calls.
// The page must be signed in. Returns ids that tests use in addresses.
export async function seedAccount(page) {
  await addCredit(page, 40);
  return inApp(page, async ({ data, phone, api }) => {
    const personal = await data.createMailbox({ label: 'Personal', localPart: 'anna.reed' + Math.floor(Math.random() * 9000 + 1000) });
    const side = await data.createMailbox({ label: 'Side project' });
    const shop = await data.createAlias({ mailboxId: personal.mailbox.id, label: 'Maple Shop' });
    const news = await data.createAlias({ mailboxId: personal.mailbox.id, label: 'Weekly newsletter' });
    const reg = await data.createAlias({ mailboxId: side.mailbox.id, label: 'Domain registrar' });
    const long = await data.createAlias({ mailboxId: personal.mailbox.id, label: 'A very long label that someone typed to see what happens', localPart: 'this.is.a-very-long_address.that.goes.on.and.on.for.testing' + Math.floor(Math.random() * 900 + 100) });
    await data.createAlias({ mailboxId: personal.mailbox.id, label: '' });
    const mail = (to, from, fromName, subject, text, extra = {}) => api.post('/api/dev/inbound-mail', { to, from, fromName, subject, text, ...extra });
    await mail(personal.address, 'lena@friends.example', 'Lena Fischer', 'Dinner on Friday?', 'Hi Anna,\n\nAre you free on Friday at seven?\n\nLena');
    await mail(reg.address, 'billing@registrar.example', 'Northwind Domains', 'Your domain renews in 30 days', 'Your domain renews on December 11.');
    await mail(long.address, 'no-reply@forum.example', 'Forum', 'Confirm your address', 'Open this link to confirm: https://forum.example/confirm/abc123');
    await mail(shop.address, 'orders@shop.example', 'Maple Shop', 'Your order 1042 is on its way', 'Thank you for your order.\nSee your order: https://example.com/orders/1042', {
      html: '<div style="font-family:Georgia,serif"><h1 style="color:#1f5e4b">Your order 1042 is on its way</h1><p>Thank you for your order.</p><p><a href="https://example.com/orders/1042">See your order</a></p><p><img src="https://example.com/banner.png" alt="Shop banner" width="300" height="60"></p></div>',
      attachments: [{ filename: 'a-file-with-a-very-long-name-that-must-truncate-gracefully-in-the-list.txt', contentType: 'text/plain', content: 'aGVsbG8' }],
    });
    await data.updateAlias(news.alias.id, { enabled: false });
    const n1 = await data.buyNumber({ number: (await phone.searchNumbers('US', '415'))[0].number, label: 'Selling the bike' });
    const n2 = await data.buyNumber({ number: (await phone.searchNumbers('US', '212'))[0].number, label: 'Deliveries' });
    const text = (n, from, body) => api.post('/api/dev/inbound-text', { numberId: n.number.id, number: n.plain, from, body });
    await text(n1, '+14155550142', 'Hi, is the bike still for sale?');
    await api.post(`/api/numbers/${n1.number.id}/texts`, { number: n1.plain, to: '+14155550142', body: 'Yes. You can see it on Saturday.' });
    await text(n1, '+14155550142', 'Great. Is 10 in the morning OK? I can bring cash.');
    await text(n1, '+12125550188', 'Your code is 448 201. Do not share it.');
    await text(n2, '+16465550111', 'Your parcel arrives today between 2 and 4.');
    const real = await data.linkPhone({ number: '+14155550199', label: 'My mobile', via: { id: n1.number.id, number: n1.plain } });
    const out = await api.get('/api/dev/phone-outbox');
    const code = out.texts.map((x) => x.body).reverse().find((b) => /\b\d{6}\b/.test(b)).match(/\b(\d{6})\b/)[1];
    await data.verifyPhone(real.id, code);
    await data.updateNumber(n1.number.id, { forwardPhoneId: real.id, forwardTexts: true, forwardCalls: true });
    await api.post('/api/dev/inbound-call', { numberId: n1.number.id, number: n1.plain, from: '+14155550142', seconds: 95 });
    await data.setPref('hideChecklist', true);
    await data.loadAll();
    return { personal: personal.mailbox.id, side: side.mailbox.id, n1: n1.number.id, n2: n2.number.id, shop: shop.alias.id, shopAddress: shop.address, reg: reg.alias.id, phone: real.id };
  });
}
