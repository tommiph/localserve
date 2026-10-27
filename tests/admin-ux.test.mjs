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

test('service guidance explains configuration, pause, recovery and failed reads without claiming device success', () => {
  const ready={health:'ready',enabled:true,configurationReady:true};
  assert.match(ux.nextStep({...ready,configurationReady:false}),/required fields/);
  assert.match(ux.nextStep({...ready,enabled:false}),/Enable/);
  assert.match(ux.nextStep(ready,true),/Resume/);
  assert.match(ux.nextStep({...ready,runtimeRecovery:{status:'pending'}}),/not replayed/);
  assert.match(ux.nextStep({...ready,health:'error'}),/Log and Settings/);
  assert.match(ux.nextStep({...ready,pollObservation:{status:'failed'}}),/Check the device or provider/);
  assert.match(ux.nextStep({...ready,gatewayConnection:{status:'unreachable'}}),/Check the device or provider/);
  assert.match(ux.nextStep({...ready,gatewayConnection:{status:'checking'}}),/Wait/);
  assert.match(ux.nextStep(ready),/Review the latest readings/);
});

async function setupFixture() {
  const effects=[],pages=[];
  const state={services:[{id:'source',name:'<Weather>',icon:'cloud',enabled:false,configurationReady:false,health:'ready',cards:[],cardData:{readyMade:{templates:[{}]}}}],tasks:[],vistas:[],server:{},paused:false};
  const context=vm.createContext({state,crypto:{randomUUID:()=> 'draft-step'},
    escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
    icon:name=>`<i>${name}</i>`,statusPill:label=>label,dialogHeader:label=>`<h1>${label}</h1>`,
    showDialog:html=>pages.push(html),closeDialog:()=>effects.push('close'),renderView:()=>effects.push('render'),
    workspace:{focus:()=>effects.push('focus')},currentView:'overview',PluginUI:{tabs:new Map()},
    TaskUI:{openEditor:(...args)=>effects.push({editor:'task',args})},VistaUI:{openEditor:()=>effects.push({editor:'vista'})},
  });
  const setup=vm.runInContext(await fs.readFile(new URL('../web/admin-ux.js',import.meta.url),'utf8')+'\nSetupUI;',context);
  return {setup,state,context,effects,pages};
}

test('setup guide offers service, Task, display and Controller paths without enabling or saving anything', async () => {
  const f=await setupFixture(),before=JSON.stringify(f.state);
  f.setup.open();assert.match(f.pages.at(-1),/Create a first Task/);assert.match(f.pages.at(-1),/0 configured and enabled services/);
  f.setup.open('device');assert.match(f.pages.at(-1),/&lt;Weather&gt;/,'Data providers remain selectable without a remote-control declaration');
  f.setup.open('device','source');assert.match(f.pages.at(-1),/required fields/);
  f.setup.handle('setup-back');assert.match(f.pages.at(-1),/Choose a service/);
  f.setup.open('display');assert.match(f.pages.at(-1),/Add ready-made card/);assert.match(f.pages.at(-1),/No data/);
  f.setup.open('phone');assert.match(f.pages.at(-1),/six-character approval code/);assert.match(f.pages.at(-1),/setup-network/);assert.doesNotMatch(f.pages.at(-1),/JSON|\/sensors/);
  f.state.server.lanAddress='http://192.168.50.10:7041';f.setup.open('phone');assert.doesNotMatch(f.pages.at(-1),/data-action="setup-network"/);
  delete f.state.server.lanAddress;assert.equal(JSON.stringify(f.state),before);assert.deepEqual(f.effects,[]);
});

test('first Task setup opens only a disabled unsaved manual draft; handoffs select the ordinary editors', async () => {
  const f=await setupFixture();f.setup.handle('setup-first-task');
  const draft=f.effects.find(effect=>effect.editor==='task');assert.ok(draft);assert.equal(draft.args[0],null);assert.equal(draft.args[1],false);
  assert.equal(draft.args[2].enabled,false);assert.equal(draft.args[2].starts.length,0);assert.equal(draft.args[2].steps[0].type,'log');
  assert.equal(f.state.tasks.length,0);assert.equal(f.state.services[0].enabled,false);
  f.setup.handle('setup-phone');assert.equal(f.context.currentView,'phone-home');
  f.setup.handle('setup-tasks');assert.equal(f.context.currentView,'tasks');
  f.setup.handle('setup-downloads');assert.equal(f.context.currentView,'downloads');
  f.setup.handle('setup-open-cards','source');assert.equal(f.context.currentView,'source');assert.equal(f.context.PluginUI.tabs.get('source'),'cards');
  f.setup.handle('setup-open-plugin','missing');assert.equal(f.context.currentView,'source');
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
