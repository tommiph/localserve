/** The bounded v1 field contract is shared by declaration and request validation.
 * It deliberately describes data, never JavaScript expressions or arbitrary HTML.
 */
import { HttpError } from './storage.mjs';
import materialGlyphs from '../assets/material-symbols/catalog.json' with { type: 'json' };

export const identifier = /^[a-z][a-z0-9-]{0,63}$/;
export const isIdentifier = value => typeof value === 'string' && identifier.test(value);

// The catalogue is generated from the bundled static Material Symbols font.
// Compatibility glyph IDs resolve to the catalogue's Material artwork.
export const glyphs = Object.keys(materialGlyphs);

export function validateFields(fields = [], nested = false) {
  if (!Array.isArray(fields) || fields.length > 32) throw new Error('Fields must be a list of at most 32 entries.');
  const seen = new Set();
  return fields.map(field => {
    if (!field || !isIdentifier(field.id) || seen.has(field.id)
      || !['string', 'number', 'boolean', ...(nested ? [] : ['list'])].includes(field.type)) {
      throw new Error('Fields need unique identifiers and supported types.');
    }
    seen.add(field.id);
    const result = { id: field.id, type: field.type, label: String(field.label || field.id).slice(0, 100), required: field.required === true };
    if (field.help !== undefined) result.help = String(field.help).slice(0, 400);
    if (field.defaultFrom !== undefined) {
      if (field.type !== 'string' || field.defaultFrom !== 'server-location') throw new Error('Unknown plugin field default source.');
      result.defaultFrom = field.defaultFrom;
    }
    if (field.type === 'list') {
      if (!Number.isInteger(field.maxItems) || field.maxItems < 1 || field.maxItems > 20) throw new Error('Plugin lists need a limit of 1–20 items.');
      result.maxItems = field.maxItems;
      result.itemLabel = String(field.itemLabel || 'item').slice(0, 40);
      result.fields = validateFields(field.fields, true);
      if (field.uniqueBy !== undefined) {
        if (!Array.isArray(field.uniqueBy) || field.uniqueBy.some(id => !result.fields.some(child => child.id === id && child.type === 'string' && child.required))) throw new Error('Unique list keys must be required declared strings.');
        result.uniqueBy = field.uniqueBy;
      }
    }
    for (const key of ['min', 'max', 'maxLength']) {
      if (field[key] !== undefined) {
        if (!Number.isFinite(field[key]) || (key === 'maxLength' && (!Number.isInteger(field[key]) || field[key] < 1 || field[key] > 4000))) throw new Error('Invalid field constraint.');
        result[key] = field[key];
      }
    }
    if (result.min > result.max) throw new Error('Field minimum exceeds maximum.');
    if (field.enum !== undefined) {
      if (!Array.isArray(field.enum) || !field.enum.length || field.enum.length > 64
        || field.enum.some(value => typeof value !== field.type)) throw new Error('Invalid field choices.');
      result.enum = field.enum;
      if (field.enumLabels !== undefined) {
        if (!Array.isArray(field.enumLabels) || field.enumLabels.length !== field.enum.length
          || field.enumLabels.some(label => typeof label !== 'string' || !label.trim() || label.length > 100)) {
          throw new Error('Choice labels must match the declared choices.');
        }
        result.enumLabels = field.enumLabels.map(label => label.trim());
      }
    }
    if (field.format === 'glyph') result.format = 'glyph';
    if (field.format === 'identifier') result.format = 'identifier';
    if (field.format === 'secret') {
      if (field.type !== 'string' || field.enum || field.suggestions) throw new Error('Secret fields must be plain strings.');
      result.format = 'secret';
    }
    if (field.format === 'multiline') {
      if (field.type !== 'string' || field.enum) throw new Error('Multiline fields must be plain strings.');
      result.format = 'multiline';
    }
    if (field.pattern !== undefined) {
      if (field.type !== 'string' || typeof field.pattern !== 'string' || field.pattern.length > 256) throw new Error('Invalid declared string pattern.');
      new RegExp(field.pattern, 'u');
      result.pattern = field.pattern;
    }
    if (field.suggestions !== undefined) {
      // Suggestions are a bounded, declaration-owned catalogue, never a URL or
      // dynamic lookup. Free typing remains available for newer station codes.
      if (field.type !== 'string' || !Array.isArray(field.suggestions) || field.suggestions.length > 600
        || field.suggestions.some(choice => !choice || typeof choice.value !== 'string'
          || choice.value.length > 32 || typeof choice.label !== 'string' || choice.label.length > 100)) {
        throw new Error('Invalid field suggestions.');
      }
      result.suggestions = field.suggestions.map(({ value, label }) => ({ value, label }));
    }
    if (field.default !== undefined) {
      validateValue(result, field.default);
      result.default = field.default;
    }
    return result;
  });
}

export function validateValue(field, value) {
  const label = field.label || field.id;
  if (field.type === 'list') {
    if (!Array.isArray(value) || value.length > field.maxItems) throw new HttpError(400, `${label} allows at most ${field.maxItems} items.`);
    for (const item of value) validateValues(field.fields, item);
    for (const key of field.uniqueBy || []) {
      const values = value.map(item => item[key].trim().toLowerCase());
      const childLabel = field.fields.find(child => child.id === key).label;
      if (new Set(values).size !== values.length) throw new HttpError(400, `Use unique ${childLabel} values in ${label}.`);
    }
    return;
  }
  if (typeof value !== field.type) throw new HttpError(400, `Invalid ${label}.`);
  if (field.type === 'number' && (!Number.isFinite(value)
    || (field.min !== undefined && value < field.min)
    || (field.max !== undefined && value > field.max))) throw new HttpError(400, `${label} is outside its allowed range.`);
  if (field.type === 'string' && (value.length > (field.maxLength || 4000)
    || (field.required && !value.trim()))) throw new HttpError(400, `Enter a valid ${label}.`);
  if (field.enum && !field.enum.includes(value)) throw new HttpError(400, `Choose a valid ${label}.`);
  if (field.format === 'glyph' && !glyphs.includes(value)) throw new HttpError(400, 'Choose a bundled Material Symbols glyph.');
  if (field.format === 'identifier' && !isIdentifier(value)) throw new HttpError(400, `Choose a valid ${label}.`);
  if (field.pattern && !new RegExp(field.pattern, 'u').test(value)) throw new HttpError(400, `Enter a valid ${label}.`);
}

export function validateValues(fields, values, defaults = false) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new HttpError(400, 'An object of field values is required.');
  const ids = new Set(fields.map(field => field.id));
  if (Object.keys(values).some(key => !ids.has(key))) throw new HttpError(400, 'Unknown plugin field.');
  const result = {};
  for (const field of fields) {
    const value = values[field.id] === undefined && defaults ? field.default : values[field.id];
    if (value === undefined) {
      if (field.required) throw new HttpError(400, `Enter ${field.label || field.id}.`);
      continue;
    }
    validateValue(field, value);
    result[field.id] = value;
  }
  return result;
}
