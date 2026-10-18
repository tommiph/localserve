/** Feed-owned HTML, attachments, alarms and URLs are never executed or fetched.
 * ICAL.js owns recurrence/exception arithmetic; this layer bounds its output. */
import ICAL from '../vendor/ical.js/lib/ical/module.js';
import { createHash } from 'node:crypto';

const day = 86400000;
const clean = (value,limit) => typeof value === 'string'
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,'').trim().slice(0,limit) : '';
const hash = value => createHash('sha256').update(value).digest('hex');

/** Missing VTIMEZONE definitions can use Node's bundled IANA data. Resolve wall
 * time explicitly: repeated hours choose the first instant, gaps move forward.
 * Unknown zone names fail the feed instead of silently using server local time. */
class SystemTimezone extends ICAL.Timezone {
  constructor(tzid) {
    super({tzid});
    this.formatter = new Intl.DateTimeFormat('en-GB',{timeZone:tzid,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  }
  utcOffset(time) {
    const wall = Date.UTC(time.year,time.month-1,time.day,time.hour,time.minute,time.second);
    const offsetAt = instant => {
      const fields = Object.fromEntries(this.formatter.formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type,Number(part.value)]));
      return Date.UTC(fields.year,fields.month-1,fields.day,fields.hour,fields.minute,fields.second) - instant;
    };
    const candidates = [...new Set([-day,0,day].map(delta => wall-offsetAt(wall+delta)))];
    const exact = candidates.filter(instant => instant+offsetAt(instant) === wall);
    const instant = exact.length ? Math.min(...exact) : Math.max(...candidates);
    return (wall-instant)/1000;
  }
}

function instant(time) {
  if (time.isDate || time.zone === ICAL.Timezone.localTimezone) {
    return new Date(time.year,time.month-1,time.day,time.hour,time.minute,time.second).getTime();
  }
  return time.toUnixTime()*1000;
}

export function parseCalendar(text, now) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1048576 || !/^\uFEFF?BEGIN:VCALENDAR\r?\n/i.test(text)
    || text.split(/\r?\n/).length > 30000) throw new Error('Invalid or oversized iCalendar feed.');
  // Each production parse has its own worker and timezone registry. Resetting
  // here also keeps isolated tests from sharing a feed's private zone definitions.
  ICAL.TimezoneService.reset();
  const root = new ICAL.Component(ICAL.parse(text.replace(/^\uFEFF/,'')));
  if (root.name !== 'vcalendar') throw new Error('Expected a single calendar.');
  const components = root.getAllSubcomponents('vevent');
  if (components.length > 1000 || root.getAllSubcomponents().length > 1100) throw new Error('Calendar exceeds 1000 events.');
  for (const component of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(component);
  // Register before properties are decoded, so unknown TZIDs cannot be cached
  // as floating time by the upstream parser. Only time-bearing fields matter.
  for (const component of components) {
    for (const name of ['dtstart','dtend','recurrence-id','rdate','exdate']) {
      for (const property of component.getAllProperties(name)) {
        const tzid = property.getParameter('tzid');
        if (tzid && !ICAL.TimezoneService.has(tzid)) ICAL.TimezoneService.register(new SystemTimezone(tzid));
      }
    }
  }
  const masters = components.filter(component => !component.hasProperty('recurrence-id'));
  const uids = new Set(), rows = new Map();
  let iterations = 0;
  const lower = now-15*60000, upper = now+30*day;
  function add(details,uid,recurrence) {
    const item = details.item;
    if (item.component.getFirstPropertyValue('status') === 'CANCELLED') return;
    const start = instant(details.startDate), end = instant(details.endDate);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Invalid calendar event time.');
    if (start > upper || end < lower) return;
    const id = hash(`${uid}\n${recurrence.toString()}`);
    rows.set(id,{id,title:clean(item.summary,160) || 'Untitled event',description:clean(item.description,240),
      location:clean(item.location,120),start,end,'all-day':details.startDate.isDate});
    if (rows.size > 3000) throw new Error('Calendar expansion exceeds 3000 occurrences.');
  }
  for (const component of masters) {
    const event = new ICAL.Event(component,{strictExceptions:true});
    if (!event.uid || event.uid.length > 1000 || uids.has(event.uid) || !component.hasProperty('dtstart')) throw new Error('Calendar event requires a unique UID and start.');
    uids.add(event.uid);
    if (component.getFirstPropertyValue('status') === 'CANCELLED') continue;
    for (const rule of component.getAllProperties('rrule')) {
      if (!['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(rule.getFirstValue().freq)) throw new Error('Calendar supports daily through yearly recurrence.');
    }
    if (!event.isRecurring()) {
      add({item:event,startDate:event.startDate,endDate:event.endDate},event.uid,event.startDate);
      continue;
    }
    const iterator = event.iterator();
    let occurrence;
    while ((occurrence = iterator.next())) {
      if (++iterations > 20000) throw new Error('Calendar recurrence exceeds 20000 iterations.');
      // Iterate from DTSTART so COUNT and exception identities remain correct.
      // The enclosing disposable worker also caps pathological next() calls.
      if (instant(occurrence) > upper) break;
      add(event.getOccurrenceDetails(occurrence),event.uid,occurrence);
    }
  }
  // Reject orphan exceptions rather than inventing a separate appointment.
  if (components.some(component => component.hasProperty('recurrence-id') && !uids.has(component.getFirstPropertyValue('uid')))) throw new Error('Calendar contains an orphan recurrence exception.');
  const ordered = [...rows.values()].sort((a,b) => a.start-b.start || a.id.localeCompare(b.id));
  return {occurrences:ordered.slice(0,32),limited:ordered.length>32};
}
