import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, newAccount } from './helpers.js';

// Preview mode is for a try-out behind a preview proxy. It must change nothing when it is off.
const apps = [];
after(async () => { for (const a of apps) await a.stop(); });
const preview = { origin: 'https://try.preview.example', 'sec-fetch-site': 'same-origin', 'x-forwarded-proto': 'https' };

test('preview mode off: a different origin is refused and the page cannot be framed', async () => {
  const app = await startTestApp(); apps.push(app);
  const a = await newAccount(app);
  const res = await a.api.put('/api/vault/k1', { value: 'AAAA' }, preview);
  assert.equal(res.status, 403);
  const page = await a.api.get('/');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('preview mode on: the proxy address is accepted, a cross-site request is still refused', async () => {
  const app = await startTestApp({ devPreview: true }); apps.push(app);
  const a = await newAccount(app);
  assert.equal((await a.api.put('/api/vault/k1', { value: 'AAAA' }, preview)).status, 204);
  assert.equal((await a.api.put('/api/vault/k2', { value: 'AAAA' }, { ...preview, 'sec-fetch-site': 'cross-site' })).status, 403);
  const page = await a.api.get('/');
  assert.equal(page.headers.get('x-frame-options'), null);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors \*/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
});

test('preview mode is never on in production', async () => {
  const { loadConfig } = await import('../server/core/config.js');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dataDir = mkdtempSync(join(tmpdir(), 'postern-prod-'));
  const c = loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://x.example', DEV_PREVIEW: '1', DATA_DIR: dataDir });
  assert.equal(c.devPreview, false);
});
