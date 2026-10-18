/** Administrator card definitions. Drafts live in modal forms; live hydration
 * refreshes only their read-only preview, never draft fields or save revisions.
 */
const CardDesigner = {
  pending: false,

  formats(type) {
    return {
      string: [['auto', 'Automatic'], ['text', 'Text'], ['link', 'Link']],
      number: [['auto', 'Automatic'], ['number', 'Decimal number'], ['text', 'Text']],
      boolean: [['auto', 'Automatic'], ['yes-no', 'Yes / No'], ['text', 'True / False']],
      timestamp: [['auto', 'Automatic'], ['datetime', 'Date and time'], ['relative', 'Time ago']],
      log: [['auto', 'Automatic'], ['log', 'Recent log']],
    }[type] || [['auto', 'Automatic']];
  },

  renderCard(card, service) {
    return CardRenderer.render(card, service.cardData, service.cardCatalog, {
      timeZone: state.server.timeZone, timeFormat: config.timeFormat,
      theme: config.theme, fontScale: config.vistaFontScale,
      now: state.server.now, connected: serverClockConnected,
    });
  },

  render(service) {
    this.gallerySignature = JSON.stringify([service.id, service.cards, service.cardCatalog]);
    const cards = service.cards || [];
    const unavailable = service.cardsError || !service.config;
    return `<section class="panel"><div class="panel-header"><h2>Cards <span class="panel-count">${cards.length}</span></h2><div class="heading-actions card-creation-actions">${service.cardTemplates?.length ? `<button type="button" class="button" data-action="card-ready-add" ${unavailable ? 'disabled' : ''}>${icon('wand-magic-sparkles')}Add ready-made card</button>` : ''}<button type="button" class="button primary" data-action="card-add" ${unavailable ? 'disabled' : ''}>${icon('plus')}Add card</button></div></div>
      ${unavailable ? `<div class="form-error" role="alert">${escapeHtml(service.cardsError || 'Plugin data is unavailable.')}</div>` : cards.length ? '<div class="panel-body"><p class="card-manager-help">Design cards for Vistas.</p></div>' : '<div class="empty-state">No cards yet. Add a card and choose the information it displays.</div>'}</section>
      <div class="card-gallery">${cards.map(card => `<section class="card-gallery-item card-preview-${card.size}" data-live-key="card:${escapeHtml(card.id)}"><div class="card-gallery-frame">${this.renderCard(card, service)}</div><div class="card-gallery-controls">${statusPill(card.enabled ? 'Enabled' : 'Disabled', card.enabled ? 'running' : 'paused')}${itemActions(card, 'card')}</div></section>`).join('')}</div>`;
  },

  hydrateGallery(service) {
    const frames = workspace.querySelectorAll('.card-gallery-frame');
    if (!frames.length || this.gallerySignature !== JSON.stringify([service.id, service.cards, service.cardCatalog])) return false;
    service.cards.forEach((card, index) => CardRenderer.mount(frames[index], this.renderCard(card, service)));
    return true;
  },

  select(name, items, value, label, glyphName) {
    return formField(label, glyphName, `<select name="${name}">${items.map(([id, name]) => `<option value="${escapeHtml(id)}" ${id === value ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select>`);
  },

  glyphOptions(inherit, label) {
    return [[inherit, label], ['none', 'No glyph'], ...(state.pluginGlyphs || []).map(glyph => [glyph, glyph.replaceAll('-', ' ')])];
  },

  newField(source) {
    return { id: crypto.randomUUID(), binding: source.id, label: source.label,
      enabled: true, icon: 'auto', format: 'auto', unit: '', decimals: 0 };
  },

  switchControl(name, label, value) {
    return `<div class="card-option"><input type="hidden" name="${name}" value="${value}"><label for="card-option-${name}">${label}</label><button id="card-option-${name}" type="button" class="switch" role="switch" aria-checked="${value}" aria-label="${label}" data-action="card-option-toggle" data-option="${name}"></button></div>`;
  },

  listControls(card, service) {
    const tables = service.cardCatalog.filter(source => source.type === 'table');
    const source = tables.find(source => source.id === card.fields[0]?.binding) || tables[0];
    const settings = card.listOptions || { rows: 10, fontSize: 14, noWrap: false, columns: source?.columns.map(column => column.id) || [] };
    const sizes = [...new Set([10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, settings.fontSize])].sort((a, b) => a - b);
    const choices = tables.map(source => [source.id, source.label]);
    if (card.layout === 'table' && !tables.some(source => source.id === card.fields[0]?.binding)) {
      choices.unshift([card.fields[0]?.binding || '', 'Unavailable List source']);
    }
    return `<div id="card-list-controls" data-field-id="${card.layout === 'table' ? card.fields[0]?.id || crypto.randomUUID() : crypto.randomUUID()}">
      ${tables.length ? '' : '<p class="card-manager-help">No List sources are available.</p>'}
      ${this.select('listSource', choices, card.layout === 'table' ? card.fields[0]?.binding : source?.id, 'List source', 'list-check')}
      <div class="field-row">${this.select('listRows', Array.from({ length: 10 }, (_, index) => [String(index + 1), String(index + 1)]), String(settings.rows), 'Rows', 'list-ol')}${this.select('listFontSize', sizes.map(size => [String(size), `${size} px`]), String(settings.fontSize), 'Font size', 'text-height')}</div>
      <div class="card-options-row">${this.switchControl('listNoWrap', 'Clip text without wrapping', settings.noWrap)}</div>
      <div class="field"><span class="field-label">${icon('table-columns')}Columns</span><div id="card-list-columns" class="card-list-columns">${this.listColumns(source, settings.columns)}</div></div>
    </div>`;
  },

  listColumns(source, selected = []) {
    const columns = source?.columns || selected.map(id => ({ id, label: `${id} (unavailable)` }));
    return columns.map(column => `<label><input type="checkbox" name="listColumn" value="${escapeHtml(column.id)}" ${selected.includes(column.id) ? 'checked' : ''}>${escapeHtml(column.label)}</label>`).join('');
  },

  fieldEditor(field, service) {
    const source = service.cardCatalog.find(source => source.id === field.binding);
    const choices = service.cardCatalog.map(source => [source.id, source.label]);
    if (!source) choices.push([field.binding, 'Unavailable field']);
    const formats = this.formats(source?.type);
    if (!formats.some(([id]) => id === field.format)) formats.push([field.format, field.format]);
    // Prefix IDs with the field identity; repeated label/glyph controls need
    // independent accessible names and must survive reordering and copying.
    const prefix = `card-field-${field.id}`;
    function fieldInput(label, name, input) {
      return `<div class="field"><label class="field-label" for="${prefix}-${name}">${escapeHtml(label)}</label>${input.replace(/<(input|select)/, `<$1 id="${prefix}-${name}" name="${name}"`)}</div>`;
    }
    function options(items, selected) {
      return items.map(([value, label]) => `<option value="${escapeHtml(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
    }
    return `<li class="card-field-editor" data-field-id="${field.id}"><input type="hidden" name="fieldEnabled" value="${field.enabled}">
      <div class="card-field-toolbar"><strong>${icon(source?.icon || 'plug')}<span class="card-field-number"></span></strong><div class="row-actions"><button type="button" class="icon-button" data-action="card-field-up" aria-label="Move field up">${icon('arrow-up')}</button><button type="button" class="icon-button" data-action="card-field-down" aria-label="Move field down">${icon('arrow-down')}</button><button type="button" class="icon-button" data-action="card-field-copy" aria-label="Copy field">${icon('copy')}</button><button type="button" class="icon-button delete" data-action="card-field-delete" aria-label="Delete field">${icon('trash-can')}</button><button type="button" class="switch" role="switch" aria-checked="${field.enabled}" data-action="card-field-toggle" aria-label="Field enabled"></button></div></div>
      ${fieldInput('Information', 'binding', `<select>${options(choices, field.binding)}</select>`)}
      ${fieldInput('Label', 'label', `<input type="text" maxlength="64" required value="${escapeHtml(field.label)}">`)}
      <div class="field-row">${fieldInput('Format', 'format', `<select>${options(formats, field.format)}</select>`)}${fieldInput('Glyph', 'icon', `<select>${options(this.glyphOptions('auto', 'Use field glyph'), field.icon)}</select>`)}</div>
      <div class="field-row">${fieldInput('Unit', 'unit', `<input type="text" maxlength="24" value="${escapeHtml(field.unit)}">`)}${fieldInput('Decimal places', 'decimals', `<input type="number" min="0" max="4" step="1" value="${field.decimals}" ${source?.type === 'number' ? '' : 'disabled'}>`)}</div>
    </li>`;
  },

  openEditor(id = null, copy = false) {
    const service = state.services.find(service => service.id === currentView);
    const original = service.cards.find(card => card.id === id);
    if (original?.layout === 'readymade') return this.openReadyMade(service, original, copy);
    const card = original ? structuredClone(original) : { schemaVersion: 1, name: '', enabled: false, showHeader: true, showFooter: true, crop: false, icon: 'inherit', size: 'medium', layout: service.defaultCardLayout || 'grid', fields: [] };
    if (!original && card.layout === 'table') {
      const source = service.cardCatalog.find(field => field.type === 'table' && field.instanceEnabled !== false)
        || service.cardCatalog.find(field => field.type === 'table');
      if (source) {
        card.fields = [{ id: crypto.randomUUID(), binding: source.id, label: source.label,
          enabled: true, icon: 'none', format: 'auto', unit: '', decimals: 0 }];
        card.listOptions = { rows: 10, fontSize: 14, noWrap: true, columns: source.columns.map(column => column.id) };
      }
    }
    if (!original && card.layout === 'webpage') {
      const source = service.cardCatalog.find(field => field.type === 'webpage' && field.instanceEnabled !== false)
        || service.cardCatalog.find(field => field.type === 'webpage');
      if (source) card.fields = [{ id: crypto.randomUUID(), binding: source.id, label: source.label,
        enabled: true, icon: 'none', format: 'auto', unit: '', decimals: 0 }];
    }
    if (copy) {
      card.name = `${card.name.slice(0, 59)} copy`;
      card.enabled = false;
      card.fields = card.fields.map(field => ({ ...field, id: crypto.randomUUID() }));
    }
    showDialog(`<form id="card-editor-form">${dialogHeader(original ? `${copy ? 'Copy' : 'Edit'} card` : 'Add card')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><div class="card-design-grid"><div class="card-design-properties">
      ${formField('Card title', 'tag', `<input name="name" required maxlength="64" value="${escapeHtml(card.name)}">`)}
      <div class="card-options-row" role="group" aria-label="Card options">${this.switchControl('enabled', 'Enabled', card.enabled)}${this.switchControl('showHeader', 'Header', card.showHeader !== false)}${this.switchControl('showFooter', 'Footer', card.showFooter !== false)}${this.switchControl('crop', 'Clip', card.crop === true)}</div>
      <div class="field-row">${this.select('size', [['small', 'Compact'], ['medium', 'Standard'], ['large', 'Wide']], card.size, 'Gallery preview size', 'display')}${this.select('layout', [['list', 'Fields'], ['grid', 'Grid'], ['highlight', 'Highlight first field'], ['table', 'List'], ...(service.cardCatalog.some(field => field.type === 'webpage') || card.layout === 'webpage' ? [['webpage', 'Webpage']] : [])], card.layout, 'View style', 'table-cells')}</div>
      ${this.select('cardIcon', this.glyphOptions('inherit', 'Use plugin glyph'), card.icon, 'Card glyph', 'plug')}
      ${this.listControls(card, service)}
      <div id="card-webpage-controls" data-field-id="${card.layout === 'webpage' ? card.fields[0]?.id || crypto.randomUUID() : crypto.randomUUID()}">
        ${this.select('webpageSource', service.cardCatalog.filter(field => field.type === 'webpage').map(field => [field.id, field.label]).concat(card.layout === 'webpage' && !service.cardCatalog.some(field => field.id === card.fields[0]?.binding) ? [[card.fields[0]?.binding || '', 'Unavailable webpage']] : []), card.layout === 'webpage' ? card.fields[0]?.binding : service.cardCatalog.find(field => field.type === 'webpage')?.id, 'Webpage source', 'display')}
        <p class="field-help">The original page fills the Card. Sites can prohibit embedding; use Parsed text in another view style when needed.</p>
      </div>
      <div id="card-field-controls">
      <label class="field"><span class="field-label">${icon('magnifying-glass')}Search available information</span><input id="card-information-search" type="search" placeholder="Find a field by name"></label>
      <div class="card-information-picker">${this.select('availableField', service.cardCatalog.map(field => [field.id, field.label]), service.cardCatalog[0]?.id, 'Available information', 'list-check')}<button type="button" class="button" data-action="card-field-add">${icon('plus')}Add field</button></div>
      <ol id="card-fields" class="card-fields-editor">${card.fields.map(field => this.fieldEditor(field, service)).join('')}</ol>
      </div>
    </div><aside class="card-design-preview" aria-label="Card preview"><div class="card-preview-heading"><h3>Live preview</h3><span>Read only</span></div><div id="card-preview"></div></aside></div></div>${dialogFooter(original && !copy ? 'Save changes' : 'Create card')}</form>`, {
      kind: 'card', pluginId: service.id, id, copy, revision: original?.revision,
    });
    dialog.classList.add('card-editor');
    this.updatePreview();
  },

  readField(element) {
    const value = name => element.querySelector(`[name="${name}"]`).value;
    return { id: element.dataset.fieldId, binding: value('binding'), label: value('label'),
      enabled: value('fieldEnabled') === 'true', icon: value('icon'), format: value('format'),
      unit: value('unit'), decimals: Number(value('decimals')) };
  },

  filterInformation(query) {
    const service = state.services.find(service => service.id === dialogContext.pluginId);
    const fields = service.cardCatalog.filter(field => field.label.toLowerCase().includes(query.toLowerCase().trim()));
    const select = dialog.querySelector('[name="availableField"]');
    const previous = select.value;
    select.innerHTML = fields.map(field => `<option value="${escapeHtml(field.id)}">${escapeHtml(field.label)}</option>`).join('') || '<option value="">No matching fields</option>';
    if (fields.some(field => field.id === previous)) select.value = previous;
    select.disabled = !fields.length;
    dialog.querySelector('[data-action="card-field-add"]').disabled = !fields.length;
  },

  readDraft() {
    const form = dialog.querySelector('#card-editor-form');
    if (form.dataset?.readyMade) return { schemaVersion: 1, layout: 'readymade', templateId: form.dataset.readyMade,
      sourceId: form.elements.namedItem('sourceId').value, enabled: dialogContext.readyEnabled };
    const layout = form.elements.namedItem('layout').value;
    const service = state.services.find(service => service.id === dialogContext.pluginId);
    const binding = form.elements.namedItem('listSource').value;
    const source = service.cardCatalog.find(source => source.id === binding);
    // Keep ordinary fields mounted when switching styles, but save only the
    // selected table binding and explicit columns for a List card.
    const pageBinding = form.elements.namedItem('webpageSource').value;
    const pageSource = service.cardCatalog.find(source => source.id === pageBinding);
    const fields = layout === 'webpage' ? [{ id: form.querySelector('#card-webpage-controls').dataset.fieldId,
      binding: pageBinding, label: pageSource?.label || 'Webpage', enabled: true, icon: 'none', format: 'auto', unit: '', decimals: 0 }]
      : layout === 'table' ? [{ id: form.querySelector('#card-list-controls').dataset.fieldId,
      binding, label: source?.label || 'List', enabled: true, icon: 'none', format: 'auto', unit: '', decimals: 0 }]
      : [...form.querySelectorAll('.card-field-editor')].map(element => this.readField(element));
    return { schemaVersion: 1, name: form.elements.namedItem('name').value,
      enabled: form.elements.namedItem('enabled').value === 'true',
      showHeader: form.elements.namedItem('showHeader').value === 'true',
      showFooter: form.elements.namedItem('showFooter').value === 'true',
      crop: form.elements.namedItem('crop').value === 'true',
      icon: form.elements.namedItem('cardIcon').value,
      size: form.elements.namedItem('size').value, layout, fields,
      ...(layout === 'table' ? { listOptions: { rows: Number(form.elements.namedItem('listRows').value),
        fontSize: Number(form.elements.namedItem('listFontSize').value), noWrap: form.elements.namedItem('listNoWrap').value === 'true',
        columns: [...form.querySelectorAll('[name="listColumn"]:checked')].map(control => control.value) } } : {}),
    };
  },

  updatePreview() {
    if (!dialog.open || dialogContext?.kind !== 'card') return;
    const service = state.services.find(service => service.id === dialogContext.pluginId);
    if (dialog.querySelector('#card-editor-form').dataset.readyMade) {
      const draft = this.readDraft();
      draft.name = dialogContext.readyName;
      CardRenderer.mount(dialog.querySelector('#card-preview'), this.renderCard(draft, service)); return;
    }
    const preview = dialog.querySelector('#card-preview');
    if (!service) { preview.innerHTML = '<p class="empty-state">Plugin unavailable.</p>'; return; }
    const draft = this.readDraft();
    dialog.querySelector('#card-list-controls').hidden = draft.layout !== 'table';
    dialog.querySelector('#card-webpage-controls').hidden = draft.layout !== 'webpage';
    dialog.querySelector('#card-field-controls').hidden = ['table', 'webpage'].includes(draft.layout);
    const previousBody = preview.querySelector('.display-card-fields');
    const scrollTop = previousBody?.scrollTop || 0;
    const scrollLeft = previousBody?.scrollLeft || 0;
    const restoreBodyFocus = document.activeElement === previousBody;
    CardRenderer.mount(preview, this.renderCard(draft, service));
    // Scroll mode retains reading position; crop mode always shows the top and
    // has no scroll target to restore or keyboard focus to retain.
    const body = preview.querySelector('.display-card-fields');
    body.scrollTop = draft.crop ? 0 : scrollTop;
    body.scrollLeft = draft.crop ? 0 : scrollLeft;
    if (restoreBodyFocus && !draft.crop) body.focus({ preventScroll: true });
    const fields = [...dialog.querySelectorAll('.card-field-editor')];
    fields.forEach((field, index) => {
      field.querySelector('.card-field-number').textContent = `Field ${index + 1}`;
      field.querySelector('[data-action="card-field-up"]').disabled = index === 0;
      field.querySelector('[data-action="card-field-down"]').disabled = index === fields.length - 1;
      const source = service.cardCatalog.find(source => source.id === field.querySelector('[name="binding"]').value);
      field.querySelector('[name="decimals"]').disabled = source?.type !== 'number' || field.querySelector('[name="format"]').value !== 'number';
      field.querySelector('[name="unit"]').disabled = ['log', 'timestamp'].includes(source?.type);
    });
  },

  changeBinding(control) {
    const element = control.closest('.card-field-editor');
    const service = state.services.find(service => service.id === dialogContext.pluginId);
    const field = this.readField(element);
    const source = service.cardCatalog.find(source => source.id === field.binding);
    if (!source) return;
    field.label = source.label;
    field.format = 'auto';
    field.unit = '';
    const parent = element.parentElement, index = [...parent.children].indexOf(element);
    element.outerHTML = this.fieldEditor(field, service);
    parent.children[index].querySelector('[name="binding"]').focus({ preventScroll: true });
    this.updatePreview();
  },

  async submit(form) {
    const draft = this.readDraft();
    if (draft.layout !== 'readymade' && !draft.fields.length) return showFormError('Add at least one information field.');
    if (draft.layout === 'table' && (!draft.fields[0].binding || !draft.listOptions.columns.length)) {
      return showFormError('Choose a List source and at least one column.');
    }
    const context = { ...dialogContext };
    const isNew = !context.id || context.copy;
    if (!isNew) draft.revision = context.revision;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    this.pending = true;
    try {
      await mutate(`api/plugins/${context.pluginId}/cards${isNew ? '' : '/' + context.id}`, draft);
      closeDialog(); renderView(); restoreRowFocus(); notify('Card saved');
    } catch (error) { button.disabled = false; showFormError(error.message); }
    finally { this.pending = false; }
  },

  async handleAction(action, id, control) {
    if (action === 'card-ready-add') return this.openReadyMade(state.services.find(service => service.id === currentView));
    if (action === 'card-add') return this.openEditor();
    if (action === 'edit-card' || action === 'copy-card') return this.openEditor(id, action === 'copy-card');
    if (action === 'card-option-toggle') {
      const input = dialog.querySelector(`#card-editor-form input[name="${control.dataset.option}"]`);
      input.value = String(input.value !== 'true');
      control.setAttribute('aria-checked', input.value);
      this.updatePreview();
      return;
    }
    if (action.startsWith('card-field-')) {
      const service = state.services.find(service => service.id === dialogContext.pluginId);
      const fields = dialog.querySelector('#card-fields');
      if (action === 'card-field-add') {
        if (fields.children.length >= 16) return showFormError('A card supports at most 16 fields.');
        const source = service.cardCatalog.find(source => source.id === dialog.querySelector('[name="availableField"]').value);
        fields.insertAdjacentHTML('beforeend', this.fieldEditor(this.newField(source), service));
        fields.lastElementChild.querySelector('[name="label"]').focus({ preventScroll: true });
      } else {
        const field = control.closest('.card-field-editor');
        const parent = field.parentElement;
        if (action === 'card-field-delete') {
          const neighbor = field.nextElementSibling || field.previousElementSibling;
          field.remove();
          (neighbor?.querySelector('[name="binding"]') || dialog.querySelector('[data-action="card-field-add"]')).focus({ preventScroll: true });
        } else if (action === 'card-field-copy') {
          if (fields.children.length >= 16) return showFormError('A card supports at most 16 fields.');
          field.insertAdjacentHTML('afterend', this.fieldEditor({ ...this.readField(field), id: crypto.randomUUID(), enabled: false }, service));
          field.nextElementSibling.querySelector('[name="label"]').focus({ preventScroll: true });
        } else if (action === 'card-field-up' && field.previousElementSibling) parent.insertBefore(field, field.previousElementSibling);
        else if (action === 'card-field-down' && field.nextElementSibling) parent.insertBefore(field.nextElementSibling, field);
        else if (action === 'card-field-toggle') {
          const input = field.querySelector('[name="fieldEnabled"]');
          input.value = String(input.value !== 'true');
          control.setAttribute('aria-checked', input.value);
        }
      }
      this.updatePreview();
      if (action === 'card-field-up' || action === 'card-field-down') {
        const target = control.disabled ? control.closest('.card-field-editor').querySelector('[name="binding"]') : control;
        target.focus({ preventScroll: true });
      }
      return;
    }
    const service = state.services.find(service => service.id === currentView);
    const card = service.cards.find(card => card.id === id);
    if (action === 'toggle-card') {
      control.disabled = true;
      try { await mutate(`api/plugins/${service.id}/cards/${id}/enabled`, { enabled: !card.enabled, revision: card.revision }); }
      finally { if (control.isConnected) control.disabled = false; }
    } else if (action === 'delete-card') {
      showDialog(`${dialogHeader('Delete card')}<div class="dialog-body"><p>Delete ${escapeHtml(card.name)}? Its saved layout and information fields will be removed.</p></div><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog">Cancel</button><button type="button" class="button danger" data-action="card-confirm-delete">Delete</button></div>`, { kind: 'card-delete', pluginId: service.id, id, revision: card.revision });
    } else if (action === 'card-confirm-delete') {
      const context = { ...dialogContext };
      await mutate(`api/plugins/${context.pluginId}/cards/${context.id}/delete`, { revision: context.revision });
      closeDialog(); renderView(); workspace.focus(); notify('Card deleted');
    }
  },

  openReadyMade(service, original = null, copy = false) {
    const template = original ? service.cardData.readyMade?.templates.find(template => template.id === original.templateId) : service.cardData.readyMade?.templates[0];
    const sources = service.cardData.readyMade?.sources || [];
    const sourceId = original?.sourceId || sources.find(source => source.enabled)?.id || sources[0]?.id || '';
    const choices = sources.map(source => [source.id, source.name + (source.enabled ? '' : ' · Disabled')]);
    if (!choices.some(([id]) => id === sourceId)) choices.unshift([sourceId, 'Unavailable data source']);
    const templateId = original?.templateId || template?.id;
    const name = template?.name || original?.name || 'Ready-made card';
    showDialog(`<form id="card-editor-form" data-ready-made="${escapeHtml(templateId)}">${dialogHeader(original ? copy ? 'Copy ready-made card' : 'Edit ready-made card' : 'Add ready-made card', name)}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><div class="card-design-grid"><div class="card-design-properties">${this.select('sourceId', choices, sourceId, template?.sourceLabel || 'Data source', 'house')}<p class="field-help">The design, graphics and information are fixed. Choose the data source that supplies this card.</p>${sources.length ? '' : '<p class="field-help">Add a data source in plugin Settings first.</p>'}</div><aside class="card-design-preview"><div class="card-preview-heading"><h3>Live preview</h3><span>Read only</span></div><div id="card-preview"></div></aside></div></div>${dialogFooter(original && !copy ? 'Save changes' : 'Create card')}</form>`,
      { kind: 'card', pluginId: service.id, id: original?.id, copy, revision: original?.revision,
        readyEnabled: copy || !original ? false : original.enabled, readyName: name });
    this.updatePreview();
  },
};

document.addEventListener('input', event => {
  if (event.target.closest('#card-editor-form')) CardDesigner.updatePreview();
});

document.addEventListener('change', event => {
  if (!event.target.closest('#card-editor-form')) return;
  if (event.target.matches('[name="listSource"]')) {
    const service = state.services.find(service => service.id === dialogContext.pluginId);
    const source = service.cardCatalog.find(source => source.id === event.target.value);
    dialog.querySelector('#card-list-columns').innerHTML = CardDesigner.listColumns(source, source?.columns.map(column => column.id));
    CardDesigner.updatePreview();
  } else if (event.target.matches('.card-field-editor [name="binding"]')) CardDesigner.changeBinding(event.target);
  else CardDesigner.updatePreview();
});

document.addEventListener('input', event => {
  if (event.target.id === 'card-information-search') CardDesigner.filterInformation(event.target.value);
});
