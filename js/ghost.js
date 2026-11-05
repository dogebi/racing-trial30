// ghost.js — per-frame position/yaw recording + interpolated playback
// Best-run ghost per track; persisted to storage (memory-safe fallback).
'use strict';
var Ghost = (function () {
  var SAMPLE_MS = 16.6667;       // ~60Hz, decimated from 120Hz physics
  var KEY = 'trial30.ghost.';

  function Recorder() {
    this.t = [];   // ms since run start
    this.x = []; this.y = []; this.z = []; this.yaw = [];
    this._acc = 0;
  }
  Recorder.prototype.push = function (ms, car) {
    this._acc += 1;
    if (this._acc % 2 !== 0) return;  // record every 2nd physics step
    this.t.push(Math.round(ms));
    this.x.push(+car.x.toFixed(2));
    this.y.push(+car.y.toFixed(2));
    this.z.push(+car.z.toFixed(2));
    this.yaw.push(+car.yaw.toFixed(3));
  };
  Recorder.prototype.reset = function () {
    this.t.length = 0; this.x.length = 0; this.y.length = 0;
    this.z.length = 0; this.yaw.length = 0;
    this._acc = 0;
  };

  // Player wraps a recorded sample set and evaluates by time.
  function Player(data) {
    this.ok = !!(data && data.t && data.t.length > 1);
    this.d = data || null;
    this._i = 0;
  }
  Player.prototype.sample = function (ms, out) {
    if (!this.ok) return false;
    var t = this.d.t, n = t.length;
    if (ms >= t[n - 1]) {
      out.x = this.d.x[n - 1]; out.y = this.d.y[n - 1];
      out.z = this.d.z[n - 1]; out.yaw = this.d.yaw[n - 1];
      return true;
    }
    var i = this._i;
    if (i >= n || t[i] > ms) i = 0;
    while (i < n - 1 && t[i + 1] <= ms) i++;
    this._i = i;
    var t0 = t[i], t1 = t[Math.min(n - 1, i + 1)];
    var f = t1 > t0 ? (ms - t0) / (t1 - t0) : 0;
    f = U.clamp(f, 0, 1);
    var j = Math.min(n - 1, i + 1);
    out.x = U.lerp(this.d.x[i], this.d.x[j], f);
    out.y = U.lerp(this.d.y[i], this.d.y[j], f);
    out.z = U.lerp(this.d.z[i], this.d.z[j], f);
    out.yaw = U.lerpAngle(this.d.yaw[i], this.d.yaw[j], f);
    return true;
  };

  // storage — rounded arrays keep each ghost ~40-100KB
  function load(trackId) {
    return U.load(KEY + trackId, null);
  }
  function save(trackId, rec) {
    return U.save(KEY + trackId, { t: rec.t, x: rec.x, y: rec.y, z: rec.z, yaw: rec.yaw });
  }

  return { Recorder: Recorder, Player: Player, load: load, save: save, SAMPLE_MS: SAMPLE_MS };
})();
