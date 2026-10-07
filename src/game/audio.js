/**
 * Super Racers — Procedural audio engine (Web Audio API).
 * All SFX + music are synthesized at runtime: zero asset downloads.
 */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class SoundSystem {
  constructor(profile) {
    this.profile = profile;
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.noiseBuffer = null;
    this.engine = null;
    this.musicTimer = null;
    this.musicStep = 0;
    this.enabled = true;
  }

  /* ── lifecycle ─────────────────────────────────────────────── */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.getVolume();
    this.master.connect(this.ctx.destination);

    // gentle limiter so explosions never clip
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.knee.value = 12;
    comp.ratio.value = 8;
    comp.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(comp);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.getMusicVolume();
    this.musicBus.connect(comp);

    this.noiseBuffer = this.makeNoise();
    return true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  getVolume() { return this.profile.settings.volume; }
  getMusicVolume() { return this.profile.settings.music; }
  get active() { return this.enabled && this.getVolume() > 0.001 && !!this.ctx; }

  applySettings() {
    if (!this.ctx) return;
    this.master.gain.value = this.getVolume();
    this.musicBus.gain.value = this.getMusicVolume();
  }

  makeNoise() {
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* ── primitives ────────────────────────────────────────────── */
  tone({ type = 'sine', freq = 440, freq2 = null, dur = 0.15, gain = 0.2, delay = 0, attack = 0.005, bus = null }) {
    if (!this.active) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freq2 !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(bus || this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise({ dur = 0.2, gain = 0.3, filter = 'lowpass', freq = 1200, q = 1, delay = 0, sweepTo = null, bus = null }) {
    if (!this.active) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1;
    const bq = this.ctx.createBiquadFilter();
    bq.type = filter;
    bq.frequency.setValueAtTime(freq, t);
    bq.Q.value = q;
    if (sweepTo) bq.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq).connect(g).connect(bus || this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /* ── UI ────────────────────────────────────────────────────── */
  uiHover() { this.tone({ type: 'triangle', freq: 900, freq2: 1200, dur: 0.05, gain: 0.05 }); }
  uiClick() { this.tone({ type: 'square', freq: 480, freq2: 220, dur: 0.07, gain: 0.09 }); }
  uiBack() { this.tone({ type: 'square', freq: 300, freq2: 150, dur: 0.09, gain: 0.08 }); }
  uiError() {
    this.tone({ type: 'sawtooth', freq: 180, freq2: 90, dur: 0.18, gain: 0.12 });
    this.tone({ type: 'sawtooth', freq: 140, freq2: 70, dur: 0.22, gain: 0.1, delay: 0.1 });
  }
  uiSuccess() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this.tone({ type: 'triangle', freq: f, dur: 0.2, gain: 0.11, delay: i * 0.06 }));
  }
  levelUp() {
    [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      this.tone({ type: 'triangle', freq: f, dur: 0.32, gain: 0.12, delay: i * 0.07 }));
  }

  /* ── match flow ────────────────────────────────────────────── */
  countdownBeep(high = false) {
    this.tone({ type: 'square', freq: high ? 880 : 440, dur: high ? 0.5 : 0.16, gain: 0.16 });
    if (high) this.tone({ type: 'square', freq: 1320, dur: 0.5, gain: 0.1, delay: 0.02 });
  }
  victory() {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      this.tone({ type: 'square', freq: f, dur: 0.45, gain: 0.12, delay: i * 0.1 }));
  }
  defeat() {
    [392, 349.23, 293.66, 220].forEach((f, i) =>
      this.tone({ type: 'sawtooth', freq: f, dur: 0.4, gain: 0.1, delay: i * 0.14 }));
  }

  /* ── engine loop ───────────────────────────────────────────── */
  startEngine() {
    if (!this.init() || this.engine) return;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc1.frequency.value = 70;
    osc2.frequency.value = 104;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 6;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.0001;

    // combustion rumble
    const rumble = this.ctx.createBufferSource();
    rumble.buffer = this.noiseBuffer;
    rumble.loop = true;
    const rumbleFilter = this.ctx.createBiquadFilter();
    rumbleFilter.type = 'bandpass';
    rumbleFilter.frequency.value = 90;
    rumbleFilter.Q.value = 1.2;
    const rumbleGain = this.ctx.createGain();
    rumbleGain.gain.value = 0.25;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(this.sfxBus);
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(gain);
    osc1.start(); osc2.start(); rumble.start();

    this.engine = { osc1, osc2, gain, filter, rumbleGain };
  }

  stopEngine() {
    if (!this.engine) return;
    const { osc1, osc2, gain } = this.engine;
    try {
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.15);
      osc1.stop(this.ctx.currentTime + 0.2);
      osc2.stop(this.ctx.currentTime + 0.2);
    } catch { /* noop */ }
    this.engine = null;
  }

  /** speedRatio 0..1, throttle 0..1, boosting bool */
  updateEngine(speedRatio, throttle, boosting) {
    if (!this.engine || !this.active) {
      if (this.engine) this.engine.gain.gain.value = 0.0001;
      return;
    }
    const t = this.ctx.currentTime;
    const target = 0.045 + speedRatio * 0.085 + throttle * 0.03 + (boosting ? 0.04 : 0);
    this.engine.gain.gain.setTargetAtTime(clamp(target, 0, 0.22), t, 0.08);
    const base = 62 + speedRatio * 190 + throttle * 46;
    this.engine.osc1.frequency.setTargetAtTime(base, t, 0.06);
    this.engine.osc2.frequency.setTargetAtTime(base * 1.51, t, 0.06);
    this.engine.filter.frequency.setTargetAtTime(420 + speedRatio * 2200, t, 0.1);
    this.engine.rumbleGain.gain.value = 0.18 + throttle * 0.2;
  }

  /* ── gameplay SFX ──────────────────────────────────────────── */
  skid() { this.noise({ dur: 0.35, gain: 0.12, filter: 'bandpass', freq: 1400, q: 2.2, sweepTo: 700 }); }
  drift() { this.noise({ dur: 0.22, gain: 0.07, filter: 'highpass', freq: 900 }); }
  boost() {
    this.noise({ dur: 1.0, gain: 0.22, filter: 'bandpass', freq: 300, q: 1.4, sweepTo: 4200 });
    this.tone({ type: 'sawtooth', freq: 120, freq2: 760, dur: 0.7, gain: 0.12 });
  }
  land() { this.noise({ dur: 0.18, gain: 0.22, filter: 'lowpass', freq: 400, sweepTo: 120 }); }
  bump(intensity = 1) {
    this.noise({ dur: 0.16, gain: clamp(0.16 * intensity, 0.02, 0.3), filter: 'lowpass', freq: 900, sweepTo: 200 });
    this.tone({ type: 'square', freq: 160, freq2: 70, dur: 0.12, gain: 0.1 * intensity });
  }
  hitmarker() { this.tone({ type: 'square', freq: 1500, freq2: 1100, dur: 0.05, gain: 0.1 }); }
  hurt() {
    this.noise({ dur: 0.25, gain: 0.26, filter: 'lowpass', freq: 800, sweepTo: 150 });
    this.tone({ type: 'sawtooth', freq: 220, freq2: 80, dur: 0.25, gain: 0.14 });
  }
  explosion() {
    this.noise({ dur: 0.9, gain: 0.5, filter: 'lowpass', freq: 1600, sweepTo: 90 });
    this.tone({ type: 'sawtooth', freq: 130, freq2: 40, dur: 0.7, gain: 0.22 });
    this.noise({ dur: 0.25, gain: 0.3, filter: 'highpass', freq: 2400, delay: 0.02 });
  }
  missileLaunch() {
    this.noise({ dur: 0.7, gain: 0.24, filter: 'bandpass', freq: 600, q: 1.1, sweepTo: 3000 });
    this.tone({ type: 'sawtooth', freq: 300, freq2: 900, dur: 0.3, gain: 0.1 });
  }
  gunshot() {
    this.noise({ dur: 0.07, gain: 0.18, filter: 'bandpass', freq: 1600, q: 1.1, sweepTo: 500 });
    this.tone({ type: 'square', freq: 420, freq2: 180, dur: 0.05, gain: 0.09 });
  }
  mineDrop() { this.tone({ type: 'triangle', freq: 340, freq2: 200, dur: 0.12, gain: 0.1 }); }
  shockwave() {
    this.tone({ type: 'sine', freq: 200, freq2: 30, dur: 0.7, gain: 0.35 });
    this.noise({ dur: 0.6, gain: 0.32, filter: 'lowpass', freq: 900, sweepTo: 100 });
  }
  shieldUp() {
    this.tone({ type: 'triangle', freq: 300, freq2: 900, dur: 0.35, gain: 0.16 });
    this.tone({ type: 'sine', freq: 900, freq2: 1400, dur: 0.5, gain: 0.1, delay: 0.08 });
  }
  repair() { [660, 880, 1100].forEach((f, i) => this.tone({ type: 'sine', freq: f, dur: 0.24, gain: 0.1, delay: i * 0.08 })); }
  pickup() { [700, 1050, 1400].forEach((f, i) => this.tone({ type: 'square', freq: f, dur: 0.09, gain: 0.09, delay: i * 0.045 })); }
  crateBreak() {
    this.noise({ dur: 0.28, gain: 0.22, filter: 'bandpass', freq: 900, q: 1.2, sweepTo: 300 });
    this.tone({ type: 'square', freq: 200, freq2: 90, dur: 0.18, gain: 0.12 });
  }
  horn() {
    [330, 415].forEach((f) => this.tone({ type: 'sawtooth', freq: f, dur: 0.4, gain: 0.12 }));
    this.tone({ type: 'sawtooth', freq: 165, dur: 0.45, gain: 0.1 });
  }
  killStreak(level = 2) {
    const base = 520 + level * 60;
    [1, 1.25, 1.5].forEach((m, i) =>
      this.tone({ type: 'square', freq: base * m, dur: 0.18, gain: 0.1, delay: i * 0.06 }));
  }
  respawn() {
    [400, 600, 900].forEach((f, i) => this.tone({ type: 'triangle', freq: f, dur: 0.2, gain: 0.1, delay: i * 0.05 }));
  }

  /* ── procedural music (menu / match loops) ─────────────────── */
  startMusic(mode = 'menu') {
    if (!this.init() || this.musicTimer) return;
    this.musicMode = mode;
    this.musicStep = 0;
    const bpm = mode === 'menu' ? 92 : 132;
    const interval = (60 / bpm) * 1000 * 0.5;
    const run = () => {
      if (!this.active) return;
      this.musicTick(mode);
    };
    run();
    this.musicTimer = setInterval(run, interval);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  musicTick(mode) {
    const step = this.musicStep++;
    const menuScale = [110, 130.81, 164.81, 196, 220, 261.63, 329.63];
    const matchScale = [82.41, 98, 110, 146.83, 164.81, 196, 220, 246.94];
    const scale = mode === 'menu' ? menuScale : matchScale;
    const bus = this.musicBus;
    const bar = Math.floor(step / 8) % 4;

    // bass pulse
    if (step % 4 === 0) {
      this.tone({ type: 'sawtooth', freq: scale[0] / 2, dur: 0.4, gain: 0.14, bus, attack: 0.02 });
    }
    if (mode === 'match' && step % 2 === 0) {
      this.tone({ type: 'square', freq: scale[0], dur: 0.12, gain: 0.07, bus });
    }
    // arpeggio
    const idx = (step * 3 + bar * 2) % scale.length;
    this.tone({ type: 'triangle', freq: scale[idx] * 2, dur: 0.22, gain: 0.06, bus, attack: 0.01 });
    if (step % 8 === 4) {
      this.tone({ type: 'triangle', freq: scale[(idx + 3) % scale.length] * 2, dur: 0.4, gain: 0.05, bus });
    }
    // hats
    if (mode === 'match' && step % 2 === 1) {
      this.noise({ dur: 0.05, gain: 0.045, filter: 'highpass', freq: 6500, bus });
    }
    // transition sweep at bar changes
    if (step % 32 === 0) {
      this.noise({ dur: 0.8, gain: 0.06, filter: 'bandpass', freq: 400, q: 1.6, sweepTo: 5000, bus });
    }
  }
}
