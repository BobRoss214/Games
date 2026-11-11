#!/usr/bin/env node
// Operator tool for the "own phone" provider: add, list and remove the phones and SIM cards of the pool.
//
//   node server/tools/ownphone.js help
//
// It opens the same database as the server (DATA_DIR) with the same secret key, so run it
// with the same environment as the server. The server does not keep the pool in memory: it
// sees each change at once, with no restart.
//
// The functions below do the work, and tests call them. The part at the end of the file
// only reads the command line.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../core/config.js';
import { openDb, nowSec } from '../core/db.js';
import { createKeys, randomId } from '../core/keys.js';
import { createPool, countryOfNumber } from '../phone/pool.js';
import { createGatewayClient, WEBHOOK_EVENTS } from '../phone/providers/ownphone.js';
import { ProviderError } from '../phone/providers/errors.js';
import { hookPath } from '../phone/ownphone.js';
import { E164, deleteNumberRows } from '../phone/common.js';

const LABEL_MAX = 60;

// An error with a plain message for the person at the command line.
export class ToolError extends Error {}
const stop = (message) => { throw new ToolError(message); };

// ---------- context ----------

// For tests and for the server process: use handles that exist already.
export function contextOf({ config, db, keys }, { fetchFn = fetch } = {}) {
  return { config, db, keys, pool: createPool({ db, keys, config }), client: createGatewayClient({ apiUrl: config.phone.ownphone.apiUrl, fetchFn }), close() {} };
}

// For the command line: the configuration and the database of the server.
export function openContext(env = process.env) {
  const config = loadConfig(env);
  const db = openDb(join(config.dataDir, 'accounts.db'));
  if (!db.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'numbers'")) {
    db.close();
    stop('The database has no tables yet. Start the server one time, then run this tool again.');
  }
  const ctx = contextOf({ config, db, keys: createKeys(config.secretKey) });
  ctx.close = () => db.close();
  return ctx;
}

// ---------- small helpers ----------

// "+15551234567" -> "+•••••••4567"
export const maskNumber = (number) => (number.length > 5 ? '+' + '•'.repeat(number.length - 5) + number.slice(-4) : number);
const credsOf = (d) => ({ login: d.login, password: d.password });
// The ids of our five webhooks at the gateway (36 characters at most). They come from the hash of
// the webhook token, so a new token has new ids and never writes over the webhooks of the old one.
const hookIds = (hookHash) => WEBHOOK_EVENTS.map((_, i) => `p${i}-${Buffer.from(hookHash).toString('base64url').slice(0, 22)}`);

function gatewayProblem(err, ctx) {
  if (err instanceof ProviderError) {
    if (err.status === 401 || err.status === 403) return new ToolError('The gateway did not accept this login and password. Copy them again from the app on the phone (Cloud Server: Username and Password).');
    if (err.status === 0 || err.status >= 500) return new ToolError(`The phone gateway is not reachable at ${ctx.client.apiUrl}. Check that it runs, and check OWNPHONE_API_URL.`);
    return new ToolError(`The phone gateway refused the request (HTTP ${err.status}).`);
  }
  return err;
}

function cleanSim(ctx, { simNumber, number, country }) {
  const n = Number(simNumber);
  if (!Number.isInteger(n) || n < 1 || n > 3) stop('A SIM number is 1, 2 or 3 (the slot of the SIM card in the phone).');
  const plain = String(number || '').replace(/[\s()-]/g, '');
  if (!E164.test(plain)) stop('Write the phone number of a SIM with + and the country code, for example +15551234567.');
  const where = (country ? String(country) : countryOfNumber(plain)).toUpperCase();
  if (!/^[A-Z]{2}$/.test(where)) stop('The country of this number is not known. Add --country with two letters, for example --country GB.');
  if (ctx.pool.simByNumber(plain)) stop(`The number ${maskNumber(plain)} is in the pool already.`);
  return { simNumber: n, number: plain, country: where };
}

function oneDevice(ctx, label) {
  if (!label || !String(label).trim()) stop('Say which phone: --label "Phone 1".');
  const found = ctx.pool.deviceByLabel(label);
  if (found.length === 0) stop(`No phone has the label "${label}". Run "list" to see the labels.`);
  return found[0];
}

