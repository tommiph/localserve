/** Manual network inventory. Polls only display results; address changes need
 * a separate reviewed submission through the normal plugin settings path. */
const DevicesUI = {
  query:'',networkId:'',pending:false,
  row(id){return state.devices?.devices.find(item=>item.id===id);},
  render(){
    const model=state.devices;
    if(!model)return pageHeading('Devices','Local network inventory')+'<div class="empty-state">Reload the administrator after restarting Sormus to use device discovery.</div>';
    if(!model.networks.some(item=>item.id===this.networkId)){
      let address;try{address=new URL(state.server.lanAddress).hostname;}catch{}
      this.networkId=(model.networks.find(item=>item.address===address)||model.networks[0])?.id||'';
    }
    const active=model.job?.status==='running',rows=model.devices.filter(row=>[row.displayName,row.address,row.mac,row.type,row.hostname,row.manufacturer,row.model,row.vendor?.company,row.vendor?.country].join(' ').toLowerCase().includes(this.query.toLowerCase().trim()));
    const escape=escapeHtml;
    return pageHeading('Devices','Local network inventory')+`<section class="panel"><div class="panel-body device-discovery-bar"><label class="field"><span class="field-label">${icon('network-wired')}Network</span><select id="device-network" ${active?'disabled':''}>${model.networks.map(network=>`<option value="${network.id}" ${network.id===this.networkId?'selected':''}>${escape(network.name)} · ${escape(network.cidr)}</option>`).join('')}</select></label><button class="button primary" data-action="device-scan" ${active||this.pending||state.paused||model.error||!this.networkId?'disabled':''}>${icon('search')}Discover devices</button>${this.lookupButton(model,active)}${active?`<button class="button" data-action="device-cancel" data-id="${model.job.id}">${model.job.kind==='lookup'?'Stop lookup':'Stop scan'}</button>`:''}</div><div class="panel-body device-discovery-note"><p>Scan an attached private network. Names and types depend on what devices report; sleeping or isolated devices may be missed. No devices are controlled or configured by a scan.</p>${this.lookupNote(model)}${state.paused?'<p>Enable server functions before scanning.</p>':''}${!model.networks.length?'<p>No attached private IPv4 network is available.</p>':''}${model.error?`<p class="form-error">${escape(model.error)}</p>`:''}${model.job?`<p role="status">${escape(model.job.stage)}${model.job.finishedAt?' · '+escape(formatServerTimestamp(model.job.finishedAt)):''}</p>${model.job.warnings.map(message=>`<p class="field-help">${escape(message)}</p>`).join('')}`:'<p class="field-help">Discovery starts only when you choose Discover devices.</p>'}</div></section>`+
    `<section class="panel"><div class="panel-header"><h2>Devices <span class="panel-count">${model.devices.length}</span></h2><label><span class="visually-hidden">Search devices</span><input type="search" id="device-search" aria-label="Search devices" placeholder="Search devices" value="${escape(this.query)}"></label></div>${rows.length?`<div class="table-scroll"><table class="service-table responsive-controls devices-table"><thead><tr><th>Device</th><th>Address</th><th>Type</th><th>Observation</th><th>Actions</th></tr></thead><tbody>${rows.map(row=>this.renderRow(row,model.job)).join('')}</tbody></table></div>`:`<div class="empty-state">${model.devices.length?'No matching devices.':'No devices discovered yet. Choose your network and start a scan.'}</div>`}</section>`;
  },
  renderRow(row,job){
    const escape=escapeHtml,observed=job?.kind!=='lookup'&&job?.status==='completed'&&row.scanId!==job.id&&row.network===job.network?'Not seen in latest scan':row.lastSeen?'Response observed':row.evidence.includes('Windows neighbor cache')?'Neighbor cache only':'Advertised information only';
    return `<tr data-live-key="device:${row.id}"><td><strong>${escape(row.displayName)}</strong>${this.vendorLabel(row)}${!row.enabled?' <span class="status-pill paused">Disabled</span>':''}<details data-live-key="device-detail:${row.id}"><summary>Details</summary><dl class="device-facts">${[['Reported name',row.name],['Hostname',row.hostname],['Reported manufacturer',row.manufacturer],['Model',row.model],['Reported type',row.reportedType],['Services',row.services.join(', ')],['Evidence',row.evidence.join(', ')],['Network',row.network]].map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value||'Not reported')}</dd></div>`).join('')}</dl>${this.vendorDetails(row)}<p class="field-help">${row.mac?'Saved labels follow this observed MAC address. Private/randomized MAC addresses can change.':'No MAC address was reported. Saved labels identify this address only; another device may later use it.'}</p></details></td><td data-label="Address"><code>${escape(row.address)}</code><small>${escape(row.mac||'MAC not reported')}</small></td><td data-label="Type">${escape(row.type)}${row.typeSource==='Unknown'?'':'<small>'+row.typeSource+'</small>'}</td><td data-label="Observation">${observed}<small>${row.lastSeen?escape(formatServerTimestamp(row.lastSeen)):'No confirmed response time'}</small></td><td class="control-row-actions"><div class="row-actions"><button class="button" data-action="device-use" data-id="${row.id}" ${row.enabled&&state.devices.candidates.length?'':'disabled'}>Use address</button><button class="icon-button" data-action="device-edit" data-id="${row.id}" aria-label="Edit ${escape(row.displayName)}" title="Edit">${icon('pen')}</button><button class="icon-button" data-action="device-copy" data-id="${row.id}" aria-label="Copy address for ${escape(row.displayName)}" title="Copy address">${icon('copy')}</button><button class="icon-button delete" data-action="device-forget" data-id="${row.id}" aria-label="Forget ${escape(row.displayName)}" title="Forget">${icon('trash-can')}</button><button class="switch" role="switch" aria-checked="${row.enabled}" data-action="device-toggle" data-id="${row.id}" aria-label="${escape(row.displayName)} enabled"></button></div></td></tr>`;
  },
  lookupButton(model,active){
    const unavailable=active||this.pending||state.paused||model.error||model.vendorLookup?.error||model.vendorLookup?.coolingDown||!model.devices.some(row=>row.enabled&&row.vendor?.prefix);
    return '<button class="button" data-action="device-lookup" '+(unavailable?'disabled':'')+'>'+icon('search')+'Look up manufacturers</button>';
  },
  lookupNote(model){
    return '<p class="field-help">Manufacturer lookup sends only public MAC prefixes to maclookup.app. Names, IPs and full MAC addresses stay on this server. Private/randomized MACs are skipped.</p>'+
      (model.vendorLookup?.error?'<p class="form-error">'+escapeHtml(model.vendorLookup.error)+'</p>':'')+
      (model.vendorLookup?.coolingDown?'<p role="status">Next manufacturer lookup: '+escapeHtml(formatServerTimestamp(model.vendorLookup.retryAt))+'</p>':'');
  },
  vendorLabel(row){
    const vendor=row.vendor;if(!vendor)return '';
    const label=vendor.status==='found'?vendor.company+(vendor.stale?' · cached':''):vendor.status==='private'?'Private/randomized MAC':vendor.status==='not-found'?'MAC prefix not registered':'';
    return label?'<small class="device-vendor">'+escapeHtml(label)+'</small>':'';
  },
  vendorDetails(row){
    const vendor=row.vendor;if(!vendor)return '';
    if(vendor.status==='private')return '<p class="field-help">Manufacturer lookup is unavailable for a private/randomized MAC.</p>';
    if(vendor.status==='no-mac')return '<p class="field-help">Manufacturer lookup needs a reported MAC address.</p>';
    if(vendor.status==='not-looked-up')return '<p class="field-help">Choose Look up manufacturers to check this MAC prefix.</p>';
    const facts=[['MAC block registrant',vendor.found?vendor.company:'Not found'],['Country',vendor.country],['Business address',vendor.address],['MAC prefix',vendor.prefix],['Assignment',vendor.blockType],['Registered block',vendor.blockStart&&vendor.blockEnd?vendor.blockStart+' – '+vendor.blockEnd:''],['Registry updated',vendor.updated],['Private registration',vendor.isPrivate?'Yes':'No'],['Lookup time',formatServerTimestamp(vendor.checkedAt)]];
    return '<dl class="device-facts">'+facts.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+escapeHtml(value||'Not reported')+'</dd></div>').join('')+'</dl><p class="field-help">Source: maclookup.app. A MAC block registration does not prove the device brand, model or type.'+(vendor.stale?' Cached result has expired; choose Look up manufacturers to refresh it.':'')+'</p>';
  },
  async handle(action,id){
    if(action==='device-lookup'){
      if(this.pending)return;this.pending=true;
      try{await request('api/devices/lookup',{requestId:crypto.randomUUID()});await refreshState();}
      finally{this.pending=false;renderView();}return;
    }
    if(action==='device-scan'){
      if(this.pending)return;this.pending=true;
      try{await request('api/devices/scan',{networkId:this.networkId,requestId:crypto.randomUUID()});await refreshState();}
      finally{this.pending=false;renderView();}return;
    }
    if(action==='device-cancel'){await request('api/devices/cancel',{id});await refreshState();return;}
    const row=this.row(id);if(!row)throw Error('Device is no longer available.');
    if(action==='device-copy'){
      try{await navigator.clipboard.writeText(row.address);notify('Device address copied');}catch{notify('Address: '+row.address);}return;
    }
    if(action==='device-toggle'){await request('api/devices/edit',{id,revision:row.revision,name:row.customName,type:row.customType,enabled:!row.enabled});await refreshState();return;}
    if(action==='device-edit'){
      showDialog(`<form id="device-editor-form">${dialogHeader('Edit device',row.address)}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>${formField('Name','pen',`<input name="name" maxlength="64" value="${escapeHtml(row.customName)}" placeholder="${escapeHtml(row.name||row.hostname||row.address)}">`)}${formField('Type','devices',`<select name="type">${state.devices.types.map(type=>`<option value="${type}" ${type===row.customType?'selected':''}>${type||'Use discovered type'}</option>`).join('')}</select>`)}<label><input type="checkbox" name="enabled" ${row.enabled?'checked':''}> Enabled</label><p class="field-help">These labels affect this inventory only. Disabling a device prevents Use address; it does not block the device or change plugin settings.</p></div>${dialogFooter()}</form>`,{kind:'device',row:structuredClone(row)});return;
    }
    if(action==='device-forget'){
      showDialog(`<form id="device-forget-form">${dialogHeader('Forget device',row.displayName)}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><p>Remove this device and its custom labels from the inventory? It can appear again after another scan. Plugin settings are unchanged.</p></div>${dialogFooter('Forget device')}</form>`,{kind:'device',row:structuredClone(row)});return;
    }
    if(action==='device-use'){
      const choices=structuredClone(state.devices.candidates);
      showDialog(`<form id="device-use-form">${dialogHeader('Use device address',row.address)}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>${formField('Plugin','plug',`<select name="plugin">${choices.map(item=>`<option value="${item.pluginId}">${escapeHtml(item.name)}</option>`).join('')}</select>`)}<p id="device-use-preview"></p><p class="field-help">Only the address changes. Other settings and enablement stay unchanged. An enabled plugin may reconnect when saved. Discovery does not verify that this is the correct device or authorize a new pairing.</p></div>${dialogFooter('Save address')}</form>`,{kind:'device-use',row:structuredClone(row),choices});this.previewAddress();
    }
  },
  previewAddress(){
    const form=dialog.querySelector('#device-use-form');if(!form||dialogContext?.kind!=='device-use')return;
    const candidate=dialogContext.choices.find(item=>item.pluginId===form.elements.plugin.value);let value=dialogContext.row.address;
    if(candidate.pluginId==='oculus-go')value+=':'+(/^\d+\.\d+\.\d+\.\d+:(\d{1,5})$/.exec(candidate.currentValue)?.[1]||'5555');
    if(candidate.pluginId==='emby'){try{const url=new URL(candidate.currentValue);value=url.protocol+'//'+value+':'+(url.port||(url.protocol==='https:'?'443':'80'));}catch{value='http://'+value+':8096';}}
    form.querySelector('#device-use-preview').textContent='Address: '+(candidate.currentValue||'Not configured')+' → '+value;
  },
  async submit(form){
    const context=dialogContext,button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;
    try{
      let endpoint='edit',values={id:context.row.id,revision:context.row.revision};
      if(form.id==='device-forget-form')values.forget=true;
      else if(form.id==='device-editor-form')Object.assign(values,{name:form.elements.name.value.trim(),type:form.elements.type.value,enabled:form.elements.enabled.checked});
      else{endpoint='use';const choice=context.choices.find(item=>item.pluginId===form.elements.plugin.value);Object.assign(values,{pluginId:choice.pluginId,pluginRevision:choice.revision});}
      await request('api/devices/'+endpoint,values);if(dialogContext===context)closeDialog();await refreshState();notify(endpoint==='use'?'Plugin address saved':'Device inventory saved');
    }catch(error){if(dialogContext===context){showFormError(error.message);button.disabled=false;}}
  },
};
document.addEventListener('input',event=>{if(event.target.id==='device-search'){DevicesUI.query=event.target.value;renderView();}});
document.addEventListener('change',event=>{if(event.target.id==='device-network')DevicesUI.networkId=event.target.value;if(event.target.matches('#device-use-form [name="plugin"]'))DevicesUI.previewAddress();});
