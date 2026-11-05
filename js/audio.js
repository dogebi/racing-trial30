// audio.js — procedural WebAudio: engine (speed pitch), boost, record jingle.
// No external files; everything is synthesized. Created lazily on first
// user gesture (autoplay policy).
'use strict';
var Sound = (function () {
  var ctx = null, master = null, muted = false;
  var engine = null;   // {osc1, osc2, gain, filter}

  function init() {
    if (ctx) return true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      buildEngine();
      return true;
    } catch (e) { ctx = null; return false; }
  }
  function resume() {
    if (!init()) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
  }
  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.5;
  }

  // ---------- engine: two detuned saws through a lowpass ----------
  function buildEngine() {
    var g = ctx.createGain();
    g.gain.value = 0;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 2;
    var o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
    var o2 = ctx.createOscillator(); o2.type = 'square';   o2.frequency.value = 91;
    var o2g = ctx.createGain(); o2g.gain.value = 0.4;
    o1.connect(f); o2.connect(o2g); o2g.connect(f);
    f.connect(g); g.connect(master);
    o1.start(); o2.start();
    engine = { o1: o1, o2: o2, g: g, f: f };
  }
  // speed 0..1, boost 0/1
  function engineUpdate(speed, boosting) {
    if (!engine) return;
    var t = ctx.currentTime;
    var f = 52 + speed * 210 + (boosting ? 26 : 0);
    try {
      engine.o1.frequency.setTargetAtTime(f, t, 0.05);
      engine.o2.frequency.setTargetAtTime(f * 1.503, t, 0.05);
      engine.g.gain.setTargetAtTime(0.06 + speed * 0.10, t, 0.08);
      engine.f.frequency.setTargetAtTime(700 + speed * 2200, t, 0.07);
    } catch (e) { /* ignore */ }
  }
  function engineOff() {
    if (!engine) return;
    try { engine.g.gain.setTargetAtTime(0, ctx.currentTime, 0.12); } catch (e) { /* ignore */ }
  }

  // ---------- one-shot helpers ----------
  function blip(freq, dur, type, vol, sweep) {
    if (!ctx) return;
    try {
      var t = ctx.currentTime;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(30, sweep), t + dur);
      g.gain.setValueAtTime(vol || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* ignore */ }
  }

  function boost()   { blip(180, 0.45, 'sawtooth', 0.16, 900); blip(90, 0.3, 'square', 0.1, 320); }
  function land()    { blip(120, 0.12, 'triangle', 0.14, 50); }
  function die()     { blip(300, 0.35, 'sawtooth', 0.14, 40); blip(150, 0.4, 'square', 0.08, 30); }
  function finish()  { blip(660, 0.12, 'sine', 0.18); blip(880, 0.18, 'sine', 0.18); }
  function record() {
    if (!ctx) return;
    // little ascending fanfare: C-E-G-C
    var seq = [523, 659, 784, 1047];
    for (var i = 0; i < seq.length; i++) {
      (function (f, delay) {
        try {
          var t = ctx.currentTime + delay;
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'triangle'; o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
          o.connect(g); g.connect(master);
          o.start(t); o.stop(t + 0.4);
        } catch (e) { /* ignore */ }
      })(seq[i], i * 0.11);
    }
  }
  function ui() { blip(520, 0.06, 'sine', 0.1); }

  return {
    init: init, resume: resume, setMuted: setMuted, muted: function () { return muted; },
    engineUpdate: engineUpdate, engineOff: engineOff,
    boost: boost, land: land, die: die, finish: finish, record: record, ui: ui
  };
})();
