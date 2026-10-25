/** Sormus runtime API v1 with named train boards and public scalar/
 * table fields. Only the explicit supervised refresh action accesses Digitraffic.
 */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const stations = JSON.parse(await fs.readFile(new URL('../stations.json', import.meta.url), 'utf8'));
const stationNames = new Map(stations.map(station => [station.code, station.name]));
const stationCodes = new Map(stations.flatMap(station => [station.name,
  station.name.replace(/ asema$/u, '')].map(name => [name.toLocaleUpperCase('fi'), station.code])));
const maximumResponseBytes = 4 * 1024 * 1024;
const maximumClaims = 300;
const claimLifetimeMs = 48 * 60 * 60 * 1000;
const requestTimeoutMs = 15000;

export function stationCode(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim().toLocaleUpperCase('fi');
  return stationCodes.get(input) ?? (/^[\p{L}\p{N}]{1,8}$/u.test(input) ? input : null);
}

function stationName(code) { return stationNames.get(code) ?? code; }

function configuration(settings) {
  if (!Array.isArray(settings?.locations) || settings.locations.length > 20
    || ![1, 2, 5].includes(settings['poll-minutes'] ?? 1)) return null;
  const locations = settings.locations.filter(item => item.enabled).map(item => ({
    ...item, station: stationCode(item.station),
    'other-station': item['other-station']?.trim() ? stationCode(item['other-station']) : '',
    line: (item.line ?? '').trim().toUpperCase(),
  }));
  if (!locations.length || locations.some(item => !item.station || item['other-station'] === null
    || item['other-station'] === item.station || !['arrivals', 'departures', 'both'].includes(item.direction)
    || !['Commuter', 'passenger'].includes(item.category) || !/^[A-Z0-9 -]{0,16}$/.test(item.line)
    || !Number.isFinite(item['advance-minutes']) || item['advance-minutes'] < 0 || item['advance-minutes'] > 30)) return null;
  return { locations, pollMinutes: settings['poll-minutes'] ?? 1 };
}

export function boardUrl(location) {
  const code = stationCode(location.station);
  if (!code) throw new Error('Invalid Finnish station.');
  const url = new URL(`https://rata.digitraffic.fi/api/v1/live-trains/station/${encodeURIComponent(code)}`);
  // Fetch a bounded station window once. Ordered timetable rows let both
  // direction modes apply direct-route filters without a second API request.
  url.search = new URLSearchParams({ arrived_trains: '10', arriving_trains: '80',
    departed_trains: '10', departing_trains: '80', include_nonstopping: 'false',
    train_categories: location.category === 'Commuter' ? 'Commuter' : 'Commuter,Long-distance',
  }).toString();
  return url.href;
}

function text(value, maximum) {
  return typeof value === 'string' && value.trim() && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value.trim().slice(0, maximum) : null;
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= 0 ? time : null;
}

function stopping(row) {
  return row.trainStopping === true && row.commercialStop === true;
}

function destinationArrivalTime(rows, index, direction, routeStation, destination, cancelled) {
  // An arrival board's destination is the monitored station. Departure boards
  // use the next selected route stop, or the final destination's last arrival.
  // Ordered lookup keeps repeated stations on loop routes from using an earlier
  // visit. Arrival readings come from that stop, never from inferred travel time.
  const onward = rows.slice(index + 1);
  const arrival = direction === 'arrival' ? rows[index]
    : routeStation ? onward.find(row => stopping(row) && row.type === 'ARRIVAL' && row.stationShortCode === routeStation)
      : onward.findLast(row => stopping(row) && row.type === 'ARRIVAL' && row.stationShortCode === destination);
  if (!arrival || cancelled || arrival.cancelled === true) return null;
  const actual = timestamp(arrival.actualTime);
  if (actual !== null) return actual;
  if (arrival.unknownDelay === true) return null;
  return timestamp(arrival.liveEstimateTime) ?? timestamp(arrival.scheduledTime);
}

