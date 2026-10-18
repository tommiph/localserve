/** Read-only inspection of captured run history. Rerun/cancel continue through
 * the existing Task handlers and server admission checks. Never build an Event
 * from these displayed fields or from the current Task definition. */
const RunUI = {
  task: '', status: '', limit: 20, opened: new Set(),

  elapsed(start, end) {
    if (!Number.isFinite(start)) return 'Not recorded';
    const milliseconds = Math.max(0, (end ?? state.server?.now ?? Date.now()) - start);
    return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
  },

  controls() {
    const tasks = new Map(state.runs.map(run => [run.taskId, state.tasks.find(task => task.id === run.taskId)?.name || run.name]));
    return `<div class="inspection-filters"><label>Task<select id="runs-task"><option value="">All Tasks</option>${[...tasks].map(([id, name]) => `<option value="${escapeHtml(id)}" ${this.task === id ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label><label>Result<select id="runs-status"><option value="">All results</option>${['running', 'completed', 'failed', 'cancelled', 'interrupted'].map(status => `<option ${status === this.status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><p>Completed means the step returned; reported device state remains separate.</p></div>`;
  },

  filtered() {
    const retained = new Set(state.runs.map(run => run.id));
    for (const id of this.opened) if (!retained.has(id)) this.opened.delete(id);
    return state.runs.filter(run => (!this.task || run.taskId === this.task) && (!this.status || run.status === this.status));
  },

  details(run) {
    const event = run.event;
    const declaration = event && (state.taskEvents || []).find(source => source.pluginId === event.pluginId && source.eventId === event.eventId
      && (!source.instanceId || event.payload?.[source.instanceKey] === source.instanceId)
      && (!source.sensorId || event.payload?.['sensor-id'] === source.sensorId));
    const values = event ? Object.entries(event.payload || {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)) : [];
    const origin = run.rerunOf ? 'Manual rerun' : run.automatic === true ? 'Automatic' : run.automatic === false ? 'Manual' : 'Not recorded';
    const trigger = !run.reason || origin === run.reason ? origin : `${origin} · ${run.reason}`;
    const time = value => Number.isFinite(value) ? escapeHtml(formatServerTimestamp(value)) : 'Not recorded';
    return `<div class="run-details" id="run-details-${escapeHtml(run.id)}" ${this.opened.has(run.id) ? '' : 'hidden'}><dl class="run-facts"><div><dt>Started by</dt><dd>${escapeHtml(trigger)}</dd></div><div><dt>Task revision</dt><dd>${escapeHtml(run.taskRevision ?? 'Not recorded')}</dd></div><div><dt>Started</dt><dd>${time(run.startedAt)}</dd></div><div><dt>Finished</dt><dd>${time(run.finishedAt)}</dd></div><div><dt>Duration</dt><dd>${this.elapsed(run.startedAt, run.finishedAt)}</dd></div>${run.rerunOf ? `<div><dt>Rerun of</dt><dd>${escapeHtml(run.rerunOf)}</dd></div>` : ''}</dl>
      <h4>Captured Event values</h4>${event ? `<p>${escapeHtml(declaration ? `${declaration.pluginName} · ${declaration.name}` : `${event.pluginId} · ${event.eventId}`)} · Observed ${time(event.occurredAt)}</p><dl class="event-values">${values.map(([key, value]) => `<div><dt>${escapeHtml(declaration?.payload?.find(field => field.id === key)?.label || key)}</dt><dd>${escapeHtml(typeof value === 'boolean' ? value ? 'Yes' : 'No' : value)}</dd></div>`).join('')}</dl>` : '<p>No Event payload was captured for this run.</p>'}
      <h4>Steps</h4>${run.steps ? `<ol class="run-steps">${run.steps.map(step => `<li><div><strong>${step.number}. ${escapeHtml(step.label)}</strong><span>${escapeHtml(step.status === 'not-run' ? 'Not run' : step.status)} · ${this.elapsed(step.startedAt, step.finishedAt)}</span></div>${step.reason ? `<p>${escapeHtml(step.reason)}</p>` : ''}</li>`).join('')}</ol>${run.stepCount > run.steps.length ? `<p>Showing the first ${run.steps.length} of ${run.stepCount} step receipts.</p>` : ''}` : '<p>Per-step timing was not recorded for this older run.</p>'}${run.error ? `<p class="evidence-error">${escapeHtml(run.error)}</p>` : ''}</div>`;
  },
};

document.addEventListener('change', event => {
  if (!['runs-task', 'runs-status'].includes(event.target.id)) return;
  RunUI[event.target.id === 'runs-task' ? 'task' : 'status'] = event.target.value;
  RunUI.limit = 20; renderView(); document.getElementById(event.target.id)?.focus();
});

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action="runs-details"], [data-action="runs-more"]');
  if (!button) return;
  if (button.dataset.action === 'runs-more') { RunUI.limit += 20; renderView(); return; }
  const id = button.dataset.id;
  if (RunUI.opened.has(id)) RunUI.opened.delete(id); else RunUI.opened.add(id);
  const body = document.getElementById(`run-details-${id}`);
  if (body) body.hidden = !RunUI.opened.has(id);
  button.setAttribute('aria-expanded', String(RunUI.opened.has(id)));
});
