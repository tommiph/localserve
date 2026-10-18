/** Event values are plain string substitutions, never executable expressions.
 * A run owns its admitted public payload; it cannot read a producer's latest state.
 */
import { HttpError } from './storage.mjs';
import { validateValues } from './plugin-schema.mjs';

function references(value) {
  if (typeof value !== 'string' || !value.includes('{{')) return [];
  const matches = [...value.matchAll(/\{\{event\.([a-zA-Z0-9_-]+)\}\}/g)];
  const remainder = value.replace(/\{\{event\.([a-zA-Z0-9_-]+)\}\}/g, '');
  if (!matches.length || matches.length > 32 || remainder.includes('{{') || remainder.includes('}}')) {
    throw new HttpError(400, 'Use event values in the form {{event.field-id}}.');
  }
  return matches.map(match => match[1]);
}

function publicScalar(field) {
  return field && ['string', 'number', 'boolean'].includes(field.type) && field.format !== 'secret';
}

export function validateTaskParameters(action, parameters, starts, events, previous = null) {
  const bound = new Map();
  for (const field of action.parameters) {
    const value = parameters?.[field.id];
    const keys = references(value);
    if (!keys.length) continue;
    if (field.type !== 'string' || field.enum || field.format === 'secret'
      || value.length > (field.maxLength || 4000)) {
      throw new HttpError(400, 'Event values require a bounded free-text action parameter.');
    }
    const sources = starts.filter(rule => rule.type === 'event').map(rule => events.find(event => event.id === rule.eventId));
    for (const key of keys) {
      if (!sources.some(source => publicScalar(source?.payload?.find(item => item.id === key)))) {
        // Preserve an existing unavailable binding during unrelated edits. It
        // still fails preflight until a matching declared producer is available.
        if (previous?.[field.id] !== value || !sources.some(source => !source)) {
          throw new HttpError(400, `Choose a declared Event start with the public field ${key}.`);
        }
      }
    }
    bound.set(field.id, value);
  }
  const staticValues = Object.fromEntries(Object.entries(parameters || {}).filter(([id]) => !bound.has(id)));
  const fields = action.parameters.filter(field => !bound.has(field.id)).map(field => {
    // A removed scene remains an explicit unavailable reference on unrelated
    // saves. Only its exact prior value can be retained; execution still
    // validates against the current choices and enabled scene before effects.
    const selected = staticValues[field.id];
    if (action.controlScene && field.id === 'scene-id' && selected && previous?.[field.id] === selected
      && field.enum && !field.enum.includes(selected)) return {...field, enum: [...field.enum, selected]};
    return field;
  });
  const result = validateValues(fields, staticValues, true);
  return { ...result, ...Object.fromEntries(bound) };
}

export function resolveTaskParameters(action, parameters, event, events) {
  const source = event && events.find(item => item.pluginId === event.pluginId && item.eventId === event.eventId
    && (!item.instanceId || event.payload?.[item.instanceKey] === item.instanceId)
    && (!item.sensorId || event.payload?.['sensor-id'] === item.sensorId));
  const resolved = {};
  for (const [id, value] of Object.entries(parameters)) {
    const keys = references(value);
    if (!keys.length) { resolved[id] = value; continue; }
    for (const key of keys) {
      const field = source?.payload?.find(item => item.id === key);
      const supplied = event?.payload?.[key];
      if (!publicScalar(field) || typeof supplied !== field.type || typeof supplied === 'number' && !Number.isFinite(supplied)) {
        throw new HttpError(409, `This Task needs the triggering event value ${key}.`);
      }
    }
    // Replace once. Event text containing template syntax remains literal data.
    resolved[id] = value.replace(/\{\{event\.([a-zA-Z0-9_-]+)\}\}/g, (_, key) => String(event.payload[key]));
  }
  // Provider text must satisfy the action's current type, length and format
  // constraints before it can cross the supervised worker/device boundary.
  return validateValues(action.parameters, resolved, true);
}
