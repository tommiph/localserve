/** Local-only dates use the host system timezone. No feed or provider is read. */
export function localTarget(source) {
  const date = source['target-date'], time = source['target-time'];
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [year, month, day] = date.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
  if (year < 1970 || year > 9999) return null;
  const at = new Date(year, month - 1, day, hour, minute);
  return at.getFullYear() === year && at.getMonth() === month - 1 && at.getDate() === day
    && at.getHours() === hour && at.getMinutes() === minute ? at.getTime() : null;
}

export function remainingTime(target, now) {
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  return { 'remaining-seconds': seconds, 'remaining-minutes': Math.ceil(seconds / 60),
    'remaining-hours': Math.ceil(seconds / 3600), 'remaining-days': Math.ceil(seconds / 86400),
    days: Math.floor(seconds / 86400), hours: Math.floor(seconds % 86400 / 3600),
    minutes: Math.floor(seconds % 3600 / 60), seconds: seconds % 60, reached: target <= now };
}

export async function refreshDate({source, target, previous, state, current, startedAt, tick, context}) {
  context.signal.throwIfAborted();
  const remaining = remainingTime(target, current);
  const lower = Math.max(previous.checkedAt ?? current, startedAt, current - tick * 120000);
  // One target per source identity. Claims do not expire while that target is
  // retained, so a clock rollback cannot re-emit its reached Event.
  const due = target > lower && target <= current && !previous.claims.some(claim => claim.id === 'date-reached');
  if (due) {
    if ((state.sequence ?? 0) >= Number.MAX_SAFE_INTEGER - 1) throw new Error('Calendar event sequence exhausted.');
    previous.claims = [{id:'date-reached', at:current}];
    state.sequence = (state.sequence ?? 0) + 1;
  }
  Object.assign(previous, remaining, {'target-at':target, 'target-name':source.name, 'checked-at':current,
    checkedAt:current, 'source-kind':'date', 'poll-status':remaining.reached?'Date reached':'Counting down',
    'event-count':remaining.reached?0:1, 'row-count':0, 'agenda-limited':false});
  context.signal.throwIfAborted();
  await context.saveState(state);
  context.signal.throwIfAborted();
  const payload = {'calendar-id':source.id, 'calendar-name':source.name, target, ...remaining};
  if (due) await context.emit('date-reached', {...payload, 'occurrence-id':`${source.id}-${state.sequence}`});
  await context.emit('countdown-updated', payload);
  return {checked:true, local:true, reached:remaining.reached};
}
