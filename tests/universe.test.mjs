/** All server checks use disposable roots, offline Cards and no adapters. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createLocalserve } from '../server.mjs';
import { UniverseStore, universeDefaults, validateUniverse } from '../server/universe.mjs';

const temporary = fileURLToPath(new URL('./.tmp/', import.meta.url));
async function folder(t) {
  await fs.mkdir(temporary, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporary, 'universe-'));
  t.after(async () => { assert.ok(root.startsWith(temporary)); await fs.rm(root, { recursive: true, force: true }); });
  return root;
}

test('Universe bounds settings, rejects stale revisions, unknown keys and duplicate references', () => {
  assert.equal(validateUniverse(universeDefaults).revision, 2);
  assert.equal(validateUniverse({ ...universeDefaults, holdSeconds: 0 }).holdSeconds, 0);
  for (const patch of [{ revision: 0 }, { script: 'x' }, { holdSeconds: -1 }, { flightMinSeconds: 20, flightMaxSeconds: 10 },
    { density: NaN }, { world: 'script' }, { world: null }, { detail: 'ultra' }, { stars: 'true' }, { viewDistance: 999999 }, { motion: 101 },
    { cards: [{pluginId:'x',cardId:'../private'}] }, { cards: Array(41).fill({pluginId:'x',cardId:'x'}) },
    { cards: [{pluginId:'x',cardId:'x'}, {pluginId:'x',cardId:'x'}] }]) {
    assert.throws(() => validateUniverse({ ...universeDefaults, ...patch }));
  }
});

test('Universe public data selects only enabled ready-made Cards and retains missing references', async t => {
  const root = await folder(t);
  let services = [{ id: 'test', cards: [{ id: 'card-1', enabled: true, layout: 'readymade', fields: [] },
    { id: 'ordinary', enabled: true, layout: 'list', fields: [] }],
    cardCatalog: [], cardData: { values: { secret: { available: true, value: 'PRIVATE' } }, status: 'Ready' } }];
  const config = { snapshot: () => ({ name:'Test',theme:'dark',vistaFontScale:110,fontScale:80,timeFormat:'24',secret:'PRIVATE' }) };
  const registry = { services: () => services }, activity = { add: async () => {} };
  let store = await new UniverseStore(root, registry, config, activity).load();
  await assert.rejects(store.save({ ...store.snapshot(), cards: [{pluginId:'test',cardId:'ordinary'}] }));
  await store.save({ ...store.snapshot(), cards: [{pluginId:'test',cardId:'card-1'}] });
  assert.equal(store.viewer().cards.length, 1);
  assert.equal(store.viewer().options.fontScale, 110);
  assert.ok(!JSON.stringify(store.viewer()).includes('PRIVATE'));
  services[0].cards[0].enabled = false;
  assert.equal(store.viewer().cards[0].unavailable, 'Card disabled');
  services = [];
  assert.equal(store.viewer().cards[0].unavailable, 'Card unavailable');
  await store.save({ ...store.snapshot(), holdSeconds: 0 });
  store = await new UniverseStore(root, registry, config, activity).load();
  assert.equal(store.snapshot().holdSeconds, 0);
  assert.equal(store.snapshot().cards[0].cardId, 'card-1');
  const captured = store.snapshot();
  const concurrent = await Promise.allSettled([store.save(captured),store.save(captured)]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  await store.save({ ...store.snapshot(), enabled: false });
  assert.deepEqual(store.viewer().cards, []);
});

test('older Universe files preserve Cards/revision and default to space without rewriting', async t => {
  const root = await folder(t), legacy = structuredClone(universeDefaults);
  delete legacy.world; legacy.revision=7; legacy.cards=[{pluginId:'example',cardId:'saved'}];
  await fs.mkdir(path.join(root,'data'));
  const file=path.join(root,'data/universe.json'), original=JSON.stringify(legacy);
  await fs.writeFile(file,original);
  const store=await new UniverseStore(root,{services:()=>[]},{snapshot:()=>({})},{add:async()=>{}}).load();
  assert.equal(store.snapshot().world,'space'); assert.equal(store.snapshot().revision,7);
  assert.equal(await fs.readFile(file,'utf8'),original);
  await store.save({...store.snapshot(),world:'forest'});
  assert.equal(store.snapshot().world,'forest'); assert.equal(store.snapshot().cards[0].cardId,'saved');
  // An editor that omits world must retain the saved world selection.
  const oldEditor=store.snapshot(); delete oldEditor.world; await store.save(oldEditor);
  assert.equal(store.snapshot().world,'forest');
  for(const world of ['ocean','mountains','dunes','space']) {
    await store.save({...store.snapshot(),world}); assert.equal(store.viewer().universe.world,world);
  }
});

test('Universe HTTP uses existing exact Origin/token checks and public-only projection', async t => {
  let app;
  t.after(() => app?.close());
  const root = await folder(t);
  await fs.mkdir(path.join(root, 'web'));
  await fs.copyFile(new URL('../web/universe.html', import.meta.url), path.join(root, 'web/universe.html'));
  app = await createLocalserve(root, { automatic: false });
  const get = await fetch(app.origin + '/api/universe');
  const payload = await get.json();
  assert.equal(payload.universe.detail, 'low'); assert.equal(payload.token, undefined);
  const post = headers => fetch(app.origin + '/api/universe', { method:'POST',headers: {'Content-Type':'application/json', ...headers},body:JSON.stringify(app.universe.snapshot()) });
  assert.equal((await post({ Origin:app.origin })).status, 403);
  assert.equal((await post({ Origin:'http://example.invalid','X-Localserve-Token':app.snapshot().token })).status, 403);
  assert.equal((await post({ Origin:app.origin,'X-Localserve-Token':app.snapshot().token })).status, 200);
  const page = await fetch(app.origin + '/universe');
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self' file:/);
  assert.doesNotMatch(page.headers.get('content-security-policy'), /unsafe-eval/);
  assert.equal((await fetch(app.origin + '/data/universe.json')).status, 404);
});

test('flight timing stays in bounds, shuffle avoids immediate repeats and holds are exact', async () => {
  const context = {};
  vm.runInNewContext(await fs.readFile(new URL('../assets/universe/flight.js', import.meta.url), 'utf8'), context);
  const Flight = context.UniverseFlight, flight = new Flight(() => 0.999999);
  const settings = { holdSeconds:10, flightMinSeconds:4, flightMaxSeconds:9, order:'shuffle' };
  flight.reset(4);
  assert.equal(flight.index, 0); assert.equal(flight.tick(9,settings), null);
  assert.equal(flight.tick(1,settings), 'depart'); assert.notEqual(flight.index, 0);
  assert.ok(flight.duration >= 4 && flight.duration <= 9);
  assert.equal(flight.tick(flight.duration,settings), 'arrive'); assert.equal(flight.elapsed, 0);
  assert.equal(Flight.ease(0), 0); assert.equal(Flight.ease(1), 1);
  for (let i = 0; i < 50; i++) { const previous = flight.index; flight.next(settings); assert.notEqual(flight.index, previous); }
  flight.reset(1); flight.next(settings); assert.equal(flight.index, 0);
  flight.reset(0); flight.next(settings); assert.equal(flight.index, -1);
});

test('zero stop passes straight into the next flight and preserves remaining frame time', async () => {
  const context = {};
  vm.runInNewContext(await fs.readFile(new URL('../assets/universe/flight.js', import.meta.url), 'utf8'), context);
  const flight = new context.UniverseFlight(() => 0);
  const settings = { holdSeconds:0, flightMinSeconds:2, flightMaxSeconds:2, order:'sequential' };
  flight.reset(3);
  assert.equal(flight.tick(0.1, settings), 'depart');
  assert.equal(flight.elapsed, 0.1);
  assert.equal(flight.tick(2.15, settings), 'pass');
  assert.equal(flight.phase, 'flight');
  assert.equal(flight.index, 2);
  assert.equal(flight.previous, 1);
  assert.ok(Math.abs(flight.elapsed - 0.25) < 1e-9);
  assert.equal(flight.tick(1.75, settings), 'pass');
  assert.equal(flight.phase, 'flight');
  assert.equal(flight.index, 0);
});
