import { Match } from '../src/match.js';
const T = +(process.argv[2] || 300), seed = +(process.argv[3] || 1), every = +(process.argv[4] || 15);
const m = new Match({ seed, floors: 5, botSkill: process.env.SK || 'normal', headless: true, players: Array.from({ length: +(process.env.PL || 4) }, () => ({})) });
m.startOpening();
let next = 0;
while (m.time < T && m.phase !== 'end') {
  m.update(1 / 30);
  if (m.time >= next) {
    next += every;
    const w = m.world, h = m.heroActor();
    const mons = w.actors.filter((a) => !a.dead && a.type === 'monster').length;
    const bodies = m.players.map((p) => p.role[0] + ':' + (p.body ? p.body.type[0] + (p.body.defId ? '.' + p.body.defId.slice(0, 4) : '') : '-')).join(' ');
    if (h) { const r = w.rooms[h.room]; console.log(`${m.time.toFixed(0).padStart(4)}s F${m.floorIndex} ${m.heroPlayer.name} L${h.hero.level} xp${h.hero.xp} hp${h.hp | 0}/${h.maxHp | 0} room ${h.room}${r ? r.type[0] + (r.locked ? 'L' : '') : ''} mons${mons} sw${m.stats.swaps} cl${m.stats.roomsCleared} | ${bodies}`); }
    else console.log(`${m.time.toFixed(0).padStart(4)}s phase ${m.phase} ${bodies}`);
  }
}
