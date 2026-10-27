/** Shared plugin-owned Control authoring. Previews are inert; drafts and save
 * revisions remain fixed during server polling and use the shared confirmation.
 */
const ControlsUI = {
  pending: false,
  ownsView(view) { return ['controls', 'control-pages', 'lighting-scenes', 'lighting', 'vr-library', 'phone-home'].includes(view); },
  service(id) {
    const current = state.services.find(service => service.id === id);
    // Field schemas belong to the captured draft. Declaration polling must not
    // silently reinterpret typed arguments; only public preview readings hydrate.
    if (dialogContext?.kind === 'controls' && dialogContext.pluginId === id) return { ...dialogContext.controlService, cardData: current?.cardData || { values: {} } };
    return current;
  },
  owner(id) { return (state.controls || []).find(owner => owner.pluginId === id) || { pages: [], error: '' }; },
  actions(service) { return service.actions.filter(action => service.controls?.actions.includes(action.id)); },
  field(label, input) { return TaskUI.field(label, 'sliders', input); },
  select(name, choices, value) { return `<select name="${name}">${choices.map(([id, label]) => `<option value="${escapeHtml(id)}" ${id === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>`; },
  switch(name, label, value) { return `<div class="card-option"><input type="hidden" name="${name}" value="${value}"><span>${escapeHtml(label)}</span><button type="button" class="switch" role="switch" aria-label="${escapeHtml(label)}" aria-checked="${value}" data-action="control-option"></button></div>`; },
  hub() {
    const entries=[
      ['control-room','Control room','dashboard','Use scenes, Tasks, remotes and live Cards from a desktop or tablet.','/control-room'],
      ['tv-launcher','Sormus Launcher','tv','Choose TV app favorites, inputs, displays and published shortcuts. Install the TV app from Downloads.','/assets/launcher/index.html'],
      ['lighting-scenes','Lighting scenes','lightbulb','Save a lighting look, choose its symbol and manage your scenes.'],
      ['lighting','Lighting animations','palette','Design moving colours, fades and lighting sequences.'],
      ['control-pages','Remotes','settings-remote','Set up the TV, lighting and other remote controls available in Controller.'],
      ['phone-home','Controller setup','smartphone','Connect phones and choose which Tasks they can run.'],
      ['vr-library','VR library','vr-cardboard','Manage the headset library and install applications.'],
    ];
    return pageHeading('Controls','Set up what people can use from Controller and your devices')+
      '<div class="control-hub">'+entries.map(([view,name,glyph,description,href])=>`<section class="panel control-hub-card" data-live-key="control-hub:${view}"><div class="panel-body"><span class="control-hub-symbol">${icon(glyph)}</span><h2>${name}</h2><p>${description}</p>${href?`<a class="button" href="${href}" target="_blank" rel="noopener" aria-label="Open ${name}">${icon('arrow-right')}Open</a>`:`<button class="button" data-view="${view}" aria-label="Open ${name}">${icon('arrow-right')}Open</button>`}</div></section>`).join('')+'</div>';
  },
  render(service = null) { return service ? this.pages(service) : this.hub(); },
  pages(service = null) {
    const owners=service?[this.owner(service.id)]:state.controls||[];
    const rows=owners.flatMap(owner=>owner.pages.map(page=>({page,service:this.service(owner.pluginId)}))).filter(entry=>entry.service);
    const body=`<section class="panel"><div class="panel-header"><h2>Remotes <span class="panel-count">${rows.length}</span></h2><button type="button" class="button primary" data-action="control-add" ${service?`data-plugin-id="${escapeHtml(service.id)}"`:''} ${owners.length?'':'disabled'}>${icon('plus')}Create remote</button></div><div class="panel-body"><p>Enable a remote to make it available in Controller. Edit changes its buttons and settings; Open remote lets you use it.</p></div>
      ${owners.some(owner=>owner.error)?`<p class="form-error">${escapeHtml(owners.find(owner=>owner.error).error)}</p>`:''}
      ${rows.length?`<div class="table-scroll"><table class="service-table responsive-controls"><thead><tr><th>Name</th><th>Plugin</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(({page,service})=>`<tr data-live-key="control:${escapeHtml(service.id)}:${escapeHtml(page.id)}"><td>${icon(page.icon)} ${escapeHtml(page.name)}</td><td data-label="Plugin">${escapeHtml(service.name)}</td><td data-label="Status">${page.enabled?'Shown in Controller':'Disabled'}</td><td class="control-row-actions"><div class="row-actions"><a class="button" ${page.enabled?`href="/controls/${service.id}/${page.slug}" target="_blank" rel="noopener"`:`aria-disabled="true" tabindex="-1"`}>${icon('arrow-up-right-from-square')}Open remote</a><span data-control-owner="${service.id}">${itemActions(page,'control')}</span></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">No remotes yet. Create one from an installed plugin.</div>'}</section>`;
    return service?body:pageHeading('Remotes','Remote controls available to Controller','<button class="button" data-view="controls">'+icon('arrow-left')+'Controls</button>')+body;
  },
  blankItem(service, kind = 'button') {
    const compatible = field => kind === 'toggle' ? field.type === 'boolean' : kind === 'range' ? field.type === 'number' && !field.enum && Number.isFinite(field.min) && Number.isFinite(field.max) : kind === 'select' ? ['string','number'].includes(field.type) && field.enum?.length : false;
    const action = this.actions(service).find(action => action.parameters.some(compatible)) || this.actions(service)[0];
    return { id: crypto.randomUUID(), label: kind === 'scene' ? 'Scene' : 'Button', kind, enabled: true, icon: service.icon,
      steps: action ? [{ id: crypto.randomUUID(), actionId: action.id, parameters: { ...action.defaults } }] : [], parameter: action?.parameters.find(compatible)?.id || null, binding: null };
  },
  open(pluginId, id = null, copy = false) {
    const service = this.service(pluginId), original = this.owner(pluginId).pages.find(page => page.id === id);
    const page = original ? structuredClone(original) : { schemaVersion: 1, name: service.controls.lighting ? 'Lights' : service.controls.television ? 'TV remote' : 'Remote', slug: 'controls', presentation: service.controls.lighting ? 'lighting' : service.controls.television ? 'television' : 'mapped', enabled: false, icon: service.icon, columns: 3, items: [] };
    if (copy) {
      page.name += ' copy'; page.slug += '-copy'; page.enabled = false;
      page.items.forEach(item => { item.id = crypto.randomUUID(); item.steps.forEach(step => { step.id = crypto.randomUUID(); }); });
    }
    showDialog(`<form id="controls-editor-form">${dialogHeader(original && !copy ? 'Edit Controls' : 'Create Controls', service.name)}<div class="dialog-body">
      <div id="form-error" class="form-error" role="alert" hidden></div><div class="control-editor-settings">
      ${this.field('Name', `<input name="name" maxlength="64" required value="${escapeHtml(page.name)}">`)}
      ${this.field('URL name', `<input name="slug" maxlength="64" pattern="[a-z0-9]+(-[a-z0-9]+)*" required value="${escapeHtml(page.slug)}">`)}
      ${service.controls.lighting || service.controls.television ? this.field('Presentation', this.select('presentation', [['mapped','Mapped controls'], ...(service.controls.lighting ? [['lighting','Lighting remote']] : []), ...(service.controls.television ? [['television','TV remote']] : [])], page.presentation || 'mapped')) : ''}
      ${this.field('Columns', this.select('columns', [1, 2, 3, 4, 5, 6].map(n => [n, String(n)]), page.columns))}
      ${this.field('Glyph', this.select('icon', (state.pluginGlyphs || []).map(glyph => [glyph, glyph]), page.icon))}
      ${this.switch('pageEnabled', 'Enabled', page.enabled)}</div>
      <p class="field-help">Add a mapped button or an adjustable control. Scenes run ordered plugin actions and delays. Preview controls are disabled.${service.controls.lighting ? ' Lighting remote automatically displays reported devices and groups alongside saved scenes; mappings stay saved when switching presentation.' : ''}</p>
      <div class="control-designer"><section><div class="control-editor-toolbar"><select name="newKind" aria-label="New control type">${[['button','Mapped button'],['toggle','Toggle'],['range','Slider'],['select','Selection'],['scene','Scene']].map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select><button type="button" class="button" data-action="control-item-add">${icon('plus')}Add control</button></div>
      <div id="control-items">${page.items.map(item => this.itemEditor(item, service)).join('')}</div></section>
      <aside class="card-design-preview"><div class="card-preview-heading"><h3 id="control-preview-title">Live preview</h3><span>Read only</span></div><div id="control-preview"></div></aside></div>
      </div>${dialogFooter(original && !copy ? 'Save changes' : 'Create Controls')}</form>`, { kind: 'controls', pluginId, id, copy, revision: original?.revision,
        presentation: page.presentation || 'mapped',
        controlService: structuredClone({ id: service.id, name: service.name, icon: service.icon, controls: service.controls, actions: service.actions, cardFields: service.cardFields }) });
    this.preview();
    // Hydration adds declaration-driven selectors before capturing the draft.
    // Polling updates only readings; it must never reset this dirty baseline.
    initialFormValues = serializeForm(dialog.querySelector('form'));
  },
  stepEditor(step, service) {
    const action = this.actions(service).find(action => action.id === step.actionId), choices = [['delay', 'Delay'], ...this.actions(service).map(action => [action.id, action.name])];
    if (!choices.some(([id]) => id === step.actionId)) choices.unshift([step.actionId, 'Unavailable action']);
    return `<div class="control-step" data-step-id="${step.id}" data-saved-parameters="${escapeHtml(JSON.stringify(step.parameters || {}))}"><div class="field-row">${this.field('Action', this.select('controlAction', choices, step.actionId))}<button type="button" class="icon-button" data-action="control-step-up" aria-label="Move step up">${icon('arrow-up')}</button><button type="button" class="icon-button" data-action="control-step-down" aria-label="Move step down">${icon('arrow-down')}</button><button type="button" class="icon-button delete" data-action="control-step-delete" aria-label="Delete step">${icon('trash-can')}</button></div>
      <div class="control-step-parameters">${step.actionId === 'delay' ? this.field('Seconds', `<input name="seconds" type="number" min="0.01" max="10" step="any" required value="${step.seconds || 1}">`) : action ? action.parameters.map(field => PluginUI.field(field, step.parameters?.[field.id] ?? action.defaults[field.id] ?? '', 'control-param-' + step.id)).join('') : '<p class="field-help">This action is unavailable. Its saved reference is retained.</p>'}</div></div>`;
  },
  itemEditor(item, service, expanded = false) {
    return `<details class="control-item-editor" data-item-id="${item.id}" ${expanded ? 'open' : ''}><summary>${escapeHtml(item.label)} · ${escapeHtml(item.kind)}</summary><div class="control-item-properties">
      <div class="field-row">${this.field('Label', `<input name="itemLabel" maxlength="64" required value="${escapeHtml(item.label)}">`)}${this.field('Type', this.select('itemKind', [['button','Mapped button'],['scene','Scene'],['toggle','Toggle'],['range','Slider'],['select','Selection']], item.kind))}${this.field('Glyph', this.select('itemIcon', (state.pluginGlyphs || []).map(glyph => [glyph, glyph]), item.icon))}</div>
      <div class="control-editor-toolbar">${this.switch('itemEnabled','Control enabled', item.enabled)}<button type="button" class="icon-button" data-action="control-item-up" aria-label="Move control up">${icon('arrow-up')}</button><button type="button" class="icon-button" data-action="control-item-down" aria-label="Move control down">${icon('arrow-down')}</button><button type="button" class="icon-button" data-action="control-item-copy" aria-label="Copy control">${icon('copy')}</button><button type="button" class="icon-button delete" data-action="control-item-delete" aria-label="Delete control">${icon('trash-can')}</button></div>
      <div class="control-steps">${item.steps.map(step => this.stepEditor(step, service)).join('')}</div>
      ${service.controls?.lighting?.sceneFadeSetting ? `<div class="control-scene-fade" ${item.kind!=='scene'?'hidden':''}>${this.field('Scene fade (seconds)', `<input name="sceneFadeSeconds" type="number" min="0" max="60" step="0.1" placeholder="Use plugin default" value="${item.fadeSeconds ?? ''}"><small class="field-help">Stored light-setting scenes only. Leave blank to use the plugin default; 0 changes immediately.</small>`)}</div>` : ''}
      <button type="button" class="button control-add-step" data-action="control-step-add" ${item.kind === 'scene' ? '' : 'hidden'}>Add scene step</button>
      <div class="control-adjustment" data-saved-parameter="${escapeHtml(item.parameter || '')}"></div>
      <div class="control-binding" data-saved-binding="${escapeHtml(JSON.stringify(item.binding))}"></div></div></details>`;
  },
  readStep(element, service) {
    const actionId = element.querySelector('[name="controlAction"]').value, id = element.dataset.stepId;
    if (actionId === 'delay') return { id, actionId, seconds: Number(element.querySelector('[name="seconds"]').value) };
    const action = this.actions(service).find(action => action.id === actionId);
    return { id, actionId, parameters: action ? PluginUI.readFields(action.parameters, element) : JSON.parse(element.dataset.savedParameters) };
  },
  readItem(element, service) {
    const value = name => element.querySelector(`[name="${name}"]`)?.value;
    const selection = value('reading') || '', [field, column] = selection.split('/');
    const binding = !field ? null : column ? { field, column, rowColumn: value('rowColumn'), rowValue: value('rowValue') } : { field };
    return { id: element.dataset.itemId, label: value('itemLabel'), kind: value('itemKind'), icon: value('itemIcon'), enabled: value('itemEnabled') === 'true',
      steps: [...element.querySelectorAll('.control-step')].map(step => this.readStep(step, service)), parameter: element.querySelector('[name="variableParameter"]') ? value('variableParameter') || null : ['toggle','range','select'].includes(value('itemKind')) ? element.querySelector('.control-adjustment').dataset.savedParameter || null : null,
      binding: element.querySelector('[name="reading"]') ? binding : JSON.parse(element.querySelector('.control-binding').dataset.savedBinding),
      ...(value('itemKind')==='scene' && value('sceneFadeSeconds')!==undefined && value('sceneFadeSeconds')!=='' ? {fadeSeconds:Number(value('sceneFadeSeconds'))} : {}) };
  },
  readDraft() {
    const form = dialog.querySelector('#controls-editor-form'), service = this.service(dialogContext.pluginId);
    const value = name => form.querySelector(`[name="${name}"]`).value;
    return { schemaVersion: 1, name: value('name'), slug: value('slug'), icon: value('icon'), columns: Number(value('columns')), enabled: value('pageEnabled') === 'true',
      presentation: form.querySelector('[name="presentation"]')?.value || dialogContext.presentation || 'mapped',
      items: [...form.querySelectorAll('.control-item-editor')].map(element => this.readItem(element, service)) };
  },
  hydrateProperties(element, service) {
    const kind = element.querySelector('[name="itemKind"]').value, step = element.querySelector('.control-step');
    const fade=element.querySelector('.control-scene-fade');if(fade)fade.hidden=kind!=='scene';
    const action = this.actions(service).find(action => action.id === step?.querySelector('[name="controlAction"]').value);
    const adjustable = element.querySelector('.control-adjustment'), oldParameter = adjustable.querySelector('select')?.value || adjustable.dataset.savedParameter;
    const fields = (action?.parameters || []).filter(field => kind === 'toggle' ? field.type === 'boolean' : kind === 'range' ? field.type === 'number' && !field.enum && Number.isFinite(field.min) && Number.isFinite(field.max) : kind === 'select' ? ['string','number'].includes(field.type) && field.enum?.length : false);
    const parameterChoices = fields.map(field => [field.id, field.label]);
    if (oldParameter && !fields.some(field => field.id === oldParameter)) parameterChoices.push([oldParameter, 'Unavailable parameter']);
    adjustable.innerHTML = ['toggle','range','select'].includes(kind) ? this.field('Adjustable parameter', this.select('variableParameter', parameterChoices, oldParameter || fields[0]?.id)) : '';
    const expected = fields.find(field => field.id === adjustable.querySelector('select')?.value)?.type;
    const bindingHolder = element.querySelector('.control-binding'), old = bindingHolder.querySelector('select') ? this.readItem(element, service).binding : JSON.parse(bindingHolder.dataset.savedBinding);
    const choices = [['', 'No reported reading']];
    for (const field of service.cardFields) {
      if (field.type === 'table') {
        for (const column of field.columns) if (!expected || column.type === expected) choices.push([field.id + '/' + column.id, field.label + ' · ' + column.label]);
      } else if (['string','number','boolean','timestamp'].includes(field.type) && (!expected || field.type === expected)) choices.push([field.id, field.label]);
    }
    const selected = old ? old.field + (old.column ? '/' + old.column : '') : '';
    if (selected && !choices.some(([id]) => id === selected)) choices.push([selected, 'Unavailable reading']);
    const table = service.cardFields.find(field => field.id === old?.field && field.type === 'table');
    bindingHolder.innerHTML = this.field('Reported reading', this.select('reading', choices, selected)) + `<div class="control-row-binding" ${table ? '' : 'hidden'}>${this.field('Row identity column', this.select('rowColumn', (table?.columns || []).filter(column => column.type === 'string').map(column => [column.id, column.label]), old?.rowColumn || 'id'))}${this.field('Row ID', `<input name="rowValue" maxlength="128" value="${escapeHtml(old?.rowValue || '')}">`)}</div>`;
    element.querySelector('.control-add-step').hidden = kind !== 'scene';
  },
  preview() {
    if (!dialog.open || dialogContext?.kind !== 'controls') return;
    const service = this.service(dialogContext.pluginId);
    for (const element of dialog.querySelectorAll('.control-item-editor')) if (!element.querySelector('[name="reading"]')) this.hydrateProperties(element, service);
    const page = this.readDraft();
    dialog.querySelector('#control-preview-title').textContent = page.presentation !== 'mapped' ? 'Mapped controls preview' : 'Live preview';
    page.id = 'preview'; page.revision = 1;
    page.items = page.items.filter(item => item.enabled).map(item => {
      const action = this.actions(service).find(action => action.id === item.steps[0]?.actionId), field = action?.parameters.find(field => field.id === item.parameter);
      const entry = item.binding && service.cardData.values[item.binding.field];
      const reported = entry?.available ? item.binding.column ? entry.value.find(row => row[item.binding.rowColumn] === item.binding.rowValue)?.[item.binding.column] ?? null : entry.value : null;
      return { id: item.id, label: item.label, kind: item.kind, icon: item.icon, available: true, hasReading: Boolean(item.binding), reported,
        ...(field ? { input: { type: field.type, min: field.min, max: field.max, enum: field.enum, enumLabels: field.enumLabels, default: item.steps[0].parameters[field.id] } } : {}) };
    });
    ControlsRenderer.mount(dialog.querySelector('#control-preview'), { page, available: true, busy: false }, { preview: true });
  },
  async submit(form) {
    if (form.id === 'controls-plugin-form') { const id = form.querySelector('select').value; closeDialog(); this.open(id); return; }
    const draft = this.readDraft(), context = { ...dialogContext }, isNew = !context.id || context.copy;
    if (!isNew) draft.revision = context.revision;
    const button = form.querySelector('[type="submit"]'); button.disabled = true; this.pending = true;
    try { await mutate(`api/plugins/${context.pluginId}/controls${isNew ? '' : '/' + context.id}`, draft); closeDialog(); renderView(); notify('Controls saved'); }
    catch (error) { button.disabled = false; showFormError(error.message); }
    finally { this.pending = false; }
  },
  async handleAction(action, id, button) {
    if (action === 'control-add') {
      const pluginId = button.dataset.pluginId || this.service(currentView)?.id;
      if (pluginId) return this.open(pluginId);
      const services = state.services.filter(service => service.controls);
      return showDialog(`<form id="controls-plugin-form">${dialogHeader('Create Controls')}<div class="dialog-body">${this.field('Plugin', this.select('pluginId', services.map(service => [service.id, service.name]), services[0]?.id))}</div>${dialogFooter('Continue')}</form>`, { kind: 'controls-plugin' });
    }
    if (action === 'control-option') {
      const hidden = button.closest('.card-option').querySelector('input'); hidden.value = String(hidden.value !== 'true'); button.setAttribute('aria-checked', hidden.value); this.preview(); return;
    }
    const service = this.service(dialogContext?.kind === 'controls' ? dialogContext.pluginId : button.closest('[data-control-owner]')?.dataset.controlOwner || currentView);
    if (action.startsWith('control-item-') || action.startsWith('control-step-')) {
      const parent = dialog.querySelector('#control-items'), element = button.closest('.control-item-editor');
      if (action === 'control-item-add') {
        if (parent.children.length >= 64) return showFormError('Use at most 64 controls.');
        parent.insertAdjacentHTML('beforeend', this.itemEditor(this.blankItem(service, dialog.querySelector('[name="newKind"]').value), service, true));
      } else if (action === 'control-item-delete') element.remove();
      else if (action === 'control-item-copy') {
        if (parent.children.length >= 64) return showFormError('Use at most 64 controls.');
        const item = this.readItem(element, service); item.id = crypto.randomUUID(); item.enabled = false; item.steps.forEach(step => { step.id = crypto.randomUUID(); });
        element.insertAdjacentHTML('afterend', this.itemEditor(item, service, true));
      } else if (action === 'control-item-up' && element.previousElementSibling) parent.insertBefore(element, element.previousElementSibling);
      else if (action === 'control-item-down' && element.nextElementSibling) parent.insertBefore(element.nextElementSibling, element);
      else if (action === 'control-step-add') {
        const steps = element.querySelector('.control-steps'); if (steps.children.length >= 32) return showFormError('Use at most 32 scene steps.');
        steps.insertAdjacentHTML('beforeend', this.stepEditor(this.blankItem(service).steps[0], service));
      } else if (action.startsWith('control-step-')) {
        const step = button.closest('.control-step'), steps = step.parentElement;
        if (action === 'control-step-delete') {
          if (steps.children.length === 1) return showFormError('A control needs at least one action step.');
          step.remove();
        }
        else if (action === 'control-step-up' && step.previousElementSibling) steps.insertBefore(step, step.previousElementSibling);
        else if (action === 'control-step-down' && step.nextElementSibling) steps.insertBefore(step.nextElementSibling, step);
      }
      this.preview(); return;
    }
    if (action === 'control-confirm-delete') {
      const context = { ...dialogContext }; await mutate(`api/plugins/${context.pluginId}/controls/${context.id}/delete`, { revision: context.revision }); closeDialog(); renderView(); return;
    }
    const page = this.owner(service.id).pages.find(page => page.id === id);
    if (action === 'edit-control' || action === 'copy-control') this.open(service.id, id, action === 'copy-control');
    else if (action === 'toggle-control') await mutate(`api/plugins/${service.id}/controls/${id}/enabled`, { revision: page.revision, enabled: !page.enabled });
    else if (action === 'delete-control') showDialog(`${dialogHeader('Delete Controls')}<div class="dialog-body"><p>Delete ${escapeHtml(page.name)} and its saved mappings?</p></div><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog">Cancel</button><button type="button" class="button danger" data-action="control-confirm-delete">Delete</button></div>`, { kind: 'controls-delete', pluginId: service.id, id, revision: page.revision });
  },
};
document.addEventListener('input', event => { if (event.target.closest('#controls-editor-form')) ControlsUI.preview(); });
document.addEventListener('invalid', event => {
  // Native constraint validation must reveal a collapsed mapping before moving
  // focus to its required field. Expansion does not change the saved draft.
  const item = event.target.closest('.control-item-editor');
  if (item) item.open = true;
}, true);
document.addEventListener('change', event => {
  const element = event.target.closest('.control-item-editor'); if (!element) return;
  const service = ControlsUI.service(dialogContext.pluginId);
  if (event.target.name === 'itemKind' && event.target.value !== 'scene') {
    const steps = element.querySelector('.control-steps');
    // A deliberate type change keeps the first mapping; only scenes have a sequence.
    while (steps.children.length > 1) steps.lastElementChild.remove();
  }
  if (event.target.name === 'controlAction') {
    const step = event.target.closest('.control-step'), action = ControlsUI.actions(service).find(action => action.id === event.target.value);
    step.outerHTML = ControlsUI.stepEditor({ id: step.dataset.stepId, actionId: event.target.value, parameters: { ...action?.defaults }, seconds: 1 }, service);
  }
  if (['controlAction','itemKind','variableParameter','reading'].includes(event.target.name)) {
    if (event.target.name === 'reading') {
      const [field, column] = event.target.value.split('/');
      element.querySelector('.control-binding').dataset.savedBinding = JSON.stringify(field ? { field, ...(column ? { column, rowColumn: 'id', rowValue: '' } : {}) } : null);
      element.querySelector('.control-binding').innerHTML = '';
    }
    ControlsUI.hydrateProperties(element, service);
  }
  ControlsUI.preview();
});
