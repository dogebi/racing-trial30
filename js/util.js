// util.js — storage wrapper (localStorage try/catch safe), math helpers, formatting
'use strict';
var U = (function () {
  var mem = {};            // in-memory fallback when storage is unavailable (file:// etc.)
  var storageOK = false;
  try {
    var k = '__trial30_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    storageOK = true;
  } catch (e) { storageOK = false; }

  function load(key, fallback) {
    if (storageOK) {
      try {
        var raw = window.localStorage.getItem(key);
        if (raw === null || raw === undefined) return fallback;
        return JSON.parse(raw);
      } catch (e) { return fallback; }
    }
    return (key in mem) ? mem[key] : fallback;
  }
  function save(key, val) {
    if (storageOK) {
      try { window.localStorage.setItem(key, JSON.stringify(val)); return true; }
      catch (e) { /* quota or privacy mode: fall through to memory */ }
    }
    try { mem[key] = val; } catch (e2) { /* ignore */ }
    return false;
  }

  function fmt(ms) { // 12.345
    var t = Math.max(0, ms);
    var s = Math.floor(t / 1000);
    var m = Math.floor(s / 60);
    var r = (t % 1000);
    var ss = s % 60;
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return m > 0 ? m + ':' + p2(ss) + '.' + p2(Math.floor(r / 10))
                 : ss + '.' + p2(Math.floor(r / 10)) + Math.floor(r % 10);
  }
  function fmtDiff(ms) { // +0.123 / -0.456
    var sign = ms >= 0 ? '+' : '-';
    return sign + (Math.abs(ms) / 1000).toFixed(3);
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  // shortest-arc angle interpolation
  function lerpAngle(a, b, t) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  return {
    load: load, save: save, storageOK: function () { return storageOK; },
    fmt: fmt, fmtDiff: fmtDiff, clamp: clamp, lerp: lerp, smooth: smooth, lerpAngle: lerpAngle
  };
})();
