/** Card templates bind to explicit public fields, never filesystem paths or code.
 * The same projection supports designer previews and read-only Vistas pages.
 */
import { randomUUID } from 'node:crypto';
import { HttpError } from './storage.mjs';
import { isIdentifier, glyphs } from './plugin-schema.mjs';
import { instanceCardFields } from './plugin-instances.mjs';
import { readyMadeCatalog, validateReadyMadeCard, readyMadeSelection } from './card-templates.mjs';
import { solarOccurrence } from './rules.mjs';
import {modeState} from './home-mode-contract.mjs';

const commonFields = [
  { id: 'plugin-name', label: 'Plugin name', type: 'string', icon: 'plug' },
  { id: 'plugin-version', label: 'Plugin version', type: 'string', icon: 'code' },
  { id: 'plugin-status', label: 'Plugin status', type: 'string', icon: 'circle-check' },
  { id: 'plugin-health', label: 'Runtime health', type: 'string', icon: 'heart' },
  { id: 'plugin-enabled', label: 'Plugin enabled', type: 'boolean', icon: 'toggle-on' },
  { id: 'plugin-configured', label: 'Configuration complete', type: 'boolean', icon: 'sliders' },
  { id: 'last-message', label: 'Latest log message', type: 'string', icon: 'comment' },
  { id: 'last-log-level', label: 'Latest log level', type: 'string', icon: 'clipboard-list' },
  { id: 'last-activity', label: 'Last activity time', type: 'timestamp', icon: 'clock' },
  { id: 'recent-log', label: 'Recent log entries', type: 'log', icon: 'clipboard-list' },
];

export function validateCardFields(values = [], events = [], settings = []) {
  if (!Array.isArray(values) || values.length > 64) throw new Error('cardFields must contain at most 64 public fields.');
  const seen = new Set(commonFields.map(field => field.id));
  return values.map(field => {
    if (!field || !isIdentifier(field.id) || seen.has(field.id)
      || typeof field.label !== 'string' || !field.label.trim() || field.label.length > 64
      || !['string', 'number', 'boolean', 'timestamp', 'table', 'webpage'].includes(field.type)) throw new Error('Card fields need unique IDs, labels, and supported types.');
    seen.add(field.id);
    const source = field.source;
    if (field.type === 'table') {
      return validateTableField(field, values);
    }
    if (field.type === 'webpage') {
      const urlField = settings.flatMap(setting => setting.type === 'list' ? setting.fields : [setting])
        .find(setting => setting.id === source?.urlSetting && setting.type === 'string' && setting.format !== 'secret');
      const urlState = values.some(value => value.type === 'string' && value.source?.kind === 'state' && value.source.key === source?.urlKey);
      const receptionState = values.some(value => value.type === 'timestamp' && value.source?.kind === 'state' && value.source.key === source?.revisionKey);
      if (source?.kind !== 'webpage' || !urlField || !isIdentifier(source.urlKey) || !isIdentifier(source.revisionKey)
        || !urlState || !receptionState) {
        throw new Error('Webpage fields require a public URL setting and declared URL/reception state fields.');
      }
      return { id: field.id, label: field.label.trim(), type: 'webpage', icon: glyphs.includes(field.icon) ? field.icon : 'display',
        source: { kind: 'webpage', urlSetting: source.urlSetting, urlKey: source.urlKey, revisionKey: source.revisionKey } };
    }
    if (!source || !['state', 'setting', 'event', 'event-time', 'clock', 'solar'].includes(source.kind)) throw new Error('Unknown card field source.');
    let validatedSource;
    if (source.kind === 'clock' || source.kind === 'solar') {
      if (field.type !== 'timestamp' || source.kind === 'solar' && !['sunrise', 'sunset'].includes(source.event)) throw new Error('Clock and solar Card fields require timestamps and a known solar event.');
      validatedSource = source.kind === 'clock' ? { kind: 'clock' } : { kind: 'solar', event: source.event };
    } else if (source.kind === 'state' || source.kind === 'setting') {
      if (!isIdentifier(source.key) || ['constructor', 'prototype', '__proto__'].includes(source.key)) throw new Error('Card source keys must be simple identifiers.');
      if (source.kind === 'setting' && !settings.some(setting => setting.id === source.key && setting.type === field.type)) throw new Error('Card settings must match a declared field.');
      // Credentials are administrator settings, never public Card bindings.
      if (source.kind === 'setting' && settings.some(setting => setting.id === source.key && setting.format === 'secret')) throw new Error('Secret settings cannot be Card sources.');
      validatedSource = { kind: source.kind, key: source.key };
    } else {
      const event = events.find(event => event.id === source.eventId);
      if (!event) throw new Error('Card fields must reference declared events.');
      if (source.kind === 'event-time') {
        if (field.type !== 'timestamp') throw new Error('Event times must use the timestamp type.');
        validatedSource = { kind: source.kind, eventId: source.eventId };
      } else {
        if (!event.payload.some(parameter => parameter.id === source.key && parameter.type === field.type)) throw new Error('Card event fields must match a declared payload field.');
        validatedSource = { kind: source.kind, eventId: source.eventId, key: source.key };
      }
    }
    return { id: field.id, label: field.label.trim(), type: field.type,
      icon: glyphs.includes(field.icon) ? field.icon : 'plug', source: validatedSource };
  });
}

