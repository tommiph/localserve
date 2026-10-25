/** Lighting administration tests use snapshots and synthetic workers only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {LightingRoom,projectLightingInventory} from '../server/lighting-room.mjs';
import {administrationInventory,publicReading} from '../plugins/tradfri/server/readings.mjs';
import {validateDeclaration} from '../server/plugins.mjs';
import {selectorFixture} from './fixtures/scene-selector.mjs';

const declaration=JSON.parse(await fs.readFile(new URL('../plugins/tradfri/declaration.json',import.meta.url),'utf8'));
const plugin=validateDeclaration(declaration);
function fixture(){
  let now=1000000;
  const light={id:'1',name:'Desk',on:false,brightness:40,reachable:true,spectrum:'white',temperature:0};
  const inventory={schemaVersion:1,lights:[light],groups:[{id:'2',name:'Study',deviceIds:['1'],on:false,brightness:40}],devices:[{id:'1',name:'Desk',type:2,battery:null}]};
  const config={revision:1,enabled:true,settings:{host:'10.23.42.2','poll-minutes':1}};
  const reading={...publicReading(inventory.lights,[],now),'gateway-host':config.settings.host,'lighting-inventory':inventory};
  const record={plugin,health:'ready',configured:true,pending:0,runtime:{},config:{snapshot:()=>config},state:{snapshot:()=>reading},log:{latest:()=>[]}};
  const calls=[],gate={paused:false};let failCommand=false,failRefresh=false,apply=false;
  const registry={get:()=>record,engine:{gate},assertReady(){if(!config.enabled)throw Error('Unavailable');},async execute(owner,action,parameters,context){
    context.signal.throwIfAborted();calls.push({action,parameters});
    if(action==='refresh'){if(failRefresh)throw Error('Read failed');reading['received-at']=++now;if(apply)light.brightness=55;}
    else if(failCommand)throw Error('Command failed');
  }};
  const room=new LightingRoom(registry,{active:new Map()},{now:()=>now});
  const command=(values={})=>room.command('tradfri',{revision:1,requestId:randomUUID(),kind:'light',id:'1',property:'brightness',value:55,...values},new AbortController().signal);
  return {room,record,config,reading,inventory,light,calls,gate,command,advance:()=>now+=200000,failCommand:()=>failCommand=true,failRefresh:()=>failRefresh=true,apply:()=>apply=true};
}

test('administrator inventory includes all bounded devices but never exposes raw or credential fields',()=>{
  const devices=Array.from({length:30},(_,i)=>({instanceId:i+1,name:'Light '+i,type:2,alive:i===0?null:true,deviceInfo:{battery:i===0?0:undefined,modelNumber:'E27',firmwareVersion:'1',serialNumber:'private'},lightList:[{onOff:false,dimmer:0,spectrum:'none'}]}));
  devices.push({instanceId:99,name:'Remote',type:0,alive:null,deviceInfo:{battery:17}});
  const source=administrationInventory(devices,[{instanceId:1,name:'Room',deviceIDs:[1,2],onOff:false,dimmer:0}]);
  source.secret='private';source.devices[0].credentials='private';
  const projected=projectLightingInventory(source);
  assert.equal(projected.lights.length,30);assert.equal(projected.devices.length,31);assert.equal(projected.devices[0].battery,0);
  assert.equal(projected.lights[0].on,false);assert.equal(projected.lights[0].brightness,0);assert.equal(projected.lights[0].reachable,null);
  assert.deepEqual(projected.groups[0].deviceIds,['1','2']);assert.doesNotMatch(JSON.stringify(projected),/private|credentials|secret|serialNumber/);
  assert.equal(projectLightingInventory({...source,devices:[source.devices[0],source.devices[0]]}),null);
  assert.equal(projectLightingInventory({...source,groups:Array(101).fill(source.groups[0])}),null);
});

test('command acknowledgement stays unconfirmed until a later reported setting matches',async()=>{
  const f=fixture();let model=await f.command();
  assert.deepEqual(f.calls.map(call=>call.action),['light-brightness','refresh']);
  assert.equal(model.operation.phase,'awaiting');assert.equal(model.lights[0].brightness,40);
  f.light.brightness=55;f.reading['received-at']++;
  model=f.room.snapshot('tradfri');assert.equal(model.operation.phase,'confirmed');
  f.config.revision++;assert.equal(f.room.snapshot('tradfri').operation,null);
});

test('a one-percent adjustment cannot be confirmed by the previous brightness',async()=>{
  const f=fixture(),model=await f.command({value:41});
  assert.equal(model.lights[0].brightness,40);assert.equal(model.operation.phase,'awaiting');
  f.light.brightness=41;assert.equal(f.room.snapshot('tradfri').operation.phase,'confirmed');
});

test('ambiguous commands and failed confirmation reads are never automatically retried',async()=>{
  const first=fixture();first.failCommand();await assert.rejects(first.command(),/Command failed/);
  assert.equal(first.calls.length,1);assert.equal(first.room.snapshot('tradfri').operation.phase,'uncertain');
  const second=fixture();second.failRefresh();const model=await second.command();
  assert.equal(second.calls.length,2);assert.equal(model.operation.phase,'awaiting');assert.match(model.operation.message,/No command was retried/);
});

test('stale, foreign, paused, busy and unsupported targets are rejected before effects',async()=>{
  for(const change of [f=>f.advance(),f=>f.gate.paused=true,f=>f.record.pending=1,f=>f.light.reachable=false,f=>f.config.settings.host='10.23.42.3']){
    const f=fixture();change(f);await assert.rejects(f.command());assert.equal(f.calls.length,0);
  }
  const f=fixture();await assert.rejects(f.command({property:'color',value:'#ff0000'}));
  await assert.rejects(f.command({revision:2}));assert.equal(f.calls.length,0);
  const requestId=randomUUID();await f.command({requestId});await assert.rejects(f.command({requestId}),/already/);assert.equal(f.calls.length,2);
});

test('inventory is hidden after gateway replacement and is not available through public Card projections',()=>{
  const f=fixture();f.config.settings.host='10.23.42.3';const snapshot=f.room.snapshot('tradfri');
  assert.equal(snapshot.lights.length,0);assert.equal(snapshot.devices.length,0);assert.equal(snapshot.receivedAt,null);
  assert.ok(!plugin.cardFields.some(field=>field.source?.key==='lighting-inventory'));
});

test('control room routes require normal administrator CSRF and revisions; GET has no effects',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());const record=f.app.registry.get('tradfri');
  await record.state.update(reading=>Object.assign(reading,{...publicReading([],[],Date.now()),'gateway-host':record.config.snapshot().settings.host,'lighting-inventory':{schemaVersion:1,lights:[],groups:[],devices:[]}}));
  const endpoint=f.app.origin+'/api/lighting-room/tradfri',revision=record.config.snapshot().revision;
  const get=await fetch(endpoint);assert.equal(get.status,200);assert.equal((await get.json()).inventoryComplete,true);
  assert.equal(f.app.snapshot().services.find(service=>service.id==='tradfri').lightingRoom.inventoryComplete,true);
  const value={revision,requestId:randomUUID(),kind:'refresh'};
  const post=(headers,body=value)=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:f.app.origin,'X-Localserve-Token':f.app.snapshot().token,...headers},body:JSON.stringify(body)});
  assert.equal((await post({'X-Localserve-Token':'wrong'})).status,403);assert.equal((await post({Origin:'https://other.invalid'})).status,403);
  assert.equal((await post({}, {...value,revision:revision+1})).status,409);assert.equal((await post({})).status,200);
  assert.equal(f.app.controls.runs.snapshot().runs.length,0);
});

test('lighting workspace consumes the shared administrator snapshot without starting another periodic read',async()=>{
  let requests=0;
  const context=vm.createContext({document:{addEventListener(){}},Date,request:async()=>{requests++;}});
  vm.runInContext(await fs.readFile(new URL('../web/lighting-room-ui.js',import.meta.url),'utf8')+'\nglobalThis.ui=LightingRoomUI;',context);
  const service={id:'tradfri',config:{revision:1},lightingRoom:{revision:1,lights:[]}};
  await context.ui.load(service);await context.ui.load(service);
  assert.equal(requests,0);assert.equal(context.ui.entry('tradfri').data.revision,1);
});

test('pending slider edits coalesce by target kind and retain only the latest unsent value',async()=>{
  let release;
  const calls=[],service={id:'tradfri',config:{revision:1}},context=vm.createContext({document:{addEventListener(){}},Date,crypto:{randomUUID},
    currentView:'tradfri',state:{services:[service]},dialog:{open:false},renderView(){},
    request:async(endpoint,value)=>{calls.push(value);if(calls.length===1)await new Promise(resolve=>{release=resolve;});return {revision:1};}});
  vm.runInContext(await fs.readFile(new URL('../web/lighting-room-ui.js',import.meta.url),'utf8')+'\nglobalThis.ui=LightingRoomUI;',context);
  context.ui.load=async()=>{};
  const sending=context.ui.enqueue(service,{kind:'light',id:'1',property:'brightness',value:10});
  await context.ui.enqueue(service,{kind:'light',id:'1',property:'brightness',value:20});
  await context.ui.enqueue(service,{kind:'light',id:'1',property:'brightness',value:30});
  await context.ui.enqueue(service,{kind:'group',id:'1',property:'brightness',value:60});
  release();await sending;
  assert.deepEqual(calls.map(value=>[value.kind,value.value]),[['light',10],['light',30],['group',60]]);
});

test('selected slider values do not snap back to older readings while confirmation is pending',async()=>{
  const context=vm.createContext({document:{addEventListener(){}},Date});
  vm.runInContext(await fs.readFile(new URL('../web/lighting-room-ui.js',import.meta.url),'utf8')+'\nglobalThis.ui=LightingRoomUI;',context);
  const ui=context.ui,entry=ui.entry('tradfri'),data={revision:1,receivedAt:100,groups:[],lights:[{id:'1',brightness:40}]};
  entry.drafts.set('light:1:brightness',55);entry.expectations.set('light:1:brightness',{kind:'light',id:'1',property:'brightness',value:55,after:101});
  ui.adopt(entry,data);assert.equal(entry.drafts.get('light:1:brightness'),55);
  ui.adopt(entry,{...data,receivedAt:102});assert.equal(entry.drafts.get('light:1:brightness'),55);
  ui.adopt(entry,{...data,receivedAt:103,lights:[{id:'1',brightness:55}]});assert.equal(entry.drafts.size,0);
});

test('desktop room filters respect group membership and escape device labels',async()=>{
  const f=fixture();f.inventory.lights.push({...f.light,id:'3',name:'<Other>',room:'Other'});
  const service={id:'tradfri',config:{revision:1}},context=vm.createContext({document:{addEventListener(){}},state:{services:[service]},Date,icon:()=>'',formatServerTimestamp:String,
    escapeHtml:value=>String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;')});
  vm.runInContext(await fs.readFile(new URL('../web/lighting-room-ui.js',import.meta.url),'utf8')+'\nglobalThis.ui=LightingRoomUI;',context);
  const ui=context.ui;ui.load=()=>{};ui.entry('tradfri').data=f.room.snapshot('tradfri');ui.entry('tradfri').room='2';
  const html=ui.render(service,'rooms');assert.match(html,/room-light:1/);assert.doesNotMatch(html,/room-light:3/);
  ui.entry('tradfri').room='all';assert.match(ui.render(service,'rooms'),/&lt;Other&gt;/);
  ui.entry('tradfri').query='Study';const searched=ui.render(service,'rooms');assert.match(searched,/room-light:1/);assert.doesNotMatch(searched,/room-light:3/);
});

test('compact lighting starts with the light list, retains an explicit inspector and labels device facts',async()=>{
  const f=fixture(),service={id:'tradfri',config:{revision:1}},context=vm.createContext({document:{addEventListener(){}},state:{services:[service]},Date,matchMedia:()=>({matches:true}),icon:()=>'',formatServerTimestamp:String,escapeHtml:String});
  vm.runInContext(await fs.readFile(new URL('../web/lighting-room-ui.js',import.meta.url),'utf8')+';this.ui=LightingRoomUI;',context);
  const ui=context.ui;ui.load=()=>{};const entry=ui.entry('tradfri');entry.data=f.room.snapshot('tradfri');
  assert.match(ui.render(service,'rooms'),/room-inspector-empty/);assert.equal(entry.selected,'');
  entry.selected='1';assert.match(ui.render(service,'rooms'),/room-close-inspector/);assert.equal(entry.selected,'1');
  const devices=ui.devices(entry.data);assert.match(devices,/data-label="Device"/);assert.match(devices,/data-label="Firmware"/);
});
