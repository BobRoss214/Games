// Fully synthesized audio: SFX, per-floor ambience, and a layered procedural score. No audio files.
import { clamp, RNG } from './util.js';

const SCALE = [0, 1, 4, 5, 7, 8, 11, 12]; // phrygian dominant-ish: dark & exotic
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Sound {
  constructor(settings) {
    this.settings = settings; this.ctx = null; this.ok = false; this.listeners = []; this.active = 0;
    this.mode = 'menu'; this.theme = 0; this.intensity = 0; this.targetIntensity = 0; this.step = 0; this.nextT = 0;
    this.rng = new RNG(77); this.lastPlay = new Map();
  }
  resume() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.connect(c.destination);
      this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 6; this.comp.connect(this.master);
      this.sfxBus = c.createGain(); this.sfxBus.connect(this.comp);
      this.musicBus = c.createGain(); this.musicBus.connect(this.comp);
      this.ambBus = c.createGain(); this.ambBus.connect(this.comp);
      // reverb
      this.verb = c.createConvolver(); const len = c.sampleRate * 2.2, buf = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
      this.verb.buffer = buf; this.verbGain = c.createGain(); this.verbGain.gain.value = 0.32; this.verb.connect(this.verbGain); this.verbGain.connect(this.comp);
      this.sfxSend = c.createGain(); this.sfxSend.gain.value = 0.35; this.sfxSend.connect(this.verb);
      this.musicSend = c.createGain(); this.musicSend.gain.value = 0.5; this.musicSend.connect(this.verb);
      // noise buffer
      const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1; this.noiseBuf = nb;
      this.applyVolumes(); this.ok = true;
      this.startAmbient(); this.timer = setInterval(() => this.tick(), 30);
    } catch (e) { this.ok = false; }
  }
  applyVolumes() {
    if (!this.ctx) return; const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.mute ? 0 : s.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s.sfx, t, 0.05); this.musicBus.gain.setTargetAtTime(s.music * 0.7, t, 0.05); this.ambBus.gain.setTargetAtTime(s.sfx * 0.6, t, 0.05);
  }
  setListeners(list) { this.listeners = list; }

  // ---------- primitives ----------
  _out(pan, wet = 1) {
    const c = this.ctx; const g = c.createGain();
    let last = g;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); last = p; }
    last.connect(this.sfxBus); if (wet) { const s = c.createGain(); s.gain.value = wet; last.connect(s); s.connect(this.sfxSend); }
    return g;
  }
  tone(o) {
    if (!this.ok || this.active > 70) return;
    const c = this.ctx, t0 = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0); if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = this._out(o.pan || 0, o.wet ?? 0.5);
    const a = o.a ?? 0.004, peak = o.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    let src = osc;
    if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); src = f; }
    src.connect(g); osc.start(t0); osc.stop(t0 + o.dur + 0.05);
    this.active++; osc.onended = () => { this.active--; };
  }
  noise(o) {
    if (!this.ok || this.active > 70) return;
    const c = this.ctx, t0 = c.currentTime + (o.delay || 0);
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true; src.playbackRate.value = o.rate || 1;
    const f = c.createBiquadFilter(); f.type = o.ftype || 'lowpass'; f.frequency.setValueAtTime(o.f || 1000, t0); if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f2), t0 + o.dur); f.Q.value = o.q || 0.7;
    const g = this._out(o.pan || 0, o.wet ?? 0.4);
    const a = o.a ?? 0.003, peak = o.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f); f.connect(g); src.start(t0, Math.random() * 1.5); src.stop(t0 + o.dur + 0.05);
    this.active++; src.onended = () => { this.active--; };
  }

  // ---------- spatial play ----------
  play(name, x, y, vol = 1, extra) {
    if (!this.ok) return;
    const now = this.ctx.currentTime, lp = this.lastPlay.get(name);
    if (lp && now - lp < 0.035) return; this.lastPlay.set(name, now);
    let pan = 0, gain = vol;
    if (x !== undefined && this.listeners.length) {
      let best = null, bd = 1e9;
      for (const l of this.listeners) { const d = Math.hypot(l.x - x, l.y - y); if (d < bd) { bd = d; best = l; } }
      const rel = Math.atan2(y - best.y, x - best.x) - best.angle;
      pan = Math.sin(rel) * Math.min(1, bd / 3) * 0.85;
      gain = vol / (1 + (bd * bd) / 40) * (Math.cos(rel) < -0.2 ? 0.8 : 1);
      if (gain < 0.02) return;
    }
    const fn = SFX[name]; if (fn) fn(this, gain, pan, extra);
  }

  // ---------- music ----------
  setMode(mode, theme) {
    if (theme !== undefined) this.theme = theme;
    if (mode === this.mode) return;
    this.mode = mode;
    if (!this.ok) return;
    if (mode === 'victory') this.jingle([0, 4, 7, 12, 16, 19, 24], 0.16, 'triangle', 57, 0.22);
    if (mode === 'defeat') this.jingle([12, 11, 8, 7, 4, 1, 0], 0.32, 'sawtooth', 45, 0.2);
  }
  setIntensity(v) { this.targetIntensity = clamp(v, 0, 1); }
  jingle(notes, gap, type, root, vol) { notes.forEach((n, i) => this.tone({ f: mtof(root + n), dur: 0.9, type, vol, delay: i * gap, a: 0.01, wet: 1, lp: 2500 })); }
  fanfare() { this.jingle([0, 4, 7, 12], 0.09, 'square', 60, 0.14); this.jingle([12, 16, 19, 24], 0.09, 'triangle', 60, 0.16); }

  startAmbient() {
    const c = this.ctx;
    this.drone = [];
    for (const [det, type] of [[-6, 'sawtooth'], [6, 'sawtooth'], [0, 'sine']]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = mtof(33); o.detune.value = det;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180; f.Q.value = 2;
      const g = c.createGain(); g.gain.value = type === 'sine' ? 0.12 : 0.05;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.07 + Math.random() * 0.05; const lg = c.createGain(); lg.gain.value = 60; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
      o.connect(f); f.connect(g); g.connect(this.ambBus); o.start(); this.drone.push({ o, f, g });
    }
    // wind
    const ws = c.createBufferSource(); ws.buffer = this.noiseBuf; ws.loop = true; const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 500; wf.Q.value = 1.5;
    const wg = c.createGain(); wg.gain.value = 0.05; const wl = c.createOscillator(); wl.frequency.value = 0.11; const wlg = c.createGain(); wlg.gain.value = 280; wl.connect(wlg); wlg.connect(wf.frequency); wl.start();
    const wl2 = c.createOscillator(); wl2.frequency.value = 0.07; const wlg2 = c.createGain(); wlg2.gain.value = 0.03; wl2.connect(wlg2); wlg2.connect(wg.gain); wl2.start();
    ws.connect(wf); wf.connect(wg); wg.connect(this.ambBus); ws.start(); this.wind = { wf, wg };
    this.nextDrip = 2; this.nextChain = 9;
  }
  themeRoot() { return [33, 31, 35, 30, 32, 28][this.theme % 6]; }
  tick() {
    if (!this.ok) return;
    const c = this.ctx, now = c.currentTime;
    this.intensity += (this.targetIntensity - this.intensity) * 0.02;
    // drone follows theme root
    const root = this.themeRoot(); for (const d of this.drone) d.o.frequency.setTargetAtTime(mtof(root), now, 2.5);
    if (this.wind) this.wind.wg.gain.setTargetAtTime(this.mode === 'boss' ? 0.01 : 0.04 + this.theme * 0.006, now, 1);
    // ambient events
    if (now > this.nextDrip) { this.nextDrip = now + 2 + Math.random() * 6; if (this.mode !== 'boss') this.tone({ f: 900 + Math.random() * 900, f2: 500, dur: 0.18, type: 'sine', vol: 0.05, pan: Math.random() * 1.6 - 0.8, wet: 1 }); }
    if (now > this.nextChain) { this.nextChain = now + 10 + Math.random() * 14; if (this.mode !== 'boss' && this.mode !== 'menu') for (let i = 0; i < 4; i++) this.noise({ dur: 0.06, vol: 0.03, ftype: 'bandpass', f: 3000 + Math.random() * 2000, q: 8, delay: i * 0.07, pan: Math.random() - 0.5, wet: 1 }); }
    // sequencer
    if (this.nextT < now - 0.5) this.nextT = now + 0.05;
    const bpm = this.mode === 'boss' ? 148 : this.mode === 'combat' ? 128 : this.mode === 'menu' ? 66 : 72;
    const stepDur = 60 / bpm / 4;
    while (this.nextT < now + 0.12) { this.scheduleStep(this.step, this.nextT, stepDur); this.step++; this.nextT += stepDur; }
  }
  scheduleStep(step, t, sd) {
    const c = this.ctx, m = this.mode; if (m === 'victory' || m === 'defeat') return;
    const root = this.themeRoot() + 12, s = step % 64, bar = Math.floor(s / 16), st = s % 16;
    const I = this.intensity, boss = m === 'boss', combat = m === 'combat' || boss, menu = m === 'menu';
    const prog = [0, 0, 5, 3][bar % 4];
    const mv = (this.settings.music || 0);
    if (!mv) return;
    const gen = (freq, dur, type, vol, lp, det = 0, delay = 0) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = det;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(lp, t + delay); f.frequency.exponentialRampToValueAtTime(Math.max(80, lp * 0.3), t + delay + dur);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t + delay); g.gain.linearRampToValueAtTime(vol, t + delay + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(f); f.connect(g); g.connect(this.musicBus); const s2 = c.createGain(); s2.gain.value = 0.4; g.connect(s2); s2.connect(this.musicSend);
      o.start(t + delay); o.stop(t + delay + dur + 0.05);
    };
    const nz = (dur, vol, ftype, f, q = 1) => {
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; const fl = c.createBiquadFilter(); fl.type = ftype; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); src.connect(fl); fl.connect(g); g.connect(this.musicBus); src.start(t, Math.random()); src.stop(t + dur + 0.02);
    };
    // pad chord every 16 steps
    if (st === 0) {
      const chord = menu ? [0, 7, 12] : [0, 3, 7];
      chord.forEach((n, i) => gen(mtof(root + prog + n + 12), sd * 16, 'sawtooth', 0.025 + (combat ? 0.01 : 0), 700 + I * 900, i * 4 - 4));
    }
    // bass
    if (combat) {
      if (st % 2 === 0 || (boss && st % 4 === 3)) { const n = [0, 0, 1, 0, 0, 5, 0, 4][((s >> 1) % 8)] ; gen(mtof(root - 12 + prog + n), sd * 1.6, 'sawtooth', 0.09 * (0.6 + I * 0.4), 380 + I * 200); }
    } else if (st === 0 || st === 8) gen(mtof(root - 12 + prog), sd * 6, 'sine', menu ? 0.07 : 0.08, 300);
    // drums
    if (combat) {
      if (st % 4 === 0 || (boss && st === 10)) { const o = c.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.14); const g = c.createGain(); g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18); o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.2); }
      if (st === 4 || st === 12) nz(0.14, 0.12 + I * 0.06, 'bandpass', 1800, 0.8);
      if (st % 2 === 0) nz(0.03, 0.03 + I * 0.03, 'highpass', 7000);
      if (boss && st % 4 === 2) nz(0.05, 0.05, 'bandpass', 900, 3);
    } else if (!menu && (st === 0 || st === 8) && I > 0.15) nz(0.5, 0.05, 'lowpass', 220, 0.8); // distant heartbeat thud
    // lead / motifs
    if (combat) {
      if (st % 2 === 1 && this.rng.chance(0.45 + I * 0.3)) { const n = SCALE[this.rng.int(0, 6)] + (this.rng.chance(0.3) ? 12 : 0); gen(mtof(root + 12 + prog + n), sd * 1.2, 'square', 0.03 + I * 0.02, 1400 + I * 1500); }
    } else if (st % 4 === 2 && this.rng.chance(menu ? 0.25 : 0.18 + I * 0.2)) {
      const n = SCALE[this.rng.int(0, 7)]; gen(mtof(root + 12 + prog + n + 12), sd * 5, 'triangle', 0.035, 1800, 0, 0);
      this.tone({ f: mtof(root + 24 + n), dur: 1.2, type: 'sine', vol: 0.02, wet: 1, delay: sd * 3, pan: this.rng.float(-0.6, 0.6) });
    }
    if (boss && st === 0 && bar % 2 === 0) gen(mtof(root - 24), sd * 12, 'sawtooth', 0.14, 260);
  }
}

