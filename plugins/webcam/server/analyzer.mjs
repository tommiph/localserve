/** Relative image measurements. No frames, thumbnails or pixel samples are persisted. */
import {randomUUID} from 'node:crypto';
export class FrameAnalyzer {
  constructor(settings) {
    this.settings = settings; this.events = new Map(); this.previous = null; this.current = null;
    this.session = randomUUID(); this.sequence = 0;
  }
  accept(grey, at) {
    if (!(grey instanceof Uint8Array) || grey.length !== 768 || !Number.isFinite(at)) throw Error('Invalid camera sample.');
    const s = this.settings;
    const mean = grey.reduce((sum, value) => sum + value, 0) / grey.length;
    const brightness = Math.round(mean / 255 * 1000) / 10;
    const baseline = !this.previous || at <= this.at || at - this.at > 3000;
    let percent = 0;
    if (!baseline) {
      const drift = s['compensate-lighting'] ? mean - this.mean : 0;
      let changed = 0;
      for (let i = 0; i < grey.length; i++) if (Math.abs(grey[i] - this.previous[i] - drift) >= s['pixel-threshold']) changed++;
      percent = Math.round(changed / grey.length * 1000) / 10;
    } else {
      this.events.clear(); this.lastMotion = null; this.motion = false; this.streak = 0;
      this.condition = null; this.candidate = null; this.lightStreak = 0;
    }
    this.streak = !baseline && percent >= s['motion-threshold'] ? this.streak + 1 : 0;
    if (this.streak >= s['motion-confirm-frames']) this.lastMotion = at;
    const active = this.lastMotion !== null && at - this.lastMotion < s['motion-hold-seconds'] * 1000;
    if (active !== this.motion) this.events.set(active ? 'motion-detected' : 'motion-ended',
      { 'motion': active, 'motion-percent': percent, brightness, 'captured-at': at });
    this.motion = active;
    const hysteresis = s['light-hysteresis'];
    let candidate = brightness < s['dark-threshold'] ? 'Dark' : brightness > s['bright-threshold'] ? 'Bright' : 'Normal';
    if (this.condition === 'Dark' && brightness < s['dark-threshold'] + hysteresis) candidate = 'Dark';
    if (this.condition === 'Bright' && brightness > s['bright-threshold'] - hysteresis) candidate = 'Bright';
    this.lightStreak = candidate === this.candidate ? this.lightStreak + 1 : 1;
    this.candidate = candidate;
    if (this.lightStreak >= s['light-confirm-frames'] && candidate !== this.condition) {
      if (this.condition !== null) this.events.set('lighting-changed',
        { brightness, condition: candidate, previous: this.condition, 'captured-at': at });
      this.condition = candidate;
    }
    this.current = { motion: active, 'motion-percent': percent, brightness,
      condition: this.condition || 'Measuring', 'captured-at': at };
    this.previous = Uint8Array.from(grey); this.at = at; this.mean = mean;
    return this.current;
  }
  takeEvents() {
    // Keep the latest occurrence of each transition, ordered by its frame time.
    const events = [...this.events].sort((a,b) => a[1]['captured-at'] - b[1]['captured-at'])
      .map(([id,payload]) => [id,{...payload,'occurrence-id':`${this.session}:${++this.sequence}`}]);
    this.events.clear(); return events;
  }
}
