/** Sormus administrator. Server data is authoritative; no sample actions,
 * devices, resource figures, or browser-only Tasks are used by this client.
 */
'use strict';
const workspace = document.querySelector('#workspace');
const dialog = document.querySelector('#editor-dialog');
const confirmationDialog = document.querySelector('#confirmation-dialog');
let confirmationReturnFocus = null;
let state, config, actionCatalog;
let currentView = location.pathname === '/downloads' ? 'downloads' : location.pathname === '/controller-setup' ? 'phone-home' : location.pathname === '/lighting-scenes' ? 'lighting-scenes' : location.pathname === '/remotes' ? 'control-pages' : location.pathname === '/devices' ? 'devices' : location.pathname === '/vr-library' ? 'vr-library' : location.pathname === '/lighting-animations' ? 'lighting' : 'overview', serviceSearch = '', initialFormValues = '', dialogContext = null;
let returnFocus = null, toastTimer, preferencesPending = 0, settingsQueue = Promise.resolve();
let pluginSearch = '';
const fontTimers = new Map();
let csrfToken = '';
let serverClockReference = null, serverClockConnected = false;
const saveFeedback = {pending: 0, error: ''};

// Required inputs inside collapsed metadata must be visible before the browser
// focuses an invalid field. Opening help/metadata never changes the draft.
document.addEventListener('invalid', event => {
  let section = event.target.parentElement;
  while (section && section !== dialog) {
    if (section.tagName === 'DETAILS') section.open = true;
    section = section.parentElement;
  }
}, true);

async function request(endpoint, values) {
  const response = await fetch(endpoint, values === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Localserve-Token': csrfToken }, body: JSON.stringify(values),
  });
  const result = await response.json();
  if(values!==undefined)AdminSync.invalidate();
  if (!response.ok) {const error=new Error(result.error || 'Request failed.');error.status=response.status;throw error;}
  return result;
}

function hydrate(data) {
  // The API owns saved settings and Tasks. Keep immediate appearance previews
  // while their queued saves are pending instead of replacing them on each poll.
  const previousTimeFormat = config?.timeFormat;
  state = data; config = data.config;
  AdminUX.observeServerVersion(config.version);
  document.querySelectorAll('#server-version, [data-server-version]').forEach(node => AdminDOM.text(node,'v'+config.version));
  if (previousTimeFormat && previousTimeFormat !== config.timeFormat) {
    TimeUI.refreshFormat();
    dialog.querySelectorAll('.task-block').forEach(card => TaskUI.updateSummary(card));
  }
  actionCatalog = data.taskActions; csrfToken = data.token;
  // Extrapolate between snapshots using a monotonic browser clock, not the
  // browser's wall-clock date. The server remains the source of displayed time.
  serverClockReference = { at: data.server.now, receivedAt: performance.now() };
  serverClockConnected = true;
  updateServerClock();
  updateServerName();
  if (!preferencesPending) {
    setTheme(config.theme);
    if (!fontTimers.has('font-scale')) setFontScale(config.fontScale);
  }
  AdminDOM.text(document.querySelector('#connection-status'),'Connected');
  renderSaveFeedback();
  // A card preview may consume fresh data while its modal fields and revision
  // stay fixed. Hydration must never reconstruct an unsaved card definition.
  if (!AdminDOM.selected(dialog)) {
    CardDesigner.updatePreview();
    VistaUI.updatePreview();
    ControlsUI.preview();
  }
}

async function refreshState(render = true) {
  const data=await AdminSync.read(request);
  if(!data)return;
  hydrate(data);
  if (render && !dialog.open) renderView();
}

function renderWorkspace(markup) {
  const scope = `${currentView}:${PluginUI.tabs.get(currentView) || 'settings'}`;
  AdminDOM.update(workspace,markup,{scope,onUpdate:() => {
    workspace.querySelectorAll('iframe[data-ready-card]').forEach(frame => CardRenderer.hydrateReadyMade(frame));
  }});
}

async function mutate(endpoint, values) {
  // Present committed server data while retaining existing controls. Open modal
  // drafts keep their captured fields and revisions during background hydration.
  const focused = document.activeElement;
  const focusId = focused?.id;
  const saving = AdminUX.savesDefinition(endpoint);
  if (saving) { saveFeedback.pending += 1; renderSaveFeedback(); }
  try {
    const result = await request(endpoint, values);
    if (result.config) hydrate(result); else await refreshState(false);
    if (saving) saveFeedback.error = '';
    if (!dialog.open) {
      renderView();
      if (focusId) document.getElementById(focusId)?.focus({preventScroll:true});
    }
    return result;
  } catch (error) {
    if (saving) saveFeedback.error = 'Save not confirmed. ' + error.message;
    throw error;
  } finally {
    if (saving) { saveFeedback.pending -= 1; renderSaveFeedback(); }
  }
}

function renderSaveFeedback() {
  const pending = saveFeedback.pending || preferencesPending || fontTimers.size;
  document.querySelectorAll('[data-save-status]').forEach(node => {
    AdminDOM.text(node,pending ? 'Saving…' : saveFeedback.error || 'All changes saved');
    node.dataset.tone = !pending && saveFeedback.error ? 'error' : 'saved';
  });
  document.querySelectorAll('[data-action="reload-administrator"]').forEach(node=>{node.disabled=Boolean(pending);});
}

// Serialize preference writes so dragging a slider cannot race a theme change.
function changeSettings(values) {
  preferencesPending += 1;
  renderSaveFeedback();
  const operation = settingsQueue.then(() => mutate('api/config', values));
  settingsQueue = operation.catch(() => {});
  // Callers still see a failed save; catching on the queue allows later edits.
  return operation.finally(() => {
    preferencesPending -= 1;
    if (!preferencesPending) {
      setTheme(config.theme);
      if (!fontTimers.has('font-scale')) setFontScale(config.fontScale);
    }
    renderSaveFeedback();
  });
}

function setTheme(value) {
  const theme = value === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  if(typeof ColorThemes!=='undefined')ColorThemes.apply(document,typeof ColorThemeUI!=='undefined'?ColorThemeUI.selected('adminColorTheme'):null);
  // Follow the saved UI theme rather than the operating system's preference.
  // Skip identical URLs during polling to avoid reloading the header image.
  // The favicon keeps the same white-on-black mark as the remote web apps.
  const logoPath = `assets/logo${theme === 'dark' ? '-dark' : ''}.svg`;
  const logo = document.querySelector('.application-logo');
  if (logo && logo.getAttribute('src') !== logoPath) logo.setAttribute('src', logoPath);
  // Theme changes are available only in Settings; the header has no selector.
}

function setFontScale(value) {
  document.documentElement.style.setProperty('--font-scale', value / 100);
  const slider = document.querySelector('#font-scale'), output = document.querySelector('#font-scale-value');
  if (slider) { slider.value = value; slider.setAttribute('aria-valuetext', `${value}%`); }
  if (output) AdminDOM.text(output,`${value}%`);
}

