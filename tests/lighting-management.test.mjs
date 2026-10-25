/** Gateway administration is exercised against synthetic resources only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createTradfriAdapter} from '../plugins/tradfri/server/index.mjs';
import {parseGroup} from '../plugins/tradfri/server/client.mjs';
import {administrationInventory} from '../plugins/tradfri/server/readings.mjs';
import {lightingEditName,lightingEditToken,lightingMemberIds} from '../server/lighting-edit-contract.mjs';
import {selectorFixture} from './fixtures/scene-selector.mjs';

function gateway(){
  const resources={
    '15001/1':{9003:1,9001:'Desk',5750:2,9019:1,3311:[{9003:0,5850:1,5851:100}]},
    '15001/2':{9003:2,9001:'Reading',5750:2,9019:1,3311:[{9003:0,5850:0,5851:30}]},
    '15001/3':{9003:3,9001:'Remote',5750:0},
    '15004/5':{9003:5,9001:'Study',9018:{15002:{9003:[1,3]}}},
    '15004/6':{9003:6,9001:'Shared',9018:{15002:{9003:[1,2]}}},
  };
  const calls=[],writes=[];let onGet=()=>{},code='2.04';
  const auth={host:'10.23.42.2',identity:'synthetic',psk:'synthetic-key'};
  const adapter=createTradfriAdapter({vault:{load:async()=>auth},credentialReady:async()=>true,
    gateway:async(host,signal,operation)=>operation({connect:async()=>{},request:async(path,method,payload)=>{
      signal.throwIfAborted();calls.push({path,method});
      if(method==='put'){writes.push({path,payload:structuredClone(payload)});if(code==='2.04')Object.assign(resources[path],structuredClone(payload));return {code};}
      onGet(path,calls.filter(call=>call.method==='get'&&call.path===path).length);
      if(path==='15001')return {code:'2.05',payload:[1,2,3]};
      if(path==='15004')return {code:'2.05',payload:[5,6]};
      return {code:'2.05',payload:structuredClone(resources[path])};
    }})});
  const controller=new AbortController();let state={};
  const context={signal:controller.signal,wait:async()=>controller.signal.throwIfAborted(),log:async()=>{},emit:async()=>{},
    readState:async()=>structuredClone(state),saveState:async value=>{state=structuredClone(value);}};
  const token=(kind,id)=>{const raw=resources[(kind==='group'?'15004/':'15001/')+id];return lightingEditToken(kind,id,raw[9001],kind==='group'?raw[9018][15002][9003].map(String):[]);};
  const edit=async(kind,id,name,members,expected=token(kind,id))=>adapter.execute(kind==='group'?'room-edit':'device-rename',
    {id,name,expected,...(kind==='group'?{members:JSON.stringify(members)}:{})},context);
  return {adapter,resources,writes,calls,context,controller,token,edit,get state(){return state;},onGet:fn=>onGet=fn,reject:()=>code='4.00',
    start:()=>adapter.start({host:auth.host,'poll-minutes':1,'security-code':''})};
}

test('gateway edit names, member IDs and conflict tokens are canonical and bounded',()=>{
  assert.equal(lightingEditName('  A\u030a room  '),'Å room');
  for(const value of ['',null,'bad\nname','x'.repeat(65),'界'.repeat(44)])assert.throws(()=>lightingEditName(value));
  assert.deepEqual(lightingMemberIds(['9','2']),['2','9']);assert.deepEqual(lightingMemberIds([]),[]);
  for(const value of [['01','1'],['1','1'],['0'],['4294967296'],[1],null,Array(101).fill('1')])assert.throws(()=>lightingMemberIds(value));
  assert.equal(lightingEditToken('group','5','Study',['2','1']),lightingEditToken('group','5','Study',['1','2']));
  assert.notEqual(lightingEditToken('group','5','Study',['1']),lightingEditToken('group','5','Other',['1']));
  assert.notEqual(lightingEditToken('group','5','Study',['1']),lightingEditToken('group','5','Study',['2']));
});

test('device rename sends one minimal update and no-op sends nothing',async()=>{
  const f=gateway();await f.start();
  await f.edit('device','1','Desk');assert.equal(f.writes.length,0);
  await f.edit('device','1','Reading desk');
  assert.deepEqual(f.writes,[{path:'15001/1',payload:{9001:'Reading desk'}}]);
  assert.equal(f.resources['15001/1'][3311][0][5850],1);
  await f.edit('device','3','Wall remote');assert.deepEqual(f.writes.at(-1).payload,{9001:'Wall remote'});
  assert.deepEqual(f.state,{});await f.adapter.stop();
});

test('room editing preserves other members and overlapping rooms without power or fade writes',async()=>{
  const f=gateway();await f.start();const other=structuredClone(f.resources['15004/6']);
  await f.edit('group','5','Office',['2','3']);
  assert.deepEqual(f.writes,[{path:'15004/5',payload:{9001:'Office',9018:{15002:{9003:[2,3]}}}}]);
  assert.deepEqual(f.resources['15004/6'],other);
  const group=parseGroup(f.resources['15004/5']),copy=group.clone();copy.deviceIDs=[1,3];
  assert.deepEqual(copy.serialize(group)['9018'],{15002:{9003:[1,3]}},'membership shape agrees with the bundled serializer');
  await f.adapter.execute('refresh',{},f.context);
  assert.equal(f.state['lighting-inventory'].groups.find(group=>group.id==='5').editToken,f.token('group','5'));
  await f.adapter.stop();
});

test('non-light changes, unknown targets and malformed values cannot write gateway configuration',async()=>{
  const f=gateway();await f.start();
  await assert.rejects(f.edit('group','5','Study',['1']),/other room members/);
  await assert.rejects(f.edit('group','6','Shared',['1','2','3']),/other room members/);
  await assert.rejects(f.edit('group','5','Study',['1','3','99']));
  await assert.rejects(f.edit('device','1','bad\nname'));
  await assert.rejects(f.edit('device','1','Desk',undefined,'wrong'),/changed/);
  assert.equal(f.writes.length,0);await f.adapter.stop();
});

test('name or member conflicts found on either fresh read reject the whole update',async()=>{
  for(const read of [1,2]){
    const f=gateway();await f.start();const expected=f.token('group','5');
    f.onGet((path,count)=>{if(path==='15004/5'&&count===read)f.resources[path][9001]='Changed elsewhere';});
    await assert.rejects(f.edit('group','5','Office',['2','3'],expected),/changed/);
    assert.equal(f.writes.length,0);await f.adapter.stop();
  }
});

test('pause cancellation before either write gate prevents edits; rejected writes are not retried',async()=>{
  for(const cancelAt of [1,2]){
    const f=gateway();await f.start();let gates=0;
    f.context.wait=async()=>{if(++gates===cancelAt)f.controller.abort(Error('Cancelled'));f.controller.signal.throwIfAborted();};
    await assert.rejects(f.edit('device','1','Office'),/Cancelled/);assert.equal(f.writes.length,0);await f.adapter.stop();
  }
  const f=gateway();await f.start();f.reject();await assert.rejects(f.edit('device','1','Office'),/rejected/);
  assert.equal(f.writes.length,1);assert.equal(f.resources['15001/1'][9001],'Desk');await f.adapter.stop();
});

test('empty light-only room updates remain explicit bounded membership updates',async()=>{
  const f=gateway();await f.start();await f.edit('group','6','Shared',[]);
  assert.deepEqual(f.writes[0],{path:'15004/6',payload:{9018:{15002:{9003:[]}}}});await f.adapter.stop();
});

test('administrator edits enforce auth, current tokens/revisions, typed membership and request claims',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());const record=f.app.registry.get('tradfri');
  const source=administrationInventory([{instanceId:1,name:'Desk',type:2,lightList:[{dimmer:40,spectrum:'none',onOff:true}]},
    {instanceId:3,name:'Remote',type:0}],[{instanceId:5,name:'Study',deviceIDs:[1,3]}]);
  await record.state.update(reading=>Object.assign(reading,{'received-at':Date.now(),'gateway-host':record.config.snapshot().settings.host,'lighting-inventory':source}));
  const endpoint=f.app.origin+'/api/lighting-room/tradfri/manage',revision=record.config.snapshot().revision;
  const value={revision,requestId:randomUUID(),kind:'group',id:'5',name:'Office',members:['1','3'],expected:source.groups[0].editToken};
  const post=(body=value,headers={})=>fetch(endpoint,{method:'POST',headers:{Origin:f.app.origin,'Content-Type':'application/json','X-Localserve-Token':f.app.snapshot().token,...headers},body:JSON.stringify(body)});
  assert.equal((await post(value,{'X-Localserve-Token':'wrong'})).status,403);
  assert.equal((await post(value,{Origin:'https://foreign.invalid'})).status,403);
  assert.equal((await post({...value,revision:revision+1})).status,409);
  assert.equal((await post({...value,expected:'0'.repeat(64)})).status,409);
  assert.equal((await post({...value,members:['1']})).status,400);
  assert.equal((await post({...value,extra:'no'})).status,400);
  assert.equal((await post({...value,kind:'device',id:'1',expected:source.devices[0].editToken})).status,400);
  const response=await post();assert.equal(response.status,200);const model=await response.json();assert.equal(model.operation.phase,'awaiting');
  assert.equal((await post()).status,409);
  await record.state.update(reading=>{reading['received-at']=Date.now()+1;const group=reading['lighting-inventory'].groups[0];group.name='Office';group.editToken=lightingEditToken('group','5','Office',['1','3']);});
  assert.equal(f.app.lightingRoom?.snapshot?.('tradfri')?.operation?.phase??(await fetch(f.app.origin+'/api/lighting-room/tradfri').then(r=>r.json())).operation.phase,'confirmed');
  assert.ok(!f.app.registry.actions().some(action=>['device-rename','room-edit'].includes(action.actionId)));
  assert.equal(f.app.controls.runs.snapshot().runs.length,0);
});

test('editor search is outside the canonical draft and uncertain saves reuse their claim',async()=>{
  const sent=[],context=vm.createContext({document:{addEventListener(){}},Date,crypto:{randomUUID},dialogContext:{kind:'lighting-management',pluginId:'tradfri',targetKind:'group',targetId:'5',revision:1,expected:'a'.repeat(64),kept:['3'],original:['1','3'],requestId:randomUUID(),submitted:false},
    request:async(endpoint,body)=>{sent.push(body);throw Error('Uncertain');},showFormError(){}});
  vm.runInContext(await fs.readFile(new URL('../web/lighting-room-ui.js',import.meta.url),'utf8')+'\nglobalThis.ui=LightingRoomUI;',context);
  const form={elements:{namedItem:()=>({value:' Office '})},querySelectorAll:()=>[{value:'2'}],querySelector:()=>({disabled:false})};
  const draft=context.ui.editDraft(form);assert.equal(draft.name,'Office');assert.equal(JSON.stringify(draft.members),'["2","3"]');
  await context.ui.submitEdit(form);await context.ui.submitEdit(form);
  assert.equal(sent.length,2);assert.equal(sent[0].requestId,sent[1].requestId);assert.equal(context.dialogContext.submitted,false);
});
