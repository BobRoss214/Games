// Browser e2e: menus work with a plain mouse click (no Enter key, no hover-then-key).
import { serve, launch } from './shot.mjs';
const srv = await serve(); const port = srv.address().port;
const browser = await launch(); const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = []; page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', (e) => logs.push(e.message));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
await page.goto(`http://127.0.0.1:${port}/index.html?debug=1&seed=4`); await page.waitForFunction('window.graveward'); await page.waitForTimeout(500);
const G = (e) => page.evaluate(`(() => { const g = window.graveward; ${e} })()`);
// internal 480x270 canvas shown at 960x540 => x2
const clickItem = async (menuExpr, i) => { const r = await G(`const r = ${menuExpr}.rects[${i}]; return r ? [r.x + r.w / 2, r.y + r.h / 2] : null`); await page.mouse.click(r[0] * 2, r[1] * 2); await page.waitForTimeout(250); };
// title: OPTIONS is item 3 -> click it
await clickItem('g.ui.mainMenu', 3);
ok(await G('return g.ui.screen') === 'options', 'click OPTIONS opens options');
// slider: click the middle of the first slider's bar
const before = await G('const it = g.ui.optionsMenu.items.find((x) => x.type === "slider"); return it.get()');
const idx = await G('return g.ui.optionsMenu.items.findIndex((x) => x.type === "slider")');
await G(`g.ui.optionsMenu.items[${idx}].set(0)`);
const bar = await G(`const it = g.ui.optionsMenu.items[${idx}]; return [it.sliderRect.x, it.sliderRect.y, it.sliderRect.w]`);
await page.mouse.click((bar[0] + bar[2] * 0.75) * 2, (bar[1] + 4) * 2); await page.waitForTimeout(200);
const after = await G(`const it = g.ui.optionsMenu.items[${idx}]; return (it.get() - it.min) / (it.max - it.min)`);
ok(Math.abs(after - 0.75) < 0.06, 'clicking a slider bar sets it (got ' + after.toFixed(2) + ')');
await G(`g.ui.optionsMenu.items[${idx}].set(${before})`);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok(await G('return g.ui.screen') === 'title', 'Escape returns to title');
await clickItem('g.ui.mainMenu', 1);
ok(await G('return g.screen') === 'playing' && await G('return g.match.phase') === 'tutorial', 'click TUTORIAL starts the tutorial');
console.log(logs.join('\n') || 'no console errors'); if (logs.length) fails++;
await browser.close(); srv.close(); process.exit(fails ? 1 : 0);
