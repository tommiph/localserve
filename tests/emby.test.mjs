/** Synthetic sessions only. No installed Emby instance, credentials, playback
 * command or unrelated service is contacted by these tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { serverUrl, configuration, readSessions,readLibrary } from '../plugins/emby/server/client.mjs';
import {libraryOptions,normalizeLibrary} from '../plugins/emby/server/library.mjs';
import { parseSessions } from '../plugins/emby/server/sessions.mjs';
import { createEmbyAdapter } from '../plugins/emby/server/index.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { validateCard, projectCardData, selectedCardData, cardCatalog } from '../server/cards.mjs';
import { createLocalserve } from '../server.mjs';

const settings={'server-url':'http://10.23.42.8:8096','api-key':'PRIVATE_API_KEY_123456','poll-minutes':0.5};
const session=(patch={})=>({Id:'private-session',UserId:'PRIVATE-ACCOUNT',UserName:'Viewer',RemoteEndPoint:'PRIVATE-ADDRESS',DeviceName:'Living room',Client:'Emby TV',NowPlayingItem:{Id:'private-item',Name:'Tesla documentary',SeriesName:'Science',Type:'Movie',RunTimeTicks:6000000000,Path:'PRIVATE-PATH'},PlayState:{IsPaused:false,PositionTicks:3000000000,VolumeLevel:25,IsMuted:false},...patch});
const libraryMovie=(id='1',patch={})=>({Id:id,Name:'Movie '+id,Type:'Movie',ProductionYear:2024,Genres:['Science Fiction','Drama'],Overview:'A movie summary.',Path:'PRIVATE-PATH',UserData:{UserId:'PRIVATE-USER'},MediaSources:[{Path:'PRIVATE-STREAM'}],...patch});
function host(seed={}) {
  let state=structuredClone(seed);const events=[],saves=[],controller=new AbortController();
  return {events,saves,controller,get state(){return structuredClone(state);},context:{signal:controller.signal,readState:async()=>structuredClone(state),
    saveState:async value=>{controller.signal.throwIfAborted();state=structuredClone(value);saves.push(structuredClone(value));},log:async()=>{},emit:async(id,value)=>{controller.signal.throwIfAborted();events.push({id,value,state:structuredClone(state)});}}};
}

test('Emby validates one private target offline and rejects credentials, queries, public targets and custom paths',async()=>{
  for(const url of ['http://8.8.8.8:8096','http://emby.example:8096','http://user:pass@10.23.42.8:8096','http://10.23.42.8:8096/other','http://10.23.42.8:8096/?api_key=secret','file:///a','http://[::1]:8096']) assert.equal(serverUrl(url),null);
  assert.equal(serverUrl('http://127.0.0.1:8096/emby/'),'http://127.0.0.1:8096/emby/Sessions');
  assert.equal(configuration({...settings,'api-key':'bad'}),null);
  let reads=0;const adapter=createEmbyAdapter({read:async()=>{reads++;return [];}});assert.equal(adapter.validateConfiguration(settings),true);await adapter.start(settings);await adapter.stop();assert.equal(reads,0);
});

test('Emby projects reported sessions only, bounds lists, strips paths and distinguishes idle from unavailable',()=>{
  const parsed=parseSessions([session()],1000);assert.equal(parsed.reading['current-progress'],50);assert.equal(parsed.reading['current-position'],300);assert.equal(parsed.reading['playing-count'],1);
  assert.doesNotMatch(JSON.stringify(parsed),/PRIVATE-|private-session|private-item/);
  const unknown=parseSessions([session({PlayState:{}})],1000);assert.equal(unknown.reading['current-state'],'Unknown');assert.equal(unknown.reading['current-progress'],null);
  const missing=parseSessions([{Id:'one'}],1000);assert.equal(missing.reading['current-title'],null);assert.equal(missing.reading['current-state'],null);
  assert.equal(parseSessions([session({NowPlayingItem:null})],1000).reading['current-title'],'Not playing');assert.equal(parseSessions([],1000).reading['current-state'],'Idle');
  const many=parseSessions(Array.from({length:12},(_,i)=>session({Id:String(i)})),1000);assert.equal(many.reading['row-count'],10);assert.equal(many.reading['list-limited'],true);
  for(const data of [{Items:[]},[session(),session()],Array.from({length:101},(_,i)=>session({Id:String(i)}))]) assert.throws(()=>parseSessions(data,1000));
});

test('Emby claims playback changes before events and does not infer stopped from missing sessions/data',async()=>{
  let clock=100000,rows=[session()];const read=async()=>rows,adapter=createEmbyAdapter({read,now:()=>clock}),h=host();await adapter.start(settings);
  await adapter.execute('refresh',{},h.context);assert.deepEqual(h.events.map(row=>row.id),['reading-updated']);
  clock+=3000;rows=[session({PlayState:{IsPaused:true}})];await adapter.execute('refresh',{},h.context);
  const paused=h.events.find(row=>row.id==='playback-paused');assert.equal(paused.value.title,'Tesla documentary');assert.equal(paused.state.sessions[0].state,'Paused');assert.equal(paused.value.progress,undefined);
  clock+=3000;rows=[session()];await adapter.execute('refresh',{},h.context);assert.ok(h.events.some(row=>row.id==='playback-resumed'));
  clock+=3000;rows=[session({NowPlayingItem:{Id:'new',Name:'Other movie'}})];await adapter.execute('refresh',{},h.context);assert.ok(h.events.some(row=>row.id==='playback-started'));assert.equal(h.state['current-series'],null);
  clock+=3000;rows=[];await adapter.execute('refresh',{},h.context);assert.ok(!h.events.some(row=>row.id==='playback-stopped'));
  clock+=3000;rows=[session()];await adapter.execute('refresh',{},h.context);
  clock+=3000;rows=[session({NowPlayingItem:null})];await adapter.execute('refresh',{},h.context);assert.ok(h.events.some(row=>row.id==='playback-stopped'));
  const resumed=createEmbyAdapter({read,now:()=>clock+4000}),resumedHost=host(h.state);rows=[session()];await resumed.start(settings);await resumed.execute('refresh',{},resumedHost.context);assert.deepEqual(resumedHost.events.map(row=>row.id),['reading-updated']);
});

test('Emby retains successes on failures, backs off, clears replacement targets and rejects late cancellation',async()=>{
  let clock=100000,fail=false,reads=0;
  const read=async()=>{reads++;if(fail){const error=Error('PRIVATE body');error.status=401;throw error;}return [session()];};
  const adapter=createEmbyAdapter({read,now:()=>clock}),h=host();await adapter.start(settings);await adapter.execute('refresh',{},h.context);
  clock+=3000;fail=true;await assert.rejects(adapter.execute('refresh',{},h.context),/could not/);assert.equal(h.state['received-at'],100000);assert.equal(h.state['current-title'],'Tesla documentary');
  await assert.rejects(adapter.execute('refresh',{},h.context),/cooling/);assert.equal(reads,2);assert.doesNotMatch(JSON.stringify(h.state),/PRIVATE/);
  await adapter.start({...settings,'server-url':'http://10.23.42.9:8096'});await assert.rejects(adapter.execute('refresh',{},h.context));assert.equal(h.state['current-title'],undefined);
  const cancelled=host(),late=createEmbyAdapter({read:async()=>{cancelled.controller.abort(Error('cancelled'));return [session()];}});await late.start(settings);await assert.rejects(late.execute('refresh',{},cancelled.context),/cancelled/);assert.equal(cancelled.saves.length,1);assert.equal(cancelled.events.length,0);
});

test('Emby transport uses only GET Sessions and header token; rejects redirects, limits and invalid JSON',async()=>{
  for(const [status,body,ok] of [[200,JSON.stringify([session()]),true],[302,'redirect',false],[401,'private',false],[200,'bad',false],[200,'x'.repeat(524289),false]]) {
    const request=(url,options,callback)=>{
      assert.equal(url.href,'http://10.23.42.8:8096/emby/Sessions');assert.equal(url.search,'');assert.equal(options.method,'GET');assert.equal(options.headers['X-Emby-Token'],settings['api-key']);assert.equal(options.rejectUnauthorized,undefined);
      const req=new EventEmitter();req.end=()=>{const response=new EventEmitter();response.statusCode=status;response.headers={'content-type':'application/json'};response.destroy=()=>{};callback(response);queueMicrotask(()=>{response.emit('data',Buffer.from(body));response.emit('end');});};return req;
    };
    const promise=readSessions(configuration(settings),new AbortController().signal,{request});
    if(ok)assert.equal((await promise).length,1);else await assert.rejects(promise);
  }
});

test('Emby public Cards expose selected data, not credentials, private identities or unselected session columns',async()=>{
  const raw=JSON.parse(await fs.readFile(new URL('../plugins/emby/declaration.json',import.meta.url))),plugin=validateDeclaration(raw),parsed=parseSessions([session()],1000);
  const record={health:'ready',configured:true,config:{snapshot:()=>({enabled:true,settings})},log:{latest:()=>[]},state:{snapshot:()=>({...parsed.reading,sessions:parsed.sessions,credential:'PRIVATE-CREDENTIAL'})}};
  const card=validateCard({schemaVersion:1,layout:'readymade',templateId:'screening',sourceId:'plugin',enabled:false},plugin,null,settings);
  const selected=selectedCardData(card,projectCardData(plugin,record),cardCatalog(plugin,settings));assert.doesNotMatch(JSON.stringify(selected),/PRIVATE|private-session|private-item|192\.168|api-key|credential/);
  assert.equal(Object.keys(selected.data.values.sessions.value[0]).length,4);
});

test('Emby actual worker preserves shared Task Contains text comparisons and sandboxed Card assets',async t=>{
  const base=fileURLToPath(new URL('./.tmp/',import.meta.url));await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'emby-')),folder=path.join(root,'plugins/emby');
  await fs.cp(new URL('../plugins/emby/',import.meta.url),folder,{recursive:true,filter:file=>!file.split(path.sep).includes('data')});
  await fs.writeFile(path.join(folder,'server/test-response.json'),JSON.stringify([session()]));
  await fs.writeFile(path.join(folder,'server/test-entry.mjs'),`import fs from 'node:fs/promises';import {createEmbyAdapter} from './index.mjs';let clock=100000;const adapter=createEmbyAdapter({now:()=>clock,read:async()=>JSON.parse(await fs.readFile(new URL('./test-response.json',import.meta.url)))});export default {...adapter,execute(...args){clock+=3000;return adapter.execute(...args);}};`);
  const raw=JSON.parse(await fs.readFile(path.join(folder,'declaration.json')));raw.runtime.entry='server/test-entry.mjs';await fs.writeFile(path.join(folder,'declaration.json'),JSON.stringify(raw));
  const app=await createLocalserve(root,{automatic:false});t.after(async()=>{await app.close();assert.ok(path.resolve(root).startsWith(path.resolve(base)+path.sep));await fs.rm(root,{recursive:true,force:true});});
  assert.equal(app.registry.services()[0].enabled,false);assert.equal(app.registry.services()[0].configurationReady,false);
  // Reject an accidental application label plus key before committing settings
  // or activating polling; the saved configuration stays editable and unchanged.
  await assert.rejects(app.registry.saveConfiguration('emby',{revision:1,enabled:true,settings:{...settings,'api-key':'Localserve PRIVATE_API_KEY_123456'}}),/valid API key/);
  assert.equal(app.registry.services()[0].config.revision,1);
  assert.equal(app.registry.services()[0].enabled,false);
  await app.registry.saveConfiguration('emby',{revision:1,enabled:true,settings});
  const events=app.registry.events();assert.ok(events.some(row=>row.id==='plugin:emby:event:reading-updated'));
  const taskResponse=await fetch(app.origin+'/api/tasks',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.origin,'X-Localserve-Token':app.snapshot().token},body:JSON.stringify({name:'Emby playback',enabled:true,starts:[{id:'rule',name:'Playback',enabled:true,type:'event',eventId:'plugin:emby:event:playback-started',condition:{field:'title',operator:'contains',value:'TESLA'}}],steps:[{id:'log',type:'log',enabled:true,message:'Emby playback matched'}]})});
  assert.equal(taskResponse.status,200,await taskResponse.text());
  await app.registry.execute('emby','refresh',{});assert.equal(app.registry.services()[0].cardData.values['current-title'].value,'Tesla documentary');assert.equal(app.state.snapshot().runs.length,0);
  await fs.writeFile(path.join(folder,'server/test-response.json'),JSON.stringify([session({NowPlayingItem:{Id:'new-video',Name:'New Tesla documentary'}})]));
  await app.registry.execute('emby','refresh',{});
  const deadline=Date.now()+3000;
  while(app.state.snapshot().runs.length===0 || app.engine.active.size || app.engine.pending.size) {assert.ok(Date.now()<deadline,'Playback Task did not finish');await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(app.state.snapshot().runs.length,1);assert.equal(app.state.snapshot().runs[0].event.payload.title,'New Tesla documentary');
  const asset=await fetch(app.origin+'/plugin-card-assets/emby/screening/card.html');assert.equal(asset.status,200);assert.match(asset.headers.get('content-security-policy'),/script-src 'none'/);
  assert.equal((await fetch(app.origin+'/plugins/emby/data/config.json')).status,404);
});

test('library options and normalized metadata are bounded and omit paths, profiles and credentials',()=>{
 assert.equal(libraryOptions(settings).enabled,false);assert.equal(libraryOptions(settings).monitor,true);assert.equal(libraryOptions({...settings,'library-genres':'Comedy,Comedy'}),null);assert.equal(libraryOptions({...settings,'library-limit':1000}),null);
 const result=normalizeLibrary({Items:[libraryMovie('1'),libraryMovie('1'),libraryMovie('2',{Type:'Episode'}),libraryMovie('bad/id'),libraryMovie('3',{Name:'<b>Third</b>'})],TotalRecordCount:400},100);
 assert.equal(result.items.length,2);assert.equal(result.total,400);assert.equal(result.items[1].title,'Third');assert.doesNotMatch(JSON.stringify(result),/PRIVATE|UserData|MediaSources|Path/);
 assert.equal(normalizeLibrary({Items:[libraryMovie('date',{ProductionYear:undefined,PremiereDate:'2021-02-03T00:00:00Z'})]},100).items[0].year,2021);
 assert.throws(()=>normalizeLibrary({Items:Array(101).fill(libraryMovie())},100),/Invalid/);
});

test('library GET stays on the configured private target and never puts a token or user identity in its URL',async()=>{
 const request=(url,options,callback)=>{
  assert.equal(url.origin,'http://10.23.42.8:8096');assert.equal(url.pathname,'/emby/Items');assert.equal(url.searchParams.get('Limit'),'100');assert.equal(url.searchParams.get('IncludeItemTypes'),'Movie');assert.equal(url.searchParams.get('EnableUserData'),'false');assert.equal(url.searchParams.get('Fields'),'Overview,Genres,ProductionYear,PremiereDate');assert.ok(!url.href.includes(settings['api-key']));assert.equal(options.headers['X-Emby-Token'],settings['api-key']);assert.equal(options.method,'GET');
  const req=new EventEmitter();req.end=()=>{const response=new EventEmitter();response.statusCode=200;response.headers={'content-type':'application/json'};response.destroy=()=>{};callback(response);queueMicrotask(()=>{response.emit('data',Buffer.from('{"Items":[]}'));response.emit('end');});};return req;
 };
 assert.deepEqual(await readLibrary(configuration(settings),100,new AbortController().signal,{request}),{Items:[]});
});

test('library-only use makes no session reads or Events, caches metadata and projects daily genre choices',async()=>{
 let clock=100000,reads=0,sessions=0;const h=host(),adapter=createEmbyAdapter({now:()=>clock,read:async()=>{sessions++;return [];},readMovies:async()=>{reads++;return {Items:[libraryMovie('1'),libraryMovie('2',{Genres:['Comedy']}),libraryMovie('3'),libraryMovie('4'),libraryMovie('5')],TotalRecordCount:5};}});
 await adapter.start({...settings,'monitor-playback':false,'library-suggestions':true,'library-genres':'Science-Fiction'});assert.equal(reads,0);
 await adapter.execute('refresh',{},h.context);assert.equal(reads,1);assert.equal(sessions,0);assert.equal(h.events.length,0);assert.equal(h.state.libraryPicks.length,4);assert.ok(h.state.libraryPicks.every(movie=>movie.genres.includes('Science Fiction')));assert.doesNotMatch(JSON.stringify(h.state),/PRIVATE/);assert.ok(h.state.libraryPicks[0].url.startsWith('http://10.23.42.8:8096/web/index.html#!/item?id='));
 clock+=3000;await adapter.execute('refresh',{},h.context);const saves=h.saves.length;await adapter.execute('refresh',{},h.context);assert.equal(reads,1);assert.equal(h.saves.length,saves);
 await adapter.stop();await adapter.start({...settings,'monitor-playback':false,'library-suggestions':true,'library-genres':'Comedy'});await adapter.execute('refresh',{},h.context);assert.equal(reads,1);assert.equal(h.state.libraryPicks.length,1);assert.equal(h.state.libraryPicks[0].id,'2');
 clock+=86400000;await adapter.execute('refresh',{},h.context);assert.equal(reads,2);assert.equal(sessions,0);assert.equal(h.events.length,0);
});

test('library outages retain same-target picks, respect cooldown and clear replacement-target metadata',async()=>{
 let clock=100000,fail=false,reads=0;const h=host(),adapter=createEmbyAdapter({now:()=>clock,readMovies:async()=>{reads++;if(fail){const error=Error('PRIVATE');error.status=401;throw error;}return {Items:[libraryMovie()],TotalRecordCount:1};}});
 const config={...settings,'monitor-playback':false,'library-suggestions':true};await adapter.start(config);await adapter.execute('refresh-library',{},h.context);clock+=3000;fail=true;
 await assert.rejects(adapter.execute('refresh-library',{},h.context),/Cached metadata/);assert.equal(h.state.libraryPicks.length,1);assert.match(h.state['library-poll-status'],/Cached/);await adapter.execute('refresh',{},h.context);assert.equal(reads,2);
 await adapter.start({...config,'server-url':'http://10.23.42.9:8096'});await assert.rejects(adapter.execute('refresh-library',{},h.context));assert.equal(h.state.libraryPicks.length,0);assert.equal(h.state['library-received-at'],null);assert.equal(h.events.length,0);
 const corrupt=host({library:{items:'damaged'}});await assert.rejects(adapter.execute('refresh',{},corrupt.context),/original data retained/);assert.equal(corrupt.state.library.items,'damaged');
});

test('library failure cannot undo successful playback observations, and cancellation prevents late metadata writes',async()=>{
 const h=host(),adapter=createEmbyAdapter({now:()=>100000,read:async()=>[session()],readMovies:async()=>{throw Error('unavailable');}});await adapter.start({...settings,'library-suggestions':true});await adapter.execute('refresh',{},h.context);
 assert.equal(h.state['current-title'],'Tesla documentary');assert.equal(h.state['received-at'],100000);assert.equal(h.events.length,1);assert.equal(h.events[0].id,'reading-updated');assert.equal(h.state['library-poll-status'],'Library unavailable');
 const cancelled=host(),late=createEmbyAdapter({readMovies:async()=>{cancelled.controller.abort(Error('cancelled'));return {Items:[libraryMovie()]};}});await late.start({...settings,'monitor-playback':false,'library-suggestions':true});await assert.rejects(late.execute('refresh-library',{},cancelled.context),/cancelled/);assert.equal(cancelled.saves.length,1);assert.equal(cancelled.state.libraryPicks.length,0);assert.equal(cancelled.events.length,0);
});

test('library ready-made Cards select four summaries without media IDs, private cache or playback actions',async()=>{
 const h=host(),adapter=createEmbyAdapter({now:()=>100000,readMovies:async()=>({Items:[1,2,3,4].map(id=>libraryMovie(String(id))),TotalRecordCount:4})});const config={...settings,'monitor-playback':false,'library-suggestions':true};await adapter.start(config);await adapter.execute('refresh-library',{},h.context);
 const plugin=validateDeclaration(JSON.parse(await fs.readFile('plugins/emby/declaration.json','utf8'))),record={health:'ready',configured:true,config:{snapshot:()=>({enabled:true,settings:config})},state:{snapshot:()=>h.state},log:{latest:()=>[]}};
 const card=validateCard({schemaVersion:1,layout:'readymade',templateId:'library-movies',sourceId:'plugin',enabled:true},plugin,null,config),selected=selectedCardData(card,projectCardData(plugin,record),cardCatalog(plugin,config));
 assert.equal(selected.data.values['pick-4-summary'].available,true);assert.equal(selected.data.values['library-more'].value.length,3);assert.doesNotMatch(JSON.stringify(selected),/PRIVATE|10\.23|credential|api-key|libraryPicks|MediaSources/);assert.equal(plugin.actions.find(action=>action.id==='refresh-library').settingsOnly,true);
});

test('library-only actual worker exposes fixed Cards and setup refresh stays outside Task actions',async t=>{
 const base=path.resolve('tests/.tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'emby-library-')),folder=path.join(root,'plugins/emby');await fs.cp('plugins/emby',folder,{recursive:true,filter:file=>!file.split(path.sep).includes('data')});
 await fs.writeFile(path.join(folder,'server/test-response.json'),JSON.stringify({Items:[1,2,3,4].map(id=>libraryMovie(String(id))),TotalRecordCount:4}));
 await fs.writeFile(path.join(folder,'server/test-entry.mjs'),`import fs from 'node:fs/promises';import {createEmbyAdapter} from './index.mjs';export default createEmbyAdapter({read:async()=>{throw Error('Session read forbidden');},readMovies:async()=>JSON.parse(await fs.readFile(new URL('./test-response.json',import.meta.url)))});`);
 const declaration=JSON.parse(await fs.readFile(path.join(folder,'declaration.json'),'utf8'));declaration.runtime.entry='server/test-entry.mjs';await fs.writeFile(path.join(folder,'declaration.json'),JSON.stringify(declaration));
 const app=await createLocalserve(root,{automatic:false});t.after(async()=>{await app.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
 await app.registry.saveConfiguration('emby',{revision:1,enabled:true,settings:{...settings,'monitor-playback':false,'library-suggestions':true}});await app.registry.execute('emby','refresh-library',{});assert.equal(app.registry.get('emby').state.snapshot().events,undefined);
 assert.equal(app.registry.cardSource('emby').cardData.values['library-pick-count'].value,4);assert.equal(app.state.snapshot().runs.length,0);assert.ok(!app.registry.actions().some(action=>action.pluginId==='emby'&&action.actionId==='refresh-library'));
 await app.registry.saveCard('emby',{schemaVersion:1,layout:'readymade',templateId:'library-movies',sourceId:'plugin',enabled:true});assert.equal(app.registry.services()[0].cards.length,1);
 const response=await fetch(app.origin+'/plugin-card-assets/emby/library-movies/card.html');assert.equal(response.status,200);assert.match(await response.text(),/data-ready-made/);
});

test('library guide has Emby links and fixed Card selection without Movies watchlist actions',async()=>{
 const service={id:'emby',enabled:true,configurationReady:true,health:'ready',config:{settings:{'library-suggestions':true}},pluginState:{library:{items:[]},libraryPicks:[{id:'1',title:'Owned movie',summary:'Summary',year:2024,genres:['Drama'],source:'Emby library',url:'http://10.23.42.8:8096/web/index.html#!/item?id=1'}]},cardData:{readyMade:{templates:[{id:'screening'},{id:'library-movies'}]}}};
 let chosen;const context={state:{paused:false,services:[service]},escapeHtml:String,icon:()=>'',URL,location:{hostname:'192.168.1.3'},CardDesigner:{openReadyMade:value=>{chosen=value;}}};vm.createContext(context);vm.runInContext(await fs.readFile('web/watch-guide-ui.js','utf8'),context);context.service=service;
 const html=vm.runInContext('WatchGuideUI.renderEmby(service)',context);assert.match(html,/Open in Emby/);assert.doesNotMatch(html,/watch-movie-save|watch-movie-watched/);
 await vm.runInContext('WatchGuideUI.handle("watch-cards","emby")',context);assert.equal(chosen.cardData.readyMade.templates[0].id,'library-movies');assert.equal(service.cardData.readyMade.templates[0].id,'screening');
 context.item={url:'http://127.0.0.1:8096/web/index.html#!/item?id=1'};assert.equal(vm.runInContext('WatchGuideUI.itemLink(item,service)',context),'http://192.168.1.3:8096/web/index.html#!/item?id=1');
 context.location.hostname='example.test';assert.equal(vm.runInContext('WatchGuideUI.itemLink(item,service)',context),context.item.url);
});
