// Plays every synthesized SFX and each music mode in a real browser AudioContext; asserts no errors and that audio graph is alive.
import { serve, launch } from './shot.mjs';
const srv = await serve(); const port = srv.address().port;
const browser = await launch(); const page = await browser.newPage();
const logs = []; page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', (e) => logs.push(e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?debug=1`); await page.waitForFunction('window.graveward');
const res = await page.evaluate(async () => {
  const g = window.graveward; g.sound.resume(); await new Promise((r) => setTimeout(r, 300));
  const mod = await import('/src/audio.js'); const names = Object.keys(mod.SFX);
  const out = { ok: g.sound.ok, state: g.sound.ctx && g.sound.ctx.state, names: names.length, errors: [] };
  for (const n of names) { try { g.sound.lastPlay.clear(); g.sound.play(n, undefined, undefined, 1); } catch (e) { out.errors.push(n + ': ' + e.message); } }
  for (const mode of ['menu', 'explore', 'combat', 'boss', 'victory', 'defeat']) { try { g.sound.setMode(mode, 2); g.sound.setIntensity(0.8); await new Promise((r) => setTimeout(r, 250)); } catch (e) { out.errors.push('music ' + mode + ': ' + e.message); } }
  out.active = g.sound.active; out.time = g.sound.ctx.currentTime;
  return out;
});
console.log(JSON.stringify(res));
console.log(logs.join('\n') || 'no console errors');
await browser.close(); srv.close();
process.exit(res.ok && !res.errors.length && !logs.length ? 0 : 1);
