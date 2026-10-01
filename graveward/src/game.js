// Game shell: owns the canvas, settings, input, audio, fx, UI and the current match. Runs the fixed-step loop.
import { RNG, clamp, dist, now } from './util.js';
import { Match } from './match.js';
import { View, renderView, buildQuantTable, setDarkness, setBloom } from './renderer.js';
import { buildTextures } from './textures.js';
import * as S from './sprites.js';
import { makeCamera, collectSprites, updateLights } from './scene.js';
import { FX } from './fx.js';
import { drawViewportHUD, drawGlobalHUD } from './hud.js';
import { drawText, panel, setCanvasFactory } from './font.js';
import { Input, DEFAULT_BINDINGS, keyLabel } from './input.js';
import { Sound } from './audio.js';
import { UI, DEFAULT_SETTINGS } from './ui.js';
import { generateFloor } from './dungeon.js';
import { World } from './world.js';
import { GODS, THEMES, MAX_LEVEL } from './data.js';

const KEY = 'graveward.settings.v2';
const DT = 1 / 60;

export class Game {
  constructor(canvas, params) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false }); this.params = params || new URLSearchParams();
    this.settings = this.loadSettings(); setDarkness(this.settings.darkness); setBloom(this.settings.bloom !== false);
    this.input = new Input(this.settings); this.input.attach(canvas);
    this.sound = new Sound(this.settings);
    this.fx = new FX(this.settings);
    this.screen = 'menu'; this.paused = false; this.match = null; this.t = 0; this.acc = 0; this.last = 0; this.frame = 0; this.fps = 60; this.fpsAcc = 0; this.fpsN = 0;
    this.viewers = []; this.views = []; this.layout = null; this.debug = this.params.get('debug') === '1';
    this.stepAcc = new Map(); this.pauseMsg = ''; this.lastMode = '';
    setCanvasFactory(() => document.createElement('canvas'));
    this.textures = buildTextures();
    this.applyQuant();
    this.applyResolution(true);
    this.ui = new UI(this);
    this.spriteBuf = [];
    this.bgReady = false;
    this.lastPadCount = 0;
    // mouse for menus
    const toInternal = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * this.W, ((e.clientY - r.top) / r.height) * this.H]; };
    canvas.addEventListener('mousemove', (e) => { if (this.input.locked) return; const [x, y] = toInternal(e); this.ui.mouse.x = x; this.ui.mouse.y = y; this.ui.mouse.moved = true; });
    canvas.addEventListener('click', (e) => { this.sound.resume(); if (this.screen === 'menu' || this.paused) { const [x, y] = toInternal(e); this.ui.mouse.x = x; this.ui.mouse.y = y; this.ui.mouse.click = true; } else if (this.screen === 'playing' && this.hasMouseP1()) this.input.requestLock(); });
    window.addEventListener('keydown', () => this.sound.resume());
    window.addEventListener('blur', () => { if (this.screen === 'playing' && !this.paused) this.pause('FOCUS LOST'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.screen === 'playing' && !this.paused) this.pause('FOCUS LOST'); });
    document.addEventListener('pointerlockchange', () => { if (!this.input.locked && this.screen === 'playing' && !this.paused && this.hasMouseP1() && this.match && this.match.phase !== 'end' && !this.ignoreUnlock) this.pause(''); });
    window.addEventListener('resize', () => this.fit()); this.fit();
    if (this.debug) window.__game = this;
  }

  // ---------------- settings ----------------
  loadSettings() {
    const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const o = JSON.parse(raw); for (const k of Object.keys(s)) if (k in o && k !== 'bindings') s[k] = o[k]; if (o.bindings) for (const d of Object.keys(s.bindings)) if (o.bindings[d]) Object.assign(s.bindings[d], o.bindings[d]); }
    } catch (e) { /* ignore */ }
    const p = this.params;
    if (p.get('players')) s.totalPlayers = clamp(+p.get('players'), 2, 4);
    if (p.get('seed')) s.seed = +p.get('seed');
    if (p.get('gore')) s.gore = clamp(+p.get('gore'), 0, 3);
    if (p.get('skill')) s.botSkill = p.get('skill');
    if (p.get('floors')) s.floors = clamp(+p.get('floors'), 3, 6);
    if (p.get('pixel')) s.pixel = p.get('pixel');
    return s;
  }
  // On-screen button names. Pad players see pad names; keyboard players see keys, plus pad names if a controller is plugged in.
  labelFor(p, act) {
    const dev = p.device || 'kbm1', isPad = dev.startsWith('pad'), padConnected = this.input.connectedPads().length > 0;
    const padName = () => {
      if (act === 'move') return 'LEFT STICK';
      if (act === 'look') return 'RIGHT STICK';
      const c = (this.input.bindingsFor(isPad ? dev : 'pad0')[act] || [])[0];
      return c === undefined ? '' : keyLabel(c);
    };
    if (isPad) return padName() || act.toUpperCase();
    let kb;
    if (act === 'move') {
      const b0 = this.input.bindingsFor(dev), ks = ['fwd', 'strafeL', 'back', 'strafeR'].map((a) => (b0[a] || [])[0] || '');
      kb = ks.every((k) => /^Key/.test(k)) ? ks.map((k) => k.replace('Key', '')).join('') : 'ARROWS';
    } else if (act === 'look') kb = dev === 'kbm1' ? 'MOUSE' : 'ARROW KEYS';
    else { const c = (this.input.bindingsFor(dev)[act] || [])[0]; kb = c === undefined ? act.toUpperCase() : keyLabel(c); }
    const pn = padConnected ? padName() : '';
    return pn ? kb + ' / ' + pn : kb;
  }

  applyDarkness() { setDarkness(this.settings.darkness); setBloom(this.settings.bloom !== false); }
  saveSettings() { try { const o = Object.assign({}, this.settings); localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* storage unavailable */ } }
  applyQuant() { buildQuantTable(14, this.settings.dither); }
  applyResolution(first) {
    const fine = this.settings.pixel === 'fine';
    this.W = fine ? 640 : 480; this.H = fine ? 360 : 270;
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.bgCanvas = document.createElement('canvas'); this.bgCanvas.width = this.W; this.bgCanvas.height = this.H;
    this.bgView = new View(this.W, this.H); this.bgCtx = this.bgCanvas.getContext('2d');
    this.layout = null; this.fit();
  }
  fit() {
    const w = window.innerWidth, h = window.innerHeight, ar = this.W / this.H;
    let cw = w, ch = Math.floor(w / ar); if (ch > h) { ch = h; cw = Math.floor(h * ar); }
    this.canvas.style.width = cw + 'px'; this.canvas.style.height = ch + 'px';
  }
  sfx(name, vol = 1) { this.sound.resume(); if (this.sound.ok) this.sound.play(name, undefined, undefined, vol); }

  // ---------------- flow ----------------
  enterLobby() { this.ui.initLobby(); }
  beginMatch(slots) {
    const s = this.settings, humans = slots.filter(Boolean);
    const total = Math.max(2, Math.min(4, Math.max(s.totalPlayers, humans.length)));
    const cfg = humans.map((sl) => ({ human: true, godId: sl.god, device: sl.dev, name: sl.name }));
    while (cfg.length < total) cfg.push({ human: false });
    this.startMatch(cfg);
  }
  startTutorial() {
    const dev = this.input.lastDevice || 'kbm1';
    this.startMatch([{ human: true, godId: 'ossuar', device: dev, name: 'You' }, { human: false }], { tutorial: true });
  }
  startMatch(cfg, opts = {}) {
    const s = this.settings;
    const seed = s.seed || ((Math.random() * 1e9) | 0) + 1;
    this.fx.clear(); this.fx.views.clear();
    this.input.kb2InUse = cfg.some((c) => c.human && c.device === 'kb2'); this.input.clearPending();
    const m = this.match = new Match({ seed, floors: s.floors, botSkill: s.botSkill, players: cfg, gore: s.gore });
    m.labelFor = (p, act) => this.labelFor(p, act);
    // input sources for humans
    const viewbot = this.params.get('viewbot') === '1';
    m.players.forEach((p) => {
      if (p.human) { p.input = this.input.source(p.device || 'kbm1'); p.pollIntent = (dt) => p.input.poll(dt); p.consumeIntent = () => p.input.consume(); }
    });
    this.viewers = m.players.filter((p) => p.human);
    if (viewbot || this.viewers.length === 0) this.viewers = m.players.slice(0, Math.max(1, +this.params.get('views') || 1));
    this.makeLayout();
    if (opts.tutorial) m.startTutorial(); else m.startOpening();
    this.screen = 'playing'; this.paused = false; this.ui.stack = ['playing']; this.ui.endMenu = null; this.ui.upSel.clear(); this.ui.pauseMenu = null;
    this.sound.resume();
    if (this.hasMouseP1()) { this.ignoreUnlock = true; this.input.requestLock(); setTimeout(() => (this.ignoreUnlock = false), 600); }
  }
  hasMouseP1() { return this.viewers.some((p) => p.human && p.device === 'kbm1'); }
  makeLayout() {
    const W = this.W, H = this.H, n = this.viewers.length;
    let rects;
    if (n <= 1) rects = [[0, 0, W, H]];
    else if (n === 2) rects = [[0, 0, W / 2 - 1, H], [W / 2 + 1, 0, W / 2 - 1, H]];
    else rects = [[0, 0, W / 2 - 1, H / 2 - 1], [W / 2 + 1, 0, W / 2 - 1, H / 2 - 1], [0, H / 2 + 1, W / 2 - 1, H / 2 - 1], [W / 2 + 1, H / 2 + 1, W / 2 - 1, H / 2 - 1]];
    this.layout = rects.map(([x, y, w, h]) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }));
    this.views = this.layout.slice(0, Math.max(n, 1)).map((r) => new View(r.w, r.h));
    this.overviewRect = n === 3 ? this.layout[3] : null;
  }
  pause(msg) { if (this.paused || this.screen !== 'playing') return; this.paused = true; this.pauseMsg = msg; this.input.releaseLock(); this.ui.stack = ['pause']; this.ui.pauseMenu = null; this.sound.resume(); }
  resume() { this.paused = false; this.pauseMsg = ''; this.ui.stack = ['playing']; if (this.hasMouseP1()) { this.ignoreUnlock = true; this.input.requestLock(); setTimeout(() => (this.ignoreUnlock = false), 600); } }
  quitToTitle() { this.input.releaseLock(); this.screen = 'menu'; this.paused = false; this.match = null; this.ui.set('title'); this.sound.setMode('menu'); this.ui.endMenu = null; }
  playAgain() { const cfg = this.match.players.map((p) => ({ human: p.human, godId: p.godId, device: p.device, name: p.name })); this.startMatch(cfg); }
  returnToLobby() { this.input.releaseLock(); this.screen = 'menu'; this.paused = false; this.match = null; this.ui.set('title'); this.ui.push('setup'); this.ui.push('lobby'); this.ui.initLobby(); this.ui.endMenu = null; }

  // ---------------- main loop ----------------
  start() { this.last = now(); const loop = (tm) => { try { this.frameStep(); } catch (e) { console.error(e); this.lastError = e; } requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
  frameStep() {
    const tNow = now(); let dt = (tNow - this.last) / 1000; this.last = tNow; dt = Math.min(dt, 0.1); this.t += dt; this.lastDt = dt;
    this.fpsAcc += dt; this.fpsN++; if (this.fpsAcc >= 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    this.input.beginFrame();
    if (this.input.padPending) { /* reserved */ }
    if (this.input.padRebind) { for (let i = 0; i < 4; i++) for (const b of this.input.padEdges[i]) { const f = this.input.padRebind; this.input.padRebind = null; f(b); break; } }
    for (const m of this.input.connectMsgs.slice()) { if (this.screen === 'playing') { this.match.toast(m, '#80a0e0'); this.input.connectMsgs.shift(); } }
    if (this.screen === 'menu' || this.paused) this.input.clearPending();
    if (this.screen === 'menu') this.updateMenu(dt); else this.updatePlaying(dt);
    this.ui.mouse.click = false; // a click lasts one frame; UI.update reads it above
    this.render();
    this.input.endFrame();
  }
  updateMenu(dt) {
    this.ui.update(dt);
    this.updateTitleBG(dt);
    this.sound.setMode('menu'); this.sound.setIntensity(0.3);
    this.sound.setListeners([]);
  }
  updatePlaying(dt) {
    const m = this.match, inp = this.input;
    // pause requests
    const nav = inp.menuNav();
    if (!this.paused && (inp.pauseRequested()) && m.phase !== 'end') this.pause('');
    else if (this.paused && this.ui.screen === 'pause' && nav.pause && false) this.resume();
    // gamepad disconnect
    if (!this.paused) { for (const p of m.players) if (p.human && p.device && p.device.startsWith('pad') && !inp.pads[+p.device.slice(3)]) { this.pause('GAMEPAD ' + (+p.device.slice(3) + 1) + ' DISCONNECTED'); break; } }
    this.ui.update(dt);
    if (this.paused) { this.sound.setIntensity(0.1); return; }
    this.acc += dt;
    let steps = 0;
    while (this.acc >= DT && steps < 5) {
      const before = m.world;
      const hit = this.hitstopFor();
      if (!hit) m.update(DT);
      this.acc -= DT; steps++;
      const w = m.world;
      if (w) { const ev = w.drainEvents(); if (ev.length) { this.fx.handle(ev, m, w); this.soundEvents(ev, m, w); } }
      if (this.fx) this.fx.update(DT, m.world);
      if (this.viewers.length && m.world) this.footsteps(m, DT);
    }
    if (steps === 5) this.acc = 0;
    if (this.prof) this.prof.sim += 0;
    this.updateMusic(m);
    this.updateListeners(m);
    this.horror(m, dt);
  }
  // creeping dread: heartbeat when hurt, whispers when a ghost hovers close to a hero viewer
  horror(m, dt) {
    this.hbT = (this.hbT || 0) - dt; this.whT = (this.whT || 0) - dt;
    for (const p of this.viewers) {
      const b = p.body; if (!b || b.type !== 'hero' || b.dead) continue;
      const f = b.hp / b.maxHp;
      if (f < 0.32 && this.hbT <= 0) { this.hbT = 0.55 + f * 1.4; this.sound.play('heartbeat', undefined, undefined, 0.6 + (0.32 - f) * 1.5); }
      if (this.whT <= 0) {
        let g = null, gd = 5; for (const a of m.world.actors) if (a.type === 'ghost') { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < gd) { gd = d; g = a; } }
        if (g) { this.whT = 4 + Math.random() * 5; this.sound.play('whisper', g.x, g.y, 0.9); }
      }
    }
  }
  hitstopFor() { for (const v of this.fx.views.values()) if (v.hitstop > 0) return true; return false; }
  fastForward(seconds) { const m = this.match; let n = Math.floor(seconds / DT); while (n-- > 0) { m.update(DT); const w = m.world; if (w) { const ev = w.drainEvents(); this.fx.handle(ev, m, w); this.fx.update(DT, w); } } }

  // ---------------- audio routing ----------------
  updateListeners(m) {
    this.sound.setListeners(this.viewers.filter((p) => p.body).map((p) => ({ x: p.body.x, y: p.body.y, angle: p.body.angle })));
  }
  updateMusic(m) {
    const w = m.world; if (!w) return;
    let mode = 'explore', inten = 0.15;
    const hero = m.heroActor();
    if (m.phase === 'end') mode = m.endInfo && m.endInfo.result === 'victory' ? 'victory' : 'defeat';
    else if (m.phase === 'boss' && w.boss && w.boss.fighting) { mode = 'boss'; inten = 0.5 + (1 - w.boss.hp / w.boss.maxHp) * 0.5; }
    else if (m.phase === 'opening') { mode = 'combat'; inten = 0.6; }
    else if (m.phase === 'upgrade') { mode = 'explore'; inten = 0.1; }
    else if (hero) {
      let near = 0; for (const a of w.actors) if (!a.dead && a.type === 'monster' && a.team === 'ghost' && dist(a.x, a.y, hero.x, hero.y) < 11) near++;
      const r = w.rooms[hero.room];
      if (near > 0 || (r && r.locked)) { mode = 'combat'; inten = clamp(0.3 + near * 0.18, 0, 1); }
    }
    this.sound.setMode(mode, w.spec && w.spec.themeIndex !== undefined ? w.spec.themeIndex : 0);
    this.sound.setIntensity(inten);
  }
  footsteps(m, dt) {
    const w = m.world;
    for (const a of w.actors) {
      if (a.dead || (a.type !== 'hero' && a.type !== 'monster') || !a.moving) continue;
      const acc = (this.stepAcc.get(a.id) || 0) + dt * Math.hypot(a.vx || 0, a.vy || 0);
      if (acc > (a.type === 'hero' ? 1.7 : 1.4)) { this.stepAcc.set(a.id, 0); if (this.viewers.length) this.sound.play(a.giant ? 'shockwave' : 'step', a.x, a.y, a.giant ? 0.25 : a.type === 'hero' ? 1 : 0.8); } else this.stepAcc.set(a.id, acc);
    }
    if (this.stepAcc.size > 200) this.stepAcc.clear();
  }
  soundEvents(events, m, w) {
    const S = this.sound; if (!S.ok) return;
    for (const e of events) {
      const x = e.x !== undefined ? e.x : e.target ? e.target.x : undefined, y = e.y !== undefined ? e.y : e.target ? e.target.y : undefined;
      switch (e.type) {
        case 'windup': {
          const a = e.target, ab = e.ab;
          if (a.type === 'hero') {
            if (ab.id === 'weapon') { if (ab.kind === 'proj') S.play(ab.proj === 'bolt' ? 'bolt' : 'shoot', x, y); else S.play(a.atk && a.atk.heavy ? 'swingHeavy' : 'swing', x, y); }
          } else if (a.type === 'monster' || a.type === 'bosspart') { S.play('windup', x, y, 0.8); if (Math.random() < 0.5) S.play(a.giant || a.type === 'bosspart' ? 'v_giant' : 'v_' + (a.def ? a.def.sprite : 'skeleton'), x, y, 0.75); }
          break;
        }
        case 'attack': { const ab = e.ab; if (ab.kind === 'proj' || ab.kind === 'curse') S.play(ab.proj === 'fireball' ? 'fire' : ab.proj === 'darkbolt' || ab.proj === 'curse' ? 'drain' : 'shoot', x, y); else if (ab.kind === 'melee') S.play('swing', x, y, 0.8); else if (ab.kind === 'leap') S.play('whoosh', x, y); else if (ab.kind === 'scream') S.play('v_screamer', x, y); break; }
        case 'hit': {
          const t = e.target; if (!t || e.dot) break;
          if (t.giant || t.type === 'bosspart') S.play('hitStone', x, y, 0.9);
          else if (t.defId === 'skeleton' || t.defId === 'archer' || t.defId === 'brute') S.play('hitBone', x, y);
          else S.play(e.amount > 18 ? 'hitHeavy' : 'hit', x, y, t.type === 'hero' ? 1.2 : 1);
          break;
        }
        case 'block': S.play('block', x, y); break; case 'parry': S.play('parry', x, y); break;
        case 'death': S.play('death', x, y, e.target && e.target.giant ? 1.3 : 1); if (e.gib) S.play('gibs', x, y, 0.8); break;
        case 'spawn': case 'pentagram': S.play('pentagram', x, y); break;
        case 'statuewake': S.play('statue', x, y); break;
        case 'heroswap': S.play('swapSting', undefined, undefined, 1); break;
        case 'herofall': S.play('death', x, y, 1.2); break;
        case 'levelup': S.play('levelup', undefined, undefined, 0.9); break;
        case 'tutstep': S.play('uiOk'); break;
        case 'explosion': S.play('explosion', x, y); break; case 'shockwave': S.play('shockwave', x, y); break; case 'rockimpact': S.play('shockwave', x, y); break;
        case 'chestopen': S.play('chest', x, y); break;
        case 'pickup': S.play(e.what === 'gold' ? 'coin' : 'pickup', undefined, undefined, 0.8); break;
        case 'pickupsfx': S.play('coin', x, y, 0.6); break; case 'ectopick': S.play('ecto', x, y, 0.7); break;
        case 'roomlock': S.play('doorSlam', undefined, undefined, 1); break; case 'roomunlock': S.play('doorOpen', undefined, undefined, 0.7); break;
        case 'roomclear': S.play('uiOk', undefined, undefined, 0.7); break;
        case 'traptrigger': S.play(e.trap === 'saw' ? 'saw' : e.trap === 'flame' ? 'flame' : e.trap === 'spikes' ? 'whoosh' : e.trap === 'crusher' ? 'windup' : 'dart', x, y); break;
        case 'spikes': S.play('spikes', x, y); break; case 'crusher': S.play('crusher', x, y); break; case 'dartfire': S.play('dart', x, y); break; case 'flame': S.play('flame', x, y, 0.5); break;
        case 'chain': S.play('lightning', x, y); break; case 'drain': S.play('drain', x, y); break; case 'frostnova': S.play('frost', x, y); break;
        case 'spellcast': if (e.spell === 'fire') S.play('fire', x, y); else if (e.spell === 'ward') S.play('ward', x, y); break;
        case 'wardcast': S.play('ward', x, y); break; case 'sightcast': S.play('ward', x, y, 0.6); break;
        case 'potion': S.play('potion', x, y); break;
        case 'projwall': S.play('hitStone', x, y, 0.4); break;
        case 'projbounce': S.play('hitStone', x, y, Math.min(0.5, 0.12 + (e.power || 0.3) * 0.25)); break;
        case 'projhit': if (e.kind === 'throwprop') S.play('hit', x, y, 0.55); break;
        case 'propbreak': S.play('hit', x, y, 0.5); break; case 'prophit': S.play('hitStone', x, y, 0.4); break;
        case 'crystalbreak': S.play('explosion', x, y, 0.5); break; case 'crystalhit': S.play('block', x, y, 0.6); break;
        case 'bossroar': case 'bossphase': S.play('roar', undefined, undefined, 1); break; case 'bossdeath': S.play('explosion', undefined, undefined, 1.2); S.play('roar', undefined, undefined, 0.8); break;
        case 'portalenter': case 'portalreturn': case 'descend': S.play('portal', undefined, undefined, 0.9); break;
        case 'ghostjump': S.play('ghostjump', x, y, 0.6); break;
        case 'torchout': case 'possesstrap': case 'coffinopen': case 'rattle': case 'chestbite': S.play(e.type === 'rattle' ? 'rattle' : 'haunt', x, y); break;
        case 'chandelier': S.play('rattle', x, y); break; case 'chandeliercrash': S.play('explosion', x, y, 0.7); break;
        case 'sealed': case 'locked': case 'nogold': S.play('sealed', undefined, undefined, 0.8); break;
        case 'dodge': S.play('dodge', x, y); break; case 'swap': S.play('ui', undefined, undefined, 0.8); break;
        case 'slimesummon': S.play('slime', x, y); break; case 'beamtick': S.play('beam', x, y, 0.5); break;
        case 'suddendeath': S.play('roar', undefined, undefined, 0.6); break;
        case 'ankh': S.play('levelup', x, y, 0.6); break; case 'deathless': S.play('hitBone', x, y, 1); break;
        case 'unwrap': S.play('hitHeavy', x, y); break;
        default: break;
      }
    }
  }

  // ---------------- rendering ----------------
  updateTitleBG(dt) {
    if (!this.bgWorld) {
      const seed = ((Math.random() * 1e6) | 0) + 3;
      try {
        const spec = generateFloor(seed, 0, this.titleTheme = (Math.random() * 6) | 0);
        const fake = { headless: true, rng: new RNG(seed), heroPlayer: null, players: [], phase: 'title', floorIndex: 0 };
        this.bgWorld = new World(fake, spec, 'floor', seed); this.bgMatch = fake; fake.world = this.bgWorld;
        const r = spec.rooms.filter((q) => q.type !== 'store').sort((a, b) => b.w * b.h - a.w * a.h)[0]; this.bgRoom = r;
      } catch (e) { this.bgWorld = null; }
    }
  }
  renderBG() {
    const w = this.bgWorld; if (!w) { this.bgCtx.fillStyle = '#050305'; this.bgCtx.fillRect(0, 0, this.W, this.H); return; }
    const r = this.bgRoom, t = this.t;
    const ang = t * 0.12 + 0.6, rad = Math.min(r.w, r.h) * 0.18;
    const cam = { x: r.cx + 0.5 + Math.cos(t * 0.05) * rad, y: r.cy + 0.5 + Math.sin(t * 0.07) * rad, angle: ang, z: 0.5, pitch: 0, vfov: 0.95, lightR: 1, lightG: 0.8, lightB: 0.5, lightRadius: 4, lightPower: 0.4, ghost: false };
    updateLights(this.bgMatch, w, [cam], t, this.fx);
    const sprites = collectSprites(this.bgMatch, w, { body: null, role: 'ghost' }, t, { parts: [], ground: [], beams: [] }, this.spriteBuf);
    renderView(this.bgView, { map: w.map, textures: this.textures, sprites }, cam, t);
    this.bgCtx.putImageData(this.bgView.img, 0, 0);
  }
  render() {
    const ctx = this.ctx, W = this.W, H = this.H, t = this.t;
    ctx.imageSmoothingEnabled = false;
    if (this.screen === 'menu') {
      this.renderBG();
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      this.ui.draw(ctx, W, H, t);
    } else this.renderPlaying(ctx, W, H, t);
    if (this.settings.showFps || this.debug) drawText(ctx, this.fps + ' FPS' + (this.debug && this.match ? '  ' + this.match.phase + ' T' + Math.round(this.match.time) : ''), W - 3, 2, '#80ff80', 1, { align: 'right' });
  }
  renderPlaying(ctx, W, H, t) {
    const m = this.match, w = m.world; if (!w) return;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const cams = [];
    const fxv = this.viewers.map((p) => this.fx.viewOf(p));
    fxv.forEach((v) => { v.shakeScaled = v.shake * this.settings.shake; });
    for (let i = 0; i < this.viewers.length; i++) {
      const p = this.viewers[i], r = this.layout[i], view = this.views[i];
      const aspect = r.w / r.h, base = this.settings.fov;
      const hfovT = 2 * Math.atan(Math.tan(base / 2) * (16 / 9));
      const vfov = clamp(2 * Math.atan(Math.tan(hfovT / 2) / aspect), 0.7, 1.28);
      const shakeV = { shake: fxv[i].shake * this.settings.shake, hurt: fxv[i].hurt, kick: fxv[i].kick };
      const cam = makeCamera(m, p, t, shakeV, { vfov });
      cams.push(cam); cam._p = p;
    }
    const T = this.prof || (this.prof = { light: 0, sprites: 0, render: 0, hud: 0, put: 0, sim: 0, n: 0 });
    let t0 = now();
    updateLights(m, w, cams, t, this.fx);
    this.fx.updateMotes(this.lastDt || 0.016, cams, w.map);
    T.light += now() - t0;
    for (let i = 0; i < this.viewers.length; i++) {
      const p = this.viewers[i], r = this.layout[i], view = this.views[i], cam = cams[i];
      t0 = now();
      const sprites = collectSprites(m, w, p, t, this.fx, this.spriteBuf);
      T.sprites += now() - t0; t0 = now(); T.nspr = (T.nspr || 0) + sprites.length;
      renderView(view, { map: w.map, textures: this.textures, sprites }, cam, t);
      T.render += now() - t0; t0 = now();
      ctx.putImageData(view.img, r.x, r.y);
      T.put += now() - t0; t0 = now();
      ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip(); ctx.translate(r.x, r.y);
      drawViewportHUD(ctx, r.w, r.h, m, p, cam, t, fxv[i]);
      ctx.restore();
      T.hud += now() - t0;
    }
    if (this.overviewRect) this.drawOverview(ctx, this.overviewRect, m, t);
    // separators
    if (this.viewers.length > 1) { ctx.fillStyle = '#000'; ctx.fillRect(W / 2 - 1, 0, 2, H); if (this.viewers.length > 2) ctx.fillRect(0, H / 2 - 1, W, 2); }
    drawGlobalHUD(ctx, W, H, m, t);
    // fade in/out on transitions
    if (m.phase === 'floor' && m.phaseT < 1.2) { ctx.fillStyle = `rgba(0,0,0,${1 - m.phaseT / 1.2})`; ctx.fillRect(0, 0, W, H); }
    if (this.hasMouseP1() && !this.input.locked && !this.paused && m.phase !== 'end' && m.phase !== 'upgrade') {
      drawText(ctx, this.input.lockFailed ? 'THIS PAGE BLOCKS MOUSE CAPTURE' : 'CLICK TO CAPTURE MOUSE', W / 2, Math.round(H * 0.78), '#ffe080', 1, { align: 'center', outline: '#000' });
      if (this.settings.edgeLook) {
        drawText(ctx, 'MOVE THE MOUSE TO LOOK. AT THE SCREEN EDGE IT KEEPS TURNING', W / 2, Math.round(H * 0.78) + 10, '#c0a860', 1, { align: 'center', outline: '#000' });
        const et = this.input.edgeTurn();
        if (et) { const a = Math.min(1, Math.abs(et) / 2.8); ctx.globalAlpha = 0.25 + 0.6 * a; drawText(ctx, et < 0 ? '<<' : '>>', et < 0 ? 6 : W - 18, Math.round(H / 2) - 3, '#ffe080', 2, { outline: '#000' }); ctx.globalAlpha = 1; }
      }
    }
    this.ui.draw(ctx, W, H, t);
    if (this.paused && this.pauseMsg) drawText(ctx, this.pauseMsg, W / 2, H / 2 - 64, '#ff8060', 1, { align: 'center' });
  }
  drawOverview(ctx, r, m, t) {
    ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip(); ctx.translate(r.x, r.y);
    ctx.fillStyle = '#08060a'; ctx.fillRect(0, 0, r.w, r.h);
    drawText(ctx, 'SCOREBOARD', r.w / 2, 3, '#e0b060', 1, { align: 'center' });
    m.players.forEach((p, i) => {
      const y = 14 + i * 10;
      ctx.fillStyle = p.color; ctx.fillRect(3, y, 4, 7);
      drawText(ctx, (p === m.heroPlayer ? '* ' : '') + p.name.slice(-1) + ' ' + (p.role === 'hero' ? 'HERO' : GODS[p.godId].name.slice(0, 5).toUpperCase()), 10, y, p === m.heroPlayer ? '#ffd060' : '#c0b8a8', 1);
      drawText(ctx, `L${p.hero.level} B${Math.round(p.ghost.blood)} W${Math.round(p.ghost.wrath)}`, r.w - 3, y, '#a89880', 1, { align: 'right' });
    });
    const w = m.world;
    if (w && w.kind === 'floor') {
      const mx = 2, my = 58, mw = r.w - 4, mh = r.h - my - 3;
      const sc = Math.min(mw / w.map.w, mh / w.map.h);
      ctx.fillStyle = '#0e0a10'; ctx.fillRect(mx, my, mw, mh);
      for (const rm of w.rooms) {
        ctx.fillStyle = rm.entered ? (rm.locked ? '#7a2020' : '#4a4038') : '#26202a';
        ctx.fillRect(mx + rm.x * sc, my + rm.y * sc, rm.w * sc, rm.h * sc);
        if (rm.entered || true) { const tag = rm.type === 'store' ? '#e0b040' : rm.type === 'portal' ? '#40b0ff' : rm.type === 'exit' ? '#ffffff' : null; if (tag) { ctx.fillStyle = tag; ctx.fillRect(mx + (rm.cx) * sc - 1, my + rm.cy * sc - 1, 3, 3); } }
      }
      for (const p of m.players) { const b = p.body; if (!b) continue; ctx.fillStyle = p.color; const s2 = p === m.heroPlayer ? 4 : 2; ctx.fillRect(mx + b.x * sc - s2 / 2, my + b.y * sc - s2 / 2, s2, s2); }
    }
    ctx.restore();
  }
}
