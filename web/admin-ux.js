/** Presentation helpers shared by administrator views. These derive labels from
 * reported state only; they never execute actions or infer a device's state. */
/** The cache is an in-memory transport base, independent of modal drafts. A
 * committed mutation invalidates an older read before it can hydrate the UI. */
const AdminSync = {
  cursor:null, snapshot:null, epoch:0, legacy:false,
  invalidate(){this.epoch++;this.cursor=null;this.snapshot=null;},
  value(previous,patch){
    if(patch.kind==='replace')return patch.value;
    if(patch.kind!=='array'||!Array.isArray(previous))throw Error('Administrator refresh needs a full snapshot.');
    const entries=new Map(previous.map(item=>[item.id,item])),ids=previous.map(item=>item.id);
    for(const item of patch.items)entries.set(item.id,item);
    for(const splice of patch.splices)ids.splice(splice.at,splice.remove,...splice.insert);
    if(new Set(ids).size!==ids.length||ids.some(id=>!entries.has(id)))throw Error('Administrator list refresh is incomplete.');
    return ids.map(id=>entries.get(id));
  },
  fields(previous,updates,removed){
    const next={...previous};
    for(const key of removed)delete next[key];
    for(const [key,patch]of Object.entries(updates))next[key]=this.value(previous?.[key],patch);
    return next;
  },
  apply(packet){
    if(packet.protocol!=='admin-fields-v1'||!/^[a-f0-9]{32}$/.test(packet.cursor))throw Error('Unsupported administrator refresh.');
    if(!packet.full&&!this.snapshot)throw Error('Administrator refresh needs a full snapshot.');
    const base=packet.full?{}:this.snapshot;
    const next=this.fields(base,packet.values,packet.removed),services=new Map((base.services||[]).map(service=>[service.id,service]));
    for(const id of packet.services.removed)services.delete(id);
    for(const patch of packet.services.updates)services.set(patch.id,this.fields(services.get(patch.id),patch.values,patch.removed));
    next.services=packet.services.order.map(id=>{if(!services.has(id))throw Error('Incomplete service refresh.');return services.get(id);});
    this.snapshot=next;this.cursor=packet.cursor;return next;
  },
  read(request){
    if(this.pending?.epoch===this.epoch)return this.pending.promise;
    const entry={epoch:this.epoch};
    entry.promise=this.readOnce(request).finally(()=>{if(this.pending===entry)this.pending=null;});
    this.pending=entry;return entry.promise;
  },
  async readOnce(request){
    const epoch=this.epoch;
    if(this.legacy){const data=await request('api/state');return epoch===this.epoch?data:null;}
    let packet;
    try{packet=await request('api/admin-state'+(this.cursor?'?cursor='+this.cursor:''));}
    catch(error){
      if(![404,405].includes(error.status))throw error;
      this.legacy=true;const data=await request('api/state');return epoch===this.epoch?data:null;
    }
    if(epoch!==this.epoch)return null;
    try{return this.apply(packet);}catch(error){this.invalidate();throw error;}
  },
};

