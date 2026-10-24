/** Saved lighting scenes share Controls claims and Task cancellation. Fake
 * adapters record commands locally; no gateway or existing service is used. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createLocalserve} from '../server.mjs';
import {validateDeclaration} from '../server/plugins.mjs';
import {validateTaskParameters} from '../server/task-event-values.mjs';

async function waitFor(check) {
  const until = Date.now() + 4000;
  while (!await check()) {
    if (Date.now() > until) throw new Error('Synthetic scene did not settle');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function fixture(t) {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url));
  await fs.mkdir(base, {recursive: true});
  const root = await fs.mkdtemp(path.join(base, 'task-scenes-'));
  const folder = path.join(root, 'plugins/tradfri');
  await fs.mkdir(path.join(folder, 'server'), {recursive: true});
  const declaration = JSON.parse(await fs.readFile(new URL('../plugins/tradfri/declaration.json', import.meta.url)));
  delete declaration.cardTemplates;
  declaration.runtime.entry = 'server/test.mjs';
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(declaration));
  await fs.writeFile(path.join(folder, 'server/test.mjs'), `
import fs from 'node:fs/promises';
export default {
  validateConfiguration: async () => true, start: async () => {}, stop: async () => {},
  async execute(actionId, parameters, context) {
    if (actionId === 'run-scene') throw new Error('Host-owned scene reached the device adapter');
    await context.wait(0.01);
    const claims = JSON.parse(await fs.readFile(new URL('../../../data/control-runs.json', import.meta.url), 'utf8'));
    if (!claims.runs.some(run => run.status === 'running')) throw new Error('No persisted running claim');
    await fs.appendFile(new URL('../data/effects.jsonl', import.meta.url), JSON.stringify({actionId, parameters}) + '\\n');
    await context.log('Fake scene effect');
    return {completed: true};
  }
};`);
  const app = await createLocalserve(root, {automatic: false});
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep));
    await fs.rm(root, {recursive: true, force: true});
  });
  await app.registry.saveConfiguration('tradfri', {revision: 1, enabled: true});
  const initial = {schemaVersion: 1, name: 'Lights', slug: 'lights', enabled: true, icon: 'lightbulb', columns: 1,
    presentation: 'lighting', items: [
      {id: 'evening', label: 'Evening', kind: 'scene', enabled: true, icon: 'lightbulb', steps: [
        {id: 'on', actionId: 'light-power', parameters: {id: '1', on: true}},
        {id: 'wait', actionId: 'delay', seconds: 0.2},
        {id: 'dim', actionId: 'light-brightness', parameters: {id: '1', value: 30}},
      ]},
      {id: 'off', label: 'Off', kind: 'scene', enabled: false, icon: 'lightbulb', steps: [
        {id: 'off', actionId: 'light-power', parameters: {id: '1', on: false}},
      ]},
    ]};
  const page = await app.controls.save('tradfri', initial);
  const sceneId = `${page.id}/evening`;
  const call = async (route, values) => {
    const response = await fetch(app.origin + route, {method: 'POST', headers: {Origin: app.origin,
      'Content-Type': 'application/json', 'X-Localserve-Token': app.snapshot().token}, body: JSON.stringify(values)});
    return {status: response.status, body: await response.json()};
  };
  const effects = async () => {
    try {return (await fs.readFile(path.join(folder, 'data/effects.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}
    catch (error) {if (error.code === 'ENOENT') return []; throw error;}
  };
  const settle = () => waitFor(() => !app.engine.active.size && !app.engine.pending.size && !app.controls.active.size);
  const savePage = async change => {
    const current = app.controls.pages('tradfri')[0];
    change(current);
    return app.controls.save('tradfri', current, current.id);
  };
  return {app, page, sceneId, call, effects, settle, savePage};
}

function task(sceneId) {
  return {name: 'Scene Task', enabled: true, starts: [], steps: [
    {id: 'before', type: 'log', enabled: true, message: 'Before scene'},
    {id: 'scene', type: 'plugin', enabled: true, capabilityId: 'plugin:tradfri:run-scene', parameters: {'scene-id': sceneId}},
    {id: 'after', type: 'log', enabled: true, message: 'After scene'},
  ]};
}

test('declaration explicitly owns the host action, and recursive/unbounded scene actions are rejected', async () => {
  const raw = JSON.parse(await fs.readFile(new URL('../plugins/tradfri/declaration.json', import.meta.url)));
  const plugin = validateDeclaration(raw);
  assert.equal(plugin.controls.taskSceneAction, 'run-scene');
  for (const change of [
    raw => raw.controls.actions.push('run-scene'),
    raw => {delete raw.controls.lighting;},
    raw => {raw.controls.taskSceneAction = 'missing';},
    raw => {raw.actions.find(action => action.id === 'run-scene').parameters[0].maxLength = 4000;},
  ]) {
    const invalid = structuredClone(raw); change(invalid); assert.throws(() => validateDeclaration(invalid));
  }
});

test('Task dropdown uses saved names; execution claims first, awaits all steps and keeps Task provenance', async t => {
  const f = await fixture(t);
  const action = f.app.registry.actions().find(action => action.actionId === 'run-scene');
  assert.equal(action.available, true);
  assert.deepEqual(action.parameters[0].enumLabels, ['Lights · Evening', 'Lights · Off (Unavailable)']);
  assert.equal((await f.call('/api/tasks', task(f.sceneId))).status, 200);
  const saved = f.app.tasks.snapshot()[0];
  const result = await f.call(`/api/tasks/${saved.id}/run`, {revision: saved.revision});
  assert.equal(result.status, 202);
  await f.settle();
  assert.deepEqual(await f.effects(), [
    {actionId: 'light-power', parameters: {id: '1', on: true}},
    {actionId: 'light-brightness', parameters: {id: '1', value: 30}},
  ]);
  assert.equal(f.app.state.snapshot().runs[0].status, 'completed');
  const history = f.app.controls.runs.snapshot().runs.at(-1);
  assert.equal(history.status, 'completed');
  assert.equal(history.taskId, saved.id);
  assert.equal(history.taskRunId, result.body.run.id);
  assert.equal(history.taskStepId, 'scene');
  const messages = f.app.activity.latest(100).map(entry => entry.message).reverse();
  assert.ok(messages.lastIndexOf('Fake scene effect') < messages.indexOf('After scene'));
  assert.equal(history.totalSteps, 3);
  await f.savePage(page => {page.name = 'Renamed'; page.items[0].label = 'Renamed scene';});
  assert.equal(f.app.registry.actions().find(action => action.actionId === 'run-scene').parameters[0].enum[0], f.sceneId);
  assert.equal(f.app.registry.actions().find(action => action.actionId === 'run-scene').parameters[0].enumLabels[0], 'Renamed · Renamed scene');
});

test('disabled/deleted scenes and disabled pages fail preflight before any earlier Task effect; stale references remain editable', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/tasks', task(f.sceneId))).status, 200);
  const saved = f.app.tasks.snapshot()[0];
  // Keep another enabled scene so this checks the selected target, not merely
  // the capability-wide any-scene availability flag.
  await f.savePage(page => {page.items[0].enabled = false; page.items[1].enabled = true;});
  const disabled = await f.call(`/api/tasks/${saved.id}/run`, {revision: saved.revision});
  assert.equal(disabled.status, 409);
  assert.ok(!f.app.activity.latest(100).some(entry => entry.message === 'Before scene'));
  await f.savePage(page => {page.items.splice(0, 1);});
  const retained = await f.call(`/api/tasks/${saved.id}`, {...saved, name: 'Renamed Task'});
  assert.equal(retained.status, 200, JSON.stringify(retained.body));
  assert.equal(f.app.tasks.snapshot()[0].steps[1].parameters['scene-id'], f.sceneId);
  assert.equal((await f.call('/api/tasks', {...task(f.sceneId), name: 'New missing scene'})).status, 400);
  await f.savePage(page => {page.enabled = false;});
  assert.equal(f.app.registry.actions().find(action => action.actionId === 'run-scene').available, false);
  assert.equal((await f.effects()).length, 0);
});

test('Task cancellation during a paused scene stops remaining commands and drains its Controls run', async t => {
  const f = await fixture(t);
  await f.call('/api/tasks', task(f.sceneId));
  const saved = f.app.tasks.snapshot()[0];
  const result = await f.call(`/api/tasks/${saved.id}/run`, {revision: saved.revision});
  await waitFor(async () => (await f.effects()).length === 1);
  await f.app.engine.setPaused(true);
  f.app.engine.cancel(result.body.run.id);
  await f.settle();
  assert.equal(f.app.state.snapshot().runs[0].status, 'cancelled');
  assert.equal(f.app.controls.runs.snapshot().runs.at(-1).status, 'cancelled');
  assert.equal((await f.effects()).length, 1);
  assert.ok(!f.app.activity.latest(100).some(entry => entry.message === 'After scene'));
});

test('page edits cancel captured scenes; scene claim failures and overlapping manual runs admit no extra effects', async t => {
  const f = await fixture(t);
  await f.call('/api/tasks', task(f.sceneId));
  const saved = f.app.tasks.snapshot()[0];
  await f.call(`/api/tasks/${saved.id}/run`, {revision: saved.revision});
  await waitFor(async () => (await f.effects()).length === 1);
  await f.savePage(page => {page.items[0].label = 'Edited';});
  await f.settle();
  assert.equal(f.app.state.snapshot().runs[0].status, 'failed');
  assert.equal((await f.effects()).length, 1);
  const view = f.app.controls.viewer('tradfri', 'lights');
  await f.app.controls.invoke('tradfri', 'lights', view.token, {revision: view.page.revision, itemId: 'evening', requestId: randomUUID()});
  await f.call(`/api/tasks/${saved.id}/run`, {revision: saved.revision});
  await f.settle();
  assert.equal(f.app.state.snapshot().runs[0].status, 'failed');
  assert.equal((await f.effects()).length, 3, 'Only the existing manual scene ran.');
  const original = f.app.controls.runs.write;
  f.app.controls.runs.write = async () => {throw new Error('Synthetic claim failure');};
  try {
    await f.call(`/api/tasks/${saved.id}/run`, {revision: saved.revision}); await f.settle();
    assert.equal(f.app.state.snapshot().runs[0].status, 'failed');
    assert.equal((await f.effects()).length, 3);
    assert.equal(f.app.controls.active.size, 0);
  } finally {f.app.controls.runs.write = original;}
});

test('scene selectors retain unavailable references, show names and do not offer Event text substitution', async () => {
  const context = vm.createContext({document: {addEventListener() {}}, escapeHtml: value => String(value),
    PluginUI: {groupFields:(fields,render)=>fields.map(render).join(''),field: (field, selected) => JSON.stringify({field, selected})}});
  const ui = await fs.readFile(new URL('../web/tasks-ui.js', import.meta.url), 'utf8');
  vm.runInContext(ui + ';globalThis.ui=TaskUI;', context);
  const action = {controlScene: true, parameters: [{id: 'scene-id', label: 'Lighting scene', type: 'string', required: true,
    enum: ['one/scene'], enumLabels: ['Lights · Evening']} ]};
  const result = context.ui.parameterFields({id: 'step', parameters: {'scene-id': 'deleted/scene'}}, action);
  assert.match(result, /Unavailable lighting scene/);
  assert.match(result, /deleted\/scene/);
  assert.doesNotMatch(result, /event-value-picker/);
  assert.throws(() => validateTaskParameters(action, {'scene-id': '{{event.title}}'}, [], []));
});
