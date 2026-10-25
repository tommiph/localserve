/** Sormus runtime API v1 for a read-only wttr.in
 * request. Import, validation, and start never initiate network traffic.
 */
const maximumResponseBytes = 512 * 1024;
const requestTimeoutMs = 15000;
// WorldWeatherOnline's condition-code reference, also used by wttr.in:
// https://www.worldweatheronline.com/weather-api/api/docs/weather-icons.aspx
// Rain includes drizzle/freezing rain and nearby/patchy reports. Snow, sleet,
// and ice pellets alone are not rain. Unknown codes remain unknown, never dry.
const rainCodes = new Set([176, 185, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 353, 356, 359, 386, 389]);
const otherCodes = new Set([113, 116, 119, 122, 143, 179, 182, 200, 227, 230, 248, 260, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377, 392, 395]);

export function locationQuery(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/^\//, '');
  const coordinates = /^[+-]?\d+(?:\.\d+)?\s*,\s*[+-]?\d+(?:\.\d+)?$/.test(raw);
  const query = coordinates ? raw : raw.replaceAll('+', ' ').trim();
  // wttr.in resolves city/landmark/Unicode names, airport/area codes, domains,
  // and coordinates. An optional URL-style leading slash is only notation;
  // URLs, query options, special commands, and implicit IP geolocation are not
  // accepted. Every request still goes to one fixed HTTPS origin/path segment.
  if (!query || query.length > 120 || /[/\\?#:\u0000-\u001f\u007f]/u.test(query)) return null;
  if (query.startsWith('@') && !/^@(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/i.test(query)) return null;
  if (coordinates) {
    const [latitude, longitude] = query.split(',').map(Number);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return `${latitude},${longitude}`;
  }
  return query;
}

function configuredLocations(settings) {
  if (!Array.isArray(settings?.locations) || settings.locations.length > 20) return null;
  const enabled = settings.locations.filter(location => location.enabled);
  if (!enabled.length || enabled.some(location => !locationQuery(location.query))) return null;
  return enabled.map(location => ({ ...location, query: locationQuery(location.query) }));
}

function text(value, maximum = 200) {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && result.length <= maximum && !/[\u0000-\u001f\u007f]/.test(result)
    ? result : null;
}

function number(value, minimum, maximum) {
  // wttr.in normally encodes numbers as strings. Empty/malformed values stay
  // missing instead of becoming zero, and non-finite/out-of-range data is omitted.
  if (typeof value !== 'number' && (typeof value !== 'string'
    || !/^[+-]?\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= minimum && result <= maximum ? result : null;
}

export function parseWeather(payload, city, receivedAt = Date.now()) {
  const current = payload?.current_condition?.[0];
  const temperature = number(current?.temp_C, -150, 100);
  const description = text(current?.weatherDesc?.[0]?.value);
  if (!current || temperature === null || !description) {
    throw new Error('wttr.in did not return valid current conditions.');
  }
  const area = payload?.nearest_area?.[0];
  const code = number(current.weatherCode, 0, 999);
  // Only declared scalar information is persisted. Forecast arrays, provider
  // URLs, and the raw response do not enter the card projection or plugin state.
  // observation_time has no reliable date/zone; receivedAt is our fetch time,
  // not a claim about the provider's observation time or data freshness.
  return {
    'requested-city': city,
    'resolved-area': text(area?.areaName?.[0]?.value),
    region: text(area?.region?.[0]?.value),
    country: text(area?.country?.[0]?.value),
    conditions: description,
    'temperature-c': temperature,
    'feels-like-c': number(current.FeelsLikeC, -150, 100),
    'humidity-percent': number(current.humidity, 0, 100),
    'wind-speed-kmph': number(current.windspeedKmph, 0, 1000),
    'wind-direction': text(current.winddir16Point, 16),
    'precipitation-mm': number(current.precipMM, 0, 10000),
    'pressure-hpa': number(current.pressure, 0, 2000),
    'visibility-km': number(current.visibility, 0, 1000),
    'cloud-cover-percent': number(current.cloudcover, 0, 100),
    'uv-index': number(current.uvIndex, 0, 100),
    'weather-code': text(current.weatherCode, 16),
    raining: rainCodes.has(code) ? true : otherCodes.has(code) ? false : null,
    'updated-at': receivedAt,
  };
}

async function readJson(response) {
  if (!response.body) throw new Error('wttr.in returned an empty response.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > maximumResponseBytes) throw new Error('wttr.in response exceeds 512 KiB.');
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Error('wttr.in returned invalid JSON.');
    }
  } finally {
    // Release the network body even when the size guard or cancellation fails.
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function fetchConditions(city, signal, fetchImpl) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error('wttr.in request timed out after 15 seconds.')), requestTimeoutMs);
  const requestSignal = AbortSignal.any([signal, timeout.signal]);
  try {
    const response = await fetchImpl(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Localserve-Weather/1.0' },
      redirect: 'error', signal: requestSignal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`wttr.in request failed (HTTP ${response.status}).`);
    }
    const payload = await readJson(response);
    requestSignal.throwIfAborted();
    return parseWeather(payload, city);
  } catch (error) {
    if (requestSignal.aborted) throw requestSignal.reason;
    throw error;
  } finally {
    // The network deadline uses wall time, including server pause. Host calls
    // still wait at Sormus's pause gate before committing state/events.
    clearTimeout(timer);
  }
}

// The injectable transport supports isolated tests. Production always uses
// native fetch to the fixed HTTPS origin above; there is no editable endpoint.
export function createWeatherAdapter({ fetchImpl = (...args) => fetch(...args) } = {}) {
  let locations = null;
  let allLocationIds = new Set();
  return {
    validateConfiguration(settings) {
      return configuredLocations(settings) !== null;
    },

    async start(settings) {
      locations = configuredLocations(settings);
      if (!locations) throw new Error('Add and enable a valid Location in Weather Settings.');
      allLocationIds = new Set(settings.locations.map(location => location.id));
    },

    async stop() {
      // Sormus cancels and drains actions before calling stop/reconfigure.
      locations = null;
      allLocationIds.clear();
    },

    async execute(actionId, parameters, context) {
      context.signal.throwIfAborted();
      if (actionId !== 'refresh') throw new Error('Unknown Weather action.');
      if (!locations) throw new Error('Weather is not configured.');
      const id = parameters['location-id'] || (locations.length === 1 ? locations[0].id : null);
      const location = locations.find(location => location.id === id);
      if (!location) throw new Error('Choose an enabled Weather location.');
      let reading;
      try {
        reading = await fetchConditions(location.query, context.signal, fetchImpl);
      } catch (error) {
        // A failed fetch leaves the last successful state and timestamp intact.
        // Cancellation cannot use revoked host services, so skip its log call.
        if (!context.signal.aborted) await context.log(`Weather refresh failed for ${location.name}: ${error.message}`, 'warning');
        throw error;
      }
      context.signal.throwIfAborted();
      // Commit before announcing the update. Persistence, logging, and event
      // delivery are separate operations; crashes can lose an event, never replay
      // it. The shared action queue prevents overlapping refreshes per plugin.
      const state = await context.readState();
      const stored = state.locations || {};
      // Keep each successful reading under its immutable location ID. Retain
      // other configured locations (including disabled ones), but prune removed
      // IDs so repeated edits cannot grow state beyond the bounded list.
      // Disabled locations are supplied at start too for private cache retention.
      const retained = Object.fromEntries(Object.entries(stored).filter(([key]) => allLocationIds.has(key)));
      retained[location.id] = reading;
      await context.saveState({ locations: retained });
      await context.log(`Weather refreshed for ${location.name} (${location.query}).`, 'success');
      const payload = { 'location-id': location.id, 'location-name': location.name,
        city: location.query, 'temperature-c': reading['temperature-c'] };
      for (const key of ['wind-speed-kmph', 'raining', 'humidity-percent', 'precipitation-mm']) {
        if (reading[key] !== null) payload[key] = reading[key];
      }
      await context.emit('weather-updated', payload);
      return { completed: true };
    },
  };
}

export default createWeatherAdapter();
