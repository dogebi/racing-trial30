// main.js — game loop, state machine, camera, restart/ghost orchestration
'use strict';
(function () {
  if (typeof THREE === 'undefined') {
    document.body.innerHTML = '<div style="color:#dfe8ff;padding:40px;font-family:sans-serif">' +
      'Three.js 로드 실패 — 네트워크(CDN) 연결을 확인한 뒤 새로고침 해주세요.</div>';
    return;
  }

  var STATE = { MENU: 0, READY: 1, RUNNING: 2, FINISHED: 3 };
  var state = STATE.MENU;
  var trackIdx = -1;
  var track = null;
  var car = Physics.makeCar();
  var carMesh = null, ghostMesh = null;
  var boostMat = null;

  var runMs = 0;               // run clock (starts on first throttle)
  var runStarted = false;
  var attempts = 0;
  var bestMs = null;
  var ghostRec = new Ghost.Recorder();
  var ghostPlay = new Ghost.Player(null);
  var ghostPos = { x: 0, y: 0, z: 0, yaw: 0 };

  var input = { throttle: 0, steer: 0, handbrake: false };
  var keys = {};
  var fovPunch = 0;            // 0..1 decaying boost punch
  var finishHold = 0;          // auto-restart countdown after finish
  var lastT = 0;
  var phys = 0;                // fixed-step accumulator

  var accentCss = '#3aa0ff';

  // ---------------- storage keys ----------------
  function bestKey(id) { return 'trial30.best.' + id; }

  // ---------------- track lifecycle ----------------
  function loadTrack(i, fromMenu) {
    trackIdx = i;
    track = TRACKS.get(i);
    accentCss = '#' + ('000000' + track.def.accent.toString(16)).slice(-6);
    boostMat = World.buildTrack(track);

    if (carMesh) World.scene().remove(carMesh.group);
    if (ghostMesh) World.scene().remove(ghostMesh.group);
    carMesh = World.makeCarMesh(track.def.accent, false);
    ghostMesh = World.makeCarMesh(0x7fe3ff, true);
    World.scene().add(carMesh.group);
    World.scene().add(ghostMesh.group);

    bestMs = U.load(bestKey(track.def.id), null);
    ghostPlay = new Ghost.Player(Ghost.load(track.def.id));
    attempts = 0;

    if (fromMenu) Hud.showMenu(false);
    Hud.setTrackInfo(track.def.name, bestMs, accentCss);
    Hud.setAttempts(attempts);
    restart(true);
    state = STATE.READY;
  }

  // instant restart: reuse meshes/scene, reset state only
  function restart(silent) {
    Physics.spawn(track, car, 2);
    runMs = 0; runStarted = false;
    finishHold = 0;
    state = STATE.READY;      // run clock arms again on first throttle input
    ghostRec.reset();
    Hud.hideFinish();
    Hud.setTimer(0);
    Hud.setTimerState(false);
    Hud.setDiff(null, false);
    attempts++;
    Hud.setAttempts(attempts);
    if (!silent) Sound.ui();
  }

  // ---------------- input ----------------
  function onKeyDown(e) {
    var k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright' || k === ' ') {
      e.preventDefault();
    }
    if (keys[k]) return;         // ignore auto-repeat
    keys[k] = true;
    Sound.resume();

    if (state === STATE.MENU) {
      var num = parseInt(k, 10);
      if (num >= 1 && num <= TRACKS.count) { Sound.ui(); loadTrack(num - 1, true); }
      return;
    }
    if (k === 'r') { restart(); return; }
    if (k === 'escape') {
      state = STATE.MENU;
      Hud.buildMenu(pickTrack, function (i) { return U.load(bestKey(TRACKS.defs[i].id), null); });
      Hud.showMenu(true);
      Sound.engineOff();
      return;
    }
    var num = parseInt(k, 10);
    if (num >= 1 && num <= TRACKS.count) { Sound.ui(); loadTrack(num - 1, true); }
  }
  function onKeyUp(e) { keys[e.key.toLowerCase()] = false; }
  function pickTrack(i) { Sound.ui(); loadTrack(i, true); }

  function readInput() {
    var up = keys['w'] || keys['arrowup'];
    var dn = keys['s'] || keys['arrowdown'];
    var lf = keys['a'] || keys['arrowleft'];
    var rt = keys['d'] || keys['arrowright'];
    input.throttle = (up ? 1 : 0) - (dn ? 1 : 0);
    input.steer = (lf ? 1 : 0) - (rt ? 1 : 0);
    input.handbrake = !!keys[' '];
    // arm the run clock on first forward input
    if (!runStarted && state === STATE.READY && input.throttle > 0) {
      runStarted = true;
      state = STATE.RUNNING;
      Hud.setTimerState(true);
    }
  }

  // ---------------- per-frame update ----------------
  function update(dt) {
    readInput();

    // fixed-step physics
    phys += dt;
    var guard = 0;
    while (phys >= Physics.DT && guard < 40) {
      phys -= Physics.DT;
      guard++;
      var ev;
      if (state === STATE.RUNNING || state === STATE.READY) {
        ev = Physics.step(track, car, input, Physics.DT);
        if (runStarted) {
          runMs += Physics.DT * 1000;
          ghostRec.push(runMs, car);
        }
        if (ev.boostedPulse) { fovPunch = 1; Sound.boost(); }
        if (ev.landed) Sound.land();
        if (ev.died) { Sound.die(); restart(true); return; }
        if (ev.finished) {
          onFinished();
          return;
        }
      }
    }

    // ---------- visuals ----------
    carMesh.group.position.set(car.x, car.y, car.z);
    carMesh.group.rotation.order = 'YXZ';
    carMesh.group.rotation.y = car.yaw;
    // pitch/roll from surface slope while grounded
    var q = track.query(car.x, car.z);
    var pitch = 0, roll = 0;
    if (car.grounded && q.idx >= 0) {
      var nd = q.idx;
      var slope = Math.asin(U.clamp(nd.ty, -1, 1));
      pitch = -slope;
      roll = car.grounded ? -nd.bank * 0.9 : 0;
    } else {
      var vy = car.vy, sp = Math.max(6, car.speed);
      pitch = U.clamp(-vy / sp, -0.5, 0.5);
    }
    carMesh.group.rotation.x += (pitch - carMesh.group.rotation.x) * 0.25;
    carMesh.group.rotation.z += (roll - carMesh.group.rotation.z) * 0.25;
    for (var wi = 0; wi < carMesh.wheels.length; wi++) {
      carMesh.wheels[wi].rotation.x += car.speed * dt * 1.4;
    }

    // ghost playback
    var ghostVisible = ghostPlay.ok && runStarted;
    ghostMesh.group.visible = ghostVisible;
    if (ghostVisible && ghostPlay.sample(runMs, ghostPos)) {
      ghostMesh.group.position.set(ghostPos.x, ghostPos.y, ghostPos.z);
      ghostMesh.group.rotation.y = ghostPos.yaw;
    }

    // camera: chase with smoothing + FOV punch
    var cam = World.camera();
    var fwdX = Math.sin(car.yaw), fwdZ = Math.cos(car.yaw);
    var dist = 10.5 + car.speed * 0.06;
    var height = 4.4 + car.speed * 0.02;
    var tx = car.x - fwdX * dist;
    var ty = car.y + height;
    var tz = car.z - fwdZ * dist;
    var sm = 1 - Math.pow(0.0008, dt);
    cam.position.x += (tx - cam.position.x) * sm;
    cam.position.y += (ty - cam.position.y) * sm;
    cam.position.z += (tz - cam.position.z) * sm;
    cam.lookAt(car.x + fwdX * 7, car.y + 1.2, car.z + fwdZ * 7);

    fovPunch = Math.max(0, fovPunch - dt * 1.7);
    var speedN = U.clamp(car.speed / Physics.MAXSPEED, 0, 1.4);
    var targetFov = 72 + speedN * 6 + fovPunch * 13;
    if (Math.abs(cam.fov - targetFov) > 0.05) {
      cam.fov += (targetFov - cam.fov) * (fovPunch > 0.1 ? 0.35 : 0.12);
      cam.updateProjectionMatrix();
    }

    // boost pad pulse
    if (boostMat) boostMat.opacity = 0.55 + 0.3 * Math.sin(performance.now() * 0.008);

    // HUD
    Hud.setTimer(runMs);
    if (bestMs != null && runStarted) Hud.setDiff(runMs - bestMs, true);
    Hud.setSpeed(car.speed * 3.2);
    Hud.setBoostGlow(car.boost);
    var lineI = U.clamp(Math.max(0, speedN - 0.62) / 0.78 + fovPunch * 0.55, 0, 1);
    Hud.drawSpeedLines(lineI, dt);
    Sound.engineUpdate(U.clamp(speedN, 0, 1), car.boost > 0);

    // finished: auto-restart for the loop
    if (state === STATE.FINISHED) {
      finishHold -= dt;
      if (finishHold <= 0) restart(true);
    }
  }

  function onFinished() {
    state = STATE.FINISHED;
    finishHold = 1.6;
    var isRecord = bestMs === null || runMs < bestMs;
    var prevBest = bestMs;
    if (isRecord) {
      bestMs = runMs;
      U.save(bestKey(track.def.id), Math.round(runMs));
      Ghost.save(track.def.id, ghostRec);
      ghostPlay = new Ghost.Player(Ghost.load(track.def.id));
      Hud.setTrackInfo(track.def.name, bestMs, accentCss);
      Hud.playNewRecord();
      Sound.record();
    } else {
      Sound.finish();
    }
    Hud.setTimer(runMs);
    Hud.setTimerState(false);
    var deltaTxt = '';
    if (isRecord) {
      deltaTxt = prevBest !== null ? '-' + ((prevBest - runMs) / 1000).toFixed(3) : '첫 기록!';
    } else {
      deltaTxt = '+' + ((runMs - prevBest) / 1000).toFixed(3);
    }
    Hud.showFinish(runMs, isRecord, deltaTxt);
    if (!isRecord) Hud.setDiff(runMs - bestMs, true);
  }

  // ---------------- main loop ----------------
  function frame(t) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.1, (t - lastT) / 1000 || 0.016);
    lastT = t;
    if (state === STATE.MENU) {
      // slow orbit over the last-loaded track for the menu backdrop
      if (track) {
        var cam = World.camera();
        var a = t * 0.00012;
        var n0 = track.nodes[Math.floor(track.N * 0.5)];
        cam.position.set(n0.x + Math.cos(a) * 70, n0.y + 34, n0.z + Math.sin(a) * 70);
        cam.lookAt(n0.x, n0.y, n0.z);
        if (Math.abs(cam.fov - 60) > 0.1) { cam.fov = 60; cam.updateProjectionMatrix(); }
      }
      Hud.drawSpeedLines(0, dt);
      World.render();
      return;
    }
    update(dt);
    World.render();
  }

  // ---------------- boot ----------------
  function boot() {
    var container = document.getElementById('app');
    World.init(container);
    Hud.init();
    Hud.buildMenu(pickTrack, function (i) { return U.load(bestKey(TRACKS.defs[i].id), null); });
    Hud.showMenu(true);
    // build track A behind the menu as a backdrop (play starts on pick/1-5 key)
    track = TRACKS.get(0);
    World.buildTrack(track);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    requestAnimationFrame(function (t) { lastT = t; requestAnimationFrame(frame); });
  }
  boot();
})();
