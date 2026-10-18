/* Universe's entire display path is ES5 + XHR + WebGL1. Space is procedural and
 * bounded; it never loads external textures, provider URLs or device controls. */
(function () {
  'use strict';
  var canvas = document.getElementById('universe-space');
  var panel = document.getElementById('universe-panel');
  var status = document.getElementById('vista-status');
  var empty = document.getElementById('universe-empty');
  var pauseButton = document.getElementById('universe-pause');
  var adapter = window.LocalserveLegacyCard;
  var flight = new UniverseFlight();
  var renderer, scene, camera, starField, bodies = [], clouds = [], resources = [];
  var landscape = null;
  // A fixed public world link overrides only scenery, never saved settings or
  // Card choices. Unknown values simply use the configured world (ES5 parser).
  var worldLink = /(?:^|[?&])world=(space|ocean|mountains|forest|dunes)(?:&|$)/.exec(window.location ? window.location.search : '');
  var settings, payload, entries = [], signature = '', worldSignature = '';
  var online = false, paused = false, hidden = document.hidden, lost = false;
  var request = null, readTimer = null, frameTimer = null, previousTime = 0, clock = 0;
  var start = { x: 0, y: 0, z: 0 }, destination = { x: 0, y: 0, z: 0 };
  var mounted = -1, swapped = false, width = 1, height = 1, stopDistance = 1000;
  var reducedQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduced = Boolean(reducedQuery && reducedQuery.matches);
  var random = Math.random;

  function remember(resource) { resources.push(resource); return resource; }
  function between(min, max) { return min + random() * (max - min); }
  function inform(text) { status.textContent = text; status.style.display = text ? 'block' : 'none'; }
  function fit() { return Math.min(width * 0.88 / 960, height * 0.8 / 540); }
  function resize() {
    width = Math.max(1, window.innerWidth); height = Math.max(1, window.innerHeight);
    stopDistance = height / (2 * Math.tan(55 * Math.PI / 360)) / fit();
    if (camera) { camera.aspect = width / height; camera.updateProjectionMatrix(); }
    if (renderer && settings) {
      var cap = settings.detail === 'low' ? 960 : settings.detail === 'medium' ? 1440 : 1920;
      var scale = Math.min(1, cap / Math.max(width, height));
      renderer.setSize(Math.floor(width * scale), Math.floor(height * scale), false);
    }
  }

  function disposeWorld() {
    for (var i = 0; i < resources.length; i += 1) resources[i].dispose();
    resources = []; bodies = []; clouds = []; starField = null; landscape = null;
  }
  function cloudTexture() {
    var image = document.createElement('canvas'); image.width = 128; image.height = 128;
    var context = image.getContext('2d');
    var gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,.35)');
    gradient.addColorStop(0.4, 'rgba(170,190,255,.14)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
    return remember(new THREE.CanvasTexture(image));
  }
  function populate() {
    disposeWorld();
    if (settings.world && settings.world !== 'space') {
      landscape = UniverseWorlds.create(settings, remember);
      scene = landscape.scene; bodies = landscape.bodies;
      renderer.setClearColor(landscape.background, 1);
      return;
    }
    renderer.setClearColor(0x030611, 1);
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030611, 0.000055);
    scene.add(new THREE.AmbientLight(0x455580, 1.1));
    var sun = new THREE.DirectionalLight(0xb3d9ff, 1.6); sun.position.set(-2, 3, 4); scene.add(sun);
    var countFactor = settings.density / 100;
    var detail = settings.detail === 'low' ? 1 : settings.detail === 'medium' ? 2 : 3;
    var span = settings.viewDistance * 2;
    if (settings.stars) {
      var geometry = remember(new THREE.BufferGeometry());
      var count = Math.floor((1400 + detail * 700) * countFactor);
      var positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
      for (var i = 0; i < count; i += 1) {
        positions[i * 3] = between(-6500, 6500); positions[i * 3 + 1] = between(-4000, 4000); positions[i * 3 + 2] = between(-span, 0);
        var tone = new THREE.Color([0xadcfff, 0xffd5ae, 0xffffff, 0x968aff][i % 4]);
        colors[i * 3] = tone.r; colors[i * 3 + 1] = tone.g; colors[i * 3 + 2] = tone.b;
      }
      geometry.addAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.addAttribute('color', new THREE.BufferAttribute(colors, 3));
      var material = remember(new THREE.PointsMaterial({ size: 5, vertexColors: THREE.VertexColors, transparent: true, opacity: 0.85, sizeAttenuation: true }));
      starField = new THREE.Points(geometry, material); starField.frustumCulled = false; scene.add(starField);
    }
    if (settings.nebulae && countFactor) {
      var texture = cloudTexture();
      var cloudCount = Math.floor((12 + detail * 8) * countFactor);
      for (var n = 0; n < cloudCount; n += 1) {
        var cloudMaterial = remember(new THREE.SpriteMaterial({ map: texture, color: [0x6856d4, 0x246c9a, 0x9b3974][n % 3], transparent: true, opacity: 0.65, depthWrite: false, blending: THREE.AdditiveBlending }));
        var cloud = new THREE.Sprite(cloudMaterial);
        cloud.position.set(between(-3600, 3600), between(-2200, 2200), between(-span, 0));
        var size = between(1600, 4200); cloud.scale.set(size, size * between(0.5, 1), 1);
        clouds.push(cloud); scene.add(cloud);
      }
    }
    // Objects keep out of the flight corridor. Mesh LOD switches geometry by
    // actual camera distance, while shared geometries/materials bound GPU use.
    var sphereNear = remember(new THREE.SphereBufferGeometry(1, detail * 8 + 8, detail * 6 + 6));
    var sphereFar = remember(new THREE.IcosahedronBufferGeometry(1, 1));
    var rockGeometry = remember(new THREE.IcosahedronBufferGeometry(1, detail > 1 ? 1 : 0));
    var planetCount = settings.planets ? Math.floor((5 + detail * 3) * countFactor) : 0;
    var rockCount = settings.asteroids ? Math.floor((30 + detail * 30) * countFactor) : 0;
    for (var b = 0; b < planetCount + rockCount; b += 1) {
      var planet = b < planetCount;
      var bodyMaterial = remember(new THREE.MeshPhongMaterial({ color: planet ? [0x497f9f, 0xb68b70, 0x7669a5, 0x4f9d91][b % 4] : 0x535461, shininess: planet ? 14 : 0, flatShading: !planet }));
      var mesh = new THREE.Mesh(planet ? sphereNear : rockGeometry, bodyMaterial);
      mesh.position.set((b % 2 ? -1 : 1) * between(1200, 4800), between(-2400, 2400), between(-span, 0));
      var radius = planet ? between(130, 460) : between(12, 60); mesh.scale.set(radius, radius * (planet ? 1 : 0.7), radius);
      mesh.rotation.set(random() * 3, random() * 3, random() * 3);
      mesh.userData.near = planet ? sphereNear : rockGeometry; mesh.userData.far = planet ? sphereFar : rockGeometry;
      bodies.push(mesh); scene.add(mesh);
      if (planet && b % 3 === 0) {
        var ringGeometry = remember(new THREE.RingBufferGeometry(1.3, 2, 40));
        var ringMaterial = remember(new THREE.MeshBasicMaterial({ color: 0x9c94bb, side: THREE.DoubleSide, transparent: true, opacity: 0.35 }));
        var ring = new THREE.Mesh(ringGeometry, ringMaterial); ring.rotation.x = 1.15; mesh.add(ring);
      }
    }
  }
  function initGraphics() {
    try {
      // Explicit context selection prevents a newer browser choosing WebGL2.
      var context = canvas.getContext('webgl', { alpha: false, antialias: false }) || canvas.getContext('experimental-webgl', { alpha: false, antialias: false });
      if (!context || !window.THREE) return false;
      renderer = new THREE.WebGLRenderer({ canvas: canvas, context: context, antialias: false });
      renderer.setPixelRatio(1); renderer.setClearColor(0x030611, 1);
      camera = new THREE.PerspectiveCamera(55, 1, 1, 12000);
      return true;
    } catch (error) { renderer = null; return false; }
  }
  function updateWorld() {
    if (!renderer || !scene || lost) return;
    var span = settings.viewDistance * 2, i;
    if (starField) {
      var attribute = starField.geometry.attributes.position;
      var positions = attribute.array;
      for (i = 2; i < positions.length; i += 3) {
        while (positions[i] > camera.position.z + 500) positions[i] -= span;
        while (positions[i] < camera.position.z - span + 500) positions[i] += span;
      }
      attribute.needsUpdate = true;
    }
    for (i = 0; i < bodies.length + clouds.length; i += 1) {
      var mesh = i < bodies.length ? bodies[i] : clouds[i - bodies.length];
      var margin = mesh.userData.landscape ? span / 12 + 800 : 500;
      while (mesh.position.z > camera.position.z + margin) mesh.position.z -= span;
      while (mesh.position.z < camera.position.z - span + margin) mesh.position.z += span;
      var distance = mesh.position.distanceTo(camera.position);
      mesh.visible = distance < settings.viewDistance + (mesh.userData.landscape ? span / 12 : 0);
      if (mesh.userData.near) mesh.geometry = distance < 2400 ? mesh.userData.near : mesh.userData.far;
    }
    if (landscape) landscape.update(camera);
    renderer.render(scene, camera);
  }
  function mount(index) {
    mounted = index;
    adapter.update(entries[index] || null, payload.options, online && !paused && !hidden && !lost);
    panel.style.visibility = index >= 0 ? 'visible' : 'hidden';
  }
  function rebaseWorld() {
    // Rebase every leg (and periodically in empty space) to retain GPU precision
    // during long-running displays. This moves coordinates, not the visible view.
    if (camera) {
      var shift = -camera.position.z;
      if (starField) {
        var positions = starField.geometry.attributes.position.array;
        for (var i = 2; i < positions.length; i += 3) positions[i] += shift;
      }
      for (var k = 0; k < bodies.length + clouds.length; k += 1) (k < bodies.length ? bodies[k] : clouds[k - bodies.length]).position.z += shift;
      camera.position.z = 0;
      start = { x: camera.position.x, y: camera.position.y, z: 0 };
    } else start = { x: 0, y: 0, z: 0 };
  }
  function beginFlight() {
    swapped = false;
    rebaseWorld();
    destination = { x: between(-600, 600) * settings.motion / 100, y: between(-250, 250) * settings.motion / 100, z: -2400 };
  }
  function positionPanel(progress) {
    var scale = fit(), x = width / 2, y = height / 2, opacity = 1;
    if (flight.phase === 'flight' && !reduced && renderer) {
      if (progress < 0.16) {
        scale *= 1 + progress * 1.8; x -= progress * width * 2.5; opacity = 1 - progress / 0.16;
      } else {
        var point = new THREE.Vector3(destination.x, destination.y, destination.z - stopDistance);
        var depth = camera.position.z - point.z;
        point.project(camera);
        x = (point.x + 1) * width / 2; y = (-point.y + 1) * height / 2;
        scale *= stopDistance / Math.max(1, depth); opacity = Math.min(1, (progress - 0.16) * 5);
      }
    } else if (flight.phase === 'flight') {
      // A stationary, gentle crossfade is also the no-WebGL fallback.
      opacity = progress < 0.5 ? 1 - progress * 2 : (progress - 0.5) * 2;
    }
    var transform = 'translate(' + (x - 480 * scale) + 'px,' + (y - 270 * scale) + 'px) scale(' + scale + ')';
    panel.style.webkitTransform = transform; panel.style.transform = transform; panel.style.opacity = String(Math.max(0, opacity));
  }
  function advance(seconds) {
    var event = flight.tick(seconds, settings);
    if (event === 'pass') {
      // Complete the old leg before rebasing its world and starting the next.
      // The passed Card remains the outgoing panel during this new departure.
      if (mounted !== flight.previous) mount(flight.previous);
      if (camera && !reduced) camera.position.set(destination.x, destination.y, destination.z);
      beginFlight();
    }
    if (event === 'depart') beginFlight();
    var progress = flight.progress();
    if (flight.phase === 'flight') {
      var swapAt = reduced || !renderer ? 0.5 : 0.16;
      if (!swapped && progress >= swapAt) { mount(flight.index); swapped = true; }
      // Continuous travel does not brake to zero velocity at every Card.
      var eased = settings.holdSeconds === 0 ? progress : UniverseFlight.ease(progress);
      if (camera && !reduced) {
        var bend = Math.sin(progress * Math.PI) * settings.motion / 100;
        camera.position.set(start.x + (destination.x - start.x) * eased + bend * 200,
          start.y + (destination.y - start.y) * eased + Math.sin(progress * Math.PI * 2) * bend * 70,
          destination.z * eased);
      }
    }
    if (event === 'arrive') { if (mounted !== flight.index) mount(flight.index); if (camera && !reduced) camera.position.set(destination.x, destination.y, destination.z); }
    positionPanel(progress);
  }
  function animate(time) {
    frameTimer = window.requestAnimationFrame(animate);
    if (!previousTime) { previousTime = time; return; }
    // Low detail caps at 30fps. Never catch up hidden/disconnected elapsed time.
    var delta = Math.max(0, (time - previousTime) / 1000);
    if (settings && settings.detail === 'low' && delta < 1 / 30) return;
    previousTime = time;
    if (!settings || hidden || !online || paused || !settings.enabled || lost) return;
    delta = Math.min(delta, 0.1); clock += delta;
    if (entries.length) advance(delta);
    else if (camera && !reduced) {
      camera.position.z -= delta * 70;
      if (camera.position.z < -2400) rebaseWorld();
    }
    updateWorld();
    if (clock >= 1) { clock = 0; adapter.tick(); }
  }
  function apply(next) {
    payload = next; settings = next.universe;
    settings.world = worldLink ? worldLink[1] : settings.world || 'space';
    var cards = [];
    for (var i = 0; i < next.cards.length; i += 1) if (next.cards[i].card) cards.push(next.cards[i]);
    var nextSignature = JSON.stringify([settings, cards.map(function (entry) { return entry.pluginId + '/' + entry.cardId; })]);
    entries = cards;
    var nextWorld = JSON.stringify([settings.world, settings.density, settings.detail, settings.stars, settings.nebulae, settings.planets, settings.asteroids, settings.viewDistance]);
    if (settings.enabled && worldSignature !== nextWorld && renderer) {
      worldSignature = nextWorld; populate(); camera.far = settings.viewDistance; resize();
    }
    if (signature !== nextSignature) {
      signature = nextSignature; flight.reset(entries.length); mounted = -1;
      if (camera) camera.position.set(0, 0, 0);
      mount(flight.index);
    } else if (mounted >= 0) adapter.update(entries[mounted], next.options, online && !paused && !hidden && !lost);
    document.title = 'Universe · ' + next.options.name;
    empty.textContent = !settings.enabled ? 'Universe disabled' : !settings.cards.length ? 'No Cards selected' : !entries.length ? 'Selected Cards unavailable' : '';
    if (!settings.enabled) { panel.style.visibility = 'hidden'; disposeWorld(); scene = null; worldSignature = ''; if (renderer) renderer.clear(); }
    else { positionPanel(flight.progress()); updateWorld(); }
    inform(lost ? 'Graphics paused · reload to restore' : !renderer ? '3D unavailable · Card display' : '');
  }
  function disconnect() {
    online = false; adapter.connected(false); inform(payload ? 'Disconnected · retained display' : 'Universe unavailable');
  }
  function scheduleRead() {
    if (readTimer) window.clearTimeout(readTimer);
    if (!hidden) readTimer = window.setTimeout(refresh, 2000);
  }
  function refresh() {
    if (request || hidden) return;
    var xhr = new XMLHttpRequest(); request = xhr;
    xhr.open('GET', '/api/universe', true); xhr.timeout = 8000;
    xhr.onload = function () {
      if (xhr !== request) return;
      try {
        if (xhr.status !== 200) throw new Error('Unavailable');
        var next = JSON.parse(xhr.responseText); online = true;
        apply(next); adapter.connected(!paused && !hidden && !lost);
      } catch (error) { disconnect(); }
      request = null; scheduleRead();
    };
    xhr.onerror = xhr.ontimeout = function () { if (xhr !== request) return; request = null; disconnect(); scheduleRead(); };
    xhr.send(null);
  }
  function visibility() {
    hidden = document.hidden; previousTime = 0;
    if (hidden) {
      if (readTimer) window.clearTimeout(readTimer); readTimer = null;
      if (request) { var old = request; request = null; old.abort(); }
      adapter.connected(false);
    } else refresh();
  }
  pauseButton.onclick = function () {
    paused = !paused; pauseButton.textContent = paused ? 'Resume flight' : 'Pause flight'; pauseButton.setAttribute('aria-pressed', String(paused));
    adapter.connected(online && !paused && !hidden && !lost); previousTime = 0;
  };
  document.getElementById('universe-next').onclick = function () {
    if (!settings || !online || paused || !settings.enabled || !entries.length) return;
    if (flight.phase === 'flight') return;
    flight.next(settings); beginFlight();
  };
  var full = document.getElementById('universe-fullscreen');
  // M47 does not implement :focus-within. Keyboard/remote focus still reveals
  // the controls without depending on that newer CSS selector.
  var controls = [pauseButton, document.getElementById('universe-next'), full];
  for (var buttonIndex = 0; buttonIndex < controls.length; buttonIndex += 1) {
    controls[buttonIndex].onfocus = function () { this.parentNode.style.opacity = '1'; };
    controls[buttonIndex].onblur = function () { this.parentNode.style.opacity = ''; };
  }
  full.onclick = function () {
    var element = document.documentElement;
    var method = element.requestFullscreen || element.webkitRequestFullscreen;
    if (method) { var result = method.call(element); if (result && result.catch) result.catch(function () {}); }
  };
  if (!document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen) full.style.display = 'none';
  canvas.addEventListener('webglcontextlost', function (event) { event.preventDefault(); lost = true; adapter.connected(false); inform('Graphics paused · reload to restore'); });
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pageshow', function () { visibility(); });
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', function () {
    hidden = true; if (readTimer) window.clearTimeout(readTimer);
    if (request) { var old = request; request = null; old.abort(); }
    adapter.connected(false);
  });
  if (reducedQuery && reducedQuery.addListener) reducedQuery.addListener(function (event) { reduced = event.matches; previousTime = 0; });
  initGraphics(); resize(); refresh(); frameTimer = window.requestAnimationFrame(animate);
}());
