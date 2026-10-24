/** YouTube tests use synthetic API replies and disposable Localserve roots.
 * No request uses installed credentials or reaches Google's API. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createYouTubeAdapter, effectiveInterval, quotaDay } from '../plugins/youtube/server/index.mjs';
import { createClient, channelFilter, mapVideos, durationSeconds } from '../plugins/youtube/server/client.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { projectCardData, cardCatalog, selectedCardData, validateCard } from '../server/cards.mjs';
import { createLocalserve } from '../server.mjs';
const declaration=JSON.parse(await fs.readFile(new URL('../plugins/youtube/declaration.json',import.meta.url),'utf8'));
const channelId='UC'+'a'.repeat(22), secondId='UC'+'b'.repeat(22), key='synthetic-key-'.repeat(3);
const settings=(paused=false)=>({'api-key':key,'api-paused':paused,'poll-minutes':15,channels:[{id:'chosen',name:'Chosen',query:channelId,enabled:true},{id:'other',name:'Other',query:secondId,enabled:true}]});
const startAt=Date.parse('2026-10-14T04:00:00Z');
function environment(initial={}){
  let state=structuredClone(initial);const events=[],logs=[],writes=[];const controller=new AbortController();
  return {controller,events,logs,writes,get state(){return state;},
    context:{signal:controller.signal,readState:async()=>structuredClone(state),saveState:async next=>{state=structuredClone(next);writes.push(structuredClone(next));},
      emit:async(id,payload)=>events.push({id,payload,state:structuredClone(state)}),log:async(message,level)=>logs.push({message,level})}};
}
function fakeClient(){
  const calls=[];let items=[],failure=null;
  return {calls,setItems(next){items=next;},fail(next){failure=next;},async request(method,parameters,credential,signal){
    signal.throwIfAborted();calls.push({method,parameters});if(failure)throw failure;
    if(method==='channels')return {items:[{id:parameters.id||channelId,snippet:{title:'Sample channel',customUrl:'@sample'},
      contentDetails:{relatedPlaylists:{uploads:'UU'+(parameters.id||channelId).slice(2)}},statistics:{hiddenSubscriberCount:false,subscriberCount:'1000',videoCount:'50',viewCount:'12345'}}]};
    if(method==='search')return {items:[{id:{channelId},snippet:{title:'Sample A'}},{id:{channelId:secondId},snippet:{title:'Sample B'}}]};
    if(method==='playlistItems')return {items:items.map(item=>({contentDetails:{videoId:item.id}})),nextPageToken:'more-not-fetched'};
    return {items:items.filter(item=>parameters.id.split(',').includes(item.id))};
  }};
}
const video=(id,at,title='Video')=>({id,snippet:{channelId,title,publishedAt:new Date(at).toISOString(),liveBroadcastContent:'none'},status:{privacyStatus:'public'},contentDetails:{duration:'PT3M20S'}});

test('YouTube declaration, Channel selectors and offline lifecycle retain secret boundaries',async()=>{
  const plugin=validateDeclaration(declaration),client=fakeClient(),adapter=createYouTubeAdapter({client});
  assert.equal(plugin.name,'YouTube');assert.equal(plugin.settings[0].format,'secret');
  assert.equal(plugin.settingsGuide.title, 'YouTube setup and testing');
  for (const change of [
    guide => { guide.sections = []; },
    guide => { guide.sections[0].steps = ['x'.repeat(1001)]; },
    guide => { guide.sections[0].steps = [null]; },
  ]) {
    const invalidGuide = structuredClone(declaration);
    change(invalidGuide.settingsGuide);
    assert.throws(() => validateDeclaration(invalidGuide), /Settings guide/);
  }
  assert.equal(plugin.events.find(event=>event.id==='video-released').occurrenceKey,'release-id');
  assert.equal(adapter.validateConfiguration(settings()),true);assert.equal(adapter.validateConfiguration({...settings(),'api-key':''}),false);
  const disabledInvalid=settings();disabledInvalid.channels[1].enabled=false;disabledInvalid.channels[1].query='incomplete draft';
  assert.equal(adapter.validateConfiguration(disabledInvalid),true,'An inactive source must not block other enabled Channels.');
  await adapter.start(settings());await adapter.stop();assert.equal(client.calls.length,0);
  for(const value of [channelId,'@linustechtips','https://www.youtube.com/@linustechtips','https://youtube.com/channel/'+channelId,'https://youtube.com/user/sample']) assert.ok(channelFilter(value));
  for(const value of ['channel name','https://example.com/@sample','http://youtube.com/@sample','https://user:pass@youtube.com/@sample','https://youtube.com:8443/@sample','https://youtube.com/watch?v=123','https://youtube.com/@sample#x']) assert.equal(channelFilter(value),null,value);
  const invalid=structuredClone(declaration);invalid.cardFields.push({id:'secret',label:'Secret',type:'string',source:{kind:'setting',key:'api-key'}});assert.throws(()=>validateDeclaration(invalid),/Secret/);
  assert.ok(effectiveInterval({...settings(),channels:Array.from({length:20},()=>({enabled:true}))})>=20*2*86400000/1500);
});

test('first refresh baselines, release claims persist before events, repeated reads and restart never replay',async()=>{
  let at=startAt;const client=fakeClient(),env=environment();client.setItems([video('oldvideo001',at-100000)]);
  let adapter=createYouTubeAdapter({client,now:()=>at});await adapter.start(settings());await adapter.execute('refresh',{'source-id':'chosen'},env.context);
  assert.equal(env.events.filter(event=>event.id==='video-released').length,0);assert.equal(env.state.budget.reads,3);
  assert.equal(env.state.channels.chosen['video-count'],1);assert.equal(env.state.channels.chosen['videos-limited'],true);
  at+=16*60000;client.setItems([video('newvideo001',at-10000),video('oldvideo001',startAt-100000)]);
  await adapter.execute('refresh',{'source-id':'chosen'},env.context);
  const release=env.events.find(event=>event.id==='video-released');assert.equal(release.payload['video-id'],'newvideo001');assert.ok(release.state.channels.chosen.claims.some(claim=>claim.id==='newvideo001'));
  const before=client.calls.length;await adapter.execute('refresh',{'source-id':'chosen'},env.context);assert.equal(client.calls.length,before);
  at+=16*60000;await adapter.execute('refresh',{'source-id':'chosen'},env.context);assert.equal(env.events.filter(event=>event.id==='video-released').length,1);
  await adapter.stop();at+=16*60000;client.setItems([video('offline0001',at-10000)]);
  adapter=createYouTubeAdapter({client,now:()=>at});await adapter.start(settings());await adapter.execute('refresh',{'source-id':'chosen'},env.context);
  assert.equal(env.events.filter(event=>event.id==='video-released').length,1);
});

test('pause/resume keeps successful readings and key/budgets without catching up missed releases',async()=>{
  let at=startAt;const client=fakeClient(),env=environment(),adapter=createYouTubeAdapter({client,now:()=>at});
  client.setItems([video('oldvideo001',at-1000)]);await adapter.start(settings());await adapter.execute('refresh',{'source-id':'chosen'},env.context);
  const received=env.state.channels.chosen['received-at'],used=env.state.budget.reads,calls=client.calls.length;
  await adapter.stop();await adapter.start(settings(true));at+=16*60000;
  await adapter.execute('refresh',{'source-id':'chosen'},env.context);assert.equal(client.calls.length,calls);assert.equal(env.state.channels.chosen['api-state'],'Paused');assert.equal(env.state.channels.chosen['received-at'],received);
  await assert.rejects(adapter.execute('lookup-channel',{'source-id':'chosen',query:'Name'},env.context),/paused/);
  client.setItems([video('paused00001',at-1000)]);await adapter.stop();await adapter.start(settings());
  await adapter.execute('refresh',{'source-id':'chosen'},env.context);assert.equal(env.events.filter(event=>event.id==='video-released').length,0);assert.equal(env.state.budget.reads,used+2);
});

test('source failures retain data, requests reserve before transmission, budgets persist and corrected keys preserve spend',async()=>{
  let at=startAt;const client=fakeClient(),env=environment(),adapter=createYouTubeAdapter({client,now:()=>at});client.setItems([video('oldvideo001',at-1000)]);
  await adapter.start(settings());await adapter.execute('refresh',{'source-id':'chosen'},env.context);
  const received=env.state.channels.chosen['received-at'],calls=client.calls.length;
  at+=16*60000;const error=new Error('YouTube rejected the request.');error.block='credentials';client.fail(error);
  await assert.rejects(adapter.execute('refresh',{'source-id':'chosen'},env.context),/rejected/);
  assert.equal(client.calls.length,calls+1);assert.equal(env.state.budget.reads,4);assert.equal(env.state.channels.chosen['received-at'],received);assert.ok(env.state.blockedUntil>at);
  at+=16*60000;await assert.rejects(adapter.execute('refresh',{'source-id':'chosen'},env.context),/blocked/);assert.equal(client.calls.length,calls+1);
  await adapter.stop();await adapter.start({...settings(),'api-key':'replacement-key-'.repeat(3)});client.fail(null);
  await adapter.execute('refresh',{'source-id':'chosen'},env.context);assert.equal(env.state.budget.reads,6);assert.equal(env.state.blockedUntil,null);
  assert.ok(env.writes.every(state=>state.budget===undefined||state.budget.reads>=1));
});

test('channel lookup never chooses ambiguous names, and independent read/search budgets are enforced',async()=>{
  let at=startAt;const client=fakeClient(),env=environment(),adapter=createYouTubeAdapter({client,now:()=>at});await adapter.start(settings());
  const result=await adapter.execute('lookup-channel',{query:'Ambiguous name'},env.context);
  assert.equal(result.matches.length,2);assert.equal(env.state.channels.chosen,undefined);assert.equal(env.events.length,0);assert.equal(env.state.budget.searches,1);assert.equal(env.state.budget.reads,0);
  await adapter.execute('lookup-channel',{'source-id':'chosen',query:'@sample'},env.context);assert.equal(env.state.budget.reads,1);assert.equal(env.state.budget.searches,1);
  await assert.rejects(adapter.execute('lookup-channel',{'source-id':'chosen',query:'https://bad.example/@name'},env.context),/supported/);
  for(let i=1;i<20;i++)await adapter.execute('lookup-channel',{'source-id':'chosen',query:'Name '+i},env.context);
  const calls=client.calls.length;await assert.rejects(adapter.execute('lookup-channel',{'source-id':'chosen',query:'Over limit'},env.context),/budget/);assert.equal(client.calls.length,calls);
  at+=86400000;await adapter.execute('lookup-channel',{'source-id':'chosen',query:'Next quota day'},env.context);assert.equal(env.state.budget.searches,1);
});

test('known publication/privacy/live states and parsed durations stay explicit',()=>{
  const items=[video('public00001',startAt-1000),video('private0001',startAt-1000),video('livevideo01',startAt-1000),video('future00001',startAt+1000),video('unknown0001',startAt-1000),video('otherchan01',startAt-1000)];
  items[1].status.privacyStatus='private';items[2].snippet.liveBroadcastContent='live';delete items[4].snippet.liveBroadcastContent;items[5].snippet.channelId=secondId;
  const mapped=mapVideos(items,channelId,startAt);assert.equal(mapped.length,1);assert.equal(mapped[0].duration,200);assert.equal(mapped[0].url,'https://www.youtube.com/watch?v=public00001');
  assert.equal(durationSeconds('PT1H2M3S'),3723);assert.equal(durationSeconds('P1DT2H'),93600);assert.equal(durationSeconds('unknown'),null);
  assert.notEqual(quotaDay(Date.parse('2026-10-14T06:59:00Z')),quotaDay(Date.parse('2026-10-14T07:01:00Z')));
});

test('Settings discovery works with no Channels and does not publish setup results',async()=>{
  const client=fakeClient(),env=environment(),adapter=createYouTubeAdapter({client,now:()=>startAt});
  await adapter.start({...settings(),channels:[]});
  const result=await adapter.execute('lookup-channel',{query:'Sample'},env.context);
  assert.deepEqual(result.matches.map(match=>match.id),[channelId,secondId]);
  assert.equal(env.state.budget.searches,1);
  assert.deepEqual(env.state.channels,{});
  assert.deepEqual(env.events,[]);
  assert.equal(declaration.events.some(event=>event.id==='lookup-completed'),false);
  assert.equal(declaration.cardFields.some(field=>field.id.startsWith('lookup-')),false);
});

test('lookup dialogs select explicitly, retain revisions and ignore late replies',async()=>{
  const service={...validateDeclaration(declaration),enabled:true,configurationReady:true,health:'ready',
    config:{revision:7,settings:{...settings(),channels:[]}}};
  let html='',selected;
  const errors=[];
  const context=vm.createContext({document:{addEventListener(){}},state:{services:[service],paused:false},currentView:'youtube',
    icon:()=>'',escapeHtml:value=>String(value??''),dialogHeader:title=>`<h2>${title}</h2>`,
    showDialog:(markup,details)=>{html=markup;context.dialogContext=details;},showFormError:error=>errors.push(error),
    mutate:async()=>({result:{matches:[{id:channelId,name:'Sample channel',handle:'@sample'}]}}),
  });
  const ui=vm.runInContext(await fs.readFile(new URL('../web/plugin-ui.js',import.meta.url),'utf8')+'\nPluginUI;',context);
  ui.openLookup(service);
  assert.match(html,/plugin-lookup-form/);
  assert.doesNotMatch(html,/source-id/);
  const button={disabled:false,isConnected:true},results={innerHTML:''};
  const form={isConnected:true,elements:{namedItem:()=>({value:'Sample'})},
    querySelector:selector=>selector==='[type="submit"]'?button:results};
  await ui.submitLookup(form);
  assert.match(results.innerHTML,/Use channel/);
  ui.openItem=(...values)=>{selected=values;};
  await ui.handleAction('plugin-use-source','0',{});
  assert.equal(selected[4].query,channelId);
  assert.equal(selected[4].enabled,false);
  service.config.revision++;
  await ui.handleAction('plugin-use-source','0',{});
  assert.match(errors[0],/changed/);
  ui.openLookup(service);
  const deferred=Promise.withResolvers();context.mutate=()=>deferred.promise;
  results.innerHTML='untouched';
  const pending=ui.submitLookup(form);
  context.dialogContext={kind:'different-editor'};
  deferred.resolve({result:{matches:[{id:secondId,name:'Late match'}]}});
  await pending;
  assert.equal(results.innerHTML,'untouched');
  const controls=structuredClone(declaration);controls.controls={actions:['lookup-channel']};
  assert.throws(()=>validateDeclaration(controls),/non-secret declared/);
});

test('changed identities clear old readings and keep failed-source backoff',async()=>{
  let at=startAt;
  const client=fakeClient(),env=environment(),adapter=createYouTubeAdapter({client,now:()=>at});
  client.setItems([video('oldvideo001',at-1000)]);
  await adapter.start(settings());
  await adapter.execute('refresh',{'source-id':'chosen'},env.context);
  assert.equal(env.state.channels.chosen['latest-id'],'oldvideo001');
  const replacement=settings();replacement.channels[0].query=secondId;
  await adapter.stop();await adapter.start(replacement);
  client.fail(new Error('Unavailable'));
  await assert.rejects(adapter.execute('refresh',{'source-id':'chosen'},env.context),/Unavailable/);
  assert.equal(env.state.channels.chosen['latest-id'],undefined);
  const used=client.calls.length;
  await adapter.execute('refresh',{'source-id':'chosen'},env.context);
  assert.equal(client.calls.length,used,'The failed replacement retains its next-check gate.');
});

test('every emitted YouTube property agrees with its declaration',async()=>{
  let at=startAt;
  const client=fakeClient(),env=environment(),adapter=createYouTubeAdapter({client,now:()=>at});
  client.setItems([video('oldvideo001',at-1000)]);
  await adapter.start(settings());await adapter.execute('refresh',{'source-id':'chosen'},env.context);
  at+=16*60000;client.setItems([video('newvideo001',at-1000)]);
  await adapter.execute('refresh',{'source-id':'chosen'},env.context);
  assert.equal(env.events.find(event=>event.id==='video-released').payload.duration,200);
  for(const emitted of env.events){
    const fields=declaration.events.find(event=>event.id===emitted.id).payload;
    for(const field of fields){
      if(field.required)assert.ok(Object.hasOwn(emitted.payload,field.id),field.id);
      if(Object.hasOwn(emitted.payload,field.id))assert.equal(typeof emitted.payload[field.id],field.type,field.id);
    }
    for(const id of Object.keys(emitted.payload))assert.ok(fields.some(field=>field.id===id),id);
  }
});

test('official transport fixes host, keeps key in headers, rejects redirects/oversized JSON and suppresses credential echoes',async()=>{
  let request;
  const client=createClient({fetchImpl:async(url,options)=>{request={url,options};return new Response(JSON.stringify({items:[]}),{status:200});}});
  await client.request('channels',{part:'snippet',id:channelId},key,new AbortController().signal);
  assert.equal(request.url.origin,'https://www.googleapis.com');assert.equal(request.url.searchParams.get('key'),null);assert.equal(request.options.headers['X-Goog-Api-Key'],key);assert.equal(request.options.redirect,'error');
  const rejected=createClient({fetchImpl:async()=>new Response(JSON.stringify({error:{errors:[{reason:'quotaExceeded'}],message:key}}),{status:403})});
  await assert.rejects(rejected.request('channels',{},key,new AbortController().signal),error=>error.block==='quota'&&!error.message.includes(key));
  const oversized=createClient({fetchImpl:async()=>new Response('x'.repeat(512*1024+1))});await assert.rejects(oversized.request('channels',{},key,new AbortController().signal),/512 KiB/);
  const echoed=createClient({fetchImpl:async()=>{throw new Error(key);}});await assert.rejects(echoed.request('channels',{},key,new AbortController().signal),error=>!error.message.includes(key));
  const prefixed=createClient({fetchImpl:async()=>{const error=new Error('YouTube returned '+key);error.block='credentials';throw error;}});
  await assert.rejects(prefixed.request('channels',{},key,new AbortController().signal),error=>!error.message.includes(key));
  const badKey=createClient({fetchImpl:async()=>new Response(JSON.stringify({error:{errors:[{reason:'badRequest'}]}}),{status:400})});
  await assert.rejects(badKey.request('channels',{},key,new AbortController().signal),/rejected the request/);
});

test('cancellation during API replies retains previous reading, emits nothing and never refunds a committed reservation',async()=>{
  let at=startAt;const client=fakeClient(),env=environment(),adapter=createYouTubeAdapter({client,now:()=>at});client.setItems([video('oldvideo001',at-1000)]);
  await adapter.start(settings());await adapter.execute('refresh',{'source-id':'chosen'},env.context);
  const old=env.state.channels.chosen['received-at'],events=env.events.length,used=env.state.budget.reads;at+=16*60000;
  const cancelled=createYouTubeAdapter({now:()=>at,client:{async request(){env.controller.abort(new Error('Cancelled'));return {items:[]};}}});await cancelled.start(settings());
  await assert.rejects(cancelled.execute('refresh',{'source-id':'chosen'},env.context),/Cancelled/);
  assert.equal(env.state.channels.chosen['received-at'],old);assert.equal(env.events.length,events);assert.equal(env.state.budget.reads,used+1);
});

test('public Cards select one source and fixed cells while API key, quota reservations and release claims stay private',async()=>{
  const plugin=validateDeclaration(declaration),client=fakeClient(),env=environment(),adapter=createYouTubeAdapter({client,now:()=>startAt});client.setItems([video('oldvideo001',startAt-1000,'<script>provider text</script>')]);
  await adapter.start(settings());await adapter.execute('refresh',{'source-id':'chosen'},env.context);
  const record={configured:true,health:'ready',config:{snapshot:()=>({enabled:true,settings:settings()})},state:{snapshot:()=>env.state},log:{latest:()=>[]}};
  const card=validateCard({schemaVersion:1,layout:'readymade',templateId:'studio',sourceId:'chosen',enabled:true},plugin,null,settings());
  const projected=selectedCardData(card,projectCardData(plugin,record),cardCatalog(plugin,settings()));
  assert.doesNotMatch(JSON.stringify(projected),new RegExp(key+'|keyFingerprint|claims|Other|uploads|budget"'));
  const rows=projected.data.values['chosen:videos'].value;assert.deepEqual(Object.keys(rows[0]),['title','published','duration']);assert.equal(rows[0].title,'<script>provider text</script>');
});

test('package lifecycle, pause settings, Cards and Tasks use the shared server without external calls',async t=>{
  const base=fileURLToPath(new URL('./.tmp/',import.meta.url));await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'youtube-'));
  await fs.mkdir(path.join(root,'plugins/youtube'),{recursive:true});
  await fs.cp(new URL('../plugins/youtube/',import.meta.url),path.join(root,'plugins/youtube'),{recursive:true,filter:source=>!source.includes(path.sep+'data')});
  let app=await createLocalserve(root,{automatic:false});
  t.after(async()=>{await app.close();assert.ok(path.resolve(root).startsWith(path.resolve(base)+path.sep));await fs.rm(root,{recursive:true,force:true});});
  await app.registry.saveConfiguration('youtube',{revision:1,enabled:true,settings:settings(true)});
  const lookup=app.registry.services()[0].actions.find(action=>action.id==='lookup-channel');
  assert.equal(lookup.settingsOnly,true);
  assert.equal(lookup.parameters.some(field=>field.id==='source-id'),false);
  assert.equal(app.registry.actions().some(action=>action.actionId==='lookup-channel'),false);
  assert.throws(()=>app.registry.execute('youtube','lookup-channel',{query:'Name'},{taskId:'task'}),/only in plugin Settings/);
  const refresh=app.registry.services()[0].actions.find(action=>action.id==='refresh');
  assert.deepEqual(refresh.parameters.find(field=>field.id==='source-id').enum,['chosen','other']);
  await app.registry.execute('youtube','refresh',{'source-id':'chosen'});
  assert.equal(app.registry.services()[0].cardData.values['chosen:api-state'].value,'Paused');
  await app.registry.saveCard('youtube',{schemaVersion:1,layout:'readymade',templateId:'studio',sourceId:'chosen',enabled:false});
  const card=app.registry.services()[0].cards[0];assert.equal(card.enabled,false);
  assert.equal(app.registry.events().filter(event=>event.eventId==='video-released').length,2);
  const response=await fetch(app.origin+'/plugin-card-assets/youtube/studio/card.html');assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/<script/);
  assert.equal((await fetch(app.origin+'/plugins/youtube/data/config.json')).status,404);
  await app.close();app=await createLocalserve(root,{automatic:false});
  assert.equal(app.registry.services()[0].config.settings['api-paused'],true);assert.equal(app.registry.services()[0].cards[0].id,card.id);
});

test('distinct YouTube releases launch their captured video on Samsung through supervised Tasks without replay',async t=>{
  const base=fileURLToPath(new URL('./.tmp/',import.meta.url));await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'youtube-events-'));
  const folder=path.join(root,'plugins/youtube');await fs.mkdir(folder,{recursive:true});
  await fs.cp(new URL('../plugins/youtube/',import.meta.url),folder,{recursive:true,filter:source=>!source.includes(path.sep+'data')});
  const tvFolder=path.join(root,'plugins/samsung-tv');
  await fs.cp(new URL('../plugins/samsung-tv/',import.meta.url),tvFolder,{recursive:true,filter:source=>!source.includes(path.sep+'data')});
  const tvDeclaration=JSON.parse(await fs.readFile(path.join(tvFolder,'declaration.json'),'utf8'));
  tvDeclaration.runtime.entry='server/test-entry.mjs';await fs.writeFile(path.join(tvFolder,'declaration.json'),JSON.stringify(tvDeclaration));
  await fs.mkdir(path.join(tvFolder,'data'),{recursive:true});
  await fs.writeFile(path.join(tvFolder,'server/test-entry.mjs'),`import fs from 'node:fs/promises';
import {createSamsungAdapter} from './index.mjs';
export default createSamsungAdapter({credentialReady:async()=>true,vault:{load:async()=>({host:'10.23.42.5',port:8001,token:'synthetic-token'}),save:async()=>{}},
youtube:{async play(settings,id){await fs.appendFile(new URL('../data/videos.jsonl',import.meta.url),JSON.stringify(id)+'\\n');}},
remote:async()=>({close(){},async send(message){await fs.appendFile(new URL('../data/messages.jsonl',import.meta.url),JSON.stringify(message)+'\\n');}})});
`);
  const modified=structuredClone(declaration);modified.runtime.entry='server/test-entry.mjs';await fs.writeFile(path.join(folder,'declaration.json'),JSON.stringify(modified));
  await fs.mkdir(path.join(folder,'data'),{recursive:true});
  const clockFile=path.join(folder,'data/test-clock.json'),replyFile=path.join(folder,'data/test-videos.json');
  let at=startAt;
  const prepare=async videos=>{await fs.writeFile(clockFile,JSON.stringify({at}));await fs.writeFile(replyFile,JSON.stringify(videos));};
  await prepare([video('oldvideo001',at-1000)]);
  await fs.writeFile(path.join(folder,'server/test-entry.mjs'),`import fs from 'node:fs';
import {createYouTubeAdapter} from './index.mjs';
const read=file=>JSON.parse(fs.readFileSync(new URL('../data/'+file,import.meta.url),'utf8'));
export default createYouTubeAdapter({now:()=>read('test-clock.json').at,client:{async request(method,parameters,key,signal){
signal.throwIfAborted();const videos=read('test-videos.json');
if(method==='channels')return {items:[{id:parameters.id,snippet:{title:'Synthetic channel'},contentDetails:{relatedPlaylists:{uploads:'UU'+parameters.id.slice(2)}}}]};
if(method==='playlistItems')return {items:videos.map(video=>({contentDetails:{videoId:video.id}}))};
return {items:videos};}}});
`);
  let app=await createLocalserve(root,{automatic:false});
  t.after(async()=>{await app.close();assert.ok(path.resolve(root).startsWith(path.resolve(base)+path.sep));await fs.rm(root,{recursive:true,force:true});});
  await app.registry.saveConfiguration('youtube',{revision:1,enabled:true,settings:settings()});
  await app.registry.saveConfiguration('samsung-tv',{revision:1,enabled:true,settings:{host:'10.23.42.5',port:8001,'remote-name':'Test','poll-minutes':1,token:'',fingerprint:'','youtube-playback':true,'youtube-port':8080}});
  await app.vistas.save({schemaVersion:1,name:'Upload screen',slug:'upload-screen',enabled:true,gap:16,padding:16,
    layout:{id:'canvas',type:'column',name:'Canvas',enabled:true,width:'1fr',height:'1fr',children:[]}});
  const vista=app.vistas.snapshot()[0];
  const response=await fetch(app.origin+'/api/tasks',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Localserve-Token':app.snapshot().token},
    body:JSON.stringify({name:'New upload',enabled:true,starts:[{id:'rule',name:'Event',type:'event',enabled:true,eventId:'plugin:youtube:event:video-released:chosen',
      condition:{field:'channel-id',operator:'eq',value:channelId}}],steps:[
        {id:'delay',type:'delay',enabled:true,seconds:0.05},
        {id:'vista',type:'show-vista',enabled:true,vistaId:vista.id},
        {id:'launch',type:'plugin',enabled:true,capabilityId:'plugin:samsung-tv:play-youtube',parameters:{'app-id':'111299001912','video-id':'{{event.video-id}}'}}]})});
  assert.equal(response.status,200,await response.text());
  const task=app.tasks.snapshot()[0];
  await assert.rejects(app.engine.start(task.id),/triggering event/);
  assert.equal(app.state.snapshot().runs.length,0,'Missing event fails before admission or any device operation');
  const settle=async()=>{const until=Date.now()+7000;while(app.engine.active.size||app.engine.pending.size){if(Date.now()>until)throw new Error('Task did not settle');await new Promise(resolve=>setTimeout(resolve,10));}};
  await app.registry.execute('youtube','refresh',{'source-id':'chosen'});await settle();assert.equal(app.state.snapshot().runs.length,0);
  at+=16*60000;await prepare([video('newvideo001',at-1000)]);await app.registry.execute('youtube','refresh',{'source-id':'chosen'});await settle();assert.equal(app.state.snapshot().runs.length,1);
  assert.equal(app.vistas.displaySnapshot().vistaId,vista.id);
  at+=16*60000;await prepare([video('newvideo002',at-1000)]);await app.registry.execute('youtube','refresh',{'source-id':'chosen'});await settle();assert.equal(app.state.snapshot().runs.length,2);
  const messages=(await fs.readFile(path.join(tvFolder,'data/messages.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(messages.every(message=>message.params.data.metaTag===''));
  const played=(await fs.readFile(path.join(tvFolder,'data/videos.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(played,['newvideo001','newvideo002']);
  assert.ok(messages.every(message=>message.params.data.appId==='111299001912'&&message.params.data.action_type==='DEEP_LINK'));
  await app.registry.execute('youtube','refresh',{'source-id':'chosen'});await settle();assert.equal(app.state.snapshot().runs.length,2);
  await app.close();at+=16*60000;await prepare([video('offline0001',at-1000)]);app=await createLocalserve(root,{automatic:false});
  await app.registry.execute('youtube','refresh',{'source-id':'chosen'});await settle();assert.equal(app.state.snapshot().runs.length,2);
});
