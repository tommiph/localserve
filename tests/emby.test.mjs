/** Synthetic sessions only. No installed Emby instance, credentials, playback
 * command or unrelated service is contacted by these tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { serverUrl, configuration, readSessions } from '../plugins/emby/server/client.mjs';
import { parseSessions } from '../plugins/emby/server/sessions.mjs';
import { createEmbyAdapter } from '../plugins/emby/server/index.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { validateCard, projectCardData, selectedCardData, cardCatalog } from '../server/cards.mjs';
import { createLocalserve } from '../server.mjs';

const settings={'server-url':'http://10.23.42.8:8096','api-key':'PRIVATE_API_KEY_123456','poll-minutes':0.5};
const session=(patch={})=>({Id:'private-session',UserId:'PRIVATE-ACCOUNT',UserName:'Viewer',RemoteEndPoint:'PRIVATE-ADDRESS',DeviceName:'Living room',Client:'Emby TV',NowPlayingItem:{Id:'private-item',Name:'Tesla documentary',SeriesName:'Science',Type:'Movie',RunTimeTicks:6000000000,Path:'PRIVATE-PATH'},PlayState:{IsPaused:false,PositionTicks:3000000000,VolumeLevel:25,IsMuted:false},...patch});
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
