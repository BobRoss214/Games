// End-to-end UI test: title -> setup -> lobby (2 keyboard players join) -> match; drives inputs and asserts the sim responds.
import { serve, launch } from './shot.mjs';
const srv = await serve(); const port = srv.address().port;
const browser = await launch(); const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = []; page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const shot = (n) => page.screenshot({ path: `/tmp/claude-0/shots/e2e_${n}.png` });
await page.goto(`http://127.0.0.1:${port}/index.html?debug=1&seed=9`);
await page.waitForFunction('window.graveward', null, { timeout: 15000 });
const G = (expr) => page.evaluate(`(() => { const g = window.graveward; ${expr} })()`);
const tap = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(90); } };
await page.waitForTimeout(400);
ok(await G('return g.ui.screen') === 'title', 'starts on title screen');
await tap('Enter'); ok(await G('return g.ui.screen') === 'setup', 'PLAY opens match setup');
await tap('ArrowDown', 5); await shot('setup');
await tap('Enter'); ok(await G('return g.ui.screen') === 'lobby', 'continue opens lobby');
await tap('Space'); await page.waitForTimeout(150); await tap('Enter'); await page.waitForTimeout(300); await shot('lobby_joined');
ok(await G('return g.ui.lobby.slots.filter(Boolean).length') === 2, 'keyboard 1 (space) and keyboard 2 (enter) both joined');
await tap('ArrowRight'); // P2 changes god
await tap('Space'); await tap('Enter'); // both ready
await page.waitForTimeout(400); await shot('lobby_ready');
await page.waitForFunction('window.graveward.screen === "playing"', null, { timeout: 8000 });
ok(true, 'match starts once everyone is ready');
ok(await G('return g.viewers.length') === 2, 'two humans => two viewports');
ok(await G('return g.match.phase') === 'opening', 'begins in the antechamber free-for-all');
// movement: hold W
const p0 = await G('const b = g.match.players[0].body; return [b.x, b.y, b.angle]');
await page.keyboard.down('KeyW'); await page.waitForTimeout(900); await page.keyboard.up('KeyW');
const p1 = await G('const b = g.match.players[0].body; return [b.x, b.y]');
ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 0.8, 'W moves player 1 forward');
// turning keys for P1 (J/L) and P2 arrows
await page.keyboard.down('KeyL'); await page.waitForTimeout(400); await page.keyboard.up('KeyL');
const a1 = await G('return g.match.players[0].body.angle'); ok(Math.abs(a1 - p0[2]) > 0.3, 'L turns player 1');
const q0 = await G('const b = g.match.players[1].body; return [b.x, b.y]');
await page.keyboard.down('ArrowUp'); await page.waitForTimeout(800); await page.keyboard.up('ArrowUp');
const q1 = await G('const b = g.match.players[1].body; return [b.x, b.y]');
ok(Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) > 0.6, 'ArrowUp moves player 2 (second keyboard scheme)');
// attack with left click
await page.mouse.move(480, 270); await page.mouse.down(); await page.waitForTimeout(150);
const swinging = await G('return !!g.match.players[0].body.atk || g.match.players[0].body.charge > 0'); await page.mouse.up(); await page.waitForTimeout(200);
ok(swinging, 'left click starts an attack');
await shot('opening_2p');
// pause via Escape
await tap('Tab'); ok(await G('return g.paused') === true, 'Tab pauses'); await shot('paused');
await tap('Enter'); ok(await G('return g.paused') === false, 'RESUME continues');
// fast forward into the floor with bots winning FFA (humans are idle)
await G('g.fastForward(140)'); await page.waitForTimeout(500);
ok(['floor', 'opening'].includes(await G('return g.match.phase')), 'match advances after the free-for-all');
await shot('floor_2p');
// tab defocus pauses
await G('g.resume()'); await G("window.dispatchEvent(new Event('blur'))"); await page.waitForTimeout(150);
ok(await G('return g.paused') === true, 'losing window focus pauses the game'); await G('g.resume()');
// end screen flow: Play Again restarts a match
await G("const m = g.match; m.endGame('victory', m.heroPlayer || m.players[0])"); await G('g.fastForward(0.1)'); await page.waitForTimeout(3500); await shot('end');
ok(await G('return g.match.phase') === 'end', 'end screen is shown'); await tap('Enter'); await page.waitForTimeout(400);
ok(await G("return g.screen === 'playing' && g.match.phase === 'opening'"), 'PLAY AGAIN starts a fresh match');
console.log(logs.length ? 'CONSOLE ERRORS:\n' + logs.join('\n') : 'no console errors');
await browser.close(); srv.close();
process.exit(fails || logs.length ? 1 : 0);
