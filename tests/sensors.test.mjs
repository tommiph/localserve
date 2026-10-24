/** No phones, LAN receivers or installed Tasks are used by these fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSensorReport } from '../server/sensor-protocol.mjs';
import { createSensorsAdapter } from '../plugins/sensors/server/index.mjs';
import { createLocalserve } from '../server.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { selectedCardData } from '../server/cards.mjs';

const deviceId='android-11111111-1111-4111-8111-111111111111';
const secondId='android-22222222-2222-4222-8222-222222222222';
const sensorId='s-1111111111111111';
function packet(sequence=1,id=deviceId) {
  return {version:1,deviceId:id,deviceName:'Android test',sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sequence,sentAt:1700000000000,
    catalog:[{id:sensorId,type:4,stringType:'android.sensor.gyroscope',name:'Gyroscope',vendor:'Test',unit:'rad/s',selected:true,status:'Streaming',reportingMode:0,resolution:0.1,maximumRange:20,powerMa:1,minDelayUs:5000}],
    readings:[{sensorId,values:[1,2,3],accuracy:3,timestampNanos:String(sequence*1000000),ageMs:0}]};
}
function gesturePacket(sequence=1,id=deviceId,type=25,mode=2) {
  const value=packet(sequence,id);
  Object.assign(value.catalog[0],{type,name:'Pick-up gesture',stringType:'android.sensor.pick_up_gesture',unit:'',reportingMode:mode});
  value.readings[0].values=[1];return value;
}
function settings() {return {'report-ms':250,'event-seconds':1,'events-per-report':4,'offline-seconds':5,'maintenance-minutes':1/12,devices:[{id:deviceId,name:'Phone one',enabled:true},{id:secondId,name:'Phone two',enabled:true}]};}
function harness() {
  let state={};const events=[];const signal=new AbortController();
  const context={signal:signal.signal,readState:async()=>structuredClone(state),saveState:async value=>{state=structuredClone(value);},emit:async(id,payload)=>events.push({id,payload,state:structuredClone(state)})};
  return {context,events,signal,get state(){return state;}};
}

test('sensor protocol bounds raw values, identities, catalogues and unknown properties',()=>{
  assert.equal(validateSensorReport(packet()).readings[0].values[0],1);
  for(const mutate of [value=>{value.url='http://example.com';},value=>{value.deviceId='__proto__';},
    value=>{value.readings[0].values[0]=Infinity;},value=>{value.readings[0].values=Array(17).fill(0);},
    value=>{value.readings[0].timestampNanos='1e10';},value=>{value.readings[0].sensorId='missing';},
    value=>{value.catalog[0].selected=false;},value=>{value.readings.push(value.readings[0]);},
    value=>{value.catalog=Array(65).fill(value.catalog[0]);}]) {
    const value=packet();mutate(value);assert.throws(()=>validateSensorReport(value));
  }
});

test('phone event contracts reject arbitrary kinds/fields, excessive batches and nonfinite values',()=>{
  const value=packet();value.phoneEvents=[{kind:'battery',timestampNanos:'1000',fields:{percent:20,charging:false}}];
  assert.equal(validateSensorReport(value).phoneEvents[0].fields.percent,20);
  for(const change of [p=>p.phoneEvents[0].kind='command',p=>p.phoneEvents[0].fields.url='http://example.com',
    p=>p.phoneEvents[0].fields.percent=NaN,p=>p.phoneEvents[0].fields.percent='20',
    p=>p.phoneEvents[0].timestampNanos='1e10',p=>p.phoneEvents[0].fields.text='x'.repeat(501),
    p=>p.phoneEvents=Array(41).fill(p.phoneEvents[0]),p=>p.phoneEvents.push(p.phoneEvents[0])]){
    const changed=structuredClone(value);change(changed);assert.throws(()=>validateSensorReport(changed));
  }
});

test('location and named-region contracts enforce ranges, source bounds and reported activity labels',()=>{
  const base=packet();base.phoneEvents=[{kind:'location',timestampNanos:'1000',fields:{latitude:0,longitude:0,'accuracy-m':5,provider:'gps','fix-at':1700000000000,'age-ms':0,mock:false}}];
  assert.equal(validateSensorReport(base).phoneEvents[0].fields.latitude,0);
  for(const change of [p=>p.phoneEvents[0].fields.latitude=91,p=>p.phoneEvents[0].fields.longitude=-181,
    p=>p.phoneEvents[0].fields['accuracy-m']=-1,p=>p.phoneEvents[0].fields['age-ms']=120001,
    p=>p.phoneEvents[0].fields.provider='invented',p=>delete p.phoneEvents[0].fields.mock]){
    const value=structuredClone(base);change(value);assert.throws(()=>validateSensorReport(value));
  }
  const regions=Array.from({length:20},(_,index)=>({kind:'geofence',timestampNanos:'2000',fields:{'region-id':String(index).padStart(8,'0')+'-1111-4111-8111-111111111111','region-name':'Region '+index,inside:true,'distance-m':0,'accuracy-m':3}}));
  base.phoneEvents=regions;assert.equal(validateSensorReport(base).phoneEvents.length,20);
  base.phoneEvents.push({...regions[0],fields:{...regions[0].fields,'region-id':'99999999-1111-4111-8111-111111111111'}});assert.throws(()=>validateSensorReport(base));
  base.phoneEvents=[{kind:'activity',timestampNanos:'2000',fields:{activity:'Walking',transition:'Enter'}},{kind:'activity',timestampNanos:'2000',fields:{activity:'Still',transition:'Exit'}}];
  assert.equal(validateSensorReport(base).phoneEvents.length,2);
  base.phoneEvents[0].fields.activity='Driving';assert.throws(()=>validateSensorReport(base));
});

test('same-fix region transitions and simultaneous activity reports retain independent claims with no coordinate history',async()=>{
  const h=harness(),adapter=createSensorsAdapter();await adapter.start(settings());
  await adapter.ingest(packet(),1000,h.context);
  const value=packet(2);value.phoneEvents=[
    {kind:'geofence',timestampNanos:'2000',fields:{'region-id':'11111111-1111-4111-8111-111111111111','region-name':'Home',inside:true,'distance-m':5,'accuracy-m':3}},
    {kind:'geofence',timestampNanos:'2000',fields:{'region-id':'22222222-1111-4111-8111-111111111111','region-name':'Garden',inside:false,'distance-m':50,'accuracy-m':3}},
    {kind:'activity',timestampNanos:'2000',fields:{activity:'Walking',transition:'Enter'}},
    {kind:'activity',timestampNanos:'2000',fields:{activity:'Still',transition:'Exit'}}];
  await adapter.ingest(value,2100,h.context);
  assert.deepEqual(h.events.slice(0,4).map(event=>event.id),['phone-geofence-enter','phone-geofence-exit','phone-activity-enter','phone-activity-exit']);
  assert.doesNotMatch(JSON.stringify(h.state.devices[deviceId].phoneClaims),/Garden|latitude|longitude/);
  value.sequence=3;value.readings=[];await adapter.ingest(value,3200,h.context);assert.equal(h.events.length,5);
});

test('phone callbacks baseline startup, claim before dispatch, omit content from state and do not consume raw gesture slots',async()=>{
  const h=harness(),adapter=createSensorsAdapter();await adapter.start(settings());
  const value=gesturePacket();value.phoneEvents=[{kind:'notification',timestampNanos:'100',fields:{package:'example.app',text:'PRIVATE-PHONE-TEXT',removed:false}}];
  await adapter.ingest(value,1000,h.context);assert.equal(h.events.length,0);
  value.sequence=2;value.readings[0].timestampNanos='2000000';value.phoneEvents[0].timestampNanos='200';
  await adapter.ingest(value,2100,h.context);
  assert.deepEqual(h.events.map(event=>event.id),['phone-notification','sensor-25']);
  assert.equal(h.events[0].state.devices[deviceId].phoneClaims.notification,'200');
  assert.doesNotMatch(JSON.stringify(h.state),/PRIVATE-PHONE-TEXT|example.app/);
  value.sequence=3;value.readings[0].ageMs=1100;
  await adapter.ingest(value,3200,h.context);assert.equal(h.events.length,2);
  await adapter.stop();await adapter.start(settings());value.sequence=4;value.phoneEvents[0].timestampNanos='300';
  await adapter.ingest(value,4300,h.context);assert.equal(h.events.length,2);
});

test('a metadata-only report does not turn the first later sensor value into a trigger',async()=>{
  const h=harness(),adapter=createSensorsAdapter();await adapter.start(settings());
  const metadata=packet();metadata.readings=[];await adapter.ingest(metadata,1000,h.context);
  await adapter.ingest(packet(2),2100,h.context);assert.equal(h.events.length,0);
  await adapter.ingest(packet(3),3200,h.context);assert.equal(h.events.length,1);
});

test('connected gestures admit the first occurrence and repeated 1 values, claiming timestamps before dispatch',async()=>{
  for(const [type,mode] of [[25,2],[22,3],[65536,3]]) {
    const h=harness(),adapter=createSensorsAdapter();await adapter.start(settings());
    const metadata=gesturePacket(1,deviceId,type,mode);metadata.readings=[];
    await adapter.ingest(metadata,1000,h.context);
    await adapter.ingest(gesturePacket(2,deviceId,type,mode),2100,h.context);
    await adapter.ingest(gesturePacket(3,deviceId,type,mode),3200,h.context);
    assert.equal(h.events.length,2);
    assert.deepEqual(h.events.map(event=>event.payload['value-0']),[1,1]);
    assert.equal(h.events[0].state.devices[deviceId].events[sensorId].timestamp,'2000000');
    assert.equal(h.events[1].state.devices[deviceId].events[sensorId].timestamp,'3000000');
    const retained=gesturePacket(4,deviceId,type,mode);retained.readings[0].timestampNanos='3000000';retained.readings[0].ageMs=1100;
    await adapter.ingest(retained,4300,h.context);assert.equal(h.events.length,2);
    await adapter.ingest(retained,4500,h.context);assert.equal(h.events.length,2);
  }
});

test('gestures prioritize bounded slots and preserve the first deferred occurrence for the next fresh report',async()=>{
  const config=settings();config['events-per-report']=1;
  const h=harness(),adapter=createSensorsAdapter();await adapter.start(config);
  const value=packet();
  for(const [id,type] of [['s-2222222222222222',25],['s-3333333333333333',17]]) {
    value.catalog.push({...value.catalog[0],id,type,reportingMode:2});
  }
  await adapter.ingest(value,1000,h.context);
  value.sequence=2;value.readings[0].timestampNanos='2000000';
  for(const sensor of value.catalog.slice(1))value.readings.push({sensorId:sensor.id,values:[1],accuracy:-1,timestampNanos:'2000000',ageMs:0});
  await adapter.ingest(value,2100,h.context);
  assert.equal(h.events.length,1);assert.ok(['sensor-17','sensor-25'].includes(h.events[0].id));
  const emitted=h.events[0].id;
  assert.ok(Object.values(h.state.devices[deviceId].events).some(claim=>claim.timestamp===null));
  value.sequence=3;value.readings.forEach(sample=>sample.ageMs=1100);
  await adapter.ingest(value,3200,h.context);
  assert.equal(h.events.length,2);assert.notEqual(h.events[1].id,emitted);
  value.sequence=4;value.readings.forEach(sample=>sample.ageMs=2200);
  await adapter.ingest(value,4300,h.context);
  assert.equal(h.events.at(-1).id,'sensor-4');
});

test('initial, old first, restarted, reconnected and replaced gesture samples cannot replay',async()=>{
  let at=1000;const h=harness(),adapter=createSensorsAdapter({now:()=>at});await adapter.start(settings());
  await adapter.ingest(gesturePacket(),at,h.context);assert.equal(h.events.length,0);
  await adapter.stop();await adapter.start(settings());
  await adapter.ingest(gesturePacket(2),2100,h.context);assert.equal(h.events.length,0);
  await adapter.ingest(gesturePacket(3),3200,h.context);assert.equal(h.events.length,1);
  at=9000;await adapter.execute('refresh',{},h.context);
  await adapter.ingest(gesturePacket(4),9100,h.context);
  assert.equal(h.events.filter(event=>event.id==='sensor-25').length,1);
  const replacement=gesturePacket(5);replacement.catalog[0].name='Replacement';
  await adapter.ingest(replacement,10200,h.context);assert.equal(h.events.filter(event=>event.id==='sensor-25').length,1);
  const late=gesturePacket(1,secondId);late.readings=[];await adapter.ingest(late,11000,h.context);
  const cached=gesturePacket(2,secondId);cached.readings[0].ageMs=4000;
  await adapter.ingest(cached,12100,h.context);assert.equal(h.events.filter(event=>event.id==='sensor-25').length,1);
});

test('multiple devices retain raw samples, baseline starts, claim before events and reject duplicate/retired sessions',async()=>{
  const h=harness();const adapter=createSensorsAdapter();await adapter.start(settings());
  await adapter.ingest(packet(),1000,h.context);await adapter.ingest(packet(1,secondId),1000,h.context);
  assert.equal(h.events.length,0);
  const second=packet(2);second.readings[0].values=[-0.123456789,0,4];
  await adapter.ingest(second,2100,h.context);
  assert.equal(h.events.length,1);assert.equal(h.events[0].id,'sensor-4');
  assert.equal(h.events[0].payload.x,-0.123456789);assert.equal(h.events[0].payload.y,0);
  assert.equal(h.events[0].state.devices[deviceId].sequence,2);
  assert.equal(h.events[0].state.devices[deviceId].events[sensorId].timestamp,'2000000');
  assert.equal(h.state.devices[secondId].name,'Phone two');
  assert.equal((await adapter.ingest(second,2200,h.context)).accepted,false);
  const replacement=packet(1);replacement.sessionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await adapter.ingest(replacement,3300,h.context);assert.equal(h.events.length,1);
  assert.equal((await adapter.ingest(packet(3),4400,h.context)).accepted,false);
  await adapter.stop();await adapter.start(settings());
  replacement.sequence=2;replacement.readings[0].timestampNanos='3000000';
  await adapter.ingest(replacement,5500,h.context);assert.equal(h.events.length,1);
});

test('connection checks use reception time, emit once and reconnect without replaying sensor values',async()=>{
  let at=1000;const h=harness(),adapter=createSensorsAdapter({now:()=>at});await adapter.start(settings());
  await adapter.ingest(packet(),at,h.context);at=6100;
  await adapter.execute('refresh',{},h.context);assert.equal(h.events[0].id,'device-offline');
  assert.equal(h.state.devices[deviceId].online,false);
  await adapter.execute('refresh',{},h.context);assert.equal(h.events.length,1);
  await adapter.ingest(packet(2),6200,h.context);assert.equal(h.events.at(-1).id,'device-online');
  assert.equal(h.events.filter(event=>event.id==='sensor-4').length,0);
  const previousTransition=h.events[0].payload['transition-id'];
  at=12000;await adapter.execute('refresh',{},h.context);
  assert.notEqual(h.events.at(-1).payload['transition-id'],previousTransition);
  assert.equal(h.events.at(-1).state.devices[deviceId].transitionId,h.events.at(-1).payload['transition-id']);
  h.signal.abort();await assert.rejects(adapter.ingest(packet(3),7300,h.context));
  assert.equal(h.state.devices[deviceId].sequence,2);
});

test('Sensorium keeps raw signed axes, zero light and stable physical sources; missing or deselected values clear',async()=>{
  let at=1000;const h=harness(),adapter=createSensorsAdapter({now:()=>at});await adapter.start(settings());
  const value=packet(),accel='s-2222222222222222',light='s-3333333333333333',proximity='s-4444444444444444';
  const add=(id,type,name,unit,values)=>{
    value.catalog.push({...value.catalog[0],id,type,name,unit});
    value.readings.push({...value.readings[0],sensorId:id,values});
  };
  add(accel,1,'Accelerometer','m/s²',[-1.25,0,9.81]);
  add(light,5,'Ambient light','lux',[0]);add(proximity,8,'Proximity','cm',[5]);
  add('s-5555555555555555',1,'Second accelerometer','m/s²',[99,99,99]);
  await adapter.ingest(value,at,h.context);
  let d=h.state.devices[deviceId];
  assert.equal(d['acceleration-x'],-1.25);assert.equal(d['acceleration-y'],0);assert.equal(d['acceleration-z'],9.81);
  assert.equal(d['rotation-x'],1);assert.equal(d['ambient-light'],0);assert.equal(d.proximity,5);
  assert.equal(d['acceleration-unit'],'m/s²');assert.equal(d['acceleration-name'],'Accelerometer');
  // Reordering the catalogue does not switch to a different accelerometer.
  value.sequence=2;value.catalog.reverse();await adapter.ingest(value,2100,h.context);
  assert.equal(h.state.devices[deviceId]['acceleration-x'],-1.25);
  // Missing samples on a new session must not be replaced by another sensor.
  value.sessionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';value.sequence=1;
  value.readings=value.readings.filter(sample=>sample.sensorId!==accel);
  await adapter.ingest(value,3200,h.context);
  assert.equal(h.state.devices[deviceId]['acceleration-x'],undefined);
  const disabled=value.catalog.find(sensor=>sensor.id===light);disabled.selected=false;disabled.status='Not selected';
  value.readings=value.readings.filter(sample=>sample.sensorId!==light);value.sequence=2;
  await adapter.ingest(value,4300,h.context);
  assert.equal(h.state.devices[deviceId]['ambient-light'],undefined);
  assert.equal(h.state.devices[deviceId]['ambient-light-unit'],undefined);
  at=10000;await adapter.execute('refresh',{},h.context);d=h.state.devices[deviceId];
  assert.match(d['reading-status'],/No recent reports.*retained/);assert.equal(d.proximity,5);
});

test('Sensorium serves contained assets and projects only the chosen device, with missing readings explicit',async t=>{
  const {app,post}=await fixture(t);
  const value=packet();value.catalog[0].type=1;value.catalog[0].name='Accelerometer';value.catalog[0].unit='m/s²';
  value.readings[0].values=[-3,0,9];assert.equal((await post(value)).status,200);
  const other=structuredClone(value);other.deviceId=secondId;other.readings[0].values=[77,78,79];
  assert.equal((await post(other)).status,200);
  const card=await app.registry.saveCard('sensors',{schemaVersion:1,layout:'readymade',templateId:'sensorium',sourceId:deviceId,enabled:true});
  const service=app.registry.services()[0];
  const projected=selectedCardData(card,service.cardData,service.cardCatalog);
  const get=id=>projected.data.values[projected.data.readyMade.bindings[id]];
  assert.equal(get('acceleration-x').value,-3);assert.equal(get('acceleration-y').value,0);
  assert.equal(get('ambient-light').available,false);assert.equal(get('rotation-x').available,false);
  assert.doesNotMatch(JSON.stringify(projected),new RegExp(secondId+'|timestampNanos|sessionId|stringType|retiredSessions'));
  for(const asset of ['card.html','card.css','assets/motif.svg']) {
    const response=await fetch(app.origin+'/plugin-card-assets/sensors/sensorium/'+asset);
    assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/script-src 'none'/);
  }
  assert.equal((await fetch(app.origin+'/plugin-card-assets/sensors/sensorium/server/index.mjs')).status,404);
  const record=app.registry.get('sensors'),config=record.config.snapshot();config.settings.devices[0].enabled=false;
  await app.registry.saveConfiguration('sensors',{revision:config.revision,settings:config.settings});
  const updated=app.registry.services()[0];
  const hidden=selectedCardData(card,updated.cardData,updated.cardCatalog);
  assert.ok(Object.values(hidden.data.values).every(datum=>!datum.available));
});

test('a rate-limited on-change sample gets a later fair turn without duplicate events',async()=>{
  const config=settings();config['events-per-report']=1;
  const h=harness(),adapter=createSensorsAdapter();await adapter.start(config);
  const first=packet();first.catalog.push({...first.catalog[0],id:'s-2222222222222222',type:5,name:'Light',stringType:'android.sensor.light',unit:'lux'});
  first.readings.push({...first.readings[0],sensorId:'s-2222222222222222',values:[50]});
  await adapter.ingest(first,1000,h.context);
  const update=structuredClone(first);update.sequence=2;update.readings.forEach(sample=>sample.timestampNanos='2000000');
  await adapter.ingest(update,2100,h.context);assert.equal(h.events.length,1);
  update.sequence=3;update.readings.forEach(sample=>sample.ageMs=1000);
  await adapter.ingest(update,3200,h.context);assert.equal(h.events.length,2);
  assert.equal(new Set(h.events.map(event=>event.id)).size,2);
  update.sequence=4;await adapter.ingest(update,4300,h.context);assert.equal(h.events.length,2);
  const scalar=h.events.find(event=>event.id==='sensor-5').payload;
  assert.equal(scalar['value-0'],50);assert.equal(scalar.x,undefined);
});

async function fixture(t) {
  const base=fileURLToPath(new URL('./.tmp/',import.meta.url));await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'sensors-'));
  await fs.cp(new URL('../plugins/sensors/',import.meta.url),path.join(root,'plugins/sensors'),{recursive:true,filter:source=>!['data','build','dist','vendor'].some(part=>source.split(path.sep).includes(part))});
  await fs.mkdir(path.join(root,'server'),{recursive:true});
  for(const name of ['sensor-protocol.mjs','phone-events.mjs','storage.mjs'])await fs.copyFile(new URL('../server/'+name,import.meta.url),path.join(root,'server',name));
  const app=await createLocalserve(root,{automatic:false});
  t.after(async()=>{await app.close();assert.ok(root.startsWith(base));await fs.rm(root,{recursive:true,force:true});});
  await app.registry.saveConfiguration('sensors',{revision:1,enabled:true,settings:settings()});
  const post=(body,headers={})=>fetch(app.origin+'/api/sensors/report',{method:'POST',headers:{'Content-Type':'application/json','X-Localserve-Sensors':'1',...headers},body:JSON.stringify(body)});
  return {app,post,root};
}

test('native LAN ingress auto-registers devices, rejects browser/paused/disabled reports and exposes typed Tasks',async t=>{
  const {app,post}=await fixture(t);
  const record=app.registry.get('sensors');
  await app.registry.saveConfiguration('sensors',{revision:record.config.snapshot().revision,settings:{...settings(),devices:[]}});
  assert.equal((await post(packet(),{Origin:app.origin})).status,403);
  assert.equal((await fetch(app.origin+'/api/sensors/report')).status,405);
  let response=await post(packet());assert.equal(response.status,200,await response.clone().text());
  assert.equal(record.config.snapshot().settings.devices[0].id,deviceId);
  assert.ok(app.registry.events().some(event=>event.id==='plugin:sensors:event:sensor-4:'+deviceId+':'+sensorId));
  const gyro=app.registry.events().find(event=>event.instanceId===deviceId && event.eventId==='sensor-4');
  assert.ok(gyro.payload.some(field=>field.id==='x'));
  assert.ok(!gyro.payload.some(field=>field.id==='value-3'));
  assert.ok(!app.registry.events().some(event=>event.eventId==='sensor-5'));
  assert.equal((await post(packet(1,secondId))).status,200);
  assert.equal(record.config.snapshot().settings.devices.length,2);
  await app.engine.setPaused(true);
  assert.equal((await post(packet(2))).status,409);
  await app.engine.setPaused(false);
  const config=record.config.snapshot();config.settings.devices[0].enabled=false;
  await app.registry.saveConfiguration('sensors',{revision:config.revision,settings:config.settings});
  await new Promise(resolve=>setTimeout(resolve,260));
  assert.equal((await post(packet(2))).status,403);
  assert.equal((await fetch(app.origin+'/plugins/sensors/android/src/local/localserve/sensors/MainActivity.java')).status,404);
});

test('two device-specific Task rules receive raw Event properties and trigger only on threshold edges',async t=>{
  const {app,post}=await fixture(t);
  assert.equal(app.registry.pollMilliseconds(app.registry.get('sensors')),5000);
  assert.equal((await post(packet())).status,200);
  assert.equal((await post(packet(1,secondId))).status,200);
  for(const [id,name] of [[deviceId,'Phone one rule'],[secondId,'Phone two rule']]) {
    const definition={name,enabled:true,starts:[{id:'gyro',name:'Gyroscope',enabled:true,type:'event',eventId:'plugin:sensors:event:sensor-4:'+id+':'+sensorId,
      condition:{field:'x',operator:'gt',value:5}}],steps:[{id:'log',type:'log',enabled:true,message:'{{event.device-name}} x={{event.x}} y={{event.value-1}}'}]};
    const response=await fetch(app.origin+'/api/tasks',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Localserve-Token':app.snapshot().token},body:JSON.stringify(definition)});
    assert.equal(response.status,200,await response.clone().text());
  }
  const send=async(sequence,id,x)=>{const value=packet(sequence,id);value.readings[0].values=[x,0,3];const response=await post(value);assert.equal(response.status,200,await response.clone().text());};
  const settle=async()=>{const deadline=Date.now()+3000;while(app.engine.active.size || app.engine.pending.size){if(Date.now()>deadline)throw new Error('Task did not settle');await new Promise(resolve=>setTimeout(resolve,10));}};
  await new Promise(resolve=>setTimeout(resolve,1100));
  await send(2,deviceId,6);await settle();
  assert.equal(app.state.snapshot().runs.length,1);
  assert.equal(app.state.snapshot().runs[0].event.payload.x,6);
  await new Promise(resolve=>setTimeout(resolve,1100));
  await send(3,deviceId,7);await send(2,secondId,8);await settle();
  assert.equal(app.state.snapshot().runs.length,2);
  assert.ok(app.activity.latest().some(entry=>entry.message==='Phone one x=6 y=0'));
  assert.ok(app.activity.latest().some(entry=>entry.message==='Phone two x=8 y=0'));
  assert.ok(!app.registry.get('sensors').log.latest().some(entry=>entry.eventId==='sensor-4'));
});

test('first connected pickup runs a Task, repeated matching pickup values run again, retained timestamps do not',async t=>{
  const {app,post}=await fixture(t);
  const first=gesturePacket();first.readings=[];assert.equal((await post(first)).status,200);
  const eventId='plugin:sensors:event:sensor-25:'+deviceId+':'+sensorId;
  const capability=app.registry.events().find(event=>event.id===eventId);
  assert.equal(capability.occurrenceKey,'timestamp-ns');
  const save=async(name,condition)=>{
    const response=await fetch(app.origin+'/api/tasks',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Localserve-Token':app.snapshot().token},
      body:JSON.stringify({name,enabled:true,starts:[{id:'pickup',name:'Pickup',type:'event',enabled:true,eventId,...(condition?{condition}:{})}],
        steps:[{id:'log',type:'log',enabled:true,message:'Pickup {{event.sensor-name}}'}]})});
    assert.equal(response.status,200,await response.clone().text());
  };
  const settle=async()=>{const limit=Date.now()+3000;while(app.engine.active.size || app.engine.pending.size){if(Date.now()>limit)throw new Error('Task did not settle');await new Promise(resolve=>setTimeout(resolve,10));}};
  await save('Every pickup');
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal((await post(gesturePacket(2))).status,200);await settle();
  assert.equal(app.state.snapshot().runs.length,1,'First real post-connection pickup is not a discarded baseline');
  await save('Pickup equals one',{field:'value-0',operator:'eq',value:1});
  for(const sequence of [3,4]) {
    await new Promise(resolve=>setTimeout(resolve,1100));
    assert.equal((await post(gesturePacket(sequence))).status,200);await settle();
    assert.equal(app.state.snapshot().runs.length,1+2*(sequence-2));
  }
  const retained=gesturePacket(5);retained.readings[0].timestampNanos='4000000';retained.readings[0].ageMs=1100;
  await new Promise(resolve=>setTimeout(resolve,1100));assert.equal((await post(retained)).status,200);await settle();
  assert.equal(app.state.snapshot().runs.length,5);
  assert.ok(app.state.snapshot().runs.every(run=>run.event.payload['value-0']===1));
});

test('vendor trigger and continuous sensors receive different occurrence semantics on their exact capabilities',async t=>{
  const {app,post}=await fixture(t),value=gesturePacket(1,deviceId,65000,3);
  value.catalog.push({...value.catalog[0],id:'s-2222222222222222',type:65001,reportingMode:0});
  value.readings.push({...value.readings[0],sensorId:'s-2222222222222222'});
  assert.equal((await post(value)).status,200);
  const events=app.registry.events().filter(event=>event.eventId==='other-reading' && event.instanceId===deviceId);
  assert.equal(events.length,2);
  assert.equal(events.find(event=>event.sensorId===sensorId).occurrenceKey,'timestamp-ns');
  assert.equal(events.find(event=>event.sensorId!==sensorId).occurrenceKey,undefined);
});

test('native phone fields reach only the selected device Task and callback content is not logged routinely',async t=>{
  const {app,post}=await fixture(t);
  const value=packet();value.readings=[];value.phoneEvents=[{kind:'battery',timestampNanos:'100',fields:{percent:80,charging:false}}];
  assert.equal((await post(value)).status,200);
  const display=await(await fetch(app.origin+'/api/phone-information?device='+deviceId)).json();
  assert.equal(display.phone.battery.fields.percent,80);
  assert.equal(display.phone.battery.fields.charging,false);
  assert.equal(app.registry.get('sensors').state.snapshot().devices[deviceId].battery,undefined);
  const response=await fetch(app.origin+'/api/tasks',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Localserve-Token':app.snapshot().token},
    body:JSON.stringify({name:'Low phone battery',enabled:true,starts:[{id:'battery',name:'Battery',type:'event',enabled:true,eventId:'plugin:sensors:event:phone-battery:'+deviceId,condition:{field:'percent',operator:'lt',value:20}}],
      steps:[{id:'log',type:'log',enabled:true,message:'Battery {{event.percent}}'}]})});
  assert.equal(response.status,200,await response.clone().text());
  value.sequence=2;value.phoneEvents[0]={kind:'battery',timestampNanos:'200',fields:{percent:10,charging:false}};
  await new Promise(resolve=>setTimeout(resolve,300));assert.equal((await post(value)).status,200);
  const limit=Date.now()+3000;while(app.engine.active.size || app.engine.pending.size){if(Date.now()>limit)throw new Error('Task did not settle');await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(app.state.snapshot().runs.length,1);assert.equal(app.state.snapshot().runs[0].event.payload.percent,10);
  assert.ok(!app.registry.get('sensors').log.latest().some(entry=>entry.eventId==='phone-battery'));
  const latest=await(await fetch(app.origin+'/api/phone-information?device='+deviceId)).json();
  assert.equal(latest.phone.battery.fields.percent,10);
});

test('region/activity enter choices accept named filters and capture public values without device effects',async t=>{
  const {app,post}=await fixture(t),value=packet();value.readings=[];assert.equal((await post(value)).status,200);
  for(const [name,eventId,field,wanted] of [['Arrive home','phone-geofence-enter','region-name','Home'],['Start walking','phone-activity-enter','activity','Walking']]) {
    const response=await fetch(app.origin+'/api/tasks',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Localserve-Token':app.snapshot().token},body:JSON.stringify({name,enabled:true,
      starts:[{id:'transition',name:'Transition',enabled:true,type:'event',eventId:'plugin:sensors:event:'+eventId+':'+deviceId,condition:{field,operator:'eq',value:wanted}}],
      steps:[{id:'log',type:'log',enabled:true,message:'{{event.'+field+'}}'}]})});
    assert.equal(response.status,200,await response.clone().text());
  }
  value.sequence=2;value.phoneEvents=[
    {kind:'geofence',timestampNanos:'2000',fields:{'region-id':'11111111-1111-4111-8111-111111111111','region-name':'Home',inside:true,'distance-m':2,'accuracy-m':1}},
    {kind:'activity',timestampNanos:'2000',fields:{activity:'Walking',transition:'Enter'}}];
  await new Promise(resolve=>setTimeout(resolve,300));assert.equal((await post(value)).status,200);
  const limit=Date.now()+3000;while(app.engine.active.size||app.engine.pending.size){if(Date.now()>limit)throw new Error('Task did not settle');await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(app.state.snapshot().runs.length,2);
  assert.ok(app.state.snapshot().runs.some(run=>run.event.payload['region-name']==='Home'));
  assert.ok(app.state.snapshot().runs.some(run=>run.event.payload.activity==='Walking'));
  assert.equal(app.registry.events().find(event=>event.eventId==='phone-geofence-enter').occurrenceKey,'timestamp-ns');
});

test('Android download route serves only the APK, leaves signing/source files private and preserves manifest identity',async t=>{
  const {app,root}=await fixture(t);
  assert.equal((await fetch(app.origin+'/downloads/localserve-sensors.apk')).status,404);
  const directory=path.join(root,'plugins/sensors/android/dist');await fs.mkdir(directory,{recursive:true});
  const original=await fs.readFile(new URL('../plugins/sensors/android/dist/localserve-sensors.apk',import.meta.url));
  await fs.writeFile(path.join(directory,'localserve-sensors.apk'),original);
  await fs.copyFile(new URL('../plugins/sensors/android/dist/verification.json',import.meta.url),path.join(directory,'verification.json'));
  const response=await fetch(app.origin+'/downloads/localserve-sensors.apk');
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/vnd.android.package-archive');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),original);
  const controller=await fetch(app.origin+'/downloads/controller.apk');assert.equal(controller.status,200);assert.equal(controller.headers.get('content-disposition'),'attachment; filename="controller.apk"');
  assert.equal((await fetch(app.origin+'/downloads/localserve-sensors.apk',{method:'HEAD'})).status,200);
  assert.equal((await fetch(app.origin+'/downloads/localserve-sensors.apk?file=anything')).status,405);
  assert.equal((await fetch(app.origin+'/tools/android-build/private/sensors-signing.p12')).status,404);
  const manifest=await fs.readFile(new URL('../plugins/sensors/android/AndroidManifest.xml',import.meta.url),'utf8');
  assert.match(manifest,/targetSdkVersion="35"/);assert.match(manifest,/minSdkVersion="26"/);
  assert.doesNotMatch(manifest,/BOOT_COMPLETED|RECORD_AUDIO|ACCESS_BACKGROUND_LOCATION|CAMERA/);
  assert.match(manifest,/FOREGROUND_SERVICE_LOCATION/);
  assert.match(manifest,/android:versionName="\d+\.\d+\.\d+"/);
});

test('two gyroscopes on one device cannot trigger each other’s Task or supply each other’s captured values',async t=>{
  const {app,post}=await fixture(t);
  const other='s-2222222222222222';
  const value=packet();value.catalog.push({...value.catalog[0],id:other,name:'Second gyroscope'});
  value.readings.push({...value.readings[0],sensorId:other,values:[0,0,0]});
  assert.equal((await post(value)).status,200);
  assert.equal(app.registry.events().filter(event=>event.instanceId===deviceId && event.eventId==='sensor-4').length,2);
  const definition={name:'Selected physical sensor',enabled:true,starts:[{id:'gyro',name:'Selected gyro',enabled:true,type:'event',
    eventId:'plugin:sensors:event:sensor-4:'+deviceId+':'+sensorId,condition:{field:'x',operator:'gt',value:5}}],
    steps:[{id:'log',type:'log',enabled:true,message:'{{event.sensor-id}} {{event.x}}'}]};
  const saved=await fetch(app.origin+'/api/tasks',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Localserve-Token':app.snapshot().token},body:JSON.stringify(definition)});
  assert.equal(saved.status,200,await saved.clone().text());
  await new Promise(resolve=>setTimeout(resolve,1100));
  value.sequence=2;value.readings.forEach(sample=>sample.timestampNanos='2000000');value.readings[1].values[0]=99;
  assert.equal((await post(value)).status,200);assert.equal(app.state.snapshot().runs.length,0);
  await new Promise(resolve=>setTimeout(resolve,1100));
  value.sequence=3;value.readings.forEach(sample=>sample.timestampNanos='3000000');value.readings[0].values[0]=6;
  assert.equal((await post(value)).status,200);
  const deadline=Date.now()+3000;while(app.engine.active.size || app.engine.pending.size){if(Date.now()>deadline)throw new Error('Task did not settle');await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(app.state.snapshot().runs.length,1);
  const run=app.state.snapshot().runs[0],task=app.tasks.snapshot()[0];
  assert.equal(run.event.payload['sensor-id'],sensorId);
  const wrong={...task,starts:[{...task.starts[0],eventId:'plugin:sensors:event:sensor-4:'+deviceId+':'+other}]};
  assert.throws(()=>app.engine.capturedEvent(run,wrong),/matching declared Event/);
});
