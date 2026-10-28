/** Map routes run against disposable stores and synthetic plugin workers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {randomUUID,createHash} from 'node:crypto';
import {selectorFixture} from './fixtures/scene-selector.mjs';
import {pngCrc,canonicalMapPng,mapImageLimit} from '../server/home-map-image.mjs';
import {homeMapView,homeMapCatalogue} from '../server/home-map-view.mjs';

function chunk(type,bytes) {
  const result=Buffer.alloc(bytes.length+12);result.writeUInt32BE(bytes.length);result.write(type,4);bytes.copy(result,8);result.writeUInt32BE(pngCrc(result.subarray(4,-4)),result.length-4);return result;
}
function png({width=2,height=2,filter=0,colour=6,extra=null}={}) {
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=colour;
  const row=Buffer.alloc(width*4+1);row[0]=filter;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(extra?[extra]:[]),chunk('IDAT',deflateSync(Buffer.concat(Array.from({length:height},()=>row)))),chunk('IEND',Buffer.alloc(0))]);
}
async function fixture(t){const f=await selectorFixture({cardTemplates:true});t.after(()=>f.close());
  const state=await fetch(f.app.origin+'/api/state').then(r=>r.json());
  return {...f,token:state.token,
    get:url=>fetch(f.app.origin+url),
    post:(url,body,headers={})=>fetch(f.app.origin+url,{method:'POST',headers:{Origin:f.app.origin,'Content-Type':'application/json','X-Localserve-Token':state.token,...headers},body:JSON.stringify(body)}),
    upload:(bytes,revision=1,headers={})=>fetch(f.app.origin+'/api/home-map/upload',{method:'POST',headers:{Origin:f.app.origin,'Content-Type':'image/png','X-Localserve-Token':state.token,'X-Home-Map-Revision':String(revision),...headers},body:bytes}),
  };
}
const marker=target=>({id:'marker-one',name:'My marker',icon:'lightbulb',enabled:true,x:22.5,y:75,target});

test('PNG normalization verifies chunks, scanline filters, dimensions and bounded pixel inflation',()=>{
  const bytes=png(),normal=canonicalMapPng(bytes);assert.equal(normal.width,2);assert.equal(normal.height,2);
  assert.deepEqual(canonicalMapPng(normal.bytes).bytes,normal.bytes);
  for(const value of [bytes.subarray(0,-1),Buffer.concat([bytes,Buffer.from('junk')]),Buffer.from('<svg></svg>'),png({filter:5}),png({colour:3}),png({extra:chunk('acTL',Buffer.alloc(8))})])assert.throws(()=>canonicalMapPng(value));
  const corrupt=Buffer.from(bytes);corrupt[40]^=1;assert.throws(()=>canonicalMapPng(corrupt));
  const metadata=png({extra:chunk('tEXt',Buffer.from('private name and address'))});assert.ok(!canonicalMapPng(metadata).bytes.includes(Buffer.from('private name')));
  const excessive=Buffer.from(bytes);excessive.writeUInt32BE(8193,16);excessive.writeUInt32BE(pngCrc(excessive.subarray(12,29)),29);assert.throws(()=>canonicalMapPng(excessive));
});

test('unshared maps reveal no plan or markers; uploads need exact origin/token and remain private until saved',async t=>{
  const f=await fixture(t),map=f.app.homeMap;
  assert.deepEqual((await f.get('/api/home-map').then(r=>r.json())).markers,[]);
  assert.equal((await f.upload(png(),1,{'X-Localserve-Token':'bad'})).status,403);
  assert.equal((await f.upload(png(),1,{Origin:'http://example.com'})).status,403);
  assert.equal((await f.upload(png(),1,{'Content-Type':'image/jpeg'})).status,415);
  assert.equal((await f.upload(png(),2)).status,409);
  const before=map.admin(),reply=await f.upload(png());assert.equal(reply.status,200);const image=await reply.json();
  assert.deepEqual(map.admin(),before);assert.equal(image.id,createHash('sha256').update(canonicalMapPng(png()).bytes).digest('hex')+'.png');
  assert.equal((await f.get('/api/home-map/image/'+image.id)).status,404);
  const privateImage=await fetch(f.app.origin+'/api/home-map/image/'+image.id,{headers:{'X-Localserve-Token':f.token}});assert.equal(privateImage.status,200);
  assert.equal((await f.get('/data/home-map/images/'+image.id)).status,404);
  assert.equal((await f.post('/api/home-map/settings',{...before,image})).status,200);
  assert.equal((await f.get('/api/home-map').then(r=>r.json())).image,null);
  assert.equal((await f.get('/api/home-map/image/'+image.id)).status,404);
  assert.equal((await f.post('/api/home-map/settings',{...map.admin(),enabled:true})).status,200);
  const publicImage=await f.get('/api/home-map/image/'+image.id);assert.equal(publicImage.status,200);assert.equal(publicImage.headers.get('cache-control'),'no-store');
  assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()),canonicalMapPng(png()).bytes);
  assert.equal((await f.get('/api/home-map/image/'+image.id+'?other=1')).status,405);
});

test('map saves reject orphan metadata and stale revisions; cancelling an image draft keeps the previous floor plan',async t=>{
  const f=await fixture(t),map=f.app.homeMap,first=await f.upload(png()).then(r=>r.json());
  assert.equal((await f.post('/api/home-map/settings',{...map.admin(),image:{...first,id:'f'.repeat(64)+'.png'}})).status,409);
  const before=map.admin();await f.post('/api/home-map/settings',{...before,image:first,enabled:true});
  const second=await f.upload(png({width:3}),map.admin().revision).then(r=>r.json());
  assert.equal((await f.get('/api/home-map/image/'+second.id)).status,404);assert.equal(map.admin().image.id,first.id);
  assert.equal((await f.post('/api/home-map/settings',{...before,name:'stale'})).status,409);
  await f.post('/api/home-map/settings',{...map.admin(),enabled:false});assert.equal((await f.get('/api/home-map/image/'+first.id)).status,404);
});

test('map catalogue and viewer intersect current publication; reads never execute saved scenes or Tasks',async t=>{
  const f=await fixture(t),catalogue=await f.get('/api/home-map/catalogue').then(r=>r.json());
  assert.ok(catalogue.some(item=>item.target.kind==='scene'));assert.ok(catalogue.some(item=>item.target.kind==='task'));assert.ok(catalogue.some(item=>item.target.kind==='card'));
  assert.doesNotMatch(JSON.stringify(catalogue),/token|parameters|steps|security-code/);
  const scene=catalogue.find(item=>item.target.kind==='scene'),task=catalogue.find(item=>item.target.kind==='task');
  await f.app.homeMap.save({...f.app.homeMap.admin(),enabled:true,markers:[marker(scene.target),{...marker(task.target),id:'task-marker'}, {...marker(scene.target),id:'disabled-marker',enabled:false}]});
  const before=f.app.controls.runs.snapshot(),view=await f.get('/api/home-map').then(r=>r.json());
  assert.equal(view.markers.length,2);assert.ok(view.markers[0].action.token);assert.equal(view.markers[0].action.type,'scene');assert.equal(view.markers[1].action.type,'task');
  assert.deepEqual(f.app.controls.runs.snapshot(),before);
  await f.app.phoneHome.save({revision:f.app.phoneHome.admin().revision,tasks:[]});
  const page=f.app.controls.pages('tradfri')[0];await f.app.controls.save('tradfri',{revision:page.revision,enabled:false},page.id,'enabled');
  const removed=await f.get('/api/home-map').then(r=>r.json());assert.ok(removed.markers.every(item=>!item.available&&!item.action));
  assert.equal(f.app.homeMap.admin().markers.length,3);
  assert.equal((await f.get('/api/home-map?x=1')).status,405);
});

test('map Task activation uses existing one-request receipt identity and pause admission',async t=>{
  const f=await fixture(t),entry=(await f.get('/api/home-map/catalogue').then(r=>r.json())).find(item=>item.target.kind==='task');
  await f.app.homeMap.save({...f.app.homeMap.admin(),enabled:true,markers:[marker(entry.target)]});
  const value=await f.get('/api/home-map').then(r=>r.json()),action=value.markers[0].action,requestId=randomUUID();
  const body={taskId:action.taskId,revision:action.revision,homeRevision:action.homeRevision,expires:action.expires,requestId};
  assert.equal((await f.post('/api/phone-home/run',body,{'X-Localserve-Home-Token':action.token})).status,202);
  assert.equal((await f.post('/api/phone-home/run',body,{'X-Localserve-Home-Token':action.token})).status,202);
  assert.equal(f.app.phoneHome.claims.snapshot().filter(item=>item.id===requestId).length,1);
  f.app.engine.gate.setPaused(true);const paused=await f.get('/api/home-map').then(r=>r.json());assert.equal(paused.markers[0].available,false);
});

test('public projection whitelists target properties and respects separate display settings',()=>{
  const target={kind:'light',pluginId:'tradfri',slug:'lights',lightId:'1'},map={name:'Home',revision:1,enabled:true,image:null,markers:[marker(target)]};
  const view={paused:false,options:{theme:'light',fontScale:90},scenes:[],tasks:[],cards:[],remotes:[],lighting:[{pluginId:'tradfri',slug:'lights',name:'Lights',available:true,busy:false,stale:false,revision:2,token:'capability',lights:[{id:'1',name:'Desk',on:true,brightness:40,controls:{power:'remote-power'},private:'never'}],groups:[],items:[{id:'remote-power',available:true,reported:true,parameters:'never'}]}]};
  let result=homeMapView(map,view);assert.equal(result.markers[0].on,true);assert.equal(result.options.theme,'light');assert.doesNotMatch(JSON.stringify(result),/private|parameters|never/);
  assert.equal(homeMapCatalogue(view)[0].action,undefined);
  view.lighting[0].stale=true;view.lighting[0].available=false;result=homeMapView(map,view);assert.equal(result.markers[0].on,null);assert.equal(result.markers[0].available,false);
  result=homeMapView({...map,enabled:false},view);assert.equal(result.markers.length,0);assert.equal(result.image,null);
});

test('map documents and scripts use local assets, scoped data and retained marker nodes',async t=>{
  const f=await fixture(t),response=await f.get('/home-map');assert.equal(response.status,200);const html=await response.text();
  assert.match(response.headers.get('Content-Security-Policy'),/frame-src 'self'/);
  for(const name of ['home-map.css','home-map.js','home-map-ui.js'])assert.equal((await f.get('/'+name)).status,200);
  assert.equal((await f.get('/map-editor')).status,200);
  const script=await fs.readFile(path.join(f.root,'web/home-map.js'),'utf8');assert.doesNotMatch(script,/api\/state|api\/admin-state|X-Localserve-Token/);assert.match(script,/new Map\(/);assert.match(script,/pending=item/);assert.match(script,/document\.hidden/);
  assert.match(html,/map-zoom-in/);assert.match(script,/ColorThemes\.apply\(document/);
});
