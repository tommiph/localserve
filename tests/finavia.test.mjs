/** Synthetic XML and disposable roots only. No installed credentials/providers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createLocalserve } from '../server.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { validateFields, validateValues } from '../server/plugin-schema.mjs';
import { createFinaviaAdapter, parseFlights, boardUrl, airportCode } from '../plugins/finavia/server/index.mjs';

const source = fileURLToPath(new URL('../plugins/finavia/', import.meta.url));
const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
const baseTime = Date.parse('2026-10-13T12:00:00Z');
const fakeKey = 'synthetic-key-never-a-real-credential';
const iso = minutes => new Date(baseTime + minutes * 60000).toISOString();
const location = (overrides = {}) => ({ id: 'helsinki', name: 'Helsinki Airport', airport: 'HEL',
  direction: 'departures', 'other-airport': '', flight: '', 'advance-minutes': 2, enabled: true, ...overrides });
const settings = (locations = [location()], overrides = {}) => ({ 'api-key': fakeKey,
  'poll-minutes': 1, locations, ...overrides });
const flight = (overrides = {}) => ({ h_apt: 'HEL', fltnr: 'AY1331', sdate: '20261013', sdt: iso(1),
  route_1: 'LHR', route_n_1: 'London', gate: '34', prm: '', prt: 'Scheduled', ...overrides });
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const flightXml = item => '<flight>' + Object.entries(item).map(([key, value]) => `<${key}>${escape(value)}</${key}>`).join('') + '</flight>';
const xml = (departures = [flight()], arrivals = []) => '<?xml version="1.0" encoding="UTF-8"?>'
  + '<flights xmlns="http://www.finavia.fi/FlightsService.xsd">'
  + `<arr><header><timestamp>${iso(0)}</timestamp></header><body>${arrivals.map(flightXml).join('')}</body></arr>`
  + `<dep><body>${departures.map(flightXml).join('')}</body></dep></flights>`;
function host(initial = {}, controller = new AbortController()) {
  let state = structuredClone(initial);
  const calls = [];
  return { signal: controller.signal, calls,
    readState: async () => structuredClone(state),
    saveState: async next => { controller.signal.throwIfAborted(); state = structuredClone(next); calls.push(['save']); },
    emit: async (id, payload) => calls.push(['event', id, payload]),
    log: async (...values) => calls.push(['log', ...values]),
  };
}
const events = context => context.calls.filter(call => call[0] === 'event');

test('declaration/readiness, secret settings and fixed credential-free request URLs', async () => {
  const raw = JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8'));
  const plugin = validateDeclaration(raw);
  assert.equal(plugin.name, 'Finavia');
  assert.equal(plugin.icon, 'flight-takeoff');
  assert.equal(plugin.settings[0].format, 'secret');
  assert.equal(plugin.defaultCardLayout, 'table');
  assert.equal(plugin.cardFields[0].columns.length, 7);
  assert.equal(airportCode(' hel '), 'HEL');
  assert.equal(airportCode('https://evil.invalid'), null);
  assert.equal(boardUrl(location()), 'https://apigw.finavia.fi/flights/public/v0/flights/dep/HEL');
  assert.equal(boardUrl(location({ direction: 'both' })), 'https://apigw.finavia.fi/flights/public/v0/flights/all/HEL');
  assert.equal(boardUrl(location({ direction: 'arrivals' })), 'https://apigw.finavia.fi/flights/public/v0/flights/arr/HEL');
  assert.throws(() => boardUrl(location({ airport: '../HEL' })));
  assert.throws(() => boardUrl(location({ airport: 'https://evil.invalid' })));
  let requests = 0;
  const adapter = createFinaviaAdapter({ now: () => baseTime, fetchImpl: async (url, options) => {
    requests += 1;
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.app_key, fakeKey);
    assert.equal(options.headers.Accept, 'application/xml');
    assert.ok(!url.includes(fakeKey));
    return new Response(xml());
  } });
  for (const config of [settings([]), settings(undefined, { 'api-key': '' }),
    settings([location({ airport: '../HEL' })]), settings([location({ 'other-airport': 'HEL' })]),
    settings([location({ 'advance-minutes': -1 })]), settings([location({ flight: 'AY 1331' })])]) {
    assert.equal(adapter.validateConfiguration(config), false);
  }
  await adapter.start(settings());
  assert.equal(requests, 0);
  const context = host();
  await adapter.execute('refresh', {}, context);
  assert.equal(requests, 1);
  assert.equal(context.calls[0][0], 'save');
  assert.deepEqual(events(context).map(call => call[1]), ['flight-departing', 'flight-arriving-or-departing']);
  for (const [, id, payload] of events(context)) validateValues(plugin.events.find(event => event.id === id).payload, payload);
  assert.doesNotMatch(JSON.stringify(await context.readState()), /synthetic-key|api-origin/);
  const unsafe = structuredClone(raw);
  unsafe.cardFields.push({ id: 'key', label: 'Key', type: 'string', source: { kind: 'setting', key: 'api-key' } });
  assert.throws(() => validateDeclaration(unsafe), /Secret settings/);
  assert.throws(() => validateFields([{ id: 'key', type: 'number', format: 'secret' }]), /Secret fields/);
  const ui = vm.runInNewContext(await fs.readFile(new URL('../web/plugin-ui.js', import.meta.url), 'utf8') + '\nPluginUI;', {
    escapeHtml: escape, icon: () => '', document: { addEventListener() {} },
  });
  assert.match(ui.field(plugin.settings[0], fakeKey, 'setting'), /type="password"/);
  assert.match(ui.field(plugin.settings[0], fakeKey, 'setting'), /autocomplete="off"/);
});

test('airport/direction/route/codeshare filters, bounded sorted rows and explicit missing data', () => {
  const data = xml([
    flight(), flight({ fltnr: 'AY1333', sdt: iso(3), route_1: 'CDG', route_n_1: 'Paris', cflight_1: 'AF999', gate: '' }),
    flight({ h_apt: 'OUL', fltnr: 'AY100' }),
  ], [flight({ fltnr: 'AY1332', sdt: iso(2) })]);
  const result = parseFlights(data, location({ direction: 'both' }), baseTime);
  assert.equal(result.reading['flight-count'], 3);
  assert.equal(result.reading['flight-1-flight'], 'AY1331');
  assert.equal(result.reading['flight-2-route'], 'From London (LHR)');
  assert.equal(result.reading['flight-3-gate'], null);
  assert.equal(parseFlights(data, location({ 'other-airport': 'LHR' }), baseTime).movements.length, 1);
  assert.equal(parseFlights(data, location({ flight: 'AF999' }), baseTime).movements[0].number, 'AY1333');
  assert.equal(parseFlights(data, location({ direction: 'arrivals' }), baseTime).movements[0].number, 'AY1332');
  const bounded = parseFlights(xml(Array.from({ length: 12 }, (_, i) => flight({ fltnr: `AY${i + 1}`, sdt: iso(12 - i) }))), location(), baseTime);
  assert.equal(bounded.reading['flight-count'], 10);
  assert.equal(bounded.reading['flight-1-flight'], 'AY12');
  assert.equal(bounded.reading['flight-11-flight'], undefined);
  const missing = parseFlights(xml([flight({ prt: '', gate: '', route_1: '', route_n_1: '' })]), location(), baseTime).reading;
  assert.equal(missing['flight-1-status'], null);
  assert.equal(missing['flight-1-route'], null);
  assert.equal(missing['updated-at'], baseTime);
  const empty = parseFlights(xml([]), location(), baseTime).reading;
  assert.equal(empty['flight-count'], 0);
  assert.equal(empty['flight-1-time'], null);
});

test('zoned times, estimates/actuals, cancellation and no invented destination/actual time', () => {
  const result = parseFlights(xml([flight({ est_d: iso(2), pest_d: iso(10), ablk_d: iso(-1) })]), location(), baseTime);
  assert.equal(result.reading['flight-1-scheduled'], baseTime + 60000);
  assert.equal(result.reading['flight-1-time'], baseTime + 600000);
  assert.equal(result.reading['flight-1-due-at'], baseTime + 600000);
  assert.equal(result.movements[0].actual, null);
  assert.equal(result.movements[0].basis, 'estimated');
  assert.equal(parseFlights(xml([flight({ sdt: '2026-10-13T15:01:00+03:00' })]), location(), baseTime).movements[0].scheduled, baseTime + 60000);
  assert.throws(() => parseFlights(xml([flight({ sdt: '2026-10-13T15:01:00' })]), location(), baseTime), /scheduled time/);
  const actual = parseFlights(xml([flight({ act_d: iso(-0.5), est_d: iso(2) })]), location(), baseTime);
  assert.equal(actual.reading['flight-count'], 0);
  assert.equal(actual.movements[0].basis, 'actual');
  const statusOnly = parseFlights(xml([flight({ prm: 'DEP', prt: 'Departed' })]), location(), baseTime);
  assert.equal(statusOnly.reading['flight-count'], 0);
  assert.equal(statusOnly.movements[0].actual, null);
  for (const overrides of [{ prm: 'C' }, { prt: 'Cancelled' }, { prt: '', prt_f: 'Peruttu' }]) {
    const cancelled = parseFlights(xml([flight(overrides)]), location(), baseTime);
    assert.equal(cancelled.reading['flight-1-status'], 'Cancelled');
    assert.equal(cancelled.reading['flight-1-due-at'], null);
  }
});

test('strict bounded XML rejects DTD/entities, missing bodies, duplicate fields and foreign markup', () => {
  const invalid = [
    '<!DOCTYPE flights [<!ENTITY x SYSTEM "https://evil.invalid/">]>' + xml(),
    xml().replace('Scheduled', '&unknown;'), xml().replace('<gate>34</gate>', '<gate><b>34</b></gate>'),
    xml().replace('<gate>34</gate>', '<gate>34</gate><gate>35</gate>'),
    '<flights xmlns="http://www.finavia.fi/FlightsService.xsd"><arr/><dep/></flights>',
    xml().replace('http://www.finavia.fi/FlightsService.xsd', 'http://evil.invalid'),
    xml().replace('<gate>34</gate>', '<gate xmlns="http://evil.invalid">34</gate>'),
    xml().replace('</dep>', '</dep><dep><body/></dep>'), '<html>Error</html>',
    xml().replace('Scheduled', 'x'.repeat(4001)),
    'x'.repeat(4 * 1024 * 1024 + 1),
    xml(Array.from({ length: 2001 }, (_, i) => flight({ fltnr: `AY${i}` }))),
  ];
  for (const value of invalid) assert.throws(() => parseFlights(value, location(), baseTime));
});

test('claims precede events, survive estimates/rename/restart/filter changes and avoid catch-up', async () => {
  let clock = baseTime;
  let data = xml();
  const adapter = createFinaviaAdapter({ now: () => clock, fetchImpl: async () => new Response(data) });
  await adapter.start(settings());
  const context = host();
  await adapter.execute('refresh', {}, context);
  assert.equal(events(context).length, 2);
  data = xml([flight({ est_d: iso(1.5) })]);
  await adapter.execute('refresh', {}, context);
  await adapter.stop(); await adapter.start(settings([location({ name: 'Renamed', 'other-airport': 'LHR' })]));
  await adapter.execute('refresh', {}, context);
  assert.equal(events(context).length, 2);
  clock += 2 * 60000;
  data = xml([flight({ act_d: iso(1.5) })]);
  await adapter.execute('refresh', {}, context);
  assert.deepEqual(events(context).slice(-2).map(call => call[1]), ['flight-departed', 'flight-arrived-or-departed']);
  await adapter.execute('refresh', {}, context);
  assert.equal(events(context).length, 4);
  clock += 10 * 60000;
  data = xml([flight({ fltnr: 'AY1333', act_d: iso(2) })]);
  await adapter.execute('refresh', {}, context);
  assert.equal(events(context).length, 4);
  clock = baseTime;
  data = xml([flight({ fltnr: 'AY999', prm: 'C' })]);
  await adapter.execute('refresh', {}, context);
  assert.equal(events(context).length, 4);
  const failed = host(); failed.saveState = async () => { throw new Error('Disk unavailable'); };
  data = xml();
  await assert.rejects(adapter.execute('refresh', {}, failed), /Disk unavailable/);
  assert.equal(events(failed).length, 0);
});

test('arrival events and combined sources use separate durable stages', async () => {
  let data = xml([], [flight()]);
  let clock = baseTime;
  const adapter = createFinaviaAdapter({ now: () => clock, fetchImpl: async () => new Response(data) });
  await adapter.start(settings([location({ direction: 'arrivals' })]));
  const context = host();
  await adapter.execute('refresh', {}, context);
  assert.deepEqual(events(context).map(call => call[1]), ['flight-arriving', 'flight-arriving-or-departing']);
  clock += 1.5 * 60000; data = xml([], [flight({ act_d: iso(1) })]);
  await adapter.execute('refresh', {}, context);
  assert.deepEqual(events(context).slice(-2).map(call => call[1]), ['flight-arrived', 'flight-arrived-or-departed']);
});

test('failed reads preserve successful state, sanitize echoed credentials and cancel without writes', async () => {
  for (const transport of [async () => new Response(fakeKey, { status: 401 }),
    async () => new Response('redirect', { status: 302 }), async () => new Response('not xml'),
    async () => new Response(Uint8Array.from([255])), async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)),
    async () => { throw new Error('Finavia echoed ' + fakeKey); }]) {
    let requests = 0;
    const adapter = createFinaviaAdapter({ fetchImpl: (...args) => { requests += 1; return transport(...args); } });
    await adapter.start(settings());
    const initial = { locations: { helsinki: { 'flight-count': 1 } }, monitoring: { helsinki: { claims: [] } } };
    const context = host(initial);
    await assert.rejects(adapter.execute('refresh', {}, context), error => !error.message.includes(fakeKey));
    assert.equal(requests, 1);
    assert.deepEqual(await context.readState(), initial);
    assert.equal(events(context).length, 0);
    assert.ok(!JSON.stringify(context.calls).includes(fakeKey));
  }
  const controller = new AbortController();
  const adapter = createFinaviaAdapter({ fetchImpl: (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    controller.abort(new Error('Cancelled'));
  }) });
  await adapter.start(settings());
  const context = host({}, controller);
  await assert.rejects(adapter.execute('refresh', {}, context), /Cancelled/);
  assert.deepEqual(context.calls, []);
});

test('claim overflow cannot evict this refresh before emitting its effects', async () => {
  const data = xml(Array.from({ length: 301 }, (_, i) => flight({ fltnr: `AY${i + 1}` })));
  const adapter = createFinaviaAdapter({ now: () => baseTime, fetchImpl: async () => new Response(data) });
  await adapter.start(settings());
  const context = host();
  await assert.rejects(adapter.execute('refresh', {}, context), /more than 300/);
  assert.deepEqual(context.calls, []);
  assert.deepEqual(await context.readState(), {});
});

async function fixture(t) {
  await fs.mkdir(temporaryRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'finavia-'));
  const folder = path.join(root, 'plugins/finavia');
  await fs.mkdir(path.join(folder, 'server'), { recursive: true });
  await fs.copyFile(path.join(source, 'server/index.mjs'), path.join(folder, 'server/index.mjs'));
  await fs.cp(path.join(source, 'vendor'), path.join(folder, 'vendor'), { recursive: true });
  const declaration = JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8'));
  declaration.runtime.entry = 'server/test-entry.mjs';
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(declaration));
  const response = (data = xml(), now = baseTime, status = 200) => fs.writeFile(path.join(folder, 'server/response.json'), JSON.stringify({ data, now, status }));
  await response();
  await fs.writeFile(path.join(folder, 'server/test-entry.mjs'), `
import fs from 'node:fs/promises';
import { createFinaviaAdapter } from './index.mjs';
let clock = 0;
export default createFinaviaAdapter({ now: () => clock, fetchImpl: async url => {
  if (new URL(url).origin !== 'https://apigw.finavia.fi') throw new Error('Wrong origin');
  const fixture = JSON.parse(await fs.readFile(new URL('./response.json', import.meta.url), 'utf8'));
  clock = fixture.now;
  return new Response(fixture.data, { status: fixture.status });
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
    save: values => call('/api/plugins/finavia/config', { revision: service().config.revision, ...values }),
    action: id => call('/api/plugins/finavia/actions/refresh', { parameters: { 'location-id': id ?? 'helsinki' } }),
    async restart() { await app.close(); app = await createLocalserve(root, { automatic: false }); },
  };
}
async function settle(f) {
  const deadline = Date.now() + 5000;
  while (f.app.engine.active.size || f.app.engine.pending.size) {
    if (Date.now() > deadline) throw new Error('Finavia Task did not settle');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('installed boards, consecutive flight Task occurrences, restart/revisions and private data', async t => {
  const f = await fixture(t);
  assert.equal(f.service().enabled, false);
  assert.equal(f.service().configurationReady, false);
  assert.equal((await f.save({ enabled: true, settings: settings() })).status, 200);
  const task = await f.call('/api/tasks', { name: 'London departing', enabled: true,
    starts: [{ id: 'rule', name: 'Event', type: 'event', enabled: true,
      eventId: 'plugin:finavia:event:flight-departing:helsinki', condition: { field: 'route', operator: 'eq', value: 'LHR' } }],
    steps: [{ id: 'log', type: 'log', enabled: true, message: 'Flight departing' }],
  });
  assert.equal(task.status, 200, JSON.stringify(task.body));
  assert.equal((await f.action()).status, 200); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 1);
  await f.action(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 1);
  await f.response(xml([flight({ fltnr: 'AY1333' })])); await f.action(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 2);
  await f.restart(); await f.action(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 2);
  const captured = f.service().config.revision;
  await f.save({ settings: settings([location({ name: 'Renamed' })]) });
  assert.equal((await f.call('/api/plugins/finavia/config', { revision: captured, settings: settings() })).status, 409);
  await f.action(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 2);
  assert.ok(f.service().cardData.values['helsinki:flights'].available);
  await assert.rejects(fs.stat(path.join(f.root, 'data/plugins/finavia')), /ENOENT/);
  for (const file of ['config.json', 'state.json', 'cards.json', 'activity.jsonl']) {
    assert.equal((await fetch(f.app.origin + '/plugins/finavia/data/' + file)).status, 404);
  }
  const before = structuredClone(f.service().pluginState);
  await f.response('', baseTime, 429); assert.equal((await f.action()).status, 409);
  assert.deepEqual(f.service().pluginState, before);
  await f.save({ settings: settings([location({ enabled: false })]) });
  assert.equal(f.service().configurationReady, false);
  assert.equal(f.service().cardData.values['helsinki:flights'].available, false);
});

test('List Cards/Vistas project only chosen rows and columns, with time/countdown and provider credit', async t => {
  const f = await fixture(t);
  await f.save({ enabled: true, settings: settings() });
  await f.action();
  const definition = { schemaVersion: 1, name: 'Flights', enabled: true, icon: 'inherit', size: 'medium', layout: 'table',
    listOptions: { rows: 1, fontSize: 14, noWrap: true, columns: ['flight', 'time', 'in-minutes'] },
    fields: [{ id: 'flights-field', binding: 'helsinki:flights', label: 'Flights', enabled: true,
      icon: 'none', format: 'auto', unit: '', decimals: 0 }] };
  assert.equal((await f.call('/api/plugins/finavia/cards', definition)).status, 200);
  const card = f.service().cards[0];
  const vista = { schemaVersion: 1, name: 'Flights', slug: 'flights', enabled: true, gap: 0, padding: 0,
    layout: { id: 'root', name: 'Canvas', type: 'column', enabled: true, width: '1fr', height: '1fr', children: [
      { id: 'slot', name: 'Flights', type: 'card', enabled: true, width: '1fr', height: '1fr', cards: [{ pluginId: 'finavia', cardId: card.id }] },
    ] } };
  assert.equal((await f.call('/api/vistas', vista)).status, 200);
  const publicCard = (await f.call('/api/vistas/flights')).body.cards[0];
  const rows = publicCard.data.values['helsinki:flights'].value;
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]), ['flight', 'time', 'in-minutes']);
  assert.ok(!JSON.stringify(publicCard).includes(fakeKey));
  assert.doesNotMatch(JSON.stringify(publicCard), /monitoring|movement-id|claims|advance-minutes|token|api-key|api-origin/);
  const renderer = vm.runInNewContext(await fs.readFile(new URL('../web/card-renderer.js', import.meta.url), 'utf8') + '\nCardRenderer;', { Intl, Date, URL });
  const output = renderer.render(publicCard.card, publicCard.data, publicCard.catalog, { locale: 'en-GB', timeZone: 'Europe/Helsinki', timeFormat: '24', now: baseTime });
  assert.match(output, /15:01/);
  assert.match(output, /data-countdown-at="\d+">1 min<\/span>/);
  assert.doesNotMatch(output, /13 Oct|Oct 13|2026/);
  assert.match(output, /Finavia/);
  assert.match(renderer.render(publicCard.card, publicCard.data, publicCard.catalog, { locale: 'en-GB', timeZone: 'Europe/Helsinki', timeFormat: '12' }), /3:01 pm/);
});
