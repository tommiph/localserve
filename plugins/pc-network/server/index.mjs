/** Localserve runtime API v1 for read-only Windows metrics.
 * Only supervised actions sample counters or resolve names; no background scan,
 * process listing, service management or arbitrary command interface exists.
 */
import os from 'node:os';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';

const helperPath = fileURLToPath(new URL('../native/Collector.exe', import.meta.url));
const gib = 1024 ** 3;
const rates = [1 / 6, 0.5, 1];
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const round = value => value === null ? null : Math.round(value * 100) / 100;
const text = (value, maximum = 253) => typeof value === 'string' && value.trim()
  && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim().slice(0, maximum) : null;

export function localAddress(value) {
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split('.').map(Number);
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254;
}

export function lookupTarget(value) {
  if (typeof value !== 'string') return null;
  const target = value.trim();
  if (isIP(target)) return target;
  if (!target || target.length > 253 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(target)
    || target.split('.').some(label => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) return null;
  return target.toLowerCase();
}

function configuration(settings) {
  return rates.includes(settings?.['poll-minutes'] ?? 1 / 6)
    && typeof (settings?.['resolve-neighbors'] ?? true) === 'boolean';
}

export function collectWindows(signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0, failed = null;
    const cancel = () => {
      // The bundled helper watches stdin and ends its own sample normally.
      // Do not kill by PID/name. EOF also stops it if the owning worker exits.
      if (!child.stdin.destroyed) child.stdin.end('cancel\n');
    };
    const deadline = setTimeout(() => {
      failed = new Error('Windows status collection exceeded 5 seconds.');
      cancel();
    }, 5000);
    child.stdin.on('error', () => {});
    child.stderr.resume();
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        failed = new Error('Windows status response exceeds its limit.');
        cancel();
      } else chunks.push(chunk);
    });
    child.once('error', () => { failed = new Error('The bundled Windows status collector could not start.'); });
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    child.once('close', code => {
      clearTimeout(deadline);
      signal.removeEventListener('abort', cancel);
      child.stdin.destroy();
      if (signal.aborted) return reject(signal.reason);
      if (failed) return reject(failed);
      if (code !== 0) return reject(new Error('Windows status collection failed.'));
      try {
        const output = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        resolve(JSON.parse(output.replace(/^\uFEFF/u, '')));
      }
      catch { reject(new Error('Windows status collector returned invalid JSON.')); }
    });
  });
}

