'use strict';
// Web Audio synthesis: sea, wind, gulls, crickets and little UI sounds. Nothing is loaded from disk.
class AudioFX {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.vol = 0.8;
    this.state = { season: 'spring', night: 0, wind: 0.4 };
    this.lastPlace = 0; this.lastRemove = 0; this.noteIdx = 4;
    this.timers = [];
  }

  // must be called from a user gesture (browser autoplay policy)
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.on ? this.vol : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.8; this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 1; this.amb.connect(this.master);
    this.buildAmbience();
    this.schedGull(); this.schedCricket();
    this.applyState();
  }

  noiseBuffer(kind) {
    const ctx = this.ctx, len = ctx.sampleRate * 5, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else d[i] = w;
    }
    return buf;
  }
  loop(kind) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuffer(kind); s.loop = true; s.start(); return s; }

  buildAmbience() {
    const ctx = this.ctx;
    // slow swells: brown noise through a low-pass, gain driven by an LFO
    const sea = this.loop('brown'), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 520;
    this.seaGain = ctx.createGain(); this.seaGain.gain.value = 0.32;
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 0.11; lfoG.gain.value = 0.16;
    lfo.connect(lfoG); lfoG.connect(this.seaGain.gain); lfo.start();
    sea.connect(lp); lp.connect(this.seaGain); this.seaGain.connect(this.amb);
    // foam hiss riding on the swell
    const hiss = this.loop('white'), bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.5;
    this.hissGain = ctx.createGain(); this.hissGain.gain.value = 0.02;
    const lfo2 = ctx.createOscillator(), lfo2G = ctx.createGain();
    lfo2.frequency.value = 0.13; lfo2G.gain.value = 0.012;
    lfo2.connect(lfo2G); lfo2G.connect(this.hissGain.gain); lfo2.start();
    hiss.connect(bp); bp.connect(this.hissGain); this.hissGain.connect(this.amb);
    // wind
    const wind = this.loop('pink');
    this.windBP = ctx.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.frequency.value = 420; this.windBP.Q.value = 1.1;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.0;
    const lfo3 = ctx.createOscillator(), lfo3G = ctx.createGain();
    lfo3.frequency.value = 0.17; lfo3G.gain.value = 160;
    lfo3.connect(lfo3G); lfo3G.connect(this.windBP.frequency); lfo3.start();
    wind.connect(this.windBP); this.windBP.connect(this.windGain); this.windGain.connect(this.amb);
  }

  // called a few times per second with the current world state
  setState(season, night, wind) {
    this.state.season = season; this.state.night = night; this.state.wind = wind;
    this.applyState();
  }
  applyState() {
    if (!this.ctx) return;
    const s = this.state, t = this.ctx.currentTime, w = s.season === 'winter' ? 0.42 + 0.2 * s.wind : 0.035 + 0.11 * s.wind;
    this.windGain.gain.setTargetAtTime(w, t, 0.6);
    this.hissGain.gain.setTargetAtTime(0.02, t, 0.6);
  }

  setEnabled(on) {
    this.on = on;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(on ? this.vol : 0, this.ctx.currentTime, 0.08);
  }
  toggle() { this.setEnabled(!this.on); return this.on; }

  // ------------------------------------------------------------------ one-shots
  tone(freq, dur, type, vol, when = 0, dest) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  place() {
    if (!this.ctx || !this.on) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPlace < 0.055) return;
    this.lastPlace = now;
    // wandering pentatonic pluck
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
    this.noteIdx = Util.clamp(this.noteIdx + Math.floor(Math.random() * 5) - 2, 0, scale.length - 1);
    const f = 261.63 * Math.pow(2, scale[this.noteIdx] / 12);
    this.tone(f, 0.28, 'triangle', 0.16);
    this.tone(f * 2, 0.12, 'sine', 0.05);
    // soft wooden tick
    this.tone(f * 0.5, 0.05, 'square', 0.02);
  }
  remove() {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (now - this.lastRemove < 0.07) return;
    this.lastRemove = now;
    const o = this.tone(170, 0.2, 'sine', 0.22);
    o.frequency.exponentialRampToValueAtTime(58, now + 0.18);
    this.tone(90, 0.1, 'triangle', 0.08);
  }
  seasonChime(season) {
    if (!this.ctx || !this.on) return;
    const seqs = {
      spring: [[0, 4, 7, 12], 'triangle', 0.11], summer: [[0, 7, 12, 16, 19], 'sine', 0.1],
      autumn: [[12, 9, 7, 4, 0], 'triangle', 0.12], winter: [[19, 24, 16, 21], 'sine', 0.09],
    };
    const [notes, type, vol] = seqs[season];
    notes.forEach((n, i) => this.tone(392 * Math.pow(2, n / 12), 0.6, type, vol, i * 0.09));
  }
  sparkle() {
    if (!this.ctx || !this.on) return;
    [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.tone(523.25 * Math.pow(2, n / 12), 0.35, 'sine', 0.07, i * 0.045));
  }
  click() {
    if (!this.ctx || !this.on) return;
    this.tone(660, 0.07, 'triangle', 0.08);
  }

  // ------------------------------------------------------------------ living ambience
  gull() {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, n = 2 + Math.floor(Math.random() * 3), base = 1500 + Math.random() * 500;
    let t0 = 0;
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + t0, o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 0.8, t);
      o.frequency.linearRampToValueAtTime(base * 1.45, t + 0.09);
      o.frequency.linearRampToValueAtTime(base * 0.95, t + 0.26);
      const vib = ctx.createOscillator(), vg = ctx.createGain();
      vib.frequency.value = 38; vg.gain.value = 60; vib.connect(vg); vg.connect(o.frequency);
      bp.type = 'bandpass'; bp.frequency.value = base * 1.3; bp.Q.value = 3;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.045, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(bp); bp.connect(g); g.connect(this.amb);
      o.start(t); vib.start(t); o.stop(t + 0.34); vib.stop(t + 0.34);
      t0 += 0.28 + Math.random() * 0.08;
    }
  }
  cricket() {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, f = 4100 + Math.random() * 500, pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = Math.random() * 2 - 1;
    for (let i = 0; i < 3; i++) {
      const t = ctx.currentTime + i * 0.085, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.014, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(g); if (pan) { g.connect(pan); pan.connect(this.amb); } else g.connect(this.amb);
      o.start(t); o.stop(t + 0.08);
    }
  }
  schedGull() {
    const s = this.state;
    if (s.night < 0.4 && this.on) this.gull();
    setTimeout(() => this.schedGull(), 7000 + Math.random() * 10000);
  }
  schedCricket() {
    const s = this.state;
    const amt = s.season === 'summer' ? 1 : (s.season === 'winter' ? 0 : 0.35);
    if (s.night > 0.6 && amt > 0 && Math.random() < amt && this.on) this.cricket();
    setTimeout(() => this.schedCricket(), 350 + Math.random() * 700);
  }
}
