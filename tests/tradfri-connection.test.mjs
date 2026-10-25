/** Gateway session/backoff checks use synthetic clients and loopback fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {createGatewaySession} from '../plugins/tradfri/server/client.mjs';
import {createLocalserve} from '../server.mjs';

const host='10.23.42.2',signal=()=>new AbortController().signal;
function clients() {
  const all=[],requests=[];let connects=0,destroyed=0;
  return {all,requests,get connects(){return connects;},get destroyed(){return destroyed;},factory(address){
    const client=new EventEmitter();all.push(client);client.address=address;
    client.connect=async()=>{connects++;};
    client.authenticate=async()=>({identity:'new',psk:'key'});
    client.request=async(resource,method,payload)=>{requests.push({resource,method,payload});return {code:'2.05',payload:[]};};
    client.destroy=()=>{destroyed++;};return client;
  }};
}

test('serialized light commands reuse one session; host/credentials changes reconnect only on explicit calls',async()=>{
  const f=clients(),session=createGatewaySession(f.factory);
  for(let index=0;index<5;index++)await session.run(host,signal(),async client=>{
    await client.connect('id','key');await client.request('15001/'+index,'get');await client.request('15001/'+index,'put',{on:true});
  });
  assert.equal(f.connects,1);assert.equal(f.all.length,1);assert.equal(f.destroyed,0);
  assert.equal(f.requests.filter(row=>row.method==='put').length,5);
  await session.run(host,signal(),client=>client.connect('replacement','new-key'));assert.equal(f.connects,2);
  await session.run('10.23.42.3',signal(),client=>client.connect('id','key'));assert.equal(f.all.length,2);assert.equal(f.destroyed,1);
  session.close();assert.equal(f.destroyed,2);
  await new Promise(resolve=>setTimeout(resolve,15));assert.equal(f.all.length,2,'No connection watchers or background reconnect.');
});

test('failed writes discard the session without retry; idle errors wait for another explicit operation',async()=>{
  const f=clients(),session=createGatewaySession(f.factory);let writes=0;
  await session.run(host,signal(),client=>client.connect('id','key'));
  f.all[0].request=async()=>{writes++;throw Error('transport failed');};
  await assert.rejects(session.run(host,signal(),client=>client.request('15001/1','put',{})),/transport failed/);
  assert.equal(writes,1);assert.equal(f.destroyed,1);assert.equal(f.all.length,1);
  await session.run(host,signal(),client=>client.connect('id','key'));assert.equal(f.connects,2);
  f.all[1].emit('error',Error('idle disconnect'));assert.equal(f.destroyed,2);assert.equal(f.all.length,2);
  session.close();assert.equal(f.destroyed,2);
});

test('cancellation discards late connection completion and cannot write or destroy a newer session',async()=>{
  const f=clients(),session=createGatewaySession(f.factory);let complete,entered;
  const started=new Promise(resolve=>{entered=resolve;}),controller=new AbortController();
  const first=session.run(host,controller.signal,async client=>{
    f.all[0].connect=()=>new Promise(resolve=>{complete=resolve;entered();});
    await client.connect('id','key');await client.request('15001/1','put',{});
  });
  await started;
  await assert.rejects(session.run(host,signal(),()=>{}),/already active/);
  controller.abort(Error('cancelled'));await assert.rejects(first,/cancelled/);
  await session.run(host,signal(),client=>client.connect('id','key'));complete();
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.requests.length,0);assert.equal(f.destroyed,1);
  await session.run(host,signal(),client=>client.connect('id','key'));assert.equal(f.all.length,2);
  session.close();
});

test('gateway backoff is completion-based, bounded, recoverable, and separate from worker health',async t=>{
  const base=path.resolve(fileURLToPath(new URL('./.tmp/',import.meta.url)));await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'gateway-session-')),folder=path.join(root,'plugins/tradfri');
  await fs.mkdir(path.join(folder,'server'),{recursive:true});
  await fs.writeFile(path.join(folder,'declaration.json'),JSON.stringify({schemaVersion:1,apiVersion:1,id:'tradfri',name:'Synthetic gateway',version:'1.0.0',icon:'lightbulb',runtime:{entry:'server/index.mjs'},
    settings:[{id:'poll-minutes',label:'Poll',type:'number',default:0.5,min:0.5,max:5}],polling:{actionId:'refresh',intervalSetting:'poll-minutes'},
    actions:['refresh','restore','break','bad-input'].map(id=>({id,name:id,parameters:[]})),cardFields:[{id:'connection-status',label:'Connection',type:'string',source:{kind:'state',key:'connection-status'}}]}));
  await fs.writeFile(path.join(folder,'server/index.mjs'),`let down=true;export default {validateConfiguration:()=>true,start(){},stop(){},async execute(id,p,c){
    if(id==='bad-input')throw Error('Choose a light.');if(id==='restore'){down=false;return {};}
    if(id==='break')down=true;if(down)throw Error('TRÅDFRI connection or request failed. Check gateway availability and credentials.');
    await c.saveState({'connection-status':'Connected'});return {};}};`);
  const app=await createLocalserve(root,{automatic:false});
  t.after(async()=>{await app.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  const record=app.registry.get('tradfri');
  await app.registry.saveConfiguration('tradfri',{revision:record.config.snapshot().revision,enabled:true,settings:{'poll-minutes':0.5}});
  const service=()=>app.registry.services()[0];assert.equal(service().gatewayConnection.status,'checking');
  for(const seconds of [60,120,300,300]){
    const before=Date.now();await assert.rejects(app.registry.execute('tradfri','refresh',{}),/connection or request failed/);
    assert.equal(record.health,'ready');assert.equal(record.gatewayConnection.status,'unreachable');
    assert.ok(record.pollDueAt>=before+seconds*1000);assert.ok(record.pollDueAt<=Date.now()+seconds*1000);
    assert.equal(service().cardData.status,'Unreachable');assert.equal(service().cardData.values['connection-status'].value,'Unreachable');
    app.registry.pollDue(record.pollDueAt-1);assert.equal(record.pollPending,false);
  }
  const failures=record.gatewayConnection.failures;await assert.rejects(app.registry.execute('tradfri','bad-input',{}),/Choose a light/);assert.equal(record.gatewayConnection.failures,failures);
  const oldGeneration=record.pollGeneration;
  app.registry.observeGateway(record,null,oldGeneration-1,record.config.snapshot().revision);assert.equal(record.gatewayConnection.status,'unreachable');
  app.registry.observeGateway(record,null,oldGeneration,record.config.snapshot().revision-1);assert.equal(record.gatewayConnection.status,'unreachable');
  await app.registry.execute('tradfri','restore',{});assert.equal(record.gatewayConnection.status,'reachable');assert.equal(record.gatewayConnection.failures,0);
  assert.ok(record.pollDueAt<=Date.now()+30000);assert.equal(service().cardData.status,'Ready');
  app.registry.pollDue(record.pollDueAt+1);await record.pollOperation;assert.equal(service().pollObservation.status,'completed');
  assert.equal(service().cardData.values['connection-status'].value,'Connected');
  await app.registry.execute('tradfri','break',{}).catch(()=>{});await app.engine.setPaused(true);
  app.registry.pollDue(record.pollDueAt+1);assert.equal(record.pollPending,false);
  await app.engine.setPaused(false);
  await app.registry.saveConfiguration('tradfri',{revision:record.config.snapshot().revision,enabled:true,settings:{'poll-minutes':5}});
  await assert.rejects(app.registry.execute('tradfri','refresh',{}));assert.equal(app.registry.gatewayPollDelay(record),300000,'Never poll faster than the user setting.');
});

test('administrator distinguishes an unreachable gateway from configuration, pause and runtime failure',async()=>{
  const ux=vm.runInNewContext(await fs.readFile(new URL('../web/admin-ux.js',import.meta.url),'utf8')+'\nAdminUX;');
  const service={enabled:true,configurationReady:true,health:'ready',gatewayConnection:{status:'unreachable',nextPollAt:61000,failures:1}};
  assert.equal(ux.serviceStatus(service).label,'Unreachable');assert.match(ux.recoveryHint(service,false,1000),/in 60 s/);
  assert.match(ux.recoveryHint(service,true,1000),/resume/);assert.equal(ux.serviceStatus(service,true).label,'Paused');
  assert.equal(ux.serviceStatus({...service,enabled:false}).label,'Disabled');
  assert.equal(ux.serviceStatus({...service,health:'error'}).label,'Runtime error');
  assert.equal(ux.serviceStatus({...service,gatewayConnection:{status:'checking'}}).label,'Checking gateway');
  assert.equal(ux.serviceStatus({...service,gatewayConnection:{status:'reachable'}}).label,'Ready');
});
