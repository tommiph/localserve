/** Transport reconstruction uses synthetic snapshots; no live store is read. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {AdminSync} from '../server/admin-sync.mjs';
import {selectorFixture} from './fixtures/scene-selector.mjs';
const clientCode=await fs.readFile(new URL('../web/admin-ux.js',import.meta.url),'utf8');
function client(){const context=vm.createContext({});vm.runInContext(clientCode+'\nglobalThis.sync=AdminSync;',context);return context.sync;}
const plain=value=>JSON.parse(JSON.stringify(value));
const snapshot=()=>({config:{name:'Synthetic'},activity:Array.from({length:1000},(_,i)=>({id:'log-'+i,message:'x'.repeat(200)})),
  runs:[{id:'run',status:'running',steps:[]}],services:[{id:'one',enabled:true,declaration:'d'.repeat(200000),pluginActivity:[{id:'p',message:'First'}],reading:1},{id:'two',enabled:false}],server:{now:1}});
test('administrator deltas reconstruct changed rows, prepends, trims, removals and service ordering',()=>{
  const server=new AdminSync(),browser=client(),first=snapshot();
  const full=server.encode(first);assert.equal(full.full,true);assert.deepEqual(plain(browser.apply(full)),first);
  const second=structuredClone(first);second.activity.unshift({id:'new',message:'Latest'});second.activity.pop();second.runs[0].status='completed';
  second.services[0].reading=0;delete second.services[0].enabled;second.services[0].pluginActivity[0].message='Revised';second.server.now++;
  const patch=server.encode(second,full.cursor);assert.equal(patch.full,false);
  assert.ok(JSON.stringify(patch).length<JSON.stringify(second).length/20,'Stable declarations and log rows must stay out of the patch');
  assert.deepEqual(plain(browser.apply(patch)),second);
  const third=structuredClone(second);third.services=[{id:'new-service',enabled:true},third.services[0]];third.activity=[third.activity[5],third.activity[1],{id:'other',message:'Other'}];
  assert.deepEqual(plain(browser.apply(server.encode(third,patch.cursor))),third);
});
test('expired or foreign cursors return complete state and manifests remain bounded',()=>{
  let now=1;const server=new AdminSync({now:()=>now,limit:2,ttl:10}),browser=client();
  const first=server.encode(snapshot());browser.apply(first);now=20;
  const next=server.encode(snapshot(),first.cursor);assert.equal(next.full,true);browser.apply(next);
  for(let i=0;i<6;i++)server.encode(snapshot());assert.equal(server.frames.size,2);
  assert.equal(server.encode(snapshot(),'0'.repeat(32)).full,true);
});
test('a mutation invalidates an in-flight refresh and old backends retain their full-state route',async()=>{
  const browser=client();let resolve;
  const reading=browser.read(()=>new Promise(done=>{resolve=done;}));browser.invalidate();resolve(new AdminSync().encode(snapshot()));
  assert.equal(await reading,null);assert.equal(browser.snapshot,null);
  const calls=[];const old=client();
  const result=await old.read(async route=>{calls.push(route);if(route==='api/admin-state'){const error=Error('Old backend');error.status=405;throw error;}return snapshot();});
  assert.deepEqual(result,snapshot());assert.deepEqual(calls,['api/admin-state','api/state']);
});
test('simultaneous manual and periodic refreshes share one cursor base and one request',async()=>{
  const browser=client();let calls=0,resolve;
  const read=()=>{calls++;return new Promise(done=>{resolve=done;});};
  const first=browser.read(read),second=browser.read(read);assert.equal(first,second);assert.equal(calls,1);
  resolve(new AdminSync().encode(snapshot()));assert.deepEqual(plain(await first),snapshot());assert.deepEqual(plain(await second),snapshot());
});
test('the guarded administrator delta endpoint keeps the full API and rejects ambiguous cursors',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());
  const read=async path=>{const response=await fetch(f.app.origin+path);assert.equal(response.status,200);return response.json();};
  const first=await read('/api/admin-state');assert.equal(first.full,true);
  const next=await read('/api/admin-state?cursor='+first.cursor);assert.equal(next.full,false);
  assert.ok((await read('/api/state')).config);
  assert.equal((await fetch(f.app.origin+'/api/admin-state?cursor=bad')).status,400);
  assert.equal((await fetch(f.app.origin+'/api/admin-state?cursor='+first.cursor+'&cursor='+first.cursor)).status,400);
  assert.equal((await fetch(f.app.origin+'/api/admin-state?other=1')).status,400);
});
