// Headless physics checks for thrown / shot objects: arcs, bounces, rolling, rest, wall reflection, height-aware hits,
// ballistic aiming of thrown props, and the same result at 30 Hz and 60 Hz.
import { Match } from '../src/match.js';
import { spawnProj, updateProjs, spawnMonster, PROJ, lobSolution, autoLob } from '../src/combat.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else if (process.env.V) console.log('ok   ' + m); };
function room(seed = 3) {
  const m = new Match({ seed, headless: true }); m.startOpening();
  const w = m.world; w.actors.length = 0; w.props.length = 0; w.pickups.length = 0; w.projs.length = 0; return { m, w, r: w.rooms[0] };
}
const shooter = (w, x, y) => ({ x, y, r: 0.2, h: 1, team: 'ghost', player: null, st: {}, dmgMul: 1, type: 'monster' });
function fly(w, p, hz, maxT = 6, onStep) { const dt = 1 / hz; const log = []; for (let t = 0; t < maxT && !p.dead; t += dt) { updateProjs(w, dt); log.push({ t, x: p.x, y: p.y, z: p.z, vz: p.vz, rolling: p.rolling, rest: p.rest }); if (onStep) onStep(p, t); } return log; }

{ // 1) an arrow arcs: rises above its launch height, then falls; at its reference range it is back near launch height
  const { w, r } = room(); const a = shooter(w, r.x + 2, r.y + 7);
  const p = spawnProj(w, a, 'arrow', 0, 12, 8); const z0 = p.z; const L = fly(w, p, 60, 2);
  ok(Math.max(...L.map((s) => s.z)) > z0 + 0.03, 'arrow rises above its launch height (lob)');
  ok(Math.max(...L.map((s) => s.z)) <= 0.93, 'arrow arc stays under the ceiling');
  const at9 = L.find((s) => s.x - (r.x + 2) >= 9 * 0.999); ok(at9 && Math.abs(at9.z - z0) < 0.12, 'arrow crosses launch height near the 9-unit reference range (z=' + (at9 && at9.z.toFixed(2)) + ')');
}
{ // 2) a stone dropped from height bounces lower each time, then rolls and rests
  const { w, r } = room(); const a = shooter(w, r.x + 2, r.y + 7);
  const p = spawnProj(w, a, 'stone', 0, 3, 5, { vz: 0 }); p.z = 0.9; p.life = 10;
  const peaks = []; let prevVz = 0, bounces = 0;
  const L = fly(w, p, 60, 10, (q) => { if (q.vz > 0 && prevVz <= 0) bounces++; if (q.vz < 0 && prevVz >= 0 && bounces > 0) peaks.push(q.z); prevVz = q.vz; });
  ok(p.bounces >= 2, 'stone bounces at least twice (' + p.bounces + ')');
  ok(peaks.length >= 1 && peaks.every((v, i) => i === 0 || v < peaks[i - 1] + 1e-6), 'each bounce is lower than the last');
  ok(L.some((s) => s.rolling) || p.rest, 'stone ends up rolling / at rest');
  ok(p.rest || p.dead, 'stone comes to rest (does not bounce forever)');
  ok(p.x - (r.x + 2) < 6, 'stone does not fly forever (' + (p.x - (r.x + 2)).toFixed(1) + ' units)');
}
{ // 3) a pot shatters on the floor (does not bounce); a bone bounces
  const { w, r } = room(); const a = shooter(w, r.x + 2, r.y + 7); let shattered = 0;
  const pot = spawnProj(w, a, 'throwprop', 0, 4, 7, { vz: 0 }); pot.z = 0.6; fly(w, pot, 60, 3); shattered = pot.dead && pot.bounces === 0;
  ok(shattered, 'a pot shatters on first floor contact');
  const bone = spawnProj(w, a, 'throwbone', 0, 4, 7, { vz: 0 }); bone.z = 0.9; fly(w, bone, 60, 3, () => {}); ok(bone.bounces >= 1, 'a bone bounces');
}
{ // 4) walls: bouncers reflect with less speed, arrows stick (die)
  const { w, r } = room(); const a = shooter(w, r.x + 10, r.y + 7);
  const s = spawnProj(w, a, 'stone', 0, 8, 5); s.life = 5; const vx0 = s.vx; let flipped = false;
  fly(w, s, 60, 3, (q) => { if (q.vx < 0) flipped = true; });
  ok(flipped, 'a stone reflects off a wall'); ok(Math.abs(s.vx) < Math.abs(vx0) || s.rest || s.dead, 'and loses speed doing it');
  const ar = spawnProj(w, a, 'arrow', 0, 14, 5); fly(w, ar, 60, 2); ok(ar.dead, 'an arrow dies on a wall');
}
{ // 5) height-aware hits: a lob passes over a short target, a level shot hits it
  const hit = (z) => { const { m, w, r } = room(); const a = { ...shooter(w, r.x + 2, r.y + 7), team: 'hero', type: 'hero', player: m.players[0] };
    const t = spawnMonster(w, 'skeleton', 0, r.x + 8, r.y + 7, null, { ctl: 'ai' }); t.hp = t.maxHp = 100; const hp0 = t.hp;
    const p = spawnProj(w, a, 'throwprop', 0, 40, 7, { vz: 0 }); p.z = z; p.life = 4; fly(w, p, 60, 1); return hp0 - t.hp; }; // fast, so gravity barely bends the path over 6 units
  ok(hit(0.5) > 0, 'a shot at body height hurts a skeleton'); ok(hit(1.4) === 0, 'a shot above its head passes over');
}
{ // 6) ballistic lob: a pot thrown at a standing target lands on it, at several distances
  for (const d of [3, 6, 9]) {
    const { m, w, r } = room(); const h = m.players[0].body; w.actors.push(h); h.dead = false; h.x = r.x + 2 + d; h.y = r.y + 7; h.vx = h.vy = 0; h.invuln = 0; const hp0 = h.hp;
    const src = shooter(w, r.x + 2, r.y + 7); src.h = 0.7; const z0 = src.h * 0.6, def = PROJ.throwprop;
    const sol = lobSolution(def, src.x, src.y, z0, h.x, h.y, 0.5);
    const p = spawnProj(w, { ...src, player: m.players[1] }, 'throwprop', sol.ang, sol.speed, 7, { vz: sol.vz }); p.life = 4;
    let apex = 0; fly(w, p, 60, 3, (q) => { apex = Math.max(apex, q.z); });
    ok(h.hp < hp0, `thrown pot lands on a target ${d} units away`); ok(apex <= 0.96, `throw over ${d} units keeps under the ceiling (apex ${apex.toFixed(2)})`);
  }
}
{ // 7) same physics at 30 Hz and 60 Hz (fixed-step independence): apex and landing spot agree
  const run = (hz) => { const { w, r } = room(); const a = shooter(w, r.x + 2, r.y + 7); const p = spawnProj(w, a, 'knife', 0, 10, 5, { vz: 2.2 }); p.z = 0.5; p.life = 10; const L = fly(w, p, hz, 6); return { apex: Math.max(...L.map((s) => s.z)), x: p.x, b: p.bounces }; };
  const a = run(30), b = run(60);
  ok(Math.abs(a.apex - b.apex) < 0.06, `apex agrees at 30/60 Hz (${a.apex.toFixed(2)} vs ${b.apex.toFixed(2)})`);
  ok(Math.abs(a.x - b.x) < 0.8, `landing spot agrees at 30/60 Hz (${a.x.toFixed(1)} vs ${b.x.toFixed(1)})`);
}
{ // 8) determinism and no tunnelling through thin walls at low frame rate
  const once = () => { const { w, r } = room(); const a = shooter(w, r.x + 2, r.y + 7); const p = spawnProj(w, a, 'bolt', 0.3, 16, 5); fly(w, p, 30, 3); return [p.x.toFixed(4), p.y.toFixed(4), p.z.toFixed(4), p.bounces].join('|'); };
  ok(once() === once(), 'identical inputs give identical results');
  const { w, r } = room(); const a = shooter(w, r.x + 13, r.y + 7); const p = spawnProj(w, a, 'bolt', 0, 40, 5); p.life = 3; fly(w, p, 30, 1);
  ok(p.x < r.x + r.w + 1.2, 'a very fast bolt at 30 Hz does not tunnel out through the wall');
}
{ // 9) a missed hero knife ends up as a pickup you can collect
  const { m, w, r } = room(); const h = m.players[0].body; w.actors.push(h); h.dead = false; h.x = r.x + 2; h.y = r.y + 7;
  const p = spawnProj(w, h, 'knife', 0, 6, 5, { vz: 0 }); p.z = 0.4; p.life = 8; fly(w, p, 60, 8);
  ok(w.pickups.some((k) => k.kind === 'knife'), 'a missed throwing knife becomes a pickup after it settles');
}
console.log(fails ? `physics: ${fails} problem(s)` : 'physics: all checks passed'); process.exit(fails ? 1 : 0);
