/** Isolated quiet-hour tests use fake adapters; no TV/provider is contacted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalserve} from '../server.mjs';
import {defaultDoNotDisturb, validateDoNotDisturb, doNotDisturbStatus, isTvAction} from '../server/do-not-disturb.mjs';
import {scheduleMinute} from '../server/tasks.mjs';

const quiet = patch => ({...structuredClone(defaultDoNotDisturb), ...patch});
const monday = (hour, minute = 0) => new Date(2026, 9, 19, hour, minute);

test('weekly windows use local starting days, exact bounds and Sunday rollover', () => {
  const setting = quiet({scheduleEnabled: true, days: [1]});
  assert.equal(doNotDisturbStatus(setting, monday(21, 59)).active, false);
  assert.equal(doNotDisturbStatus(setting, monday(22)).scheduled, true);
  assert.equal(doNotDisturbStatus(setting, monday(6)).active, false);
  assert.equal(doNotDisturbStatus(setting, new Date(2026, 9, 20, 6, 59)).active, true);
  assert.equal(doNotDisturbStatus(setting, new Date(2026, 9, 20, 7)).active, false);
  assert.equal(doNotDisturbStatus(setting, new Date(2026, 9, 20, 22)).active, false);
  const sunday = {...setting, days: [0]};
  assert.equal(doNotDisturbStatus(sunday, monday(6)).active, true);
  assert.equal(doNotDisturbStatus(sunday, monday(7)).active, false);
  const daytime = {...setting, start: '09:15', end: '17:45'};
  assert.equal(doNotDisturbStatus(daytime, monday(9, 14)).active, false);
  assert.equal(doNotDisturbStatus(daytime, monday(9, 15)).active, true);
  assert.equal(doNotDisturbStatus(daytime, monday(17, 44)).active, true);
  assert.equal(doNotDisturbStatus(daytime, monday(17, 45)).active, false);
  assert.equal(doNotDisturbStatus({...setting, scheduleEnabled: false}, monday(22)).active, false);
  assert.deepEqual(doNotDisturbStatus(quiet({enabled: true}), monday(12)), {active: true, manual: true, scheduled: false});
  assert.equal(doNotDisturbStatus({...setting, enabled: true}, monday(12)).active, true);
  assert.equal(doNotDisturbStatus({...setting, enabled: false}, monday(22)).active, true);
  for (const patch of [{days: []}, {days: [1, 1]}, {days: [7]}, {days: ['1']}, {start: '24:00'},
    {end: '7:00'}, {start: '07:00'}, {enabled: 1}, {scheduleEnabled: 'true'}, {timezone: 'UTC'}]) {
    assert.throws(() => validateDoNotDisturb(quiet(patch)));
  }
  assert.throws(() => validateDoNotDisturb(null));
  assert.equal(isTvAction('webpage', 'open-on-tv'), true);
  for (const action of ['key', 'show-notice', 'play-youtube', 'wake', 'volume', 'future-effect']) assert.equal(isTvAction('samsung-tv', action), true);
  for (const action of ['refresh', 'refresh-apps']) assert.equal(isTvAction('samsung-tv', action), false);
  assert.equal(isTvAction('tradfri', 'key'), false);
});

async function waitFor(check) {
  const deadline = Date.now() + 4000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('Synthetic operation timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function fixture(t) {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url));
  await fs.mkdir(base, {recursive: true});
  const root = await fs.mkdtemp(path.join(base, 'quiet-'));
  const folder = path.join(root, 'plugins/samsung-tv');
  await fs.mkdir(path.join(folder, 'server'), {recursive: true});
  const declaration = JSON.parse(await fs.readFile(new URL('../plugins/samsung-tv/declaration.json', import.meta.url)));
  declaration.runtime.entry = 'server/test-entry.mjs';
  // Assets are irrelevant to fake effects. Keep the actual action/Event schema.
  delete declaration.cardTemplates;
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(declaration));
  await fs.writeFile(path.join(folder, 'server/test-entry.mjs'), `
import fs from 'node:fs/promises';
export default {
  validateConfiguration: async () => true, start: async () => {}, stop: async () => {},
  async execute(actionId, parameters, context) {
    if (actionId === 'send-text') {
      await context.log('Synthetic TV stage entered');
      await context.wait(0.15);
    }
    await context.wait(0.01);
    await fs.appendFile(new URL('../data/effects.jsonl', import.meta.url), JSON.stringify({actionId, parameters}) + '\\n');
    return {completed: true};
  }
};`);
  let app = await createLocalserve(root, {automatic: false});
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep));
    await fs.rm(root, {recursive: true, force: true});
  });
  await app.registry.saveConfiguration('samsung-tv', {revision: 1, enabled: true});
  const call = async (route, values, headers = {}) => {
    const response = await fetch(app.origin + route, {method: 'POST', headers: {Origin: app.origin,
      'Content-Type': 'application/json', 'X-Localserve-Token': app.snapshot().token, ...headers}, body: JSON.stringify(values)});
    return {status: response.status, body: await response.json()};
  };
  const setQuiet = async patch => {
    const result = await call('/api/config', {doNotDisturb: {...app.config.snapshot().doNotDisturb, ...patch}});
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const effects = async () => {
    try { return (await fs.readFile(path.join(folder, 'data/effects.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const settle = () => waitFor(() => !app.engine.active.size && !app.engine.pending.size);
  const restart = async () => {await app.close(); app = await createLocalserve(root, {automatic: false});};
  return {get app() {return app;}, call, setQuiet, effects, settle, restart};
}

function definition(starts = [], steps) {
  return {name: 'Quiet hours test', enabled: true, starts, steps: steps || [
    {id: 'tv', type: 'plugin', capabilityId: 'plugin:samsung-tv:key', parameters: {key: 'KEY_POWER'}, enabled: true},
    {id: 'tail', type: 'log', message: 'Non-TV step still runs', enabled: true},
  ]};
}

test('settings validate before persistence, require normal write authentication and survive restart', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.app.config.snapshot().doNotDisturb, defaultDoNotDisturb);
  assert.equal((await f.call('/api/config', {doNotDisturb: quiet({enabled: true})}, {'X-Localserve-Token': 'wrong'})).status, 403);
  assert.equal((await f.call('/api/config', {doNotDisturb: quiet({enabled: true})}, {Origin: 'http://example.com'})).status, 403);
  assert.equal((await f.call('/api/config', {doNotDisturb: quiet({days: []})})).status, 400);
  assert.equal(f.app.snapshot().doNotDisturb.active, false);
  await f.setQuiet({enabled: true, days: [1, 3, 5], start: '23:15', end: '06:45'});
  await f.restart();
  assert.equal(f.app.snapshot().doNotDisturb.active, true);
  assert.deepEqual(f.app.config.snapshot().doNotDisturb, quiet({enabled: true, days: [1, 3, 5], start: '23:15', end: '06:45'}));
  await f.app.config.update(config => {delete config.doNotDisturb;});
  await f.restart();
  assert.deepEqual(f.app.config.snapshot().doNotDisturb, defaultDoNotDisturb, 'Older installations gain disabled defaults.');
});

test('scheduled TV steps are consumed and skipped; manual Run, Rerun and direct controls remain available', async t => {
  const f = await fixture(t);
  const now = new Date(), minute = scheduleMinute(now);
  const start = {id: 'schedule', type: 'schedule', name: 'Schedule', enabled: true, days: [minute.day], time: minute.time};
  assert.equal((await f.call('/api/tasks', definition([start]))).status, 200);
  await f.setQuiet({enabled: true});
  await f.app.engine.tick(now); await f.settle();
  const run = f.app.state.snapshot().runs[0];
  assert.equal(run.automatic, true);
  assert.equal(run.status, 'completed');
  assert.equal((await f.effects()).length, 0);
  assert.ok(f.app.activity.latest(100).some(entry => /Do not disturb.*skipped/.test(entry.message)));
  assert.ok(f.app.activity.latest(100).some(entry => entry.message === 'Non-TV step still runs'));
  const task = f.app.tasks.snapshot()[0];
  assert.equal((await f.call(`/api/tasks/${task.id}/run`, {revision: task.revision})).status, 202);
  await f.settle();
  assert.equal(f.app.state.snapshot().runs[0].automatic, false);
  assert.equal((await f.call(`/api/runs/${run.id}/rerun`, {revision: task.revision})).status, 202);
  await f.settle();
  await f.app.registry.execute('samsung-tv', 'key', {key: 'KEY_POWER'});
  assert.equal((await f.effects()).length, 3);
  await f.setQuiet({enabled: false});
  await f.app.engine.tick(now); await f.settle();
  assert.equal((await f.effects()).length, 3, 'Turning quiet hours off does not replay the claimed minute.');
});

test('Event true-edge claims remain consumed and other Task steps continue', async t => {
  const f = await fixture(t);
  const event = f.app.registry.events().find(event => event.eventId === 'status-updated');
  const rule = {id: 'event', type: 'event', name: 'Event', enabled: true, eventId: event.id,
    condition: {field: 'volume', operator: 'gt', value: 10}};
  assert.equal((await f.call('/api/tasks', definition([rule]))).status, 200);
  await f.setQuiet({enabled: true});
  await f.app.engine.emitPluginEvent('samsung-tv', 'status-updated', {volume: 20}); await f.settle();
  assert.equal((await f.effects()).length, 0);
  await f.setQuiet({enabled: false});
  await f.app.engine.emitPluginEvent('samsung-tv', 'status-updated', {volume: 20}); await f.settle();
  assert.equal((await f.effects()).length, 0, 'Unchanged true condition cannot replay after quiet hours.');
  await f.app.engine.emitPluginEvent('samsung-tv', 'status-updated', {volume: 0});
  await f.app.engine.emitPluginEvent('samsung-tv', 'status-updated', {volume: 20}); await f.settle();
  assert.equal((await f.effects()).length, 1);
});

test('quiet hours recheck after Task delays, queued actions and worker stages; refresh is unaffected', async t => {
  const f = await fixture(t);
  const steps = [{id: 'delay', type: 'delay', seconds: 0.15, enabled: true}, ...definition().steps];
  assert.equal((await f.call('/api/tasks', definition([], steps))).status, 200);
  const task = f.app.tasks.snapshot()[0];
  await f.app.engine.start(task.id, 'Synthetic automatic', null, {automatic: true});
  await waitFor(() => f.app.activity.latest(100).some(entry => /Delay/.test(entry.message)));
  await f.setQuiet({enabled: true}); await f.settle();
  assert.equal((await f.effects()).length, 0);
  await f.setQuiet({enabled: false});
  const record = f.app.registry.get('samsung-tv');
  let release;
  record.actionQueue = new Promise(resolve => {release = resolve;});
  const pending = f.app.registry.execute('samsung-tv', 'key', {key: 'KEY_POWER'}, {automatic: true});
  const rejected = assert.rejects(pending, {code: 'TV_DO_NOT_DISTURB'});
  await f.setQuiet({enabled: true}); release(); await rejected;
  assert.equal((await f.effects()).length, 0);
  await f.setQuiet({enabled: false});
  const staged = f.app.registry.execute('samsung-tv', 'send-text', {text: 'Test'}, {automatic: true});
  const stageRejected = assert.rejects(staged, {code: 'TV_DO_NOT_DISTURB'});
  await waitFor(() => f.app.activity.latest(100).some(entry => entry.message === 'Synthetic TV stage entered'));
  await f.setQuiet({enabled: true}); await stageRejected;
  assert.equal((await f.effects()).length, 0);
  for (const actionId of ['show-notice', 'play-youtube', 'wake']) {
    assert.throws(() => f.app.registry.execute('samsung-tv', actionId, {}, {automatic: true}), {code: 'TV_DO_NOT_DISTURB'});
  }
  assert.equal(f.app.registry.notices.admin().active, false, 'No notice was reserved by an inhibited action.');
  await f.app.registry.execute('samsung-tv', 'refresh', {}, {automatic: true});
  assert.deepEqual((await f.effects()).map(item => item.actionId), ['refresh']);
});
