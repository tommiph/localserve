/** Shared plugin workspace. Identity and forms come from declarations; a plugin
 * name cannot be edited here. No plugin IDs or installed-plugin list are embedded.
 */
const PluginUI = {
  tabs: new Map(),
  pending: false,
  glyphSearch: '',
  valueInstances: new Map(),
  openGuides: new Set(),
  // Test receipts belong to the current Settings revision, not telemetry or
  // durable device state. Polling cannot turn a past test into current proof.
  connectionResults: new Map(),
  cameraLists: new Map(),
  builders: new Map(),

  taskBuilderCatalog(){
    const actions=actionCatalog.filter(action=>!action.parameters?.some(field=>field.format==='secret')).map(action=>{
      const owner=state.services.find(service=>service.id===action.pluginId);
      let parameters=structuredClone(action.parameters);
      if(action.type==='show-vista'){
        const vistas=(state.vistas||[]).filter(vista=>vista.enabled);
        parameters=[{id:'vistaId',label:'Vista',type:'string',required:true,enum:vistas.map(vista=>vista.id),enumLabels:vistas.map(vista=>vista.name),help:vistas.length?'':'Create and enable a Vista first.'}];
      }
      // Named choices come from declared public tables, never private state or
      // guessed IDs. Missing device readings remain explicitly unselectable.
      const lighting=owner?.controls?.lighting;
      const lightingRole=lighting&&Object.entries(lighting.actions).find(([,id])=>id===action.actionId)?.[0];
      const rows=keys=>keys.flatMap(key=>owner?.cardData?.values?.[key]?.available?owner.cardData.values[key].value:[]);
      let targets=null;
      if(lightingRole?.startsWith('light'))targets=rows(lighting.lights);
      if(lightingRole?.startsWith('group'))targets=rows([lighting.groups]);
      if(owner?.controls?.television&&action.actionId==='launch-app')targets=rows(['apps']);
      if(targets!==null)parameters=parameters.map(field=>field.id==='id'?{...field,enum:targets.filter(row=>typeof row.id==='string').map(row=>row.id),enumLabels:targets.filter(row=>typeof row.id==='string').map(row=>row.name||'Unnamed device'),help:targets.length?'': 'No devices reported yet. Refresh the device connection, then come back.'}:field);
      return {id:action.id,type:action.type,name:action.name,pluginId:action.pluginId,actionId:action.actionId,icon:action.icon,pluginName:action.pluginName||'Server',description:action.description,available:action.available,unavailableReason:action.unavailableReason,defaults:action.defaults,parameters};
    });
    const events=(state.taskEvents||[]).map(event=>({id:event.id,eventId:event.eventId,pluginId:event.pluginId,pluginName:event.pluginName,icon:state.services.find(owner=>owner.id===event.pluginId)?.icon,name:event.name,occurrenceKey:event.occurrenceKey,available:event.available,unavailableReason:event.unavailableReason,payload:event.payload.filter(field=>field.format!=='secret')}));
    return {actions,events,hasLocation:Boolean(config.location)};
  },

  async loadTaskBuilder(service){
    if(!service?.enabled||!service.taskBuilder)throw Error('Enable this plugin first.');
    let entry=this.builders.get(service.id);
    if(!entry){
      entry={};this.builders.set(service.id,entry);
      const url=`/plugin-task-builders/${encodeURIComponent(service.id)}`;
      const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=url+'.css';
      stylesheet.dataset.taskBuilder=service.id;document.head.append(stylesheet);
      // Load failure stays inside this optional feature; the rest of the
      // administrator and server continue using their existing contracts.
      entry.pending=import(url+'.js').then(module=>{entry.module=module;return module;}).catch(error=>{entry.error=true;throw error;});
    }
    return entry.module||entry.pending;
  },

  taskBuilderHome(service){
    if(!service.enabled)return `<section class="task-builder-welcome"><span class="service-icon">${icon(service.icon)}</span><h2>A little idea.<br>A useful little task.</h2><p>Make something happen with a few simple choices.</p><button class="button primary" data-action="toggle-service" data-id="${escapeHtml(service.id)}">Enable ${escapeHtml(service.name)}</button></section>`;
    const entry=this.builders.get(service.id);
    if(entry?.module?.landing){
      try{return entry.module.landing({...this.taskBuilderCatalog(),escape:escapeHtml,icon});}
      catch{return '<div class="empty-state">This builder could not open. Settings and your saved Tasks are still available.</div>';}
    }
    if(!entry)this.loadTaskBuilder(service).then(()=>{if(currentView===service.id)renderView();}).catch(()=>{if(currentView===service.id)renderView();});
    return `<div class="empty-state">${entry?.error?'This builder could not load. Reload the page to try again.':'Getting your ideas ready…'}</div>`;
  },

  async openTaskBuilder(service,intent){
    const module=await this.loadTaskBuilder(service);
    const current=()=>state.services.find(item=>item.id===service.id&&item.enabled&&item.taskBuilder);
    const check=draft=>{
      if(!current())throw Error('This builder has been turned off.');
      const capability=draft.steps[0]?.capabilityId||draft.steps[0]?.type;
      if(!actionCatalog.some(action=>action.id===capability&&action.available!==false))throw Error('That action is no longer available. Check its connection and try again.');
      if(draft.starts.some(rule=>rule.type==='event'&&!state.taskEvents.some(event=>event.id===rule.eventId&&event.available!==false)))throw Error('That signal is no longer available. Choose another one.');
    };
    if(!current())throw Error('This builder has been turned off.');
    let context,creating=false,savedTaskId=null;
    module.open({...this.taskBuilderCatalog(),escape:escapeHtml,icon,time:value=>TimeUI.render(value),formatTime:value=>TimeUI.format(value),intent,
      show:body=>{showDialog(`<form id="recipe-builder-form" novalidate>${body}</form>`,{kind:'task-builder'});context=dialogContext;},
      error:message=>{if(dialogContext===context)showFormError(message);},
      review:draft=>{check(draft);TaskUI.openEditor(null,false,{...draft,enabled:false});},
      create:async draft=>{
        if(creating||savedTaskId)throw Error('This task is already being saved.');
        if(dialogContext!==context)throw Error('This builder is no longer open.');
        check(draft);creating=true;
        try{
          const before=new Set(state.tasks.map(task=>task.id));
          await mutate('api/tasks',{...draft,enabled:false});
          savedTaskId=state.tasks.find(task=>!before.has(task.id)&&task.name===draft.name)?.id;
          if(!savedTaskId)throw Error('Check Tasks to confirm that your task was saved.');
          if(dialogContext===context)initialFormValues=serializeForm(dialog.querySelector('form'));
          return {id:savedTaskId};
        }finally{creating=false;}
      },
      editSaved:()=>{if(savedTaskId&&dialogContext===context)TaskUI.openEditor(savedTaskId);},
    });
  },

  field(field, value, prefix) {
    if (field.displayScale) {
      const scale=field.displayScale;
      field={...field,min:field.min===undefined?undefined:field.min*scale,max:field.max===undefined?undefined:field.max*scale};
      if(typeof value==='number')value=Number((value*scale).toPrecision(12));
    }
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
        : field.type === 'number' ? Number(control.value)/(field.displayScale || 1) : control.value];
    }));
  },

  glyphChoices(service) {
    const choices = (state.pluginGlyphs || []).filter(name => name.includes(this.glyphSearch.toLowerCase().trim().replaceAll(' ', '-').replaceAll('_', '-')));
    return choices.length ? choices.slice(0, 96).map(name => `<button class="glyph-choice" type="button" data-action="plugin-glyph" data-id="${escapeHtml(service.id)}" data-glyph="${name}" aria-label="Use ${name} glyph" aria-pressed="${service.icon === name}" title="${name}">${icon(name)}<span>${escapeHtml(name.replaceAll('-', ' '))}</span></button>`).join('') + (choices.length > 96 ? '<p class="glyph-search-help">Showing 96 of ' + choices.length + ' glyphs. Search to narrow the choices.</p>' : '') : '<p class="empty-state">No glyphs found.</p>';
  },

  render(service) {
    const tabNames = [
      ...(service.taskBuilder ? [['create','Create','auto-awesome']] : []),
      ['settings', 'Settings', 'sliders'],
      ...(!service.taskBuilder ? [['cards', 'Card designer', 'table-cells']] : []),
      ...(service.controls ? [['controls', 'Controls', 'gamepad']] : []),
      ...(service.events.length ? [['events', 'Events', 'tower-broadcast']] : []),
      ['log', 'Log', 'clipboard-list'],
    ];
    const remembered = this.tabs.get(service.id);
    const selected = tabNames.some(([id]) => id === remembered) ? remembered : service.taskBuilder?'create':'settings';
    this.tabs.set(service.id,selected);
    const status = serviceStatus(service);
    const heading = `<div class="page-heading"><div class="plugin-heading"><span class="service-icon">${icon(service.icon)}</span><div><h1>${escapeHtml(service.name)} <small class="plugin-version" title="Plugin version">v${escapeHtml(service.version)}</small></h1><div class="plugin-readiness">${statusPill(status.label, status.className)}</div></div></div></div>`;
    const tabs = `<div class="tabs" role="tablist" aria-label="${escapeHtml(service.name)} workspace">${tabNames.map(([id, label, glyph]) => `<button type="button" id="plugin-tab-${id}" class="tab" role="tab" aria-selected="${selected === id}" aria-controls="plugin-panel" tabindex="${selected === id ? 0 : -1}" data-action="plugin-tab" data-id="${id}">${icon(glyph)}${label}</button>`).join('')}</div>`;
    const error = `<div id="plugin-error" class="form-error" role="alert" ${service.error ? '' : 'hidden'}>${escapeHtml(service.error)}</div>`;
    const panel = selected==='create' ? this.taskBuilderHome(service) : selected === 'controls' ? ControlsUI.render(service) : selected === 'cards' ? CardDesigner.render(service) : selected === 'log' ? this.log(service)
      : selected === 'events' ? this.events(service) : this.settings(service);
    const evidence=selected==='create'?'':`<div class="plugin-evidence">${serviceEvidence(service)}<p>A completed check may use cached data. Reception is the latest available source timestamp; command delivery does not confirm device state.</p></div>`;
    renderWorkspace(heading + evidence + tabs + error + `<div id="plugin-panel" role="tabpanel" aria-labelledby="plugin-tab-${selected}">${panel}</div>`);
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

  connectionPanel(service) {
    const setup = service.connectionSetup;
    if (!setup || !service.config) return '';
    const result = this.connectionResults.get(service.id);
    const current = result?.revision === service.config.revision ? result : null;
    const actions = [setup.testAction, setup.repairAction].filter(Boolean).map(id => service.actions.find(action => action.id === id)).filter(Boolean);
    const reason = state.paused ? 'Enable server functions first.' : !service.enabled ? 'Enable this plugin first.' : !service.configurationReady ? 'Complete the connection settings below first.' : '';
    return `<section class="panel plugin-connection" id="plugin-connection-panel" tabindex="-1" aria-label="Connection" data-live-key="connection:${escapeHtml(service.id)}"><div class="panel-header"><h2>${icon('link')} Connection</h2></div><div class="panel-body">
      <p><strong>${escapeHtml(service.config.settings[setup.addressSetting] || 'No address configured')}</strong></p>
      <p class="field-help">${escapeHtml(setup.help)}</p>
      <div class="connection-actions">${actions.map(action => `<button type="button" id="connection-${escapeHtml(action.id)}" class="button" data-action="plugin-connection" data-capability="${escapeHtml(action.id)}" data-revision="${service.config.revision}" ${this.pending || reason || action.available === false ? 'disabled' : ''}>${icon(action.id === setup.repairAction ? 'arrows-rotate' : 'link')}${escapeHtml(action.name)}</button>`).join('')}</div>
      ${reason ? `<p class="field-help">${escapeHtml(reason)}</p>` : ''}
      <div class="connection-result ${current?.error ? 'evidence-error' : ''}" role="status" aria-live="polite">${current ? `${current.scope ? escapeHtml(current.scope)+': ' : ''}${escapeHtml(current.message)}${current.at ? ` · ${escapeHtml(formatServerTimestamp(current.at))}` : ''}` : 'Not checked in this browser session for the current settings.'}</div>
    </div></section>`;
  },

  async testConnection(service, control) {
    if (this.pending) return;
    const revision = Number(control.dataset.revision), actionId = control.dataset.capability;
    if (![service.connectionSetup?.testAction, service.connectionSetup?.repairAction].includes(actionId)) return;
    this.pending = true;
    const scope=service.actions.find(action=>action.id===actionId)?.name || 'Connection check';
    this.connectionResults.set(service.id, {revision, scope, message: 'Checking connection…'});
    this.render(service);
    try {
      const reply = await mutate(`api/plugins/${service.id}/actions/${actionId}`, {revision, parameters: {}});
      this.connectionResults.set(service.id, {revision, scope, message: reply.result?.message || 'Check completed.', at: state.server?.now ?? Date.now()});
    } catch (error) {
      this.connectionResults.set(service.id, {revision, scope, error: true, message: error.message, at: state.server?.now ?? Date.now()});
    } finally {
      this.pending = false;
      if (currentView === service.id) {
        this.render(state.services.find(candidate => candidate.id === service.id));
        document.getElementById(`connection-${actionId}`)?.focus({preventScroll: true});
      }
    }
  },

  settings(service) {
    return (typeof CloudRelayUI!=='undefined'?CloudRelayUI.panel(service):'') + this.webcamSettings(service) + this.connectionPanel(service) + (service.id === "oculus-go" && service.actions.some(action => action.id === "library-install") ? '<section class="panel"><div class="panel-body"><h2>Applications</h2><p>Browse your APK library, read installed apps and manage applications on the configured headset.</p><button class="button" data-view="vr-library">Open VR library</button></div></section>' : "") + this.settingsBody(service);
  },

  webcamSettings(service) {
    if (service.runtime?.inspection !== 'camera-list-v1') return '';
    const saved=this.cameraLists.get(service.id), result=saved?.revision===service.config.revision?saved:null;
    return `<section class="panel"><div class="panel-header"><h2>${icon('videocam')}Camera</h2></div><div class="panel-body"><button class="button" type="button" data-action="plugin-camera-list" ${this.pending || !['idle','ready'].includes(service.health)?'disabled':''}>List cameras</button><p class="field-help">Listing names does not enable the plugin or start capture. Select a camera before enabling; changing an enabled plugin's camera restarts its capture. List again after USB devices change.</p><p>Configured index: ${escapeHtml(service.config.settings['device-index'])}</p>${result?.error?`<p class="evidence-error">${escapeHtml(result.error)}</p>`:result?.devices?.length?`<label class="field"><span class="field-label">Camera</span><select id="camera-choice"><option value="">Choose a camera</option>${result.devices.map(item=>`<option value="${item.index}">${escapeHtml(item.name)} · ${item.index}</option>`).join('')}</select></label><button class="button" type="button" data-action="plugin-camera-use" disabled>Use selected camera</button>`:result?'<p>No cameras found.</p>':'<p class="field-help">No camera list in this browser session for the current settings.</p>'}</div></section>`;
  },

  async listCameras(service) {
    if(this.pending)return; this.pending=true;this.render(service);
    const revision=service.config.revision;
    try {const result=await request(`api/plugins/${service.id}/inspect`,{revision});this.cameraLists.set(service.id,result);}
    catch(error){this.cameraLists.set(service.id,{revision,error:error.message});}
    finally {this.pending=false;if(currentView===service.id)this.render(state.services.find(item=>item.id===service.id));}
  },

  settingsBody(service) {
    if (!service.config) return '<section class="panel"><div class="empty-state">Plugin data could not be loaded.</div></section>';
    return `${service.taskBuilder?`<section class="panel plugin-task-builder"><div class="panel-body"><h2>I want… when…</h2><p>Choose an action and when it should happen, then review your Task before saving.</p><button class="button primary" data-action="plugin-task-builder" ${service.enabled?'':'disabled'}>Build a task</button>${!service.enabled?'<p class="field-help">Enable this plugin below to begin.</p>':''}</div></section>`:''}<section class="panel"><div class="panel-header"><h2>Settings</h2><span class="panel-count">v${escapeHtml(service.version)}</span></div><div class="panel-body"><p class="save-guidance">Fields save automatically when changed. List entries use their own editor. <span data-save-status aria-live="polite"></span></p>${this.settingsGuide(service)}
      ${service.runtime?.ingest === 'sensors-v1' ? '<div class="plugin-setting-row"><span>Controller for Android</span><a class="button" href="/sensors" target="_blank" rel="noopener">Download APK</a></div>' : ''}
      <form id="plugin-settings-form" data-plugin-id="${escapeHtml(service.id)}" data-revision="${service.config.revision}"><fieldset class="plugin-settings-fields">${this.groupFields(service.settings,field=>this.field(field,service.config.settings[field.id] ?? field.default,'plugin-setting'),service.id)}</fieldset></form>
      <div class="plugin-setting-row"><span>${icon('toggle-on')}Enabled</span><button type="button" class="switch" role="switch" aria-checked="${service.enabled}" aria-label="${escapeHtml(service.name)} enabled" data-action="toggle-service" data-id="${escapeHtml(service.id)}"></button></div>
      ${service.attribution ? `<p class="field-help"><a href="${escapeHtml(service.attribution.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(service.attribution.label)}</a> · <a href="${escapeHtml(service.attribution.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(service.attribution.licenseLabel)}</a> · ${escapeHtml(service.attribution.notice)}</p>` : ''}
    </div></section>${service.settings.filter(field => field.type === 'list').map(field => this.list(service, field)).join('')}
    <section class="panel plugin-appearance"><div class="panel-body"><details><summary>${icon('palette')} Plugin appearance</summary><div class="plugin-setting-row"><span>Glyph</span><details id="glyph-picker"><summary>${icon(service.icon)}<span>${escapeHtml(service.icon)}</span>${icon('chevron-down')}</summary><div class="glyph-picker-body"><label class="field-label" for="glyph-search">Search glyphs</label><input id="glyph-search" type="search" placeholder="Search glyphs" value="${escapeHtml(this.glyphSearch)}"><div id="glyph-choices" class="glyph-grid">${this.glyphChoices(service)}</div></div></details><button class="button" type="button" data-action="plugin-glyph-default" data-id="${escapeHtml(service.id)}">Reset glyph</button></div></details></div></section>`;
  },

  groupFields(fields, render, owner = 'fields') {
    const groups=new Map();
    for(const field of fields) {
      const name=field.section || 'General';
      if(!groups.has(name))groups.set(name,[]);
      groups.get(name).push(field);
    }
    if(!fields.some(field=>field.section || field.advanced))return fields.map(render).join('');
    return [...groups].map(([name,items])=>`<section class="plugin-field-group"><h3>${escapeHtml(name)}</h3>${items.filter(field=>!field.advanced).map(render).join('')}${items.some(field=>field.advanced)?`<details class="editor-help" data-live-key="advanced:${escapeHtml(owner+':'+name)}"><summary>Advanced · ${escapeHtml(name)}</summary>${items.filter(field=>field.advanced).map(render).join('')}</details>`:''}</section>`).join('');
  },

  list(service, field) {
    const items = service.config.settings[field.id] || [];
    const lookup = service.settingsLookup?.setting === field.id;
    return `<section class="panel plugin-list"><div class="panel-header"><h2>${escapeHtml(field.label)} <span class="panel-count">${items.length}</span></h2><div class="heading-actions">${lookup ? `<button type="button" class="button" data-action="plugin-find-source" data-setting="${field.id}" ${items.length >= field.maxItems ? 'disabled' : ''}>${icon('magnifying-glass')}Find ${escapeHtml(field.itemLabel)}</button>` : ''}<button type="button" class="button primary" data-action="plugin-list-add" data-setting="${field.id}" ${items.length >= field.maxItems ? 'disabled' : ''}>${icon('plus')}Add ${escapeHtml(field.itemLabel)}</button></div></div>
      ${field.help ? `<div class="panel-body"><p class="field-help">${escapeHtml(field.help)}</p></div>` : ''}
      ${items.length ? items.map(item => `<div class="settings-item" data-live-key="source:${escapeHtml(field.id)}:${escapeHtml(item.id)}"><div class="settings-text"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(this.itemSummary(field, item))}</p></div>${AdminUX.definitionActions(item,{edit:"plugin-list-edit",copy:"plugin-list-copy",delete:"plugin-list-delete",toggle:"plugin-list-toggle"},{attributes:{setting:field.id},before:this.listActionButtons(service,field,item)})}</div>`).join('') : `<div class="empty-state">No ${escapeHtml(field.label.toLowerCase())} yet.</div>`}</section>`;
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
    // A copied cloud client needs its own identity and credential grant.
    if (operation === 'copy' && service.id === 'google-apps-script' && field.id === 'clients') Object.assign(item, {'client-id':'',key:''});
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
    if(action==='plugin-camera-list')return this.listCameras(service);
    if(action==='plugin-camera-use') {
      const result=this.cameraLists.get(service.id), selected=document.getElementById('camera-choice')?.value;
      if(!result || result.revision!==service.config.revision || !result.devices?.some(item=>String(item.index)===selected))return this.showError('List and choose the camera again for the current settings.');
      return this.save(service.id,{settings:{...service.config.settings,'device-index':Number(selected)}},result.revision);
    }
    if (action === 'plugin-connection') {
      await this.testConnection(service, control);
    } else if (action === 'plugin-source-action') {
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
  if(event.target.id==='camera-choice') {
    const button=document.querySelector('[data-action="plugin-camera-use"]');if(button)button.disabled=event.target.value==='';return;
  }
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
