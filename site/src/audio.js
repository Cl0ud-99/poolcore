// ============================================================
//  AMBIENCE: fully synthesised audio, no sample files
// ============================================================
//
// Everything here is generated with the Web Audio API at runtime. That keeps the
// repository free of binary assets, makes every parameter tunable from the URL,
// and - most importantly for ambience - allows loops that never seam, because the
// sources are continuous oscillators and filtered noise rather than a clip that
// has to be crossfaded against itself.
//
// The mix is deliberately quiet and top-heavy in the far field: it should sit
// under the image rather than announce itself.
//
// Browsers block audio until the user interacts with the page, so nothing starts
// until the first click. That is also the same click that captures the pointer.

export class Ambience {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.nodes = {};
    this.timers = [];
    this.masterGain = 0.55;
  }

  // Must be called from a user gesture handler.
  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.started = true;
    this.ctx = new AC();

    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = this.masterGain;
    master.connect(ctx.destination);
    this.nodes.master = master;

    // ---- shared reverb: a convolution against synthesised noise ----
    // An exponentially decaying noise burst is a serviceable impulse response and
    // costs nothing to generate. It is what makes the drips read as a large tiled
    // room rather than a click in a vacuum.
    const irLen = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        const t = i / irLen;
        // long tail, gently low-passed by weighting toward the start
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.42;
    conv.connect(wet).connect(master);
    this.nodes.reverb = conv;

    this.buildRoomTone();
    this.buildFluorescentHum();
    this.buildDrips();
    this.buildHysteria();
  }

  // ---- low air: filtered brown noise, very slowly breathing ----
  buildRoomTone() {
    const ctx = this.ctx;

    // Brown noise: integrate white noise. Gives the low rumble of a large hall
    // without the hiss that plain white noise contributes.
    const len = ctx.sampleRate * 6;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 0.6;

    const g = ctx.createGain();
    g.gain.value = 0.20;

    // Slow amplitude drift so the room never feels static. Two detuned LFOs
    // rather than one, so the cycle is long enough to be unnoticeable.
    for (const [rate, depth] of [[0.037, 0.055], [0.061, 0.035]]) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const la = ctx.createGain();
      la.gain.value = depth;
      lfo.connect(la).connect(g.gain);
      lfo.start();
    }

    src.connect(lp).connect(g).connect(this.nodes.master);
    src.start();
    this.nodes.room = { src, g };
  }

  // ---- fluorescent hum: the signature backrooms sound ----
  buildFluorescentHum() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.075;

    // 50 Hz mains hum plus its odd harmonics, which is what a magnetic ballast
    // actually produces. The 100 Hz component is the loudest in practice.
    const parts = [[50, 0.55], [100, 1.0], [150, 0.45], [250, 0.18], [350, 0.08]];
    for (const [f, amp] of parts) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = amp * 0.22;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 6;
      o.connect(bp).connect(g).connect(out);
      o.start();
    }

    // Slow amplitude drift, so the hum breathes instead of sitting flat. Wired
    // into the output gain rather than a pitch input: a magnetic ballast varies in
    // loudness far more than in frequency.
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.021;
    const driftAmt = ctx.createGain();
    driftAmt.gain.value = 0.020;
    drift.connect(driftAmt).connect(out.gain);
    drift.start();

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;

    // Occasional flicker: a brief gain dip, like a failing tube.
    const flicker = ctx.createGain();
    flicker.gain.value = 1;

    // Single, linear path: out -> lowpass -> flicker -> master.
    out.connect(lp).connect(flicker).connect(this.nodes.master);

    this.nodes.hum = { out, flicker };
    this.scheduleFlicker();
  }

  scheduleFlicker() {
    const ctx = this.ctx;
    const delay = 4 + Math.random() * 14;
    this.timers.push(setTimeout(() => {
      if (!this.started) return;
      const t = ctx.currentTime;
      const g = this.nodes.hum.flicker.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(1, t);
      const dips = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < dips; i++) {
        const at = t + 0.04 + i * 0.07;
        g.setValueAtTime(0.25 + Math.random() * 0.4, at);
        g.setValueAtTime(1, at + 0.035);
      }
      this.scheduleFlicker();
    }, delay * 1000));
  }

  // ---- water drips: short decaying sines, randomly placed in the room ----
  buildDrips() {
    this.scheduleDrip();
  }

  scheduleDrip() {
    const ctx = this.ctx;
    // Irregular spacing: constant intervals read as a machine, not a leak.
    const delay = 0.9 + Math.random() * 4.5;
    this.timers.push(setTimeout(() => {
      if (!this.started) return;
      this.playDrip();
      // Occasional quick double-drip, which is what a real leak does.
      if (Math.random() < 0.22) {
        this.timers.push(setTimeout(() => this.playDrip(), 90 + Math.random() * 130));
      }
      this.scheduleDrip();
    }, delay * 1000));
  }

  playDrip() {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // A drip is a short sine that falls in pitch as the cavity collapses.
    const base = 520 + Math.random() * 780;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 0.42, t + 0.085);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10 + Math.random() * 0.09, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);

    o.connect(g);

    // Pan the drip somewhere in the room so the space has width.
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = (Math.random() * 2 - 1) * 0.85;
      g.connect(pan).connect(this.nodes.master);
      g.connect(this.nodes.reverb);
    } else {
      g.connect(this.nodes.master);
      g.connect(this.nodes.reverb);
    }

    o.start(t);
    o.stop(t + 0.35);
  }

  // ---- very faint hysteria: distant, detuned, almost subliminal ----
  buildHysteria() {
    this.scheduleHysteria();
  }

  scheduleHysteria() {
    const delay = 16 + Math.random() * 34;
    this.timers.push(setTimeout(() => {
      if (!this.started) return;
      this.playHysteria();
      this.scheduleHysteria();
    }, delay * 1000));
  }

  playHysteria() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 2.5 + Math.random() * 3.0;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    // A slow swell in and out - it should approach from far away and recede,
    // never start or stop abruptly.
    out.gain.exponentialRampToValueAtTime(0.016 + Math.random() * 0.012, t + dur * 0.42);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    // A small cluster of detuned high voices. Two or three slightly-off pitches
    // beat against each other, which is what makes it feel uneasy rather than
    // simply high.
    const root = 620 + Math.random() * 420;
    const ratios = [1.0, 1.0 + (Math.random() * 0.02 + 0.006), 2.0 - Math.random() * 0.015];
    for (const r of ratios) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = root * r;
      // Slow vibrato, barely there.
      const vib = ctx.createOscillator();
      vib.frequency.value = 3.5 + Math.random() * 2.5;
      const vibAmt = ctx.createGain();
      vibAmt.gain.value = 1.5 + Math.random() * 2.5;
      vib.connect(vibAmt).connect(o.frequency);
      vib.start(t); vib.stop(t + dur);

      const g = ctx.createGain();
      g.gain.value = 0.34;
      o.connect(g).connect(out);
      o.start(t); o.stop(t + dur);
    }

    // Distance: remove everything above ~2 kHz so it reads as far away and behind
    // a wall, and drench it in the reverb.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500 + Math.random() * 700;
    out.connect(lp);
    lp.connect(this.nodes.reverb);
    const direct = ctx.createGain();
    direct.gain.value = 0.35;
    lp.connect(direct).connect(this.nodes.master);
  }

  setVolume(v) {
    this.masterGain = Math.max(0, Math.min(1, v));
    if (this.nodes.master) this.nodes.master.gain.value = this.masterGain;
  }

  suspend() { if (this.ctx) this.ctx.suspend(); }
  resume() { if (this.ctx) this.ctx.resume(); }
}
