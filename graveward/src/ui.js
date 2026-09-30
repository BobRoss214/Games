// Menus and full-screen states: title, setup, lobby, how-to, options, controls, credits, pause, upgrade, end.
import { drawText, panel, bar, textWidth, wrapText } from './font.js';
import { GODS, GOD_IDS, MONSTERS, EVOLVE_COST, WEAPONS, RARITY, ARTIFACTS, XP_TABLE, LEVEL_UNLOCKS, BOSSES } from './data.js';
import * as S from './sprites.js';
import { frameCanvas } from './hud.js';
import { ACTIONS, DEFAULT_BINDINGS, DEVICE_NAMES, keyLabel } from './input.js';
import { clamp } from './util.js';

export const DEFAULT_SETTINGS = {
  master: 0.8, music: 0.7, sfx: 0.9, mute: false, gore: 2, fov: 0.95, sensitivity: 1, stickSens: 1, deadzone: 0.18, shake: 1, pixel: 'chunky', showFps: false,
  botSkill: 'normal', floors: 5, totalPlayers: 4, seed: 0, dither: 1, bindings: JSON.parse(JSON.stringify(DEFAULT_BINDINGS)),
};

const C = { gold: '#e0b060', dim: '#8a7a68', hi: '#ffe8a8', text: '#e8dcc0', red: '#d03a30', bg: 'rgba(6,3,5,0.86)' };

class Menu {
  constructor(items, opts = {}) { this.items = items; this.sel = 0; this.opts = opts; this.rects = []; this.skipHeaders(1); }
  skipHeaders(dir) { let n = 0; while (this.items[this.sel] && (this.items[this.sel].type === 'header' || this.items[this.sel].hidden) && n++ < 50) this.sel = (this.sel + dir + this.items.length) % this.items.length; }
  update(nav, mouse, game) {
    const it = () => this.items[this.sel];
    if (nav.up) { this.sel = (this.sel - 1 + this.items.length) % this.items.length; this.skipHeaders(-1); game.sfx('ui'); }
    if (nav.down) { this.sel = (this.sel + 1) % this.items.length; this.skipHeaders(1); game.sfx('ui'); }
    if (mouse && mouse.moved) for (let i = 0; i < this.rects.length; i++) { const r = this.rects[i]; if (r && mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h && this.items[i].type !== 'header' && this.sel !== i) { this.sel = i; game.sfx('ui'); } }
    const cur = it(); if (!cur) return;
    let ok = nav.ok;
    if (mouse && mouse.click) { const r = this.rects[this.sel]; if (r && mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h) ok = true; }
    if (cur.type === 'slider') {
      const step = cur.step || 0.1;
      if (nav.left) { cur.set(clamp(+(cur.get() - step).toFixed(3), cur.min, cur.max)); game.sfx('ui'); }
      if (nav.right || ok) { cur.set(clamp(+(cur.get() + step).toFixed(3), cur.min, cur.max)); game.sfx('ui'); }
      if (mouse && mouse.click && cur.sliderRect) { const r = cur.sliderRect; if (mouse.x >= r.x && mouse.x <= r.x + r.w) cur.set(clamp(cur.min + ((mouse.x - r.x) / r.w) * (cur.max - cur.min), cur.min, cur.max)); }
    } else if (cur.type === 'choice') {
      const n = cur.options.length, i = cur.options.indexOf(cur.get());
      if (nav.left) { cur.set(cur.options[(i - 1 + n) % n]); game.sfx('ui'); }
      if (nav.right || ok) { cur.set(cur.options[(i + 1) % n]); game.sfx('ui'); }
    } else if (cur.type === 'toggle') { if (nav.left || nav.right || ok) { cur.set(!cur.get()); game.sfx('ui'); } }
    else if (cur.type === 'button' && ok) { game.sfx('uiOk'); cur.onOk && cur.onOk(); }
  }
  draw(ctx, cx, y0, t, opts = {}) {
    const lh = opts.lineH || 14; this.rects = [];
    let y = y0;
    this.items.forEach((it, i) => {
      if (it.hidden) { this.rects.push(null); return; }
      const sel = i === this.sel;
      if (it.type === 'header') { drawText(ctx, it.label, cx, y + 2, C.dim, 1, { align: 'center' }); this.rects.push(null); y += lh; return; }
      const label = typeof it.label === 'function' ? it.label() : it.label;
      let text = label, valText = '';
      if (it.type === 'slider') valText = it.fmt ? it.fmt(it.get()) : Math.round(((it.get() - it.min) / (it.max - it.min)) * 100) + '%';
      else if (it.type === 'choice') valText = String(it.fmt ? it.fmt(it.get()) : it.get());
      else if (it.type === 'toggle') valText = it.get() ? 'ON' : 'OFF';
      const w = opts.width || 220;
      const x = cx - w / 2;
      this.rects.push({ x, y: y - 2, w, h: lh - 1 });
      if (sel) { ctx.fillStyle = 'rgba(120,20,20,0.55)'; ctx.fillRect(x, y - 2, w, lh - 1); ctx.fillStyle = '#c04030'; ctx.fillRect(x, y - 2, 2, lh - 1); ctx.fillRect(x + w - 2, y - 2, 2, lh - 1); }
      const col = sel ? C.hi : C.text;
      if (it.type === 'button') drawText(ctx, text, cx, y + 1, col, 1, { align: 'center' });
      else {
        drawText(ctx, text, x + 6, y + 1, col, 1);
        if (it.type === 'slider') { const sw = 60, sx = x + w - sw - 30; it.sliderRect = { x: sx, y, w: sw, h: 8 }; bar(ctx, sx, y + 2, sw, 4, (it.get() - it.min) / (it.max - it.min), sel ? '#e0a040' : '#8a6a30', '#1a1008'); drawText(ctx, valText, x + w - 4, y + 1, col, 1, { align: 'right' }); }
        else drawText(ctx, (sel ? '< ' : '') + valText + (sel ? ' >' : ''), x + w - 4, y + 1, sel ? C.hi : C.gold, 1, { align: 'right' });
      }
      y += lh;
    });
    return y;
  }
}

