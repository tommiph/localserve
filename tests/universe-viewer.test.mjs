/** Execute the shipped display scripts with real Three.js geometry/matrices and
 * an instrumented renderer. No GPU, browser, provider or TV is contacted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const scripts = await Promise.all(['vendor/three-r97/three.min.js', 'flight.js', 'worlds.js', 'universe.js'].map(name => fs.readFile(new URL('../assets/universe/' + name, import.meta.url), 'utf8')));
const defaults = { schemaVersion:1,revision:1,enabled:true,cards:[],holdSeconds:1,flightMinSeconds:2,flightMaxSeconds:2,
  order:'sequential',density:100,detail:'low',viewDistance:6000,motion:50,stars:true,nebulae:true,planets:true,asteroids:true };
function fixture(graphics = true, search = '') {
  const nodes = {}, listeners = {}, timers = new Map(), frames = [], reads = [], mounts = [], renderers = [];
  let sequence = 0, time = 0, remotePause;
  function element() { return { style:{},setAttribute(key,value){ this[key]=value; },addEventListener(key,callback){ this[key]=callback; } }; }
  for (const id of ['universe-space','universe-panel','vista-status','universe-empty','universe-pause','universe-fullscreen','universe-next']) nodes[id] = element();
  nodes['universe-space'].getContext = () => graphics ? {} : null;
  const document = { hidden:false,documentElement:element(),getElementById:id=>nodes[id],
    addEventListener:(key,callback)=>{listeners[key]=callback;},createElement:()=>({getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})}) };
  const context = vm.createContext({ document, console, Float32Array, Uint16Array, Uint32Array, Int32Array, ArrayBuffer,
    location:{search},setTimeout:(fn)=>{timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:fn=>frames.push(fn),innerWidth:1920,innerHeight:1080,
    addEventListener:(key,callback)=>{listeners[key]=callback;},matchMedia:()=>({matches:false,addListener(fn){listeners.reduced=fn;}}),
    LocalserveLegacyCard:{update:(entry,options,online)=>mounts.push({entry,options,online}),connected:value=>mounts.push({connected:value}),tick(){}},
    XMLHttpRequest:class {open(method,url){this.url=url;}send(){reads.push(this);}abort(){this.aborted=true;}},
  });
  context.window = context; context.self = context;
  context.LocalserveTvViewer = {install(step,controls){remotePause=controls.pause;}};
  vm.runInContext(scripts[0], context);
  context.THREE.WebGLRenderer = function () {
    renderers.push(this);this.calls=0;this.setPixelRatio=()=>{};this.setClearColor=()=>{};this.setSize=(w,h)=>{this.size=[w,h];};this.clear=()=>{};
    this.render=(scene,camera)=>{ this.calls++;this.scene=scene;this.camera=camera;camera.updateMatrixWorld();camera.matrixWorldInverse.getInverse(camera.matrixWorld); };
  };
  vm.runInContext(scripts[1], context); vm.runInContext(scripts[2], context); vm.runInContext(scripts[3], context);
  const cards = [0,1].map(index=>({pluginId:'example',cardId:'card-'+index,card:{id:'card-'+index}}));
  const payload = (patch = {}) => ({ universe:{...defaults,cards:cards.map(({pluginId,cardId})=>({pluginId,cardId})),...patch},cards,
    options:{name:'Test',theme:'dark',fontScale:100,timeFormat:'24',now:12345} });
  return {nodes,document,listeners,timers,reads,mounts,renderers,payload,get remotePause(){return remotePause;},
    deliver(value){ const xhr=reads[reads.length-1];xhr.status=200;xhr.responseText=JSON.stringify(value);xhr.onload(); },
    step(seconds){ for(let i=0;i<seconds*60;i++){time+=1000/60;const fn=frames.shift();fn(time);} },
    poll(){const [id,fn]=[...timers].at(-1);timers.delete(id);fn();},
  };
}

for (const world of ['ocean','mountains','forest','dunes']) {
  test(`${world} builds bounded finite geometry, recycles strips and disposes on change`, () => {
    const f = fixture(true, '?world=' + world); f.deliver(f.payload()); f.step(0.2);
    const renderer = f.renderers[0], scene = renderer.scene;
    const strips = scene.children.filter(child => child.userData.landscape);
    assert.equal(strips.length, 6);
    let drawCalls = 0, disposed = 0;
    scene.traverse(child => {
      if (!child.geometry) return;
      drawCalls++;
      child.geometry.addEventListener('dispose', () => disposed++);
      const vertices = child.geometry.attributes.position.array;
      assert.ok(Array.from(vertices).every(Number.isFinite));
      assert.ok(vertices.length < 200000, 'one batch remains bounded');
    });
    assert.ok(drawCalls < 65, 'batched landscape draw-call ceiling');
    // Continue through many leg/rebase boundaries without accumulating objects.
    f.step(100);
    assert.equal(renderer.scene, scene);
    assert.equal(renderer.scene.children.filter(child => child.userData.landscape).length, 6);
    assert.ok(strips.every(chunk => Number.isFinite(chunk.position.z)));
    assert.doesNotMatch(f.nodes['universe-panel'].style.transform, /NaN|Infinity/);
    const z = renderer.camera.position.z; f.poll(); f.deliver(f.payload());
    assert.equal(renderer.scene, scene); assert.equal(renderer.camera.position.z, z);
    f.poll(); f.deliver(f.payload({density:0}));
    assert.notEqual(renderer.scene, scene); assert.ok(disposed > 0);
    assert.equal(renderer.scene.children.filter(child => child.userData.landscape).flatMap(chunk => chunk.children).length, 0);
    // URL is only an override; it cannot re-enable a disabled display.
    f.poll(); f.deliver(f.payload({enabled:false}));
    assert.equal(f.nodes['universe-panel'].style.visibility, 'hidden');
  });
}

test('configured world switches live, invalid links fall back and no-WebGL remains usable', () => {
  const f=fixture(true,'?world=unknown'); f.deliver(f.payload({world:'forest'})); f.step(0.1);
  const old=f.renderers[0].scene;
  assert.equal(old.children.filter(child=>child.userData.landscape).length,6);
  f.poll(); f.deliver(f.payload({world:'space'}));
  assert.notEqual(f.renderers[0].scene,old);
  assert.ok(f.renderers[0].scene.children.some(child=>child.isPoints));
  const fallback=fixture(false,'?world=ocean'); fallback.deliver(fallback.payload()); fallback.step(4);
  assert.match(fallback.nodes['vista-status'].textContent,/3D unavailable/);
  assert.ok(fallback.mounts.some(item=>item.entry?.cardId==='card-1'));
});

test('landscape detail/view-distance extremes stay bounded and resources retire once', () => {
  for(const world of ['ocean','mountains','forest','dunes']) for(const detail of ['low','medium','high']) {
    const f=fixture(); f.deliver(f.payload({world,detail,viewDistance:3000})); f.step(0.2);
    const renderer=f.renderers[0], retired=new Set(); let calls=0;
    renderer.scene.traverse(child=>{
      if(child.geometry) {
        calls++;
        const geometry=child.geometry;
        geometry.addEventListener('dispose',()=>{
          assert.ok(!retired.has(geometry),'no double geometry disposal'); retired.add(geometry);
        });
        assert.ok(Array.from(geometry.attributes.position.array).every(Number.isFinite));
      }
    });
    assert.ok(calls<65);
    f.poll(); f.deliver(f.payload({world,detail,viewDistance:12000})); f.step(0.2);
    assert.equal(renderer.camera.far,12000);
    assert.ok(retired.size>0);
    f.poll(); f.deliver(f.payload({world:'space'}));
    assert.ok(renderer.scene.children.some(child=>child.isPoints));
  }
});

test('shipped Universe bounds scene, uses one Card adapter and advances live flight', () => {
  const f=fixture();f.deliver(f.payload());f.step(0.2);
  const renderer=f.renderers[0];
  assert.equal(renderer.size[0],960);
  assert.ok(renderer.scene.children.length < 100);
  const points=renderer.scene.children.find(child=>child.isPoints);
  assert.equal(points.geometry.attributes.position.count,2100);
  assert.equal(f.mounts.filter(item=>item.entry).at(-1).entry.cardId,'card-0');
  f.step(2);
  assert.equal(f.mounts.filter(item=>item.entry).at(-1).entry.cardId,'card-1');
  assert.ok(renderer.camera.position.z < -1);
  assert.doesNotMatch(f.nodes['universe-panel'].style.transform,/NaN|Infinity/);
  f.step(1.4);
  assert.equal(f.nodes['universe-panel'].style.opacity,'1');
  // Repeated data updates hydrate the active Card and do not restart the leg.
  const z=renderer.camera.position.z;f.poll();f.deliver(f.payload());
  assert.equal(renderer.camera.position.z,z);
});

test('pause, visibility, disconnect and recovery do not replay time or duplicate read loops', () => {
  const f=fixture();f.deliver(f.payload());f.step(0.3);
  f.nodes['universe-pause'].onclick();
  const count=f.renderers[0].calls;f.step(5);assert.equal(f.renderers[0].calls,count);
  f.poll();f.deliver(f.payload());assert.equal(f.mounts.at(-1).connected,false);
  f.nodes['universe-pause'].onclick();
  f.document.hidden=true;f.listeners.visibilitychange();assert.equal(f.timers.size,0);
  f.step(5);f.document.hidden=false;f.listeners.visibilitychange();
  const reads=f.reads.length;f.listeners.pageshow();assert.equal(f.reads.length,reads);
  f.deliver(f.payload());f.step(0.1);
  assert.equal(f.mounts.filter(item=>item.entry).at(-1).entry.cardId,'card-0');
  f.poll();f.reads.at(-1).onerror();const before=f.renderers[0].calls;
  f.step(5);assert.equal(f.renderers[0].calls,before);
  assert.match(f.nodes['vista-status'].textContent,/Disconnected/);
  f.poll();f.deliver(f.payload());assert.equal(f.nodes['vista-status'].style.display,'none');
});

test('no WebGL falls back to stationary Card fades and removed Cards clear immediately', () => {
  const f=fixture(false);f.deliver(f.payload());
  assert.match(f.nodes['vista-status'].textContent,/3D unavailable/);
  f.step(3.4);assert.equal(f.mounts.filter(item=>item.entry).at(-1).entry.cardId,'card-1');
  f.poll();f.deliver({...f.payload(),cards:[]});
  assert.equal(f.nodes['universe-panel'].style.visibility,'hidden');
  assert.match(f.nodes['universe-empty'].textContent,/unavailable/);
});

test('zero stop keeps the camera moving through successive Card boundaries', () => {
  const f = fixture(); f.deliver(f.payload({ holdSeconds:0 })); f.step(0.2);
  const camera = f.renderers[0].camera;
  for (let i = 0; i < 50; i++) {
    const before = camera.position.z;
    f.step(0.1);
    assert.notEqual(camera.position.z, before, 'Camera must keep moving between Cards');
    assert.doesNotMatch(f.nodes['universe-panel'].style.transform, /NaN|Infinity/);
  }
  const visited = new Set(f.mounts.filter(item => item.entry).map(item => item.entry.cardId));
  assert.equal(visited.size, 2);
});

test('dedicated Play and Pause controls are idempotent and hold the flight camera',()=>{
 const f=fixture();f.deliver(f.payload({holdSeconds:0}));f.step(.2);f.remotePause('pause');
 const camera=f.renderers[0].camera,before=camera.position.z;f.step(1);assert.equal(camera.position.z,before);
 assert.equal(f.nodes['universe-pause'].textContent,'Resume flight');f.remotePause('pause');assert.equal(f.nodes['universe-pause'].textContent,'Resume flight');
 f.remotePause('play');f.step(.2);assert.notEqual(camera.position.z,before);assert.equal(f.nodes['universe-pause'].textContent,'Pause flight');
});