// Takes numbers of the pool away from the accounts that hold them (the normal delete path of a number).
function takeBack(ctx, held) {
  for (const row of held) deleteNumberRows(ctx.db, row.account_id, row.id);
  return held.length;
}

function countryWarnings(ctx, sims) {
  const allowed = ctx.config.phone.countries || [];
  const missing = [...new Set(sims.map((s) => s.country))].filter((c) => !allowed.includes(c));
  return missing.length ? [`PHONE_COUNTRIES does not have ${missing.join(', ')}. The web app offers the countries of that list. Add ${missing.join(', ')} there, or people cannot choose these numbers.`] : [];
}

// Checks the login at the gateway and finds the phone. Returns { device } (an entry of GET /devices),
// or { needDevice: true, devices } when the login has several phones and no deviceId was given.
async function findAtGateway(ctx, creds, deviceId) {
  let devices;
  try { devices = await ctx.client.devices(creds); } catch (err) { throw gatewayProblem(err, ctx); }
  devices = devices.filter((d) => d && typeof d.id === 'string' && d.id);
  if (devices.length === 0) stop('This login has no phone at the gateway yet. Open the app on the phone, connect it to your server, then try again.');
  if (deviceId) {
    const device = devices.find((d) => d.id === deviceId) || null;
    if (!device) stop(`The gateway has no phone with the device id ${deviceId} for this login.`);
    return { device };
  }
  if (devices.length === 1) return { device: devices[0] };
  return { needDevice: true, devices: devices.map((d) => ({ id: d.id, name: String(d.name || ''), lastSeen: String(d.lastSeen || ''), sims: Array.isArray(d.simCards) ? d.simCards.length : 0 })) };
}

// Registers the five webhooks of a phone and sets the signing key and the ping interval.
// If a step fails, the webhooks that were made are removed again, and the error goes to the caller.
async function setUpGateway(ctx, creds, { hookHash, webhookUrl, gatewayId, signingKey }) {
  const ids = hookIds(hookHash);
  const registered = [];
  try {
    for (const [i, event] of WEBHOOK_EVENTS.entries()) {
      await ctx.client.addWebhook(creds, { id: ids[i], url: webhookUrl, event, deviceId: gatewayId });
      registered.push(ids[i]);
    }
    await ctx.client.patchSettings(creds, { webhooks: { signing_key: signingKey }, ping: { interval_seconds: Math.max(1, ctx.config.phone.ownphone.pingSeconds) } });
  } catch (err) {
    for (const id of registered) { try { await ctx.client.deleteWebhook(creds, id); } catch { /* the gateway is not reachable: nothing more to do */ } }
    throw gatewayProblem(err, ctx);
  }
}

// Removes the five webhooks of a token at the gateway. Returns false if the gateway could not be asked.
async function cleanGateway(ctx, creds, hookHash) {
  let clean = true;
  for (const id of hookIds(hookHash)) {
    try { await ctx.client.deleteWebhook(creds, id); } catch (err) { if (!(err instanceof ProviderError && err.notFound)) clean = false; }
  }
  return clean;
}

// ---------- commands ----------

