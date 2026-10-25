/** Native scenes are synthetic CoAP responses; no physical gateway is used. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneLight,readGatewayScenes,inspectionAction} from '../plugins/tradfri/server/gateway-scenes.mjs';
import {parseAccessory} from '../plugins/tradfri/server/client.mjs';
import {createTradfriAdapter} from '../plugins/tradfri/server/index.mjs';
import {GatewayScenes} from '../server/gateway-scenes.mjs';
import {LightingRoom} from '../server/lighting-room.mjs';
import {selectorFixture} from './fixtures/scene-selector.mjs';
import {administrationInventory,publicReading} from '../plugins/tradfri/server/readings.mjs';
const rawDevice={9003:1,9001:'White',5750:2,9019:1,3311:[{5850:1,5851:100,5711:370}]};
const rawScene={9003:8,9001:'Evening',15013:[{9003:1,5850:0,5851:0,5711:250}]};
const rawGroup={9003:5,9001:'Studio',9018:{15002:{9003:[1]}}};
function gateway(scene=structuredClone(rawScene)){
  const calls=[],resources={'15004/5':rawGroup,'15005/5':[8],'15005/5/8':scene,'15001/1':rawDevice};
  const client={connect:async()=>{},request:async(resource,method)=>{calls.push({resource,method});return {code:'2.05',payload:structuredClone(resources[resource])};}};
  return {client,calls,resources,scene};
}
test('native scene decoding preserves explicit zero and refuses absent raw values or unsupported colour',()=>{
  const device=parseAccessory(rawDevice),light=rawScene[15013][0];
  assert.deepEqual(sceneLight(light,device),{id:'1',on:false,brightness:0,temperature:0});
  for(const key of ['9003','5850','5851','5711']){const copy={...light};delete copy[key];assert.throws(()=>sceneLight(copy,device));}
  assert.throws(()=>sceneLight({...light,5851:255},device));
});
test('finite room list and selected scene reads perform only fixed GETs and reject unsupported members',async()=>{
  const f=gateway(),signal=new AbortController().signal;
  let result=await readGatewayScenes(f.client,{id:'5'},signal);assert.deepEqual(result.scenes,[{id:'8',name:'Evening'}]);
  result=await readGatewayScenes(f.client,{id:'5','scene-id':'8'},signal);
  assert.equal(result.issues.length,0);assert.deepEqual(result.lights,[{id:'1',on:false,brightness:0,temperature:0}]);
  f.scene[15021]=[{9003:9}];result=await readGatewayScenes(f.client,{id:'5','scene-id':'8'},signal);
  assert.equal(result.lights.length,0);assert.ok(result.issues.length);
  delete f.scene[15021];f.scene[15013][0][9003]=9;
  assert.ok((await readGatewayScenes(f.client,{id:'5','scene-id':'8'},signal)).issues.length);
  assert.ok(f.calls.every(call=>call.method==='get'&&/^1500[145]\/[0-9/]+$/.test(call.resource)));
  await assert.rejects(readGatewayScenes(f.client,{id:'../5'},signal));
  await assert.rejects(readGatewayScenes(f.client,{id:'5','scene-id':'99'},signal));
});
test('adapter inspection returns typed scene data without writes, state changes or emitted Events',async()=>{
  const f=gateway(),settings={host:'10.23.42.2','security-code':'','poll-minutes':1},auth={host:settings.host,identity:'test',psk:'test'};
  const adapter=createTradfriAdapter({vault:{load:async()=>auth},credentialReady:async()=>true,gateway:async(host,signal,operation)=>operation(f.client)});
  await adapter.start(settings);
  const result=await adapter.execute('inspect-scenes',{id:'5','scene-id':'8'},{signal:new AbortController().signal,log:async()=>{}});
  assert.equal(result.sceneId,'8');assert.ok(f.calls.every(call=>call.method==='get'));
  await adapter.stop();
});
async function fixture(t){
  const f=await selectorFixture({sceneFades:true,gatewayScenes:true});t.after(()=>f.close());
  const record=f.app.registry.get('tradfri'),group={instanceId:5,name:'Studio',deviceIDs:[1]},devices=[parseAccessory(rawDevice)];
  const inventory=administrationInventory(devices,[group]),reading=publicReading(inventory.lights,[group],Date.now());
  const g=gateway(),details=await readGatewayScenes(g.client,{id:'5','scene-id':'8'},new AbortController().signal),list=await readGatewayScenes(g.client,{id:'5'},new AbortController().signal);
  await record.state.update(state=>Object.assign(state,reading,{'gateway-host':'','lighting-inventory':inventory,gatewaySceneFixture:{details,list}}));
  const page=f.app.controls.pages('tradfri')[0],values={action:'inspect',revision:record.config.snapshot().revision,pageRevision:page.revision,groupId:'5',sceneId:'8'};
  const controller=new AbortController(),scenes=new GatewayScenes(f.app.registry,f.app.controls,new LightingRoom(f.app.registry,f.app.controls));
  return {...f,record,page,values,scenes,signal:controller.signal};
}
test('preview import is a disabled independent copy, single-use and revision/runtime bound',async t=>{
  const f=await fixture(t),before=f.app.controls.pages('tradfri')[0].items.length;
  const preview=await f.scenes.request('tradfri',f.page.id,f.values,f.signal);
  assert.equal(preview.importable,true);assert.equal(f.record.state.snapshot().effects,undefined);
  const request={...f.values,action:'import',preview:preview.preview,name:'Imported evening'};
  await f.scenes.request('tradfri',f.page.id,request,f.signal);
  const imported=f.app.controls.pages('tradfri')[0].items.at(-1);
  assert.equal(imported.enabled,false);assert.equal(imported.steps[0].parameters.brightness,0);
  assert.equal(f.app.controls.pages('tradfri')[0].items.length,before+1);
  await assert.rejects(f.scenes.request('tradfri',f.page.id,request,f.signal),/reopen|again/);
  assert.equal(f.record.state.snapshot().effects,undefined);
});
test('administrator route protects inspection/import and the action cannot enter Tasks or Controls',async t=>{
  const f=await fixture(t),endpoint=f.app.origin+'/api/lighting-scenes/tradfri/'+f.page.id+'/gateway';
  assert.equal((await fetch(endpoint)).status,405);
  assert.equal((await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f.values)})).status,403);
  const headers={Origin:f.app.origin,'X-Localserve-Token':f.app.snapshot().token,'Content-Type':'application/json'};
  const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({...f.values,sceneId:undefined})});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).scenes,[{id:'8',name:'Evening'}]);
  assert.ok(!f.app.registry.actions().some(action=>action.actionId===inspectionAction.id));
  assert.ok(!f.record.plugin.controls.actions.includes(inspectionAction.id));
  f.app.engine.gate.setPaused(true);
  await assert.rejects(f.scenes.request('tradfri',f.page.id,f.values,f.signal),/Refresh lighting/);
});
test('expired, reconfigured and changed-room previews cannot be imported or replayed',async t=>{
  const f=await fixture(t),preview=await f.scenes.request('tradfri',f.page.id,f.values,f.signal);
  const request={...f.values,action:'import',preview:preview.preview,name:'Expired copy'};
  f.scenes.previews.get(preview.preview).expires=0;
  await assert.rejects(f.scenes.request('tradfri',f.page.id,request,f.signal),/again/);
  const second=await f.scenes.request('tradfri',f.page.id,f.values,f.signal);
  await f.record.state.update(state=>{state['lighting-inventory'].groups[0].editToken='f'.repeat(64);});
  await assert.rejects(f.scenes.request('tradfri',f.page.id,{...request,preview:second.preview},f.signal),/again/);
  assert.equal(f.app.controls.pages('tradfri')[0].items.length,6);
  assert.equal(f.record.state.snapshot().effects,undefined);
});
