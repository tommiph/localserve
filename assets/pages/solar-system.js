/** Supplied procedural solar-system display, adapted for local CSP and
 * cooperative visibility lifecycle. No network, device controls or API access. */
(function () {
'use strict';
if (!window.THREE) { document.getElementById('display-error').hidden = false; return; }

// Main Application Scope
var scene, camera, renderer;
var animationFrame = 0;
var displayFailed = false;
var celestialBodies = [];
var starField;
var sunMesh, sunCoronaMesh;

// Cinematic Camera Engine States
var clock = new THREE.Clock();
var currentTargetIndex = 0;
var transitionTimer = 0;
var transitionDuration = 10.0; // Seconds per focus target

// Dynamic camera blending vectors
var currentCamPos = new THREE.Vector3(0, 100, 200);
var currentLookAt = new THREE.Vector3(0, 0, 0);

// Utility: Generate procedural canvas textures to prevent external asset dependencies
function createProceduralTexture(type, colorBase) {
    var canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    var ctx = canvas.getContext('2d');

    if (type === 'sun') {
        var grad = ctx.createRadialGradient(256, 128, 10, 256, 128, 256);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.3, '#ffaa00');
        grad.addColorStop(1, '#ff3300');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 256);
    } else if (type === 'earth') {
        ctx.fillStyle = '#1e3a8a'; // Deep ocean blue
        ctx.fillRect(0, 0, 512, 256);
        ctx.fillStyle = '#15803d'; // Landmass splotches
        for (var i = 0; i < 25; i++) {
            ctx.beginPath();
            var x = Math.random() * 512;
            var y = Math.random() * 256;
            var r = 20 + Math.random() * 50;
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (type === 'clouds') {
        ctx.clearRect(0, 0, 512, 256);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        for (var i = 0; i < 30; i++) {
            ctx.beginPath();
            var x = Math.random() * 512;
            var y = Math.random() * 256;
            var r = 15 + Math.random() * 40;
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
    } else {
        // Generic gas giant or rocky texture bands
        ctx.fillStyle = colorBase;
        ctx.fillRect(0, 0, 512, 256);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        for (var j = 0; j < 10; j++) {
            var h = 10 + Math.random() * 20;
            ctx.fillRect(0, Math.random() * 256, 512, h);
        }
    }

    var texture = new THREE.Texture(canvas);
    texture.needsUpdate = true;
    return texture;
}

// Celestial Body Configurations
var bodyConfigs = [
    { name: "Sun", size: 10, distance: 0, speed: 0, color: 0xffaa00, type: 'sun', camDist: 35, camHeight: 12 },
    { name: "Mercury", size: 1.0, distance: 22, speed: 0.04, color: 0x888888, type: 'rock', camDist: 6, camHeight: 2 },
    { name: "Venus", size: 1.8, distance: 32, speed: 0.02, color: 0xd4a373, type: 'gas', camDist: 8, camHeight: 3 },
    { name: "Earth", size: 2.5, distance: 45, speed: 0.012, color: 0x1d4ed8, type: 'earth', camDist: 10, camHeight: 3.5, hasMoon: true, hasClouds: true },
    { name: "Mars", size: 1.4, distance: 60, speed: 0.009, color: 0xc1440e, type: 'rock', camDist: 7, camHeight: 2.5 },
    { name: "Jupiter", size: 5.5, distance: 82, speed: 0.005, color: 0xd4a373, type: 'gas', camDist: 18, camHeight: 6 },
    { name: "Saturn", size: 4.5, distance: 108, speed: 0.003, color: 0xf4e2bb, type: 'gas', camDist: 20, camHeight: 7, hasRings: true },
    { name: "Uranus", size: 3.0, distance: 135, speed: 0.0018, color: 0x73d2de, type: 'gas', camDist: 12, camHeight: 4 },
    { name: "Neptune", size: 2.9, distance: 162, speed: 0.0012, color: 0x3b5fc0, type: 'gas', camDist: 12, camHeight: 4 }
];

function init() {
    var container = document.getElementById('canvas-container');

    // 1. Scene Setup
    scene = new THREE.Scene();

    // 2. Camera Setup
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);

    // 3. Renderer Setup (WebGL 1 safe, disabled antialiasing for maximum hardware performance)
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.appendChild(renderer.domElement);

    // 4. Lighting Setup
    var ambientLight = new THREE.AmbientLight(0x222222);
    scene.add(ambientLight);

    var sunLight = new THREE.PointLight(0xffffff, 2.0, 600);
    sunLight.position.set(0, 0, 0);
    scene.add(sunLight);

    // 5. Build Environment
    createStarfield();
    createSunAndBodies();

    // 6. Window Resize Listener
    window.addEventListener('resize', onWindowResize, false);

    // Start Cinematic Loop
    animate();
}

// Starfield background point cloud
function createStarfield() {
    var starCount = 2000;
    var geometry = new THREE.BufferGeometry();
    var positions = new Float32Array(starCount * 3);

    for (var i = 0; i < starCount * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 900;
        positions[i + 1] = (Math.random() - 0.5) * 900;
        positions[i + 2] = (Math.random() - 0.5) * 900;
    }

    geometry.addAttribute('position', new THREE.BufferAttribute(positions, 3));
    var material = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, transparent: true, opacity: 0.85 });
    starField = new THREE.Points(geometry, material);
    scene.add(starField);
}