function updateServerName() {
  AdminDOM.text(document.querySelector('#brand-name'),config.name);
  AdminDOM.text(document.querySelector('#breadcrumb-name'),config.name);
  document.title = `${config.name} · Administration`;
}

function formatServerTimestamp(value) {
  // Follow the server's derived zone, even when this browser runs elsewhere.
  return new Intl.DateTimeFormat(undefined, {
    timeZone: state.server.timeZone, dateStyle: 'medium', timeStyle: 'medium',
    // h23 keeps midnight at 00:00; h12 adds the locale's AM/PM designation.
    hourCycle: config.timeFormat === '12' ? 'h12' : 'h23',
  }).format(new Date(value));
}

function updateServerClock() {
  if (!serverClockReference || !serverClockConnected) return;
  const timestamp = serverClockReference.at + performance.now() - serverClockReference.receivedAt;
  const clock = document.querySelector('#server-clock');
  clock.dateTime = new Date(timestamp).toISOString();
  AdminDOM.text(clock,formatServerTimestamp(timestamp));
  if (!AdminDOM.selected(workspace) && !AdminDOM.selected(dialog)) CardRenderer.updateCountdowns(document, timestamp);
}

function serviceStatus(service) {
  return AdminUX.serviceStatus(service, state.paused);
}

function serviceCheck(service) {
  const check = service.pollObservation;
  if (!check) return service.lastPollAt ? 'Attempted ' + relativeTime(service.lastPollAt) : 'No check recorded';
  const labels = {running: 'Checking', completed: 'Completed', failed: 'Failed', cancelled: 'Stopped'};
  return `${labels[check.status] || 'Unknown'} · ${relativeTime(check.finishedAt || check.attemptedAt)}`;
}

function serviceEvidence(service) {
  const reception = AdminUX.reception(service);
  const check = service.pollObservation;
  const recovery = AdminUX.recoveryHint(service, state.paused);
  const nextStep = service.enabled && (!service.configurationReady || ['error','restart-required'].includes(service.health) || service.gatewayConnection?.status === 'unreachable' || check?.status === 'failed') ? AdminUX.nextStep(service,state.paused) : '';
  return `<div class="service-evidence"><span>Last check: <b>${escapeHtml(serviceCheck(service))}</b></span><span>Latest reception: <b title="${escapeHtml(reception ? `${reception.label} · ${formatServerTimestamp(reception.value.value)}` : 'No declared reception timestamp is available')}">${reception ? escapeHtml(relativeTime(reception.value.value)) : 'Not reported'}</b></span>${check?.error ? `<span class="evidence-error">${escapeHtml(check.error)}</span>` : ''}${recovery ? `<span>${escapeHtml(recovery)}</span>` : ''}${nextStep ? `<span class="service-next-step">${escapeHtml(nextStep)}</span>` : ''}</div>`;
}

