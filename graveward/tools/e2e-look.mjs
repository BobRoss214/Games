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
  const a1 = await ang(p); await p.mouse.move(480, 270); await p.waitForTimeout(400); const a2 = await ang(p);
  ok(Math.abs(dAng(a1, a2)) < 0.25, 'cursor in the middle does not turn');
  await p.mouse.move(8, 270); await p.waitForTimeout(600);
  ok(dAng(a2, await ang(p)) < -0.8, 'cursor at the left edge turns left');
  await p.evaluate(() => { window.graveward.settings.edgeLook = false; }); const a3 = await ang(p); await p.mouse.move(950, 270); await p.waitForTimeout(500);
  ok(Math.abs(dAng(a3, await ang(p))) < 0.05, 'edge look can be switched off in Options');
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
console.log(logs.join('\n') || 'no console errors'); if (logs.length) fails++;
await browser.close(); srv.close(); process.exit(fails ? 1 : 0);
