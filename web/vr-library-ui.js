/** APK library presentation. Browsing never sends a headset package command. */
const VrLibraryUI = {
  missingArt: new Set(), data: null, error: '', loading: false, pending: false, readAt: 0,
  query: '', genre: '', filter: 'all', sort: 'title',
  async refresh(force = false) {
    if (this.loading || !force && Date.now() - this.readAt < 2000) return;
    this.loading = true; this.readAt = Date.now();
    try { this.data = await request('/api/vr-library'); this.error = ''; }
    catch (error) { this.error = error.message; }
    finally { this.loading = false; if (currentView === 'vr-library' && !dialog.open) renderView(); }
  },
  render() {
    void this.refresh();
    const value = this.data, escape = escapeHtml;
    const heading = pageHeading('VR library', 'Oculus Go applications', `<button class="button" data-action="vr-settings">${icon('sliders')}Connection & settings</button>`);
    if (this.error) return heading + `<section class="panel vr-library-section"><div class="empty-state" role="status">${escape(this.error)} <button class="button" data-action="vr-refresh">Try again</button></div></section>`;
    if (!value) return heading + '<section class="panel vr-library-section"><div class="empty-state" role="status">Loading library…</div></section>';
    if (!value.available) return heading + `<section class="panel vr-library-section"><div class="empty-state">${icon('vr-cardboard')}<h2>Set up your library</h2><p>${escape(value.reason)}</p><button class="button primary" data-action="vr-settings">Open Oculus Go settings</button></div></section>`;
    const installed = new Set(value.inventory?.packages || []), genres = [...new Set(value.apps.flatMap(app => app.tags))].sort();
    let apps = value.apps.filter(app => (!this.query || (app.title + ' ' + app.packageName + ' ' + app.tags.join(' ')).toLowerCase().includes(this.query.toLowerCase()))
      && (!this.genre || app.tags.includes(this.genre)) && (this.filter !== 'installed' || installed.has(app.packageName)));
    apps.sort((a,b) => this.sort === 'newest' ? b.added - a.added : this.sort === 'size' ? a.versions[0].size - b.versions[0].size : a.title.localeCompare(b.title));
    const blocked = this.pending || value.busy || state.paused;
    return heading + `<section class="panel vr-library-intro"><div class="panel-body"><div class="vr-library-summary"><div>${icon('vr-cardboard')}<strong>${value.apps.length} titles</strong><span>${value.apps.reduce((n,app) => n + app.versions.length,0)} APKs</span>${value.inventory ? `<span>${installed.size} user apps installed · read ${escape(relativeTime(value.inventory.at))}</span>` : '<span>Installed apps have not been read</span>'}</div><div class="heading-actions"><button class="button" data-action="vr-scan" ${this.pending || value.scanning ? 'disabled' : ''}>${icon('arrows-rotate')}${value.scanning ? 'Scanning…' : 'Scan library'}</button><button class="button" data-action="vr-inventory" ${blocked ? 'disabled' : ''}>${icon('download')}Read installed apps</button></div></div><p class="field-help">Library folder: ${escape(value.folder)}. Add your standalone APK files there, then scan. Install and uninstall apply only to the headset configured in Oculus Go settings.</p>${state.paused ? '<p class="field-help">Enable server functions before changing or reading installed applications.</p>' : ''}
      <details data-live-key="vr-home-access"><summary>Use the Home VR headset app</summary><p>In Home VR, open Settings → Change address. Enter this server’s LAN IP and port, such as <strong>192.168.1.10:7041</strong>. Use the same network and keep wireless ADB enabled for installations. “Find PC” can still find a separate server.</p><p>Headset access: <strong>${value.homeVrEnabled ? 'Enabled' : 'Disabled'}</strong>. The matching Home VR token is configured in Oculus Go settings.</p><button class="button" data-action="vr-save-token" ${this.pending ? 'disabled' : ''}>Save Home VR token</button><p class="field-help">Saves the replacement token with Windows credential protection. Afterwards, clear its replacement field in plugin settings. The protected copy remains.</p></details></div></section>
      ${value.clientApp ? `<section class="panel vr-library-section"><div class="panel-body"><h2>Localserve Go</h2><p>The native headset app appears as <strong># Localserve #</strong>. Browse, play, favorite, install and manage your collection in VR.</p><div class="heading-actions"><a class="button" href="${value.clientApp.url}" download>${icon("download")}Download Go app · v${escape(value.clientApp.version)}</a><button class="button primary" data-action="vr-client-code" ${this.pending ? "disabled" : ""}>${icon("link")}Connect headset</button></div><p class="field-help">Install the APK using your own authorized headset setup tools. The app contains no server address or credentials. Home VR remains a separate application.</p></div></section>` : ""}
      ${this.job(value.job, value.busy)}
      ${value.errors.length ? `<section class="panel vr-library-section"><div class="panel-body"><details><summary>${value.errors.length} library issue${value.errors.length === 1 ? '' : 's'}</summary><ul>${value.errors.map(error => `<li>${escape(error)}</li>`).join('')}</ul></details></div></section>` : ''}
      <section class="panel vr-library-section"><div class="panel-header"><h2>Applications <span class="panel-count">${apps.length}</span></h2></div><div class="panel-body"><div class="vr-library-filters">
      <label class="field-label">Search<input type="search" data-vr-filter="query" value="${escape(this.query)}" placeholder="Title, package or genre"></label>
      <label class="field-label">Show<select data-vr-filter="filter"><option value="all" ${this.filter === 'all' ? 'selected' : ''}>All applications</option><option value="installed" ${this.filter === 'installed' ? 'selected' : ''} ${value.inventory ? '' : 'disabled'}>Installed</option></select></label>
      <label class="field-label">Genre<select data-vr-filter="genre"><option value="">All genres</option>${genres.map(genre => `<option ${this.genre === genre ? 'selected' : ''}>${escape(genre)}</option>`).join('')}</select></label>
      <label class="field-label">Sort<select data-vr-filter="sort">${[['title','A–Z'],['newest','Newest'],['size','APK size']].map(([id,label]) => `<option value="${id}" ${this.sort === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
      ${apps.length ? `<div class="vr-library-grid">${apps.map(app => `<article class="vr-app" data-live-key="vr:${escape(app.id)}"><div class="vr-app-art">${icon('vr-cardboard')}${this.missingArt.has(app.packageName) ? '' : `<img src="/api/vr-library/art/${encodeURIComponent(app.packageName)}" data-vr-art="${escape(app.packageName)}" alt="" loading="lazy">`}</div><div class="vr-app-copy"><h3>${escape(app.title)}</h3><p class="field-help">${escape(app.tags.join(' · ')) || 'Application'} · ${app.versions.length} version${app.versions.length === 1 ? '' : 's'}</p>${installed.has(app.packageName) ? statusPill('Installed at last read','running') : ''}<p>${escape(app.description || app.packageName)}</p><button class="button" data-action="vr-details" data-id="${escape(app.id)}">${icon('circle-info')}Details & versions</button></div></article>`).join('')}</div>` : '<div class="empty-state"><h3>No applications to show</h3><p>Add APK files to the configured folder and scan, or clear your filters.</p></div>'}</div></section>
      ${value.inventory ? `<section class="panel vr-library-section"><div class="panel-header"><h2>Installed user applications</h2></div><div class="panel-body"><p class="field-help">Snapshot from the last explicit read. Protected system applications and Home VR cannot be removed here.</p><div class="vr-installed-list">${value.inventory.packages.map(packageName => `<div class="settings-item" data-live-key="installed:${escape(packageName)}"><div class="settings-text"><strong>${escape(value.apps.find(app => app.packageName === packageName)?.title || packageName)}</strong><p>${escape(packageName)}</p></div><button class="button" data-action="vr-remove" data-id="${escape(packageName)}" ${blocked || this.protected(packageName) ? 'disabled' : ''}>Uninstall</button></div>`).join('') || '<p>No user applications reported.</p>'}</div></div></section>` : ''}`;
  },
  protected(packageName) { return /^(android|com\.android|com\.oculus|com\.facebook|com\.qualcomm|com\.qti|org\.openpacific)(\.|$)/i.test(packageName) || ['com.tommi.homevr','org.localserve.go'].includes(packageName); },
  job(job, busy) {
    if (!job) return '';
    return `<section class="panel vr-library-section" data-live-key="vr-job:${escapeHtml(job.id)}"><div class="panel-body"><div class="vr-library-summary"><h2>${escapeHtml(job.state)} · ${escapeHtml(job.title)}</h2>${busy ? `<button class="button" data-action="vr-cancel" data-id="${escapeHtml(job.id)}" ${this.pending ? 'disabled' : ''}>Stop remaining work</button>` : ''}</div><p role="status">${escapeHtml(job.error || (busy ? 'Keep the headset awake and connected. The application is verified after the package operation returns.' : 'Package operation verified on the configured headset.'))}</p></div></section>`;
  },
  details(id) {
    const app = this.data.apps.find(app => app.id === id); if (!app) return;
    showDialog(`<form id="vr-install-form">${dialogHeader(app.title,'Application details')}<div class="dialog-body"><p>${escapeHtml(app.description || app.packageName)}</p><p class="field-help">${escapeHtml(app.packageName)}</p><label class="field-label" for="vr-version">Version</label><select id="vr-version" name="fileId">${app.versions.map(version => `<option value="${version.id}">${escapeHtml(version.versionName || 'Version ' + version.versionCode)} · ${this.size(version.size)} · ${escapeHtml(version.name)}</option>`).join('')}</select><p>Install sends this APK to the configured Oculus Go. An existing version may be replaced. Android signature checks remain enabled; downgrades and split APK sets are not supported.</p><p class="field-help">Wireless ADB must already be enabled and authorized. No package operation is retried automatically.</p><div id="form-error" class="form-error" role="alert" hidden></div></div><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog">Close</button><button class="button primary" type="submit" ${this.data.busy || this.pending || state.paused || this.protected(app.packageName) ? 'disabled' : ''}>${icon('download')}Install selected version</button></div></form>`, {kind:'vr-install', revision:this.data.revision, submitted:false});
  },
  size(bytes) { return bytes >= 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(2) + ' GiB' : (bytes / 1024 ** 2).toFixed(1) + ' MiB'; },
  async action(action, control) {
    if (action === 'vr-client-code') {
      if (this.pending || !this.data?.available) return;
      this.pending = true; renderView();
      try {
        const result = await request('/api/vr-library/client-code',{revision:this.data.revision});
        if (currentView !== 'vr-library' || dialog.open) return;
        const host = state.config.listen.host, port = new URL(state.server.address).port;
        const address = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ? host + ':' + port : 'Your server LAN IP:' + port;
        showDialog(`${dialogHeader('Connect Localserve Go')}<div class="dialog-body"><p>In <strong># Localserve #</strong> on your headset, open Settings and enter:</p><dl class="facts"><div><dt>Server address</dt><dd>${escapeHtml(address)}</dd></div><div><dt>Connection code</dt><dd class="vr-connection-code">${escapeHtml(result.code)}</dd></div></dl><p>The code works once and expires at ${escapeHtml(formatServerTimestamp(result.expiresAt))}. Creating another code replaces this one. Connect only on your trusted LAN.</p></div><div class="dialog-footer"><button class="button" type="button" data-action="close-dialog">Close</button></div>`,{kind:'vr-code'});
      } catch(error) { notify(error.message); }
      finally { this.pending = false; if(!dialog.open)renderView(); }
      return;
    }
    if (action === 'vr-settings') { PluginUI.tabs.set('oculus-go','settings'); currentView = 'oculus-go'; setNavigationOpen(false); renderView(); workspace.focus({preventScroll:true}); return; }
    if (action === 'vr-details') { this.details(control.dataset.id); return; }
    if (action === 'vr-refresh') { await this.refresh(true); return; }
    if (this.pending || !this.data?.available) return;
    const revision = this.data.revision;
    if (action === 'vr-remove') {
      this.pending = true; renderView();
      try {
        const result = await request('/api/vr-library/prepare-uninstall',{revision,packageName:control.dataset.id});
        if (currentView !== 'vr-library' || dialog.open) return;
        showDialog(`<form id="vr-uninstall-form">${dialogHeader('Uninstall application?')}<div class="dialog-body"><p><strong>${escapeHtml(result.packageName)}</strong></p><p>This removes the application and its saved data from the configured headset. It does not delete your APK file. This cannot be undone.</p><p class="field-help">Confirmation expires in two minutes. Protected and system applications cannot be removed.</p><div id="form-error" class="form-error" role="alert" hidden></div></div><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog" autofocus>Keep application</button><button class="button danger" type="submit">Uninstall and delete saved data</button></div></form>`, {kind:'vr-uninstall',revision,...result,submitted:false});
      } catch (error) { notify(error.message); }
      finally { this.pending = false; if (!dialog.open) renderView(); } return;
    }
    this.pending = true; renderView();
    try {
      const operation = {'vr-scan':'scan','vr-inventory':'inventory','vr-save-token':'save-token','vr-cancel':'cancel'}[action];
      if (operation) { await request('/api/vr-library/' + operation,{revision,...(action === 'vr-cancel' ? {id:control.dataset.id} : {})}); notify(action === 'vr-save-token' ? 'Token protected. Clear its replacement setting now.' : action === 'vr-cancel' ? 'Cancellation requested. Check the headset before retrying.' : action === 'vr-scan' ? 'Library scan started' : 'Installed applications read'); }
    } catch (error) { notify(error.message); }
    finally { this.pending = false; await this.refresh(true); }
  },
};
document.addEventListener('input', event => {
  const field = event.target.dataset.vrFilter; if (!field) return;
  VrLibraryUI[field] = event.target.value; if (currentView === 'vr-library') renderView();
});
document.addEventListener('error', event => {
  if (event.target.matches?.('.vr-app-art img')) { VrLibraryUI.missingArt.add(event.target.dataset.vrArt); event.target.hidden = true; }
}, true);
document.addEventListener('submit', async event => {
  if (!['vr-install-form','vr-uninstall-form'].includes(event.target.id)) return;
  event.preventDefault(); const form = event.target, context = dialogContext;
  if (!form.isConnected || !dialog.open || context.submitted || !['vr-install','vr-uninstall'].includes(context.kind)) return;
  context.submitted = true; form.querySelector('[type="submit"]').disabled = true;
  const uninstall = context.kind === 'vr-uninstall';
  try {
    const values = uninstall ? {packageName:context.packageName,confirmation:context.confirmation} : {id:new FormData(form).get('fileId')};
    await request('/api/vr-library/' + (uninstall ? 'uninstall' : 'install'),{revision:context.revision,...values});
    if (dialogContext === context) closeDialog(); notify('Package operation started');
    await VrLibraryUI.refresh(true);
  } catch (error) {
    if (dialogContext === context) showFormError(error.message + ' Close this dialog and check operation status before trying again.');
  }
});
