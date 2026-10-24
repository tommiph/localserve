/** Vista tests own temporary roots/listeners; no live Tasks/plugins are changed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createLocalserve } from '../server.mjs';
import { dimension, validateVista } from '../server/vistas.mjs';

const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
function node(id = 'root', type = 'column') {
  const item = { id, type, name: id, enabled: true, width: '1fr', height: '1fr' };
  if (['row', 'column'].includes(type)) item.children = [];
  else item.cards = [];
  if (type === 'collection') Object.assign(item, { rotation: 'both', intervalSeconds: 5, animation: 'fade', durationMs: 500 });
  return item;
}
function definition() {
  return { schemaVersion: 1, name: 'Living room', slug: 'living-room', enabled: false, gap: 16, padding: 16, layout: node() };
}
async function fixture(t) {
  await fs.mkdir(temporaryRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'vistas-'));
  await fs.mkdir(path.join(root, 'web'));
  await fs.copyFile(new URL('../web/vista.html', import.meta.url), path.join(root, 'web/vista.html'));
  let app = await createLocalserve(root, { automatic: false });
  const call = async (endpoint, values, headers = {}) => {
    const response = await fetch(app.origin + endpoint, values === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.origin, 'X-Localserve-Token': app.snapshot().token, ...headers }, body: JSON.stringify(values),
    });
    return { status: response.status, body: await response.json() };
  };
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(temporaryRoot) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, call, get app() { return app; }, async restart() { await app.close(); app = await createLocalserve(root, { automatic: false }); } };
}

test('administrator and Vista font preferences save independently across display routes and restart', async t => {
  const f = await fixture(t);
  assert.equal(f.app.config.snapshot().vistaFontScale, 100);
  assert.equal((await f.call('/api/config', { fontScale: 125 })).status, 200);
  assert.equal((await f.call('/api/display')).body.options.fontScale, 100);
  assert.equal((await f.call('/api/config', { vistaFontScale: 85 })).status, 200);
  assert.equal(f.app.config.snapshot().fontScale, 125);
  await f.call('/api/vistas', { ...definition(), enabled: true });
  const vista = f.app.vistas.snapshot()[0];
  await f.app.vistas.show(vista.id);
  for (const endpoint of ['/api/display', '/api/vistas/living-room']) {
    assert.equal((await f.call(endpoint)).body.options.fontScale, 85);
  }
  assert.equal((await f.call('/api/config', { fontScale: 100 })).status, 200);
  assert.equal(f.app.config.snapshot().vistaFontScale, 85);
  for (const invalid of [0, 79, 131, 82, '110', null]) {
    assert.equal((await f.call('/api/config', { vistaFontScale: invalid })).status, 400);
  }
  await f.restart();
  assert.equal(f.app.config.snapshot().fontScale, 100);
  assert.equal((await f.call('/api/display')).body.options.fontScale, 85);
  assert.equal((await f.call('/api/vistas/living-room')).body.options.fontScale, 85);
});

test('Vista persistence, independent URLs, stale edits, enable/disable, and deletion', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.app.snapshot().vistas, []);
  assert.equal((await f.call('/api/vistas', definition(), { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await f.call('/api/vistas', definition())).status, 200);
  let saved = f.app.vistas.snapshot()[0];
  assert.equal((await f.call('/api/vistas/living-room')).status, 404);
  assert.equal((await fetch(f.app.origin + '/vistas/living-room')).status, 404);
  assert.equal((await f.call(`/api/vistas/${saved.id}/enabled`, { enabled: true, revision: saved.revision })).status, 200);
  assert.equal((await f.call(`/api/vistas/${saved.id}`, saved)).status, 409);
  saved = f.app.vistas.snapshot()[0];
  assert.equal((await f.call('/api/vistas/living-room')).status, 200);
  const page = await fetch(f.app.origin + '/vistas/living-room');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self' file:;/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self';/);
  const adminApi = await fetch(f.app.origin + '/api/state');
  assert.match(adminApi.headers.get('content-security-policy'), /frame-ancestors 'none';/);
  const controls = await fetch(f.app.origin + '/controls');
  assert.match(controls.headers.get('content-security-policy'), /frame-ancestors 'none';/);
  const html = await page.text();
  assert.match(html, /\.\.\/assets\/vista-boot.js/);
  assert.doesNotMatch(html, /app.js|plugin-ui.js|editor-dialog/);
  assert.equal((await f.call('/api/vistas', { ...definition(), name: 'Other' })).status, 409);
  assert.equal((await f.call('/api/vistas', { ...definition(), name: 'Bedroom', slug: 'bedroom', enabled: true })).status, 200);
  await f.restart();
  assert.equal(f.app.vistas.snapshot().length, 2);
  assert.equal((await f.call('/api/vistas/bedroom')).body.vista.name, 'Bedroom');
  assert.equal((await f.call('/data/vistas.json')).status, 404);
  assert.equal((await f.call(`/api/vistas/${saved.id}/enabled`, { revision: saved.revision, enabled: false })).status, 200);
  assert.equal((await f.call('/api/vistas/living-room')).status, 404);
  saved = f.app.vistas.snapshot()[0];
  assert.equal((await f.call(`/api/vistas/${saved.id}/delete`, { revision: saved.revision })).status, 200);
  assert.equal(f.app.vistas.snapshot().length, 1);
});

test('shared display selection is persisted, revision-aware, public and independent of individual Vista URLs', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.app.origin + '/display')).status, 200);
  assert.match((await fetch(f.app.origin + '/display')).headers.get('content-security-policy'), /frame-ancestors 'self' file:;/);
  assert.equal((await f.call('/api/display')).body.vista, null);
  await f.call('/api/vistas', { ...definition(), enabled: true });
  const vista = f.app.vistas.snapshot()[0];
  assert.equal((await f.call('/api/display', { vistaId: vista.id, revision: 1 }, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await f.call('/api/display', { vistaId: vista.id, revision: 1 })).status, 200);
  assert.equal((await f.call('/api/display', { vistaId: vista.id, revision: 1 })).status, 409);
  const payload = (await f.call('/api/display')).body;
  assert.equal(payload.vista.id, vista.id);
  assert.doesNotMatch(JSON.stringify(payload), /token|vistaId|taskActions/);
  await f.restart();
  assert.equal((await f.call('/api/display')).body.vista.id, vista.id);
  const selected = f.app.vistas.displaySnapshot();
  await f.call(`/api/vistas/${vista.id}/enabled`, { revision: vista.revision, enabled: false });
  assert.equal((await f.call('/api/display')).body.vista, null, 'disabled targets are pollable empty displays');
  assert.deepEqual(f.app.vistas.displaySnapshot(), selected, 'missing targets retain their identity');
  assert.equal((await f.call('/api/vistas/living-room')).status, 404);
  assert.equal((await f.call('/api/display', { vistaId: vista.id, revision: selected.revision })).status, 409);
  await f.call(`/api/vistas/${vista.id}/enabled`, { revision: vista.revision + 1, enabled: true });
  assert.equal((await f.call('/api/display')).body.vista.id, vista.id);
  const before = f.app.vistas.displaySnapshot();
  const write = f.app.vistas.display.write;
  f.app.vistas.display.write = async () => { throw new Error('disk failure'); };
  await assert.rejects(f.app.vistas.show(vista.id), /disk failure/);
  assert.deepEqual(f.app.vistas.displaySnapshot(), before);
  f.app.vistas.display.write = write;
});

test('Show Vista Tasks support Timer, ordered Delay, pause, cancellation and unavailable targets', async t => {
  const f = await fixture(t);
  await f.call('/api/vistas', { ...definition(), name: 'First', slug: 'first', enabled: true });
  await f.call('/api/vistas', { ...definition(), name: 'Second', slug: 'second', enabled: true });
  const [first, second] = f.app.vistas.snapshot();
  const show = (id, vistaId) => ({ id, type: 'show-vista', enabled: true, vistaId });
  const runTask = { name: 'Switch display', enabled: true, starts: [], steps: [show('one', first.id),
    { id: 'delay', type: 'delay', enabled: true, seconds: 0.25 }, show('two', second.id)] };
  assert.equal((await f.call('/api/tasks', { ...runTask, steps: [show('one', 'unknown')] })).status, 400);
  assert.equal((await f.call('/api/tasks', runTask)).status, 200);
  const task = f.app.tasks.snapshot()[0];
  assert.equal((await f.call(`/api/tasks/${task.id}/run`, {})).status, 202);
  const waitFor = async predicate => {
    const deadline = Date.now() + 4000;
    while (!predicate()) { if (Date.now() > deadline) throw new Error('Display Task did not settle'); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  await waitFor(() => f.app.vistas.displaySnapshot().vistaId === first.id);
  await f.app.engine.setPaused(true);
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(f.app.vistas.displaySnapshot().vistaId, first.id, 'pause prevents the next Vista change');
  await f.app.engine.setPaused(false);
  await waitFor(() => f.app.engine.active.size === 0);
  assert.equal(f.app.vistas.displaySnapshot().vistaId, second.id);
  assert.equal(f.app.state.snapshot().runs[0].status, 'completed');
  await f.call(`/api/tasks/${task.id}/run`, {});
  await waitFor(() => f.app.vistas.displaySnapshot().vistaId === first.id);
  f.app.engine.cancel(f.app.state.snapshot().runs[0].id);
  await waitFor(() => f.app.engine.active.size === 0);
  assert.equal(f.app.vistas.displaySnapshot().vistaId, first.id);
  assert.equal(f.app.state.snapshot().runs[0].status, 'cancelled');
  const timer = { name: 'Timer display', enabled: true, starts: [{ id: 'timer', type: 'timer', name: 'Timer', enabled: true, seconds: 1 }], steps: [show('show', second.id)] };
  assert.equal((await f.call('/api/tasks', timer)).status, 200);
  await f.app.engine.tick(new Date(Date.now() + 2000));
  await waitFor(() => f.app.engine.active.size === 0 && f.app.engine.pending.size === 0);
  assert.equal(f.app.vistas.displaySnapshot().vistaId, second.id);
  await f.call(`/api/vistas/${second.id}/enabled`, { revision: second.revision, enabled: false });
  assert.equal((await f.call(`/api/tasks/${task.id}/run`, {})).status, 409);
  await f.call(`/api/vistas/${second.id}/delete`, { revision: second.revision + 1 });
  assert.equal((await f.call(`/api/tasks/${task.id}`, { ...task, name: 'Retained missing target' })).status, 200);
  assert.equal((await f.call(`/api/tasks/${task.id}/run`, {})).status, 409);
});

test('Vista validation bounds layout complexity and rejects CSS/script injection', () => {
  for (const size of ['30%', '240px', '1.5fr', '20rem', '10em', '100vh', '40vw', '80vmin', '50vmax', 'auto']) assert.equal(dimension(size), size);
  for (const size of ['0px', '-2fr', 'calc(100% - 1px)', '1px;background:red', 'url(secret)', 'Infinitypx', '10001px']) assert.throws(() => dimension(size));
  const draft = definition();
  draft.layout.children = [node('row', 'row')];
  draft.layout.children[0].children = [{ ...node('collection', 'collection'), cards: [{ pluginId: 'simulator', cardId: 'first' }, { pluginId: 'simulator', cardId: 'second' }] }];
  assert.equal(validateVista(draft).layout.children[0].children[0].cards.length, 2);
  assert.throws(() => validateVista({ ...draft, slug: '../private' }));
  assert.throws(() => validateVista({ ...draft, script: 'alert(1)' }));
  const duplicate = structuredClone(draft);
  duplicate.layout.children.push(node('row'));
  assert.throws(() => validateVista(duplicate), /identities/);
  const large = definition();
  large.layout.children = Array.from({ length: 200 }, (_, index) => node(`child-${index}`, 'card'));
  assert.throws(() => validateVista(large), /200/);
  const deep = definition(); let parent = deep.layout;
  for (let index = 0; index < 9; index++) { parent.children.push(node(`nested-${index}`)); parent = parent.children[0]; }
  assert.throws(() => validateVista(deep), /nesting/);
  const duplicateMembers = structuredClone(draft);
  duplicateMembers.layout.children[0].children[0].cards.push({ pluginId: 'simulator', cardId: 'first' });
  assert.throws(() => validateVista(duplicateMembers), /once/);
});

test('viewer projection includes only enabled referenced card fields, with no admin data', async t => {
  const f = await fixture(t);
  const catalog = [{ id: 'shown', type: 'string' }, { id: 'hidden', type: 'string' }];
  const card = { id: 'first', name: 'Public', enabled: true, fields: [{ id: 'a', binding: 'shown', enabled: true }, { id: 'b', binding: 'hidden', enabled: false }] };
  f.app.registry.services = () => [{ id: 'example', config: { token: 'private-token' }, pluginState: { private: 'private-state' }, cards: [card, { ...card, id: 'disabled', enabled: false }], cardCatalog: catalog,
    cardData: { pluginName: 'Example', icon: 'plug', status: 'Ready', values: { shown: { value: 'Hello', type: 'string', available: true }, hidden: { value: 'hidden-value' } } } }];
  const draft = { ...definition(), enabled: true };
  draft.layout.children = [{ ...node('cards', 'collection'), cards: [{ pluginId: 'example', cardId: 'first' }, { pluginId: 'example', cardId: 'disabled' }, { pluginId: 'gone', cardId: 'missing' }] }];
  await f.call('/api/vistas', draft);
  const response = await f.call('/api/vistas/living-room');
  const serialized = JSON.stringify(response.body);
  assert.doesNotMatch(serialized, /private-token|private-state|hidden-value|"token"|"listen"|"tasks"|"location"/);
  assert.equal(response.body.cards[0].card.fields.length, 1);
  assert.equal(response.body.cards[0].catalog.length, 1);
  assert.equal(response.body.cards[1].unavailable, 'Card disabled');
  assert.equal(response.body.cards[2].unavailable, 'Card unavailable');
});

test('collection timing persists through polling and changes only on bound data updates', async () => {
  const source = await fs.readFile(new URL('../web/vista-renderer.js', import.meta.url), 'utf8');
  const renderer = vm.runInNewContext(source + '\nVistaRenderer;', {});
  const collection = { ...node('collection', 'collection'), cards: [{ pluginId: 'plugin', cardId: 'a' }, { pluginId: 'plugin', cardId: 'b' }] };
  function entry(cardId, value = 1, other = 0) { return { pluginId: 'plugin', cardId, card: { fields: [{ binding: 'value', enabled: true }] }, data: { status: 'Ready', values: { value, other } } }; }
  let entries = new Map([['plugin/a', entry('a')], ['plugin/b', entry('b')]]);
  let choice = renderer.choose(collection, entries, null, 0);
  assert.equal(choice.selected, 'plugin/a');
  choice = renderer.choose(collection, entries, choice, 4000);
  assert.equal(choice.nextAt, 5000);
  choice = renderer.choose(collection, entries, choice, 5000);
  assert.equal(choice.selected, 'plugin/b');
  assert.equal(choice.nextAt, 10000);
  entries.set('plugin/a', entry('a', 1, 123));
  choice = renderer.choose(collection, entries, choice, 6000);
  assert.equal(choice.selected, 'plugin/b', 'Unbound data does not interrupt the collection');
  entries.set('plugin/a', entry('a', 2));
  choice = renderer.choose(collection, entries, choice, 6500);
  assert.equal(choice.selected, 'plugin/a');
  assert.equal(choice.nextAt, 11500);
  choice = renderer.choose({ ...collection, rotation: 'update' }, entries, choice, 20000);
  assert.equal(choice.selected, 'plugin/a', 'Update-only mode has no timer rotation');
  entries.delete('plugin/a');
  choice = renderer.choose(collection, entries, choice, 21000);
  assert.equal(choice.selected, 'plugin/b', 'Removed/disabled cards are skipped');
  assert.equal(renderer.choose(collection, new Map(), choice, 22000).selected, null);
});

test('Vista minute countdown advances from server time between polls and freezes when disconnected', async () => {
  let now = 0, tick;
  const element = () => ({ style: { setProperty(key, value) { this[key] = value; } }, dataset: {}, children: [], firstElementChild: null,
    append(child) { this.children.push(child); }, replaceChildren(child) { this.children = [child]; } });
  const context = vm.createContext({ Intl, Date, URL, performance: { now: () => now },
    document: { createElement: element }, window: {}, setInterval: callback => { tick = callback; return 1; }, clearInterval() {} });
  vm.runInContext(await fs.readFile(new URL('../web/card-renderer.js', import.meta.url), 'utf8'), context);
  const renderer = vm.runInContext(await fs.readFile(new URL('../web/vista-renderer.js', import.meta.url), 'utf8') + '\nVistaRenderer;', context);
  const epoch = Date.parse('2026-10-13T12:00:00Z');
  const host = element();
  const payload = { vista: { gap: 0, padding: 0, layout: { ...node('root'), children: [
    { ...node('slot', 'card'), cards: [{ pluginId: 'hsl-trains', cardId: 'board' }] },
  ] } }, options: { now: epoch }, cards: [{ pluginId: 'hsl-trains', cardId: 'board',
    card: { name: 'Trains', layout: 'table', fields: [{ binding: 'trains', enabled: true }],
      listOptions: { rows: 1, fontSize: 14, noWrap: true, columns: ['in-minutes'] } },
    data: { values: { trains: { type: 'table', available: true, value: [{ 'in-minutes': epoch + 61000 }] } } },
    catalog: [{ id: 'trains', type: 'table', columns: [{ id: 'in-minutes', label: 'In', type: 'timestamp', format: 'minutes-until' }] }],
  }] };
  const controller = renderer.create(host);
  controller.update(payload);
  const slot = host.children[0].children[0];
  assert.match(slot.innerHTML, /data-countdown-at="\d+">2 min<\/span>/);
  now = 2000; tick();
  assert.match(slot.innerHTML, /data-countdown-at="\d+">1 min<\/span>/);
  controller.update({ ...payload, options: { ...payload.options, connected: false } });
  now = 62000; tick();
  assert.match(slot.innerHTML, /data-countdown-at="\d+">1 min<\/span>/);
  controller.destroy();
});

test('List collection update rotation ignores unselected columns and rows', async () => {
  const source = await fs.readFile(new URL('../web/vista-renderer.js', import.meta.url), 'utf8');
  const renderer = vm.runInNewContext(source + '\nVistaRenderer;', {});
  const entry = id => ({ pluginId: 'news', cardId: id,
    card: { layout: 'table', listOptions: { rows: 1, columns: ['title'] }, fields: [{ binding: 'articles', enabled: true }] },
    data: { status: 'Ready', values: { articles: { type: 'table', available: true,
      value: [{ title: 'Visible', date: 1 }, { title: 'Hidden row', date: 1 }] } } } });
  const entries = new Map([['news/a', entry('a')], ['news/b', entry('b')]]);
  const collection = { ...node('news', 'collection'), rotation: 'update', cards: [{ pluginId: 'news', cardId: 'a' }, { pluginId: 'news', cardId: 'b' }] };
  const initial = renderer.choose(collection, entries, null, 0);
  const rows = entries.get('news/b').data.values.articles.value;
  rows[0].date = 2;
  rows[1].title = 'Still hidden';
  const unchanged = renderer.choose(collection, entries, initial, 1);
  assert.equal(unchanged.selected, 'news/a');
  rows[0].title = 'Visible update';
  assert.equal(renderer.choose(collection, entries, unchanged, 2).selected, 'news/b');
});

test('Random collection transitions persist through saving, restart, and viewer projection', async t => {
  const f = await fixture(t);
  const draft = { ...definition(), enabled: true };
  draft.layout.children = [{ ...node('random', 'collection'), animation: 'random' }];
  assert.equal((await f.call('/api/vistas', draft)).status, 200);
  await f.restart();
  const saved = f.app.vistas.snapshot()[0];
  assert.equal(saved.layout.children[0].animation, 'random');
  assert.equal((await f.call('/api/vistas/living-room')).body.vista.layout.children[0].animation, 'random');
  assert.equal(saved.layout.children[0].durationMs, 500);
});

test('Random transitions choose supported animations without repeating the previous style', async () => {
  const source = await fs.readFile(new URL('../web/vista-renderer.js', import.meta.url), 'utf8');
  const renderer = vm.runInNewContext(source + '\nVistaRenderer;', {});
  const supported = ['fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom', 'flip'];
  for (const previous of [undefined, ...supported]) {
    for (const sample of [0, 0.2, 0.5, 0.999999]) {
      const chosen = renderer.resolveTransition('random', previous, () => sample);
      assert.ok(supported.includes(chosen));
      assert.notEqual(chosen, previous);
    }
  }
  assert.equal(renderer.resolveTransition('slide-left', 'slide-left'), 'slide-left');
  assert.equal(renderer.resolveTransition('none', 'fade'), 'none');
});

async function editorFixture() {
  const source = await fs.readFile(new URL('../web/vistas-ui.js', import.meta.url), 'utf8');
  let identity = 0;
  const errors = [];
  const context = {
    state: { services: [
      { id: 'example', name: 'Example', icon: 'plug', cards: [
        { id: 'one', name: 'News', icon: 'inherit', enabled: true },
        { id: 'two', name: 'Weather', icon: 'none', enabled: false },
      ] },
      { id: 'layout', name: 'Other', icon: 'plug', cards: [{ id: 'one', name: 'Other card', icon: 'inherit', enabled: true }] },
    ] },
    crypto: { randomUUID: () => `created-${++identity}` }, structuredClone,
    document: { addEventListener() {} },
    icon: name => `<i class="ms-${name}"></i>`,
    escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]),
    showFormError: message => errors.push(message),
  };
  const editor = vm.runInNewContext(await fs.readFile(new URL('../web/admin-ux.js',import.meta.url),'utf8') + '\n' + source + '\nVistaUI;', context);
  editor.draft = definition(); editor.targetId = editor.draft.layout.id;
  // Exercise real insertion/selection logic without creating a browser, live
  // cards, or plugin events. DOM-only refresh is irrelevant to these decisions.
  editor.refreshTree = () => {};
  return { editor, errors };
}

test('card library adds blocks to the chosen container and cards to empty collections in order', async () => {
  const { editor, errors } = await editorFixture();
  await editor.handleAction('vista-library-layout', null, { dataset: { type: 'row' } });
  const row = editor.draft.layout.children[0];
  assert.equal(editor.targetId, row.id);
  await editor.handleAction('vista-library-card', 'one', { dataset: { plugin: 'example' } });
  assert.equal(row.children[0].name, 'News');
  assert.equal(row.children[0].cards[0].pluginId, 'example');
  editor.insertion = 'first';
  await editor.handleAction('vista-library-layout', null, { dataset: { type: 'collection' } });
  const collection = row.children[0];
  assert.equal(collection.type, 'collection');
  assert.equal(collection.cards.length, 0, 'Collections do not acquire an arbitrary default card');
  assert.equal(editor.targetId, collection.id);
  await editor.handleAction('vista-library-card', 'one', { dataset: { plugin: 'example' } });
  editor.insertion = 'first';
  await editor.handleAction('vista-library-card', 'two', { dataset: { plugin: 'example' } });
  assert.equal(collection.cards.map(card => card.cardId).join(','), 'two,one');
  await editor.handleAction('vista-library-card', 'one', { dataset: { plugin: 'example' } });
  assert.match(errors.at(-1), /already/);
  assert.equal(collection.cards.length, 2);
  await editor.handleAction('vista-library-layout', null, { dataset: { type: 'column' } });
  assert.match(errors.at(-1), /row or column/);
  const saved = validateVista(editor.readDraft());
  assert.equal(saved.layout.children[0].children[0].cards.length, 2);
  row.children.splice(0, 1);
  assert.equal(editor.target().id, editor.draft.layout.id, 'Removing a selected container falls back to the root');
  editor.insertion = 'after:removed';
  editor.insert(editor.target(), editor.newNode('card'));
  assert.equal(editor.draft.layout.children.at(-1).type, 'card');
});

test('card-library filters/search are editor-only, plugin categories cannot collide, and properties start collapsed', async () => {
  const { editor } = await editorFixture();
  const before = JSON.stringify(editor.readDraft());
  editor.libraryCategory = 'plugin:example';
  editor.librarySearch = 'weather';
  const matching = editor.libraryRows();
  assert.match(matching, /Weather/);
  assert.doesNotMatch(matching, /News|Other card|Add Row/);
  editor.libraryCategory = 'layout'; editor.librarySearch = '';
  assert.match(editor.libraryRows(), /Add Card collection/);
  assert.doesNotMatch(editor.libraryRows(), /Other card/);
  const html = editor.nodeEditor(editor.draft.layout, true);
  assert.match(html, /vista-node-properties task-block-fields" hidden/);
  assert.doesNotMatch(html, /class="task-block[ "']/);
  editor.expanded.add(editor.draft.layout.id);
  editor.insertion = 'first';
  assert.equal(JSON.stringify(editor.readDraft()), before, 'Search, selection, expansion, and placement do not mark a draft dirty');
});
