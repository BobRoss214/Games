// Match: the game director. Players, phases, role swap, room locking, progression, boss flow.
import { RNG, clamp, dist, dist2, TAU, hashSeed, seedGlobal } from './util.js';
import { GODS, GOD_IDS, MONSTERS, XP_TABLE, EVOLVE_COST, BOSSES, BOSS_IDS, themesForFloors, MAX_LEVEL } from './data.js';
import { DECAL } from './textures.js';
import { World, newId } from './world.js';
import { generateFloor, buildOpeningRoom, buildBossMap } from './dungeon.js';
import { newHeroRecord, spawnHero, heroControl, grantXp, applyLevelUp, refreshHeroStats, giveItem } from './hero.js';
import { spawnGhost, ghostControl, trapControl, monsterControl, updateTraps, updateProps, destroyProp, usePentagram, rosterFor } from './ghost.js';
import { updateStatus, updateProjs, updateHazards, updatePickups, spawnPickup, spawnMonster, dealDamage, hostile, spawnHazard } from './combat.js';
import { Boss } from './boss.js';
import { BotBrain, monsterAI } from './ai.js';

export const emptyIntent = () => ({
  fwd: 0, strafe: 0, turn: 0, turnRate: 0, interactHeld: false, attack: false, attackPressed: false, attackReleased: false, alt: false, altPressed: false, dodge: false, interact: false,
  spell: false, spellNext: false, potion: false, potionNext: false, swap: false, sprint: false, ability2: false, aimAngle: undefined, menu: 0,
});

const PLAYER_COLORS = ['#e0463c', '#3c8ae0', '#3cc060', '#d8b030'];

export class Match {
  constructor(opts) {
    this.opts = Object.assign({ seed: 1, floors: 5, botSkill: 'normal', headless: false, gore: 2 }, opts);
    this.headless = this.opts.headless;
    this.seed = this.opts.seed >>> 0;
    this.rng = new RNG(this.seed ^ 0x51ed);
    seedGlobal(this.seed * 2654435761);
    this.players = [];
    this.phase = 'setup';
    this.time = 0; this.phaseT = 0;
    this.world = null; this.floorWorld = null;
    this.heroPlayer = null;
    this.floorIndex = 0; this.bossAttempts = 0; this.bossId = null;
    this.toasts = []; this.feed = [];
    this.counts = {};
    this.stats = { swaps: 0, chests: 0, roomsCleared: 0, floors: 0, bossFights: 0, heroDeaths: 0 };
    this.themeOrder = themesForFloors(this.opts.floors);
    this.endInfo = null;
    this.upgradeT = 0;
    this.pendingSwap = null;
    this.banner = null;
    const list = this.opts.players || [{ human: false }, { human: false }, { human: false }, { human: false }];
    list.forEach((cfg, i) => this.addPlayer(cfg, i));
  }

  addPlayer(cfg, i) {
    const god = cfg.godId || GOD_IDS[(i + (this.rng.int(0, 2))) % 3];
    const p = {
      idx: i, name: cfg.name || (cfg.human ? 'Player ' + (i + 1) : 'Bot ' + (i + 1)), color: PLAYER_COLORS[i % 4], human: !!cfg.human, godId: god, role: 'ghost',
      hero: newHeroRecord(this.rng), ghost: { ecto: 0, blood: 0, wrath: 0, tiers: [0, 0, 0], kills: 0, ectoT: 0 }, body: null, ghostForm: null,
      intent: emptyIntent(), ai: null, pollIntent: null, toasts: [], upgradeReady: false, ranks: 0,
      stats: { heroKills: 0, monsterKills: 0, heroTime: 0, heroCount: 0, damageToHero: 0, killingBlows: 0 }, device: cfg.device || null,
    };
    if (!p.human) p.ai = new BotBrain(p, this.opts.botSkill, this.rng.fork(i + 11));
    this.players.push(p);
    return p;
  }

  // ---------------- helpers ----------------
  heroActor() { const hp = this.heroPlayer; return hp && hp.body && hp.body.type === 'hero' && !hp.body.dead ? hp.body : null; }
  heroLevel() { return this.heroPlayer ? this.heroPlayer.hero.level : 1; }
  avgTier(p) { return (p.ghost.tiers[0] + p.ghost.tiers[1] + p.ghost.tiers[2]) / 3; }
  toast(text, color = '#e8dcc0') { this.feed.unshift({ text, color, t: 0 }); if (this.feed.length > 6) this.feed.pop(); }
  toastFor(p, text, color, dur) { p.toasts.unshift({ text, color: color || '#e8dcc0', t: 0, dur: dur || 4.5 }); if (p.toasts.length > 3) p.toasts.pop(); }
  key(p, act) { return this.labelFor ? this.labelFor(p, act) : act.toUpperCase(); }
  hint(p, id, text, dur = 8) { if (!p.human || (p.hints && p.hints[id])) return; (p.hints || (p.hints = {}))[id] = 1; this.toastFor(p, text, '#a8d8ff', dur); }
  setBanner(text, sub, color, dur = 2.4) { this.banner = { text, sub, color: color || '#e0463c', t: 0, dur }; }
  addBlood(p, amt) {
    const crown = this.heroPlayer && this.heroPlayer.hero.artifacts.includes('crown') ? 1.6 : 1;
    p.ghost.blood += amt * 0.5 * crown; p.stats.damageToHero += amt;
  }

