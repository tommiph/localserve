/** Installed ready-made Cards expose a fixed, package-owned HTML/CSS design.
 * Their only presentation input is a declared data source; no editable markup,
 * scripts, resource URLs or private configuration enter a Card definition.
 * Fixed table slots reuse the public row/column boundary of ordinary Lists. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from './storage.mjs';
import { isIdentifier } from './plugin-schema.mjs';
import { pluginInstances, instanceBinding } from './plugin-instances.mjs';

const assetPath = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*\.(?:html|css|svg|png|webp)$/;
export function validateCardTemplates(values = [], fields = []) {
  if (!Array.isArray(values) || values.length > 8) throw new Error('cardTemplates allows at most eight installed designs.');
  const ids = new Set();
  return values.map(value => {
    if (!value || !isIdentifier(value.id) || ids.has(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 40
      || typeof value.directory !== 'string' || !/^cards\/[a-z0-9-]+$/.test(value.directory)
      || !assetPath.test(value.entry) || !value.entry.endsWith('.html')
      || !Array.isArray(value.assets) || !value.assets.includes(value.entry) || value.assets.length > 32 || new Set(value.assets).size !== value.assets.length
      || value.assets.some(asset => !assetPath.test(asset)) || !Array.isArray(value.slots) || !value.slots.length || value.slots.length > 16) throw new Error('Invalid ready-made Card design or asset allowlist.');
    ids.add(value.id);
    if (value.preview !== undefined && value.preview !== true) throw new Error('Card preview must explicitly opt in.');
    const slots = new Set();
    if (value.sourceLabel !== undefined && (typeof value.sourceLabel !== 'string' || !value.sourceLabel.trim() || value.sourceLabel.length > 32)) throw new Error('Invalid ready-made data source label.');
    const result = { id: value.id, name: value.name.trim(), sourceLabel: value.sourceLabel || 'Data source', directory: value.directory, entry: value.entry, assets: [...value.assets],
      slots: value.slots.map(slot => {
        const field = fields.find(field => field.id === slot.field);
        if (!isIdentifier(slot.id) || ['source-name','source-status'].includes(slot.id) || slots.has(slot.id) || !field || !['string','number','boolean','timestamp','table'].includes(field.type)
          || !['text','number','time','datetime','minutes-until','table'].includes(slot.format || 'text')
          || ['time','datetime','minutes-until'].includes(slot.format) && field.type !== 'timestamp'
          || (slot.format === 'table') !== (field.type === 'table')
          || slot.format === 'number' && field.type !== 'number'
          || slot.percentOf !== undefined && (slot.format !== 'number' || field.type !== 'number')
          || slot.grouping !== undefined && (slot.format !== 'number' || typeof slot.grouping !== 'boolean')
          || slot.decimals !== undefined && (!Number.isInteger(slot.decimals) || slot.decimals < 0 || slot.decimals > 2)) throw new Error('Ready-made slots must reference typed public Card fields.');
        slots.add(slot.id);
        if (field.type === 'table') {
          // The package fixes its row/column selection. These same bounds apply
          // before public Vista projection and before iframe hydration.
          if (!Number.isInteger(slot.rows) || slot.rows < 1 || slot.rows > 10
            || !Array.isArray(slot.columns) || !slot.columns.length || slot.columns.length > 7
            || new Set(slot.columns).size !== slot.columns.length
            || slot.columns.some(id => !field.columns.some(column => column.id === id))) throw new Error('Invalid ready-made table selection.');
          return { id: slot.id, field: field.id, type: 'table', format: 'table', rows: slot.rows,
            columns: slot.columns.map(id => ({ ...field.columns.find(column => column.id === id) })) };
        }
        return { id: slot.id, field: field.id, type: field.type, format: slot.format || 'text', decimals: slot.decimals || 0,
          ...(slot.percentOf !== undefined ? { percentOf: slot.percentOf } : {}),
          ...(slot.grouping === false ? { grouping: false } : {}) };
      }) };
    // A fixed percentage may divide two declared numeric slots. No arbitrary
    // expression or private state path is accepted, and derived chains are disallowed.
    for (const slot of result.slots) {
      if (slot.percentOf === undefined) continue;
      const total = result.slots.find(candidate => candidate.id === slot.percentOf);
      if (slot.type !== 'number' || slot.format !== 'number' || !total || total === slot
        || total.type !== 'number' || total.percentOf !== undefined) throw new Error('Percentage slots require a separate declared numeric total.');
    }
    if (value.variant !== undefined) {
      const variant = value.variant;
      if (!result.slots.some(slot => slot.id === variant?.slot && slot.type !== 'table') || !isIdentifier(variant.fallback) || !variant.choices || typeof variant.choices !== 'object' || Array.isArray(variant.choices)
        || Object.keys(variant.choices).length > 16 || Object.entries(variant.choices).some(([name, choices]) => !isIdentifier(name)
          || !Array.isArray(choices) || choices.length > 64 || choices.some(choice => typeof choice !== 'string' || choice.length > 32))) throw new Error('Invalid declared Card graphic variants.');
      result.variant = { slot: variant.slot, fallback: variant.fallback, choices: structuredClone(variant.choices) };
    }
    if (value.preview) result.preview = true;
    return result;
  });
}

export function readyMadeCatalog(plugin, settings = {}) {
  const sources = plugin.instances ? pluginInstances(plugin, settings) : [{ id: 'plugin', name: plugin.name, enabled: true }];
  return { templates: (plugin.cardTemplates || []).map(({ directory, assets, entry, ...template }) => ({ ...template,
    url: `/plugin-card-assets/${plugin.id}/${template.id}/${entry}`,
    ...(template.preview && plugin.runtime?.preview === 'jpeg-v1' ? { previewUrl: `/api/plugin-preview/${plugin.id}/frame.jpg` } : {}) })),
  sources: sources.map(source => ({ id: source.id, name: source.name, enabled: source.enabled,
    bindings: Object.fromEntries(plugin.cardFields.map(field => [field.id, plugin.instances ? instanceBinding(plugin, source, field) : field.id])) })) };
}

export function validateReadyMadeCard(value, plugin, existing, settings) {
  const catalog = readyMadeCatalog(plugin, settings), template = catalog.templates.find(template => template.id === value.templateId);
  const source = catalog.sources.find(source => source.id === value.sourceId);
  if (value.schemaVersion !== 1 || typeof value.enabled !== 'boolean' || !isIdentifier(value.templateId) || !isIdentifier(value.sourceId)) throw new HttpError(400, 'Choose an installed design and data source.');
  if (existing?.layout === 'readymade' && (!Array.isArray(existing.fields) || !existing.fields.length || existing.fields.length > 16
    || existing.fields.some(field => !field || !isIdentifier(field.id) || typeof field.binding !== 'string' || field.binding.length > 192 || field.enabled !== true))) throw new HttpError(400, 'Invalid saved ready-made fields; original Card is retained.');
  if (existing && existing.layout === 'readymade' && existing.templateId !== value.templateId) throw new HttpError(400, 'Only the data source can be changed for this design.');
  if (value.html !== undefined || value.css !== undefined) throw new HttpError(400, 'Ready-made markup is package-owned.');
  if (!template || !source) {
    // Removed Locations/designs retain their saved references. They render an
    // explicit unavailable state and can be repaired by choosing a known source.
    if (!existing || existing.templateId !== value.templateId || existing.sourceId !== value.sourceId) throw new HttpError(400, 'The ready-made design or data source is unavailable.');
    return { ...existing, revision: existing.revision + 1, enabled: value.enabled };
  }
  const fixed = { showHeader: false, showFooter: false, crop: false, icon: 'inherit', size: 'large' };
  if (Object.entries(fixed).some(([key, expected]) => value[key] !== undefined && value[key] !== expected)
    || value.listOptions !== undefined
    || value.fields !== undefined && (!existing || JSON.stringify(value.fields) !== JSON.stringify(existing.fields))
    || value.name !== undefined && (!existing || value.name !== existing.name)) throw new HttpError(400, 'This ready-made layout is fixed. Only its data source is editable.');
  return { id: existing?.id || randomUUID(), revision: (existing?.revision || 0) + 1, schemaVersion: 1,
    name: existing?.sourceId === source.id ? existing.name : `${template.name} · ${source.name}`.slice(0, 60), enabled: value.enabled,
    layout: 'readymade', templateId: template.id, sourceId: source.id, ...fixed,
    fields: template.slots.map(slot => ({ id: slot.id, binding: source.bindings[slot.field], label: slot.id, enabled: true, icon: 'none', format: 'auto', unit: '', decimals: 0 })) };
}

export function readyMadeSelection(card, metadata) {
  if (card.layout !== 'readymade') return null;
  const template = metadata?.templates.find(template => template.id === card.templateId);
  const source = metadata?.sources.find(source => source.id === card.sourceId);
  if (!template || !source) return { unavailable: 'Design or data source unavailable' };
  return { template, source: { id: source.id, name: source.name, enabled: source.enabled },
    bindings: Object.fromEntries(template.slots.map(slot => [slot.id, source.bindings[slot.field]])) };
}

export async function readCardAsset(root, registry, pluginId, templateId, asset) {
  const plugin = registry.plugins.find(plugin => plugin.id === pluginId);
  const template = plugin?.cardTemplates.find(template => template.id === templateId);
  if (!template?.assets.includes(asset)) throw new HttpError(404, 'Card asset unavailable.');
  const packageRoot = path.join(root, 'plugins', plugin.folder), directory = path.join(packageRoot, template.directory);
  const realPackage = await fs.realpath(packageRoot), realDirectory = await fs.realpath(directory);
  if (!realPackage.startsWith(await fs.realpath(root) + path.sep) || !realDirectory.startsWith(realPackage + path.sep)) throw new HttpError(404, 'Card asset unavailable.');
  const file = path.join(directory, asset), realFile = await fs.realpath(file), stat = await fs.lstat(file);
  if (!realFile.startsWith(realDirectory + path.sep) || !stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new HttpError(404, 'Card asset unavailable.');
  return { content: await fs.readFile(realFile), extension: path.extname(file) };
}
