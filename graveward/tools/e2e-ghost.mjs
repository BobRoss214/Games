// Human ghost e2e: a human becomes a Ghost, floats to a pentagram, possesses a monster with the E key, attacks, leaves the body,
// possesses a trap and triggers it, and finally kills the Hero to take the crown.
import { serve, launch } from './shot.mjs';
const srv = await serve(); const port = srv.address().port;
const browser = await launch(); const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = []; page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', (e) => logs.push(e.message));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
await page.goto(`http://127.0.0.1:${port}/index.html?debug=1&auto=1&humans=1&seed=21`); await page.waitForFunction('window.graveward && window.graveward.match');
const G = (e) => page.evaluate(`(() => { const g = window.graveward, m = g.match; ${e} })()`);
await G('g.fastForward(140)');
await G(`const me = m.players[0]; // make sure the human is a ghost: swap the crown to a bot if needed
  if (me.role === 'hero') { const bot = m.players[1]; m.doSwap(bot, me, me.body.x, me.body.y, 0); }
  m.players.forEach((p) => { if (!p.human) p.ai = { think: () => (window.__blank ||= { fwd: 0, strafe: 0, turn: 0, turnRate: 0, attack: false, alt: false }), upgradeDecide() {} }; }); g.fastForward(0.2);`);
ok(await G('return m.players[0].role') === 'ghost' && await G('return m.players[0].body.type') === 'ghost', 'human is a floating ghost');
// put the ghost on an unused pentagram
await G(`const w = m.world, me = m.players[0]; const hh = m.heroActor(); let px = hh.x + 2.2, py = hh.y; if (!w.canStand(px, py, 0.3)) { px = hh.x - 2.2; } const cx = px | 0, cy = py | 0;
  const pent = w.addProp({ kind: 'pent', x: cx + 0.5, y: cy + 0.5, cx, cy, room: hh.room }); window.__pent = { x: pent.x, y: pent.y }; me.body.x = pent.x; me.body.y = pent.y; g.fastForward(0.1);`);
ok(await G('return !!window.__pent'), 'a pentagram exists on this floor');
await page.keyboard.press('KeyE'); await page.waitForTimeout(300);
ok(await G("return m.players[0].body.type === 'monster'"), 'pressing E on a pentagram turns the ghost into a monster');
await page.screenshot({ path: '/tmp/claude-0/shots/e2e_monster.png' });
await page.mouse.move(480, 270); await page.mouse.down(); await page.waitForTimeout(200); await page.mouse.up();
ok(await G('const b = m.players[0].body; return !!b.atk || Object.values(b.cds).some((c) => c > 0)'), 'attack input fires the monster ability');
// hold E to leave body
await page.keyboard.down('KeyE'); await page.waitForTimeout(1300); await page.keyboard.up('KeyE'); await page.waitForTimeout(200);
ok(await G("return m.players[0].body.type === 'ghost'"), 'holding E releases the body back to a ghost');
// trap possession
await G(`const w = m.world, me = m.players[0]; const hh = m.heroActor(); const tr = w.addProp({ kind: 'trap', trap: 'spikes', x: hh.x - 1.5, y: hh.y, dir: 0, room: hh.room }); window.__trap = !!tr; if (tr) { me.body.x = tr.x; me.body.y = tr.y; } g.fastForward(0.1);`);
if (await G('return window.__trap')) {
  await page.keyboard.press('KeyE'); await page.waitForTimeout(300);
  ok(await G("return m.players[0].body.type === 'trapctl'"), 'E on a trap possesses it');
  await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up();
  ok(await G("const t = m.players[0].body.trap; return t.state !== 'idle'"), 'attack triggers the trap');
  await page.screenshot({ path: '/tmp/claude-0/shots/e2e_trap.png' });
} else ok(true, '(no trap on this floor to possess)');
// killing blow takes the crown
await G(`const me = m.players[0]; if (me.body.type === 'trapctl') { me.body.trap.owner = null; } const hero = m.heroActor(); hero.hp = 1; hero.invuln = 0; const { dealDamage } = window.__combat || {}; hero.lastHit = { player: me, t: m.world.time, kind: 'test' }; hero.hp = 0; m.onActorDeath(m.world, hero, { player: me, actor: null, kind: 'test' }, {}); g.fastForward(2);`);
ok(await G('return m.heroPlayer === m.players[0]'), 'landing the killing blow makes the human the new Hero');
ok(await G("return m.players[0].body.type === 'hero'"), 'and they now control a hero body');
console.log(logs.join('\n') || 'no console errors');
await browser.close(); srv.close(); process.exit(fails || logs.length ? 1 : 0);
