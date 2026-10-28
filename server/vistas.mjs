/** Server-owned Vista layouts reference plugin-owned cards. Viewer responses
 * contain only the cards' declared display data, never administrator snapshots.
 */
import {displayPalette} from './color-themes.mjs';
import {todayPresentation,daylightAt} from './today.mjs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonStore, HttpError } from './storage.mjs';
import { selectedCardData } from './cards.mjs';

export const animations = ['none', 'random', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom', 'flip'];
export const rotations = ['interval', 'update', 'both'];

function requireObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw new HttpError(400, 'Unknown Vista property.');
}

export function dimension(value) {
  // A small explicit CSS grammar permits sizing without accepting expressions,
  // URLs, declarations, or arbitrary style injection. fr sizes are grid tracks.
  if (value === 'auto') return value;
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d+)?|\.\d+)(?:%|px|rem|em|vw|vh|vmin|vmax|fr)$/.test(value)
    || parseFloat(value) <= 0 || parseFloat(value) > 10000) {
    throw new HttpError(400, 'Use a positive size with %, px, rem, em, vw, vh, vmin, vmax, or fr; or auto.');
  }
  return value;
}

function validateLayout(layout) {
  const identities = new Set();
  let count = 0;
  function validateNode(node, depth) {
    requireObject(node, ['id', 'type', 'name', 'enabled', 'width', 'height', 'children', 'cards', 'rotation', 'intervalSeconds', 'animation', 'durationMs']);
    if (++count > 200 || depth > 8) throw new HttpError(400, 'A Vista supports 200 layout items and 8 nesting levels.');
    if (typeof node.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(node.id) || identities.has(node.id)) throw new HttpError(400, 'Layout item identities must be valid and unique.');
    identities.add(node.id);
    if (!['row', 'column', 'card', 'collection'].includes(node.type) || typeof node.enabled !== 'boolean'
      || typeof node.name !== 'string' || !node.name.trim() || node.name.length > 64 || /[\u0000-\u001f]/.test(node.name)) throw new HttpError(400, 'Enter a layout item name and valid type/Enabled state.');
    const result = { id: node.id, type: node.type, name: node.name.trim(), enabled: node.enabled,
      width: dimension(node.width), height: dimension(node.height) };
    if (['row', 'column'].includes(node.type)) {
      if (!Array.isArray(node.children)) throw new HttpError(400, 'Rows and columns need a list of contents.');
      result.children = node.children.map(child => validateNode(child, depth + 1));
    } else {
      if (!Array.isArray(node.cards) || node.cards.length > 100 || (node.type === 'card' && node.cards.length > 1)) throw new HttpError(400, 'Choose one card, or up to 100 collection members.');
      const members = new Set();
      result.cards = node.cards.map(reference => {
        requireObject(reference, ['pluginId', 'cardId']);
        if (![reference.pluginId, reference.cardId].every(id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id))) throw new HttpError(400, 'Choose a valid plugin card.');
        const key = `${reference.pluginId}/${reference.cardId}`;
        if (members.has(key)) throw new HttpError(400, 'A card can appear once per collection.');
        members.add(key);
        // Keep missing references so uninstalling/deleting a card never destroys
        // a saved layout. The editor/viewer report its availability explicitly.
        return { pluginId: reference.pluginId, cardId: reference.cardId };
      });
      if (node.type === 'collection') {
        if (!rotations.includes(node.rotation) || !animations.includes(node.animation)
          || !Number.isFinite(node.intervalSeconds) || node.intervalSeconds < 1 || node.intervalSeconds > 86400
          || !Number.isInteger(node.durationMs) || node.durationMs < 0 || node.durationMs > 5000) throw new HttpError(400, 'Choose a valid collection rotation, interval (1–86400 seconds), and transition (0–5000 ms).');
        Object.assign(result, { rotation: node.rotation, animation: node.animation,
          intervalSeconds: node.intervalSeconds, durationMs: node.durationMs });
      }
    }
    return result;
  }
  if (!['row', 'column'].includes(layout?.type)) throw new HttpError(400, 'A Vista layout starts with a row or column.');
  return validateNode(layout, 0);
}

export function validateVista(value, existing = null) {
  requireObject(value, ['id', 'revision', 'schemaVersion', 'name', 'slug', 'enabled', 'gap', 'padding', 'layout','presentation']);
  if (value.schemaVersion !== 1 || typeof value.name !== 'string' || !value.name.trim()
    || value.name.length > 64 || /[\u0000-\u001f]/.test(value.name) || typeof value.enabled !== 'boolean'
    || typeof value.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) || value.slug.length > 64
    || ![value.gap, value.padding].every(size => Number.isInteger(size) && size >= 0 && size <= 80)) throw new HttpError(400, 'Enter a name, a URL name using lowercase letters/numbers/hyphens, and spacing from 0 to 80 pixels.');
  return { id: existing?.id || randomUUID(), revision: (existing?.revision || 0) + 1,
    schemaVersion: 1, name: value.name.trim(), slug: value.slug, enabled: value.enabled,
    gap: value.gap, padding: value.padding, layout: validateLayout(value.layout),
    ...(value.presentation!==undefined?{presentation:todayPresentation(value.presentation)}:{}) };
}