const AdminUX = {
  pageServerVersion: null,
  observeServerVersion(version) {
    if(!this.pageServerVersion&&typeof version==='string')this.pageServerVersion=version;
  },
  versions(data) {
    const current=data.config?.version,packages=data.server?.clientPackages||{},previous=this.pageServerVersion;
    const changed=previous&&current&&previous!==current;
    const row=(name,value)=>`<div class="client-version-row"><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`;
    return `<section class="panel settings-group"><details class="client-versions"><summary>Versions and updates${changed?' · Reload recommended':''}</summary><div class="panel-body"><dl>${row('Running server',current?'v'+current:'Not reported')}${row('Server when this page connected',previous?'v'+previous:'Not reported')}${row('Available Android APK',packages.android?'v'+packages.android:'No verified build available')}${row('Bundled TV launcher source',packages.tvLauncherSource?'v'+packages.tvLauncherSource:'Not available')}</dl>${changed?'<p class="client-version-note" role="status">The server version changed while this page was open. Reload to load the current administrator interface.</p>':''}<button type="button" class="button" data-action="reload-administrator">${icon('arrows-rotate')}Reload administrator</button><p class="field-help">Reloading affects this browser page only. It does not restart the server or refresh a TV display.</p><h3>Controller for Android</h3><p>The installed APK version is shown in Controller Settings. Installing an APK and reloading its server interface are separate updates.</p><button class="button" data-view="downloads">${icon('download')}Open Downloads</button><h3>TV display</h3><p>The installed TV launcher version is not reported here. Its bundled source version does not confirm what is installed on the TV. To load updated viewer scripts, finish or dismiss the current notice or game, close Vista completely, then reopen it. A server restart does not update an already-open TV document.</p></div></details></section>`;
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
    if (service.enabled && service.runtimeRecovery && !paused) return {label: service.runtimeRecovery.status === 'recovering' ? 'Recovering' : 'Recovery pending', className: 'waiting'};
    if (['loading', 'configuring'].includes(service.health)) return {label: service.health === 'loading' ? 'Loading' : 'Updating', className: 'waiting'};
    if (['error', 'restart-required'].includes(service.health)) return {label: service.health === 'error' ? 'Runtime error' : 'Restart required', className: 'waiting'};
    if (!service.configurationReady) return {label: 'Configure', className: 'waiting'};
    if (!service.enabled) return {label: 'Disabled', className: 'paused'};
    if (paused) return {label: 'Paused', className: 'paused'};
    if(service.health==='ready'&&service.gatewayConnection?.status==='unreachable')return {label:'Unreachable',className:'waiting'};
    if(service.health==='ready'&&service.gatewayConnection?.status==='checking')return {label:'Checking gateway',className:'waiting'};
    return service.health === 'ready' ? {label: 'Ready', className: 'running'} : {label: 'Not running', className: 'waiting'};
  },

  recoveryHint(service, paused = false, now = Date.now()) {
    if(service.enabled&&service.gatewayConnection?.status==='unreachable'){
      if(paused)return 'Gateway unreachable. Automatic checks resume with the server; failed lighting commands are not retried.';
      const seconds=Math.max(0,Math.ceil((service.gatewayConnection.nextPollAt-now)/1000));
      return `Gateway unreachable. Next connection check ${seconds?'in '+seconds+' s':'is due'}. Failed lighting commands are not retried.`;
    }
    if (!service.enabled || !service.runtimeRecovery) return '';
    if (paused) return 'Automatic recovery will continue when the server resumes.';
    if (service.runtimeRecovery.status === 'recovering') return 'Restarting the plugin process. Interrupted commands are not retried.';
    const seconds = Math.max(0, Math.ceil((service.runtimeRecovery.nextAttemptAt - now) / 1000));
    return `Automatic recovery ${seconds ? 'in ' + seconds + ' s' : 'is due'}. Interrupted commands are not retried.`;
  },

  nextStep(service, paused = false) {
    if (!service.configurationReady) return 'Open Settings and complete the required fields before enabling this service.';
    if (!service.enabled) return 'Enable this service when you are ready to use it.';
    if (paused) return 'Resume server functions to continue automatic checks.';
    if (service.runtimeRecovery) return 'Automatic recovery is pending. Open the plugin Log for details; interrupted actions are not replayed.';
    if (['error','restart-required'].includes(service.health)) return 'Open the plugin Log and Settings to review the reported error.';
    if (service.gatewayConnection?.status === 'unreachable' || service.pollObservation?.status === 'failed')
      return 'Check the device or provider connection and its Settings. Use Refresh to request a new reading when available.';
    if (service.gatewayConnection?.status === 'checking' || ['loading','configuring'].includes(service.health))
      return 'Wait for the current connection check to finish, then inspect its readings.';
    return 'Review the latest readings before adding actions or automatic rules.';
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
      return `${activation}${task.ruleMode==='and' && rules?' · AND (all rules)':''} · ${rules}/${allRules} rules · ${steps}/${task.steps.length} steps enabled`;
  },

  savesDefinition(endpoint) {
    if (/^(?:\/)?api\/lighting-scenes\/[^/]+\/[^/]+$/.test(endpoint)) return true;
    return /(?:^|\/)api\/(?:games\/maze|config|universe|display|tasks(?:\/[^/]+(?:\/(?:enabled|delete))?)?|plugins\/[^/]+\/(?:config|enabled|cards(?:\/[^/]+(?:\/(?:enabled|delete))?)?|controls(?:\/[^/]+(?:\/(?:enabled|delete))?)?)|vistas(?:\/[^/]+(?:\/(?:enabled|delete))?)?)$/.test(endpoint);
  },
};

