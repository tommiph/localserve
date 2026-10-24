/** Injected wttr.in responses and isolated workers; never query external services. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createLocalserve } from '../server.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { createWeatherAdapter, parseWeather, locationQuery } from '../plugins/weather/server/index.mjs';

function locationSettings(query, minutes = 60) {
  return { 'poll-minutes': minutes, locations: query.trim()
    ? [{ id: 'legacy-city', name: 'Kerava', query, enabled: true }] : [] };
}

const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
const source = fileURLToPath(new URL('../plugins/weather/', import.meta.url));
const sample = {
  current_condition: [{ temp_C: '6', FeelsLikeC: '2', humidity: '91', cloudcover: '100',
    precipMM: '0.1', pressure: '1015', uvIndex: '0', visibility: '10', weatherCode: '176',
    weatherDesc: [{ value: 'Patchy rain nearby' }], winddir16Point: 'NE', windspeedKmph: '21',
    observation_time: '04:44 PM', weatherIconUrl: [{ value: 'https://example.invalid/image.png' }] }],
  nearest_area: [{ areaName: [{ value: 'Sompio' }], region: [{ value: 'Southern Finland' }], country: [{ value: 'Finland' }] }],
  weather: [{ hourly: [{ tempC: '7' }] }],
};

function context(controller = new AbortController()) {
  const calls = [];
  let state = { 'requested-city': 'Old city', 'temperature-c': 10, 'updated-at': 123 };
  return {
    signal: controller.signal, calls,
    readState: async () => structuredClone(state),
    saveState: async value => { controller.signal.throwIfAborted(); calls.push('save'); state = value; },
    log: async (message, level) => { calls.push(['log', message, level]); },
    emit: async (id, payload) => { calls.push(['event', id, payload]); },
  };
}

test('current conditions are bounded scalar data, with explicit missing values and area identity', () => {
  const data = parseWeather(sample, 'Kerava', 1000);
  assert.equal(data['temperature-c'], 6);
  assert.equal(data['precipitation-mm'], 0.1);
  assert.equal(data['uv-index'], 0);
  assert.equal(data['requested-city'], 'Kerava');
  assert.equal(data['resolved-area'], 'Sompio');
  assert.equal(data['updated-at'], 1000);
  assert.equal(data.raining, true);
  const snow = structuredClone(sample);
  snow.current_condition[0].weatherCode = '338';
  assert.equal(parseWeather(snow, 'Kerava').raining, false, 'Snow precipitation is not rain');
  snow.current_condition[0].weatherCode = '999';
  assert.equal(parseWeather(snow, 'Kerava').raining, null, 'Unknown conditions are not dry');
  assert.doesNotMatch(JSON.stringify(data), /hourly|observation_time|weatherIconUrl|https:/);
  const missing = structuredClone(sample);
  Object.assign(missing.current_condition[0], { humidity: '', visibility: 'abc', FeelsLikeC: null, uvIndex: 'Infinity', windspeedKmph: '-1' });
  for (const id of ['humidity-percent', 'visibility-km', 'feels-like-c', 'uv-index', 'wind-speed-kmph']) {
    assert.equal(parseWeather(missing, 'Kerava')[id], null);
  }
  assert.throws(() => parseWeather({}, 'Kerava'), /current conditions/);
  assert.throws(() => parseWeather({ current_condition: [{ temp_C: 'bad' }] }, 'Kerava'), /current conditions/);
});

test('configuration never fetches, Unicode city is encoded, and state commits before the real event', async () => {
  let requests = 0;
  const adapter = createWeatherAdapter({ fetchImpl: async (url, options) => {
    requests += 1;
    assert.equal(url, 'https://wttr.in/S%C3%A3o%20Paulo%2C%20Brazil?format=j1');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Accept, 'application/json');
    return Response.json(sample);
  } });
  for (const city of ['', ' ', 'https://example.com', ':help', 'Kerava?format=3', '../Kerava']) {
    assert.equal(adapter.validateConfiguration(locationSettings(city)), false);
  }
  assert.equal(adapter.validateConfiguration(locationSettings(' São Paulo, Brazil ')), true);
  await adapter.start(locationSettings(' São Paulo, Brazil '));
  assert.equal(requests, 0);
  const host = context();
  await adapter.execute('refresh', {}, host);
  assert.equal(requests, 1);
  assert.equal(host.calls[0], 'save');
  assert.deepEqual(host.calls[2], ['event', 'weather-updated', { 'location-id': 'legacy-city', 'location-name': 'Kerava', city: 'São Paulo, Brazil', 'temperature-c': 6,
    'wind-speed-kmph': 21, raining: true, 'humidity-percent': 91, 'precipitation-mm': 0.1 }]);
  await adapter.stop();
  await assert.rejects(adapter.execute('refresh', {}, host), /not configured/);
});

test('HTTP, malformed, oversized, and network failures preserve readings without retry or an update event', async () => {
  for (const transport of [
    async () => new Response('Busy', { status: 429 }),
    async () => new Response('<html>Error</html>'),
    async () => Response.json({ current_condition: [] }),
    async () => new Response('x'.repeat(512 * 1024 + 1)),
    async () => { throw new Error('Network unavailable'); },
  ]) {
    let requests = 0;
    const adapter = createWeatherAdapter({ fetchImpl: (...args) => { requests += 1; return transport(...args); } });
    await adapter.start(locationSettings('Kerava'));
    const host = context();
    const old = await host.readState();
    await assert.rejects(adapter.execute('refresh', {}, host));
    assert.deepEqual(await host.readState(), old);
    assert.equal(requests, 1);
    assert.equal(host.calls.length, 1);
    assert.equal(host.calls[0][0], 'log');
    assert.equal(host.calls[0][2], 'warning');
  }
});

test('cancellation aborts the request without saving or using revoked host services', async () => {
  const controller = new AbortController();
  const adapter = createWeatherAdapter({ fetchImpl: async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    controller.abort(new Error('Cancelled by test'));
  }) });
  await adapter.start(locationSettings('Kerava'));
  const host = context(controller);
  await assert.rejects(adapter.execute('refresh', {}, host), /Cancelled by test/);
  assert.deepEqual(host.calls, []);
});

async function fixture(t, legacy = null) {
  await fs.mkdir(temporaryRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'weather-'));
  const folder = path.join(root, 'plugins/weather');
  await fs.mkdir(path.join(folder, 'server'), { recursive: true });
  await fs.copyFile(path.join(source, 'server/index.mjs'), path.join(folder, 'server/index.mjs'));
  const declaration = JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8'));
  declaration.runtime.entry = 'server/test-entry.mjs';
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(declaration));
  await fs.writeFile(path.join(folder, 'server/response.json'), JSON.stringify({ status: 200, payload: sample }));
  // Replace only the transport inside this disposable worker, while retaining
  // the production parser, lifecycle, action, IPC, and persistence behavior.
  await fs.writeFile(path.join(folder, 'server/test-entry.mjs'), `
import fs from 'node:fs/promises';
import { createWeatherAdapter } from './index.mjs';
export default createWeatherAdapter({ fetchImpl: async (url, options) => {
  if (!url.startsWith('https://wttr.in/') || !url.endsWith('?format=j1')) throw new Error('Unexpected Weather URL');
  const fixture = JSON.parse(await fs.readFile(new URL('./response.json', import.meta.url), 'utf8'));
  return Response.json(fixture.payload, { status: fixture.status });
} });
`);
  if (legacy) {
    await fs.mkdir(path.join(folder, 'data'));
    await fs.writeFile(path.join(folder, 'data/config.json'), JSON.stringify(legacy.config));
    await fs.writeFile(path.join(folder, 'data/state.json'), JSON.stringify(legacy.state));
  }
  let app = await createLocalserve(root, { automatic: false });
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(temporaryRoot) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  function service() { return app.registry.services()[0]; }
  async function call(endpoint, values) {
    const response = await fetch(app.origin + endpoint, values === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.origin, 'X-Localserve-Token': app.snapshot().token },
      body: JSON.stringify(values),
    });
    return { status: response.status, body: await response.json() };
  }
  return {
    folder, service, call, get app() { return app; },
    save: values => {
      if (values.settings && Object.hasOwn(values.settings, 'city')) {
        values = { ...values, settings: locationSettings(values.settings.city, values.settings['poll-minutes'] ?? 60) };
      }
      return call('/api/plugins/weather/config', { revision: service().config.revision, ...values });
    },
    action: () => call('/api/plugins/weather/actions/refresh', { parameters: {} }),
    response: (status, payload = sample) => fs.writeFile(path.join(folder, 'server/response.json'), JSON.stringify({ status, payload })),
    async restart() { await app.close(); app = await createLocalserve(root, { automatic: false }); },
  };
}

test('fresh package config, interval choices, runtime actions/events, public cards, and restart persistence', async t => {
  const f = await fixture(t);
  assert.equal(f.service().enabled, false);
  assert.equal(f.service().configurationReady, false);
  assert.deepEqual(f.service().config.settings, { locations: [], 'poll-minutes': 60 });
  assert.equal(f.service().pollSeconds, 3600);
  assert.equal(f.service().cardData.values['temperature-c'], undefined);
  assert.deepEqual(f.service().cards, []);
  assert.equal((await f.action()).status, 409);
  for (const minutes of [1, 14, 16, 61]) {
    assert.equal((await f.save({ settings: { city: 'Kerava', 'poll-minutes': minutes } })).status, 400);
  }
  await f.save({ enabled: true, settings: { city: 'Kerava', 'poll-minutes': 60 } });
  assert.equal(f.service().configurationReady, true);
  assert.equal((await f.action()).status, 200);
  assert.equal(f.service().cardData.values['temperature-c'].value, 6);
  assert.equal(f.service().cardData.values['resolved-area'].value, 'Sompio');
  assert.ok(f.service().pluginActivity.some(entry => entry.eventId === 'weather-updated'));
  const saved = structuredClone(f.service().pluginState);
  await f.response(503);
  assert.notEqual((await f.action()).status, 200);
  assert.deepEqual(f.service().pluginState, saved);
  for (const file of ['declaration.json', 'server/index.mjs', 'data/config.json', 'data/state.json', 'data/cards.json']) {
    assert.equal((await f.call(`/plugins/weather/${file}`)).status, 404);
  }
  await f.save({ settings: { city: '', 'poll-minutes': 30 } });
  assert.equal(f.service().configurationReady, false);
  assert.deepEqual(f.service().pluginState, saved);
  await f.restart();
  assert.equal(f.service().config.settings['poll-minutes'], 30);
  assert.deepEqual(f.service().pluginState, saved);
  assert.equal(f.service().lastPollAt, null, 'Last poll is process-local attempt metadata');
  await f.save({ settings: { city: 'Kerava' } });
  assert.equal(f.service().pollSeconds, 3600, 'An older config without an optional interval uses the hourly default');
});

test('automatic polls use the shared queue, coalesce missed intervals, respect pause, and postpone after manual refresh', async t => {
  const f = await fixture(t);
  await f.save({ enabled: true, settings: { city: 'Kerava', 'poll-minutes': 60 } });
  const record = f.app.registry.get('weather');
  const events = () => f.service().pluginActivity.filter(entry => entry.eventId === 'weather-updated').length;
  await f.app.engine.setPaused(true);
  f.app.registry.pollDue(record.pollDueAt + 10000000);
  assert.equal(record.pending, 0);
  await f.app.engine.setPaused(false);
  f.app.registry.pollDue(record.pollDueAt);
  f.app.registry.pollDue(record.pollDueAt + 10000000);
  await record.pollOperation;
  assert.equal(events(), 1);
  const due = record.pollDueAt;
  assert.ok(due >= Date.now() + 3599000);
  f.app.registry.pollDue(due - 1);
  assert.equal(record.pending, 0);
  f.app.registry.pollDue(due + 10000000);
  await record.pollOperation;
  assert.equal(events(), 2, 'An overdue clock makes one attempt');
  await f.action();
  assert.equal(events(), 3);
  assert.ok(record.pollDueAt >= Date.now() + 3599000);
  await f.save({ settings: { city: 'Kerava', 'poll-minutes': 15 } });
  assert.equal(f.service().pollSeconds, 900);
  f.app.registry.pollDue(Date.now());
  assert.equal(record.pending, 0, 'Rate edits do not refetch immediately');
  await f.response(429);
  f.app.registry.pollDue(record.pollDueAt);
  await record.pollOperation;
  assert.equal(events(), 3);
  assert.ok(record.pollDueAt >= Date.now() + 899000, 'Failure waits the full interval');
  await f.save({ enabled: false });
  f.app.registry.pollDue(record.pollDueAt + 10000000);
  assert.equal(record.pending, 0);
});

test('polling declarations and readable dropdown labels validate, and Current values formats timestamps', async () => {
  const raw = JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8'));
  const declaration = validateDeclaration(raw);
  assert.equal(declaration.settings[0].enumLabels[3], '1 hour');
  assert.throws(() => validateDeclaration({ ...raw, polling: { actionId: 'missing', intervalSetting: 'poll-minutes' } }), /Polling/);
  assert.throws(() => validateDeclaration({ ...raw, settings: [{ ...raw.settings[0], enumLabels: ['Bad'] }, raw.settings[1]] }), /labels/);
  const sandbox = { document: { addEventListener() {} }, escapeHtml: value => String(value ?? ''), icon: () => '', state: { paused: false }, formatServerTimestamp: value => `formatted:${value}` };
  vm.createContext(sandbox);
  vm.runInContext(await fs.readFile(new URL('../web/plugin-ui.js', import.meta.url), 'utf8'), sandbox);
  const html = vm.runInContext(`PluginUI.field(${JSON.stringify(declaration.settings[0])}, 60, 'setting')`, sandbox);
  assert.match(html, /value="60" selected>1 hour/);
  sandbox.service = { ...declaration, instances: null, enabled: false, cardData: { values: { 'updated-at': { available: true, value: 1000 } } } };
  const values = vm.runInContext('PluginUI.events(service)', sandbox);
  assert.match(values, /Last successful refresh/);
  assert.match(values, /formatted:1000/);
  assert.match(values, /No data/);
  sandbox.crypto = { randomUUID: () => 'test-id' };
  sandbox.state.taskEvents = [{ ...declaration.events[0], id: 'plugin:weather:event:weather-updated' }];
  vm.runInContext(await fs.readFile(new URL('../web/tasks-ui.js', import.meta.url), 'utf8'), sandbox);
  sandbox.rule = { eventId: sandbox.state.taskEvents[0].id, condition: { field: 'temperature-c', operator: 'gte', value: 10 } };
  const temperatureControls = vm.runInContext('TaskUI.eventConditionFields(rule)', sandbox);
  assert.match(temperatureControls, /value="gte" selected>At least/);
  assert.match(temperatureControls, /value="10"/);
  assert.match(temperatureControls, /condition becomes true/);
  sandbox.rule.condition = { field: 'raining', operator: 'eq', value: true };
  const rainControls = vm.runInContext('TaskUI.eventConditionFields(rule)', sandbox);
  assert.match(rainControls, /value="true" selected>Yes/);
  assert.doesNotMatch(rainControls, /Greater than/);
});

async function settle(f) {
  const deadline = Date.now() + 5000;
  while (f.app.engine.active.size || f.app.engine.pending.size) {
    if (Date.now() > deadline) throw new Error('Weather Task did not finish.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function conditionalTask(f, name, condition, eventId = 'plugin:weather:event:weather-updated') {
  const response = await f.call('/api/tasks', { name, enabled: true,
    starts: [{ id: 'weather-rule', name: 'Event', type: 'event', enabled: true,
      eventId, condition }],
    steps: [{ id: 'log', type: 'log', enabled: true, message: name }],
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return f.app.tasks.snapshot().find(task => task.name === name);
}

test('per-Task temperature, wind, and rain conditions fire once on entry, rearm on false, and survive restart', async t => {
  const f = await fixture(t);
  await f.save({ enabled: true, settings: { city: 'Kerava', 'poll-minutes': 60 } });
  await conditionalTask(f, 'Warm', { field: 'temperature-c', operator: 'gte', value: 10 });
  await conditionalTask(f, 'Windy', { field: 'wind-speed-kmph', operator: 'gte', value: 30 });
  await conditionalTask(f, 'Rain', { field: 'raining', operator: 'eq', value: true });
  const dry = structuredClone(sample);
  Object.assign(dry.current_condition[0], { temp_C: '9', windspeedKmph: '29', weatherCode: '113' });
  const wet = structuredClone(sample);
  Object.assign(wet.current_condition[0], { temp_C: '10', windspeedKmph: '30', weatherCode: '296' });
  await f.response(200, dry);
  await f.action();
  assert.equal(f.app.state.snapshot().runs.length, 0);
  await f.response(200, wet);
  await f.action();
  await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 3);
  await f.action();
  assert.equal(f.app.state.snapshot().runs.length, 3, 'Repeated true readings do not retrigger');
  const unknown = structuredClone(wet);
  Object.assign(unknown.current_condition[0], { windspeedKmph: '', weatherCode: '999' });
  await f.response(200, unknown);
  await f.action();
  await f.response(200, wet);
  await f.action();
  assert.equal(f.app.state.snapshot().runs.length, 3, 'Missing readings do not rearm');
  await f.response(200, dry);
  await f.action();
  await f.response(200, wet);
  await f.action();
  await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 6);
  await f.restart();
  await f.action();
  assert.equal(f.app.state.snapshot().runs.length, 6, 'Restart retains true-state claims');
});

test('first matching reading triggers, concurrent producers share a durable claim, and disabled rules rearm', async t => {
  const f = await fixture(t);
  await f.save({ enabled: true, settings: { city: 'Kerava', 'poll-minutes': 60 } });
  const task = await conditionalTask(f, 'Cold', { field: 'temperature-c', operator: 'lte', value: 6 });
  await Promise.all([
    f.app.engine.emitPluginEvent('weather', 'weather-updated', { 'location-id': 'legacy-city', 'location-name': 'Kerava', city: 'Kerava', 'temperature-c': 6 }),
    f.app.engine.emitPluginEvent('weather', 'weather-updated', { 'location-id': 'legacy-city', 'location-name': 'Kerava', city: 'Kerava', 'temperature-c': 6 }),
  ]);
  await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 1);
  let saved = f.app.tasks.snapshot()[0];
  assert.equal((await f.call(`/api/tasks/${task.id}`, { ...saved, name: 'Renamed Cold' })).status, 200);
  await f.action();
  assert.equal(f.app.state.snapshot().runs.length, 1, 'Unrelated edits preserve the edge');
  saved = f.app.tasks.snapshot()[0];
  assert.equal((await f.call(`/api/tasks/${task.id}/enabled`, { revision: saved.revision, enabled: false })).status, 200);
  saved = f.app.tasks.snapshot()[0];
  assert.equal((await f.call(`/api/tasks/${task.id}/enabled`, { revision: saved.revision, enabled: true })).status, 200);
  await f.action();
  await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 2, 'Re-enabling starts a fresh condition baseline');
  saved = f.app.tasks.snapshot()[0];
  for (const condition of [
    { field: 'missing', operator: 'eq', value: 1 },
    { field: 'raining', operator: 'gte', value: true },
    { field: 'temperature-c', operator: 'gte', value: '6' },
    { field: 'wind-speed-kmph', operator: 'gte', value: -1 },
  ]) {
    assert.equal((await f.call(`/api/tasks/${task.id}`, { ...saved, starts: [{ ...saved.starts[0], condition }] })).status, 400);
  }
});

test('all documented Location formats normalize safely, and the new-entry default uses Server location only', async () => {
  const examples = new Map([
    ['/paris', 'paris'], ['/Eiffel+tower', 'Eiffel tower'], ['/Москва', 'Москва'],
    ['/muc', 'muc'], ['/@stackoverflow.com', '@stackoverflow.com'], ['/94107', '94107'],
    ['/-78.46,106.79', '-78.46,106.79'], ['+60.4,+25.1', '60.4,25.1'], ['0,0', '0,0'],
  ]);
  for (const [input, expected] of examples) assert.equal(locationQuery(input), expected);
  for (const input of ['https://example.com', '//Paris', '/:help', '90.1,0', '0,180.1', 'Paris?format=3', 'Paris\nBerlin', '@example/com']) assert.equal(locationQuery(input), null);
  const declaration = validateDeclaration(JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8')));
  const sandbox = { document: { addEventListener() {} }, config: { location: { latitude: 60.4048, longitude: 25.113 } },
    crypto: { randomUUID: () => 'test-id' } };
  vm.createContext(sandbox);
  vm.runInContext(await fs.readFile(new URL('../web/plugin-ui.js', import.meta.url), 'utf8'), sandbox);
  sandbox.field = declaration.settings[1];
  const first = vm.runInContext('PluginUI.newItem(field)', sandbox);
  assert.equal(first.query, '60.4048,25.113');
  assert.equal(first.name, 'Server location');
  sandbox.config.location = { latitude: 0, longitude: 0 };
  assert.equal(vm.runInContext('PluginUI.newItem(field).query', sandbox), '0,0');
  sandbox.config.location = null;
  assert.equal(vm.runInContext('PluginUI.newItem(field).query', sandbox), '');
  assert.equal(first.query, '60.4048,25.113', 'Saved/drafted inputs do not follow global edits');
});

test('legacy City configuration and scalar state migrate once with private recovery copies and stable bindings', async t => {
  const old = { config: { revision: 7, enabled: false, icon: 'sun', settings: { city: 'Kerava', 'poll-minutes': 30 } },
    state: parseWeather(sample, 'Kerava', 1000) };
  const f = await fixture(t, old);
  assert.equal(f.service().config.revision, 8);
  assert.deepEqual(f.service().config.settings.locations, [{ id: 'legacy-city', name: 'Kerava', query: 'Kerava', enabled: true }]);
  assert.equal(f.service().cardData.values['temperature-c'].value, 6);
  assert.equal(f.app.registry.events()[0].id, 'plugin:weather:event:weather-updated');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.folder, 'data/config.before-instances.json'), 'utf8')), old.config);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.folder, 'data/state.before-instances.json'), 'utf8')), old.state);
  await f.restart();
  assert.equal(f.service().config.revision, 8, 'Migration is idempotent');
  assert.equal(f.service().cardData.values['temperature-c'].value, 6);
  assert.equal((await f.call('/plugins/weather/data/config.before-instances.json')).status, 404);
});

test('location list validates identity, duplicates, bounds, stale revisions, and independent enablement', async t => {
  const f = await fixture(t);
  const items = [
    { id: 'paris', name: 'Paris', query: '/paris', enabled: true },
    { id: 'muc', name: 'Airport', query: '/muc', enabled: false },
  ];
  const revision = f.service().config.revision;
  assert.equal((await f.save({ settings: { locations: items, 'poll-minutes': 60 } })).status, 200);
  assert.equal(f.service().configurationReady, true);
  assert.equal(f.service().pollTargets, 1);
  assert.equal((await f.call('/api/plugins/weather/config', { revision, settings: { locations: [] } })).status, 409);
  for (const locations of [
    [...items, { ...items[0] }],
    [...items, { ...items[0], id: 'other', name: 'Other' }],
    [{ ...items[0], id: '../bad' }],
    [{ ...items[0], query: 'https://example.com' }],
    [{ ...items[0], extra: 'untrusted' }],
    Array.from({ length: 21 }, (_, i) => ({ id: `city-${i}`, name: `City ${i}`, query: `Place ${i}`, enabled: true })),
  ]) assert.equal((await f.save({ settings: { locations, 'poll-minutes': 60 } })).status, 400);
  assert.equal((await f.save({ settings: { locations: items.map(item => ({ ...item, enabled: false })), 'poll-minutes': 60 } })).status, 200);
  assert.equal(f.service().configurationReady, false);
});

test('two locations keep independent data, failure, Task edges, and public Vista bindings', async t => {
  const f = await fixture(t);
  const items = [
    { id: 'paris', name: 'Paris', query: '/paris', enabled: true },
    { id: 'muc', name: 'Airport', query: '/muc', enabled: true },
  ];
  await f.save({ enabled: true, settings: { locations: items, 'poll-minutes': 60 } });
  const firstEvent = f.app.registry.events().find(event => event.instanceId === 'paris').id;
  const secondEvent = f.app.registry.events().find(event => event.instanceId === 'muc').id;
  await conditionalTask(f, 'Paris cold', { field: 'temperature-c', operator: 'lte', value: 6 }, firstEvent);
  await conditionalTask(f, 'Airport cold', { field: 'temperature-c', operator: 'lte', value: 6 }, secondEvent);
  const refresh = id => f.call('/api/plugins/weather/actions/refresh', { parameters: { 'location-id': id } });
  assert.equal((await refresh('paris')).status, 200);
  await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 1);
  assert.equal(f.service().cardData.values['paris:temperature-c'].value, 6);
  assert.equal(f.service().cardData.values['muc:temperature-c'].available, false);
  assert.equal((await refresh('muc')).status, 200);
  await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 2, 'One location cannot consume another location\'s edge');
  await f.response(503);
  const before = structuredClone(f.service().pluginState);
  assert.notEqual((await refresh('paris')).status, 200);
  assert.deepEqual(f.service().pluginState, before);
  assert.notEqual((await refresh('missing')).status, 200);
  const card = { schemaVersion: 1, name: 'Paris only', enabled: true, icon: 'inherit', size: 'medium', layout: 'list',
    fields: [{ id: 'temperature', binding: 'paris:temperature-c', label: 'Paris temperature', enabled: true, icon: 'auto', format: 'number', unit: '°C', decimals: 0 }] };
  assert.equal((await f.call('/api/plugins/weather/cards', card)).status, 200);
  const savedCard = f.service().cards[0];
  const vista = { schemaVersion: 1, name: 'Weather display', slug: 'weather', enabled: true, gap: 0, padding: 0,
    layout: { id: 'root', name: 'Canvas', type: 'column', enabled: true, width: '1fr', height: '1fr', children: [
      { id: 'card', name: 'Paris', type: 'card', enabled: true, width: '1fr', height: '1fr', cards: [{ pluginId: 'weather', cardId: savedCard.id }] },
    ] } };
  assert.equal((await f.call('/api/vistas', vista)).status, 200);
  const publicResponse = await f.call('/api/vistas/weather');
  const publicText = JSON.stringify(publicResponse.body);
  assert.match(publicText, /paris:temperature-c/);
  assert.doesNotMatch(publicText, /muc:|Airport|pluginState|settings|token|config/);
  await f.save({ settings: { locations: [{ ...items[0], name: 'Paris renamed' }, items[1]], 'poll-minutes': 60 } });
  assert.ok(f.service().cardCatalog.some(field => field.id === 'paris:temperature-c' && field.label.startsWith('Paris renamed')));
  await f.save({ settings: { locations: [{ ...items[0], enabled: false }, items[1]], 'poll-minutes': 60 } });
  assert.equal(f.service().cardData.values['paris:temperature-c'].available, false);
  assert.equal((await refresh('paris')).status, 409);
  await f.save({ settings: { locations: [items[1]], 'poll-minutes': 60 } });
  assert.equal(f.service().cards[0].fields[0].binding, 'paris:temperature-c', 'Removal retains saved references');
  assert.ok(!f.service().cardCatalog.some(field => field.id === 'paris:temperature-c'));
});

test('multi-location polling is staggered, serialized, and manual refresh postpones only its target', async t => {
  const f = await fixture(t);
  await f.save({ enabled: true, settings: { 'poll-minutes': 60, locations: [
    { id: 'paris', name: 'Paris', query: 'Paris', enabled: true },
    { id: 'muc', name: 'Airport', query: 'muc', enabled: true },
  ] } });
  const record = f.app.registry.get('weather');
  const paris = record.instancePolls.get('paris');
  const airport = record.instancePolls.get('muc');
  assert.equal(airport.nextAt - paris.nextAt, 1800000);
  f.app.registry.pollDue(paris.nextAt);
  await record.pollOperation;
  assert.ok(f.service().pluginState.locations.paris);
  assert.equal(f.service().pluginState.locations.muc, undefined);
  f.app.registry.pollDue(airport.nextAt);
  await record.pollOperation;
  assert.ok(f.service().pluginState.locations.muc);
  const airportDue = airport.nextAt;
  await f.call('/api/plugins/weather/actions/refresh', { parameters: { 'location-id': 'paris' } });
  assert.equal(airport.nextAt, airportDue);
  assert.ok(paris.nextAt >= Date.now() + 3599000);
  f.app.registry.pollDue(Date.now() + 100000000);
  await record.pollOperation;
  const future = [...record.instancePolls.values()].map(clock => clock.nextAt);
  assert.ok(future.every(time => time > Date.now()), 'Overdue locations do not become a burst');
});

test('saving a location keeps its owning workspace when another plugin appears first', async () => {
  const declaration = validateDeclaration(JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8')));
  const location = { id: 'paris', name: 'Paris', query: '/paris', enabled: false };
  let rendered;
  let sent;
  const sandbox = {
    document: { addEventListener() {} }, structuredClone,
    state: { services: [{ id: 'simulator' }, { ...declaration, config: { settings: { locations: [], 'poll-minutes': 60 } } }] },
    dialogContext: { pluginId: 'weather', setting: 'locations', operation: 'add', item: location,
      items: [], settings: { locations: [], 'poll-minutes': 60 }, revision: 1 },
    mutate: async (url, values) => { sent = { url, values }; },
    closeDialog() {}, notify() {}, showFormError: message => { throw new Error(message); },
    capture: service => { rendered = service.id; },
  };
  vm.createContext(sandbox);
  vm.runInContext(await fs.readFile(new URL('../web/plugin-ui.js', import.meta.url), 'utf8'), sandbox);
  sandbox.draft = location;
  vm.runInContext('PluginUI.render = capture; PluginUI.readFields = () => draft;', sandbox);
  const button = { isConnected: false };
  sandbox.form = { querySelector: () => button };
  await vm.runInContext('PluginUI.submitItem(form)', sandbox);
  assert.equal(rendered, 'weather');
  assert.equal(sent.url, 'api/plugins/weather/config');
  assert.equal(sent.values.settings.locations[0].id, 'paris');
});
