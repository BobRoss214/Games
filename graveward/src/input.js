// Input: keyboard+mouse (P1), second keyboard scheme (P2), gamepads (Xbox layout) with hot-plug, rebinding.
import { clamp } from './util.js';

export const ACTIONS = [
  ['fwd', 'Move forward'], ['back', 'Move back'], ['strafeL', 'Strafe left'], ['strafeR', 'Strafe right'], ['turnL', 'Turn left'], ['turnR', 'Turn right'],
  ['attack', 'Attack / fire'], ['alt', 'Block / ability 2'], ['dodge', 'Dodge roll'], ['interact', 'Interact / possess'], ['spell', 'Cast spell / ability 3'],
  ['spellNext', 'Next spell / haunt jump'], ['potion', 'Use potion'], ['potionNext', 'Next potion'], ['swap', 'Swap weapon'], ['sprint', 'Sprint'], ['autorun', 'Auto-walk forward on/off'], ['autorunBack', 'Auto-walk backward on/off'],
];
export const DEFAULT_BINDINGS = {
  kbm1: { fwd: ['KeyW'], back: ['KeyS'], strafeL: ['KeyA'], strafeR: ['KeyD'], turnL: ['KeyJ'], turnR: ['KeyL'], attack: ['Mouse0'], alt: ['Mouse2'], dodge: ['Space'], interact: ['KeyE'], spell: ['KeyR'], spellNext: ['KeyT'], potion: ['KeyQ'], potionNext: ['KeyG'], swap: ['KeyX'], sprint: ['ShiftLeft'], autorun: ['KeyF'], autorunBack: ['KeyV'] },
  kb2: { fwd: ['ArrowUp'], back: ['ArrowDown'], strafeL: ['Comma'], strafeR: ['Period'], turnL: ['ArrowLeft'], turnR: ['ArrowRight'], attack: ['Enter'], alt: ['ShiftRight'], dodge: ['Slash'], interact: ['Quote'], spell: ['Semicolon'], spellNext: ['BracketLeft'], potion: ['KeyP'], potionNext: ['BracketRight'], swap: ['Backslash'], sprint: ['ControlRight'], autorun: ['KeyO'], autorunBack: ['KeyI'] },
  pad: { attack: [7], alt: [6], dodge: [1], interact: [0], spell: [2], potion: [3], swap: [4], spellNext: [5], sprint: [10], potionNext: [11] },
};
export const DEVICE_NAMES = { kbm1: 'KEYBOARD + MOUSE', kb2: 'KEYBOARD 2', pad0: 'GAMEPAD 1', pad1: 'GAMEPAD 2', pad2: 'GAMEPAD 3', pad3: 'GAMEPAD 4' };

// Xbox-layout names for the browser's "standard" gamepad mapping (also fine for most other pads)
export const PAD_BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'MENU', 'L STICK CLICK', 'R STICK CLICK', 'D-PAD UP', 'D-PAD DOWN', 'D-PAD LEFT', 'D-PAD RIGHT'];
export function keyLabel(code) {
  if (typeof code === 'number') return PAD_BUTTON_NAMES[code] || 'PAD BTN ' + code;
  return code.replace('Key', '').replace('Digit', '').replace('Arrow', 'ARROW ').replace('Mouse0', 'LEFT CLICK').replace('Mouse2', 'RIGHT CLICK').replace('Mouse1', 'MIDDLE CLICK').replace('ShiftLeft', 'L SHIFT').replace('ShiftRight', 'R SHIFT').replace('ControlRight', 'R CTRL').replace('ControlLeft', 'L CTRL').replace('Bracket', 'BRKT ').replace('Semicolon', ';').replace('Quote', "'").replace('Comma', ',').replace('Period', '.').replace('Slash', '/').replace('Backslash', '\\').replace('Space', 'SPACE');
}

