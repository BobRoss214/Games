// Browser e2e: turning works three ways while moving: mouse (captured), arrow keys, and cursor at the screen edges (no pointer lock).
import { serve, launch } from './shot.mjs';
const srv = await serve(); const port = srv.address().port;
const browser = await launch(); const logs = []; let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const open = async (query) => {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', (e) => logs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html?auto=1&humans=1&players=2&debug=1&seed=4${query}`); await page.waitForFunction('window.graveward && window.graveward.match'); await page.waitForTimeout(700);
  return page;
};
const ang = (page) => page.evaluate(() => window.graveward.match.players[0].body.angle);
const dAng = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
{ // 1) arrow keys, while holding W
  const p = await open(''); const a0 = await ang(p);
  await p.keyboard.down('KeyW'); await p.keyboard.down('ArrowRight'); await p.waitForTimeout(500); await p.keyboard.up('ArrowRight'); await p.keyboard.up('KeyW');
  const d = dAng(a0, await ang(p)); ok(d > 0.8, 'ArrowRight turns right while walking (' + d.toFixed(2) + ' rad)');
  const a1 = await ang(p); await p.keyboard.down('KeyW'); await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(500); await p.keyboard.up('ArrowLeft'); await p.keyboard.up('KeyW');
  ok(dAng(a1, await ang(p)) < -0.8, 'ArrowLeft turns left while walking');
  await p.close();
}
{ // 2) cursor at the screen edges (pointer not captured), while holding W
  const p = await open(''); const a0 = await ang(p);
  await p.mouse.move(470, 270); await p.keyboard.down('KeyW'); await p.mouse.move(950, 270); await p.waitForTimeout(600); await p.keyboard.up('KeyW');
  ok(dAng(a0, await ang(p)) > 0.8, 'cursor at the right edge turns right while walking');
  const a1 = await ang(p); await p.mouse.move(480, 270); await p.waitForTimeout(250); const a1b = await ang(p); await p.waitForTimeout(400); const a2 = await ang(p);
  ok(Math.abs(dAng(a1b, a2)) < 0.05, 'a resting cursor in the middle does not turn');
  await p.mouse.move(8, 270); await p.waitForTimeout(600);
  ok(dAng(a2, await ang(p)) < -0.8, 'cursor at the left edge turns left');
  await p.evaluate(() => { window.graveward.settings.edgeLook = false; }); const a3 = await ang(p); await p.mouse.move(950, 270); await p.waitForTimeout(500);
  ok(Math.abs(dAng(a3, await ang(p))) < 0.05, 'edge look can be switched off in Options');
  await p.close();
}
{ // 2c) the real-world case: the game sits in a sandboxed iframe that blocks pointer lock. Plain mouse movement must turn the camera while walking.
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => logs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/tools/blank.html`).catch(() => {});
  await page.setContent(`<body style="margin:0;background:#000"><iframe id="f" sandbox="allow-scripts allow-same-origin" style="border:0;width:960px;height:540px" src="http://127.0.0.1:${port}/index.html?auto=1&humans=1&players=2&debug=1&seed=4"></iframe></body>`);
  const fr = page.frames().find((f) => f.url().includes('index.html')); await fr.waitForFunction('window.graveward && window.graveward.match'); await page.waitForTimeout(700);
  const fang = () => fr.evaluate(() => window.graveward.match.players[0].body.angle);
  await page.mouse.click(480, 270); await page.waitForTimeout(300);
  ok(!(await fr.evaluate(() => window.graveward.input.locked)), 'pointer lock is blocked in the sandboxed frame (test setup)');
  await page.mouse.move(400, 270); await page.waitForTimeout(300); const a0 = await fang(); await page.keyboard.down('KeyW'); await page.mouse.move(520, 270, { steps: 12 }); await page.waitForTimeout(300); await page.keyboard.up('KeyW');
  ok(dAng(a0, await fang()) > 0.15, 'plain mouse movement turns right while walking, with no pointer lock (' + dAng(a0, await fang()).toFixed(2) + ' rad)');
  const a1 = await fang(); await page.keyboard.down('KeyD'); await page.mouse.move(400, 270, { steps: 12 }); await page.waitForTimeout(300); await page.keyboard.up('KeyD');
  ok(dAng(a1, await fang()) < -0.15, 'and turns left while strafing');
  await page.close();
}
{ // 2d) auto-walk (F) keeps walking with no key held, so a touchpad can be used; S stops it
  const p = await open(''); const pos = () => p.evaluate(() => { const b = window.graveward.match.players[0].body; return [b.x, b.y]; });
  await p.keyboard.press('KeyF'); await p.waitForTimeout(200); const q0 = await pos(); await p.waitForTimeout(700); const q1 = await pos();
  ok(Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) > 0.8, 'F auto-walks with no key held');
  const a0 = await ang(p); await p.keyboard.down('ArrowRight'); await p.waitForTimeout(400); await p.keyboard.up('ArrowRight'); ok(dAng(a0, await ang(p)) > 0.6, 'turning works while auto-walking');
  await p.keyboard.down('KeyS'); await p.waitForTimeout(100); await p.keyboard.up('KeyS'); await p.waitForTimeout(300);
  ok(!(await p.evaluate(() => window.graveward.match.players[0].input.isAuto())), 'S stops auto-walk');
  await p.keyboard.press('F3'); await p.waitForTimeout(150); ok(await p.evaluate(() => window.graveward.input.diag), 'F3 opens the input test'); await p.screenshot({ path: '/tmp/claude-0/shots/diag.png' });
  await p.close();
}
{ // 2b) a second player on Keyboard 2 owns the arrow keys: player 1 must not turn with them
  const p = await open(''); await p.evaluate(() => { window.graveward.input.kb2InUse = true; }); const a0 = await ang(p);
  await p.keyboard.down('ArrowRight'); await p.waitForTimeout(500); await p.keyboard.up('ArrowRight');
  ok(Math.abs(dAng(a0, await ang(p))) < 0.05, 'arrow keys do not turn player 1 when Keyboard 2 is in use'); await p.close();
}
{ // 3) captured mouse: edge look must stay off (the cursor is hidden and pinned)
  const p = await open(''); await p.evaluate(() => { const g = window.graveward; g.input.locked = true; g.input.mx = 0.98; g.input.mouseIn = true; });
  const a0 = await ang(p); await p.waitForTimeout(500); ok(Math.abs(dAng(a0, await ang(p))) < 0.05, 'edge look is off while the mouse is captured');
  await p.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 120, movementY: 0 }))); await p.waitForTimeout(150);
  ok(dAng(a0, await ang(p)) > 0.15, 'captured mouse movement still turns the camera'); await p.close();
}
{ // 4) fast monitors: many display frames with NO simulation step in between must not drop mouse turning or button presses
  const p = await open('');
  const r = await p.evaluate(async () => {
    const g = window.graveward, me = g.match.players[0].body; g.input.locked = true; await new Promise((res) => setTimeout(res, 300));
    const a0 = me.angle, real = g.frameStep; g.frameStep = () => {};
    for (let i = 0; i < 100; i++) { document.dispatchEvent(new MouseEvent('mousemove', { movementX: 2 })); g.acc = 0; real.call(g); }
    // a potion tap (down + up) that happens entirely inside frames with no simulation step
    const h = g.match.players[0].hero, potions0 = (h.potions.health || 0);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' })); g.acc = 0; real.call(g); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ' })); g.acc = 0; real.call(g);
    for (let i = 0; i < 6; i++) { g.last -= 20; real.call(g); } g.frameStep = real;
    return { turned: me.angle - a0, potionsUsed: potions0 - (h.potions.health || 0) };
  });
  ok(Math.abs(r.turned - 0.48) < 0.05, 'mouse turning survives frames with no simulation step (' + r.turned.toFixed(3) + ' of 0.480 rad)');
  ok(r.potionsUsed === 1, 'a button tap inside frames with no simulation step still fires, exactly once (' + r.potionsUsed + ')');
  await p.close();
}
{ // 5) pressing menu keys while paused must not fire in the game after resuming
  const p = await open(''); await p.keyboard.press('Tab'); await p.waitForTimeout(200);
  await p.keyboard.press('Space'); await p.keyboard.press('KeyQ'); await p.waitForTimeout(200);
  const before = await p.evaluate(() => window.graveward.match.players[0].hero.potions.health || 0);
  await p.evaluate(() => window.graveward.resume()); await p.waitForTimeout(400);
  ok((await p.evaluate(() => window.graveward.match.players[0].hero.potions.health || 0)) === before, 'keys pressed while paused do not fire after resume'); await p.close();
}
console.log(logs.join('\n') || 'no console errors'); if (logs.length) fails++;
await browser.close(); srv.close(); process.exit(fails ? 1 : 0);
