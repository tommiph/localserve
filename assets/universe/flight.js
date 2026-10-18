/* Pure flight state, also exercised by offline tests. Hidden/disconnected time
 * never advances this clock: the viewer supplies only active elapsed seconds. */
(function (root) {
  'use strict';
  function Flight(random) { this.random = random || Math.random; this.index = -1; this.phase = 'hold'; this.elapsed = 0; this.duration = 0; this.count = 0; }
  Flight.prototype.reset = function (count) { this.count = count; this.index = count ? 0 : -1; this.phase = 'hold'; this.elapsed = 0; };
  Flight.prototype.next = function (settings) {
    if (!this.count) return;
    this.previous = this.index;
    this.index = settings.order === 'shuffle' && this.count > 1
      ? (this.index + 1 + Math.floor(this.random() * (this.count - 1))) % this.count
      : (this.index + 1) % this.count;
    this.duration = settings.flightMinSeconds + this.random() * (settings.flightMaxSeconds - settings.flightMinSeconds);
    this.phase = 'flight'; this.elapsed = 0;
  };
  Flight.prototype.tick = function (seconds, settings) {
    this.elapsed += seconds;
    if (this.phase === 'hold' && this.elapsed >= settings.holdSeconds) {
      var departureElapsed = settings.holdSeconds === 0 ? this.elapsed : 0;
      this.next(settings); this.elapsed = departureElapsed; return 'depart';
    }
    if (this.phase === 'flight' && this.elapsed >= this.duration) {
      if (settings.holdSeconds === 0) {
        // Carry the frame's remaining time directly into the next leg. A zero
        // stop must never insert a hold frame or lose time at a Card boundary.
        var remaining = this.elapsed - this.duration;
        this.next(settings); this.elapsed = remaining; return 'pass';
      }
      this.phase = 'hold'; this.elapsed = 0; return 'arrive';
    }
    return null;
  };
  Flight.prototype.progress = function () { return this.phase === 'hold' ? 1 : Math.min(1, this.elapsed / this.duration); };
  Flight.ease = function (value) { return value * value * value * (value * (value * 6 - 15) + 10); };
  root.UniverseFlight = Flight;
}(typeof window === 'undefined' ? globalThis : window));