// sims: [{ simNumber, number }]. Returns { needDevice: true, devices } when the login has several
// phones and no deviceId was given; else { id, label, gatewayId, sims, webhookUrl, warnings }.
export async function addPhone(ctx, { label, login, password, sims, deviceId = '', country = '' }) {
  const name = String(label || '').trim();
  if (!name || name.length > LABEL_MAX) stop(`Give the phone a label of 1 to ${LABEL_MAX} characters: --label "Phone 1".`);
  if (ctx.pool.deviceByLabel(name).length) stop(`A phone with the label "${name}" is in the pool already. Choose a different label.`);
  if (!login || !password) stop('The login and the password of the phone are needed. The app shows them on its home screen (Cloud Server: Username and Password).');
  if (!Array.isArray(sims) || sims.length === 0) stop('Name at least one SIM: --sim 1=+15551234567');
  const clean = sims.map((s) => cleanSim(ctx, { ...s, country }));
  if (new Set(clean.map((s) => s.simNumber)).size !== clean.length) stop('Each SIM number can be given one time.');
  if (new Set(clean.map((s) => s.number)).size !== clean.length) stop('Each phone number can be given one time.');

  const creds = { login: String(login), password: String(password) };
  const found = await findAtGateway(ctx, creds, deviceId);
  if (found.needDevice) return found;
  const { device } = found;
  const existing = ctx.pool.devices();
  const same = existing.find((d) => d.gatewayId === device.id);
  if (same) stop(`This phone is in the pool already, with the label "${same.label}".`);

  const warnings = countryWarnings(ctx, clean);
  // What the phone itself says about its SIM cards (often it does not know the number).
  const cards = Array.isArray(device.simCards) ? device.simCards : [];
  for (const s of clean) {
    const card = cards.find((k) => k && k.simNumber === s.simNumber);
    const said = card && typeof card.phoneNumber === 'string' ? card.phoneNumber.replace(/[\s()-]/g, '') : '';
    if (cards.length && !card) warnings.push(`The phone reports no SIM card in slot ${s.simNumber}. Check the slot number.`);
    else if (said && E164.test(said) && said !== s.number) warnings.push(`The phone reports a different number for SIM ${s.simNumber} (it ends in ${said.slice(-4)}). Check the number that you typed.`);
  }
  if (!ctx.config.publicUrl.startsWith('https://')) warnings.push(`PUBLIC_URL is ${ctx.config.publicUrl}. The app on the phone sends events only to an address that starts with https://. Set PUBLIC_URL to the public https address of this server, then remove this phone and add it again.`);
  if (ctx.config.phone.provider !== 'ownphone') warnings.push('PHONE_PROVIDER is not "ownphone". The server does not use the pool until you set PHONE_PROVIDER=ownphone and start it again.');

  // One login of the gateway has one signing key for all its phones. A second phone of a login keeps the key.
  const sibling = existing.find((d) => d.login === creds.login);
  const signingKey = sibling ? sibling.signingKey : randomBytes(32).toString('base64url');

  const made = ctx.db.tx(() => {
    const d = ctx.pool.addDevice({ label: name, login: creds.login, password: creds.password, gatewayId: device.id, signingKey });
    for (const s of clean) ctx.pool.addSim({ deviceId: d.id, ...s });
    return d;
  });
  const webhookUrl = ctx.config.publicUrl + hookPath(made.token);
  try {
    await setUpGateway(ctx, creds, { hookHash: made.hookHash, webhookUrl, gatewayId: device.id, signingKey });
  } catch (err) {
    // Half a set-up is worse than none: take the phone out of the pool again.
    ctx.pool.removeDevice(made.id);
    throw err;
  }
  return { id: made.id, label: name, gatewayId: device.id, sims: clean, webhookUrl, pingSeconds: ctx.config.phone.ownphone.pingSeconds, warnings };
}

// Every phone with its SIM cards. show: true gives the full numbers, else only the last 4 digits.
// accepted: valid webhooks since the phone was added. refused: { device, signature, clock, at } (see refusalLines).
export function listPhones(ctx, { show = false } = {}) {
  return ctx.pool.devices().map((d) => ({
    id: d.id, label: d.label, gatewayId: d.gatewayId, online: d.online, lastSeen: d.lastSeen, createdDay: d.createdDay,
    accepted: d.accepted, refused: d.refused,
    sims: ctx.pool.sims(d.id).map((s) => ({ simNumber: s.simNumber, number: show ? s.number : maskNumber(s.number), country: s.country, inUse: s.inUse })),
  }));
}

export function addSim(ctx, { label, simNumber, number, country = '' }) {
  const device = oneDevice(ctx, label);
  const sim = cleanSim(ctx, { simNumber, number, country });
  if (ctx.pool.sim(device.id, sim.simNumber)) stop(`The phone "${device.label}" has a SIM ${sim.simNumber} in the pool already. Remove it first.`);
  ctx.pool.addSim({ deviceId: device.id, ...sim });
  return { label: device.label, ...sim, warnings: countryWarnings(ctx, [sim]) };
}