function validateTableField(field, fields) {
  const source = field.source;
  if (source?.kind !== 'rows' || !Array.isArray(source.rows) || !source.rows.length || source.rows.length > 10
    || !Array.isArray(field.columns) || !field.columns.length || field.columns.length > 7) {
    throw new Error('Table fields require 1–10 declared rows and 1–7 columns.');
  }
  const seen = new Set();
  const columns = field.columns.map(column => {
    if (!column || !isIdentifier(column.id) || seen.has(column.id)
      || ['constructor', 'prototype', '__proto__'].includes(column.id)
      || typeof column.label !== 'string' || !column.label.trim() || column.label.length > 64
      || !['string', 'number', 'boolean', 'timestamp'].includes(column.type)) throw new Error('Invalid table column.');
    seen.add(column.id);
    if (column.format !== undefined && !(column.type === 'timestamp' && ['time', 'minutes-until'].includes(column.format)
      || column.type === 'number' && column.format === 'duration')) {
      throw new Error('Table formats must match timestamp or numeric duration columns.');
    }
    if (column.position !== undefined && column.position !== 'last') throw new Error('Invalid table column position.');
    return { id: column.id, label: column.label.trim(), type: column.type,
      ...(column.format ? { format: column.format } : {}),
      ...(column.position ? { position: column.position } : {}) };
  });
  const cellFields = source.cellFields ?? [];
  if (!Array.isArray(cellFields) || cellFields.length > 60) throw new Error('Table cellFields allows at most 60 explicit scalar keys.');
  const cellKeys = new Set();
  for (const cell of cellFields) {
    if (!cell || !isIdentifier(cell.key) || ['constructor', 'prototype', '__proto__'].includes(cell.key)
      || cellKeys.has(cell.key) || !['string', 'number', 'boolean', 'timestamp'].includes(cell.type)) {
      throw new Error('Invalid declared table cell field.');
    }
    cellKeys.add(cell.key);
  }
  // Table-only cells declare their own bounded key/type allowlist without using
  // another standalone Card binding for every row. Existing scalar-backed rows
  // still validate as before; neither form permits paths or private arrays.
  const rows = source.rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).length !== columns.length) throw new Error('Invalid table row.');
    return Object.fromEntries(columns.map(column => {
      const scalar = fields.find(scalar => scalar.source?.kind === 'state'
        && scalar.source.key === row[column.id] && scalar.type === column.type);
      const cell = cellFields.find(cell => cell.key === row[column.id] && cell.type === column.type);
      if ((!scalar && !cell) || !isIdentifier(row[column.id])) throw new Error('Table cells must reference declared scalar state keys of the same type.');
      return [column.id, row[column.id]];
    }));
  });
  if (!fields.some(scalar => scalar.type === 'number' && scalar.source?.kind === 'state' && scalar.source.key === source.countKey)) {
    throw new Error('Table row count must reference a declared numeric state field.');
  }
  let sort;
  if (source.sort !== undefined) {
    const column = columns.find(column => column.id === source.sort?.column);
    if (!column || !['timestamp', 'number'].includes(column.type)
      || !['asc', 'desc'].includes(source.sort.direction)) {
      throw new Error('Table sorting requires a declared numeric or timestamp column and asc/desc direction.');
    }
    sort = { column: column.id, direction: source.sort.direction };
  }
  return { id: field.id, label: field.label.trim(), type: 'table',
    icon: glyphs.includes(field.icon) ? field.icon : 'plug', columns,
    source: { kind: 'rows', countKey: source.countKey, rows,
      ...(cellFields.length ? { cellFields: cellFields.map(({ key, type }) => ({ key, type })) } : {}),
      ...(sort ? { sort } : {}) } };
}

export function cardCatalog(plugin, settings = {}) {
  return [...instanceCardFields(plugin, settings).map(({ source, instanceEnabled, ...field }) => field), ...commonFields];
}

