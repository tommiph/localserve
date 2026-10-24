/** Synthetic device/transport checks; no tests query a physical headset. */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, randomBytes, publicDecrypt, constants } from 'node:crypto';
import { connectAdb, packet, signToken, validKey, targetAddress, keyFromSetting } from '../plugins/oculus-go/server/adb.mjs';
import { batteryReading, powerReading, storageReading, activityReading, thermalReading } from '../plugins/oculus-go/server/readings.mjs';
import { createOculusAdapter } from '../plugins/oculus-go/server/index.mjs';
import { createVault } from '../plugins/oculus-go/server/vault.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { createLocalserve } from '../server.mjs';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const settings = { address: '10.23.42.7:5555', serial: 'GO-SERIAL', 'adb-key': '', 'poll-minutes': 0.25 };
const declaration = JSON.parse(await fs.readFile(new URL('../plugins/oculus-go/declaration.json', import.meta.url), 'utf8'));
const sample = {
  identity: 'GO-SERIAL\n', power: 'mState = AWAKE\n',
  battery: 'level: 50\nscale: 100\nAC powered: false\nUSB powered: true\nWireless powered: false\nstatus: 2\ntemperature: 255\n',
  activity: 'mResumedActivity: ActivityRecord{1 u0 com.example.game/.Main}',
  storage: 'Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/data 8388608 4194304 4194304 50% /data',
  thermal: 'ZONE:/sys/class/thermal/thermal_zone0\ntsens_tz_sensor0\n455\nZONE:/sys/class/thermal/thermal_zone1\nbattery\n25500\nZONE:/sys/class/thermal/thermal_zone2\nunknown\n9000\n',
};
function memoryContext(seed = {}) {
  let state = structuredClone(seed); const controller = new AbortController(), events = [];
  return { controller, events, get state() { return state; }, context: { signal: controller.signal,
    readState: async () => structuredClone(state), saveState: async value => { state = structuredClone(value); },
    log: async () => {}, emit: async (id, payload) => events.push({ id, payload, state: structuredClone(state) }) } };
}

test('declaration, local targets, secret exclusion and offline readiness', async () => {
  const plugin = validateDeclaration(declaration); assert.equal(plugin.name, 'Oculus Go');
  assert.equal(plugin.cardFields.find(field => field.id === 'sensors').columns.length, 5);
  assert.ok(!plugin.cardFields.some(field => field.source.key === 'adb-key' || field.source.key === 'serial'));
  for (const address of ['127.0.0.1:5555', '8.8.8.8:5555', '10.23.42.255:5555', '10.23.42.7:0', 'host:5555', '10.23.42.7:5555;reboot']) assert.equal(targetAddress(address), null);
  assert.equal(targetAddress(settings.address).port, 5555); assert.equal(validKey(key), true);
  assert.deepEqual(keyFromSetting(Buffer.from(key.privateKey).toString('base64')), key);
  const adapter = createOculusAdapter({ vault: { async load() { return key; } }, credentialReady: async () => true,
    connect: async () => { throw new Error('No network permitted during readiness/start.'); } });
  assert.equal(await adapter.validateConfiguration(settings), true);
  assert.equal(await adapter.validateConfiguration({ ...settings, serial: '' }), false);
  assert.equal(await adapter.validateConfiguration({ ...settings, 'adb-key': 'bad' }), false);
  await adapter.start(settings); await adapter.stop();
});

