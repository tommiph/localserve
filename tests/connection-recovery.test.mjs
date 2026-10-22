/** Connection setup uses synthetic devices and never emits automation events. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {generateKeyPairSync} from 'node:crypto';
import {createSamsungAdapter} from '../plugins/samsung-tv/server/index.mjs';
import {createOculusAdapter} from '../plugins/oculus-go/server/index.mjs';
import {validateDeclaration} from '../server/plugins.mjs';
import {connectRemote} from '../plugins/samsung-tv/server/client.mjs';
import {createLocalserve} from '../server.mjs';

const pin = Array(32).fill('AB').join(':');
const settings = {host:'192.168.1.20', port:8002, fingerprint:pin, token:'', 'remote-name':'Localserve', 'poll-minutes':1};
const pairing = {host:'192.168.1.10', port:8002, fingerprint:pin, token:'authorized-token'};
const declarations = await Promise.all(['samsung-tv','oculus-go'].map(async id => JSON.parse(await fs.readFile(new URL(`../plugins/${id}/declaration.json`, import.meta.url)))));
function context() {
  const controller = new AbortController();
  return {controller, signal:controller.signal, readState:async()=>({}), log:async()=>{}, wait:async()=>controller.signal.throwIfAborted(),
    saveState:async()=>assert.fail('Setup must not replace telemetry'), emit:async()=>assert.fail('Setup must not emit Task events')};
}

test('connection metadata accepts only declared parameter-free Settings actions', () => {
  for (const raw of declarations) {
    const d = validateDeclaration(raw);
    assert.ok(d.connectionSetup);
    for (const action of [d.connectionSetup.testAction,d.connectionSetup.repairAction].filter(Boolean)) assert.equal(d.actions.find(a=>a.id===action).settingsOnly,true);
    const bad = structuredClone(raw); bad.connectionSetup.testAction='refresh';
    assert.throws(()=>validateDeclaration(bad),/Connection setup/);
    const secret = structuredClone(raw); secret.connectionSetup.addressSetting=raw.id==='samsung-tv'?'token':'adb-key';
    assert.throws(()=>validateDeclaration(secret),/Connection setup/);
    const polling=structuredClone(raw);polling.polling.actionId='test-connection';
    assert.throws(()=>validateDeclaration(polling),/Polling/);
  }
});

test('authorized TLS handshake stores certificate identity even without token rotation', async () => {
  let saved;
  const connection=await connectRemote(settings,{host:settings.host,port:8002,token:'existing'},new AbortController().signal,{
    agentFactory:()=>({destroy(){}}),saveToken:async next=>{saved=next;},socketFactory:()=>{
      const socket=new EventEmitter();socket.terminate=()=>{};
      queueMicrotask(()=>socket.emit('message',Buffer.from(JSON.stringify({event:'ms.channel.connect',data:{}}))));return socket;
    },
  });
  assert.equal(saved.fingerprint,pin);assert.equal(saved.token,'existing');connection.close();
});

test('setup actions are excluded from Task capabilities and reject automatic or Task execution', async t => {
  const base=new URL('./.tmp/',import.meta.url);await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(new URL('connection-',base));let app;
  t.after(async()=>{await app?.close();assert.ok(path.basename(root).startsWith('connection-'));await fs.rm(root,{recursive:true,force:true});});
  const folder=path.join(root,'plugins/samsung-tv');await fs.mkdir(path.join(folder,'server'),{recursive:true});
  await fs.writeFile(path.join(folder,'declaration.json'),JSON.stringify(declarations[0]));
  await fs.writeFile(path.join(folder,'server/index.mjs'),"export default {validateConfiguration(){return true;},start(){},stop(){},execute(){throw Error('No setup request should enter the runtime.');}};");
  app=await createLocalserve(root,{automatic:false});
  await app.registry.saveConfiguration('samsung-tv',{revision:1,enabled:true});
  assert.ok(!app.snapshot().taskActions.some(action=>['test-connection','repair-connection'].includes(action.actionId)));
  for(const action of ['test-connection','repair-connection'])for(const ctx of [{taskId:'task'},{automatic:true}])
    await assert.rejects(async()=>app.registry.execute('samsung-tv',action,{},ctx),/only in plugin Settings/);
});

test('TV address repair verifies the saved pin, reads apps and commits rotated authorization without a screen command', async () => {
  const order = []; let saved;
  const adapter = createSamsungAdapter({vault:{load:async()=>pairing,save:async next=>{saved=next;order.push('save');}}, remote:async (values,auth,signal,options)=>{
    assert.equal(values.fingerprint,pairing.fingerprint); assert.equal(auth.host,settings.host);
    await options.saveToken({...auth,token:'rotated'});
    return {apps:async()=>{order.push('apps');return [];},close:()=>order.push('close'),send:()=>assert.fail('No screen commands')};
  }});
  await adapter.start(settings);
  const result = await adapter.execute('repair-connection',{},context());
  assert.equal(result.connected,true); assert.deepEqual(order,['apps','save','close']);
  assert.equal(saved.host,settings.host); assert.equal(saved.token,'rotated');
  // The running adapter immediately uses the new target, without a plugin restart.
  await adapter.execute('test-connection',{},context());
  await adapter.stop();
});

test('TV repair never connects with an absent/changed pin, absent pairing or unverified plain port', async () => {
  for (const [auth,values] of [
    [null,settings], [{...pairing,fingerprint:undefined},settings],
    [{...pairing,fingerprint:Array(32).fill('CD').join(':')},settings],
    [{...pairing,port:8001},{...settings,port:8001}],
    [pairing,{...settings,token:'replacement'}],
  ]) {
    const adapter=createSamsungAdapter({vault:{load:async()=>auth,save:async()=>assert.fail('No writes')},remote:async()=>assert.fail('No token may be sent')});
    await adapter.start(values); await assert.rejects(adapter.execute('repair-connection',{},context())); await adapter.stop();
  }
});

test('failed/cancelled TV verification preserves pairing and closes its owned connection', async () => {
  for (const failure of ['certificate','authorization','apps','cancel','storage']) {
    let saves=0,closed=0; const ctx=context();
    const adapter=createSamsungAdapter({vault:{load:async()=>pairing,save:async()=>{saves++;throw Error('Storage unavailable');}},remote:async()=>{
      if(failure==='certificate')throw Error('TV certificate fingerprint changed.');
      if(failure==='authorization')throw Error('The TV declined its saved pairing token.');
      return {apps:async()=>{if(failure==='apps')throw Error('TV app list is invalid.');if(failure==='cancel')ctx.controller.abort();return [];},close:()=>closed++};
    }});
    await adapter.start(settings); await assert.rejects(adapter.execute('repair-connection',{},ctx));
    assert.equal(saves,failure==='storage'?1:0); assert.equal(closed,['apps','cancel','storage'].includes(failure)?1:0); await adapter.stop();
  }
});

test('Oculus test authenticates and checks only the configured serial, including after an address change', async () => {
  const pair=generateKeyPairSync('rsa',{modulusLength:2048}), key={privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'})};
  let serial='HEADSET',closed=0; const reads=[],targets=[];
  const adapter=createOculusAdapter({vault:{load:async()=>key},connect:async address=>{targets.push(address);return {read:async section=>{reads.push(section);return serial;},close:()=>closed++};}});
  for(const address of ['192.168.1.10:5555','192.168.1.20:5555']){
    await adapter.start({address,serial:'HEADSET','adb-key':''});
    assert.equal((await adapter.execute('test-connection',{},context())).connected,true); await adapter.stop();
  }
  serial='OTHER';await adapter.start({address:'192.168.1.20:5555',serial:'HEADSET','adb-key':''});
  await assert.rejects(adapter.execute('test-connection',{},context()),/serial/);
  assert.deepEqual(reads,['identity','identity','identity']); assert.equal(closed,3);assert.equal(targets.length,3); await adapter.stop();
});

test('connection UI keeps results scoped to settings revision and posts only the selected setup action', async () => {
  const service={...validateDeclaration(declarations[0]),enabled:true,configurationReady:true,config:{revision:3,settings},actions:validateDeclaration(declarations[0]).actions};
  let resolve, requests=0, renders=0;
  const scope={state:{paused:false,services:[service]},currentView:service.id,icon:()=>'',escapeHtml:value=>String(value).replaceAll('<','&lt;'),formatServerTimestamp:()=> 'time',
    document:{addEventListener(){},getElementById(){return null;}},mutate:async(url,body)=>{requests++;assert.equal(url,'api/plugins/samsung-tv/actions/test-connection');assert.equal(body.revision,3);assert.deepEqual(Object.keys(body.parameters),[]);await new Promise(r=>resolve=r);return {result:{message:'Verified'}};}};
  vm.createContext(scope);vm.runInContext(await fs.readFile(new URL('../web/plugin-ui.js',import.meta.url),'utf8')+'\nglobalThis.ui=PluginUI;',scope);
  const ui=scope.ui;ui.render=()=>renders++;
  assert.match(ui.connectionPanel(service),/Not checked in this browser session/);
  const control={dataset:{revision:'3',capability:'test-connection'}};
  const operation=ui.testConnection(service,control);await ui.testConnection(service,control);assert.equal(requests,1);
  resolve();await operation;assert.match(ui.connectionPanel(service),/Verified/);assert.equal(ui.pending,false);assert.equal(renders,2);
  service.config.revision++;assert.doesNotMatch(ui.connectionPanel(service),/Verified/);
  scope.mutate=async()=>{throw Error('<Connection failed>');};control.dataset.revision='4';
  await ui.testConnection(service,control);assert.match(ui.connectionPanel(service),/&lt;Connection failed>/);assert.equal(ui.pending,false);
  scope.state.paused=true;assert.match(ui.connectionPanel(service),/Enable server functions first/);
});
