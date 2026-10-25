/** Sormus supervised board lifecycle for Finavia Public Flights.
 * Import, validation and start remain offline; only refresh reads the provider.
 */
import { createHash } from 'node:crypto';
import sax from '../vendor/sax/lib/sax.js';

const maximumResponseBytes = 4 * 1024 * 1024;
const maximumFlights = 2000;
const maximumClaims = 300;
const claimLifetimeMs = 48 * 60 * 60 * 1000;
const requestTimeoutMs = 15000;
const apiOrigin = 'https://apigw.finavia.fi';

export function airportCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function configuration(settings) {
  const apiKey = typeof settings?.['api-key'] === 'string' ? settings['api-key'].trim() : '';
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(apiKey)
    || !Array.isArray(settings?.locations) || settings.locations.length > 20
    || ![1, 2, 5].includes(settings['poll-minutes'] ?? 1)) return null;
  const locations = settings.locations.filter(item => item.enabled).map(item => ({
    ...item, airport: airportCode(item.airport),
    'other-airport': item['other-airport']?.trim() ? airportCode(item['other-airport']) : '',
    flight: (item.flight ?? '').trim().toUpperCase(),
  }));
  if (!locations.length || locations.some(item => !item.airport || item['other-airport'] === null
    || item['other-airport'] === item.airport || !['arrivals', 'departures', 'both'].includes(item.direction)
    || !/^[A-Z0-9]{0,16}$/.test(item.flight) || !Number.isFinite(item['advance-minutes'])
    || item['advance-minutes'] < 0 || item['advance-minutes'] > 30)) return null;
  return { locations, apiKey, pollMinutes: settings['poll-minutes'] ?? 1 };
}

export function boardUrl(location) {
  const airport = airportCode(location.airport);
  const direction = { arrivals: 'arr', departures: 'dep', both: 'all' }[location.direction];
  if (!airport || !direction) throw new Error('Invalid Finavia board.');
  // All board requests use Finavia's fixed Public Flights HTTPS gateway.
  // Keys never enter URLs; editable boards cannot change the request origin.
  return `${apiOrigin}/flights/public/v0/flights/${direction}/${airport}`;
}

function text(value, maximum = 100) {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && !/[\u0000-\u001f\u007f]/u.test(result) ? result.slice(0, maximum) : null;
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) && at >= 0 ? at : null;
}

function cancellation(flight) {
  // Preserve the provider status text. Only explicit cancellation markers
  // suppress movement events/countdowns; an absent status is not "on time".
  return ['C', 'CNL', 'CNX'].includes(flight.prm?.trim().toUpperCase())
    || /^(?:cancelled|canceled|peruttu|inställd)(?:\s|$)/iu.test(flight.prt ?? '')
    || /^(?:peruttu)(?:\s|$)/iu.test(flight.prt_f ?? '');
}

function movementFrom(flight, direction, location) {
  if (airportCode(flight.h_apt) !== location.airport) return null;
  const number = text(flight.fltnr, 16)?.toUpperCase();
  const scheduled = timestamp(flight.sdt);
  if (!number || !/^[A-Z0-9]{1,16}$/.test(number) || scheduled === null
    || !/^\d{8}$/.test(flight.sdate ?? '')) throw new Error('Finavia returned an invalid flight identity or scheduled time.');
  const routes = Array.from({ length: 4 }, (_, index) => ({
    code: airportCode(flight[`route_${index + 1}`]), name: text(flight[`route_n_${index + 1}`]),
  })).filter(route => route.code);
  if (location['other-airport'] && !routes.some(route => route.code === location['other-airport'])) return null;
  const codeshares = Array.from({ length: 6 }, (_, index) => text(flight[`cflight_${index + 1}`], 16)?.toUpperCase()).filter(Boolean);
  if (location.flight && ![number, ...codeshares].includes(location.flight)) return null;
  const actual = timestamp(flight.act_d);
  const estimated = timestamp(flight.pest_d) ?? timestamp(flight.est_d);
  const cancelled = cancellation(flight);
  // act_d is the reported runway movement. ablk_d is a different operational
  // milestone and must never confirm takeoff/landing. The documented public
  // estimate takes precedence over the operational estimate. All accepted
  // timestamps carry their own zone; unzoned documentation examples are rejected.
  const expected = actual ?? estimated ?? scheduled;
  const basis = actual !== null ? 'actual' : estimated !== null ? 'estimated' : 'scheduled';
  const status = text(flight.prt) ?? text(flight.prt_f) ?? null;
  const reported = actual !== null || ['DEP', 'LAN'].includes(flight.prm?.trim().toUpperCase())
    || /^(?:departed|landed|lähtenyt|laskeutunut)$/iu.test(status ?? '');
  return {
    key: `${flight.sdate}/${number}/${location.airport}/${direction}`,
    number, direction, scheduled, expected, actual, cancelled, basis, status, reported,
    gate: text(flight.gate, 32), routes, codeshares,
  };
}