// ---------- SFX library ----------
const rnd = (a, b) => a + Math.random() * (b - a);
const SFX = {
  swing: (a, g, p) => a.noise({ dur: 0.18, vol: 0.18 * g, ftype: 'bandpass', f: 600, f2: 2400, q: 1.2, pan: p, wet: 0.2 }),
  swingHeavy: (a, g, p) => { a.noise({ dur: 0.3, vol: 0.22 * g, ftype: 'bandpass', f: 300, f2: 1600, q: 1, pan: p }); a.tone({ f: 120, f2: 50, dur: 0.25, type: 'sine', vol: 0.15 * g, pan: p }); },
  hit: (a, g, p) => { a.noise({ dur: 0.12, vol: 0.28 * g, ftype: 'lowpass', f: 900, f2: 200, pan: p }); a.tone({ f: rnd(110, 150), f2: 55, dur: 0.14, type: 'triangle', vol: 0.25 * g, pan: p }); },
  hitHeavy: (a, g, p) => { SFX.hit(a, g * 1.3, p); a.noise({ dur: 0.3, vol: 0.2 * g, ftype: 'lowpass', f: 500, f2: 80, pan: p }); },
  hitBone: (a, g, p) => { a.noise({ dur: 0.1, vol: 0.22 * g, ftype: 'highpass', f: 1800, pan: p }); a.tone({ f: rnd(500, 800), f2: 300, dur: 0.08, type: 'square', vol: 0.06 * g, pan: p }); },
  hitStone: (a, g, p) => { a.noise({ dur: 0.16, vol: 0.25 * g, ftype: 'bandpass', f: 800, q: 2, pan: p }); a.tone({ f: 90, f2: 60, dur: 0.2, type: 'square', vol: 0.12 * g, pan: p }); },
  block: (a, g, p) => { a.tone({ f: 1800, f2: 900, dur: 0.12, type: 'square', vol: 0.09 * g, pan: p }); a.noise({ dur: 0.1, vol: 0.16 * g, ftype: 'highpass', f: 2500, pan: p }); },
  parry: (a, g, p) => { a.tone({ f: 2400, f2: 1600, dur: 0.3, type: 'triangle', vol: 0.15 * g, pan: p }); a.noise({ dur: 0.15, vol: 0.2 * g, ftype: 'highpass', f: 3000, pan: p }); },
  step: (a, g, p) => a.noise({ dur: 0.07, vol: 0.05 * g, ftype: 'lowpass', f: 400, f2: 150, pan: p, wet: 0.2 }),
  shoot: (a, g, p) => { a.noise({ dur: 0.12, vol: 0.12 * g, ftype: 'bandpass', f: 1500, f2: 400, pan: p }); a.tone({ f: 260, f2: 100, dur: 0.1, type: 'triangle', vol: 0.1 * g, pan: p }); },
  bolt: (a, g, p) => { a.tone({ f: 200, f2: 60, dur: 0.15, type: 'sawtooth', vol: 0.18 * g, pan: p, lp: 900 }); a.noise({ dur: 0.15, vol: 0.14 * g, ftype: 'bandpass', f: 1200, pan: p }); },
  fire: (a, g, p) => { a.noise({ dur: 0.5, vol: 0.2 * g, ftype: 'bandpass', f: 400, f2: 1800, q: 0.8, pan: p }); a.tone({ f: 100, f2: 250, dur: 0.4, type: 'sawtooth', vol: 0.08 * g, pan: p, lp: 700 }); },
  frost: (a, g, p) => { for (let i = 0; i < 6; i++) a.tone({ f: 1800 + i * 300, f2: 1000, dur: 0.4, type: 'sine', vol: 0.05 * g, delay: i * 0.03, pan: p, wet: 1 }); a.noise({ dur: 0.5, vol: 0.12 * g, ftype: 'highpass', f: 3500, pan: p }); },
  lightning: (a, g, p) => { for (let i = 0; i < 4; i++) a.noise({ dur: 0.08, vol: 0.22 * g, ftype: 'bandpass', f: 2500 + i * 500, q: 3, delay: i * 0.04, pan: p }); a.tone({ f: 70, f2: 50, dur: 0.3, type: 'square', vol: 0.12 * g, pan: p }); },
  drain: (a, g, p) => { a.tone({ f: 300, f2: 700, dur: 0.5, type: 'sawtooth', vol: 0.09 * g, pan: p, lp: 1200 }); a.tone({ f: 302, f2: 705, dur: 0.5, type: 'sawtooth', vol: 0.09 * g, pan: p, lp: 1200 }); },
  ward: (a, g, p) => { [0, 4, 7, 12].forEach((n, i) => a.tone({ f: 440 * Math.pow(2, n / 12), dur: 0.6, type: 'triangle', vol: 0.08 * g, delay: i * 0.05, pan: p, wet: 1 })); },
  potion: (a, g, p) => { for (let i = 0; i < 4; i++) a.tone({ f: 300 + i * 40, f2: 200, dur: 0.1, type: 'sine', vol: 0.15 * g, delay: i * 0.09, pan: p }); },
  coin: (a, g, p) => { a.tone({ f: 1320, dur: 0.08, type: 'square', vol: 0.06 * g, pan: p }); a.tone({ f: 1760, dur: 0.18, type: 'square', vol: 0.06 * g, delay: 0.06, pan: p }); },
  pickup: (a, g, p) => { a.tone({ f: 660, dur: 0.1, type: 'triangle', vol: 0.12 * g, pan: p }); a.tone({ f: 990, dur: 0.2, type: 'triangle', vol: 0.12 * g, delay: 0.07, pan: p }); },
  ecto: (a, g, p) => a.tone({ f: 1400, f2: 2200, dur: 0.15, type: 'sine', vol: 0.06 * g, pan: p, wet: 1 }),
  chest: (a, g, p) => { a.noise({ dur: 0.3, vol: 0.18 * g, ftype: 'lowpass', f: 400, f2: 900, pan: p }); a.tone({ f: 200, f2: 400, dur: 0.3, type: 'sawtooth', vol: 0.07 * g, lp: 800, pan: p }); [0, 4, 7, 12].forEach((n, i) => a.tone({ f: 660 * Math.pow(2, n / 12), dur: 0.5, type: 'triangle', vol: 0.06 * g, delay: 0.15 + i * 0.06, wet: 1, pan: p })); },
  doorSlam: (a, g, p) => { a.noise({ dur: 0.7, vol: 0.5 * g, ftype: 'lowpass', f: 500, f2: 60, wet: 0.8, pan: p }); a.tone({ f: 70, f2: 30, dur: 0.8, type: 'sine', vol: 0.4 * g, wet: 0.8, pan: p }); },
  doorOpen: (a, g, p) => a.noise({ dur: 0.5, vol: 0.12 * g, ftype: 'bandpass', f: 250, f2: 120, q: 3, pan: p }),
  sealed: (a, g, p) => { a.tone({ f: 110, dur: 0.2, type: 'square', vol: 0.12 * g, lp: 400 }); a.tone({ f: 90, dur: 0.3, type: 'square', vol: 0.12 * g, lp: 400, delay: 0.15 }); },
  spikes: (a, g, p) => { a.noise({ dur: 0.15, vol: 0.3 * g, ftype: 'highpass', f: 1500, pan: p }); a.tone({ f: 200, f2: 80, dur: 0.15, type: 'square', vol: 0.12 * g, pan: p }); },
  saw: (a, g, p) => { a.tone({ f: 220, f2: 900, dur: 0.4, type: 'sawtooth', vol: 0.1 * g, lp: 3000, pan: p }); a.noise({ dur: 0.4, vol: 0.12 * g, ftype: 'bandpass', f: 3000, q: 2, pan: p }); },
  flame: (a, g, p) => a.noise({ dur: 0.35, vol: 0.14 * g, ftype: 'bandpass', f: 600, f2: 1400, q: 0.6, pan: p }),
  dart: (a, g, p) => { a.noise({ dur: 0.08, vol: 0.14 * g, ftype: 'highpass', f: 3000, pan: p }); a.tone({ f: 1200, f2: 600, dur: 0.06, type: 'square', vol: 0.05 * g, pan: p }); },
  crusher: (a, g, p) => { a.noise({ dur: 0.5, vol: 0.45 * g, ftype: 'lowpass', f: 400, f2: 60, pan: p }); a.tone({ f: 60, f2: 25, dur: 0.6, type: 'sine', vol: 0.4 * g, pan: p }); },
  explosion: (a, g, p) => { a.noise({ dur: 0.9, vol: 0.5 * g, ftype: 'lowpass', f: 1600, f2: 60, wet: 0.7, pan: p }); a.tone({ f: 90, f2: 30, dur: 0.8, type: 'sine', vol: 0.45 * g, pan: p }); },
  shockwave: (a, g, p) => { a.noise({ dur: 0.6, vol: 0.4 * g, ftype: 'lowpass', f: 600, f2: 50, pan: p }); a.tone({ f: 80, f2: 28, dur: 0.6, type: 'sine', vol: 0.4 * g, pan: p }); },
  death: (a, g, p) => { a.noise({ dur: 0.5, vol: 0.3 * g, ftype: 'lowpass', f: 800, f2: 100, pan: p }); a.tone({ f: 200, f2: 40, dur: 0.6, type: 'sawtooth', vol: 0.15 * g, lp: 600, pan: p }); },
  gibs: (a, g, p) => { for (let i = 0; i < 4; i++) a.noise({ dur: 0.08, vol: 0.2 * g, ftype: 'lowpass', f: 500, delay: i * 0.06 + 0.1, pan: p }); },
  levelup: (a, g) => { [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => a.tone({ f: 330 * Math.pow(2, n / 12), dur: 0.5, type: 'square', vol: 0.09 * g, delay: i * 0.07, lp: 3000, wet: 1 })); a.tone({ f: 165, dur: 1.2, type: 'sawtooth', vol: 0.1 * g, lp: 500, wet: 1 }); },
  swapSting: (a, g) => { a.tone({ f: 55, f2: 40, dur: 1.6, type: 'sawtooth', vol: 0.3 * g, lp: 300, wet: 1 }); [0, 1, 6, 7].forEach((n, i) => a.tone({ f: 220 * Math.pow(2, n / 12), dur: 0.9, type: 'square', vol: 0.09 * g, delay: 0.1 + i * 0.12, lp: 1800, wet: 1 })); a.noise({ dur: 1.2, vol: 0.2 * g, ftype: 'lowpass', f: 3000, f2: 200, wet: 1 }); },
  pentagram: (a, g, p) => { a.noise({ dur: 0.9, vol: 0.28 * g, ftype: 'bandpass', f: 200, f2: 2400, q: 2, pan: p, wet: 0.8 }); a.tone({ f: 60, f2: 200, dur: 0.8, type: 'sawtooth', vol: 0.15 * g, lp: 600, pan: p }); },
  statue: (a, g, p) => { a.noise({ dur: 1.4, vol: 0.4 * g, ftype: 'lowpass', f: 300, f2: 50, pan: p, wet: 0.9 }); a.tone({ f: 45, f2: 30, dur: 1.4, type: 'sine', vol: 0.5 * g, pan: p }); },
  portal: (a, g) => { a.tone({ f: 110, f2: 880, dur: 1.4, type: 'sawtooth', vol: 0.12 * g, lp: 2000, wet: 1 }); a.noise({ dur: 1.4, vol: 0.2 * g, ftype: 'bandpass', f: 500, f2: 4000, q: 1.5, wet: 1 }); },
  roar: (a, g, p) => { a.tone({ f: 70, f2: 38, dur: 1.6, type: 'sawtooth', vol: 0.3 * g, lp: 500, pan: p, wet: 0.8 }); a.tone({ f: 72, f2: 40, dur: 1.6, type: 'square', vol: 0.15 * g, lp: 400, pan: p, wet: 0.8 }); a.noise({ dur: 1.6, vol: 0.3 * g, ftype: 'lowpass', f: 900, f2: 100, pan: p, wet: 0.8 }); },
  beam: (a, g, p) => { a.tone({ f: 300, f2: 320, dur: 0.16, type: 'sawtooth', vol: 0.06 * g, lp: 1500, pan: p }); a.noise({ dur: 0.16, vol: 0.1 * g, ftype: 'bandpass', f: 1500, q: 2, pan: p }); },
  ui: (a, g) => a.tone({ f: 660, dur: 0.05, type: 'square', vol: 0.05 * g, lp: 2000 }),
  uiOk: (a, g) => { a.tone({ f: 440, dur: 0.06, type: 'square', vol: 0.07 * g, lp: 2400 }); a.tone({ f: 660, dur: 0.1, type: 'square', vol: 0.07 * g, delay: 0.05, lp: 2400 }); },
  uiBack: (a, g) => a.tone({ f: 330, f2: 200, dur: 0.1, type: 'square', vol: 0.06 * g, lp: 1500 }),
  whoosh: (a, g, p) => a.noise({ dur: 0.35, vol: 0.14 * g, ftype: 'bandpass', f: 400, f2: 1800, q: 0.8, pan: p }),
  ghostjump: (a, g, p) => { a.tone({ f: 1200, f2: 300, dur: 0.25, type: 'sine', vol: 0.07 * g, pan: p, wet: 1 }); },
  haunt: (a, g, p) => { a.tone({ f: 220, f2: 180, dur: 0.6, type: 'sine', vol: 0.09 * g, pan: p, wet: 1 }); a.noise({ dur: 0.5, vol: 0.06 * g, ftype: 'bandpass', f: 900, q: 4, pan: p, wet: 1 }); },
  rattle: (a, g, p) => { for (let i = 0; i < 6; i++) a.noise({ dur: 0.05, vol: 0.12 * g, ftype: 'bandpass', f: 3000, q: 6, delay: i * 0.06, pan: p }); },
  slime: (a, g, p) => { a.tone({ f: 300, f2: 80, dur: 0.25, type: 'sine', vol: 0.14 * g, pan: p }); a.noise({ dur: 0.2, vol: 0.1 * g, ftype: 'lowpass', f: 700, pan: p }); },
  dodge: (a, g, p) => a.noise({ dur: 0.2, vol: 0.12 * g, ftype: 'highpass', f: 1500, pan: p }),
  windup: (a, g, p) => a.tone({ f: 200, f2: 320, dur: 0.15, type: 'triangle', vol: 0.04 * g, pan: p }),
  heartbeat: (a, g) => { a.tone({ f: 62, f2: 40, dur: 0.16, type: 'sine', vol: 0.5 * g, wet: 0.3 }); a.tone({ f: 58, f2: 38, dur: 0.18, type: 'sine', vol: 0.36 * g, delay: 0.19, wet: 0.3 }); },
  whisper: (a, g, p) => { const f0 = 900 + Math.random() * 500; for (let i = 0; i < 4; i++) a.noise({ dur: 0.35 + Math.random() * 0.3, vol: 0.09 * g, ftype: 'bandpass', f: f0 + i * 260, f2: f0 * 0.7 + i * 200, q: 7, delay: i * 0.22, pan: p, wet: 1, a: 0.12 }); a.tone({ f: 190, f2: 150, dur: 1.2, type: 'sine', vol: 0.03 * g, pan: p, wet: 1, a: 0.3 }); },
  // monster voices
  v_skeleton: (a, g, p) => { for (let i = 0; i < 3; i++) a.noise({ dur: 0.05, vol: 0.13 * g, ftype: 'bandpass', f: 2600, q: 5, delay: i * 0.05, pan: p }); a.tone({ f: 180, f2: 120, dur: 0.3, type: 'sawtooth', vol: 0.06 * g, lp: 500, pan: p }); },
  v_archer: (a, g, p) => SFX.v_skeleton(a, g, p),
  v_brute: (a, g, p) => { a.tone({ f: 90, f2: 55, dur: 0.6, type: 'sawtooth', vol: 0.2 * g, lp: 400, pan: p }); a.noise({ dur: 0.5, vol: 0.15 * g, ftype: 'lowpass', f: 400, pan: p }); },
  v_crawler: (a, g, p) => { a.tone({ f: 380, f2: 150, dur: 0.25, type: 'sawtooth', vol: 0.11 * g, lp: 900, pan: p }); a.noise({ dur: 0.2, vol: 0.12 * g, ftype: 'bandpass', f: 1000, q: 2, pan: p }); },
  v_screamer: (a, g, p) => { a.tone({ f: 900, f2: 1600, dur: 0.6, type: 'sawtooth', vol: 0.12 * g, lp: 3500, pan: p, wet: 0.7 }); a.tone({ f: 1350, f2: 2300, dur: 0.6, type: 'square', vol: 0.05 * g, lp: 3500, pan: p }); },
  v_bloat: (a, g, p) => { a.tone({ f: 130, f2: 70, dur: 0.5, type: 'sine', vol: 0.18 * g, pan: p }); a.noise({ dur: 0.4, vol: 0.14 * g, ftype: 'lowpass', f: 500, f2: 200, pan: p }); },
  v_mummy: (a, g, p) => { a.tone({ f: 140, f2: 100, dur: 0.8, type: 'sawtooth', vol: 0.11 * g, lp: 500, pan: p, wet: 0.8 }); a.noise({ dur: 0.7, vol: 0.06 * g, ftype: 'bandpass', f: 700, q: 3, pan: p }); },
  v_scarab: (a, g, p) => { for (let i = 0; i < 8; i++) a.noise({ dur: 0.03, vol: 0.08 * g, ftype: 'highpass', f: 5000, delay: i * 0.03, pan: p }); },
  v_priest: (a, g, p) => { [0, 3, 7].forEach((n, i) => a.tone({ f: 165 * Math.pow(2, n / 12), dur: 0.9, type: 'sawtooth', vol: 0.05 * g, lp: 700, delay: i * 0.05, wet: 1, pan: p })); },
  v_slime: (a, g, p) => SFX.slime(a, g, p),
  v_giant: (a, g, p) => SFX.roar(a, g * 0.8, p),
};
export { SFX };
