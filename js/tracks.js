// tracks.js — track definitions + spline builder + surface query
// Catmull-Rom resampled centerline nodes with per-node half-width, bank,
// boost flag and gap flag. The surface query is the single source of truth
// for both physics and finish detection.
'use strict';
var TRACKS = (function () {
  var SPACING = 2.0;   // node spacing (units)
  var CELL = 24;       // spatial hash cell size

  function crPoint(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return {
      x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
    };
  }

  // def.pts: [x, z, height, halfWidth, bankDeg, opts]
  // opts.boost: boost strength from this pt until the next; opts.gap: no road until the next pt
  function build(def) {
    var pts = def.pts.map(function (p) {
      var o = p[5] || {};
      return { x: p[0], y: p[2], z: p[1], hw: p[3], bank: (p[4] || 0) * Math.PI / 180,
               boost: o.boost || 0, gap: o.gap ? 1 : 0 };
    });
    var n = pts.length;
    var get = function (i) { return pts[Math.max(0, Math.min(n - 1, i))]; };

    var nodes = [];
    var boost = 0, gap = 0, s = 0;
    var prev = null;
    for (var i = 0; i < n - 1; i++) {
      var cp = pts[i];
      boost = cp.boost || 0;
      gap = cp.gap;
      var p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      var segLen = Math.sqrt((p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y) + (p2.z - p1.z) * (p2.z - p1.z));
      var steps = Math.max(1, Math.round(segLen / SPACING));
      for (var j = 0; j < steps; j++) {
        var t = j / steps;
        var pos = crPoint(p0, p1, p2, p3, t);
        if (prev) {
          var dx = pos.x - prev.x, dy = pos.y - prev.y, dz = pos.z - prev.z;
          var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < 1e-4) continue;
          s += d;
        }
        nodes.push({
          x: pos.x, y: pos.y, z: pos.z,
          hw: p1.hw + (p2.hw - p1.hw) * t,
          bank: p1.bank + (p2.bank - p1.bank) * t,
          boost: boost, gap: gap, s: s
        });
        prev = pos;
      }
    }
    var lp = pts[n - 1];
    if (prev) {
      var ldx = lp.x - prev.x, ldy = lp.y - prev.y, ldz = lp.z - prev.z;
      s += Math.sqrt(ldx * ldx + ldy * ldy + ldz * ldz);
    }
    nodes.push({ x: lp.x, y: lp.y, z: lp.z, hw: lp.hw, bank: lp.bank,
                 boost: 0, gap: 0, s: s });

    // tangents, banked right vectors, yaw
    var N = nodes.length;
    for (var k = 0; k < N; k++) {
      var nd = nodes[k];
      var a = nodes[Math.max(0, k - 1)], b = nodes[Math.min(N - 1, k + 1)];
      var tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
      var tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      var fl = Math.sqrt(tz * tz + tx * tx) || 1;
      var rfx = tz / fl, rfz = -tx / fl;
      var cb = Math.cos(nd.bank), sb = Math.sin(nd.bank);
      nd.tx = tx; nd.ty = ty; nd.tz = tz;
      nd.rx = rfx * cb; nd.ry = sb; nd.rz = rfz * cb;
      nd.yaw = Math.atan2(tx, tz);
    }

    // spatial hash over XZ
    var grid = {};
    for (var m = 0; m < N; m++) {
      var qn = nodes[m];
      var key = Math.floor(qn.x / CELL) + ',' + Math.floor(qn.z / CELL);
      (grid[key] || (grid[key] = [])).push(m);
    }

    // query(px,pz[,py]) -> surface info at horizontal position.
    // py (optional) makes the search height-aware so stacked sections
    // (e.g. a spiral passing over itself) don't grab each other.
    function query(px, pz, py) {
      var cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
      var best = -1, bestD = Infinity;
      var bestNear = -1, bestNearD = Infinity;
      for (var gx = cx - 1; gx <= cx + 1; gx++) {
        for (var gz = cz - 1; gz <= cz + 1; gz++) {
          var bucket = grid[gx + ',' + gz];
          if (!bucket) continue;
          for (var q = 0; q < bucket.length; q++) {
            var idx = bucket[q];
            var nd2 = nodes[idx];
            var ddx = px - nd2.x, ddz = pz - nd2.z;
            var d2 = ddx * ddx + ddz * ddz;
            if (d2 < bestD) { bestD = d2; best = idx; }
            if (py !== undefined && Math.abs(nd2.y - py) <= 14 && d2 < bestNearD) {
              bestNearD = d2; bestNear = idx;
            }
          }
        }
      }
      if (bestNear >= 0) best = bestNear;
      if (best < 0) return { onTrack: false, idx: -1, s: 0, u: 0, y: -1e4, boost: 0, yaw: 0, hw: 0 };

      // refine: project onto the two segments adjacent to the nearest node
      var res = null;
      var trySeg = function (i0) {
        i0 = Math.max(0, Math.min(N - 2, i0));
        var na = nodes[i0], nb = nodes[i0 + 1];
        var ex = nb.x - na.x, ez = nb.z - na.z;
        var el2 = ex * ex + ez * ez || 1;
        var tt = U.clamp(((px - na.x) * ex + (pz - na.z) * ez) / el2, 0, 1);
        var mx = na.x + ex * tt, mz = na.z + ez * tt;
        var rx = px - mx, rz = pz - mz;
        var d2 = rx * rx + rz * rz;
        if (!res || d2 < res.d2) res = { d2: d2, na: na, nb: nb, t: tt, mx: mx, mz: mz };
      };
      trySeg(best - 1);
      trySeg(best);

      var na = res.na, nb = res.nb, t = res.t;
      var hw = na.hw + (nb.hw - na.hw) * t;
      var bank = na.bank + (nb.bank - na.bank) * t;
      var gap = (na.gap && nb.gap) ? 1 : (na.gap || nb.gap ? 0.5 : 0);
      // interpolated flat right vector -> signed lateral offset
      var itx = nb.tx + (na.tx - nb.tx) * t, itz = nb.tz + (na.tz - nb.tz) * t;
      var ifl = Math.sqrt(itz * itz + itx * itx) || 1;
      var rfx = itz / ifl, rfz = -itx / ifl;
      var rxo = px - res.mx, rzo = pz - res.mz;
      var u = rxo * rfx + rzo * rfz;
      var y = na.y + (nb.y - na.y) * t + u * Math.tan(bank);
      var sn = na.s + (nb.s - na.s) * t;
      return {
        onTrack: Math.abs(u) <= hw && gap === 0,
        gapPart: gap,
        idx: na, idxB: nb, t: t,
        s: sn, u: u, hw: hw, bank: bank,
        y: y, boost: nb.boost || na.boost,
        yaw: Math.atan2(itx, itz)
      };
    }

    return { nodes: nodes, query: query, def: def, length: s, N: N, spacing: SPACING };
  }

  // ---------------- track definitions ----------------
  // [x, z, height, halfWidth, bankDeg, opts]
  var defs = [
    {
      id: 'sky-cut', name: 'A. 스카이 컷', accent: 0x3aa0ff,
      idea: '아이디어: 점프 컷. 고속 활주 뒤 큰 공백구간을 "믿고 직진" — 착지 각도가 기록을 가른다.',
      killDepth: 16,
      pts: [
        [0, -20, 6, 9, 0],
        [0, 60, 6, 10, 0], [0, 160, 8, 10, 0], [0, 260, 12, 10, 0],
        [0, 340, 18, 10, 0, { boost: 1.0 }],          // launch ramp zone
        [0, 400, 26, 9, 0],                            // ramp base
        [0, 470, 34, 9, 0],                            // rising lip (gives launch vy)
        [0, 480, 34, 9, 0, { gap: true }],             // ---- the cut (gap) ----
        [0, 560, 2, 9, 0],                             // landing pad (lower)
        [0, 700, 2, 8, 0],
        [-60, 780, 3, 8, -18], [ -150, 800, 3, 8, 0 ], // banked left sweep
        [-240, 780, 4, 8, 18], [-300, 720, 6, 8, 0],
        [-300, 640, 8, 9, 0, { boost: 1.0 }],
        [-300, 560, 10, 9, 0], [-300, 470, 12, 9, 0],
        [-280, 400, 12, 9, 14], [-230, 350, 12, 9, 14],
        [-160, 330, 10, 8, 0],
        [-80, 330, 8, 8, 0, { boost: 0.8 }],
        [40, 330, 6, 8, 0], [140, 330, 4, 8, 0], [220, 320, 3, 9, 0]
      ]
    },
    {
      id: 'boost-chain', name: 'B. 부스터 체인', accent: 0xff8a3a,
      idea: '아이디어: 부스터 체인. S자마다 패드가 이어진다 — 패드를 못 밟으면 체인이 끊긴다.',
      killDepth: 14,
      pts: [
        [0, -20, 4, 9, 0],
        [0, 40, 4, 10, 0, { boost: 1.0 }],
        [0, 110, 4, 10, 0],
        [-70, 160, 4, 9, 22], [-140, 160, 4, 9, 0],
        [-140, 220, 5, 9, 0, { boost: 1.0 }],
        [-140, 290, 6, 9, 0],
        [-70, 340, 8, 9, -22], [0, 340, 9, 9, 0],
        [0, 400, 10, 9, 0, { boost: 1.0 }],
        [0, 470, 12, 9, 0],
        [70, 520, 14, 9, -20], [140, 520, 15, 9, 0],
        [140, 580, 16, 9, 0, { boost: 1.0 }],
        [140, 650, 17, 9, 0],
        [200, 700, 17, 9, -24], [270, 740, 16, 9, 0],
        [270, 810, 14, 10, 0, { boost: 1.2 }],
        [270, 890, 12, 10, 0], [270, 970, 10, 10, 0]
      ]
    },
    {
      id: 'spiral-drop', name: 'C. 나선 강하', accent: 0x9a6bff,
      idea: '아이디어: 뱅크 나선. 고도 60을 뱅크 코너만으로 내려온다 — 그립을 믿고 풀스로틀.',
      killDepth: 16,
      pts: [
        [0, -20, 60, 9, 0],
        [0, 60, 58, 10, 0, { boost: 0.8 }],
        [40, 140, 54, 10, 24], [80, 230, 48, 10, 30],
        [60, 320, 42, 10, 30], [-20, 370, 36, 10, 24],
        [-120, 380, 31, 10, 30], [-200, 340, 26, 10, 30],
        [-240, 260, 21, 10, 30], [-220, 170, 16, 10, 26],
        [-140, 120, 12, 10, 0],
        [-60, 110, 10, 9, 0, { boost: 1.0 }],
        [30, 120, 8, 9, 0], [110, 160, 6, 9, -16],
        [160, 230, 5, 9, 0], [170, 310, 4, 9, 16],
        [120, 380, 3, 10, 0], [30, 410, 2, 10, 0],
        [-60, 400, 2, 10, 0, { boost: 1.0 }],
        [-140, 370, 2, 10, 0], [-200, 320, 2, 10, 0]
      ]
    },
    {
      id: 'needle-zigzag', name: 'D. 니들 지그재그', accent: 0x37e08c,
      idea: '아이디어: 좁은 지그재그 + 마지막 롱점프. 정밀 조작 후 한 방에 내던진다.',
      killDepth: 14,
      pts: [
        [0, -20, 10, 8, 0],
        [0, 60, 10, 8, 0],
        [-45, 100, 10, 5.5, 0], [-90, 140, 10, 5.5, 0],
        [-45, 180, 10, 5.5, 0], [0, 220, 10, 5.5, 0],
        [-45, 260, 9, 5.5, 0], [-90, 300, 9, 5.5, 0],
        [-45, 340, 8, 5.5, 0], [0, 380, 8, 5.5, 0],
        [-40, 420, 7, 5.5, 0], [-80, 460, 7, 5.5, 0],
        [-40, 500, 6, 6, 0],
        [40, 540, 6, 8, 0, { boost: 1.0 }],
        [130, 580, 8, 8, 0, { boost: 1.2 }],
        [190, 620, 13, 8, 0],                        // ramp up
        [250, 655, 19, 8, 0],
        [300, 690, 21, 8, 0],                        // rising lip
        [318, 708, 27, 8, 0],                        // lip crest (last road)
        [324, 714, 27, 8, 0, { gap: true }],         // gap starts at the crest
        [370, 760, 2, 10, 0],                        // far landing (aligned to launch ray)
        [410, 800, 2, 10, 0], [440, 830, 2, 10, 0]
      ]
    },
    {
      id: 'belt-loop', name: 'E. 벨트 서킷', accent: 0xffd257,
      idea: '아이디어: 입문용 벨트트랙. 넓은 뱅크 180도와 리듬 부스터로 속도를 유지한다.',
      killDepth: 14,
      pts: [
        [0, -20, 4, 12, 0],
        [0, 80, 4, 12, 0, { boost: 0.8 }],
        [0, 180, 4, 12, 0],
        [10, 280, 5, 12, 8], [60, 360, 6, 12, 20],
        [150, 400, 7, 12, 26], [240, 370, 8, 12, 20],
        [280, 290, 9, 12, 8],
        [270, 190, 9, 12, 0, { boost: 1.0 }],
        [270, 110, 9, 12, 0],
        [230, 40, 8, 12, -18], [150, 0, 7, 12, -26],
        [60, 10, 6, 12, -18], [10, 70, 5, 12, 0],
        [-30, 160, 5, 12, 0, { boost: 1.0 }],
        [-30, 260, 4, 12, 0], [-30, 350, 3, 12, 0]
      ]
    }
  ];

  var built = {};
  function get(i) {
    if (!built[i]) built[i] = build(defs[i]);
    return built[i];
  }

  return { defs: defs, build: build, get: get, count: defs.length };
})();
