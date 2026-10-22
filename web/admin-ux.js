/** Presentation helpers shared by administrator views. These derive labels from
 * reported state only; they never execute actions or infer a device's state. */
const AdminUX = {
  pageServerVersion: null,
  observeServerVersion(version) {
    if(!this.pageServerVersion&&typeof version==='string')this.pageServerVersion=version;
  },
  versions(data) {
    const current=data.config?.version,packages=data.server?.clientPackages||{},previous=this.pageServerVersion;
    const changed=previous&&current&&previous!==current;
    const row=(name,value)=>`<div class="client-version-row"><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`;
    return `<section class="panel settings-group"><details class="client-versions"><summary>Versions and updates${changed?' · Reload recommended':''}</summary><div class="panel-body"><dl>${row('Running server',current?'v'+current:'Not reported')}${row('Server when this page connected',previous?'v'+previous:'Not reported')}${row('Available Android APK',packages.android?'v'+packages.android:'No verified build available')}${row('Bundled TV launcher source',packages.tvLauncherSource?'v'+packages.tvLauncherSource:'Not available')}</dl>${changed?'<p class="client-version-note" role="status">The server version changed while this page was open. Reload to load the current administrator interface.</p>':''}<button type="button" class="button" data-action="reload-administrator">${icon('arrows-rotate')}Reload administrator</button><p class="field-help">Reloading affects this browser page only. It does not restart the server or refresh a TV display.</p><h3>Android app</h3><p>The installed APK version is shown in the phone app’s Connection screen. Installing an APK and reloading its server interface are separate updates.</p><a class="button" href="sensors" target="_blank" rel="noopener">${icon('download')}Android download and setup</a><h3>TV display</h3><p>The installed TV launcher version is not reported here. Its bundled source version does not confirm what is installed on the TV. To load updated viewer scripts, finish or dismiss the current notice or game, close Vista completely, then reopen it. A server restart does not update an already-open TV document.</p></div></details></section>`;
  },
  definitionActions(item, actions, {attributes={},before=''}={}) {
    const name=escapeHtml(item.name),id=escapeHtml(item.id);
    const extra=Object.entries(attributes).map(([key,value])=>` data-${key}="${escapeHtml(value)}"`).join('');
    return `<div class="row-actions definition-actions" role="group" aria-label="Actions for ${name}">${before}${[
      ['edit','Edit','pen'],['copy','Copy','copy'],['delete','Delete','trash-can'],
    ].map(([action,label,glyph])=>`<button type="button" class="icon-button definition-action ${action==='delete'?'delete':''}" data-action="${escapeHtml(actions[action])}" data-id="${id}"${extra} title="${label} ${name}" aria-label="${label} ${name}">${icon(glyph)}<span>${label}</span></button>`).join('')}<span class="definition-enablement"><span aria-hidden="true">${item.enabled?'Enabled':'Disabled'}</span><button type="button" class="switch" role="switch" aria-checked="${item.enabled}" data-action="${escapeHtml(actions.toggle)}" data-id="${id}"${extra} title="${item.enabled?'Enabled':'Disabled'} · ${name}" aria-label="${name} enabled"></button></span></div>`;
  },
  cardAvailability(service, card) {
    if (!card) return 'Card unavailable';
    if (!card.enabled) return 'Card disabled';
    if (!service?.enabled) return 'Plugin disabled';
    if (!service.configurationReady) return 'Plugin needs configuration';
    if (card.layout === 'readymade') {
      const source = service.cardData?.readyMade?.sources?.find(item => item.id === card.sourceId);
      if (!source) return 'Data source unavailable';
      if (!source.enabled) return 'Data source disabled';
    }
    return '';
  },
  serviceStatus(service, paused = false) {
    if (['loading', 'configuring'].includes(service.health)) return {label: service.health === 'loading' ? 'Loading' : 'Updating', className: 'waiting'};
    if (['error', 'restart-required'].includes(service.health)) return {label: service.health === 'error' ? 'Runtime error' : 'Restart required', className: 'waiting'};
    if (!service.configurationReady) return {label: 'Configure', className: 'waiting'};
    if (!service.enabled) return {label: 'Disabled', className: 'paused'};
    if (paused) return {label: 'Paused', className: 'paused'};
    return service.health === 'ready' ? {label: 'Ready', className: 'running'} : {label: 'Not running', className: 'waiting'};
  },

  reception(service) {
    // A completed check may only inspect a cache. Reception must instead come
    // from a plugin-declared reception timestamp, never from command delivery,
    // clock/Event time or a forecast's publication/validity period.
    const fields = (service.cardCatalog || []).filter(field => {
      const declaration = service.cardFields?.find(item => field.id === item.id || field.id.endsWith(':' + item.id));
      return field.type === 'timestamp' && /receiv|reception/i.test(field.label) && declaration?.source?.kind === 'state';
    });
    return fields.map(field => ({label: field.label, value: service.cardData?.values[field.id]}))
      .filter(item => item.value?.available && Number.isFinite(item.value.value))
      .sort((a, b) => b.value.value - a.value.value)[0] || null;
  },

  taskActivation(task, paused = false) {
    const rules = task.starts.filter(rule => rule.enabled).length;
    const steps = task.steps.filter(step => step.enabled).length;
    const allRules = task.starts.length;
    const activation = !task.enabled ? 'Task disabled' : paused ? 'Server paused'
      : allRules && !rules ? 'Automatic rules disabled' : rules ? `${rules} automatic rule${rules === 1 ? '' : 's'} enabled` : 'Manual only';
    return `${activation} · ${rules}/${allRules} rules · ${steps}/${task.steps.length} steps enabled`;
  },

  savesDefinition(endpoint) {
    return /(?:^|\/)api\/(?:games\/maze|config|universe|display|tasks(?:\/[^/]+(?:\/(?:enabled|delete))?)?|plugins\/[^/]+\/(?:config|enabled|cards(?:\/[^/]+(?:\/(?:enabled|delete))?)?|controls(?:\/[^/]+(?:\/(?:enabled|delete))?)?)|vistas(?:\/[^/]+(?:\/(?:enabled|delete))?)?)$/.test(endpoint);
  },
};