export class Input {
  constructor(settings) {
    this.s = settings; this.keys = new Set(); this.down = new Set(); this.up = new Set(); this.mouseDX = 0; this.mouseDY = 0; this.locked = false; this.lockFailed = false; this.mouseEvents = 0; this.lastMoveAt = 0; this.lastMove = [0, 0]; this.diag = false;
    this.pads = [null, null, null, null]; this.padPrev = [null, null, null, null]; this.padEdges = [new Set(), new Set(), new Set(), new Set()];
    this.listeners = []; this.rebind = null; this.lastAnyKey = null; this.connectMsgs = [];
    this.mx = 0.5; this.my = 0.5; this.mouseIn = false; this.kb2InUse = false; // cursor over the canvas (0..1); arrow keys belong to Keyboard 2 when it is playing
    this.frameId = 0; this.sourceMap = new Map(); // every display frame, each device source takes the button presses of that frame (even when no simulation step runs)
    this.devices = new Map(); // devId -> DeviceState
    this.menuHeld = {};
  }
  attach(canvas) {
    this.canvas = canvas;
    const on = (t, e, f, o) => { t.addEventListener(e, f, o); this.listeners.push([t, e, f, o]); };
    on(window, 'keydown', (e) => {
      if (e.code === 'F3' && !e.repeat) { this.diag = !this.diag; e.preventDefault(); return; }
      if (e.repeat) { if (this.captureKeys(e)) e.preventDefault(); return; }
      if (this.rebind) { this.rebind(e.code); this.rebind = null; e.preventDefault(); return; }
      this.keys.add(e.code); this.down.add(e.code); this.lastAnyKey = e.code; this.lastDevice = 'kbm1';
      if (this.captureKeys(e)) e.preventDefault();
    });
    on(window, 'keyup', (e) => { this.keys.delete(e.code); this.up.add(e.code); });
    on(window, 'blur', () => { this.keys.clear(); });
    on(canvas, 'mousedown', (e) => {
      if (this.rebind) { this.rebind('Mouse' + e.button); this.rebind = null; e.preventDefault(); return; }
      this.clickedAt = performance.now(); this.lastDevice = 'kbm1'; this.keys.add('Mouse' + e.button); this.down.add('Mouse' + e.button); this.lastAnyKey = 'Mouse' + e.button; this.canvas.focus && this.canvas.focus(); e.preventDefault();
    });
    on(window, 'mouseup', (e) => { this.keys.delete('Mouse' + e.button); this.up.add('Mouse' + e.button); });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'mousemove', (e) => { const r = canvas.getBoundingClientRect(); if (r.width > 0) { this.mx = (e.clientX - r.left) / r.width; this.my = (e.clientY - r.top) / r.height; this.mouseIn = true; } });
    on(canvas, 'mouseleave', () => { this.mouseIn = false; });
    // captured mouse: raw movement turns the camera. Not captured (embedded pages often block pointer lock): the cursor still turns the camera
    // while it is over the game, and pushing it into a screen edge keeps turning (see edgeTurn).
    on(document, 'mousemove', (e) => { this.mouseEvents++; this.lastMoveAt = performance.now(); this.lastMove = [e.movementX, e.movementY]; if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } else if (this.mouseIn && this.s.edgeLook) { this.mouseDX += e.movementX * 1.6; } });
    on(document, 'pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (this.locked) this.lockFailed = false; });
    on(document, 'pointerlockerror', () => { if (performance.now() - (this.clickedAt || -1e9) < 1500) this.lockFailed = true; }); // only a refusal right after a click means the page really blocks it
    on(window, 'gamepadconnected', (e) => this.connectMsgs.push('Gamepad ' + (e.gamepad.index + 1) + ' connected'));
    on(window, 'gamepaddisconnected', (e) => this.connectMsgs.push('Gamepad ' + (e.gamepad.index + 1) + ' disconnected'));
  }
  captureKeys(e) { return /^(Arrow|Space|Tab|Slash|Quote|Backslash|Bracket|Comma|Period|Semicolon)/.test(e.code) || e.code === 'Enter' || e.code === 'Escape' && false; }
  requestLock() { if (this.canvas && this.canvas.requestPointerLock && !this.locked) { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } } }
  releaseLock() { if (this.locked && document.exitPointerLock) document.exitPointerLock(); }

  // ---- per-frame ----
  beginFrame() {
    this.frameId++;
    let list = [];
    try { list = (navigator.getGamepads ? navigator.getGamepads() : []) || []; this.padBlocked = !navigator.getGamepads; } catch (e) { this.padBlocked = true; } // throws SecurityError when an embedding page blocks gamepads
    for (let i = 0; i < 4; i++) {
      const g = list[i]; const prev = this.pads[i];
      this.padPrev[i] = prev; this.padEdges[i].clear();
      if (g && g.connected) {
        const cur = { axes: Array.from(g.axes), buttons: g.buttons.map((b) => b.pressed || b.value > 0.5), vals: g.buttons.map((b) => b.value), id: g.id };
        if (prev) cur.buttons.forEach((b, k) => { if (b && !prev.buttons[k]) this.padEdges[i].add(k); });
        else cur.buttons.forEach((b, k) => { if (b) this.padEdges[i].add(k); });
        this.pads[i] = cur;
        if (prev && this.padEdges[i].size) this.lastDevice = 'pad' + i;
      } else this.pads[i] = null;
    }
  }
  // Called at the end of every display frame. Presses and releases from this frame are latched into each device's pending set
  // (a no-op if a simulation step already took them), then the per-frame sets are cleared. Mouse movement is NOT cleared here:
  // it waits in mouseDX until a simulation step uses it, so a fast monitor (many frames per step) never drops turning.
  endFrame() { for (const s of this.sourceMap.values()) s.take(); this.down.clear(); this.up.clear(); }
  // paused / in menus: forget anything pending so it cannot fire when play resumes
  clearPending() { this.mouseDX = 0; this.mouseDY = 0; for (const s of this.sourceMap.values()) s.clear(); }
  padStatus() { // 'blocked' | 'none' | 'ok:<pad id>'
    if (this.padBlocked) return 'blocked';
    const i = this.connectedPads()[0];
    return i === undefined ? 'none' : 'ok:' + (this.pads[i].id || 'pad');
  }
  connectedPads() { return this.pads.map((p, i) => (p ? i : -1)).filter((i) => i >= 0); }

  // -1..1: how hard the cursor is pushed into the left/right edge zone while the mouse is NOT captured
  edgeTurn() {
    if (this.locked || !this.mouseIn || !this.s.edgeLook) return 0;
    const Z = 0.14, ramp = (d) => Math.min(1, Math.max(0, d / Z));
    const l = ramp(Z - this.mx), r = ramp(this.mx - (1 - Z));
    return (r * r - l * l) * 2.8;
  }

  keyDown(code) { return this.keys.has(code); }
  padAxis(i, a) { const p = this.pads[i]; if (!p) return 0; const v = p.axes[a] || 0; const dz = this.s.deadzone; return Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz); }
  padStick(i, ax, ay) { const x = this.padAxis(i, ax), y = this.padAxis(i, ay); return [x, y]; }

  // Which devices pressed a "join" button this frame
  pollJoin() {
    const out = [];
    if (this.down.has('Space') || this.down.has('Mouse0')) out.push('kbm1');
    if (this.down.has('Enter') || this.down.has('NumpadEnter')) out.push('kb2');
    for (let i = 0; i < 4; i++) if (this.padEdges[i].has(0) || this.padEdges[i].has(9)) out.push('pad' + i);
    return out;
  }

  bindingsFor(dev) { const b = this.s.bindings; return dev.startsWith('pad') ? b.pad : b[dev]; }

  // ---- intent source for a device (persistent state, edges accumulate until consumed) ----
  source(dev) {
    const st = { pending: {}, attackPrev: false, takenFrame: -1 };
    const isPad = dev.startsWith('pad'), pi = isPad ? +dev.slice(3) : -1;
    const EDGES = [['attackPressed', 'attack'], ['altPressed', 'alt'], ['dodge', 'dodge'], ['interact', 'interact'], ['spell', 'spell'], ['spellNext', 'spellNext'], ['potion', 'potion'], ['potionNext', 'potionNext'], ['swap', 'swap']];
    const src = {
      dev,
      // latch this display frame's presses/releases into st.pending, once per frame
      take: () => {
        if (st.takenFrame === this.frameId) return; st.takenFrame = this.frameId;
        const b = this.bindingsFor(dev);
        const edge = (act) => (b[act] || []).some((c) => (isPad ? this.padEdges[pi].has(c) : this.down.has(c)));
        const rel = (act) => (b[act] || []).some((c) => (isPad ? (this.pads[pi] && this.padPrev[pi] && !this.pads[pi].buttons[c] && this.padPrev[pi].buttons[c]) : this.up.has(c)));
        for (const [k, act] of EDGES) if (edge(act)) st.pending[k] = true;
        // laptop touchpads go dead while a key is held: latch walking (1 forward, -1 backward) so the hands can be free
        if (!isPad && edge('autorun')) st.auto = st.auto === 1 ? 0 : 1;
        if (!isPad && edge('autorunBack')) st.auto = st.auto === -1 ? 0 : -1;
        if (rel('attack')) st.pending.attackReleased = true;
      },
      clear: () => { st.pending = {}; st.auto = 0; },
      isAuto: () => st.auto || 0,
      poll: (dt) => {
        src.take();
        const b = this.bindingsFor(dev);
        const down = (act) => (b[act] || []).some((c) => (isPad ? (this.pads[pi] && this.pads[pi].buttons[c]) : this.keys.has(c)));
        const I = st.intent || (st.intent = {});
        let fwd = 0, strafe = 0, turnRate = 0, turn = 0;
        const sens = this.s.sensitivity, stickSens = this.s.stickSens;
        if (isPad) {
          const [lx, ly] = this.padStick(pi, 0, 1), [rx] = this.padStick(pi, 2, 3);
          fwd = -ly; strafe = lx; turnRate = rx * 3.4 * stickSens;
          const p = this.pads[pi]; if (p) { if (p.buttons[12]) fwd = 1; if (p.buttons[13]) fwd = -1; if (p.buttons[14]) strafe = -1; if (p.buttons[15]) strafe = 1; }
        } else {
          if ((down('back') && st.auto === 1) || (down('fwd') && st.auto === -1)) st.auto = 0; // the opposite key cancels it
          fwd = (down('fwd') ? 1 : 0) - (down('back') ? 1 : 0); if (st.auto && fwd === 0) fwd = st.auto; strafe = (down('strafeR') ? 1 : 0) - (down('strafeL') ? 1 : 0);
          turnRate = ((down('turnR') ? 1 : 0) - (down('turnL') ? 1 : 0)) * 2.4 * sens;
          if (dev === 'kbm1') {
            turn = Math.max(-300, Math.min(300, this.mouseDX)) * 0.0024 * sens; this.mouseDX = 0; this.mouseDY = 0;
            // arrow keys also turn, unless a second player is on Keyboard 2 (it uses the arrows)
            if (!this.kb2InUse) turnRate += ((this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0)) * 2.4 * sens;
            // no pointer lock (embedded page, or before the first click): pushing the cursor to the screen edges turns
            turnRate += this.edgeTurn() * sens;
          }
        }
        const attackNow = down('attack'), altNow = down('alt');
        const res = {
          fwd, strafe, turn, turnRate, attack: attackNow, alt: altNow, sprint: down('sprint'), interactHeld: down('interact'),
          attackPressed: !!st.pending.attackPressed, attackReleased: !!(st.pending.attackReleased || (st.attackPrev && !attackNow)),
          altPressed: !!st.pending.altPressed, dodge: !!st.pending.dodge, interact: !!st.pending.interact,
          spell: !!st.pending.spell, spellNext: !!st.pending.spellNext, potion: !!st.pending.potion,
          potionNext: !!st.pending.potionNext, swap: !!st.pending.swap, ability2: !!st.pending.spell, aimAngle: undefined,
        };
        st.attackPrev = attackNow;
        // pending edges persist until the sim consumes a tick (handles frames with zero sim ticks)
        for (const k of ['attackPressed', 'attackReleased', 'altPressed', 'dodge', 'interact', 'spell', 'spellNext', 'potion', 'potionNext', 'swap']) if (res[k]) st.pending[k] = true;
        st.last = res; return res;
      },
      consume: () => { st.pending = {}; },
    };
    this.sourceMap.set(dev, src);
    return src;
  }

  // ---- menu navigation (any device) ----
  menuNav() {
    const nav = { up: false, down: false, left: false, right: false, ok: false, back: false, any: false, tab: false };
    const d = this.down;
    if (d.has('ArrowUp') || d.has('KeyW')) nav.up = true; if (d.has('ArrowDown') || d.has('KeyS')) nav.down = true;
    if (d.has('ArrowLeft') || d.has('KeyA')) nav.left = true; if (d.has('ArrowRight') || d.has('KeyD')) nav.right = true;
    if (d.has('Enter') || d.has('Space') || d.has('NumpadEnter')) nav.ok = true; if (d.has('Escape') || d.has('Backspace')) nav.back = true;
    if (d.has('Tab')) nav.tab = true;
    for (let i = 0; i < 4; i++) {
      const p = this.pads[i]; if (!p) continue;
      const e = this.padEdges[i];
      if (e.has(12)) nav.up = true; if (e.has(13)) nav.down = true; if (e.has(14)) nav.left = true; if (e.has(15)) nav.right = true; if (e.has(0)) nav.ok = true; if (e.has(1)) nav.back = true; if (e.has(9)) nav.pause = true;
      // stick with repeat
      const [x, y] = this.padStick(i, 0, 1); const key = 'p' + i;
      const h = this.menuHeld[key] || (this.menuHeld[key] = { x: 0, y: 0, t: 0 });
      const dx = x > 0.6 ? 1 : x < -0.6 ? -1 : 0, dy = y > 0.6 ? 1 : y < -0.6 ? -1 : 0;
      if ((dx && dx !== h.x) || (dy && dy !== h.y)) { if (dy < 0) nav.up = true; if (dy > 0) nav.down = true; if (dx < 0) nav.left = true; if (dx > 0) nav.right = true; }
      h.x = dx; h.y = dy;
    }
    nav.any = nav.up || nav.down || nav.left || nav.right || nav.ok || nav.back;
    if (d.has('Escape') || nav.pause) nav.pause = true;
    return nav;
  }
  // Per-device navigation edges (used by the lobby so each player drives their own column)
  deviceNav(dev) {
    const n = { up: false, down: false, left: false, right: false, ok: false, back: false };
    const d = this.down;
    if (dev === 'kbm1') { n.up = d.has('KeyW'); n.down = d.has('KeyS'); n.left = d.has('KeyA'); n.right = d.has('KeyD'); n.ok = d.has('Space') || d.has('KeyE') || d.has('Mouse0'); n.back = d.has('Backspace') || d.has('Escape'); }
    else if (dev === 'kb2') { n.up = d.has('ArrowUp'); n.down = d.has('ArrowDown'); n.left = d.has('ArrowLeft'); n.right = d.has('ArrowRight'); n.ok = d.has('Enter') || d.has('NumpadEnter'); n.back = d.has('ShiftRight') || d.has('Slash'); }
    else if (dev.startsWith('pad')) {
      const i = +dev.slice(3); const e = this.padEdges[i]; if (!this.pads[i]) return n;
      n.up = e.has(12); n.down = e.has(13); n.left = e.has(14); n.right = e.has(15); n.ok = e.has(0); n.back = e.has(1);
      const [x, y] = this.padStick(i, 0, 1); const h = this.menuHeld['d' + i] || (this.menuHeld['d' + i] = { x: 0, y: 0 });
      const dx = x > 0.6 ? 1 : x < -0.6 ? -1 : 0, dy = y > 0.6 ? 1 : y < -0.6 ? -1 : 0;
      if (dx && dx !== h.x) { if (dx < 0) n.left = true; else n.right = true; } if (dy && dy !== h.y) { if (dy < 0) n.up = true; else n.down = true; }
      h.x = dx; h.y = dy;
    }
    return n;
  }
  pauseRequested() {
    if (this.down.has('Escape') || this.down.has('Tab')) return true;
    for (let i = 0; i < 4; i++) if (this.padEdges[i].has(9)) return true;
    return false;
  }
  anyPress() { if (this.down.size) return true; for (let i = 0; i < 4; i++) if (this.padEdges[i].size) return true; return false; }
}