const HOWTO = [
  ['THE PITCH', [
    'ONE PLAYER IS THE HERO, EXPLORING A CURSED TOMB AND GROWING STRONGER.',
    'EVERYONE ELSE IS A GHOST. GHOSTS POSSESS MONSTERS, TRAPS AND STATUES TO KILL THE HERO.',
    'WHOEVER LANDS THE KILLING BLOW BECOMES THE NEW HERO. THE OLD HERO BECOMES A GHOST.',
    'REACH LEVEL 10, ENTER THE PORTAL AND SLAY THE BOSS TO WIN. THE BOSS IS CONTROLLED BY THE GHOSTS.',
    'ONLY THREE BOSS ATTEMPTS IN TOTAL. FAIL THREE TIMES AND EVERYONE LOSES.' ]],
  ['CONTROLS', null],
  ['PLAYING THE HERO', [
    'ATTACK: TAP TO SWING. LEVEL 3+: HOLD TO CHARGE A HEAVY ATTACK.',
    'LEVEL 5: DODGE ROLL (INVULNERABLE). LEVEL 6: HOLD BLOCK, TIME IT TO PARRY.',
    'LEVEL 4 / 7: SPELL SLOTS. POTIONS HEAL AND BUFF. SPRINT WITH SHIFT / L STICK CLICK.',
    'CLEAR ROOMS TO UNLOCK DOORS: KILL EVERY MONSTER AND SMASH EVERY RED CRYSTAL.',
    'BREAK POTS AND CRATES FOR GOLD. OPEN CHESTS. SPEND GOLD AT THE SHOP (HAMMER + ANVIL SIGN).',
    'THE TRAPDOOR IN THE EXIT ROOM TAKES YOU DEEPER, BUT ONLY ONCE THE ROOM IS CLEAR.' ]],
  ['PLAYING A GHOST', [
    'YOU ARE INVISIBLE TO THE HERO. FLOAT TO A GLOWING PENTAGRAM AND PRESS INTERACT TO BECOME A MONSTER.',
    'POSSESS TRAPS (ATTACK TO TRIGGER) AND WAKE STATUES INTO GIANTS. HAUNT POTS AND TORCHES.',
    'SMASHED SCENERY LEAKS ECTOPLASM. COLLECT 6 TO SUMMON A SLIME ANYWHERE.',
    'HURT THE HERO TO EARN BLOOD. EVERY HERO LEVEL-UP GIVES YOU WRATH.',
    'SPEND WRATH BETWEEN FLOORS TO EVOLVE YOUR THREE MONSTERS. HOLD INTERACT TO LEAVE A BODY.',
    'NEXT-SPELL KEY (T / RB) TELEPORTS YOU BETWEEN HAUNT POINTS AND THE HERO.' ]],
  ['THE BOSS', [
    'AT LEVEL 10 THE PORTAL ROOM OPENS THE WAY. AN ARROW ON YOUR HUD POINTS THE WAY.',
    'FIVE BOSSES: SARCOPHAGUS COLOSSUS, JACKAL KING, BANDAGE MOTHER, SAND DEVOURER, BEATING HEART. ONE IS PICKED AT RANDOM.',
    'EACH GHOST CONTROLS ONE PART OF THE BOSS. BOTS FILL EMPTY PARTS.',
    'WEAK SPOTS: COLOSSUS CHEST OPENS AFTER FIST SLAMS. JACKAL HEADS TAKE DOUBLE DAMAGE MID-ATTACK.',
    'BANDAGE MOTHER: UNWRAP BOTH ARMS TO EXPOSE THE CORE.',
    'ANY HERO CAN WIN, REGARDLESS OF LEVEL, IF THEY SLAY THE BOSS.' ]],
];

export class UI {
  constructor(game) {
    this.g = game; this.stack = ['title']; this.t = 0; this.mouse = { x: 0, y: 0, click: false, moved: false };
    this.howPage = 0; this.controlsDev = 'kbm1'; this.ctrlSel = 0; this.rebinding = false; this.creditsT = 0;
    this.lobby = null; this.pauseMenu = null; this.upSel = new Map(); this.endSel = 0; this.endMenu = null;
    this.buildMenus();
  }
  get screen() { return this.stack[this.stack.length - 1]; }
  push(s) { this.stack.push(s); this.g.sfx('uiOk'); }
  pop() { if (this.stack.length > 1) { this.stack.pop(); this.g.sfx('uiBack'); } }
  set(s) { this.stack = [s]; }

