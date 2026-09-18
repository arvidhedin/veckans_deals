/**
 * Web Audio API Sound Effects & Haptics for Katan Mobile
 */

class SoundEffects {
  constructor() {
    this.enabled = true;
    this.audioCtx = null;
  }

  _initCtx() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  vibrate(pattern = [30]) {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {}
    }
  }

  playDiceRoll() {
    if (!this.enabled) return;
    this._initCtx();
    if (!this.audioCtx) return;

    this.vibrate([20, 30, 20, 40]);

    // Fast rattle noise burst followed by wooden thud
    const now = this.audioCtx.currentTime;
    for (let i = 0; i < 5; i++) {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140 + Math.random() * 180, now + i * 0.05);
      gain.gain.setValueAtTime(0.15, now + i * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.05 + 0.04);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now + i * 0.05);
      osc.stop(now + i * 0.05 + 0.05);
    }
  }

  playBuild() {
    if (!this.enabled) return;
    this._initCtx();
    if (!this.audioCtx) return;

    this.vibrate([40]);
    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.15);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  playCollect() {
    if (!this.enabled) return;
    this._initCtx();
    if (!this.audioCtx) return;

    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  playTurnChime() {
    if (!this.enabled) return;
    this._initCtx();
    if (!this.audioCtx) return;

    this.vibrate([50, 40, 50]);
    const now = this.audioCtx.currentTime;
    const notes = [440, 554.37, 659.25]; // A major
    notes.forEach((freq, idx) => {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.2, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.08 + 0.25);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.26);
    });
  }
}

window.soundEffects = new SoundEffects();
