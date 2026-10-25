/** Universe owns display preferences only. Card data still belongs to plugins. */
import path from 'node:path';
import { JsonStore, HttpError } from './storage.mjs';
import { selectedCardData } from './cards.mjs';

export const universeDefaults = { schemaVersion: 1, revision: 1, enabled: true, cards: [],
  world: 'space',
  holdSeconds: 15, flightMinSeconds: 8, flightMaxSeconds: 18, order: 'sequential',
  density: 50, detail: 'low', viewDistance: 6000, motion: 50,
  stars: true, nebulae: true, planets: true, asteroids: true };

export function validateUniverse(value, previous = universeDefaults) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).some(key => !Object.hasOwn(universeDefaults, key))) throw new HttpError(400, 'Unknown Universe setting.');
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1
    || value.revision >= Number.MAX_SAFE_INTEGER || value.revision !== previous.revision) throw new HttpError(409, 'Universe changed. Close and reopen the editor.');
  const next = structuredClone(value);
  // An omitted world retains the saved selection or defaults to Space.
  if (next.world === undefined) next.world = previous.world ?? 'space';
  if (!['space', 'ocean', 'mountains', 'forest', 'dunes'].includes(next.world)) throw new HttpError(400, 'Choose an available world.');
  for (const key of ['enabled', 'stars', 'nebulae', 'planets', 'asteroids']) {
    if (typeof next[key] !== 'boolean') throw new HttpError(400, `Choose ${key}.`);
  }
  for (const [key, min, max] of [['holdSeconds', 0, 3600], ['flightMinSeconds', 2, 300],
    ['flightMaxSeconds', 2, 300], ['density', 0, 100], ['viewDistance', 3000, 12000], ['motion', 0, 100]]) {
    if (!Number.isInteger(next[key]) || next[key] < min || next[key] > max) throw new HttpError(400, `${key} must be a whole number from ${min} to ${max}.`);
  }
  if (next.flightMaxSeconds < next.flightMinSeconds) throw new HttpError(400, 'Maximum flight time must be at least the minimum.');
  if (!['low', 'medium', 'high'].includes(next.detail) || !['sequential', 'shuffle'].includes(next.order)) throw new HttpError(400, 'Choose a valid detail level and order.');
  if (!Array.isArray(next.cards) || next.cards.length > 40) throw new HttpError(400, 'Select up to 40 ready-made Cards.');
  const keys = new Set();
  for (const reference of next.cards) {
    if (!reference || Object.keys(reference).sort().join(',') !== 'cardId,pluginId'
      || typeof reference.pluginId !== 'string' || typeof reference.cardId !== 'string'
      || !/^[a-z0-9-]{1,80}$/.test(reference.pluginId) || !/^[a-zA-Z0-9-]{1,80}$/.test(reference.cardId)) throw new HttpError(400, 'Invalid Card reference.');
    const key = reference.pluginId + '/' + reference.cardId;
    if (keys.has(key)) throw new HttpError(400, 'Each Card can appear once.');
    keys.add(key);
  }
  next.revision = previous.revision + 1;
  return next;
}

export class UniverseStore {
  constructor(root, registry, config, activity) {
    this.store = new JsonStore(path.join(root, 'data/universe.json'), universeDefaults);
    Object.assign(this, { registry, config, activity });
  }
  async load() {
    await this.store.load();
    validateUniverse(this.snapshot(), this.snapshot());
    return this;
  }
  snapshot() { return { world: 'space', ...this.store.snapshot() }; }
  async save(value) {
    await this.store.update(current => {
      const next = validateUniverse(value, current);
      // Missing saved references remain explicit. Newly selected references must
      // resolve to a declared ready-made Card; no ordinary/Webpage cards enter.
      const services = this.registry.services();
      for (const reference of next.cards) {
        const old = current.cards.some(item => item.pluginId === reference.pluginId && item.cardId === reference.cardId);
        const card = services.find(service => service.id === reference.pluginId)?.cards.find(card => card.id === reference.cardId);
        if (!old && card?.layout !== 'readymade') throw new HttpError(400, 'Choose an available ready-made Card.');
      }
      Object.assign(current, next);
    });
    await this.activity.add('Universe settings updated');
  }
  viewer() {
    const settings = this.snapshot(), config = this.config.snapshot();
    const services = this.registry.services();
    const cards = settings.enabled ? settings.cards.map(reference => {
      const service = services.find(service => service.id === reference.pluginId);
      const card = service?.cards.find(card => card.id === reference.cardId);
      if (!card?.enabled || card.layout !== 'readymade') return { ...reference, unavailable: card ? 'Card disabled' : 'Card unavailable' };
      return { ...reference, card: { ...card, fields: card.fields.filter(field => field.enabled) },
        ...selectedCardData(card, service.cardData, service.cardCatalog) };
    }) : [];
    // No token, capabilities, plugin configuration or administrator state.
    return { universe: settings, cards, options: { name: config.name, theme: config.displayTheme ?? config.theme,
      fontScale: config.vistaFontScale, timeFormat: config.timeFormat,
      timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone, now: Date.now() } };
  }
}
