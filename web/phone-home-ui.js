/** Administrator publishing controls for the scoped phone Home surface. */
const PhoneHomeUI = {
  render() {
    const home = state.phoneHome;
    if (!home) return pageHeading('Phone home', 'Refresh the administrator to load phone access.');
    const published = home.tasks.map((item) => ({
      item,
      task: state.tasks.find((task) => task.id === item.taskId),
    }));
    return (
      pageHeading(
        'Phone home',
        'Favorites, remotes and manual Task shortcuts',
        `<a class="button" href="sensors" target="_blank" rel="noopener">${icon('download')}Android app</a><a class="button primary" href="home" target="_blank" rel="noopener">${icon('arrow-up-right-from-square')}Open Home</a>`,
      ) +
      `<section class="panel"><div class="panel-header"><h2>${icon('play')}Published Tasks</h2><button class="button" data-action="phone-home-edit">${icon('pen')}Edit</button></div><div class="panel-body"><p>Choose which Tasks people can run from Home. Favorites and their order are personal to each phone. Enabled Controls pages appear automatically in Remotes.</p><p class="field-help">Publishing allows manual device actions on your trusted LAN. Event-dependent Tasks need captured values and remain unavailable here. Disabling a shortcut does not cancel a run already accepted.</p></div>${published.length ? `<div class="table-scroll"><table class="service-table"><thead><tr><th>Task</th><th>Phone shortcut</th><th>Task status</th></tr></thead><tbody>${published.map(({ item, task }) => `<tr data-live-key="phone-task-${escapeHtml(item.taskId)}"><td>${icon(item.icon)} ${escapeHtml(task?.name || 'Deleted Task')}</td><td>${item.enabled ? 'Enabled' : 'Disabled'}</td><td>${task ? (task.enabled ? 'Enabled' : 'Disabled') : 'Unavailable'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">No Tasks published. Your existing Tasks stay private to administration until selected here.</div>'}</section>`
    );
  },
  field(label, glyph, input, index) {
    const id = 'field-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return formField(label, glyph, input).replaceAll(id, id + '-phone-' + index);
  },
  edit() {
    const home = state.phoneHome;
    if (!home) return;
    const choices = ['play', 'lightbulb', 'tv', 'movie', 'music', 'home', 'star', 'power-off', 'bed', 'sun'];
    const icons = choices.filter((id) => state.pluginGlyphs.includes(id));
    showDialog(
      `<form id="phone-home-form">${dialogHeader('Publish phone shortcuts')}<div class="dialog-body"><p>Select up to 32 Tasks. This grants manual execution from Home; it does not enable or edit the Task itself.</p><div id="form-error" class="form-error" role="alert" hidden></div>${
        state.tasks.length
          ? state.tasks
              .map((task, index) => {
                const saved = home.tasks.find((item) => item.taskId === task.id);
                const glyphs = [...new Set([saved?.icon || 'play', ...icons])];
                return `<fieldset class="panel" data-phone-task="${escapeHtml(task.id)}"><legend>${escapeHtml(task.name)}</legend><div class="panel-body"><label><input name="publish" type="checkbox" ${saved ? 'checked' : ''}> Publish on phone</label><div class="form-grid">${this.field('Glyph', 'shapes', `<select name="icon">${glyphs.map((id) => `<option value="${id}" ${id === (saved?.icon || 'play') ? 'selected' : ''}>${escapeHtml(id.replaceAll('-', ' '))}</option>`).join('')}</select>`, index)}${this.field('Shortcut enabled', 'toggle-on', `<input name="enabled" class="switch" type="checkbox" ${saved?.enabled !== false ? 'checked' : ''}>`, index)}</div></div></fieldset>`;
              })
              .join('')
          : '<p>Create a Task first, then publish it here.</p>'
      }</div>${dialogFooter()}</form>`,
      { kind: 'phone-home', revision: home.revision },
    );
  },
};
document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'phone-home-form') return;
  event.preventDefault();
  const form = event.target,
    context = dialogContext;
  if (!form.isConnected || context?.kind !== 'phone-home' || context.submitted) return;
  const tasks = [...form.querySelectorAll('[data-phone-task]')]
    .filter((row) => row.querySelector('[name="publish"]').checked)
    .map((row) => ({
      taskId: row.dataset.phoneTask,
      icon: row.querySelector('[name="icon"]').value,
      enabled: row.querySelector('[name="enabled"]').checked,
    }));
  context.submitted = true;
  form.querySelector('[type="submit"]').disabled = true;
  try {
    await request('/api/phone-home/settings', { revision: context.revision, tasks });
    await refreshState(false);
    if (dialogContext === context) closeDialog();
    renderView();
    notify('Phone shortcuts saved');
  } catch (error) {
    if (dialogContext === context) {
      context.submitted = false;
      form.querySelector('[type="submit"]').disabled = false;
      showFormError(error.message);
    }
  }
});