/** Read-only setup navigation hands off to ordinary configuration editors. */
const SetupUI = {
  page:'', selected:'',
  choice(id, glyph, title, help, action='setup-page') {
    return `<button type="button" class="setup-choice" data-action="${action}" data-id="${escapeHtml(id)}">${icon(glyph)}<strong>${escapeHtml(title)}</strong><span>${escapeHtml(help)}</span></button>`;
  },
  navigate(view) {
    closeDialog();currentView=view;renderView();workspace.focus();
  },
  open(page='', selected='') {
    this.page=page;this.selected=selected;
    const services=state.services || [];
    const tasks=state.tasks || [];
    const cards=services.reduce((total,service)=>total+(service.cards || []).filter(card=>card.enabled).length,0);
    const configured=services.filter(service=>service.enabled && service.configurationReady).length;
    let body='';
    if(!page) {
      body=`<h2>Choose your next step</h2><p>Start with a service, try a manual Task, then put your controls or information where you want them. You can return here at any time.</p>
        <p class="setup-progress">${configured} configured and enabled services · ${tasks.length} saved Tasks · ${cards} enabled Cards</p>
        <div class="setup-choices">${[
          ['device','devices','Connect a service','Set up a device or information source and inspect its readings.'],
          ['task','list-check','Create a first Task','Try a manual activity message, without controlling any device.'],
          ['display','display','Create a display','Choose a ready-made Card, then arrange it in a Vista.'],
          ['phone','smartphone','Use Controller','Connect your phone and choose the shortcuts it can use.'],
        ].map(choice=>this.choice(...choice)).join('')}</div>
        <p class="field-help">This guide opens the normal editors. It never enables services, saves content or runs actions for you.</p>`;
    }
    if(page==='device') {
      const service=services.find(item=>item.id===selected);
      const status=service && AdminUX.serviceStatus(service,state.paused);
      body=service?`<h2>${escapeHtml(service.name)}</h2>
        <p>${statusPill(status.label,status.className)}</p><p>${escapeHtml(AdminUX.nextStep(service,state.paused))}</p>
        <ol class="setup-checklist"><li>Open Settings and read this plugin's setup instructions.</li><li>Complete its required fields with your own device or provider details.</li><li>Enable the service when ready, then check its latest readings and Log.</li></ol>
        <p class="field-help">Configured means the required fields are present. It does not prove that the device or provider has responded. The guide does not test the connection.</p>
        <div class="row-actions"><button type="button" class="button primary" data-action="setup-open-plugin" data-id="${escapeHtml(service.id)}">Open Settings</button><button type="button" class="button" data-action="setup-page" data-id="task">Next: Task</button></div>`:
        `<h2>Choose a service</h2><p>Devices and information sources are configured in their own plugin. Simulator works without a device or account.</p><div class="setup-choices">${services.map(service=>this.choice(service.id,service.icon,service.name,AdminUX.serviceStatus(service,state.paused).label,'setup-device')).join('') || '<p>No plugins are installed. Add a trusted plugin folder and refresh discovery.</p>'}</div>`;
    }
    if(page==='task') {
      body=`<h2>Create a first Task</h2><p>Try the Task editor using a message in Activity. No device or plugin is required.</p>
        <ol class="setup-checklist"><li>Open the prepared draft and change its name or message.</li><li>Leave automatic rules empty. Enable the Task and choose Save when ready.</li><li>In Tasks, choose Run once. Check its completed run and your message in Activity.</li><li>For phone access, use Controller setup → Choose Tasks after saving.</li></ol>
        <p class="field-help">The draft starts disabled and unsaved. Opening it does not create or execute a Task. Add real actions and automatic rules only after reviewing what they will do.</p>
        <div class="row-actions"><button type="button" class="button primary" data-action="setup-first-task">Open Task draft</button><button type="button" class="button" data-action="setup-tasks">Open Tasks</button><button type="button" class="button" data-action="setup-activity">Open Activity</button></div>
        <p>${tasks.length} saved Task${tasks.length===1?'':'s'}. The optional Simulator demo on an empty Overview also provides a finished Task and display.</p>`;
    }
    if(page==='display') {
      const sources=services.filter(service=>service.cardData?.readyMade?.templates?.length);
      body=`<h2>Create a display</h2><ol class="setup-checklist"><li>Configure an information source in its plugin and check its readings.</li><li>Open its Card designer, choose Add ready-made card, select a source and enable the Card.</li><li>Create a Vista, use Add here to choose where to insert the Card, then save and enable the Vista.</li><li>Open the Vista's own URL. Choose it for /display only when you want to change the shared TV display.</li></ol>
        <p>${cards} enabled Card${cards===1?'':'s'} available. A ready-made design is a template; it is not a saved Card until you create one. Missing readings remain No data.</p>
        <div class="setup-choices">${sources.map(service=>this.choice(service.id,service.icon,service.name,'Open Card designer','setup-open-cards')).join('') || '<p>No ready-made designs are installed. You can still create a Vista and add Cards later.</p>'}</div>
        <div class="row-actions"><button type="button" class="button primary" data-action="setup-new-vista">Add Vista</button><button type="button" class="button" data-action="setup-vistas">Open Vistas</button></div>
        <p class="field-help">Previewing does not open the TV or change /display. Install compatible TV applications from Downloads when you are ready to use a TV.</p>`;
    }
    if(page==='phone')body=`<h2>Use Controller</h2><ol class="setup-checklist"><li>Connect the phone and PC to the same home network.</li><li>${state.server?.lanAddress?'A LAN address is active. Use the address shown in Controller setup.':'Open Settings → Network and configure a reachable private LAN address. Localhost reaches this PC only.'}</li><li>On the phone, open the server's Downloads page, download Controller and install it.</li><li>In Controller Settings, enter the server address and choose Save server.</li><li>For a new phone, open Controller setup → Connect a phone in administration. Enter its six-character approval code in Controller.</li><li>Use Controller setup → Choose Tasks to publish selected saved Tasks. Enable lighting scenes for end-user access in their editor.</li></ol>
      <p class="field-help">Connection details come from the server automatically after approval. There are no configuration files to copy. Full remotes and Cards use the home network; away-from-home Lights and Tasks need the optional Google Apps Script relay.</p>
      <p>Phone reporting is optional in Controller Settings and requires Android permission for the sources you choose.</p>
      <div class="row-actions"><button type="button" class="button primary" data-action="setup-phone">Open Controller setup</button><button type="button" class="button" data-action="setup-downloads">Open Downloads</button>${!state.server?.lanAddress?'<button type="button" class="button" data-action="setup-network">Open server Settings</button>':''}</div>`;
    showDialog(`${dialogHeader('Setup guide')}<div class="dialog-body setup-guide">${body}</div><div class="dialog-footer">${page?'<button type="button" class="button" data-action="setup-back">Back</button>':''}<button type="button" class="button" data-action="close-dialog">Close</button></div>`,{kind:'setup-guide'});
  },
  handle(action,id) {
    if(action==='setup-guide')return this.open();
    if(action==='setup-back')return this.page==='device' && this.selected?this.open('device'):this.open();
    if(action==='setup-page')return this.open(id);
    if(action==='setup-device')return this.open('device',id);
    if(action==='setup-new-vista'){closeDialog();return VistaUI.openEditor();}
    if(action==='setup-first-task'){
      closeDialog();return TaskUI.openEditor(null,false,{name:'First Task',enabled:false,starts:[],steps:[{id:crypto.randomUUID(),type:'log',enabled:true,message:'My first Task completed.'}]});
    }
    const destinations={'setup-phone':'phone-home','setup-tasks':'tasks','setup-activity':'activity','setup-downloads':'downloads','setup-network':'settings','setup-vistas':'vistas'};
    if(destinations[action])return this.navigate(destinations[action]);
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
      options.onUpdate?.();
    } else {
      // A retained list can sit inside a scrolling sidebar or panel. Include
      // every ancestor and finish layout hydration before restoring positions.
      const ancestors=[];
      for(let node=host.parentElement;node;node=node.parentElement)ancestors.push(node);
      const scrolling = [...new Set([host,...host.querySelectorAll('*'),...ancestors,host.ownerDocument.scrollingElement])]
        .filter(node => node && (node.scrollTop || node.scrollLeft))
        .map(node => ({node,top:node.scrollTop,left:node.scrollLeft}));
      this.children(host,template.content);
      options.onUpdate?.();
      for (const {node,top,left} of scrolling) if (node.isConnected) {
        if (node.scrollTop !== top) node.scrollTop = top;
        if (node.scrollLeft !== left) node.scrollLeft = left;
      }
    }
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