// force: also take the number away from the account that holds it. Returns { label, simNumber, number, takenBack }.
export function removeSim(ctx, { label, simNumber, force = false }) {
  const device = oneDevice(ctx, label);
  const sim = ctx.pool.sim(device.id, Number(simNumber));
  if (!sim) stop(`The phone "${device.label}" has no SIM ${simNumber} in the pool.`);
  const held = ctx.pool.heldNumbers({ simId: sim.id });
  if (held.length && !force) stop('An account uses this number. Nothing was changed. Add --force to take the number away from that account: its texts are deleted and cannot come back.');
  const takenBack = ctx.db.tx(() => { const n = takeBack(ctx, held); ctx.pool.removeSim(sim.id); return n; });
  return { label: device.label, simNumber: sim.simNumber, number: maskNumber(sim.number), takenBack };
}

// Returns { label, sims, takenBack, gatewayCleaned }. gatewayCleaned: false if the webhooks could not be removed at the gateway.
export async function removePhone(ctx, { label, force = false }) {
  const device = oneDevice(ctx, label);
  const held = ctx.pool.heldNumbers({ deviceId: device.id });
  if (held.length && !force) stop(`Accounts use ${held.length} number(s) of this phone. Nothing was changed. Add --force to take the numbers away from those accounts: their texts are deleted and cannot come back.`);
  const sims = ctx.pool.sims(device.id).length;
  const takenBack = ctx.db.tx(() => { const n = takeBack(ctx, held); ctx.pool.removeDevice(device.id); return n; });
  // The phone must stop sending events to an address that does not exist any more.
  const gatewayCleaned = await cleanGateway(ctx, credsOf(device), device.hookHash);
  return { label: device.label, sims, takenBack, gatewayCleaned };
}

// The phone signed up at the gateway again (for example after the database of the gateway was lost):
// it has a new login, a new password and a new device id there. This keeps the phone in the pool with
// its SIM cards, so the numbers of accounts and their texts stay. It makes a new webhook token and a
// new signing key, and sets up the gateway under the new login. If a step at the gateway fails, nothing changes.
// Returns { needDevice: true, devices }, or { label, gatewayId, sims, inUse, webhookUrl, pingSeconds, oldCleaned, warnings }.
export async function reloginPhone(ctx, { label, login, password, deviceId = '' }) {
  const device = oneDevice(ctx, label);
  if (!login || !password) stop('The new login and the new password of the phone are needed. The app shows them on its home screen (Cloud Server: Username and Password).');
  const creds = { login: String(login), password: String(password) };
  const found = await findAtGateway(ctx, creds, deviceId);
  if (found.needDevice) return found;
  const others = ctx.pool.devices().filter((d) => d.id !== device.id);
  const taken = others.find((d) => d.gatewayId === found.device.id);
  if (taken) stop(`The phone with this device id is in the pool already, with the label "${taken.label}".`);

  // One login of the gateway has one signing key for all its phones: a phone of the pool that uses the new login keeps its key.
  const sibling = others.find((d) => d.login === creds.login);
  const signingKey = sibling ? sibling.signingKey : randomBytes(32).toString('base64url');
  const fresh = ctx.pool.newToken();
  const webhookUrl = ctx.config.publicUrl + hookPath(fresh.token);
  // The gateway first. Only when all of it worked does the record of the phone change.
  await setUpGateway(ctx, creds, { hookHash: fresh.hookHash, webhookUrl, gatewayId: found.device.id, signingKey });
  ctx.pool.relogin(device.id, { login: creds.login, password: creds.password, gatewayId: found.device.id, signingKey, hookHash: fresh.hookHash });
  // The webhooks of the old token, under the old login (it may not exist any more). If the login
  // is the same and only the password is new, the new password removes them.
  const oldCleaned = await cleanGateway(ctx, device.login === creds.login ? creds : credsOf(device), device.hookHash);

  const sims = ctx.pool.sims(device.id);
  const warnings = [];
  if (!ctx.config.publicUrl.startsWith('https://')) warnings.push(`PUBLIC_URL is ${ctx.config.publicUrl}. The app on the phone sends events only to an address that starts with https://.`);
  return { label: device.label, gatewayId: found.device.id, sims: sims.length, inUse: sims.filter((x) => x.inUse).length, webhookUrl, pingSeconds: ctx.config.phone.ownphone.pingSeconds, oldCleaned, warnings };
}