export function cardFormats(type) {
  return {
    string: ['auto', 'text', 'link'], number: ['auto', 'number', 'text'],
    boolean: ['auto', 'yes-no', 'text'], timestamp: ['auto', 'datetime', 'relative'],
    log: ['auto', 'log'], table: ['auto'],
  }[type] || ['auto'];
}

function text(value, label, maximum, required = false) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f]/.test(value)
    || (required && !value.trim())) throw new HttpError(400, `Enter a valid ${label}.`);
  return value.trim();
}

function onlyKeys(value, permitted) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !permitted.includes(key))) throw new HttpError(400, 'Unknown card property.');
}

export function validateCard(value, plugin, existing = null, settings = {}) {
  onlyKeys(value, ['id', 'revision', 'schemaVersion', 'name', 'enabled', 'showHeader', 'showFooter', 'crop', 'icon', 'size', 'layout', 'fields', 'listOptions', ...(value.layout === 'readymade' ? ['templateId','sourceId'] : [])]);
  if (value.layout === 'readymade') return validateReadyMadeCard(value, plugin, existing, settings);
  if (existing?.layout === 'readymade') throw new HttpError(400, 'The ready-made design is fixed.');
  // Missing display options mean visible header/footer and scrolling. Defaults
  // apply on save; loading does not rewrite files or advance revisions.
  for (const name of ['showHeader', 'showFooter', 'crop']) {
    if (value[name] !== undefined && typeof value[name] !== 'boolean') throw new HttpError(400, 'Card display options must be on or off.');
  }
  if (value.schemaVersion !== 1 || typeof value.enabled !== 'boolean'
    || !['small', 'medium', 'large'].includes(value.size)
    || !['list', 'grid', 'highlight', 'table', 'webpage'].includes(value.layout)
    || !['inherit', 'none', ...glyphs].includes(value.icon)) throw new HttpError(400, 'Choose a valid card size, layout, glyph, and Enabled state.');
  if (!Array.isArray(value.fields) || !value.fields.length || value.fields.length > 16) throw new HttpError(400, 'A card needs between 1 and 16 information fields.');
  const catalog = cardCatalog(plugin, settings);
  const seen = new Set();
  const fields = value.fields.map(field => {
    onlyKeys(field, ['id', 'binding', 'label', 'enabled', 'icon', 'format', 'unit', 'decimals']);
    if (typeof field.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(field.id) || seen.has(field.id)) throw new HttpError(400, 'Card field identities must be valid and unique.');
    seen.add(field.id);
    const source = catalog.find(source => source.id === field.binding);
    const original = existing?.fields.find(original => original.id === field.id && original.binding === field.binding);
    // Keep saved missing bindings editable; never invent a replacement value or
    // silently cascade-delete templates when a declaration stops advertising data.
    if (!source && !original) throw new HttpError(400, 'Choose information declared by this plugin.');
    const formats = source ? cardFormats(source.type) : cardFormats('string').concat('number', 'yes-no', 'datetime', 'relative', 'log');
    if (typeof field.enabled !== 'boolean' || !['auto', 'none', ...glyphs].includes(field.icon)
      || !formats.includes(field.format) || !Number.isInteger(field.decimals) || field.decimals < 0 || field.decimals > 4) throw new HttpError(400, 'Choose valid card field formatting.');
    return { id: field.id, binding: field.binding, label: text(field.label, 'field label', 64, true),
      enabled: field.enabled, icon: field.icon, format: field.format,
      unit: text(field.unit, 'unit', 24), decimals: field.decimals };
  });
  let listOptions;
  const webpageSource = catalog.find(source => source.id === fields[0]?.binding);
  if (value.layout === 'webpage' && (fields.length !== 1 || webpageSource && webpageSource.type !== 'webpage')) {
    throw new HttpError(400, 'Webpage style needs one declared webpage source.');
  }
  if (value.layout !== 'webpage' && fields.some(field => catalog.find(source => source.id === field.binding)?.type === 'webpage')) {
    throw new HttpError(400, 'Use Webpage style for whole webpage information.');
  }
  if (value.listOptions !== undefined || value.layout === 'table') {
    const source = catalog.find(source => source.id === fields[0]?.binding);
    onlyKeys(value.listOptions, ['rows', 'fontSize', 'noWrap', 'columns']);
    const options = value.listOptions;
    if (!Number.isInteger(options.rows) || options.rows < 1 || options.rows > 10
      || !Number.isInteger(options.fontSize) || options.fontSize < 10 || options.fontSize > 48
      || typeof options.noWrap !== 'boolean' || !Array.isArray(options.columns)
      || !options.columns.length || options.columns.length > 7
      || new Set(options.columns).size !== options.columns.length
      || options.columns.some(id => !isIdentifier(id))) throw new HttpError(400, 'Choose 1–10 rows, a 10–48px font size, and valid List columns.');
    if (value.layout === 'table' && (fields.length !== 1 || (source && source.type !== 'table'))) {
      throw new HttpError(400, 'List style needs one declared table source.');
    }
    const retained = existing?.listOptions?.columns || [];
    if (value.layout === 'table' && options.columns.some(id => source
      ? !source.columns.some(column => column.id === id) : !retained.includes(id))) {
      throw new HttpError(400, 'Choose columns declared by the List source.');
    }
    listOptions = { rows: options.rows, fontSize: options.fontSize, noWrap: options.noWrap, columns: [...options.columns] };
  }
  return { id: existing?.id || randomUUID(), revision: (existing?.revision || 0) + 1,
    schemaVersion: 1, name: text(value.name, 'card title', 64, true), enabled: value.enabled,
    showHeader: value.showHeader ?? true, showFooter: value.showFooter ?? true,
    crop: value.crop ?? false,
    icon: value.icon, size: value.size, layout: value.layout, fields,
    ...(listOptions ? { listOptions } : {}) };
}

