/** Synthetic pixels and disposable plugin workers; never open a physical camera. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createLocalserve} from '../server.mjs';
import {validateDeclaration} from '../server/plugins.mjs';
import {FrameAnalyzer} from '../plugins/webcam/server/analyzer.mjs';
import {CameraCapture} from '../plugins/webcam/server/capture.mjs';
const declaration=JSON.parse(await fs.readFile(new URL('../plugins/webcam/declaration.json',import.meta.url)));
const settings=Object.fromEntries(declaration.settings.map(field=>[field.id,field.default]));
const sample=value=>new Uint8Array(768).fill(value);

test('Webcam declaration exposes typed readings, inert design and bounded preview contract',()=>{
 const plugin=validateDeclaration(declaration);
 assert.equal(plugin.runtime.preview,'jpeg-v1');assert.equal(plugin.cardTemplates[0].preview,true);
 assert.ok(plugin.events.find(e=>e.id==='readings').payload.some(f=>f.id==='brightness'&&f.type==='number'));
 assert.equal(plugin.events.find(e=>e.id==='motion-detected').occurrenceKey,'occurrence-id');
 assert.equal(plugin.events.find(e=>e.id==='readings').occurrenceKey,undefined);
 assert.throws(()=>validateDeclaration({...declaration,runtime:{...declaration.runtime,preview:'http://elsewhere'}}),/preview/);
});
test('uniform lighting shifts are classified without manufacturing movement',()=>{
 const a=new FrameAnalyzer(settings);for(let i=0;i<4;i++)a.accept(sample(10),1000+i*200);
 assert.equal(a.current.condition,'Dark');assert.deepEqual(a.takeEvents(),[]);
 for(let i=0;i<4;i++)a.accept(sample(240),2000+i*200);
 assert.equal(a.current.condition,'Bright');assert.equal(a.current.motion,false);
 assert.equal(a.takeEvents()[0][0],'lighting-changed');
});
test('movement confirms, holds, ends, repeats and baselines after a stale gap',()=>{
 const a=new FrameAnalyzer(settings);a.accept(sample(100),1000);
 const patch=sample(100);patch.fill(230,0,160);
 a.accept(patch,1200);a.accept(sample(100),1400);
 assert.equal(a.current.motion,true);assert.equal(a.takeEvents()[0][0],'motion-detected');
 for(let at=1600;at<=5600;at+=200)a.accept(sample(100),at);
 assert.equal(a.current.motion,false);assert.ok(a.takeEvents().some(e=>e[0]==='motion-ended'));
 a.accept(patch,5800);a.accept(sample(100),6000);assert.ok(a.takeEvents().some(e=>e[0]==='motion-detected'));
 a.accept(patch,12000);assert.equal(a.current.motion,false);assert.deepEqual(a.takeEvents(),[]);
});
test('lighting hysteresis prevents boundary flicker and zero remains a real reading',()=>{
 const a=new FrameAnalyzer(settings);for(let i=0;i<4;i++)a.accept(sample(0),1000+i*200);
 assert.equal(a.current.brightness,0);assert.equal(a.current.condition,'Dark');
 for(let i=0;i<6;i++)a.accept(sample(54),2000+i*200);
 assert.equal(a.current.condition,'Dark');assert.deepEqual(a.takeEvents(),[]);
 assert.throws(()=>a.accept(sample(1).slice(1),5000),/sample/);
});

async function fixture(t){
 const base=new URL('./.tmp/',import.meta.url);await fs.mkdir(base,{recursive:true});
 const root=await fs.mkdtemp(path.join(fileURLToPath(base),'webcam-'));
 const folder=path.join(root,'plugins/webcam');await fs.mkdir(path.join(folder,'server'),{recursive:true});
 await fs.writeFile(path.join(folder,'declaration.json'),JSON.stringify(declaration));
 await fs.cp(new URL('../plugins/webcam/cards/',import.meta.url),path.join(folder,'cards'),{recursive:true});
 await fs.writeFile(path.join(folder,'server/index.mjs'),`let live=false;export default {
 validateConfiguration(){return true},async start(){live=true},async stop(){live=false},async suspend(){live=false},
 async preview(){return live?{at:Date.now(),jpeg:'/9j/2Q=='}:null},
 async execute(id,p,c){if(id==='refresh')live=true;await c.saveState({brightness:0,motion:false,condition:'Dark','captured-at':Date.now(),status:'Live'});return {ok:true}}
 };`);
 const app=await createLocalserve(root,{automatic:false});
 t.after(async()=>{await app.close();assert.ok(path.resolve(root).startsWith(path.resolve(fileURLToPath(base))+path.sep));await fs.rm(root,{recursive:true,force:true});});
 const call=async(route,values)=>{const response=await fetch(app.origin+route,values===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',Origin:app.origin,'X-Localserve-Token':app.snapshot().token},body:JSON.stringify(values)});return response;};
 const enable=async(value)=>{const service=app.registry.services()[0];return call('/api/plugins/webcam/config',{revision:service.config.revision,enabled:value});};
 return {app,call,enable};
}
test('frame endpoint is disabled by default, scoped, paused, suspended and cleared on disable',async t=>{
 const f=await fixture(t);assert.equal(f.app.registry.services()[0].enabled,false);
 assert.equal((await f.call('/api/plugin-preview/webcam/frame.jpg')).status,409);
 assert.equal((await f.enable(true)).status,200);
 let frame=await f.call('/api/plugin-preview/webcam/frame.jpg?v=1');assert.equal(frame.status,200);
 assert.equal(frame.headers.get('content-type'),'image/jpeg');assert.equal(frame.headers.get('cache-control'),'no-store');
 assert.equal((await frame.arrayBuffer()).byteLength,4);
 assert.equal((await f.call('/api/plugin-preview/webcam/frame.jpg?path=private')).status,400);
 assert.equal((await f.call('/api/plugin-preview/unknown/frame.jpg')).status,404);
 await f.app.engine.setPaused(true);assert.equal((await f.call('/api/plugin-preview/webcam/frame.jpg')).status,503);
 await f.app.engine.setPaused(false);assert.equal((await f.call('/api/plugin-preview/webcam/frame.jpg')).status,503);
 await f.call('/api/plugins/webcam/actions/refresh',{parameters:{}});
 assert.equal((await f.call('/api/plugin-preview/webcam/frame.jpg')).status,200);
 await f.enable(false);assert.notEqual((await f.call('/api/plugin-preview/webcam/frame.jpg')).status,200);
});
test('ready-made frame is inert and advertises only its own fixed same-origin preview',async t=>{
 const f=await fixture(t);const metadata=f.app.registry.services()[0].cardData.readyMade;
 assert.equal(metadata.templates[0].previewUrl,'/api/plugin-preview/webcam/frame.jpg');
 const response=await f.call(metadata.templates[0].url);assert.equal(response.status,200);
 assert.match(response.headers.get('content-security-policy'),/script-src 'none'/);
 assert.match(await response.text(),/data-card-preview/);
});
test('an in-flight frame cannot survive a pause and resume of the capture session',async t=>{
 const f=await fixture(t);await f.enable(true);
 const record=f.app.registry.get('webcam'),runtime=record.runtime,original=runtime.request.bind(runtime);
 let release,entered;const waiting=new Promise(resolve=>entered=resolve);
 runtime.request=(operation,...args)=>operation==='preview'?new Promise(resolve=>{release=resolve;entered();}):original(operation,...args);
 const result=f.app.registry.previewFrame('webcam').then(()=>null,error=>error);
 await waiting;await f.app.engine.setPaused(true);await f.app.engine.setPaused(false);
 release({at:Date.now(),jpeg:'/9j/2Q=='});
 assert.match((await result).message,/changed/);
});
test('movement occurrences can repeat while brightness comparisons retain true-edge behavior',async t=>{
 const f=await fixture(t);await f.enable(true);
 for(const [eventId,field,operator,value]of [['motion-detected','motion','eq',true],['readings','brightness','lt',20]]) {
  const response=await f.call('/api/tasks',{name:eventId,enabled:true,starts:[{id:'rule',name:'Camera',type:'event',enabled:true,
   eventId:'plugin:webcam:event:'+eventId,condition:{field,operator,value}}],steps:[{id:'log',type:'log',enabled:true,message:'Brightness {{event.brightness}}'}]});
  assert.equal(response.status,200,await response.text());
 }
 const emit=async(id,brightness,occurrence)=>{
  await f.app.engine.emitPluginEvent('webcam',id,{motion:true,brightness,'motion-percent':8,'captured-at':Date.now(),
   ...(occurrence?{'occurrence-id':occurrence}:{condition:'Dark'})});
  const until=Date.now()+2000;while(f.app.engine.active.size||f.app.engine.pending.size){if(Date.now()>until)throw Error('Task did not finish');await new Promise(resolve=>setTimeout(resolve,5));}
 };
 await emit('motion-detected',10,'one');await emit('motion-detected',10,'one');await emit('motion-detected',10,'two');
 await emit('readings',10);await emit('readings',10);await emit('readings',30);await emit('readings',10);
 const runs=f.app.state.snapshot().runs;
 assert.equal(runs.filter(run=>run.name==='motion-detected').length,2);
 assert.equal(runs.filter(run=>run.name==='readings').length,2);
 assert.ok(runs.every(run=>run.status==='completed'));
});
test('owned capture rejects malformed packets and clears fresh pixels on stop',async()=>{
 let child,commands='';
 const launch=(file,args,options)=>{
  assert.ok(file.endsWith('Capture.exe'));assert.equal(options.shell,false);assert.deepEqual(args,['0','640','360','5','70']);
  child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  child.stdin.on('data',data=>commands+=data.toString());child.stdin.on('finish',()=>queueMicrotask(()=>child.emit('close',0)));
  child.kill=()=>{throw Error('Cooperative stop should be sufficient.');};return child;
 };
 let time=1000;const c=new CameraCapture(settings,{launch,now:()=>time});
 const packet={sequence:1,width:64,height:48,jpeg:'/9j/2Q==',grey:Buffer.from(sample(100)).toString('base64')};
 child.stdout.write(JSON.stringify(packet)+'\n');assert.equal(c.preview().at,1000);
 time=4000;assert.equal(c.preview(),null);
 child.stdout.write('{broken}\n');await c.close();
 assert.equal(c.preview(),null);assert.match(commands,/ping\nstop\n/);assert.match(c.error.message,/invalid/);
});
function previewFixture(code) {
 const timers=new Map();let timerId=0,attached=true;
 const parent={children:[],insertBefore(node,next){const i=this.children.indexOf(next);this.children.splice(i<0?this.children.length:i,0,node);node.parentNode=this;},
  removeChild(node){this.children.splice(this.children.indexOf(node),1);node.parentNode=null;}};
 function picture(){return {style:{visibility:'hidden'},parentNode:parent,complete:false,naturalWidth:0,
  set onload(value){if(typeof value==='function')throw Error('Sandbox blocks child load handlers');},get onload(){return null;},
  set onerror(value){if(typeof value==='function')throw Error('Sandbox blocks child error handlers');},
  get src(){return this._src;},set src(value){this._src=value;this.complete=false;this.naturalWidth=0;},
  cloneNode(){return picture();},removeAttribute(name){if(name==='src'){delete this._src;this.complete=false;this.naturalWidth=0;}},
  get nextSibling(){return parent.children[parent.children.indexOf(this)+1]||null;}};}
 const image=picture();parent.children.push(image);
 const doc={querySelector:()=>image},frame={contentDocument:doc,getClientRects:()=>[1],style:{opacity:'0.5'}};
 const document={hidden:false,documentElement:{contains:()=>attached}};
 const context={window:{},document,setTimeout:(callback,ms)=>{const id=++timerId;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(code,context);
 return {preview:context.window.LocalserveCardPreview,image,parent,doc,frame,document,timers,
  ready(image){image.complete=true;image.naturalWidth=640;this.run(40);},detach(){attached=false;},run(ms){const item=[...timers].find(([,t])=>t.ms===ms);assert.ok(item,'Expected timer '+ms);timers.delete(item[0]);item[1].callback();}};
}
test('ES5 preview buffers decoded frames during fades without child image event handlers',async()=>{
 const code=await fs.readFile(new URL('../assets/card-preview.js',import.meta.url),'utf8');assert.doesNotMatch(code,/\b(?:const|let)\b|=>|\?\./);
 const f=previewFixture(code),url='/api/plugin-preview/webcam/frame.jpg';
 f.preview.attach(f.frame,'https://external.invalid/image',true);assert.equal(f.image.src,undefined);
 f.preview.attach(f.frame,url,true);assert.equal(f.parent.children.length,2);
 assert.match(f.image.src,/^\/api\/plugin-preview\/webcam\/frame\.jpg\?v=\d+$/);
 f.ready(f.image);const first=f.image.src;assert.equal(f.image.style.visibility,'visible');
 f.run(200);const back=f.parent.children[1];assert.ok(back.src);assert.equal(back.style.visibility,'hidden');
 assert.equal(f.image.src,first,'Displayed JPEG must not be overwritten by a pending request');assert.equal(f.image.style.visibility,'visible');
 const state=f.frame._preview;f.preview.attach(f.frame,url,true);assert.equal(f.frame._preview,state,'Poll hydration retains buffers');
 f.ready(back);assert.equal(back.style.visibility,'visible');assert.equal(f.image.style.visibility,'hidden');
 f.run(200);assert.equal(back.style.visibility,'visible');assert.equal(f.image.style.visibility,'hidden');
 f.ready(f.image);assert.equal(f.image.style.visibility,'visible');assert.equal(back.style.visibility,'hidden');
 assert.equal(f.frame.style.opacity,'0.5','Streaming must not modify collection animation');
 f.frame._preview.stop();assert.equal(f.parent.children.length,1);assert.equal(f.timers.size,0);assert.equal(f.image.src,undefined);
});
test('preview clears failed, hidden and retired buffers and resumes without leaked callbacks',async()=>{
 const code=await fs.readFile(new URL('../assets/card-preview.js',import.meta.url),'utf8'),f=previewFixture(code),url='/api/plugin-preview/webcam/frame.jpg';
 f.preview.attach(f.frame,url,true);f.ready(f.image);f.run(200);
 const back=f.parent.children[1],late=[...f.timers.values()].find(t=>t.ms===40).callback;f.run(2500);
 assert.ok(f.parent.children.every(image=>image.style.visibility==='hidden'&&image.src===undefined));
 late();assert.ok(f.parent.children.every(image=>image.style.visibility==='hidden'));
 f.run(1000);f.ready(f.image);f.run(200);late();
 assert.equal(back.style.visibility,'hidden','An old load callback cannot publish a reused buffer');
 f.ready(back);f.document.hidden=true;f.run(200);
 assert.equal(f.image.src,undefined);f.document.hidden=false;f.run(500);f.ready(f.image);
 f.preview.attach(f.frame,url,false);assert.equal(f.parent.children.length,1);assert.equal(f.image.src,undefined);
 f.preview.attach(f.frame,url,true);assert.ok(f.image.src);f.ready(f.image);f.detach();f.run(200);
 assert.equal(f.timers.size,0);assert.equal(f.image.onload,null);assert.equal(f.parent.children.length,1);
});

test('Windows capture self-test emits a bounded JPEG and grayscale sample without a camera',async()=>{
 if(process.platform!=='win32')return;
 const {stdout}=await promisify(execFile)(fileURLToPath(new URL('../plugins/webcam/native/Capture.exe',import.meta.url)),['--self-test'],{windowsHide:true,maxBuffer:100000});
 const value=JSON.parse(stdout);assert.equal(value.width,64);assert.equal(Buffer.from(value.grey,'base64').length,768);
 const jpeg=Buffer.from(value.jpeg,'base64');assert.equal(jpeg[0],255);assert.equal(jpeg[1],216);assert.equal(jpeg.at(-1),217);
});