export function parseTrains(data, location, receivedAt = Date.now()) {
  if (!Array.isArray(data) || data.length > 200) throw new Error('Digitraffic returned an invalid or oversized train list.');
  const movements = [];
  const identities = new Set();
  for (const train of data) {
    if (!Number.isInteger(train?.trainNumber) || train.trainNumber < 1 || train.trainNumber > 999999
      || !/^\d{4}-\d{2}-\d{2}$/.test(train.departureDate || '')
      || !Array.isArray(train.timeTableRows) || train.timeTableRows.length > 1000) {
      throw new Error('Digitraffic returned an invalid train timetable.');
    }
    if (!['Commuter', 'Long-distance'].includes(train.trainCategory)
      || location.category === 'Commuter' && train.trainCategory !== 'Commuter') continue;
    const line = text(train.commuterLineID, 16)?.toUpperCase() ?? null;
    if (location.line && location.line !== line) continue;
    const rows = train.timeTableRows;
    const stops = rows.filter(stopping);
    const origin = text(stops[0]?.stationShortCode, 32);
    const destination = text(stops.at(-1)?.stationShortCode, 32);
    if (!origin || !destination) continue;
    const visits = new Map();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!stopping(row) || row.stationShortCode !== location.station
        || !['ARRIVAL', 'DEPARTURE'].includes(row.type)) continue;
      const visit = (visits.get(row.type) ?? 0) + 1;
      visits.set(row.type, visit);
      const direction = row.type === 'ARRIVAL' ? 'arrival' : 'departure';
      if (location.direction !== 'both' && location.direction !== `${direction}s`) continue;
      // Position matters, including loop services I/P. Merely checking whether
      // both codes occur somewhere would admit trains travelling the wrong way.
      const routeRows = direction === 'departure' ? rows.slice(index + 1) : rows.slice(0, index);
      if (location['other-station'] && !routeRows.some(stop => stopping(stop)
        && stop.stationShortCode === location['other-station'])) continue;
      const scheduled = timestamp(row.scheduledTime);
      if (scheduled === null) throw new Error('Digitraffic returned a movement without a valid scheduled time.');
      const actual = timestamp(row.actualTime);
      const estimate = timestamp(row.liveEstimateTime);
      const unknownDelay = row.unknownDelay === true;
      const expected = actual ?? (unknownDelay ? null : estimate ?? scheduled);
      const basis = actual !== null ? 'actual' : unknownDelay ? 'unknown' : estimate !== null ? 'estimated' : 'scheduled';
      const cancelled = train.cancelled === true || row.cancelled === true;
      const arrives = destinationArrivalTime(rows, index, direction, location['other-station'], destination, cancelled);
      const track = text(row.commercialTrack, 16);
      const delay = Number.isFinite(row.differenceInMinutes) && Math.abs(row.differenceInMinutes) <= 1440
        ? row.differenceInMinutes : null;
      // Estimates, track changes and timetable corrections do not make a new
      // movement. Date/train/station/type/visit distinguishes midnight and loops.
      const key = `${train.departureDate}/${train.trainNumber}/${location.station}/${direction}/${visit}`;
      if (identities.has(key)) continue;
      identities.add(key);
      movements.push({ key, direction, line, trainNumber: train.trainNumber, origin, destination,
        scheduled, actual, expected, basis, cancelled, track, delay, arrives });
    }
  }
  const displayed = movements.filter(item => item.actual === null && (item.expected ?? item.scheduled) >= receivedAt)
    .sort((a, b) => (a.expected ?? a.scheduled) - (b.expected ?? b.scheduled) || a.key.localeCompare(b.key)).slice(0, 10);
  const reading = { 'train-count': displayed.length, 'station-name': stationName(location.station),
    'route-station': location['other-station'] ? stationName(location['other-station']) : '',
    'line-filter': location.line, 'updated-at': receivedAt,
    attribution: 'Source: Fintraffic / Digitraffic · CC BY 4.0 · Filtered and formatted by Sormus' };
  for (let index = 1; index <= 10; index += 1) {
    const movement = displayed[index - 1];
    const routeCode = location['other-station'] || (movement?.direction === 'departure' ? movement?.destination : movement?.origin);
    reading[`train-${index}-train`] = movement ? movement.line ?? `Train ${movement.trainNumber}` : null;
    reading[`train-${index}-route`] = movement
      ? `${movement.direction === 'departure' ? 'To' : 'From'} ${stationName(routeCode)}` : null;
    reading[`train-${index}-time`] = movement?.expected ?? null;
    reading[`train-${index}-arrives`] = movement?.arrives ?? null;
    // Keep the absolute station deadline rather than a poll-time minute count.
    // Read-only clients can count down between provider refreshes without
    // inventing events or polling more frequently. Cancelled trains have no due time.
    reading[`train-${index}-due-at`] = movement && !movement.cancelled ? movement.expected : null;
    reading[`train-${index}-track`] = movement?.track ?? null;
    reading[`train-${index}-status`] = movement ? movement.cancelled ? 'Cancelled'
      : movement.basis === 'unknown' ? 'Delay unknown'
        : `${movement.basis === 'scheduled' ? 'Scheduled' : 'Estimated'}${movement.delay !== null ? ` · ${movement.delay > 0 ? '+' : ''}${movement.delay} min` : ''}` : null;
  }
  return { reading, movements };
}