/** Read-only setup navigation hands off to ordinary configuration editors. */
const SetupUI = {
  page:'', selected:'',
  open(page='', selected='') {
    this.page=page;this.selected=selected;
    let body='';
    if(!page)body=`<h2>What would you like to set up?</h2><div class="setup-choices">${[['device','devices','Connect a device','Configure a local device and check its readiness.'],['display','display','Create a display','Choose information Cards, then arrange a Vista.'],['phone','smartphone','Use my phone','Open Home, remotes and optional sensor reporting.']].map(([id,glyph,label,help])=>`<button type="button" class="setup-choice" data-action="setup-page" data-id="${id}">${icon(glyph)}<strong>${label}</strong><span>${help}</span></button>`).join('')}</div>`;
    if(page==='device') {
      const services=state.services.filter(service=>service.controls || service.connectionSetup || service.runtime?.preview || service.runtime?.ingest);
      const service=services.find(item=>item.id===selected);
      body=service?`<h2>${escapeHtml(service.name)}</h2><ol class="setup-checklist"><li>Configuration: <strong>${service.configurationReady?'Complete':'Needs configuration'}</strong></li><li>Plugin: <strong>${service.enabled?'Enabled':'Disabled'}</strong></li><li>Check reported readings or use an explicit connection check in Settings.</li></ol><p class="field-help">Configuration readiness does not prove a live device connection. Nothing is enabled or tested by this guide.</p><button type="button" class="button primary" data-action="setup-open-plugin" data-id="${escapeHtml(service.id)}">Open Settings</button>`:`<h2>Choose a device</h2><div class="setup-choices">${services.map(service=>`<button type="button" class="setup-choice" data-action="setup-device" data-id="${escapeHtml(service.id)}">${icon(service.icon)}<strong>${escapeHtml(service.name)}</strong><span>${service.enabled?'Enabled':'Disabled'}</span></button>`).join('') || '<p>No installed plugin declares a device interface. Install a trusted plugin in plugins/ and refresh discovery.</p>'}</div>`;
    }
    if(page==='display') {
      const services=state.services.filter(service=>service.cardData?.readyMade?.templates?.length);
      const count=state.services.reduce((total,service)=>total+(service.cards || []).filter(card=>card.enabled).length,0);
      body=`<h2>Create a display</h2><ol class="setup-checklist"><li>Configure a data source in its plugin.</li><li>Create its Card in Card designer.</li><li>Add the Card to a Vista and preview its own URL.</li></ol><p>${count} enabled Card${count===1?'':'s'} available. You can arrange a Vista before its data source is ready.</p><div class="setup-choices">${services.map(service=>`<button type="button" class="setup-choice" data-action="setup-open-cards" data-id="${escapeHtml(service.id)}">${icon(service.icon)}<strong>${escapeHtml(service.name)}</strong><span>Open Card designer</span></button>`).join('')}</div><button type="button" class="button primary" data-action="setup-new-vista">Add Vista</button><p class="field-help">Previewing does not change the shared /display selection. For a device-free example, Create demo is available on an empty Overview.</p>`;
    }
    if(page==='phone')body=`<h2>Use my phone</h2><ol class="setup-checklist"><li>Connect the phone and server to the same LAN.</li><li>${state.server?.lanAddress?'A LAN address is active. Copy it from Phone home.':'Set an explicit LAN address in Settings → Network; localhost reaches this PC only.'}</li><li>Open Home in a browser or install the Android app.</li><li>Configure Sensors separately only if you want native phone reporting.</li></ol><p class="field-help">Remotes come from enabled Controls pages. Cards are chosen on the phone. Only Tasks explicitly published by the administrator appear there.</p><button type="button" class="button primary" data-action="setup-phone">Open Phone home</button>`;
    showDialog(`${dialogHeader('Setup guide')}<div class="dialog-body setup-guide">${body}</div><div class="dialog-footer">${page?'<button type="button" class="button" data-action="setup-back">Back</button>':''}<button type="button" class="button" data-action="close-dialog">Close</button></div>`,{kind:'setup-guide'});
  },
  handle(action,id) {
    if(action==='setup-guide')return this.open();
    if(action==='setup-back')return this.page==='device' && this.selected?this.open('device'):this.open();
    if(action==='setup-page')return this.open(id);
    if(action==='setup-device')return this.open('device',id);
    if(action==='setup-new-vista'){closeDialog();return VistaUI.openEditor();}
    if(action==='setup-phone'){closeDialog();currentView='phone-home';renderView();workspace.focus();return;}
    if(['setup-open-plugin','setup-open-cards'].includes(action)) {
      if(!state.services.some(service=>service.id===id))return;
      closeDialog();PluginUI.tabs.set(id,action==='setup-open-cards'?'cards':'settings');currentView=id;renderView();workspace.focus();
    }
  },
};

