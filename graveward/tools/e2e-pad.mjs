// Gamepad e2e: fake controller injected into navigator.getGamepads (join in lobby, stick movement, buttons, hot-unplug pause).
import { serve, launch } from './shot.mjs';
const srv = await serve(); const port = srv.address().port;
const browser = await launch(); const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = []; page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', (e) => logs.push(e.message));
await page.addInitScript(() => {
  window.__pad = null;
  const mk = () => ({ index: 0, connected: true, id: 'Fake Xbox Controller', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
  window.__setPad = (on) => { window.__pad = on ? window.__pad || mk() : null; };
  window.__axis = (i, v) => { if (window.__pad) window.__pad.axes[i] = v; };
  window.__btn = (i, down) => { if (window.__pad) window.__pad.buttons[i] = { pressed: down, value: down ? 1 : 0 }; };
  navigator.getGamepads = () => [window.__pad, null, null, null];
});
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
await page.goto(`http://127.0.0.1:${port}/index.html?debug=1&seed=4`); await page.waitForFunction('window.graveward'); await page.waitForTimeout(400);
const G = (e) => page.evaluate(`(() => { const g = window.graveward; ${e} })()`);
const press = async (b, ms = 120) => { await page.evaluate((i) => window.__btn(i, true), b); await page.waitForTimeout(ms); await page.evaluate((i) => window.__btn(i, false), b); await page.waitForTimeout(ms); };
await page.evaluate(() => window.__setPad(true)); await page.waitForTimeout(200);
await press(0); ok(await G('return g.ui.screen') === 'setup', 'pad A on PLAY opens setup');
await G("g.ui.setupMenu.sel = 6"); await press(0); ok(await G('return g.ui.screen') === 'lobby', 'pad reaches lobby');
await press(0); await page.waitForTimeout(300); ok(await G('return g.ui.lobby.slots.filter(Boolean).length') === 1, 'pad A joins the lobby');
await press(15); // dpad right changes god
await press(0, 200); await page.waitForFunction('window.graveward.screen === "playing"', null, { timeout: 8000 }); ok(true, 'pad readies up and the match starts');
ok(await G('return g.match.players[0].device') === 'pad0', 'player 1 is bound to pad0');
const a0 = await G('const b = g.match.players[0].body; return [b.x, b.y, b.angle]');
await page.evaluate(() => window.__axis(1, -1)); await page.waitForTimeout(900); await page.evaluate(() => window.__axis(1, 0));
const a1 = await G('const b = g.match.players[0].body; return [b.x, b.y]'); ok(Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) > 0.8, 'left stick moves the hero');
await page.evaluate(() => window.__axis(2, 1)); await page.waitForTimeout(400); await page.evaluate(() => window.__axis(2, 0));
ok(Math.abs((await G('return g.match.players[0].body.angle')) - a0[2]) > 0.3, 'right stick turns the camera');
await page.evaluate(() => window.__btn(7, true)); await page.waitForTimeout(160);
ok(await G('const b = g.match.players[0].body; return !!b.atk || b.charge > 0'), 'right trigger attacks'); await page.evaluate(() => window.__btn(7, false));
await page.waitForTimeout(400);
await page.evaluate(() => window.__setPad(false)); await page.waitForTimeout(300);
ok(await G('return g.paused') === true, 'unplugging the controller pauses the game'); ok((await G('return g.pauseMsg')).includes('DISCONNECTED'), 'pause message names the disconnect');
await page.screenshot({ path: '/tmp/claude-0/shots/e2e_pad_pause.png' });
console.log(logs.join('\n') || 'no console errors');
await browser.close(); srv.close(); process.exit(fails || logs.length ? 1 : 0);
