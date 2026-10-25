/** Nested Tasks execute on an isolated server with synthetic effects only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createLocalserve} from '../server.mjs';
import {assertTaskLinks, validateTask} from '../server/tasks.mjs';

const log = (id,message=id) => ({id,type:'log',enabled:true,message});
const call = (taskId,id='call') => ({id,type:'run-task',enabled:true,taskId});
const delay = seconds => ({id:'wait',type:'delay',enabled:true,seconds});
const definition = (name,steps) => ({name,enabled:true,starts:[],steps});
async function until(check) {
  const end=Date.now()+5000;
  while(!check()){if(Date.now()>end)throw Error('Task did not settle');await new Promise(resolve=>setTimeout(resolve,5));}
}
async function fixture(t) {
  const base=new URL('./.tmp/',import.meta.url);await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(new URL('task-calls-',base));
  const app=await createLocalserve(root,{automatic:false});
  t.after(async()=>{await app.close();assert.equal(path.dirname(root),path.resolve(fileURLToPath(base)));await fs.rm(root,{recursive:true,force:true});});
  const request=async(route,values)=>{
    const response=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Localserve-Token':app.snapshot().token},body:JSON.stringify(values)});
    return {status:response.status,body:await response.json()};
  };
  const save=async value=>{const reply=await request('/api/tasks',value);assert.equal(reply.status,200,JSON.stringify(reply.body));return app.tasks.snapshot().find(task=>task.name===value.name);};
  const settle=()=>until(()=>!app.engine.active.size&&!app.engine.pending.size);
  const runFor=id=>app.state.snapshot().runs.find(run=>run.taskId===id);
  return {app,request,save,settle,runFor};
}

test('Run task waits, shares one root slot, keeps receipts and rejects overlapping target execution',async t=>{
  const f=await fixture(t);await f.app.config.update(config=>{config.maxConcurrentRuns=1;});
  const child=await f.save(definition('Child',[log('child-first'),delay(0.12),log('child-last')]));
  const parent=await f.save(definition('Parent',[log('parent-first'),call(child.id),log('parent-last')]));
  const other=await f.save(definition('Other',[log('other')]));
  const admitted=await f.app.engine.start(parent.id);
  await until(()=>f.app.engine.active.size===2);
  assert.equal(f.app.engine.rootRunCount(),1);
  await assert.rejects(f.app.engine.start(other.id),/concurrent/);
  await assert.rejects(f.app.engine.start(child.id),/already running/);
  assert.equal(f.runFor(parent.id).steps[1].status,'running');
  assert.equal(f.runFor(parent.id).steps[2].status,'pending');
  await f.settle();
  assert.equal(f.runFor(parent.id).status,'completed');assert.equal(f.runFor(child.id).status,'completed');
  assert.equal(f.runFor(child.id).parentRunId,admitted.id);
  assert.equal(f.runFor(parent.id).steps[1].childRunId,f.runFor(child.id).id);
  assert.equal(f.runFor(parent.id).steps[1].childTaskName,'Child');
  const messages=f.app.activity.latest(100).map(row=>row.message);
  for(const message of ['parent-first','child-first','child-last','parent-last'])assert.ok(messages.includes(message));
  assert.ok(f.runFor(parent.id).steps[2].startedAt>=f.runFor(child.id).finishedAt);
});

test('missing, disabled, circular and excessive-depth calls reject before parent effects',async t=>{
  const f=await fixture(t),child=await f.save(definition('Child',[log('child')]));
  const parent=await f.save(definition('Parent',[log('must-not-run'),call(child.id)]));
  assert.equal((await f.request('/api/tasks/'+child.id,{...child,steps:[call(parent.id)]})).status,400);
  assert.equal((await f.request('/api/tasks/'+parent.id,{...parent,steps:[call(parent.id)]})).status,400);
  assert.equal((await f.request('/api/tasks',definition('Missing',[call('missing')]))).status,400);
  await f.app.tasks.update(tasks=>{tasks.find(task=>task.id===child.id).enabled=false;});
  await assert.rejects(f.app.engine.start(parent.id),/disabled/);
  await f.app.tasks.update(tasks=>{tasks.splice(tasks.findIndex(task=>task.id===child.id),1);});
  await assert.rejects(f.app.engine.start(parent.id),/not found/);
  assert.equal(f.app.state.snapshot().runs.length,0);
  // A missing saved reference survives unrelated edits, while remaining blocked.
  assert.equal((await f.request('/api/tasks/'+parent.id,{...parent,name:'Renamed'})).status,200);
  const chain=Array.from({length:9},(_,index)=>({id:'level-'+index,steps:index===8?[log('end')]:[call('level-'+(index+1))]}));
  assert.throws(()=>assertTaskLinks(chain[0],chain),/eight levels/);
  chain[7].steps=[log('end')];assert.doesNotThrow(()=>assertTaskLinks(chain[0],chain));
  await f.app.tasks.update(tasks=>{tasks.splice(0,tasks.length,...chain.map(task=>({...task,name:task.id,enabled:true,starts:[],revision:1})));tasks[7].steps=[call('level-0')];});
  await assert.rejects(f.app.engine.start('level-0'),/loop/);
});

test('parent cancellation reaches its child; child failure or cancellation stops following parent steps',async t=>{
  const f=await fixture(t),child=await f.save(definition('Child',[delay(10),log('not-run')]));
  const parent=await f.save(definition('Parent',[call(child.id),log('parent-not-run')]));
  const run=await f.app.engine.start(parent.id);await until(()=>f.app.engine.active.size===2);
  f.app.engine.cancel(run.id);await f.settle();
  assert.equal(f.runFor(child.id).status,'cancelled');assert.equal(f.runFor(parent.id).status,'cancelled');
  assert.equal(f.runFor(parent.id).steps[1].status,'not-run');
  await f.app.engine.start(parent.id);await until(()=>f.app.engine.active.size===2);
  f.app.engine.cancel(f.runFor(child.id).id);await f.settle();
  assert.equal(f.runFor(parent.id).status,'failed');assert.equal(f.runFor(parent.id).steps[1].status,'not-run');
  f.app.registry.actions=()=>[{id:'plugin:fake:fail',pluginId:'fake',actionId:'fail',available:true,parameters:[]}];
  f.app.registry.execute=async()=>{throw Error('Synthetic failure');};
  await f.app.tasks.update(tasks=>{tasks.find(task=>task.id===child.id).steps=[{id:'fail',type:'plugin',capabilityId:'plugin:fake:fail',enabled:true,parameters:{}}];});
  await f.app.engine.start(parent.id);await f.settle();
  assert.equal(f.runFor(child.id).status,'failed');assert.equal(f.runFor(parent.id).status,'failed');
  assert.equal(f.runFor(parent.id).steps[1].status,'not-run');
});

test('pause suspends nested Delay and a changed target is rechecked at the call boundary',async t=>{
  const f=await fixture(t),child=await f.save(definition('Child',[delay(0.15),log('child')]));
  const parent=await f.save(definition('Parent',[call(child.id),log('parent')]));
  await f.app.engine.start(parent.id);await until(()=>f.runFor(child.id)?.steps[0].status==='running');
  await f.app.engine.setPaused(true);await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(f.runFor(parent.id).status,'running');assert.equal(f.runFor(child.id).steps[1].status,'pending');
  await f.app.engine.setPaused(false);await f.settle();
  await f.app.tasks.update(tasks=>{tasks.find(task=>task.id===parent.id).steps=[delay(0.12),call(child.id),log('later')];});
  await f.app.engine.start(parent.id);await until(()=>f.runFor(parent.id)?.steps[0].status==='running');
  await f.app.tasks.update(tasks=>{tasks.find(task=>task.id===child.id).enabled=false;});
  await f.settle();assert.equal(f.runFor(parent.id).status,'failed');assert.equal(f.runFor(parent.id).steps[2].status,'not-run');
});

test('nested Tasks inherit captured values and automatic TV quiet-hours behavior, bypassing their start rules',async t=>{
  const f=await fixture(t),source={id:'video',pluginId:'example',eventId:'new',payload:[{id:'title',type:'string',required:true,maxLength:80}]};
  f.app.registry.events=()=>[source];
  const tv={id:'plugin:samsung-tv:launch-app',pluginId:'samsung-tv',actionId:'launch-app',available:true,parameters:[]};
  f.app.registry.actions=()=>[tv];let effects=0;f.app.registry.execute=async()=>{effects++;};
  const child=await f.save({...definition('Child',[log('value','Video {{event.title}}'),{id:'tv',type:'plugin',enabled:true,capabilityId:tv.id,parameters:{}}]),starts:[{id:'event',type:'event',name:'Video',enabled:false,eventId:'video'}]});
  const parent=await f.save(definition('Parent',[call(child.id),log('after')]));
  await assert.rejects(f.app.engine.start(parent.id),/triggering event value/);
  await f.app.config.update(config=>{config.doNotDisturb={...config.doNotDisturb,enabled:true};});
  const event={pluginId:'example',eventId:'new',payload:{title:'Original'},trace:[]};
  await f.app.engine.start(parent.id,'Automatic',event,{automatic:true});event.payload.title='Changed';await f.settle();
  assert.equal(f.runFor(child.id).event.payload.title,'Original');assert.equal(f.runFor(child.id).automatic,true);
  assert.equal(f.runFor(child.id).steps[1].reason,'Do not disturb');assert.equal(effects,0);
  const previous=f.runFor(parent.id);assert.equal(f.app.engine.previewRerun(previous.id,{}).manualTvEffects,true);
  await f.app.engine.manualStart(parent.id,{eventRunId:previous.id});await f.settle();assert.equal(effects,1);
  assert.equal(f.runFor(child.id).automatic,false);assert.equal(f.runFor(child.id).status,'completed');
});

test('editor offers an escaped Task selector, retains missing targets and serializes nested steps',async()=>{
  const context={state:{tasks:[{id:'self',name:'Self',enabled:true,steps:[]},{id:'child',name:'Child <name>',enabled:false,steps:[]}]},document:{addEventListener(){}},crypto:{randomUUID:()=> 'field'},escapeHtml:value=>String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),icon:()=>''};
  vm.createContext(context);vm.runInContext(await fs.readFile(new URL('../web/tasks-ui.js',import.meta.url),'utf8')+'\nthis.ui=TaskUI;',context);
  context.ui.editorTaskId='self';const html=context.ui.stepFields(call('child'));
  assert.match(html,/name="taskId"/);assert.match(html,/Child &lt;name&gt; \(Disabled\)/);assert.doesNotMatch(html,/value="self"/);
  assert.match(context.ui.stepFields(call('missing')),/Unavailable item/);
  assert.match(context.ui.validateCard(call('')),/Select a Task/);
  const values={blockId:'step',blockEnabled:'true',taskId:'child'};
  const read=context.ui.readCard({dataset:{blockType:'run-task',group:'step'},querySelector:selector=>({value:values[selector.match(/name="(.*?)"/)[1]]})});
  assert.equal(read.type,'run-task');assert.equal(read.taskId,'child');
});
