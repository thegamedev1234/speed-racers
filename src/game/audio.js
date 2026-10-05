/**
 * Super Racers - Audio Synthesizer
 * Uses Web Audio API to create arcade sound effects without external audio file dependencies.
 */

export class SoundSystem {
  constructor(profileManager) {
    this.profileManager = profileManager;
    this.ctx = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.isEngineRunning = false;
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  isEnabled() {
    return this.profileManager.getAudioEnabled() && this.profileManager.getVolume() > 0;
  }

  getVolume() {
    return this.profileManager.getVolume();
  }

  playClick() {
    if (!this.isEnabled()) return;
    this.init();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);

      gain.gain.setValueAtTime(0.2 * this.getVolume(), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {
      // Audio autoplay policy catch
    }
  }

  playChime() {
    if (!this.isEnabled()) return;
    this.init();
    if (!this.ctx) return;

    try {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      const now = this.ctx.currentTime;

      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const start = now + idx * 0.06;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.25 * this.getVolume(), start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(start);
        osc.stop(start + 0.2);
      });
    } catch (e) {}
  }

  playCountdownTick() {
    if (!this.isEnabled()) return;
    this.init();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(440, now); // A4

      gain.gain.setValueAtTime(0.3 * this.getVolume(), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.15);
    } catch (e) {}
  }

  playCountdownGo() {
    if (!this.isEnabled()) return;
    this.init();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      [880, 1174.66, 1760].forEach(freq => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.35 * this.getVolume(), now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.5);
      });
    } catch (e) {}
  }

  playBump() {
    if (!this.isEnabled()) return;
    this.init();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);

      gain.gain.setValueAtTime(0.4 * this.getVolume(), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.1);
    } catch (e) {}
  }

  startEngine() {
    if (!this.isEnabled() || this.isEngineRunning) return;
    this.init();
    if (!this.ctx) return;

    try {
      this.engineOsc = this.ctx.createOscillator();
      this.engineGain = this.ctx.createGain();

      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.setValueAtTime(65, this.ctx.currentTime);

      this.engineGain.gain.setValueAtTime(0.08 * this.getVolume(), this.ctx.currentTime);

      this.engineOsc.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);

      this.engineOsc.start();
      this.isEngineRunning = true;
    } catch (e) {}
  }

  updateEngine(speedNormalized) {
    if (!this.isEngineRunning || !this.engineOsc || !this.ctx) return;
    if (!this.isEnabled()) {
      this.stopEngine();
      return;
    }

    try {
      const baseFreq = 65;
      const targetFreq = baseFreq + Math.abs(speedNormalized) * 160;
      this.engineOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.05);

      const targetVol = (0.05 + Math.abs(speedNormalized) * 0.1) * this.getVolume();
      this.engineGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.05);
    } catch (e) {}
  }

  stopEngine() {
    if (this.isEngineRunning && this.engineOsc) {
      try {
        this.engineOsc.stop();
        this.engineOsc.disconnect();
      } catch (e) {}
      this.engineOsc = null;
      this.engineGain = null;
      this.isEngineRunning = false;
    }
  }
}
