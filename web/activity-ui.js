/** Activity filtering/grouping changes presentation only. Pausing freezes this
 * view's bounded snapshot, never server logging, retention, Tasks or polling. */
const ActivityUI = {
  contexts: new Map(), opened: new Set(),

  context(scope) {
    if (!this.contexts.has(scope)) this.contexts.set(scope, {search: '', plugin: '', task: '', level: '', type: '', group: true, paused: false, held: []});
    return this.contexts.get(scope);
  },

  countText(filtered, source, paused, limit) {
    return `${filtered} of ${source} recent entries shown · ${paused ? 'Display paused; server logging continues · Snapshot limited to 500 entries' : 'Live display · Recent view limited to ' + limit + ' entries'} · Search covers shown entries only; older retained logs remain on disk`;
  },

  type(entry) { return entry.eventId ? 'event' : entry.taskId ? 'task' : entry.pluginId ? 'plugin' : 'server'; },

  filtered(entries, settings) {
    const query = settings.search.toLowerCase().trim();
    return entries.filter(entry => (!settings.plugin || entry.pluginId === settings.plugin)
      && (!settings.task || entry.taskId === settings.task) && (!settings.level || entry.level === settings.level)
      && (!settings.type || this.type(entry) === settings.type)
      && (!query || `${entry.message} ${entry.source} ${entry.eventId || ''}`.toLowerCase().includes(query)));
  },

  groups(entries, enabled) {
    const groups = [];
    for (const entry of entries) {
      // Never merge different Event payloads, Tasks, runs or severities. Only
      // identical adjacent displayed messages may share a compact visual row.
      const key = JSON.stringify([entry.message, entry.source, entry.level, entry.pluginId, entry.taskId, entry.runId, entry.eventId, entry.payload]);
      const last = groups.at(-1);
      if (enabled && last?.key === key) last.entries.push(entry);
      else groups.push({key, entries: [entry]});
    }
    return groups;
  },

  row(group) {
    const entry = group.entries[0];
    const glyph = ['warning', 'error'].includes(entry.level) ? 'triangle-exclamation' : entry.level === 'success' ? 'check' : 'circle-info';
    const task = state.tasks.find(task => task.id === entry.taskId)?.name;
    const taskLabel = task && task !== entry.source ? ' · ' + escapeHtml(task) : '';
    return `<li class="activity-row" data-live-key="activity:${escapeHtml(entry.id)}"><span class="activity-glyph ${escapeHtml(entry.level)}">${icon(glyph)}</span><div class="activity-content">${escapeHtml(entry.message)}<small>${escapeHtml(entry.source || 'Server')}${taskLabel} · ${this.type(entry)} · ${escapeHtml(entry.level || 'info')}</small>${entry.eventId ? `<details data-activity-details="event-${escapeHtml(entry.id)}" ${this.opened.has('event-' + entry.id) ? 'open' : ''}><summary>Event values</summary><dl class="event-values">${Object.entries(entry.payload || {}).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></details>` : ''}${group.entries.length > 1 ? `<details class="activity-repeats" data-activity-details="group-${escapeHtml(entry.id)}" ${this.opened.has('group-' + entry.id) ? 'open' : ''}><summary>${group.entries.length} identical entries</summary><ul>${group.entries.map(item => `<li>${escapeHtml(formatServerTimestamp(item.at))}</li>`).join('')}</ul></details>` : ''}</div><time class="activity-time" title="${escapeHtml(formatServerTimestamp(entry.at))}">${escapeHtml(relativeTime(entry.at))}</time></li>`;
  },

  render(entries, scope = 'global') {
    const settings = this.context(scope), source = settings.paused ? settings.held : entries;
    const filtered = this.filtered(source, settings);
    const tasks = new Map(source.filter(entry => entry.taskId).map(entry => [entry.taskId, state.tasks.find(task => task.id === entry.taskId)?.name || 'Deleted Task']));
    const select = (key, label, options) => `<label>${label}<select data-activity-filter="${key}"><option value="">${{plugin: 'All plugins', task: 'All Tasks', level: 'All severities', type: 'All types'}[key]}</option>${options.map(([id, name]) => `<option value="${escapeHtml(id)}" ${settings[key] === id ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label>`;
    return `<section class="panel activity-inspector" data-activity-scope="${escapeHtml(scope)}"><div class="panel-header"><h2>Activity log</h2><button class="button" type="button" data-action="activity-pause" aria-pressed="${settings.paused}">${icon(settings.paused ? 'play' : 'pause')}${settings.paused ? 'Resume display' : 'Pause display'}</button></div>
      <div class="inspection-filters"><label class="inspection-search">Search<input type="search" data-activity-filter="search" value="${escapeHtml(settings.search)}" placeholder="Search messages or sources"></label>${scope === 'global' ? select('plugin', 'Plugin', state.services.map(plugin => [plugin.id, plugin.name])) : ''}${select('task', 'Task', [...tasks])}${select('level', 'Severity', [['info', 'Info'], ['success', 'Success'], ['warning', 'Warning'], ['error', 'Error']])}${select('type', 'Type', [['event', 'Event'], ['task', 'Task'], ['plugin', 'Plugin'], ['server', 'Server']])}<label class="check-field"><input type="checkbox" data-activity-filter="group" ${settings.group ? 'checked' : ''}>Group repeated entries</label><button type="button" class="text-button" data-action="activity-reset">Reset filters</button></div><p class="inspection-count">${this.countText(filtered.length, source.length, settings.paused, scope === 'global' ? 2000 : 500)}</p><div data-activity-results>${this.rows(filtered, settings)}</div></section>`;
  },

  rows(entries, settings) {
    return entries.length ? `<ul class="activity-list">${this.groups(entries, settings.group).map(group => this.row(group)).join('')}</ul>` : '<div class="empty-state">No entries match these filters.</div>';
  },

  source(scope) {
    if (scope === 'global') return state.activity;
    return state.services.find(service => service.id === scope)?.pluginActivity || [];
  },
};

document.addEventListener('input', event => {
  const control = event.target, panel = control.closest('[data-activity-scope]');
  if (!panel || control.dataset.activityFilter !== 'search') return;
  const scope = panel.dataset.activityScope, settings = ActivityUI.context(scope);
  settings.search = control.value;
  // Update rows only, preserving the search caret and current scroll position.
  const source = settings.paused ? settings.held : ActivityUI.source(scope), filtered = ActivityUI.filtered(source, settings);
  AdminDOM.update(panel.querySelector('[data-activity-results]'),ActivityUI.rows(filtered, settings));
  panel.querySelector('.inspection-count').textContent = `${ActivityUI.countText(filtered.length, source.length, settings.paused, scope === 'global' ? 2000 : 500)}`;
});

document.addEventListener('change', event => {
  const control = event.target, panel = control.closest('[data-activity-scope]');
  if (!panel || !control.dataset.activityFilter || control.dataset.activityFilter === 'search') return;
  const key = control.dataset.activityFilter;
  ActivityUI.context(panel.dataset.activityScope)[key] = key === 'group' ? control.checked : control.value;
  renderView();
});

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action="activity-pause"], [data-action="activity-reset"]');
  if (!button) return;
  const scope = button.closest('[data-activity-scope]').dataset.activityScope, settings = ActivityUI.context(scope);
  if (button.dataset.action === 'activity-reset') Object.assign(settings, {search: '', plugin: '', task: '', level: '', type: ''});
  else {
    settings.paused = !settings.paused;
    settings.held = settings.paused ? structuredClone(ActivityUI.source(scope)).slice(0, 500) : [];
  }
  renderView();
});

document.addEventListener('toggle', event => {
  const details = event.target;
  if (!details.isConnected || !details.matches('[data-activity-details]')) return;
  if (details.open) ActivityUI.opened.add(details.dataset.activityDetails);
  else ActivityUI.opened.delete(details.dataset.activityDetails);
  // History itself is bounded; avoid retaining expansion state indefinitely.
  while (ActivityUI.opened.size > 1000) ActivityUI.opened.delete(ActivityUI.opened.values().next().value);
}, true);
