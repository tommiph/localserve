/** Card persistence/projection checks use only isolated Localserve roots.
 * The shared renderer is evaluated without a browser or administrator globals.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createLocalserve } from '../server.mjs';
import { validateDeclaration } from '../server/plugins.mjs';

const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../plugins/simulator/', import.meta.url));

async function fixture(t) {
  await fs.mkdir(temporaryRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'cards-'));
  const folder = path.join(root, 'plugins', 'simulator');
  await fs.mkdir(path.join(folder, 'server'), { recursive: true });
  for (const file of ['declaration.json', 'server/index.mjs']) await fs.copyFile(path.join(sourceRoot, file), path.join(folder, file));
  let app = await createLocalserve(root, { automatic: false });
  async function call(endpoint, values) {
    const response = await fetch(app.origin + endpoint, values === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.origin, 'X-Localserve-Token': app.snapshot().token },
      body: JSON.stringify(values),
    });
    return { status: response.status, body: await response.json() };
  }
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(temporaryRoot) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    root, folder, call, get app() { return app; },
    service: () => app.registry.services()[0],
    async restart() { await app.close(); app = await createLocalserve(root, { automatic: false }); },
    async enable() {
      const config = app.registry.services()[0].config;
      assert.equal((await call('/api/plugins/simulator/config', { revision: config.revision, enabled: true })).status, 200);
    },
    action: (actionId, parameters = {}) => call(`/api/plugins/simulator/actions/${actionId}`, { parameters }),
  };
}

function definition(name = 'Overview') {
  return { schemaVersion: 1, name, enabled: false, icon: 'inherit', size: 'medium', layout: 'grid', fields: [
    { id: 'current', binding: 'value', label: 'Value', enabled: true, icon: 'auto', format: 'number', unit: 'units', decimals: 2 },
    { id: 'status', binding: 'plugin-status', label: 'Status', enabled: true, icon: 'auto', format: 'auto', unit: '', decimals: 0 },
  ] };
}

test('public card-field declarations validate sources, identity, and payload types', async () => {
  const raw = JSON.parse(await fs.readFile(path.join(sourceRoot, 'declaration.json'), 'utf8'));
  const plugin = validateDeclaration(raw);
  assert.equal(plugin.cardFields.length, 9);
  for (const cardFields of [
    [raw.cardFields[0], raw.cardFields[0]],
    [{ ...raw.cardFields[0], id: 'plugin-name' }],
    [{ ...raw.cardFields[0], source: { kind: 'file', key: 'auth.json' } }],
    [{ ...raw.cardFields[0], source: { kind: 'state', key: '../secret' } }],
    [{ ...raw.cardFields[0], source: { kind: 'event', eventId: 'signal', key: 'message' } }],
    [{ ...raw.cardFields[0], source: { kind: 'event-time', eventId: 'signal' } }],
  ]) assert.throws(() => validateDeclaration({ ...raw, cardFields }));
});

test('card CRUD saves only in the plugin folder, uses revisions, and survives restart', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.service().cards, []);
  assert.equal((await f.call('/api/plugins/simulator/cards', definition())).status, 200);
  const first = f.service().cards[0];
  assert.equal(first.revision, 1);
  assert.equal(first.enabled, false);
  assert.equal(first.showHeader, true, 'Older definitions default to visible chrome');
  assert.equal(first.showFooter, true);
  assert.equal(first.crop, false, 'Older definitions keep scrolling');
  assert.equal(f.service().enabled, false, 'Creating cards never enables the plugin');
  const file = path.join(f.folder, 'data/cards.json');
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).cards, [first]);
  assert.equal((await f.call('/plugins/simulator/data/cards.json')).status, 404);
  const endpoint = `/api/plugins/simulator/cards/${first.id}`;
  assert.equal((await f.call(endpoint, { ...first, name: 'Renamed', showHeader: false, showFooter: false, crop: true, fields: [...first.fields].reverse() })).status, 200);
  assert.equal((await f.call(endpoint, { ...first, name: 'Stale' })).status, 409);
  const edited = f.service().cards[0];
  assert.equal(edited.fields[0].binding, 'plugin-status');
  assert.equal((await f.call(endpoint + '/enabled', { revision: edited.revision, enabled: true })).status, 200);
  const enabled = f.service().cards[0];
  assert.equal((await f.call('/api/plugins/simulator/cards', { ...enabled, name: 'Copy', enabled: false })).status, 200);
  assert.notEqual(f.service().cards[1].id, first.id);
  assert.equal(f.service().cards[1].enabled, false);
  await f.restart();
  assert.equal(f.service().cards.length, 2);
  assert.equal(f.service().cards[0].enabled, true);
  assert.equal(f.service().cards[0].name, 'Renamed');
  assert.equal(f.service().cards[0].showHeader, false);
  assert.equal(f.service().cards[0].showFooter, false);
  assert.equal(f.service().cards[1].showHeader, false, 'Copies preserve visibility choices');
  assert.equal(f.service().cards[1].showFooter, false);
  assert.equal(f.service().cards[0].crop, true);
  assert.equal(f.service().cards[1].crop, true, 'Copies preserve cropping');
  const copy = f.service().cards[1];
  assert.equal((await f.call(`/api/plugins/simulator/cards/${copy.id}/delete`, { revision: copy.revision })).status, 200);
  assert.equal(f.service().cards.length, 1);
});

test('legacy templates load without rewriting files or revisions and gain visible defaults on save', async t => {
  const f = await fixture(t);
  await f.call('/api/plugins/simulator/cards', definition());
  await f.app.close();
  const file = path.join(f.folder, 'data/cards.json');
  const stored = JSON.parse(await fs.readFile(file, 'utf8'));
  delete stored.cards[0].showHeader;
  delete stored.cards[0].showFooter;
  delete stored.cards[0].crop;
  const legacy = JSON.stringify(stored);
  await fs.writeFile(file, legacy);
  await f.restart();
  assert.equal(f.service().cardsError, '');
  assert.equal(await fs.readFile(file, 'utf8'), legacy);
  const card = f.service().cards[0];
  assert.equal(card.revision, 1);
  assert.equal((await f.call(`/api/plugins/simulator/cards/${card.id}`, { ...card, name: 'Legacy edited' })).status, 200);
  assert.equal(f.service().cards[0].showHeader, true);
  assert.equal(f.service().cards[0].showFooter, true);
  assert.equal(f.service().cards[0].crop, false);
});

test('card validation rejects undeclared bindings, extra properties, malformed fields, and incompatible formats', async t => {
  const f = await fixture(t);
  const base = definition();
  const cases = [
    { ...base, schemaVersion: 2 }, { ...base, html: '<script>bad()</script>' },
    { ...base, name: '' }, { ...base, size: 'enormous' }, { ...base, icon: 'unknown' },
    { ...base, showHeader: 'false' }, { ...base, showFooter: null },
    { ...base, crop: 'false' }, { ...base, crop: 1 }, { ...base, crop: null },
    { ...base, fields: [] }, { ...base, fields: Array(17).fill(base.fields[0]) },
    { ...base, fields: [{ ...base.fields[0], binding: 'auth-password' }] },
    { ...base, fields: [{ ...base.fields[0], format: 'relative' }] },
    { ...base, fields: [{ ...base.fields[0], decimals: -1 }] },
    { ...base, fields: [{ ...base.fields[0], decimals: 1.5 }] },
    { ...base, fields: [{ ...base.fields[0], source: { kind: 'file' } }] },
    { ...base, fields: [base.fields[0], base.fields[0]] },
  ];
  for (const value of cases) assert.equal((await f.call('/api/plugins/simulator/cards', value)).status, 400, JSON.stringify(value));
  assert.deepEqual(f.service().cards, []);
  assert.equal((await f.call('/api/plugins/simulator/cards', base)).status, 200);
  assert.equal((await f.call('/api/plugins/simulator/cards', base)).status, 409);
});

test('public projections report actual values/events and honest missing states without private configuration', async t => {
  const f = await fixture(t);
  assert.equal(f.service().cardData.values.value.available, false, 'No fabricated initial zero');
  assert.equal(f.service().cardData.values['signal-message'].available, false);
  assert.equal(f.service().cardData.status, 'Disabled');
  await f.enable();
  await f.action('set-value', { value: 42.5 });
  await f.action('set-value', { value: 50 });
  await f.action('emit-signal', { message: 'Actual signal' });
  await f.action('pulse');
  const projected = f.service().cardData;
  assert.equal(projected.values.value.value, 50);
  assert.equal(projected.values['previous-value'].value, 42.5);
  assert.equal(projected.values['pulse-count'].value, 1);
  assert.equal(projected.values['signal-message'].value, 'Actual signal');
  assert.equal(projected.values['signal-time'].available, true);
  assert.equal(projected.values['recent-log'].value.length, 5);
  assert.equal(projected.status, 'Ready');
  assert.equal(Object.hasOwn(projected, 'config'), false);
  assert.equal(Object.hasOwn(projected, 'pluginState'), false);
  assert.equal(Object.hasOwn(projected, 'token'), false);
  await f.app.engine.setPaused(true);
  assert.equal(f.service().cardData.status, 'Paused');
  await f.restart();
  assert.equal(f.service().cardData.values.value.value, 50);
  assert.equal(f.service().cardData.values['signal-message'].value, 'Actual signal');
});

test('invalid card storage is retained without disabling the runtime', async t => {
  const f = await fixture(t);
  await f.enable();
  await f.app.close();
  const file = path.join(f.folder, 'data/cards.json');
  await fs.writeFile(file, '{invalid');
  await f.restart();
  assert.equal(f.service().health, 'ready');
  assert.ok(f.service().cardsError);
  assert.equal(await fs.readFile(file, 'utf8'), '{invalid');
  assert.equal((await f.call('/api/plugins/simulator/cards', definition())).status, 409);
  assert.equal((await f.action('pulse')).status, 200);
});

test('concurrent edits cannot overwrite one revision and missing fields retain definitions', async t => {
  const f = await fixture(t);
  await f.call('/api/plugins/simulator/cards', definition());
  const original = f.service().cards[0];
  const endpoint = `/api/plugins/simulator/cards/${original.id}`;
  const results = await Promise.all([
    f.call(endpoint, { ...original, name: 'First editor' }),
    f.call(endpoint, { ...original, name: 'Second editor' }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const declarationFile = path.join(f.folder, 'declaration.json');
  const declaration = JSON.parse(await fs.readFile(declarationFile, 'utf8'));
  declaration.cardFields = declaration.cardFields.filter(field => field.id !== 'value');
  // This ordinary-Card test deliberately retires a public field. Retire its
  // installed fixed designs too, so the edited declaration remains valid.
  declaration.cardTemplates = declaration.cardTemplates?.filter(template => !template.slots.some(slot => slot.field === 'value'));
  await fs.writeFile(declarationFile, JSON.stringify(declaration));
  await f.app.registry.discover();
  assert.equal(f.service().health, 'idle', 'Display-only declaration edits do not restart the runtime');
  const card = f.service().cards[0];
  assert.equal(card.fields[0].binding, 'value');
  assert.equal(f.service().cardData.values.value, undefined);
  assert.equal((await f.call(endpoint, { ...card, name: 'Retained missing field' })).status, 200);
});

test('shared renderer escapes content, formats values, and needs no administrator globals', async () => {
  const source = await fs.readFile(new URL('../web/card-renderer.js', import.meta.url), 'utf8');
  const renderer = vm.runInNewContext(source + '\nCardRenderer;', { Intl, Date });
  const card = definition('<img src=x onerror=bad()>');
  const catalog = [{ id: 'value', type: 'number', icon: 'gauge' }, { id: 'plugin-status', type: 'string', icon: 'plug' }];
  const data = { icon: 'plug', pluginName: '<script>bad()</script>', status: 'Ready', values: {
    value: { type: 'number', available: true, value: 42.5 },
    'plugin-status': { type: 'string', available: true, value: '<button>Bad</button>' },
  } };
  const html = renderer.render(card, data, catalog, { locale: 'en-US', timeZone: 'UTC', timeFormat: '24', now: 0 });
  assert.match(html, /42\.50/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;button/);
  assert.match(html, /tabindex="0"/);
  assert.doesNotMatch(html, /display-card-crop/);
  const cropped = renderer.render({ ...card, crop: true }, data, catalog, {});
  assert.match(cropped, /display-card-crop/);
  assert.doesNotMatch(cropped, /tabindex/);
  assert.match(cropped, /42[.,]50/);
  assert.doesNotMatch(html, /<script|<img|<button|fetch\(/);
  assert.match(renderer.render(card, data, catalog, { connected: false }), /Disconnected/);
  assert.match(renderer.render(card, data, [], {}), /Unavailable field/);
  assert.match(renderer.render(card, { ...data, values: {} }, catalog, {}), /No data/);
  for (const showHeader of [true, false]) {
    for (const showFooter of [true, false]) {
      const output = renderer.render({ ...card, showHeader, showFooter }, data, catalog, {});
      assert.equal(output.includes('<header'), showHeader);
      assert.equal(output.includes('<footer'), showFooter);
      assert.match(output, /42[.,]50/);
      assert.match(output, /aria-label="&lt;img/, 'Hidden headers retain an accessible card name');
    }
  }
  card.fields = [{ ...card.fields[0], binding: 'time', format: 'datetime', unit: '' }];
  const time = { type: 'timestamp', available: true, value: Date.UTC(2026, 9, 12, 19) };
  const timeData = { ...data, values: { time } }, timeCatalog = [{ id: 'time', type: 'timestamp', icon: 'clock' }];
  assert.match(renderer.render(card, timeData, timeCatalog, { locale: 'en-US', timeZone: 'UTC', timeFormat: '24' }), /19:00/);
  assert.match(renderer.render(card, timeData, timeCatalog, { locale: 'en-US', timeZone: 'UTC', timeFormat: '12' }), /7:00\s*PM/i);
});
