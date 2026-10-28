import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {createTvCalendar} from '../plugins/tv-calendar/server/index.mjs';
import {episodes,readTvmaze} from '../plugins/tv-calendar/server/client.mjs';
import {validateDeclaration} from '../server/plugins.mjs';
import {createLocalserve} from '../server.mjs';
import {validateValues} from '../server/plugin-schema.mjs';
import path from 'node:path';
import vm from 'node:vm';
import {tvPicks,projectTvPicks} from '../plugins/tv-calendar/server/daily.mjs';
const settings={'poll-minutes':1,'refresh-hours':6,shows:[{id:'show-a',name:'Example','tvmaze-id':'1',enabled:true}]};
const at=Date.parse('2026-10-27T12:00:00Z');
const data={id:1,name:'Example',network:{name:'Network'},_embedded:{episodes:[{id:2,name:'Episode',season:1,number:1,airstamp:new Date(at+60000).toISOString(),airdate:'2026-10-27'}]}};
test('daily TV suggestions are stable, genre-filtered and exclude followed shows without network calls',()=>{
  const picks=tvPicks(settings,{},at);assert.equal(picks.length,4);assert.deepEqual(tvPicks(settings,{},at),picks);
  const selected={...settings,shows:[...settings.shows,{id:'followed',name:picks[0].name,'tvmaze-id':picks[0].id,enabled:true}],'pick-genre':'Science-Fiction','pick-ended':false};
  const filtered=tvPicks(selected,{},at);assert.ok(filtered.every(show=>show.genres.includes('Science-Fiction')&&show.status!=='Ended'&&show.id!==picks[0].id));
  const state={watched:['123']};projectTvPicks(selected,state,at);assert.equal(state['pick-day'],'2026-10-27');assert.deepEqual(state.watched,['123']);assert.match(state['pick-status'],/not verified/);assert.equal(state['more-count'],Math.max(0,state['pick-count']-1));
});

test('multiple TV genre choices use OR and an explicit All overrides an existing single preference',async()=>{
 const choice={...settings,'pick-genre':'Drama','pick-genres':'Comedy,Science-Fiction'},picks=tvPicks(choice,{},at);
 assert.equal(picks.length,4);assert.ok(picks.every(show=>show.genres.some(genre=>['Comedy','Science-Fiction'].includes(genre))));
 assert.deepEqual(tvPicks({...choice,'pick-genres':''},{},at),tvPicks(settings,{},at));
 const adapter=createTvCalendar();assert.equal(adapter.validateConfiguration({...choice,'pick-genres':'Comedy,Comedy'}),false);assert.equal(adapter.validateConfiguration({...choice,'pick-genres':'Unknown'}),false);
});

