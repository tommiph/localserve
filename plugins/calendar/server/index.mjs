/** Localserve API v1: shared named calendars, offline lifecycle and serialized
 * refreshes. A minute tick reads the cached agenda; feeds refresh less often. */
import { createHash } from 'node:crypto';
import { subscriptionUrl, readSubscription } from './http.mjs';
import { expandCalendar } from './parse.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
export function configuration(settings) {
  if (!settings || ![1,2,5].includes(settings['poll-minutes']) || ![5,15,30,60].includes(settings['feed-minutes'])
    || !Array.isArray(settings.calendars) || settings.calendars.length > 20) return null;
  if (settings.calendars.some(item => !subscriptionUrl(item.url) || !Number.isInteger(item['reminder-minutes'])
    || item['reminder-minutes'] < 0 || item['reminder-minutes'] > 1440)) return null;
  const calendars = settings.calendars.filter(item => item.enabled);
  return calendars.length ? {calendars,ids:new Set(settings.calendars.map(item => item.id)),tick:settings['poll-minutes'],feed:settings['feed-minutes']} : null;
}

export function calendarReading(occurrences, now, receivedAt, limited) {
  const upcoming = occurrences.filter(row => row.end > now || row.start === row.end && row.start >= now);
  const reading = {'event-count':upcoming.length,'row-count':Math.min(10,upcoming.length),'agenda-limited':limited,
    'received-at':receivedAt,'checked-at':now,'poll-status':'Available'};
  const next = upcoming[0];
  for (const key of ['title','description','location','start','end','all-day']) reading[`next-${key}`] = next?.[key] ?? null;
  if (!next) reading['next-title'] = 'No upcoming events';
  for (let i=0;i<10;i++) {
    for (const key of ['title','start','end','location','all-day']) reading[`event-${i+1}-${key}`] = upcoming[i]?.[key] ?? null;
  }
  return reading;
}