function renderNavigation() {
  const plugins = state.services.filter(service => `${service.name} ${service.id}`.toLowerCase().includes(pluginSearch.toLowerCase().trim()));
  AdminDOM.update(document.querySelector('#plugin-navigation'),plugins.map(service => {
    const status = serviceStatus(service);
    return `<button class="nav-item ${currentView === service.id ? 'selected' : ''}" data-view="${escapeHtml(service.id)}" aria-label="${escapeHtml(service.name)}">${icon(service.icon)}<span>${escapeHtml(service.name)}</span><span class="status-dot ${status.className}"></span></button>`;
  }).join('') || '<p class="navigation-empty">No matching plugins</p>');
  document.querySelectorAll('.nav-item[data-view]').forEach(button => {
    const selected = button.dataset.view === currentView || button.dataset.view === 'controls' && ControlsUI.ownsView(currentView); button.classList.toggle('selected', selected);
    if (selected) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  AdminDOM.text(document.querySelector('#task-count'),state.tasks.length);
  document.querySelector('#sidebar-status-dot').className = `status-dot ${state.paused ? 'waiting' : 'running'}`;
  AdminDOM.text(document.querySelector('#sidebar-status-text'),state.paused ? 'Server paused' : 'Server running');
}

function activityPanel(entries = state.activity, full = false, scope = 'global') {
  if (full) return ActivityUI.render(entries, scope);
  const visible = full ? entries : entries.slice(0, 6);
  return `<section class="panel"><div class="panel-header"><h2>${full ? 'Activity log' : 'Recent activity'}</h2>${full ? '' : '<button class="text-button" data-view="activity">View all ' + icon('arrow-right') + '</button>'}</div>
    ${visible.length ? `<ul class="activity-list">${visible.map(entry => `<li class="activity-row" data-live-key="activity:${escapeHtml(entry.id)}"><span class="activity-glyph ${entry.level}">${icon(entry.level === 'warning' ? 'triangle-exclamation' : entry.level === 'success' ? 'check' : 'circle-info')}</span><div class="activity-content">${escapeHtml(entry.message)}<small>${escapeHtml(entry.source)}</small></div><time class="activity-time" title="${escapeHtml(formatServerTimestamp(entry.at))}" datetime="${new Date(entry.at).toISOString()}">${relativeTime(entry.at)}</time></li>`).join('')}</ul>` : '<div class="empty-state">No activity logged.</div>'}</section>`;
}

function servicesPanel() {
  const services = state.services.filter(service => `${service.name} ${service.description}`.toLowerCase().includes(serviceSearch.toLowerCase()));
  return `<section class="panel" aria-label="Services"><div class="panel-header"><h2>Services <span class="panel-count">${state.services.length}</span></h2><label class="service-search">${icon('magnifying-glass')}<input id="service-search" type="search" aria-label="Search services" placeholder="Search services" value="${escapeHtml(serviceSearch)}"></label></div>
    <div class="table-scroll"><table class="service-table responsive-services"><thead><tr><th>Service</th><th>Status</th><th>Polling</th><th>Read activity</th><th>Enabled</th><th class="service-mobile-read">Details</th></tr></thead><tbody>${services.map(service => {
      const status = serviceStatus(service);
      return `<tr data-live-key="service:${escapeHtml(service.id)}"><td class="service-name-cell"><div class="service-identity"><span class="service-icon">${icon(service.icon)}</span><button class="service-link" data-view="${escapeHtml(service.id)}">${escapeHtml(service.name)}</button></div></td><td class="service-status-cell">${statusPill(status.label,status.className)}</td><td class="service-desktop-read">${service.pollSeconds ? `Every ${formatDuration(service.pollSeconds)}` : '—'}</td><td class="service-desktop-read">${serviceEvidence(service)}</td><td class="service-toggle-cell"><div class="service-enabled"><button class="switch" role="switch" aria-checked="${service.enabled}" data-action="toggle-service" data-id="${escapeHtml(service.id)}" aria-label="${escapeHtml(service.name)} enabled"></button></div></td><td class="service-mobile-read"><details data-live-key="service-details:${escapeHtml(service.id)}"><summary>Details</summary><p>${service.pollSeconds ? `Polling every ${formatDuration(service.pollSeconds)}` : 'No automatic polling'}</p>${serviceEvidence(service)}</details></td></tr>`;
    }).join('') || '<tr><td colspan="6"><div class="empty-state">No matching services.</div></td></tr>'}</tbody></table></div></section>`;
}

function renderOverview() {
  const configured = state.services.filter(service => service.enabled && service.configurationReady && service.health === 'ready' && !['unreachable','checking'].includes(service.gatewayConnection?.status));
  const polling = state.paused ? [] : state.services.filter(service => service.enabled && service.configurationReady && service.health === 'ready' && service.pollSeconds > 0);
  const pollsPerHour = polling.reduce((sum, service) => sum + 3600 / service.pollSeconds * (service.pollTargets ?? 1), 0);
  const warnings = state.server.discoveryErrors.length + state.services.filter(service => ['error', 'restart-required'].includes(service.health) || service.enabled && (!service.configurationReady || service.pollObservation?.status === 'failed')).length;
  const failedRuns = RunUI.recentFailures();
  renderWorkspace(pageHeading('Overview','Server status and services',`${failedRuns ? `<button class="button task-failure-shortcut" data-action="overview-failed-runs">${icon('triangle-exclamation')}${failedRuns} failed run${failedRuns === 1 ? '' : 's'} · Last 24 hours</button>` : ''}<button class="button" data-action="setup-guide">${icon('route')}Setup guide</button><button class="button" data-action="refresh">${icon('rotate')}Refresh</button>`) + `
    ${state.demo && typeof DemoUI !== 'undefined' ? DemoUI.render() : ''}
    <section class="server-strip ${state.paused ? 'paused':''}" aria-label="Server controls"><div class="strip-identity"><span class="strip-icon">${icon(state.paused ? 'pause':'server')}</span><div><div class="strip-title">Server ${state.paused ? 'paused':'running'} ${statusPill(state.paused ? 'Paused':'Operational',state.paused ? 'waiting':'running')}</div><p class="strip-description">${state.server.runningTasks} active Tasks · ${configured.length} ready services</p></div></div><div class="server-toggle"><div class="server-toggle-text">Enabled</div><button class="switch" role="switch" aria-checked="${!state.paused}" data-action="toggle-server" aria-label="Server functions enabled"></button></div></section>
    <div class="metrics-grid">${metric('Active services',state.paused ? 0:configured.length,`/ ${state.services.length}`,'Configured and enabled','layer-group')}${metric('Polling rate',Number(pollsPerHour.toFixed(2)),'/ hour',polling.length ? 'Configured automatic rate' : 'No active polling services','arrows-rotate')}${metric('Server uptime',formatDuration(state.server.uptimeSeconds),'','','clock')}${metric('Needs attention',warnings,'',warnings ? 'Review configuration and Activity':'No service warnings','triangle-exclamation')}</div>
    <div class="dashboard-grid"><div class="dashboard-main">${servicesPanel()}${activityPanel()}</div><div class="dashboard-aside"><section class="panel"><div class="panel-header"><h2>Server details</h2>${icon('server')}</div><div class="panel-body"><dl class="facts"><div><dt>Name</dt><dd>${escapeHtml(config.name)}</dd></div><div><dt>Version</dt><dd>${escapeHtml(config.version)}</dd></div><div><dt>Address</dt><dd>${escapeHtml(state.server.address)}</dd></div><div><dt>Tasks</dt><dd>${state.tasks.filter(task=>task.enabled).length} enabled</dd></div><div><dt>Process CPU</dt><dd>${state.server.cpuPercent}%</dd></div><div><dt>Process memory</dt><dd>${Math.round(state.server.memoryBytes/1048576)} MB</dd></div></dl><div class="aside-note"><button class="text-button" data-view="settings">Server settings ${icon('arrow-right')}</button></div></div></section></div></div>`);
}

function runsPanel() {
  const filtered = RunUI.filtered();
  const rows = filtered.slice(0, RunUI.limit).map(run => {
    const task = state.tasks.find(task => task.id === run.taskId);
    const busy = state.runs.some(item => item.taskId === run.taskId && ['running', 'queued'].includes(item.status));
    const unavailable = !task ? 'The Task has been deleted.' : !task.enabled ? 'Enable the Task to rerun it.'
      : state.paused ? 'Enable server functions to rerun.' : busy ? 'This Task is already running.' : '';
    const control = run.status === 'running'
      ? `<button class="button" data-action="cancel-run" data-id="${escapeHtml(run.id)}">Cancel run</button>`
      : `<button class="button" data-action="task-rerun" data-id="${escapeHtml(run.id)}" data-revision="${task?.revision || 0}" aria-label="Rerun ${escapeHtml(run.name)}" title="${escapeHtml(unavailable || 'Review the current Task and this run’s saved Event values before rerunning.')}" ${unavailable ? 'disabled' : ''}>${icon('arrow-rotate-left')}Rerun</button>`;
    return `<article class="run-card" data-live-key="run:${escapeHtml(run.id)}"><div class="settings-item"><div class="settings-text"><h3>${escapeHtml(run.name)}</h3><p>${escapeHtml(RunUI.triggerText(run))} · ${escapeHtml(formatServerTimestamp(run.startedAt))} · ${RunUI.elapsed(run.startedAt, run.finishedAt)}${run.status === 'running' ? ` · Step ${run.step}` : ''}</p>${RunUI.outcome(run)}</div>${statusPill(state.paused && run.status === 'running' ? 'Paused' : run.status, run.status === 'failed' ? 'waiting' : run.status === 'running' ? 'running' : 'paused')}<button class="button" data-action="runs-details" data-id="${escapeHtml(run.id)}" aria-expanded="${RunUI.opened.has(run.id)}" aria-controls="run-details-${escapeHtml(run.id)}">Details</button>${control}</div>${RunUI.details(run)}</article>`;
  });
  return `<section class="panel plugin-log"><div class="panel-header"><h2>Task runs</h2><span>${filtered.length} retained</span></div>${RunUI.controls()}${rows.join('') || '<div class="empty-state">No runs match these filters.</div>'}${filtered.length > RunUI.limit ? '<div class="panel-body"><button class="button" data-action="runs-more">Show more runs</button></div>' : ''}</section>`;
}

function renderSettings() {
  renderWorkspace(pageHeading('Settings','Server configuration') + '<p class="save-guidance">Switches and sliders save automatically. Other settings use Edit and Save changes. <span data-save-status aria-live="polite"></span></p>' + `<div class="settings-groups">
    <section class="panel settings-group" aria-label="General"><div class="panel-header"><h2>General</h2></div>
      <div class="settings-item">${icon('server')}<div class="settings-text"><h3>Server name</h3><p>${escapeHtml(config.name)}</p></div><button class="button" data-action="edit-name" aria-label="Edit server name">${icon('pen')}Edit</button></div>
      <div class="settings-item">${icon('location-dot')}<div class="settings-text"><h3>Server location</h3><p>${config.location ? `${config.location.latitude}, ${config.location.longitude}` : 'Not configured'}</p></div><button class="button" data-action="edit-location" aria-label="Edit server location">${icon('pen')}Edit</button></div>
      <div class="settings-item">${icon('clock')}<div class="settings-text"><h3 id="time-format-label">Use 24-hour format</h3></div><button id="time-format" class="switch" type="button" role="switch" aria-labelledby="time-format-label" aria-checked="${config.timeFormat === '24'}" data-action="toggle-time-format"></button></div>
    </section>
    <section class="panel settings-group" aria-label="Appearance"><div class="panel-header"><h2>Appearance</h2></div>
      <div class="settings-item">${icon('circle-half-stroke')}<div class="settings-text"><h3>Administrator theme</h3><p>${config.theme === 'dark' ? 'Dark' : 'Light'} · Administrator interface only</p></div><button class="button" data-action="theme">${icon('circle-half-stroke')}Switch to ${config.theme === 'dark' ? 'light' : 'dark'}</button></div>
      <div class="settings-item">${icon('display')}<div class="settings-text"><h3>Display theme</h3><p>${config.displayTheme === 'dark' ? 'Dark' : 'Light'} · Vistas, Cards and browser controls. Controller has its own appearance setting.</p></div><button class="button" data-action="display-theme">${icon('circle-half-stroke')}Switch to ${config.displayTheme === 'dark' ? 'light' : 'dark'}</button></div>
      ${fontSizeSetting('Administrator font size', 'font-scale', config.fontScale, 'Administrator interface')}
      ${fontSizeSetting('Display font size', 'vista-font-scale', config.vistaFontScale, 'Vistas, Cards and browser controls')}
    </section>
    ${ColorThemeUI.render()}
    <section class="panel settings-group" aria-label="Automation"><div class="panel-header"><h2>Automation</h2></div>
      <div class="settings-item">${icon('moon')}<div class="settings-text"><h3 id="do-not-disturb-label">Do not disturb · Enable now</h3><p>${state.doNotDisturb?.active ? 'Active' : 'Inactive'}${state.doNotDisturb?.scheduled ? ' · Weekly schedule' : ''}${state.doNotDisturb?.manual ? ' · Enabled manually' : ''}. Skips automatic TV actions. Manual controls and Run / Rerun remain available.</p></div><button id="do-not-disturb" class="switch" type="button" role="switch" aria-labelledby="do-not-disturb-label" aria-checked="${config.doNotDisturb.enabled}" data-action="toggle-do-not-disturb"></button></div>
      <div class="settings-item">${icon('calendar')}<div class="settings-text"><h3>Do not disturb schedule</h3><p>${doNotDisturbScheduleSummary()}</p></div><button class="button" data-action="edit-do-not-disturb" aria-label="Edit Do not disturb schedule">${icon('pen')}Edit</button></div>
      <div class="settings-item">${icon('list-check')}<div class="settings-text"><h3>Concurrent Task limit</h3><p>${config.maxConcurrentRuns}</p></div><button class="button" data-action="edit-server-options" aria-label="Edit server options">${icon('pen')}Edit</button></div>
    </section>
    <section class="panel settings-group" aria-label="History"><div class="panel-header"><h2>History</h2></div>
      <div class="settings-item">${icon('clock')}<div class="settings-text"><h3>Activity log retention</h3><p>${config.activityRetentionDays} days · Server and all plugins</p></div><button class="button" data-action="edit-log-retention" aria-label="Edit Activity log retention">${icon('pen')}Edit</button></div>
    </section>
    <section class="panel settings-group" aria-label="Network"><div class="panel-header"><h2>Network</h2></div>
      <div class="settings-item">${icon('network-wired')}<div class="settings-text"><h3>Server address</h3><p>${escapeHtml(state.server.address)}</p></div><button class="button" data-action="edit-server-options" aria-label="Edit server options">${icon('pen')}Edit</button></div>
    </section>
  ${AdminUX.versions(state)}</div>`);
}

function fontSizeSetting(label, id, value, description) {
  return `<div class="settings-item">${icon('text-height')}<div class="settings-text"><h3><label for="${id}">${label}</label></h3><p>${description}</p></div><div class="font-scale-control"><input id="${id}" type="range" min="80" max="130" step="5" value="${value}" aria-valuetext="${value}%"><output id="${id}-value" for="${id}">${value}%</output><button class="icon-button" data-action="reset-${id}" aria-label="Reset ${label.toLowerCase()} to 100%">${icon('rotate-left')}</button></div></div>`;
}

function renderPlugin(service) {
  PluginUI.render(service);
}

function renderView() {
  const focused = document.activeElement;
  const focusId = focused?.id;
  const focusRegion = focused?.closest('#admin-navigation') ? document.querySelector('#admin-navigation') : workspace;
  const signature = node => JSON.stringify([node.tagName, node.dataset, node.getAttribute('aria-label'), node.getAttribute('href'), node.getAttribute('name'), node.closest('[data-activity-details]')?.dataset.activityDetails, node.closest('[data-variable-details]')?.dataset.variableDetails]);
  const focusSignature = focused?.matches('button,a,summary,input,select') ? signature(focused) : null;
  if (!['overview','tasks','vistas','universe','downloads','controls','control-pages','lighting-scenes','devices','phone-home','activity','settings','variables','games','vr-library','lighting'].includes(currentView) && !state.services.some(service=>service.id===currentView)) currentView='overview';
  renderNavigation();
  const plugin = state.services.find(service=>service.id===currentView);
  const title = plugin?.name || ({overview:'Overview',tasks:'Tasks',vistas:'Vistas',universe:'Universe',downloads:'Downloads',controls:'Controls','control-pages':'Remotes','lighting-scenes':'Lighting scenes',devices:'Devices','phone-home':'Controller setup',activity:'Activity',settings:'Settings',variables:'Variables',games:'Games','vr-library':'VR library',lighting:'Lighting animations'})[currentView] || 'Overview';
  AdminDOM.text(document.querySelector('#breadcrumb-page'),currentView !== 'controls' && ControlsUI.ownsView(currentView) ? 'Controls / ' + title : title);
  if (plugin) renderPlugin(plugin);
  else if (currentView==='tasks') renderWorkspace(TaskUI.renderTasks() + runsPanel());
  else if (currentView==='vistas') renderWorkspace(VistaUI.render());
  else if (currentView==='universe') renderWorkspace(UniverseUI.render());
  else if (currentView==='downloads') renderWorkspace(DownloadsUI.render());
  else if (currentView==='controls') renderWorkspace(ControlsUI.render());
  else if (currentView==='control-pages') renderWorkspace(ControlsUI.pages());
  else if (currentView==='lighting-scenes') renderWorkspace(LightingScenesUI.render());
  else if (currentView==='devices') renderWorkspace(DevicesUI.render());
  else if (currentView==='phone-home') renderWorkspace(PhoneHomeUI.render());
  else if (currentView==='activity') renderWorkspace(pageHeading('Activity','Server and Task activity') + activityPanel(state.activity,true));
  else if (currentView==='settings') renderSettings();
  else if (currentView==='variables') renderWorkspace(VariablesUI.render());
  else if (currentView==='games') renderWorkspace(GamesUI.render());
  else if (currentView==='lighting') renderWorkspace(LightingUI.render());
  else if (currentView==='vr-library') renderWorkspace(VrLibraryUI.render());
  else renderOverview();
  // Retained controls keep focus. If a structural change replaces one, restore
  // the matching semantic control without moving its scroll container.
  if (focusId && !focused.isConnected) document.getElementById(focusId)?.focus({preventScroll: true});
  else if (focusSignature && !focused.isConnected) {
    [...focusRegion.querySelectorAll('button,a,summary,input,select')].find(node => signature(node) === focusSignature)?.focus({preventScroll: true});
  }
  renderSaveFeedback();
}

function openNameEditor() {
  showDialog(`<form id="settings-form">${dialogHeader('Edit server name')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>${formField('Server name','server',`<input name="name" required maxlength="64" value="${escapeHtml(config.name)}">`)}</div>${dialogFooter()}</form>`,{kind:'name'});
}

function openLocationEditor() {
  // Prefill only saved server coordinates. Clearing both removes the location;
  // a partially filled pair is rejected rather than silently using zero.
  showDialog(`<form id="settings-form">${dialogHeader('Server location')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><div class="field-row">${formField('Latitude','location-dot',`<input name="latitude" type="number" min="-90" max="90" step="any" value="${config.location?.latitude ?? ''}">`)}${formField('Longitude','location-dot',`<input name="longitude" type="number" min="-180" max="180" step="any" value="${config.location?.longitude ?? ''}">`)}</div><p class="field-help">Exposed to enable internationalization and localization for plugins (e.g., Sunrise, Local News, Weather).</p></div>${dialogFooter()}</form>`,{kind:'location'});
}

function openServerOptions() {
  showDialog(`<form id="settings-form">${dialogHeader('Server options')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>${formField('Listen address','network-wired',`<input name="host" list="server-address-options" maxlength="45" required value="${escapeHtml(config.listen.host)}"><datalist id="server-address-options"><option value="127.0.0.1">This computer (IPv4)</option><option value="::1">This computer (IPv6)</option></datalist>`)}${formField('Port','hashtag',`<input name="port" type="number" min="0" max="65535" required value="${config.listen.port}">`,'Use a private LAN IPv4 address to enable network access; localhost stays available. LAN mode includes administration and Controls. Port 0 selects an available port. Changes apply on restart.')}${formField('Concurrent Task limit','list-check',`<input name="maxConcurrentRuns" type="number" min="1" max="100" required value="${config.maxConcurrentRuns}">`)}</div>${dialogFooter()}</form>`,{kind:'server-options'});
}

function openLogRetentionEditor() {
  showDialog(`<form id="settings-form">${dialogHeader('Activity log retention')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>${formField('Keep logs (days)','clock',`<input name="activityRetentionDays" type="number" min="1" max="3650" step="1" required value="${config.activityRetentionDays}">`,'Applies to server and all plugin Activity logs. Entries older than this period are permanently deleted when saved, at startup, and during automatic cleanup. Increasing the period cannot restore deleted entries.')}</div>${dialogFooter()}</form>`,{kind:'log-retention'});
}

function doNotDisturbScheduleSummary() {
  const setting = config.doNotDisturb;
  const days = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
  const selected = setting.days.length === 7 ? 'Every day' : days.filter(([day]) => setting.days.includes(day)).map(([, name]) => name).join(', ');
  return `${setting.scheduleEnabled ? 'Enabled' : 'Disabled'} · ${selected} · ${TimeUI.format(setting.start)}–${TimeUI.format(setting.end)}${setting.start > setting.end ? ' (next day)' : ''} · Server local time`;
}

function openDoNotDisturbEditor() {
  const setting = config.doNotDisturb;
  // Reuse the Task editor's Monday-first days and editable quarter-hour menus.
  // Each menu owns its canonical HH:mm value, independently of display format.
  showDialog(`<form id="settings-form">${dialogHeader('Do not disturb schedule')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>
    ${PluginUI.field({id: 'scheduleEnabled', label: 'Enable weekly schedule', type: 'boolean'}, setting.scheduleEnabled, 'dnd')}
    ${TaskUI.weekdayFields(setting)}
    <div class="field-row"><div data-dnd-start>${formField('Start time', 'clock', TimeUI.render(setting.start))}</div><div data-dnd-end>${formField('End time', 'clock', TimeUI.render(setting.end))}</div></div>
    <p class="field-help">Uses the server's local time. Days select when the period starts; an earlier end time means the next day. Choose different start and end times. Automatic TV steps are skipped and logged, without running later. Other Task steps continue.</p>
    <p class="field-help">Enable now stays on until you turn it off. The weekly schedule works independently. Existing TV screens stay open until their normal timer or dismissal.</p>
    </div>${dialogFooter()}</form>`, {kind: 'do-not-disturb'});
}

document.addEventListener('click', async event=>{
  const control = event.target.closest('button, a.brand'); if (!control || !state) return;
  if (control.matches('a.brand')) { event.preventDefault(); setNavigationOpen(false); currentView='overview'; renderView(); workspace.focus({preventScroll: true}); return; }
  if (control.dataset.view) { const mobile = window.matchMedia('(max-width: 800px)').matches; setNavigationOpen(false); currentView=control.dataset.view; serviceSearch=''; renderView(); if (mobile) workspace.focus({preventScroll: true}); return; }
  const {action,id}=control.dataset;
  try {
    if (action==='theme') { const theme=document.documentElement.dataset.theme==='dark'?'light':'dark'; setTheme(theme); await changeSettings({theme,adminColorTheme:''}); return; }
    if (action==='display-theme') { await changeSettings({displayTheme:config.displayTheme==='dark'?'light':'dark',displayColorTheme:''}); return; }
    if (!action) return;
    if(action.startsWith('room-'))return await LightingRoomUI.handle(action,control);
    if(action==='downloads-refresh')return await DownloadsUI.load();
    if(action.startsWith('scene-'))return await LightingScenesUI.handle(action,control);
    if(action.startsWith('cloud-')&&typeof CloudRelayUI!=='undefined')return await CloudRelayUI.handle(control);
    if(action.startsWith('device-'))return await DevicesUI.handle(action,id,control);
    if(action.startsWith('setup-'))return SetupUI.handle(action,id);
    if (action === 'overview-failed-runs') {
      RunUI.task = ''; RunUI.status = 'failed'; RunUI.period = 'day'; RunUI.limit = 20;
      currentView = 'tasks'; setNavigationOpen(false); renderView();
      workspace.querySelector('.plugin-log')?.scrollIntoView({block:'start'}); return;
    }
    if(action==='phone-home-edit')return PhoneHomeUI.edit();
    if(action==='phone-home-copy-address')return await PhoneHomeUI.copyAddress();
    if(action==='demo-install'||action==='demo-run'){
      if(!state.demo||typeof DemoUI==='undefined')throw new Error('Demo setup is unavailable. Refresh the administrator.');
      return await DemoUI.handle(action);
    }
    if(action==='plugin-task-builder')return await PluginUI.openTaskBuilder(state.services.find(service=>service.id===currentView),control.dataset.intent);
    if(action==='task-recipe')return await PluginUI.openTaskBuilder(state.services.find(service=>service.id===id && service.enabled && service.taskBuilder));
    if(action==='task-view-runs') {
      if(!state.tasks.some(task=>task.id===id))return;
      RunUI.task=id; RunUI.status=''; RunUI.period=''; RunUI.limit=20;
      currentView='tasks'; renderView();
      workspace.querySelector('#runs-task')?.focus({preventScroll:true});
      workspace.querySelector('#runs-task')?.scrollIntoView({block:'center'}); return;
    }
    if (action === 'navigation-toggle' || action === 'navigation-close') {
      setNavigationOpen(action === 'navigation-toggle' && document.body.dataset.navigationOpen !== 'true'); return;
    }
    if (action.startsWith('lighting-') || action.endsWith('-lighting')) return await LightingUI.handle(action,id,control);
    if (action.startsWith('vr-')) return await VrLibraryUI.action(action,control);
    if (action.startsWith('game-')) return await GamesUI.action(action);
    if (action.startsWith('universe-')) return await UniverseUI.handleAction(action, control);
    if (action.startsWith('vista-') || action.endsWith('-vista')) return await VistaUI.handleAction(action,id,control);
    if (action.startsWith('control-') || action.endsWith('-control')) return await ControlsUI.handleAction(action,id,control);
    if (action.startsWith('plugin-')) return await PluginUI.handleAction(action,id,control);
    if (action.startsWith('card-') || action.endsWith('-card')) return await CardDesigner.handleAction(action,id,control);
    if (action.startsWith('task-') || action.endsWith('-task')) return await TaskUI.handleAction(action,id,control);
    if (action==='toggle-server') {
      control.disabled = true;
      try { await mutate('api/pause',{paused:!state.paused}); }
      finally { if (control.isConnected) control.disabled = false; }
    }
    if (action==='toggle-service') {
      const service = state.services.find(service => service.id === id);
      control.disabled = true;
      try { await mutate(`api/plugins/${id}/enabled`, { enabled: !service.enabled, revision: service.config.revision }); }
      finally { if (control.isConnected) control.disabled = false; }
    }
    if (action==='cancel-run') await mutate(`api/runs/${id}/cancel`,{});
    if (action==='edit-name') openNameEditor();
    if (action==='reload-administrator') {
      if(saveFeedback.pending||preferencesPending||fontTimers.size||dialog.open){notify('Wait for changes to finish saving before reloading.');return;}
      location.reload();return;
    }
    if (action==='edit-location') openLocationEditor();
    if (action==='edit-log-retention') openLogRetentionEditor();
    if (action==='edit-do-not-disturb') openDoNotDisturbEditor();
    if (action==='toggle-do-not-disturb') {
      control.disabled = true;
      try { await changeSettings({doNotDisturb: {...config.doNotDisturb, enabled: !config.doNotDisturb.enabled}}); }
      finally { if (control.isConnected) control.disabled = false; }
    }
    if (action==='edit-server-options') openServerOptions();
    if (action === 'reset-font-scale' || action === 'reset-vista-font-scale') {
      const vista = action === 'reset-vista-font-scale';
      const slider = vista ? 'vista-font-scale' : 'font-scale';
      clearTimeout(fontTimers.get(slider)); fontTimers.delete(slider);
      await changeSettings({ [vista ? 'vistaFontScale' : 'fontScale']: 100 });
    }
    if (action === 'toggle-time-format') {
      // Commit through the shared preference queue; failed saves keep the old state.
      control.disabled = true;
      try { await changeSettings({ timeFormat: config.timeFormat === '24' ? '12' : '24' }); }
      finally { if (control.isConnected) control.disabled = false; }
    }
    if (action==='refresh') await mutate('api/plugins/refresh',{});
    if (action==='close-dialog') requestDialogClose();
    if (action==='discard') closeDialog();
    if (action==='keep-editing') closeConfirmation();
  } catch (error) { notify(error.message); }
});

document.addEventListener('submit',async event=>{
  event.preventDefault();
  if (['device-editor-form','device-use-form','device-forget-form'].includes(formIdentifier(event.target))) return DevicesUI.submit(event.target);
  if (formIdentifier(event.target) === 'universe-editor-form') return UniverseUI.submit(event.target);
  if (formIdentifier(event.target) === 'vista-editor-form') return VistaUI.submit(event.target);
  if (['controls-editor-form','controls-plugin-form'].includes(formIdentifier(event.target))) return ControlsUI.submit(event.target);
  if (formIdentifier(event.target) === 'card-editor-form') return CardDesigner.submit(event.target);
  if (formIdentifier(event.target) === 'plugin-item-form') return PluginUI.submitItem(event.target);
  if (formIdentifier(event.target) === 'plugin-lookup-form') return PluginUI.submitLookup(event.target);
  if (formIdentifier(event.target) === 'task-run-form') return TaskUI.submitRun(event.target);
  if (formIdentifier(event.target) === 'task-rerun-form') return TaskUI.submitRerun(event.target);
  if (event.target.matches('.plugin-event-form')) return PluginUI.submit(event.target);
  if (formIdentifier(event.target)==='editor-form') return TaskUI.submit(event.target);
  if (formIdentifier(event.target)!=='settings-form') return;
  const values=Object.fromEntries(new FormData(event.target));
  let patch;
  if (dialogContext.kind === 'name') patch = { name: values.name.trim() };
  else if (dialogContext.kind === 'log-retention') patch = { activityRetentionDays: Number(values.activityRetentionDays) };
  else if (dialogContext.kind === 'do-not-disturb') {
    const form = event.target;
    const start = TimeUI.normalize(form.querySelector('[data-dnd-start] [data-time-input]'));
    const end = TimeUI.normalize(form.querySelector('[data-dnd-end] [data-time-input]'));
    const days = new FormData(form).getAll('days').map(Number);
    if (!start || !end || start === end || !days.length) return showFormError('Choose at least one day and different valid start and end times.');
    patch = {doNotDisturb: {...config.doNotDisturb, scheduleEnabled: form.elements.scheduleEnabled.checked, days, start, end}};
  }
  else if (dialogContext.kind === 'location') {
    const latitude = values.latitude.trim(), longitude = values.longitude.trim();
    if (Boolean(latitude) !== Boolean(longitude)) return showFormError('Enter both coordinates, or clear both.');
    patch = { location: latitude ? { latitude: Number(latitude), longitude: Number(longitude) } : null };
  } else patch = {listen:{host:values.host,port:Number(values.port)},maxConcurrentRuns:Number(values.maxConcurrentRuns)};
  const button=event.target.querySelector('[type="submit"]'); button.disabled=true;
  try { await changeSettings(patch); closeDialog(); renderView(); notify('Settings saved'); }
  catch (error) { button.disabled=false; showFormError(error.message); }
});

document.addEventListener('input',event=>{
  if (event.target.matches('[data-event-search]')) { TaskUI.searchEvents(event.target); return; }
  if (event.target.id === 'plugin-search') { pluginSearch = event.target.value; renderNavigation(); return; }
  if (event.target.name === 'startName') {
    // Only direct name edits opt out of automatic naming, not type changes.
    event.target.closest('.task-block').querySelector('[name="ruleNameEdited"]').value = 'true';
  }
  // Update the saved time representation before the block summary reads it.
  if (event.target.matches('[data-time-input]')) TimeUI.normalize(event.target);
  if (event.target.id==='action-search') { TaskUI.librarySearch=event.target.value; TaskUI.refreshLibrary(); }
  if (event.target.closest('.task-block')) {
    const block = event.target.closest('.task-block');
    TaskUI.syncNoticeOptions(block);
    TaskUI.updateSummary(block);
  }
  if (event.target.id==='task-search') { TaskUI.search=event.target.value; AdminDOM.update(document.querySelector('#task-rows'),TaskUI.rows()); }
  if (['font-scale', 'vista-font-scale'].includes(event.target.id)) {
    // Each slider owns its debounce; moving one cannot discard the other's save.
    // Only administrator sizing changes the editor document's CSS variable.
    const id = event.target.id, value = Number(event.target.value);
    const key = id === 'font-scale' ? 'fontScale' : 'vistaFontScale';
    if (key === 'fontScale') setFontScale(value);
    else {
      AdminDOM.text(document.querySelector('#vista-font-scale-value'),`${value}%`);
      event.target.setAttribute('aria-valuetext', `${value}%`);
    }
    clearTimeout(fontTimers.get(id));
    renderSaveFeedback();
    fontTimers.set(id, setTimeout(() => {
      fontTimers.delete(id);
      changeSettings({ [key]: value }).catch(error => notify(error.message));
    }, 250));
  }
  if (event.target.id==='service-search') {
    serviceSearch=event.target.value;
    const holder=document.createElement('div'); holder.innerHTML=servicesPanel();
    AdminDOM.update(document.querySelector('.service-table tbody'),holder.querySelector('tbody').innerHTML);
  }
});

document.addEventListener('invalid', event => {
  const fields=event.target.closest('#editor-form .task-block-fields');
  if(fields)fields.hidden=false;
}, true);

document.addEventListener('change',event=>{
  if (event.target.matches('[data-event-value-picker]')) TaskUI.insertEventValue(event.target);
  else if (event.target.matches('[data-task-type]')) TaskUI.changeType(event.target);
  else if (event.target.closest('.task-block') && ['eventId', 'conditionField'].includes(event.target.name)) TaskUI.changeEventCondition(event.target);
  else if (event.target.closest('.task-block')) TaskUI.updateSummary(event.target.closest('.task-block'));
});
dialog.addEventListener('cancel',event=>{event.preventDefault();requestDialogClose();});
// Escape dismisses only the confirmation, preserving the editor and its draft.
confirmationDialog.addEventListener('cancel', event => {
  event.preventDefault();
  closeConfirmation();
});
confirmationDialog.addEventListener('keydown', handleConfirmationKeydown);

function handleConfirmationKeydown(event) {
  if (event.key !== 'Tab') return;
  const keepEditing = confirmationDialog.querySelector('[data-action="keep-editing"]');
  const discard = confirmationDialog.querySelector('[data-action="discard"]');
  // Wrap both ends explicitly so keyboard focus stays in this two-action popup.
  if (event.shiftKey && document.activeElement === keepEditing) {
    event.preventDefault();
    discard.focus();
  } else if (!event.shiftKey && document.activeElement === discard) {
    event.preventDefault();
    keepEditing.focus();
  }
}

async function initialize() {
  try {
    AdminDOM.install();
    setNavigationOpen(false, false);
    await refreshState();
    TimeUI.install();
    setInterval(updateServerClock, 1000);
    let polling = false;
    setInterval(async()=>{
      // Keep one state read in flight. DOM reconciliation retains active fields;
      // open modal drafts keep their captured definitions and save revisions.
      if (polling || document.hidden) return;
      polling = true;
      try { await refreshState(!dialog.open && !PluginUI.pending && !CardDesigner.pending && !VistaUI.pending && !ControlsUI.pending && !GamesUI.pending && !document.querySelector('#glyph-picker[open]')); }
      catch {
        serverClockConnected = false;
        CardDesigner.updatePreview();
        AdminDOM.text(document.querySelector('#connection-status'),'Disconnected');
      }
      finally { polling = false; }
    },2000);
  } catch(error) { renderWorkspace(pageHeading('Server unavailable',error.message)); }
}
initialize();

function setNavigationOpen(open, focus = true) {
  const mobile = window.matchMedia('(max-width: 800px)').matches;
  const navigation = document.querySelector('#admin-navigation');
  const toggle = document.querySelector('#mobile-navigation-toggle');
  const active = mobile && open;
  document.body.dataset.navigationOpen = String(active);
  navigation.hidden = mobile && !active;
  navigation.inert = mobile && !active;
  document.querySelector('.main-shell').inert = active;
  document.querySelector('.navigation-scrim').hidden = !active;
  toggle.setAttribute('aria-expanded', String(active));
  if (active) { navigation.setAttribute('role', 'dialog'); navigation.setAttribute('aria-modal', 'true'); }
  else { navigation.removeAttribute('role'); navigation.removeAttribute('aria-modal'); }
  if (focus && mobile) (active ? navigation.querySelector('.mobile-navigation-close') : toggle).focus({preventScroll: true});
}

window.addEventListener('resize', () => {
  // Mobile browser bars change viewport height while scrolling. Keep the drawer
  // open during those resizes; leaving the mobile layout still clears its trap.
  if (window.matchMedia('(max-width: 800px)').matches && document.body.dataset.navigationOpen === 'true') return;
  setNavigationOpen(false, false);
});
document.addEventListener('keydown', event => {
  if (document.body.dataset.navigationOpen !== 'true') return;
  if (event.key === 'Escape') { event.preventDefault(); setNavigationOpen(false); return; }
  if (event.key !== 'Tab') return;
  const controls = [...document.querySelector('#admin-navigation').querySelectorAll('a,button')].filter(control => !control.disabled && control.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}


function icon(name) {
  return `<i class="material-symbol ms-${escapeHtml(name)}" aria-hidden="true"></i>`;
}


function notify(message) {
  const toast = document.querySelector('#toast');
  clearTimeout(toastTimer);
  AdminDOM.text(toast,message);
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}


function pageHeading(title, description, actions = '') {
  return `<div class="page-heading"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><div class="heading-actions">${actions}</div></div>`;
}


function metric(label, value, unit, footnote, glyph) {
  return `<div class="metric"><div class="metric-top"><span>${label}</span>${icon(glyph)}</div><div class="metric-value">${value}<span>${unit}</span></div><div class="metric-foot">${footnote}</div></div>`;
}


function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}


function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 1) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}


function statusPill(label, className = 'running') {
  return `<span class="status-pill ${className}"><span class="status-dot ${className}"></span>${escapeHtml(label)}</span>`;
}


function itemActions(item, kind = 'task') {
  return AdminUX.definitionActions(item,{edit:`edit-${kind}`,copy:`copy-${kind}`,delete:`delete-${kind}`,toggle:`toggle-${kind}`});
}


function dialogHeader(title, subtitle = '') {
  return `<div class="dialog-header"><div><h2 id="dialog-title">${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div><button class="icon-button" type="button" data-action="close-dialog" aria-label="Close dialog">${icon('xmark')}</button></div>`;
}


function formField(label, glyph, input, help = '') {
  // Helper text describes the field without becoming part of its accessible name.
  const fieldId = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const accessibleInput = input.replace(/<(input|select|textarea)/, `<$1 id="${fieldId}"${help ? ` aria-describedby="${fieldId}-help"` : ''}`);
  return `<div class="field"><label class="field-label" for="${fieldId}">${icon(glyph)}${escapeHtml(label)}</label>${accessibleInput}${help ? `<span class="field-help" id="${fieldId}-help">${escapeHtml(help)}</span>` : ''}</div>`;
}


function dialogFooter(saveLabel = 'Save changes') {
  return `<div class="dialog-footer"><span class="draft-status" data-draft-status role="status" aria-live="polite"></span><button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button primary" type="submit">${escapeHtml(saveLabel)}</button></div>`;
}


function showDialog(content, context) {
  returnFocus = document.activeElement;
  dialogContext = context;
  dialog.classList.toggle('task-editor', context.kind === 'task' || context.kind === 'task-simulation');
  dialog.classList.toggle('card-editor', context.kind === 'card');
  dialog.classList.toggle('vista-editor', context.kind === 'vista' || context.kind === 'universe');
  dialog.classList.toggle('controls-editor', context.kind === 'controls');
  dialog.classList.toggle('task-builder-editor', context.kind === 'task-builder');
  dialog.classList.toggle('setup-editor', context.kind === 'setup-guide');
  document.querySelector('#dialog-content').innerHTML = content;
  const form = dialog.querySelector('form');
  initialFormValues = form ? serializeForm(form) : '';
  updateDraftStatus();
  dialog.showModal();
  // Native dialog handles focus containment; the name field is the useful start.
  (dialog.querySelector('input:not([type="hidden"]), select, textarea, button[role="switch"]') || dialog.querySelector('button'))?.focus();
}

// Selecting a captured run or inspecting a lookup changes no saved definition.
// Keep both the draft hint and close guard on the same definition boundary.
function isDefinitionEditor(form) {
  return form && !['task-run', 'task-rerun', 'task-simulation', 'plugin-lookup', 'lighting-start', 'vr-install', 'vr-uninstall'].includes(dialogContext?.kind)
    && dialogContext?.operation !== 'delete' && !formIdentifier(form).includes('delete');
}

function updateDraftStatus() {
  const form = dialog.querySelector('form'), status = dialog.querySelector('[data-draft-status]');
  if (!form || !status) return;
  if (!isDefinitionEditor(form)) { AdminDOM.text(status,''); return; }
  // Serializers already omit library searches, preview selection and other UI
  // state. The same comparison drives both this hint and discard confirmation.
  try {
    const dirty = serializeForm(form) !== initialFormValues;
    AdminDOM.text(status,dirty ? 'Unsaved changes' : dialogContext?.kind==='lighting-scene' ? 'Saving won’t change lights' : 'Changes apply when saved');
    status.dataset.dirty = String(dirty);
  } catch { AdminDOM.text(status,'Unsaved changes'); status.dataset.dirty = 'true'; }
}

// Run after existing delegated handlers update hidden fields or reorder blocks.
// No MutationObserver: polling and transient preview markup cannot mark a draft.
for (const type of ['input', 'change', 'click']) document.addEventListener(type, () => queueMicrotask(updateDraftStatus));


function formIdentifier(form) {
  // Named action inputs can shadow HTMLFormElement properties such as id.
  // Read the element's attribute through the native method instead.
  return Element.prototype.getAttribute.call(form,'id') || '';
}
function serializeForm(form) {
  const id=formIdentifier(form);
  if(id==='phone-home-form')return JSON.stringify([...form.querySelectorAll('[data-phone-task]')].map(row=>({id:row.dataset.phoneTask,publish:row.querySelector('[name="publish"]').checked,icon:row.querySelector('[name="icon"]').value,enabled:row.querySelector('[name="enabled"]').checked,label:row.querySelector('[name="label"]').value.trim()})));
  // Optional builders keep one canonical draft across their changing pages.
  // Navigation/search are presentation; only meaningful choices affect discard.
  if(id==='recipe-builder-form'&&form.querySelector('[data-task-builder-draft]'))return form.querySelector('[data-task-builder-draft]').value;
  if (id === 'universe-editor-form') return JSON.stringify(UniverseUI.readDraft());
  if (id === 'vista-editor-form') return JSON.stringify(VistaUI.readDraft());
  if (id === 'lighting-animation-form') return JSON.stringify(LightingUI.readDraft());
  if (id === 'lighting-scene-form') return JSON.stringify(LightingScenesUI.draft(form));
  if (id === 'lighting-management-form') return JSON.stringify(LightingRoomUI.editDraft(form));
  if (id === 'card-editor-form') return JSON.stringify(CardDesigner.readDraft());
  if (id === 'controls-editor-form') return JSON.stringify(ControlsUI.readDraft());
  // timeText is presentation only; its hidden HH:mm value determines changes.
  return JSON.stringify([...new FormData(form).entries()].filter(([name]) => name !== 'timeText'));
}


function requestDialogClose() {
  TimeUI.close();
  const form = dialog.querySelector('form');
  if (isDefinitionEditor(form) && serializeForm(form) !== initialFormValues) {
    if (confirmationDialog.open) return;
    confirmationReturnFocus = document.activeElement;
    // showModal adds a top-layer popup without resizing or rebuilding the editor.
    // Native modal behavior blocks interaction with the draft underneath it.
    confirmationDialog.showModal();
    confirmationDialog.querySelector('[data-action="keep-editing"]').focus();
    return;
  }
  closeDialog();
}

function closeConfirmation(restoreFocus = true) {
  const previousFocus = confirmationReturnFocus;
  if (confirmationDialog.open) confirmationDialog.close();
  confirmationReturnFocus = null;
  if (restoreFocus && previousFocus?.isConnected) {
    previousFocus.focus({ preventScroll: true });
  }
}

function closeDialog() {
  dialog.classList.remove('wide-preview');
  VistaUI.preview?.destroy();
  VistaUI.preview = null;
  TimeUI.close();
  const previousFocus = returnFocus;
  // Discard closes both layers; Keep editing and Escape close only the popup.
  closeConfirmation(false);
  dialog.close();
  dialogContext = null;
  if (previousFocus?.isConnected) previousFocus.focus();
  else workspace.focus({ preventScroll: true });
}


function showFormError(message) {
  const error = dialog.querySelector('#form-error');
  AdminDOM.text(error,message);
  error.hidden = false;
}


function restoreRowFocus() {
  if (!returnFocus?.dataset) return;
  const action = returnFocus.dataset.action;
  const id = returnFocus.dataset.id;
  if (action) {
    const candidate = [...document.querySelectorAll('[data-action]')].find(button => button.dataset.action === action && button.dataset.id === id);
    candidate?.focus({ preventScroll: true });
  }
}


