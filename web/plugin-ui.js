/** Shared plugin workspace. Identity and forms come from declarations; a plugin
 * name cannot be edited here. No plugin IDs or installed-plugin list are embedded.
 */
const PluginUI = {
  tabs: new Map(),
  pending: false,
  glyphSearch: '',
  valueInstances: new Map(),
  openGuides: new Set(),

  field(field, value, prefix) {
    const id = `${prefix}-${field.id}`;
    const common = `id="${escapeHtml(id)}" name="${escapeHtml(field.id)}" ${field.help ? `aria-describedby="${escapeHtml(id)}-help"` : ''} ${field.required ? 'required' : ''}`;
    let input;
    if (field.type === 'boolean') {
      input = `<input ${common.replace('required', '')} class="switch plugin-setting-toggle" role="switch" type="checkbox" ${value ? 'checked' : ''}>`;
    } else if (field.type === 'list') {
      input = `<input ${common} type="hidden" value="${escapeHtml(JSON.stringify(value || []))}">`;
    } else if (field.enum) {
      input = `<select ${common}>${field.enum.map((choice, index) => `<option value="${escapeHtml(choice)}" ${choice === value ? 'selected' : ''}>${escapeHtml(field.enumLabels?.[index] ?? choice)}</option>`).join('')}</select>`;
    } else if (field.type === 'number') {
      input = `<input ${common} type="number" step="any" ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''} value="${escapeHtml(value ?? '')}">`;
    } else if (field.format === 'multiline') {
      input = `<textarea ${common} rows="4" maxlength="${field.maxLength || 4000}">${escapeHtml(value ?? '')}</textarea>`;
    } else {
      // Declared patterns are authoritative at the API boundary. HTML uses a
      // different Unicode regex mode, so copying them here could reject valid
      // location notation or silently disable browser validation.
      input = `<input ${common} type="${field.format === 'secret' ? 'password' : 'text'}" ${field.format === 'secret' ? 'autocomplete="off" spellcheck="false"' : ''} maxlength="${field.maxLength || 4000}" value="${escapeHtml(value ?? '')}" ${field.suggestions ? `list="${escapeHtml(id)}-choices"` : ''}>`;
      if (field.suggestions) input += `<datalist id="${escapeHtml(id)}-choices">${field.suggestions.map(choice => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`).join('')}</datalist>`;
    }
    if (field.type === 'list') return input;
    return `<div class="field ${field.type === 'boolean' ? 'plugin-checkbox-field' : ''}"><label class="field-label" for="${escapeHtml(id)}">${icon(field.type === 'number' ? 'hashtag' : field.type === 'boolean' ? 'toggle-on' : 'comment')}${escapeHtml(field.label)}</label>${input}${field.help ? `<span id="${escapeHtml(id)}-help" class="field-help">${escapeHtml(field.help).replaceAll('\n', '<br>')}</span>` : ''}</div>`;
  },

  readFields(fields, form) {
    return Object.fromEntries(fields.filter(field => {
      const control = form.elements?.namedItem(field.id) || form.querySelector(`[name="${field.id}"]`);
      // Optional numeric arguments have a real absent state. A blank white/RGB
      // setting must not silently become zero and change another capability.
      return !(field.type === 'number' && !field.required && field.default === undefined && control.value === '');
    }).map(field => {
      const control = form.elements?.namedItem(field.id) || form.querySelector(`[name="${field.id}"]`);
      return [field.id, field.type === 'list' ? JSON.parse(control.value) : field.type === 'boolean'
        ? control.type === 'hidden' ? control.value === 'true' : control.checked
        : field.type === 'number' ? Number(control.value) : control.value];
    }));
  },

  glyphChoices(service) {
    const choices = (state.pluginGlyphs || []).filter(name => name.includes(this.glyphSearch.toLowerCase().trim().replaceAll(' ', '-').replaceAll('_', '-')));
    return choices.length ? choices.slice(0, 96).map(name => `<button class="glyph-choice" type="button" data-action="plugin-glyph" data-id="${escapeHtml(service.id)}" data-glyph="${name}" aria-label="Use ${name} glyph" aria-pressed="${service.icon === name}" title="${name}">${icon(name)}<span>${escapeHtml(name.replaceAll('-', ' '))}</span></button>`).join('') + (choices.length > 96 ? '<p class="glyph-search-help">Showing 96 of ' + choices.length + ' glyphs. Search to narrow the choices.</p>' : '') : '<p class="empty-state">No glyphs found.</p>';
  },

  render(service) {
    const tabNames = [
      ['settings', 'Settings', 'sliders'],
      ['cards', 'Card designer', 'table-cells'],
      ...(service.controls ? [['controls', 'Controls', 'gamepad']] : []),
      ...(service.events.length ? [['events', 'Events', 'tower-broadcast']] : []),
      ['log', 'Log', 'clipboard-list'],
    ];
    const remembered = this.tabs.get(service.id);
    const selected = tabNames.some(([id]) => id === remembered) ? remembered : 'settings';
    const status = serviceStatus(service);
    const heading = `<div class="page-heading"><div class="plugin-heading"><span class="service-icon">${icon(service.icon)}</span><div><h1>${escapeHtml(service.name)}</h1><div class="plugin-readiness">${statusPill(status.label, status.className)}</div></div></div></div>`;
    const tabs = `<div class="tabs" role="tablist" aria-label="${escapeHtml(service.name)} workspace">${tabNames.map(([id, label, glyph]) => `<button type="button" id="plugin-tab-${id}" class="tab" role="tab" aria-selected="${selected === id}" aria-controls="plugin-panel" tabindex="${selected === id ? 0 : -1}" data-action="plugin-tab" data-id="${id}">${icon(glyph)}${label}</button>`).join('')}</div>`;
    const error = `<div id="plugin-error" class="form-error" role="alert" ${service.error ? '' : 'hidden'}>${escapeHtml(service.error)}</div>`;
    const panel = selected === 'controls' ? ControlsUI.render(service) : selected === 'cards' ? CardDesigner.render(service) : selected === 'log' ? this.log(service)
      : selected === 'events' ? this.events(service) : this.settings(service);
    renderWorkspace(heading + `<div class="plugin-evidence">${serviceEvidence(service)}<p>A completed check may use cached data. Reception is the latest available source timestamp; command delivery does not confirm device state.</p></div>` + tabs + error + `<div id="plugin-panel" role="tabpanel" aria-labelledby="plugin-tab-${selected}">${panel}</div>`);
    renderSaveFeedback();
  },

  log(service) {
    return activityPanel(service.pluginActivity || [], true, service.id);
  },

  settingsGuide(service) {
    const guide = service.settingsGuide;
    if (!guide) return '';
    return `<details class="plugin-setup-guide" data-plugin-guide="${escapeHtml(service.id)}" ${this.openGuides.has(service.id) ? 'open' : ''}><summary>${escapeHtml(guide.title)}</summary>${guide.sections.map(section => `<section><h3>${escapeHtml(section.title)}</h3><ol>${section.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol></section>`).join('')}</details>`;
  },

  settings(service) {
    if (!service.config) return '<section class="panel"><div class="empty-state">Plugin data could not be loaded.</div></section>';
    return `<section class="panel"><div class="panel-header"><h2>Settings</h2><span class="panel-count">v${escapeHtml(service.version)}</span></div><div class="panel-body"><p class="save-guidance">Fields save automatically when changed. List entries use their own editor. <span data-save-status aria-live="polite"></span></p>${this.settingsGuide(service)}
      ${service.runtime?.ingest === 'sensors-v1' ? '<div class="plugin-setting-row"><span>Android app</span><a class="button" href="/sensors" target="_blank" rel="noopener">Download APK</a></div>' : ''}
      <form id="plugin-settings-form" data-plugin-id="${escapeHtml(service.id)}" data-revision="${service.config.revision}"><fieldset class="plugin-settings-fields">${service.settings.map(field => this.field(field, service.config.settings[field.id] ?? field.default, 'plugin-setting')).join('')}</fieldset></form>
      <div class="plugin-setting-row"><span>${icon('toggle-on')}Enabled</span><button type="button" class="switch" role="switch" aria-checked="${service.enabled}" aria-label="${escapeHtml(service.name)} enabled" data-action="toggle-service" data-id="${escapeHtml(service.id)}"></button></div>
      ${service.attribution ? `<p class="field-help"><a href="${escapeHtml(service.attribution.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(service.attribution.label)}</a> · <a href="${escapeHtml(service.attribution.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(service.attribution.licenseLabel)}</a> · ${escapeHtml(service.attribution.notice)}</p>` : ''}
    </div></section>${service.settings.filter(field => field.type === 'list').map(field => this.list(service, field)).join('')}
    <section class="panel plugin-appearance"><div class="panel-body"><details><summary>${icon('palette')} Plugin appearance</summary><div class="plugin-setting-row"><span>Glyph</span><details id="glyph-picker"><summary>${icon(service.icon)}<span>${escapeHtml(service.icon)}</span>${icon('chevron-down')}</summary><div class="glyph-picker-body"><label class="field-label" for="glyph-search">Search glyphs</label><input id="glyph-search" type="search" placeholder="Search glyphs" value="${escapeHtml(this.glyphSearch)}"><div id="glyph-choices" class="glyph-grid">${this.glyphChoices(service)}</div></div></details><button class="button" type="button" data-action="plugin-glyph-default" data-id="${escapeHtml(service.id)}">Reset glyph</button></div></details></div></section>`;
  },

  list(service, field) {
    const items = service.config.settings[field.id] || [];
    const lookup = service.settingsLookup?.setting === field.id;
    return `<section class="panel plugin-list"><div class="panel-header"><h2>${escapeHtml(field.label)} <span class="panel-count">${items.length}</span></h2><div class="heading-actions">${lookup ? `<button type="button" class="button" data-action="plugin-find-source" data-setting="${field.id}" ${items.length >= field.maxItems ? 'disabled' : ''}>${icon('magnifying-glass')}Find ${escapeHtml(field.itemLabel)}</button>` : ''}<button type="button" class="button primary" data-action="plugin-list-add" data-setting="${field.id}" ${items.length >= field.maxItems ? 'disabled' : ''}>${icon('plus')}Add ${escapeHtml(field.itemLabel)}</button></div></div>
      ${field.help ? `<div class="panel-body"><p class="field-help">${escapeHtml(field.help)}</p></div>` : ''}
      ${items.length ? items.map(item => `<div class="settings-item" data-live-key="source:${escapeHtml(field.id)}:${escapeHtml(item.id)}"><div class="settings-text"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(this.itemSummary(field, item))}</p></div>${statusPill(item.enabled ? 'Enabled' : 'Disabled', item.enabled ? 'running' : 'paused')}<div class="row-actions">
      ${this.listActionButtons(service, field, item)}${['edit', 'copy', 'delete'].map(action => `<button type="button" class="icon-button ${action === 'delete' ? 'delete' : ''}" data-action="plugin-list-${action}" data-setting="${field.id}" data-id="${item.id}" aria-label="${action[0].toUpperCase() + action.slice(1)} ${escapeHtml(item.name)}">${icon(action === 'edit' ? 'pen' : action === 'copy' ? 'copy' : 'trash-can')}</button>`).join('')}
      <button type="button" class="switch" role="switch" aria-checked="${item.enabled}" data-action="plugin-list-toggle" data-setting="${field.id}" data-id="${item.id}" aria-label="${escapeHtml(item.name)} enabled"></button></div></div>`).join('') : `<div class="empty-state">No ${escapeHtml(field.label.toLowerCase())} yet.</div>`}</section>`;
  },

  listActionButtons(service, field, item) {
    return (service.listActions || []).filter(entry => entry.setting === field.id).map(entry => {
      const action = service.actions.find(action => action.id === entry.actionId);
      if (!action) return '';
      const reason = state.paused ? 'Enable server functions first.' : !item.enabled ? 'Enable this entry first.'
        : action.available === false ? action.unavailableReason : '';
      return `<button type="button" class="button" data-action="plugin-source-action" data-capability="${escapeHtml(action.id)}" data-id="${escapeHtml(item.id)}" data-revision="${service.config.revision}" title="${escapeHtml(reason || action.description)}" ${reason || this.pending ? 'disabled' : ''}>${icon('display')}${escapeHtml(action.name)}</button>`;
    }).join('');
  },

  async runSourceAction(service, control) {
    if (this.pending) return;
    const entry = service.listActions.find(entry => entry.actionId === control.dataset.capability);
    if (!entry) return;
    this.pending = true;
    control.disabled = true;
    let failure;
    try {
      await mutate(`api/plugins/${service.id}/actions/${entry.actionId}`, {
        revision: Number(control.dataset.revision), parameters: {[entry.targetParameter]: control.dataset.id},
      });
      notify('Command sent. Check the TV for display.');
    } catch (error) { failure = error.message; }
    finally {
      this.pending = false;
      // Refresh from current declarations/readiness without repeating the send.
      if (currentView === service.id) this.render(state.services.find(item => item.id === service.id));
      if (failure) this.showError(failure);
    }
  },

  itemSummary(field, item) {
    return field.fields.filter(child => child.format !== 'secret' && !['id', 'name', 'enabled'].includes(child.id)
      && item[child.id] !== '' && item[child.id] !== undefined).map(child => {
      const value = item[child.id];
      const label = child.suggestions?.find(choice => choice.value === value)?.label
        ?? child.enumLabels?.[child.enum?.indexOf(value)] ?? value;
      return child.id === 'query' ? label : `${child.label}: ${label}`;
    }).join(' · ');
  },

  newItem(field) {
    const item = { id: `loc-${crypto.randomUUID()}`, name: '', enabled: true };
    for (const child of field.fields.filter(child => !['id', 'name', 'enabled'].includes(child.id))) {
      item[child.id] = child.defaultFrom === 'server-location' && config.location
        ? `${config.location.latitude},${config.location.longitude}` : child.default ?? '';
    }
    if (field.fields.some(child => child.defaultFrom === 'server-location' && item[child.id])) item.name = 'Server location';
    return item;
  },

  openItem(service, field, operation, id, prefill = {}) {
    const items = structuredClone(service.config.settings[field.id] || []);
    const original = items.find(item => item.id === id);
    const item = original ? structuredClone(original) : {...this.newItem(field),...prefill};
    if (operation === 'copy') Object.assign(item, { id: `loc-${crypto.randomUUID()}`, name: `${item.name.slice(0, 27)} copy`, enabled: false });
    const context = { kind: 'plugin-item', pluginId: service.id, setting: field.id, operation,
      item, items, settings: structuredClone(service.config.settings), revision: service.config.revision };
    const title = `${operation === 'add' ? 'Add' : operation === 'copy' ? 'Copy' : operation === 'delete' ? 'Delete' : 'Edit'} ${field.itemLabel}`;
    const fields = operation === 'delete' ? `<p>Delete ${escapeHtml(item.name)}?</p>` : field.fields.filter(child => child.id !== 'id').map(child => child.type === 'boolean'
      ? `<div class="plugin-setting-row"><label for="item-option-${child.id}">${escapeHtml(child.label)}</label><input type="hidden" name="${child.id}" value="${item[child.id]}"><button id="item-option-${child.id}" class="switch" type="button" role="switch" aria-checked="${item[child.id]}" aria-label="${escapeHtml(child.label)}" data-action="plugin-item-option" data-id="${child.id}"></button></div>`
      : this.field(child, item[child.id], 'plugin-item')).join('');
    // Capture both the settings revision and item list. Polling never advances
    // the modal's baseline; conflicting external edits must be reopened.
    showDialog(`<form id="plugin-item-form">${dialogHeader(title)}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>${fields}</div>${dialogFooter(operation === 'delete' ? 'Delete' : operation === 'add' || operation === 'copy' ? `Add ${field.itemLabel}` : 'Save changes')}</form>`, context);
  },

  async submitItem(form) {
    if (this.pending) return;
    const context = dialogContext;
    const service = state.services.find(service => service.id === context.pluginId);
    const field = service.settings.find(field => field.id === context.setting);
    let items = structuredClone(context.items);
    if (context.operation === 'delete') items = items.filter(item => item.id !== context.item.id);
    else {
      const item = { ...context.item, ...this.readFields(field.fields.filter(child => child.id !== 'id'), form) };
      for (const child of field.fields.filter(child => child.type === 'string')) item[child.id] = item[child.id].trim();
      const index = items.findIndex(existing => existing.id === item.id);
      if (index < 0) items.push(item);
      else items[index] = item;
    }
    this.pending = true;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await mutate(`api/plugins/${service.id}/config`, { revision: context.revision, settings: { ...context.settings, [field.id]: items } });
      closeDialog();
      this.render(state.services.find(candidate => candidate.id === context.pluginId));
      notify(`${field.itemLabel[0].toUpperCase() + field.itemLabel.slice(1)} saved`);
    } catch (error) { showFormError(error.message); }
    finally { this.pending = false; if (button.isConnected) button.disabled = false; }
  },

  openLookup(service) {
    const lookup = service.settingsLookup;
    const action = service.actions.find(item => item.id === lookup.actionId);
    const field = service.settings.find(item => item.id === lookup.setting);
    const ready = service.enabled && service.configurationReady && service.health === 'ready' && !state.paused;
    showDialog(`<form id="plugin-lookup-form">${dialogHeader(action.name)}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>${action.parameters.map(parameter => this.field(parameter, '', 'source-lookup')).join('')}<button type="submit" class="button primary" ${ready ? '' : 'disabled'}>${icon('magnifying-glass')}Search</button>${ready ? '' : '<p class="field-help">Enable the server and configure this plugin in Settings before searching.</p>'}<div class="source-lookup-results" aria-live="polite"></div></div><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog">Close</button></div></form>`, {
      kind: 'plugin-lookup', pluginId: service.id, revision: service.config.revision, matches: [], itemLabel: field.itemLabel,
    });
  },

  async submitLookup(form) {
    if (this.pending) return;
    const context = dialogContext;
    const service = state.services.find(item => item.id === context.pluginId);
    const action = service.actions.find(item => item.id === service.settingsLookup.actionId);
    const button = form.querySelector('[type="submit"]');
    this.pending = true;
    button.disabled = true;
    try {
      const reply = await mutate(`api/plugins/${service.id}/actions/${action.id}`, {parameters: this.readFields(action.parameters, form)});
      // A late network reply cannot populate a different dialog or silently save
      // a Channel. Selection opens the ordinary captured-revision item editor.
      if (dialogContext !== context || !form.isConnected) return;
      context.matches = (reply.result?.matches || []).slice(0, 5);
      form.querySelector('.source-lookup-results').innerHTML = context.matches.length
        ? context.matches.map((match, index) => `<div class="settings-item"><div class="settings-text"><h3>${escapeHtml(match.name)}</h3><p>${escapeHtml(match.handle || '')} · ${escapeHtml(match.id)}</p></div><button class="button" type="button" data-action="plugin-use-source" data-id="${index}">Use ${escapeHtml(context.itemLabel)}</button></div>`).join('')
        : '<p class="empty-state">No matches found.</p>';
    } catch (error) {
      if (dialogContext === context && form.isConnected) showFormError(error.message);
    } finally {
      this.pending = false;
      if (button.isConnected) button.disabled = false;
    }
  },

  catalogEvents(service) {
    const instances = service.config.settings[service.instances.setting] || [];
    const selected = instances.find(item => item.id === this.valueInstances.get(service.id))?.id || instances[0]?.id;
    const sourceField = service.settings.find(field => field.id === service.instances.setting);
    const sourceLabel = sourceField.itemLabel[0].toUpperCase() + sourceField.itemLabel.slice(1);
    const selector = instances.length ? this.field({id: 'instance', label: sourceLabel, type: 'string',
      enum: instances.map(item => item.id), enumLabels: instances.map(item => `${item.name}${item.enabled ? '' : ' (Disabled)'}`),
    }, selected, 'current-value') : `<p class="field-help">Add a ${escapeHtml(sourceField.itemLabel)} in Settings.</p>`;
    const fields = service.cardCatalog.filter(field => selected && field.instanceId === selected
      && service.settingsLookup.readingFields.includes(field.id.slice(selected.length + 1)));
    const facts = fields.filter(field => field.type !== 'table').map(field => {
      const datum = service.cardData.values[field.id];
      const value = !datum?.available ? 'No data' : field.type === 'timestamp' ? formatServerTimestamp(datum.value)
        : field.type === 'boolean' ? datum.value ? 'Yes' : 'No' : datum.value;
      return `<div><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
    }).join('');
    const ready = service.enabled && service.configurationReady && service.health === 'ready' && !state.paused;
    const table = fields.find(field => field.type === 'table');
    const rows = table ? CardRenderer.render({name: table.label, layout: 'table', showHeader: false, showFooter: false,
      fields: [{id: 'reading-table', binding: table.id, label: table.label, enabled: true}],
      listOptions: {rows: 10, fontSize: 14, noWrap: true, columns: table.columns.map(column => column.id)},
    }, service.cardData, [table], {timeZone: state.server?.timeZone, timeFormat: config.timeFormat, now: state.server?.now}) : '';
    const refresh = service.actions.find(action => action.id === service.polling?.actionId);
    const refreshFields = refresh?.parameters.map(field => field.id === service.polling.targetParameter
      ? `<input type="hidden" name="${field.id}" value="${escapeHtml(selected)}">`
      : this.field(field, field.default, 'reading-refresh')).join('');
    const refreshForm = refresh && selected ? `<form class="plugin-event-form" data-plugin-id="${escapeHtml(service.id)}" data-plugin-action="${refresh.id}">${refreshFields}<button class="button" type="submit" ${ready && instances.find(item => item.id === selected)?.enabled ? '' : 'disabled'}>${icon('arrows-rotate')}${escapeHtml(refresh.name)}</button></form>` : '';
    return `<section class="panel"><div class="panel-header"><h2>Current readings</h2></div><div class="panel-body">${selector}<dl class="facts">${facts}</dl>${rows}${refreshForm}</div></section>`
      + service.events.map(event => `<section class="panel"><div class="panel-header"><h2>${escapeHtml(event.name)}</h2></div><div class="panel-body"><p>${escapeHtml(event.description)}</p><p class="field-help">${event.occurrenceKey ? 'Each distinct matching occurrence can start a Task.' : 'A filtered Task starts when its condition becomes true.'}</p><div class="event-properties"><table><thead><tr><th>Property</th><th>Type</th><th>Task value</th></tr></thead><tbody>${event.payload.filter(field => field.format !== 'secret' && ['string', 'number', 'boolean'].includes(field.type)).map(field => `<tr><td>${escapeHtml(field.label)}${field.required ? '' : ' (optional)'}</td><td>${escapeHtml(field.type)}</td><td><code>{{event.${escapeHtml(field.id)}}}</code></td></tr>`).join('')}</tbody></table></div></div></section>`).join('');
  },

  events(service) {
    if (service.settingsLookup) return this.catalogEvents(service);
    const enabled = service.enabled && service.configurationReady && service.health === 'ready' && !state.paused;
    const unavailableReason = !service.enabled ? `Enable ${service.name} in Settings to produce events.`
      : !service.configurationReady ? 'Complete plugin configuration in Settings to produce events.'
      : service.health !== 'ready' ? 'The plugin runtime is unavailable. Check its status and Log.'
      : state.paused ? 'Enable server functions in Overview to produce events.' : '';
    // State labels/types are declaration-owned, just like Card fields. In
    // particular, timestamps must honor global time preferences rather than
    // exposing an epoch number or a provider's undated observation string.
    const instances = service.instances ? service.config.settings[service.instances.setting] || [] : [];
    const selected = instances.find(item => item.id === this.valueInstances.get(service.id))?.id || instances[0]?.id;
    const sources = service.instances ? service.cardCatalog.filter(field => field.instanceId === selected)
      : service.cardFields.filter(field => ['state', 'rows'].includes(field.source.kind));
    const itemLabel = service.settings?.find(field => field.id === service.instances?.setting)?.itemLabel || 'instance';
    const selector = instances.length ? `<div class="plugin-event-form plugin-value-selector">${this.field({
      id: 'instance', label: itemLabel[0].toUpperCase() + itemLabel.slice(1), type: 'string',
      enum: instances.map(item => item.id),
      enumLabels: instances.map(item => `${item.name}${item.enabled ? '' : ' (Disabled)'}`),
    }, selected, 'current-value')}</div>` : '';
    const facts = sources.filter(field => field.type !== 'webpage').map(field => {
      const datum = service.cardData.values[field.id];
      const value = !datum?.available ? 'No data' : field.type === 'timestamp'
        ? formatServerTimestamp(datum.value) : field.type === 'boolean'
          ? datum.value ? 'Yes' : 'No' : datum.value;
      const table = field.type === 'table' ? CardRenderer.render({ name: field.label, layout: 'table', showHeader: false, showFooter: false,
        fields: [{ id: 'current-table', binding: field.id, label: field.label, enabled: true }],
        listOptions: { rows: 10, fontSize: 14, noWrap: true, columns: field.columns.map(column => column.id) } },
        service.cardData, [field], { timeZone: state.server?.timeZone, timeFormat: config.timeFormat, now: state.server?.now }) : null;
      return `<div${table ? ' class="plugin-table-fact"' : ''}><dt>${escapeHtml(field.label)}</dt><dd>${table ?? escapeHtml(value)}</dd></div>`;
    });
    return `<section class="panel"><div class="panel-header"><h2>Current values</h2></div><div class="panel-body">${selector}<dl class="facts">${facts.length ? facts.join('') : '<div><dt>Values</dt><dd>None yet</dd></div>'}</dl></div></section>
      ${service.events.map(event => {
        const action = service.actions.find(action => action.id === event.testAction);
        return `<section class="panel"><div class="panel-header"><h2>${icon('tower-broadcast')} ${escapeHtml(event.name)}</h2></div><div class="panel-body"><p class="plugin-event-description">${escapeHtml(event.description)}</p>${action ? `<form class="plugin-event-form" data-plugin-id="${escapeHtml(service.id)}" data-plugin-action="${escapeHtml(action.id)}">${action.parameters.map(field => this.field(field, service.pluginState?.[field.id] ?? field.default, `event-${event.id}`)).join('')}<button class="button primary" type="submit" ${enabled ? '' : 'disabled'}>${icon('paper-plane')}${escapeHtml(action.name)}</button></form>` : ''}</div></section>`;
      }).join('')}${enabled ? '' : `<p class="aside-note">${escapeHtml(unavailableReason)}</p>`}`;
  },

  showError(message) {
    const error = document.querySelector('#plugin-error');
    if (error) { error.textContent = message; error.hidden = false; }
    else notify(message);
  },

  async save(id, patch, revision) {
    if (this.pending) return;
    this.pending = true;
    const form = document.querySelector('#plugin-settings-form');
    const fields = form?.querySelector('fieldset');
    const focusId = document.activeElement?.id;
    if (fields) fields.disabled = true;
    const service = state.services.find(service => service.id === id);
    try {
      await mutate(`api/plugins/${id}/config`, { revision: revision ?? service.config.revision, ...patch });
      notify('Plugin settings saved');
    } catch (error) {
      // Reload the committed revision without replacing a focused failed draft.
      // A retry still uses its captured revision until the workspace is refreshed.
      await refreshState(false).catch(() => {});
      this.showError(error.message);
    } finally {
      this.pending = false;
      if (fields?.isConnected) fields.disabled = false;
      if (currentView === id && focusId) document.getElementById(focusId)?.focus({preventScroll: true});
    }
  },

  async handleAction(action, id, control) {
    const service = state.services.find(service => service.id === currentView);
    if (action === 'plugin-source-action') {
      await this.runSourceAction(service, control);
    } else if (action === 'plugin-find-source') {
      this.openLookup(service);
    } else if (action === 'plugin-use-source') {
      const context = dialogContext;
      const match = context.matches?.[Number(id)];
      if (!match || context.pluginId !== service.id) return;
      if (service.config.revision !== context.revision) return showFormError(`Plugin settings changed. Close and reopen the ${context.itemLabel} search.`);
      const field = service.settings.find(field=>field.id===service.settingsLookup.setting);
      this.openItem(service,field,'add',null,{name:match.name.slice(0,32),[service.settingsLookup.valueField]:match.id,enabled:false});
    } else if (action === 'plugin-item-option') {
      const input = dialog.querySelector(`[name="${id}"]`);
      input.value = String(input.value !== 'true');
      control.setAttribute('aria-checked', input.value);
    } else if (action.startsWith('plugin-list-')) {
      const field = service.settings.find(field => field.id === control.dataset.setting);
      const operation = action.slice('plugin-list-'.length);
      if (operation === 'toggle') {
        const items = structuredClone(service.config.settings[field.id]);
        const item = items.find(item => item.id === id);
        item.enabled = !item.enabled;
        await this.save(service.id, { settings: { ...service.config.settings, [field.id]: items } });
        this.render(state.services.find(candidate => candidate.id === service.id));
      } else this.openItem(service, field, operation, id);
    } else if (action === 'plugin-tab') {
      this.tabs.set(service.id, id);
      this.glyphSearch = '';
      this.render(service);
      document.querySelector(`#plugin-tab-${id}`).focus({ preventScroll: true });
    } else if (action === 'plugin-glyph' || action === 'plugin-glyph-default') {
      const iconName = action === 'plugin-glyph-default'
        ? service.declarationIcon
        : control.dataset.glyph;
      await this.save(id, { icon: iconName });
    }
  },

  async submit(form) {
    if (this.pending) return;
    const service = state.services.find(service => service.id === form.dataset.pluginId);
    const action = service.actions.find(action => action.id === form.dataset.pluginAction);
    const button = form.querySelector('[type="submit"]');
    this.pending = true;
    button.disabled = true;
    try {
      const reply = await mutate(`api/plugins/${service.id}/actions/${action.id}`, { parameters: this.readFields(action.parameters, form) });
      notify(reply.result?.skipped || `${action.name} completed`);
    } catch (error) { this.showError(error.message); }
    finally { this.pending = false; if (button.isConnected) button.disabled = false; }
  },
};