export function parseFlights(xml, location, receivedAt = Date.now()) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > maximumResponseBytes) throw new Error('Finavia response exceeds 4 MiB or is not XML.');
  const parser = sax.parser(true, { strictEntities: true, xmlns: true });
  const path = [];
  const movements = [];
  const identities = new Set();
  const sections = new Set();
  const bodies = new Set();
  let flight = null;
  let captured = '';
  let capturedKey = null;
  let count = 0;
  parser.onerror = () => { throw new Error('Finavia returned invalid FlightsService XML.'); };
  parser.ondoctype = () => { throw new Error('Finavia XML must not contain a DTD.'); };
  parser.onopentag = node => {
    if (capturedKey) throw new Error('Finavia flight fields must not contain nested markup.');
    path.push(node.local);
    if (path.length > 16) throw new Error('Finavia XML nesting exceeds its limit.');
    if (path.length === 1 && (node.local !== 'flights' || node.uri !== 'http://www.finavia.fi/FlightsService.xsd')) throw new Error('Finavia did not return FlightsService XML.');
    if (path.length === 2 && ['arr', 'dep'].includes(node.local)) {
      if (sections.has(node.local)) throw new Error('Finavia returned duplicate flight sections.');
      sections.add(node.local);
    }
    if (path.length === 3 && ['arr', 'dep'].includes(path[1]) && node.local === 'body') {
      if (bodies.has(path[1])) throw new Error('Finavia returned duplicate flight bodies.');
      bodies.add(path[1]);
    }
    if (node.uri !== 'http://www.finavia.fi/FlightsService.xsd') throw new Error('Finavia returned an unexpected XML namespace.');
    if (path.length === 4 && ['arr', 'dep'].includes(path[1]) && path[2] === 'body' && node.local === 'flight') {
      if (++count > maximumFlights) throw new Error('Finavia returned more than 2000 flights.');
      flight = {};
    }
    if (flight && path.length === 5) {
      if (Object.hasOwn(flight, node.local)) throw new Error('Finavia returned duplicate flight fields.');
      capturedKey = node.local;
      captured = '';
    }
  };
  const capture = value => {
    if (capturedKey) captured += value;
    if (captured.length > 4000) throw new Error('Finavia flight field exceeds its limit.');
  };
  parser.ontext = capture;
  parser.oncdata = capture;
  parser.onclosetag = () => {
    if (capturedKey && path.length === 5) {
      flight[capturedKey] = captured.trim();
      capturedKey = null;
      captured = '';
    }
    if (flight && path.length === 4) {
      const direction = path[1] === 'arr' ? 'arrival' : 'departure';
      if (location.direction === 'both' || location.direction === `${direction}s`) {
        const movement = movementFrom(flight, direction, location);
        if (movement && !identities.has(movement.key)) {
          identities.add(movement.key);
          movements.push(movement);
        }
      }
      flight = null;
    }
    path.pop();
  };
  parser.write(xml).close();
  const requiredSections = location.direction === 'both' ? ['arr', 'dep'] : [location.direction === 'arrivals' ? 'arr' : 'dep'];
  if (requiredSections.some(section => !sections.has(section) || !bodies.has(section))) throw new Error('Finavia response is missing a requested flight section.');
  const displayed = movements.filter(item => !item.reported && item.expected >= receivedAt)
    .sort((a, b) => a.expected - b.expected || a.key.localeCompare(b.key)).slice(0, 10);
  const reading = {
    'flight-count': displayed.length, airport: location.airport,
    'route-filter': location['other-airport'] || '', 'flight-filter': location.flight || '',
    'updated-at': receivedAt, attribution: 'Flight data: Finavia · Filtered and formatted by Sormus',
  };
  for (let index = 1; index <= 10; index += 1) {
    const movement = displayed[index - 1];
    const route = movement?.routes.map(stop => stop.name ? `${stop.name} (${stop.code})` : stop.code).join(' → ');
    reading[`flight-${index}-flight`] = movement?.number ?? null;
    reading[`flight-${index}-route`] = movement && route ? `${movement.direction === 'departure' ? 'To' : 'From'} ${route}` : null;
    reading[`flight-${index}-gate`] = movement?.gate ?? null;
    reading[`flight-${index}-status`] = movement ? movement.cancelled ? 'Cancelled' : movement.status : null;
    reading[`flight-${index}-scheduled`] = movement?.scheduled ?? null;
    reading[`flight-${index}-time`] = movement?.expected ?? null;
    reading[`flight-${index}-due-at`] = movement && !movement.cancelled ? movement.expected : null;
  }
  return { reading, movements };
}

