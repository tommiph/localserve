/** End-user capability client. It never loads /api/state or administrator
 * tokens and never accepts arbitrary action names/arguments from this browser.
 */
'use strict';
const board = document.querySelector('#controls-board'), feedback = document.querySelector('#controls-feedback');
const status = document.querySelector('#controls-status'), cancel = document.querySelector('#controls-cancel');
const parts = location.pathname.split('/').filter(Boolean), isIndex = parts.length === 1;
const endpoint = isIndex ? '/api/control-view' : `/api/control-view/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`;
let snapshot, refreshing = false, sending = false, observedRun = null;
function appearance(options) {
  document.documentElement.dataset.theme = options.theme;
  document.documentElement.style.setProperty('--font-scale', options.fontScale / 100);
  const logo = `/assets/logo${options.theme === 'dark' ? '-dark' : ''}.svg`;
  // Header branding follows the theme; installed-app icons/favicon always use
  // the white logo on black, independent of current page appearance.
  document.querySelector('#controls-logo').src = logo;
  document.querySelector('#controls-server-name').textContent = options.name;
}
async function refresh() {
  if (refreshing) return; refreshing = true;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Controls unavailable');
    snapshot = await response.json(); appearance(snapshot.options);
    if (isIndex) {
      document.title = `Controls · ${snapshot.options.name}`;
      board.innerHTML = snapshot.pages.length ? `<div class="controls-grid">${snapshot.pages.map(page => `<a class="control-directory-entry" href="${ControlsRenderer.escape(page.url)}">${ControlsRenderer.icon(page.icon)}<strong>${ControlsRenderer.escape(page.name)}</strong><span>${ControlsRenderer.escape(page.pluginName)} · ${page.available ? 'Ready' : 'Unavailable'}</span></a>`).join('')}</div>` : '<p class="empty-state">No enabled Control pages.</p>';
      status.textContent = 'Choose a Control page'; return;
    }
    document.title = `${snapshot.page.name} · ${snapshot.options.name}`;
    document.querySelector('#controls-title').textContent = snapshot.page.name;
    board.setAttribute('aria-label', snapshot.page.name);
    status.textContent = snapshot.available ? snapshot.busy ? 'Running' : snapshot.page.pluginName : 'Controls unavailable or server paused';
    renderControls();
    const active = snapshot.runs.find(run => run.id === snapshot.activeRunId);
    cancel.hidden = !active; cancel.dataset.runId = active?.id || '';
    const run = snapshot.runs.find(run => run.id === observedRun) || active;
    if (run) feedback.textContent = ['queued', 'running'].includes(run.status) ? `Running · Step ${run.step} of ${run.totalSteps}` : run.message;
  } catch {
    status.textContent = 'Disconnected · commands unavailable';
    if (snapshot?.page) { snapshot.available = false; renderControls(); }
    cancel.hidden = true;
  } finally { refreshing = false; }
}
function renderControls() {
  const current = { ...snapshot, busy: snapshot.busy || sending };
  document.body.classList.toggle('lighting-viewer', Boolean(snapshot.lighting));
  document.body.classList.toggle('television-viewer', snapshot.page.presentation === 'television');
  if (snapshot.lighting) LightingControls.mount(board, current, { invoke, post, refresh });
  else if (snapshot.page.presentation === 'television') TelevisionControls.mount(board, current);
  else ControlsRenderer.mount(board, current);
}
async function post(operation, body, token = snapshot.token) {
  const response = await fetch(endpoint + '/' + operation, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Localserve-Control-Token': token }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Control unavailable'); return value;
}
async function invoke(itemId, input) {
  if (!snapshot?.available || snapshot.busy || sending) return;
  sending = true; renderControls();
  const requestId = crypto.randomUUID(); observedRun = requestId;
  try {
    const body = { itemId, requestId, revision: snapshot.page.revision };
    if (input) {
      const item = snapshot.page.items.find(item => item.id === itemId);
      body.value = item.kind === 'toggle' ? input.checked : item.input.type === 'number' ? Number(input.value) : input.value;
    }
    feedback.textContent = 'Sending'; await post('run', body);
  } catch (error) { feedback.textContent = error.message + ' · no command was retried.'; }
  finally { sending = false; void refresh(); }
}
board.addEventListener('click', event => {
  const button = event.target.closest('[data-control-item]'); if (button && !button.disabled) void invoke(button.dataset.controlItem);
});
board.addEventListener('input', event => {
  if (!event.target.matches('[data-control-input]')) return;
  event.target.dataset.changed = 'true'; ControlsRenderer.updateInput(event.target);
});
board.addEventListener('change', event => {
  const input = event.target; if (input.matches('[data-control-input]') && !input.disabled) void invoke(input.dataset.controlInput, input);
});
cancel.addEventListener('click', async () => {
  cancel.disabled = true;
  try { await post('cancel', { runId: cancel.dataset.runId }); feedback.textContent = 'Cancellation requested'; }
  catch (error) { feedback.textContent = error.message; }
  finally { cancel.disabled = false; void refresh(); }
});
let polling = null;
function startPolling() {
  if (polling === null) polling = setInterval(refresh, 2000);
  void refresh();
}
startPolling();
window.addEventListener('pagehide', () => {
  clearInterval(polling);
  polling = null;
});
// Android may restore this document from the back/forward cache. Reconnect
// exactly one read loop; never replay a command when returning to the app.
window.addEventListener('pageshow', startPolling);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refresh();
});
