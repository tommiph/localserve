/** Real child-process checks in isolated roots. No device services are contacted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalserve } from '../server.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { glyphs } from '../server/plugin-schema.mjs';

const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
const simulatorSource = fileURLToPath(new URL('../plugins/simulator/', import.meta.url));
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(check) {
  const deadline = Date.now() + 6000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Simulator test timed out.');
    await sleep(10);
  }
}

async function fixture(t) {
  await fs.mkdir(temporaryRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'simulator-'));
  const folder = path.join(root, 'plugins', 'simulator');
  await fs.mkdir(path.join(folder, 'server'), { recursive: true });
  for (const file of ['declaration.json', 'server/index.mjs']) await fs.copyFile(path.join(simulatorSource, file), path.join(folder, file));
  let app = await createLocalserve(root, { automatic: false });
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(temporaryRoot) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  async function call(endpoint, values) {
    const response = await fetch(app.origin + endpoint, values === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.origin, 'X-Localserve-Token': app.snapshot().token },
      body: JSON.stringify(values),
    });
    return { status: response.status, body: await response.json() };
  }
  function service() { return app.registry.services()[0]; }
  function save(values) { return call('/api/plugins/simulator/config', { revision: service().config.revision, ...values }); }
  async function enable() { assert.equal((await save({ enabled: true })).status, 200); }
  function action(id, parameters = {}) { return call(`/api/plugins/simulator/actions/${id}`, { parameters }); }
  async function restart() {
    await app.close();
    app = await createLocalserve(root, { automatic: false });
  }
  return { root, folder, get app() { return app; }, call, service, save, enable, action, restart };
}

function pluginStep(action, parameters = {}, id = action) {
  return { id, enabled: true, type: 'plugin', capabilityId: `plugin:simulator:${action}`, parameters };
}

async function createTask(f, name, steps, eventId) {
  const response = await f.call('/api/tasks', {
    name, enabled: true, steps,
    starts: eventId ? [{ id: 'event-rule', name: 'Event rule', enabled: true, type: 'event', eventId: `plugin:simulator:event:${eventId}` }] : [],
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return f.app.tasks.snapshot().find(task => task.name === name);
}

test('declarations reject incompatible contracts and every offered glyph is bundled', async () => {
  const declaration = JSON.parse(await fs.readFile(path.join(simulatorSource, 'declaration.json'), 'utf8'));
  assert.equal(validateDeclaration(declaration).icon, 'plug');
  assert.throws(() => validateDeclaration({ ...declaration, apiVersion: 2 }), /version|Version/);
  assert.throws(() => validateDeclaration({ ...declaration, runtime: { entry: '../server.mjs' } }), /relative/);
  assert.throws(() => validateDeclaration({ ...declaration, events: [...declaration.events, declaration.events[0]] }), /unique/);
  assert.throws(() => validateDeclaration({ ...declaration, settings: [{ id: 'enabled', type: 'boolean' }] }), /reserved/);
  const css = await fs.readFile(new URL('../assets/material-symbols/material-symbols.css', import.meta.url), 'utf8');
  for (const glyph of glyphs) assert.ok(css.includes(`.ms-${glyph}::before`), `Missing bundled glyph: ${glyph}`);
});

test('folder-owned settings, JSON identity, glyphs, stale saves, and private paths', async t => {
  const f = await fixture(t);
  assert.equal(f.service().name, 'Simulator');
  assert.equal(f.service().icon, 'plug');
  assert.equal(f.service().enabled, false);
  assert.equal(f.service().configurationReady, true);
  const stale = f.service().config.revision;
  assert.equal((await f.save({ icon: 'robot' })).status, 200);
  assert.equal((await f.call('/api/plugins/simulator/config', { revision: stale, icon: 'flask' })).status, 409);
  for (const values of [{ name: 'Renamed' }, { icon: 'nonexistent-glyph' }, { settings: { 'configuration-complete': 'yes' } }]) assert.equal((await f.save(values)).status, 400);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.folder, 'data/config.json'), 'utf8')).icon, 'robot');
  await assert.rejects(fs.stat(path.join(f.root, 'data/plugins')), { code: 'ENOENT' });
  for (const file of ['declaration.json', 'server/index.mjs', 'data/config.json', 'data/state.json', 'data/activity.jsonl']) assert.equal((await f.call(`/plugins/simulator/${file}`)).status, 404);
  const declarationFile = path.join(f.folder, 'declaration.json');
  const declaration = JSON.parse(await fs.readFile(declarationFile, 'utf8'));
  declaration.name = 'Simulation Lab';
  await fs.writeFile(declarationFile, JSON.stringify(declaration));
  await f.app.registry.discover();
  assert.equal(f.service().name, 'Simulation Lab');
  assert.equal(f.service().icon, 'robot');
  await f.restart();
  assert.equal(f.service().name, 'Simulation Lab');
  assert.equal(f.service().icon, 'robot');
});

test('actions and events execute through the adapter and persist without replay', async t => {
  const f = await fixture(t);
  assert.equal((await f.action('pulse')).status, 409);
  await f.enable();
  assert.equal(f.app.registry.actions().filter(action => action.available).length, 6);
  assert.deepEqual(f.app.registry.events().map(event => event.eventId), ['signal', 'value-changed', 'pulse']);
  const listener = await createTask(f, 'Signal listener', [{ id: 'log', type: 'log', enabled: true, message: 'Signal received' }], 'signal');
  await createTask(f, 'Value listener', [{ id: 'log', type: 'log', enabled: true, message: 'Value received' }], 'value-changed');
  await createTask(f, 'Pulse listener', [{ id: 'log', type: 'log', enabled: true, message: 'Pulse received' }], 'pulse');
  assert.equal((await f.action('emit-signal', { message: 'Hello' })).status, 200);
  await waitFor(() => !f.app.engine.active.size);
  assert.equal(f.app.state.snapshot().runs[0].taskId, listener.id);
  assert.deepEqual(f.app.state.snapshot().runs[0].event.payload, { message: 'Hello' });
  assert.equal((await f.action('set-value', { value: 42 })).status, 200);
  const eventCount = () => f.service().pluginActivity.filter(entry => entry.eventId === 'value-changed').length;
  assert.equal(eventCount(), 1);
  await f.action('set-value', { value: 42 });
  assert.equal(eventCount(), 1);
  await f.action('pulse');
  await waitFor(() => !f.app.engine.active.size);
  assert.ok(f.app.state.snapshot().runs.some(run => run.event?.eventId === 'value-changed'));
  assert.ok(f.app.state.snapshot().runs.some(run => run.event?.eventId === 'pulse'));
  assert.equal(f.service().pluginState.sequence, 1);
  await f.action('log', { message: 'Persistent log', level: 'success' });
  assert.equal((await f.action('set-value', { value: 1000001 })).status, 400);
  assert.equal((await f.action('emit-signal', { unknown: 'value' })).status, 400);
  assert.equal((await f.action('undeclared')).status, 400);
  await assert.rejects(f.app.engine.emitPluginEvent('simulator', 'signal', { message: 123 }), /Invalid/);
  const runCount = f.app.state.snapshot().runs.length;
  await f.restart();
  assert.equal(f.service().enabled, true);
  assert.equal(f.service().pluginState.value, 42);
  assert.equal(f.service().pluginState.sequence, 1);
  assert.ok(f.service().pluginActivity.some(entry => entry.message === 'Persistent log'));
  assert.equal(f.app.state.snapshot().runs.length, runCount);
});

test('global Tasks execute plugin steps in order and isolate deliberate failures', async t => {
  const f = await fixture(t);
  await f.enable();
  const task = await createTask(f, 'Plugin sequence', [pluginStep('log', { message: 'Before' }), pluginStep('wait', { seconds: 0.05 }), pluginStep('log', { message: 'After' }, 'last')]);
  const started = await f.call(`/api/tasks/${task.id}/run`, {});
  assert.equal(started.status, 202);
  await waitFor(() => !f.app.engine.active.size);
  const messages = f.app.activity.entries.filter(entry => entry.runId === started.body.run.id).map(entry => entry.message);
  assert.ok(messages.indexOf('Before') < messages.indexOf('Wait completed'));
  assert.ok(messages.indexOf('Wait completed') < messages.indexOf('After'));
  assert.equal(f.app.state.snapshot().runs[0].status, 'completed');
  const failing = await createTask(f, 'Failure', [pluginStep('fail', { message: 'Expected failure' }), pluginStep('log', { message: 'Must not run' })]);
  await f.call(`/api/tasks/${failing.id}/run`, {});
  await waitFor(() => !f.app.engine.active.size);
  assert.equal(f.app.state.snapshot().runs[0].status, 'failed');
  assert.ok(!f.service().pluginActivity.some(entry => entry.message === 'Must not run'));
  assert.equal((await f.action('pulse')).status, 200);
});

test('plugin Wait pauses, cancels while paused, and disabling drains work', async t => {
  const f = await fixture(t);
  await f.enable();
  const task = await createTask(f, 'Pause and cancel', [pluginStep('wait', { seconds: 0.4 }), pluginStep('log', { message: 'Finished' })]);
  const started = await f.call(`/api/tasks/${task.id}/run`, {});
  await waitFor(() => f.service().pluginActivity.some(entry => entry.message.startsWith('Wait:')));
  await f.call('/api/pause', { paused: true });
  await sleep(500);
  assert.ok(!f.service().pluginActivity.some(entry => entry.message === 'Finished'));
  assert.equal((await f.action('pulse')).status, 409);
  assert.equal((await f.call(`/api/runs/${started.body.run.id}/cancel`, {})).status, 200);
  await waitFor(() => !f.app.engine.active.size);
  assert.equal(f.app.state.snapshot().runs[0].status, 'cancelled');
  assert.equal(f.service().health, 'ready');
  await f.call('/api/pause', { paused: false });
  const pending = f.action('wait', { seconds: 5 });
  await waitFor(() => f.app.registry.get('simulator').pending > 0);
  await f.save({ enabled: false });
  assert.equal((await pending).status, 409);
  assert.equal(f.service().enabled, false);
  assert.equal(f.service().configurationReady, true);
  assert.equal((await f.call(`/api/tasks/${task.id}/run`, {})).status, 409);
});

test('configuration readiness is independent of enablement and glyph saves preserve actions', async t => {
  const f = await fixture(t);
  await f.enable();
  const pending = f.action('wait', { seconds: 0.15 });
  await waitFor(() => f.app.registry.get('simulator').pending > 0);
  await f.save({ icon: 'flask' });
  assert.equal((await pending).status, 200);
  const record = f.app.registry.get('simulator');
  const request = record.runtime.request.bind(record.runtime);
  let releaseStop;
  const stopped = new Promise(resolve => { releaseStop = resolve; });
  record.runtime.request = async (...arguments_) => {
    if (arguments_[0] === 'stop') await stopped;
    return request(...arguments_);
  };
  const changing = f.save({ settings: { 'configuration-complete': false } });
  try {
    await waitFor(() => f.service().health === 'configuring');
    assert.equal((await f.action('pulse')).status, 409, 'No admission between config commit and runtime application');
  } finally { releaseStop(); }
  await changing;
  record.runtime.request = request;
  assert.equal(f.service().enabled, true);
  assert.equal(f.service().configurationReady, false);
  assert.equal((await f.action('pulse')).status, 409);
  await f.save({ enabled: false });
  assert.equal(f.service().configurationReady, false);
  await f.save({ settings: { 'configuration-complete': true } });
  assert.equal(f.service().enabled, false);
  assert.equal(f.service().configurationReady, true);
});

test('event chains are bounded and removing a plugin preserves global definitions', async t => {
  const f = await fixture(t);
  await f.enable();
  const task = await createTask(f, 'Event dependency', [pluginStep('pulse')], 'signal');
  const result = await f.app.engine.emitPluginEvent('simulator', 'signal', {}, { trace: Array(8).fill('simulator:signal') });
  assert.equal(result.reason, 'chain-limit');
  assert.equal(f.app.state.snapshot().runs.length, 0);
  await fs.unlink(path.join(f.folder, 'declaration.json'));
  await f.app.registry.discover();
  assert.equal(f.app.registry.services().length, 0);
  assert.equal(f.app.tasks.snapshot()[0].id, task.id);
  assert.equal((await f.call(`/api/tasks/${task.id}/run`, {})).status, 409);
  assert.equal((await f.call(`/api/tasks/${task.id}`, { ...task, name: 'Renamed with missing dependency' })).status, 200);
  assert.equal(f.app.tasks.snapshot()[0].steps[0].capabilityId, 'plugin:simulator:pulse');
});

test('worker failures are contained, invalid saved data is retained, and shutdown exits children', async t => {
  const f = await fixture(t);
  await f.enable();
  const runtime = f.app.registry.get('simulator').runtime;
  runtime.child.kill();
  await waitFor(() => f.service().health === 'error');
  assert.equal((await f.call('/api/state')).status, 200);
  assert.equal((await f.action('pulse')).status, 409);
  await f.app.close();
  assert.equal(runtime.child.connected, false);
  await fs.writeFile(path.join(f.folder, 'data/config.json'), '{invalid');
  await f.restart();
  assert.equal(f.service().health, 'error');
  assert.equal(await fs.readFile(path.join(f.folder, 'data/config.json'), 'utf8'), '{invalid');
  assert.ok(f.app.registry.errors.length > 0);
});

test('concurrent pulses serialize with unique counts and the queue has a hard admission limit', async t => {
  const f = await fixture(t);
  await f.enable();
  const operations = Array.from({ length: 32 }, () => f.app.registry.execute('simulator', 'pulse', {}));
  assert.throws(() => f.app.registry.execute('simulator', 'pulse', {}), /queue is full/);
  await Promise.all(operations);
  assert.equal(f.service().pluginState.sequence, 32);
  const sequences = f.service().pluginActivity.filter(entry => entry.eventId === 'pulse').map(entry => entry.payload.sequence).sort((a, b) => a - b);
  assert.deepEqual(sequences, Array.from({ length: 32 }, (_, index) => index + 1));
});

test('worker host services reject undeclared events independently of browser validation', async t => {
  const f = await fixture(t);
  const entry = path.join(f.folder, 'server/index.mjs');
  const source = await fs.readFile(entry, 'utf8');
  // Deliberately modify only a fixture adapter to exercise the host boundary.
  await fs.writeFile(entry, source.replace("return context.emit('signal'", "return context.emit('undeclared'"));
  await f.restart();
  await f.enable();
  const result = await f.action('emit-signal', { message: 'Invalid worker event' });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /undeclared event/);
  assert.equal(f.app.state.snapshot().runs.length, 0);
  assert.equal((await f.action('pulse')).status, 200);
});

test('a missing runtime entry reports Error while the rest of Localserve remains available', async t => {
  const f = await fixture(t);
  await f.app.close();
  await fs.unlink(path.join(f.folder, 'server/index.mjs'));
  await f.restart();
  assert.equal(f.service().health, 'error');
  assert.ok(f.service().error.length > 0);
  assert.equal(f.service().configurationReady, false);
  assert.equal((await f.call('/api/state')).status, 200);
});