// Sends one text through a phone, with no account and no charge. Returns { id, simNumber }.
export async function testText(ctx, { label, to, simNumber = 0, text = '' }) {
  const device = oneDevice(ctx, label);
  const dest = String(to || '').replace(/[\s()-]/g, '');
  if (!E164.test(dest)) stop('Write the destination with + and the country code: --to +15551234567');
  const sims = ctx.pool.sims(device.id);
  const sim = simNumber ? sims.find((s) => s.simNumber === Number(simNumber)) : sims[0];
  if (!sim) stop(simNumber ? `The phone "${device.label}" has no SIM ${simNumber} in the pool.` : `The phone "${device.label}" has no SIM in the pool.`);
  const id = randomId();
  const body = String(text || `Test text from ${ctx.config.appName}.`).slice(0, 300);
  try {
    await ctx.client.sendMessage(credsOf(device), { id, deviceId: device.gatewayId, phoneNumbers: [dest], textMessage: { text: body }, simNumber: sim.simNumber, ttl: Math.max(5, ctx.config.phone.ownphone.textTtlSeconds), withDeliveryReport: true });
  } catch (err) { throw gatewayProblem(err, ctx); }
  return { id, simNumber: sim.simNumber, online: device.online };
}

// What the refused webhooks of a phone mean, in words, with what to do. refused: { device, signature, clock, at }.
export function refusalLines(refused) {
  const many = (n) => `${n} ${n === 1 ? 'webhook was' : 'webhooks were'} refused`;
  const lines = [];
  if (refused.device) lines.push(`${many(refused.device)}: the device id did not match. Remove this phone and add it again.`);
  if (refused.signature) lines.push(`${many(refused.signature)}: the signature was wrong. Open the app on the phone one time so that it loads the signing key. If that does not help, remove this phone and add it again.`);
  if (refused.clock) lines.push(`${many(refused.clock)}: the time was more than 5 minutes off. The clock of the phone may be wrong. Set the phone to automatic date and time.`);
  return lines;
}

// The last words of "add": how the person sees that it works, and what to look at if it does not.
export function checkNowLines(ctx) {
  const ping = Math.max(1, ctx.config.phone.ownphone.pingSeconds);
  const minutes = Math.ceil(ping / 60) + 1;
  return [
    'What to check now:',
    `  Run "list" in about ${minutes} minutes. The phone must show "online" and at least 1 accepted webhook (it reports every ${ping} seconds).`,
    '  Then run "test" to send one text.',
    '  If the phone stays offline, the three most likely causes are:',
    '  1. The app did not load the new settings. Open the app on the phone, stop the service and start it again.',
    `  2. The phone cannot reach ${ctx.config.publicUrl} over https. Open that address in the browser of the phone. The app sends nothing to an address that does not start with https://.`,
    '  3. Android stopped the app to save the battery. Turn off battery optimization for the app, and let it start by itself.',
    '  If "list" shows refused webhooks, it says why.',
  ];
}

// ---------- the command line ----------

export const HELP = `Own phone: the pool of phones and SIM cards.

Run this tool with the same environment as the server (DATA_DIR, SECRET_KEY, PUBLIC_URL, OWNPHONE_API_URL).

  node server/tools/ownphone.js add --label "Phone 1" --login <user> --sim 1=+15551234567 [--sim 2=+1555...] [--device-id <id>] [--country GB]
      Adds a phone with its SIM cards. The login and the password are the "Username" and "Password"
      that the app shows on the phone after it is connected to your gateway server.
      The password comes from one of these, the first that is there:
        --password <pass>      easy, but other users of this computer can see it in the process list
        OWNPHONE_PASSWORD      an environment variable (safer)
        --password-stdin       the first line of the standard input (safest): printf '%s' "$PASS" | node server/tools/ownphone.js add ... --password-stdin
  node server/tools/ownphone.js list [--show]
      The phones, their SIM cards (last 4 digits; --show gives the full numbers), in use or free, online or offline.
  node server/tools/ownphone.js add-sim --label "Phone 1" --sim 2=+15557654321 [--country GB]
  node server/tools/ownphone.js remove-sim --label "Phone 1" --sim 2 [--force]
  node server/tools/ownphone.js remove --label "Phone 1" [--force]
      --force takes the numbers away from the accounts that use them. Their texts are deleted.
  node server/tools/ownphone.js relogin --label "Phone 1" --login <new user> [--device-id <id>]
      For a phone that had to sign up at the gateway again (for example after the database of the gateway
      was lost) and got a new Username and Password. The phone stays in the pool with its SIM cards:
      the numbers of accounts and their texts are not touched. The password comes in the same three ways as for "add".
  node server/tools/ownphone.js test --label "Phone 1" --to +15551230000 [--sim 2]
      Sends one test text through the phone.
`;

