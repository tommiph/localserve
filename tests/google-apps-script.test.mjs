/** A simulated Apps Script runtime and disposable local stores exercise the
 * relay without contacting Google, sending phone data or controlling devices. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {createHmac,randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {validateTask} from '../server/tasks.mjs';
import {createSensorsAdapter} from '../plugins/sensors/server/index.mjs';
import {relayUrl,relayClient,signRelay,readRelay} from '../server/relay-protocol.mjs';
import {CloudRelay} from '../server/cloud-relay.mjs';
import {SensorIngress} from '../server/sensor-ingress.mjs';
import {PhoneDisplayCache} from '../server/phone-display.mjs';
import {AndRuleGroups} from '../server/task-rule-groups.mjs';
import {createRelayAdapter,validRelaySettings} from '../plugins/google-apps-script/server/index.mjs';
import {selectorFixture} from './fixtures/scene-selector.mjs';
const collectorKey='1'.repeat(64),clientKey='2'.repeat(64),url='https://script.google.com/macros/s/abcdefghijklmnop123456/exec';
const clientTag=createHmac('sha256',clientKey).update([1,'phone','identity',0,'identity',''].join('\n')).digest('hex');
const sensorDevice='android-12345678-1234-1234-1234-123456789abc';
async function google(){
  let at=1700000000000;const properties=new Map();
  properties.set('LOCAL_SERVE_RELAY',JSON.stringify({collectorKey,reportIntervalMs:60000,clients:[{id:'phone',key:clientKey,enabled:true,scenes:true,sensors:true,events:true,deviceId:sensorDevice}]}));
  const store={getProperty:key=>properties.has(key)?properties.get(key):null,setProperty(key,value){assert.ok(Buffer.byteLength(value)<=9216);properties.set(key,value);},deleteProperty:key=>properties.delete(key),getProperties:()=>Object.fromEntries(properties),setProperties(values){for(const [key,value] of Object.entries(values))this.setProperty(key,value);}};
  const content={MimeType:{JSON:'application/json'},createTextOutput:text=>({text,setMimeType(){return this;}})};
  const context=vm.createContext({Date:class extends Date{static now(){return at;}},ContentService:content,PropertiesService:{getScriptProperties:()=>store},LockService:{getScriptLock:()=>({tryLock:()=>true,hasLock:()=>true,releaseLock(){}})},Utilities:{Charset:{UTF_8:'UTF-8'},getUuid:randomUUID,
    newBlob:value=>{const bytes=Buffer.from(value);return {getBytes:()=>Array.from(bytes),getDataAsString:()=>bytes.toString('utf8')};},base64Encode:bytes=>Buffer.from(bytes).toString('base64'),base64Decode:text=>Array.from(Buffer.from(text,'base64')),computeHmacSha256Signature:(text,key)=>Array.from(createHmac('sha256',key).update(text).digest()).map(byte=>byte>127?byte-256:byte)}});
  vm.runInContext(await fs.readFile(new URL('../plugins/google-apps-script/server/apps-script/Code.gs',import.meta.url),'utf8'),context);
  const post=envelope=>JSON.parse(context.doPost({postData:{contents:JSON.stringify(envelope)}}).text);
  const send=(clientId,op,payload,options={})=>{
    const key=clientId==='collector'?collectorKey:clientKey,request=signRelay(clientId,key,op,payload,at,options.nonce||randomUUID());
    return readRelay(post(request),key,{clientId,op,nonce:request.nonce,now:at});
  };
  return {send,post,properties,context,now:()=>at,advance:ms=>at+=ms};
}
const catalogue=()=>({name:'Example server',paused:false,revision:2,scenes:[{key:'tradfri/lights/evening',type:'scene',name:'Evening',icon:'moon',revision:3,available:true}],tasks:[]});
test('relay URL and authenticated envelope reject foreign hosts, edited bodies and stale responses',()=>{
  assert.equal(relayUrl(url),url);
  for(const value of ['http://script.google.com/macros/s/abcdefghijklmnop/exec',url+'?key=private',url.replace('script.google.com','script.google.com.example'),url.replace('/exec','/dev')])assert.throws(()=>relayUrl(value));
  const at=1700000000000,request=signRelay('phone',clientKey,'event',{value:0,active:false},at);
  assert.deepEqual(readRelay(request,clientKey,{clientId:'phone',op:'event',nonce:request.nonce,now:at}),{value:0,active:false});
  assert.throws(()=>readRelay({...request,payload:Buffer.from('{}').toString('base64')},clientKey,{clientId:'phone',op:'event',nonce:request.nonce,now:at}),/authentication/);
  assert.throws(()=>readRelay(request,clientKey,{clientId:'phone',op:'event',nonce:request.nonce,now:at+120001}),/expired/);
});
test('cloud authentication, nonce claims and sender permissions protect every operation',async()=>{
  const g=await google();assert.equal(g.send('collector','ping',{}).ok,true);
  const nonce=randomUUID();assert.equal(g.send('phone','event',{id:randomUUID(),channel:'signal',message:'hello'},{nonce}).ok,true);
  assert.equal(g.send('phone','event',{id:randomUUID(),channel:'signal',message:'hello'},{nonce}).ok,false);
  assert.equal(g.send('phone','sync',{catalog:catalogue()}).ok,false);
  assert.equal(g.send('phone','sensor',{id:randomUUID(),deviceId:sensorDevice.replace('abc','def'),packet:'e30='}).ok,false);
  const bad=signRelay('phone','3'.repeat(64),'catalog',{},g.now());assert.equal(g.post(bad).ok,false);
  assert.deepEqual(JSON.parse(g.context.doGet().text),{service:'Localserve relay',protocol:1});
});
test('shortcuts use a fresh server catalogue and do not accept arbitrary actions or changed request identities',async()=>{
  const g=await google(),id=randomUUID(),command={id,type:'scene',key:'tradfri/lights/evening',revision:3};
  assert.equal(g.send('phone','run',command).ok,false);
  g.send('collector','sync',{catalog:catalogue(),receipts:[]});assert.equal(g.send('phone','run',command).status,'queued');
  assert.equal(g.send('phone','run',command).status,'queued');
  assert.equal(g.send('phone','run',{...command,arbitrary:'execute code'}).ok,false);
  assert.equal(g.send('phone','run',{...command,id:randomUUID(),key:'other/action'}).ok,false);
  g.advance(120001);assert.equal(g.send('phone','run',{...command,id:randomUUID()}).ok,false);
});
test('sensor slots keep only the latest report and late acknowledgement cannot delete its replacement',async()=>{
  const g=await google(),old=randomUUID(),newer=randomUUID();
  const report=id=>({id,deviceId:sensorDevice,packet:'e30='});g.send('phone','sensor',report(old));
  let batch=g.send('collector','sync',{catalog:catalogue(),receipts:[]});assert.equal(batch.messages.length,1);assert.equal(batch.messages[0].id,old);
  g.send('phone','sensor',report(newer));g.send('collector','ack',{results:[{id:old,clientId:'phone',status:'received'}]});
  batch=g.send('collector','sync',{catalog:catalogue(),receipts:[]});assert.equal(batch.messages.length,1);assert.equal(batch.messages[0].id,newer);
  g.advance(90001);assert.equal(g.send('collector','sync',{catalog:catalogue(),receipts:[]}).messages.length,0);
});
test('receipts distinguish queued delivery, rejected requests and actual shortcut completion',async()=>{
  const g=await google(),id=randomUUID();g.send('collector','sync',{catalog:catalogue(),receipts:[]});g.send('phone','run',{id,type:'scene',key:'tradfri/lights/evening',revision:3});
  assert.equal(g.send('phone','receipt',{id}).receipt,null);
  g.send('collector','ack',{results:[{id,clientId:'phone',status:'accepted'}]});assert.equal(g.send('phone','receipt',{id}).receipt.status,'accepted');
  g.send('collector','sync',{catalog:catalogue(),receipts:[{id,clientId:'phone',status:'completed'}]});assert.equal(g.send('phone','receipt',{id}).receipt.status,'completed');
  assert.equal(g.send('phone','receipt',{id:randomUUID()}).receipt,null);
});
test('cloud storage chunks remain below property limits and pending inbox capacity is bounded',async()=>{
  const g=await google();
  g.send('phone','sensor',{id:randomUUID(),deviceId:sensorDevice,packet:Buffer.alloc(18000,7).toString('base64')});
  assert.ok([...g.properties.keys()].filter(key=>key.startsWith('d_')).length>1);
  for(let index=0;index<39;index++)assert.equal(g.send('phone','event',{id:randomUUID(),channel:'test',message:'hi'}).ok,true);
  assert.equal(g.send('phone','event',{id:randomUUID(),channel:'test',message:'hi'}).ok,false);
});
test('Node client follows only the Google GET result redirect without forwarding its signed body',async()=>{
  let request,calls=[];const now=1700000000000;
  const client=relayClient(url,'collector',collectorKey,{now:()=>now,fetcher:async(address,options)=>{
    calls.push({address,options});if(calls.length===1){request=JSON.parse(options.body);return new Response(null,{status:302,headers:{Location:'https://script.googleusercontent.com/macros/echo?result=one'}});}
    return Response.json(signRelay('collector',collectorKey,request.op,{ok:true},now,request.nonce));
  }});
  assert.equal((await client('ping',{},new AbortController().signal)).ok,true);assert.equal(calls.length,2);assert.equal(calls[1].options.method,'GET');assert.equal(calls[1].options.body,undefined);assert.equal(calls[1].options.redirect,'error');
  const hostile=relayClient(url,'collector',collectorKey,{fetcher:async()=>new Response(null,{status:302,headers:{Location:'https://example.com/'}})});
  await assert.rejects(hostile('ping',{},new AbortController().signal),/connection failed/);
});
async function bridgeFixture(t){
  const base=path.resolve('tests/.tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'relay-'));
  const gate=Object.assign(new EventEmitter(),{paused:false}),settings={url,'collector-key':collectorKey,'poll-minutes':.5,'report-seconds':60,clients:[{id:'entry-phone','client-id':'phone',key:clientKey,enabled:true,scenes:true,sensors:true,events:true,'device-id':sensorDevice}]};
  const record={plugin:{id:'google-apps-script'},config:{snapshot:()=>({revision:2,settings})},runtime:{}};
  const registry={engine:{gate},assertReady(){}};let effectCount=0;
  const view={...catalogue(),scenes:[{pluginId:'tradfri',slug:'lights',id:'evening',name:'Evening',icon:'moon',revision:3,available:true,token:'private-lan-token'}],tasks:[]};
  const runs=[];
  const home={viewer:()=>structuredClone(view),state:{snapshot:()=>({runs:[]})}},controls={viewer:()=>({token:'private-control-token'}),invoke:async(id,slug,token,values)=>{effectCount++;runs.push({id:values.requestId,status:'queued'});return {id:values.requestId,status:'queued'};},runs:{snapshot:()=>({runs})}};
  const sensors={relay:async()=>({accepted:true})},bridge=await new CloudRelay(root,registry,home,controls,sensors).load();
  const context={signal:new AbortController().signal,relayClaim:{epoch:bridge.epoch,runtime:record.runtime,revision:2}};
  t.after(async()=>{await bridge.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  const message=(kind,payload={})=>({id:randomUUID(),clientId:'phone',kind,keyTag:clientTag,createdAt:Date.now(),expiresAt:Date.now()+90000,payload});
  return {bridge,record,context,settings,gate,message,effects:()=>effectCount,sensors};
}
test('bridge exports only the scoped catalogue, never LAN tokens or raw readings',async t=>{
  const f=await bridgeFixture(t),snapshot=await f.bridge.exchange(f.record,{operation:'snapshot'},f.context);
  assert.equal(snapshot.catalog.scenes[0].key,'tradfri/lights/evening');assert.doesNotMatch(JSON.stringify(snapshot),/token|private-lan|private-control|sensor.*reading/);
});
test('durable relay claims prevent duplicate commands and reject stale/disabled shortcut authority',async t=>{
  const f=await bridgeFixture(t),message=f.message('shortcut');message.payload={id:message.id,type:'scene',key:'tradfri/lights/evening',revision:3};
  assert.equal((await f.bridge.exchange(f.record,{operation:'receive',message},f.context)).status,'queued');await f.bridge.exchange(f.record,{operation:'receive',message},f.context);assert.equal(f.effects(),1);
  const stale=f.message('shortcut');stale.payload={...message.payload,id:stale.id,revision:2};assert.equal((await f.bridge.exchange(f.record,{operation:'receive',message:stale},f.context)).status,'rejected');assert.equal(f.effects(),1);
  f.settings.clients[0].scenes=false;const denied=f.message('shortcut');denied.payload={...message.payload,id:denied.id};assert.equal((await f.bridge.exchange(f.record,{operation:'receive',message:denied},f.context)).reason,'client-permission-denied');
  f.gate.paused=true;await assert.rejects(f.bridge.exchange(f.record,{operation:'snapshot'},f.context),/state changed/);
});
test('client key rotation rejects old-key messages before shortcut admission',async t=>{
  const f=await bridgeFixture(t);f.settings.clients[0].key='4'.repeat(64);
  const message=f.message('shortcut');message.payload={id:message.id,type:'scene',key:'tradfri/lights/evening',revision:3};
  assert.equal((await f.bridge.exchange(f.record,{operation:'receive',message},f.context)).reason,'client-permission-denied');assert.equal(f.effects(),0);
});
test('cloud expiry produces an explicit receipt and collector sync acknowledges already received messages',async()=>{
  const g=await google(),id=randomUUID();g.send('collector','sync',{catalog:catalogue(),receipts:[]});g.send('phone','run',{id,type:'scene',key:'tradfri/lights/evening',revision:3});
  g.advance(90001);assert.equal(g.send('phone','receipt',{id}).receipt.status,'expired');
  const next=randomUUID();g.send('phone','event',{id:next,channel:'test',message:'one'});
  assert.equal(g.send('collector','sync',{catalog:catalogue(),receipts:[{id:next,clientId:'phone',status:'received'}]}).messages.length,0);
});
test('collector publishes local permission revocation without exposing client keys',async()=>{
  const g=await google();g.send('collector','sync',{catalog:catalogue(),receipts:[],clients:[{id:'phone',enabled:true,scenes:false,sensors:true,events:true,deviceId:sensorDevice}]});
  assert.equal(g.send('phone','catalog',{}).ok,false);assert.equal(g.send('phone','event',{id:randomUUID(),channel:'test',message:'one'}).ok,true);
});

test('only a signed collector installs new clients and rotates keys through a validated atomic replacement',async()=>{
  const g=await google(),clients=[{id:'new-phone',key:clientKey,enabled:true,scenes:true,sensors:true,events:false,deviceId:sensorDevice}];
  assert.equal(g.send('phone','sync',{catalog:catalogue(),clients}).ok,false);
  const sync=g.send('collector','sync',{catalog:catalogue(),clients});assert.equal(sync.clientSync,1);
  const request=signRelay('new-phone',clientKey,'catalog',{},g.now());assert.equal(readRelay(g.post(request),clientKey,{clientId:'new-phone',op:'catalog',nonce:request.nonce,now:g.now()}).ok,true);
  const before=g.properties.get('LOCAL_SERVE_RELAY');
  assert.equal(g.send('collector','sync',{catalog:catalogue(),clients:[...clients,{...clients[0]}]}).ok,false);assert.equal(g.properties.get('LOCAL_SERVE_RELAY'),before);
  assert.equal(g.send('collector','sync',{catalog:catalogue(),clients:[{...clients[0],key:'4'.repeat(64)}]}).ok,true);
  const old=signRelay('new-phone',clientKey,'catalog',{},g.now());assert.equal(g.post(old).ok,false);
  const fresh=signRelay('new-phone','4'.repeat(64),'catalog',{},g.now());assert.equal(readRelay(g.post(fresh),'4'.repeat(64),{clientId:'new-phone',op:'catalog',nonce:fresh.nonce,now:g.now()}).ok,true);
  g.send('collector','sync',{catalog:catalogue(),clients:[]});assert.deepEqual(JSON.parse(g.properties.get('LOCAL_SERVE_RELAY')).clients,[]);
});
test('relay reception uses a bounded cloud timeout and distinct presence events from LAN reports',async()=>{
  let now=100000,state={};const events=[];const adapter=createSensorsAdapter({now:()=>now});
  const settings={'report-ms':250,'event-seconds':1,'events-per-report':4,'offline-seconds':5,'maintenance-minutes':1/12,devices:[{id:sensorDevice,name:'Phone',enabled:true}]};
  await adapter.start(settings);
  const context={signal:new AbortController().signal,readState:async()=>structuredClone(state),saveState:async value=>state=structuredClone(value),emit:async(id,payload)=>events.push({id,payload})};
  const packet=sequence=>({version:1,deviceId:sensorDevice,deviceName:'Phone',sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sequence,sentAt:now,catalog:[],readings:[]});
  await adapter.ingest(packet(1),now,context);now+=6000;await adapter.execute('refresh',{},context);assert.equal(events.at(-1).id,'device-offline');
  await adapter.ingest(packet(2),now,{...context,reportTransport:'relay',relayTimeoutMs:105000});assert.equal(events.at(-1).id,'relay-online');
  now+=31000;await adapter.execute('refresh',{},context);assert.equal(state.devices[sensorDevice].online,true);
  now+=75000;await adapter.execute('refresh',{},context);assert.equal(state.devices[sensorDevice].online,false);assert.equal(events.at(-1).id,'relay-offline');
  assert.equal(events.filter(event=>event.id==='device-online').length,0);await adapter.stop();
});

test('cloud-delayed scalar samples emit real values while LAN freshness limits remain unchanged',async()=>{
  let now=100000,state={};const events=[],adapter=createSensorsAdapter({now:()=>now});
  await adapter.start({'report-ms':250,'event-seconds':1,'events-per-report':4,'offline-seconds':5,'maintenance-minutes':1/12,devices:[{id:sensorDevice,name:'Phone',enabled:true}]});
  const context={signal:new AbortController().signal,readState:async()=>structuredClone(state),saveState:async value=>state=structuredClone(value),emit:async(id,payload)=>events.push({id,payload})};
  const packet=(sequence,value)=>({version:1,deviceId:sensorDevice,deviceName:'Phone',sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sequence,sentAt:now-40000,
    catalog:[{id:'s-1111111111111111',type:5,stringType:'android.sensor.light',name:'Light',vendor:'Test',unit:'lx',selected:true,status:'Streaming',reportingMode:0,resolution:.1,maximumRange:1000,powerMa:1,minDelayUs:5000}],
    readings:[{sensorId:'s-1111111111111111',values:[value],accuracy:3,timestampNanos:String(sequence*1000000),ageMs:40000}]});
  const relay={...context,reportTransport:'relay',relayTimeoutMs:195000};await adapter.ingest(packet(1,10),now,relay);now+=120000;await adapter.ingest(packet(2,0),now,relay);
  assert.equal(events.find(event=>event.id==='sensor-5')?.payload['value-0'],0);assert.equal(state.devices[sensorDevice]['ambient-light'],0);
  now+=1000;await adapter.ingest(packet(3,20),now,context);now+=1000;await adapter.ingest(packet(4,30),now,context);
  assert.equal(events.filter(event=>event.id==='sensor-5').length,1);await adapter.stop();
});

test('AND presence and phone display retention follow the current report transport',()=>{
  let device={online:false,transport:'relay',sessionId:'one',transitionId:'lost'};
  const events=['device-offline','relay-offline','relay-online'].map(id=>({id,eventId:id,pluginId:'sensors',instanceId:sensorDevice,instanceEnabled:true}));
  const config={enabled:true,revision:1,settings:{'offline-seconds':30,devices:[{id:sensorDevice,enabled:true}]}};
  const record={plugin:{runtime:{ingest:'sensors-v1'}},runtime:{},health:'ready',configured:true,pollGeneration:1,config:{snapshot:()=>config},state:{snapshot:()=>({devices:{[sensorDevice]:device}})}};
  const groups=new AndRuleGroups({registry:{events:()=>events,records:new Map([['sensors',record]])}});
  assert.ok(groups.source({eventId:'relay-offline'}));assert.equal(groups.source({eventId:'device-offline'}),null);device.online=true;assert.ok(groups.source({eventId:'relay-online'}));assert.equal(groups.source({eventId:'relay-offline'}),null);
  const cache=new PhoneDisplayCache(),packet={deviceId:sensorDevice,sessionId:'one',phoneEvents:[{kind:'battery',timestampNanos:'1000',fields:{percent:20}}]},transport={transport:'relay',relayTimeoutMs:195000};
  cache.capture(packet,100000,record,null,transport);cache.capture({...packet,phoneEvents:[]},220000,record,null,transport);assert.equal(cache.snapshot(sensorDevice,record).battery.fields.percent,20);
  cache.capture({...packet,phoneEvents:[]},221000,record,null,{});assert.deepEqual(cache.snapshot(sensorDevice,record),{});
});
test('generic events preserve zero/false without storing their text in relay receipts',async t=>{
  const f=await bridgeFixture(t),message=f.message('event',{channel:'battery',message:'private message',value:0,active:false});
  const result=await f.bridge.exchange(f.record,{operation:'receive',message},f.context);assert.equal(result.event.value,0);assert.equal(result.event.active,false);
  assert.doesNotMatch(JSON.stringify(f.bridge.store.snapshot()),/private message|battery/);assert.equal((await f.bridge.exchange(f.record,{operation:'receive',message},f.context)).event,undefined);
});
test('sensor messages require the pinned phone, bounded gzip and the existing ingress',async t=>{
  const f=await bridgeFixture(t);let received;f.sensors.relay=async(packet,signal,transport)=>{received={packet,transport};return {accepted:true};};
  const message=f.message('sensors',{deviceId:sensorDevice,packet:gzipSync(JSON.stringify({deviceId:sensorDevice})).toString('base64')});
  assert.equal((await f.bridge.exchange(f.record,{operation:'receive',message},f.context)).status,'received');assert.equal(received.transport.timeoutMs,105000);
  const wrong=f.message('sensors',{...message.payload,deviceId:'other-phone'});assert.equal((await f.bridge.exchange(f.record,{operation:'receive',message:wrong},f.context)).status,'rejected');
  const bomb=f.message('sensors',{deviceId:sensorDevice,packet:gzipSync(Buffer.alloc(1000000)).toString('base64')});assert.equal((await f.bridge.exchange(f.record,{operation:'receive',message:bomb},f.context)).status,'rejected');
});
test('Google sync failure backs off instead of retrying uncertain effects in a loop',async()=>{
  let calls=0,at=100000;const adapter=createRelayAdapter({now:()=>at,client:()=>async()=>{calls++;throw Error('private external error');}});
  const settings={url,'collector-key':collectorKey,clients:[]};assert.equal(validRelaySettings(settings),true);await adapter.start(settings);
  let state={};const context={signal:new AbortController().signal,cloudRelay:async()=>({catalog:catalogue(),receipts:[]}),saveState:async value=>state=value,readState:async()=>state,log:async()=>{}};
  await assert.rejects(adapter.execute('sync',{},context),/waiting before/);assert.equal((await adapter.execute('sync',{},context)).coolingDown,true);assert.equal(calls,1);await adapter.stop();
});
test('setup exports require normal administrator authorization and contain no credentials in the static script',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());
  const response=await fetch(f.app.origin+'/api/cloud-relay/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);
  const code=await fs.readFile(new URL('../plugins/google-apps-script/server/apps-script/Code.gs',import.meta.url),'utf8');assert.doesNotMatch(code,new RegExp(collectorKey));
});

test('client setup separates editable client IDs, retains enablement and preserves valid keys',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());const folder=path.join(f.root,'plugins/google-apps-script');await fs.mkdir(path.join(folder,'server'),{recursive:true});
  await fs.copyFile(new URL('../plugins/google-apps-script/declaration.json',import.meta.url),path.join(folder,'declaration.json'));
  await fs.writeFile(path.join(folder,'server/index.mjs'),'export default {validateConfiguration(){return false},async start(){},async stop(){}}');await f.app.registry.discover();
  const initial=f.app.registry.get('google-apps-script').config.snapshot();
  await f.app.registry.saveConfiguration('google-apps-script',{revision:initial.revision,settings:{...initial.settings,url,clients:[{id:'loc-'+randomUUID(),'client-id':'phone',name:'Phone',enabled:true,key:'',scenes:true,sensors:false,events:false,'device-id':''}]}});
  const post=async values=>{const response=await fetch(f.app.origin+'/api/cloud-relay/setup',{method:'POST',headers:{Origin:f.app.origin,'Content-Type':'application/json','X-Localserve-Token':f.app.snapshot().token},body:JSON.stringify(values)});return {status:response.status,body:await response.json()};};
  const before=f.app.registry.get('google-apps-script').config.snapshot();assert.equal((await post({revision:before.revision,operation:'keys'})).status,200);
  const keyed=f.app.registry.get('google-apps-script').config.snapshot();assert.equal(keyed.enabled,false);assert.match(keyed.settings['collector-key'],/^[a-f0-9]{64}$/);assert.notEqual(keyed.settings.clients[0].key,keyed.settings['collector-key']);
  assert.equal((await post({revision:before.revision,operation:'google'})).status,409);
  const exported=await post({revision:keyed.revision,operation:'phone',clientId:'phone'});assert.equal(exported.status,200);assert.equal(JSON.parse(exported.body.text).clientId,'phone');assert.doesNotMatch(exported.body.text,/loc-/);
  assert.equal((await post({revision:keyed.revision,operation:'keys'})).status,200);const again=f.app.registry.get('google-apps-script').config.snapshot();assert.equal(again.settings.clients[0].key,keyed.settings.clients[0].key);assert.equal(again.enabled,false);
  const google=await post({revision:again.revision,operation:'google'});assert.equal(JSON.parse(google.body.text).clients[0].id,'phone');
});

test('interrupted durable claims survive recovery without replay, while malformed stores isolate the relay',async t=>{
  const f=await bridgeFixture(t),message=f.message('event',{channel:'example',message:'do not replay'});
  await f.bridge.exchange(f.record,{operation:'receive',message},f.context);await f.bridge.store.update(value=>{value.receipts[0].status='dispatching';});
  await f.bridge.load();assert.equal((await f.bridge.exchange(f.record,{operation:'receive',message},f.context)).status,'interrupted');assert.equal(f.effects(),0);
  const file=f.bridge.store.file;assert.equal(typeof file,'string');await fs.writeFile(file,'broken');await f.bridge.load();assert.match(f.bridge.admin().error,/retained/);assert.equal(await fs.readFile(file,'utf8'),'broken');
});

test('a successful local snapshot physically removes expired receipt metadata',async t=>{
  const f=await bridgeFixture(t);await f.bridge.store.update(value=>value.receipts.push({id:randomUUID(),clientId:'phone',kind:'event',status:'received',at:Date.now()-1201000,expiresAt:Date.now()-1000}));
  const snapshot=await f.bridge.exchange(f.record,{operation:'snapshot'},f.context);assert.deepEqual(snapshot.receipts,[]);assert.deepEqual(f.bridge.store.snapshot().receipts,[]);
});

test('sensor ingress adds cloud transit age and rejects stale reports before existing admission',async()=>{
  const ingress=new SensorIngress({});let received;
  ingress.process=async(packet,signal,transport)=>{received={packet,transport};return {accepted:true};};
  const packet={version:1,deviceId:sensorDevice,deviceName:'Phone',sessionId:randomUUID(),sequence:1,sentAt:Date.now()-40000,
    catalog:[{id:'s-1111111111111111',type:5,stringType:'android.sensor.light',name:'Light',vendor:'Test',unit:'lx',selected:true,status:'Streaming',reportingMode:0,resolution:.1,maximumRange:1000,powerMa:1,minDelayUs:5000}],
    readings:[{sensorId:'s-1111111111111111',values:[0],accuracy:3,timestampNanos:'1000000',ageMs:0}]};
  const signal=new AbortController().signal;await ingress.relay(packet,signal,{timeoutMs:195000});assert.ok(received.packet.readings[0].ageMs>=40000);assert.equal(received.packet.readings[0].values[0],0);assert.equal(received.transport.transport,'relay');assert.equal(ingress.pending,0);
  await assert.rejects(ingress.relay({...packet,sentAt:Date.now()-90001},signal,{timeoutMs:195000}),/expired/);
  await assert.rejects(ingress.relay({...packet,sentAt:Date.now()+60000},signal,{timeoutMs:195000}),/clock/);
});

test('worker publishes only new or changed receipts and retries their publication after a failed sync',async()=>{
  const id=randomUUID(),calls=[],receipt={id,clientId:'phone',status:'queued'};let fail=false,at=100000;
  const adapter=createRelayAdapter({now:()=>at,client:()=>async(op,value)=>{calls.push(structuredClone(value));if(fail)throw Error('Synthetic failure');return {messages:[]};}});
  await adapter.start({url,'collector-key':collectorKey});const context={signal:new AbortController().signal,cloudRelay:async()=>({catalog:catalogue(),receipts:[receipt]}),saveState:async()=>{},log:async()=>{},readState:async()=>({})};
  await adapter.execute('sync',{},context);await adapter.execute('sync',{},context);assert.equal(calls[0].receipts.length,1);assert.equal(calls[1].receipts.length,0);
  receipt.status='completed';await adapter.execute('sync',{},context);assert.equal(calls[2].receipts[0].status,'completed');
  receipt.status='failed';fail=true;await assert.rejects(adapter.execute('sync',{},context));fail=false;at+=61000;await adapter.execute('sync',{},context);assert.equal(calls[4].receipts[0].status,'failed');await adapter.stop();
  // A new worker has no publication cache; persisted receipts are sent again.
  await adapter.start({url,'collector-key':collectorKey});await adapter.execute('sync',{},context);assert.equal(calls[5].receipts.length,1);await adapter.stop();
});

test('installed relay worker reaches normal scenes and Task Event execution without providers',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());
  const folder=path.join(f.root,'plugins/google-apps-script');await fs.mkdir(path.join(folder,'server'),{recursive:true});
  const declaration=JSON.parse(await fs.readFile(new URL('../plugins/google-apps-script/declaration.json',import.meta.url),'utf8'));
  declaration.runtime.entry='server/fixture.mjs';await fs.writeFile(path.join(folder,'declaration.json'),JSON.stringify(declaration));
  const adapter=pathToFileURL(path.resolve('plugins/google-apps-script/server/index.mjs')).href;
  await fs.writeFile(path.join(folder,'server/fixture.mjs'),`import fs from 'node:fs/promises';import {createRelayAdapter} from '${adapter}';export default createRelayAdapter({client:()=>async(op,payload)=>{if(op==='sync'){await fs.writeFile(new URL('catalog.json',import.meta.url),JSON.stringify(payload));return {ok:true,messages:JSON.parse(await fs.readFile(new URL('messages.json',import.meta.url),'utf8'))};}await fs.writeFile(new URL('ack.json',import.meta.url),JSON.stringify(payload));return {ok:true};}});`);
  await f.app.registry.discover();let config=f.app.registry.get('google-apps-script').config.snapshot();
  await f.app.registry.saveConfiguration('google-apps-script',{revision:config.revision,enabled:true,settings:{...config.settings,url,'collector-key':collectorKey,clients:[{id:'entry-phone','client-id':'phone',name:'Outside phone',key:clientKey,enabled:true,scenes:true,sensors:false,events:true,'device-id':''}]}});
  const event=f.app.registry.events().find(item=>item.pluginId==='google-apps-script');
  const task=validateTask({name:'Relay Event check',enabled:true,starts:[{id:'incoming',name:'Relay message',enabled:true,type:'event',eventId:event.id,comparisons:[]}],steps:[{id:'log',enabled:true,type:'log',message:'Relay {{event.message}} / {{event.value}} / {{event.active}}'}]},null,f.app.registry.actions(),f.app.registry.events(),[]);
  await f.app.tasks.update(items=>items.push(task));
  const now=Date.now(),id=randomUUID(),scene=f.app.cloudRelay.catalogue().scenes[0],shortcut=f.app.cloudRelay.catalogue().tasks[0],taskMessageId=randomUUID();
  const messages=[{id,clientId:'phone',kind:'shortcut',keyTag:clientTag,createdAt:now,expiresAt:now+90000,payload:{id,type:'scene',key:scene.key,revision:scene.revision}},{id:randomUUID(),clientId:'phone',kind:'event',keyTag:clientTag,createdAt:now,expiresAt:now+90000,payload:{channel:'test',message:'outside',value:0,active:false}},
    {id:taskMessageId,clientId:'phone',kind:'shortcut',keyTag:clientTag,createdAt:now,expiresAt:now+90000,payload:{id:taskMessageId,type:'task',key:shortcut.key,revision:shortcut.revision}}];
  await fs.writeFile(path.join(folder,'server/messages.json'),JSON.stringify(messages));await f.app.registry.execute('google-apps-script','sync',{});
  assert.equal(f.app.cloudRelay.store.snapshot().receipts.length,3);assert.equal(f.app.cloudRelay.store.snapshot().receipts[1].status,'received');
  const exported=await fs.readFile(path.join(folder,'server/catalog.json'),'utf8');assert.doesNotMatch(exported,/token|parameters|steps|gateway/);
  await f.app.controls.active.get('tradfri')?.done;
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.equal(f.app.controls.runs.snapshot().runs.find(item=>item.id===f.app.cloudRelay.store.snapshot().receipts[0].runId).status,'completed');
  const run=f.app.state.snapshot().runs.find(item=>item.taskId===task.id);assert.equal(run?.status,'completed');
  assert.equal(f.app.state.snapshot().runs.find(item=>item.taskId===shortcut.key)?.status,'completed');
  assert.ok(f.app.activity.entries.some(item=>item.message==='Relay outside / 0 / false'));
  const count=f.app.controls.runs.snapshot().runs.length;
  await f.app.registry.execute('google-apps-script','sync',{});assert.equal(f.app.controls.runs.snapshot().runs.length,count);assert.equal(f.app.state.snapshot().runs.filter(item=>item.taskId===task.id).length,1);assert.equal(f.app.state.snapshot().runs.filter(item=>item.taskId===shortcut.key).length,1);
});
