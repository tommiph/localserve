/** Tests create only temporary Localserve roots inside tests/.tmp.
 * No installed plugins, device services, or unrelated endpoints are contacted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { createLocalserve, defaultConfig } from '../server.mjs';
import { JsonStore } from '../server/storage.mjs';
import { scheduleMinute } from '../server/tasks.mjs';
import { solarOccurrence, validateRule, eventConditionMatches } from '../server/rules.mjs';

const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
const sleep = milliseconds => new Promise(resolve=>setTimeout(resolve,milliseconds));
async function waitFor(check) {
  // Functional completion includes durable admission and per-step receipts.
  // Allow slow Windows fsyncs; this is not a sub-four-second latency contract.
  const deadline=Date.now()+15000;
  while (!(await check())) { if (Date.now()>deadline) throw new Error('Test timed out'); await sleep(10); }
}
async function fixture(t, configuration = defaultConfig) {
  await fs.mkdir(temporaryRoot,{recursive:true});
  const root=await fs.mkdtemp(path.join(temporaryRoot,'case-'));
  await fs.writeFile(path.join(root,'config.json'),JSON.stringify(configuration));
  const application=await createLocalserve(root,{automatic:false});
  t.after(async()=>{
    await application.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(temporaryRoot)+path.sep));
    await fs.rm(root,{recursive:true,force:true});
  });
  const call=async(endpoint,values,headers={})=>{
    const response=await fetch(application.origin+endpoint,values===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',Origin:application.origin,'X-Localserve-Token':application.snapshot().token,...headers},body:JSON.stringify(values)});
    return {status:response.status,body:await response.json()};
  };
  return {...application,root,call};
}
function task(name='Test',seconds=0.1) {
  return {name,enabled:true,starts:[],steps:[
    {id:'first',type:'log',enabled:true,message:'First message'},
    {id:'delay',type:'delay',enabled:true,seconds},
    {id:'last',type:'log',enabled:true,message:'Last message'},
  ]};
}

test('Contains text validates bounded string searches and matches literal text without case sensitivity', () => {
  const fields = [
    { id: 'title', label: 'Video title', type: 'string', maxLength: 100 },
    { id: 'status', label: 'Status', type: 'string', enum: ['Playing', 'Idle'], pattern: '^[A-Z][a-z]+$' },
    { id: 'count', type: 'number' },
    { id: 'active', type: 'boolean' },
  ];
  const events = [{ id: 'upload', payload: fields }];
  const rule = { id: 'filter', name: 'Event', type: 'event', enabled: true, eventId: 'upload',
    condition: { field: 'title', operator: 'contains', value: ' tesla ' } };
  const condition = validateRule(rule, events).condition;
  assert.equal(condition.value, 'tesla');
  for (const title of ['Tesla announces a car', 'New TESLA update', 'About tesla today']) {
    assert.equal(eventConditionMatches(condition, { title }), true);
  }
  assert.equal(eventConditionMatches(condition, { title: 'Train updates' }), false);
  assert.equal(eventConditionMatches(condition, { title: '' }), false);
  assert.equal(eventConditionMatches(condition, {}), null, 'Missing text does not rearm');
  assert.equal(eventConditionMatches(condition, { title: 123 }), null);
  assert.equal(eventConditionMatches({ ...condition, value: '.*' }, { title: 'Tesla' }), false);
  assert.equal(eventConditionMatches({ ...condition, value: '.*' }, { title: 'Text .* literally' }), true);
  assert.equal(eventConditionMatches({ ...condition, value: 'sää' }, { title: 'SÄÄ tänään' }), true);
  for (const value of ['', '   ', 'x'.repeat(101), true, 12]) {
    assert.throws(() => validateRule({ ...rule, condition: { ...rule.condition, value } }, events));
  }
  for (const field of ['count', 'active']) {
    assert.throws(() => validateRule({ ...rule, condition: { field, operator: 'contains', value: '1' } }, events), /valid comparison/);
  }
  const partialEnum = validateRule({ ...rule, condition: { field: 'status', operator: 'contains', value: 'play' } }, events);
  assert.equal(eventConditionMatches(partialEnum.condition, { status: 'Playing' }), true);
  assert.throws(() => validateRule({ ...rule, condition: { field: 'status', operator: 'eq', value: 'play' } }, events));
});

test('Task editor offers Contains text only for text fields and retains its saved selection', async () => {
  const sandbox = { state: { taskEvents: [{ id: 'upload', occurrenceKey: 'release-id', payload: [
    { id: 'title', label: 'Video title', type: 'string' },
    { id: 'count', label: 'Count', type: 'number' },
    { id: 'active', label: 'Active', type: 'boolean' },
  ] }] }, document: { addEventListener() {} }, crypto: { randomUUID: () => 'test-field' }, escapeHtml: value => String(value ?? ''), icon: () => '' };
  vm.createContext(sandbox);
  vm.runInContext(await fs.readFile(new URL('../web/tasks-ui.js', import.meta.url), 'utf8'), sandbox);
  sandbox.rule = { eventId: 'upload', condition: { field: 'title', operator: 'contains', value: 'tesla' } };
  const html = vm.runInContext('TaskUI.eventConditionFields(rule)', sandbox);
  assert.match(html, /value="contains" selected>Contains text/);
  assert.match(html, /value="tesla"/);
  assert.match(html, /ignores letter case/);
  assert.match(html, /distinct matching occurrence/);
  for (const field of ['count', 'active']) {
    sandbox.rule.condition = { field, operator: 'eq', value: field === 'count' ? 1 : true };
    assert.doesNotMatch(vm.runInContext('TaskUI.eventConditionFields(rule)', sandbox), /Contains text/);
  }
});

test('Contains text keeps reading edges and distinct upload claims through saves and restart', async t => {
  const app = await fixture(t);
  const folder = path.join(app.root, 'plugins', 'text-source');
  await fs.mkdir(folder);
  const title = { id: 'title', label: 'Video title', type: 'string', maxLength: 100 };
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify({ id: 'text-source', name: 'Text source', events: [
    { id: 'reading', name: 'Reading', payload: [title] },
    { id: 'upload', name: 'Upload', occurrenceKey: 'release-id', payload: [title, { id: 'release-id', type: 'string', required: true }] },
  ] }));
  await app.registry.discover();
  await app.registry.saveConfiguration('text-source', { revision: 1, enabled: true });
  function readyProducer(application) {
    // Only this disposable metadata fixture bypasses readiness. Installed
    // adapters and live device actions are never used to exercise these rules.
    const services = application.registry.services.bind(application.registry);
    application.registry.services = () => services().map(service => ({ ...service, configurationReady: true }));
  }
  readyProducer(app);
  for (const eventId of ['reading', 'upload']) {
    const definition = { ...task(eventId, 0.01), starts: [{ id: 'filter', name: 'Event', type: 'event', enabled: true,
      eventId: `plugin:text-source:event:${eventId}`, condition: { field: 'title', operator: 'contains', value: 'tesla' } }] };
    assert.equal((await app.call('/api/tasks', definition)).status, 200);
  }
  async function emit(application, eventId, payload) {
    await application.engine.emitPluginEvent('text-source', eventId, payload);
    await waitFor(() => !application.engine.active.size && !application.engine.pending.size);
  }
  const runs = (application, name) => application.state.snapshot().runs.filter(run => run.name === name).length;
  await emit(app, 'reading', { title: 'Tesla update' });
  await emit(app, 'reading', {});
  await emit(app, 'reading', { title: 'TESLA again' });
  assert.equal(runs(app, 'reading'), 1, 'Missing/repeated true readings do not rearm');
  await emit(app, 'reading', { title: 'Weather update' });
  await emit(app, 'reading', { title: 'New Tesla' });
  assert.equal(runs(app, 'reading'), 2);
  await emit(app, 'upload', { title: 'TESLA first', 'release-id': 'one' });
  await emit(app, 'upload', { title: 'TESLA first', 'release-id': 'one' });
  await emit(app, 'upload', { title: 'Tesla second', 'release-id': 'two' });
  assert.equal(runs(app, 'upload'), 2, 'Consecutive distinct matching uploads each trigger');
  const saved = app.tasks.snapshot().find(item => item.name === 'upload');
  assert.equal((await app.call(`/api/tasks/${saved.id}`, { ...saved, steps: [{ id: 'log', type: 'log', enabled: true, message: 'Updated log' }] })).status, 200);
  await emit(app, 'upload', { title: 'Tesla second', 'release-id': 'two' });
  assert.equal(runs(app, 'upload'), 2, 'An unrelated save retains the claim');
  await app.close();
  const restarted = await createLocalserve(app.root, { automatic: false });
  try {
    readyProducer(restarted);
    await emit(restarted, 'upload', { title: 'Tesla second', 'release-id': 'two' });
    assert.equal(runs(restarted, 'upload'), 2, 'Restart does not replay a matched upload');
    await emit(restarted, 'upload', { title: 'Other subject', 'release-id': 'three' });
    assert.equal(runs(restarted, 'upload'), 2);
    await emit(restarted, 'upload', { title: 'Tesla fourth', 'release-id': 'four' });
    assert.equal(runs(restarted, 'upload'), 3);
  } finally { await restarted.close(); }
});

test('empty install, API boundaries, configuration persistence, and stale edits',async t=>{
  // An unsupported timezone override is removed without resetting preferences.
  const legacyConfig = { ...defaultConfig, timezone: 'Pacific/Honolulu', fontScale: 110 };
  delete legacyConfig.timeFormat;
  delete legacyConfig.location;
  delete legacyConfig.vistaFontScale;
  delete legacyConfig.displayTheme;
  const app=await fixture(t, legacyConfig);
  assert.equal(app.config.snapshot().timeFormat, '24', 'Existing installations default to 24-hour');
  assert.equal(app.config.snapshot().location, null, 'Existing installations do not guess a location');
  assert.equal(Object.hasOwn(app.config.snapshot(), 'timezone'), false);
  assert.equal(app.config.snapshot().fontScale, 110);
  assert.equal(app.config.snapshot().vistaFontScale, 110, 'Migration preserves Vista appearance independently');
  assert.equal(app.config.snapshot().displayTheme, legacyConfig.theme, 'Existing displays retain their initial theme');
  assert.equal(app.snapshot().server.timeZone, new Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(app.snapshot().services.length,0);
  assert.deepEqual(app.snapshot().taskActions.map(action=>action.name),['Log activity','Delay','Show Vista']);
  assert.equal((await app.call('/api/config',{name:'Changed'},{Origin:'https://foreign.example'})).status,403);
  assert.equal((await app.call('/api/config',{name:'Changed'},{'X-Localserve-Token':'wrong'})).status,403);
  for (const endpoint of ['/config.json','/data/tasks.json','/server.mjs','/runtime/node.exe']) assert.equal((await app.call(endpoint)).status,404);
  assert.equal((await app.call('/api/config',{timezone:'Europe/Helsinki'})).status,400);
  assert.equal((await app.call('/api/config',{name:'Desk server',fontScale:120})).status,200);
  const persisted=JSON.parse(await fs.readFile(path.join(app.root,'config.json'),'utf8'));
  assert.equal(persisted.name,'Desk server');
  assert.equal(persisted.vistaFontScale, 110, 'Administrator sizing does not change Vista sizing');
  assert.equal((await app.call('/api/config',{theme:'light',fontScale:125})).status,200);
  assert.equal(app.config.snapshot().displayTheme,legacyConfig.theme,'Administrator theme cannot change display appearance');
  assert.equal((await app.call('/api/config',{displayTheme:'light',vistaFontScale:115})).status,200);
  assert.equal((await app.call('/api/config',{theme:'dark',fontScale:90})).status,200);
  for(const options of [app.controls.options(),app.vistas.displayViewer().options,app.universe.viewer().options]) {
    assert.equal(options.theme,'light');assert.equal(options.fontScale,115);
  }
  assert.equal((await app.call('/api/config',{displayTheme:'invalid'})).status,400);
  assert.equal(app.config.snapshot().displayTheme,'light');
  assert.equal(Object.hasOwn(persisted, 'timezone'), false);
  assert.equal((await app.call('/api/config', { timeFormat: '12' })).status, 200);
  assert.equal(JSON.parse(await fs.readFile(path.join(app.root, 'config.json'), 'utf8')).timeFormat, '12');
  assert.equal((await app.call('/api/config', { timeFormat: 'invalid' })).status, 400);
  assert.equal(app.config.snapshot().timeFormat, '12', 'Invalid preferences do not overwrite saved settings');
  assert.equal((await app.call('/api/tasks',{...task(),steps:[{id:'invalid',enabled:true,type:'delay',seconds:-1}]})).status,400);
  await app.call('/api/tasks',task());
  const saved=app.tasks.snapshot()[0];
  assert.equal((await app.call(`/api/tasks/${saved.id}`,{...saved,name:'Updated'})).status,200);
  assert.equal((await app.call(`/api/tasks/${saved.id}`,{...saved,name:'Stale'})).status,409);
  assert.equal(app.tasks.snapshot()[0].name,'Updated');
});

test('real ordered execution, nonblocking delays, pause/resume, cancellation and limits',async t=>{
  const app=await fixture(t);
  await app.call('/api/tasks',task('Pause test',0.3));
  const saved=app.tasks.snapshot()[0];
  const started=await app.call(`/api/tasks/${saved.id}/run`,{});
  assert.equal(started.status,202);
  await waitFor(()=>app.activity.latest().some(entry=>entry.message.includes('Delay 0.3')));
  assert.equal((await app.call('/api/state')).status,200,'HTTP stays responsive during a Delay');
  assert.equal((await app.call(`/api/tasks/${saved.id}/run`,{})).status,409,'A Task cannot overlap itself');
  await app.call('/api/pause',{paused:true});
  await sleep(400);
  assert.ok(!app.activity.latest().some(entry=>entry.message==='Last message'));
  assert.equal((await app.call(`/api/tasks/${saved.id}/run`,{})).status,409);
  await app.call('/api/pause',{paused:false});
  await waitFor(()=>app.state.snapshot().runs[0].status==='completed');
  const messages=app.activity.entries.filter(entry=>entry.runId===started.body.run.id).map(entry=>entry.message);
  assert.ok(messages.indexOf('First message')<messages.indexOf('Last message'));
  await waitFor(()=>!app.engine.active.size);
  await app.call('/api/config',{maxConcurrentRuns:1});
  const next=await app.call(`/api/tasks/${saved.id}/run`,{});
  await app.call('/api/tasks',task('Second task',1));
  assert.equal((await app.call(`/api/tasks/${app.tasks.snapshot()[1].id}/run`,{})).status,409);
  await app.call(`/api/runs/${next.body.run.id}/cancel`,{});
  await waitFor(()=>app.state.snapshot().runs[0].status==='cancelled');
});

test('system-timezone schedules and durable once-per-minute claims',async t=>{
  const app=await fixture(t);
  const date=new Date(2026,9,12,19,0);
  assert.deepEqual(scheduleMinute(date),{date:'2026-10-12',time:'19:00',day:1});
  // Isolated child processes exercise opposite local calendars for one instant.
  // TZ affects only each test process; no Windows timezone setting is changed.
  const moduleUrl = new URL('../server/tasks.mjs', import.meta.url).href;
  const script = `import { scheduleMinute } from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify(scheduleMinute(new Date('2026-10-12T00:30:00Z'))));`;
  const calendars = [
    { zone: 'America/New_York', expected: { date: '2026-10-11', time: '20:30', day: 0 } },
    { zone: 'Asia/Tokyo', expected: { date: '2026-10-12', time: '09:30', day: 1 } },
  ];
  for (const calendar of calendars) {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: calendar.zone }, encoding: 'utf8', windowsHide: true,
    });
    assert.deepEqual(JSON.parse(output), calendar.expected);
  }
  const scheduled=task('Schedule',0.01);
  scheduled.starts=[{id:'schedule',name:'Evening',type:'schedule',enabled:true,time:'19:00',days:[1]}];
  await app.call('/api/tasks',scheduled);
  await app.engine.tick(date); await app.engine.tick(date);
  assert.equal(app.state.snapshot().runs.length,1);
  await waitFor(()=>app.state.snapshot().runs[0].status==='completed');
  await app.engine.tick(date); assert.equal(app.state.snapshot().runs.length,1);
  const persisted=JSON.parse(await fs.readFile(path.join(app.root,'data/state.json'),'utf8'));
  assert.equal(persisted.claims.length,1);
  assert.equal(persisted.runs[0].status,'completed');
});

test('declaration discovery, rejected duplicates, removal, and metadata-only capabilities',async t=>{
  const app=await fixture(t);
  const invalid=path.join(app.root,'plugins','invalid'); await fs.mkdir(invalid);
  await fs.writeFile(path.join(invalid,'declaration.json'),JSON.stringify({name:'Missing identity'}));
  await app.registry.discover();
  assert.equal(app.registry.services().length,0); assert.equal(app.registry.errors.length,1);
  await fs.unlink(path.join(invalid,'declaration.json'));
  const folder=path.join(app.root,'plugins','example'); await fs.mkdir(folder);
  const declaration={id:'example',name:'Example',actions:[{id:'action',name:'Example action',parameters:[]}]};
  await fs.writeFile(path.join(folder,'declaration.json'),JSON.stringify(declaration));
  await app.registry.discover();
  assert.equal(app.registry.services()[0].name,'Example');
  assert.equal(app.registry.services()[0].configurationReady,false);
  assert.equal(app.registry.actions()[0].available,false);
  const duplicate=path.join(app.root,'plugins','duplicate'); await fs.mkdir(duplicate);
  await fs.writeFile(path.join(duplicate,'declaration.json'),JSON.stringify(declaration));
  await app.registry.discover(); assert.equal(app.registry.services().length,1); assert.equal(app.registry.errors.length,1);
  await fs.unlink(path.join(folder,'declaration.json')); await fs.unlink(path.join(duplicate,'declaration.json'));
  await app.registry.discover(); assert.equal(app.registry.services().length,0);
});

test('serialized writes preserve concurrent updates and unreadable data is retained',async t=>{
  const app=await fixture(t), file=path.join(app.root,'data','counter.json');
  const store=await new JsonStore(file,{count:0}).load();
  await Promise.all(Array.from({length:20},()=>store.update(value=>{value.count+=1;})));
  assert.equal(store.snapshot().count,20);
  await fs.writeFile(file,'{broken');
  await assert.rejects(new JsonStore(file,{count:0}).load());
  assert.equal(await fs.readFile(file,'utf8'),'{broken');
});

test('restart reloads persisted Tasks/settings/history and marks unfinished runs interrupted',async t=>{
  const app=await fixture(t);
  const location = { latitude: 60.1, longitude: 24.9 };
  await app.call('/api/config',{name:'Restart check',timeFormat:'12',location});
  await app.call('/api/tasks',task('Persistent Task'));
  await app.state.update(state=>{state.runs.push({id:'unfinished',taskId:'old',name:'Old run',status:'running',startedAt:Date.now()});});
  await app.close();
  const restarted=await createLocalserve(app.root,{automatic:false});
  try {
    assert.equal(restarted.config.snapshot().name,'Restart check');
    assert.equal(restarted.config.snapshot().timeFormat, '12');
    assert.deepEqual(restarted.config.snapshot().location, location);
    assert.equal(Object.hasOwn(restarted.config.snapshot(), 'timezone'), false);
    assert.equal(restarted.tasks.snapshot()[0].name,'Persistent Task');
    assert.equal(restarted.state.snapshot().runs[0].status,'interrupted');
    assert.equal(restarted.engine.active.size,0,'Interrupted Tasks are never replayed automatically');
    assert.ok(restarted.activity.latest().some(entry=>entry.message.includes('Task created')));
  } finally { await restarted.close(); }
});

test('one server per project folder; graceful stop releases its lock',async t=>{
  const app=await fixture(t);
  await assert.rejects(createLocalserve(app.root,{automatic:false}),/already running/);
  await app.close();
  await assert.rejects(fs.readFile(path.join(app.root,'data/server.lock')),{code:'ENOENT'});
});

test('Timer and Interval clocks arm, persist, rearm, and consume overdue starts once', async t => {
  const app = await fixture(t);
  const definition = task('Timer rule', 0.01);
  definition.starts = [{ id: 'clock', name: 'Countdown', type: 'timer', enabled: true, seconds: 1 }];
  await app.call('/api/tasks', definition);
  let saved = app.tasks.snapshot()[0];
  const key = `${saved.id}/clock`;
  const first = app.state.snapshot().ruleClocks[key];
  assert.ok(first.nextAt > Date.now());
  await app.call(`/api/tasks/${saved.id}`, { ...saved, name: 'Renamed timer' });
  assert.deepEqual(app.state.snapshot().ruleClocks[key], first, 'Unrelated edits retain the countdown');
  await app.engine.tick(new Date(first.nextAt - 1));
  assert.equal(app.state.snapshot().runs.length, 0);
  await app.engine.tick(new Date(first.nextAt));
  await waitFor(() => !app.engine.active.size);
  await app.engine.tick(new Date(first.nextAt + 10000));
  assert.equal(app.state.snapshot().runs.length, 1, 'Timer runs only once');
  await app.close();
  const restarted = await createLocalserve(app.root, { automatic: false });
  try {
    await restarted.engine.tick(new Date(first.nextAt + 20000));
    assert.equal(restarted.state.snapshot().runs.length, 1, 'Restart does not rearm a consumed Timer');
  } finally { await restarted.close(); }
});

test('Interval enablement and pause use persistent clocks without a catch-up burst', async t => {
  const app = await fixture(t);
  const definition = task('Interval rule', 0.01);
  definition.starts = [{ id: 'repeat', name: 'Repeat', type: 'interval', enabled: true, seconds: 1 }];
  await app.call('/api/tasks', definition);
  let saved = app.tasks.snapshot()[0];
  const key = `${saved.id}/repeat`;
  const first = app.state.snapshot().ruleClocks[key];
  await app.call('/api/pause', { paused: true });
  await app.engine.tick(new Date(first.nextAt + 10000));
  assert.equal(app.state.snapshot().runs.length, 0);
  await app.call('/api/pause', { paused: false });
  await app.engine.tick(new Date(first.nextAt + 10000));
  await waitFor(() => !app.engine.active.size);
  await app.engine.tick(new Date(first.nextAt + 10000));
  assert.equal(app.state.snapshot().runs.length, 1);
  assert.equal(app.state.snapshot().ruleClocks[key].nextAt, first.nextAt + 11000);
  await app.call(`/api/tasks/${saved.id}/enabled`, { revision: saved.revision, enabled: false });
  assert.equal(app.state.snapshot().ruleClocks[key], undefined);
  saved = app.tasks.snapshot()[0];
  await app.call(`/api/tasks/${saved.id}/enabled`, { revision: saved.revision, enabled: true });
  assert.notEqual(app.state.snapshot().ruleClocks[key].generation, first.generation);
});

test('solar rules use validated global location, calculate locally, deduplicate, and handle polar days', async t => {
  const app = await fixture(t);
  const date = new Date(2026, 2, 20, 12);
  const rule = { id: 'sun', name: 'Dawn', type: 'sunrise', enabled: true, days: [0, 1, 2, 3, 4, 5, 6] };
  const location = { latitude: 0, longitude: 0 };
  const rise = solarOccurrence(date, rule, location);
  const set = solarOccurrence(date, { ...rule, type: 'sunset' }, location);
  assert.ok(Number.isFinite(rise) && Number.isFinite(set));
  assert.ok(new Date(rise).getUTCHours() >= 5 && new Date(rise).getUTCHours() <= 7);
  assert.ok(new Date(set).getUTCHours() >= 17 && new Date(set).getUTCHours() <= 19);
  assert.equal(solarOccurrence(new Date(2026, 5, 21, 12), rule, { latitude: 89, longitude: 0 }), null);
  assert.equal(solarOccurrence(date, rule, null), null);
  // Unsupported per-rule coordinates are discarded, even when posted by a
  // client. No configured global location means no solar dispatch.
  const definition = { ...task('Solar rule', 0.01), starts: [{ ...rule, latitude: 91, longitude: 12 }] };
  assert.equal((await app.call('/api/tasks', definition)).status, 200);
  assert.equal(Object.hasOwn(app.tasks.snapshot()[0].starts[0], 'latitude'), false);
  assert.equal(Object.hasOwn(app.tasks.snapshot()[0].starts[0], 'longitude'), false);
  await app.engine.tick(new Date(rise));
  assert.equal(app.state.snapshot().runs.length, 0);
  for (const invalid of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: null, longitude: 0 }, { latitude: 0 }, { latitude: '0', longitude: 0 }, []]) {
    assert.equal((await app.call('/api/config', { location: invalid })).status, 400);
    assert.equal(app.config.snapshot().location, null);
  }
  assert.equal((await app.call('/api/config', { location })).status, 200);
  assert.deepEqual(app.config.snapshot().location, location);
  const shifted = solarOccurrence(date, rule, { latitude: 0, longitude: 30 });
  assert.ok(Math.abs(rise - shifted) > 60 * 60 * 1000, 'A changed global location recalculates the cached occurrence');
  await app.engine.tick(new Date(rise));
  await waitFor(() => !app.engine.active.size);
  await app.engine.tick(new Date(rise));
  assert.equal(app.state.snapshot().runs.length, 1);
  assert.equal(app.state.snapshot().runs[0].reason, 'Sunrise: Dawn');
  assert.equal((await app.call('/api/config', { location: null })).status, 200);
  await app.engine.tick(new Date(solarOccurrence(new Date(2026, 2, 21, 12), rule, location)));
  assert.equal(app.state.snapshot().runs.length, 1, 'Clearing location prevents future solar starts');
});

test('startup removes legacy per-rule locations without choosing a global location', async t => {
  const app = await fixture(t);
  await app.close();
  const legacy = { ...task('Legacy solar'), id: 'legacy', revision: 3, enabled: false,
    starts: [{ id: 'sun', name: 'Sunrise', type: 'sunrise', enabled: true, days: [1], latitude: 12, longitude: 34 }] };
  await fs.writeFile(path.join(app.root, 'data/tasks.json'), JSON.stringify([legacy]));
  const restarted = await createLocalserve(app.root, { automatic: false });
  try {
    assert.equal(restarted.config.snapshot().location, null);
    assert.equal(restarted.tasks.snapshot()[0].revision, 4);
    assert.equal(Object.hasOwn(restarted.tasks.snapshot()[0].starts[0], 'latitude'), false);
    const persisted = JSON.parse(await fs.readFile(path.join(app.root, 'data/tasks.json'), 'utf8'));
    assert.equal(Object.hasOwn(persisted[0].starts[0], 'longitude'), false);
  } finally { await restarted.close(); }
});

test('Event rules require declared, enabled, ready plugin producers', async t => {
  const app = await fixture(t);
  const folder = path.join(app.root, 'plugins', 'event-source');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify({
    id: 'event-source', name: 'Event source', events: [{ id: 'changed', name: 'Changed' }],
  }));
  await app.registry.discover();
  const capability = app.registry.events()[0];
  const definition = { ...task('Event rule', 0.01), starts: [{ id: 'event', name: 'Changed', enabled: true, type: 'event', eventId: capability.id }] };
  assert.equal((await app.call('/api/tasks', { ...definition, starts: [{ ...definition.starts[0], eventId: 'missing' }] })).status, 400);
  assert.equal((await app.call('/api/tasks', definition)).status, 200);
  await assert.rejects(app.engine.emitPluginEvent('event-source', 'changed'), /unavailable/);
  const producer = app.registry.services().find(service => service.id === 'event-source');
  assert.equal((await app.call('/api/plugins/event-source/enabled', { enabled: true, revision: producer.config.revision })).status, 200);
  await assert.rejects(app.engine.emitPluginEvent('event-source', 'changed'), /unavailable/);
  // A fixture-only ready adapter exercises the hook without importing a plugin
  // or contacting a device. Real installations still have no runtime adapters.
  const metadataServices = app.registry.services.bind(app.registry);
  app.registry.services = () => metadataServices().map(service => ({ ...service, configurationReady: true }));
  await app.engine.emitPluginEvent('event-source', 'changed');
  await waitFor(() => !app.engine.active.size);
  assert.equal(app.state.snapshot().runs.length, 1);
  await app.call('/api/pause', { paused: true });
  await app.engine.emitPluginEvent('event-source', 'changed');
  assert.equal(app.state.snapshot().runs.length, 1);
});

test('editable time parsing handles noon, midnight, arbitrary minutes, and quarter-hour choices', async () => {
  // Exercise the actual browser helper's pure functions without a browser or DOM.
  const source = await fs.readFile(new URL('../web/time-ui.js', import.meta.url), 'utf8');
  const times = vm.runInNewContext(source + '\nTimeUI;', { config: { timeFormat: '24' } });
  assert.equal(times.parse('12:00 AM'), '00:00');
  assert.equal(times.parse('12:00 PM'), '12:00');
  assert.equal(times.parse('7:07 pm'), '19:07');
  assert.equal(times.parse('09:23'), '09:23');
  assert.equal(times.parse('9am'), '09:00');
  for (const invalid of ['24:00', '12:60 PM', '0:15 AM', 'not a time']) assert.equal(times.parse(invalid), '');
  assert.equal(times.format('00:00', '12'), '12:00 AM');
  assert.equal(times.format('12:00', '12'), '12:00 PM');
  assert.equal(times.format('19:07', '12'), '7:07 PM');
  assert.equal(times.format('19:07', '24'), '19:07');
  const choices = Array.from(times.choices());
  assert.equal(choices.length, 96);
  assert.equal(new Set(choices).size, 96);
  assert.equal(choices[0], '00:00');
  assert.equal(choices[95], '23:45');
  assert.equal(choices[77], '19:15');
});

test('rule name intent survives normalization without resetting its execution clock', async t => {
  const app = await fixture(t);
  const automatic = { id: 'name', name: 'Timer', type: 'timer', seconds: 60, enabled: true };
  assert.equal(validateRule(automatic, []).nameEdited, false);
  assert.equal(validateRule({ ...automatic, name: 'Schedule' }, []).nameEdited, false);
  assert.equal(validateRule({ ...automatic, name: 'My timer' }, []).nameEdited, true);
  assert.equal(validateRule({ ...automatic, nameEdited: true }, []).nameEdited, true);
  assert.throws(() => validateRule({ ...automatic, nameEdited: 'yes' }, []), /edit state/);
  await app.call('/api/tasks', { ...task('Name intent'), starts: [automatic] });
  const saved = app.tasks.snapshot()[0];
  const key = `${saved.id}/name`;
  const clock = app.state.snapshot().ruleClocks[key];
  await app.call(`/api/tasks/${saved.id}`, { ...saved, starts: [{ ...saved.starts[0], nameEdited: true }] });
  const persisted = JSON.parse(await fs.readFile(path.join(app.root, 'data/tasks.json'), 'utf8'));
  assert.equal(persisted[0].starts[0].nameEdited, true);
  assert.deepEqual(app.state.snapshot().ruleClocks[key], clock, 'Editing the name does not rearm the Timer');
});