  // ---------------- phases ----------------
  startOpening() {
    this.phase = 'opening'; this.phaseT = 0;
    const spec = buildOpeningRoom(this.seed);
    const w = this.world = new World(this, spec, 'opening', this.seed + 5);
    this.players.forEach((p, i) => {
      p.role = 'hero'; p.hero = newHeroRecord(this.rng);
      const s = spec.spawns[i % 4];
      const h = spawnHero(w, p, s[0], s[1], s[2], 1, { ffa: true, invuln: 1.5 });
      p.body = h; p.ghostForm = null;
    });
    this.heroPlayer = null;
    this.suddenRing = 0; this.suddenT = 0;
    this.setBanner('THE ANTECHAMBER', 'Last one standing becomes the Hero', '#c02020', 3.5);
    this.toast('Free-for-all! Kill everyone else.');
  }

  startFloor(index) {
    this.phase = 'floor'; this.phaseT = 0; this.floorIndex = index;
    const theme = this.themeOrder[index % this.themeOrder.length];
    const spec = generateFloor(this.seed, index, theme);
    spec.floorIndex = index;
    const w = this.world = new World(this, spec, 'floor', this.seed * 3 + index * 17 + 1);
    w.depth = index;
    const start = spec.start;
    const hp = this.heroPlayer;
    // restore hero
    if (hp.body && !hp.body.removed && !hp.body.dead && hp.body.type === 'hero') hp.body.removed = true;
    const hero = spawnHero(w, hp, start.cx + 0.5, start.cy + 0.5, 0, hp.heroHpFrac || 1, { invuln: 1.5 });
    hero.hp = Math.max(hero.hp, hero.maxHp * (hp.heroHpFrac || 1)); hp.body = hero;
    this.placeGhosts(w, hero);
    for (const p of this.players) { p.upgradeReady = false; }
    this.stats.floors++;
    for (const q of this.players) {
      if (q === hp) { this.hint(q, 'move', `${this.key(q, 'move')} MOVE  -  ${this.key(q, 'attack')} SWING  -  ${this.key(q, 'interact')} INTERACT`); this.hint(q, 'rooms', 'KILL EVERYTHING IN A ROOM TO OPEN ITS DOORS. SMASH POTS FOR GOLD.'); }
      else this.hint(q, 'ghost1', `YOU ARE A GHOST. FLOAT TO A RED PENTAGRAM, PRESS ${this.key(q, 'interact')} TO BECOME A MONSTER.`, 10);
    }
    this.setBanner('FLOOR ' + (index + 1), spec.theme.name, '#d8b060', 3);
    this.toast('Floor ' + (index + 1) + ': ' + spec.theme.name);
    hero.ankhUsed = false;
    for (const r of spec.rooms) { r.locked = false; }
    w.emit('floorstart', { index });
  }

  placeGhosts(w, hero) {
    let k = 0;
    for (const p of this.players) {
      if (p === this.heroPlayer) continue;
      if (p.body && !p.body.removed && p.body.type !== 'ghost') p.body.removed = true;
      const ang = (k++ / 3) * TAU;
      const g = spawnGhost(w, p, hero.x + Math.cos(ang) * 3.2, hero.y + Math.sin(ang) * 3.2, ang + Math.PI); if (!w.canStand(g.x, g.y, g.r, true)) { g.x = hero.x + Math.cos(ang) * 1.5; g.y = hero.y + Math.sin(ang) * 1.5; }
      p.role = 'ghost';
      if (!w.canStand(g.x, g.y, g.r, true)) w.unstick(g);
    }
  }

