/** Rule definitions and local solar calculations. No network or plugin calls. */
import { randomUUID } from 'node:crypto';
import { getTimes } from '../vendor/suncalc/index.js';
import { HttpError } from './storage.mjs';
import { validateValues } from './plugin-schema.mjs';

export const ruleTypes = {
  schedule: 'Schedule', calendar: 'Calendar', timer: 'Timer', interval: 'Interval',
  sunrise: 'Sunrise', sunset: 'Sunset', event: 'Event',
};
const solarCache = new Map();

/** A strict wall-clock minute in the server's system timezone. Nonexistent
 * spring-forward minutes are invalid; Date selects the earlier repeated hour. */
export function calendarDateTime(date, time) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [year, month, day] = date.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
  if (year < 1970 || year > 9999) return null;
  const value = new Date(year, month - 1, day, hour, minute);
  return value.getFullYear() === year && value.getMonth() === month - 1
    && value.getDate() === day && value.getHours() === hour && value.getMinutes() === minute
    ? value.getTime() : null;
}

export function calendarDue(rule, now) {
  const at = calendarDateTime(rule.date, rule.time);
  // Compare instants too: the second copy of a repeated local minute must not
  // become catch-up work when the first copy was missed during an outage.
  return at !== null && now.getTime() >= at && now.getTime() < at + 60000;
}

export function validateRule(start, events) {
  if (!Object.hasOwn(ruleTypes, start.type) || typeof start.name !== 'string'
    || !start.name.trim() || start.name.length > 64) {
    throw new HttpError(400, 'Choose a rule type and enter a rule name.');
  }
  if (start.nameEdited !== undefined && typeof start.nameEdited !== 'boolean') {
    throw new HttpError(400, 'Rule name edit state must be true or false.');
  }
  // Retain explicit name edits across saves/copies, even if the chosen name is
  // identical to a default type label. Missing edit flags infer custom names.
  const rule = { id: start.id, name: start.name.trim(), type: start.type, enabled: start.enabled,
    nameEdited: start.nameEdited ?? !Object.values(ruleTypes).includes(start.name.trim()) };
  if (['schedule', 'sunrise', 'sunset'].includes(start.type)) {
    if (!Array.isArray(start.days) || !start.days.length
      || start.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new HttpError(400, 'Select valid weekdays.');
    }
    rule.days = [...new Set(start.days)];
  }
  if (start.type === 'calendar') {
    if (calendarDateTime(start.date, start.time) === null) throw new HttpError(400, 'Choose a valid date and time in the server timezone (1970–9999). Missing daylight-saving minutes are unavailable.');
    rule.date = start.date;
    rule.time = start.time;
  } else if (start.type === 'schedule') {
    if (typeof start.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start.time)) {
      throw new HttpError(400, 'Enter a valid schedule time.');
    }
    rule.time = start.time;
  } else if (['timer', 'interval'].includes(start.type)) {
    if (!Number.isFinite(start.seconds) || start.seconds < 1 || start.seconds > 31536000) {
      throw new HttpError(400, 'Rule duration must be between 1 second and 365 days.');
    }
    rule.seconds = start.seconds;
  } else if (start.type === 'event') {
    if (!events.some(event => event.id === start.eventId)) {
      throw new HttpError(400, 'Select an event declared by an installed plugin.');
    }
    rule.eventId = start.eventId;
    if (start.condition !== undefined && start.condition !== null) {
      const condition = start.condition;
      const event = events.find(event => event.id === start.eventId);
      const field = event.payload?.find(field => field.id === condition.field);
      const operators = field?.type === 'number'
        ? ['eq', 'ne', 'gt', 'gte', 'lt', 'lte']
        : field?.type === 'string' ? ['eq', 'ne', 'contains'] : ['eq', 'ne'];
      if (!field || !operators.includes(condition.operator)
        || Object.keys(condition).some(key => !['field', 'operator', 'value'].includes(key))) {
        throw new HttpError(400, 'Choose a declared event field and a valid comparison.');
      }
      // A substring is search text, not a full payload value: retain the string
      // length bound but do not require it to match a declared enum/pattern.
      // Reject blank searches so they cannot silently match every event.
      const contains = condition.operator === 'contains';
      const comparisonField = contains
        ? { id: field.id, label: field.label, type: 'string', maxLength: field.maxLength }
        : field;
      const value = contains && typeof condition.value === 'string' ? condition.value.trim() : condition.value;
      validateValues([{ ...comparisonField, required: true }], { [field.id]: value });
      rule.condition = { field: field.id, operator: condition.operator, value };
    }
  }
  return rule;
}

