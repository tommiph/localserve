/** Injected aircraft responses and disposable plugin roots only. No provider
 * traffic, installed settings or existing Cards/Tasks/Vistas are changed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coordinates, configuration, parseAircraft, distanceNm } from '../plugins/adsb-lol/server/aircraft.mjs';
import { createAdsbAdapter } from '../plugins/adsb-lol/server/index.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { validateCard, projectCardData, selectedCardData, cardCatalog } from '../server/cards.mjs';
import { createLocalserve } from '../server.mjs';

const raw = JSON.parse(await fs.readFile(new URL('../plugins/adsb-lol/declaration.json',import.meta.url)));
const area = { id:'nearby',name:'Nearby',coordinates:'0,0',radius:25,'position-age':60,enabled:true };
const settings = { areas:[area],'poll-minutes':2 };
const target = configuration(settings).areas[0];
const aircraft = (hex = 'abc123',patch = {}) => ({hex,flight:' FIN123 ',r:'OH-ABC',t:'A320',lat:0,lon:0.1,seen_pos:2,alt_baro:10000,gs:250,track:90,...patch});
const payload = rows => ({ac:rows,msg:'No error',now:1792000000,total:rows.length});
function host(seed = {},controller = new AbortController()) {
  let state = structuredClone(seed);
  const events = [], saves = [];
  return { get state(){return structuredClone(state);},events,saves,controller,context:{signal:controller.signal,
    readState:async()=>structuredClone(state),saveState:async value=>{controller.signal.throwIfAborted();state=structuredClone(value);saves.push(structuredClone(value));},
    log:async()=>{},emit:async(id,value)=>{controller.signal.throwIfAborted();events.push({id,value,state:structuredClone(state)});},
  } };
}

test('offline configuration fixes the request scope and validates numeric bounds', async () => {
  let requests = 0;
  const adapter = createAdsbAdapter({fetchImpl:async()=>{requests++;throw Error('Unexpected fetch');}});
  assert.equal(adapter.validateConfiguration(settings),true);
  await adapter.start(settings);await adapter.stop();assert.equal(requests,0);
  for (const value of ['', 'https://example.com','0,0/../x','91,0','0,181','0,Infinity']) assert.equal(coordinates(value),null);
  assert.deepEqual(coordinates(' -90, +180 '),{latitude:-90,longitude:180});
  for (const change of [{radius:0},{radius:251},{'position-age':0},{coordinates:'bad'}]) assert.equal(configuration({...settings,areas:[{...area,...change}]}),null);
  assert.equal(configuration({...settings,'poll-minutes':0}),null);
  assert.equal(configuration({...settings,areas:[]}),null);
  assert.equal(configuration({...settings,areas:Array(21).fill(area)}),null);
});

test('aircraft parser sorts calculated distances and keeps ground, unknowns and old positions honest', () => {
  const parsed = parseAircraft(payload([aircraft('abc001',{lon:0.2}),aircraft('abc002',{lon:0.01,alt_baro:'ground'}),
    aircraft('abc003',{seen_pos:61}),aircraft('abc004',{lat:undefined,lastPosition:{lat:0,lon:0.001,seen_pos:0}}),
    aircraft('abc005',{lon:1})]),target,1000);
  assert.equal(parsed.reading['aircraft-count'],2);assert.equal(parsed.reading['excluded-count'],3);
  assert.equal(parsed.reading['aircraft-1-hex'],'abc002');assert.equal(parsed.reading['aircraft-1-altitude-label'],'Ground');
  assert.equal(parsed.aircraft[0].altitude,null);assert.equal(parsed.aircraft[0].ground,true);
  assert.equal(parsed.reading['received-at'],1000);assert.equal(parsed.seen.length,5);
  assert.ok(Math.abs(distanceNm({latitude:0,longitude:0},{latitude:0,longitude:1})-60.04)<0.1);
  const unknown = parseAircraft(payload([aircraft('abc001',{alt_baro:null,gs:'',track:NaN,flight:null})]),target,1000);
  assert.equal(unknown.aircraft[0].ground,null);assert.equal(unknown.aircraft[0].speed,null);assert.equal(unknown.aircraft[0].track,null);
  assert.equal(unknown.reading['aircraft-1-callsign'],'abc001');
  assert.equal(parseAircraft(payload([aircraft('abc001',{squawk:'9999'})]),target,1000).aircraft[0].squawk,null);
  assert.equal(parseAircraft(payload([]),target,1000).reading['aircraft-count'],0);
  for (const bad of [{},payload([aircraft('bad')]),payload([aircraft(),aircraft()]),payload(Array(2001).fill(aircraft()))]) assert.throws(()=>parseAircraft(bad,target,1));
});

test('first reads baseline; later occurrence claims commit before events and persist across restart', async () => {
  let clock = 100000, response = payload([aircraft()]), requests = 0;
  const transport = async(url,options)=>{
    requests++;assert.equal(url,'https://api.adsb.lol/v2/point/0/0/25');assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,undefined);return Response.json(response);
  };
  const adapter = createAdsbAdapter({fetchImpl:transport,now:()=>clock}), h=host();await adapter.start(settings);
  await adapter.execute('refresh',{},h.context);
  assert.deepEqual(h.events.map(event=>event.id),['reading-updated']);
  await assert.rejects(adapter.execute('refresh',{},h.context),/cooling/);assert.equal(requests,1);
  clock+=3000;response=payload([aircraft(),aircraft('def456',{alt_baro:null,gs:null,track:null,flight:' TESLA1 '})]);
  await adapter.execute('refresh',{},h.context);
  const detection=h.events.find(event=>event.id==='aircraft-detected');
  assert.equal(detection.value.callsign,'TESLA1');assert.equal(detection.value.altitude,undefined);assert.equal(detection.value.ground,undefined);
  assert.ok(detection.state.areas.nearby.seen.includes('def456'));assert.equal(detection.state.sequence,1);
  assert.equal(detection.value['occurrence-id'],'nearby-1');
  const resumed=createAdsbAdapter({fetchImpl:transport,now:()=>clock+6000}), resumedHost=host(h.state);await resumed.start(settings);
  await resumed.execute('refresh',{},resumedHost.context);assert.ok(!resumedHost.events.some(event=>event.id==='aircraft-detected'));
  clock+=6000;response=payload([]);await adapter.execute('refresh',{},h.context);
  clock+=3000;response=payload([aircraft('def456')]);await adapter.execute('refresh',{},h.context);
  assert.equal(h.events.filter(event=>event.id==='aircraft-detected').length,2);
});

test('failed reads retain successes/claims, back off without retry, and rate limits block other areas', async () => {
  let clock=100000, mode='ok', requests=0;
  const adapter=createAdsbAdapter({now:()=>clock,fetchImpl:async()=>{
    requests++;return mode==='ok'?Response.json(payload([aircraft()])):new Response('provider private body',{status:429,headers:{'Retry-After':'999999999'}});
  }}),h=host();await adapter.start(settings);await adapter.execute('refresh',{},h.context);
  const successful=h.state.areas.nearby;h.events.length=0;clock+=3000;mode='bad';
  await assert.rejects(adapter.execute('refresh',{},h.context),/failed/);
  assert.equal(h.state.areas.nearby['received-at'],successful['received-at']);assert.deepEqual(h.state.areas.nearby.seen,successful.seen);
  assert.equal(h.events.length,0);assert.equal(requests,2);assert.ok(h.state.blockedUntil<=clock+86400000);
  assert.doesNotMatch(JSON.stringify(h.state),/provider private body/);
  clock+=3000;await adapter.start({...settings,areas:[...settings.areas,{...area,id:'other',name:'Other'}]});
  await assert.rejects(adapter.execute('refresh',{'area-id':'other'},h.context),/cooling/);assert.equal(requests,2);
  // A replacement area cannot inherit the old reading during its cooldown.
  await adapter.start({...settings,areas:[{...area,radius:10}]});
  await assert.rejects(adapter.execute('refresh',{},h.context),/cooling/);assert.equal(h.state.areas.nearby['received-at'],undefined);
});

test('malformed/oversized responses and cancellation never produce late readings or events', async () => {
  for (const make of [()=>new Response('{bad'),()=>Response.json({ac:[]}),()=>new Response('x'.repeat(1048577)),()=>new Response('redirect',{status:302})]) {
    let requests=0;const adapter=createAdsbAdapter({fetchImpl:async()=>{requests++;return make();}}),h=host();await adapter.start(settings);
    await assert.rejects(adapter.execute('refresh',{},h.context));assert.equal(requests,1);assert.equal(h.events.length,0);assert.equal(h.state.areas.nearby['received-at'],undefined);
  }
  const controller=new AbortController(),h=host({},controller);
  const adapter=createAdsbAdapter({fetchImpl:async()=>{controller.abort(Error('cancelled'));return Response.json(payload([aircraft()]));}});await adapter.start(settings);
  await assert.rejects(adapter.execute('refresh',{},h.context),/cancelled/);assert.equal(h.events.length,0);assert.equal(h.saves.length,1);
});

test('new observations are bounded to ten events without replaying skipped identities', async () => {
  let clock=100000,rows=[],h=host();const adapter=createAdsbAdapter({now:()=>clock,fetchImpl:async()=>Response.json(payload(rows))});await adapter.start(settings);
  await adapter.execute('refresh',{},h.context);clock+=3000;
  rows=Array.from({length:30},(_,i)=>aircraft((i+1).toString(16).padStart(6,'0')));
  await adapter.execute('refresh',{},h.context);assert.equal(h.events.filter(event=>event.id==='aircraft-detected').length,10);
  assert.equal(h.state.areas.nearby.seen.length,30);assert.equal(h.state.areas.nearby['row-count'],10);
  clock+=3000;h.events.length=0;await adapter.execute('refresh',{},h.context);assert.deepEqual(h.events.map(event=>event.id),['reading-updated']);
});

test('damaged occurrence claims are retained without network requests or sequence reset', async () => {
  for (const seed of [{sequence:-1}, {areas:{nearby:{identity:'0,0/25/60',seen:['invalid']}}}]) {
    let requests=0;const adapter=createAdsbAdapter({fetchImpl:async()=>{requests++;return Response.json(payload([]));}}),h=host(seed);
    await adapter.start(settings);await assert.rejects(adapter.execute('refresh',{},h.context),/original state retained/);
    assert.equal(requests,0);assert.equal(h.saves.length,0);assert.deepEqual(h.state,seed);
  }
});

test('named-area Cards project selected typed rows only; Airspace assets are contained and inert', async () => {
  const plugin=validateDeclaration(raw),reading=parseAircraft(payload([aircraft()]),target,100000).reading;
  const record={health:'ready',configured:true,config:{snapshot:()=>({enabled:true,settings})},log:{latest:()=>[]},state:{snapshot:()=>({areas:{nearby:{...reading,seen:['PRIVATE-CLAIM'],identity:'PRIVATE-IDENTITY'},other:{secret:'OTHER-AREA'}}})}};
  const data=projectCardData(plugin,record),catalog=cardCatalog(plugin,settings);
  const card=validateCard({schemaVersion:1,layout:'readymade',templateId:'airspace',sourceId:'nearby',enabled:false},plugin,null,settings);
  const projected=selectedCardData(card,data,catalog);
  assert.doesNotMatch(JSON.stringify(projected),/PRIVATE-CLAIM|PRIVATE-IDENTITY|OTHER-AREA|seen_pos|api\.adsb/);
  const table=projected.data.values['nearby:aircraft'];assert.equal(table.value.length,1);assert.equal(Object.keys(table.value[0]).length,5);
  for (const asset of plugin.cardTemplates[0].assets) {
    const source=await fs.readFile(new URL(`../plugins/adsb-lol/cards/airspace/${asset}`,import.meta.url),'utf8');
    assert.doesNotMatch(source,/<script\b|<iframe\b|on(?:click|load|error)=|url\(["']?https?:|<image[^>]+https?:/i);
  }
});

test('actual shared runtime discovers disabled plugin and persists named readings with private API boundaries', async t => {
  const base=fileURLToPath(new URL('./.tmp/',import.meta.url));await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'adsb-')),folder=path.join(root,'plugins/adsb-lol');
  await fs.cp(new URL('../plugins/adsb-lol/',import.meta.url),folder,{recursive:true,filter:file=>!file.split(path.sep).includes('data')});
  await fs.writeFile(path.join(folder,'server/test-response.json'),JSON.stringify(payload([aircraft()])));
  await fs.writeFile(path.join(folder,'server/test-entry.mjs'),`import fs from 'node:fs/promises';import {createAdsbAdapter} from './index.mjs';export default createAdsbAdapter({fetchImpl:async()=>Response.json(JSON.parse(await fs.readFile(new URL('./test-response.json',import.meta.url))))});`);
  const declaration=structuredClone(raw);declaration.runtime.entry='server/test-entry.mjs';await fs.writeFile(path.join(folder,'declaration.json'),JSON.stringify(declaration));
  let app=await createLocalserve(root,{automatic:false});
  t.after(async()=>{await app.close();assert.ok(path.resolve(root).startsWith(path.resolve(base)+path.sep));await fs.rm(root,{recursive:true,force:true});});
  assert.equal(app.registry.services()[0].enabled,false);assert.equal(app.registry.services()[0].configurationReady,false);
  await app.registry.saveConfiguration('adsb-lol',{revision:1,enabled:true,settings});
  await app.registry.execute('adsb-lol','refresh',{});
  assert.equal(app.registry.services()[0].cardData.values['nearby:aircraft-count'].value,1);
  const asset=await fetch(app.origin+'/plugin-card-assets/adsb-lol/airspace/card.html');
  assert.equal(asset.status,200);assert.match(asset.headers.get('content-security-policy'),/script-src 'none'/);
  const html=await asset.text();
  assert.match(html,/class="hero-value"/);
  assert.match(html,/data-card-cell="traffic:0:altitude-label"/);
  assert.doesNotMatch(html,/data-card-table|class="sweep"/);
  assert.equal((await fetch(app.origin+'/plugin-card-assets/adsb-lol/airspace/../../data/config.json')).status,404);
  for (const file of ['/plugins/adsb-lol/data/config.json','/plugins/adsb-lol/server/index.mjs','/data/plugins/adsb-lol/state.json']) assert.equal((await fetch(app.origin+file)).status,404);
  const saved=app.registry.get('adsb-lol').state.snapshot();await app.close();app=await createLocalserve(root,{automatic:false});assert.deepEqual(app.registry.get('adsb-lol').state.snapshot(),saved);
});
