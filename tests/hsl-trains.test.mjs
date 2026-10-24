/** Synthetic timetables/disposable roots only; no installed data or upstream. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createLocalserve } from '../server.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { validateValues } from '../server/plugin-schema.mjs';
import { createTrainsAdapter, parseTrains, boardUrl, stationCode } from '../plugins/hsl-trains/server/index.mjs';

const source = fileURLToPath(new URL('../plugins/hsl-trains/', import.meta.url));
const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
const baseTime = Date.parse('2026-10-13T12:00:00Z');
const iso = offset => new Date(baseTime + offset * 60000).toISOString();
const location = (overrides = {}) => ({ id: 'kerava', name: 'Kerava → Pasila', station: 'KE',
  direction: 'departures', 'other-station': 'PSL', line: '', category: 'Commuter',
  'advance-minutes': 2, enabled: true, ...overrides });
const settings = (locations = [location()]) => ({ 'poll-minutes': 1, locations });
const row = (station, type, offset, overrides = {}) => ({ stationShortCode: station, type,
  scheduledTime: iso(offset), trainStopping: true, commercialStop: true, commercialTrack: '4', ...overrides });
function train(number = 101, overrides = {}) {
  return { trainNumber: number, departureDate: '2026-10-13', trainCategory: 'Commuter', commuterLineID: 'K',
    cancelled: false, timeTableRows: [row('KE', 'DEPARTURE', 1), row('PSL', 'ARRIVAL', 25),
      row('PSL', 'DEPARTURE', 26), row('HKI', 'ARRIVAL', 31)], ...overrides };
}
function host(initial = {}, controller = new AbortController()) {
  let state = structuredClone(initial);
  const calls = [];
  return { signal: controller.signal, calls,
    readState: async () => structuredClone(state),
    saveState: async next => { controller.signal.throwIfAborted(); state = structuredClone(next); calls.push(['save']); },
    emit: async (id, payload) => { calls.push(['event', id, payload]); },
    log: async (...values) => calls.push(['log', ...values]),
  };
}
const events = context => context.calls.filter(call => call[0] === 'event');

test('declarations, offline readiness, Finnish station aliases and fixed HTTPS request', async () => {
  const raw = JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8'));
  const plugin = validateDeclaration(raw);
  assert.equal(plugin.name, 'HSL Trains');
  assert.equal(plugin.cardFields.filter(field => field.type === 'table').length, 1);
  assert.ok(plugin.settings[1].fields.find(field => field.id === 'station').suggestions.length > 200);
  assert.equal(stationCode(' Kerava '), 'KE');
  assert.equal(stationCode('Pasila asema'), 'PSL');
  assert.equal(stationCode('hki'), 'HKI');
  assert.equal(stationCode('https://evil.invalid'), null);
  const url = new URL(boardUrl(location()));
  assert.equal(url.origin, 'https://rata.digitraffic.fi');
  assert.equal(url.pathname, '/api/v1/live-trains/station/KE');
  assert.equal(url.searchParams.get('include_nonstopping'), 'false');
  assert.equal(url.searchParams.get('train_categories'), 'Commuter');
  assert.equal(new URL(boardUrl(location({ category: 'passenger' }))).searchParams.get('train_categories'), 'Commuter,Long-distance');
  let requests = 0;
  const adapter = createTrainsAdapter({ now: () => baseTime, fetchImpl: async (url, options) => {
    requests += 1;
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['Digitraffic-User'], 'Localserve-HSL-Trains/1.0');
    assert.equal(options.headers['Accept-Encoding'], 'gzip');
    return Response.json([train()]);
  } });
  assert.equal(adapter.validateConfiguration(settings([])), false);
  assert.equal(adapter.validateConfiguration(settings([location({ station: 'https://x' })])), false);
  assert.equal(adapter.validateConfiguration(settings([location({ 'other-station': 'KE' })])), false);
  assert.equal(adapter.validateConfiguration(settings([location({ 'advance-minutes': -1 })])), false);
  await adapter.start(settings());
  assert.equal(requests, 0);
  const context = host();
  await adapter.execute('refresh', {}, context);
  assert.equal(requests, 1);
  assert.equal(context.calls[0][0], 'save');
  for (const [, id, payload] of events(context)) validateValues(plugin.events.find(event => event.id === id).payload, payload);
  assert.deepEqual(events(context).map(call => call[1]), ['train-departing', 'train-arriving-or-departing']);
});

test('boards filter line/category/direct-route direction and exclude passing/noncommercial stops', () => {
  const reverse = train(102, { timeTableRows: [row('HKI', 'DEPARTURE', -20), row('PSL', 'ARRIVAL', -15),
    row('PSL', 'DEPARTURE', -14), row('KE', 'ARRIVAL', 1), row('KE', 'DEPARTURE', 2)] });
  const rLine = train(103, { commuterLineID: 'R' });
  const passing = train(104, { timeTableRows: [row('KE', 'DEPARTURE', 1, { trainStopping: false }), row('PSL', 'ARRIVAL', 10)] });
  const noncommercial = train(105, { timeTableRows: [row('KE', 'DEPARTURE', 1), row('PSL', 'ARRIVAL', 10, { commercialStop: false })] });
  const cargo = train(106, { trainCategory: 'Cargo' });
  const data = [train(), reverse, rLine, passing, noncommercial, cargo];
  const departures = parseTrains(data, location({ line: 'K' }), baseTime);
  assert.deepEqual(departures.movements.map(item => item.trainNumber), [101]);
  assert.equal(departures.reading['train-1-route'], 'To Pasila asema');
  assert.equal(departures.reading['train-1-arrives'], baseTime + 25 * 60000);
  assert.equal(parseTrains([train()], location({ 'other-station': '' }), baseTime).reading['train-1-arrives'], baseTime + 31 * 60000);
  const arrivals = parseTrains(data, location({ direction: 'arrivals', line: 'K' }), baseTime);
  assert.deepEqual(arrivals.movements.map(item => item.trainNumber), [102]);
  assert.equal(arrivals.reading['train-1-route'], 'From Pasila asema');
  assert.equal(arrivals.reading['train-1-arrives'], baseTime + 60000);
  assert.equal(parseTrains(data, location({ direction: 'both', line: 'K' }), baseTime).movements.length, 2);
  const bounded = parseTrains(Array.from({ length: 20 }, (_, index) => train(200 + index)), location(), baseTime).reading;
  assert.equal(bounded['train-count'], 10);
  assert.equal(bounded['train-11-time'], undefined);
});

test('destination arrival uses its own estimate/actual, preserves missing data and selects the onward loop visit', () => {
  const data = train();
  const reading = () => parseTrains([data], location(), baseTime).reading['train-1-arrives'];
  data.timeTableRows[1].liveEstimateTime = iso(27);
  assert.equal(reading(), baseTime + 27 * 60000);
  data.timeTableRows[1].unknownDelay = true;
  assert.equal(reading(), null);
  data.timeTableRows[1].actualTime = iso(28);
  assert.equal(reading(), baseTime + 28 * 60000);
  data.timeTableRows[1].cancelled = true;
  assert.equal(reading(), null);
  data.timeTableRows[1].cancelled = false;
  data.cancelled = true;
  assert.equal(reading(), null);
  data.cancelled = false;
  data.timeTableRows[1] = row('PSL', 'DEPARTURE', 26);
  assert.equal(reading(), null, 'A departure row cannot substitute for arrival');
  const loop = train(102, { timeTableRows: [row('PSL', 'ARRIVAL', -30), row('PSL', 'DEPARTURE', -29),
    row('KE', 'DEPARTURE', 1), row('PSL', 'ARRIVAL', 25), row('HKI', 'ARRIVAL', 31)] });
  assert.equal(parseTrains([loop], location(), baseTime).reading['train-1-arrives'], baseTime + 25 * 60000);
});

test('missing estimates, unknown delay, cancellation and reception are explicit', () => {
  const data = train();
  data.timeTableRows[0].unknownDelay = true;
  data.timeTableRows[0].liveEstimateTime = iso(2);
  const result = parseTrains([data], location(), baseTime);
  assert.equal(result.reading['train-1-time'], null);
  assert.equal(result.reading['train-1-status'], 'Delay unknown');
  assert.equal(result.reading['updated-at'], baseTime);
  assert.equal(result.movements[0].expected, null);
  assert.equal(result.reading['train-1-due-at'], null);
  const cancelled = parseTrains([train(103, { cancelled: true })], location(), baseTime);
  assert.equal(cancelled.reading['train-1-status'], 'Cancelled');
  assert.equal(cancelled.reading['train-1-due-at'], null);
  const empty = parseTrains([], location(), baseTime).reading;
  assert.equal(empty['train-count'], 0);
  assert.equal(empty['train-1-train'], null);
  assert.throws(() => parseTrains({}, location()));
  const malformed = train(); malformed.timeTableRows[0].scheduledTime = '12:01';
  assert.throws(() => parseTrains([malformed], location()), /scheduled time/);
});

test('upcoming/confirmed/both events, movement claims, estimate corrections, restart and no catch-up', async () => {
  let clock = baseTime;
  let response = [train()];
  const adapter = createTrainsAdapter({ now: () => clock, fetchImpl: async () => Response.json(response) });
  await adapter.start(settings());
  const context = host();
  await adapter.execute('refresh', {}, context);
  assert.equal(events(context).length, 2);
  response[0].timeTableRows[0].liveEstimateTime = iso(1.5);
  await adapter.execute('refresh', {}, context);
  await adapter.stop(); await adapter.start(settings([location({ name: 'Renamed' })]));
  await adapter.execute('refresh', {}, context);
  assert.equal(events(context).length, 2);
  clock = baseTime + 2 * 60000;
  response[0].timeTableRows[0].actualTime = iso(1.5);
  await adapter.execute('refresh', {}, context);
  assert.deepEqual(events(context).slice(-2).map(call => call[1]), ['train-departed', 'train-arrived-or-departed']);
  assert.equal(events(context).at(-1)[2]['time-basis'], 'actual');
  await adapter.execute('refresh', {}, context);
  assert.equal(events(context).length, 4);
  response = [train(102, { timeTableRows: [row('KE', 'DEPARTURE', 1, { actualTime: iso(1) }), row('PSL', 'ARRIVAL', 30)] })];
  clock += 10 * 60000;
  await adapter.execute('refresh', {}, context);
  assert.equal(events(context).length, 4, 'Offline confirmed movements are not replayed');
  response = [train(103, { cancelled: true }), train(104)];
  response[1].timeTableRows[0].unknownDelay = true;
  clock = baseTime;
  await adapter.execute('refresh', {}, context);
  assert.equal(events(context).length, 4, 'Cancelled/unknown movements do not emit upcoming events');
});

test('all arrival event variants and wrong direction exclusion', async () => {
  let data = [train(101, { timeTableRows: [row('PSL', 'DEPARTURE', -20), row('KE', 'ARRIVAL', 1)] })];
  let clock = baseTime;
  const adapter = createTrainsAdapter({ now: () => clock, fetchImpl: async () => Response.json(data) });
  await adapter.start(settings([location({ direction: 'arrivals' })]));
  const context = host();
  await adapter.execute('refresh', {}, context);
  assert.deepEqual(events(context).map(call => call[1]), ['train-arriving', 'train-arriving-or-departing']);
  clock += 1.5 * 60000; data[0].timeTableRows[1].actualTime = iso(1);
  await adapter.execute('refresh', {}, context);
  assert.deepEqual(events(context).slice(-2).map(call => call[1]), ['train-arrived', 'train-arrived-or-departed']);
});

test('excessive same-window movements cannot evict their own claims before emission', async () => {
  const data = train(101, { timeTableRows: [
    ...Array.from({ length: 301 }, () => row('KE', 'DEPARTURE', 1)), row('PSL', 'ARRIVAL', 30),
  ] });
  const adapter = createTrainsAdapter({ now: () => baseTime, fetchImpl: async () => Response.json([data]) });
  await adapter.start(settings());
  const previous = { locations: { kerava: { 'train-count': 1 } } };
  const context = host(previous);
  await assert.rejects(adapter.execute('refresh', {}, context), /more than 300/);
  assert.deepEqual(context.calls, []);
  assert.deepEqual(await context.readState(), previous);
});

test('transport/parser failures preserve readings and claims; cancellation uses no revoked host writes', async () => {
  for (const transport of [async () => new Response('Rate limit', { status: 429 }),
    async () => new Response('redirect', { status: 302 }), async () => Response.json({ error: 'bad' }),
    async () => new Response('not json'), async () => new Response(Uint8Array.from([255])),
    async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)),
    async () => { throw new Error('Network failed'); }]) {
    let requests = 0;
    const adapter = createTrainsAdapter({ fetchImpl: (...args) => { requests += 1; return transport(...args); } });
    await adapter.start(settings());
    const previous = { locations: { kerava: { 'train-count': 1 } }, monitoring: { kerava: { claims: [] } } };
    const context = host(previous);
    await assert.rejects(adapter.execute('refresh', {}, context));
    assert.deepEqual(await context.readState(), previous);
    assert.equal(requests, 1);
    assert.equal(context.calls[0][0], 'log');
  }
  const controller = new AbortController();
  const adapter = createTrainsAdapter({ fetchImpl: (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    controller.abort(new Error('Cancelled'));
  }) });
  await adapter.start(settings());
  const context = host({}, controller);
  await assert.rejects(adapter.execute('refresh', {}, context), /Cancelled/);
  assert.deepEqual(context.calls, []);
});

async function fixture(t) {
  await fs.mkdir(temporaryRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'hsl-trains-'));
  const folder = path.join(root, 'plugins/hsl-trains');
  await fs.mkdir(path.join(folder, 'server'), { recursive: true });
  await fs.copyFile(path.join(source, 'server/index.mjs'), path.join(folder, 'server/index.mjs'));
  await fs.copyFile(path.join(source, 'stations.json'), path.join(folder, 'stations.json'));
  const declaration = JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8'));
  declaration.runtime.entry = 'server/test-entry.mjs';
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(declaration));
  const response = (data = [train()], now = baseTime, status = 200) => fs.writeFile(path.join(folder, 'server/response.json'), JSON.stringify({ data, now, status }));
  await response();
  await fs.writeFile(path.join(folder, 'server/test-entry.mjs'), `
import fs from 'node:fs/promises';
import { createTrainsAdapter } from './index.mjs';
let clock = 0;
export default createTrainsAdapter({ now: () => clock, fetchImpl: async url => {
  if (new URL(url).origin !== 'https://rata.digitraffic.fi') throw new Error('Wrong origin');
  const fixture = JSON.parse(await fs.readFile(new URL('./response.json', import.meta.url), 'utf8'));
  clock = fixture.now;
  return Response.json(fixture.data, { status: fixture.status });
} });`);
  let app = await createLocalserve(root, { automatic: false });
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(temporaryRoot) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  const service = () => app.registry.services()[0];
  const call = async (endpoint, values) => {
    const response = await fetch(app.origin + endpoint, values === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.origin, 'X-Localserve-Token': app.snapshot().token },
      body: JSON.stringify(values),
    });
    return { status: response.status, body: await response.json() };
  };
  return { root, folder, response, service, call, get app() { return app; },
    save: values => call('/api/plugins/hsl-trains/config', { revision: service().config.revision, ...values }),
    action: id => call('/api/plugins/hsl-trains/actions/refresh', { parameters: { 'location-id': id ?? 'kerava' } }),
    async restart() { await app.close(); app = await createLocalserve(root, { automatic: false }); },
  };
}
async function settle(f) {
  const deadline = Date.now() + 5000;
  while (f.app.engine.active.size || f.app.engine.pending.size) {
    if (Date.now() > deadline) throw new Error('Trains Task did not settle');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('installed boards, consecutive K Task occurrences, restart, revision guards and private state', async t => {
  const f = await fixture(t);
  assert.equal(f.service().enabled, false);
  assert.equal(f.service().configurationReady, false);
  assert.equal((await f.save({ enabled: true, settings: settings() })).status, 200);
  const task = await f.call('/api/tasks', { name: 'K departing Kerava', enabled: true,
    starts: [{ id: 'rule', name: 'Event', type: 'event', enabled: true,
      eventId: 'plugin:hsl-trains:event:train-departing:kerava', condition: { field: 'line', operator: 'eq', value: 'K' } }],
    steps: [{ id: 'log', type: 'log', enabled: true, message: 'K departing' }],
  });
  assert.equal(task.status, 200, JSON.stringify(task.body));
  assert.equal((await f.action()).status, 200); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 1);
  await f.action(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 1);
  await f.response([train(102)]); await f.action(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 2, 'Consecutive K movements both trigger');
  await f.restart(); await f.action(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 2);
  const captured = f.service().config.revision;
  await f.save({ settings: settings([location({ name: 'Renamed' })]) });
  assert.equal((await f.call('/api/plugins/hsl-trains/config', { revision: captured, settings: settings() })).status, 409);
  await f.action(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 2);
  assert.ok(f.service().cardData.values['kerava:trains'].available);
  assert.equal(f.service().cardData.values['kerava:trains'].value[0].train, 'K');
  await assert.rejects(fs.stat(path.join(f.root, 'data/plugins/hsl-trains')), /ENOENT/);
  assert.equal((await fetch(f.app.origin + '/plugins/hsl-trains/data/state.json')).status, 404);
  const before = structuredClone(f.service().pluginState);
  await f.response([], baseTime, 429); assert.equal((await f.action()).status, 409);
  assert.deepEqual(f.service().pluginState, before);
});

test('List cards and Vistas project chosen train columns/rows with global time format', async t => {
  const f = await fixture(t);
  await f.save({ enabled: true, settings: settings() });
  await f.response(Array.from({ length: 12 }, (_, index) => train(300 + index)));
  await f.action();
  const definition = { schemaVersion: 1, name: 'Departures', enabled: true, icon: 'inherit', size: 'medium', layout: 'table',
    listOptions: { rows: 2, fontSize: 14, noWrap: true, columns: ['train', 'time', 'arrives', 'in-minutes'] },
    fields: [{ id: 'trains-field', binding: 'kerava:trains', label: 'Trains', enabled: true,
      icon: 'none', format: 'auto', unit: '', decimals: 0 }] };
  assert.equal((await f.call('/api/plugins/hsl-trains/cards', definition)).status, 200);
  const card = f.service().cards[0];
  const vista = { schemaVersion: 1, name: 'Trains', slug: 'trains', enabled: true, gap: 0, padding: 0,
    layout: { id: 'root', name: 'Canvas', type: 'column', enabled: true, width: '1fr', height: '1fr', children: [
      { id: 'slot', name: 'Trains', type: 'card', enabled: true, width: '1fr', height: '1fr', cards: [{ pluginId: 'hsl-trains', cardId: card.id }] },
    ] } };
  assert.equal((await f.call('/api/vistas', vista)).status, 200);
  const publicCard = (await f.call('/api/vistas/trains')).body.cards[0];
  const rows = publicCard.data.values['kerava:trains'].value;
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]), ['train', 'time', 'arrives', 'in-minutes']);
  assert.equal(rows[0].arrives, baseTime + 25 * 60000);
  assert.doesNotMatch(JSON.stringify(publicCard), /monitoring|movement-id|claims|advance-minutes|token/);
  const renderer = vm.runInNewContext(await fs.readFile(new URL('../web/card-renderer.js', import.meta.url), 'utf8') + '\nCardRenderer;', { Intl, Date, URL });
  const output = renderer.render(publicCard.card, publicCard.data, publicCard.catalog, { locale: 'en-GB', timeZone: 'Europe/Helsinki', timeFormat: '24', now: baseTime });
  assert.match(output, /15:01/);
  assert.match(output, /15:25/);
  assert.match(output, /data-countdown-at="\d+">1 min<\/span>/);
  assert.doesNotMatch(output, /13 Oct|Oct 13|2026/);
  assert.match(renderer.render(publicCard.card, publicCard.data, publicCard.catalog, { locale: 'en-GB', timeZone: 'Europe/Helsinki', timeFormat: '12' }), /3:01 pm/);
  const table = f.service().cardCatalog.find(field => field.id === 'kerava:trains');
  assert.deepEqual(table.columns.map(column => column.id), ['train', 'route', 'track', 'status', 'time', 'arrives', 'in-minutes']);
  const oldOrder = { ...publicCard.card, listOptions: { ...publicCard.card.listOptions,
    columns: ['arrives', 'in-minutes', 'train', 'route', 'time', 'track', 'status'] } };
  const oldOutput = renderer.render(oldOrder, f.service().cardData, [table], { locale: 'en-GB', timeZone: 'Europe/Helsinki' });
  assert.deepEqual([...oldOutput.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map(match => match[1]),
    ['Train', 'Direction / route', 'Track', 'Status', 'Time', 'Arrives', 'In']);
  assert.doesNotMatch(oldOutput, /13 Oct|Oct 13|2026/);
  const tableDefinition = JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8'));
  const rawTable = tableDefinition.cardFields.find(field => field.id === 'trains');
  for (const invalid of [
    [{ key: '../private', type: 'timestamp' }],
    [{ key: 'constructor', type: 'timestamp' }],
    rawTable.source.cellFields.map(cell => ({ ...cell, type: 'string' })),
    Array(61).fill({ key: 'arrives', type: 'timestamp' }),
  ]) {
    const changed = structuredClone(tableDefinition);
    changed.cardFields.find(field => field.id === 'trains').source.cellFields = invalid;
    assert.throws(() => validateDeclaration(changed));
  }
  const hiddenFooter = renderer.render({ ...publicCard.card, showFooter: false }, publicCard.data, publicCard.catalog);
  assert.match(hiddenFooter, /Fintraffic \/ Digitraffic/);
  assert.match(hiddenFooter, /CC BY 4.0/);
  assert.doesNotMatch(hiddenFooter, /<footer/);
  assert.doesNotMatch(renderer.render(publicCard.card, { ...publicCard.data,
    attribution: { ...publicCard.data.attribution, url: 'javascript:alert(1)' } }, publicCard.catalog), /javascript:/);
});

test('minute countdown rounds future time up, reaches zero and updates only displayed text', async () => {
  const renderer = vm.runInNewContext(await fs.readFile(new URL('../web/card-renderer.js', import.meta.url), 'utf8') + '\nCardRenderer;', { Intl, Date, URL });
  const catalogue = [{ id: 'trains', label: 'Trains', type: 'table', columns: [
    { id: 'in-minutes', label: 'In', type: 'timestamp', format: 'minutes-until' },
  ] }];
  const card = { layout: 'table', fields: [{ binding: 'trains', enabled: true }],
    listOptions: { rows: 1, fontSize: 14, noWrap: true, columns: ['in-minutes'] } };
  for (const [seconds, expected] of [[61, 2], [60, 1], [15, 1], [0, 0], [-60, 0]]) {
    const data = { values: { trains: { type: 'table', available: true, value: [{ 'in-minutes': baseTime + seconds * 1000 }] } } };
    assert.match(renderer.render(card, data, catalogue, { now: baseTime }), new RegExp(`data-countdown-at="\\d+">${expected} min<`));
  }
  const missing = { values: { trains: { type: 'table', available: true, value: [{ 'in-minutes': null }] } } };
  assert.match(renderer.render(card, missing, catalogue, { now: baseTime }), /No data/);
  const element = { dataset: { countdownAt: String(baseTime + 61000) }, textContent: '2' };
  const root = { querySelectorAll: () => [element] };
  renderer.updateCountdowns(root, baseTime + 2000);
  assert.equal(element.textContent, '1 min');
  assert.equal(element.dataset.countdownAt, String(baseTime + 61000));
  renderer.updateCountdowns(root, baseTime + 62000);
  assert.equal(element.textContent, '0 min');
});

test('two-board polling staggers, serializes and isolates refresh/failure/disabled bindings', async t => {
  const f = await fixture(t);
  const locations = [location(), location({ id: 'pasila', name: 'Pasila', station: 'PSL', 'other-station': '', direction: 'arrivals' })];
  assert.equal((await f.save({ enabled: true, settings: settings(locations) })).status, 200);
  const record = f.app.registry.get('hsl-trains');
  assert.ok(record.instancePolls.get('pasila').nextAt - record.instancePolls.get('kerava').nextAt >= 29900);
  f.app.registry.pollDue(record.pollDueAt);
  f.app.registry.pollDue(record.pollDueAt + 1000000);
  await record.pollOperation;
  assert.equal(f.service().pluginActivity.filter(entry => entry.message.startsWith('Trains refreshed')).length, 1);
  const kerava = structuredClone(f.service().pluginState.locations.kerava);
  const keravaDue = record.instancePolls.get('kerava').nextAt;
  await f.action('pasila');
  assert.deepEqual(f.service().pluginState.locations.kerava, kerava);
  assert.equal(record.instancePolls.get('kerava').nextAt, keravaDue);
  assert.ok(f.service().cardData.values['pasila:trains'].available);
  await f.response([], baseTime, 429);
  assert.equal((await f.action('pasila')).status, 409);
  assert.ok(record.instancePolls.get('pasila').nextAt >= Date.now() + 59900);
  assert.deepEqual(f.service().pluginState.locations.kerava, kerava);
  await f.app.engine.setPaused(true);
  f.app.registry.pollDue(record.pollDueAt + 1000000);
  assert.equal(record.pending, 0);
  await f.app.engine.setPaused(false);
  await f.save({ settings: settings([locations[0], { ...locations[1], enabled: false }]) });
  assert.equal(f.service().cardData.values['pasila:trains'].available, false);
  assert.equal(record.instancePolls.has('pasila'), false);
});

test('twenty boards with maximum retained Unicode movement claims fit the snapshot bound', async () => {
  const locations = Array.from({ length: 20 }, (_, index) => location({ id: `board-${index}`, name: `Board ${index}` }));
  const previous = { locations: {}, monitoring: {} };
  for (const item of locations) {
    previous.locations[item.id] = parseTrains(Array.from({ length: 10 }, (_, index) => train(500 + index)), item, baseTime).reading;
    previous.monitoring[item.id] = { receivedAt: baseTime, claims: Array.from({ length: 400 }, (_, index) => ({
      key: `confirmed/2026-10-13/${100000 + index}/${'界'.repeat(8)}/departure/999`, at: baseTime,
    })) };
  }
  const adapter = createTrainsAdapter({ now: () => baseTime, fetchImpl: async () => Response.json([]) });
  await adapter.start(settings(locations));
  const context = host(previous);
  for (const item of locations) await adapter.execute('refresh', { 'location-id': item.id }, context);
  const saved = await context.readState();
  for (const board of Object.values(saved.monitoring)) assert.equal(board.claims.length, 300);
  assert.ok(Buffer.byteLength(JSON.stringify(saved), 'utf8') < 1048576);
});

test('shared station suggestions and occurrence-aware Task UI remain declaration-driven', async () => {
  const raw = JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8'));
  const plugin = validateDeclaration(raw);
  for (const event of plugin.events) assert.equal(event.occurrenceKey, 'movement-id');
  const invalid = structuredClone(raw); invalid.events[0].occurrenceKey = 'line';
  assert.throws(() => validateDeclaration(invalid), /occurrenceKey/);
  const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const context = { document: { addEventListener() {} }, escapeHtml, icon: () => '' };
  const ui = vm.runInNewContext(await fs.readFile(new URL('../web/plugin-ui.js', import.meta.url), 'utf8') + '\nPluginUI;', context);
  const station = plugin.settings[1].fields.find(field => field.id === 'station');
  const html = ui.field(station, 'KE', 'test');
  assert.match(html, /datalist/);
  assert.match(html, /Kerava asema \(KE\)/);
  const sandbox = { document: { addEventListener() {} }, escapeHtml, icon: () => '', crypto: { randomUUID: () => 'test' },
    state: { taskEvents: [{ ...plugin.events[0], id: 'event' }] } };
  const tasks = vm.runInNewContext(await fs.readFile(new URL('../web/tasks-ui.js', import.meta.url), 'utf8') + '\nTaskUI;', sandbox);
  // The shared Event helper describes occurrences with provider-neutral wording.
  assert.match(tasks.eventConditionFields({ eventId: 'event', condition: { field: 'line', operator: 'eq', value: 'K' } }), /distinct matching occurrence/);
});