export function eventConditionSignature(rule) {
  return JSON.stringify([rule.eventId, rule.condition]);
}

export function eventConditionMatches(condition, payload) {
  const value = payload[condition.field];
  // Missing readings do not rearm an already true condition. A later known
  // false reading is required, so absent wind/rain is never treated as calm/dry.
  if (typeof value !== typeof condition.value || (typeof value === 'number' && !Number.isFinite(value))) return null;
  switch (condition.operator) {
    case 'eq': return value === condition.value;
    case 'ne': return value !== condition.value;
    case 'contains':
      // Literal, case-insensitive substring matching only. No regular expression,
      // expression evaluation, word splitting or locale-dependent casing.
      if (typeof value !== 'string' || !condition.value.trim()) return null;
      return value.toLowerCase().includes(condition.value.toLowerCase());
    case 'gt': return value > condition.value;
    case 'gte': return value >= condition.value;
    case 'lt': return value < condition.value;
    case 'lte': return value <= condition.value;
    default: return null;
  }
}

export function reconcileEventConditions(tasks, previous = {}) {
  const conditions = {};
  for (const task of tasks.filter(task => task.enabled && task.ruleMode!=='and')) {
    for (const rule of task.starts.filter(rule => rule.enabled && rule.type === 'event' && rule.condition)) {
      const key = `${task.id}/${rule.id}`;
      const signature = eventConditionSignature(rule);
      conditions[key] = previous[key]?.signature === signature
        ? previous[key] : { signature, matched: null };
    }
  }
  return conditions;
}

/** Preserve a running clock through unrelated edits; rearm after disable/enable
 * or a duration/type change. Disabled parent Tasks make their rules inactive.
 */
export function reconcileRuleClocks(tasks, previous = {}, now = Date.now()) {
  const clocks = {};
  for (const task of tasks.filter(task => task.enabled)) {
    for (const rule of task.starts.filter(rule => rule.enabled && ['timer', 'interval'].includes(rule.type))) {
      const key = `${task.id}/${rule.id}`;
      const signature = `${rule.type}/${rule.seconds}`;
      clocks[key] = previous[key]?.signature === signature ? previous[key] : {
        signature, generation: randomUUID(), nextAt: now + rule.seconds * 1000, completed: false,
      };
    }
  }
  return clocks;
}

export function solarOccurrence(date, rule, location) {
  // Solar rules can be saved before location is configured, but cannot run.
  // The current global coordinates are part of the cache key, so edits apply
  // immediately without retaining a result calculated for a previous location.
  if (!location) return null;
  const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const key = `${day}/${zone}/${rule.type}/${location.latitude}/${location.longitude}`;
  if (solarCache.has(key)) return solarCache.get(key);
  let occurrence = null;
  // Check adjacent solar days too: coordinates may be far from the server's
  // timezone. Match the result to the server's local calendar day explicitly.
  for (const offset of [-1, 0, 1]) {
    const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset, 12);
    const candidate = getTimes(noon, location.latitude, location.longitude, 0, -noon.getTimezoneOffset())[rule.type];
    if (candidate && Number.isFinite(candidate.getTime())
      && candidate.getFullYear() === date.getFullYear()
      && candidate.getMonth() === date.getMonth() && candidate.getDate() === date.getDate()) {
      occurrence = candidate.getTime();
      break;
    }
  }
  // Polar day/night can have no sunrise or sunset. Cache null and skip the rule;
  // never fabricate a time. Bound this process-local calculation cache.
  if (solarCache.size >= 1000) solarCache.clear();
  solarCache.set(key, occurrence);
  return occurrence;
}