export function createCalendarAdapter({ read = readSubscription, expand = expandCalendar, now = Date.now } = {}) {
  let configured, startedAt;
  return {
    validateConfiguration(settings) { return configuration(settings) !== null; },
    async start(settings) {
      configured = configuration(settings);
      if (!configured) throw new Error('Add and enable a valid calendar subscription.');
      startedAt = now();
    },
    async stop() { configured = null; },
    async execute(actionId,parameters,context) {
      context.signal.throwIfAborted();
      if (actionId !== 'refresh' || !configured) throw new Error('Calendar refresh is unavailable.');
      const calendar = configured.calendars.find(item => item.id === (parameters['calendar-id'] || (configured.calendars.length === 1 ? configured.calendars[0].id : null)));
      if (!calendar) throw new Error('Choose an enabled calendar.');
      const state = await context.readState();
      state.calendars = Object.fromEntries(Object.entries(state.calendars || {}).filter(([id]) => configured.ids.has(id)));
      const identity = digest(`${subscriptionUrl(calendar.url)}\n${calendar['reminder-minutes']}`);
      const old = state.calendars[calendar.id];
      const previous = old?.identity === identity ? old : {identity,claims:[]};
      if (state.sequence !== undefined && (!Number.isSafeInteger(state.sequence) || state.sequence < 0)
        || !Array.isArray(previous.claims) || previous.claims.length > 128
        || previous.claims.some(claim => !/^[a-f\d]{64}$/.test(claim.id) || !Number.isFinite(claim.at))) {
        throw new Error('Calendar saved occurrence claims are invalid; original state retained.');
      }
      state.calendars[calendar.id] = previous;
      const fetched = !Array.isArray(previous.occurrences) || now() >= (previous.nextFetchAt || 0);
      if (fetched) {
        if (now() < (state.nextRequestAt || 0)) {
          if (old?.identity !== identity) await context.saveState(state);
          throw new Error('Calendar request spacing is active; wait for the next refresh.');
        }
        previous['attempted-at'] = now();
        previous.nextFetchAt = now()+configured.feed*60000;
        state.nextRequestAt = now()+2000;
        // Feed URLs can contain private subscription tokens. Persist only their
        // digest and bounded parsed appointments, never response text or URLs.
        await context.saveState(state);
        const signal = AbortSignal.any([context.signal,AbortSignal.timeout(20000)]);
        try {
          const result = await expand(await read(calendar.url,signal),now(),signal);
          signal.throwIfAborted();
          previous.occurrences = result.occurrences;
          previous.limited = result.limited;
          previous['received-at'] = now();
          previous.failures = 0;
          previous.failed = false;
          previous.nextFetchAt = now()+configured.feed*60000;
        } catch {
          context.signal.throwIfAborted();
          previous.failures = Math.min(8,(previous.failures || 0)+1);
          previous.failed = true;
          previous['poll-status'] = 'Failed · previous agenda retained';
          previous.nextFetchAt = now()+Math.min(3600000,configured.feed*60000*2**(previous.failures-1));
          state.nextRequestAt = now()+2000;
          await context.saveState(state);
          await context.log(`Calendar refresh failed for ${calendar.name}; previous agenda retained.`, 'warning');
          throw new Error('Calendar feed could not be read or parsed. Check the subscription URL and supported feed limits; no request was retried.');
        }
        state.nextRequestAt = now()+2000;
      }
      if (previous.failed) throw new Error('Calendar feed is cooling down; reminders wait for a successful refresh.');
      const current = now();
      // Allow one interval of scheduling/serial-work slack. A 61-second check
      // must not lose the first second after a nominal one-minute tick. Longer
      // gaps still have a bounded observation window instead of catch-up work.
      const lower = Math.max(previous.checkedAt ?? current,startedAt,current-configured.tick*120000);
      const claims = new Map(previous.claims.filter(claim => claim.at >= current-2*86400000).map(claim => [claim.id,claim]));
      const pending = [];
      for (const row of previous.occurrences) {
        const times = [['event-started',row.start],['event-ended',row.end]];
        if (calendar['reminder-minutes'] > 0) times.unshift(['event-upcoming',row.start-calendar['reminder-minutes']*60000]);
        for (const [id,due] of times) {
          const key = digest(`${row.id}\n${id}\n${due}`);
          if (due > lower && due <= current && !claims.has(key)) {
            claims.set(key,{id:key,at:current});
            pending.push({id,row});
          }
        }
      }
      let sequence = state.sequence ?? 0;
      if (sequence > Number.MAX_SAFE_INTEGER-10) throw new Error('Calendar event sequence exhausted.');
      const events = pending.slice(0,10).map(({id,row}) => ({id,payload:{'calendar-id':calendar.id,'calendar-name':calendar.name,
        'occurrence-id':`${calendar.id}-${++sequence}`,title:row.title,start:row.start,end:row.end,'all-day':row['all-day'],
        ...(row.description ? {description:row.description} : {}),...(row.location ? {location:row.location} : {})}}));
      state.sequence = sequence;
      previous.claims = [...claims.values()].sort((a,b) => b.at-a.at).slice(0,128);
      previous.checkedAt = current;
      Object.assign(previous,calendarReading(previous.occurrences,current,previous['received-at'],previous.limited));
      // Twenty calendars share a 1 MiB snapshot. Long multibyte descriptions
      // must not let one source prevent every other source from saving. Remove
      // farthest appointments first and report the bounded agenda explicitly.
      while (Buffer.byteLength(JSON.stringify(previous)) > 45000 && previous.occurrences.length) {
        previous.occurrences.pop();
        previous.limited = true;
        Object.assign(previous,calendarReading(previous.occurrences,current,previous['received-at'],true));
      }
      if (Buffer.byteLength(JSON.stringify(previous)) > 45000) throw new Error('Calendar saved state exceeds its per-source bound.');
      // Commit the timer cursor and all due claims before events. First reads,
      // restarts, long gaps and missed ticks never replay overdue reminders.
      await context.saveState(state);
      if (fetched) await context.log(`Calendar refreshed: ${calendar.name}.`, 'success');
      for (const event of events) await context.emit(event.id,event.payload);
      const next = previous.occurrences.find(row => row.end > current);
      await context.emit('reading-updated',{'calendar-id':calendar.id,'calendar-name':calendar.name,count:previous['event-count'],
        ...(next ? {title:next.title,start:next.start} : {})});
      return {completed:true,fetched};
    },
  };
}
export default createCalendarAdapter();
