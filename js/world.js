// world.js — Three.js scene: road mesh from track nodes, gates, car/ghost meshes
'use strict';
var World = (function () {
  var scene, camera, renderer;
  var trackGroup = null;

  // ---------- canvas textures ----------
  function makeRoadTexture() {
    var c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#1b2130';
    g.fillRect(0, 0, 128, 128);
    // subtle asphalt noise
    for (var i = 0; i < 260; i++) {
      g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.03) + ')';
      g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
    // edge stripes
    g.fillStyle = '#e8eefc';
    g.fillRect(0, 0, 7, 128);
    g.fillRect(121, 0, 7, 128);
    // dashed center line
    g.fillStyle = 'rgba(220,230,255,0.55)';
    g.fillRect(61, 0, 6, 64);
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }
  function makeBannerTexture(text, color) {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#101521';
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = color; g.lineWidth = 10;
    g.strokeRect(5, 5, 502, 118);
    g.fillStyle = color;
    g.font = 'bold 72px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, 68);
    return new THREE.CanvasTexture(c);
  }

  // ---------- road geometry ----------
  // builds BufferGeometry between consecutive non-gap nodes
  function roadGeometry(track) {
    var nodes = track.nodes, N = track.N;
    var pos = [], uv = [], idx = [];
    var skirt = [], skirtIdx = [];
    var vi = 0, si = 0;
    for (var i = 0; i < N - 1; i++) {
      var a = nodes[i], b = nodes[i + 1];
      if (a.gap || b.gap) continue;
      var aw = a.hw, bw = b.hw;
      // road quad
      pos.push(
        a.x + a.rx * aw, a.y + a.ry * aw, a.z + a.rz * aw,
        a.x - a.rx * aw, a.y - a.ry * aw, a.z - a.rz * aw,
        b.x + b.rx * bw, b.y + b.ry * bw, b.z + b.rz * bw,
        b.x - b.rx * bw, b.y - b.ry * bw, b.z - b.rz * bw
      );
      var v0 = a.s / 8, v1 = b.s / 8;
      uv.push(0, v0, 1, v0, 0, v1, 1, v1);
      idx.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
      vi += 4;
      // skirts (drop walls) for depth reading — 1.4 units tall
      var H = 1.4;
      skirt.push(
        a.x + a.rx * aw, a.y + a.ry * aw, a.z + a.rz * aw,
        a.x + a.rx * aw, a.y + a.ry * aw - H, a.z + a.rz * aw - H * 0.3,
        b.x + b.rx * bw, b.y + b.ry * bw, b.z + b.rz * bw,
        b.x + b.rx * bw, b.y + b.ry * bw - H, b.z + b.rz * bw - H * 0.3
      );
      skirtIdx.push(si, si + 2, si + 1, si + 1, si + 2, si + 3);
      si += 4;
      skirt.push(
        a.x - a.rx * aw, a.y - a.ry * aw, a.z - a.rz * aw,
        a.x - a.rx * aw, a.y - a.ry * aw - H, a.z - a.rz * aw - H * 0.3,
        b.x - b.rx * bw, b.y - b.ry * bw, b.z - b.rz * bw,
        b.x - b.rx * bw, b.y - b.ry * bw - H, b.z - b.rz * bw - H * 0.3
      );
      skirtIdx.push(si, si + 1, si + 2, si + 1, si + 3, si + 2);
      si += 4;
    }
    function geo(p, u, ix) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      if (u) g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
      g.setIndex(ix);
      g.computeVertexNormals();
      return g;
    }
    return { road: geo(pos, uv, idx), skirt: geo(skirt, null, skirtIdx) };
  }

  // boost pad overlay: bright strips above road in boost zones
  function boostGeometry(track) {
    var nodes = track.nodes, N = track.N;
    var pos = [], idx = [], vi = 0;
    for (var i = 0; i < N - 1; i++) {
      var a = nodes[i], b = nodes[i + 1];
      if (a.boost <= 0 || b.boost <= 0 || a.gap || b.gap) continue;
      var aw = a.hw * 0.86, bw = b.hw * 0.86;
      var ay = 0.06, by = 0.06;   // hover above road
      pos.push(
        a.x + a.rx * aw, a.y + a.ry * aw + ay, a.z + a.rz * aw + ay * 0.2,
        a.x - a.rx * aw, a.y - a.ry * aw + ay, a.z - a.rz * aw + ay * 0.2,
        b.x + b.rx * bw, b.y + b.ry * bw + by, b.z + b.rz * bw + by * 0.2,
        b.x - b.rx * bw, b.y - b.ry * bw + by, b.z - b.rz * bw + by * 0.2
      );
      idx.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
      vi += 4;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ---------- gates ----------
  function makeGate(node, bannerTex) {
    var grp = new THREE.Group();
    var W = node.hw + 0.8;
    var matP = new THREE.MeshLambertMaterial({ color: 0x3a4670 });
    var postG = new THREE.BoxGeometry(0.6, 7, 0.6);
    var p1 = new THREE.Mesh(postG, matP), p2 = new THREE.Mesh(postG, matP);
    p1.position.set(node.x + node.rx * W, node.y + node.ry * W + 3.5, node.z + node.rz * W);
    p2.position.set(node.x - node.rx * W, node.y - node.ry * W + 3.5, node.z - node.rz * W);
    grp.add(p1); grp.add(p2);
    var ban = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 2 + 0.6, 2.6),
      new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide })
    );
    // orient banner along the track (perpendicular to travel)
    ban.position.set(node.x, node.y + node.ry * W + 6.4, node.z);
    ban.rotation.y = node.yaw;
    grp.add(ban);
    return grp;
  }

  // ---------- car meshes ----------
  function makeCarMesh(accent, ghost) {
    var grp = new THREE.Group();
    var bodyMat = ghost
      ? new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.32, depthWrite: false })
      : new THREE.MeshLambertMaterial({ color: accent });
    var darkMat = ghost
      ? new THREE.MeshBasicMaterial({ color: 0x2a4a5a, transparent: true, opacity: 0.25, depthWrite: false })
      : new THREE.MeshLambertMaterial({ color: 0x121826 });

    var body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.2), bodyMat);
    body.position.y = 0.55;
    grp.add(body);
    var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 1.8), darkMat);
    cabin.position.set(0, 1.02, -0.3);
    grp.add(cabin);
    var nose = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 0.9), bodyMat);
    nose.position.set(0, 0.38, 2.2);
    grp.add(nose);
    var wing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.5), darkMat);
    wing.position.set(0, 1.05, -2.0);
    grp.add(wing);
    var wG = new THREE.CylinderGeometry(0.42, 0.42, 0.36, 10);
    var wheels = [];
    var offs = [[-1.0, 1.4], [1.0, 1.4], [-1.0, -1.4], [1.0, -1.4]];
    for (var i = 0; i < 4; i++) {
      var w = new THREE.Mesh(wG, darkMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(offs[i][0], 0.42, offs[i][1]);
      grp.add(w);
      wheels.push(w);
    }
    if (!ghost) {
      var light = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 0.25),
        new THREE.MeshBasicMaterial({ color: 0xfff6c8 })
      );
      light.position.set(0, 0.45, 2.66);
      light.rotation.x = 0;
      grp.add(light);
    }
    grp.scale.set(1.15, 1.15, 1.15);
    return { group: grp, wheels: wheels };
  }

  // ---------- init / track build ----------
  function init(container) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090f);
    scene.fog = new THREE.Fog(0x07090f, 160, 520);

    camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 1200);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0x8aa4d8, 0x1a2030, 0.95));
    var dir = new THREE.DirectionalLight(0xffffff, 0.65);
    dir.position.set(80, 160, 60);
    scene.add(dir);

    // faint reference grid far below (depth cue over the void)
    var grid = new THREE.GridHelper(1600, 64, 0x1c2740, 0x141c2e);
    grid.position.y = -42;
    scene.add(grid);

    window.addEventListener('resize', function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
    return true;
  }

  function buildTrack(track) {
    if (trackGroup) {
      scene.remove(trackGroup);
      trackGroup.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
      });
    }
    trackGroup = new THREE.Group();
    var accent = track.def.accent;
    var accentHex = '#' + ('000000' + accent.toString(16)).slice(-6);

    var geos = roadGeometry(track);
    var road = new THREE.Mesh(geos.road, new THREE.MeshLambertMaterial({ map: makeRoadTexture() }));
    trackGroup.add(road);
    var skirtMat = new THREE.MeshLambertMaterial({ color: accent, transparent: true, opacity: 0.28 });
    trackGroup.add(new THREE.Mesh(geos.skirt, skirtMat));

    var boostMat = new THREE.MeshBasicMaterial({
      color: 0x59d7ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide
    });
    var boostMesh = new THREE.Mesh(boostGeometry(track), boostMat);
    trackGroup.add(boostMesh);

    var nodes = track.nodes;
    var start = makeGate(nodes[1], makeBannerTexture('START', accentHex));
    trackGroup.add(start);
    var fin = makeGate(nodes[nodes.length - 1], makeBannerTexture('FINISH', accentHex));
    trackGroup.add(fin);

    scene.add(trackGroup);
    return { boostMat: boostMat };
  }

  function render() { renderer.render(scene, camera); }

  return {
    init: init, buildTrack: buildTrack, render: render,
    makeCarMesh: makeCarMesh, makeGate: makeGate,
    scene: function () { return scene; },
    camera: function () { return camera; },
    renderer: function () { return renderer; }
  };
})();