test('Go parsers preserve unknowns, exact temperature units and bounded rows', () => {
  assert.deepEqual(batteryReading(sample.battery), { 'battery-percent': 50, charging: true, 'battery-temperature': 25.5, 'battery-status': 'Charging' });
  assert.equal(batteryReading('')['battery-percent'], null); assert.equal(batteryReading('').charging, null);
  assert.equal(batteryReading('level: 110\nscale: 100')['battery-percent'], null);
  assert.equal(powerReading('history: STANDBY then AWAKE')['headset-state'], 'Unknown');
  assert.equal(powerReading('mState: STANDBY')['headset-state'], 'Standby');
  assert.equal(activityReading(sample.activity)['active-package'], 'com.example.game');
  assert.equal(storageReading(sample.storage)['storage-free-gib'], 4);
  assert.equal(storageReading(sample.storage)['storage-free-percent'], 50);
  assert.equal(storageReading(sample.storage.replace('1K-blocks', 'blocks'))['storage-free-gib'], null);
  assert.equal(storageReading(sample.storage.replace('1K-blocks', 'blocks'))['storage-free-percent'], null);
  const sensors = thermalReading(sample.thermal);
  assert.equal(sensors['sensor-1-celsius'], 45.5); assert.equal(sensors['sensor-2-celsius'], 25.5);
  assert.equal(sensors['sensor-3-celsius'], null); assert.equal(sensors['sensor-3-raw'], 9000);
  const many = thermalReading(Array.from({ length: 39 }, (_, i) => `ZONE:/sys/class/thermal/thermal_zone${i}\ntsens_tz_sensor${i}\n400\n`).join(''));
  assert.equal(many['sensor-count'], 39); assert.equal(many['sensor-row-count'], 10); assert.equal(many['sensors-truncated'], false);
  assert.equal(many['sensor-bank-4-count'], 9); assert.equal(many['sensor-39-celsius'], 40); assert.match(many['thermal-summary'], /thermal_zone38/);
});

test('ADB signs the existing SHA-1 challenge without hashing twice', () => {
  const token = randomBytes(20), signature = signToken(token, key.privateKey);
  const decoded = publicDecrypt({ key: pair.publicKey, padding: constants.RSA_PKCS1_PADDING }, signature);
  assert.equal(decoded.toString('hex'), '3021300906052b0e03021a05000414' + token.toString('hex'));
  assert.throws(() => signToken(Buffer.alloc(19), key.privateKey), /invalid/);
});

test('real TCP ADB framing authenticates, reads allowlisted streams and cancels a pending read', async t => {
  const sockets = new Set(), observed = [], token = randomBytes(20);
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 24 && buffer.length >= 24 + buffer.readUInt32LE(12)) {
        const name = buffer.subarray(0, 4).toString(), id = buffer.readUInt32LE(4), size = buffer.readUInt32LE(12), data = buffer.subarray(24, 24 + size);
        buffer = buffer.subarray(24 + size);
        if (name === 'CNXN') socket.write(packet('AUTH', 1, 0, token));
        if (name === 'AUTH') { assert.deepEqual(data, signToken(token, key.privateKey)); socket.write(packet('CNXN', 0x01000000, 4096, 'device::\0')); }
        if (name === 'OPEN') {
          observed.push(data.toString()); socket.write(packet('OKAY', 99, id));
          if (data.toString().startsWith('shell:getprop')) {
            const frame = packet('WRTE', 99, id, 'GO-SERIAL\n'); socket.write(frame.subarray(0, 13)); socket.write(frame.subarray(13));
          }
        }
        if (name === 'OKAY') socket.write(packet('CLSE', 99, id));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const controller = new AbortController();
  const connection = await connectAdb(settings.address, key, controller.signal, {
    socketFactory: () => net.createConnection({ host: '127.0.0.1', port: server.address().port }),
  });
  assert.equal(await connection.read('identity'), sample.identity);
  await assert.rejects(connection.read('reboot'), /Unsupported/);
  const pending = connection.read('battery'); controller.abort(new Error('cancelled'));
  await assert.rejects(pending, /cancelled/); connection.close();
  assert.deepEqual(observed, ['shell:getprop ro.serialno\0']);
});

