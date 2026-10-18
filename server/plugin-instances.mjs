/** Declaration-owned named instances share runtime/UI infrastructure. These
 * helpers never discover plugins or dereference arbitrary configuration paths.
 */
import { isIdentifier } from './plugin-schema.mjs';

export function validateInstances(value, settings, events) {
  if (value === undefined) return null;
  const field = settings.find(field => field.id === value?.setting);
  if (!field || field.type !== 'list' || !isIdentifier(value.stateKey) || !isIdentifier(value.eventKey)
    || !field.fields.some(child => child.id === 'id' && child.type === 'string' && child.format === 'identifier' && child.required)
    || !field.fields.some(child => child.id === 'name' && child.type === 'string' && child.required)
    || !field.fields.some(child => child.id === 'enabled' && child.type === 'boolean' && child.required)
    || events.some(event => !event.payload.some(child => child.id === value.eventKey && child.type === 'string' && child.required))) {
    throw new Error('Instances require a bounded named list, state key, and declared event identity.');
  }
  const result = { setting: field.id, stateKey: value.stateKey, eventKey: value.eventKey };
  if (value.queryUrlMigration !== undefined) {
    const migration = value.queryUrlMigration;
    let base;
    try { base = new URL(migration?.baseUrl); } catch { throw new Error('Invalid query URL migration origin.'); }
    if (base.protocol !== 'https:' || base.username || base.password || base.port || base.hash
      || !isIdentifier(migration.queryParameter) || !Array.isArray(migration.parameters)
      || !migration.parameters.length || migration.parameters.length > 8
      || !field.fields.some(child => child.id === 'query' && child.type === 'string' && child.required)) {
      throw new Error('Invalid query URL migration.');
    }
    const parameterIds = new Set([migration.queryParameter]);
    const settingIds = new Set();
    const parameters = migration.parameters.map(parameter => {
      if (!isIdentifier(parameter.setting) || !isIdentifier(parameter.parameter)
        || settings.some(field => field.id === parameter.setting)
        || settingIds.has(parameter.setting) || parameterIds.has(parameter.parameter)
        || typeof parameter.default !== 'string' || parameter.default.length > 100) {
        throw new Error('Invalid query URL migration parameters.');
      }
      settingIds.add(parameter.setting);
      parameterIds.add(parameter.parameter);
      return { setting: parameter.setting, parameter: parameter.parameter, default: parameter.default };
    });
    result.queryUrlMigration = { baseUrl: base.href, queryParameter: migration.queryParameter, parameters };
  }
  if (value.legacySetting !== undefined) {
    if (!isIdentifier(value.legacySetting) || !isIdentifier(value.legacyId)) throw new Error('Invalid legacy instance migration.');
    result.legacySetting = value.legacySetting;
    result.legacyId = value.legacyId;
  }
  return result;
}

export function pluginInstances(plugin, settings = {}) {
  if (!plugin.instances) return [];
  return settings[plugin.instances.setting] || [];
}

export function instanceBinding(plugin, instance, field) {
  // The declaration's compatibility instance uses unprefixed field IDs.
  // Other instances use immutable ID prefixes so a rename cannot retarget a Card.
  return instance.id === plugin.instances.legacyId ? field.id : `${instance.id}:${field.id}`;
}

export function instanceEventId(plugin, instance, event) {
  const original = `plugin:${plugin.id}:event:${event.id}`;
  return instance.id === plugin.instances.legacyId ? original : `${original}:${instance.id}`;
}

export function instanceCardFields(plugin, settings = {}) {
  if (!plugin.instances) return plugin.cardFields || [];
  return pluginInstances(plugin, settings).flatMap(instance => (plugin.cardFields || []).map(field => ({
    ...field, id: instanceBinding(plugin, instance, field),
    label: `${instance.name} · ${field.label}`.slice(0, 64),
    instanceId: instance.id, instanceEnabled: instance.enabled,
  })));
}