async function readJson(response) {
  if (!response.body) throw new Error('Digitraffic returned an empty response.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > maximumResponseBytes) throw new Error('Digitraffic response exceeds 4 MiB.');
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function fetchBoard(location, signal, fetchImpl, now) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error('Digitraffic request timed out after 15 seconds.')), requestTimeoutMs);
  const requestSignal = AbortSignal.any([signal, timeout.signal]);
  try {
    const response = await fetchImpl(boardUrl(location), { redirect: 'error', signal: requestSignal,
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'Digitraffic-User': 'Localserve-HSL-Trains/1.0' } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Digitraffic request failed (HTTP ${response.status}).`);
    }
    const data = await readJson(response);
    requestSignal.throwIfAborted();
    return parseTrains(data, location, now());
  } catch (error) {
    if (requestSignal.aborted) throw requestSignal.reason;
    throw error;
  } finally {
    // A wall-time network limit includes pause; state/event host services still
    // wait at the shared pause gate before they can commit or dispatch.
    clearTimeout(timer);
  }
}

function locationSignature(location) {
  return createHash('sha256').update(JSON.stringify([location.station, location.direction,
    location['other-station'], location.line, location.category, location['advance-minutes']])).digest('hex');
}

function eventPayload(location, movement, stage) {
  return { 'location-id': location.id, 'location-name': location.name,
    'movement-id': `${stage}/${movement.key}`, station: location.station, 'station-name': stationName(location.station),
    direction: movement.direction, ...(movement.line ? { line: movement.line } : {}),
    'train-number': movement.trainNumber, origin: movement.origin, destination: movement.destination,
    'scheduled-at': movement.scheduled, 'time-basis': movement.basis,
    ...(movement.expected !== null ? { 'expected-at': movement.expected } : {}),
    ...(movement.actual !== null ? { 'actual-at': movement.actual } : {}),
    ...(movement.track !== null ? { track: movement.track } : {}),
    ...(movement.delay !== null ? { 'delay-minutes': movement.delay } : {}) };
}

export function createTrainsAdapter({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  let configured = null;
  let allLocationIds = new Set();
  return {
    validateConfiguration(settings) { return configuration(settings) !== null; },
    async start(settings) {
      configured = configuration(settings);
      if (!configured) throw new Error('Add and enable a valid station board in HSL Trains Settings.');
      allLocationIds = new Set(settings.locations.map(item => item.id));
    },
    async stop() {
      // The supervisor cancels/drains the old configuration before stop.
      configured = null;
      allLocationIds.clear();
    },
    async execute(actionId, parameters, context) {
      context.signal.throwIfAborted();
      if (actionId !== 'refresh') throw new Error('Unknown HSL Trains action.');
      if (!configured) throw new Error('HSL Trains is not configured.');
      const id = parameters['location-id'] || (configured.locations.length === 1 ? configured.locations[0].id : null);
      const location = configured.locations.find(item => item.id === id);
      if (!location) throw new Error('Choose an enabled HSL Trains location.');
      let result;
      try { result = await fetchBoard(location, context.signal, fetchImpl, now); }
      catch (error) {
        if (!context.signal.aborted) await context.log(`Trains refresh failed for ${location.name}: ${error.message}`, 'warning');
        throw error;
      }
      context.signal.throwIfAborted();
      const state = await context.readState();
      const receivedAt = result.reading['updated-at'];
      const previous = state.monitoring?.[location.id];
      const signature = locationSignature(location);
      // Keep claims across renames, disable/enable and filter changes. A new
      // filter must not replay a previously claimed effect at the same station.
      const claims = (previous?.claims || []).filter(claim => claim.at >= receivedAt - claimLifetimeMs);
      const known = new Set(claims.map(claim => claim.key));
      const pending = [];
      const confirmedAfter = Math.max(previous?.signature === signature ? previous.receivedAt : 0,
        receivedAt - configured.pollMinutes * 60000);
      for (const movement of result.movements) {
        if (movement.cancelled) continue;
        const stage = movement.actual !== null && movement.actual <= receivedAt && movement.actual >= confirmedAfter
          ? 'confirmed' : movement.actual === null && movement.expected !== null
            && movement.expected >= receivedAt && movement.expected <= receivedAt + location['advance-minutes'] * 60000
            ? 'upcoming' : null;
        if (!stage) continue;
        const key = `${stage}/${movement.key}`;
        if (known.has(key)) continue;
        known.add(key);
        claims.push({ key, at: receivedAt });
        pending.push({ stage, movement });
      }
      // Every event we emit must still have its claim in the committed bounded
      // snapshot. An anomalous timetable with hundreds of same-window visits
      // cannot evict this refresh's own claims before their effects are admitted.
      if (pending.length > maximumClaims) throw new Error('Digitraffic returned more than 300 new movements in one event window.');
      const retain = collection => Object.fromEntries(Object.entries(collection || {}).filter(([key]) => allLocationIds.has(key)));
      const locations = retain(state.locations);
      const monitoring = retain(state.monitoring);
      locations[id] = result.reading;
      monitoring[id] = { signature, receivedAt, claims: claims.slice(-maximumClaims) };
      // Persist ALL claims with the reading before the first event. A failed,
      // paused, overlapping or crashed Task admission consumes its movement;
      // restart/manual refresh never replays uncertain effects. Claims are
      // bounded to 48 hours / 300 per location, not unlimited deduplication.
      await context.saveState({ locations, monitoring });
      for (const { stage, movement } of pending) {
        const single = stage === 'upcoming' ? movement.direction === 'arrival' ? 'train-arriving' : 'train-departing'
          : movement.direction === 'arrival' ? 'train-arrived' : 'train-departed';
        const combined = stage === 'upcoming' ? 'train-arriving-or-departing' : 'train-arrived-or-departed';
        const payload = eventPayload(location, movement, stage);
        await context.emit(single, payload);
        await context.emit(combined, payload);
      }
      await context.log(`Trains refreshed for ${location.name}: ${result.reading['train-count']} upcoming movements, ${pending.length} new events.`, 'success');
      return { completed: true };
    },
  };
}

export default createTrainsAdapter();