// argv: the words after the command. Returns { opts: { name: value }, sims: ['1=+1555…'] }.
export function parseArgs(argv) {
  const opts = {};
  const sims = [];
  const FLAGS = new Set(['show', 'force', 'help', 'password-stdin']);
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (!word.startsWith('--')) stop(`This word is not understood: ${word}. Options start with --.`);
    let [name, value] = word.slice(2).split(/=(.*)/s);
    if (FLAGS.has(name)) { opts[name] = true; continue; }
    if (value === undefined) { value = argv[++i]; if (value === undefined) stop(`The option --${name} needs a value.`); }
    if (name === 'sim') sims.push(value); else opts[name] = value;
  }
  return { opts, sims };
}
const simPair = (text) => {
  const m = /^([123])=(.+)$/.exec(String(text));
  if (!m) stop('Write a SIM as <slot>=<number>, for example --sim 1=+15551234567');
  return { simNumber: Number(m[1]), number: m[2] };
};
// "a moment ago", "12 minutes ago", ...
function since(at) {
  const s = Math.max(0, nowSec() - at);
  if (s < 120) return 'a moment ago';
  if (s < 2 * 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 2 * 86400) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}
const ago = (lastSeen) => (lastSeen ? `last seen ${since(lastSeen)}` : 'never seen');