async function boundedLookup(operation, signal, milliseconds = 1500) {
  signal.throwIfAborted();
  let timer, cancel;
  const boundary = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('Lookup timed out.'), { code: 'TIMEOUT' })), milliseconds);
    cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
  try { return await Promise.race([Promise.resolve().then(operation), boundary]); }
  finally {
    // Windows' system resolver cannot cancel an already submitted lookup. Its
    // late result is abandoned and can never save state/emit after this action.
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

function lookupStatus(error) {
  return error?.code === 'TIMEOUT' ? 'Timed out' : ['ENOTFOUND', 'ENODATA', 'EAI_AGAIN'].includes(error?.code)
    ? 'Unresolved' : 'Lookup unavailable';
}

function gpuReadings(gpus, previous, receivedAt) {
  const keys = ['name', 'percent', 'dedicated-used-gib', 'dedicated-total-gib', 'shared-used-gib', 'shared-limit-gib', 'status', 'received-at'];
  const bytes = value => Number.isSafeInteger(value) && value >= 0 ? round(value / gib) : null;
  const identities = Array.isArray(previous['gpu-identities']) ? previous['gpu-identities'].slice(0, 4) : [];
  const reading = { 'gpu-count': Array.isArray(gpus) ? gpus.length : previous['gpu-count'] ?? null,
    'gpu-identities': Array.isArray(gpus) ? gpus.map(gpu => gpu.id) : identities };
  for (let index = 1; index <= 4; index++) {
    const gpu = gpus?.[index - 1];
    const prefix = `gpu-${index}-`;
    if (!Array.isArray(gpus)) {
      for (const key of keys) reading[prefix + key] = previous[prefix + key] ?? null;
      reading[prefix + 'status'] = reading[prefix + 'name'] ? 'Unavailable · previous readings retained' : null;
      continue;
    }
    if (!gpu) {
      for (const key of keys) reading[prefix + key] = null;
      continue;
    }
    if (!gpu || typeof gpu !== 'object' || !/^[0-9a-f]{8}_[0-9a-f]{8}$/i.test(gpu.id || '')) {
      throw new Error('Windows returned an invalid GPU identity.');
    }
    const usage = number(gpu.usage);
    const current = {
      name: text(gpu.name, 128), percent: usage !== null && usage <= 100 ? round(usage) : null,
      'dedicated-used-gib': bytes(gpu.dedicatedUsed), 'dedicated-total-gib': bytes(gpu.dedicatedTotal),
      'shared-used-gib': bytes(gpu.sharedUsed), 'shared-limit-gib': bytes(gpu.sharedLimit),
    };
    const oldIndex = identities.indexOf(gpu.id) + 1;
    let retained = false;
    for (const [key, value] of Object.entries(current)) {
      const old = oldIndex ? previous[`gpu-${oldIndex}-${key}`] : null;
      reading[prefix + key] = value ?? old ?? null;
      if (value === null && old !== undefined && old !== null) retained = true;
    }
    const complete = current.percent !== null && current['dedicated-used-gib'] !== null && current['shared-used-gib'] !== null;
    reading[prefix + 'status'] = complete ? 'Current' : retained ? 'Partial · previous readings retained' : 'Partial · counters unavailable';
    reading[prefix + 'received-at'] = complete ? receivedAt : oldIndex ? previous[`gpu-${oldIndex}-received-at`] ?? null : null;
  }
  // Summary fields consistently refer to DXGI's first hardware adapter. Each
  // adapter also has its own fields/List row; never sum different GPU engines.
  for (const key of keys) reading[`gpu-${key}`] = reading[`gpu-1-${key}`];
  if (!Array.isArray(gpus)) reading['gpu-status'] = identities.length ? 'Unavailable · previous readings retained' : 'GPU readings unavailable';
  else if (!gpus.length) reading['gpu-status'] = 'No hardware GPU reported';
  return reading;
}

export function publicReading(data, system = os, receivedAt = Date.now(), previous = {}) {
  if (!data || number(data.totalMemory) === null || !data.totalMemory
    || number(data.availableMemory) === null || data.availableMemory > data.totalMemory
    || !Array.isArray(data.adapters) || data.adapters.length > 10 || !Array.isArray(data.disks) || data.disks.length > 10
    || data.neighbors !== null && (!Array.isArray(data.neighbors) || data.neighbors.length > 256)
    || data.gpus != null && (!Array.isArray(data.gpus) || data.gpus.length > 4)) throw new Error('Windows returned invalid status counters.');
  const memoryUsed = data.totalMemory - data.availableMemory;
  const cpu = number(data.cpu);
  const reading = {
    'host-name': text(system.hostname()), 'operating-system': text(`${system.type()} ${system.release()}`),
    'cpu-model': text(system.cpus()[0]?.model), 'logical-processors': system.cpus().length,
    'cpu-percent': cpu !== null && cpu <= 100 ? round(cpu) : null,
    'sample-seconds': round(number(data.sampleSeconds)), 'uptime-hours': round(number(system.uptime() / 3600)),
    'memory-total-gib': round(data.totalMemory / gib), 'memory-used-gib': round(memoryUsed / gib),
    'memory-available-gib': round(data.availableMemory / gib), 'memory-percent': round(memoryUsed / data.totalMemory * 100),
    'commit-used-gib': number(data.commitUsed) === null ? null : round(data.commitUsed / gib),
    'commit-limit-gib': number(data.commitLimit) === null ? null : round(data.commitLimit / gib),
    'updated-at': receivedAt, 'adapter-count': data.adapters.length, 'disk-count': data.disks.length,
  };
  // These named gauges must not depend on DriveInfo's enumeration order.
  for (const letter of ['d', 'e']) {
    const disk = data.disks.find(item => item?.name?.toUpperCase() === `${letter.toUpperCase()}:\\`);
    const total = number(disk?.total), free = number(disk?.free);
    reading[`drive-${letter}-free-percent`] = total !== null && total > 0 && free !== null && free <= total
      ? round(free / total * 100) : null;
  }
  const active = data.adapters.filter(adapter => adapter.status === 'Up');
  const sumRate = key => active.length && active.every(adapter => number(adapter[key]) !== null)
    ? round(active.reduce((sum, adapter) => sum + adapter[key], 0)) : null;
  reading['receive-mbps'] = sumRate('receiveMbps');
  reading['transmit-mbps'] = sumRate('transmitMbps');
  for (let index = 1; index <= 10; index += 1) {
    const adapter = data.adapters[index - 1];
    reading[`adapter-${index}-name`] = text(adapter?.name, 100);
    reading[`adapter-${index}-status`] = text(adapter?.status, 32);
    reading[`adapter-${index}-address`] = Array.isArray(adapter?.addresses)
      ? adapter.addresses.filter(address => isIP(address)).slice(0, 8).join('\n').slice(0, 1000) || null : null;
    reading[`adapter-${index}-link`] = number(adapter?.speed) === null ? null : round(adapter.speed / 1e6);
    reading[`adapter-${index}-receive`] = round(number(adapter?.receiveMbps));
    reading[`adapter-${index}-transmit`] = round(number(adapter?.transmitMbps));
    const disk = data.disks[index - 1];
    const validDisk = disk && number(disk.total) !== null && disk.total > 0 && number(disk.free) !== null && disk.free <= disk.total;
    reading[`disk-${index}-name`] = text(disk?.name, 32);
    reading[`disk-${index}-total`] = validDisk ? round(disk.total / gib) : null;
    reading[`disk-${index}-free`] = validDisk ? round(disk.free / gib) : null;
    reading[`disk-${index}-used`] = validDisk ? round((disk.total - disk.free) / disk.total * 100) : null;
  }
  Object.assign(reading, gpuReadings(data.gpus, previous, receivedAt));
  return reading;
}

export function neighborRows(data) {
  if (data === null) return null;
  const seen = new Set();
  return data.filter(row => {
    const key = `${row.index}/${row.address}`;
    if (!localAddress(row.address) || !Number.isInteger(row.index) || row.index < 1
      || !/^[0-9A-F]{2}(?:-[0-9A-F]{2}){5}$/i.test(row.mac ?? '') || parseInt(row.mac.slice(0, 2), 16) % 2
      || /^00(?:-00){5}$/.test(row.mac) || !['Reachable', 'Stale', 'Delay', 'Probe', 'Permanent'].includes(row.state)
      || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => Number(b.state === 'Reachable') - Number(a.state === 'Reachable')
    || a.address.localeCompare(b.address, 'en', { numeric: true })).slice(0, 10);
}

export function createPcNetworkAdapter({ collector = collectWindows, reverse = dns.reverse, lookup = dns.lookup,
  now = () => Date.now(), system = os, platform = process.platform,
  helperReady = () => fs.lstat(helperPath).then(stat => stat.isFile() && !stat.isSymbolicLink()).catch(() => false) } = {}) {
  let settings = null;
  return {
    async validateConfiguration(values) { return platform === 'win32' && configuration(values) && await helperReady(); },
    async start(values) {
      if (!await this.validateConfiguration(values)) throw new Error('PC and Network needs Windows and its bundled collector.');
      settings = { 'poll-minutes': 1 / 6, 'resolve-neighbors': true, ...values };
    },
    async stop() { settings = null; },
    async execute(action, parameters, context) {
      context.signal.throwIfAborted();
      if (!settings) throw new Error('PC and Network is not ready.');
      if (action === 'lookup') {
        const target = lookupTarget(parameters.target);
        if (!target) throw new Error('Enter a hostname or IP address, without a URL or port.');
        let names = [], addresses = [], status = 'Resolved';
        try {
          if (isIP(target)) {
            names = (await boundedLookup(() => reverse(target), context.signal)).map(name => text(name)).filter(Boolean).slice(0, 10);
            addresses = [target];
          } else addresses = (await boundedLookup(() => lookup(target, { all: true }), context.signal))
            .map(item => item.address).filter(address => isIP(address)).slice(0, 10);
          if (!names.length && isIP(target) || !addresses.length) status = 'Unresolved';
        } catch (error) {
          context.signal.throwIfAborted();
          status = lookupStatus(error);
        }
        const state = await context.readState();
        Object.assign(state, { 'lookup-target': target, 'lookup-addresses': addresses.join('\n') || null,
          'lookup-hostname': names.join('\n').slice(0, 1000) || null, 'lookup-status': status, 'lookup-at': now() });
        await context.saveState(state);
        await context.emit('lookup-completed', { target, success: status === 'Resolved', status,
          ...(addresses.length ? { addresses: addresses.join(', ') } : {}), ...(names.length ? { hostname: names[0] } : {}) });
        await context.log(`Network lookup completed: ${status}.`);
        return { completed: true };
      }
      if (action !== 'refresh') throw new Error('Unknown PC and Network action.');
      let data;
      try { data = await collector(context.signal); }
      catch (error) {
        if (!context.signal.aborted) await context.log('PC status refresh failed; previous readings retained.', 'warning');
        throw error;
      }
      context.signal.throwIfAborted();
      const state = await context.readState();
      const at = now();
      const reading = publicReading(data, system, at, state);
      const rows = neighborRows(data.neighbors);
      const cache = settings['resolve-neighbors'] ? { ...state.nameCache } : {};
      if (rows !== null) {
        // Resolve only existing private-address cache entries, two per action.
        // Failure results wait five minutes; successful names wait ten. This is
        // neither an exhaustive inventory nor a claim that Stale means online.
        const due = rows.filter(row => (cache[`${row.index}/${row.address}`]?.expires ?? 0) <= at).slice(0, 2);
        if (settings['resolve-neighbors']) for (const row of due) {
          const key = `${row.index}/${row.address}`;
          let name = null, status = 'Unresolved';
          try {
            const names = await boundedLookup(() => reverse(row.address), context.signal, 1000);
            name = text(names[0]);
            if (name) status = 'Resolved';
          } catch (error) { context.signal.throwIfAborted(); status = lookupStatus(error); }
          cache[key] = { name, status, expires: at + (name ? 600000 : 300000) };
        }
        reading['neighbor-count'] = rows.length;
        reading['neighbors-status'] = 'Windows neighbor cache';
        for (let index = 1; index <= 10; index += 1) {
          const row = rows[index - 1];
          const cached = row ? cache[`${row.index}/${row.address}`] : null;
          reading[`neighbor-${index}-address`] = row?.address ?? null;
          reading[`neighbor-${index}-hostname`] = settings['resolve-neighbors'] ? cached?.name ?? null : null;
          reading[`neighbor-${index}-resolution`] = row ? settings['resolve-neighbors'] ? cached?.status ?? 'Not checked' : 'Disabled' : null;
          reading[`neighbor-${index}-state`] = row?.state ?? null;
          reading[`neighbor-${index}-mac`] = row?.mac ?? null;
          reading[`neighbor-${index}-adapter`] = row ? text(data.adapters.find(adapter => adapter.index === row.index)?.name, 100) : null;
        }
      } else {
        // A denied/unsupported cache query cannot erase the last successful
        // device table. Its separate status makes retained rows explicit.
        reading['neighbors-status'] = 'Cache unavailable; previous rows retained';
        if (!settings['resolve-neighbors']) for (let index = 1; index <= 10; index += 1) {
          reading[`neighbor-${index}-hostname`] = null;
          reading[`neighbor-${index}-resolution`] = state[`neighbor-${index}-address`] ? 'Disabled' : null;
        }
      }
      const activeCache = Object.fromEntries(Object.entries(cache).filter(([, value]) => value.expires > at)
        .sort((a, b) => b[1].expires - a[1].expires).slice(0, 64));
      Object.assign(state, reading, { nameCache: activeCache });
      // Commit the sample before dispatching reading events. Conditional Task
      // rules use the existing true-edge state; no historic sample is replayed.
      await context.saveState(state);
      const payload = {
        'memory-percent': reading['memory-percent'],
        ...(reading['cpu-percent'] !== null ? { 'cpu-percent': reading['cpu-percent'] } : {}),
        ...(reading['receive-mbps'] !== null ? { 'receive-mbps': reading['receive-mbps'] } : {}),
        ...(reading['transmit-mbps'] !== null ? { 'transmit-mbps': reading['transmit-mbps'] } : {}),
      };
      // Retained GPU values remain useful in Cards, but cannot rearm or match
      // Task conditions as though an unavailable counter were a fresh sample.
      for (let index = 1; index <= 4; index++) {
        const gpu = data.gpus?.[index - 1];
        if (number(gpu?.usage) !== null && gpu.usage <= 100) payload[`gpu-${index}-percent`] = reading[`gpu-${index}-percent`];
        if (Number.isSafeInteger(gpu?.dedicatedUsed) && gpu.dedicatedUsed >= 0) {
          payload[`gpu-${index}-dedicated-used-gib`] = reading[`gpu-${index}-dedicated-used-gib`];
        }
      }
      await context.emit('status-updated', payload);
      // Avoid a second sample log on every ten-second poll; the declared event
      // already records successful reception in plugin/global Activity.
      return { completed: true };
    },
  };
}

export default createPcNetworkAdapter();