  buildMenus() {
    const g = this.g, st = g.settings;
    const slider = (label, key, min = 0, max = 1, step = 0.1, after) => ({ type: 'slider', label, min, max, step, get: () => st[key], set: (v) => { st[key] = v; g.saveSettings(); if (after) after(); } });
    const choice = (label, key, options, fmt, after) => ({ type: 'choice', label, options, fmt, get: () => st[key], set: (v) => { st[key] = v; g.saveSettings(); if (after) after(); } });
    const toggle = (label, key, after) => ({ type: 'toggle', label, get: () => st[key], set: (v) => { st[key] = v; g.saveSettings(); if (after) after(); } });
    this.mainMenu = new Menu([
      { type: 'button', label: 'PLAY', onOk: () => this.push('setup') },
      { type: 'button', label: 'TUTORIAL', onOk: () => g.startTutorial() },
      { type: 'button', label: 'HOW TO PLAY', onOk: () => { this.howPage = 0; this.push('howto'); } },
      { type: 'button', label: 'OPTIONS', onOk: () => this.push('options') },
      { type: 'button', label: 'CREDITS', onOk: () => { this.creditsT = 0; this.push('credits'); } },
    ]);
    this.setupMenu = new Menu([
      { type: 'header', label: 'MATCH SETUP' },
      choice('TOTAL PLAYERS', 'totalPlayers', [2, 3, 4], (v) => v + ' (HUMANS + BOTS)'),
      choice('BOT SKILL', 'botSkill', ['easy', 'normal', 'hard'], (v) => v.toUpperCase()),
      choice('FLOORS BEFORE DEPTH LOOPS', 'floors', [3, 4, 5, 6]),
      choice('GORE', 'gore', [0, 1, 2, 3], (v) => ['OFF', 'LOW', 'HIGH', 'EXCESSIVE'][v], () => g.fx.settings.gore = st.gore),
      { type: 'choice', label: 'SEED', options: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 42, 101, 666, 1337], get: () => st.seed, set: (v) => { st.seed = v; g.saveSettings(); }, fmt: (v) => (v === 0 ? 'RANDOM' : String(v)) },
      { type: 'button', label: 'CONTINUE TO LOBBY', onOk: () => { g.enterLobby(); this.push('lobby'); } },
      { type: 'button', label: 'BACK', onOk: () => this.pop() },
    ]);
    this.optionsMenu = new Menu([
      { type: 'header', label: 'AUDIO' },
      slider('MASTER VOLUME', 'master', 0, 1, 0.1, () => g.sound.applyVolumes()), slider('MUSIC VOLUME', 'music', 0, 1, 0.1, () => g.sound.applyVolumes()), slider('SFX VOLUME', 'sfx', 0, 1, 0.1, () => g.sound.applyVolumes()),
      toggle('MUTE ALL', 'mute', () => g.sound.applyVolumes()),
      { type: 'header', label: 'VIDEO' },
      choice('PIXEL SIZE', 'pixel', ['chunky', 'fine'], (v) => (v === 'chunky' ? 'CHUNKY 480X270' : 'FINE 640X360'), () => g.applyResolution()),
      { ...slider('FIELD OF VIEW', 'fov', 0.7, 1.25, 0.05), fmt: (v) => Math.round(((2 * Math.atan(Math.tan(v / 2) * (16 / 9))) * 180) / Math.PI) + ' DEG' },
      slider('COLOR DITHER', 'dither', 0, 1, 0.25, () => g.applyQuant()),
      slider('SCREEN SHAKE', 'shake', 0, 1, 0.25), toggle('SHOW FPS', 'showFps'),
      choice('GORE', 'gore', [0, 1, 2, 3], (v) => ['OFF', 'LOW', 'HIGH', 'EXCESSIVE'][v], () => g.fx.settings.gore = st.gore),
      { type: 'header', label: 'CONTROLS' },
      { ...slider('MOUSE SENSITIVITY', 'sensitivity', 0.2, 3, 0.1), fmt: (v) => v.toFixed(1) + 'X' }, { ...slider('STICK SENSITIVITY', 'stickSens', 0.3, 2.5, 0.1), fmt: (v) => v.toFixed(1) + 'X' }, { ...slider('STICK DEAD ZONE', 'deadzone', 0.05, 0.5, 0.05), fmt: (v) => Math.round(v * 100) + '%' },
      { type: 'button', label: 'REBIND CONTROLS', onOk: () => { this.ctrlSel = 0; this.push('controls'); } },
      { type: 'button', label: 'BACK', onOk: () => this.pop() },
    ]);
    this.creditsMenu = null;
  }

  // ---------------- update ----------------
  update(dt) {
    this.t += dt;
    const g = this.g, nav = g.input.menuNav();
    const m = this.mouse; if (m.click) m.click = false;
    const s = this.screen;
    if (g.screen === 'playing') return this.updatePlaying(dt, nav);
    switch (s) {
      case 'title': this.mainMenu.update(nav, m, g); break;
      case 'setup': this.setupMenu.update(nav, m, g); if (nav.back) this.pop(); break;
      case 'lobby': this.updateLobby(dt); break;
      case 'howto': if (nav.left) this.howPage = (this.howPage + HOWTO.length - 1) % HOWTO.length; if (nav.right || nav.ok) this.howPage = (this.howPage + 1) % HOWTO.length; if (nav.back) this.pop(); if (m.click) this.howPage = (this.howPage + 1) % HOWTO.length; break;
      case 'options': this.optionsMenu.update(nav, m, g); if (nav.back) this.pop(); break;
      case 'controls': this.updateControls(nav); break;
      case 'credits': this.creditsT += dt; if (nav.back || nav.ok) this.pop(); break;
      default: break;
    }
    m.moved = false;
  }

  updateControls(nav) {
    const g = this.g, n = ACTIONS.length + 3;
    if (this.rebinding) return;
    if (nav.up) this.ctrlSel = (this.ctrlSel - 1 + n) % n; if (nav.down) this.ctrlSel = (this.ctrlSel + 1) % n;
    const devs = ['kbm1', 'kb2', 'pad0'];
    if (nav.tab || (this.ctrlSel === ACTIONS.length && (nav.left || nav.right || nav.ok))) { const i = devs.indexOf(this.controlsDev); this.controlsDev = devs[(i + (nav.left ? 2 : 1)) % 3]; g.sfx('ui'); }
    if (nav.back) { g.saveSettings(); this.pop(); return; }
    if (nav.ok) {
      if (this.ctrlSel < ACTIONS.length) {
        const act = ACTIONS[this.ctrlSel][0]; this.rebinding = true;
        g.input.rebind = (code) => { const b = g.settings.bindings[this.controlsDev === 'pad0' ? 'pad' : this.controlsDev]; b[act] = [code]; this.rebinding = false; g.saveSettings(); };
        if (this.controlsDev === 'pad0') g.input.padRebind = (btn) => { g.settings.bindings.pad[act] = [btn]; this.rebinding = false; g.input.padRebind = null; g.input.rebind = null; g.saveSettings(); };
      } else if (this.ctrlSel === ACTIONS.length + 1) { g.settings.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS)); g.saveSettings(); }
      else if (this.ctrlSel === ACTIONS.length + 2) { g.saveSettings(); this.pop(); }
    }
  }

  // ---- lobby ----
  initLobby() {
    this.lobby = { slots: [null, null, null, null], countdown: 0, msg: '' };
  }
  updateLobby(dt) {
    const g = this.g, inp = g.input, L = this.lobby; if (!L) return this.initLobby();
    const joined = L.slots.filter(Boolean);
    // join
    for (const dev of inp.pollJoin()) {
      if (L.slots.some((s) => s && s.dev === dev)) continue;
      const i = L.slots.findIndex((s) => !s); if (i < 0) continue;
      const gi = GOD_IDS[(i) % 3];
      L.slots[i] = { dev, god: gi, ready: false, name: 'PLAYER ' + (i + 1) }; g.sfx('uiOk');
    }
    // per-slot nav
    let backAll = false;
    for (let i = 0; i < 4; i++) {
      const s = L.slots[i]; if (!s) continue;
      const nv = inp.deviceNav(s.dev);
      if (s.justJoined) { s.justJoined = false; continue; }
      if (nv.left && !s.ready) { s.god = GOD_IDS[(GOD_IDS.indexOf(s.god) + 2) % 3]; g.sfx('ui'); }
      if (nv.right && !s.ready) { s.god = GOD_IDS[(GOD_IDS.indexOf(s.god) + 1) % 3]; g.sfx('ui'); }
      if (nv.ok && s.joinedT > 0.25) { s.ready = !s.ready; g.sfx(s.ready ? 'uiOk' : 'uiBack'); }
      if (nv.back) { if (s.ready) s.ready = false; else { L.slots[i] = null; g.sfx('uiBack'); } }
      s.joinedT = (s.joinedT || 0) + dt;
    }
    const nav = inp.menuNav();
    const j2 = L.slots.filter(Boolean);
    if (j2.length === 0 && nav.back) { this.pop(); return; }
    if (j2.length > 0 && j2.every((s) => s.ready)) { L.countdown += dt; if (L.countdown > 1.4) { g.beginMatch(L.slots); L.countdown = 0; } } else L.countdown = 0;
    L.msg = inp.connectMsgs.length ? inp.connectMsgs.shift() : L.msg;
  }

  // ---------------- playing overlays ----------------
  updatePlaying(dt, nav) {
    const g = this.g, m = g.match;
    if (g.paused) {
      if (!this.pauseMenu) this.buildPause();
      if (this.screen === 'options') { this.optionsMenu.update(nav, this.mouse, g); if (nav.back) this.pop(); }
      else if (this.screen === 'controls') this.updateControls(nav);
      else if (this.screen === 'howto') { if (nav.left) this.howPage = (this.howPage + HOWTO.length - 1) % HOWTO.length; if (nav.right || nav.ok) this.howPage = (this.howPage + 1) % HOWTO.length; if (nav.back) this.pop(); }
      else { this.pauseMenu.update(nav, this.mouse, g); if (nav.back || nav.pause) { g.resume(); } }
      this.mouse.moved = false; return;
    }
    if (m.phase === 'upgrade') this.updateUpgrade(dt);
    if (m.phase === 'end') this.updateEnd(dt, nav);
    if (m.tut && m.tut.done) {
      if (!this.tutMenu) this.tutMenu = new Menu([
        { type: 'button', label: 'PLAY A MATCH', onOk: () => { g.quitToTitle(); this.push('setup'); } },
        { type: 'button', label: 'REPLAY TUTORIAL', onOk: () => { this.tutMenu = null; g.startTutorial(); } },
        { type: 'button', label: 'BACK TO TITLE', onOk: () => { this.tutMenu = null; g.quitToTitle(); } },
      ]);
      this.tutMenu.update(nav, this.mouse, g);
    } else this.tutMenu = null;
    this.mouse.moved = false;
  }
  buildPause() {
    const g = this.g;
    const tut = g.match && g.match.tut && !g.match.tut.done;
    this.pauseMenu = new Menu([
      { type: 'button', label: 'RESUME', onOk: () => g.resume() },
      ...(tut ? [{ type: 'button', label: 'SKIP THIS STEP', onOk: () => { g.match.tut.skip(); g.resume(); } }] : []),
      { type: 'button', label: 'OPTIONS', onOk: () => this.push('options') },
      { type: 'button', label: 'HOW TO PLAY', onOk: () => { this.howPage = 0; this.push('howto'); } },
      { type: 'button', label: 'QUIT TO TITLE', onOk: () => g.quitToTitle() },
    ]);
    this.stack = ['pause'];
  }

  // ---- upgrade screen ----
  updateUpgrade(dt) {
    const g = this.g, m = g.match, inp = g.input;
    for (const p of m.players) {
      if (!p.human || p.upgradeReady) continue;
      const nv = inp.deviceNav(p.device);
      let st = this.upSel.get(p); if (!st) { st = { sel: 0 }; this.upSel.set(p, st); }
      const n = p === m.heroPlayer ? 1 : 4;
      if (nv.up) st.sel = (st.sel + n - 1) % n; if (nv.down) st.sel = (st.sel + 1) % n;
      if (nv.ok) {
        if (p === m.heroPlayer || st.sel === 3) { p.upgradeReady = true; g.sfx('uiOk'); }
        else if (m.evolve(p, st.sel)) g.sfx('levelup'); else g.sfx('uiBack');
      }
    }
  }
  updateEnd(dt, nav) {
    const g = this.g;
    if (!this.endMenu) this.endMenu = new Menu([
      { type: 'button', label: 'PLAY AGAIN', onOk: () => g.playAgain() },
      { type: 'button', label: 'RETURN TO LOBBY', onOk: () => g.returnToLobby() },
      { type: 'button', label: 'TITLE SCREEN', onOk: () => g.quitToTitle() },
    ]);
    if (g.match.phaseT > 3) this.endMenu.update(nav, this.mouse, g);
  }

  // ---------------- draw ----------------
  draw(ctx, W, H, t) {
    const g = this.g;
    ctx.imageSmoothingEnabled = false;
    if (g.screen === 'playing') return this.drawPlaying(ctx, W, H, t);
    switch (this.screen) {
      case 'title': this.drawTitle(ctx, W, H, t); break;
      case 'setup': this.drawBG(ctx, W, H, 0.7); this.drawSetup(ctx, W, H, t); break;
      case 'lobby': this.drawBG(ctx, W, H, 0.8); this.drawLobby(ctx, W, H, t); break;
      case 'howto': this.drawBG(ctx, W, H, 0.85); this.drawHowTo(ctx, W, H, t); break;
      case 'options': this.drawBG(ctx, W, H, 0.85); this.drawOptions(ctx, W, H, t); break;
      case 'controls': this.drawBG(ctx, W, H, 0.9); this.drawControls(ctx, W, H, t); break;
      case 'credits': this.drawBG(ctx, W, H, 0.85); this.drawCredits(ctx, W, H, t); break;
      default: break;
    }
  }
  drawBG(ctx, W, H, dark) { ctx.drawImage(this.g.bgCanvas, 0, 0, W, H); ctx.fillStyle = `rgba(4,2,4,${dark})`; ctx.fillRect(0, 0, W, H); }
  logo(ctx, W, y, t, scale = 5) {
    const text = 'GRAVEWARD';
    const w = textWidth(text, scale);
    const x = Math.round(W / 2 - w / 2);
    for (let i = 0; i < 6; i++) drawText(ctx, text, x, y + i, '#3a0608', scale, { shadow: null });
    drawText(ctx, text, x, y, '#c02020', scale, { shadow: null });
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, 7 * scale); ctx.clip(); drawText(ctx, text, x, y - 2, '#ff6a3a', scale, { shadow: null }); ctx.restore();
    drawText(ctx, text, x, y, '#d43a28', scale, { shadow: null });
    // drips
    ctx.fillStyle = '#a01418';
    for (let i = 0; i < 9; i++) { const dx = x + 8 + i * (w / 9) + (i % 2) * 4, len = 6 + ((i * 7 + Math.floor(t * 0.7)) % 5) * 3 + Math.sin(t * 1.3 + i) * 3; ctx.fillRect(Math.round(dx), y + 7 * scale - 2, 3, Math.round(len)); ctx.fillRect(Math.round(dx) - 1, y + 7 * scale - 2 + Math.round(len), 5, 3); }
  }
  drawTitle(ctx, W, H, t) {
    ctx.drawImage(this.g.bgCanvas, 0, 0, W, H);
    const g2 = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.9); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,0.75)'); ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
    this.logo(ctx, W, Math.round(H * 0.11), t, Math.round(W / 96));
    drawText(ctx, 'A LOCAL GAME OF HERO AND HAUNT', W / 2, Math.round(H * 0.11) + 7 * Math.round(W / 96) + 30, '#c8b090', 1, { align: 'center' });
    this.mainMenu.draw(ctx, W / 2, Math.round(H * 0.58), t, { lineH: 16, width: 160 });
    drawText(ctx, '1-4 PLAYERS  -  SPLIT SCREEN  -  KEYBOARD, MOUSE, GAMEPAD', W / 2, H - 22, C.dim, 1, { align: 'center' });
    const ps = this.g.input.padStatus();
    const msg = ps === 'blocked' ? 'THIS PAGE BLOCKS CONTROLLERS. OPEN THE GAME IN ITS OWN TAB' : ps === 'none' ? 'NO CONTROLLER SEEN YET. PLUG IN, THEN PRESS A BUTTON' : 'CONTROLLER FOUND: ' + ps.slice(3).replace(/\s*\(.*$/, '').slice(0, 30).toUpperCase() + '. D-PAD + A TO CHOOSE';
    drawText(ctx, msg, W / 2, H - 11, ps === 'blocked' ? '#e05a4a' : ps === 'none' ? '#8a7a60' : '#7ad07a', 1, { align: 'center' });
  }
  drawSetup(ctx, W, H, t) {
    panel(ctx, W / 2 - 150, 20, 300, H - 40, C.bg);
    drawText(ctx, 'NEW MATCH', W / 2, 30, C.gold, 2, { align: 'center' });
    this.setupMenu.draw(ctx, W / 2, 58, t, { lineH: 15, width: 260 });
    drawText(ctx, 'HUMANS JOIN NEXT. EMPTY SLOTS ARE FILLED BY BOTS.', W / 2, H - 34, C.dim, 1, { align: 'center' });
  }
  drawLobby(ctx, W, H, t) {
    const L = this.lobby || (this.initLobby(), this.lobby);
    drawText(ctx, 'THE LOBBY', W / 2, 8, C.gold, 2, { align: 'center' });
    drawText(ctx, 'PRESS SPACE / CLICK (KEYBOARD 1), ENTER (KEYBOARD 2) OR A (GAMEPAD) TO JOIN', W / 2, 26, C.dim, 1, { align: 'center' });
    const cw = Math.floor((W - 20) / 4) - 4;
    for (let i = 0; i < 4; i++) {
      const x = 10 + i * (cw + 5), y = 40, h = H - 76, s = L.slots[i];
      panel(ctx, x, y, cw, h, 'rgba(10,6,8,0.85)', s ? (s.ready ? '#60c060' : '#a08040') : '#3a3030');
      drawText(ctx, 'P' + (i + 1), x + 4, y + 4, ['#e0463c', '#3c8ae0', '#3cc060', '#d8b030'][i], 2);
      if (!s) {
        drawText(ctx, 'BOT / EMPTY', x + cw / 2, y + h / 2 - 6, '#5a4a4a', 1, { align: 'center' });
        drawText(ctx, 'PRESS TO JOIN', x + cw / 2, y + h / 2 + 6, Math.sin(t * 4) > 0 ? '#c8b090' : '#7a6a5a', 1, { align: 'center' });
        continue;
      }
      const god = GODS[s.god];
      drawText(ctx, DEVICE_NAMES[s.dev], x + cw / 2, y + 22, C.dim, 1, { align: 'center' });
      drawText(ctx, (s.ready ? '' : '< ') + god.name.toUpperCase() + (s.ready ? '' : ' >'), x + cw / 2, y + 36, god.color, 1, { align: 'center' });
      wrapText(god.title.toUpperCase(), Math.floor((cw - 6) / 6)).slice(0, 2).forEach((ln, k) => drawText(ctx, ln, x + cw / 2, y + 45 + k * 8, C.dim, 1, { align: 'center' }));
      god.roster.forEach((id, k) => { const f = S.monsterFrame(MONSTERS[id].sprite, 0, 'idle', Math.floor(t * 1.5) % 2); const bx = x + 6 + k * Math.floor((cw - 8) / 3), bw = Math.floor((cw - 8) / 3) - 2; ctx.fillStyle = '#12101c'; ctx.fillRect(bx, y + 60, bw, 40); const sc = Math.min((bw - 2) / f.w, 38 / f.h); const dw = f.w * sc, dh = f.h * sc; ctx.drawImage(frameCanvas(f), bx + (bw - dw) / 2, y + 60 + 39 - dh, dw, dh); drawText(ctx, MONSTERS[id].names[0].split(' ').pop().toUpperCase().slice(0, Math.max(4, Math.floor(bw / 6))), bx + bw / 2, y + 102, C.text, 1, { align: 'center' }); });
      const lines = wrapText(god.passive.toUpperCase(), Math.floor((cw - 8) / 6));
      lines.slice(0, 5).forEach((ln, k) => drawText(ctx, ln, x + 5, y + 114 + k * 8, '#b0a090', 1));
      drawText(ctx, s.ready ? 'READY!' : 'PRESS OK TO READY', x + cw / 2, y + h - 12, s.ready ? '#60e060' : Math.sin(t * 5) > 0 ? '#ffe8a8' : '#a09070', 1, { align: 'center' });
    }
    const joined = L.slots.filter(Boolean).length;
    const total = this.g.settings.totalPlayers;
    drawText(ctx, `${joined} HUMAN${joined === 1 ? '' : 'S'} + ${Math.max(0, total - joined)} BOT${total - joined === 1 ? '' : 'S'}  -  ${this.g.settings.floors} FLOORS  -  ${this.g.settings.botSkill.toUpperCase()} BOTS`, W / 2, H - 30, C.text, 1, { align: 'center' });
    if (joined > total) drawText(ctx, 'MORE HUMANS THAN TOTAL PLAYERS: RAISE THE TOTAL IN SETUP', W / 2, H - 20, '#e05050', 1, { align: 'center' });
    else if (L.countdown > 0) drawText(ctx, 'STARTING...', W / 2, H - 20, '#ffe080', 1, { align: 'center' });
    else drawText(ctx, joined ? 'EVERYONE READY TO BEGIN. BACKSPACE / B TO LEAVE' : 'WAITING FOR PLAYERS (ESC TO GO BACK)', W / 2, H - 20, C.dim, 1, { align: 'center' });
    if (L.msg) drawText(ctx, L.msg, W / 2, H - 10, '#80a0e0', 1, { align: 'center' });
  }
  drawHowTo(ctx, W, H, t) {
    panel(ctx, 30, 14, W - 60, H - 28, C.bg);
    const [title, lines] = HOWTO[this.howPage];
    drawText(ctx, title, W / 2, 24, C.gold, 2, { align: 'center' });
    let y = 48;
    if (!lines) {
      const rows = [['MOVE', 'move'], ['LOOK', 'look'], ['ATTACK (HOLD: HEAVY)', 'attack'], ['BLOCK / ABILITY 2', 'alt'], ['DODGE ROLL', 'dodge'], ['INTERACT / POSSESS', 'interact'], ['CAST SPELL / ABILITY 3', 'spell'], ['NEXT SPELL / HAUNT JUMP', 'spellNext'], ['USE POTION', 'potion'], ['NEXT POTION', 'potionNext'], ['SWAP WEAPON', 'swap'], ['SPRINT', 'sprint']];
      const cx1 = 44, cx2 = Math.round(W * 0.5), cx3 = Math.round(W * 0.74);
      drawText(ctx, 'ACTION', cx1, y, C.dim, 1); drawText(ctx, 'KEYBOARD 1', cx2, y, C.dim, 1); drawText(ctx, 'XBOX PAD', cx3, y, C.dim, 1); y += 11;
      const g = this.g, fake = (d) => ({ device: d });
      for (const [name, act] of rows) {
        const kb = g.labelFor(fake('kbm1'), act).split(' / ')[0], pad = g.labelFor(fake('pad0'), act);
        drawText(ctx, name, cx1, y, C.text, 1); drawText(ctx, kb, cx2, y, C.gold, 1); drawText(ctx, pad, cx3, y, '#a8d8ff', 1); y += 10;
      }
      drawText(ctx, 'PAUSE: TAB OR ESC / MENU BUTTON.  REBIND IN OPTIONS.', W / 2, y + 6, C.dim, 1, { align: 'center' });
      drawText(ctx, 'USING A PAD? PLUG IT IN AND PRESS ANY BUTTON ONCE.', W / 2, y + 17, C.dim, 1, { align: 'center' });
    } else
    for (const ln of lines) { for (const w of wrapText(ln, Math.floor((W - 90) / 6))) { drawText(ctx, w, 44, y, C.text, 1); y += 10; } y += 5; }
    drawText(ctx, `PAGE ${this.howPage + 1}/${HOWTO.length}   LEFT/RIGHT TO TURN PAGE   ESC TO CLOSE`, W / 2, H - 24, C.dim, 1, { align: 'center' });
  }
  drawOptions(ctx, W, H, t) {
    panel(ctx, W / 2 - 150, 6, 300, H - 12, C.bg);
    drawText(ctx, 'OPTIONS', W / 2, 12, C.gold, 2, { align: 'center' });
    this.optionsMenu.draw(ctx, W / 2, 30, t, { lineH: 11, width: 270 });
  }
  drawControls(ctx, W, H, t) {
    panel(ctx, W / 2 - 170, 4, 340, H - 8, C.bg);
    drawText(ctx, 'CONTROLS', W / 2, 8, C.gold, 2, { align: 'center' });
    const b = this.g.settings.bindings[this.controlsDev === 'pad0' ? 'pad' : this.controlsDev];
    ACTIONS.forEach(([id, label], i) => {
      const y = 27 + i * 10, sel = this.ctrlSel === i;
      if (sel) { ctx.fillStyle = 'rgba(120,20,20,0.55)'; ctx.fillRect(W / 2 - 160, y - 2, 320, 10); }
      drawText(ctx, label.toUpperCase(), W / 2 - 154, y, sel ? C.hi : C.text, 1);
      const v = (b[id] || []).map(keyLabel).join(' / ') || (this.controlsDev === 'pad0' && (id === 'fwd' || id === 'back' || id === 'strafeL' || id === 'strafeR') ? 'LEFT STICK' : this.controlsDev === 'pad0' && (id === 'turnL' || id === 'turnR') ? 'RIGHT STICK' : '-');
      drawText(ctx, sel && this.rebinding ? 'PRESS A KEY...' : v, W / 2 + 154, y, sel ? C.hi : C.gold, 1, { align: 'right' });
    });
    const y0 = 27 + ACTIONS.length * 10;
    const items = [['DEVICE: ' + DEVICE_NAMES[this.controlsDev] + '  (LEFT/RIGHT)', ACTIONS.length], ['RESET ALL TO DEFAULTS', ACTIONS.length + 1], ['DONE', ACTIONS.length + 2]];
    items.forEach(([l, idx], k) => { const y = y0 + 5 + k * 11, sel = this.ctrlSel === idx; if (sel) { ctx.fillStyle = 'rgba(120,20,20,0.55)'; ctx.fillRect(W / 2 - 160, y - 2, 320, 10); } drawText(ctx, l, W / 2, y, sel ? C.hi : C.text, 1, { align: 'center' }); });
    drawText(ctx, 'PLAYER 2 USES THE RIGHT-HAND KEYS. PAD: STICKS MOVE/LOOK.', W / 2, H - 13, C.dim, 1, { align: 'center' });
  }
  drawCredits(ctx, W, H, t) {
    const lines = ['GRAVEWARD', '', 'A DARK, GRITTY, PIXELATED DUNGEON CRAWLER', 'INSPIRED BY THE HERO-AND-GHOST STRUCTURE OF CRAWL', '', 'ALL ART, SOUND AND MUSIC ARE GENERATED IN CODE', 'NO EXTERNAL ASSETS. ZERO DEPENDENCIES.', '', 'ENGINE: CUSTOM SOFTWARE RAYCASTER', 'AUDIO: WEB AUDIO API SYNTHESIS', '', 'BUILT WITH CLAUDE CODE', '', 'THANK YOU FOR PLAYING'];
    lines.forEach((ln, i) => drawText(ctx, ln, W / 2, H - ((this.creditsT * 14) % (H + lines.length * 14)) + i * 14, i === 0 ? '#d43a28' : C.text, i === 0 ? 3 : 1, { align: 'center' }));
    drawText(ctx, 'ESC TO RETURN', W / 2, H - 10, C.dim, 1, { align: 'center' });
  }

  // ---------------- playing overlays ----------------
  drawPlaying(ctx, W, H, t) {
    const g = this.g, m = g.match;
    if (m.phase === 'upgrade') this.drawUpgrade(ctx, W, H, t);
    else if (m.phase === 'end') this.drawEnd(ctx, W, H, t);
    if (m.tut && m.tut.done && !g.paused && this.tutMenu) {
      ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, 0, W, H);
      panel(ctx, W / 2 - 110, H / 2 - 62, 220, 124, C.bg);
      drawText(ctx, 'TUTORIAL COMPLETE', W / 2, H / 2 - 54, C.gold, 2, { align: 'center' });
      drawText(ctx, 'YOU KNOW THE BASICS. NOW GO HAUNT SOMEONE.', W / 2, H / 2 - 34, C.dim, 1, { align: 'center' });
      this.tutMenu.draw(ctx, W / 2, H / 2 - 16, t, { lineH: 16, width: 170 });
    }
    if (g.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
      const s = this.screen;
      if (s === 'options') { this.drawOptions(ctx, W, H, t); return; }
      if (s === 'controls') { this.drawControls(ctx, W, H, t); return; }
      if (s === 'howto') { this.drawHowTo(ctx, W, H, t); return; }
      if (!this.pauseMenu) this.buildPause();
      panel(ctx, W / 2 - 80, H / 2 - 50, 160, 100, C.bg);
      drawText(ctx, 'PAUSED', W / 2, H / 2 - 42, C.gold, 2, { align: 'center' });
      this.pauseMenu.draw(ctx, W / 2, H / 2 - 18, t, { lineH: 15, width: 140 });
    }
  }

  drawUpgrade(ctx, W, H, t) {
    const m = this.g.match;
    ctx.fillStyle = 'rgba(4,2,8,0.97)'; ctx.fillRect(0, 0, W, H);
    drawText(ctx, 'THE DESCENT', W / 2, 8, C.gold, 2, { align: 'center' });
    drawText(ctx, 'EVOLVE YOUR MONSTERS WITH WRATH. THE HERO GROWS; SO DO THE HAUNTED.', W / 2, 26, C.dim, 1, { align: 'center' });
    bar(ctx, W / 2 - 60, 36, 120, 3, m.upgradeT / 50, '#c08030', '#201008');
    const cw = Math.floor((W - 16) / 4) - 4;
    m.players.forEach((p, i) => {
      const x = 8 + i * (cw + 4), y = 46, h = H - 56;
      panel(ctx, x, y, cw, h, 'rgba(12,8,14,0.9)', p.upgradeReady ? '#3a7a3a' : p.color);
      drawText(ctx, p.name.toUpperCase(), x + 4, y + 4, p.color, 1);
      drawText(ctx, p === m.heroPlayer ? 'HERO' : 'GHOST', x + cw - 4, y + 4, p === m.heroPlayer ? '#ffd060' : '#a0a0c0', 1, { align: 'right' });
      drawText(ctx, `LV${p.hero.level} XP${p.hero.xp}`, x + 4, y + 14, C.text, 1); drawText(ctx, '$' + p.hero.gold, x + cw - 4, y + 14, '#ffd860', 1, { align: 'right' });
      drawText(ctx, 'BLOOD ' + Math.round(p.ghost.blood), x + 4, y + 23, '#d05060', 1); drawText(ctx, 'WRATH ' + Math.round(p.ghost.wrath), x + 4, y + 32, '#e09040', 1);
      const god = GODS[p.godId];
      drawText(ctx, god.name.toUpperCase(), x + 4, y + 43, god.color, 1);
      const st = this.upSel.get(p) || { sel: 0 };
      const chars = Math.max(6, Math.floor((cw - 40) / 6));
      god.roster.forEach((id, k) => {
        const tier = p.ghost.tiers[k], by = y + 54 + k * 40;
        const sel = p.human && !p.upgradeReady && p !== m.heroPlayer && st.sel === k;
        ctx.fillStyle = sel ? 'rgba(120,20,20,0.5)' : 'rgba(20,16,26,0.8)'; ctx.fillRect(x + 3, by, cw - 6, 38);
        const f = S.monsterFrame(MONSTERS[id].sprite, tier, 'idle', Math.floor(t * 1.5) % 2); const sc = Math.min(28 / f.w, 34 / f.h); ctx.drawImage(frameCanvas(f), x + 5, by + 36 - f.h * sc, f.w * sc, f.h * sc);
        const nm = wrapText(MONSTERS[id].names[tier].toUpperCase(), chars).slice(0, 2);
        nm.forEach((ln, q) => drawText(ctx, ln, x + 36, by + 3 + q * 8, C.text, 1));
        for (let q = 0; q < 3; q++) { ctx.fillStyle = q <= tier ? '#e0c040' : '#3a3220'; ctx.fillRect(x + 36 + q * 8, by + 20, 6, 4); }
        if (tier < 2) { const c = EVOLVE_COST[tier + 1]; const ok = m.canEvolve(p, k); drawText(ctx, `${c.wrath}W${c.blood ? ' ' + c.blood + 'B' : ''}`, x + 36 + 28, by + 19, ok ? '#80e080' : '#806060', 1); if (sel) drawText(ctx, ok ? 'OK: EVOLVE' : 'NEED MORE', x + 36, by + 28, ok ? '#ffe080' : '#a05050', 1); }
        else drawText(ctx, 'MAX', x + 36 + 28, by + 19, '#e0c040', 1);
      });
      if (p === m.heroPlayer) { drawText(ctx, p.hero.weapons[p.hero.weaponIdx].name.toUpperCase().slice(0, Math.floor((cw - 8) / 6)), x + 4, y + h - 38, C.text, 1); drawText(ctx, 'ARTIFACTS: ' + p.hero.artifacts.length, x + 4, y + h - 29, C.text, 1); }
      const rdy = p.upgradeReady;
      const isSel = p.human && !rdy && (p === m.heroPlayer || st.sel === 3);
      ctx.fillStyle = isSel ? 'rgba(120,20,20,0.6)' : 'rgba(30,30,30,0.6)'; ctx.fillRect(x + 3, y + h - 18, cw - 6, 14);
      drawText(ctx, rdy ? 'READY' : p.human ? 'CONTINUE' : 'BOT THINKING', x + cw / 2, y + h - 15, rdy ? '#60e060' : isSel ? C.hi : C.dim, 1, { align: 'center' });
    });
  }

  drawEnd(ctx, W, H, t) {
    const m = this.g.match, info = m.endInfo; if (!info) return;
    const a = clamp(m.phaseT / 2, 0, 1);
    ctx.fillStyle = `rgba(4,2,4,${0.97 * a})`; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a;
    const win = info.result === 'victory';
    drawText(ctx, win ? 'VICTORY' : 'DEVOURED', W / 2, 10, win ? '#ffd060' : '#c02020', 4, { align: 'center', outline: '#000' });
    drawText(ctx, win ? `${info.winner.name.toUpperCase()} SLEW THE BOSS AND CLAIMS THE TOMB` : 'THE THIRD SEAL BREAKS. THE BEAST WALKS THE EARTH. EVERYONE LOSES.', W / 2, 42, C.text, 1, { align: 'center' });
    drawText(ctx, `TIME ${Math.floor(info.time / 60)}:${String(Math.floor(info.time % 60)).padStart(2, '0')}   HERO SWAPS ${m.stats.swaps}   ROOMS CLEARED ${m.stats.roomsCleared}   BOSS ATTEMPTS ${info.attempts + (win ? 1 : 0)}`, W / 2, 54, C.dim, 1, { align: 'center' });
    panel(ctx, 24, 68, W - 48, 100, 'rgba(12,8,10,0.85)');
    drawText(ctx, 'RANK   PLAYER      LV   KILLS  KILLING BLOWS  BLOOD  SCORE', 32, 74, C.gold, 1);
    info.rankings.forEach((r, i) => {
      const p = r.player, y = 88 + i * 18;
      drawText(ctx, '#' + r.rank, 32, y, '#ffd060', 1); ctx.fillStyle = p.color; ctx.fillRect(62, y - 1, 5, 9);
      drawText(ctx, p.name.toUpperCase().slice(0, 10), 72, y, p.color, 1);
      drawText(ctx, String(p.hero.level), 156, y, C.text, 1); drawText(ctx, String(p.stats.monsterKills), 196, y, C.text, 1); drawText(ctx, String(p.stats.killingBlows), 262, y, C.text, 1);
      drawText(ctx, String(Math.round(p.ghost.blood)), 322, y, '#d04050', 1); drawText(ctx, String(r.score), 372, y, '#ffe080', 1);
      if (win && p === info.winner) drawText(ctx, 'WINNER', W - 40, y, '#ffd060', 1, { align: 'right' });
    });
    ctx.globalAlpha = 1;
    if (m.phaseT > 3 && this.endMenu) this.endMenu.draw(ctx, W / 2, H - 60, t, { lineH: 15, width: 160 });
  }
}
