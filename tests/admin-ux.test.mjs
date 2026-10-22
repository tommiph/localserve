/** Administrator labels and execution evidence. All runtime checks use a
 * disposable Simulator; no installed settings, provider or device is touched. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createLocalserve} from '../server.mjs';

const ux = vm.runInNewContext(await fs.readFile(new URL('../web/admin-ux.js', import.meta.url), 'utf8') + '\nAdminUX;');

test('Card availability separates saved enablement, plugin configuration and data source availability', () => {
  const service={enabled:true,configurationReady:true,cardData:{readyMade:{sources:[{id:'one',enabled:true}]}}};
  const card={enabled:true,layout:'readymade',sourceId:'one'};
  assert.equal(ux.cardAvailability(service,card),'');
  assert.equal(ux.cardAvailability({...service,enabled:false},card),'Plugin disabled');
  assert.equal(ux.cardAvailability({...service,configurationReady:false},card),'Plugin needs configuration');
  assert.equal(ux.cardAvailability(service,{...card,sourceId:'missing'}),'Data source unavailable');
  service.cardData.readyMade.sources[0].enabled=false;
  assert.equal(ux.cardAvailability(service,card),'Data source disabled');
  assert.equal(ux.cardAvailability(service,{...card,enabled:false}),'Card disabled');
});

test('readiness, enablement and check failure are separate states', () => {
  const ready = {health: 'ready', configurationReady: true, enabled: true};
  assert.equal(ux.serviceStatus(ready).label, 'Ready');
  assert.equal(ux.serviceStatus({...ready, enabled: false}).label, 'Disabled');
  assert.equal(ux.serviceStatus({...ready, enabled: false, configurationReady: false}).label, 'Configure');
  assert.equal(ux.serviceStatus(ready, true).label, 'Paused');
  assert.equal(ux.serviceStatus({...ready, health: 'error'}).label, 'Runtime error');
  assert.equal(ux.serviceStatus({...ready, pollObservation: {status: 'failed'}}).label, 'Ready');
});

test('reception uses declared reported timestamps, including zero, never Event/clock/publication time', () => {
  const service = {cardFields: [
    {id: 'received', source: {kind: 'state'}}, {id: 'clock', source: {kind: 'clock'}},
    {id: 'event', source: {kind: 'event-time'}}, {id: 'published', source: {kind: 'state'}},
  ], cardCatalog: [
    {id: 'one:received', label: 'One · Reception', type: 'timestamp'},
    {id: 'clock', label: 'Reception clock', type: 'timestamp'},
    {id: 'event', label: 'Last received Event', type: 'timestamp'},
    {id: 'published', label: 'Published', type: 'timestamp'},
  ], cardData: {values: Object.fromEntries(['one:received', 'clock', 'event', 'published'].map(id => [id, {available: true, value: id === 'one:received' ? 0 : 9999}]))}};
  assert.equal(ux.reception(service).value.value, 0);
  service.cardData.values['one:received'].available = false;
  assert.equal(ux.reception(service), null);
});

test('activation summaries distinguish disabled rules from a manual-only Task', () => {
  const task = {enabled: true, starts: [{enabled: false}], steps: [{enabled: true}, {enabled: false}]};
  assert.match(ux.taskActivation(task), /Automatic rules disabled · 0\/1 rules · 1\/2 steps/);
  assert.match(ux.taskActivation({...task, starts: []}), /Manual only/);
  assert.match(ux.taskActivation({...task, enabled: false}), /Task disabled/);
  assert.match(ux.taskActivation(task, true), /Server paused/);
  for (const route of ['api/config', 'api/plugins/simulator/config', 'api/tasks', 'api/tasks/one/enabled', 'api/vistas/one', 'api/plugins/simulator/cards/one']) assert.equal(ux.savesDefinition(route), true, route);
  for (const route of ['api/tasks/one/run', 'api/runs/one/rerun', 'api/plugins/tv/actions/off', 'api/state']) assert.equal(ux.savesDefinition(route), false, route);
});

test('a failed check retains runtime readiness, non-poll actions do not replace it, and configuration resets it', async t => {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url));
  await fs.mkdir(base, {recursive: true});
  const root = await fs.mkdtemp(path.join(base, 'admin-ux-'));
  const folder = path.join(root, 'plugins/simulator');
  await fs.mkdir(path.join(folder, 'server'), {recursive: true});
  const declaration = JSON.parse(await fs.readFile(new URL('../plugins/simulator/declaration.json', import.meta.url)));
  declaration.settings.push({id: 'poll-minutes', label: 'Poll interval', type: 'number', min: 1, max: 60, default: 60});
  declaration.polling = {actionId: 'pulse', intervalSetting: 'poll-minutes'};
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(declaration));
  await fs.copyFile(new URL('../plugins/simulator/server/index.mjs', import.meta.url), path.join(folder, 'server/index.mjs'));
  const app = await createLocalserve(root, {automatic: false});
  t.after(async () => { await app.close(); await fs.rm(root, {recursive: true, force: true}); });
  await fs.mkdir(path.join(root, 'web'));
  for (const name of ['admin-ux.js','variables-ui.js']) {
    await fs.copyFile(new URL('../web/'+name, import.meta.url), path.join(root, 'web',name));
    assert.equal((await fetch(app.origin + '/'+name)).status, 200);
  }
  const service = () => app.registry.services()[0];
  await app.registry.saveConfiguration('simulator', {revision: service().config.revision, enabled: true});
  await app.registry.execute('simulator', 'pulse', {});
  assert.equal(service().pollObservation.status, 'completed');
  assert.ok(service().pollObservation.finishedAt >= service().pollObservation.attemptedAt);
  const record = app.registry.records.get('simulator'), request = record.runtime.request;
  record.runtime.request = async () => { throw Error('Fixture read failed'); };
  await assert.rejects(app.registry.execute('simulator', 'pulse', {}), /Fixture read failed/);
  record.runtime.request = request;
  const failure = service().pollObservation;
  assert.equal(failure.status, 'failed'); assert.equal(service().health, 'ready');
  await app.registry.execute('simulator', 'log', {message: 'A delivered command is not reception', level: 'info'});
  assert.deepEqual(service().pollObservation, failure);
  await app.registry.saveConfiguration('simulator', {revision: service().config.revision, enabled: false});
  assert.equal(service().pollObservation, null);
});