export function validateCardStore(value, plugin, settings = {}) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.cards) || value.cards.length > 100) throw new Error('Invalid cards.json; original data was retained.');
  const seen = new Set(), names = new Set();
  for (const card of value.cards) {
    if (typeof card.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(card.id) || seen.has(card.id)
      || !Number.isInteger(card.revision) || card.revision < 1) throw new Error('Invalid saved card identity or revision.');
    validateCard(card, plugin, card, settings);
    if (names.has(card.name.toLowerCase())) throw new Error('Saved card titles must be unique within a plugin.');
    seen.add(card.id); names.add(card.name.toLowerCase());
  }
  return value;
}

function validValue(type, value) {
  if (type === 'webpage') return Boolean(value && typeof value.url === 'string' && safeWebpageUrl(value.url)
    && Number.isFinite(value.revision));
  if (type === 'timestamp') return Number.isFinite(value) && Math.abs(value) <= 8640000000000000;
  if (type === 'number') return Number.isFinite(value);
  return typeof value === type;
}

function safeWebpageUrl(value) {
  try {
    const url = new URL(value);
    return value.length <= 2000 && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.port;
  } catch { return false; }
}

export function projectCardData(plugin, record, paused = false, environment = {}) {
  const config = record?.config.snapshot();
  const entries = record?.log.latest() || [];
  const savedState = record?.state.snapshot() || {};
  const state = plugin.modeSelector ? modeState(config?.settings,savedState) : savedState;
  let status = 'Unavailable';
  if (record) {
    if (['error', 'restart-required'].includes(record.health)) status = 'Error';
    else if (record.health === 'loading') status = 'Loading';
    else if (record.health === 'configuring') status = 'Updating';
    else if (!record.configured) status = 'Configure';
    else if (!config.enabled) status = 'Disabled';
    else status = paused ? 'Paused' : record.gatewayConnection?.status==='unreachable'?'Unreachable':record.gatewayConnection?.status==='checking'?'Checking':'Ready';
  }
  const values = {};
  function set(field, value) {
    const available = ['log', 'table'].includes(field.type) ? Array.isArray(value) : validValue(field.type, value);
    values[field.id] = { type: field.type, available, value: available ? value : null };
  }
  for (const field of instanceCardFields(plugin, config?.settings)) {
    const source = field.source;
    // Only the declaration's public keys are read from one explicitly selected
    // instance. Disabled instances expose no readings, including to Vistas.
    const sourceState = field.instanceId ? state[plugin.instances.stateKey]?.[field.instanceId] || {} : state;
    let value;
    if (source.kind === 'rows') {
      const count = sourceState[source.countKey];
      if (Number.isInteger(count) && count >= 0 && count <= source.rows.length) {
        value = source.rows.slice(0, count).map(row => Object.fromEntries(field.columns.map(column => {
          const cell = sourceState[row[column.id]];
          return [column.id, validValue(column.type, cell) ? (column.type === 'string' ? cell.slice(0, 1000) : cell) : null];
        })));
        if (source.sort) {
          // Sort the complete public rows before the Card/Vista row limit and
          // column selection. A title-only list still orders by publication
          // time without exposing that hidden date in the viewer response.
          // Missing dates stay last; stable sorting retains feed order for ties.
          const { column, direction } = source.sort;
          value.sort((left, right) => {
            if (left[column] === null) return right[column] === null ? 0 : 1;
            if (right[column] === null) return -1;
            return direction === 'desc' ? right[column] - left[column] : left[column] - right[column];
          });
        }
      }
    } else if (source.kind === 'webpage') {
      const settings = field.instanceId ? config?.settings[plugin.instances.setting]?.find(instance => instance.id === field.instanceId) : config?.settings;
      const url = settings?.[source.urlSetting];
      let normalized;
      try { normalized = new URL(url).href; } catch { normalized = null; }
      value = record?.configured && config?.enabled && sourceState[source.urlKey] === normalized ? { url: normalized,
        revision: Number.isFinite(sourceState[source.revisionKey]) ? sourceState[source.revisionKey] : 0 } : undefined;
    } else if (source.kind === 'state') {
      value = Object.hasOwn(sourceState, source.key) ? sourceState[source.key] : undefined;
      if(plugin.id==='tradfri'&&source.key==='connection-status'&&record?.gatewayConnection?.status==='unreachable')value='Unreachable';
      if(plugin.id==='tradfri'&&source.key==='connection-status'&&record?.gatewayConnection?.status==='checking')value='Checking';
    }
    else if (source.kind === 'clock') value = environment.now ?? Date.now();
    else if (source.kind === 'solar') value = solarOccurrence(new Date(environment.now ?? Date.now()), { type: source.event }, environment.location);
    else if (source.kind === 'setting') value = config?.settings?.[source.key];
    else {
      // Only the retained plugin log is searched. Once an old event falls out of
      // its 500-row window, no value is claimed until a new occurrence exists.
      const event = entries.find(entry => entry.eventId === source.eventId
        && (!field.instanceId || entry.payload?.[plugin.instances.eventKey] === field.instanceId));
      value = source.kind === 'event-time' ? event?.at : event?.payload?.[source.key];
    }
    set(field, field.instanceEnabled === false ? undefined : value);
  }
  const latest = entries[0];
  const common = {
    'plugin-name': plugin.name, 'plugin-version': plugin.version, 'plugin-status': status,
    'plugin-health': record?.health || 'unavailable', 'plugin-enabled': config?.enabled,
    'plugin-configured': record?.configured, 'last-message': latest?.message,
    'last-log-level': latest?.level, 'last-activity': latest?.at,
    // This explicit DTO excludes raw config, private state, run IDs, and paths.
    'recent-log': entries.slice(0, 5).map(entry => ({ message: String(entry.message), at: entry.at, level: entry.level })),
  };
  for (const field of commonFields) set(field, common[field.id]);
  return { pluginId: plugin.id, pluginName: plugin.name, icon: config?.icon || plugin.icon, status, values,
    ...(plugin.cardTemplates?.length ? { readyMade: readyMadeCatalog(plugin, config?.settings) } : {}),
    ...(plugin.attribution ? { attribution: plugin.attribution } : {}) };
}

