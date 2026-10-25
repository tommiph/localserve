/** Recovery uses disposable adapters only; no installed integration is loaded. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {PluginRegistry} from '../server/plugins.mjs';
import {ExecutionGate} from '../server/tasks.mjs';

const temporary = new URL('./.tmp/', import.meta.url);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 10000;
  while (!check()) { assert.ok(Date.now() < deadline, 'Synthetic process did not settle'); await sleep(10); }
}
const adapter = `let settings;
export default {
  validateConfiguration(value) { if(value.mode==='invalid') throw Error('Invalid adapter configuration'); settings=value; return value.mode!=='unconfigured'; },
  start() {}, stop() {},
  async execute(id, parameters, context) {
    if(id==='crash') { await context.saveState({claims:1}); process.exit(7); }
    if(id==='hang') return new Promise(()=>{});
    if(id==='fail') throw Error('Provider unavailable');
    return settings.mode;
  }
};`;
async function fixture(t, count = 1) {
  await fs.mkdir(temporary, {recursive:true});
  const root = await fs.mkdtemp(new URL('recovery-', temporary));
  const directory = path.join(root, 'plugins');
  await fs.mkdir(directory);
  const names = Array.from({length:count}, (_,index) => 'source-' + index);
  for (const id of names) {
    const folder = path.join(directory, id);
    await fs.mkdir(path.join(folder, 'server'), {recursive:true});
    await fs.writeFile(path.join(folder, 'server/index.mjs'), adapter);
    await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify({schemaVersion:1, apiVersion:1,
      id, name:id, version:'1.0.0', icon:'plug', runtime:{entry:'server/index.mjs'},
      settings:[{id:'mode',label:'Mode',type:'string',default:'normal'}],
      actions:['crash','hang','fail','read'].map(id=>({id,name:id,parameters:[]}))}));
  }
  const registry = new PluginRegistry(directory, {snapshot:()=>({plugins:Object.fromEntries(names.map(id=>[id,{enabled:true}]))})}, {async add(){}});
  registry.attachEngine({gate:new ExecutionGate()});
  t.after(async () => {
    await registry.close();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(fileURLToPath(temporary)), 'Temporary root ownership');
    await fs.rm(root, {recursive:true, force:true});
  });
  await registry.discover();
  return {registry, record:registry.get(names[0]), root};
}
async function crash(registry, record) {
  const runtime = record.runtime;
  await assert.rejects(registry.execute(record.plugin.id, 'crash', {}), /exited|unknown|cancelled/i);
  await until(()=>record.health==='error' && !record.pending);
  assert.equal(runtime.error instanceof Error, true);
  return runtime;
}

test('failed process recovers after cooldown without replaying its interrupted action or changing configuration', async t => {
  const {registry, record} = await fixture(t);
  const configuration = record.config.snapshot();
  const old = await crash(registry, record);
  assert.deepEqual(record.state.snapshot(), {claims:1});
  assert.equal(registry.services()[0].runtimeRecovery.status, 'waiting');
  await registry.recoverOne(record.recovery.nextAt - 1);
  assert.equal(record.runtime, old);
  await registry.recoverOne(record.recovery.nextAt);
  assert.notEqual(record.runtime, old);
  assert.equal(record.health, 'ready');
  assert.equal(record.error, '');
  assert.equal(registry.services()[0].runtimeRecovery, null);
  assert.deepEqual(record.state.snapshot(), {claims:1}, 'Committed claims remain; execute is not replayed');
  assert.deepEqual(record.config.snapshot(), configuration);
  assert.equal(await registry.execute(record.plugin.id, 'read', {}), 'normal');
  registry.runtimeFailed(record, old, Error('Late old callback'));
  assert.equal(record.health, 'ready');
});

test('repeated crashes back off to five minutes and reset only after sustained readiness', async t => {
  const {registry, record} = await fixture(t);
  const delays = [15000,30000,60000,120000,300000,300000];
  for (const delay of delays) {
    const started = Date.now();
    await crash(registry, record);
    assert.ok(record.recovery.nextAt >= started + delay);
    assert.ok(record.recovery.nextAt <= Date.now() + delay);
    await registry.recoverOne(record.recovery.nextAt);
  }
  record.recovery.readySince = Date.now() - 300001;
  await crash(registry, record);
  assert.equal(record.recovery.failures, 1);
});

test('pause, disable, contract replacement and shutdown never admit recovery', async t => {
  const {registry, record} = await fixture(t);
  const old = await crash(registry, record), due = record.recovery.nextAt;
  registry.engine.gate.setPaused(true);
  await registry.recoverOne(due);
  assert.equal(record.runtime, old);
  registry.engine.gate.setPaused(false);
  await registry.saveConfiguration(record.plugin.id, {revision:1, enabled:false});
  await registry.recoverOne(due);
  assert.equal(record.runtime, old);
  assert.equal(registry.services()[0].runtimeRecovery, null);
  await registry.saveConfiguration(record.plugin.id, {revision:2, enabled:true, settings:{mode:'latest'}});
  record.health = 'restart-required';
  await registry.recoverOne(due);
  assert.equal(record.runtime, old);
  record.health = 'error';
  await registry.recoverOne(due);
  assert.equal(await registry.execute(record.plugin.id, 'read', {}), 'latest');
  await crash(registry, record);
  const current = record.runtime;
  registry.beginClose();
  await registry.recoverOne(record.recovery.nextAt);
  assert.equal(record.runtime, current);
});

test('recovery drains host writes and defers if pause changes during drain', async t => {
  const {registry, record} = await fixture(t);
  const old = await crash(registry, record);
  let release;
  const write = new Promise(resolve=>{release=resolve;});
  old.hostCalls.add(write);
  const recovery = registry.recoverOne(record.recovery.nextAt);
  await until(()=>record.recovery.active);
  assert.equal(registry.services()[0].runtimeRecovery.status,'recovering');
  assert.equal(record.runtime,old);
  registry.engine.gate.setPaused(true);
  release();
  await recovery;
  assert.equal(record.runtime,old);
  registry.engine.gate.setPaused(false);
  await registry.recoverOne(record.recovery.nextAt);
  assert.equal(record.health,'ready');
});

test('settings and recovery serialize, and removal drains the same lifecycle', async t => {
  const {registry, record, root} = await fixture(t);
  const old = await crash(registry, record);
  let release;
  old.hostCalls.add(new Promise(resolve=>{release=resolve;}));
  const recovery = registry.recoverOne(record.recovery.nextAt);
  await until(()=>record.recovery.active);
  const save = registry.saveConfiguration(record.plugin.id, {revision:1, enabled:false,settings:{mode:'latest'}});
  release();
  await Promise.all([recovery,save]);
  assert.equal(record.health,'idle');
  assert.equal(record.config.snapshot().enabled,false);
  assert.equal(record.config.snapshot().settings.mode,'latest');
  await fs.unlink(path.join(root,'plugins',record.plugin.id,'declaration.json'));
  await registry.discover();
  assert.equal(registry.records.size,0);
  assert.equal(record.runtime.stopping,true);
});

test('at most one failed worker is restarted per discovery pass', async t => {
  const {registry, record} = await fixture(t,2);
  const second = registry.get('source-1');
  await crash(registry,record);await crash(registry,second);
  record.recovery.nextAt=0;second.recovery.nextAt=0;
  await registry.discover();
  assert.equal(record.health,'ready');
  assert.equal(second.health,'error');
  await registry.discover();
  assert.equal(second.health,'ready');
});

test('provider errors and adapter validation errors do not cause respawn loops', async t => {
  const {registry, record} = await fixture(t);
  await assert.rejects(registry.execute(record.plugin.id,'fail',{}), /Provider unavailable/);
  assert.equal(record.health,'ready');
  assert.equal(record.recovery.nextAt,null);
  await crash(registry,record);
  await registry.saveConfiguration(record.plugin.id,{revision:1,settings:{mode:'invalid'}});
  await registry.recoverOne(record.recovery.nextAt);
  assert.equal(record.health,'error');
  assert.match(record.error,/Invalid adapter configuration/);
  assert.equal(record.recovery.nextAt,null);
});

test('unresponsive requests fail the process and recover without a second execution', async t => {
  const {registry, record} = await fixture(t);
  const runtime = record.runtime;
  // Short direct supervision deadline exercises the same unresponsive-child
  // path without waiting for an ordinary action's thirty-second watchdog.
  await assert.rejects(runtime.request('execute',{actionId:'hang',parameters:{}},{},10),/timed out/);
  assert.equal(record.health,'error');
  await registry.recoverOne(record.recovery.nextAt);
  assert.equal(record.health,'ready');
  assert.notEqual(record.runtime,runtime);
});

test('administrator recovery labels distinguish deferred, active and paused recovery', async () => {
  const ux=vm.runInNewContext(await fs.readFile(new URL('../web/admin-ux.js',import.meta.url),'utf8')+';AdminUX;');
  const service={enabled:true,health:'error',configurationReady:true,runtimeRecovery:{status:'waiting',nextAttemptAt:12000}};
  assert.equal(ux.serviceStatus(service).label,'Recovery pending');
  assert.match(ux.recoveryHint(service,false,2000),/in 10 s/);
  assert.match(ux.recoveryHint(service,true),/when the server resumes/);
  service.runtimeRecovery.status='recovering';
  assert.equal(ux.serviceStatus(service).label,'Recovering');
  assert.match(ux.recoveryHint(service),/not retried/);
  assert.equal(ux.recoveryHint({...service,enabled:false}),'');
});
