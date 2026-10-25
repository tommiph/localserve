/** Sormus serial polling of named Fingrid datasets. Validation/start
 * stay offline; the shared host owns queues, pause, cancellation and polling. */
import { createHash } from 'node:crypto';
import { createClient, validDatasetId, validKey, mapMetadata, mapLatest, text } from './client.mjs';
import { overviewValues } from './overview.mjs';
const hourMs = 3600000, dayMs = 24 * hourMs, callLimit = 9000;
export const effectiveInterval = settings => Math.max(settings['poll-minutes'] * 60000,
  settings.datasets.filter(source => source.enabled).length * dayMs / 8000);
function ready(settings) {
  return validKey(settings?.['api-key']) && [3, 5, 15, 30, 60].includes(settings['poll-minutes'])
    && ['en', 'fi'].includes(settings.language) && typeof settings['api-paused'] === 'boolean'
    && Array.isArray(settings.datasets) && settings.datasets.length <= 20 && settings.datasets.some(source => source.enabled)
    && settings.datasets.every(source => typeof source.query === 'string' && typeof source.enabled === 'boolean'
      && (!source.enabled || validDatasetId(source.query)));
}
export function recentBudget(buckets = {}, at = Date.now()) {
  const hour = Math.floor(at / hourMs);
  // Include the whole oldest partial hour. This conservatively covers every
  // rolling 24-hour window, including restarts, rather than guessing reset time.
  const retained = Object.fromEntries(Object.entries(buckets).filter(([key, count]) => /^\d+$/.test(key)
    && Number(key) >= hour - 24 && Number(key) <= hour && Number.isSafeInteger(count) && count > 0));
  return { buckets: retained, count: Object.values(retained).reduce((sum, count) => sum + count, 0), hour };
}
export function createFingridAdapter({ client = createClient(), now = Date.now } = {}) {
  let settings = null;
  return {
    validateConfiguration: values => Boolean(ready(values)),
    async start(values) { if (!ready(values)) throw new Error('Configure a Fingrid key and enable a Dataset.'); settings = structuredClone(values); },
    async stop() { settings = null; },
    async execute(actionId, parameters, context) {
      if (!settings || actionId !== 'refresh') throw new Error('Fingrid refresh is unavailable.');
      context.signal.throwIfAborted();
      const enabled = settings.datasets.filter(source => source.enabled);
      const target = enabled.find(source => source.id === (parameters['source-id'] || (enabled.length === 1 ? enabled[0].id : '')));
      if (!target) throw new Error('Choose an enabled Fingrid Dataset.');
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(20000)]);
      const interval = effectiveInterval(settings), state = await context.readState();
      const ids = new Set(settings.datasets.map(source => source.id));
      state.datasets = Object.fromEntries(Object.entries(state.datasets || {}).filter(([id]) => ids.has(id)));
      const fingerprint = createHash('sha256').update(settings['api-key']).digest('hex');
      if (state.keyFingerprint !== fingerprint) {
        // A corrected key removes rejection/backoff blocks, never reserved spend
        // or successful readings. The secret itself never enters state.
        state.keyFingerprint = fingerprint; state.blockedUntil = 0;
        for (const reading of Object.values(state.datasets)) { reading.nextCheck = 0; reading.error = ''; }
      }
      let previous = state.datasets[target.id] || {};
      const sameSource = previous.query === target.query;
      if (!sameSource) previous = { sequence: previous.sequence || 0 };
      state.datasets[target.id] = { ...previous };
      const publishStatus = () => {
        const budget = recentBudget(state.budget, now()); state.budget = budget.buckets;
        const overview = overviewValues(settings, state);
        for (const reading of Object.values(state.datasets)) {
          // Named sources supply the fixed Grid overview through declared
          // public fields. Their scalar Cards/Events keep original semantics.
          Object.assign(reading, overview);
          reading['api-paused'] = settings['api-paused']; reading['request-count'] = budget.count;
          reading['request-limit'] = callLimit; reading['effective-minutes'] = interval / 60000;
          reading['api-state'] = settings['api-paused'] ? 'Paused' : reading.error ? 'Error' : 'Active';
          reading['last-error'] = reading.error || null;
          reading['next-check'] = settings['api-paused'] ? null : Math.max(reading.nextCheck || 0, state.blockedUntil || 0) || null;
        }
      };
      const persist = async () => { signal.throwIfAborted(); publishStatus(); await context.saveState(state); signal.throwIfAborted(); };
      if (settings['api-paused'] || now() < (state.blockedUntil || 0) || sameSource && now() < (previous.nextCheck || 0)) {
        await persist(); return { skipped: true };
      }
      const api = async kind => {
        // Host waits respect pause/cancellation. Reserve only after spacing and
        // before transmission; a failed/cancelled request remains spent.
        const wait = Math.max(0, (state.nextRequestAt || 0) - now());
        await context.wait(Math.max(0.01, wait / 1000)); signal.throwIfAborted();
        const budget = recentBudget(state.budget, now());
        if (budget.count >= callLimit) {
          const error = new Error('Fingrid local rolling request budget reached.'); error.status = 429; error.retryMs = hourMs; throw error;
        }
        state.budget = budget.buckets;
        state.budget[budget.hour] = (state.budget[budget.hour] || 0) + 1;
        state.nextRequestAt = now() + 2100;
        await persist();
        try { return await client.read(target.query, kind, settings['api-key'], signal); }
        finally {
          // Completion-based spacing also covers slow persistence or requests.
          // A reservation timestamp alone could expire before a delayed send.
          state.nextRequestAt = now() + 2100;
          if (!signal.aborted) await persist();
        }
      };
      try {
        let metadata = previous.metadata;
        if (!sameSource || !metadata || previous.metadataLanguage !== settings.language || previous.metadataAt < now() - dayMs) {
          metadata = mapMetadata(await api('metadata'), target.query, settings.language);
        }
        const latest = mapLatest(await api('latest'), target.query);
        if (sameSource && Number.isFinite(previous['period-end']) && latest['period-end'] < previous['period-end']) {
          throw new Error('Fingrid returned an older period. Previous reading retained.');
        }
        signal.throwIfAborted();
        const receivedAt = now(), baseline = sameSource && Number.isFinite(previous.value);
        const changed = baseline && latest.value !== previous.value;
        const history = baseline && Array.isArray(previous.history) ? previous.history.filter(row =>
          row.start !== latest['period-start'] || row.end !== latest['period-end']) : [];
        history.unshift({ start: latest['period-start'], end: latest['period-end'], value: latest.value });
        history.sort((left, right) => right.end - left.end || right.start - left.start);
        const reading = { ...latest, ...metadata, query: target.query, 'dataset-id': Number(target.query),
          metadata, metadataLanguage: settings.language,
          metadataAt: metadata === previous.metadata ? previous.metadataAt : receivedAt,
          'received-at': receivedAt, 'attempted-at': receivedAt, 'sample-count': Math.min(history.length, 10),
          history: history.slice(0, 10), sequence: (previous.sequence || 0) + 1,
          nextCheck: receivedAt + interval, failures: 0, error: '' };
        for (let row = 1; row <= 10; row++) {
          const sample = reading.history[row - 1];
          reading[`sample-${row}-start`] = sample?.start ?? null;
          reading[`sample-${row}-end`] = sample?.end ?? null;
          reading[`sample-${row}-value`] = sample?.value ?? null;
        }
        state.datasets[target.id] = reading;
        // The observed change/sequence is durable before any Task can consume
        // it. A crash may lose delivery, but cannot replay a committed change.
        await persist();
        await context.log(`Fingrid refreshed for ${target.name} (dataset ${target.query}).`, 'success');
        const payload = { 'source-id': target.id, 'source-name': target.name, 'dataset-id': Number(target.query), value: latest.value,
          'period-start': latest['period-start'], 'period-end': latest['period-end'], 'received-at': receivedAt,
          'reading-id': `${target.query}:${reading.sequence}` };
        if (metadata.unit !== null) payload.unit = metadata.unit;
        if (changed) await context.emit('value-changed', { ...payload, 'previous-value': previous.value });
        await context.emit('reading-updated', payload);
        return { completed: true, changed };
      } catch (error) {
        context.signal.throwIfAborted();
        // The read deadline cannot authorize late reading/event commits. Keep
        // already reserved spend, and let normal polling make the next attempt.
        if (signal.aborted) throw new Error('Fingrid exceeded its 20-second read deadline. Previous readings retained.');
        if ([401, 403].includes(error.status)) state.blockedUntil = now() + 6 * hourMs;
        if (error.status === 429) state.blockedUntil = now() + Math.max(60000, error.retryMs || hourMs);
        const reading = state.datasets[target.id];
        reading.error = text(error.message, 300); reading.failures = (previous.failures || 0) + 1;
        reading['attempted-at'] = now();
        reading.nextCheck = now() + (error.status === 404 ? 6 * hourMs : Math.min(6 * hourMs, interval * 2 ** Math.min(reading.failures - 1, 6)));
        await persist(); await context.log(`Fingrid refresh failed for ${target.name}: ${reading.error}`, 'warning');
        throw new Error(reading.error);
      }
    },
  };
}
export default createFingridAdapter();
