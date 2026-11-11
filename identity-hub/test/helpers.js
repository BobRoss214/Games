// Shared test helpers. Each test file starts its own app with a temporary data folder.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { createAccountKeys } from '../shared/crypto.js';
import { generateRecoveryKey } from '../shared/recovery.js';
import { b64u, unb64u } from '../shared/bytes.js';

export { b64u, unb64u };

// Starts an app on a free port with simulated providers. Call app.stop() in `after`.
export async function startTestApp(overrides = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'postern-test-'));
  const base = {
    dataDir, port: 0, host: '127.0.0.1', logLevel: 'silent', powBits: 4, rateLimits: false,
    publicUrl: 'http://localhost:8080', origin: 'http://localhost:8080',
    mail: { smtpPort: 0, smtpHost: '127.0.0.1', domains: ['postern.test', 'alt.test'], relayUrl: '' },
    phone: { provider: 'mock' },
    pay: { provider: 'mock' },
  };
  const app = await createApp(merge(base, overrides), {});
  await app.start();
  const stop = app.stop;
  app.stop = async () => { await stop(); rmSync(dataDir, { recursive: true, force: true }); };
  return app;
}

function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) && typeof a[k] === 'object' ? merge(a[k], v) : v;
  return out;
}

// A small HTTP client that keeps cookies, like a browser tab.
export function client(app) {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const init = { method, headers: { ...headers }, redirect: 'manual' };
    if (cookie) init.headers.cookie = cookie;
    if (body !== undefined) {
      if (Buffer.isBuffer(body) || typeof body === 'string') init.body = body;
      else { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
    }
    const res = await fetch(app.url + path, init);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    let data = null;
    if (type.includes('json')) data = await res.json();
    else if (res.status !== 204) data = Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
  return {
    call,
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b, h) => call('POST', p, b ?? {}, h),
    put: (p, b, h) => call('PUT', p, b ?? {}, h),
    patch: (p, b, h) => call('PATCH', p, b ?? {}, h),
    del: (p, b, h) => call('DELETE', p, b, h),
    setCookie: (v) => { cookie = v; },
    get cookie() { return cookie; },
  };
}

// Makes an account directly in the store (does not use the sign-up route) and
// returns a signed-in client plus the account keys, as a browser has them.
export async function newAccount(app, { credits = 0 } = {}) {
  const recovery = await generateRecoveryKey();
  const keys = await createAccountKeys(recovery.bytes);
  app.store.createAccount(keys.upload);
  if (credits) app.store.credit(keys.upload.accountId, credits, 'topup');
  const session = app.store.createSession(keys.upload.accountId);
  const api = client(app);
  api.setCookie(`postern=${session.token}`);
  return { id: keys.upload.accountId, recovery, keys: keys.local, upload: keys.upload, api, session };
}
