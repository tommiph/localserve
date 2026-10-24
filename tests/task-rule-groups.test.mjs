/** Disposable producers and log-only Tasks verify logical grouping without devices. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createLocalserve} from '../server.mjs';
import {validateTask} from '../server/tasks.mjs';
import {AndRuleGroups,groupSignature} from '../server/task-rule-groups.mjs';
const rule=(id,eventId,field,value,operator='eq')=>({id,type:'event',name:id,enabled:true,eventId:'plugin:source:event:'+eventId,condition:{field,operator,value}});
const draft=(starts,extra={})=>({name:'AND Task',enabled:true,ruleMode:'and',starts,steps:[{id:'log',type:'log',enabled:true,message:'Matched'}],...extra});
async function fixture(t) {
  const base=path.resolve('tests/.tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'and-rules-'));
  await fs.mkdir(path.join(root,'plugins/source'),{recursive:true});
  await fs.writeFile(path.join(root,'plugins/source/declaration.json'),JSON.stringify({id:'source',name:'Source',events:[
    {id:'network',name:'Network',payload:[{id:'connected',type:'boolean'}]},
    {id:'light',name:'Light',payload:[{id:'lux',type:'number'}]},
    {id:'video',name:'Video',occurrenceKey:'release',payload:[{id:'title',type:'string'},{id:'release',type:'string',required:true}]}
  ]}));
  let app=await createLocalserve(root,{automatic:false});
  await app.registry.saveConfiguration('source',{revision:1,enabled:true});
  const ready=()=>{const r=app.registry.records.get('source');r.configured=true;r.health='ready';};ready();
  t.after(async()=>{await app.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  const settle=async()=>{const deadline=Date.now()+5000;while(app.engine.pending.size||app.engine.active.size){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));}};
  const post=async(route,body)=>{const r=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Localserve-Token':app.snapshot().token},body:JSON.stringify(body)});assert.equal(r.status,200,await r.text());};
  const emit=async(id,payload)=>{await app.engine.emitPluginEvent('source',id,payload);await settle();};
  return {get app(){return app;},post,emit,settle,ready,runs:()=>app.state.snapshot().runs.length,restart:async()=>{await app.close();app=await createLocalserve(root,{automatic:false});ready();}};
}
const pair=()=>[rule('wifi','network','connected',true),rule('dark','light','lux',50,'lt')];

test('AND phone comparisons expire across offline, reconnect and session changes while offline presence stays usable',()=>{
  let device={online:true,sessionId:'first',transitionId:'one'};
  const network={id:'network',eventId:'phone-network',pluginId:'sensors',instanceId:'phone',instanceEnabled:true};
  const offline={...network,id:'offline',eventId:'device-offline'};
  const record={plugin:{runtime:{ingest:'sensors-v1'}},runtime:{},pollGeneration:1,health:'ready',configured:true,
    config:{snapshot:()=>({enabled:true})},state:{snapshot:()=>({devices:{phone:device}})}};
  const start={id:'wifi',enabled:true,type:'event',eventId:'network'},task=draft([start]);task.id='task';
  const groups=new AndRuleGroups({registry:{events:()=>[network,offline],records:new Map([['sensors',record]])}});
  const cache={signature:groupSignature(task),values:new Map([[start.id,{...groups.source(start),matched:true}]])};
  groups.observations.set(task.id,cache);assert.equal(groups.comparison(task,start),true);
  device={...device,online:false,transitionId:'lost'};
  assert.equal(groups.comparison(task,start),null);assert.ok(groups.source({eventId:'offline'}));
  device={...device,online:true,transitionId:'resumed'};
  assert.equal(groups.comparison(task,start),null,'Reconnection must not revive a retained comparison');
  assert.equal(groups.source({eventId:'offline'}),null,'An old offline condition is unavailable after reconnect');
  cache.values.set(start.id,{...groups.source(start),matched:true});assert.equal(groups.comparison(task,start),true);
  device={...device,sessionId:'second'};assert.equal(groups.comparison(task,start),null);
});

test('ruleMode validates AND/OR and preserves legacy definitions and comparison requirements',()=>{
  const events=[{id:'plugin:source:event:network',payload:[{id:'connected',type:'boolean'}]}];
  const original=draft([rule('wifi','network','connected',true)]);delete original.ruleMode;
  assert.equal(validateTask(original,null,[],events).ruleMode,undefined);
  assert.equal(validateTask({...original,ruleMode:'and'},null,[],events).ruleMode,'and');
  for(const ruleMode of [null,'xor',true,0])assert.throws(()=>validateTask({...original,ruleMode},null,[],events),/AND or OR/);
  const noComparison={...original,ruleMode:'and',starts:[{...original.starts[0],condition:undefined}]};
  assert.throws(()=>validateTask(noComparison,null,[],events),/comparison/);
  assert.equal(validateTask({...noComparison,ruleMode:'or'},null,[],events).ruleMode,'or');
});

test('AND combines reports, handles zero/unknowns and rearms after false without merging payloads',async t=>{
  const f=await fixture(t);await f.post('/api/tasks',draft(pair()));
  await f.emit('network',{connected:true});assert.equal(f.runs(),0);
  await f.emit('light',{lux:0});assert.equal(f.runs(),1);
  assert.deepEqual(f.app.state.snapshot().runs[0].event.payload,{lux:0});
  await f.emit('light',{lux:1});await f.emit('network',{connected:true});assert.equal(f.runs(),1);
  await f.emit('light',{});await f.emit('network',{connected:true});assert.equal(f.runs(),1);
  await f.emit('light',{lux:2});assert.equal(f.runs(),1,'Unknown does not rearm');
  await f.emit('network',{connected:false});await f.emit('network',{connected:true});assert.equal(f.runs(),2);
  const group=Object.values(f.app.state.snapshot().ruleGroups)[0];
  assert.deepEqual(Object.keys(group).sort(),['matched','signature'],'Reports are not copied into durable group state');
});

test('AND evaluates comparisons from one report atomically and deduplicates discrete occurrences',async t=>{
  const f=await fixture(t);
  await f.post('/api/tasks',draft([rule('tesla','video','title','tesla','contains'),rule('review','video','title','review','contains')]));
  await f.emit('video',{title:'Tesla review',release:'one'});assert.equal(f.runs(),1);
  await f.emit('video',{title:'Tesla review',release:'one'});assert.equal(f.runs(),1);
  await f.emit('video',{title:'Tesla review',release:'two'});assert.equal(f.runs(),2);
  await f.emit('video',{title:'Tesla only',release:'three'});assert.equal(f.runs(),2);
  await f.emit('video',{title:'Review only',release:'four'});assert.equal(f.runs(),2,'No mixed old/new comparison results');
});

test('AND restores no cached reports or duplicate run after restart and invalidates reconfigured sources',async t=>{
  const f=await fixture(t);await f.post('/api/tasks',draft(pair()));
  await f.emit('network',{connected:true});await f.emit('light',{lux:5});assert.equal(f.runs(),1);
  await f.restart();await f.emit('light',{lux:2});assert.equal(f.runs(),1);
  await f.emit('network',{connected:true});assert.equal(f.runs(),1,'Durable true claim prevents restart replay');
  const record=f.app.registry.records.get('source');record.pollGeneration++;
  await f.emit('network',{connected:false});await f.emit('light',{lux:1});assert.equal(f.runs(),1);
  record.pollGeneration++;
  await f.emit('network',{connected:true});assert.equal(f.runs(),1,'Other comparison needs a new report');
  await f.emit('light',{lux:3});assert.equal(f.runs(),2);
});

test('AND timers consume blocked occurrences and intervals wait for their next due time',async t=>{
  const f=await fixture(t),start=new Date();
  await f.post('/api/tasks',draft([rule('wifi','network','connected',true),{id:'timer',name:'Timer',type:'timer',enabled:true,seconds:1}]));
  await f.app.engine.tick(new Date(start.getTime()+2000));await f.settle();assert.equal(f.runs(),0);
  await f.emit('network',{connected:true});await f.app.engine.tick(new Date(start.getTime()+4000));await f.settle();assert.equal(f.runs(),0);
  await f.post('/api/tasks',draft([rule('wifi','network','connected',true),{id:'repeat',name:'Interval',type:'interval',enabled:true,seconds:1}],{name:'Interval AND'}));
  await f.emit('network',{connected:true});await f.app.engine.tick(new Date(Date.now()+2000));await f.settle();assert.equal(f.runs(),1);
});

test('AND schedules must coincide; disabled rules do not gate and OR behavior is unchanged',async t=>{
  const f=await fixture(t),date=new Date(2030,4,6,12,0),clock=(id,time)=>({id,name:id,type:'schedule',enabled:true,days:[date.getDay()],time});
  await f.post('/api/tasks',draft([clock('one','12:00'),clock('two','12:00')],{name:'Coincide'}));
  await f.post('/api/tasks',draft([clock('one','12:00'),clock('two','13:00')],{name:'Different'}));
  await f.app.engine.tick(date);await f.settle();assert.equal(f.runs(),1);
  await f.app.engine.tick(date);await f.settle();assert.equal(f.runs(),1);
  await f.app.engine.tick(new Date(2030,4,6,13,0));await f.settle();assert.equal(f.runs(),1);
  await f.post('/api/tasks',draft(pair().map((r,i)=>({...r,enabled:i===0})),{name:'Disabled condition'}));
  await f.emit('network',{connected:true});assert.equal(f.runs(),2);
  await f.post('/api/tasks',draft(pair(),{name:'Any condition',ruleMode:'or'}));
  await f.emit('light',{lux:1});assert.equal(f.runs(),3);
});

test('concurrent AND reports claim once; a failed durable claim starts no work',async t=>{
  const f=await fixture(t);await f.post('/api/tasks',draft(pair()));
  await Promise.all([f.emit('network',{connected:true}),f.emit('light',{lux:2})]);assert.equal(f.runs(),1);
  await f.emit('network',{connected:false});
  const write=f.app.state.write.bind(f.app.state);let fail=true;
  f.app.state.write=async value=>{if(fail && Object.values(value.ruleGroups||{}).some(g=>g.matched===true)){fail=false;throw Error('Claim write failed');}return write(value);};
  await assert.rejects(f.emit('network',{connected:true}),/Claim write failed/);assert.equal(f.runs(),1);
  await f.emit('network',{connected:true});assert.equal(f.runs(),2);
});

test('pause and edited AND comparisons invalidate cached reports without replay',async t=>{
  const f=await fixture(t);await f.post('/api/tasks',draft(pair()));
  await f.emit('network',{connected:true});await f.emit('light',{lux:1});assert.equal(f.runs(),1);
  await f.app.engine.setPaused(true);await f.app.engine.setPaused(false);
  await f.emit('network',{connected:false});await f.emit('network',{connected:true});assert.equal(f.runs(),1,'Paused reports are not retained');
  await f.emit('light',{lux:3});assert.equal(f.runs(),2);
  const task=f.app.tasks.snapshot()[0];task.starts[1].condition.value=10;
  await f.post('/api/tasks/'+task.id,task);
  await f.emit('light',{lux:2});assert.equal(f.runs(),2,'An edited group needs fresh reports for all comparisons');
  await f.emit('network',{connected:true});assert.equal(f.runs(),3);
});

test('a queued AND report cannot become a fresh report after producer reconfiguration',async t=>{
  const f=await fixture(t);await f.post('/api/tasks',draft(pair()));
  let release;f.app.engine.andRules.queue=new Promise(resolve=>{release=resolve;});
  const pending=f.app.engine.emitPluginEvent('source','network',{connected:true});
  f.app.registry.records.get('source').pollGeneration++;release();await pending;
  await f.emit('light',{lux:1});assert.equal(f.runs(),0);
  await f.emit('network',{connected:true});assert.equal(f.runs(),1);
});

test('Task editor preserves AND on edit/copy, defaults to OR and gates unsupported backends',async()=>{
  const vm=await import('node:vm');let html='';
  const task={...draft([]),id:'example',revision:1};
  const context={state:{tasks:[task],services:[],taskEvents:[],server:{taskRuleModes:['or','and']}},actionCatalog:[],document:{addEventListener(){}},dialog:{querySelector(){return null;}},
    crypto:{randomUUID:()=> 'new-id'},escapeHtml:value=>String(value??''),icon:()=>'',showDialog:value=>{html=value;},dialogHeader:()=>'',dialogFooter:()=>''};
  const ui=vm.runInNewContext(await fs.readFile('web/tasks-ui.js','utf8')+';TaskUI;',context);ui.numberCards=()=>{};
  ui.openEditor('example');assert.match(html,/value="and" selected/);assert.doesNotMatch(html,/value="and" selected disabled/);
  ui.openEditor('example',true);assert.match(html,/value="and" selected/);assert.doesNotMatch(html,/name="enabled" type="checkbox" checked/);
  ui.openEditor();assert.match(html,/value="or" selected/);
  context.state.server={};ui.openEditor('example');assert.match(html,/value="and" selected disabled/);
});

test('named action ID fields cannot shadow editor identity, dirty tracking or submit routing',async()=>{
  const vm=await import('node:vm'),source=await fs.readFile('web/app.js','utf8');
  const identity=source.slice(source.indexOf('function formIdentifier('),source.indexOf('function serializeForm('));
  const serializer=source.slice(source.indexOf('function serializeForm('),source.indexOf('function requestDialogClose('));
  const definition=source.slice(source.indexOf('function isDefinitionEditor('),source.indexOf('function updateDraftStatus('));
  const form={id:{value:'app-id'},attributes:{id:'editor-form'},matches:()=>false};let submitted=0,handler;
  const context={Element:{prototype:{getAttribute(name){return this.attributes[name];}}},FormData:class{entries(){return [['id','app-id'],['ruleMode','and']];}},
    dialogContext:{kind:'task'},TaskUI:{submit(value){assert.equal(value,form);submitted++;}},document:{addEventListener(type,callback){if(type==='submit')handler=callback;}}};
  const scope=vm.createContext(context);vm.runInContext(identity+serializer+definition,scope);
  scope.form=form;assert.equal(vm.runInContext('isDefinitionEditor(form)',scope),true);
  assert.match(vm.runInContext('serializeForm(form)',scope),/ruleMode.*and/);
  const start=source.indexOf("document.addEventListener('submit',"),end=source.indexOf("document.addEventListener('input',",start);
  vm.runInContext(source.slice(start,end),scope);await handler({target:form,preventDefault(){}});assert.equal(submitted,1);
});