export class VistaStore {
  constructor(root, registry, config, activity) {
    Object.assign(this, { registry, config, activity });
    this.store = new JsonStore(path.join(root, 'data/vistas.json'), { schemaVersion: 1, vistas: [] });
    this.display = new JsonStore(path.join(root, 'data/vista-display.json'), { schemaVersion: 1, revision: 1, vistaId: null });
  }

  async load() {
    await this.store.load();
    await this.display.load();
    const display = this.display.snapshot();
    if (display.schemaVersion !== 1 || !Number.isSafeInteger(display.revision) || display.revision < 1
      || display.vistaId !== null && (typeof display.vistaId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(display.vistaId))) {
      throw new Error('Invalid vista-display.json; original data was retained.');
    }
    const saved = this.store.snapshot();
    if (saved.schemaVersion !== 1 || !Array.isArray(saved.vistas) || saved.vistas.length > 100) throw new Error('Invalid vistas.json; original data was retained.');
    const ids = new Set(), slugs = new Set(), names = new Set();
    for (const vista of saved.vistas) {
      validateVista(vista, vista);
      if (typeof vista.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(vista.id) || !Number.isInteger(vista.revision) || vista.revision < 1
        || ids.has(vista.id) || slugs.has(vista.slug) || names.has(vista.name.toLowerCase())) throw new Error('Invalid or duplicate saved Vista identity; original data was retained.');
      ids.add(vista.id); slugs.add(vista.slug); names.add(vista.name.toLowerCase());
    }
    return this;
  }

  snapshot() { return this.store.snapshot().vistas; }

  displaySnapshot() { return this.display.snapshot(); }

  async show(id, { revision, signal, gate } = {}) {
    const assertTarget = () => {
      if (!this.snapshot().some(vista => vista.id === id && vista.enabled)) throw new HttpError(409, 'Choose an enabled Vista.');
    };
    assertTarget();
    await this.display.update(async current => {
      // Check again inside the serialized persistence boundary: a target can be
      // disabled, a run cancelled or a pause requested while this write queues.
      if (gate) await gate.wait(signal);
      signal?.throwIfAborted();
      assertTarget();
      if (revision !== undefined && revision !== current.revision) throw new HttpError(409, 'The display selection changed. Refresh before choosing again.');
      if (current.vistaId !== id) { current.vistaId = id; current.revision += 1; }
    });
  }

  displayViewer() {
    const display = this.display.snapshot();
    const vista = this.snapshot().find(vista => vista.id === display.vistaId && vista.enabled);
    if (vista) return { ...this.viewer(vista.slug), displayRevision: display.revision };
    const config = this.config.snapshot();
    // An empty display is a successful, pollable response. A later Task can
    // select a Vista without forcing the end user to reopen the display page.
    return { vista: null, cards: [], displayRevision: display.revision,
      options: { name: config.name, theme: config.displayTheme ?? config.theme, colorTheme:displayPalette(config), fontScale: config.vistaFontScale, timeFormat: config.timeFormat } };
  }

  async save(values, id = null, operation = null) {
    let name;
    await this.store.update(saved => {
      const index = saved.vistas.findIndex(vista => vista.id === id);
      const old = saved.vistas[index];
      if (id && !old) throw new HttpError(404, 'Vista not found.');
      if (old && values.revision !== old.revision) throw new HttpError(409, 'This Vista changed. Close and reopen its editor before saving.');
      name = old?.name;
      if (operation === 'delete') { saved.vistas.splice(index, 1); return; }
      const vista = validateVista(operation === 'enabled' ? { ...old, enabled: values.enabled } : values, old);
      if (saved.vistas.some(item => item.id !== id && (item.slug === vista.slug || item.name.toLowerCase() === vista.name.toLowerCase()))) throw new HttpError(409, 'Use a unique Vista name and URL name.');
      if (!old && saved.vistas.length >= 100) throw new HttpError(400, 'The server supports up to 100 Vistas.');
      if (old) saved.vistas[index] = vista;
      else saved.vistas.push(vista);
      name = vista.name;
    });
    await this.activity.add(`Vista ${operation === 'delete' ? 'deleted' : id ? 'updated' : 'created'}: ${name}`);
  }

  viewer(slug) {
    const vista = this.snapshot().find(vista => vista.slug === slug && vista.enabled);
    if (!vista) throw new HttpError(404, 'Vista unavailable.');
    const references = new Map();
    function collect(node) {
      if (!node.enabled) return;
      for (const reference of node.cards || []) references.set(`${reference.pluginId}/${reference.cardId}`, reference);
      (node.children || []).forEach(collect);
    }
    collect(vista.layout);
    const services = this.registry.services();
    const cards = [...references.values()].map(reference => {
      const plugin = services.find(plugin => plugin.id === reference.pluginId);
      const card = plugin?.cards.find(card => card.id === reference.cardId);
      if (!card?.enabled) return { ...reference, unavailable: card ? 'Card disabled' : 'Card unavailable' };
      return { ...reference, card: { ...card, fields: card.fields.filter(field => field.enabled) },
        ...selectedCardData(card, plugin.cardData, plugin.cardCatalog) };
    });
    const config = this.config.snapshot();
    const result={ vista, cards, options: { name: config.name, theme: config.displayTheme ?? config.theme, colorTheme:displayPalette(config), fontScale: config.vistaFontScale,
      timeFormat: config.timeFormat, timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone, now: Date.now(),...(vista.presentation?{daylight:daylightAt(config)}:{}) } };
    return this.artwork?this.artwork.decorate(result):result;
  }
}
