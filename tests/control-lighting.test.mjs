/** Synthetic lighting readings and effects only. Never contact a gateway. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { ControlsStore, validateControlPage } from '../server/controls.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { publicReading } from '../plugins/tradfri/server/readings.mjs';

const raw = JSON.parse(await fs.readFile(new URL('../plugins/tradfri/declaration.json', import.meta.url)));
const plugin = { ...validateDeclaration(raw), folder: 'tradfri' };
test('shared action forms preserve absent optional white/RGB arguments and explicit zero', async () => {
  const source = await fs.readFile(new URL('../web/plugin-ui.js', import.meta.url),'utf8');
  const context = vm.createContext({ document: { addEventListener() {} } });
  vm.runInContext(source + ';globalThis.read = PluginUI.readFields;',context);
  const fields = plugin.actions.find(action => action.id === 'light-state').parameters;
  const values = { id: { value:'1' }, on:{type:'checkbox',checked:false}, brightness:{value:'0'}, temperature:{value:''},hue:{value:'0'},saturation:{value:'0'} };
  const actual = context.read(fields,{ elements:{ namedItem: name => values[name] } });
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),{id:'1',on:false,brightness:0,hue:0,saturation:0});
});
async function fixture(t) {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url));
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'lighting-'));
  await fs.mkdir(path.join(root, 'plugins/tradfri/data'), { recursive: true });
  const reading = { ...publicReading([
    { id: '1', name: '<White bulb>', room: 'Office', on: false, brightness: 35, reachable: true, spectrum: 'white', temperature: 60 },
    { id: '2', name: 'Colour bulb', room: 'Office', on: true, brightness: 70, reachable: true, spectrum: 'rgb', hue: 220, saturation: 83 },
    { id: '3', name: 'Offline', on: null, brightness: null, reachable: false, spectrum: null },
  ], [{ instanceId: 10, name: 'Office', onOff: true, dimmer: 40, deviceIDs: [1,2,3] }], Date.now()), 'gateway-host': '10.23.42.2' };
  const settings = { host: '10.23.42.2' };
  const record = { configured: true, health: 'ready', pending: 0,
    config: { snapshot: () => ({ revision: 1, enabled: true, settings }) },
    state: { snapshot: () => structuredClone(reading) }, log: { latest: () => [] } };
  const effects = [], gate = { paused: false, wait: async signal => signal.throwIfAborted() };
  let store;
  const registry = { plugins: [plugin], records: new Map([['tradfri',record]]), get: () => record,
    engine: { gate }, pollMilliseconds: () => 30000,
    assertReady: () => { if (!record.configured) throw new Error('Not ready'); },
    execute: async (id, actionId, parameters, context) => {
      context.signal.throwIfAborted();
      assert.equal(store.runs.snapshot().runs.at(-1).status, 'running');
      effects.push({ actionId, parameters: structuredClone(parameters) });
    } };
  store = await new ControlsStore(root, registry, { snapshot: () => ({ name: 'Test', theme: 'dark', fontScale: 100, timeFormat: '24' }) }, { add: async () => {} }).load();
  t.after(async () => {
    await store.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  await store.save('tradfri', { schemaVersion: 1, name: 'Lights', slug: 'lights', enabled: true, icon: 'lightbulb', columns: 2, presentation: 'lighting', items: [] });
  const view = () => store.viewer('tradfri','lights');
  const scene = values => store.scene('tradfri','lights',view().token,{ revision: view().page.revision, ...values });
  const run = (itemId, value) => store.invoke('tradfri','lights',view().token,{ revision: view().page.revision, requestId: randomUUID(), itemId, ...(value === undefined ? {} : { value }) });
  return { store, view, scene, run, effects, record, reading, settings, gate, root };
}

test('designed scenes store supported per-light settings without executing and preserve exact values when edited',async t=>{
  const f=await fixture(t),page=()=>f.store.pages('tradfri')[0];
  const lights=[{id:'1',on:false,brightness:0,temperature:0},{id:'2',on:true,brightness:72,hue:232.5,saturation:43.25}];
  await f.store.administerScene('tradfri',page().id,{action:'create',revision:page().revision,name:'Evening',lights,icon:'moon'});
  let scene=page().items[0];
  assert.equal(scene.enabled,false);assert.equal(scene.icon,'moon');assert.deepEqual(scene.steps.map(step=>step.parameters),lights);assert.ok(scene.steps.every(step=>step.actionId==='light-state'));
  assert.deepEqual(f.effects,[]);
  const details=f.store.sceneDetails('tradfri',page().id);assert.deepEqual(details.editableScenes[scene.id],lights);assert.equal(Object.hasOwn(details,'token'),false);
  const changed=[{...lights[0],on:true,temperature:80},lights[1]];
  await f.store.administerScene('tradfri',page().id,{action:'edit',revision:page().revision,itemId:scene.id,name:'Evening',lights:changed});
  scene=page().items[0];assert.deepEqual(scene.steps.map(step=>step.parameters),changed);assert.equal(scene.enabled,false);assert.deepEqual(f.effects,[]);
  // Metadata edits remain available while paused and never replace the recipe.
  f.gate.paused=true;
  await f.store.administerScene('tradfri',page().id,{action:'edit',revision:page().revision,itemId:scene.id,name:'Quiet evening'});
  assert.deepEqual(page().items[0].steps.map(step=>step.parameters),changed);
  await assert.rejects(f.store.administerScene('tradfri',page().id,{action:'edit',revision:page().revision,itemId:scene.id,name:'Quiet evening',lights}),/unavailable|ready/);
});

test('scene authoring rejects wrong targets, unsupported fields, injected actions, duplicate lights and stale readings',async t=>{
  const f=await fixture(t),page=()=>f.store.pages('tradfri')[0],good={id:'1',on:true,brightness:50,temperature:50};
  const create=lights=>f.store.administerScene('tradfri',page().id,{action:'create',revision:page().revision,name:'Designed',lights});
  for(const lights of [[],[good,good],[{...good,id:'999'}],[{...good,brightness:101}],[{...good,on:1}],[{...good,temperature:NaN}],[{...good,hue:30}],[{...good,actionId:'light-power'}],[{id:'2',on:true,brightness:50,hue:361,saturation:20}]])await assert.rejects(create(lights));
  await assert.rejects(f.scene({action:'create',name:'Remote injection',lights:[good]}),/administration/);
  await assert.rejects(f.store.administerScene('tradfri',page().id,{action:'create',revision:page().revision,name:'Mixed',lights:[good],lightIds:['1']}),/Unknown|settings|current lighting/i);
  const staleRevision=page().revision;await create([good]);
  await assert.rejects(f.store.administerScene('tradfri',page().id,{action:'create',revision:staleRevision,name:'Old revision',lights:[good]}),/changed/);
  f.settings.host='10.23.42.3';await assert.rejects(create([good]),/Refresh|available/);
  assert.equal(page().items.length,1);assert.deepEqual(f.effects,[]);
});

test('lighting contract opt-in, bounded public targets, capabilities and private projection', async t => {
  const f = await fixture(t), view = f.view();
  assert.equal(view.lighting.lights.length, 3);
  assert.equal(view.lighting.lights[0].capturable, true);
  assert.equal(view.lighting.lights[2].capturable, false);
  assert.ok(view.lighting.lights[0].controls.temperature);
  assert.equal(view.lighting.lights[0].controls.color, undefined);
  assert.ok(view.lighting.lights[1].controls.color);
  assert.doesNotMatch(JSON.stringify(view), /gateway-host|192\.168\.0\.2|baselines|parameters|identitySetting/);
  const bad = structuredClone(raw); bad.controls.lighting.actions.lightPower = 'reconnect';
  assert.throws(() => validateDeclaration(bad));
  const mapped = { schemaVersion: 1, name: 'Mapped', slug: 'mapped', enabled: true, icon: 'lightbulb', columns: 1, items: [] };
  assert.equal(validateControlPage(mapped,plugin).presentation,'mapped');
  assert.throws(() => validateControlPage({ ...mapped,presentation: 'lighting' },{...plugin,controls:{actions:[]}}));
  f.settings.host = '10.23.42.9';
  assert.equal(f.view().lighting.lights.length, 0);
  assert.equal(f.view().lighting.receivedAt, null);
});

test('dynamic controls use claimed shared execution and reject missing/unsupported targets and colours', async t => {
  const f = await fixture(t);
  await f.run('remote-light-1-brightness', 80); await f.store.active.get('tradfri')?.done;
  assert.deepEqual(f.effects[0], { actionId: 'light-brightness', parameters: { id: '1', value: 80 } });
  assert.equal(f.view().lighting.lights[0].brightness,35,'targets never replace reported state');
  await assert.rejects(f.run('remote-light-1-color', '#ffffff'), /unavailable/);
  await assert.rejects(f.run('remote-light-3-power',true), /unavailable/);
  await assert.rejects(f.run('remote-light-2-color','red'), /RRGGBB/);
  await assert.rejects(f.run('remote-light-1-brightness',101), /range/);
  await f.run('remote-group-10-power',false); await f.store.active.get('tradfri')?.done;
  assert.deepEqual(f.effects[1], { actionId:'group-power',parameters:{id:'10',on:false} });
  f.gate.paused = true;
  await assert.rejects(f.run('remote-light-1-power',true), /paused/);
});

test('scene capture uses exact known readings, saves disabled, handles revisions and copies without effects', async t => {
  const f = await fixture(t), before = f.view();
  await f.scene({action:'capture',name:'Reading',lightIds:['1','2']});
  let saved = f.store.pages('tradfri')[0], scene = saved.items[0];
  assert.equal(scene.enabled,false); assert.equal(scene.steps.length,2);
  assert.deepEqual(scene.steps[0].parameters,{id:'1',on:false,brightness:35,temperature:60});
  assert.deepEqual(scene.steps[1].parameters,{id:'2',on:true,brightness:70,hue:220,saturation:83});
  assert.equal(f.effects.length,0);
  await assert.rejects(f.store.scene('tradfri','lights',before.token,{action:'capture',revision:before.page.revision,name:'Stale',lightIds:['1']}), /Refresh/);
  await assert.rejects(f.run(scene.id), /unavailable/);
  await f.scene({action:'enabled',itemId:scene.id,enabled:true});
  await f.run(scene.id); await f.store.active.get('tradfri')?.done;
  assert.equal(f.effects.length,2); assert.equal(f.effects[0].actionId,'light-state');
  await f.scene({action:'copy',itemId:scene.id,name:'Reading copy'});
  saved = f.store.pages('tradfri')[0];
  assert.equal(saved.items[1].enabled,false);
  assert.notEqual(saved.items[1].steps[0].id,saved.items[0].steps[0].id);
  f.reading['light-1-brightness'] = 42;
  await f.scene({action:'edit',itemId:scene.id,name:'Renamed',lightIds:['1']});
  assert.equal(f.store.pages('tradfri')[0].items[0].steps[0].parameters.brightness,42);
  await f.scene({action:'delete',itemId:scene.id});
  assert.equal(f.store.pages('tradfri')[0].items.length,1);
  assert.equal(f.effects.length,2);
  const disk = JSON.parse(await fs.readFile(path.join(f.root,'plugins/tradfri/data/controls.json')));
  assert.equal(disk.pages[0].items[0].label,'Reading copy');
});

test('capture rejects stale, missing, duplicate or incomplete readings and failed saves preserve scenes', async t => {
  const f = await fixture(t);
  for (const ids of [[],['1','1'],['3'],['999']]) await assert.rejects(f.scene({action:'capture',name:'Bad',lightIds:ids}));
  f.reading['light-1-temperature'] = null;
  await assert.rejects(f.scene({action:'capture',name:'Bad',lightIds:['1']}), /complete/);
  f.reading['received-at'] = Date.now() - 600000;
  await assert.rejects(f.scene({action:'capture',name:'Old',lightIds:['2']}), /Refresh/);
  f.reading['received-at'] = Date.now(); f.record.pending = 1;
  await assert.rejects(f.scene({action:'capture',name:'Busy',lightIds:['2']}), /wait/);
  f.record.pending = 0;
  const entry = f.store.entry('tradfri').store, oldWrite = entry.write;
  entry.write = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(f.scene({action:'capture',name:'Lost',lightIds:['2']}), /disk/);
  assert.equal(f.store.pages('tradfri')[0].items.length,0);
  entry.write = oldWrite;
  await f.scene({action:'capture',name:'Saved',lightIds:['2']});
  assert.equal(f.effects.length,0);
});

test('scene glyph edits, capture and copy persist and project without lighting effects',async t=>{
  const f=await fixture(t);await f.scene({action:'capture',name:'Evening',lightIds:['1'],icon:'moon'});
  const scene=f.view().lighting.scenes[0];assert.equal(scene.icon,'moon');assert.ok(f.view().lighting.glyphs.includes('restaurant'));
  const original=f.store.pages('tradfri')[0].items[0].steps;
  await f.scene({action:'edit',itemId:scene.id,name:'Evening',icon:'restaurant'});assert.equal(f.view().lighting.scenes[0].icon,'restaurant');assert.deepEqual(f.store.pages('tradfri')[0].items[0].steps,original);
  await f.scene({action:'copy',itemId:scene.id,name:'Dinner copy'});assert.equal(f.view().lighting.scenes[1].icon,'restaurant');
  await assert.rejects(f.scene({action:'edit',itemId:scene.id,name:'Bad',icon:'<script>'}),/glyph/);assert.equal(f.view().lighting.scenes[0].label,'Evening');assert.equal(f.effects.length,0);
});
