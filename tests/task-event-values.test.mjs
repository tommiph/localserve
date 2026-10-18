import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTaskParameters, resolveTaskParameters } from '../server/task-event-values.mjs';
import { TaskEngine, validateTask } from '../server/tasks.mjs';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const action = { parameters: [
  { id: 'id', type: 'string', required: true, maxLength: 128 },
  { id: 'mode', type: 'string', enum: ['DEEP_LINK'], default: 'DEEP_LINK' },
  { id: 'arguments', type: 'string', maxLength: 2048, default: '' },
] };
const events = [{ id: 'release:chosen', pluginId: 'youtube', eventId: 'video-released',
  instanceId: 'chosen', instanceKey: 'source-id', payload: [
    { id: 'source-id', type: 'string' }, { id: 'url', type: 'string' },
    { id: 'title', type: 'string' }, { id: 'count', type: 'number' },
    { id: 'private', type: 'string', format: 'secret' },
  ] }];
const starts = [{ type: 'event', eventId: 'release:chosen' }];
const parameters = { id: '111299001912', arguments: '{{event.url}}' };
const event = { pluginId: 'youtube', eventId: 'video-released', payload: {
  'source-id': 'chosen', url: 'https://www.youtube.com/watch?v=newvideo001', title: '{{event.private}}', count: 0,
} };

async function editorFixture() {
  const context = vm.createContext({
    state: {taskEvents: [{...events[0], name: 'Video released', pluginName: 'YouTube'}]},
    actionCatalog: [{...action, id: 'plugin:samsung-tv:launch-app'}],
    dialog: {querySelector: () => null}, document: {addEventListener() {}},
    escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;'),
  });
  vm.runInContext(await readFile(new URL('../web/plugin-ui.js', import.meta.url), 'utf8'), context);
  return vm.runInContext(await readFile(new URL('../web/tasks-ui.js', import.meta.url), 'utf8') + '\nTaskUI;', context);
}

test('action type input/change reads the rendered fields until replacement', async () => {
  const editor = await editorFixture();
  // The native select already says Launch app, but only Delay's fields exist.
  // Both the preceding input summary and changeType must still read Delay.
  const controls = {blockId: 'step', blockType: 'plugin:samsung-tv:launch-app', blockEnabled: 'true', seconds: '3'};
  const card = {dataset: {group: 'step', blockType: 'delay'}, querySelector: selector => {
    const name = selector.match(/name="([^"]+)"/)?.[1];
    return name in controls ? {value: controls[name]} : null;
  }};
  assert.equal(editor.readCard(card).type, 'delay');
  assert.equal(editor.readCard(card).seconds, 3);
});

test('event value picker uses declared draft rules and public scalar payload fields', async () => {
  const editor = await editorFixture();
  editor.editorStarts = [{type: 'event', enabled: true, eventId: events[0].id}];
  const options = editor.eventValueOptions();
  assert.match(options, /Video released/);
  assert.match(options, /value="title"/);
  assert.match(options, /value="count"/);
  assert.doesNotMatch(options, /private/);
  editor.editorStarts[0].enabled = false;
  assert.match(editor.eventValueOptions(), /value="title"/,'Disabled starts can be tested with saved Event values.');
});

test('templates allow declared scalars, retain literals, and apply current action limits', () => {
  const saved = validateTaskParameters(action, parameters, starts, events);
  assert.equal(saved.mode, 'DEEP_LINK');
  assert.equal(resolveTaskParameters(action, saved, event, events).arguments, event.payload.url);
  const composite = { ...parameters, arguments: '{{event.title}} / {{event.count}}' };
  assert.equal(resolveTaskParameters(action, composite, event, events).arguments, '{{event.private}} / 0');
  assert.throws(() => resolveTaskParameters(action, saved, { ...event, payload: { ...event.payload, url: 'x'.repeat(2049) } }, events), /valid/);
  assert.throws(() => resolveTaskParameters(action, saved, { ...event, payload: { ...event.payload, url: 42 } }, events), /triggering event/);
});

