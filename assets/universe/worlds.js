/* Original procedural landscapes. ES5, shared geometry, WebGL1 and no network
 * assets. Six repeating strips bound memory regardless of journey duration.
 * Landscape chunks leave a clear central corridor for the camera and Cards. */
(function (root) {
  'use strict';
  var palettes = {
    ocean: { sky: 0x062e46, fog: 0x0c5261, ground: 0x154f53, light: 0x7be5e0 },
    mountains: { sky: 0xa9c9da, fog: 0xa9c9da, ground: 0x687d72, light: 0xffe8c7 },
    forest: { sky: 0x263f36, fog: 0x365448, ground: 0x304a35, light: 0xffe5a4 },
    dunes: { sky: 0x694a65, fog: 0xb67c7b, ground: 0xb37655, light: 0xffd6a0 }
  };
  function create(settings, remember) {
    var kind = settings.world, palette = palettes[kind];
    if (!palette) return null;
    var scene = new THREE.Scene(), bodies = [], detail = settings.detail === 'high' ? 3 : settings.detail === 'medium' ? 2 : 1;
    var density = settings.density / 100, span = settings.viewDistance * 2, strip = span / 6;
    scene.fog = new THREE.FogExp2(palette.fog, kind === 'ocean' ? 0.00028 : kind === 'forest' ? 0.00021 : 0.00012);
    scene.add(new THREE.AmbientLight(kind === 'forest' ? 0x9bb7a4 : 0xa5b5c5, 0.85));
    var sun = new THREE.DirectionalLight(palette.light, 1.15); sun.position.set(-3, 5, 2); scene.add(sun);
    function material(color, basic) {
      return remember(basic ? new THREE.MeshBasicMaterial({ color: color }) : new THREE.MeshLambertMaterial({ color: color, flatShading: true }));
    }
    var groundMaterial = material(palette.ground);
    var floorGeometry = remember(new THREE.PlaneBufferGeometry(28000, span + 10000));
    var floor = new THREE.Mesh(floorGeometry, groundMaterial); floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -700, -span / 2); scene.add(floor);
    // A haze-softened disc gives the surface worlds a stable distant light.
    // It follows translation, so it cannot be flown through or wrap abruptly.
    var disc;
    if (kind !== 'ocean') {
      disc = new THREE.Mesh(remember(new THREE.CircleBufferGeometry(kind === 'dunes' ? 520 : 210, 24)), material(palette.light, true));
      scene.add(disc);
    }
    var cone = remember(new THREE.ConeGeometry(1, 1, detail === 1 ? 5 : 7));
    var trunk = remember(new THREE.CylinderGeometry(1, 1.2, 1, 5));
    var rock = remember(new THREE.IcosahedronGeometry(1, detail > 1 ? 1 : 0));
    var ball = remember(new THREE.SphereGeometry(1, 12, 6));
    var green = material(kind === 'ocean' ? 0x338f88 : 0x2e694b), darkGreen = material(0x214a3b);
    var wood = material(0x67574a), stone = material(kind === 'mountains' ? 0x7b8892 : 0x527879);
    var snow = material(0xe3ebeb), sand = material(0xd39b6c), coral = material(0xd6818f);
    var gold = material(kind === 'ocean' ? 0x83d8d0 : 0xf4cf8c, true);
    function between(a, b) { return a + Math.random() * (b - a); }
    // Merge pieces by material in each strip: hundreds of trees/corals use a
    // small fixed set of draw calls rather than one call per branch or leaf.
    function part(batches, geometry, mat, x, y, z, sx, sy, sz, rotation) {
      var batch = null;
      for (var j = 0; j < batches.length; j += 1) if (batches[j].material === mat) batch = batches[j];
      if (!batch) { batch = { material: mat, geometry: new THREE.Geometry() }; batches.push(batch); }
      var mesh = new THREE.Mesh(geometry, mat); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
      mesh.rotation.z = rotation || 0; mesh.updateMatrix(); batch.geometry.merge(geometry, mesh.matrix);
    }
    for (var c = 0; c < 6; c += 1) {
      var chunk = new THREE.Group(), batches = [], count = Math.floor((kind === 'forest' ? 24 + detail * 8 : 12 + detail * 4) * density);
      chunk.position.z = -c * strip; chunk.userData.landscape = true;
      for (var i = 0; i < count; i += 1) {
        var side = i % 2 ? -1 : 1, x = side * between(1100, 6500), z = between(-strip / 2, strip / 2), h;
        if (kind === 'forest') {
          h = between(450, 1400);
          part(batches, trunk, wood, x, -700 + h * 0.34, z, 20, h * 0.68, 20);
          part(batches, cone, i % 3 ? green : darkGreen, x, -700 + h * 0.67, z, h * 0.28, h * 0.9, h * 0.28);
          part(batches, cone, darkGreen, x, -700 + h * 0.9, z, h * 0.2, h * 0.65, h * 0.2);
          // Firefly-like decorative motes are scenery, never sensor readings.
          if (i % 3 === 0) part(batches, rock, gold, side * between(350, 2200), between(-450, 350), z, 4, 4, 4);
        } else if (kind === 'mountains') {
          h = between(1000, 3600); x = side * (h * 0.8 + between(1800, 4800));
          part(batches, cone, stone, x, -700 + h / 2, z, h * 0.8, h, h * 0.7);
          part(batches, cone, snow, x, -700 + h * 0.88, z, h * 0.197, h * 0.25, h * 0.172);
          part(batches, rock, groundMaterial, side * between(1200, 3800), -650, z, 350, 160, 420);
        } else if (kind === 'dunes') {
          h = between(300, 1100); var duneWidth = between(1600, 3300); x = side * (duneWidth + between(1400, 4500));
          part(batches, ball, i % 2 ? sand : groundMaterial, x, -740, z, duneWidth, h, between(800, 1800));
          if (i % 4 === 0) part(batches, rock, stone, side * between(1400, 3800), -650, z, 70, 100, 60);
        } else {
          part(batches, rock, stone, x, -630, z, between(140, 330), between(90, 240), 220);
          h = between(160, 440);
          part(batches, trunk, green, x, -700 + h / 2, z, 20, h, 20, 0.12);
          part(batches, ball, coral, x, -700 + h, z, 100, 70, 90);
          part(batches, ball, coral, x + 70, -700 + h * 0.7, z, 80, 50, 60);
          // Small flattened fish, batched in loose schools off the flight path.
          for (var f = 0; f < 4; f += 1) part(batches, rock, gold, side * between(900, 3400), between(-350, 900), z + f * 45, 28, 10, 8);
        }
      }
      for (var b = 0; b < batches.length; b += 1) {
        var buffer = remember(new THREE.BufferGeometry().fromGeometry(batches[b].geometry));
        batches[b].geometry.dispose(); chunk.add(new THREE.Mesh(buffer, batches[b].material));
      }
      // Floating plankton / pollen are one point buffer per strip, including
      // gentle depth cues around the otherwise unobstructed center corridor.
      if ((kind === 'ocean' || kind === 'forest') && density) {
        var points = Math.floor((50 + detail * 30) * density), coordinates = new Float32Array(points * 3);
        for (var p = 0; p < points; p += 1) {
          coordinates[p * 3] = between(-4000, 4000); coordinates[p * 3 + 1] = between(-600, 1900); coordinates[p * 3 + 2] = between(-strip / 2, strip / 2);
        }
        var particles = remember(new THREE.BufferGeometry()); particles.addAttribute('position', new THREE.BufferAttribute(coordinates, 3));
        var dust = remember(new THREE.PointsMaterial({ color: palette.light, size: kind === 'ocean' ? 5 : 3, transparent: true, opacity: 0.55 }));
        chunk.add(new THREE.Points(particles, dust));
      }
      bodies.push(chunk); scene.add(chunk);
    }
    return { scene: scene, bodies: bodies, background: palette.sky,
      update: function (camera) {
        floor.position.z = camera.position.z - span / 2;
        if (disc) disc.position.set(camera.position.x - 3600, 2400, camera.position.z - settings.viewDistance * 0.85);
      } };
  }
  root.UniverseWorlds = { create: create };
}(this));
