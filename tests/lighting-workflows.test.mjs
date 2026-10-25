/** Lighting workflow drafts, diagnostics and receipt-only recovery. No hardware. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {selectorFixture} from './fixtures/scene-selector.mjs';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
async function taskUI(snapshot){
  const scope={state:snapshot,actionCatalog:snapshot.taskActions,crypto:{randomUUID},document:{addEventListener(){}},escapeHtml:escape,icon:()=>''};
  vm.createContext(scope);vm.runInContext(await fs.readFile(new URL('../web/tasks-ui.js',import.meta.url),'utf8')+';this.ui=TaskUI;',scope);return scope;
}
test('scene, light and room shortcuts open disabled global Task drafts and save through the ordinary API without effects',async t=>{
  const f=await selectorFixture({sceneFades:true});t.after(()=>f.close());
  const snapshot=f.app.snapshot(),service=snapshot.services.find(service=>service.id==='tradfri');
  service.lightingRoom={lights:[{id:'1',name:'Desk <light>'}],groups:[{id:'7',name:'Study'}]};
  const scope=await taskUI(snapshot),drafts=[];scope.ui.openEditor=(id,copy,draft)=>{assert.equal(id,null);assert.equal(copy,false);drafts.push(draft);};
  for(const input of [{kind:'scene',pageId:f.page.id,sceneId:'scene-0'},{kind:'light',id:'1'},{kind:'group',id:'7'}])scope.ui.openLightingTask({pluginId:'tradfri',...input});
  assert.deepEqual(drafts.map(draft=>draft.steps[0].capabilityId),['plugin:tradfri:run-scene','plugin:tradfri:light-power','plugin:tradfri:group-power']);
  assert.equal(drafts[0].steps[0].parameters['scene-id'],f.page.id+'/scene-0');
  for(const draft of drafts){
    assert.equal(draft.enabled,false);assert.equal(draft.starts.length,0);
    const reply=await fetch(f.app.origin+'/api/tasks',{method:'POST',headers:{Origin:f.app.origin,'Content-Type':'application/json','X-Localserve-Token':f.app.snapshot().token},body:JSON.stringify(draft)});
    assert.equal(reply.status,200,await reply.text());
  }
  assert.equal(f.app.controls.runs.snapshot().runs.length,0);assert.equal(f.app.registry.get('tradfri').state.snapshot().effects,undefined);
  assert.throws(()=>scope.ui.openLightingTask({pluginId:'tradfri',kind:'light',id:'missing'}),/unavailable/);
  assert.throws(()=>scope.ui.openLightingTask({pluginId:'tradfri',kind:'scene',pageId:f.page.id,sceneId:'missing'}),/unavailable/);
  assert.match(scope.ui.lightingShortcut({pluginId:'tradfri',kind:'light',id:'1',name:'Desk <light>'}),/Desk &lt;light>/);
});

test('diagnostics projects safe receipts and failure categories without executing a gateway action',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());
  const record=f.app.registry.get('tradfri');
  await record.state.update(state=>{state['private-note']='PRIVATE';});
  f.app.controls.failures.set('tradfri',{at:100,stage:'history-step',type:'Error',code:'ENOSPC',message:'PRIVATE',parameters:{secret:'PRIVATE'}});
  await f.app.controls.runs.update(state=>{state.runs.push({id:'synthetic',pluginId:'tradfri',status:'failed',step:0,totalSteps:1,startedAt:100,finishedAt:101,parameters:{secret:'PRIVATE'}});});
  const before=JSON.stringify(record.state.snapshot());
  const response=await fetch(f.app.origin+'/api/lighting-room/tradfri');assert.equal(response.status,200);const model=await response.json();
  assert.equal(model.diagnostics.lastFailure.code,'ENOSPC');assert.equal(model.diagnostics.lastScene.status,'failed');
  assert.doesNotMatch(JSON.stringify(model),/PRIVATE|parameters|secret/);assert.equal(JSON.stringify(record.state.snapshot()),before);
  const scope={document:{addEventListener(){}},escapeHtml:escape,icon:()=>'',formatServerTimestamp:String};vm.createContext(scope);
  vm.runInContext(await fs.readFile(new URL('../web/lighting-room-ui.js',import.meta.url),'utf8')+';this.ui=LightingRoomUI;',scope);
  model.devices=[{id:'2',name:'Plug <name>',type:3,reachable:null,battery:null,model:'',firmware:''}];
  const html=scope.ui.diagnostics(f.app.snapshot().services[0],model);
  assert.match(html,/Inventory only/);assert.match(html,/Plug &lt;name>/);assert.match(html,/ENOSPC/);assert.match(html,/history|Recording a step/);
  assert.doesNotMatch(html,/room-rename-device|PRIVATE/);
});

async function receiptFixture(t){
  const f=await selectorFixture({sceneFades:true});t.after(()=>f.close());
  const run=async(context={})=>{const page=f.app.controls.pages('tradfri')[0];await f.app.controls.invoke('tradfri',page.slug,f.app.controls.token('tradfri',page),{revision:page.revision,itemId:'scene-0',requestId:randomUUID()},context);await f.app.controls.active.get('tradfri')?.done;return f.app.controls.runs.snapshot().runs.at(-1);};
  return {...f,run};
}
test('a briefly locked Windows receipt replacement is retried without repeating a light command',{skip:process.platform!=='win32'},async t=>{
  const f=await receiptFixture(t),store=f.app.controls.runs,write=store.write.bind(store);let locks=0;
  store.write=async value=>{if(value.runs.at(-1).status==='running'&&locks<2){locks++;throw Object.assign(Error('locked'),{code:'EPERM',syscall:'rename'});}return write(value);};
  assert.equal((await f.run()).status,'completed');assert.equal(locks,2);assert.equal(f.app.registry.get('tradfri').state.snapshot().effects.length,1);
});
test('a permanent receipt error prevents effects and records a safe stage/code',async t=>{
  const f=await receiptFixture(t),store=f.app.controls.runs,write=store.write.bind(store);let failedWrites=0;
  store.write=async value=>{if(value.runs.at(-1).status==='running'){failedWrites++;throw Object.assign(Error('PRIVATE'),{code:'ENOSPC',syscall:'rename'});}return write(value);};
  assert.equal((await f.run()).status,'failed');assert.equal(failedWrites,1);assert.equal(f.app.registry.get('tradfri').state.snapshot().effects,undefined);
  assert.equal(f.app.controls.failures.get('tradfri').stage,'history-start');assert.equal(f.app.controls.failures.get('tradfri').code,'ENOSPC');
  assert.doesNotMatch(JSON.stringify(f.app.controls.failures.get('tradfri')),/PRIVATE/);
});
test('cancellation during a receipt replacement wait still prevents the first device effect',{skip:process.platform!=='win32'},async t=>{
  const f=await receiptFixture(t),store=f.app.controls.runs,write=store.write.bind(store),controller=new AbortController();let locked=false;
  store.write=async value=>{if(value.runs.at(-1).status==='running'&&!locked){locked=true;controller.abort();throw Object.assign(Error('locked'),{code:'EBUSY',syscall:'rename'});}return write(value);};
  assert.equal((await f.run({signal:controller.signal})).status,'cancelled');assert.equal(f.app.registry.get('tradfri').state.snapshot().effects,undefined);
});
