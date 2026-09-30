// Headless tutorial test: an autopilot plays every step, and we check that doors stay sealed until each step is done.
import { Match, emptyIntent } from '../src/match.js';
const seed = +(process.argv[2] || 5);
const m = new Match({ seed, headless: true, players: [{ human: true, godId: 'ossuar', name: 'You' }, { human: false }] });
m.labelFor = (p, a) => a.toUpperCase();
const p = m.players[0]; let I = emptyIntent(); p.pollIntent = () => I;
m.startTutorial();
const t = m.tut, w = m.world, DT = 1 / 60;
let fails = 0; const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL ' + msg); } else if (process.env.V) console.log('ok   ' + msg); };
const nav = { path: null, i: 0, tx: 0, ty: 0, age: 9 };
function walkTo(x, y, stop = 0.5) {
  const b = p.body, d = Math.hypot(x - b.x, y - b.y); if (d < stop) return true;
  nav.age += DT;
  if (!nav.path || Math.hypot(x - nav.tx, y - nav.ty) > 1 || nav.age > 0.5) { nav.path = w.path(b.x, b.y, x, y, { passDoors: true }) || [[x, y]]; nav.i = 0; nav.tx = x; nav.ty = y; nav.age = 0; }
  while (nav.i < nav.path.length - 1 && Math.hypot(nav.path[nav.i][0] - b.x, nav.path[nav.i][1] - b.y) < 0.5) nav.i++;
  const [px, py] = nav.path[nav.i]; const ang = Math.atan2(py - b.y, px - b.x);
  if (b.type === 'hero') I.aimAngle = ang; else b.angle = ang;
  I.fwd = 1; return false;
}
const face = (x, y) => { const b = p.body; const ang = Math.atan2(y - b.y, x - b.x); if (b.type === 'hero') I.aimAngle = ang; else b.angle = ang; };
const nearest = (f) => { const b = p.body; let best = null, bd = 1e9; for (const a of w.actors) if (f(a)) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < bd) { bd = d; best = a; } } return best; };
const R = (n) => t.spec.rooms[n];
const seen = [];
function act(step) {
  const b = p.body; if (!b) return;
  switch (step.id) {
    case 'look': I.turnRate = 3; break;
    case 'move': (Math.floor(t.stepT / 1.0) % 2 === 0) ? (I.fwd = 1) : (I.strafe = 1); break;
    case 'smash': { const pr = w.props.filter((q) => q.alive && q.kind === 'scenery' && q.destructible).sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0]; if (pr) { face(pr.x, pr.y); if (Math.hypot(pr.x - b.x, pr.y - b.y) > 1.0) I.fwd = 1; I.attack = true; } break; }
    case 'gold': { const g = w.pickups.filter((q) => !q.dead && q.kind === 'gold')[0]; if (g) walkTo(g.x, g.y, 0.2); break; }
    case 'kill': case 'block': { const mo = nearest((a) => a.type === 'monster' && !a.dead); if (mo) { face(mo.x, mo.y); const d = Math.hypot(mo.x - b.x, mo.y - b.y); if (step.id === 'kill') { if (d > 1.2) I.fwd = 1; I.attack = true; } else { I.alt = true; if (d > 2.5) I.fwd = 1; } } break; }
    case 'heavy': { const c = t.stepT % 1.6; if (c < 0.6) I.attack = true; else if (c < 0.63) I.attackReleased = true; break; }
    case 'dodge': I.fwd = 1; I.dodge = true; break;
    case 'potion': I.potion = true; break;
    case 'spell': I.spell = true; break;
    case 'chest': { const c = R(5).chests[0]; walkTo(c.x, c.y + 1.0, 0.3); if (Math.hypot(c.x - b.x, c.y - b.y) < 1.5) { face(c.x, c.y); I.interact = true; } break; }
    case 'shop': { const s = R(5).shop.find((q) => q.prop && !q.prop.sold); if (s) { walkTo(s.x - 1.0, s.y, 0.3); if (Math.hypot(s.x - b.x, s.y - b.y) < 1.5) { face(s.x, s.y); I.interact = true; } } break; }
    case 'ghostmove': { const pe = R(6).pentagrams[0]; walkTo(pe.x, pe.y, 0.3); break; }
    case 'possess': I.interact = true; break;
    case 'attack': { const d = t.dummy; walkTo(d.x, d.y, 1.0); face(d.x, d.y); I.attack = true; I.attackPressed = true; break; }
    default:
      if (/^enter/.test(step.id)) { const n = +step.id.slice(5); const prevR = R(n - 1), door = t.spec.doors[n - 1]; if (!t.inRoom(n)) { if (door.locked) { walkTo(prevR.x + 8, prevR.y + 4.5, 0.5); } else walkTo(R(n).x + 3, R(n).y + 4.5, 0.6); } }
  }
}
// gate test on a fresh match: with the smash step active, push against sealed door 1 and make sure we stay in room 1
{
  const m2 = new Match({ seed, headless: true, players: [{ human: true, godId: 'ossuar' }, { human: false }] });
  const p2 = m2.players[0]; let J = emptyIntent(); p2.pollIntent = () => J; m2.startTutorial();
  const t2 = m2.tut; while (t2.step.id !== 'smash') t2.skip();
  const d1 = t2.spec.doors[1], r1 = t2.spec.rooms[1], b2 = p2.body;
  b2.x = r1.x + 10.5; b2.y = d1.y + 0.5; b2.angle = 0;
  for (let i = 0; i < 240; i++) { J = emptyIntent(); J.fwd = 1; m2.update(DT); }
  ok(b2.x < d1.x, 'cannot walk through sealed door 1 (x=' + b2.x.toFixed(2) + ' door=' + d1.x + ')');
  ok(t2.step.id === 'smash', 'still on the smash step after pushing on the door');
  // dying does not end the tutorial
  b2.hp = 1; b2.dead = false; m2.onActorDeath(m2.world, b2, null, {});
  ok(!b2.dead && b2.hp > 1, 'learner cannot die');
}
let guardTested = false, ticks = 0, lastId = null, idT = 0;
while (!t.done && ticks < 60 * 60 * 6) {
  const step = t.step;
  if (step && step.id !== lastId) { lastId = step.id; idT = 0; if (process.env.V) console.log('step ' + step.id + ' @' + (ticks / 60).toFixed(1) + 's'); I = emptyIntent(); nav.path = null; }
  idT += DT;
  // gate test: while 'smash' is active, door 1 must be sealed even if we push against it
  if (step && step.id === 'smash' && !guardTested) { guardTested = true; const d = t.spec.doors[1]; ok(d.locked, 'door 1 sealed during smash step'); }
  const fresh = emptyIntent(); fresh.aimAngle = I.aimAngle; I = fresh;
  if (step && t.wait <= 0) act(step);
  m.update(DT); ticks++;
  if (idT > 90) { console.log('FAIL step "' + step.id + '" stuck > 90s; pos ' + p.body.x.toFixed(1) + ',' + p.body.y.toFixed(1) + ' type ' + p.body.type); fails++; break; }
  if (t.step && t.step.id === 'ghostmove' && !p.body.type === 'ghost') fails++;
}
ok(t.done, 'tutorial finished');
ok(t.spec.doors.every((d) => !d.locked), 'all doors unlocked at the end');
console.log(`tutorial seed ${seed}: ${fails ? fails + ' problems' : 'ok'} in ${(ticks / 60).toFixed(0)}s game time`);
process.exit(fails ? 1 : 0);
