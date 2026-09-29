// Scenario screenshots: node tools/shots.mjs <name> [--seed N] [--humans N] [--players N] [--ff seconds] [--views N] [--viewbot]
import { serve, launch } from './shot.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const name = args[0] || 'shot', seed = opt('seed', '7'), humans = opt('humans', '1'), players = opt('players', '4'), ff = +opt('ff', '0'), views = opt('views', '1');
const out = opt('out', `/tmp/claude-0/shots/${name}.png`), w = +opt('w', '960'), h = +opt('h', '540'), wait = +opt('wait', '600');
const extra = opt('q', '');
const srv = await serve(); const port = srv.address().port;
const browser = await launch(); const page = await browser.newPage({ viewport: { width: w, height: h } });
const logs = []; page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); }); page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
await page.goto(`http://127.0.0.1:${port}/index.html?auto=1&debug=1&seed=${seed}&humans=${humans}&players=${players}&views=${views}${args.includes('--viewbot') ? '&viewbot=1' : ''}${extra ? '&' + extra : ''}`);
await page.waitForFunction('window.graveward && window.graveward.match', null, { timeout: 15000 });
if (ff) await page.evaluate((s) => { window.graveward.fastForward(s); }, ff);
if (args.includes('--js')) await page.evaluate(opt('js', ''));
await page.waitForTimeout(wait);
await page.screenshot({ path: out });
console.log(logs.slice(0, 15).join('\n') || 'no console errors');
console.log('state:', JSON.stringify(await page.evaluate(() => { const g = window.graveward, m = g.match; return { phase: m.phase, t: Math.round(m.time), fps: g.fps, hero: m.heroPlayer && m.heroPlayer.name, floor: m.floorIndex }; })));
await browser.close(); srv.close();
