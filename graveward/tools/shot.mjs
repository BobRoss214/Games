// Usage: node tools/shot.mjs "<path?query>" out.png [waitMs] [w h]
// Serves the graveward folder on a temp port and screenshots the page with Playwright (preinstalled chromium).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
export function serve(port = 0) {
  return new Promise((res) => {
    const srv = createServer(async (req, rsp) => {
      try {
        const u = new URL(req.url, 'http://x'); let p = normalize(join(root, decodeURIComponent(u.pathname)));
        if (!p.startsWith(root)) { rsp.writeHead(403); return rsp.end(); }
        if (u.pathname.endsWith('/')) p = join(p, 'index.html');
        const data = await readFile(p);
        rsp.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        rsp.end(data);
      } catch { rsp.writeHead(404); rsp.end('nf'); }
    }).listen(port, '127.0.0.1', () => res(srv));
  });
}
function loadPlaywright() {
  for (const spec of ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright']) { try { return require(spec); } catch (e) { /* try next */ } }
  throw new Error('Playwright not found. Install it once (npm i -g playwright) to run the browser tests; the game itself needs nothing.');
}
export async function launch() {
  const { chromium } = loadPlaywright();
  const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , target, out = 'shot.png', wait = '800', W = '960', H = '540'] = process.argv;
  const srv = await serve(); const port = srv.address().port;
  const browser = await launch(); const page = await browser.newPage({ viewport: { width: +W, height: +H } });
  const logs = []; page.on('console', (m) => logs.push(m.type() + ': ' + m.text())); page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/${target}`);
  await page.waitForTimeout(+wait);
  await page.screenshot({ path: out });
  console.log(logs.join('\n'));
  await browser.close(); srv.close();
}