test('missing, private, malformed and enum bindings cannot reach an action', () => {
  for (const argumentsValue of ['{{event.private}}', '{{event.undeclared}}', '{{event.url.toString()}}', '{{other.url}}']) {
    assert.throws(() => validateTaskParameters(action, { ...parameters, arguments: argumentsValue }, starts, events));
  }
  assert.throws(() => validateTaskParameters(action, { ...parameters, mode: '{{event.title}}' }, starts, events));
  assert.throws(() => validateTaskParameters(action, parameters, [], events));
  assert.throws(() => resolveTaskParameters(action, parameters, null, events), /triggering event/);
  assert.throws(() => resolveTaskParameters(action, parameters, event, []), /triggering event/);
  assert.throws(() => resolveTaskParameters(action, parameters, { ...event, payload: { ...event.payload, 'source-id': 'other' } }, events));
  const retained = validateTaskParameters(action, parameters, starts, [], parameters);
  assert.equal(retained.arguments, '{{event.url}}');
  assert.throws(() => validateTaskParameters(action, { ...parameters, arguments: 'changed {{event.url}}' }, starts, [], parameters));
});

test('Task preflight prevents earlier effects and admission captures payload before writes and delays', async () => {
  const capability = { ...action, id: 'plugin:samsung-tv:launch-app', pluginId: 'samsung-tv', actionId: 'launch-app', available: true };
  const task = validateTask({ name: 'Captured upload', enabled: true, starts: [
    { id: 'event', type: 'event', name: 'Event', enabled: true, eventId: events[0].id },
  ], steps: [
    { id: 'early', type: 'log', enabled: true, message: 'Starting' },
    { id: 'delay', type: 'delay', enabled: true, seconds: 0.03 },
    { id: 'tv', type: 'plugin', enabled: true, capabilityId: capability.id, parameters },
  ] }, null, [capability], events);
  let saved = { paused: false, runs: [] }; const effects = [], logs = [];
  const engine = new TaskEngine({ snapshot: () => [task] }, {
    snapshot: () => structuredClone(saved),
    update: async update => { await new Promise(resolve => setTimeout(resolve, 5)); update(saved); },
  }, { snapshot: () => ({ maxConcurrentRuns: 4 }) }, {
    actions: () => [capability], events: () => events,
    execute: async (_plugin, _action, values) => effects.push(values),
  }, { add: async text => logs.push(text) });
  await assert.rejects(engine.start(task.id), /triggering event/);
  assert.equal(saved.runs.length, 0); assert.equal(logs.length, 0); assert.equal(effects.length, 0);
  const incoming = structuredClone(event);
  const admitted = engine.start(task.id, 'New upload', incoming);
  incoming.payload.url = 'https://www.youtube.com/watch?v=othervid001';
  const run = await admitted;
  assert.ok(Object.isFrozen(run.event.payload));
  const deadline = Date.now() + 2000;
  while (engine.active.size || engine.pending.size) {
    if (Date.now() > deadline) throw new Error('Task did not finish');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(saved.runs[0].status, 'completed');
  assert.deepEqual(effects.map(values => values.arguments), [event.payload.url]);
});

test('failed Task history keeps the action error beside its status', async () => {
  const task=validateTask({name:'Failure details',enabled:true,starts:[],steps:[
    {id:'vista',type:'show-vista',enabled:true,vistaId:'target'},
  ]},null,[],[],[{id:'target',enabled:true}]);
  const saved={runs:[]};
  const engine=new TaskEngine({snapshot:()=>[task]}, {
    snapshot:()=>structuredClone(saved),update:async change=>change(saved),
  },{snapshot:()=>({maxConcurrentRuns:4})},{actions:()=>[],events:()=>[]},{add:async()=>{}});
  engine.vistas = {
    snapshot:()=>[{id:'target',enabled:true}],show:async()=>{throw new Error('Target became unavailable.');},
  };
  await engine.start(task.id);
  const deadline=Date.now()+2000;
  while(engine.active.size||engine.pending.size){
    if(Date.now()>deadline)throw new Error('Run did not settle');
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal(saved.runs[0].status,'failed');
  assert.equal(saved.runs[0].error,'Target became unavailable.');
});
