/** Manufacturer tests use fixed responses and clocks, never a public API. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {DeviceVendors,vendorPrefix} from '../server/device-vendors.mjs';
import {Devices} from '../server/devices.mjs';
import {localNetworks} from '../server/device-discovery.mjs';
import {selectorFixture} from './fixtures/scene-selector.mjs';

const mac='00:11:22:33:44:55',signal=()=>new AbortController().signal;
const network=localNetworks({Ethernet:[{family:'IPv4',address:'10.23.42.3',netmask:'255.255.255.0'}]})[0];
const body=(prefix='001122',found=true)=>({success:true,found,macPrefix:found?prefix:'',company:found?'Example Devices':'',address:'Business park',country:'FI',blockType:'MA-L',updated:'2026-01-01',isPrivate:false});
const response=(value=body(),status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
async function fixture(t,fetcher=async()=>response()){
  const base=path.resolve('tests/.tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'vendors-'));
  let now=100000;const calls=[],options={now:()=>now,fetcher:async(...args)=>{calls.push(args);return fetcher(...args);},wait:async milliseconds=>{now+=milliseconds;}};
  const cache=await new DeviceVendors(root,options).load();
  t.after(async()=>{await cache.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  return {root,cache,calls,options,advance:milliseconds=>now+=milliseconds};
}
test('prefix extraction skips missing, multicast and locally administered addresses',()=>{
  assert.equal(vendorPrefix(mac),'001122');assert.equal(vendorPrefix('00-11-22-33-44-55'),'001122');
  for(const value of ['',null,'02:11:22:33:44:55','ca:11:22:33:44:55','01:11:22:33:44:55'])assert.equal(vendorPrefix(value),null);
});
test('reads never contact the provider; manual requests send only six hex digits over fixed HTTPS',async t=>{
  const f=await fixture(t);assert.equal(f.cache.info(mac).status,'not-looked-up');f.cache.summary();assert.equal(f.calls.length,0);
  await f.cache.lookup('001122',signal());assert.equal(f.calls.length,1);
  assert.equal(f.calls[0][0],'https://api.maclookup.app/v2/macs/001122');assert.equal(f.calls[0][1].redirect,'error');
  assert.equal(f.calls[0][1].headers.Accept,'application/json');assert.equal(f.cache.info(mac).company,'Example Devices');
  const reopened=await new DeviceVendors(f.root,f.options).load();assert.equal(reopened.info(mac).country,'FI');assert.equal(f.calls.length,1);await reopened.close();
});
test('positive and missing registrations have distinct expiry and shared-prefix caching',async t=>{
  let found=true;const f=await fixture(t,async()=>response(body('001122',found)));
  await f.cache.lookup('001122',signal());assert.equal(await f.cache.lookup('001122',signal()),false);assert.equal(f.cache.info('00:11:22:aa:bb:cc').company,'Example Devices');
  f.advance(31*86400000);assert.equal(f.cache.info(mac).stale,true);found=false;await f.cache.lookup('001122',signal());assert.equal(f.cache.info(mac).status,'not-found');
  f.advance(6*86400000);assert.equal(await f.cache.lookup('001122',signal()),false);
  f.advance(2*86400000);assert.equal(f.cache.info(mac).stale,true);await f.cache.lookup('001122',signal());assert.equal(f.calls.length,3);
});
test('rate limits and Retry-After persist across restarts without automatic retry',async t=>{
  const f=await fixture(t,async()=>response({},429,{'Retry-After':'120'}));
  await assert.rejects(f.cache.lookup('001122',signal()),error=>error.status===429);assert.equal(f.calls.length,1);
  const reopened=await new DeviceVendors(f.root,f.options).load();assert.equal(reopened.summary().retryAt,220000);
  await assert.rejects(reopened.lookup('001122',signal()),/cooling down/);assert.equal(f.calls.length,1);await reopened.close();
});
test('successful responses with exhausted quota also retain the provider reset time',async t=>{
  const f=await fixture(t,async()=>response(body(),200,{'X-RateLimit-Remaining':'0','X-RateLimit-Reset':'180'}));
  await f.cache.lookup('001122',signal());assert.equal(f.cache.summary().retryAt,180000);assert.equal(f.cache.info(mac).status,'found');
});
test('invalid provider bodies never replace saved registrations',async t=>{
  let next=response();const f=await fixture(t,async()=>next);await f.cache.lookup('001122',signal());f.advance(31*86400000);
  for(const invalid of [body('445566'),{success:false,found:true},{...body(),company:9}]){
    next=response(invalid);await assert.rejects(f.cache.lookup('001122',signal()));assert.equal(f.cache.info(mac).company,'Example Devices');
  }
  next=response({padding:'x'.repeat(33000)});await assert.rejects(f.cache.lookup('001122',signal()),/too large/);
  next=new Response('not json',{headers:{'Content-Type':'text/html'}});await assert.rejects(f.cache.lookup('001122',signal()),/Unexpected/);
  assert.equal(f.cache.info(mac).company,'Example Devices');
});
test('cancellation after a response preserves rate metadata without saving the registration',async t=>{
  const controller=new AbortController();const f=await fixture(t,async()=>{controller.abort();return response();});
  await assert.rejects(f.cache.lookup('001122',controller.signal));assert.equal(f.cache.info(mac).status,'not-looked-up');assert.ok(f.cache.summary().retryAt>100000);
});
test('manual batch deduplicates prefixes, skips disabled/private entries and leaves inventory unchanged',async t=>{
  const f=await fixture(t),gate=Object.assign(new EventEmitter(),{paused:false});
  const rows=[{address:'10.23.42.8',mac},{address:'10.23.42.9',mac:'00:11:22:ab:cd:ef'},{address:'10.23.42.10',mac:'02:11:22:33:44:55'},{address:'10.23.42.11',mac:'44:55:66:11:22:33'}];
  const inventory=await new Devices(f.root,{records:new Map()},gate,{now:f.options.now,vendors:f.options,networks:()=>[network],discover:async()=>({rows,warnings:[]})}).load();t.after(()=>inventory.close());
  inventory.start({networkId:network.id,requestId:randomUUID()});await inventory.operation;
  const disabled=inventory.rows()[3];await inventory.edit({id:disabled.id,revision:disabled.revision,name:'',type:'',enabled:false});
  const before=inventory.rows(),requestId=randomUUID();inventory.lookup({requestId});await inventory.operation;
  assert.equal(inventory.job.status,'completed');assert.equal(inventory.job.count,1);assert.equal(f.calls.length,1);assert.deepEqual(inventory.rows(),before);
  inventory.lookup({requestId});assert.equal(f.calls.length,1);
  f.advance(1000);inventory.lookup({requestId:randomUUID()});await inventory.operation;assert.equal(inventory.operation,null);assert.equal(inventory.job.count,0);
  gate.paused=true;assert.throws(()=>inventory.lookup({requestId:randomUUID()}),/Enable/);
});
test('pause cancels an in-flight lookup and blocks overlapping scans',async t=>{
  let started;const ready=new Promise(resolve=>started=resolve);
  const f=await fixture(t,async(url,{signal})=>{started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
  const gate=Object.assign(new EventEmitter(),{paused:false});
  const inventory=await new Devices(f.root,{records:new Map()},gate,{now:f.options.now,vendors:f.options,networks:()=>[network],discover:async()=>({rows:[{address:'10.23.42.8',mac}],warnings:[]})}).load();t.after(()=>inventory.close());
  inventory.start({networkId:network.id,requestId:randomUUID()});await inventory.operation;inventory.lookup({requestId:randomUUID()});await ready;
  assert.throws(()=>inventory.start({networkId:network.id,requestId:randomUUID()}),/already running/);
  gate.paused=true;gate.emit('change');await inventory.operation;assert.equal(inventory.job.status,'cancelled');assert.equal(inventory.snapshot().devices[0].vendor.status,'not-looked-up');
});
test('invalid cache disables only vendor lookup and retains the original file',async t=>{
  const f=await fixture(t);const file=path.join(f.root,'data/device-vendors.json');await fs.writeFile(file,'{"schemaVersion":99}');
  const inventory=await new Devices(f.root,{records:new Map()},Object.assign(new EventEmitter(),{paused:false}),{networks:()=>[network],discover:async()=>({rows:[],warnings:[]})}).load();t.after(()=>inventory.close());
  assert.equal(inventory.snapshot().error,'');assert.ok(inventory.snapshot().vendorLookup.error);assert.throws(()=>inventory.lookup({requestId:randomUUID()}),/cache/);
  inventory.start({networkId:network.id,requestId:randomUUID()});await inventory.operation;assert.equal(inventory.job.status,'completed');assert.equal(await fs.readFile(file,'utf8'),'{"schemaVersion":99}');
});
test('lookup HTTP endpoint enforces administrator Origin/token and returns an admitted job',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());const origin=f.app.origin;
  const state=await fetch(origin+'/api/state').then(r=>r.json());const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID()})};
  assert.equal((await fetch(origin+'/api/devices/lookup',options)).status,403);
  options.headers.Origin=origin;options.headers['X-Localserve-Token']=state.token;
  const accepted=await fetch(origin+'/api/devices/lookup',options);assert.equal(accepted.status,202);await f.app.devices.operation;assert.equal(f.app.devices.job.count,0);
});
test('manufacturer labels and facts escape service data and explain the evidence source',async()=>{
  const context=vm.createContext({document:{addEventListener(){}},escapeHtml:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),formatServerTimestamp:()=> 'Now'});
  vm.runInContext(await fs.readFile(new URL('../web/devices-ui.js',import.meta.url),'utf8')+'\nglobalThis.ui=DevicesUI;',context);
  const row={vendor:{status:'found',company:'<script>',checkedAt:1,country:'FI',prefix:'001122'}};
  assert.match(context.ui.vendorLabel(row),/&lt;script&gt;/);assert.doesNotMatch(context.ui.vendorDetails(row),/<script>/);assert.match(context.ui.vendorDetails(row),/does not prove/);
  assert.match(context.ui.vendorDetails({vendor:{status:'private'}}),/private\/randomized/);
});
