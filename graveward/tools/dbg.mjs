import { Match } from '../src/match.js';
const T = +(process.argv[2] || 200), seed = +(process.argv[3] || 1);
const m = new Match({ seed, floors: 5, botSkill: 'normal', headless: true, players: [{}, {}, {}, {}] });
m.startOpening();
while (m.time < T && m.phase !== 'end') m.update(1 / 30);
const w = m.world, h = m.heroActor();
console.log('phase', m.phase, 'floor', m.floorIndex, 'time', m.time | 0, 'hero', m.heroPlayer && m.heroPlayer.name);
if (h) {
  const room = w.rooms[h.room];
  console.log('hero', h.x.toFixed(1), h.y.toFixed(1), 'room', h.room, room && room.type, 'hp', h.hp | 0, 'lvl', h.hero.level, 'xp', h.hero.xp, 'gold', h.hero.gold);
  const br = m.heroPlayer.ai; console.log('goal', JSON.stringify(br.plan && Object.keys(br.plan)), 'nav', br.nav.path && br.nav.path.length, 'fails', br.nav.fails, 'intent', JSON.stringify({ f: br.I.fwd.toFixed(2), s: br.I.strafe.toFixed(2), a: br.I.aimAngle, atk: br.I.attack }));
  console.log('rooms:', w.rooms.map((r) => `${r.id}:${r.type}${r.entered ? 'E' : ''}${r.locked ? 'L' : ''}${r.cleared ? 'C' : ''}`).join(' '));
  if (room) console.log('roomState', JSON.stringify(m.roomState(w, room)), 'locked', room.locked);
}
console.log('actors', w.actors.filter((a) => !a.dead).map((a) => `${a.type}:${a.defId || ''}@${a.x.toFixed(0)},${a.y.toFixed(0)}${a.player ? '(' + a.player.name.slice(-1) + ')' : ''}`).join(' '));
for (const p of m.players) console.log(p.name, p.role, p.body && p.body.type, p.ghost.blood | 0, 'wrath', p.ghost.wrath | 0, 'ecto', p.ghost.ecto);
console.log('pickups', w.pickups.length, 'props pent', w.props.filter((p) => p.kind === 'pent').map((p) => (p.usedUp ? 'U' : '.') + p.room).join(' '));
if (h) {
  const room = w.rooms[h.room];
  console.log('crystals', room.crystals.map((c) => `${c.x},${c.y} alive=${c.prop.alive} hp=${c.prop.hp}`));
  const br = m.heroPlayer.ai;
  console.log('plan target', br.plan.target && (br.plan.target.type + ':' + (br.plan.target.defId || '') + ' dead=' + br.plan.target.dead), 'atkPhase', br.atkPhase, 'I', JSON.stringify(br.I));
  console.log('hero atk', h.atk && h.atk.ab.id, 'stun', h.st.stun, 'blocking', h.blocking, 'charge', h.charge, 'weapon', h.hero.weapons[h.hero.weaponIdx].id);
}
