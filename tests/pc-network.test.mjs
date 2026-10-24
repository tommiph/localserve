/** Injected telemetry/DNS and isolated installations; native checks read only
 * this PC's counters. No live provider, process listing, or LAN sweep occurs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createLocalserve } from '../server.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { validateValues } from '../server/plugin-schema.mjs';
import { createPcNetworkAdapter, collectWindows, publicReading, neighborRows, lookupTarget, localAddress } from '../plugins/pc-network/server/index.mjs';

const source = fileURLToPath(new URL('../plugins/pc-network/', import.meta.url));
const temporary = fileURLToPath(new URL('./.tmp/', import.meta.url));
const gib = 1024 ** 3;
const baseTime = Date.parse('2026-10-13T12:00:00Z');
const system = { hostname: () => 'test-pc', type: () => 'Windows_NT', release: () => '10.0',
  cpus: () => [{ model: 'Synthetic CPU' }, { model: 'Synthetic CPU' }], uptime: () => 7200 };
const settings = { 'poll-minutes': 1 / 6, 'resolve-neighbors': true };
const neighbor = (address = '192.168.1.1', overrides = {}) => ({ address, index: 2, mac: 'AA-BB-CC-DD-EE-10', state: 'Stale', ...overrides });
const sample = (overrides = {}) => ({ cpu: 25, sampleSeconds: 1, totalMemory: 16 * gib, availableMemory: 12 * gib,
  commitUsed: 5 * gib, commitLimit: 24 * gib,
  adapters: [{ id: 'nic', index: 2, name: 'Ethernet', status: 'Up', speed: 1e9,
    addresses: ['192.168.1.3', 'fe80::1'], receiveMbps: 1.25, transmitMbps: 0.5 }],
  disks: [{ name: 'C:\\', total: 100 * gib, free: 40 * gib }], neighbors: [neighbor()], ...overrides });
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
const adapter = (overrides = {}) => createPcNetworkAdapter({ collector: async () => sample(),
  reverse: async () => ['router.home.arpa'], lookup: async () => [{ address: '192.168.1.2', family: 4 }],
  now: () => baseTime, system, platform: 'win32', helperReady: async () => true, ...overrides });

test('declaration, offline readiness, fractional-minute polling and typed public tables', async () => {
  const plugin = validateDeclaration(JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8')));
  assert.equal(plugin.name, 'PC and Network');
  assert.equal(plugin.settings[0].default * 60, 10);
  assert.equal(plugin.cardFields.filter(field => field.type === 'table').length, 4);
  let reads = 0;
  const runtime = adapter({ collector: async () => { reads++; return sample(); } });
  assert.equal(await runtime.validateConfiguration(settings), true);
  assert.equal(await adapter({ platform: 'linux' }).validateConfiguration(settings), false);
  assert.equal(await adapter({ helperReady: async () => false }).validateConfiguration(settings), false);
  assert.equal(await runtime.validateConfiguration({ 'poll-minutes': 0, 'resolve-neighbors': true }), false);
  await runtime.start(settings);
  assert.equal(reads, 0);
  const context = host();
  await runtime.execute('refresh', {}, context);
  assert.deepEqual(context.calls.map(call => call[0]), ['save', 'event']);
  validateValues(plugin.events[0].payload, context.calls[1][2]);
  const state = await context.readState();
  assert.equal(state['cpu-percent'], 25);
  assert.equal(state['neighbor-1-hostname'], 'router.home.arpa');
  assert.ok(JSON.stringify(state).length < 65536);
});

test('CPU/memory/disk/network readings preserve missing counters and invalid input fails', () => {
  const result = publicReading(sample(), system, baseTime);
  assert.equal(result['memory-percent'], 25);
  assert.equal(result['memory-used-gib'], 4);
  assert.equal(result['disk-1-used'], 60);
  assert.equal(result['drive-d-free-percent'], null);
  assert.equal(result['drive-e-free-percent'], null);
  assert.equal(result['adapter-1-link'], 1000);
  assert.equal(result['adapter-1-address'], '192.168.1.3\nfe80::1');
  assert.equal(result['receive-mbps'], 1.25);
  assert.equal(result['updated-at'], baseTime);
  const absent = publicReading(sample({ cpu: null, adapters: [] }), system);
  assert.equal(absent['cpu-percent'], null);
  assert.equal(absent['receive-mbps'], null);
  assert.equal(absent['adapter-1-receive'], null);
  assert.equal(publicReading(sample({ cpu: 200 }), system)['cpu-percent'], null);
  assert.throws(() => publicReading(sample({ availableMemory: 30 * gib }), system));
  assert.throws(() => publicReading(sample({ neighbors: {} }), system));
});

const gpu = (overrides = {}) => ({ id: '00000000_00000042', name: 'Synthetic GPU', usage: 25,
  dedicatedTotal: 8 * gib, dedicatedUsed: 2 * gib, sharedLimit: 16 * gib, sharedUsed: 0, ...overrides });

test('GPU readings keep adapters separate, preserve same-identity failures, and clear removed or replacement GPUs', () => {
  const first = publicReading(sample({ gpus: [gpu(), gpu({ id: '00000000_00000043', name: 'Second GPU', usage: 80 })] }), system, baseTime);
  assert.equal(first['gpu-count'], 2);
  assert.equal(first['gpu-1-percent'], 25);
  assert.equal(first['gpu-2-percent'], 80);
  assert.equal(first['gpu-1-dedicated-used-gib'], 2);
  assert.equal(first['gpu-1-shared-used-gib'], 0, 'A reported zero is retained');
  assert.equal(first['gpu-1-received-at'], baseTime);
  const partial = publicReading(sample({ gpus: [gpu({ usage: null, sharedUsed: null })] }), system, baseTime + 1000, first);
  assert.equal(partial['gpu-1-percent'], 25);
  assert.equal(partial['gpu-1-received-at'], baseTime, 'Retained counters are not stamped as current');
  assert.match(partial['gpu-1-status'], /previous readings retained/);
  assert.equal(partial['gpu-2-name'], null, 'Removed rows are cleared');
  const unavailable = publicReading(sample({ gpus: null }), system, baseTime + 2000, first);
  assert.equal(unavailable['gpu-count'], 2);
  assert.equal(unavailable['gpu-2-percent'], 80);
  assert.match(unavailable['gpu-2-status'], /Unavailable/);
  const replacement = publicReading(sample({ gpus: [gpu({ id: '00000000_00000044', usage: null })] }), system, baseTime + 2000, first);
  assert.equal(replacement['gpu-1-percent'], null, 'Never attach an old GPU value to a new adapter');
  assert.equal(replacement['gpu-1-received-at'], null);
  const empty = publicReading(sample({ gpus: [] }), system, baseTime, first);
  assert.equal(empty['gpu-count'], 0);
  assert.equal(empty['gpu-1-name'], null);
  const unsupported = publicReading(sample({ gpus: [gpu({ usage: null, dedicatedUsed: null, sharedUsed: null })] }), system, baseTime);
  assert.equal(unsupported['gpu-1-percent'], null);
  assert.equal(unsupported['gpu-1-dedicated-used-gib'], null);
  assert.equal(unsupported['gpu-1-received-at'], null);
  assert.equal(publicReading(sample({ gpus: [gpu({ usage: Infinity, dedicatedUsed: -1 })] }), system)['gpu-1-percent'], null);
  assert.throws(() => publicReading(sample({ gpus: Array(5).fill(gpu()) }), system));
  assert.throws(() => publicReading(sample({ gpus: [gpu({ id: 'arbitrary' })] }), system));
});

test('missing GPU counters are omitted from Events while Cards retain successful same-adapter readings', async () => {
  let data = sample({ gpus: [gpu()] });
  const runtime = adapter({ collector: async () => data });
  const context = host();
  await runtime.start(settings);
  await runtime.execute('refresh', {}, context);
  assert.equal(context.calls.find(call => call[0] === 'event')[2]['gpu-1-percent'], 25);
  data = sample({ gpus: [gpu({ usage: null, dedicatedUsed: null })] });
  context.calls.length = 0;
  await runtime.execute('refresh', {}, context);
  const payload = context.calls.find(call => call[0] === 'event')[2];
  assert.equal(Object.hasOwn(payload, 'gpu-1-percent'), false);
  assert.equal(Object.hasOwn(payload, 'gpu-1-dedicated-used-gib'), false);
  assert.equal((await context.readState())['gpu-1-percent'], 25);
  await runtime.stop();
});

test('native GPU aggregation uses the busiest summed engine and direct adapter memory only', { skip: process.platform !== 'win32' }, async () => {
  await fs.mkdir(temporary, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporary, 'gpu-native-'));
  try {
    const sourceFile = path.join(root, 'GpuSpec.cs'), executable = path.join(root, 'GpuSpec.exe');
    await fs.writeFile(sourceFile, `using System;
using System.Collections.Generic;
using System.Reflection;
internal static class GpuSpec {
  static void Equal(double? actual, double? expected) { if(actual != expected) throw new Exception("GPU aggregation mismatch"); }
  public static int Main() {
    var usage=typeof(GpuReadings).GetMethod("Usage", BindingFlags.Static|BindingFlags.NonPublic);
    var memory=typeof(GpuReadings).GetMethod("Memory", BindingFlags.Static|BindingFlags.NonPublic);
    string id="00000000_00000042", prefix="luid_0x00000000_0x00000042_phys_0";
    var counters=new Dictionary<string,double?> {
      {"pid_1_"+prefix+"_eng_0_engtype_3D",20}, {"pid_2_"+prefix+"_eng_0_engtype_3D",30},
      {"pid_1_"+prefix+"_eng_1_engtype_Copy",80},
      {"pid_1_luid_0x00000000_0x00000043_phys_0_eng_0_engtype_3D",99}
    };
    Equal((double?)usage.Invoke(null,new object[]{counters,id}),80);
    counters["pid_2_"+prefix+"_eng_0_engtype_3D"]=null;
    Equal((double?)usage.Invoke(null,new object[]{counters,id}),null);
    Equal((double?)usage.Invoke(null,new object[]{new Dictionary<string,double?>(),id}),null);
    var bytes=new Dictionary<string,double?> {{prefix,0}};
    Equal((double?)memory.Invoke(null,new object[]{bytes,id}),0);
    bytes["luid_0x00000000_0x00000042_phys_1"]=100;
    Equal((double?)memory.Invoke(null,new object[]{bytes,id}),null);
    Console.WriteLine("GPU aggregation passed"); return 0;
  }
}`);
    const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', `/out:${executable}`, sourceFile, path.join(source, 'native/GpuReadings.cs')], { windowsHide: true });
    assert.match(execFileSync(executable, [], { windowsHide: true }).toString(), /GPU aggregation passed/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(temporary) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('D: and E: gauges follow drive letters and leave missing or invalid volumes unavailable', () => {
  const disks = [
    { name: 'E:\\', total: 200 * gib, free: 50 * gib },
    { name: 'C:\\', total: 100 * gib, free: 40 * gib },
    { name: 'D:\\', total: 80 * gib, free: 16 * gib },
  ];
  const reading = publicReading(sample({ disks }), system);
  assert.equal(reading['drive-d-free-percent'], 20);
  assert.equal(reading['drive-e-free-percent'], 25);
  assert.equal(publicReading(sample({ disks: disks.slice(0, 2) }), system)['drive-d-free-percent'], null);
  assert.equal(publicReading(sample({ disks: [{ name: 'E:\\', total: 0, free: 0 }] }), system)['drive-e-free-percent'], null);
});

test('neighbor display is a bounded private unicast cache view, not an online inventory', () => {
  const rows = neighborRows([neighbor(), neighbor(), neighbor('8.8.8.8'), neighbor('127.0.0.1'),
    neighbor('192.168.1.2', { mac: 'FF-FF-FF-FF-FF-FF' }), neighbor('192.168.1.3', { mac: '00-00-00-00-00-00' }),
    neighbor('192.168.1.4', { state: 'Incomplete' }), neighbor('192.168.1.5', { state: 'Reachable' })]);
  assert.deepEqual(rows.map(row => row.address), ['192.168.1.5', '192.168.1.1']);
  assert.equal(rows[1].state, 'Stale');
  assert.equal(neighborRows(null), null);
  assert.equal(neighborRows(Array.from({ length: 20 }, (_, i) => neighbor(`10.0.0.${i + 1}`))).length, 10);
  assert.ok(localAddress('172.31.0.1'));
  assert.ok(!localAddress('172.32.0.1'));
  assert.ok(!localAddress('not-an-ip'));
});

test('two PTR attempts per refresh, explicit failures, cached success/failure and restart retention', async () => {
  let clock = baseTime, reads = 0;
  const data = sample({ neighbors: [neighbor('192.168.1.1'), neighbor('192.168.1.2'), neighbor('192.168.1.3')] });
  const runtime = adapter({ collector: async () => data, now: () => clock, reverse: async ip => {
    reads++;
    if (ip.endsWith('.1')) return ['router.home.arpa'];
    throw Object.assign(new Error('No PTR'), { code: 'ENOTFOUND' });
  } });
  await runtime.start(settings);
  const context = host();
  await runtime.execute('refresh', {}, context);
  assert.equal(reads, 2);
  let state = await context.readState();
  assert.equal(state['neighbor-2-hostname'], null);
  assert.equal(state['neighbor-2-resolution'], 'Unresolved');
  assert.equal(state['neighbor-3-resolution'], 'Not checked');
  await runtime.execute('refresh', {}, context);
  assert.equal(reads, 3);
  await runtime.stop(); await runtime.start(settings);
  await runtime.execute('refresh', {}, context);
  assert.equal(reads, 3);
  clock += 300000;
  await runtime.execute('refresh', {}, context);
  assert.equal(reads, 5, 'Only failed lookups expired at five minutes');
  data.neighbors = null;
  await runtime.execute('refresh', {}, context);
  state = await context.readState();
  assert.equal(state['neighbor-count'], 3);
  assert.match(state['neighbors-status'], /previous rows retained/);
  await runtime.stop(); await runtime.start({ ...settings, 'resolve-neighbors': false });
  await runtime.execute('refresh', {}, context);
  assert.equal((await context.readState())['neighbor-1-hostname'], null);
  assert.equal((await context.readState())['neighbor-1-resolution'], 'Disabled');
  assert.equal(reads, 5);
});

test('manual lookup uses OS forward resolution or explicit reverse DNS and never shell input', async () => {
  for (const value of ['https://example.com', 'host:443', '192.168.1.0/24', 'host;start', '-x', 'a..b']) assert.equal(lookupTarget(value), null);
  assert.equal(lookupTarget('Printer.local'), 'printer.local');
  assert.equal(lookupTarget('::1'), '::1');
  const runtime = adapter();
  await runtime.start(settings);
  const context = host();
  await runtime.execute('lookup', { target: 'Printer.local' }, context);
  assert.equal((await context.readState())['lookup-addresses'], '192.168.1.2');
  await runtime.execute('lookup', { target: '192.168.1.1' }, context);
  assert.equal((await context.readState())['lookup-hostname'], 'router.home.arpa');
  assert.equal(context.calls.filter(call => call[0] === 'event').length, 2);
  const plugin = validateDeclaration(JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8')));
  for (const call of context.calls.filter(call => call[0] === 'event')) validateValues(plugin.events[1].payload, call[2]);
  await assert.rejects(runtime.execute('lookup', { target: 'host;exit' }, context), /hostname/);
  const failure = adapter({ lookup: async () => { throw Object.assign(new Error('Bad request'), { code: 'ENOTFOUND' }); } });
  await failure.start(settings);
  await failure.execute('lookup', { target: 'missing.local' }, context);
  assert.equal((await context.readState())['lookup-status'], 'Unresolved');
});

test('collection failure, persistence failure and lookup cancellation cannot emit new effects', async () => {
  const initial = { 'cpu-percent': 42, 'updated-at': baseTime - 1000 };
  const failing = adapter({ collector: async () => { throw new Error('Unavailable'); } });
  await failing.start(settings);
  const context = host(initial);
  await assert.rejects(failing.execute('refresh', {}, context), /Unavailable/);
  assert.deepEqual(await context.readState(), initial);
  assert.equal(context.calls.filter(call => call[0] === 'event').length, 0);
  const runtime = adapter(); await runtime.start(settings);
  const diskFailure = host(); diskFailure.saveState = async () => { throw new Error('Disk unavailable'); };
  await assert.rejects(runtime.execute('refresh', {}, diskFailure), /Disk unavailable/);
  assert.equal(diskFailure.calls.length, 0);
  const controller = new AbortController();
  const cancelling = adapter({ lookup: async () => { controller.abort(new Error('Cancelled')); return [{ address: '192.168.1.1' }]; } });
  await cancelling.start(settings);
  const cancelled = host({}, controller);
  await assert.rejects(cancelling.execute('lookup', { target: 'printer.local' }, cancelled), /Cancelled/);
  assert.deepEqual(cancelled.calls, []);
});

test('lookup deadlines abandon late results without writes after timeout', async () => {
  let finish;
  const runtime = adapter({ lookup: () => new Promise(resolve => { finish = resolve; }) });
  await runtime.start(settings);
  const context = host();
  await runtime.execute('lookup', { target: 'slow.local' }, context);
  assert.equal((await context.readState())['lookup-status'], 'Timed out');
  const calls = context.calls.length;
  finish([{ address: '192.168.1.1' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.calls.length, calls);
});

test('bundled Windows collector returns actual bounded telemetry and cooperatively cancels', { skip: process.platform !== 'win32' }, async () => {
  const data = await collectWindows(new AbortController().signal);
  const reading = publicReading(data);
  assert.ok(reading['memory-total-gib'] > 0);
  assert.ok(data.adapters.length <= 10);
  assert.ok(data.neighbors === null || data.neighbors.length <= 256);
  assert.ok(data.gpus === null || data.gpus.length <= 4);
  const controller = new AbortController();
  const operation = collectWindows(controller.signal);
  setTimeout(() => controller.abort(new Error('Cancelled test sample')), 100);
  await assert.rejects(operation, /Cancelled test sample/);
});

async function fixture(t) {
  await fs.mkdir(temporary, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporary, 'pc-network-'));
  const folder = path.join(root, 'plugins/pc-network');
  await fs.mkdir(path.join(folder, 'server'), { recursive: true });
  await fs.copyFile(path.join(source, 'server/index.mjs'), path.join(folder, 'server/index.mjs'));
  const declaration = JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8'));
  declaration.runtime.entry = 'server/test-entry.mjs';
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(declaration));
  const response = async (data = sample()) => fs.writeFile(path.join(folder, 'server/sample.json'), JSON.stringify(data));
  await response();
  await fs.writeFile(path.join(folder, 'server/test-entry.mjs'), `
import fs from 'node:fs/promises';
import { createPcNetworkAdapter } from './index.mjs';
export default createPcNetworkAdapter({ collector: async () => JSON.parse(await fs.readFile(new URL('./sample.json', import.meta.url), 'utf8')),
  platform: 'win32', helperReady: async () => true, reverse: async () => ['router.home.arpa'] });`);
  let app = await createLocalserve(root, { automatic: false });
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(temporary) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  const service = () => app.registry.services()[0];
  const call = async (route, values) => {
    const r = await fetch(app.origin + route, values === undefined ? {} : { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: app.origin, 'X-Localserve-Token': app.snapshot().token }, body: JSON.stringify(values) });
    return { status: r.status, body: await r.json() };
  };
  return { root, service, call, response, get app() { return app; },
    refresh: () => call('/api/plugins/pc-network/actions/refresh', { parameters: {} }),
    async restart() { await app.close(); app = await createLocalserve(root, { automatic: false }); },
  };
}
async function settle(f) {
  const deadline = Date.now() + 5000;
  while (f.app.engine.active.size || f.app.engine.pending.size) {
    if (Date.now() > deadline) throw new Error('PC status Task did not settle');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('GPU Task conditions retain true edges and missing samples; Vistas export only selected GPU cells', async t => {
  const f = await fixture(t);
  await f.response(sample({ gpus: [gpu({ usage: 90 }), gpu({ id: '00000000_00000043', name: 'Hidden second GPU' })] }));
  await f.call('/api/plugins/pc-network/config', { revision: f.service().config.revision, enabled: true });
  const task = await f.call('/api/tasks', { name: 'GPU busy', enabled: true,
    starts: [{ id: 'rule', name: 'Event', type: 'event', enabled: true,
      eventId: 'plugin:pc-network:event:status-updated', condition: { field: 'gpu-1-percent', operator: 'gte', value: 80 } }],
    steps: [{ id: 'log', type: 'log', enabled: true, message: 'GPU busy' }] });
  assert.equal(task.status, 200, JSON.stringify(task.body));
  await f.refresh(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 1);
  await f.response(sample({ gpus: null })); await f.refresh(); await settle(f);
  await f.restart();
  await f.response(sample({ gpus: [gpu({ usage: 95 })] })); await f.refresh(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 1, 'Missing/restart samples do not rearm a true condition');
  await f.response(sample({ gpus: [gpu({ usage: 20 })] })); await f.refresh(); await settle(f);
  await f.response(sample({ gpus: [gpu({ usage: 90 }), gpu({ id: '00000000_00000043', name: 'Hidden second GPU' })] }));
  await f.refresh(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 2);
  const card = { schemaVersion: 1, name: 'GPU', enabled: true, icon: 'inherit', size: 'medium', layout: 'table',
    listOptions: { rows: 1, fontSize: 14, noWrap: false, columns: ['name', 'percent'] },
    fields: [{ id: 'table', binding: 'gpus', label: 'GPUs', enabled: true, icon: 'none', format: 'auto', unit: '', decimals: 0 }] };
  assert.equal((await f.call('/api/plugins/pc-network/cards', card)).status, 200);
  const vista = { schemaVersion: 1, name: 'GPU', slug: 'gpu', enabled: true, gap: 8, padding: 8,
    layout: { id: 'root', name: 'Canvas', type: 'column', enabled: true, width: '1fr', height: '1fr', children: [
      { id: 'slot', name: 'GPU', type: 'card', enabled: true, width: '1fr', height: '1fr', cards: [{ pluginId: 'pc-network', cardId: f.service().cards[0].id }] },
    ] } };
  assert.equal((await f.call('/api/vistas', vista)).status, 200);
  const publicVista = (await f.call('/api/vistas/gpu')).body;
  assert.deepEqual(Object.keys(publicVista.cards[0].data.values.gpus.value[0]), ['name', 'percent']);
  assert.equal(publicVista.cards[0].data.values.gpus.value.length, 1);
  assert.doesNotMatch(JSON.stringify(publicVista), /gpu-identities|00000042|Hidden second GPU|dedicatedUsed|nameCache|token/);
});

test('installed plugin, numeric Task true edges/restart and private table projection in Vistas', async t => {
  const f = await fixture(t);
  assert.equal(f.service().enabled, false);
  assert.equal(f.service().configurationReady, true);
  assert.equal((await f.call('/api/plugins/pc-network/config', { revision: f.service().config.revision, enabled: true })).status, 200);
  const task = await f.call('/api/tasks', { name: 'High CPU', enabled: true,
    starts: [{ id: 'rule', name: 'Event', type: 'event', enabled: true,
      eventId: 'plugin:pc-network:event:status-updated', condition: { field: 'cpu-percent', operator: 'gte', value: 80 } }],
    steps: [{ id: 'log', type: 'log', enabled: true, message: 'High CPU' }] });
  assert.equal(task.status, 200, JSON.stringify(task.body));
  await f.refresh(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 0);
  await f.response(sample({ cpu: 90 })); await f.refresh(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 1);
  await f.restart(); await f.refresh(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 1);
  await f.response(sample({ cpu: 20 })); await f.refresh(); await settle(f);
  await f.response(sample({ cpu: 90 })); await f.refresh(); await settle(f);
  assert.equal(f.app.state.snapshot().runs.length, 2);
  const definition = { schemaVersion: 1, name: 'Neighbors', enabled: true, icon: 'inherit', size: 'medium', layout: 'table',
    listOptions: { rows: 1, fontSize: 14, noWrap: false, columns: ['address', 'hostname', 'state'] },
    fields: [{ id: 'table', binding: 'neighbors', label: 'Neighbors', enabled: true, icon: 'none', format: 'auto', unit: '', decimals: 0 }] };
  assert.equal((await f.call('/api/plugins/pc-network/cards', definition)).status, 200);
  const vista = { schemaVersion: 1, name: 'PC', slug: 'pc', enabled: true, gap: 8, padding: 8,
    layout: { id: 'root', name: 'Canvas', type: 'column', enabled: true, width: '1fr', height: '1fr', children: [
      { id: 'slot', name: 'Neighbors', type: 'card', enabled: true, width: '1fr', height: '1fr', cards: [{ pluginId: 'pc-network', cardId: f.service().cards[0].id }] },
    ] } };
  assert.equal((await f.call('/api/vistas', vista)).status, 200);
  const viewer = (await f.call('/api/vistas/pc')).body;
  assert.deepEqual(Object.keys(viewer.cards[0].data.values.neighbors.value[0]), ['address', 'hostname', 'state']);
  assert.doesNotMatch(JSON.stringify(viewer), /nameCache|expires|helperPath|poll-minutes|token|cpu-percent/);
  for (const file of ['config.json', 'state.json', 'activity.jsonl', 'cards.json']) {
    assert.equal((await fetch(f.app.origin + '/plugins/pc-network/data/' + file)).status, 404);
  }
});