// Build Sun and Orbiting Celestial Bodies
function createSunAndBodies() {
    for (var i = 0; i < bodyConfigs.length; i++) {
        var config = bodyConfigs[i];
        var bodyGroup = new THREE.Group();
        scene.add(bodyGroup);

        var mesh;
        if (config.name === "Sun") {
            var sunGeo = new THREE.SphereGeometry(config.size, 32, 32);
            var sunMat = new THREE.MeshBasicMaterial({ map: createProceduralTexture('sun') });
            mesh = new THREE.Mesh(sunGeo, sunMat);
            bodyGroup.add(mesh);

            // Shimmer corona
            var coronaGeo = new THREE.SphereGeometry(config.size * 1.15, 32, 32);
            var coronaMat = new THREE.MeshBasicMaterial({ color: 0xff4500, transparent: true, opacity: 0.35 });
            sunCoronaMesh = new THREE.Mesh(coronaGeo, coronaMat);
            bodyGroup.add(sunCoronaMesh);
        } else {
            // Orbit track line
            var orbitGeo = new THREE.RingGeometry(config.distance - 0.1, config.distance + 0.1, 128);
            var orbitMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.05 });
            var orbitLine = new THREE.Mesh(orbitGeo, orbitMat);
            orbitLine.rotation.x = Math.PI / 2;
            scene.add(orbitLine);

            // Planet Mesh
            var pGeo = new THREE.SphereGeometry(config.size, 24, 24);
            var pMat = new THREE.MeshLambertMaterial({ map: createProceduralTexture(config.type, config.color) });
            mesh = new THREE.Mesh(pGeo, pMat);
            bodyGroup.add(mesh);

            // Earth specific clouds & moon
            if (config.hasClouds) {
                var cloudGeo = new THREE.SphereGeometry(config.size * 1.03, 24, 24);
                var cloudMat = new THREE.MeshLambertMaterial({ map: createProceduralTexture('clouds'), transparent: true, opacity: 0.5 });
                var cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
                bodyGroup.add(cloudMesh);
                config.cloudMesh = cloudMesh;
            }

            if (config.hasMoon) {
                var moonGeo = new THREE.SphereGeometry(0.7, 16, 16);
                var moonMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
                var moonMesh = new THREE.Mesh(moonGeo, moonMat);
                bodyGroup.add(moonMesh);
                config.moonMesh = moonMesh;
            }

            // Saturn Rings
            if (config.hasRings) {
                var ringGeo = new THREE.RingGeometry(config.size * 1.4, config.size * 2.3, 32);
                var ringMat = new THREE.MeshBasicMaterial({ color: 0xcca66b, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
                var ringMesh = new THREE.Mesh(ringGeo, ringMat);
                ringMesh.rotation.x = Math.PI / 2;
                bodyGroup.add(ringMesh);
            }
        }

        celestialBodies.push({
            config: config,
            group: bodyGroup,
            mesh: mesh,
            angle: Math.random() * Math.PI * 2
        });
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Main Animation & Automated Cinematic Loop
function animate() {
    if (document.hidden || !renderer) { animationFrame = 0; return; }
    animationFrame = requestAnimationFrame(animate);

    var delta = clock.getDelta();
    var elapsedTime = clock.getElapsedTime();

    // 1. Update all celestial positions & rotations
    for (var i = 0; i < celestialBodies.length; i++) {
        var body = celestialBodies[i];
        var cfg = body.config;

        if (cfg.name !== "Sun") {
            body.angle += cfg.speed * 0.4;
            var px = Math.cos(body.angle) * cfg.distance;
            var pz = Math.sin(body.angle) * cfg.distance;
            body.group.position.set(px, 0, pz);
            body.mesh.rotation.y += 0.01;

            if (cfg.cloudMesh) {
                cfg.cloudMesh.rotation.y += 0.015;
            }
            if (cfg.moonMesh) {
                var moonAngle = elapsedTime * 0.04;
                cfg.moonMesh.position.x = Math.cos(moonAngle) * (cfg.size * 2.5);
                cfg.moonMesh.position.z = Math.sin(moonAngle) * (cfg.size * 2.5);
            }
        } else {
            body.mesh.rotation.y += 0.002;
            if (sunCoronaMesh) {
                sunCoronaMesh.scale.setScalar(1 + Math.sin(elapsedTime * 2) * 0.03);
            }
        }
    }

    // Starfield subtle motion
    if (starField) {
        starField.rotation.y += 0.0001;
    }

    // 2. Automated Cinematic Focus Transitions
    transitionTimer += delta;
    if (transitionTimer >= transitionDuration) {
        transitionTimer = 0;
        currentTargetIndex = (currentTargetIndex + 1) % celestialBodies.length;
    }

    var activeTarget = celestialBodies[currentTargetIndex];
    var targetPos = activeTarget.group.position;
    var targetCfg = activeTarget.config;

    // Calculate dynamic orbital camera position around active focus body
    var orbitSpeedCam = elapsedTime * 0.2;
    var camOffsetDist = targetCfg.camDist;
    var camHeightOffset = targetCfg.camHeight;

    var idealCamX = targetPos.x + Math.cos(orbitSpeedCam) * camOffsetDist;
    var idealCamZ = targetPos.z + Math.sin(orbitSpeedCam) * camOffsetDist;
    var idealCamY = targetPos.y + camHeightOffset + Math.sin(elapsedTime * 0.5) * 1.0;

    var idealCamPos = new THREE.Vector3(idealCamX, idealCamY, idealCamZ);

    // Smoothly interpolate (lerp) camera position and lookAt target for buttery cinematic flow
    currentCamPos.lerp(idealCamPos, 0.03);
    currentLookAt.lerp(targetPos, 0.05);

    camera.position.copy(currentCamPos);
    camera.lookAt(currentLookAt);

    renderer.render(scene, camera);
}

// Run on load

function stopAnimation() {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
}
function showDisplayError() {
    displayFailed = true;
    stopAnimation();
    document.getElementById('display-error').hidden = false;
}
function resumeAnimation() {
    if (displayFailed || document.hidden || !renderer || animationFrame) return;
    // Discard hidden time so returning to the page does not jump camera targets.
    clock.getDelta();
    animate();
}
document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopAnimation(); else resumeAnimation();
});
window.addEventListener('pagehide', stopAnimation);
window.addEventListener('pageshow', resumeAnimation);
window.addEventListener('load', function () {
    try {
        init();
        renderer.domElement.addEventListener('webglcontextlost', showDisplayError);
    } catch (error) {
        // Display a usable failure state; never repeatedly recreate GPU contexts.
        showDisplayError();
    }
});
    
}());
