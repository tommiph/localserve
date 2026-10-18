/** Controls execute only an isolated Simulator here. Live light/TV verification
 * is read-only; no physical devices receive test commands. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createLocalserve } from '../server.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { validateControlPage } from '../server/controls.mjs';

const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
const source = fileURLToPath(new URL('../plugins/simulator/', import.meta.url));
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFor(check) {
  const deadline = Date.now() + 6000;
  while (!(await check())) { if (Date.now() > deadline) throw new Error('Controls test timed out.'); await sleep(10); }
}
function step(actionId = 'pulse', parameters = {}) { return { id: randomUUID(), actionId, parameters }; }
function item(kind = 'button', steps = [step()], extra = {}) {
  return { id: randomUUID(), label: 'Test control', kind, enabled: true, icon: 'plug', steps, parameter: null, binding: null, ...extra };
}
function page(items = [item()], extra = {}) {
  return { schemaVersion: 1, name: 'Test Controls', slug: 'test', enabled: true, icon: 'plug', columns: 3, items, ...extra };
}
async function declaration() {
  const value = JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8'));
  value.controls = { actions: value.actions.map(action => action.id) };
  return value;
}
async function fixture(t) {
  await fs.mkdir(temporaryRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'controls-')), folder = path.join(root, 'plugins/simulator');
  await fs.mkdir(path.join(folder, 'server'), { recursive: true });
  await fs.mkdir(path.join(root, 'web'));
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(await declaration()));
  await fs.copyFile(path.join(source, 'server/index.mjs'), path.join(folder, 'server/index.mjs'));
  await fs.copyFile(new URL('../web/controls.html', import.meta.url), path.join(root, 'web/controls.html'));
  let app = await createLocalserve(root, { automatic: false });
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(temporaryRoot) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  async function call(endpoint, values, headers = {}) {
    const response = await fetch(app.origin + endpoint, values === undefined ? {} : { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: app.origin, 'X-Localserve-Token': app.snapshot().token, ...headers }, body: JSON.stringify(values) });
    return { status: response.status, body: await response.json() };
  }
  await call('/api/plugins/simulator/config', { revision: 1, enabled: true });
  const f = { root, folder, get app() { return app; }, call,
    async save(value) { const result = await call('/api/plugins/simulator/controls', value); assert.equal(result.status, 200, JSON.stringify(result.body)); return app.controls.pages('simulator').at(-1); },
    view(slug = 'test') { return app.controls.viewer('simulator', slug); },
    async run(saved, itemId, extra = {}, headers = {}) {
      return call(`/api/control-view/simulator/${saved.slug}/run`, { itemId, requestId: randomUUID(), revision: saved.revision, ...extra }, { 'X-Localserve-Control-Token': f.view(saved.slug).token, ...headers });
    },
    async idle() { await waitFor(() => !app.controls.active.size); },
    async restart() { await app.close(); app = await createLocalserve(root, { automatic: false }); },
  };
  return f;
}

test('declaration opt-in excludes credentials and undeclared actions; bounded typed pages reject arbitrary mappings', async () => {
  const raw = await declaration(), plugin = validateDeclaration(raw);
  assert.deepEqual(plugin.controls.actions, raw.controls.actions);
  for (const ids of [['unknown'], ['pulse', 'pulse'], []]) assert.throws(() => validateDeclaration({ ...raw, controls: { actions: ids } }));
  const secret = structuredClone(raw); secret.actions[0].parameters[0].format = 'secret';
  assert.throws(() => validateDeclaration(secret), /non-secret/);
  const good = validateControlPage(page([item('range', [step('set-value', { value: 42 })], { parameter: 'value', binding: { field: 'value' } })]), plugin);
  assert.equal(good.items[0].steps[0].parameters.value, 42);
  for (const bad of [page([item('button', [step('unknown')])]), page([item('range', [step()], { parameter: 'not-a-field' })]),
    page([item('range', [step('set-value', { value: 2 })], { parameter: 'value', binding: { field: 'signal-message' } })]),
    page([item('button', [step('pulse', { command: 'arbitrary' })])]), page([], { columns: 7 }), page([], { slug: '../other' }),
    page([item('scene', Array.from({ length: 7 }, () => ({ id: randomUUID(), actionId: 'delay', seconds: 10 })))]),
    page([item()], { html: '<script>arbitrary</script>' })]) assert.throws(() => validateControlPage(bad, plugin));
});

test('saved directional glyphs survive startup without rewriting mappings or executing them', async t => {
  const f = await fixture(t);
  const saved = await f.save(page(['arrow-up','arrow-down','arrow-left','arrow-right'].map(icon =>
    item('button', [step('log', {message:'Do not execute',level:'info'})], {icon}))));
  const file = path.join(f.folder,'data/controls.json'), before = await fs.readFile(file,'utf8');
  await f.restart();
  assert.equal((await fetch(f.app.origin + '/controls/simulator/test')).status,200);
  assert.equal(f.app.controls.admin()[0].error,'');
  assert.deepEqual(f.app.controls.pages('simulator')[0],saved);
  assert.equal(await fs.readFile(file,'utf8'),before);
  assert.equal(f.app.controls.runs.snapshot().runs.length,0);
});

test('plugin-owned CRUD, captured revisions, unique URLs, public projection and private storage', async t => {
  const f = await fixture(t), saved = await f.save(page([item('range', [step('set-value', { value: 10 })], { parameter: 'value', binding: { field: 'value' } }), item('button', [step('log', { message: 'PRIVATE-MAPPING', level: 'info' })])]));
  assert.ok((await fs.stat(path.join(f.folder, 'data/controls.json'))).isFile());
  assert.equal((await f.call(`/api/plugins/simulator/controls/${saved.id}`, { ...saved, revision: 0 })).status, 409);
  assert.equal((await f.call('/api/plugins/simulator/controls', page([], { name: 'Another' }))).status, 409);
  assert.equal((await fetch(f.app.origin + '/controls/simulator/test')).status, 200);
  assert.equal((await fetch(f.app.origin + '/controls')).status, 200);
  const view = f.view();
  assert.equal(view.page.items[0].reported, null);
  assert.notEqual(view.token, f.app.snapshot().token);
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE-MAPPING|parameters|pluginState|configuration-complete|controlActions|controlPageId/);
  assert.equal((await f.call('/plugins/simulator/data/controls.json')).status, 404);
  assert.equal((await f.call('/data/control-runs.json')).status, 404);
  const copy = structuredClone(saved); delete copy.id; delete copy.revision; copy.slug = 'copy'; copy.name += ' copy'; copy.enabled = false;
  await f.save(copy);
  assert.equal(f.app.controls.index().pages.length, 1);
  assert.equal((await fetch(f.app.origin + '/controls/simulator/copy')).status, 404);
  await f.restart();
  assert.equal(f.app.controls.pages('simulator').length, 2);
  assert.notEqual(f.view().token, view.token);
  assert.equal((await f.call(`/api/plugins/simulator/controls/${saved.id}/enabled`, { revision: 1, enabled: false })).status, 200);
  assert.equal((await f.call('/api/control-view/simulator/test')).status, 404);
  assert.equal((await f.call(`/api/plugins/simulator/controls/${saved.id}/delete`, { revision: 2 })).status, 200);
  assert.equal(f.app.controls.pages('simulator').length, 1);
});

test('page capabilities, Origin, immutable mapped arguments and adjustable values are enforced', async t => {
  const f = await fixture(t), saved = await f.save(page([item(), item('range', [step('set-value', { value: 10 })], { parameter: 'value', binding: { field: 'value' } })]));
  assert.equal((await f.run(saved, saved.items[0].id, {}, { Origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await f.call('/api/control-view/simulator/test/scene', { action: 'capture', revision: saved.revision, name: 'Blocked', lightIds: [] },
    { Origin: 'https://elsewhere.example', 'X-Localserve-Control-Token': f.view().token })).status, 403);
  assert.equal((await f.call('/api/control-view/simulator/test/scene', { action: 'capture', revision: saved.revision, name: 'Blocked', lightIds: [] },
    { 'X-Localserve-Control-Token': f.app.snapshot().token })).status, 403);
  assert.equal((await f.run(saved, saved.items[0].id, {}, { 'X-Localserve-Control-Token': f.app.snapshot().token })).status, 403);
  const other = await f.save(page([], { name: 'Other', slug: 'other' }));
  assert.equal((await f.run(saved, saved.items[0].id, {}, { 'X-Localserve-Control-Token': f.view(other.slug).token })).status, 403);
  assert.equal((await f.run(saved, saved.items[0].id, { value: 1 })).status, 400);
  assert.equal((await f.run(saved, saved.items[0].id, { actionId: 'fail' })).status, 400);
  for (const value of ['50', 1000001, null]) assert.equal((await f.run(saved, saved.items[1].id, { value })).status, 400);
  assert.equal((await f.run(saved, saved.items[1].id, { value: 37 })).status, 202);
  await f.idle();
  assert.equal(f.view().page.items[1].reported, 37);
  assert.equal(f.app.registry.services()[0].pluginState.value, 37);
  const oldToken = f.view().token;
  await f.call(`/api/plugins/simulator/controls/${saved.id}`, { ...saved, name: 'Renamed' });
  assert.equal((await f.run(saved, saved.items[0].id, {}, { 'X-Localserve-Control-Token': oldToken })).status, 403);
});

test('claims precede effects; duplicate requests and restarts never replay and a busy plugin rejects overlap', async t => {
  const f = await fixture(t), saved = await f.save(page([item('scene', [step(), { id: randomUUID(), actionId: 'delay', seconds: 1 }, step()])]));
  let claimBeforeEffects = false;
  const write = f.app.controls.runs.write.bind(f.app.controls.runs);
  f.app.controls.runs.write = async value => {
    if (value.runs.length === 1 && value.runs[0].status === 'queued') {
      assert.equal(f.app.registry.services()[0].pluginState.sequence, undefined);
      await write(value); claimBeforeEffects = true;
    } else await write(value);
  };
  const requestId = randomUUID();
  assert.equal((await f.run(saved, saved.items[0].id, { requestId })).status, 202);
  const claim = f.app.controls.runs.snapshot().runs[0];
  assert.equal(claim.id, requestId);
  assert.equal(claimBeforeEffects, true);
  assert.equal((await f.run(saved, saved.items[0].id)).status, 429);
  assert.equal((await f.run(saved, saved.items[0].id, { requestId })).status, 202);
  await f.idle();
  assert.equal(f.app.registry.services()[0].pluginState.sequence, 2, JSON.stringify({ runs: f.app.controls.runs.snapshot().runs, log: f.app.registry.services()[0].pluginActivity.slice(-8) }));
  assert.equal((await f.run(saved, saved.items[0].id, { requestId })).status, 202);
  assert.equal(f.app.registry.services()[0].pluginState.sequence, 2);
  await f.restart();
  assert.equal((await f.run(saved, saved.items[0].id, { requestId })).status, 202);
  await f.idle();
  assert.equal(f.app.registry.services()[0].pluginState.sequence, 2);
  // A saved unfinished claim is recovered as interrupted, never automatically executed.
  await f.app.close();
  const runFile = path.join(f.root, 'data/control-runs.json'), history = JSON.parse(await fs.readFile(runFile, 'utf8'));
  history.runs[0].status = 'running'; await fs.writeFile(runFile, JSON.stringify(history));
  await f.restart();
  assert.equal(f.app.controls.runs.snapshot().runs[0].status, 'interrupted');
  assert.equal(f.app.registry.services()[0].pluginState.sequence, 2);
});

test('scenes preserve order, stop after failure, pause cooperatively and cancel remaining steps', async t => {
  const f = await fixture(t), saved = await f.save(page([item('scene', [step('set-value', { value: 1 }), { id: randomUUID(), actionId: 'delay', seconds: 0.2 }, step('set-value', { value: 2 })]),
    item('scene', [step('fail', { message: 'PRIVATE-ERROR' }), step()])]));
  const run = await f.run(saved, saved.items[0].id);
  await waitFor(() => f.app.controls.runs.snapshot().runs.find(entry => entry.id === run.body.id)?.step === 2);
  await f.call('/api/pause', { paused: true });
  await sleep(250);
  assert.equal(f.app.registry.services()[0].pluginState.value, 1);
  assert.equal((await f.run(saved, saved.items[1].id)).status, 409);
  assert.equal((await f.call('/api/control-view/simulator/test/cancel', { runId: run.body.id }, { 'X-Localserve-Control-Token': f.view().token })).status, 200);
  await f.idle();
  assert.equal(f.app.controls.runs.snapshot().runs[0].status, 'cancelled');
  await f.call('/api/pause', { paused: false });
  await f.run(saved, saved.items[0].id); await f.idle();
  assert.equal(f.app.registry.services()[0].pluginState.value, 2);
  await f.run(saved, saved.items[1].id); await f.idle();
  assert.equal(f.app.controls.runs.snapshot().runs.at(-1).status, 'failed');
  assert.doesNotMatch(JSON.stringify(f.view()), /PRIVATE-ERROR/);
  assert.equal(f.app.registry.services()[0].pluginState.sequence, undefined);
});

test('saved edits, disabling and shutdown cancel remaining work; claim write failure admits no effect', async t => {
  const f = await fixture(t), saved = await f.save(page([item('scene', [{ id: randomUUID(), actionId: 'delay', seconds: 1 }, step()])]));
  const original = f.app.controls.runs.write;
  f.app.controls.runs.write = async () => { throw new Error('Simulated storage failure'); };
  assert.equal((await f.run(saved, saved.items[0].id)).status, 500);
  f.app.controls.runs.write = original;
  assert.equal(f.app.controls.active.size, 0);
  assert.equal(f.app.registry.services()[0].pluginState.sequence, undefined);
  await f.run(saved, saved.items[0].id);
  await f.call(`/api/plugins/simulator/controls/${saved.id}`, { ...saved, name: 'Edited' });
  await f.idle(); assert.equal(f.app.controls.runs.snapshot().runs.at(-1).status, 'cancelled');
  let current = f.app.controls.pages('simulator')[0];
  await f.run(current, current.items[0].id);
  await f.call(`/api/plugins/simulator/controls/${current.id}/enabled`, { revision: current.revision, enabled: false });
  await f.idle(); assert.equal(f.app.controls.runs.snapshot().runs.at(-1).status, 'cancelled');
  current = f.app.controls.pages('simulator')[0];
  await f.call(`/api/plugins/simulator/controls/${current.id}/enabled`, { revision: current.revision, enabled: true });
  current = f.app.controls.pages('simulator')[0];
  await f.run(current, current.items[0].id); await f.restart();
  assert.equal(f.app.registry.services()[0].pluginState.sequence, undefined);
  assert.equal(f.app.controls.runs.snapshot().runs.at(-1).status, 'cancelled');
});

test('missing mappings stay explicit and malformed package Controls are quarantined without disabling its adapter', async t => {
  const f = await fixture(t), saved = await f.save(page());
  const raw = await declaration(); raw.controls.actions = ['set-value'];
  await fs.writeFile(path.join(f.folder, 'declaration.json'), JSON.stringify(raw));
  await f.app.registry.discover(); await f.app.controls.sync();
  assert.equal(f.view().page.items[0].available, false);
  assert.equal((await f.call(`/api/plugins/simulator/controls/${saved.id}`, { ...saved, name: 'Still saved' })).status, 200);
  await f.app.close();
  await fs.writeFile(path.join(f.folder, 'data/controls.json'), '{broken');
  await f.restart();
  assert.match(f.app.controls.admin()[0].error, /retained/);
  assert.equal(await fs.readFile(path.join(f.folder, 'data/controls.json'), 'utf8'), '{broken');
  assert.equal(f.app.registry.get('simulator').health, 'ready');
});

test('configuration edits cancel scenes and shutdown drains admissions whose claims are still being written', async t => {
  const f = await fixture(t), saved = await f.save(page([item('scene', [{ id: randomUUID(), actionId: 'delay', seconds: 1 }, step()])]));
  await f.run(saved, saved.items[0].id);
  const config = f.app.registry.services()[0].config;
  await f.call('/api/plugins/simulator/config', { revision: config.revision, icon: 'robot' });
  await f.idle();
  assert.equal(f.app.controls.runs.snapshot().runs.at(-1).status, 'cancelled');
  assert.equal(f.app.registry.services()[0].pluginState.sequence, undefined);
  const store = f.app.controls.runs, write = store.write.bind(store);
  let release, entered = false;
  const held = new Promise(resolve => { release = resolve; });
  store.write = async value => {
    if (value.runs.at(-1).status === 'queued') { entered = true; await held; }
    await write(value);
  };
  const admission = f.app.controls.invoke('simulator', 'test', f.view().token, { itemId: saved.items[0].id, revision: saved.revision, requestId: randomUUID() });
  await waitFor(() => entered);
  let closed = false;
  const closing = f.app.close().then(() => { closed = true; });
  await sleep(30); assert.equal(closed, false);
  release(); await admission; await closing;
  assert.equal(store.snapshot().runs.at(-1).status, 'cancelled');
  const state = JSON.parse(await fs.readFile(path.join(f.folder, 'data/state.json'), 'utf8'));
  assert.equal(state.sequence, undefined);
});

test('save bounds match readable on-disk bytes so accepted pages survive restart', async t => {
  const f = await fixture(t);
  const large = page(Array.from({ length: 4 }, (_, i) => item('scene', Array.from({ length: 32 }, () => step('log', { message: 'ä'.repeat(1800), level: 'info' })), { label: 'Scene ' + i })));
  let accepted = 0, rejected = false;
  for (let index = 0; index < 8; index++) {
    try { await f.app.controls.save('simulator', { ...large, name: 'Large ' + index, slug: 'large-' + index }); accepted++; }
    catch (error) { assert.equal(error.status, 400); assert.match(error.message, /2 MiB/); rejected = true; break; }
  }
  assert.equal(rejected, true); assert.ok(accepted > 0);
  assert.ok((await fs.stat(path.join(f.folder, 'data/controls.json'))).size <= 2 * 1024 * 1024);
  await f.restart();
  assert.equal(f.app.controls.pages('simulator').length, accepted);
  assert.equal(f.app.controls.admin()[0].error, '');
});

test('shared renderer escapes labels and selections; previews disable widgets and polling retains DOM', async () => {
  const context = vm.createContext({ document: { activeElement: null } });
  vm.runInContext(await fs.readFile(new URL('../web/controls-renderer.js', import.meta.url), 'utf8') + '\nglobalThis.renderer = ControlsRenderer;', context);
  const renderer = context.renderer, mapped = item(); mapped.label = '<img onerror="alert(1)">';
  assert.doesNotMatch(renderer.renderItem(mapped), /<img/);
  const input = { disabled: false, dataset: {}, value: '', closest: () => ({ querySelector: () => null }) };
  const reading = { textContent: '' }, surface = { dataset: { controlId: 'widget' }, querySelector: selector => selector === '[data-control-reading]' ? reading : input, querySelectorAll: () => [input] };
  let rebuilds = 0;
  const host = { dataset: {}, set innerHTML(value) { rebuilds++; }, querySelectorAll: () => [surface] };
  const snapshot = { page: { id: 'page', revision: 1, columns: 3, items: [{ id: 'widget', kind: 'range', label: 'Volume', icon: 'plug', reported: 13, available: true, input: { min: 0, max: 100, default: 0 } }] }, available: true, busy: false };
  renderer.mount(host, snapshot, { preview: true }); assert.equal(input.disabled, true);
  snapshot.page.items[0].reported = 27; renderer.mount(host, snapshot);
  assert.equal(rebuilds, 1); assert.equal(input.value, '27'); assert.equal(reading.textContent, '27');
  input.dataset.changed = 'true'; input.value = '42'; renderer.mount(host, snapshot);
  assert.equal(input.value, '42'); assert.equal(reading.textContent, '27');
  snapshot.busy = true; renderer.mount(host, snapshot); assert.equal(input.disabled, true);
});