test('adapter commits transitions, preserves failed sections and rejects wrong identities without writes', async () => {
  const raw = { ...sample }, failures = new Set(); let closed = 0, reads = [];
  const connect = async () => ({ async read(section) { reads.push(section); if (failures.has(section)) throw new Error('unavailable'); return raw[section]; }, close() { closed++; } });
  const adapter = createOculusAdapter({ vault: { async load() { return key; } }, connect });
  await adapter.start(settings); const harness = memoryContext();
  await adapter.execute('refresh', {}, harness.context);
  assert.deepEqual(harness.events.map(event => event.id), ['status-updated']);
  assert.equal(harness.state['active-app-display'], 'com.example.game');
  raw.activity = sample.activity.replace('com.example.game', 'com.example.next');
  await adapter.execute('refresh', {}, harness.context);
  assert.equal(harness.events[1].id, 'headset-changed'); assert.equal(harness.events[1].state['change-sequence'], 1);
  failures.add('battery'); failures.add('power');
  await adapter.execute('refresh', {}, harness.context);
  assert.equal(harness.state['battery-percent'], 50); assert.equal(harness.state['headset-state'], 'Unknown');
  assert.ok(!Object.hasOwn(harness.events.at(-1).payload, 'state'), 'missing power must not rearm a typed Task condition');
  assert.ok(!Object.hasOwn(harness.events.at(-1).payload, 'battery')); assert.equal(harness.state['change-sequence'], 1);
  failures.clear(); raw.power = 'mState: STANDBY';
  await adapter.execute('refresh', {}, harness.context); assert.equal(harness.state['active-app'], null);
  assert.equal(harness.state['active-app-display'], 'Not playing');
  const resumed = memoryContext(harness.state); await adapter.stop(); await adapter.start(settings);
  await adapter.execute('refresh', {}, resumed.context); assert.deepEqual(resumed.events.map(event => event.id), ['status-updated']);
  const saved = structuredClone(resumed.state); reads = []; raw.identity = 'OTHER';
  await assert.rejects(adapter.execute('refresh', {}, resumed.context), /serial/);
  assert.deepEqual(reads, ['identity']); assert.deepEqual(resumed.state, saved); assert.equal(closed, 6);
});

test('foreground minutes reset on app changes and become unavailable after an activity read failure', async () => {
  const raw = { ...sample }; let clock = 1_000_000, failActivity = false;
  const adapter = createOculusAdapter({ vault: { async load() { return key; } }, now: () => clock,
    connect: async () => ({ async read(section) {
      if (section === 'activity' && failActivity) throw new Error('unavailable');
      return raw[section];
    }, close() {} }) });
  const h = memoryContext(); await adapter.start(settings);
  await adapter.execute('refresh', {}, h.context);
  assert.equal(h.state['foreground-minutes'], 0);
  clock += 150_000; await adapter.execute('refresh', {}, h.context);
  assert.equal(h.state['foreground-minutes'], 2.5);
  raw.activity = sample.activity.replace('com.example.game', 'com.example.next');
  clock += 60_000; await adapter.execute('refresh', {}, h.context);
  assert.equal(h.state['foreground-minutes'], 0);
  failActivity = true; clock += 60_000; await adapter.execute('refresh', {}, h.context);
  assert.equal(h.state['foreground-minutes'], null);
  assert.equal(h.state['active-app-display'], 'com.example.next', 'failed activity retains the last known app');
  failActivity = false; clock += 60_000; await adapter.execute('refresh', {}, h.context);
  assert.equal(h.state['foreground-minutes'], 0);
  raw.activity = ''; clock += 60_000; await adapter.execute('refresh', {}, h.context);
  assert.equal(h.state['active-app-display'], 'Not playing');
  await adapter.stop();
});

test('cancelled and wholly unavailable diagnostics never persist or emit', async () => {
  const harness = memoryContext({ 'battery-percent': 25 }), original = structuredClone(harness.state);
  let abort = false, closed = 0;
  const adapter = createOculusAdapter({ vault: { async load() { return key; } },
    connect: async () => ({ async read(section) {
      if (section === 'identity') return sample.identity;
      if (abort) { harness.controller.abort(new Error('cancelled')); harness.context.signal.throwIfAborted(); }
      throw new Error('missing section');
    }, close() { closed++; } }) });
  await adapter.start(settings);
  await assert.rejects(adapter.execute('refresh', {}, harness.context), /unavailable/);
  assert.deepEqual(harness.state, original); assert.equal(harness.events.length, 0);
  abort = true;
  await assert.rejects(adapter.execute('refresh', {}, harness.context), /cancelled/);
  assert.deepEqual(harness.state, original); assert.equal(harness.events.length, 0); assert.equal(closed, 2);
});