/** Administrator DOM reconciliation. Retained elements own their scrolling,
 * focus, disclosure state and embedded documents; server markup owns content. */
const AdminDOM = {
  scopes: new WeakMap(), pending: new Map(), installed: false,

  key(node) {
    if (node.nodeType !== 1) return null;
    const identity = node.getAttribute('data-live-key') || node.id;
    if (identity) return `${node.nodeName}:${identity}`;
    if (node.nodeName === 'IFRAME') return `IFRAME:${node.getAttribute('data-webpage-key') || node.getAttribute('src')}`;
    for (const name of ['data-view','data-activity-scope','data-variable-details','data-activity-details','data-activity-filter']) {
      if (node.hasAttribute(name)) return `${node.nodeName}:${name}:${node.getAttribute(name)}`;
    }
    if (node.hasAttribute('data-action')) return `${node.nodeName}:action:${['data-action','data-id','data-setting','data-plugin-id'].map(name => node.getAttribute(name) || '').join('|')}`;
    if (node.nodeName === 'OPTION') return `OPTION:${node.value}`;
    if (['INPUT','SELECT','TEXTAREA'].includes(node.nodeName) && node.name) return `${node.nodeName}:name:${node.name}`;
    return null;
  },

  selected(host) {
    const selection = host.ownerDocument.getSelection();
    if (selection && !selection.isCollapsed) {
      for (let index=0; index<selection.rangeCount; index++) {
        if (selection.getRangeAt(index).intersectsNode(host)) return true;
      }
    }
    // Focus inside a Card frame belongs to its embedded document. Leave it
    // connected and unchanged until the user returns to administrator controls.
    const active = host.ownerDocument.activeElement;
    return active?.nodeName === 'IFRAME' && host.contains(active);
  },

  update(host, markup, options = {}) {
    if (!host) return false;
    const changedScope = options.scope !== undefined && this.scopes.get(host) !== options.scope;
    this.pending.delete(host);
    if (!changedScope && this.selected(host)) {
      // Keep only the latest presentation while text is selected for copying.
      // Server hydration and all other independent regions continue normally.
      this.pending.set(host,{markup,options});
      return false;
    }
    const template = host.ownerDocument.createElement('template');
    template.innerHTML = markup;
    if (changedScope) {
      this.scopes.set(host,options.scope);
      host.replaceChildren(template.content);
    } else {
      const scrolling = [host,...host.querySelectorAll('*'),host.ownerDocument.scrollingElement]
        .filter(node => node && (node.scrollTop || node.scrollLeft))
        .map(node => ({node,top:node.scrollTop,left:node.scrollLeft}));
      this.children(host,template.content);
      for (const {node,top,left} of scrolling) if (node.isConnected) {
        if (node.scrollTop !== top) node.scrollTop = top;
        if (node.scrollLeft !== left) node.scrollLeft = left;
      }
    }
    options.onUpdate?.();
    return true;
  },

  children(parent, desired) {
    const original = [...parent.childNodes], used = new Set();
    const keyed = new Map(original.map(node => [this.key(node),node]).filter(([key]) => key !== null));
    let cursor = parent.firstChild;
    for (const next of [...desired.childNodes]) {
      const key = this.key(next);
      let node = key === null ? original.find(candidate => !used.has(candidate) && this.key(candidate) === null && candidate.nodeType === next.nodeType && candidate.nodeName === next.nodeName) : keyed.get(key);
      if (node && (used.has(node) || node.nodeType !== next.nodeType || node.nodeName !== next.nodeName)) node = null;
      if (!node) node = next.cloneNode(true);
      used.add(node);
      if (node !== cursor) parent.insertBefore(node,cursor);
      this.patch(node,next);
      cursor = node.nextSibling;
    }
    for (const node of original) if (!used.has(node)) node.remove();
  },

  patch(node, next) {
    if (node.nodeType !== 1) {
      if (node.nodeValue !== next.nodeValue) node.nodeValue = next.nodeValue;
      return;
    }
    const active = node === node.ownerDocument.activeElement;
    const field = ['INPUT','SELECT','TEXTAREA'].includes(node.nodeName);
    const draft = field && node.type !== 'hidden' && node.closest('form[data-plugin-action]');
    const value = field ? node.value : null;
    const preserve = name => node.nodeName === 'DETAILS' && name === 'open'
      || field && (active || draft) && ['value','checked','selected'].includes(name);
    for (const attribute of [...node.attributes]) {
      if (!preserve(attribute.name) && !next.hasAttribute(attribute.name)) node.removeAttribute(attribute.name);
    }
    for (const attribute of [...next.attributes]) {
      if (!preserve(attribute.name) && node.getAttribute(attribute.name) !== attribute.value) node.setAttribute(attribute.name,attribute.value);
    }
    // An active native dropdown keeps its option nodes until focus leaves it.
    // Editable controls retain their live value, caret and composition session.
    if (field && active) return;
    this.children(node,next);
    if (field) {
      const desired = draft && (node.nodeName !== 'SELECT' || [...node.options].some(option => option.value === value)) ? value : next.value;
      if (node.value !== desired) node.value = desired;
      if (!draft && node.nodeName === 'INPUT' && node.checked !== next.checked) node.checked = next.checked;
    }
  },

  text(node, value) {
    const text = String(value);
    if (node && node.textContent !== text && !this.selected(node)) node.textContent = text;
  },

  install() {
    if (this.installed) return;
    this.installed = true;
    const flush = () => {
      for (const [host,entry] of [...this.pending]) {
        if (!host.isConnected) this.pending.delete(host);
        else if (!this.selected(host)) this.update(host,entry.markup,entry.options);
      }
    };
    document.addEventListener('selectionchange',flush);
    document.addEventListener('focusin',flush);
  },
};