// Runs one command. io: { env, out(line), readStdin() → Promise<string>, open() → context }. Returns the exit code.
export async function runCli(argv, io = {}) {
  const env = io.env || process.env;
  const out = io.out || ((line) => process.stdout.write(line + '\n'));
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || rest.includes('--help')) { out(HELP); return command ? 0 : 2; }
  let ctx = null;
  try {
    const { opts, sims } = parseArgs(rest);
    ctx = io.open ? io.open() : openContext(env);
    if (command === 'add') {
      let password = opts.password || env.OWNPHONE_PASSWORD || '';
      if (!password && opts['password-stdin']) password = String(await (io.readStdin ? io.readStdin() : readStdin())).split(/\r?\n/)[0];
      const res = await addPhone(ctx, { label: opts.label, login: opts.login, password, sims: sims.map(simPair), deviceId: opts['device-id'] || '', country: opts.country || '' });
      if (res.needDevice) {
        out('This login has more than one phone at the gateway. Nothing was added. Run the command again with --device-id and one of these:');
        for (const d of res.devices) out(`  ${d.id}   ${d.name || '(no name)'}   ${d.sims} SIM card(s)   last seen ${d.lastSeen || 'never'}`);
        return 2;
      }
      out(`Added the phone "${res.label}" with ${res.sims.length} SIM card(s):`);
      for (const s of res.sims) out(`  SIM ${s.simNumber}: ${maskNumber(s.number)} (${s.country})`);
      out('Done at the gateway:');
      out(`  - 5 webhooks for this phone (texts in, sent, delivered, failed, ping). They point at ${ctx.config.publicUrl}/api/hooks/ownphone/<secret token>.`);
      out(`  - the signing key for webhooks, and a ping every ${res.pingSeconds} seconds.`);
      for (const w of res.warnings) out(`Warning: ${w}`);
      for (const line of checkNowLines(ctx)) out(line);
    } else if (command === 'relogin') {
      let password = opts.password || env.OWNPHONE_PASSWORD || '';
      if (!password && opts['password-stdin']) password = String(await (io.readStdin ? io.readStdin() : readStdin())).split(/\r?\n/)[0];
      const res = await reloginPhone(ctx, { label: opts.label, login: opts.login, password, deviceId: opts['device-id'] || '' });
      if (res.needDevice) {
        out('This login has more than one phone at the gateway. Nothing was changed. Run the command again with --device-id and one of these:');
        for (const d of res.devices) out(`  ${d.id}   ${d.name || '(no name)'}   ${d.sims} SIM card(s)   last seen ${d.lastSeen || 'never'}`);
        return 2;
      }
      out(`The phone "${res.label}" uses its new login at the gateway now.`);
      out(`Kept as they were: its ${res.sims} SIM card(s), and the ${res.inUse} number(s) that accounts use, with their texts.`);
      out('Done at the gateway, under the new login:');
      out(`  - 5 new webhooks for this phone. They point at ${ctx.config.publicUrl}/api/hooks/ownphone/<new secret token>. The old address does not work any more.`);
      out(`  - a new signing key for webhooks, and a ping every ${res.pingSeconds} seconds.`);
      if (!res.oldCleaned) out('The old login could not be reached, so its webhooks were not removed there. That is normal when the old login is gone.');
      for (const w of res.warnings) out(`Warning: ${w}`);
      for (const line of checkNowLines(ctx)) out(line);
    } else if (command === 'list') {
      const phones = listPhones(ctx, { show: !!opts.show });
      if (!phones.length) out('The pool has no phone. Add one with "add".');
      for (const p of phones) {
        out(`${p.label}   ${p.online ? 'online' : 'OFFLINE'}, ${ago(p.lastSeen)}   ${p.accepted} ${p.accepted === 1 ? 'webhook' : 'webhooks'} accepted   added ${p.createdDay}   device id ${p.gatewayId}`);
        for (const s of p.sims) out(`  SIM ${s.simNumber}: ${s.number} (${s.country})   ${s.inUse ? 'in use' : 'free'}`);
        if (!p.sims.length) out('  no SIM card');
        const refused = refusalLines(p.refused);
        for (const line of refused) out(`  ${line}`);
        if (refused.length && p.refused.at) out(`  The last refused webhook was ${since(p.refused.at)}.`);
      }
    } else if (command === 'add-sim') {
      if (sims.length !== 1) stop('Name one SIM: --sim 2=+15557654321');
      const res = addSim(ctx, { label: opts.label, ...simPair(sims[0]), country: opts.country || '' });
      out(`Added SIM ${res.simNumber} (${maskNumber(res.number)}, ${res.country}) to the phone "${res.label}". The number is free in the pool now.`);
      for (const w of res.warnings) out(`Warning: ${w}`);
    } else if (command === 'remove-sim') {
      if (sims.length !== 1 || !/^[123]$/.test(sims[0])) stop('Say which SIM: --sim 2');
      const res = removeSim(ctx, { label: opts.label, simNumber: Number(sims[0]), force: !!opts.force });
      out(`Removed SIM ${res.simNumber} (${res.number}) of the phone "${res.label}" from the pool.`);
      if (res.takenBack) out(`${res.takenBack} account(s) lost this number and its texts. They see it when they open the app again.`);
    } else if (command === 'remove') {
      const res = await removePhone(ctx, { label: opts.label, force: !!opts.force });
      out(`Removed the phone "${res.label}" and its ${res.sims} SIM card(s) from the pool.`);
      if (res.takenBack) out(`${res.takenBack} number(s) were taken away from accounts, with their texts. The people see it when they open the app again.`);
      out(res.gatewayCleaned ? 'The webhooks of this phone are removed at the gateway.' : 'The gateway was not reachable: the webhooks of this phone are still there. Remove them in the app on the phone (Settings, Webhooks), or the phone keeps sending events to an address that is gone.');
    } else if (command === 'test') {
      const res = await testText(ctx, { label: opts.label, to: opts.to, simNumber: opts.sim ? Number(opts.sim) : (sims[0] ? Number(sims[0]) : 0), text: opts.text || '' });
      out(`The gateway took the test text for SIM ${res.simNumber}.${res.online ? '' : ' The phone is offline now: it sends the text when it is online again.'}`);
      out('Look at the destination phone. The server has no record of a test text.');
    } else {
      out(`The command "${command}" does not exist.\n`);
      out(HELP);
      return 2;
    }
    return 0;
  } catch (err) {
    if (err instanceof ToolError) { out(`Error: ${err.message}`); return 1; }
    throw err;
  } finally {
    if (ctx) ctx.close();
  }
}

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

// Only when this file is the program that was started (not when a test imports it).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    process.stderr.write(`The tool stopped with an error: ${String((err && err.message) || err).slice(0, 200)}\n`);
    process.exitCode = 1;
  });
}
