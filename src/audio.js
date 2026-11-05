// Tiny synthesized sound engine. No assets, no downloads — everything is WebAudio.
// All sounds are created lazily after the first user gesture (browser autoplay rules).

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._drone = null;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    // shared noise buffer
    const len = this.ctx.sampleRate * 1.2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return this.ctx;
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.t, 0.02);
    return this.muted;
  }

  _env(node, t0, a, d, peak = 0.5) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    node.connect(g);
    g.connect(this.master);
    return g;
  }

  _noise(t0, dur, freq, q, peak) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    src.connect(bp);
    this._env(bp, t0, 0.002, dur, peak);
    src.start(t0, Math.random() * 0.5, dur + 0.05);
  }

  _tone(type, f0, f1, t0, a, d, peak = 0.25) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + a + d);
    this._env(o, t0, a, d, peak);
    o.start(t0);
    o.stop(t0 + a + d + 0.05);
  }

  // --- game sounds -----------------------------------------------------------
  // `hp` lets the gun get audibly weaker as PULSE drains: the player should be
  // able to hear that they are running out before they read it.
  shoot(overdraft = false, hp = 8) {
    if (!this.ensure() || this.muted) return;
    const t0 = this.t;
    const low = Math.max(0, Math.min(1, hp / 8));
    const base = (overdraft ? 900 : 660) * (0.72 + 0.28 * low);
    this._tone('square', base, base * 0.33, t0, 0.001, 0.07, 0.10);
    this._noise(t0, 0.05, 2600, 1.2, 0.10);
  }

  hit() {
    if (!this.ensure() || this.muted) return;
    const t0 = this.t;
    this._noise(t0, 0.04, 1800, 1.6, 0.14);
  }

  // The exact sound of a kill paying for the shot that caused it. Pitch rises with
  // the refund, so a brute sounds like a jackpot and a scrapper like a coin.
  refund(amount = 1) {
    if (!this.ensure() || this.muted) return;
    const t0 = this.t;
    const base = 620 + Math.min(6, amount) * 95;
    this._tone('sine', base, base * 1.5, t0, 0.002, 0.07, 0.10);
    this._tone('triangle', base * 1.5, base * 1.9, t0 + 0.06, 0.002, 0.08, 0.07);
  }

  // A quiet two-bar bass loop so the arena is not silent between shots. Deliberately
  // sparse: a browser game that loops a busy melody gets muted in ten seconds.
  startMusic() {
    if (!this.ensure() || this.muted || this._music) return;
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0.0;
    g.gain.setTargetAtTime(0.055, this.t, 1.2);
    g.connect(this.master);
    const notes = [55, 55, 73.4, 55, 61.7, 55, 82.4, 73.4];   // A1 / D2 / B1 / E2
    const spb = 0.46;
    const self = this;
    let step = 0;
    const tick = () => {
      if (!self._music) return;
      const n = notes[step % notes.length];
      const t0 = self.t;
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = n;
      const env = c.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.9, t0 + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + spb * 0.9);
      o.connect(env); env.connect(g);
      o.start(t0); o.stop(t0 + spb);
      step++;
      self._musicTimer = setTimeout(tick, spb * 1000);
    };
    this._music = { g };
    tick();
  }

  stopMusic() {
    if (this._musicTimer) clearTimeout(this._musicTimer);
    if (this._music) {
      const { g } = this._music;
      try {
        g.gain.setTargetAtTime(0, this.t, 0.25);
        setTimeout(() => { try { g.disconnect(); } catch {} }, 600);
      } catch {}
      this._music = null;
    }
  }

  kill() {
    if (!this.ensure() || this.muted) return;
    const t0 = this.t;
    this._tone('sawtooth', 420, 90, t0, 0.002, 0.16, 0.14);
    this._noise(t0, 0.12, 700, 0.9, 0.16);
    // arcade confirmation blip: the reward for a kill is audible, not just visual
    this._tone('square', 1180, 1180, t0 + 0.01, 0.001, 0.05, 0.045);
    this._tone('square', 1560, 1560, t0 + 0.045, 0.001, 0.055, 0.035);
  }

  hurt() {
    if (!this.ensure() || this.muted) return;
    const t0 = this.t;
    this._tone('sine', 140, 48, t0, 0.002, 0.26, 0.35);
    this._noise(t0, 0.18, 320, 0.7, 0.22);
  }

  orb() {
    if (!this.ensure() || this.muted) return;
    const t0 = this.t;
    this._tone('sine', 520, 1040, t0, 0.004, 0.09, 0.10);
  }

  dash() {
    if (!this.ensure() || this.muted) return;
    const t0 = this.t;
    this._tone('triangle', 240, 900, t0, 0.002, 0.14, 0.12);
    this._noise(t0, 0.14, 1400, 0.6, 0.08);
  }

  // level cleared: a rising two-note arcade flourish
  levelClear() {
    if (!this.ensure() || this.muted) return;
    const t0 = this.t;
    this._tone('square', 660, 660, t0, 0.002, 0.09, 0.12);
    this._tone('square', 990, 990, t0 + 0.09, 0.002, 0.10, 0.11);
    this._tone('square', 1320, 1320, t0 + 0.19, 0.002, 0.16, 0.10);
  }

  // level failed: a flat descending buzz, clearly not the death sound
  levelFail() {
    if (!this.ensure() || this.muted) return;
    const t0 = this.t;
    this._tone('sawtooth', 240, 150, t0, 0.004, 0.22, 0.13);
    this._tone('sawtooth', 180, 110, t0 + 0.16, 0.004, 0.26, 0.11);
  }

  // armour: a metallic clang that says 'that did nothing'
  clang() {
    if (!this.ensure() || this.muted) return;
    const t0 = this.t;
    this._tone('square', 1500, 900, t0, 0.001, 0.05, 0.07);
    this._noise(t0, 0.04, 3200, 2.2, 0.07);
  }

  wave() {
    if (!this.ensure() || this.muted) return;
    const t0 = this.t;
    this._tone('sine', 300, 600, t0, 0.01, 0.18, 0.16);
    this._tone('sine', 450, 900, t0 + 0.08, 0.01, 0.2, 0.12);
  }

  death() {
    if (!this.ensure() || this.muted) return;
    const now = this.t;
    if (this._lastDeath != null && now - this._lastDeath < 0.5) return;
    this._lastDeath = now;
    const t0 = this.t;
    this._tone('sawtooth', 300, 40, t0, 0.01, 0.8, 0.3);
    this._noise(t0, 0.6, 260, 0.5, 0.2);
  }

  heartbeat(strength = 1) {
    if (!this.ensure() || this.muted) return;
    const t0 = this.t;
    this._tone('sine', 62, 40, t0, 0.004, 0.11, 0.32 * strength);
    this._tone('sine', 58, 36, t0 + 0.15, 0.004, 0.14, 0.24 * strength);
  }

  // Low, uneasy drone that runs while the player is in OVERDRAFT.
  overdraftOn() {
    if (!this.ensure() || this._drone) return;
    const c = this.ctx, t0 = this.t;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.12, t0, 0.3);
    g.connect(this.master);
    const a = c.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 55;
    const b = c.createOscillator(); b.type = 'sine'; b.frequency.value = 58.5;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    a.connect(lp); b.connect(lp); lp.connect(g);
    a.start(t0); b.start(t0);
    this._drone = { a, b, g };
  }

  overdraftOff() {
    if (!this._drone) return;
    const { a, b, g } = this._drone;
    const t0 = this.t;
    g.gain.setTargetAtTime(0, t0, 0.08);
    a.stop(t0 + 0.5); b.stop(t0 + 0.5);
    this._drone = null;
  }
}