async function readXml(response) {
  if (!response.body) throw new Error('Finavia returned an empty response.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > maximumResponseBytes) throw new Error('Finavia response exceeds 4 MiB.');
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function fetchBoard(location, config, signal, fetchImpl, now) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error('Finavia request timed out after 15 seconds.')), requestTimeoutMs);
  const requestSignal = AbortSignal.any([signal, timeout.signal]);
  try {
    const response = await fetchImpl(boardUrl(location), {
      redirect: 'error', signal: requestSignal,
      headers: { Accept: 'application/xml', 'Accept-Encoding': 'gzip', app_key: config.apiKey },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Finavia request failed (HTTP ${response.status}).`);
    }
    const xml = await readXml(response);
    requestSignal.throwIfAborted();
    return parseFlights(xml, location, now());
  } catch (error) {
    if (requestSignal.aborted) throw requestSignal.reason;
    // Do not log response bodies, URLs supplied by errors, or transport details:
    // gateways/clients may echo authentication headers in their error messages.
    const message = /^Finavia [A-Za-z0-9 ()./-]+$/.test(error.message ?? '')
      && !error.message.includes(config.apiKey) ? error.message : 'Finavia request or response could not be processed.';
    throw new Error(message);
  } finally {
    // The network deadline includes pause. Host writes/events still cooperate
    // with the shared pause/cancellation gate before persistence/admission.
    clearTimeout(timer);
  }
}

function locationSignature(location) {
  return createHash('sha256').update(JSON.stringify([location.airport, location.direction,
    location['other-airport'], location.flight, location['advance-minutes']])).digest('hex');
}

function eventPayload(location, movement, stage) {
  return {
    'location-id': location.id, 'location-name': location.name,
    'movement-id': `${stage}/${movement.key}`, airport: location.airport,
    direction: movement.direction, 'flight-number': movement.number,
    'scheduled-at': movement.scheduled, 'expected-at': movement.expected, 'time-basis': movement.basis,
    ...(movement.actual !== null ? { 'actual-at': movement.actual } : {}),
    ...(movement.gate !== null ? { gate: movement.gate } : {}),
    ...(movement.status !== null ? { status: movement.status } : {}),
    ...(movement.routes.length ? { route: movement.routes.map(route => route.code).join(' → ') } : {}),
  };
}

export function createFinaviaAdapter({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  let configured = null;
  let allLocationIds = new Set();
  return {
    validateConfiguration(settings) { return configuration(settings) !== null; },
    async start(settings) {
      configured = configuration(settings);
      if (!configured) throw new Error('Set the API key and enable a valid airport board in Finavia Settings.');
      allLocationIds = new Set(settings.locations.map(item => item.id));
    },
    async stop() {
      // The supervisor drains/cancels actions before releasing credentials.
      configured = null;
      allLocationIds.clear();
    },
    async execute(actionId, parameters, context) {
      context.signal.throwIfAborted();
      if (actionId !== 'refresh') throw new Error('Unknown Finavia action.');
      if (!configured) throw new Error('Finavia is not configured.');
      const id = parameters['location-id'] || (configured.locations.length === 1 ? configured.locations[0].id : null);
      const location = configured.locations.find(item => item.id === id);
      if (!location) throw new Error('Choose an enabled Finavia location.');
      let result;
      try { result = await fetchBoard(location, configured, context.signal, fetchImpl, now); }
      catch (error) {
        if (!context.signal.aborted) await context.log(`Flights refresh failed for ${location.name}: ${error.message}`, 'warning');
        throw error;
      }
      context.signal.throwIfAborted();
      const state = await context.readState();
      const receivedAt = result.reading['updated-at'];
      const previous = state.monitoring?.[location.id];
      const signature = locationSignature(location);
      const claims = (previous?.claims || []).filter(claim => claim.at >= receivedAt - claimLifetimeMs);
      const known = new Set(claims.map(claim => claim.key));
      const pending = [];
      const confirmedAfter = Math.max(previous?.signature === signature ? previous.receivedAt : 0,
        receivedAt - configured.pollMinutes * 60000);
      for (const movement of result.movements) {
        if (movement.cancelled) continue;
        const stage = movement.actual !== null && movement.actual <= receivedAt && movement.actual >= confirmedAfter
          ? 'confirmed' : !movement.reported && movement.expected >= receivedAt
            && movement.expected <= receivedAt + location['advance-minutes'] * 60000 ? 'upcoming' : null;
        if (!stage) continue;
        const key = `${stage}/${movement.key}`;
        if (known.has(key)) continue;
        known.add(key);
        claims.push({ key, at: receivedAt });
        pending.push({ stage, movement });
      }
      if (pending.length > maximumClaims) throw new Error('Finavia returned more than 300 new movements in one event window.');
      const retain = collection => Object.fromEntries(Object.entries(collection || {}).filter(([key]) => allLocationIds.has(key)));
      const locations = retain(state.locations);
      const monitoring = retain(state.monitoring);
      locations[id] = result.reading;
      monitoring[id] = { signature, receivedAt, claims: claims.slice(-maximumClaims) };
      // Claims survive rename/settings edits and are committed with the reading
      // before any effect. Crashes, skips and pauses do not cause replay; retained
      // history is bounded to 300 claims / 48 hours per board.
      await context.saveState({ locations, monitoring });
      for (const { stage, movement } of pending) {
        const single = stage === 'upcoming' ? movement.direction === 'arrival' ? 'flight-arriving' : 'flight-departing'
          : movement.direction === 'arrival' ? 'flight-arrived' : 'flight-departed';
        const combined = stage === 'upcoming' ? 'flight-arriving-or-departing' : 'flight-arrived-or-departed';
        const payload = eventPayload(location, movement, stage);
        await context.emit(single, payload);
        await context.emit(combined, payload);
      }
      await context.log(`Flights refreshed for ${location.name}: ${result.reading['flight-count']} upcoming movements, ${pending.length} new events.`, 'success');
      return { completed: true };
    },
  };
}

export default createFinaviaAdapter();