test('genre checkboxes retain old preferences and keep All genres mutually exclusive',async()=>{
 const context={escapeHtml:String,icon:()=>''};vm.createContext(context);vm.runInContext(await fs.readFile('web/watch-guide-ui.js','utf8'),context);
 const service={id:'movies',config:{settings:{genre:'Drama'}},settings:[{id:'genre',enum:['','Drama','Comedy'],enumLabels:['All genres','Drama','Comedy']}]};context.service=service;
 const html=vm.runInContext("WatchGuideUI.genreSetting(service,{id:'genres'})",context);assert.match(html,/name="genres" value="Drama"/);assert.match(html,/data-watch-genre="Drama" checked/);assert.doesNotMatch(html,/<select/);
 const hidden={value:''},choices=[{dataset:{watchGenre:''},checked:false},{dataset:{watchGenre:'Drama'},checked:true},{dataset:{watchGenre:'Comedy'},checked:true}];const group={querySelectorAll:()=>choices,querySelector:()=>hidden};for(const choice of choices)choice.closest=()=>group;context.control=choices[2];vm.runInContext('WatchGuideUI.syncGenres(control)',context);assert.equal(hidden.value,'Drama,Comedy');
 choices[0].checked=true;context.control=choices[0];vm.runInContext('WatchGuideUI.syncGenres(control)',context);assert.equal(hidden.value,'');assert.equal(choices[1].checked,false);assert.equal(choices[2].checked,false);
});
test('daily-pick Follow saves once, preserves settings and keeps failures visible after rendering',async()=>{
  let finish,calls=0,error='';const service={id:'tv-calendar',config:{revision:4,settings:{...settings,shows:[]}},settings:[{id:'shows',maxItems:20}],pluginState:{dailyPicks:[{id:'9',name:'Discovery'}]}};
  const context={state:{services:[service]},currentView:'tv-calendar',structuredClone,PluginUI:{newItem:()=>({id:'new'}),render:()=>{error='';},showError:value=>{error=value;}},notify:()=>{},mutate:async(route,value)=>{calls++;assert.equal(value.revision,4);assert.equal(value.settings['poll-minutes'],1);assert.equal(value.settings.shows[0]['tvmaze-id'],'9');return new Promise((resolve,reject)=>{finish=reject;});}};
  vm.createContext(context);vm.runInContext(await fs.readFile('web/watch-guide-ui.js','utf8'),context);
  const run=vm.runInContext('WatchGuideUI.followTv("9")',context);await vm.runInContext('WatchGuideUI.followTv("9")',context);assert.equal(calls,1);finish(Error('Save not confirmed'));await run;assert.match(error,/not confirmed/);
});
test('normal numeric provider IDs save through the declared configuration contract',async()=>{const declaration=validateDeclaration(JSON.parse(await fs.readFile('plugins/tv-calendar/declaration.json')));assert.equal(validateValues(declaration.settings,settings).shows[0]['tvmaze-id'],'1');});
test('title search filters readable genre/status metadata without changing the watchlist',async()=>{
  let route;const found=[{show:{id:10,name:'Voyager',genres:['Science-Fiction'],language:'English',status:'Ended'}},{show:{id:11,name:'Comedy',genres:['Comedy'],status:'Running'}}];
  const f=await fixture(async url=>{route=new URL(url);return new Response(JSON.stringify(found));});
  const result=await f.adapter.execute('lookup-show',{query:'Voyager',genre:'Science-Fiction',status:'Ended'},f.context);
  assert.equal(route.pathname,'/search/shows');assert.equal(route.searchParams.get('q'),'Voyager');
  assert.deepEqual(result.matches.map(show=>show.name),['Voyager']);assert.deepEqual(result.matches[0].genres,['Science-Fiction']);
  assert.equal(result.matches[0].language,'English');assert.equal(result.scope,'title');assert.deepEqual(f.state().shows,{});assert.equal(f.events.length,0);
});
test('genre browsing uses one dated official schedule, deduplicates shows and bounds results',async()=>{
  const routes=[];const f=await fixture(async url=>{routes.push(new URL(url));return new Response(JSON.stringify(Array.from({length:250},(_,i)=>({_embedded:{show:{id:Math.floor(i/2)+1,name:'Show '+i,genres:['Drama'],status:'Running'}}}))));});
  const result=await f.adapter.execute('lookup-show',{genre:'Drama',source:'streaming'},f.context);
  assert.equal(result.matches.length,100);assert.equal(result.limited,true);assert.equal(new Set(result.matches.map(show=>show.id)).size,100);
  assert.equal(routes.length,1);assert.equal(routes[0].pathname,'/schedule/web');assert.equal(routes[0].searchParams.get('country'),'');assert.match(result.date,/^2026-10-27$/);assert.equal(result.scope,'schedule');
  f.advance(1600);await f.adapter.execute('lookup-show',{source:'tv-fi'},f.context);assert.equal(routes[1].pathname,'/schedule');assert.equal(routes[1].searchParams.get('country'),'FI');
  f.advance(1600);await assert.rejects(f.adapter.execute('lookup-show',{source:'foreign'},f.context),/browse/);assert.equal(routes.length,2);
});
test('show Add/Copy paths open discovery and selected show IDs stay hidden in ordinary editors',async()=>{
  const service={id:'tv-calendar',config:{revision:7,settings:{shows:settings.shows}},pluginState:{shows:{'1':{network:'Network',genres:['Drama'],status:'Running'}}},settings:[{id:'shows',maxItems:20,itemLabel:'show',fields:[{id:'id',type:'string'},{id:'name',type:'string'},{id:'tvmaze-id',type:'string'},{id:'enabled',type:'boolean'}]}]};
  const sandbox={state:{services:[service]},structuredClone,crypto:globalThis.crypto,escapeHtml:value=>String(value),icon:()=>'',dialogHeader:()=>'',dialogFooter:()=>'',AdminUX:{definitionActions:()=>''},showDialog:(html,context)=>{sandbox.html=html;sandbox.context=context;}};
  sandbox.document={addEventListener:()=>{}};
  sandbox.dialog={querySelector:()=>null};
  vm.createContext(sandbox);vm.runInContext(await fs.readFile('web/tv-calendar-ui.js','utf8')+'\n'+await fs.readFile('web/plugin-ui.js','utf8'),sandbox);
  vm.runInContext('TVCalendarUI.search=async()=>{}',sandbox);
  vm.runInContext('PluginUI.openItem(state.services[0],state.services[0].settings[0],"add",null)',sandbox);
  assert.equal(sandbox.context.kind,'tvcal-search');assert.match(sandbox.html,/name="genre"/);assert.doesNotMatch(sandbox.html,/TVmaze show ID/);
  vm.runInContext('PluginUI.openItem(state.services[0],state.services[0].settings[0],"copy","show-a")',sandbox);assert.equal(sandbox.context.selection.operation,'copy');
  vm.runInContext('PluginUI.openItem(state.services[0],state.services[0].settings[0],"copy","show-a",{name:"New show","tvmaze-id":"99",enabled:true})',sandbox);
  assert.equal(sandbox.context.item['tvmaze-id'],'99');assert.equal(sandbox.context.item.enabled,false);assert.match(sandbox.html,/type="hidden" name="tvmaze-id" value="99"/);assert.doesNotMatch(sandbox.html,/TVmaze show ID/);
  assert.doesNotMatch(vm.runInContext('TVCalendarUI.showList(state.services[0],state.services[0].settings[0])',sandbox),/TVmaze show ID/);
});
test('starter discovery is populated, genre-filtered and read-only even during provider cooldown',async()=>{
  let calls=0;const f=await fixture(()=>{calls++;throw Error('No network expected');});
  f.state().blockedUntil=at+86400000;
  const before=structuredClone(f.state()),all=await f.adapter.execute('lookup-show',{},f.context);
  assert.equal(all.scope,'suggested');assert.equal(all.matches.length,18);assert.equal(new Set(all.matches.map(show=>show.id)).size,18);assert.match(all.checkedOn,/^\d{4}-\d{2}-\d{2}$/);
  assert.ok(all.matches.some(show=>show.name==='Severance'));assert.ok(all.matches.some(show=>show.name==='Abbott Elementary'));
  const science=await f.adapter.execute('lookup-show',{source:'suggested',genre:'Science-Fiction'},f.context);
  assert.ok(science.matches.length>3);assert.ok(science.matches.every(show=>show.genres.includes('Science-Fiction')));
  const ended=await f.adapter.execute('lookup-show',{source:'suggested',status:'Ended'},f.context);assert.ok(ended.matches.every(show=>show.status==='Ended'));
  assert.equal(calls,0);assert.deepEqual(f.state(),before);assert.equal(f.events.length,0);
});
async function followFinder({shows=[],limit=20,save}={}){
  const config={revision:4,settings:{...structuredClone(settings),shows:structuredClone(shows)}};
  const service={id:'tv-calendar',config,settings:[{id:'shows',maxItems:limit}]};
  const context={kind:'tvcal-search',revision:4,settings:structuredClone(config.settings),selection:{operation:'add'},matches:[{id:'10',name:'First'},{id:'11',name:'Second'}]};
  const buttons=[0,1].map(index=>({dataset:{id:String(index)},textContent:'Follow',disabled:false})),submit={},counter={},error={hidden:true},calls=[],errors=[];
  let nextId=0;
  const sandbox={state:{services:[service]},dialogContext:context,structuredClone,PluginUI:{newItem:()=>({id:'new-'+(++nextId)})},showFormError:value=>errors.push(value),dialog:{querySelectorAll:()=>buttons,querySelector:selector=>selector==='#form-error'?error:selector==='[type="submit"]'?submit:counter},mutate:async(route,values)=>{
    calls.push(structuredClone({route,values}));
    if(save)return save({route,values,service});
    assert.equal(values.revision,service.config.revision);
    service.config={revision:values.revision+1,settings:structuredClone(values.settings)};
    return {services:[structuredClone(service)]};
  }};
  vm.createContext(sandbox);vm.runInContext(await fs.readFile('web/tv-calendar-ui.js','utf8'),sandbox);
  return {service,context,buttons,submit,counter,calls,errors,sandbox,follow:index=>vm.runInContext(`TVCalendarUI.follow(${index})`,sandbox)};
}
test('one-click Follow keeps results open and saves several shows with successive revisions',async()=>{
  const existing={id:'existing',name:'Existing','tvmaze-id':'1',enabled:false};
  const f=await followFinder({shows:[existing]});await f.follow(0);await f.follow(1);await f.follow(0);
  assert.equal(f.calls.length,2);assert.deepEqual(f.calls.map(call=>call.values.revision),[4,5]);
  assert.deepEqual(f.calls[1].values.settings.shows.map(show=>show['tvmaze-id']),['1','10','11']);
  assert.deepEqual(f.calls[1].values.settings.shows[0],existing);assert.equal(f.calls[1].values.settings['refresh-hours'],6);
  assert.equal(f.sandbox.dialogContext,f.context);assert.equal(f.context.revision,6);assert.equal(f.buttons[0].textContent,'Following');assert.equal(f.buttons[1].textContent,'Following');
  assert.equal(f.counter.textContent,'Following 3 of 20 shows');assert.ok(f.service.config.settings.shows.slice(1).every(show=>show.enabled));assert.deepEqual(f.errors,[]);
});
test('pending Follow ignores repeated clicks; capacity and conflicting edits cannot overwrite settings',async()=>{
  let finish;const f=await followFinder({save:()=>new Promise(resolve=>{finish=resolve;})});const pending=f.follow(0);await f.follow(0);await f.follow(1);
  assert.equal(f.calls.length,1);assert.ok(f.buttons.every(button=>button.disabled));
  const saved={revision:5,settings:structuredClone(f.calls[0].values.settings)};f.service.config=saved;finish({services:[{id:'tv-calendar',config:saved}]});await pending;
  const full=await followFinder({shows:[{id:'one','tvmaze-id':'1'}],limit:1});await full.follow(0);assert.equal(full.calls.length,0);assert.match(full.errors[0],/up to 1/);
  f.service.config={...f.service.config,revision:99};await f.follow(1);assert.equal(f.calls.length,1);assert.match(f.errors[0],/Settings changed/);
});
test('uncertain Follow response locks the result list until a fresh search without replaying a save',async()=>{
  const f=await followFinder({save:async()=>{throw Error('Connection lost');}});await f.follow(0);await f.follow(1);
  assert.equal(f.calls.length,1);assert.equal(f.context.invalid,true);assert.ok(f.buttons.every(button=>button.disabled));assert.equal(f.submit.disabled,false);assert.match(f.errors[0],/Search again/);
});
test('closing a finder during Follow does not update a replacement dialog or repeat the mutation',async()=>{
  let finish;const f=await followFinder({save:()=>new Promise(resolve=>{finish=resolve;})});const pending=f.follow(0);
  const replacement={kind:'another-dialog'};f.sandbox.dialogContext=replacement;
  finish({services:[{id:'tv-calendar',config:{revision:5,settings:f.calls[0].values.settings}}]});await pending;
  assert.equal(f.sandbox.dialogContext,replacement);assert.equal(f.calls.length,1);assert.equal(f.context.revision,4);
});
async function fixture(fetchImpl=async()=>new Response(JSON.stringify(data))){
 let clock=at,state={},events=[];const adapter=createTvCalendar({fetchImpl,now:()=>clock});await adapter.start(settings);
 const context={signal:new AbortController().signal,readState:async()=>structuredClone(state),saveState:async value=>{state=structuredClone(value);},emit:async(id,payload)=>events.push({id,payload,saved:structuredClone(state)})};
 return {adapter,context,state:()=>state,events,advance:ms=>{clock+=ms;}};
}
test('declaration validates and starts without any provider request',async()=>{const declaration=validateDeclaration(JSON.parse(await fs.readFile('plugins/tv-calendar/declaration.json')));assert.equal(declaration.id,'tv-calendar');const f=await fixture(()=>{throw Error('Network during startup');});assert.equal(f.state()['received-at'],undefined);await f.adapter.stop();});
test('airing claims commit before Events, repeat checks and restart never replay',async()=>{const f=await fixture();await f.adapter.execute('refresh',{},f.context);assert.equal(f.events.length,0);f.advance(60001);await f.adapter.execute('refresh',{},f.context);assert.equal(f.events.length,1);assert.equal(f.events[0].saved.emitted[0].id,'2');await f.adapter.execute('refresh',{},f.context);assert.equal(f.events.length,1);await f.adapter.stop();await f.adapter.start(settings);await f.adapter.execute('refresh',{},f.context);assert.equal(f.events.length,1);});
test('watched changes retain cache and corrupt history cannot be reset silently',async()=>{const f=await fixture();await f.adapter.execute('refresh',{},f.context);await f.adapter.execute('set-watched',{'episode-id':'2',watched:true},f.context);assert.deepEqual(f.state().watched,['2']);f.state().watched='bad';await assert.rejects(f.adapter.execute('refresh',{},f.context),/retained/);assert.equal(f.state().watched,'bad');});
test('provider failure retains cached listings and rate limit stops search',async()=>{let fail=false;const f=await fixture(async()=>fail?new Response('',{status:429,headers:{'retry-after':'3600'}}):new Response(JSON.stringify(data)));await f.adapter.execute('refresh',{},f.context);f.advance(1600);fail=true;await assert.rejects(f.adapter.execute('refresh-show',{'show-id':'1'},f.context),/retained/);assert.equal(f.state().shows['1'].name,'Example');await assert.rejects(f.adapter.execute('lookup-show',{query:'Example'},f.context),/cooling/);});
test('fixed origin and dated episode bounds are enforced',async()=>{await assert.rejects(readTvmaze('https://foreign.test',new AbortController().signal),/Unsupported/);const many=structuredClone(data);many._embedded.episodes=Array.from({length:500},(_,i)=>({id:i+1,name:'Episode',airstamp:new Date(at+(i-250)*86400000).toISOString()}));const parsed=episodes(many,at);assert.equal(parsed.items.length,100);assert.equal(parsed.limited,true);});

