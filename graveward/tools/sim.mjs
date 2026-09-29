// Headless bot-vs-bot simulation: node tools/sim.mjs [--matches N] [--seed S] [--minutes M] [--floors F] [--verbose]
import { Match } from '../src/match.js';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] === undefined || args[i + 1].startsWith('--') ? true : args[i + 1]) : d; };
const N = +opt('matches', 3), seed0 = +opt('seed', 1), maxMin = +opt('minutes', 60), floors = +opt('floors', 5), verbose = opt('verbose', false), dtv = 1 / +opt('hz', 30);
const skill = opt('skill', 'normal'), nplayers = +opt('players', 4);
let bad = 0; const results = [];
for (let m = 0; m < N; m++) {
  const seed = seed0 + m;
  const t0 = Date.now();
  let match, err = null, ticks = 0;
  try {
    match = new Match({ seed, floors, botSkill: skill, headless: true, players: Array.from({ length: nplayers }, () => ({ human: false })) });
    match.startOpening();
    let lastProgress = 0, lastXp = 0, lastKey = '';
    while (match.phase !== 'end' && match.time < maxMin * 60) {
      match.update(dtv); ticks++;
      if (match.time - lastProgress > 300) { // progress watchdog every 5 min
        lastProgress = match.time;
        const hp = match.heroPlayer; const key = hp ? hp.hero.level + ':' + hp.hero.xp + ':' + match.floorIndex + ':' + match.bossAttempts + match.phase + match.stats.swaps : match.phase;
        if (key === lastKey) { err = 'stalled at ' + key + ' t=' + Math.round(match.time); break; }
        lastKey = key;
      }
      if (verbose && ticks % 3600 === 0) console.log(`  t=${Math.round(match.time)} phase=${match.phase} floor=${match.floorIndex} hero=${match.heroPlayer && match.heroPlayer.name} L${match.heroPlayer && match.heroPlayer.hero.level}`);
    }
  } catch (e) { err = e.stack; }
  const ms = Date.now() - t0;
  const r = { seed, phase: match.phase, min: +(match.time / 60).toFixed(1), floor: match.floorIndex, swaps: match.stats.swaps, rooms: match.stats.roomsCleared, boss: match.bossAttempts, result: match.endInfo && match.endInfo.result, levels: match.players.map((p) => p.hero.level).join('/'), ms, err };
  r.counts = ['pentagram','traptrigger','statuewake','slimesummon','potion','buy','chestopen','spellcast','dodge','parry','block','levelup','propbreak','roomclear','heroswap','ankh','deathless','torchout','chandeliercrash','chain','frostnova'].map((k) => k + ':' + (match.counts[k] || 0)).join(' ');
  results.push(r); if (err || match.phase !== 'end') bad++;
  console.log(JSON.stringify(r)); if (verbose || N === 1) console.log('  ' + r.counts);
}
console.log(`done: ${N} matches, ${bad} problems`);
process.exit(bad ? 1 : 0);