/** Public Vista output includes only the requested table rows/columns. Reuse the
 * same binding boundary as scalar cards; hidden cells must not leak in the DTO.
 */
export function selectedCardData(card, data, catalog) {
  const readyMade = readyMadeSelection(card, data.readyMade);
  const bindings = new Set(readyMade ? Object.values(readyMade.bindings || {}) : card.fields.filter(field => field.enabled).map(field => field.binding));
  const tableSelection = id => {
    if (card.layout === 'table') return card.listOptions;
    const slot = readyMade?.template?.slots.find(slot => slot.type === 'table' && readyMade.bindings[slot.id] === id);
    return slot ? { rows: slot.rows, columns: slot.columns.map(column => column.id) } : null;
  };
  const selectedCatalog = catalog.filter(field => bindings.has(field.id)).map(field => {
    const selection = field.type === 'table' && tableSelection(field.id);
    return selection ? { ...field, columns: field.columns.filter(column => selection.columns.includes(column.id)) } : field;
  });
  const values = Object.fromEntries(Object.entries(data.values).filter(([id]) => bindings.has(id)).map(([id, datum]) => {
    const selection = datum.type === 'table' && tableSelection(id);
    if (!selection || !datum.available) return [id, datum];
    return [id, { ...datum, value: datum.value.slice(0, selection.rows).map(row => Object.fromEntries(
      selection.columns.map(column => [column, row[column] ?? null]))) }];
  }));
  return { catalog: selectedCatalog, data: { pluginName: data.pluginName, icon: data.icon, status: data.status, values,
    ...(readyMade ? { readyMade } : {}),
    ...(data.attribution ? { attribution: data.attribution } : {}) } };
}
