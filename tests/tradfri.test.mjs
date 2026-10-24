/** Synthetic gateway data/commands; these tests never contact physical lights. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createTradfriAdapter } from '../plugins/tradfri/server/index.mjs';
import { parseAccessory, parseGroup, lightPayload, withGateway, boundedIds } from '../plugins/tradfri/server/client.mjs';
import { lightRows, publicReading, lightColor } from '../plugins/tradfri/server/readings.mjs';
import { projectCardData } from '../server/cards.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { createVault } from '../plugins/tradfri/server/vault.mjs';
import { createLocalserve } from '../server.mjs';
import { validateValues } from '../server/plugin-schema.mjs';
const declaration = JSON.parse(await fs.readFile(new URL('../plugins/tradfri/declaration.json', import.meta.url), 'utf8'));
const settings = { host: '10.23.42.2', 'security-code': '', 'poll-minutes': 1 };
const auth = { host: settings.host, identity: 'test-identity', psk: 'test-psk' };
const rawLight = { 9001: 'Desk <light>', 9003: 65537, 5750: 2, 9019: 1, 3: { 1: 'TRADFRI bulb E27 WS opal 1000lm', 3: '1.0.0' }, 3311: [{ 9003: 0, 5850: 1, 5851: 127, 5711: 370 }] };
const rawGroup = { 9001: 'Office', 9003: 1, 5850: 1, 5851: 127, 9018: { 15002: { 9003: [65537] } } };
function harness(seed = {}) {
  let state = structuredClone(seed); const controller = new AbortController(), events = [];
  return { events, controller, get state() { return state; }, context: { signal: controller.signal,
    readState: async () => structuredClone(state), saveState: async value => { state = structuredClone(value); }, log: async () => {}, wait: async () => controller.signal.throwIfAborted(),
    emit: async (id, payload) => events.push({ id, payload, state: structuredClone(state) }) } };
}
function fakeGateway() {
  const light = structuredClone(rawLight), commands = []; let fail = false;
  return { light, commands, fail(value) { fail = value; }, gateway: async (host, signal, operation) => operation({
    async connect(identity, psk) { assert.equal(identity, auth.identity); assert.equal(psk, auth.psk); },
    async request(resource, method, payload) {
      signal.throwIfAborted(); if (fail) throw new Error('private ' + auth.psk);
      if (method === 'put') { commands.push({ resource, payload }); return { code: '2.04', payload: {} }; }
      return { code: '2.05', payload: structuredClone({ '15001': [65537], '15004': [1], '15001/65537': light, '15004/1': rawGroup }[resource]) };
    },
  }) };
}
const adapterFor = fake => createTradfriAdapter({ vault: { async load() { return auth; } }, credentialReady: async () => true, gateway: fake.gateway });

test('TRÅDFRI declaration/offline readiness/secret boundaries and invalid resources', async () => {
  const plugin = validateDeclaration(declaration); assert.equal(plugin.name, 'TRÅDFRI'); assert.equal(plugin.actions.length, 10);
  assert.equal(plugin.controls.taskSceneAction, 'run-scene');
  assert.ok(!plugin.controls.actions.includes('run-scene'), 'Stored scenes cannot recursively call scenes.');
  assert.ok(!plugin.cardFields.some(field => field.source.key === 'security-code'));
  const fake = fakeGateway(), adapter = adapterFor(fake);
  assert.equal(await adapter.validateConfiguration(settings), true);
  assert.equal(await adapter.validateConfiguration({ ...settings, host: '8.8.8.8' }), false);
  assert.equal(await adapter.validateConfiguration({ ...settings, host: '10.23.42.3' }), false);
  await adapter.start(settings); await adapter.stop(); assert.equal(fake.commands.length, 0);
  assert.throws(() => boundedIds(['../15001']), /invalid/); assert.throws(() => boundedIds(Array(101).fill(1)), /exceeds/);
});

test('actual bundled parser/conversions, missing reachability, bounded light/details/group projection', () => {
  const device = parseAccessory(rawLight), group = parseGroup(rawGroup);
  const rows = lightRows([device], [group]); assert.equal(rows[0].brightness, 50); assert.equal(rows[0].room, 'Office');
  assert.equal(rows[0].reachable, true); assert.equal(rows[0].spectrum, 'white');
  const missing = structuredClone(rawLight); delete missing['9019'];
  assert.equal(lightRows([parseAccessory(missing)], [group])[0].reachable, null);
  const reading = publicReading(Array.from({ length: 25 }, (_, i) => ({ ...rows[0], id: String(i + 1) })), [group], 123);
  assert.equal(reading['light-row-count'], 10); assert.equal(reading['light-bank-2-count'], 10); assert.equal(reading['lights-truncated'], true);
  assert.equal(reading['light-1-firmware'], '1.0.0'); assert.equal(reading['received-at'], 123);
  const off = publicReading([{ ...rows[0], on: false, brightness: 50 }], [], 123);
  assert.equal(off['light-1-display-brightness'], 0);
  assert.equal(off['light-1-brightness'], 50, 'the reported dimmer setting stays available to Lists');
  assert.equal(publicReading([{ ...rows[0], on: true, brightness: 50 }], [], 123)['light-1-display-brightness'], 50);
  assert.equal(publicReading([{ ...rows[0], on: null, brightness: null }], [], 123)['light-1-display-brightness'], null);
  assert.equal(lightColor({ spectrum: 'rgb', hue: 0, saturation: 100 }), '#FF0000');
  assert.equal(lightColor({ spectrum: 'white', temperature: 0 }), '4000 K');
  assert.equal(lightColor({ spectrum: 'white', temperature: 35 }), '3110 K');
  assert.equal(lightColor({ spectrum: 'white', temperature: 100 }), '2200 K');
  assert.equal(lightColor({ spectrum: 'white', temperature: null }), null);
  assert.equal(lightColor({ spectrum: 'rgb', hue: null, saturation: 100 }), null);
  const payload = lightPayload(device, { onOff: false }); assert.equal(payload['3311'][0]['5850'], 0);
  assert.equal(rawLight['3311'][0]['5850'], 1, 'operation serialization cannot mutate observed state');
});

test('Nordic card derives current time and solar events from the configured location', () => {
  const plugin = validateDeclaration(declaration), state = publicReading([], [], 123);
  const record = { health: 'ready', configured: true, config: { snapshot: () => ({ enabled: true, settings }) },
    state: { snapshot: () => state }, log: { latest: () => [] } };
  const now = Date.parse('2026-10-14T12:00:00Z');
  const values = projectCardData(plugin, record, false, { now, location: { latitude: 60.4048, longitude: 25.113 } }).values;
  assert.equal(values['current-time'].value, now);
  assert.ok(Number.isFinite(values['sunrise-time'].value));
  assert.ok(Number.isFinite(values['sunset-time'].value));
  assert.ok(values['sunrise-time'].value < values['sunset-time'].value);
  assert.equal(projectCardData(plugin, record, false, { now }).values['sunrise-time'].available, false);
});

test('readings commit change claims, omit unknown properties and survive restart without replay', async () => {
  const fake = fakeGateway(), adapter = adapterFor(fake), h = harness(); await adapter.start(settings);
  await adapter.execute('refresh', {}, h.context); assert.deepEqual(h.events.map(event => event.id), ['status-updated']);
  fake.light['3311'][0]['5850'] = 0;
  await adapter.execute('refresh', {}, h.context); assert.equal(h.events[1].id, 'light-changed'); assert.equal(h.events[1].state.sequence, 1);
  delete fake.light['9019']; await adapter.execute('refresh', {}, h.context); assert.equal(h.state.sequence, 1);
  fake.light['9019'] = 1; await adapter.execute('refresh', {}, h.context); assert.equal(h.state.sequence, 1);
  const restarted = harness(h.state); await adapter.stop(); await adapter.start(settings); await adapter.execute('refresh', {}, restarted.context);
  assert.deepEqual(restarted.events.map(event => event.id), ['status-updated']);
  const saved = structuredClone(restarted.state); fake.fail(true);
  await assert.rejects(adapter.execute('refresh', {}, restarted.context), error => !error.message.includes(auth.psk));
  assert.deepEqual(restarted.state, saved);
});

test('lighting commands serialize once, enforce capabilities and never optimistically alter Cards', async () => {
  const fake = fakeGateway(), adapter = adapterFor(fake), h = harness(); await adapter.start(settings);
  await adapter.execute('refresh', {}, h.context); const before = structuredClone(h.state);
  await adapter.execute('light-power', { id: '65537', on: false }, h.context);
  assert.equal(fake.commands.length, 1); assert.equal(fake.commands[0].payload['3311'][0]['5850'], 0); assert.deepEqual(h.state, before);
  await adapter.execute('group-brightness', { id: '1', value: 50 }, h.context); assert.equal(fake.commands[1].payload['5851'], 127);
  await assert.rejects(adapter.execute('light-color', { id: '65537', color: '#ff0000' }, h.context), /does not support/);
  await assert.rejects(adapter.execute('light-brightness', { id: '../bad', value: 50 }, h.context), /reported/);
  assert.equal(fake.commands.length, 2);
});

test('captured light state restores power/dimmer/white in one write without changing readings', async () => {
  const fake = fakeGateway(), adapter = adapterFor(fake), h = harness(); await adapter.start(settings);
  await adapter.execute('light-state', { id: '65537', on: false, brightness: 25, temperature: 80 }, h.context);
  assert.equal(fake.commands.length, 1);
  const payload = fake.commands[0].payload['3311'][0];
  assert.equal(payload['5850'], 0); assert.ok(payload['5851'] >= 63 && payload['5851'] <= 64);
  assert.ok(payload['5711'] > 400);
  assert.equal(fake.light['3311'][0]['5850'], 1); assert.deepEqual(h.state, {});
  fake.light['3311'][0]['5850'] = 0;
  await adapter.execute('light-state', { id: '65537', on: false, brightness: 25 }, h.context);
  assert.equal(fake.commands[1].payload['3311'][0]['5850'], 0, 'unchanged Off must be explicit alongside dimmer');
  await assert.rejects(adapter.execute('light-state', { id: '65537', on: false, brightness: 20, hue: 180, saturation: 100 }, h.context), /captured colour/);
  assert.equal(fake.commands.length, 2);
});

test('animation-owned fades override one combined light write without changing scene defaults', async () => {
  const fake=fakeGateway(),adapter=adapterFor(fake),h=harness();
  await adapter.start({...settings,'fade-seconds':0.4});
  await adapter.execute('light-state',{id:'65537',on:true,brightness:25,temperature:70},{...h.context,lightingFadeSeconds:12.3});
  assert.equal(fake.commands.at(-1).payload['3311'][0]['5712'],123);
  await adapter.execute('light-state',{id:'65537',on:true,brightness:30,temperature:70},h.context);
  assert.equal(fake.commands.at(-1).payload['3311'][0]['5712'],4);
  await adapter.execute('light-state',{id:'65537',on:true,brightness:35,temperature:70},{...h.context,lightingFadeSeconds:0});
  assert.equal(fake.commands.at(-1).payload['3311'][0]['5712'],0);
  assert.deepEqual(h.state,{});await adapter.stop();
});

test('fade settings reach supported light/group/scene commands with legacy defaults and explicit zero', async () => {
  const plugin = validateDeclaration(declaration);
  const fadeField = plugin.settings.find(field => field.id === 'fade-seconds');
  assert.equal(fadeField.default, 0.4);
  for (const [seconds, ticks] of [[undefined, 4], [0, 0], [1.25, 13], [60, 600]]) {
    const fake = fakeGateway(), adapter = adapterFor(fake), h = harness();
    await adapter.start({ ...settings, ...(seconds === undefined ? {} : { 'fade-seconds': seconds }) });
    await adapter.execute('light-brightness', { id: '65537', value: 25 }, h.context);
    await adapter.execute('light-temperature', { id: '65537', value: 70 }, h.context);
    await adapter.execute('light-state', { id: '65537', on: true, brightness: 25, temperature: 70 }, h.context);
    for (const command of fake.commands) assert.equal(command.payload['3311'][0]['5712'], ticks);
    await adapter.execute('group-brightness', { id: '1', value: 25 }, h.context);
    assert.equal(fake.commands.at(-1).payload['5712'], ticks);
    await adapter.execute('group-power', { id: '1', on: false }, h.context);
    assert.deepEqual(fake.commands.at(-1).payload, { '5850': 0 }, 'simple group power has no transition');

    fake.light['3311'][0]['5707'] = 0;
    fake.light['3311'][0]['5708'] = 65535;
    await adapter.execute('light-color', { id: '65537', color: '#00ff00' }, h.context);
    assert.equal(fake.commands.at(-1).payload['3311'][0]['5712'], ticks);
    assert.equal(fake.commands.length, 6, 'one write per explicit command');
    assert.deepEqual(h.state, {}, 'fade commands cannot change reported readings');
    await adapter.stop();
  }
  const adapter = adapterFor(fakeGateway());
  for (const invalid of [-1, 60.1, NaN, Infinity, '1', null]) {
    const values = { ...settings, 'fade-seconds': invalid };
    assert.throws(() => validateValues(plugin.settings, values));
    assert.equal(await adapter.validateConfiguration(values), false);
    await assert.rejects(adapter.start(values), /Fade duration/);
  }
});

test('gateway cancellation closes only its owned client and discards late completion', async () => {
  const controller = new AbortController(); let destroyed = 0, complete;
  const client = new EventEmitter(); client.destroy = () => { destroyed++; };
  const pending = withGateway(settings.host, controller.signal, () => new Promise(resolve => { complete = resolve; }), () => client);
  await Promise.resolve(); controller.abort(new Error('cancelled'));
  await assert.rejects(pending, /cancelled/); complete('late'); assert.ok(destroyed >= 1);
});

test('configured code authenticates once across refresh/restart; explicit reauthentication remains available', async () => {
  let saved = auth, authentications = 0;
  const fake = fakeGateway(), withCode = { ...settings, 'security-code': 'test-printed-code' };
  const adapter = createTradfriAdapter({ vault: { async load() { return saved; }, async save(value) { saved = structuredClone(value); } },
    gateway: async (host, signal, operation) => fake.gateway(host, signal, client => operation({ ...client, async authenticate() { authentications++; return { identity: auth.identity, psk: auth.psk }; } })) });
  const h = harness(); await adapter.start(withCode);
  await adapter.execute('refresh', {}, h.context); await adapter.execute('refresh', {}, h.context); assert.equal(authentications, 1);
  await adapter.stop(); await adapter.start(withCode); await adapter.execute('refresh', {}, h.context); assert.equal(authentications, 1);
  await adapter.execute('reconnect', {}, h.context); assert.equal(authentications, 2);
  assert.doesNotMatch(JSON.stringify(saved), /test-printed-code/); assert.equal(fake.commands.length, 0);
});

test('pause/cancellation gate after a target read prevents a lighting write', async () => {
  const fake = fakeGateway(), adapter = adapterFor(fake), h = harness(); await adapter.start(settings);
  h.context.wait = async () => { h.controller.abort(new Error('cancelled at gate')); h.controller.signal.throwIfAborted(); };
  await assert.rejects(adapter.execute('light-power', { id: '65537', on: false }, h.context), /cancelled at gate/);
  assert.equal(fake.commands.length, 0); assert.deepEqual(h.state, {});
});

test('TRÅDFRI own DPAPI credentials roundtrip and retain damaged files', async t => {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url)); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'tradfri-vault-')), file = path.join(root, 'auth.dpapi');
  t.after(async () => { assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const vault = createVault(file); await vault.save(auth); assert.deepEqual(await vault.load(), auth);
  assert.ok(!(await fs.readFile(file)).includes(auth.psk)); await fs.writeFile(file, 'damaged'); await assert.rejects(vault.load()); assert.equal(await fs.readFile(file, 'utf8'), 'damaged');
});

test('installed TRÅDFRI runtime projects chosen List columns and keeps credentials/internal claims private', async t => {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url)); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'tradfri-install-')), folder = path.join(root, 'plugins/tradfri');
  await fs.cp(new URL('../plugins/tradfri/', import.meta.url), folder, { recursive: true, filter: file => !file.split(path.sep).includes('data') });
  const metadata = structuredClone(declaration); metadata.runtime.entry = 'server/test-entry.mjs'; await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(metadata));
  await fs.writeFile(path.join(folder, 'server/test-entry.mjs'), `import {createTradfriAdapter} from './index.mjs';
const auth=${JSON.stringify(auth)}, light=${JSON.stringify(rawLight)}, group=${JSON.stringify(rawGroup)};
export default createTradfriAdapter({vault:{async load(){return auth;}},credentialReady:async()=>true,
gateway:async(host,signal,operation)=>operation({async connect(){},async request(path){return {code:'2.05',payload:({'15001':[65537],'15004':[1],'15001/65537':light,'15004/1':group})[path]};}})});`);
  const app = await createLocalserve(root, { automatic: false });
  t.after(async () => { await app.close(); assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const call = async (route, body) => { const response = await fetch(app.origin + route, body === undefined ? {} : { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json', 'X-Localserve-Token': app.snapshot().token }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const service = () => app.registry.services()[0];
  assert.equal((await call('/api/plugins/tradfri/config', { revision: service().config.revision, enabled: true, settings })).status, 200);
  assert.equal((await call('/api/plugins/tradfri/actions/refresh', { parameters: {} })).status, 200);
  assert.equal((await call('/api/plugins/tradfri/cards', { schemaVersion: 1, name: 'Lights', enabled: true, icon: 'inherit', size: 'medium', layout: 'table', fields: [{ id: 'table', binding: 'lights', label: 'Lights', enabled: true, icon: 'none', format: 'auto', unit: '', decimals: 0 }], listOptions: { rows: 1, fontSize: 14, noWrap: false, columns: ['name', 'on'] } })).status, 200);
  await call('/api/vistas', { schemaVersion: 1, name: 'Lights', slug: 'lights', enabled: true, gap: 0, padding: 0, layout: { id: 'root', type: 'column', name: 'Canvas', enabled: true, width: '1fr', height: '1fr', children: [{ id: 'slot', type: 'card', name: 'Lights', enabled: true, width: '1fr', height: '1fr', cards: [{ pluginId: 'tradfri', cardId: service().cards[0].id }] }] } });
  const publicData = (await call('/api/vistas/lights')).body;
  assert.deepEqual(Object.keys(publicData.cards[0].data.values.lights.value[0]), ['name', 'on']);
  assert.doesNotMatch(JSON.stringify(publicData), /identity|test-psk|light-baseline|gateway-host|security-code|token/);
  for (const name of ['config.json', 'state.json', 'credentials.dpapi']) assert.equal((await fetch(app.origin + '/plugins/tradfri/data/' + name)).status, 404);
});