  // ---------------- main update ----------------
  update(dt) {
    this.time += dt; this.phaseT += dt;
    for (const t of this.feed) t.t += dt;
    for (const p of this.players) for (const t of p.toasts) t.t += dt;
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.dur) this.banner = null; }
    switch (this.phase) {
      case 'opening': case 'floor': case 'boss': this.stepWorld(dt); break;
      case 'upgrade': this.stepUpgrade(dt); break;
      case 'end': if (this.world) this.world.time += dt; break;
      default: break;
    }
  }

  gatherIntent(p, dt) {
    if (p.human) return p.pollIntent ? p.pollIntent(dt) : p.intent;
    return p.ai.think(this, dt);
  }

  stepWorld(dt) {
    const w = this.world;
    if (this.pendingSwap) { this.pendingSwap.t -= dt; if (this.pendingSwap.t <= 0) { const s = this.pendingSwap; this.pendingSwap = null; this.doSwap(s.newP, s.oldP, s.x, s.y, s.angle); } }
    w.time += dt;
    w.map.updateDoors(dt);
    // intents for players
    const intents = new Map();
    for (const p of this.players) intents.set(p, this.gatherIntent(p, dt));
    // actor control
    const acts = w.actors.slice();
    for (const a of acts) {
      if (a.removed) continue;
      if (a.dead) { a.deadT += dt; if (a.deadT > (a.type === 'hero' ? 99 : 1.2) && a.type !== 'hero') this.finishDeath(w, a); continue; }
      const it = a.player && a.ctl === 'player' ? intents.get(a.player) : null;
      updateStatus(w, a, dt);
      if (a.dead) continue;
      switch (a.type) {
        case 'hero': heroControl(w, a, it || emptyIntent(), dt); this.heroTick(w, a, dt); break;
        case 'ghost': ghostControl(w, a, it || emptyIntent(), dt); break;
        case 'trapctl': trapControl(w, a, it || emptyIntent(), dt); break;
        case 'monster': case 'bosspart': {
          let intent = it;
          if (!intent) intent = monsterAI(this, w, a, dt);
          monsterControl(w, a, intent, dt);
          break;
        }
        default: break;
      }
      if (a.type !== 'ghost' && a.type !== 'trapctl') a.animT += dt;
    }
    if (this.world !== w) return; // world changed mid-tick (portal)
    // reset edge flags for human intents now consumed
    for (const p of this.players) if (p.human && p.consumeIntent) p.consumeIntent();
    updateProjs(w, dt); updateHazards(w, dt); updateTraps(w, dt); updateProps(w, dt); updatePickups(w, dt);
    this.doorLogic(w, dt);
    if (this.phase === 'opening') this.stepOpening(w, dt);
    else if (this.phase === 'floor') this.stepFloor(w, dt);
    else if (this.phase === 'boss') { if (w.boss) w.boss.update(dt); this.stepBossWorld(w, dt); }
    w.cleanup();
    if (this.headless) w.events.length = 0;
  }

  heroTick(w, a, dt) {
    a.player.stats.heroTime += dt;
    if (a.startle > 0) a.startle -= dt;
    a.room = (w.roomAt(a.x, a.y) || { id: -1 }).id;
    if (a.hero.level >= MAX_LEVEL && !a.player.reachedTen) { a.player.reachedTen = true; this.toast('Level 10! The portal calls...', '#5ad0ff'); this.setBanner('LEVEL 10', 'Find the portal room', '#5ad0ff', 2.5); }
    if (a.hp <= 0 && !a.dead) { /* handled by dealDamage */ }
  }

  // ---------------- doors ----------------
  doorLogic(w, dt) {
    const m = w.map;
    for (const d of m.doors) {
      let want = 0;
      if (!d.locked) {
        const cx = d.x + 0.5, cy = d.y + 0.5;
        for (const a of w.actors) {
          if (a.dead || a.type === 'ghost' || a.type === 'trapctl' || a.type === 'bosspart') continue;
          if (a.type === 'monster' && a.def && a.def.swarm) { /* swarm opens too */ }
          if (Math.abs(a.x - cx) < 1.35 && Math.abs(a.y - cy) < 1.35) { want = 1; break; }
        }
      }
      if (want) d.closeDelay = 0.8;
      else if (d.closeDelay > 0) { d.closeDelay -= dt; want = 1; }
      if (want === 0 && d.open > 0) {
        // do not crush actors standing in the door cell
        let occ = false; for (const a of w.actors) if (!a.dead && a.type !== 'ghost' && !a.ethereal && Math.abs(a.x - (d.x + 0.5)) < 0.7 && Math.abs(a.y - (d.y + 0.5)) < 0.7) { occ = true; break; }
        if (occ) want = 1;
      }
      d.target = want;
    }
  }

  lockRoom(w, room) {
    room.locked = true; room.lockT = 0;
    { const hh = this.heroPlayer; if (hh) this.hint(hh, 'lock', 'DOORS SEALED! DEFEAT EVERY MONSTER AND SMASH RED CRYSTALS TO ESCAPE.'); }
    for (const d of room.doors) { d.locked = true; w.map.setDoorTex(d, 12); }
    w.emit('roomlock', { room });
  }
  unlockRoom(w, room) {
    room.locked = false;
    for (const d of room.doors) { d.locked = false; w.map.setDoorTex(d, 11); }
    w.emit('roomunlock', { room });
  }

  roomState(w, room) {
    const pents = room.pentagrams.filter((p) => !p.prop.usedUp).length;
    const crystals = room.crystals.filter((c) => c.prop.alive).length;
    let mons = 0; for (const a of w.actors) if (a.type === 'monster' && !a.dead && a.room === room.id) mons++;
    return { pents, crystals, mons };
  }

  stepFloor(w, dt) {
    const hero = this.heroActor();
    if (!hero) return;
    for (const r of w.rooms) {
      if (r.type === 'store') continue;
      const inside = hero.room === r.id && this.deepInside(hero, r);
      const st = this.roomState(w, r);
      const cond = st.pents > 0 || st.crystals > 0 || st.mons > 0;
      if (!r.locked && inside && cond && hero.room === r.id) { this.lockRoom(w, r); r.visited = true; }
      if (r.locked && hero.room !== r.id) { r.awayT = (r.awayT || 0) + dt; if (r.awayT > 1.2) { r.awayT = 0; this.unlockRoom(w, r); } } else r.awayT = 0;
      if (r.locked) {
        r.lockT += dt;
        if (!cond) {
          this.unlockRoom(w, r);
          if (!r.cleared) { r.cleared = true; this.onRoomCleared(w, r, hero); }
        } else if (st.pents > 0 && r.lockT > 26) {
          r.autoT = (r.autoT || 0) + dt;
          if (r.autoT > 7) { r.autoT = 0; const pent = r.pentagrams.find((p) => !p.prop.usedUp); if (pent) { const m = usePentagram(w, this.fakePlayerForHollow(), null, pent.prop, 'hollow'); m.player = null; m.ctl = 'ai'; m.depthScale = true; m.room = r.id; } }
        }
      }
    }
    // trapdoor
    const ex = w.spec.exit;
    if (ex && ex.trapdoor) {
      const t = ex.trapdoor;
      if (Math.abs(hero.x - t.x) < 0.7 && Math.abs(hero.y - t.y) < 0.7) {
        const est = this.roomState(w, ex);
        if (!ex.locked && est.pents === 0 && est.crystals === 0 && est.mons === 0) this.useExit(hero);
        else if (!hero.exitMsg || hero.exitMsg < w.time) { hero.exitMsg = w.time + 3; this.toastFor(hero.player, 'The trapdoor is sealed. Clear the room.'); w.emit('sealed', { target: hero }); }
      }
    }
    // hero regen tick of ecto for ghosts handled in ghost
    this.trackHeroRoom(w, hero);
  }
  fakePlayerForHollow() { return { godId: 'ossuar', ghost: { tiers: [0, 0, 0] }, name: 'Hollow' }; }
  deepInside(hero, r) { return hero.x > r.x + 0.55 && hero.x < r.x + r.w - 0.55 && hero.y > r.y + 0.55 && hero.y < r.y + r.h - 0.55; }
  trackHeroRoom(w, hero) {
    if (hero.room !== hero.lastRoom) {
      hero.lastRoom = hero.room;
      const r = w.rooms[hero.room];
      if (r && !r.entered) { r.entered = true; if (r.type === 'store') this.toastFor(hero.player, 'Shop: safe zone. Ghosts cannot enter.', '#d8b060'); if (r.type === 'treasure') this.toastFor(hero.player, 'A treasure vault...', '#ffd060'); if (r.type === 'curse') this.toastFor(hero.player, 'A cursed chamber. Blood runs cold.', '#ff4040'); if (r.type === 'portal') this.toastFor(hero.player, hero.hero.level >= MAX_LEVEL ? 'The portal hums. Step in and press E.' : 'The portal is dormant until level 10.', '#5ad0ff'); }
    }
  }

  onRoomCleared(w, r, hero) {
    this.stats.roomsCleared++;
    const xp = 18 + r.pentagrams.length * 10 + w.depth * 4 + r.crystals.length * 6;
    grantXp(this, hero.player, xp);
    this.toastFor(hero.player, 'Room cleared! +' + xp + ' XP', '#80e080');
    if (hero.hero.artifacts.includes('canopic')) hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * 0.25);
    w.emit('roomclear', { room: r, target: hero });
    for (let i = 0; i < 2; i++) spawnPickup(w, 'gold', r.cx + 0.5 + this.rng.float(-1, 1), r.cy + 0.5 + this.rng.float(-1, 1), { amount: 5 + w.depth * 3 });
  }

  useExit(hero) {
    if (this.phase !== 'floor') return;
    const p = this.heroPlayer;
    p.heroHpFrac = hero.hp / hero.maxHp;
    this.phase = 'upgrade'; this.phaseT = 0; this.upgradeT = 50;
    this.upgradeData = { floor: this.floorIndex };
    for (const pl of this.players) { pl.upgradeReady = false; pl.upState = { sel: 0 }; }
    this.world.emit('descend', { target: hero });
    this.setBanner('DESCENDING', '', '#d8b060', 1.2);
    // bots decide right away
    for (const pl of this.players) if (!pl.human) { pl.ai.upgradeDecide(this); pl.upgradeReady = true; }
  }

  stepUpgrade(dt) {
    this.upgradeT -= dt;
    // wrath for all players: hero player also gets a little
    const allReady = this.players.every((p) => p.upgradeReady);
    if (this.upgradeT <= 0 || allReady) this.finishUpgrade();
  }
  canEvolve(p, idx) {
    const t = p.ghost.tiers[idx]; if (t >= 2) return false;
    const c = EVOLVE_COST[t + 1];
    return p.ghost.wrath >= c.wrath && p.ghost.blood >= c.blood;
  }
  evolve(p, idx) {
    if (!this.canEvolve(p, idx)) return false;
    const t = p.ghost.tiers[idx], c = EVOLVE_COST[t + 1];
    p.ghost.wrath -= c.wrath; p.ghost.blood -= c.blood * 0.4; p.ghost.tiers[idx] = t + 1; return true;
  }
  finishUpgrade() { this.startFloor(this.floorIndex + 1); }

  // ---------------- opening free-for-all ----------------
  stepOpening(w, dt) {
    if (this.phaseT < 2) return;
    const alive = w.actors.filter((a) => a.type === 'hero' && !a.dead);
    if (this.phaseT > 90) { // sudden death
      this.suddenT += dt;
      if (this.suddenT > 2.4 && this.suddenRing < 7) {
        this.suddenT = 0; this.suddenRing++;
        const r = w.rooms[0];
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
          const ring = Math.min(x - r.x, y - r.y, r.x + r.w - 1 - x, r.y + r.h - 1 - y);
          if (ring === this.suddenRing - 1) w.map.decal[y * w.map.w + x] = DECAL.spikePlate;
        }
        if (this.suddenRing === 1) { this.setBanner('SUDDEN DEATH', 'The floor closes in', '#ff3030', 3); this.toast('Sudden death! Spikes close in from the walls.'); }
        w.emit('suddendeath', {});
      }
      const r = w.rooms[0];
      for (const a of alive) {
        const ring = Math.min(a.x - r.x, a.y - r.y, r.x + r.w - a.x, r.y + r.h - a.y);
        if (ring < this.suddenRing && Math.floor(w.time * 2) !== a.sdTick) { a.sdTick = Math.floor(w.time * 2); dealDamage(w, a, 7 + this.suddenRing * 1.5, { actor: null, player: null, kind: 'env' }, { noKnock: true, bypassBlock: true, bypassInvuln: true, type: 'aoe' }); }
      }
    }
    if (!this.ffaDone && alive.length <= 1) {
      this.ffaDone = true;
      const winner = alive.length ? alive[0].player : (this.lastFfaDeath || this.players[0]);
      this.pendingFfa = { winner, t: 2.6 };
      this.setBanner(winner.name.toUpperCase(), 'is the first HERO', winner.color, 2.6);
    }
    if (this.pendingFfa) {
      this.pendingFfa.t -= dt;
      if (this.pendingFfa.t <= 0) { const wn = this.pendingFfa.winner; this.pendingFfa = null; this.beginRun(wn); }
    }
  }

  beginRun(winner) {
    this.heroPlayer = winner; winner.role = 'hero'; winner.stats.heroCount++;
    for (const p of this.players) { p.hero = newHeroRecord(this.rng); if (p !== winner) p.role = 'ghost'; p.body = null; p.ghostForm = null; }
    winner.heroHpFrac = 1;
    this.startFloor(0);
  }

  // ---------------- deaths ----------------
  onActorDeath(w, a, src, opts) {
    if (a.dead) return;
    a.dead = true; a.deadT = 0; a.anim = 'dead'; a.animT = 0;
    w.emit('death', { x: a.x, y: a.y, target: a, src, gib: (opts && opts.dot) ? false : true });
    if (a.type === 'hero') return this.onHeroDeath(w, a, src);
    if (a.type === 'bosspart') { if (w.boss) w.boss.onPartDeath(a, src); return; }
    if (a.type === 'monster') this.onMonsterDeath(w, a, src);
  }

  onMonsterDeath(w, a, src) {
    // release owner to ghost form
    const owner = a.player;
    if (owner && owner.body === a) { const g = spawnGhost(w, owner, a.x, a.y, a.angle); owner.body = g; this.toastFor(owner, 'Your ' + a.name + ' died.', '#b0a0d0'); }
    // credit
    const killer = src && src.player;
    if (killer && killer.role === 'hero' && this.phase === 'floor') {
      const ha = this.heroActor();
      grantXp(this, killer, Math.round(a.def.xp * (1 + a.tier * 0.5) * (a.xpMul || 1) * (1 + w.depth * 0.06)));
      killer.hero.kills++; killer.stats.monsterKills++;
      if (this.rng.chance(0.14) && ha) spawnPickup(w, 'heart', a.x, a.y, { amount: 12 });
    }
    if (a.def.gold && this.rng.chance(0.85)) spawnPickup(w, 'gold', a.x, a.y, { amount: Math.max(1, Math.round(a.def.gold * (0.7 + this.rng.next() * 0.6) * (1 + w.depth * 0.15))) });
    if (owner === null || owner === undefined) { /* hollow etc. */ }
    if (a.def.splits && !a.noSplit) {
      for (let i = 0; i < 2; i++) { const s = spawnMonster(w, 'slimelet', 0, a.x + this.rng.float(-0.4, 0.4), a.y + this.rng.float(-0.4, 0.4), a.player === undefined ? null : (a.player && a.player.role === 'ghost' ? a.player : null), { ctl: 'ai', depthScale: true, noPuff: true }); s.summoner = a.summoner; s.xpMul = 0.5; }
    }
    a.deathBurst = true;
  }

  finishDeath(w, a) {
    if (a.removed) return;
    a.removed = true;
    if (a.type === 'monster' || a.type === 'bosspart') {
      if (w.corpses.length > 90) w.corpses.shift();
      if (!a.exploded) w.corpses.push({ x: a.x, y: a.y, sprite: a.sprite, defId: a.defId, tier: a.tier, angle: a.angle, scale: a.scaleV || 1, id: a.id, tintHollow: a.def && a.def.tintHollow });
    }
  }

  onHeroDeath(w, hero, src) {
    const p = hero.player;
    this.stats.heroDeaths++;
    if (this.phase === 'opening') {
      p.role = 'ghost'; this.lastFfaDeath = p;
      const g = spawnGhost(w, p, hero.x, hero.y, hero.angle); p.body = g; p.spectator = true;
      this.toast((src && src.player ? src.player.name : 'The tomb') + ' killed ' + p.name + '.', '#c04040');
      return;
    }
    if (this.phase === 'boss') { this.bossFail(w, hero); return; }
    // find killer
    let killer = src && src.player && src.player !== p && src.player.role === 'ghost' ? src.player : null;
    if (!killer && hero.lastHit && hero.lastHit.player && hero.lastHit.player !== p && w.time - hero.lastHit.t < 10) killer = hero.lastHit.player;
    if (!killer) { const gs = this.players.filter((q) => q !== p).sort((a, b) => b.ghost.blood - a.ghost.blood); killer = gs[0]; }
    killer.stats.killingBlows++;
    // delay for drama
    this.pendingSwap = { newP: killer, oldP: p, x: hero.x, y: hero.y, angle: hero.angle, t: 1.1 };
    this.setBanner('THE HERO HAS FALLEN', killer.name + ' takes the mantle', killer.color, 2.2);
    w.emit('herofall', { x: hero.x, y: hero.y, target: hero, killer });
  }

  doSwap(newP, oldP, x, y, angle) {
    const w = this.world; if (!w) return;
    // old hero body
    const old = oldP.body; if (old && old.type === 'hero') { old.removed = true; w.corpses.push({ x: old.x, y: old.y, sprite: 'herocorpse', defId: 'hero', tier: 0, angle: old.angle, scale: 1, id: old.id }); }
    for (let i = 0; i < 3; i++) spawnPickup(w, 'gold', x, y, { amount: 6 + oldP.hero.level * 3 });
    oldP.role = 'ghost'; oldP.hero.deaths = (oldP.hero.deaths || 0) + 1;
    const g = spawnGhost(w, oldP, x, y, angle); oldP.body = g;
    this.hint(oldP, 'ghost1', `YOU ARE A GHOST NOW. POSSESS A PENTAGRAM (${this.key(oldP, 'interact')}) OR TRAP TO GET REVENGE.`, 8);
    // new hero
    if (newP.body && newP.body !== g && !newP.body.removed) { newP.body.removed = true; if (newP.body.type === 'trapctl') { newP.body.trap.owner = null; newP.body.trap.proxy = null; } }
    if (newP.ghostForm) { newP.ghostForm.removed = true; newP.ghostForm = null; }
    newP.role = 'hero'; newP.stats.heroCount++;
    const h = spawnHero(w, newP, x, y, angle, 0.6, { invuln: 3.2 });
    newP.body = h; this.heroPlayer = newP;
    h.hp = Math.max(h.hp, h.maxHp * 0.6);
    h.ankhUsed = false; h.spawnFlash = 1.2;
    this.stats.swaps++;
    this.toast(newP.name + ' killed the Hero and takes their place!', newP.color);
    this.setBanner(newP.name.toUpperCase(), 'IS THE NEW HERO', newP.color, 2.4);
    w.emit('heroswap', { x, y, newP, oldP });
    // reset room state: monsters keep going. relock evaluated next tick.
  }

  releaseMonster(m) {
    const w = this.world; const p = m.player; if (!p || p.body !== m) return;
    m.ctl = 'ai'; m.player = p; // stays AI-controlled, still credited to owner
    const g = spawnGhost(w, p, m.x, m.y, m.angle); p.body = g;
    m.leftBehind = true;
  }

  onLevelUp(player) {
    const w = this.world; const a = player.body;
    const lv = player.hero.level;
    if (a && a.type === 'hero') applyLevelUp(w, a);
    this.toast(player.name + ' reached level ' + lv + '!', '#ffd060');
    this.setBanner('LEVEL ' + lv, player.name, '#ffd060', 1.6);
    { const U = { 3: `LEVEL 3: HOLD ${this.key(player, 'attack')} TO CHARGE A HEAVY ATTACK`, 4: `LEVEL 4: SPELL SLOT UNLOCKED. ${this.key(player, 'spell')} CASTS`, 5: `LEVEL 5: ${this.key(player, 'dodge')} DODGE ROLLS (INVULNERABLE)`, 6: `LEVEL 6: HOLD ${this.key(player, 'alt')} TO BLOCK. TAP AT IMPACT TO PARRY`, 7: 'LEVEL 7: SECOND SPELL SLOT', 10: 'LEVEL 10: FIND THE PORTAL ROOM (ARROW ON HUD)' }; if (U[lv]) this.toastFor(player, U[lv], '#ffe080', 7); }
    for (const p of this.players) if (p !== player) { p.ghost.wrath += lv * 8; this.toastFor(p, 'The Hero grows stronger... +' + lv * 8 + ' Wrath', '#c08040'); }
    if (this.phase === 'floor' || this.phase === 'boss') for (const p of this.players) if (p.role === 'ghost') { /* nothing extra */ }
  }

  // ---------------- props smashing ----------------
  smashProps(w, a, ab, opts) {
    const reach = ab.reach + 0.4, half = (ab.arc * Math.PI) / 360;
    for (const pr of w.props) {
      if (!pr.alive || !(pr.destructible || pr.kind === 'crystal')) continue;
      const d = dist(a.x, a.y, pr.x, pr.y); if (d > reach + 0.3) continue;
      const ang = Math.atan2(pr.y - a.y, pr.x - a.x);
      let da = Math.abs(ang - a.angle); da = da > Math.PI ? TAU - da : da;
      if (da > half + 0.35) continue;
      this.hitProp(w, pr, ab.dmg * a.dmgMul, a);
    }
  }
  hitProp(w, pr, dmg, byActor) {
    if (!pr.alive) return;
    if (pr.kind === 'crystal') {
      pr.hp -= dmg; pr.hitT = 0.2; w.emit('crystalhit', { x: pr.x, y: pr.y, prop: pr });
      if (pr.hp <= 0) { w.removeProp(pr); pr.removed = true; w.emit('crystalbreak', { x: pr.x, y: pr.y }); if (byActor && byActor.player && byActor.type === 'hero') grantXp(this, byActor.player, 10 + w.depth * 2); }
      return;
    }
    pr.hp -= 1; pr.hitT = 0.15;
    w.emit('prophit', { x: pr.x, y: pr.y, prop: pr });
    if (pr.hp <= 0) { destroyProp(w, pr, {}); if (byActor && byActor.player) grantXp(this, byActor.player, 1); }
  }

  // ---------------- portal & boss ----------------
  tryEnterPortal(w, hero, portal) {
    const p = hero.player;
    if (hero.hero.level < MAX_LEVEL) { this.toastFor(p, 'The portal is dormant. Reach level 10.', '#5ad0ff'); w.emit('sealed', { target: hero }); return; }
    if (this.bossAttempts >= 3) { this.toastFor(p, 'The seals are broken.', '#5ad0ff'); return; }
    this.enterBoss(hero);
  }

  enterBoss(hero) {
    const p = this.heroPlayer;
    this.floorWorld = this.world;
    this.floorWorld.savedHeroPos = { x: hero.x, y: hero.y };
    if (!this.bossId) this.bossId = this.rng.pick(BOSS_IDS);
    const spec = buildBossMap(this.bossId);
    const w = this.world = new World(this, spec, 'boss', this.seed * 5 + this.bossAttempts * 13);
    w.depth = this.floorIndex + 2;
    this.phase = 'boss'; this.phaseT = 0; this.bossStage = 'pre';
    hero.removed = true;
    const h = spawnHero(w, p, spec.preRoom.cx + 0.5, spec.preRoom.y + 4.5, -Math.PI / 2, Math.max(0.5, hero.hp / hero.maxHp), { invuln: 1 });
    p.body = h;
    // remove ghost bodies from floor world; create boss + parts
    for (const q of this.players) if (q !== p) { if (q.body) q.body.removed = true; q.body = null; q.ghostForm = null; }
    w.boss = new Boss(this, w, this.bossId, this.players.filter((q) => q !== p), this.bossAttempts);
    w.boss.dormant = true;
    this.stats.bossFights++;
    this.setBanner('THE PORTAL OPENS', 'Attempt ' + (this.bossAttempts + 1) + ' of 3', '#5ad0ff', 2.8);
    this.toast('Boss attempt ' + (this.bossAttempts + 1) + ' of 3', '#5ad0ff');
    w.emit('portalenter', {});
  }

  stepBossWorld(w, dt) {
    const hero = this.heroActor(); if (!hero) return;
    const sp = w.spec;
    // pre-boss fountain heal
    if (this.bossStage === 'pre') {
      if (hero.room === 0) { hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * 0.3 * dt); hero.mana = hero.maxMana; }
      if (hero.y < sp.arena.y + sp.arena.h - 0.5 && hero.room === 1) {
        this.bossStage = 'fight'; sp.gate2.locked = true; sp.gate2.target = 0; w.map.setDoorTex(sp.gate2, 12);
        w.boss.dormant = false; w.boss.startFight();
        this.setBanner(w.boss.def.name.toUpperCase(), 'AWAKENS', '#e04030', 3);
        this.toast(w.boss.def.name + ' awakens!', '#e04030');
      }
      // let ghost parts be dormant with intro
    }
    if (this.bossStage === 'fight' && !w.boss.dead && hero.y > sp.arena.y + sp.arena.h + 0.2) { // slipped out through the closing door: put them back inside
      hero.x = 23.5; hero.y = sp.arena.y + sp.arena.h - 1.6; hero.invuln = Math.max(hero.invuln, 1.5); w.emit('ghostjump', { x: hero.x, y: hero.y });
    }
    if (this.bossStage === 'won') {
      this.bossWinT = (this.bossWinT || 0) + dt;
      if (this.bossWinT > 4.5) this.endGame('victory', this.heroPlayer);
    }
  }

  bossFail(w, hero) {
    const p = hero.player;
    this.bossAttempts++;
    this.toast('The Hero has fallen to the boss. Attempt ' + this.bossAttempts + ' of 3 used.', '#e04030');
    this.setBanner('THE HERO FALLS', 'Seal ' + this.bossAttempts + ' of 3 broken', '#e04030', 2.5);
    this.bossResolve = { t: 3.0 };
    this.bossStage = 'failed';
    w.emit('bossfail', { target: hero });
    const self = this;
    const iv = setTimeoutSim(this, 3.0, () => {
      if (self.bossAttempts >= 3) self.endGame('devoured', null);
      else self.returnFromBoss();
    });
  }

  returnFromBoss() {
    const p = this.heroPlayer;
    this.world = this.floorWorld; this.floorWorld = null;
    const w = this.world; this.phase = 'floor';
    const room = w.spec.portal;
    const h = spawnHero(w, p, room.cx + 1.5, room.cy + 1.5, -Math.PI / 2, 0.3, { invuln: 3 });
    h.hp = Math.max(1, h.maxHp * 0.25); p.body = h;
    this.placeGhosts(w, h);
    this.setBanner('BACK FROM THE BRINK', (3 - this.bossAttempts) + ' attempt' + (3 - this.bossAttempts === 1 ? '' : 's') + ' remain', '#5ad0ff', 2.6);
    w.emit('portalreturn', {});
  }

  onBossDefeated() {
    this.bossStage = 'won'; this.bossWinT = 0;
    this.setBanner('THE BOSS FALLS', this.heroPlayer.name + ' is victorious!', '#ffd060', 4);
    this.toast(this.heroPlayer.name + ' has slain ' + this.world.boss.def.name + '!', '#ffd060');
  }

  endGame(result, winner) {
    if (this.phase === 'end') return;
    this.phase = 'end'; this.phaseT = 0;
    this.endInfo = { result, winner, rankings: this.rankings(), time: this.time, attempts: this.bossAttempts };
    this.world && this.world.emit('gameend', { result });
  }

  rankings() {
    const score = (p) => p.ghost.blood + p.hero.xp * 0.25 + p.stats.monsterKills * 2 + p.stats.killingBlows * 60;
    return this.players.slice().sort((a, b) => score(b) - score(a)).map((p, i) => ({ player: p, rank: i + 1, score: Math.round(score(p)) }));
  }
}

// Sim-time timer helper (works headless, driven by match update through phase timers)
function setTimeoutSim(match, seconds, fn) {
  match.timers = match.timers || [];
  match.timers.push({ t: seconds, fn });
  return match.timers.length;
}
const _update = Match.prototype.update;
Match.prototype.update = function (dt) {
  if (this.timers && this.timers.length) {
    for (const tm of this.timers) tm.t -= dt;
    const due = this.timers.filter((tm) => tm.t <= 0);
    this.timers = this.timers.filter((tm) => tm.t > 0);
    for (const tm of due) tm.fn();
  }
  _update.call(this, dt);
};
