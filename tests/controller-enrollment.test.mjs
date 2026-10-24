/** Disposable phone identities exercise approval without a phone or Google. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {ControllerEnrollment} from '../server/controller-enrollment.mjs';
import {CloudRelay} from '../server/cloud-relay.mjs';
const one='android-11111111-1111-4111-8111-111111111111',two='android-22222222-2222-4222-8222-222222222222';
async function fixture(t){
  const base=path.resolve('tests/.tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'controller-approval-'));
  let now=100000;const enrollment=await new ControllerEnrollment(root,{now:()=>now}).load();
  t.after(async()=>{await enrollment.close();await fs.rm(root,{recursive:true,force:true});});
  return {root,enrollment,advance:ms=>now+=ms};
}
test('unknown phone receives no grants until a one-use code is entered; hashes survive restart',async t=>{
  const {root,enrollment}=await fixture(t);let grants=0;const known=()=>false,grant=async()=>{grants++;return 'controller-example';};
  const input={version:2,deviceId:one,name:'Example phone'};
  assert.equal((await enrollment.connect(input,known,grant)).approvalRequired,true);assert.equal(grants,0);
  const issued=enrollment.issue();assert.match(issued.code,/^[23456789A-HJ-NP-Z]{6}$/);
  const approved=await enrollment.connect({...input,code:issued.code.toLowerCase()},known,grant);assert.equal(approved.approved,true);assert.equal(grants,1);
  assert.doesNotMatch(JSON.stringify(enrollment.admin()),new RegExp(approved.approvalToken));
  const bytes=await fs.readFile(enrollment.store.file,'utf8');assert.ok(!bytes.includes(approved.approvalToken));assert.ok(!bytes.includes(issued.code));
  const restored=await new ControllerEnrollment(root).load();
  assert.equal((await restored.connect({...input,approvalToken:approved.approvalToken},known,grant)).approved,true);assert.equal(grants,1);
  assert.equal((await enrollment.connect({...input,deviceId:two,code:issued.code},known,grant)).approvalRequired,true);
  assert.equal((await enrollment.connect(input,()=>true,grant)).approvalRequired,true);await restored.close();
});
test('codes expire, replacement cancels old code and failed attempts are bounded',async t=>{
  const {enrollment,advance}=await fixture(t),input={deviceId:one,version:2};const first=enrollment.issue();advance(300001);
  assert.equal((await enrollment.connect({...input,code:first.code},()=>false,async()=>{})).approvalRequired,true);
  const previous=enrollment.issue(),current=enrollment.issue();
  assert.equal((await enrollment.connect({...input,code:previous.code},()=>false,async()=>{})).approvalRequired,true);
  for(let i=0;i<8;i++)await enrollment.connect({...input,code:'000000'},()=>false,async()=>{});
  assert.equal((await enrollment.connect({...input,code:current.code},()=>false,async()=>{})).approvalRequired,true);
});
test('simultaneous enrollment consumes a code for one phone only and rejects edited identities',async t=>{
  const {enrollment}=await fixture(t),issued=enrollment.issue();let grants=0;
  const results=await Promise.all([one,two].map(deviceId=>enrollment.connect({version:2,deviceId,code:issued.code},()=>false,async()=>grants++)));
  assert.equal(results.filter(result=>result.approved).length,1);assert.equal(grants,1);
  for(const bad of [{deviceId:'phone'},{deviceId:one,code:[]},{deviceId:one,approvalToken:'wrong'},{deviceId:one,clientId:'collector'}])await assert.rejects(enrollment.connect(bad,()=>false,async()=>{}),/Controller/);
});
test('corrupt approvals are retained and isolate provisioning only',async t=>{
  const {root,enrollment}=await fixture(t);await fs.writeFile(enrollment.store.file,'broken');const failed=await new ControllerEnrollment(root).load();
  assert.match(failed.admin().error,/retained/);assert.throws(()=>failed.issue(),/retained/);assert.equal(await fs.readFile(enrollment.store.file,'utf8'),'broken');await failed.close();
});
test('enabling remote access later provisions an approved phone once, inside the drained enrollment queue',async t=>{
  const {enrollment}=await fixture(t);let remote=false,calls=0;
  const grant=async()=>{calls++;return remote?'controller-late':'';},input={version:2,deviceId:one,code:enrollment.issue().code};
  const first=await enrollment.connect(input,()=>false,grant);assert.equal(first.permissions.remoteClient,'');
  remote=true;const saved=await enrollment.connect({version:2,deviceId:one,approvalToken:first.approvalToken},()=>false,grant);assert.equal(saved.permissions.remoteClient,'controller-late');
  await enrollment.connect({version:2,deviceId:one,approvalToken:first.approvalToken},()=>false,grant);assert.equal(calls,2);
});
test('approved phones get individual remote clients, preserving existing settings and disabled grants',async t=>{
  const {root}=await fixture(t);let config={revision:1,enabled:true,settings:{url:'https://script.google.com/macros/s/abcdefghijklmnopqrst/exec','collector-key':'a'.repeat(64),'report-seconds':120,clients:[]}};
  const gate=Object.assign(new EventEmitter(),{paused:false}),record={plugin:{id:'google-apps-script'},config:{snapshot:()=>structuredClone(config)}};
  const registry={records:new Map([['google-apps-script',record]]),engine:{gate},saveConfiguration:async(id,value)=>{assert.equal(value.revision,config.revision);config={...config,...value,revision:config.revision+1};}};
  const relay=await new CloudRelay(root,registry,{},{}).load();t.after(()=>relay.close());
  assert.equal((await relay.connectController({version:2,deviceId:one})).approvalRequired,true);assert.equal(config.settings.clients.length,0);
  const {code}=relay.enrollment.issue(),response=await relay.connectController({version:2,deviceId:one,name:'Example phone',code});
  assert.equal(config.settings.clients.length,1);const client=config.settings.clients[0];assert.equal(client.sensors,true);assert.equal(client.scenes,true);assert.equal(client.events,false);assert.equal(client['device-id'],one);
  assert.equal(response.sensors.deviceId,one);assert.equal(response.scenes.clientId,client['client-id']);assert.equal(config.enabled,true);
  assert.equal((await relay.connectController({version:2,deviceId:two,approvalToken:response.approvalToken})).scenes,null);
  config.settings.clients[0].enabled=false;
  const denied=await relay.connectController({version:2,deviceId:one,approvalToken:response.approvalToken});assert.equal(denied.sensors,null);assert.equal(config.settings.clients[0].enabled,false);
  config.settings.clients=[];
  const removed=await relay.connectController({version:2,deviceId:one,approvalToken:response.approvalToken});assert.equal(removed.scenes,null);assert.equal(removed.sensors,null);assert.equal(config.settings.clients.length,0);
  assert.ok(!JSON.stringify(relay.admin()).includes(response.approvalToken));
});
