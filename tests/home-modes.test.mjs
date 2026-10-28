/** Home modes use disposable plugin roots and local Tasks; no device is contacted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createLocalserve} from '../server.mjs';
import {validateTask} from '../server/tasks.mjs';

async function fixture(t,simulator=false){
  const base=path.resolve('tests/.tmp');await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'home-modes-'));
  for(const id of ['home-modes',...(simulator?['simulator']:[])])
    await fs.cp('plugins/'+id,path.join(root,'plugins',id),{recursive:true,filter:source=>!source.includes(path.sep+'data')});
  const app=await createLocalserve(root,{automatic:false});
  t.after(async()=>{await app.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  const record=()=>app.registry.get('home-modes');
  const modes=[['home','Home','home','#69bda7'],['away','Away','door-open','#dbb06d'],['evening','Evening','sun','#c99cd8'],['night','Night','moon','#8fa5dd']].map(([id,name,icon,color])=>({id,name,icon,color,'task-id':'',enabled:true}));
  await app.registry.saveConfiguration('home-modes',{revision:record().config.snapshot().revision,enabled:true,settings:{modes}});
  return {app,root,record};
}
async function addTask(app,{id='bound',starts=[],steps,ruleMode='or'}={}){
  const task=validateTask({name:id,enabled:true,ruleMode,starts,
    steps:steps||[{id:'log',type:'log',enabled:true,message:'Mode entered'}]},null,
    app.registry.actions(),app.registry.events(),app.tasks.snapshot());
  task.id=id;await app.tasks.update(items=>items.push(task));return task;
}
async function bind(record,app,bindings){
  const cfg=record().config.snapshot();
  for(const mode of cfg.settings.modes)mode['task-id']=bindings[mode.id]||'';
  await app.registry.saveConfiguration('home-modes',{revision:cfg.revision,settings:cfg.settings});
}
async function settled(app){
  for(let i=0;i<100;i++){if(!app.engine.active.size)return;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.fail('Local Tasks did not finish within the test bound.');
}
const modeRule={id:'mode',name:'Home mode',type:'event',enabled:true,eventId:'plugin:home-modes:event:mode-changed',condition:{field:'mode-id',operator:'eq',value:'home'}};

test('mode selection persists, reselect is inert and restart restores no Events or assigned Task',async t=>{
  const {app,root,record}=await fixture(t),task=await addTask(app);
  await bind(record,app,{home:task.id});
  const result=await app.registry.execute('home-modes','select-mode',{'mode-id':'home'});
  assert.equal(result.changed,true);assert.equal(result.taskStatus,'started');await settled(app);
  assert.equal(app.state.snapshot().runs.length,1);
  assert.equal(app.state.snapshot().runs[0].event.payload['mode-id'],'home');
  assert.equal(app.state.snapshot().runs[0].automatic,true);
  assert.equal((await app.registry.execute('home-modes','select-mode',{'mode-id':'home'})).changed,false);
  assert.equal(app.state.snapshot().runs.length,1);
  assert.equal(app.engine.homeModes.comparison(modeRule),true);
  const publicView=app.phoneHome.viewer(true).modes;
  assert.equal(publicView.currentId,'home');assert.doesNotMatch(JSON.stringify(publicView),/task-id|bound|transition-id/);
  await app.close();const restored=await createLocalserve(root,{automatic:false});
  try{assert.equal(restored.phoneHome.viewer(true).modes.currentId,'home');assert.equal(restored.state.snapshot().runs.length,1);assert.equal(restored.engine.homeModes.comparison(modeRule),true);}
  finally{await restored.close();}
});

test('public capabilities consume a request before execution and reject foreign, stale, disabled and paused selections',async t=>{
  const {app,record}=await fixture(t),modes=app.phoneHome.viewer(true).modes;
  const body={modeId:'night',revision:modes.revision,expires:modes.expires,requestId:crypto.randomUUID()};
  const request=(value,token=modes.token,origin=app.origin)=>fetch(app.origin+'/api/phone-home/run',{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Localserve-Home-Token':token},body:JSON.stringify(value)});
  assert.equal((await request(body,modes.token,'https://foreign.example')).status,403);
  const first=await request(body);assert.equal(first.status,202);const receipt=await first.json();assert.equal(receipt.changed,true);
  assert.equal((await request(body)).status,202);assert.equal(record().state.snapshot()['mode-id'],'night');
  assert.equal((await request({...body,modeId:'away'})).status,409);
  assert.equal((await request({...body,requestId:crypto.randomUUID()},'0'.repeat(64))).status,403);
  await app.engine.setPaused(true);assert.equal((await request({...body,requestId:crypto.randomUUID()})).status,409);await app.engine.setPaused(false);
  const cfg=record().config.snapshot();
  await app.registry.saveConfiguration('home-modes',{revision:cfg.revision,settings:{...cfg.settings,modes:cfg.settings.modes.map(mode=>({...mode,enabled:mode.id!=='away'}))}});
  assert.equal((await request({...body,modeId:'away',requestId:crypto.randomUUID()})).status,409);
  assert.equal((await fetch(app.origin+'/api/phone-home/receipts/'+receipt.requestId,{headers:{'X-Localserve-Home-Token':receipt.token}})).status,200);
});

test('an assigned Task matching the same mode Event starts once and receives its captured public values',async t=>{
  const {app,record}=await fixture(t);
  const task=await addTask(app,{starts:[modeRule],steps:[{id:'log',type:'log',enabled:true,message:'Selected {{event.mode-name}}'}]});
  await bind(record,app,{home:task.id});await app.registry.execute('home-modes','select-mode',{'mode-id':'home'});await settled(app);
  assert.equal(app.state.snapshot().runs.length,1);assert.equal(app.state.snapshot().runs[0].event.payload['mode-name'],'Home');
  const cfg=record().config.snapshot();cfg.settings.modes[0].name='At home';
  await app.registry.saveConfiguration('home-modes',{revision:cfg.revision,settings:cfg.settings});
  assert.equal(app.registry.services().find(service=>service.id==='home-modes').cardData.values['mode-name'].value,'At home');
  assert.equal(app.state.snapshot().runs.length,1,'Renaming does not emit or run');
});

test('AND combines restored mode state with a fresh unrelated reading, without a startup mode Event',async t=>{
  const {app,root}=await fixture(t,true);await app.registry.execute('home-modes','select-mode',{'mode-id':'home'});
  await addTask(app,{id:'and-mode',ruleMode:'and',starts:[modeRule,{id:'value',name:'Value',type:'event',enabled:true,eventId:'plugin:simulator:event:value-changed',condition:{field:'value',operator:'eq',value:1}}]});
  await app.close();const restored=await createLocalserve(root,{automatic:false});
  try{
    assert.equal(restored.state.snapshot().runs.length,0);
    const source=restored.registry.get('simulator');await restored.registry.saveConfiguration('simulator',{revision:source.config.snapshot().revision,enabled:true});
    await restored.registry.execute('simulator','set-value',{value:1});await settled(restored);
    assert.equal(restored.state.snapshot().runs.length,1);assert.equal(restored.state.snapshot().runs[0].taskId,'and-mode');
  }finally{await restored.close();}
});

test('disabled modes cannot be selected and missing assigned Tasks never undo the selected mode',async t=>{
  const {app,record}=await fixture(t);await bind(record,app,{home:'missing-task'});
  const result=await app.registry.execute('home-modes','select-mode',{'mode-id':'home'});
  assert.equal(result.taskStatus,'not-started');assert.equal(record().state.snapshot()['mode-id'],'home');
  const cfg=record().config.snapshot();cfg.settings.modes[0].enabled=false;
  await app.registry.saveConfiguration('home-modes',{revision:cfg.revision,settings:cfg.settings});
  await assert.rejects(app.registry.execute('home-modes','select-mode',{'mode-id':'home'}),/enabled home mode/);
  assert.equal(app.engine.homeModes.comparison(modeRule),null);assert.equal(app.phoneHome.viewer(true).modes.currentId,null);
});

test('alternating assigned Tasks retain causal ancestry and cannot form an unbounded mode loop',async t=>{
  const {app,record}=await fixture(t);
  const capabilityId=app.registry.actions().find(action=>action.actionId==='select-mode').id;
  for(const [id,target]of [['to-away','away'],['to-home','home']])await addTask(app,{id,steps:[{id:'mode',type:'plugin',enabled:true,capabilityId,parameters:{'mode-id':target}}]});
  await bind(record,app,{home:'to-away',away:'to-home'});
  await app.registry.execute('home-modes','select-mode',{'mode-id':'home'});await settled(app);
  const runs=app.state.snapshot().runs;assert.ok(runs.length>=2&&runs.length<=8);
  assert.ok(runs.every(run=>run.event.trace.length>=1&&run.event.trace.length<=8));
});

test('public client mode helpers retain the older-TV ES5 syntax contract',async()=>{
  const acorn={exports:{}};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:acorn,exports:acorn.exports});
  acorn.exports.parse(await fs.readFile('assets/launcher/launcher.js','utf8'),{ecmaVersion:5});
  for(const file of ['web/scene-selector.js','web/control-room.js','assets/launcher/launcher.js']){
    const code=await fs.readFile(file,'utf8');assert.match(code,/getRandomValues/);assert.match(code,/api\/phone-home\/run/);assert.match(code,/aria-pressed/);
  }
});

test('concurrent duplicate selections admit one transition and one assigned Task',async t=>{
  const {app,record}=await fixture(t),task=await addTask(app);
  await bind(record,app,{home:task.id});
  const modes=app.phoneHome.viewer(true).modes;
  const body={modeId:'home',revision:modes.revision,expires:modes.expires,requestId:crypto.randomUUID()};
  const results=await Promise.allSettled([app.engine.homeModes.select(body,modes.token),app.engine.homeModes.select(body,modes.token)]);
  assert.ok(results.some(result=>result.status==='fulfilled'));
  for(const result of results)if(result.status==='rejected')assert.equal(result.reason.status,409);
  await settled(app);assert.equal(app.state.snapshot().runs.length,1);
});

test('a damaged public receipt store isolates its controls without stopping mode Tasks or the server',async t=>{
  const {app,root}=await fixture(t);await app.close();
  await fs.writeFile(path.join(root,'data/home-mode-runs.json'),'{"invalid":true}');
  const restored=await createLocalserve(root,{automatic:false});
  try{
    assert.equal((await fetch(restored.origin+'/api/state')).status,200);
    assert.equal(restored.phoneHome.viewer(true).modes.available,false);
    assert.match(restored.engine.homeModes.error,/retained/);
    assert.equal((await restored.registry.execute('home-modes','select-mode',{'mode-id':'away'})).changed,true);
    assert.equal(await fs.readFile(path.join(root,'data/home-mode-runs.json'),'utf8'),'{"invalid":true}');
    const events=restored.registry.events;restored.registry.events=()=>{throw Error('Unrelated catalogue rebuilt');};
    try{assert.equal(restored.engine.homeModes.comparison({eventId:'plugin:simulator:event:value-changed'}),undefined);}
    finally{restored.registry.events=events;}
  }finally{await restored.close();}
});
