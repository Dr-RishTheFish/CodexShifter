"use strict";
class CarSounds {
  constructor() {
    this.context = null;
    this.enabled = true;
  }
  shift(up = true) {
    if (!this.enabled) return;
    try {
      const ctx =
        this.context ||
        (this.context = new (window.AudioContext ||
          window.webkitAudioContext)());
      ctx.resume();
      const now = ctx.currentTime,
        duration = up ? 0.58 : 0.8;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.055, now);
      master.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      master.connect(ctx.destination);
      // A four-cylinder firing fundamental plus harmonics creates a short engine rev.
      for (const harmonic of [1, 2, 3, 4, 6]) {
        const osc = ctx.createOscillator(),
          gain = ctx.createGain();
        osc.type = harmonic === 1 ? "sawtooth" : "triangle";
        gain.gain.value = 1 / (harmonic * 2);
        const base = up ? 72 : 105;
        osc.frequency.setValueAtTime(base * harmonic, now);
        osc.frequency.exponentialRampToValueAtTime(
          (up ? 150 : 210) * harmonic,
          now + 0.16,
        );
        osc.frequency.exponentialRampToValueAtTime(
          (up ? 90 : 120) * harmonic,
          now + duration,
        );
        osc.connect(gain).connect(master);
        osc.start(now);
        osc.stop(now + duration);
      }
      const noise = ctx.createBuffer(
        1,
        Math.ceil(ctx.sampleRate * 0.16),
        ctx.sampleRate,
      );
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] =
          (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.024));
      const source = ctx.createBufferSource();
      source.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 950;
      const impact = ctx.createGain();
      impact.gain.value = 0.13;
      source.connect(filter).connect(impact).connect(ctx.destination);
      source.start(now + 0.18);
      source.stop(now + 0.34);
    } catch {}
  }
}
window.CarSounds = CarSounds;
