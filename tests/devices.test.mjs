/** Discovery tests use synthetic packets, adapters and workers, never a LAN scan. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {Devices,addressValue} from '../server/devices.mjs';
import {localNetworks,macAddress,dnsRecords,queryPacket,descriptionFields,descriptionUrl,discoverNetwork,inferredType,mdnsDevices} from '../server/device-discovery.mjs';
import {selectorFixture} from './fixtures/scene-selector.mjs';
const interfaces={Ethernet:[{family:'IPv4',address:'10.23.42.3',netmask:'255.255.255.0',internal:false}]};
const network=localNetworks(interfaces)[0];
const sample=(address='10.23.42.8',mac='02:11:22:33:44:55')=>({address,mac,name:'Desk TV',services:['UPnP'],evidence:['UPnP'],reportedType:'urn:schemas-upnp-org:device:MediaRenderer:1',seen:true});
async function fixture(t,discover=async()=>({rows:[sample()],warnings:[]})){
  const base=path.resolve('tests/.tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'devices-'));
  const gate=Object.assign(new EventEmitter(),{paused:false});const saved=[];
  const settings={host:'10.23.42.7',token:'private-token',port:8002};
  const record={plugin:{name:'TV',settings:[{id:'host',type:'string'}]},config:{snapshot:()=>({revision:4,enabled:false,settings:{...settings}})}};
  const registry={records:new Map([['samsung-tv',record]]),async saveConfiguration(id,values){saved.push({id,values});}};
  let networks=[network];const inventory=await new Devices(root,registry,gate,{discover,networks:()=>networks,now:()=>12345}).load();
  t.after(async()=>{await inventory.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  return {root,gate,inventory,saved,detach(){networks=[];}};
}
async function scan(inventory){inventory.start({networkId:network.id,requestId:randomUUID()});await inventory.operation;return inventory.rows()[0];}
test('network choices are attached/private only, /24 bounded, and respect narrower subnet masks',()=>{
  assert.equal(network.addresses.length,254);assert.equal(network.cidr,'10.23.42.0/24');
  const rows=localNetworks({...interfaces,Public:[{family:4,address:'8.8.8.8',netmask:'255.255.255.0'}],Loop:[{family:4,address:'127.0.0.1',netmask:'255.0.0.0',internal:true}],Narrow:[{family:4,address:'10.1.2.130',netmask:'255.255.255.128'}]});
  assert.equal(rows.length,2);assert.equal(rows[1].addresses.length,126);assert.equal(rows[1].addresses[0],'10.1.2.129');
});
test('DNS parser rejects loops and truncation, and QU queries use bounded labels',()=>{
  assert.equal(queryPacket('_http._tcp.local').readUInt16BE(queryPacket('_http._tcp.local').length-2),0x8001);
  assert.throws(()=>queryPacket('x'.repeat(64)+'.local'));
  assert.throws(()=>dnsRecords(Buffer.alloc(3)));
  const cycle=Buffer.alloc(18);cycle.writeUInt16BE(1,4);cycle[12]=0xc0;cycle[13]=12;assert.throws(()=>dnsRecords(cycle));
  const packet=Buffer.concat([Buffer.from([0,0,0x84,0,0,0,0,1,0,0,0,0]),Buffer.from([1,97,0,0,1,0,1,0,0,0,20,0,4,10,23,42,8])]);
  assert.deepEqual(dnsRecords(packet),[{name:'a',type:1,value:'10.23.42.8'}]);
});
test('UPnP descriptions stay on the responder IP, reject credentials/foreign/own targets and never expand entities',()=>{
  assert.ok(descriptionUrl('http://10.23.42.8:8000/description.xml','10.23.42.8',network));
  for(const target of ['http://8.8.8.8/test','http://device.local/test','http://user:pass@10.23.42.8/test','https://10.23.42.8/test','http://10.23.42.3/test'])assert.equal(descriptionUrl(target,'10.23.42.8',network),null);
  assert.equal(descriptionFields('<root><friendlyName>TV &amp; Audio</friendlyName><manufacturer>Example</manufacturer></root>').name,'TV & Audio');
  assert.deepEqual(descriptionFields('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///private">]><friendlyName>&x;</friendlyName>'),{});
  assert.equal(macAddress('FF-FF-FF-FF-FF-FF'),null);assert.equal(macAddress('02-11-22-33-44-55'),'02:11:22:33:44:55');
});
test('cached neighbors are not labeled as responding, reported services infer type, foreign addresses are dropped',async()=>{
  const result=await discoverNetwork(network,{signal:new AbortController().signal,neighbors:async()=>({neighbors:[{address:'10.23.42.8',mac:'02:11:22:33:44:55'}],responding:[]}),advertise:async()=>({rows:[sample('8.8.8.8')],warnings:[]}),reverse:async()=>['desk.example']});
  const row=result.rows.find(item=>item.address==='10.23.42.8');assert.equal(row.seen,false);assert.equal(row.hostname,'desk.example');assert.equal(inferredType(row),'Unknown');assert.ok(!result.rows.some(item=>item.address==='8.8.8.8'));
  assert.equal(inferredType(sample()),'Media device');
});
test('mDNS proxy announcements do not claim a direct response from the advertised device',()=>{
  const records=[{name:'Printer._ipp._tcp.local',type:33,value:{host:'printer.local',port:631},peer:'10.23.42.9'},{name:'printer.local',type:1,value:'10.23.42.8'}];
  assert.equal(mdnsDevices(records,network)[0].seen,false);
  records[0].peer='10.23.42.8';assert.equal(mdnsDevices(records,network)[0].seen,true);
});
test('startup and snapshot never discover; one manual scan is idempotent, saves evidence and preserves aliases across DHCP changes',async t=>{
  let calls=0,row=sample();const f=await fixture(t,async()=>{calls++;return {rows:[row],warnings:[]};});
  f.inventory.snapshot();assert.equal(calls,0);
  const id=randomUUID();f.inventory.start({networkId:network.id,requestId:id});await f.inventory.operation;
  f.inventory.start({networkId:network.id,requestId:id});assert.equal(calls,1);
  const first=f.inventory.rows()[0];await f.inventory.edit({id:first.id,revision:first.revision,name:'Living room',type:'TV',enabled:true});
  row=sample('10.23.42.9');await scan(f.inventory);const next=f.inventory.snapshot().devices[0];
  assert.equal(next.id,first.id);assert.equal(next.address,'10.23.42.9');assert.equal(next.displayName,'Living room');assert.equal(next.typeSource,'Custom');
  row=sample('10.23.42.9','02:aa:bb:cc:dd:ee');await scan(f.inventory);assert.equal(f.inventory.rows().length,2);assert.equal(f.inventory.rows()[1].customName,'');
});
test('pause/cancel/shutdown discard uncommitted results and preserve the previous inventory',async t=>{
  const f=await fixture(t,async(network,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}));
  f.inventory.start({networkId:network.id,requestId:randomUUID()});assert.throws(()=>f.inventory.start({networkId:network.id,requestId:randomUUID()}),/already/);
  f.gate.paused=true;f.gate.emit('change');await f.inventory.operation;assert.equal(f.inventory.job.status,'cancelled');assert.equal(f.inventory.rows().length,0);
  assert.throws(()=>f.inventory.start({networkId:network.id,requestId:randomUUID()}),/Enable/);
});
test('address application uses current revisions, preserves credentials and never enables plugins',async t=>{
  const f=await fixture(t),row=await scan(f.inventory);
  await f.inventory.use({id:row.id,revision:row.revision,pluginId:'samsung-tv',pluginRevision:4});
  assert.deepEqual(f.saved,[{id:'samsung-tv',values:{revision:4,settings:{host:row.address,token:'private-token',port:8002}}}]);
  await assert.rejects(f.inventory.use({id:row.id,revision:row.revision,pluginId:'samsung-tv',pluginRevision:3}),/settings changed/);
  f.detach();await assert.rejects(f.inventory.use({id:row.id,revision:row.revision,pluginId:'samsung-tv',pluginRevision:4}),/attached/);
  assert.equal(addressValue('oculus-go','10.23.42.8','10.23.42.7:5566'),'10.23.42.8:5566');assert.equal(addressValue('emby','10.23.42.8','https://10.23.42.7:8920'),'https://10.23.42.8:8920');
});
test('edits reject stale revisions; disabled devices cannot apply an address and forgetting touches no plugin',async t=>{
  const f=await fixture(t),row=await scan(f.inventory);
  await assert.rejects(f.inventory.edit({id:row.id,revision:0,name:'',type:'',enabled:true}),/changed/);
  await f.inventory.edit({id:row.id,revision:row.revision,name:'',type:'',enabled:false});
  await assert.rejects(f.inventory.use({id:row.id,revision:row.revision+1,pluginId:'samsung-tv',pluginRevision:4}),/disabled/);
  await f.inventory.edit({id:row.id,revision:row.revision+1,forget:true});assert.equal(f.inventory.rows().length,0);assert.equal(f.saved.length,0);
});
test('malformed saved inventory disables only discovery without overwriting data',async t=>{
  const f=await fixture(t);await f.inventory.close();const file=path.join(f.root,'data/devices.json');await fs.writeFile(file,'{"schemaVersion":9}');
  const next=await new Devices(f.root,{records:new Map()},f.gate).load();t.after(()=>next.close());assert.ok(next.snapshot().error);assert.equal(await fs.readFile(file,'utf8'),'{"schemaVersion":9}');
});
test('HTTP scan requires administrator Origin/token, and reading state performs no discovery',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());let calls=0;
  f.app.devices.networks=()=>[network];f.app.devices.discover=async()=>{calls++;return {rows:[sample()],warnings:[]};};
  const state=await fetch(f.app.origin+'/api/state').then(response=>response.json());assert.equal(calls,0);
  const page=await fetch(f.app.origin+'/devices');assert.equal(page.status,200);assert.match(await page.text(),/devices-ui\.js/);
  assert.equal((await fetch(f.app.origin+'/devices-ui.js')).status,200);assert.equal(calls,0);
  const body={networkId:network.id,requestId:randomUUID()};
  assert.equal((await fetch(f.app.origin+'/api/devices/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,403);
  const response=await fetch(f.app.origin+'/api/devices/scan',{method:'POST',headers:{'Content-Type':'application/json',Origin:f.app.origin,'X-Localserve-Token':state.token},body:JSON.stringify(body)});
  assert.equal(response.status,202);await f.app.devices.operation;assert.equal(calls,1);assert.equal(f.app.devices.rows().length,1);
});

test('changing the reviewed plugin updates its address preview using the shared field helper ID',async()=>{
  const listeners={},preview={textContent:''},form={elements:{plugin:{value:'samsung-tv'}},querySelector:()=>preview};
  const context=vm.createContext({URL,document:{addEventListener:(name,handler)=>listeners[name]=handler},dialog:{querySelector:()=>form},
    dialogContext:{kind:'device-use',row:{address:'10.23.42.3'},choices:[{pluginId:'samsung-tv',currentValue:'10.23.42.6'},{pluginId:'emby',currentValue:'https://10.23.42.7:8920'}]}});
  vm.runInContext(await fs.readFile(new URL('../web/devices-ui.js',import.meta.url),'utf8')+'\nglobalThis.ui=DevicesUI;',context);
  context.ui.previewAddress();assert.equal(preview.textContent,'Address: 10.23.42.6 → 10.23.42.3');
  form.elements.plugin.value='emby';listeners.change({target:{id:'field-plugin',matches:selector=>selector==='#device-use-form [name="plugin"]'}});
  assert.equal(preview.textContent,'Address: https://10.23.42.7:8920 → https://10.23.42.3:8920');
});
