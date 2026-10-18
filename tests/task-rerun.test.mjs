/** Explicit reruns use retained server history, never caller-supplied payloads.
 * Fixtures own their loopback server and synthetic actions; no TV is contacted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createLocalserve} from '../server.mjs';

const source = {id:'event:one',pluginId:'example',eventId:'changed',instanceId:'one',instanceKey:'source-id',payload:[
  {id:'source-id',type:'string',required:true,maxLength:20},
  {id:'title',type:'string',required:true,maxLength:100},
  {id:'value',type:'number',required:true}, {id:'enabled',type:'boolean',required:true},
  {id:'private',type:'string',format:'secret'},
]};
const action = {id:'plugin:target:record',pluginId:'target',actionId:'record',available:true,
  parameters:[{id:'message',type:'string',required:true,maxLength:1000}]};

async function fixture(t) {
  const base=fileURLToPath(new URL('./.tmp/',import.meta.url));
  await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'task-rerun-'));
  const app=await createLocalserve(root,{automatic:false});
  const effects=[];
  app.registry.events=()=>[source];
  app.registry.actions=()=>[action];
  app.registry.execute=async(_plugin,_action,values)=>effects.push(structuredClone(values));
  const call=async(route,values,headers={})=>{
    const response=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,
      'Content-Type':'application/json','X-Localserve-Token':app.snapshot().token,...headers},body:JSON.stringify(values)});
    return {status:response.status,body:await response.json()};
  };
  const settle=async()=>{
    const until=Date.now()+2000;
    while(app.engine.active.size||app.engine.pending.size){
      if(Date.now()>until)throw new Error('Task did not finish');
      await new Promise(resolve=>setTimeout(resolve,5));
    }
  };
  t.after(async()=>{await app.close();assert.ok(path.resolve(root).startsWith(path.resolve(base)+path.sep));await fs.rm(root,{recursive:true,force:true});});
  return {app,call,effects,settle};
}

const definition=()=>({name:'Saved Event test',enabled:true,starts:[{id:'rule',type:'event',name:'Event',enabled:false,eventId:source.id}],steps:[
  {id:'log',type:'log',enabled:true,message:'{{event.title}} / {{event.value}} / {{event.enabled}}'},
  {id:'delay',type:'delay',enabled:true,seconds:.04},
  {id:'record',type:'plugin',enabled:true,capabilityId:action.id,parameters:{message:'{{event.title}}'}},
]});

test('manual Event runs and reruns capture public history and execute the current definition from step one',async t=>{
  const f=await fixture(t);
  await f.call('/api/tasks',definition());
  let task=f.app.tasks.snapshot()[0];
  await f.app.state.update(state=>state.runs.push({id:'saved-event',taskId:'old-task',name:'Previous source',status:'completed',startedAt:1,
    event:{pluginId:'example',eventId:'changed',privateMeta:'not-public',payload:{'source-id':'one',title:'Original',value:0,enabled:false,private:'not-public'},occurredAt:1,trace:['example:changed']}}));
  const first=await f.call(`/api/tasks/${task.id}/run`,{revision:task.revision,eventRunId:'saved-event'});
  assert.equal(first.status,202,JSON.stringify(first.body));
  const run=first.body.run;
  assert.equal(run.event.payload.private,undefined);
  assert.equal(run.event.privateMeta,undefined);
  assert.equal(run.eventRunId,'saved-event');
  f.app.registry.events=()=>[{...source,payload:[...source.payload,{id:'added',type:'number',default:42}]}];
  const captured=f.app.engine.capturedEvent(f.app.state.snapshot().runs.find(item=>item.id===run.id),task);
  assert.equal(captured.payload.added,undefined,'New defaults are not historical observations.');
  f.app.registry.events=()=>[source];
  await f.app.state.update(state=>{state.runs.find(run=>run.id==='saved-event').event.payload.title='Changed later';});
  await f.settle();
  assert.deepEqual(f.effects,[{message:'Original'}]);
  assert.ok(f.app.activity.latest(100).some(entry=>entry.message==='Original / 0 / false'));
  const changed={...task,steps:task.steps.map(step=>step.type==='log'?{...step,message:'Current {{event.title}}'}:step)};
  assert.equal((await f.call(`/api/tasks/${task.id}`,changed)).status,200);
  assert.equal((await f.call(`/api/runs/${run.id}/rerun`,{revision:task.revision})).status,409);
  task=f.app.tasks.snapshot()[0];
  const repeated=await f.call(`/api/runs/${run.id}/rerun`,{revision:task.revision});
  assert.equal(repeated.status,202);
  assert.notEqual(repeated.body.run.id,run.id);
  assert.equal(repeated.body.run.rerunOf,run.id);
  assert.equal(repeated.body.run.taskRevision,task.revision);
  assert.equal((await f.call(`/api/runs/${run.id}/rerun`,{revision:task.revision})).status,409,'An active Task cannot overlap itself.');
  await f.settle();
  assert.deepEqual(f.effects,[{message:'Original'},{message:'Original'}]);
  assert.ok(f.app.activity.latest(100).some(entry=>entry.message==='Current Original'));
  await f.app.state.update(state=>{state.eventConditions={sentinel:{matched:true}};});
  await f.app.engine.rerun(run.id,{revision:task.revision});await f.settle();
  assert.deepEqual(f.app.state.snapshot().eventConditions,{sentinel:{matched:true}},'Manual rerun never rewinds automatic Event claims.');
});

test('rerun boundaries reject injected values, stale/missing history, pause, disabled Tasks and unavailable schemas',async t=>{
  const f=await fixture(t);
  await f.call('/api/tasks',definition());
  const task=f.app.tasks.snapshot()[0];
  await f.app.state.update(state=>state.runs.push({id:'saved',taskId:task.id,status:'completed',event:{pluginId:'example',eventId:'changed',
    payload:{'source-id':'one',title:'Original',value:1,enabled:true}}}));
  const route='/api/runs/saved/rerun', values={revision:task.revision};
  assert.equal((await f.call(route,{...values,event:{payload:{title:'Injected'}}})).status,400);
  assert.equal((await f.call(`/api/tasks/${task.id}/run`,{...values,event:{payload:{title:'Injected'}}})).status,400);
  assert.equal((await f.call(route,values,{Origin:'https://outside.example'})).status,403);
  assert.equal((await f.call(route,values,{'X-Localserve-Token':'wrong'})).status,403);
  assert.equal((await f.call('/api/runs/missing/rerun',values)).status,404);
  await f.app.engine.setPaused(true);
  assert.equal((await f.call(route,values)).status,409);await f.app.engine.setPaused(false);
  await f.app.tasks.update(items=>{items[0].enabled=false;});
  assert.equal((await f.call(route,values)).status,409);
  await f.app.tasks.update(items=>{items[0].enabled=true;});
  f.app.registry.events=()=>[];
  assert.equal((await f.call(route,values)).status,409);
  f.app.registry.events=()=>[{...source,payload:source.payload.map(field=>field.id==='title'?{...field,format:'secret'}:field)}];
  assert.equal((await f.call(route,values)).status,409);
  assert.equal(f.effects.length,0);
  f.app.registry.events=()=>[source];
  await f.app.state.update(state=>{state.runs.find(run=>run.id==='saved').event.payload=null;});
  assert.equal((await f.call(route,values)).status,409);
  await f.app.tasks.update(items=>items.splice(0));
  assert.equal((await f.call(route,values)).status,404);
});

test('run rows offer Rerun for finished enabled Tasks and explain unavailable states',async()=>{
  const script=await fs.readFile(new URL('../web/app.js',import.meta.url),'utf8');
  const state={paused:false,tasks:[{id:'task',enabled:true,revision:4}],runs:[{id:'run',taskId:'task',name:'Example',reason:'Manual',status:'completed',startedAt:1}]};
  const runUI=vm.runInNewContext(await fs.readFile(new URL('../web/run-ui.js',import.meta.url),'utf8')+'\nRunUI;',{
    document:{addEventListener(){}},state,escapeHtml:String,icon:()=>'',formatServerTimestamp:()=>'',
  });
  const panel=vm.runInNewContext(script.slice(script.indexOf('function runsPanel()'),script.indexOf('function renderSettings()'))+'\nrunsPanel;',{
    state,RunUI:runUI,escapeHtml:String,icon:()=>'',statusPill:()=>'',formatServerTimestamp:()=>'',
  });
  assert.match(panel(),/data-action="task-rerun"/);
  assert.match(panel(),/data-revision="4"/);
  state.tasks[0].enabled=false;assert.match(panel(),/Enable the Task to rerun it/);
  state.tasks=[];assert.match(panel(),/Task has been deleted/);
  state.runs[0].status='running';assert.match(panel(),/cancel-run/);assert.doesNotMatch(panel(),/task-rerun/);
});