test('own CurrentUser DPAPI key file roundtrips and retains damaged data', async t => {
  if (process.platform !== 'win32') return t.skip('Windows DPAPI');
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url)); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'oculus-vault-')), file = path.join(root, 'key.dpapi');
  t.after(async () => { assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const vault = createVault(file); assert.equal(await vault.load(), null); await vault.save(key);
  assert.deepEqual(await vault.load(), key); assert.ok(!(await fs.readFile(file)).includes('PRIVATE KEY'));
  await fs.writeFile(file, 'damaged'); await assert.rejects(vault.load()); assert.equal(await fs.readFile(file, 'utf8'), 'damaged');
});

test('installed runtime uses typed Tasks and projects only selected sensor cells without private keys', async t => {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url)); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'oculus-install-')), folder = path.join(root, 'plugins/oculus-go');
  await fs.cp(new URL('../plugins/oculus-go/', import.meta.url), folder, { recursive: true, filter: file => !file.split(path.sep).includes('data') });
  const metadata = structuredClone(declaration); metadata.runtime.entry = 'server/test-entry.mjs';
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(metadata));
  await fs.writeFile(path.join(folder, 'server/test-entry.mjs'), `
import {createOculusAdapter} from './index.mjs';
const key=${JSON.stringify(key)}, data=${JSON.stringify(sample)};
export default createOculusAdapter({vault:{async load(){return key;}},credentialReady:async()=>true,
connect:async()=>({async read(section){return data[section];},close(){}})});`);
  const app = await createLocalserve(root, { automatic: false });
  t.after(async () => { await app.close(); assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const call = async (route, values) => {
    const response = await fetch(app.origin + route, values === undefined ? {} : { method: 'POST', headers: {
      Origin: app.origin, 'Content-Type': 'application/json', 'X-Localserve-Token': app.snapshot().token }, body: JSON.stringify(values) });
    return { status: response.status, body: await response.json() };
  };
  const service = () => app.registry.services()[0];
  assert.equal((await call('/api/plugins/oculus-go/config', { revision: service().config.revision, enabled: true, settings })).status, 200);
  assert.equal(service().configurationReady, true);
  assert.equal((await call('/api/tasks', { name: 'Go battery', enabled: true,
    starts: [{ id: 'rule', name: 'Event', type: 'event', enabled: true, eventId: 'plugin:oculus-go:event:status-updated', condition: { field: 'battery', operator: 'lte', value: 50 } }],
    steps: [{ id: 'log', type: 'log', enabled: true, message: 'Battery reading' }] })).status, 200);
  for (let i = 0; i < 2; i++) assert.equal((await call('/api/plugins/oculus-go/actions/refresh', { parameters: {} })).status, 200);
  const deadline = Date.now() + 3000;
  while (app.engine.pending.size || app.engine.active.size) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal(app.state.snapshot().runs.length, 1);
  assert.equal((await call('/api/plugins/oculus-go/cards', { schemaVersion: 1, name: 'Sensors', enabled: true, icon: 'inherit', size: 'medium', layout: 'table',
    fields: [{ id: 'table', binding: 'sensors', label: 'Sensors', enabled: true, icon: 'none', format: 'auto', unit: '', decimals: 1 }],
    listOptions: { rows: 1, fontSize: 14, noWrap: false, columns: ['label', 'celsius'] } })).status, 200);
  await call('/api/vistas', { schemaVersion: 1, name: 'Go', slug: 'go', enabled: true, gap: 0, padding: 0,
    layout: { id: 'root', type: 'column', name: 'Canvas', enabled: true, width: '1fr', height: '1fr', children: [
      { id: 'slot', type: 'card', name: 'Sensors', enabled: true, width: '1fr', height: '1fr', cards: [{ pluginId: 'oculus-go', cardId: service().cards[0].id }] },
    ] } });
  const projection = (await call('/api/vistas/go')).body;
  assert.deepEqual(Object.keys(projection.cards[0].data.values.sensors.value[0]), ['label', 'celsius']);
  assert.doesNotMatch(JSON.stringify(projection), /PRIVATE KEY|serial|target-identity|presence-fingerprint|change-sequence|adb-key|token/);
  for (const file of ['config.json', 'state.json', 'adb-key.dpapi']) assert.equal((await fetch(app.origin + '/plugins/oculus-go/data/' + file)).status, 404);
});
