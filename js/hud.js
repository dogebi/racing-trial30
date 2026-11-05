// hud.js — DOM HUD, track-select menu, 2D canvas speed-line FX
'use strict';
var Hud = (function () {
  var el = {};            // cached DOM refs
  var fx, fxg;            // speed-line canvas
  var streaks = [];
  var onFinishClick = null;
  var menuVisible = true;

  function init() {
    ['menu', 'cards', 'hud', 'timer', 'diff', 'trackname', 'bestline', 'attempts',
     'speed', 'finish', 'newrecord', 'fx', 'audiobtn', 'boostbar', 'boostfill']
      .forEach(function (id) { el[id] = document.getElementById(id); });
    fx = el.fx;
    fxg = fx.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    el.audiobtn.addEventListener('click', function () {
      var m = !Sound.muted();
      Sound.setMuted(m);
      el.audiobtn.textContent = m ? '소리: 꺼짐' : '소리: 켜짐';
      Sound.resume();
      Sound.ui();
    });
    // seed streaks
    for (var i = 0; i < 34; i++) streaks.push(newStreak());
    return true;
  }
  function resize() {
    fx.width = window.innerWidth;
    fx.height = window.innerHeight;
  }
  function newStreak() {
    return {
      a: Math.random() * Math.PI * 2,          // angle
      r: 200 + Math.random() * 700,            // radius
      len: 60 + Math.random() * 160,
      w: 1 + Math.random() * 2.2,
      sp: 0.6 + Math.random() * 1.2
    };
  }

  // ---------- menu ----------
  function buildMenu(onPick, bestGetter) {
    el.cards.innerHTML = '';
    TRACKS.defs.forEach(function (def, i) {
      var card = document.createElement('div');
      card.className = 'card';
      var bt = bestGetter(i);
      card.innerHTML =
        '<span class="key">' + (i + 1) + '</span><span class="nm">' + def.name + '</span>' +
        '<div class="idea">' + def.idea + '</div>' +
        '<div class="bt">' + (bt != null ? 'BEST ' + U.fmt(bt) : '<span class="no">기록 없음</span>') + '</div>';
      card.addEventListener('click', function () { onPick(i); });
      el.cards.appendChild(card);
    });
  }
  function showMenu(v) {
    menuVisible = v;
    el.menu.style.display = v ? 'flex' : 'none';
    el.hud.style.display = v ? 'none' : 'block';
  }
  function isMenu() { return menuVisible; }

  // ---------- run HUD ----------
  function setTrackInfo(name, best, accentHex) {
    el.trackname.textContent = name;
    el.trackname.style.color = accentHex;
    el.bestline.textContent = best != null ? 'BEST ' + U.fmt(best) : 'BEST —';
  }
  function setTimer(ms) { el.timer.textContent = U.fmt(ms); }
  function setTimerState(running) {
    el.timer.className = running ? '' : 'low';
  }
  function setDiff(msDelta, hasBest) {
    if (!hasBest || msDelta === null) { el.diff.textContent = ''; el.diff.style.color = '#9fb4d8'; return; }
    el.diff.textContent = U.fmtDiff(msDelta);
    el.diff.style.color = msDelta <= 0 ? '#5cff9d' : '#ff6a5c';
  }
  function setAttempts(n) { el.attempts.textContent = '시도 ' + n; }
  function setSpeed(kmh) {
    el.speed.innerHTML = Math.round(kmh) + '<small> km/h</small>';
  }
  function setBoostGlow(v) {
    el.boostbar.style.display = v > 0 ? 'block' : 'none';
    el.boostfill.style.width = Math.round(U.clamp(v, 0, 1) * 100) + '%';
  }

  function showFinish(timeMs, isRecord, deltaTxt) {
    var f = el.finish;
    f.querySelector('.time').textContent = U.fmt(timeMs);
    f.querySelector('.sub').textContent = isRecord ? '베스트 타임 갱신! ' + (deltaTxt || '') : (deltaTxt || '');
    f.style.display = 'block';
  }
  function hideFinish() { el.finish.style.display = 'none'; }
  function playNewRecord() {
    var n = el.newrecord;
    n.classList.remove('anim');
    void n.offsetWidth;            // restart animation
    n.classList.add('anim');
  }

  // ---------- speed lines ----------
  function drawSpeedLines(intensity, dt) {
    var w = fx.width, h = fx.height;
    fxg.clearRect(0, 0, w, h);
    if (intensity <= 0.02) return;
    var cx = w / 2, cy = h / 2;
    fxg.save();
    fxg.lineCap = 'round';
    for (var i = 0; i < streaks.length; i++) {
      var s = streaks[i];
      s.r += s.sp * intensity * dt * 1400;
      if (s.r > Math.max(w, h)) { streaks[i] = newStreak(); s = streaks[i]; s.r = 160 + Math.random() * 120; }
      var x0 = cx + Math.cos(s.a) * s.r;
      var y0 = cy + Math.sin(s.a) * s.r;
      var x1 = cx + Math.cos(s.a) * (s.r + s.len * intensity);
      var y1 = cy + Math.sin(s.a) * (s.r + s.len * intensity);
      fxg.strokeStyle = 'rgba(150,205,255,' + (0.5 * intensity) + ')';
      fxg.lineWidth = s.w;
      fxg.beginPath();
      fxg.moveTo(x0, y0);
      fxg.lineTo(x1, y1);
      fxg.stroke();
    }
    fxg.restore();
  }

  return {
    init: init, buildMenu: buildMenu, showMenu: showMenu, isMenu: isMenu,
    setTrackInfo: setTrackInfo, setTimer: setTimer, setTimerState: setTimerState,
    setDiff: setDiff, setAttempts: setAttempts, setSpeed: setSpeed, setBoostGlow: setBoostGlow,
    showFinish: showFinish, hideFinish: hideFinish, playNewRecord: playNewRecord,
    drawSpeedLines: drawSpeedLines
  };
})();
