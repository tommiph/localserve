/** Tasks and ordered action blocks. All saves and runs go through the server. */
const TaskUI = {
  search: '',
  stepTypes: { log: 'Log activity', delay: 'Delay', 'show-vista': 'Show Vista' },
  ruleTypes: { schedule: 'Schedule', timer: 'Timer', interval: 'Interval', sunrise: 'Sunrise', sunset: 'Sunset', event: 'Event' },
  librarySearch: '',
  libraryCategory: 'all',
  replaceStepId: null,

  categoryFor(type) {
    return 'server';
  },

  glyphFor(type) {
    return { log: 'clipboard-list', delay: 'hourglass-half', 'show-vista': 'display', timer: 'hourglass-start', interval: 'arrows-rotate', sunrise: 'sun', sunset: 'moon', event: 'tower-broadcast', schedule: 'calendar' }[type] || 'bolt';
  },

  renderLibrary() {
    // Categories and capabilities come from the current server declaration list.
    // Disabled/unready plugin actions remain visible but unavailable for insertion.
    return `<aside class="action-library" aria-label="Action library"><h3>Action library</h3><label class="library-search">${icon('magnifying-glass')}<input id="action-search" type="search" aria-label="Search actions" placeholder="Search actions"></label>
      <label class="library-filter">Plugin<select id="action-plugin-filter"><option value="all">All plugins and Server</option><option value="server">Server</option>${state.services.map(plugin => `<option value="${escapeHtml(plugin.id)}">${escapeHtml(plugin.name)}</option>`).join('')}</select></label>
      <div id="task-library-mode">${this.libraryMode()}</div><label class="library-insertion">Add as<select id="insert-after"><option value="end">Last step</option><option value="first">First step</option></select></label>
      <div id="library-actions">${this.libraryRows()}</div></aside>`;
  },

  libraryRows() {
    const actions = actionCatalog.filter(action => (this.libraryCategory === 'all' || action.category === this.libraryCategory) && `${action.pluginName || 'Server'} ${action.name} ${action.description}`.toLowerCase().includes(this.librarySearch.toLowerCase()));
    return actions.length ? actions.map(action => `<div class="library-choice"><button class="library-action" type="button" data-action="task-library-add" data-id="${escapeHtml(action.id)}" aria-label="${this.replaceStepId ? 'Replace selected step with' : 'Add'} ${escapeHtml(action.name)}" ${action.available === false ? 'disabled' : ''}><span class="task-block-icon ${escapeHtml(action.category)}">${icon(action.icon || this.glyphFor(action.type))}</span><span><strong>${escapeHtml(action.name)}</strong><span class="library-owner">${escapeHtml(action.pluginName || 'Server')}</span><small>${escapeHtml(action.description)}</small></span>${icon(this.replaceStepId ? 'swap-horiz' : 'plus')}</button>${action.available === false ? `<p class="library-unavailable">${escapeHtml(action.unavailableReason || 'Configure and enable the owning plugin to use this action.')}</p>` : ''}</div>`).join('') : '<div class="empty-state">No actions match this search and plugin filter.</div>';
  },

  libraryMode() {
    return this.replaceStepId ? '<p class="aside-note">Choose an action to replace the highlighted step and its parameters.</p><button class="button" type="button" data-action="task-replace-cancel">Cancel replacement</button>' : '';
  },

  refreshLibrary() {
    dialog.querySelector('#library-actions').innerHTML = this.libraryRows();
    const select = dialog.querySelector('#action-plugin-filter');
    if (select) select.value = this.libraryCategory;
    const mode = dialog.querySelector('#task-library-mode');
    if (mode) mode.innerHTML = this.libraryMode();
    const insertion = dialog.querySelector('.library-insertion');
    if (insertion) insertion.hidden = Boolean(this.replaceStepId);
    dialog.querySelectorAll('[data-action="task-library-filter"]').forEach(button => button.setAttribute('aria-pressed', button.dataset.id === this.libraryCategory));
  },

  // Each added card gets unique label IDs; helper text remains a description.
  field(label, glyph, input, help = '') {
    const id = `task-field-${crypto.randomUUID()}`;
    const accessibleInput = input.replace(/<(input|select|textarea)/, `<$1 id="${id}"${help ? ` aria-describedby="${id}-help"` : ''}`);
    return `<div class="field"><label class="field-label" for="${id}">${icon(glyph)}${escapeHtml(label)}</label>${accessibleInput}${help ? `<span class="field-help" id="${id}-help">${escapeHtml(help)}</span>` : ''}</div>`;
  },

  options(items, selected) {
    const options = items.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`);
    if (selected && !items.some(item => item.id === selected)) options.push(`<option value="${escapeHtml(selected)}" selected>Unavailable item</option>`);
    return options.join('');
  },

  taskSummary(task) {
    return AdminUX.taskActivation(task, state.paused);
  },

  renderTasks() {
    return pageHeading('Tasks', 'Server tasks and their running order', `${this.recipeEntry()}<button class="button primary" data-action="task-add">${icon('plus')}Add task</button>`) +
      `<section class="panel"><div class="panel-header"><h2>Tasks <span class="panel-count">${state.tasks.length}</span></h2><label class="service-search">${icon('magnifying-glass')}<input id="task-search" type="search" aria-label="Search tasks" placeholder="Search tasks" value="${escapeHtml(this.search)}"></label></div><div id="task-rows">${this.rows()}</div></section>` + this.activeNotice();
  },

  recipeEntry() {
    // Optional builders remain opt-in; navigation never enables a plugin.
    const builder = state.services.find(service => service.taskBuilder);
    if (!builder) return '';
    return builder.enabled
      ? `<button class="button" data-action="task-recipe" data-id="${escapeHtml(builder.id)}">${icon('auto-awesome')}Build a task</button>`
      : `<button class="button" data-view="${escapeHtml(builder.id)}">${icon('auto-awesome')}Set up Recipes</button>`;
  },

  activeNotice() {
    const notice = state.tvNotice;
    if (!notice?.active) return '';
    const elapsed = notice.shownAt ? `Open for ${formatDuration(Math.max(0, (state.server.now - notice.shownAt) / 1000))}` : 'Waiting for display';
    return `<section class="panel plugin-log"><div class="panel-header"><h2>${icon('bell')}Active TV notice</h2><button class="button" type="button" data-action="task-dismiss-notice" data-revision="${notice.revision}" ${notice.dismissing ? 'disabled' : ''}>${notice.dismissing ? 'Dismissing…' : 'Dismiss notice'}</button></div><div class="panel-body"><p>${elapsed} · ${notice.autoClose ? 'Automatic close enabled' : 'Stays open until dismissed'}</p><p class="field-help">Dismissal stops the chime and closes the notice when its page reconnects. The TV’s Back button also dismisses it.</p></div></section>`;
  },

  runSummary(task) {
    // Inspect retained receipts by stable Task identity, without sorting state.
    const run = (state.runs || []).filter(item => item.taskId === task.id && Number.isFinite(item.startedAt))
      .reduce((latest, item) => !latest || item.startedAt > latest.startedAt ? item : latest, null);
    if (!run) return '<p>No retained runs</p>';
    const labels = {running:'Running', completed:'Completed', failed:'Failed', cancelled:'Cancelled', interrupted:'Interrupted'};
    return `<p class="task-last-run">Last run: ${escapeHtml(labels[run.status] || 'Result unavailable')} · ${escapeHtml(formatServerTimestamp(run.startedAt))} <button type="button" class="text-button" data-action="task-view-runs" data-id="${escapeHtml(task.id)}" aria-label="View runs for ${escapeHtml(task.name)}">View runs</button></p>`;
  },

  rows() {
    const tasks = state.tasks.filter(task => `${task.name} ${this.taskSummary(task)}`.toLowerCase().includes(this.search.toLowerCase()));
    if (!tasks.length) return '<div class="empty-state">No tasks found.</div>';
    return tasks.map(task => `<div class="settings-item task-row" data-live-key="task:${escapeHtml(task.id)}"><span class="service-icon">${icon('list-check')}</span><div class="settings-text"><h3>${escapeHtml(task.name)}</h3><p>${escapeHtml(this.taskSummary(task))}</p>${this.runSummary(task)}</div><button class="button" data-action="task-run" data-id="${escapeHtml(task.id)}" title="Run ${escapeHtml(task.name)}" aria-label="Run ${escapeHtml(task.name)}" ${!task.enabled || state.paused ? 'disabled' : ''}>${icon('play')}Run</button>${itemActions(task, 'task')}</div>`).join('');
  },

  weekdayFields(item) {
    // Render Monday first while retaining saved Date-compatible weekday values.
    // Changing the presentation must not shift existing Monday/Sunday schedules.
    const weekdays = [
      { name: 'Mon', value: 1 }, { name: 'Tue', value: 2 },
      { name: 'Wed', value: 3 }, { name: 'Thu', value: 4 },
      { name: 'Fri', value: 5 }, { name: 'Sat', value: 6 },
      { name: 'Sun', value: 0 },
    ];
    return `<fieldset class="weekday-fields"><legend>${icon('calendar')}Days</legend>${weekdays.map(day => `<label><input type="checkbox" name="days" value="${day.value}" ${(item.days || [0, 1, 2, 3, 4, 5, 6]).includes(day.value) ? 'checked' : ''}>${day.name}</label>`).join('')}</fieldset>`;
  },

  ruleFields(rule) {
    if (rule.type === 'schedule') {
      return this.field('Time', 'clock', TimeUI.render(rule.time || '19:00')) + this.weekdayFields(rule);
    }
    if (rule.type === 'timer' || rule.type === 'interval') {
      return this.field('Duration (seconds)', this.glyphFor(rule.type), `<input name="seconds" type="number" min="1" max="31536000" step="any" required value="${rule.seconds ?? 60}">`);
    }
    if (rule.type === 'sunrise' || rule.type === 'sunset') {
      // Every solar rule uses the same server setting; no per-rule overrides.
      return `<p class="field-help">${config.location ? `Server location: ${config.location.latitude}, ${config.location.longitude}` : 'Set Server location in Settings to run this rule.'}</p>` + this.weekdayFields(rule);
    }
    return this.field('Find an Event', 'magnifying-glass', '<input type="search" data-event-search placeholder="Search phone, sensor or Event name">')
      + this.field('Plugin event', 'tower-broadcast', `<select name="eventId" required>${this.eventOptions(rule.eventId)}</select>`, 'Events are grouped by plugin. Searching keeps the current selection until you choose another.') +
      `<div data-event-condition>${this.eventConditionFields(rule)}</div>`;
  },

  eventOptions(selected, search = '') {
    const all = state.taskEvents || [], query = search.trim().toLocaleLowerCase();
    const matches = all.filter(event => `${event.pluginName} ${event.name} ${event.id}`.toLocaleLowerCase().includes(query));
    const groups = new Map();
    for (const event of matches) {
      const group = event.pluginName || event.pluginId;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({id:event.id, name:event.name + (event.available === false ? ' · Unavailable' : '')});
    }
    const chosen = all.find(event => event.id === selected);
    const retained = selected && !matches.some(event => event.id === selected)
      ? `<optgroup label="Current selection">${this.options([{id:selected, name:chosen ? `${chosen.pluginName} · ${chosen.name}` : 'Unavailable Event'}], selected)}</optgroup>` : '';
    return `<option value="">${!all.length ? 'No plugin events available' : !matches.length ? 'No matching Events' : 'Select Event'}</option>`
      + retained + [...groups].map(([group, events]) => `<optgroup label="${escapeHtml(group)}">${this.options(events, selected)}</optgroup>`).join('');
  },

  searchEvents(input) {
    const select = input.closest('.task-block').querySelector('[name="eventId"]');
    const selected = select.value;
    select.innerHTML = this.eventOptions(selected, input.value);
    select.value = selected;
  },

  conditionOperators(type) {
    if (type === 'number') return { eq: 'Equals', ne: 'Does not equal', gt: 'Greater than', gte: 'At least', lt: 'Less than', lte: 'At most' };
    if (type === 'string') return { eq: 'Equals', ne: 'Does not equal', contains: 'Contains text' };
    return { eq: 'Equals', ne: 'Does not equal' };
  },

  eventConditionFields(rule) {
    const event = (state.taskEvents || []).find(event => event.id === rule.eventId);
    if (!event) return rule.condition
      ? `<p class="field-help">Event condition unavailable; saved comparison retained.</p><input type="hidden" name="unavailableCondition" value="${escapeHtml(JSON.stringify(rule.condition))}">` : '';
    const fields = event.payload || [];
    if (!fields.length) return '';
    const field = fields.find(field => field.id === rule.condition?.field);
    let html = this.field('Condition', 'sliders', `<select name="conditionField"><option value="">Any occurrence</option>${this.options(fields.map(field => ({ id: field.id, name: field.label })), rule.condition?.field)}</select>`);
    if (!field) return html;
    const operators = this.conditionOperators(field.type);
    html += this.field('Comparison', 'sliders', `<select name="conditionOperator">${Object.entries(operators).map(([key, label]) => `<option value="${key}" ${key === rule.condition.operator ? 'selected' : ''}>${label}</option>`).join('')}</select>`);
    const value = rule.condition.value;
    const input = field.type === 'boolean'
      ? `<select name="conditionValue"><option value="true" ${value === true ? 'selected' : ''}>Yes</option><option value="false" ${value !== true ? 'selected' : ''}>No</option></select>`
      : field.type === 'number'
        ? `<input name="conditionValue" type="number" step="any" required ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''} value="${escapeHtml(value ?? '')}">`
        : `<input name="conditionValue" type="text" required maxlength="${field.maxLength || 4000}" value="${escapeHtml(value ?? '')}">`;
    const triggerHelp = this.editorRuleMode==='and'
      ? 'This comparison gates the AND group. All enabled comparisons must match before a run; unknown readings block it.'
      : event.occurrenceKey
      ? 'Triggers for each distinct matching occurrence. Repeated readings of the same occurrence do not trigger again.'
      : 'Triggers when this condition becomes true. A nonmatching reading rearms it. The first matching reading can trigger.';
    const textHelp = field.type === 'string' ? ' Contains text matches anywhere in the value and ignores letter case.' : '';
    return html + this.field('Value', field.type === 'boolean' ? 'toggle-on' : 'gauge', input, triggerHelp + textHelp);
  },

  changeEventCondition(control) {
    const card = control.closest('.task-block');
    const rule = this.readCard(card);
    if (control.name === 'eventId') delete rule.condition;
    else {
      const field = state.taskEvents.find(event => event.id === rule.eventId)?.payload?.find(field => field.id === control.value);
      rule.condition = field ? { field: field.id, operator: 'eq', value: field.type === 'boolean' ? true : field.type === 'number' ? 0 : '' } : null;
    }
    // Replace only dependent controls: the captured draft, rule name, enabled
    // state, and editor geometry remain untouched while choosing a condition.
    card.querySelector('[data-event-condition]').innerHTML = this.eventConditionFields(rule);
    if (control.name === 'conditionField') card.querySelector('[name="conditionField"]')?.focus();
    this.updateSummary(card);
    this.refreshEventPickers();
  },

  eventValueOptions() {
    const starts = dialog.querySelector('#task-starts');
    const rules = starts ? [...starts.children].map(card => this.readCard(card)) : this.editorStarts || [];
    // Disabled rules still describe a Task's accepted Event values: the user
    // can test them manually with history before enabling automatic dispatch.
    const events = [...new Set(rules.filter(rule => rule.type === 'event').map(rule => rule.eventId))]
      .map(id => (state.taskEvents || []).find(event => event.id === id)).filter(Boolean);
    return '<option value="">Insert event value…</option>' + events.map(event => `<optgroup label="${escapeHtml(`${event.pluginName} · ${event.name}`)}">${(event.payload || []).filter(field => field.format !== 'secret' && ['string', 'number', 'boolean'].includes(field.type)).map(field => `<option value="${escapeHtml(field.id)}">${escapeHtml(field.label)} · ${field.type}${field.required ? '' : ' · optional'}</option>`).join('')}</optgroup>`).join('');
  },

  refreshEventPickers() {
    const options = this.eventValueOptions();
    dialog.querySelectorAll('[data-event-value-picker]').forEach(select => { select.innerHTML = options; });
    dialog.querySelectorAll('.task-step').forEach(card => this.refreshBindingHints(card));
  },

  draftRules() {
    const starts = dialog.querySelector('#task-starts');
    return starts ? [...starts.children].map(card => this.readCard(card)) : this.editorStarts || [];
  },

  bindingHints(value, rules = this.draftRules()) {
    if (typeof value !== 'string' || !value.includes('{{')) return '';
    const keys = [...new Set([...value.matchAll(/\{\{event\.([a-zA-Z0-9_-]+)\}\}/g)].map(match => match[1]))];
    const sources = rules.filter(rule => rule.type === 'event').map(rule => (state.taskEvents || []).find(event => event.id === rule.eventId));
    const malformed = value.replace(/\{\{event\.([a-zA-Z0-9_-]+)\}\}/g, '').match(/\{\{|\}\}/);
    const chips = keys.map(key => {
      const fields = sources.map(source => source?.payload?.find(field => field.id === key && field.format !== 'secret' && ['string', 'number', 'boolean'].includes(field.type)));
      const field = fields.find(Boolean);
      return `<span class="binding-chip ${field ? '' : 'missing'}" title="${escapeHtml('{{event.' + key + '}}')}">${icon(field ? 'link' : 'triangle-exclamation')}${escapeHtml(field?.label || key)}${field ? field.required ? '' : ' · optional' : ' · missing binding'}</span>${field && fields.some(item => !item) ? '<span class="binding-warning">Not supplied by every selected Event.</span>' : ''}`;
    }).join('');
    return chips + (malformed ? '<span class="binding-warning">Use {{event.field-id}} for Event values.</span>' : '')
      + (rules.some(rule => rule.type !== 'event') ? '<span class="binding-warning">Schedule and timer starts do not supply Event values.</span>' : '');
  },

  refreshBindingHints(card) {
    card.querySelectorAll('[data-binding-parameter]').forEach(node => {
      const input = card.querySelector(`[name="${node.dataset.bindingParameter}"]`);
      node.innerHTML = this.bindingHints(input?.value || '');
    });
  },

  insertEventValue(select) {
    if (!select.value) return;
    const input = select.closest('.task-block').querySelector(`[name="${select.dataset.parameter}"]`);
    const token = `{{event.${select.value}}}`;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    if (input.maxLength >= 0 && input.value.length - (end - start) + token.length > input.maxLength) {
      select.value = '';
      return showFormError('This event value would exceed the parameter length limit.');
    }
    input.setRangeText(token, start, end, 'end');
    select.value = '';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.focus();
  },

  parameterFields(step, action) {
    return PluginUI.groupFields(action.parameters,field => {
      const selected = step.parameters?.[field.id];
      if (action.controlScene && selected && field.enum && !field.enum.includes(selected)) {
        field = {...field, enum: [...field.enum, selected], enumLabels: [...field.enumLabels, 'Unavailable lighting scene']};
      }
      let input = PluginUI.field(field, step.parameters?.[field.id] ?? field.default, `step-${step.id || crypto.randomUUID()}`);
      if (action.id === 'plugin:samsung-tv:show-notice') {
        if (field.id === 'seconds') input = `<div data-notice-duration ${step.parameters?.['auto-close'] === false ? 'hidden' : ''}>${input}</div>`;
        if (field.id === 'loop-sound' && !step.parameters?.sound) input = input.replace('<input ', '<input disabled ');
      }
      if (field.type !== 'string' || field.enum || field.format === 'secret') return input;
      return `${input}<label class="event-value-picker">${escapeHtml(field.label)} event value<select data-event-value-picker data-parameter="${field.id}">${this.eventValueOptions()}</select></label><div class="event-binding-hints" data-binding-parameter="${field.id}">${this.bindingHints(step.parameters?.[field.id])}</div>`;
    },step.id || action.id);
  },

  eventValueHelp() {
    return '<p class="aside-note">Add an Event rule to use its public values. Text fields and Log activity accept {{event.field-id}}. Run lets you select saved Event values from Task history; Rerun uses the selected run’s values. Schedules provide no Event values. Missing required values stop the Task before any step runs.</p>';
  },

  stepFields(step) {
    if (step.type === 'show-vista') return this.field('Vista', 'display', `<select name="vistaId"><option value="">Select Vista</option>${this.options((state.vistas || []).map(vista => ({ id: vista.id, name: vista.name + (vista.enabled ? '' : ' (Disabled)') })), step.vistaId)}</select>`, 'Changes the shared /display page. The selected Vista must be enabled when the Task runs.');
    if (step.type === 'log') return this.field('Message', 'comment', `<textarea name="message" maxlength="2000" rows="3">${escapeHtml(step.message || '')}</textarea>`)
      + `<label class="event-value-picker">Message event value<select data-event-value-picker data-parameter="message">${this.eventValueOptions()}</select></label><div class="event-binding-hints" data-binding-parameter="message">${this.bindingHints(step.message)}</div>` + this.eventValueHelp();
    if (step.type === 'delay') return this.field('Duration (seconds)', 'hourglass-half', `<input name="seconds" type="number" min="0.01" max="86400" step="any" value="${step.seconds ?? 5}">`);
    const action = actionCatalog.find(action => action.id === step.capabilityId);
    if (!action) return `<p class="aside-note">This capability is unavailable.</p><input type="hidden" name="unavailableParameters" value="${escapeHtml(JSON.stringify(step.parameters || {}))}">`;
    const textParameters = action.parameters.some(field => field.type === 'string' && !field.enum && field.format !== 'secret');
    const eventHelp = textParameters ? this.eventValueHelp() : '';
    const noticePreview = action.id === 'plugin:samsung-tv:show-notice'
      ? '<button type="button" class="button" data-action="task-preview-notice">Preview notice</button><p class="aside-note">Preview is silent. Automatic close returns after the display time; otherwise use Back or Tasks → Dismiss notice. An active Vista is restored; otherwise only the Vista TV app closes. TV volume and mute are unchanged.</p>' : '';
    return `${action.available ? '' : `<p class="aside-note">${escapeHtml(action.unavailableReason || 'Plugin unavailable. Saved parameters are retained.')}</p>`}${this.parameterFields(step, action)}${eventHelp}${noticePreview}`;
  },

  card(item, group, open = false) {
    const types = group === 'start' ? this.ruleTypes : Object.fromEntries(actionCatalog.map(action => [action.type === 'plugin' ? action.id : action.type, action.type === 'plugin' ? `${action.pluginName} · ${action.name}` : action.name]));
    const selectedType = item.type === 'plugin' ? item.capabilityId : item.type;
    if (item.type === 'plugin' && !types[selectedType]) types[selectedType] = 'Unavailable plugin action';
    const nameEdited = item.nameEdited ?? Boolean(item.name && !Object.values(this.ruleTypes).includes(item.name));
    const fields = group === 'start' ? this.field('Rule name', 'tag', `<input name="startName" maxlength="64" value="${escapeHtml(item.name || this.ruleTypes[item.type])}">`) + this.ruleFields(item) : this.stepFields(item);
    return `<article class="task-block task-${group}" data-group="${group}" data-block-type="${escapeHtml(selectedType)}">
      <input type="hidden" name="blockId" value="${escapeHtml(item.id || crypto.randomUUID())}"><input type="hidden" name="blockEnabled" value="${item.enabled !== false}">
      ${group === 'start' ? `<input type="hidden" name="ruleNameEdited" value="${nameEdited}">` : ''}
      ${group === 'start' ? '<span class="task-rule-or">OR</span>' : ''}<div class="task-block-header"><span class="task-block-icon ${this.categoryFor(item.type)}">${icon(actionCatalog.find(action => action.id === item.capabilityId)?.icon || this.glyphFor(item.type))}</span><span class="step-number"></span>${group === 'start' ? `<select name="blockType" data-task-type aria-label="Rule type">${Object.entries(types).map(([type, label]) => `<option value="${escapeHtml(type)}" ${selectedType === type ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>` : `<input type="hidden" name="blockType" value="${escapeHtml(selectedType)}"><strong class="task-step-title">${escapeHtml(types[selectedType] || 'Unavailable action')}</strong><button class="text-button" type="button" data-action="task-replace">Replace</button>`}
        <div class="row-actions">${group === 'step' ? `<button class="icon-button" type="button" data-action="task-block-up" aria-label="Move step up">${icon('arrow-up')}</button><button class="icon-button" type="button" data-action="task-block-down" aria-label="Move step down">${icon('arrow-down')}</button>` : ''}
          <button class="icon-button" type="button" data-action="task-block-edit" aria-label="Edit ${group}">${icon('pen')}</button><button class="icon-button" type="button" data-action="task-block-copy" aria-label="Copy ${group}">${icon('copy')}</button><button class="icon-button delete" type="button" data-action="task-block-delete" aria-label="Delete ${group}">${icon('trash-can')}</button><button class="switch" type="button" role="switch" aria-checked="${item.enabled !== false}" data-action="task-block-toggle" aria-label="${group === 'start' ? 'Rule' : 'Step'} enabled"></button>
        </div></div><button class="task-block-summary" type="button" data-action="task-block-edit" title="Edit parameters"></button><div class="task-block-fields" ${open ? '' : 'hidden'}>${fields}</div>
    </article>`;
  },

  openEditor(id, copy = false, draft = null) {
    // Capture the original revision in dialogContext. Polling may update saved
    // state while this modal is open; it must not advance the draft's revision.
    const existing = state.tasks.find(task => task.id === id);
    const task = existing || draft || { name: '', enabled: false, starts: [], steps: [] };
    this.editorStarts = task.starts;
    this.editorRuleMode = task.ruleMode || 'or';
    this.replaceStepId = null;
    this.librarySearch = ''; this.libraryCategory = 'all';
    showDialog(`<form id="editor-form">${dialogHeader(existing ? `${copy ? 'Copy' : 'Edit'} task` : 'Add task')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>
      <div class="field-row">${this.field('Task name', 'tag', `<input name="name" required maxlength="48" value="${escapeHtml(copy ? task.name + ' copy' : task.name)}">`)}<label class="check-field task-enabled"><input name="enabled" type="checkbox" ${task.enabled && !copy ? 'checked' : ''}>Task enabled</label></div>
      <details class="editor-help"><summary>How Task activation works</summary><p>Task enabled permits runs. OR lets any enabled rule start it. AND combines the latest reported comparisons; all enabled rules must match. AND does not merge Event values: action text uses the report that starts the run. Enabled steps run in order. With no enabled rules, use manual Run.</p></details><div class="task-designer"><div class="task-canvas"><section class="task-editor-section"><div class="task-section-heading"><div><h3>Start task when</h3><p id="task-rule-help">${this.ruleModeHelp(task.ruleMode)}</p></div><label class="task-rule-mode">Combine rules<select name="ruleMode" aria-label="Combine rules" aria-describedby="task-rule-help"><option value="or" ${task.ruleMode!=='and'?'selected':''}>OR · Any rule</option><option value="and" ${task.ruleMode==='and'?'selected':''} ${state.server?.taskRuleModes?.includes('and')?'':'disabled'}>AND · All rules</option></select></label></div><div id="task-starts">${task.starts.map(start => this.card(copy ? { ...start, id: crypto.randomUUID() } : start, 'start')).join('')}</div><div class="task-add-controls"><button class="button" type="button" data-action="task-add-rule">${icon('calendar')}Add rule</button></div></section>
      <section class="task-editor-section"><div class="task-section-heading"><div><h3>Run these steps in order</h3><p>Choose actions from the library. Tap a block’s parameters to edit them.</p></div></div><div id="task-steps">${task.steps.map(step => this.card(copy ? { ...step, id: crypto.randomUUID() } : step, 'step')).join('')}</div><button class="button add-action-button" type="button" data-action="task-focus-library">${icon('plus')}Add action</button></section></div>${this.renderLibrary()}</div>
      ${copy ? '<p class="aside-note">The copied task starts disabled.</p>' : ''}</div>${dialogFooter(existing && !copy ? 'Save changes' : 'Create task')}</form>`, { kind: 'task', id, copy, revision: existing?.revision });
    this.numberCards();
  },

  ruleModeHelp(mode) {
    return mode==='and' ? 'All enabled comparisons must match their latest reports. Add a comparison to each Event rule. Time rules must fall due together; comparisons gate that moment.' : 'Any enabled rule can start this Task. With no enabled rules, use manual Run.';
  },

  numberCards() {
    if (this.replaceStepId && ![...dialog.querySelectorAll('.task-step')].some(card => this.readCard(card).id === this.replaceStepId)) this.clearReplacement();
    this.refreshEventPickers();
    for (const group of ['start', 'step']) {
      dialog.querySelectorAll(`.task-${group}`).forEach((card, index) => {
        this.updateSummary(card);
        card.querySelector('.step-number').textContent = `${group === 'start' ? 'Rule' : 'Step'} ${index + 1}`;
        card.querySelector('[data-action="task-block-up"]')?.toggleAttribute('disabled', index === 0);
        card.querySelector('[data-action="task-block-down"]')?.toggleAttribute('disabled', index === dialog.querySelectorAll(`.task-${group}`).length - 1);
      });
    }
    const insertion = dialog.querySelector('#insert-after');
    if (insertion) {
      const selected = insertion.value;
      // Anchors remain preceding card IDs; labels name the inserted position.
      insertion.innerHTML = '<option value="end">Last step</option><option value="first">First step</option>' + [...dialog.querySelectorAll('.task-step')].map((card, index) => `<option value="${escapeHtml(this.readCard(card).id)}">Step ${index + 2}</option>`).join('');
      insertion.value = [...insertion.options].some(option => option.value === selected) ? selected : 'end';
    }
  },

  syncNoticeOptions(card) {
    if (card.dataset.blockType !== 'plugin:samsung-tv:show-notice') return;
    const duration = card.querySelector('[data-notice-duration]');
    if (duration) duration.hidden = !card.querySelector('[name="auto-close"]').checked;
    const loop = card.querySelector('[name="loop-sound"]');
    if (loop) loop.disabled = !card.querySelector('[name="sound"]').checked;
  },

  updateSummary(card) {
    const item = this.readCard(card);
    let detail = item.type === 'log' ? this.bindingLabel(item.message || 'Set message') : '';
    if (item.type === 'schedule') detail = `${TimeUI.format(item.time)} · ${item.days.map(day => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', ')}`;
    if (item.type === 'timer') detail = `After ${item.seconds} seconds`;
    if (item.type === 'interval') detail = `Every ${item.seconds} seconds`;
    if (item.type === 'sunrise' || item.type === 'sunset') detail = config.location ? `Server location: ${config.location.latitude}, ${config.location.longitude}` : 'Server location required';
    if (item.type === 'event') {
      const event = (state.taskEvents || []).find(event => event.id === item.eventId);
      detail = event ? `When ${event.pluginName} · ${event.name}` : 'Select plugin event';
    }
    if (item.type === 'event' && item.condition) {
      const field = state.taskEvents.find(event => event.id === item.eventId)?.payload?.find(field => field.id === item.condition.field);
      const comparison = this.conditionOperators(field?.type)[item.condition.operator] || item.condition.operator;
      const event = state.taskEvents.find(event => event.id === item.eventId);
      detail += ` · ${field?.label || item.condition.field} ${comparison.toLowerCase()} ${typeof item.condition.value === 'boolean' ? item.condition.value ? 'Yes' : 'No' : item.condition.value} · ${this.editorRuleMode==='and' ? 'AND group comparison' : event?.occurrenceKey ? 'Each matching occurrence' : 'Once when true; nonmatching reading rearms'}`;
    }
    if (item.type === 'delay') detail = `${item.seconds} second${item.seconds === 1 ? '' : 's'}`;
    if (item.type === 'show-vista') detail = `Show Vista · ${state.vistas?.find(vista => vista.id === item.vistaId)?.name || 'Unavailable Vista'}`;
    if (item.type === 'plugin') {
      const action = actionCatalog.find(action => action.id === item.capabilityId);
      detail = `${action?.name || 'Unavailable action'}${this.parameterSummary(item, action)}`;
      if (action?.controlScene) {
        const field = action.parameters.find(field => field.id === 'scene-id');
        const index = field.enum.indexOf(item.parameters['scene-id']);
        detail = `${action.name} · ${index < 0 ? 'Unavailable lighting scene' : field.enumLabels[index]}`;
      }
      if (item.capabilityId === 'plugin:samsung-tv:show-notice') {
        const notice = item.parameters;
        detail = `Show TV notice · ${notice.template} · ${notice.title || 'Title required'} · ${notice['auto-close'] === false ? 'Until dismissed' : `${notice.seconds} seconds`} · Sound ${notice.sound ? notice['loop-sound'] ? 'looping' : 'on' : 'off'}`;
      }
    }
    card.querySelector('.task-block-summary').textContent = `${item.enabled ? 'Enabled' : 'Disabled'} · ${item.name ? item.name + ' · ' : ''}${detail}`;
    this.refreshBindingHints(card);
  },

  parameterSummary(step, action) {
    // Summaries expose declared public values and labels, never secret fields.
    return (action?.parameters || []).filter(field => field.format !== 'secret' && ['string','number','boolean'].includes(field.type)
      && step.parameters?.[field.id] !== undefined).map(field => {
      let value = step.parameters[field.id];
      const index = field.enum?.indexOf(value) ?? -1;
      if (index >= 0) value = field.enumLabels?.[index] ?? value;
      if (typeof value === 'boolean') value = value ? 'Yes' : 'No';
      if (typeof value === 'string') value = this.bindingLabel(value);
      return ` · ${field.label || field.id}: ${String(value).slice(0,120)}`;
    }).join('');
  },

  bindingLabel(value) {
    const sources = this.draftRules().filter(rule => rule.type === 'event')
      .map(rule => (state.taskEvents || []).find(event => event.id === rule.eventId));
    return value.replace(/\{\{event\.([a-zA-Z0-9_-]+)\}\}/g, (token, key) => {
      const field = sources.flatMap(source => source?.payload || []).find(field => field.id === key && field.format !== 'secret');
      return field ? `[${field.label || field.id}]` : token;
    });
  },

  clearReplacement() {
    this.replaceStepId = null;
    dialog.querySelectorAll('.task-replacing').forEach(card => card.classList.remove('task-replacing'));
    this.refreshLibrary();
  },

  readCard(card) {
    const get = name => card.querySelector(`[name="${name}"]`)?.value?.trim() || '';
    // A select emits input before change. Until replacement, read the schema
    // that produced these controls, not the newly selected action's schema.
    const item = { id: get('blockId'), type: card.dataset.blockType || get('blockType'), enabled: get('blockEnabled') === 'true' };
    if (item.type.startsWith('plugin:')) {
      item.capabilityId = item.type;
      item.type = 'plugin';
      const action = actionCatalog.find(action => action.id === item.capabilityId);
      item.parameters = action ? PluginUI.readFields(action.parameters, card) : JSON.parse(get('unavailableParameters') || '{}');
    }
    if (card.dataset.group === 'start') {
      item.name = get('startName');
      item.nameEdited = get('ruleNameEdited') === 'true';
    }
    if (item.type === 'log') Object.assign(item, { message: get('message') });
    if (item.type === 'delay') item.seconds = Number(get('seconds'));
    if (item.type === 'show-vista') item.vistaId = get('vistaId');
    if (item.type === 'timer' || item.type === 'interval') item.seconds = get('seconds') ? Number(get('seconds')) : NaN;
    if (item.type === 'event') {
      item.eventId = get('eventId');
      if (get('unavailableCondition')) item.condition = JSON.parse(get('unavailableCondition'));
      else if (get('conditionField')) {
        const field = state.taskEvents.find(event => event.id === item.eventId)?.payload?.find(field => field.id === get('conditionField'));
        const raw = get('conditionValue');
        item.condition = { field: get('conditionField'), operator: get('conditionOperator'),
          value: field?.type === 'boolean' ? raw === 'true' : field?.type === 'number' ? raw ? Number(raw) : NaN : raw };
      }
    }
    if (item.type === 'schedule') item.time = get('time');
    if (['schedule', 'sunrise', 'sunset'].includes(item.type)) item.days = [...card.querySelectorAll('[name="days"]:checked')].map(input => Number(input.value));
    return item;
  },

  validateCard(item) {
    if (item.type === 'show-vista' && !item.vistaId) return 'Select a Vista to show on the display.';
    if (item.name !== undefined && !item.name) return 'Enter a name for each rule.';
    if (item.type === 'log' && !item.message) return 'Enter an activity message.';
    if (item.type === 'delay' && (!Number.isFinite(item.seconds) || item.seconds <= 0 || item.seconds > 86400)) return 'Enter a duration greater than zero and at most 86400 seconds.';
    if (['timer', 'interval'].includes(item.type) && (!Number.isFinite(item.seconds) || item.seconds < 1 || item.seconds > 31536000)) return 'Enter a duration between 1 second and 365 days.';
    if (item.type === 'event' && !(state.taskEvents || []).some(event => event.id === item.eventId)) {
      const original = state.tasks.find(task => task.id === dialogContext?.id)?.starts.find(rule => rule.id === item.id && rule.eventId === item.eventId);
      if (!original) return 'Select an event declared by an installed plugin.';
    }
    if (item.type === 'schedule' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) return 'Enter a valid time.';
    if (['schedule', 'sunrise', 'sunset'].includes(item.type)) {
      if (!item.days.length) return 'Select at least one day.';
    }
    return '';
  },

  async submit(form) {
    // Client validation helps the editor; the server validates again before
    // persistence. Keep the draft open if a save fails or its revision is stale.
    const name = form.querySelector('[name="name"]').value.trim();
    const existing = state.tasks.find(task => task.id === dialogContext.id);
    const isNew = !existing || dialogContext.copy;
    if (state.tasks.some(task => task.name.toLowerCase() === name.toLowerCase() && (isNew || task.id !== existing.id))) return showFormError('Use a different task name.');
    const task = { id: isNew ? crypto.randomUUID() : existing.id, name, enabled: form.querySelector('[name="enabled"]').checked, ruleMode: form.querySelector('[name="ruleMode"]').value, starts: [], steps: [] };
    for (const card of form.querySelectorAll('.task-block')) {
      const item = this.readCard(card);
      const error = this.validateCard(item);
      if (error) { card.querySelector('.task-block-fields').hidden = false; showFormError(error); card.querySelector('.task-block-fields input, .task-block-fields select, .task-block-fields textarea')?.focus(); return; }
      task[card.dataset.group === 'start' ? 'starts' : 'steps'].push(item);
    }
    if (!task.steps.length) return showFormError('Add at least one step.');
    if(task.ruleMode==='and' && task.starts.some(rule=>rule.enabled && rule.type==='event' && !rule.condition))return showFormError('AND requires a comparison on every enabled Event rule.');
    if(task.ruleMode==='and' && !state.server?.taskRuleModes?.includes('and'))return showFormError('AND rules require the updated server. Refresh after the server update before saving.');
    if (!isNew) task.revision = dialogContext.revision;
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      await mutate(isNew ? 'api/tasks' : `api/tasks/${existing.id}`, task);
      closeDialog(); renderView(); restoreRowFocus(); notify('Task saved');
    } catch (error) { button.disabled = false; showFormError(error.message); }
  },

  changeType(control) {
    TimeUI.close();
    const card = control.closest('.task-block');
    const old = this.readCard(card);
    // Follow type labels only until the user edits the name. Keep that explicit
    // choice through type changes, copies, and subsequent saves/reopens.
    const next = { id: old.id, name: old.name, nameEdited: old.nameEdited, type: control.value, enabled: old.enabled };
    if (next.type.startsWith('plugin:')) {
      const action = actionCatalog.find(action => action.id === next.type);
      next.capabilityId = next.type;
      next.type = 'plugin';
      next.parameters = { ...action?.defaults };
    }
    if (card.dataset.group === 'start' && !old.nameEdited) next.name = this.ruleTypes[control.value];
    if (Number.isFinite(old.seconds)) next.seconds = old.seconds;
    if (old.days?.length) next.days = old.days;
    if (old.time) next.time = old.time;
    const container = card.parentElement;
    const position = [...container.children].indexOf(card);
    const replacement = this.card(next, card.dataset.group, true);
    card.outerHTML = replacement;
    this.numberCards();
    container.children[position].querySelector('[data-task-type], [data-action="task-replace"]').focus();
  },

  eventRuns(task) {
    return state.runs.filter(run => run.event && !['running', 'queued'].includes(run.status)).filter(run => {
      const source = (state.taskEvents || []).find(event => event.pluginId === run.event.pluginId && event.eventId === run.event.eventId
        && (!event.instanceId || run.event.payload?.[event.instanceKey] === event.instanceId)
        && (!event.sensorId || run.event.payload?.['sensor-id'] === event.sensorId));
      return source && task.starts.some(rule => rule.type === 'event' && rule.eventId === source.id);
    });
  },

  previewEvent(run) {
    if (!run?.event) return '<p class="field-help">Select a saved Event to inspect its captured values before running.</p>';
    const event = run.event;
    const source = (state.taskEvents || []).find(item => item.pluginId === event.pluginId && item.eventId === event.eventId
      && (!item.instanceId || event.payload?.[item.instanceKey] === item.instanceId)
      && (!item.sensorId || event.payload?.['sensor-id'] === item.sensorId));
    const fields = (source?.payload || []).filter(field => field.format !== 'secret' && ['string', 'number', 'boolean'].includes(field.type));
    return `<h3>Captured values</h3><p class="field-help">${escapeHtml(source ? `${source.pluginName} · ${source.name}` : 'Event source unavailable')} · ${escapeHtml(formatServerTimestamp(event.occurredAt ?? run.startedAt))}</p><dl class="event-values">${fields.map(field => {
      const value = event.payload?.[field.id];
      return `<div><dt>${escapeHtml(field.label)}</dt><dd>${typeof value !== field.type ? 'Not captured' : escapeHtml(typeof value === 'boolean' ? value ? 'Yes' : 'No' : value)}</dd></div>`;
    }).join('')}</dl>`;
  },

  async runTask(id) {
    const task = state.tasks.find(task => task.id === id);
    const needsEvent = task.steps.some(step => step.enabled && (step.type === 'log'
      ? step.message.includes('{{event.') : step.type === 'plugin' && Object.values(step.parameters).some(value => typeof value === 'string' && value.includes('{{event.'))));
    if (!needsEvent) {
      await mutate(`api/tasks/${id}/run`, {revision: task.revision});
      return notify('Task started');
    }
    const runs = this.eventRuns(task);
    showDialog(`<form id="task-run-form">${dialogHeader('Run task', task.name)}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>${this.field('Event values', 'tower-broadcast', `<select name="eventRunId" required><option value="">Select saved Event</option>${runs.map(run => `<option value="${escapeHtml(run.id)}">${escapeHtml(run.name)} · ${escapeHtml(formatServerTimestamp(run.startedAt))}</option>`).join('')}</select>`, 'Uses saved Event values and runs the current Task from the first step. The automatic Event rule can stay disabled for this test. No new Event is emitted.')}${runs.length ? '' : '<p class="aside-note">No matching Event values in Task history. Let an enabled Event rule capture a real Event, then use Run or Rerun to test with those saved values. To test an action now without Event history, replace its Event tokens with literal values.</p>'}</div>${dialogFooter('Run task')}</form>`, {kind: 'task-run', id, revision: task.revision});
    const preview = document.createElement('section');
    preview.id = 'task-event-preview'; preview.className = 'captured-event-preview';
    preview.innerHTML = this.previewEvent(null);
    dialog.querySelector('.dialog-body').append(preview);
    dialog.querySelector('[type="submit"]').disabled = !runs.length;
  },

  async submitRun(form) {
    const context = dialogContext;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await mutate(`api/tasks/${context.id}/run`, {revision: context.revision, eventRunId: form.querySelector('[name="eventRunId"]').value});
      if (dialogContext === context && form.isConnected) { closeDialog(); renderView(); notify('Task started'); }
    } catch (error) { if (dialogContext === context && form.isConnected) showFormError(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  },

  rerunPreview(preview) {
    const value = input => escapeHtml(typeof input === 'boolean' ? input ? 'Yes' : 'No' : input);
    const values = preview.event?.values || [];
    const title = values.find(field => field.id === 'title' && typeof field.value === 'string');
    return `<p>Starts the current Task from step one, including steps that already succeeded.${preview.manualTvEffects ? ' This is a manual run; Do not disturb does not prevent its TV actions.' : ''}</p>
      <p class="field-help">Task revision ${preview.revision}${preview.sourceTaskRevision !== null && preview.sourceTaskRevision !== preview.revision ? ` · The original run used revision ${preview.sourceTaskRevision}` : ''}.</p>
      ${title ? `<h3 class="rerun-event-title">${value(title.value)}</h3>` : ''}
      ${preview.event ? `<p class="field-help">${escapeHtml(preview.event.pluginName)} · ${escapeHtml(preview.event.name)} · ${Number.isFinite(preview.event.occurredAt) ? escapeHtml(formatServerTimestamp(preview.event.occurredAt)) : 'Event time not recorded'}</p><details class="rerun-values"><summary>Captured Event values · ${values.length}</summary><dl class="event-values">${values.map(field => `<div><dt>${escapeHtml(field.label)}</dt><dd>${value(field.value)}</dd></div>`).join('')}</dl></details>` : '<p>No Event values were captured. This run uses the current Task’s literal settings.</p>'}
      <h3>Running order</h3><ol class="run-steps">${preview.steps.map(step => `<li><div><strong>${step.number}. ${escapeHtml(step.label)}</strong><span>${step.enabled ? 'Enabled' : 'Disabled · skipped'}</span></div>${step.parameters.length ? `<details><summary>Values for this step</summary><dl class="event-values">${step.parameters.map(field => `<div><dt>${escapeHtml(field.label)}</dt><dd>${value(field.value)}</dd></div>`).join('')}</dl></details>` : ''}</li>`).join('')}</ol>
      ${preview.stepCount > preview.steps.length ? `<p class="aside-note">Showing the first ${preview.steps.length} of ${preview.stepCount} steps. Rerun starts the complete Task.</p>` : ''}`;
  },

  async openRerun(id, revision) {
    const run = state.runs.find(run => run.id === id);
    if (!run) return notify('This run is no longer in history.');
    showDialog(`<form id="task-rerun-form">${dialogHeader('Rerun task', run.name)}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><div id="rerun-preview" aria-live="polite">Checking the current Task and captured values…</div></div>${dialogFooter('Rerun from step one')}</form>`, {kind:'task-rerun', runId:id, revision});
    const context = dialogContext, form = dialog.querySelector('#task-rerun-form');
    form.querySelector('[type="submit"]').disabled = true;
    try {
      const reply = await request(`api/runs/${id}/preview`, {revision});
      if (dialogContext !== context || !form.isConnected) return;
      form.querySelector('#rerun-preview').innerHTML = this.rerunPreview(reply.preview);
      context.previewReady = true;
      form.querySelector('[type="submit"]').disabled = false;
    } catch (error) {
      if (dialogContext === context && form.isConnected) {
        form.querySelector('#rerun-preview').textContent = 'Rerun is unavailable. Nothing has been started.';
        showFormError(error.message);
      }
    }
  },

  async submitRerun(form) {
    const context = dialogContext;
    if (context?.kind !== 'task-rerun' || !context.previewReady || context.submitting
      || !form.isConnected || form !== dialog.querySelector('#task-rerun-form')) return;
    context.submitting = true;
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      // Submit only the historical run ID and captured revision. Displayed
      // values never become an editable or caller-supplied Event payload.
      await mutate(`api/runs/${context.runId}/rerun`, {revision:context.revision});
      if (dialogContext === context && form.isConnected) { closeDialog(); renderView(); notify('Task restarted from step one'); }
    } catch (error) {
      if (dialogContext === context && form.isConnected) {
        showFormError(`${error.message} Check Task runs before reopening Rerun.`);
        // Reopen to obtain a new validated preview after any rejection.
        context.previewReady = false;
      }
    } finally {
      context.submitting = false;
      if (dialogContext === context && form.isConnected) button.disabled = !context.previewReady;
    }
  },

  async handleAction(action, id, control) {
    if (action === 'task-dismiss-notice') {
      control.disabled = true;
      try { await mutate('api/tv-notices/dismiss', {revision: Number(control.dataset.revision)}); notify('Notice dismissal requested'); }
      finally { if (control.isConnected) control.disabled = false; }
      return;
    }
    if (action === 'task-rerun') {
      return this.openRerun(id, Number(control.dataset.revision));
    }
    if (action === 'task-preview-notice') {
      const parameters = PluginUI.readFields(actionCatalog.find(item => item.id === 'plugin:samsung-tv:show-notice').parameters, control.closest('.task-block'));
      const preview = { ...parameters, fontScale: config.vistaFontScale, serverName: config.name };
      window.open(`assets/notices/notice.html?preview=1#${encodeURIComponent(JSON.stringify(preview))}`, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'task-add') return this.openEditor();
    if (action === 'task-replace-cancel') { this.clearReplacement(); dialog.querySelector('#action-search').focus(); return; }
    if (action === 'task-replace') {
      const card = control.closest('.task-step');
      this.clearReplacement(); this.replaceStepId = this.readCard(card).id;
      card.classList.add('task-replacing'); this.librarySearch=''; this.libraryCategory='all';
      dialog.querySelector('#action-search').value=''; this.refreshLibrary();
      dialog.querySelector('#action-search').focus(); return;
    }
    if (action === 'edit-task' || action === 'copy-task') return this.openEditor(id, action === 'copy-task');
    if (action === 'task-focus-library') { dialog.querySelector('#action-search').focus(); return; }
    if (action === 'task-library-filter') { this.libraryCategory = id; this.refreshLibrary(); return; }
    if (action === 'task-add-rule') {
      dialog.querySelector('#task-starts').insertAdjacentHTML('beforeend', this.card({ type: 'schedule', enabled: true }, 'start', true));
    } else if (action === 'task-library-add') {
      const action = actionCatalog.find(item => item.id === id);
      if (!action || action.available === false) return showFormError('This action is unavailable. Check its plugin settings.');
      const step = { ...action.defaults, type: action.type, enabled: true, id: crypto.randomUUID() };
      if (action.type === 'plugin') Object.assign(step, { capabilityId: action.id, parameters: { ...action.defaults } });
      const steps = dialog.querySelector('#task-steps');
      if (this.replaceStepId) {
        const previous = [...steps.children].find(card => this.readCard(card).id === this.replaceStepId);
        if (!previous) { this.clearReplacement(); return showFormError('The selected step is no longer available. Choose another step.'); }
        const old = this.readCard(previous); step.id=old.id; step.enabled=old.enabled;
        const position = [...steps.children].indexOf(previous);
        previous.outerHTML=this.card(step,'step',true); this.clearReplacement(); this.numberCards();
        steps.children[position].querySelector('.task-block-fields input, .task-block-fields select, textarea, [data-action="task-replace"]')?.focus(); return;
      }
      const insertion = dialog.querySelector('#insert-after').value;
      const previous = [...steps.children].find(card => this.readCard(card).id === insertion);
      if (insertion === 'first') steps.insertAdjacentHTML('afterbegin', this.card(step, 'step', true));
      else if (previous) previous.insertAdjacentHTML('afterend', this.card(step, 'step', true));
      else steps.insertAdjacentHTML('beforeend', this.card(step, 'step', true));
      this.numberCards();
      const added = [...steps.children].find(card => this.readCard(card).id === step.id);
      added.querySelector('textarea, .task-block-fields input, .task-block-fields select')?.focus();
      return;
    } else if (action.startsWith('task-block-')) {
      const card = control.closest('.task-block');
      const fields = card.querySelector('.task-block-fields');
      if (action === 'task-block-edit') fields.hidden = !fields.hidden;
      if (action === 'task-block-delete') card.remove();
      if (action === 'task-block-copy') card.insertAdjacentHTML('afterend', this.card({ ...this.readCard(card), id: crypto.randomUUID(), enabled: false }, card.dataset.group, true));
      if (action === 'task-block-up' && card.previousElementSibling) card.parentElement.insertBefore(card, card.previousElementSibling);
      if (action === 'task-block-down' && card.nextElementSibling) card.parentElement.insertBefore(card.nextElementSibling, card);
      if (action === 'task-block-toggle') {
        const input = card.querySelector('[name="blockEnabled"]');
        input.value = String(input.value !== 'true');
        control.setAttribute('aria-checked', input.value);
      }
    } else if (action === 'task-run') {
      return this.runTask(id);
    }
    else if (action === 'toggle-task') {
      const task = state.tasks.find(item => item.id === id);
      returnFocus = control; await mutate(`api/tasks/${id}/enabled`, {enabled: !task.enabled, revision: task.revision}); renderView(); restoreRowFocus(); return;
    } else if (action === 'delete-task') {
      const task = state.tasks.find(item => item.id === id);
      showDialog(`${dialogHeader('Delete task')}<div class="dialog-body"><p>Delete ${escapeHtml(task.name)} and its starts and steps? Running instances are cancelled. Activity records are retained.</p></div><div class="dialog-footer"><button class="button" data-action="close-dialog">Cancel</button><button class="button danger" data-action="task-confirm-delete">Delete</button></div>`, { kind: 'task-delete', id, revision: task.revision });
      return;
    } else if (action === 'task-confirm-delete') {
      await mutate(`api/tasks/${dialogContext.id}/delete`, {revision: dialogContext.revision}); closeDialog(); renderView(); workspace.focus(); notify('Task deleted'); return;
    }
    if (dialog.open && dialog.querySelector('#task-steps')) this.numberCards();
  },


};

// Library filters and captured-value inspection are local UI state only.
document.addEventListener('change', event => {
  if(event.target.name==='ruleMode' && event.target.closest('#editor-form')) {
    TaskUI.editorRuleMode=event.target.value;
    dialog.querySelector('#task-rule-help').textContent=TaskUI.ruleModeHelp(event.target.value);
    for(const card of dialog.querySelectorAll('.task-start')) {
      const rule=TaskUI.readCard(card);
      if(rule.type==='event')card.querySelector('[data-event-condition]').innerHTML=TaskUI.eventConditionFields(rule);
      TaskUI.updateSummary(card);
    }
  }
  if (event.target.id === 'action-plugin-filter') {
    TaskUI.libraryCategory = event.target.value; TaskUI.refreshLibrary();
  }
  if (event.target.name === 'eventRunId' && event.target.closest('#task-run-form')) {
    const task = state.tasks.find(task => task.id === dialogContext.id);
    const run = task && TaskUI.eventRuns(task).find(run => run.id === event.target.value);
    dialog.querySelector('#task-event-preview').innerHTML = TaskUI.previewEvent(run);
  }
});

