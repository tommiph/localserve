/** Localserve runtime API v1 with shared named-area scheduling. Import,
 * validation/start are offline; only an explicit/scheduled refresh reads data. */
import { configuration, areaIdentity, areaUrl, parseAircraft } from './aircraft.mjs';
import { readAircraft } from './http.mjs';

export function createAdsbAdapter({ fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
  let configured = null;
  return {
    validateConfiguration(settings) { return configuration(settings) !== null; },
    async start(settings) {
      configured = configuration(settings);
      if (!configured) throw new Error('Add and enable an area with coordinates and a 1–250 NM radius.');
    },
    async stop() { configured = null; },
    async execute(actionId, parameters, context) {
      context.signal.throwIfAborted();
      if (actionId !== 'refresh' || !configured) throw new Error('Choose an available adsb.lol refresh action.');
      const area = configured.areas.find(area => area.id === (parameters['area-id'] || (configured.areas.length === 1 ? configured.areas[0].id : null)));
      if (!area) throw new Error('Choose an enabled adsb.lol area.');
      const state = await context.readState();
      state.areas = Object.fromEntries(Object.entries(state.areas || {}).filter(([id]) => configured.ids.has(id)));
      const identity = areaIdentity(area), old = state.areas[area.id];
      // Reconfigured centres/radii/age limits start a new baseline. Never retain
      // another area's readings after a failed attempt at the replacement source.
      const previous = old?.identity === identity ? old : { identity };
      if (state.sequence !== undefined && (!Number.isSafeInteger(state.sequence) || state.sequence < 0)
        || previous.seen !== undefined && (!Array.isArray(previous.seen) || previous.seen.length > 2000
          || previous.seen.some(hex => typeof hex !== 'string' || !/^~?[a-f\d]{6}$/.test(hex)))) {
        // Damaged claims must not become a fresh baseline/sequence that could
        // replay old occurrence identities. Leave the original state untouched.
        throw new Error('adsb.lol saved occurrence state is invalid; original state retained.');
      }
      state.areas[area.id] = previous;
      if ((state.blockedUntil || 0) > now() || (state.nextRequestAt || 0) > now() || (previous.nextCheck || 0) > now()) {
        if (old?.identity !== identity) await context.saveState(state);
        throw new Error('adsb.lol is cooling down. Wait for the next allowed refresh; no request was sent.');
      }
      previous['attempted-at'] = now();
      // Reserve before transmission. A crash keeps this slot spent and the
      // shared serial worker never catches up/replays a missed provider request.
      state.nextRequestAt = now() + 2000;
      await context.saveState(state);
      const signal = AbortSignal.any([context.signal,AbortSignal.timeout(15000)]);
      let result;
      try {
        result = parseAircraft(await readAircraft(areaUrl(area),signal,fetchImpl),area,now());
        signal.throwIfAborted();
      } catch (error) {
        context.signal.throwIfAborted();
        const failures = Math.min(10,(previous.failures || 0) + 1);
        previous.failures = failures;
        previous['poll-status'] = 'Failed · previous successful reading retained';
        previous.nextCheck = now() + Math.min(3600000,configured.minutes * 60000 * 2 ** (failures - 1));
        state.nextRequestAt = now() + 2000;
        if (error.status === 429) state.blockedUntil = now() + error.retryMs;
        else if ([401,403].includes(error.status)) state.blockedUntil = now() + 3600000;
        else if (error.status >= 400 && error.status < 500) previous.nextCheck = now() + 3600000;
        await context.saveState(state);
        await context.log(`adsb.lol refresh failed for ${area.name}; previous same-area readings retained.`, 'warning');
        // Transport diagnostics can contain request URLs/coordinates. Persist
        // only categorical failure status, not provider bodies or raw errors.
        throw new Error(signal.aborted ? 'adsb.lol exceeded its 15-second deadline.' : 'adsb.lol refresh failed. Check the area and provider availability; no request was retried.');
      }
      signal.throwIfAborted();
      const baseline = Array.isArray(previous.seen) ? new Set(previous.seen) : null;
      const candidates = baseline ? result.aircraft.filter(aircraft => !baseline.has(aircraft.hex)).slice(0,10) : [];
      let sequence = state.sequence ?? 0;
      if (sequence > Number.MAX_SAFE_INTEGER - 10) throw new Error('adsb.lol event sequence exhausted. No event was emitted.');
      const events = candidates.map(aircraft => {
        const payload = { 'area-id': area.id, 'area-name': area.name, hex: aircraft.hex,
          distance: aircraft.distance, 'occurrence-id': `${area.id}-${++sequence}` };
        for (const key of ['callsign','registration','type','altitude','speed','track','ground','latitude','longitude','position-age','squawk','emergency']) {
          if (aircraft[key] !== null) payload[key] = aircraft[key];
        }
        return payload;
      });
      state.sequence = sequence;
      state.areas[area.id] = { identity, ...result.reading, 'attempted-at': previous['attempted-at'], seen: result.seen, failures: 0 };
      state.nextRequestAt = now() + 2000;
      // Commit readings and every current identity before events. The first
      // success baselines; failures retain claims; skipped events never replay.
      await context.saveState(state);
      await context.log(`adsb.lol refreshed: ${area.name}, ${result.aircraft.length} aircraft with recent positions.`, 'success');
      for (const payload of events) await context.emit('aircraft-detected',payload);
      const updated = { 'area-id': area.id, 'area-name': area.name, count: result.aircraft.length };
      if (result.aircraft[0]) {
        updated['nearest-hex'] = result.aircraft[0].hex;
        updated['nearest-distance'] = result.aircraft[0].distance;
        if (result.aircraft[0].callsign) updated['nearest-callsign'] = result.aircraft[0].callsign;
      }
      await context.emit('reading-updated',updated);
      return { completed: true };
    },
  };
}
export default createAdsbAdapter();
