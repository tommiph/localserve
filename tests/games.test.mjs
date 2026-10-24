/** Disposable game settings, real procedural geometry and synthetic remote/audio
 * inputs. These checks never contact a TV, provider or installed configuration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {GamesStore,gameDefaults,validateGames} from '../server/games.mjs';
import {createLocalserve} from '../server.mjs';

const sources=Object.fromEntries(await Promise.all(['maze-core.js','maze.js','music.js'].map(async name=>[name,await fs.readFile(new URL('../assets/games/'+name,import.meta.url),'utf8')])));
const coreContext={};vm.runInNewContext(sources['maze-core.js'],coreContext);const Core=coreContext.MazeCore;
const temporary=fileURLToPath(new URL('./.tmp/',import.meta.url));
async function folder(t){await fs.mkdir(temporary,{recursive:true});const root=await fs.mkdtemp(path.join(temporary,'games-'));t.after(async()=>{assert.ok(root.startsWith(temporary));await fs.rm(root,{recursive:true,force:true});});await fs.mkdir(path.join(root,'web'));await fs.copyFile(new URL('../web/maze.html',import.meta.url),path.join(root,'web/maze.html'));return root;}

test('game settings validate every field, revision and local music boundary',()=>{
  assert.equal(validateGames(gameDefaults).revision,2);
  for(const patch of [{revision:0},{unknown:1},{enabled:1},{detail:'ultra'},{startSize:2},{growth:0},{gemCount:65},{gemPoints:0},{speedPoints:0},{paceSeconds:0},{moveMs:119},{musicVolume:101},{musicUrl:'/assets/games/music/../key.wav'},{musicUrl:'https://example.com/a.mp3'},{musicUrl:'/assets/games/music/a.mp3?x=1'}])assert.throws(()=>validateGames({...gameDefaults,...patch}),JSON.stringify(patch));
  assert.equal(validateGames({...gameDefaults,gemCount:0,musicVolume:0,musicUrl:'/assets/games/music/my-track.mp3'}).gemCount,0);
});

test('recursive mazes are connected perfect mazes with symmetric closed borders',()=>{
  for(const size of [3,5,7,11,25])for(const seed of [0,1,771,0xffffffff]){
    let edges=0;const seen=new Set(['0,0']),queue=[[0,0]];
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)for(let d=0;d<4;d++){
      const nx=x+Core.dx[d],ny=y+Core.dy[d],wall=Core.wall(seed,size,x,y,d);
      if(nx<0||ny<0||nx>=size||ny>=size)assert.equal(wall,true);
      else{assert.equal(wall,Core.wall(seed,size,nx,ny,(d+2)%4));if(!wall)edges++;}
    }
    for(let at=0;at<queue.length;at++){const [x,y]=queue[at];for(let d=0;d<4;d++)if(!Core.wall(seed,size,x,y,d)){const nx=x+Core.dx[d],ny=y+Core.dy[d],key=nx+','+ny;if(!seen.has(key)){seen.add(key);queue.push([nx,ny]);}}}
    assert.equal(seen.size,size*size);assert.equal(edges/2,size*size-1);
  }
});

test('large mazes need no room grid, gems are bounded, and speed rewards active time',()=>{
  const a=Core.create(gameDefaults,17),b=Core.create(gameDefaults,17);
  assert.equal(JSON.stringify(a),JSON.stringify(b));assert.equal(Core.stage(gameDefaults,4,17).size,11);
  const huge=Core.stage(gameDefaults,50000,17);assert.equal(huge.size,100003);
  for(let x=0;x<1000;x++)assert.equal(typeof Core.wall(huge.seed,huge.size,x*83,x*37,1),'boolean');
  const gems=Core.gems(7,3,64);assert.equal(gems.length,7);assert.equal(new Set(gems.map(g=>g.x+','+g.y)).size,7);
  assert.ok(gems.every(g=>!(g.x===0&&g.y===2)&&!(g.x===2&&g.y===0)));
  a.x=a.gems[0].x;a.y=a.gems[0].y;assert.equal(Core.collect(a,100),100);assert.equal(Core.collect(a,100),0);
  const fast=Core.bonus(a,gameDefaults);a.seconds=100;assert.ok(Core.bonus(a,gameDefaults)<fast);
  a.x=0;a.y=0;a.facing=0;assert.equal(Core.move(a,false),null);
});

test('Games persists preferences without exposing admin fields; TV launch is fixed and revision guarded',async t=>{
  const root=await folder(t),commands=[];let logging=async()=>{};
  const registry={actionAvailability:()=>({available:true}),engine:{gate:{paused:false}},localDisplayOrigin:()=> 'http://192.168.1.10:7041',execute:async(...args)=>commands.push(args)};
  let store=await new GamesStore(root,registry,{add:(...args)=>logging(...args)}).load();
  assert.equal(store.viewer().settings.musicUrl,'');assert.equal(store.viewer().revision,undefined);assert.equal(store.viewer().token,undefined);
  await store.save({...store.snapshot(),musicVolume:20});store=await new GamesStore(root,registry,{add:(...args)=>logging(...args)}).load();assert.equal(store.snapshot().musicVolume,20);
  const revision=store.snapshot().revision,signal=new AbortController().signal;
  await assert.rejects(store.openOnTv(revision-1,signal));assert.equal(commands.length,0);
  await store.openOnTv(revision,signal);assert.equal(commands.length,1);assert.deepEqual(commands[0].slice(0,3),['samsung-tv','launch-app',{id:'HwGlance01.HomeGlance',mode:'DEEP_LINK',arguments:'http://192.168.1.10:7041/games/maze'}]);assert.equal(commands[0][3].automatic,false);
  const abort=new AbortController();abort.abort();await assert.rejects(store.openOnTv(revision,abort.signal));assert.equal(commands.length,1);
  registry.localDisplayOrigin=()=>null;await assert.rejects(store.openOnTv(revision,signal));assert.equal(commands.length,1);registry.localDisplayOrigin=()=> 'http://192.168.1.10:7041';
  let release;logging=()=>new Promise(resolve=>{release=resolve;});const pending=store.openOnTv(revision,signal);
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(store.admin().tvAvailable,false);await assert.rejects(store.openOnTv(revision,signal));
  await store.store.update(value=>{value.enabled=false;value.revision++;});release();await assert.rejects(pending);assert.equal(commands.length,1);assert.throws(()=>store.viewer());
});

test('HTTP game display is public read-only, private saves require exact Origin/token',async t=>{
  let app;t.after(()=>app?.close());const root=await folder(t);app=await createLocalserve(root,{automatic:false});
  const headers={Origin:app.origin,'X-Localserve-Token':app.snapshot().token,'Content-Type':'application/json'};
  const response=await fetch(app.origin+'/api/games/maze');assert.equal(response.status,200);assert.equal((await response.json()).settings.detail,'low');
  const post=(route,body,h=headers)=>fetch(app.origin+route,{method:'POST',headers:h,body:JSON.stringify(body)});
  assert.equal((await post('/api/games/maze',app.games.snapshot(),{Origin:app.origin})).status,403);
  assert.equal((await post('/api/games/maze',app.games.snapshot(),{...headers,Origin:'http://evil.invalid'})).status,403);
  assert.equal((await post('/api/games/maze',app.games.snapshot())).status,200);
  assert.equal((await post('/api/games/maze/open-on-tv',{revision:2,url:'http://evil.invalid'})).status,400);
  const page=await fetch(app.origin+'/games/maze');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'self' file:/);assert.doesNotMatch(page.headers.get('content-security-policy'),/unsafe-eval|unsafe-inline/);
  assert.equal((await fetch(app.origin+'/games/maze?seed=x')).status,400);
  assert.equal((await fetch(app.origin+'/data/games.json')).status,404);
  assert.equal((await post('/api/games/maze',{...app.games.snapshot(),enabled:false})).status,200);
  assert.equal((await fetch(app.origin+'/games/maze')).status,404);assert.equal((await fetch(app.origin+'/maze.html')).status,404);assert.equal((await fetch(app.origin+'/api/games/maze')).status,404);
});

test('all shipped game scripts parse as ES5 for the Tizen WebGL1 viewer',()=>{
  const module={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module,exports:module.exports});
  for(const [name,source]of Object.entries(sources))assert.doesNotThrow(()=>module.exports.parse(source,{ecmaVersion:5}),name);
});

function audioFixture(){
  const reads=[],sources=[],reports=[];let decode;
  const audio={destination:{},resume:()=>Promise.resolve(),decodeAudioData:(data,callback)=>{decode=callback;},createGain:()=>({gain:{},connect(){},disconnect(){}}),createBufferSource:()=>{const source={connect(){},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;}};sources.push(source);return source;},close:()=>Promise.resolve()};
  const context={AudioContext:function(){return audio;},XMLHttpRequest:function(){this.open=()=>{};this.send=()=>reads.push(this);this.abort=()=>{this.aborted=true;this.onabort();};}};context.window=context;vm.runInNewContext(sourcesForMusic(),context);
  return{music:new context.MazeMusic('/assets/games/music/test.wav',40,message=>reports.push(message)),reads,sources,reports,decode:()=>decode({duration:5})};
}
function sourcesForMusic(){return sources['music.js'];}
test('music loads only on opt-in, loops decoded audio and stops on pause/disposal',()=>{
  const f=audioFixture();f.music.play();assert.equal(f.reads.length,0);f.music.toggle(true);assert.equal(f.reads.length,1);
  const xhr=f.reads[0];xhr.status=200;xhr.response=new ArrayBuffer(20);xhr.onload();f.music.pause();f.decode();assert.equal(f.sources.length,0);
  f.music.play();assert.equal(f.sources.length,1);assert.equal(f.sources[0].loop,true);assert.equal(f.sources[0].started,true);
  f.music.pause();assert.equal(f.sources[0].stopped,true);f.music.play();assert.equal(f.sources.length,2);f.music.close();assert.equal(f.sources[1].stopped,true);f.music.play();assert.equal(f.sources.length,2);
  const late=audioFixture();late.music.toggle(true);const read=late.reads[0];read.status=200;read.response=new ArrayBuffer(20);read.onload();late.music.close();late.decode();assert.equal(late.sources.length,0);
  const large=audioFixture();large.music.toggle(true);large.reads[0].onprogress({loaded:13000000});assert.equal(large.reads[0].aborted,true);assert.equal(large.music.failed,true);
});

async function viewerFixture(graphics=true){
  const nodes={},listeners={},frames=new Map(),reads=[],renderers=[];let time=0,sequence=0,remotePause;
  function element(){return{hidden:false,disabled:false,textContent:'',style:{},userData:{},addEventListener(key,fn){this['on'+key]=fn;},focus(){this.focused=true;if(this.onfocus)this.onfocus();},click(){if(!this.disabled&&this.onclick)this.onclick();}};}
  for(const id of ['maze','menu','start','music','fullscreen','level','score','gems','time','bearing','best','toast','menu-message','stage-result','music-status'])nodes[id]=element();
  const paint={fillRect(){},fillText(){},strokeRect(){},beginPath(){},arc(){},fill(){},createLinearGradient:()=>({addColorStop(){}})};
  nodes.maze.getContext=()=>graphics?{}:null;
  const document={hidden:false,getElementById:id=>nodes[id],documentElement:{},createElement:()=>({getContext:()=>paint}),addEventListener:(key,fn)=>{listeners[key]=fn;}};
  const context=vm.createContext({document,console,Date,Math,Float32Array,Uint16Array,Uint32Array,Int32Array,ArrayBuffer,localStorage:{getItem:()=>null,setItem(){}},performance:{now:()=>time},innerWidth:1920,innerHeight:1080,matchMedia:()=>({matches:false}),requestAnimationFrame:fn=>{frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:id=>frames.delete(id),addEventListener:(key,fn)=>{listeners[key]=fn;},XMLHttpRequest:function(){this.open=()=>{};this.send=()=>reads.push(this);this.abort=()=>{this.aborted=true;};}});context.window=context;context.self=context;
  vm.runInContext(await fs.readFile(new URL('../assets/universe/vendor/three-r97/three.min.js',import.meta.url),'utf8'),context);
  context.THREE.WebGLRenderer=function(){renderers.push(this);this.setPixelRatio=()=>{};this.setClearColor=()=>{};this.setSize=(w,h)=>{this.size=[w,h];};this.render=(scene,camera)=>{this.scene=scene;this.camera=camera;};this.dispose=()=>{this.disposed=true;};};
  vm.runInContext(sources['maze-core.js'],context);
  let current;for(const name of ['create','stage']){const original=context.MazeCore[name];context.MazeCore[name]=(...args)=>(current=original(...args));}
  context.LocalserveTvViewer={install(step,controls){remotePause=controls.pause;}};
  vm.runInContext(sources['music.js'],context);vm.runInContext(sources['maze.js'],context);
  const xhr=reads[0];xhr.status=200;xhr.responseText=JSON.stringify({settings:gameDefaults});xhr.onload();
  return{nodes,listeners,document,renderers,frames,reads,remotePause,get current(){return current;},step(seconds){for(let n=0;n<seconds*30;n++){time+=1000/30;const entry=frames.entries().next().value;if(!entry)break;frames.delete(entry[0]);entry[1](time);}},key(code,down=true,repeat=false){listeners[down?'keydown':'keyup']({keyCode:code,repeat,preventDefault(){},stopPropagation(){}});}};
}
test('real geometry stays bounded, remote starts/turns/pauses, hidden time freezes and resources close',async()=>{
  const f=await viewerFixture();f.step(.2);const renderer=f.renderers[0];assert.deepEqual(renderer.size,[960,540]);assert.equal(f.nodes.start.disabled,false);
  let draws=0;renderer.scene.traverse(node=>{if(node.geometry){draws++;if(node.geometry.vertices)assert.ok(node.geometry.vertices.every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.z)));else assert.ok(Array.from(node.geometry.attributes.position.array).every(Number.isFinite));}});assert.ok(draws<70);
  f.key(13);assert.equal(f.nodes.menu.hidden,true);f.key(13,true,true);assert.equal(f.nodes.menu.hidden,true);f.key(13,false);f.key(39);f.key(39,false);f.step(.5);assert.equal(f.nodes.bearing.textContent,'E');
  assert.ok(Math.abs(renderer.camera.rotation.y+Math.PI/2)<.001);f.step(1.5);assert.notEqual(f.nodes.time.textContent,'0:00');
  f.document.hidden=true;f.listeners.visibilitychange();const elapsed=f.nodes.time.textContent;f.step(4);assert.equal(f.nodes.time.textContent,elapsed);assert.equal(f.nodes.menu.hidden,false);
  f.document.hidden=false;f.listeners.visibilitychange();f.step(2);assert.equal(f.nodes.time.textContent,elapsed);
  f.key(13);f.key(13,false);f.step(1.2);assert.notEqual(f.nodes.time.textContent,elapsed);f.key(10009);assert.equal(f.nodes.menu.hidden,false);
  f.listeners.pagehide();assert.equal(renderer.disposed,true);assert.equal(f.frames.size,0);assert.equal(f.reads[0].aborted,true);
  const unavailable=await viewerFixture(false);assert.match(unavailable.nodes['menu-message'].textContent,/WebGL/);assert.equal(unavailable.nodes.start.disabled,true);
});

test('remote traversal reaches EXIT, awards one bonus and starts a larger maze',async()=>{
  const f=await viewerFixture(),game=f.current,queue=[{x:game.x,y:game.y,path:[]}],seen=new Set([game.x+','+game.y]);let route;
  for(let at=0;at<queue.length;at++){const node=queue[at];if(node.x===game.size-1&&node.y===0){route=node.path;break;}for(let d=0;d<4;d++)if(!Core.wall(game.seed,game.size,node.x,node.y,d)){const x=node.x+Core.dx[d],y=node.y+Core.dy[d],key=x+','+y;if(!seen.has(key)){seen.add(key);queue.push({x,y,path:[...node.path,d]});}}}
  assert.ok(route.length);f.key(13);f.key(13,false);
  for(const direction of route){while(game.facing!==direction){f.key(39);f.key(39,false);f.step(.35);}f.key(38);f.key(38,false);f.step(.45);}
  assert.equal(f.nodes.menu.hidden,false);assert.equal(f.nodes.start.textContent,'Next maze');assert.match(f.nodes['stage-result'].textContent,/Speed bonus/);
  const score=Number(f.nodes.score.textContent);assert.ok(score>0);f.step(3);assert.equal(Number(f.nodes.score.textContent),score);
  f.key(13);f.key(13,false);assert.equal(f.current.level,2);assert.equal(f.current.size,7);assert.equal(Number(f.nodes.score.textContent),score);assert.equal(f.nodes.menu.hidden,true);f.listeners.pagehide();
});

test('dedicated media controls start, pause and resume without advancing a paused run',async()=>{
 const f=await viewerFixture();f.remotePause('play');assert.equal(f.nodes.menu.hidden,true);
 f.step(1);f.remotePause('pause');assert.equal(f.nodes.menu.hidden,false);const time=f.nodes.time.textContent;
 f.step(3);assert.equal(f.nodes.time.textContent,time);f.remotePause('play');assert.equal(f.nodes.menu.hidden,true);
 f.remotePause('toggle');assert.equal(f.nodes.menu.hidden,false);f.listeners.pagehide();
});