test('oversized bodies and aborted reads are rejected without redirects',async()=>{
  await assert.rejects(readTvmaze('/search/shows?q=example',new AbortController().signal,async(url,options)=>{
    assert.equal(options.redirect,'error');assert.equal(new URL(url).origin,'https://api.tvmaze.com');
    return new Response('x'.repeat(3*1024*1024+1));
  }),/too large/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(readTvmaze('/search/shows?q=example',controller.signal,async()=>new Response('[]')),/abort/i);
});

test('long pauses suppress catch-up and disabled shows keep watched metadata without exposing upcoming rows',async()=>{
  const f=await fixture();await f.adapter.execute('refresh',{},f.context);f.advance(600000);
  await f.adapter.execute('refresh',{},f.context);assert.equal(f.events.length,0);
  await f.adapter.stop();await f.adapter.start({...settings,shows:settings.shows.map(show=>({...show,enabled:false}))});
  await f.adapter.execute('refresh',{},f.context);assert.ok(f.state().shows['1']);assert.equal(f.state()['row-count'],0);
});

test('isolated worker exposes typed Cards and setup actions stay outside Task capabilities',async t=>{
  const base=path.resolve('tests/.tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'tv-calendar-'));
  await fs.cp('plugins/tv-calendar',path.join(root,'plugins/tv-calendar'),{recursive:true,filter:file=>!file.split(path.sep).includes('data')});
  const app=await createLocalserve(root,{automatic:false});t.after(async()=>{await app.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  const record=app.registry.get('tv-calendar');
  await app.registry.saveConfiguration('tv-calendar',{revision:record.config.snapshot().revision,enabled:true});
  await app.registry.execute('tv-calendar','refresh',{});
  const actions=app.registry.actions();assert.ok(actions.some(action=>action.pluginId==='tv-calendar'&&action.actionId==='refresh'));
  assert.ok(!actions.some(action=>action.pluginId==='tv-calendar'&&action.actionId==='set-watched'));
  const card=app.registry.cardSource('tv-calendar');assert.equal(card.cardData.values['row-count'].value,0);
  assert.equal(card.cardData.values.tonight.type,'table');
  assert.equal(app.registry.events().find(event=>event.pluginId==='tv-calendar').payload.find(field=>field.id==='episode-title').type,'string');
});
