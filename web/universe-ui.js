/* Universe edits display preferences in the shared modal. Card definitions and
 * provider settings remain in their existing plugin editors. */
const UniverseUI = {
  draft: null,
  search: '',
  category: 'all',
  worlds: [['space','Space'],['ocean','Ocean depths'],['mountains','Alpine mountains'],['forest','Calm forest'],['dunes','Sunset dunes']],
  library() {
    return state.services.flatMap(service => service.cards.filter(card => card.layout === 'readymade')
      .map(card => ({ pluginId: service.id, cardId: card.id, name: card.name, plugin: service.name, enabled: card.enabled, unavailable:AdminUX.cardAvailability(service,card) })));
  },
  render() {
    const value = state.universe;
    if (!value) return pageHeading('Universe', '3D Card display') + '<section class="panel"><div class="universe-summary">Restart Localserve to enable Universe.</div></section>';
    return pageHeading('Universe', '3D Card display') + `<section class="panel"><div class="panel-header"><h2>${icon('meteor')}Universe</h2><div class="row-actions"><button class="button" data-action="universe-edit">${icon('pen')}Edit</button><a class="button primary" href="/universe" target="_blank" rel="noopener">${icon('arrow-up-right-from-square')}Open display</a></div></div><div class="universe-summary"><span>${value.enabled ? 'Enabled' : 'Disabled'}</span><span>${escapeHtml(this.worlds.find(([id]) => id === (value.world || 'space'))?.[1] || 'Space')}</span><span>${value.cards.length} Cards</span><span>Stop ${value.holdSeconds}s</span><span>Flight ${value.flightMinSeconds}–${value.flightMaxSeconds}s</span><span>${escapeHtml(value.detail)} detail</span></div><p class="field-help universe-help">Select ready-made Cards and configure the journey. Display URL: <a href="/universe" target="_blank" rel="noopener">/universe</a></p><div class="universe-world-library">${this.worlds.map(([id,label]) => `<a class="button" href="/universe?world=${id}" target="_blank" rel="noopener">${icon('arrow-up-right-from-square')}${label}</a>`).join('')}</div><p class="field-help universe-help">World links share the selected Cards and journey settings.</p></section>`;
  },
  number(label, key, min, max, help = '') {
    return formField(label, 'sliders', `<input name="${key}" type="number" min="${min}" max="${max}" step="1" required value="${this.draft[key]}">`, help);
  },
  select(label, key, choices) {
    return formField(label, 'sliders', `<select name="${key}">${choices.map(([id, name]) => `<option value="${id}" ${this.draft[key] === id ? 'selected' : ''}>${name}</option>`).join('')}</select>`);
  },
  open() {
    this.draft = { world: 'space', ...structuredClone(state.universe) }; this.search = ''; this.category = 'all';
    showDialog(`<form id="universe-editor-form">${dialogHeader('Edit Universe')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><div class="task-designer"><div class="task-canvas universe-settings"><label class="check-field"><input type="checkbox" name="enabled" ${this.draft.enabled ? 'checked' : ''}>Display enabled</label>
      <h3>Journey</h3>
      <div class="field-row">${this.number('Stop at each Card (seconds)', 'holdSeconds', 0, 3600, '0 keeps the flight moving without stopping at Cards.')}${this.select('Card order', 'order', [['sequential','Selected order'],['shuffle','Shuffle']])}</div>
      <div class="field-row">${this.number('Minimum flight (seconds)', 'flightMinSeconds', 2, 300)}${this.number('Maximum flight (seconds)', 'flightMaxSeconds', 2, 300)}</div>
      <h3>Selected Cards</h3>
      <p class="field-help">Add Cards from the library. Use the arrows to set their order. Disabled or missing Cards are skipped. Selected Cards with an unavailable source show their status.</p><div id="universe-selected"></div>
      <h3>World</h3>
      ${this.select('Default world', 'world', this.worlds)}
      <div class="field-row">${this.number('Population density (%)', 'density', 0, 100)}${this.number('Flight motion (%)', 'motion', 0, 100, '0 keeps a straight flight path.')}</div><details><summary>Space objects</summary><p class="field-help">These switches apply to the Space world.</p><div class="universe-categories">${[['stars','Stars'],['nebulae','Nebulae'],['planets','Planets'],['asteroids','Asteroids']].map(([id,label]) => `<label class="check-field"><input type="checkbox" name="${id}" ${this.draft[id] ? 'checked' : ''}>${label}</label>`).join('')}</div></details>
      <h3>Rendering</h3>
      <div class="field-row">${this.select('Detail / LOD', 'detail', [['low','Low · 2017 TV'],['medium','Medium'],['high','High']])}${this.number('View distance', 'viewDistance', 3000, 12000)}</div><p class="field-help">Low detail uses fewer objects, simpler geometry and a limited rendering resolution. Distant objects are culled. Reduced motion keeps Cards stationary between gentle fades.</p></div>
      <aside class="action-library">
      <h3>Card library</h3><label class="library-search">${icon('magnifying-glass')}<input id="universe-search" type="search" placeholder="Search Cards" aria-label="Search Cards"></label><div id="universe-library"></div></aside></div></div>${dialogFooter('Save changes')}</form>`, { kind: 'universe' });
    this.refresh();
  },
  readDraft() {
    const form = dialog.querySelector('#universe-editor-form');
    if (form) {
      const values = new FormData(form);
      for (const key of ['holdSeconds','flightMinSeconds','flightMaxSeconds','density','viewDistance','motion']) this.draft[key] = Number(values.get(key));
      for (const key of ['enabled','stars','nebulae','planets','asteroids']) this.draft[key] = values.has(key);
      this.draft.order = values.get('order'); this.draft.detail = values.get('detail'); this.draft.world = values.get('world');
    }
    return structuredClone(this.draft);
  },
  refresh() {
    const library = this.library();
    dialog.querySelector('#universe-selected').innerHTML = this.draft.cards.map((reference, index) => {
      const card = library.find(card => card.pluginId === reference.pluginId && card.cardId === reference.cardId);
      return `<div class="universe-card-row"><div><strong>${escapeHtml(card?.name || 'Card unavailable')}</strong><small>${escapeHtml(card ? `${card.plugin}${card.unavailable ? ' · '+escapeHtml(card.unavailable) : ''}` : reference.pluginId)}</small></div><div class="row-actions">${[['up','arrow-up','Move up',index === 0],['down','arrow-down','Move down',index === this.draft.cards.length - 1],['remove','xmark','Remove',false]].map(([action,glyph,label,disabled]) => `<button type="button" class="icon-button" data-action="universe-${action}" data-index="${index}" aria-label="${label} ${escapeHtml(card?.name || 'Card')}" ${disabled ? 'disabled' : ''}>${icon(glyph)}</button>`).join('')}</div></div>`;
    }).join('') || '<p class="field-help">No Cards selected. The display shows the world until you add Cards.</p>';
    const plugins = [...new Map(library.map(card => [card.pluginId, card.plugin])).entries()];
    dialog.querySelector('#universe-library').innerHTML = `<div class="library-categories">${[['all','All'], ...plugins.map(([id, label]) => ['plugin:' + id, label])].map(([id,label]) => `<button type="button" class="category-chip" data-action="universe-category" data-category="${id}" aria-pressed="${this.category === id}">${escapeHtml(label)}</button>`).join('')}</div><div class="library-actions">${library.filter(card => (this.category === 'all' || 'plugin:' + card.pluginId === this.category) && `${card.name} ${card.plugin}`.toLowerCase().includes(this.search.toLowerCase())).map(card => {
      const selected = this.draft.cards.some(item => item.pluginId === card.pluginId && item.cardId === card.cardId);
      return `<button type="button" class="library-action" data-action="universe-add" data-plugin="${card.pluginId}" data-card="${card.cardId}" ${selected || this.draft.cards.length >= 40 ? 'disabled' : ''}>${icon('layer-group')}<span><strong>${escapeHtml(card.name)}</strong><small>${escapeHtml(card.plugin)}${card.unavailable ? ' · '+escapeHtml(card.unavailable) : ''}${selected ? ' · Added' : ''}</small></span>${icon('plus')}</button>`;
    }).join('') || '<p class="field-help">No matching ready-made Cards.</p>'}</div>`;
  },
  async handleAction(action, control) {
    if (action === 'universe-edit') return this.open();
    if (!this.draft || !dialog.open) return;
    const index = Number(control.dataset.index), cards = this.draft.cards;
    if (action === 'universe-category') this.category = control.dataset.category;
    if (action === 'universe-add' && cards.length < 40 && !cards.some(item => item.pluginId === control.dataset.plugin && item.cardId === control.dataset.card)) cards.push({ pluginId: control.dataset.plugin, cardId: control.dataset.card });
    if (action === 'universe-remove') cards.splice(index, 1);
    if (action === 'universe-up' && index > 0) [cards[index-1],cards[index]] = [cards[index],cards[index-1]];
    if (action === 'universe-down' && index < cards.length-1) [cards[index+1],cards[index]] = [cards[index],cards[index+1]];
    this.refresh();
  },
  async submit(form) {
    const button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    try { await mutate('api/universe', this.readDraft()); closeDialog(); renderView(); notify('Universe settings saved'); }
    catch (error) { const box = form.querySelector('#form-error'); box.textContent = error.message; box.hidden = false; }
    finally { if (button) button.disabled = false; }
  }
};
document.addEventListener('input', event => {
  if (event.target.id !== 'universe-search') return;
  UniverseUI.search = event.target.value; UniverseUI.refresh();
});
