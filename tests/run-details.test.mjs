/** Durable step evidence is checked with synthetic actions in disposable roots.
 * These fixtures cannot reach a provider, TV or installed lighting gateway. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalserve} from '../server.mjs';
import {validateTask} from '../server/tasks.mjs';

async function fixture(t) {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url));
  await fs.mkdir(base, {recursive: true});
  const root = await fs.mkdtemp(path.join(base, 'run-details-'));
  const app = await createLocalserve(root, {automatic: false});
  t.after(async () => { await app.close(); await fs.rm(root, {recursive: true, force: true}); });
  const action = {id: 'plugin:fixture:record', name: 'Synthetic action', pluginId: 'fixture', actionId: 'record', available: true,
    parameters: [{id: 'message', type: 'string', required: true, maxLength: 100}]};
  app.registry.actions = () => [action];
  const save = async steps => {
    const task = validateTask({name: 'Receipt fixture', enabled: true, starts: [], steps}, null, [action]);
    await app.tasks.update(items => items.push(task)); return task;
  };
  const settle = async check => {
    const until = Date.now() + 4000;
    while (!(check ? check() : !app.engine.active.size && !app.engine.pending.size)) {
      if (Date.now() > until) throw Error('Fixture did not settle');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  return {app, save, settle};
}
const command = (id, enabled = true) => ({id, type: 'plugin', enabled, capabilityId: 'plugin:fixture:record', parameters: {message: 'PRIVATE_ARGUMENT'}});

test('Event labels belong to admission receipts and survive later declaration edits', async t => {
  const f=await fixture(t);
  const declaration={id:'fixture:changed',pluginId:'fixture',pluginName:'Test source',eventId:'changed',name:'Original signal',payload:[]};
  f.app.registry.events=()=>[declaration];
  const task=await f.save([{id:'log',type:'log',enabled:true,message:'Receipt recorded'}]);
  const run=await f.app.engine.start(task.id,'Event: Event',{pluginId:'fixture',eventId:'changed',payload:{}},{automatic:true});
  declaration.name='Edited signal'; declaration.pluginName='Renamed source';
  await f.settle();
  const saved=f.app.state.snapshot().runs.find(item=>item.id===run.id);
  assert.deepEqual(saved.eventLabel,{pluginName:'Test source',name:'Original signal'});
  assert.equal(saved.event.eventLabel,undefined,'Labels never become replay payload fields.');
});

test('receipt intent commits before effects; successful/disabled steps keep timing without copying arguments', async t => {
  const f = await fixture(t), effects = [];
  f.app.registry.execute = async () => {
    assert.equal(f.app.state.snapshot().runs[0].steps[0].status, 'running'); effects.push(1);
  };
  const task = await f.save([command('one'), command('off', false)]);
  await f.app.engine.manualStart(task.id, {revision: task.revision}); await f.settle();
  const run = f.app.state.snapshot().runs[0];
  assert.equal(run.status, 'completed'); assert.equal(effects.length, 1);
  assert.equal(run.steps[0].status, 'completed'); assert.ok(run.steps[0].finishedAt >= run.steps[0].startedAt);
  assert.equal(run.steps[0].capabilityId, 'plugin:fixture:record');
  assert.equal(run.steps[1].status, 'skipped'); assert.equal(run.steps[1].reason, 'Disabled');
  assert.doesNotMatch(JSON.stringify(run), /PRIVATE_ARGUMENT/);
});

test('failures identify the failed step and future steps are not presented as queued work', async t => {
  const f = await fixture(t); let calls = 0;
  f.app.registry.execute = async () => { calls++; throw Error('Synthetic failure'); };
  const task = await f.save([command('one'), command('later')]);
  await f.app.engine.manualStart(task.id); await f.settle();
  const run = f.app.state.snapshot().runs[0];
  assert.equal(run.status, 'failed'); assert.equal(calls, 1);
  assert.equal(run.steps[0].status, 'failed'); assert.match(run.steps[0].reason, /Synthetic failure/);
  assert.equal(run.steps[1].status, 'not-run');
});

test('cancellation and recovery record interrupted evidence without replaying effects', async t => {
  const f = await fixture(t); let calls = 0;
  f.app.registry.execute = async () => { calls++; };
  const task = await f.save([{id: 'delay', type: 'delay', enabled: true, seconds: 30}, command('later')]);
  const run = await f.app.engine.manualStart(task.id);
  await f.settle(() => f.app.state.snapshot().runs[0].steps[0].status === 'running');
  f.app.engine.cancel(run.id); await f.settle();
  let saved = f.app.state.snapshot().runs[0];
  assert.equal(saved.steps[0].status, 'cancelled'); assert.equal(saved.steps[1].status, 'not-run'); assert.equal(calls, 0);
  await f.app.state.update(state => { state.runs[0].status = 'running'; state.runs[0].steps[0].status = 'running'; state.runs[0].steps[1].status = 'pending'; });
  await f.app.engine.recover(); saved = f.app.state.snapshot().runs[0];
  assert.equal(saved.status, 'interrupted'); assert.equal(saved.steps[0].status, 'interrupted');
  assert.equal(saved.steps[1].status, 'not-run'); assert.equal(calls, 0);
});
