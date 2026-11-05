// physics.js — single arcade car, fixed timestep, surface-driven
'use strict';
var Physics = (function () {
  var DT = 1 / 120;              // fixed physics step
  var MAXSPEED = 46;             // base terminal speed (units/s)
  var BOOSTSPEED = 60;           // terminal speed while boosting
  var ACCEL = 26;                // throttle accel
  var BOOSTACCEL = 36;           // extra accel inside a boost pad
  var BRAKE = 42;
  var DRAG = 0.55;               // speed-scaled drag coefficient
  var GRIP = 9.5;                // lateral velocity kill rate (grounded)
  var HANDBRAKE_GRIP = 1.6;      // drifting
  var STEER = 2.35;              // rad/s at low speed
  var GRAVITY = 26;
  var SNAP_UP = 1.6;             // max ground rise followed per step
  var SNAP_DOWN = 2.4;           // max ground drop followed before airborne
  var AIR_STEER = 0.55;          // yaw control in air

  function makeCar() {
    return {
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      yaw: 0,
      grounded: true,
      wasGrounded: true,
      prevGroundY: 0,
      boost: 0,            // current pad strength (0 = none)
      speed: 0,
      lastPadS: -1,        // one FX pulse per pad pass
      progressS: 0,
      maxS: 0,
      airTime: 0
    };
  }

  // spawn at track node `back` (default 2) before the start line
  function spawn(track, car, back) {
    back = back || 2;
    var n = track.nodes[Math.min(back, track.N - 1)];
    car.x = n.x; car.y = n.y; car.z = n.z;
    car.vx = 0; car.vy = 0; car.vz = 0;
    car.yaw = n.yaw;
    car.grounded = true; car.wasGrounded = true;
    car.prevGroundY = n.y;
    car.boost = 0; car.speed = 0;
    car.lastPadS = -1;
    car.progressS = n.s; car.maxS = n.s; car.airTime = 0;
  }

  // one fixed step. input: {throttle -1..1, steer -1..1, handbrake bool}
  // returns events {died, finished, boostedPulse, landed}
  function step(track, car, input, dt) {
    var ev = { died: false, finished: false, boostedPulse: false, landed: false };
    var q = track.query(car.x, car.z, car.y);

    car.progressS = q.s;
    if (q.s > car.maxS) car.maxS = q.s;
    car.wasGrounded = car.grounded;

    // ---------- vertical / surface ----------
    var onRoad = q.onTrack;
    var groundY = onRoad ? q.y : -1e4;
    if (onRoad) {
      var dy = groundY - car.y;
      if (dy <= SNAP_UP && dy >= -SNAP_DOWN) {
        if (car.grounded) {
          // follow the surface; vertical velocity comes from the slope
          car.vy = U.clamp((groundY - car.prevGroundY) / dt, -34, 34);
        } else {
          ev.landed = true;
          car.vy = 0;
          car.airTime = 0;
        }
        car.y = groundY;
        car.prevGroundY = groundY;
        car.grounded = true;
      } else {
        car.grounded = false;   // ground fell away or rose too fast -> airborne
      }
    } else {
      car.grounded = false;
    }

    // ---------- planar movement ----------
    var sin = Math.sin(car.yaw), cos = Math.cos(car.yaw);
    var fwdX = sin, fwdZ = cos;          // forward = (sin, 0, cos), matches node.yaw
    var rightX = cos, rightZ = -sin;
    var vFwd = car.vx * fwdX + car.vz * fwdZ;
    var vLat = car.vx * rightX + car.vz * rightZ;

    var pad = (onRoad && q.boost > 0 && Math.abs(q.u) <= q.hw) ? q.boost : 0;

    if (car.grounded) {
      if (input.throttle > 0) vFwd += ACCEL * input.throttle * dt;
      else if (input.throttle < 0) {
        if (vFwd > 0) vFwd += BRAKE * input.throttle * dt;       // braking
        else vFwd += ACCEL * 0.5 * input.throttle * dt;          // reverse
      }
      if (pad > 0) vFwd += BOOSTACCEL * pad * dt;

      // drag toward terminal speed; pads raise the ceiling
      var term = pad > 0 ? BOOSTSPEED * (0.9 + 0.25 * pad) : MAXSPEED;
      var dragK = DRAG * (pad > 0 ? 0.5 : 1);
      // factor tuned so base equilibrium speed ~= MAXSPEED under throttle
      vFwd -= dragK * vFwd * Math.abs(vFwd) * dt * 0.0123;
      var excess = vFwd - term;
      if (excess > 0) vFwd = term + excess * Math.pow(0.25, dt); // bleed overspeed
      if (vFwd < -8) vFwd = -8;

      // lateral grip
      var g = input.handbrake ? HANDBRAKE_GRIP : GRIP;
      vLat -= vLat * Math.min(1, g * dt);

      // steering scales with speed, reverses when backing up
      var spdN = Math.min(1, Math.abs(vFwd) / 18);
      var dir = vFwd >= -0.5 ? 1 : -1;
      car.yaw += input.steer * STEER * spdN * dir * dt;
    } else {
      car.airTime += dt;
      car.yaw += input.steer * STEER * AIR_STEER * dt;
    }
    car.boost = pad;

    if (!car.grounded) car.vy -= GRAVITY * dt;

    car.vx = fwdX * vFwd + rightX * vLat;
    car.vz = fwdZ * vFwd + rightZ * vLat;
    car.speed = Math.sqrt(car.vx * car.vx + car.vz * car.vz);

    // integrate
    car.x += car.vx * dt;
    car.y += car.vy * dt;
    car.z += car.vz * dt;

    // ---------- events ----------
    if (pad > 0) {
      var key = q.idx.s;
      if (car.lastPadS !== key) {
        car.lastPadS = key;
        ev.boostedPulse = true;
      }
    }

    // death: fell below the road band
    var refY = onRoad ? q.y : refYAt(track, car);
    if (car.y < refY - track.def.killDepth) ev.died = true;
    if (car.y < -40) ev.died = true;

    // finish: reached the final stretch while on road
    if (onRoad && car.progressS >= track.length - 4 && car.maxS >= track.length - 4) {
      ev.finished = true;
    }
    return ev;
  }

  function refYAt(track, car) {
    var i = Math.min(track.N - 1, Math.max(0, Math.floor(car.maxS / track.spacing)));
    var nd = track.nodes[i];
    return nd ? nd.y : 0;
  }

  return { DT: DT, MAXSPEED: MAXSPEED, makeCar: makeCar, spawn: spawn, step: step };
})();
