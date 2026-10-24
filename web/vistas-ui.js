/** Administrator Vista composition. Layout definitions reference the plugin
 * card library; editing and preview never execute actions or modify cards.
 */
const VistaUI = {
  draft: null,
  preview: null,
  fitFrame: null,
  pending: false,
  tvPending: false,
  tab: 'layout',
  splitPreview: false,
  selectedNodeId: null,
  librarySearch: '',
  libraryCategory: 'all',
  targetId: null,
  insertion: 'end',
  expanded: new Set(),
  libraryMarkup: {},
  animations: { none: 'None', random: 'Random', fade: 'Fade', 'slide-left': 'Slide left', 'slide-right': 'Slide right', 'slide-up': 'From bottom', 'slide-down': 'From top', zoom: 'Zoom', flip: 'Flip' },

  newNode(type) {
    const node = { id: crypto.randomUUID(), type, name: { row: 'Row', column: 'Column', card: 'Card', collection: 'Card collection' }[type], enabled: true, width: '1fr', height: '1fr' };
    const names = new Set();
    const visit = item => {if (!item) return; names.add(item.name); (item.children || []).forEach(visit);};
    visit(this.draft?.layout);
    const base = node.name; let number = 1;
    while (names.has(`${base} ${number}`)) number++;
    node.name = `${base} ${number}`;
    if (['row', 'column'].includes(type)) node.children = [];
    else {
      // Collections begin empty. Cards are explicitly chosen from the library,
      // rather than silently populating a new block with the first plugin card.
      node.cards = [];
      if (type === 'collection') Object.assign(node, { rotation: 'interval', intervalSeconds: 10, animation: 'fade', durationMs: 500 });
    }
    return node;
  },

  library() {
    return state.services.flatMap(service => service.cards.map(card => ({ pluginId: service.id, cardId: card.id,
      name: card.name, pluginName: service.name, enabled: card.enabled, pluginEnabled: service.enabled, configured: service.configurationReady,
      unavailable: AdminUX.cardAvailability(service, card),
      icon: card.icon === 'inherit' ? service.icon : card.icon === 'none' ? 'id-card' : card.icon,
      label: `${service.name} · ${card.name}${card.enabled ? '' : ' (disabled)'}` })));
  },

  targets(node = this.draft.layout, path = '', position = '1') {
    const label = path ? `${path} / ${position} ${node.name}` : `${position} ${node.name}`;
    const current = ['row', 'column', 'collection'].includes(node.type) ? [{ id: node.id, name: `${label} (${node.type === 'collection' ? 'Collection' : node.type === 'row' ? 'Row' : 'Column'})` }] : [];
    return current.concat((node.children || []).flatMap((child,index) => this.targets(child, label, `${position}.${index+1}`)));
  },

  nodePath(id, node = this.draft.layout, position = '1') {
    if (node.id === id) return position;
    return (node.children || []).map((child,index) => this.nodePath(id,child,`${position}.${index+1}`)).find(Boolean) || '';
  },

  layoutMap(node = this.draft.layout, position = '1') {
    return `<div class="vista-map-node vista-map-${node.type}" data-live-key="map:${escapeHtml(node.id)}"><button type="button" data-action="vista-map-select" data-id="${escapeHtml(node.id)}" aria-pressed="${this.selectedNodeId===node.id}" title="${escapeHtml(node.width+' × '+node.height)}">${escapeHtml(position+' '+node.name)}${node.enabled ? '' : ' · Disabled'}</button>${node.children?.length ? `<div class="vista-map-children">${node.children.map((child,index)=>this.layoutMap(child,`${position}.${index+1}`)).join('')}</div>` : ''}</div>`;
  },

  target() {
    const selected = this.find(this.targetId)?.node;
    if (selected && ['row', 'column', 'collection'].includes(selected.type)) return selected;
    this.targetId = this.draft.layout.id;
    return this.draft.layout;
  },

  renderLibrary() {
    return `<aside class="action-library vista-card-library" aria-label="Card library"><h3>Card library</h3>
      <label class="library-search">${icon('magnifying-glass')}<input id="vista-card-search" type="search" aria-label="Search cards" placeholder="Search cards"></label>
      <label class="library-filter">Source<select id="vista-card-filter"><option value="all">All cards and layouts</option><option value="layout">Layout blocks</option>${state.services.map(plugin => `<option value="plugin:${escapeHtml(plugin.id)}">${escapeHtml(plugin.name)}</option>`).join('')}</select></label>
      <label class="library-insertion">Add to<select id="vista-library-target" aria-label="Add to"></select></label>
      <label class="library-insertion">Add as<select id="vista-library-insertion" aria-label="Add as"></select></label>
      <p class="library-destination" id="vista-library-destination" aria-live="polite"></p><div id="vista-library-items"></div></aside>`;
  },

  libraryRows() {
    const target = this.target(), search = this.librarySearch.trim().toLowerCase();
    const layouts = [
      { type: 'collection', name: 'Card collection', icon: 'layer-group', description: 'Switch between cards in one space.' },
      { type: 'row', name: 'Row', icon: 'grip-lines', description: 'Arrange blocks horizontally.' },
      { type: 'column', name: 'Column', icon: 'grip-lines-vertical', description: 'Arrange blocks vertically.' },
    ];
    const layoutRows = ['all', 'layout'].includes(this.libraryCategory) ? layouts.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(search)).map(item =>
      `<button class="library-action" type="button" data-action="vista-library-layout" data-type="${item.type}" aria-label="Add ${item.name}" ${target.type === 'collection' ? 'disabled' : ''}><span class="task-block-icon server">${icon(item.icon)}</span><span><strong>${item.name}</strong><small>${item.description}</small></span>${icon('plus')}</button>`) : [];
    const cardRows = this.library().filter(card => (this.libraryCategory === 'all' || this.libraryCategory === `plugin:${card.pluginId}`)
      && `${card.name} ${card.pluginName}`.toLowerCase().includes(search)).map(card => {
      const alreadyAdded = target.type === 'collection' && target.cards.some(member => member.pluginId === card.pluginId && member.cardId === card.cardId);
      const reason = alreadyAdded ? 'Already added to this collection' : card.unavailable;
      return `<button class="library-action" type="button" data-action="vista-library-card" data-plugin="${escapeHtml(card.pluginId)}" data-id="${escapeHtml(card.cardId)}" aria-label="Add ${escapeHtml(card.name)}" ${alreadyAdded ? 'disabled' : ''}><span class="task-block-icon server">${icon(card.icon)}</span><span><strong>${escapeHtml(card.name)}</strong><span class="library-owner">${escapeHtml(card.pluginName)}</span>${reason ? `<small class="library-unavailable">${escapeHtml(reason)}</small>` : ''}</span>${icon('plus')}</button>`;
    });
    return layoutRows.concat(cardRows).join('') || '<div class="empty-state">No cards found.</div>';
  },

  refreshLibrary() {
    const library = dialog.querySelector('.vista-card-library');
    if (!library) return;
    const target = this.target();
    const filter = library.querySelector('#vista-card-filter');
    if (filter) filter.value = this.libraryCategory;
    const destination = library.querySelector('#vista-library-destination');
    if (destination) destination.textContent = `Adding to: ${this.targets().find(item => item.id === target.id)?.name || target.name}`;
    const targetSelect = library.querySelector('#vista-library-target');
    const targetOptions = this.targets().map(item => `<option value="${item.id}" ${item.id === target.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
    // Compare markup before replacing it: steady data polling must not remove
    // focused library buttons or reset a user's search/caret.
    if (this.libraryMarkup.targets !== targetOptions) { targetSelect.innerHTML = targetOptions; this.libraryMarkup.targets = targetOptions; }
    const contents = target.type === 'collection' ? target.cards : target.children;
    const singular = target.type === 'collection' ? 'card' : 'item';
    const positions = [['end', `Last ${singular}`], ['first', `First ${singular}`], ...contents.map((item, index) => [`after:${item.id || `${item.pluginId}/${item.cardId}`}`, `${singular === 'card' ? 'Card' : 'Item'} ${index + 2}`])];
    if (!positions.some(([id]) => id === this.insertion)) this.insertion = 'end';
    const insertionSelect = library.querySelector('#vista-library-insertion');
    const insertionOptions = positions.map(([id, label]) => `<option value="${id}" ${id === this.insertion ? 'selected' : ''}>${label}</option>`).join('');
    if (this.libraryMarkup.positions !== insertionOptions) { insertionSelect.innerHTML = insertionOptions; this.libraryMarkup.positions = insertionOptions; }
    library.querySelectorAll('[data-action="vista-library-filter"]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.id === this.libraryCategory)));
    const items = library.querySelector('#vista-library-items'), rows = this.libraryRows();
    if (this.libraryMarkup.items !== rows) { items.innerHTML = rows; this.libraryMarkup.items = rows; }
  },

  insert(target, item) {
    const contents = target.type === 'collection' ? target.cards : target.children;
    const anchor = this.insertion.startsWith('after:') ? this.insertion.slice(6) : null;
    const anchorIndex = anchor ? contents.findIndex(item => (item.id || `${item.pluginId}/${item.cardId}`) === anchor) : -1;
    const index = this.insertion === 'first' ? 0 : anchorIndex >= 0 ? anchorIndex + 1 : contents.length;
    contents.splice(index, 0, item);
  },

  tvLaunchAvailability() {
    const service = state.services.find(service => service.id === 'samsung-tv');
    const action = service?.actions?.find(action => action.id === 'launch-app');
    const reason = this.tvPending ? 'Sending to TV…' : state.paused ? 'Enable server functions first.'
      : !service?.enabled || !action?.available ? action?.unavailableReason || 'Configure and enable Samsung TV first.'
      : !state.server?.lanAddress ? 'Configure a LAN server address first.' : '';
    return { service, reason };
  },

  async openOnTv(vista) {
    if (this.tvPending) return;
    const { service, reason } = this.tvLaunchAvailability();
    if (!vista?.enabled || reason) return notify(reason || 'Enable this Vista first.');
    // The server supplies the reachable LAN origin. Opening an own-URL Vista
    // never changes the shared display selection or creates a saved Task.
    const url = `${state.server.lanAddress}/vistas/${vista.slug}`;
    const revision = service.config.revision;
    this.tvPending = true;
    renderView();
    try {
      await mutate('api/plugins/samsung-tv/actions/launch-app', { revision,
        parameters: { id: 'HwGlance01.HomeGlance', mode: 'DEEP_LINK', arguments: url } });
      notify('Vista sent to the TV. Check its display.');
    } catch (error) {
      notify(`${error.message} No launch was retried.`);
    } finally {
      this.tvPending = false;
      renderView();
    }
  },

  render() {
    const selected = state.vistas?.find(vista => vista.id === state.vistaDisplay?.vistaId);
    const tv = this.tvLaunchAvailability();
    return pageHeading('Vistas', 'Layouts for end-user displays', `<button class="button primary" data-action="vista-add">${icon('plus')}Add Vista</button>`) +
      `<section class="panel vista-display-panel"><div class="panel-header"><h2>${icon('display')}End-user display</h2><a class="button" href="display" target="_blank" rel="noopener">${icon('arrow-up-right-from-square')}Open shared /display</a></div><div class="panel-body"><p>${selected?.enabled ? escapeHtml(selected.name) : 'No enabled Vista selected'} · /display</p><p class="field-help">Use on shared display changes /display for everyone. Open this Vista only opens its own URL. Tasks → Server → Show Vista can change it using Timer, Interval, Schedule or Event rules. All open display pages follow the same selection.</p></div></section>` +
      `<section class="panel"><div class="panel-header"><h2>Vistas <span class="panel-count">${state.vistas?.length || 0}</span></h2></div>${state.vistas?.length ? state.vistas.map(vista => `<div class="settings-item" data-live-key="vista:${escapeHtml(vista.id)}"><span class="service-icon">${icon('table-cells-large')}</span><div class="settings-text"><h3>${escapeHtml(vista.name)}</h3><p>/vistas/${escapeHtml(vista.slug)}</p></div>${state.vistaDisplay?.vistaId === vista.id ? '<span class="selected-display-marker">Selected for /display</span>' : ''}<button class="button" data-action="vista-show" data-id="${vista.id}" ${vista.enabled && state.vistaDisplay?.vistaId !== vista.id ? '' : 'disabled'}>${icon('display')}Use on shared display</button><button class="button" data-action="vista-open" data-id="${vista.id}" ${vista.enabled ? '' : 'disabled'}>${icon('arrow-up-right-from-square')}Open this Vista</button><button class="button" data-action="vista-tv" data-id="${vista.id}" title="${escapeHtml(!vista.enabled ? 'Enable this Vista first.' : tv.reason || 'Open this Vista on the TV without changing /display.')}" ${vista.enabled && !tv.reason ? '' : 'disabled'}>${icon('display')}Open on TV</button>${itemActions(vista, 'vista')}</div>`).join('') : '<div class="empty-state">No Vistas. Add a Vista to arrange cards.</div>'}</section>`;
  },

  find(id, node = this.draft?.layout, parent = null) {
    if (!node) return null;
    if (node.id === id) return { node, parent };
    for (const child of node.children || []) {
      const found = this.find(id, child, node);
      if (found) return found;
    }
    return null;
  },

  copyNode(node) {
    const copy = structuredClone(node);
    function identities(item) { item.id = crypto.randomUUID(); (item.children || []).forEach(identities); }
    identities(copy);
    copy.enabled = false;
    return copy;
  },

  input(label, property, value, type = 'text', extra = '') {
    const glyph = { name: 'tag', width: 'arrows-left-right', height: 'arrows-up-down', gap: 'arrows-left-right', padding: 'expand', intervalSeconds: 'clock', durationMs: 'stopwatch' }[property] || 'sliders';
    return `<label class="field"><span class="field-label">${icon(glyph)}${escapeHtml(label)}</span><input data-vista-property="${property}" type="${type}" value="${escapeHtml(value)}" ${extra}></label>`;
  },

  sizePresets(node, property) {
    const options = [['1fr', 'Fill available space'], ['50%', 'Half (50%)'], ['33.333%', 'Third (33%)'], ['25%', 'Quarter (25%)'], ['240px', '240 pixels'], ['480px', '480 pixels']];
    return `<label class="field"><span class="field-label">${property === 'width' ? 'Width' : 'Height'} preset</span><select data-vista-size-preset="${property}"><option value="">Custom size</option>${options.map(([value, label]) => `<option value="${value}" ${node[property] === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
  },

  selectCard(reference, index, total) {
    const selected = reference ? `${reference.pluginId}/${reference.cardId}` : '';
    const choices = this.library();
    if (selected && !choices.some(card => `${card.pluginId}/${card.cardId}` === selected)) choices.push({ ...reference, label: 'Unavailable card' });
    return `<div class="vista-member"><label class="field"><span class="field-label">${icon('id-card')}Card ${index + 1}</span><select data-vista-member="${index}"><option value="">Select card</option>${choices.map(card => `<option value="${card.pluginId}/${card.cardId}" ${`${card.pluginId}/${card.cardId}` === selected ? 'selected' : ''}>${escapeHtml(card.label)}</option>`).join('')}</select></label><div class="row-actions"><button class="icon-button" type="button" data-action="vista-member-up" data-index="${index}" aria-label="Move card ${index + 1} up" ${index === 0 ? 'disabled' : ''}>${icon('arrow-up')}</button><button class="icon-button" type="button" data-action="vista-member-down" data-index="${index}" aria-label="Move card ${index + 1} down" ${index >= total - 1 ? 'disabled' : ''}>${icon('arrow-down')}</button><button class="icon-button delete" type="button" data-action="vista-member-delete" data-index="${index}" aria-label="Remove card ${index + 1}">${icon('trash-can')}</button></div></div>`;
  },

  nodeControls(node, root) {
    const siblings = this.find(node.id)?.parent?.children || [];
    const index = siblings.indexOf(node);
    const controls = [['edit', 'Edit', 'pen', false]];
    if (!root) controls.push(['up', 'Move', 'arrow-up', index <= 0], ['down', 'Move', 'arrow-down', index >= siblings.length - 1], ['copy', 'Copy', 'copy', false], ['delete', 'Delete', 'trash-can', false]);
    return controls.map(([action, verb, glyph, disabled]) => `<button class="icon-button ${action === 'delete' ? 'delete' : ''}" type="button" data-action="vista-node-${action}" aria-label="${escapeHtml(`${verb} ${node.name}${['up', 'down'].includes(action) ? ' ' + action : ''}`)}" ${action === 'edit' ? `aria-expanded="${this.expanded.has(node.id)}"` : ''} ${disabled ? 'disabled' : ''}>${icon(glyph)}</button>`).join('') +
      `<button class="switch" type="button" role="switch" aria-checked="${node.enabled}" data-action="vista-node-toggle" aria-label="${escapeHtml(node.name)} enabled"></button>`;
  },

  nodeSummary(node, root = false) {
    const sizes = root ? '' : `${node.width} × ${node.height} · `;
    if (node.children) return `${sizes}${node.type === 'row' ? 'Horizontal' : 'Vertical'} · ${node.children.length} item${node.children.length === 1 ? '' : 's'}`;
    if (node.type === 'collection') return `${sizes}${node.cards.length} card${node.cards.length === 1 ? '' : 's'} · ${node.rotation === 'update' ? 'On card update' : `Every ${node.intervalSeconds}s${node.rotation === 'both' ? ' or on update' : ''}`} · ${this.animations[node.animation] || node.animation}`;
    const reference = node.cards[0];
    const card = reference && this.library().find(card => card.pluginId === reference.pluginId && card.cardId === reference.cardId);
    return `${sizes}${card?.label || (reference ? 'Unavailable card' : 'No card selected')}${card?.unavailable ? ' · '+card.unavailable : ''}`;
  },

  memberRows(node) {
    return node.cards.map((reference, index) => {
      const card = this.library().find(card => card.pluginId === reference.pluginId && card.cardId === reference.cardId);
      return `<div class="vista-member-block"><span class="task-block-icon server">${icon(card?.icon || 'id-card')}</span><span class="vista-member-title"><strong>${escapeHtml(card?.name || 'Unavailable card')}</strong><small>${escapeHtml(card?.pluginName || reference.pluginId)}${card?.unavailable ? ' · '+escapeHtml(card.unavailable) : ''}</small></span><div class="row-actions"><button class="icon-button" type="button" data-action="vista-member-up" data-index="${index}" aria-label="Move card ${index + 1} up" ${index === 0 ? 'disabled' : ''}>${icon('arrow-up')}</button><button class="icon-button" type="button" data-action="vista-member-down" data-index="${index}" aria-label="Move card ${index + 1} down" ${index === node.cards.length - 1 ? 'disabled' : ''}>${icon('arrow-down')}</button><button class="icon-button delete" type="button" data-action="vista-member-delete" data-index="${index}" aria-label="Remove card ${index + 1}">${icon('trash-can')}</button></div></div>`;
    }).join('') || '<p class="vista-empty-members">No cards. Unavailable members keep their place and show their status.</p>';
  },

  nodeEditor(node, root = false) {
    const container = ['row', 'column'].includes(node.type);
    const glyph = container ? (node.type === 'row' ? 'grip-lines' : 'grip-lines-vertical') : node.type === 'collection' ? 'layer-group' : 'id-card';
    const selected = this.targetId === node.id;
    return `<section class="vista-node-editor ${selected ? 'vista-add-target' : ''} ${this.selectedNodeId === node.id ? 'vista-selected-node' : ''}" data-vista-node="${node.id}">
      <div class="vista-node-heading task-block-header"><span class="task-block-icon server">${icon(glyph)}</span><strong><small class="vista-node-position">${escapeHtml(this.nodePath(node.id))}</small> ${escapeHtml(node.name)}</strong><div class="row-actions">${this.nodeControls(node, root)}</div></div>
      <div class="vista-block-description"><button class="task-block-summary" type="button" data-action="vista-node-edit" aria-expanded="${this.expanded.has(node.id)}">${escapeHtml(this.nodeSummary(node, root))}</button>${container || node.type === 'collection' ? `<button class="text-button vista-add-here" type="button" data-action="vista-library-target" aria-pressed="${selected}" aria-label="Add to ${escapeHtml(node.name)}">${icon('plus')}Add here</button>` : ''}</div>
      <div class="vista-node-properties task-block-fields" ${this.expanded.has(node.id) ? '' : 'hidden'}>
        <div class="field-row">${this.input('Item name', 'name', node.name)}${container ? `<label class="field"><span class="field-label">${icon('grip-lines')}Direction</span><select data-vista-property="type"><option value="row" ${node.type === 'row' ? 'selected' : ''}>Row</option><option value="column" ${node.type === 'column' ? 'selected' : ''}>Column</option></select></label>` : ''}</div>
        ${root ? '' : `<div class="field-row">${this.sizePresets(node, 'width')}${this.sizePresets(node, 'height')}</div><div class="field-row">${this.input('Width', 'width', node.width)}${this.input('Height', 'height', node.height)}</div><p class="field-help">Custom sizes: %, px, rem, em, vw, vh, vmin, vmax, fr, or auto. Fill shares remaining space along the parent’s direction.</p>`}
        ${node.type === 'card' ? this.selectCard(node.cards[0], 0, 1) : ''}
        ${node.type === 'collection' ? `<div class="field-row"><label class="field"><span class="field-label">${icon('arrows-rotate')}Switch cards</span><select data-vista-property="rotation"><option value="interval" ${node.rotation === 'interval' ? 'selected' : ''}>On interval</option><option value="update" ${node.rotation === 'update' ? 'selected' : ''}>On card update</option><option value="both" ${node.rotation === 'both' ? 'selected' : ''}>On interval or update</option></select></label>${this.input('Interval (seconds)', 'intervalSeconds', node.intervalSeconds, 'number', 'min="1" max="86400" step="any"')}</div><div class="field-row"><label class="field"><span class="field-label">${icon('wand-magic-sparkles')}Transition</span><select data-vista-property="animation">${Object.entries(this.animations).map(([key, label]) => `<option value="${key}" ${node.animation === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${this.input('Transition (ms)', 'durationMs', node.durationMs, 'number', 'min="0" max="5000" step="1"')}</div>` : ''}
      </div>
      ${container ? `<div class="vista-node-children">${node.children.map(child => this.nodeEditor(child)).join('')}</div>` : node.type === 'collection' ? `<div class="vista-collection-members">${this.memberRows(node)}</div>` : ''}
    </section>`;
  },

  openEditor(id, copy = false) {
    const existing = state.vistas?.find(vista => vista.id === id);
    this.draft = existing ? structuredClone(existing) : { schemaVersion: 1, name: '', slug: '', enabled: false, gap: 16, padding: 16, layout: this.newNode('column') };
    // Canvas is the initial root's user-facing name. Keep ordinary columns and
    // existing or copied layouts' saved names intact.
    if (!existing) this.draft.layout.name = 'Canvas';
    if (copy) { this.draft.name += ' copy'; this.draft.slug += '-copy'; this.draft.enabled = false; this.draft.layout = this.copyNode(this.draft.layout); this.draft.layout.enabled = true; }
    this.preview?.destroy();
    this.tab = 'layout';
    this.splitPreview = false;
    this.librarySearch = ''; this.libraryCategory = 'all'; this.insertion = 'end';
    this.targetId = this.draft.layout.id;
    this.selectedNodeId = this.targetId;
    this.expanded = new Set(); this.libraryMarkup = {};
    showDialog(`<form id="vista-editor-form">${dialogHeader(existing ? `${copy ? 'Copy' : 'Edit'} Vista` : 'Add Vista')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>
      <div class="field-row vista-identity">${formField('Vista name', 'tag', `<input name="vistaName" required maxlength="64" value="${escapeHtml(this.draft.name)}">`)}<label class="check-field"><span>Vista enabled</span><button type="button" class="switch" role="switch" aria-label="Vista enabled" aria-checked="${this.draft.enabled}" data-action="vista-enabled"></button></label></div>
      <details class="editor-help"><summary>URL and spacing</summary><div class="field-row">${formField('URL name', 'link', `<input name="vistaSlug" required maxlength="64" pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${escapeHtml(this.draft.slug)}">`, '/vistas/ followed by this name.')}${this.input('Gap (px)', 'gap', this.draft.gap, 'number', 'min="0" max="80"')}${this.input('Padding (px)', 'padding', this.draft.padding, 'number', 'min="0" max="80"')}</div></details>
      <div class="tabs" role="tablist" aria-label="Vista editor"><button id="vista-layout-tab" class="tab" type="button" role="tab" aria-controls="vista-layout-panel" aria-selected="true" tabindex="0" data-action="vista-tab" data-tab="layout">${icon('table-cells')}Layout</button><button id="vista-preview-tab" class="tab" type="button" role="tab" aria-controls="vista-preview-panel" aria-selected="false" tabindex="-1" data-action="vista-tab" data-tab="preview">${icon('eye')}Preview</button></div><label class="check-field vista-preview-option"><input id="vista-split-preview" type="checkbox">Show preview alongside layout</label>
      <p id="vista-fit-warning" class="field-help evidence-error" role="status" hidden></p><div class="vista-editing-panels"><section id="vista-layout-panel" role="tabpanel" aria-label="Layout"><div class="task-designer vista-designer"><div class="task-canvas"><h3 class="vista-layout-title">Layout editor</h3><p class="field-help vista-layout-instructions">Start by adding cards or layout blocks from the library. <strong>Add here</strong> selects their destination. <strong>Edit</strong> changes sizes and settings; <strong>Preview</strong> shows the result.</p><details class="editor-help"><summary>Layout map</summary><p class="field-help">Select a region to edit it. Containers also become the insertion destination. This is a schematic; use Preview for exact sizes.</p><div id="vista-layout-map" class="vista-layout-map"></div></details><div id="vista-layout-tree">${this.nodeEditor(this.draft.layout, true)}</div></div>${this.renderLibrary()}</div></section><section id="vista-preview-panel" role="tabpanel" aria-label="Preview" hidden><div id="vista-preview" class="vista-stage vista-admin-preview"></div></section></div></div>${dialogFooter(existing && !copy ? 'Save changes' : 'Create Vista')}</form>`, { kind: 'vista', id: existing?.id, copy, revision: existing?.revision });
    this.preview = VistaRenderer.create(dialog.querySelector('#vista-preview'));
    this.updatePreview();
  },

  readDraft() { return structuredClone(this.draft); },

  updatePreview() {
    if (!dialog.open || dialogContext?.kind !== 'vista' || !this.preview) return;
    this.refreshLibrary();
    const map = dialog.querySelector('#vista-layout-map'), mapMarkup=this.layoutMap();
    if (map && this.libraryMarkup.map !== mapMarkup) {map.innerHTML=mapMarkup; this.libraryMarkup.map=mapMarkup;}
    const cards = state.services.flatMap(service => service.cards.filter(card => card.enabled).map(card => ({ pluginId: service.id, cardId: card.id, card, catalog: service.cardCatalog, data: service.cardData })));
    // Invalid intermediate sizing should not inject CSS or destroy a working
    // preview. Server validation remains authoritative on Save.
    const draft = this.readDraft();
    function safe(node) {
      for (const size of ['width', 'height']) if (!/^(?:auto|(?:\d+(?:\.\d+)?|\.\d+)(?:%|px|rem|em|vw|vh|vmin|vmax|fr))$/.test(node[size])) node[size] = '1fr';
      (node.children || []).forEach(safe);
    }
    safe(draft.layout);
    this.preview.update({ vista: draft, cards, options: { theme: config.theme, fontScale: config.vistaFontScale, timeZone: state.server.timeZone, timeFormat: config.timeFormat, now: state.server.now, connected: serverClockConnected } });
    dialog.querySelectorAll('#vista-preview [data-node-id]').forEach(element => element.classList.toggle('vista-preview-selected', element.dataset.nodeId === this.selectedNodeId));
    dialog.querySelectorAll('[data-vista-node]').forEach(element => element.classList.toggle('vista-selected-node', element.dataset.vistaNode === this.selectedNodeId));
    cancelAnimationFrame(this.fitFrame);
    this.fitFrame=requestAnimationFrame(()=>{
      this.fitFrame=null;
      if(dialog.open && dialogContext?.kind==='vista')this.reportFit();
    });
  },

  reportFit() {
    const warnings=[];
    for(const frame of dialog.querySelectorAll('#vista-preview iframe[data-ready-card]')) {
      if(!frame.clientWidth || !frame.clientHeight)continue;
      try {
        const document=frame.contentDocument, region=document?.querySelector('.content');
        if(region && (region.scrollHeight>region.clientHeight+2 || region.scrollWidth>region.clientWidth+2))warnings.push(frame.title);
      } catch { /* An unloaded frame has no measurable layout yet. */ }
    }
    const notice=dialog.querySelector('#vista-fit-warning');if(!notice)return;
    AdminDOM.text(notice,warnings.length?`Visible Cards need scrolling at this preview size: ${warnings.join(', ')}. Use a larger region or fewer details for a TV. This browser preview does not qualify the TV fallback layout.`:'');
    notice.hidden=!warnings.length;
  },

  refreshTree(focusId, focus = true) {
    this.target(); // A deleted destination falls back to the root.
    if (!this.find(this.selectedNodeId)) this.selectedNodeId = this.targetId;
    dialog.querySelector('#vista-layout-tree').innerHTML = this.nodeEditor(this.draft.layout, true);
    const target = dialog.querySelector(`[data-vista-node="${focusId}"] > .vista-node-heading button`);
    if (focus) target?.focus({ preventScroll: true });
    this.updatePreview();
  },

  setExpanded(block, open) {
    const id = block.dataset.vistaNode;
    if (open) this.expanded.add(id);
    else this.expanded.delete(id);
    block.querySelector('.vista-node-properties').hidden = !open;
    block.querySelectorAll(':scope > .vista-node-heading [data-action="vista-node-edit"], :scope > .vista-block-description [data-action="vista-node-edit"]').forEach(button => button.setAttribute('aria-expanded', String(open)));
  },

  onInput(control) {
    if (control.id === 'vista-card-search') {
      this.librarySearch = control.value; this.refreshLibrary(); return;
    }
    if (control.id === 'vista-library-target') {
      this.targetId = control.value; this.selectedNodeId = this.targetId; this.insertion = 'end'; this.refreshTree(this.targetId, false); return;
    }
    if (control.id === 'vista-card-filter') { this.libraryCategory = control.value; this.refreshLibrary(); return; }
    if (control.id === 'vista-split-preview') { this.splitPreview = control.checked; this.updatePanels(); return; }
    if (control.id === 'vista-library-insertion') { this.insertion = control.value; return; }
    if (control.name === 'vistaName') this.draft.name = control.value;
    if (control.name === 'vistaSlug') this.draft.slug = control.value;
    const nodeId = control.closest('[data-vista-node]')?.dataset.vistaNode;
    const node = nodeId ? this.find(nodeId)?.node : this.draft;
    if (nodeId) this.selectedNodeId = nodeId;
    if (control.dataset.vistaSizePreset) {
      const size = control.dataset.vistaSizePreset;
      if (control.value) {
        node[size] = control.value; this.refreshTree(node.id, false);
        dialog.querySelector(`[data-vista-node="${node.id}"] > .vista-node-properties [data-vista-size-preset="${size}"]`)?.focus({preventScroll: true});
      }
      return;
    }
    if (control.dataset.vistaProperty) {
      const property = control.dataset.vistaProperty;
      node[property] = ['gap', 'padding', 'durationMs', 'intervalSeconds'].includes(property) ? Number(control.value) : control.value;
      if (['width', 'height'].includes(property)) {
        const preset = control.closest('.vista-node-properties').querySelector(`[data-vista-size-preset="${property}"]`);
        preset.value = [...preset.options].some(option => option.value === control.value) ? control.value : '';
      }
    }
    if (control.dataset.vistaMember !== undefined) {
      const index = Number(control.dataset.vistaMember);
      const [pluginId, cardId] = control.value.split('/');
      if (pluginId && cardId) node.cards[index] = { pluginId, cardId };
      else {
        node.cards.splice(index, 1);
        // Removing a member changes subsequent indexes. Rebuild the controls
        // once so later selection edits cannot target an old array position.
        this.refreshTree(node.id);
        return;
      }
    }
    if (control.dataset.vistaProperty === 'name') {
      const heading = control.closest('.vista-node-editor').querySelector('.vista-node-heading');
      heading.querySelector('strong').innerHTML = `<small class="vista-node-position">${escapeHtml(this.nodePath(node.id))}</small> ${escapeHtml(node.name)}`;
      heading.querySelector('.row-actions').innerHTML = this.nodeControls(node, !this.find(node.id).parent);
    }
    if (nodeId) {
      const block = control.closest('.vista-node-editor');
      block.querySelector('.task-block-summary').textContent = this.nodeSummary(node, !this.find(node.id).parent);
    }
    this.updatePreview();
  },

  updatePanels() {
    dialog.classList.toggle('wide-preview', this.tab === 'layout' && this.splitPreview);
    dialog.querySelector('.vista-editing-panels').classList.toggle('with-preview', this.tab === 'layout' && this.splitPreview);
    dialog.querySelector('#vista-layout-panel').hidden = this.tab !== 'layout';
    dialog.querySelector('#vista-preview-panel').hidden = this.tab !== 'preview' && !this.splitPreview;
    this.updatePreview();
  },

  async submit(form) {
    const values = this.readDraft(), context = { ...dialogContext };
    const isNew = !context.id || context.copy;
    if (!isNew) values.revision = context.revision;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true; this.pending = true;
    try {
      await mutate(`api/vistas${isNew ? '' : '/' + context.id}`, values);
      closeDialog(); renderView(); restoreRowFocus(); notify('Vista saved');
    } catch (error) { button.disabled = false; showFormError(error.message); }
    finally { this.pending = false; }
  },

  async handleAction(action, id, control) {
    if (action === 'vista-add') return this.openEditor();
    if (action === 'vista-map-select') {
      const found=this.find(id); if(!found)return;
      this.selectedNodeId=id;
      this.targetId=['row','column','collection'].includes(found.node.type)?id:found.parent?.id || this.draft.layout.id;
      this.expanded.add(id); this.refreshTree(id,false);
      const block=dialog.querySelector(`[data-vista-node="${id}"]`);
      block?.querySelector('[data-action="vista-node-edit"]')?.focus({preventScroll:true});
      block?.scrollIntoView({block:'center'}); return;
    }
    if (action === 'edit-vista' || action === 'copy-vista') return this.openEditor(id, action === 'copy-vista');
    if (action === 'vista-library-filter') {
      this.libraryCategory = id; this.refreshLibrary(); return;
    }
    if (action === 'vista-library-target') {
      this.targetId = control.closest('[data-vista-node]').dataset.vistaNode; this.selectedNodeId = this.targetId;
      this.insertion = 'end'; this.refreshTree(this.targetId); return;
    }
    if (action === 'vista-library-layout') {
      const target = this.target();
      if (target.type === 'collection') return showFormError('Choose a row or column to add layout blocks.');
      const node = this.newNode(control.dataset.type);
      this.insert(target, node);
      // A new collection/row/column becomes the destination so subsequent card
      // clicks populate that block immediately. Selection is editor-only state.
      this.targetId = node.id; this.selectedNodeId = node.id; this.insertion = 'end';
      this.refreshTree(node.id); return;
    }
    if (action === 'vista-library-card') {
      const card = this.library().find(card => card.cardId === id && card.pluginId === control.dataset.plugin);
      if (!card) return showFormError('This card is no longer available.');
      const reference = { pluginId: card.pluginId, cardId: card.cardId }, target = this.target();
      if (target.type === 'collection') {
        if (target.cards.some(item => item.pluginId === reference.pluginId && item.cardId === reference.cardId)) return showFormError('This card is already in the collection.');
        if (target.cards.length >= 100) return showFormError('A collection supports up to 100 cards.');
        this.insert(target, reference);
      } else {
        const node = this.newNode('card'); node.name = card.name; node.cards = [reference];
        this.insert(target, node);
        this.selectedNodeId = node.id;
      }
      this.refreshTree(target.id); return;
    }
    if (action === 'vista-tab') {
      this.tab = control.dataset.tab;
      this.updatePanels();
      dialog.querySelectorAll('[data-action="vista-tab"]').forEach(button => {
        button.setAttribute('aria-selected', String(button.dataset.tab === this.tab));
        button.tabIndex = button.dataset.tab === this.tab ? 0 : -1;
      });
      this.updatePreview(); return;
    }
    if (action === 'vista-enabled') {
      this.draft.enabled = !this.draft.enabled;
      control.setAttribute('aria-checked', this.draft.enabled); return;
    }
    if (action.startsWith('vista-node-') || action.startsWith('vista-member-')) {
      const { node, parent } = this.find(control.closest('[data-vista-node]').dataset.vistaNode);
      if (action === 'vista-node-edit') {
        const block = control.closest('.vista-node-editor');
        this.selectedNodeId = node.id; this.updatePreview();
        this.setExpanded(block, !this.expanded.has(node.id));
        return;
      }
      if (action === 'vista-node-toggle') node.enabled = !node.enabled;
      if (parent) {
        const index = parent.children.indexOf(node);
        if (action === 'vista-node-delete') parent.children.splice(index, 1);
        if (action === 'vista-node-copy') parent.children.splice(index + 1, 0, this.copyNode(node));
        if (action === 'vista-node-up' && index > 0) [parent.children[index - 1], parent.children[index]] = [node, parent.children[index - 1]];
        if (action === 'vista-node-down' && index < parent.children.length - 1) [parent.children[index + 1], parent.children[index]] = [node, parent.children[index + 1]];
      }
      const index = Number(control.dataset.index);
      if (action === 'vista-member-delete') node.cards.splice(index, 1);
      if (action === 'vista-member-up' && index > 0) [node.cards[index - 1], node.cards[index]] = [node.cards[index], node.cards[index - 1]];
      if (action === 'vista-member-down' && index < node.cards.length - 1) [node.cards[index + 1], node.cards[index]] = [node.cards[index], node.cards[index + 1]];
      this.refreshTree(action === 'vista-node-delete' ? parent.id : node.id); return;
    }
    if (action === 'vista-confirm-delete') {
      const context = { ...dialogContext };
      await mutate(`api/vistas/${context.id}/delete`, { revision: context.revision });
      closeDialog(); renderView(); notify('Vista deleted'); return;
    }
    const vista = state.vistas.find(vista => vista.id === id);
    if (action === 'vista-show') {
      control.disabled = true;
      try { await mutate('api/display', { vistaId: id, revision: state.vistaDisplay.revision }); renderView(); notify('Display Vista selected'); }
      finally { if (control.isConnected) control.disabled = false; }
    } else if (action === 'vista-tv') {
      return this.openOnTv(vista);
    } else if (action === 'vista-open') {
      // Browser-native navigation preserves the administrator in its own tab.
      window.open(`vistas/${vista.slug}`, '_blank', 'noopener');
    } else if (action === 'toggle-vista') {
      control.disabled = true;
      try { await mutate(`api/vistas/${id}/enabled`, { revision: vista.revision, enabled: !vista.enabled }); }
      finally { if (control.isConnected) control.disabled = false; }
    } else if (action === 'delete-vista') {
      showDialog(`${dialogHeader('Delete Vista')}<div class="dialog-body"><p>Delete ${escapeHtml(vista.name)}? Its URL and layout will be removed. Plugin cards remain available.</p></div><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog">Cancel</button><button type="button" class="button danger" data-action="vista-confirm-delete">Delete</button></div>`, { kind: 'vista-delete', id, revision: vista.revision });
    }
  },
};

document.addEventListener('input', event => {
  if (event.target.closest('#vista-editor-form') && event.target.tagName !== 'SELECT') VistaUI.onInput(event.target);
});
document.addEventListener('change', event => {
  if (event.target.closest('#vista-editor-form') && event.target.tagName === 'SELECT') VistaUI.onInput(event.target);
});

document.addEventListener('invalid', event => {
  if (!event.target.closest('#vista-editor-form')) return;
  const block = event.target.closest('.vista-node-editor');
  // Native numeric validation must be able to focus an invalid field even if
  // its block was collapsed after editing. Reveal it before the browser focuses.
  if (block) VistaUI.setExpanded(block, true);
}, true);

document.addEventListener('keydown', event => {
  if (!event.target.matches('[data-action="vista-tab"]')) return;
  const tabs = [...dialog.querySelectorAll('[data-action="vista-tab"]')];
  const index = tabs.indexOf(event.target);
  const next = { ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault(); tabs[next].click(); tabs[next].focus();
});
