// Browser tests for the web app. Run: npm run test:e2e   (or: node e2e/run.mjs journey  to run files that match a word)
//
// The script starts its own server on a free port with a temporary data folder and
// simulated providers, runs every file in e2e/tests/, prints one line per file and a
// total, and stops the server. Exit code 1 if a test fails or the page logs an error
// that the test did not expect (a page error, a blocked script, a failed request).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, loadPlaywright, startServer, makeContext } from './lib.mjs';

const filter = process.argv.slice(2);
const dir = join(ROOT, 'e2e', 'tests');
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().filter((f) => !filter.length || filter.some((w) => f.includes(w)));
if (files.length === 0) { console.error('No test file matches.'); process.exit(1); }

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const { chromium } = loadPlaywright();
const browser = await chromium.launch();
let shared = null; // the server with the default settings, used by most files
const results = [];
const startAll = Date.now();

try {
  for (const file of files) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    const name = file.replace('.test.mjs', '');
    const started = Date.now();
    let server = null;
    let own = false;
    let t = null;
    let error = null;
    try {
      // A file that exports "server" (extra settings) gets its own server.
      if (mod.server) { server = await startServer(mod.server); own = true; } else { shared = shared || await startServer(); server = shared; }
      t = makeContext({ browser, server, name });
      await mod.default(t);
      const unexpected = t.unexpectedErrors();
      if (unexpected.length) error = new Error(`the page logged ${unexpected.length} unexpected error(s):\n      ${unexpected.slice(0, 8).join('\n      ')}`);
    } catch (err) {
      error = err;
    }
    if (t) await t.closeAll();
    if (own && server) await server.stop();
    const line = `${name.padEnd(22)} ${String(t ? t.checks : 0).padStart(3)} checks  ${seconds(Date.now() - started).padStart(7)}`;
    if (error) {
      console.log(`FAIL  ${line}`);
      console.log(`      ${String(error.message || error).split('\n').slice(0, 14).join('\n      ')}`);
    } else console.log(`ok    ${line}`);
    results.push({ name, ok: !error, checks: t ? t.checks : 0 });
  }
} finally {
  await browser.close();
  if (shared) await shared.stop();
}

const failed = results.filter((r) => !r.ok);
const checks = results.reduce((n, r) => n + r.checks, 0);
console.log(`\ne2e: ${results.length} files, ${results.length - failed.length} passed, ${failed.length} failed, ${checks} checks, ${seconds(Date.now() - startAll)}`);
process.exit(failed.length ? 1 : 0);