document.addEventListener('toggle', event => {
  const guide = event.target;
  // Native details toggles are queued. Ignore a detached previous rendering so
  // polling cannot overwrite the current user's expanded/collapsed preference.
  if (!guide.isConnected || !guide.matches('[data-plugin-guide]')) return;
  if (guide.open) PluginUI.openGuides.add(guide.dataset.pluginGuide);
  else PluginUI.openGuides.delete(guide.dataset.pluginGuide);
}, true);

document.addEventListener('input', event => {
  if (event.target.id !== 'glyph-search') return;
  PluginUI.glyphSearch = event.target.value;
  const service = state.services.find(service => service.id === currentView);
  document.querySelector('#glyph-choices').innerHTML = PluginUI.glyphChoices(service);
});

document.addEventListener('change', event => {
  if (event.target.id === 'current-value-instance') {
    PluginUI.valueInstances.set(currentView, event.target.value);
    PluginUI.render(state.services.find(service => service.id === currentView));
    document.querySelector('#current-value-instance')?.focus();
    return;
  }
  const form = event.target.closest('#plugin-settings-form');
  if (!form) return;
  const service = state.services.find(service => service.id === form.dataset.pluginId);
  void PluginUI.save(service.id, { settings: PluginUI.readFields(service.settings, form) }, Number(form.dataset.revision));
});

document.addEventListener('keydown', event => {
  if (!event.target.matches('[role="tab"][data-action="plugin-tab"]')) return;
  const tabs = [...document.querySelectorAll('[role="tab"][data-action="plugin-tab"]')];
  const index = tabs.indexOf(event.target);
  const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
    : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
    : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
  if (next >= 0) {
    event.preventDefault();
    tabs[next].click();
  }
});
