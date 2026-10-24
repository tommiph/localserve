/** Synthetic Fingrid replies only; installed secrets/provider/device services
 * are never contacted. Integration fixtures own disposable Localserve roots. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, mapMetadata, mapLatest, validDatasetId } from '../plugins/fingrid/server/client.mjs';
import { createFingridAdapter, effectiveInterval, recentBudget } from '../plugins/fingrid/server/index.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { createLocalserve } from '../server.mjs';
import { validateCard, selectedCardData, projectCardData, cardCatalog } from '../server/cards.mjs';
import { overviewValues } from '../plugins/fingrid/server/overview.mjs';
const key = 'a'.repeat(31), start = Date.parse('2026-10-14T10:00:00Z');
const declaration = JSON.parse(await fs.readFile(new URL('../plugins/fingrid/declaration.json', import.meta.url), 'utf8'));
const settings = () => ({ 'api-key': key, 'api-paused': false, 'poll-minutes': 3, language: 'en', datasets: [
  { id: 'consumption', name: 'Consumption', query: '193', enabled: true },
  { id: 'wind', name: 'Wind', query: '181', enabled: false },
] });
const metadata = (id = '193') => ({ id: Number(id), type: 'timeseries', status: 'active', nameEn: 'Consumption', nameFi: 'Kulutus',
  unitEn: 'MW', unitFi: 'MW', descriptionEn: 'Reported data', dataPeriodEn: '3 min', organization: 'Fingrid', license: { name: 'Creative Commons Attribution' } });
const latest = (value = 10000, at = start, id = '193') => ({ datasetId: Number(id), value, startTime: new Date(at).toISOString(), endTime: new Date(at).toISOString() });
function environment(initial = {}) {
  let state = structuredClone(initial), at = start;
  const controller = new AbortController(), events = [], writes = [], calls = [], waits = [];
  let result = latest(), failure = null;
  const context = { signal: controller.signal, readState: async () => structuredClone(state),
    saveState: async value => { controller.signal.throwIfAborted(); state = structuredClone(value); writes.push(structuredClone(state)); },
    wait: async seconds => { controller.signal.throwIfAborted(); waits.push(seconds); at += seconds * 1000; }, log: async () => {},
    emit: async (id, payload) => events.push({ id, payload, state: structuredClone(state) }) };
  const client = { async read(id, kind) { calls.push({ id, kind, at, spent: recentBudget(state.budget, at).count }); if (failure) throw failure;
    return kind === 'metadata' ? metadata(id) : { ...result, datasetId: Number(id) }; } };
  return { context, controller, client, events, calls, writes, waits, get state() { return state; }, get at() { return at; },
    now: () => at, advance: milliseconds => { at += milliseconds; }, reading: data => { result = data; }, fail: error => { failure = error; } };
}

test('declaration and parsing keep IDs, metadata, finite values and reported periods explicit', async () => {
  const declared = validateDeclaration(declaration);
  assert.equal(declared.id, 'fingrid'); assert.equal(declared.settings[0].format, 'secret');
  assert.ok(!declared.cardFields.some(field => field.source?.key === 'api-key'));
  assert.ok(validDatasetId('193')); assert.ok(!validDatasetId('0')); assert.ok(!validDatasetId('../193'));
  assert.equal(mapMetadata(metadata(), '193', 'fi')['dataset-title'], 'Kulutus');
  assert.equal(mapLatest(latest(-2, start + 86400000), '193').value, -2, 'Forecast periods and signed values are not relabelled');
  for (const data of [{ ...latest(), value: '' }, { ...latest(), value: Infinity }, { ...latest(), datasetId: 192 },
    { ...latest(), startTime: '2026-10-14 10:00' }, { ...latest(), endTime: '2026-10-14T09:00:00Z' }]) assert.throws(() => mapLatest(data, '193'));
  assert.throws(() => mapMetadata({ ...metadata(), type: 'file' }, '193'));
  const env = environment(), adapter = createFingridAdapter({ client: env.client, now: env.now });
  assert.equal(adapter.validateConfiguration(settings()), true);
  const inactive = settings(); inactive.datasets[1].query = 'bad'; assert.equal(adapter.validateConfiguration(inactive), true);
  await adapter.start(settings()); await adapter.stop(); assert.equal(env.calls.length, 0, 'Lifecycle is offline');
});

test('fixed transport masks credential echoes and bounds redirects, UTF-8 and JSON size', async () => {
  const seen = [];
  let reply = () => new Response(JSON.stringify(latest()), { headers: { 'content-type': 'application/json' } });
  const client = createClient(async (url, options) => { seen.push({ url, options }); return reply(); });
  const signal = new AbortController().signal;
  await client.read('193', 'latest', key, signal);
  assert.equal(seen[0].url, 'https://data.fingrid.fi/api/datasets/193/data/latest');
  assert.equal(seen[0].options.headers['x-api-key'], key); assert.ok(!seen[0].url.includes(key)); assert.equal(seen[0].options.redirect, 'manual');
  reply = () => new Response('', { status: 302, headers: { Location: 'https://example.com' } }); await assert.rejects(client.read('193', 'latest', key, signal), /HTTP 302/);
  reply = () => new Response('x'.repeat(512 * 1024 + 1), { headers: { 'content-type': 'application/json' } }); await assert.rejects(client.read('193', 'latest', key, signal), /512 KiB/);
  reply = () => new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }); await assert.rejects(client.read('193', 'latest', key, signal), /UTF-8 JSON/);
  reply = () => { throw new Error(key); }; await assert.rejects(client.read('193', 'latest', key, signal), error => !error.message.includes(key));
});

test('baseline, correction/history bounds, reservations and occurrence claims precede events', async () => {
  const env = environment(), adapter = createFingridAdapter({ client: env.client, now: env.now }); await adapter.start(settings());
  await adapter.execute('refresh', { 'source-id': 'consumption' }, env.context);
  assert.deepEqual(env.events.map(event => event.id), ['reading-updated']);
  assert.equal(env.calls.length, 2); assert.ok(env.calls[1].at - env.calls[0].at >= 2100); assert.ok(env.calls.every(call => call.spent > 0));
  env.advance(4 * 60000); env.reading(latest(0)); await adapter.execute('refresh', {}, env.context);
  assert.equal(env.state.datasets.consumption['sample-count'], 1, 'Same-period correction replaces its sample');
  const changed = env.events.find(event => event.id === 'value-changed');
  assert.equal(changed.payload.value, 0); assert.equal(changed.payload['previous-value'], 10000);
  assert.equal(changed.state.datasets.consumption.sequence, 2); assert.equal(changed.payload['reading-id'], '193:2');
  for (let i = 0; i < 12; i++) { env.advance(4 * 60000); env.reading(latest(i, env.at)); await adapter.execute('refresh', {}, env.context); }
  assert.equal(env.state.datasets.consumption.history.length, 10); assert.equal(env.state.datasets.consumption['sample-count'], 10);
  assert.equal(env.calls.filter(call => call.kind === 'metadata').length, 1, 'Metadata is cached');
  const before = env.events.length; await adapter.stop(); await adapter.start(settings()); env.advance(4 * 60000);
  await adapter.execute('refresh', {}, env.context); assert.equal(env.events.length, before + 1, 'Restart does not replay value change');
});

test('pause, failed/older responses, changed IDs and corrected keys retain proper baselines and spend', async () => {
  const env = environment(), adapter = createFingridAdapter({ client: env.client, now: env.now }); await adapter.start(settings());
  await adapter.execute('refresh', {}, env.context);
  const receipt = env.state.datasets.consumption['received-at'];
  await adapter.stop(); await adapter.start({ ...settings(), 'api-paused': true }); env.advance(4 * 60000);
  await adapter.execute('refresh', {}, env.context); assert.equal(env.calls.length, 2); assert.equal(env.state.datasets.consumption['received-at'], receipt);
  await adapter.stop(); await adapter.start(settings()); env.fail(Object.assign(new Error('Fingrid request failed (HTTP 403).'), { status: 403 }));
  await assert.rejects(adapter.execute('refresh', {}, env.context)); assert.equal(env.state.datasets.consumption.value, 10000);
  assert.ok(env.state.blockedUntil > env.at); const spent = recentBudget(env.state.budget, env.at).count;
  env.fail(null); await adapter.stop(); await adapter.start({ ...settings(), 'api-key': 'b'.repeat(31) });
  env.reading(latest(7, start - 60000)); await assert.rejects(adapter.execute('refresh', {}, env.context), /older period/);
  assert.ok(recentBudget(env.state.budget, env.at).count > spent);
  const changed = settings(); changed.datasets[0].query = '177'; await adapter.stop(); await adapter.start(changed);
  env.advance(4 * 60000); env.reading(latest(50, env.at)); const count = env.events.filter(event => event.id === 'value-changed').length;
  await adapter.execute('refresh', {}, env.context);
  assert.equal(env.state.datasets.consumption['dataset-id'], 177); assert.equal(env.state.datasets.consumption.history.length, 1);
  assert.equal(env.events.filter(event => event.id === 'value-changed').length, count, 'New source baselines');
});

test('rolling request budget and rate-limit blocks survive refresh without immediate requests', async () => {
  const hour = Math.floor(start / 3600000);
  const env = environment({ budget: { [hour]: 9000 } }), adapter = createFingridAdapter({ client: env.client, now: env.now }); await adapter.start(settings());
  await assert.rejects(adapter.execute('refresh', {}, env.context), /budget reached/); assert.equal(env.calls.length, 0);
  await adapter.execute('refresh', {}, env.context); assert.equal(env.calls.length, 0);
  assert.equal(recentBudget({ [hour - 24]: 3, [hour - 25]: 4 }, start).count, 3);
  assert.ok(effectiveInterval({ ...settings(), datasets: Array.from({ length: 20 }, () => ({ enabled: true })) }) > 3 * 60000);
  const rate = environment(), second = createFingridAdapter({ client: rate.client, now: rate.now }); await second.start(settings());
  rate.fail(Object.assign(new Error('Fingrid request failed (HTTP 429).'), { status: 429, retryMs: 120000 }));
  await assert.rejects(second.execute('refresh', {}, rate.context)); const calls = rate.calls.length;
  await second.execute('refresh', {}, rate.context); assert.equal(rate.calls.length, calls);
});

test('cancelled late responses preserve reserved spend without reception or event commits', async () => {
  const env = environment(); const client = { async read(id, kind) {
    if (kind === 'latest') env.controller.abort(new Error('Cancelled'));
    return kind === 'metadata' ? metadata(id) : latest();
  } };
  const adapter = createFingridAdapter({ client, now: env.now }); await adapter.start(settings());
  await assert.rejects(adapter.execute('refresh', {}, env.context), /Cancelled/);
  assert.equal(env.events.length, 0); assert.equal(env.state.datasets.consumption['received-at'], undefined);
  assert.equal(recentBudget(env.state.budget, env.at).count, 2);
});

test('Grid projects only declared overview fields through its selected source', async () => {
  const env = environment(), adapter = createFingridAdapter({ client: env.client, now: env.now }); await adapter.start(settings());
  await adapter.execute('refresh', {}, env.context);
  const plugin = validateDeclaration(declaration);
  const record = { configured: true, health: 'ready', config: { snapshot: () => ({ enabled: true, settings: settings() }) },
    state: { snapshot: () => ({ ...env.state, datasets: { ...env.state.datasets, wind: { value: 123456789, description: 'UNRELATED SOURCE' } } }) }, log: { latest: () => [] } };
  const card = validateCard({ schemaVersion: 1, layout: 'readymade', templateId: 'grid', sourceId: 'consumption', enabled: true }, plugin, null, settings());
  const projection = selectedCardData(card, projectCardData(plugin, record), cardCatalog(plugin, settings()));
  assert.doesNotMatch(JSON.stringify(projection), new RegExp(key + '|keyFingerprint|nextRequestAt|UNRELATED SOURCE|123456789'));
  assert.equal(projection.data.values['consumption:grid-consumption'].value, 10000);
  assert.equal(projection.data.values['consumption:grid-production'].available, false);
  assert.equal(projection.data.values['consumption:readings'], undefined, 'The simplified Card projects no history table');
  assert.equal(Object.keys(projection.data.values).length, 16);
});

test('overview uses enabled exact dataset identities/units, preserves frequency precision and oldest reported times', () => {
  const config = settings(); config.datasets = [
    { id: 'p', query: '192', enabled: true }, { id: 'c', query: '193', enabled: true },
    { id: 'f', query: '177', enabled: true }, { id: 'w', query: '181', enabled: false },
  ];
  const reading = (query, value, unit, at) => ({ query, value, unit, 'period-end': at, 'received-at': at + 1000 });
  const state = { datasets: { p: reading('192', 9000, 'MW', start), c: reading('193', 10000, 'MW', start + 60000),
    f: reading('177', 50.017, 'Hz', start + 120000), w: reading('181', 2000, 'MW', start) } };
  let overview = overviewValues(config, state);
  assert.equal(overview['grid-production'], 9000); assert.equal(overview['grid-consumption'], 10000);
  assert.equal(overview['grid-frequency'], 50.017); assert.equal(overview['grid-wind'], null);
  assert.equal(overview['grid-period-end'], start); assert.equal(overview['grid-received-at'], start + 1000);
  state.datasets.p.unit = 'MWh/h'; state.datasets.c.query = '124'; state.datasets.f.value = null;
  overview = overviewValues(config, state);
  assert.equal(overview['grid-production'], null); assert.equal(overview['grid-production-unit'], null);
  assert.equal(overview['grid-consumption'], null); assert.equal(overview['grid-frequency'], null);
  assert.equal(overview['grid-period-end'], null);
});

test('supervised lifecycle, masked Settings, source-only Cards and typed Tasks operate without external reads', async t => {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url)); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'fingrid-')), folder = path.join(root, 'plugins/fingrid');
  await fs.cp(new URL('../plugins/fingrid/', import.meta.url), folder, { recursive: true, filter: source => !source.includes(path.sep + 'data') });
  const fake = structuredClone(declaration); fake.runtime.entry = 'server/test-entry.mjs'; await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(fake));
  await fs.mkdir(path.join(folder, 'data'), { recursive: true });
  const sampleFile = path.join(folder, 'data/sample.json');
  await fs.writeFile(sampleFile, JSON.stringify({ at: start, metadata: metadata(), latest: latest() }));
  await fs.writeFile(path.join(folder, 'server/test-entry.mjs'), `import fs from 'node:fs';
import {createFingridAdapter} from './index.mjs';
const sample=()=>JSON.parse(fs.readFileSync(new URL('../data/sample.json',import.meta.url),'utf8'));
export default createFingridAdapter({now:()=>sample().at,client:{read:async(id,kind)=>sample()[kind]}});
`);
  const app = await createLocalserve(root, { automatic: false });
  t.after(async () => { await app.close(); assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  await app.registry.saveConfiguration('fingrid', { revision: 1, enabled: true, settings: settings() });
  assert.equal(app.registry.services()[0].settings.find(field => field.id === 'api-key').format, 'secret');
  const response = await fetch(app.origin + '/api/tasks', { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json', 'X-Localserve-Token': app.snapshot().token },
    body: JSON.stringify({ name: 'Fingrid value', enabled: true, starts: [{ id: 'rule', type: 'event', name: 'Event', enabled: true,
      eventId: 'plugin:fingrid:event:value-changed:consumption', condition: { field: 'value', operator: 'gte', value: 0 } }],
      steps: [{ id: 'log', type: 'log', enabled: true, message: 'Observed Fingrid change' }] }) });
  assert.equal(response.status, 200, await response.text());
  const settle = async () => { const until = Date.now() + 5000; while (app.engine.active.size || app.engine.pending.size) {
    if (Date.now() > until) throw new Error('Task did not settle'); await new Promise(resolve => setTimeout(resolve, 10)); } };
  await app.registry.execute('fingrid', 'refresh', { 'source-id': 'consumption' }); await settle(); assert.equal(app.state.snapshot().runs.length, 0);
  await fs.writeFile(sampleFile, JSON.stringify({ at: start + 4 * 60000, metadata: metadata(), latest: latest(1, start + 4 * 60000) }));
  await app.registry.execute('fingrid', 'refresh', { 'source-id': 'consumption' }); await settle(); assert.equal(app.state.snapshot().runs.length, 1);
  await fs.writeFile(sampleFile, JSON.stringify({ at: start + 8 * 60000, metadata: metadata(), latest: latest(2, start + 8 * 60000) }));
  await app.registry.execute('fingrid', 'refresh', { 'source-id': 'consumption' }); await settle(); assert.equal(app.state.snapshot().runs.length, 2);
  await app.registry.saveCard('fingrid', { schemaVersion: 1, layout: 'readymade', templateId: 'grid', sourceId: 'consumption', enabled: false });
  const service = app.registry.services()[0]; assert.equal(service.cards[0].enabled, false);
  assert.ok(!JSON.stringify(service.cardData).includes(key)); assert.ok(!JSON.stringify(service.cardData).includes('keyFingerprint'));
  assert.equal((await fetch(app.origin + '/plugins/fingrid/data/config.json')).status, 404);
  const asset = await fetch(app.origin + '/plugin-card-assets/fingrid/grid/card.html'); assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-security-policy'), /script-src 'none'/); assert.doesNotMatch(await asset.text(), /<script/);
});
