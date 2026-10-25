/** Desktop lighting workspace. Draft slider positions are distinct from reported
 * readings. Only release/change sends a value; pending edits keep the latest
 * value per setting rather than accumulating obsolete drag positions. */
const LightingRoomUI = {
  entries:new Map(),
  compact() {return typeof matchMedia==='function'&&matchMedia('(max-width: 1000px)').matches;},
  entry(id) {
    if(!this.entries.has(id))this.entries.set(id,{data:null,lastRead:0,reading:false,error:'',query:'',filter:'all',room:'all',selected:'',drafts:new Map(),expectations:new Map(),queue:new Map(),sending:false});
    return this.entries.get(id);
  },
  service() {return state.services.find(service=>service.id===currentView);},
  adopt(entry,data) {
    if(entry.data&&entry.data.revision!==data.revision){entry.drafts.clear();entry.expectations.clear();entry.queue.clear();entry.selected='';entry.room='all';}
    entry.data=data;
    for(const [key,expected]of entry.expectations){
      if(data.receivedAt===null||data.receivedAt<expected.after)continue;
      const target=(expected.kind==='group'?data.groups:data.lights)?.find(target=>target.id===expected.id);
      if(!target)continue;
      let matches;
      if(expected.property==='color'){
        const rgb=expected.value.slice(1).match(/../g).map(value=>parseInt(value,16)/255),max=Math.max(...rgb),min=Math.min(...rgb),d=max-min;
        const h=((!d?0:max===rgb[0]?((rgb[1]-rgb[2])/d)%6:max===rgb[1]?(rgb[2]-rgb[0])/d+2:(rgb[0]-rgb[1])/d+4)*60+360)%360;
        matches=Number.isFinite(target.hue)&&Number.isFinite(target.saturation)&&Math.min(Math.abs(target.hue-h),360-Math.abs(target.hue-h))<=3&&Math.abs(target.saturation-(max?d/max*100:0))<=2;
      }else matches=typeof target[expected.property]==='number'&&Math.abs(target[expected.property]-expected.value)<=0.6;
      if(matches){if(entry.drafts.get(key)===expected.value)entry.drafts.delete(key);entry.expectations.delete(key);}
    }
  },
  async load(service,force=false) {
    const entry=this.entry(service.id);
    if(!force&&service.lightingRoom){
      this.adopt(entry,service.lightingRoom);entry.loadError='';return;
    }
    if(entry.reading||!force&&Date.now()-entry.lastRead<2500)return;
    entry.reading=true;entry.lastRead=Date.now();
    const revision=service.config.revision;
    try {
      const data=await request('api/lighting-room/'+service.id);
      if(state.services.find(item=>item.id===service.id)?.config.revision===revision){
        this.adopt(entry,data);entry.loadError='';
      }
    }catch(error){entry.loadError=error.message;}
    finally{entry.reading=false;if(currentView===service.id&&!dialog.open)renderView();}
  },
  color(light) {
    if(light.spectrum==='rgb'&&Number.isFinite(light.hue)&&Number.isFinite(light.saturation))return `hsl(${light.hue} ${light.saturation}% 65%)`;
    if(light.spectrum==='white'&&Number.isFinite(light.temperature))return `hsl(${45-light.temperature*.2} 85% ${85-light.temperature*.15}%)`;
    return 'var(--accent)';
  },
  hex(light) {
    if(!Number.isFinite(light.hue)||!Number.isFinite(light.saturation))return '#ffffff';
    const c=light.saturation/100,h=light.hue%360/60,x=c*(1-Math.abs(h%2-1));
    return '#'+(h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x]).map(n=>Math.round((n+1-c)*255).toString(16).padStart(2,'0')).join('');
  },
  reported(value,suffix='') {return value===null||value===undefined?'No data':value+suffix;},
  status(light) {return light.reachable===false?'Unreachable':light.on===true?'On':light.on===false?'Off':'State unknown';},
  attributes(service,kind,id,property) {return `data-plugin-id="${escapeHtml(service.id)}" data-kind="${kind}" data-target-id="${escapeHtml(id)}" data-property="${property}"`;},
  permitted(model,entry) {return model.available&&!model.stale&&(!model.busy||entry.sending);},
  summary(lights) {
    const on=lights.filter(light=>light.on===true).length,unknown=lights.filter(light=>light.on===null).length;
    return lights.length?`${on} of ${lights.length} on${unknown?' · '+unknown+' unknown':''}`:'No lights';
  },
  memberships(model,light) {
    return model.groups.filter(group=>group.deviceIds.includes(light.id)).map(group=>group.name).join(' · ')||light.room||'Ungrouped';
  },
  render(service,tab) {
    this.load(service);
    if(tab==='scenes')return `<div class="lighting-room">${LightingScenesUI.render({pluginId:service.id,embedded:true})}</div>`;
    if(tab==='effects')return `<div class="lighting-room">${LightingUI.render({embedded:true})}</div>`;
    const entry=this.entry(service.id),model=entry.data?.revision===service.config.revision?entry.data:null;
    if(!model)return `<section class="panel room-empty"><span class="room-empty-symbol">${icon('lightbulb')}</span><h2>Lighting control room</h2><p>${escapeHtml(entry.loadError||'Reading the latest gateway inventory…')}</p><button class="button" data-action="room-reload">${icon('rotate')}Reload inventory</button></section>`;
    if(tab==='diagnostics')return this.diagnostics(service,model);
    const lights=model.lights,operation=model.operation,phase=entry.sending?'sending':operation?.phase;
    const phaseLabel={sending:'Sending command',awaiting:'Awaiting reported confirmation',confirmed:'Reported setting confirmed',refreshed:'Inventory refreshed',uncertain:'Outcome not confirmed'}[phase];
    const active=state.lightingAnimations?.active;
    const health=`<div class="room-health"><span class="room-connection ${!model.available||model.stale?'needs-attention':''}">${icon(model.paused?'pause':'circle')}${model.paused?'Server paused':!model.available?'Gateway unavailable':model.gatewayStatus==='unreachable'?'Gateway unreachable':model.gatewayStatus==='checking'?'Checking gateway':model.stale?'Readings need refreshing':'Gateway ready'}</span><span>Last reading: ${model.receivedAt===null?'Not received':escapeHtml(formatServerTimestamp(model.receivedAt))}</span><button class="button" data-action="room-refresh" data-plugin-id="${service.id}" ${!model.available||model.busy||entry.sending?'disabled':''}>${icon('rotate')}Refresh lighting</button></div>`;
    const feedback=`${entry.error||entry.loadError?`<div class="form-error" role="alert">${escapeHtml(entry.error||entry.loadError)}</div>`:''}${phaseLabel?`<div class="room-feedback ${phase==='uncertain'?'needs-attention':''}" role="status">${icon(phase==='confirmed'?'check':'clock')}<span>${phaseLabel}${operation?.targetId?' · '+escapeHtml((operation.kind==='group'?model.groups:operation.kind==='device'?model.devices:lights).find(target=>target.id===operation.targetId)?.name||'Selected device'):''}${operation?.message?'<small>'+escapeHtml(operation.message)+'</small>':''}</span></div>`:''}${!model.inventoryComplete?'<p class="aside-note">Showing the existing lighting tables. Refresh lighting to populate the complete administrator inventory.</p>':''}${active?`<div class="room-feedback"><span>${icon('auto-awesome')} ${escapeHtml(active.name)} is active. Manual lighting controls take over.</span><button class="button danger" data-action="lighting-stop" data-id="${active.id}">${icon('stop')}Stop effect</button></div>`:''}`;
    const stats=`<div class="room-statistics"><div><span>Lights on</span><strong>${lights.filter(light=>light.on===true).length}<small> / ${lights.length}</small></strong></div><div><span>Rooms</span><strong>${model.groups.length}</strong></div><div><span>Unreachable devices</span><strong>${model.devices.filter(device=>device.reachable===false).length}</strong></div><div><span>Low batteries · ≤ 20%</span><strong>${model.devices.filter(device=>device.battery!==null&&device.battery<=20).length}</strong></div></div>`;
    if(tab==='devices')return `<div class="lighting-room">${health}${feedback}${stats}${this.devices(model)}</div>`;
    const rooms=tab==='rooms'?this.rooms(service,model,entry):'';
    const toolbar=`<div class="room-toolbar"><label class="room-search">${icon('magnifying-glass')}<input id="room-search" type="search" data-room-search placeholder="Find a light or room" aria-label="Find a light or room" value="${escapeHtml(entry.query)}"></label><label>Show <select data-room-filter aria-label="Filter lights"><option value="all" ${entry.filter==='all'?'selected':''}>All lights</option><option value="on" ${entry.filter==='on'?'selected':''}>Lights on</option><option value="off" ${entry.filter==='off'?'selected':''}>Lights off</option><option value="unreachable" ${entry.filter==='unreachable'?'selected':''}>Unreachable</option></select></label><span>${model.inventoryComplete?'Complete reported inventory':'Partial inventory'}</span>${entry.drafts.size?'<button class="button" data-action="room-reset">Use reported values</button>':''}</div>`;
    const query=entry.query.trim().toLowerCase(),group=model.groups.find(room=>room.id===entry.room);
    const filtered=lights.filter(light=>(!query||(light.name+' '+this.memberships(model,light)).toLowerCase().includes(query))&&
      (tab!=='rooms'||entry.room==='all'||entry.room==='ungrouped'||Boolean(group?.deviceIds.includes(light.id))));
    const visible=filtered.filter(light=>(tab!=='rooms'||entry.room!=='ungrouped'||!model.groups.some(room=>room.deviceIds.includes(light.id)))&&
      (entry.filter==='all'||entry.filter==='on'&&light.on===true||entry.filter==='off'&&light.on===false||entry.filter==='unreachable'&&light.reachable===false));
    if(!visible.some(light=>light.id===entry.selected))entry.selected=this.compact()?'':visible[0]?.id||'';
    const selected=visible.find(light=>light.id===entry.selected);
    const grid=`<div class="room-workbench"><section class="room-light-list" aria-label="Lights"><div class="room-section-heading"><h2>${escapeHtml(tab==='rooms'&&group?group.name:'Lights')}</h2><span>${visible.length} shown</span></div>${tab==='rooms'&&group?`<div class="panel room-group-controls">${this.range(service,model,entry,group,'brightness','Room brightness',group.brightness,'group')}<p class="field-help">Gateway group setting; individual light levels can differ.</p></div>`:''}<div class="room-light-grid">${visible.map(light=>this.tile(service,model,entry,light)).join('')||'<div class="panel room-empty"><h3>No matching lights</h3><p>Change the search or filter, or refresh the gateway inventory.</p></div>'}</div></section>${this.inspector(service,model,entry,selected)}</div>`;
    return `<div class="lighting-room">${health}${feedback}${stats}${rooms}${toolbar}${grid}${tab==='devices'?this.devices(model):''}</div>`;
  },
  taskShortcut(service,kind,target) {
    return typeof TaskUI==='undefined'?'':TaskUI.lightingShortcut({pluginId:service.id,kind,id:target.id,name:target.name});
  },
  diagnostics(service,model) {
    const e=escapeHtml,connection=service.gatewayConnection,check=service.pollObservation,last=model.diagnostics?.lastScene,failure=model.diagnostics?.lastFailure;
    const time=value=>Number.isFinite(value)?formatServerTimestamp(value):'Not reported';
    const panel=(title,rows,help)=>`<section class="panel"><div class="panel-header"><h2>${e(title)}</h2></div><div class="panel-body"><dl class="facts">${rows.map(([label,value])=>`<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl><p class="field-help">${e(help)}</p></div></section>`;
    const phase={sending:'Sending',awaiting:'Awaiting reported confirmation',confirmed:'Reported setting confirmed',refreshed:'Inventory refreshed',uncertain:'Outcome unconfirmed'};
    const stages={'history-start':'Starting the run receipt','history-step':'Recording a step before sending','history-complete':'Recording completion','history-result':'Saving the final run result',readiness:'Checking readiness',command:'Executing a step',execution:'Executing the scene'};
    return `<div class="lighting-room room-diagnostics"><div class="room-section-heading"><div><h2>Diagnostics</h2><p>Connection, reported readings and execution evidence.</p></div><button class="button" data-action="room-refresh" data-plugin-id="${service.id}" ${!model.available||model.busy?'disabled':''}>${icon('rotate')}Refresh lighting</button><button class="button" data-action="room-activity">${icon('clipboard-list')}View activity</button></div><div class="room-diagnostic-grid">
      ${panel('Gateway connection',[['Connection',connection?.status==='reachable'?'Reachable':connection?.status==='unreachable'?'Unreachable':'Not checked'],['Plugin runtime',service.health],['Last connection check',time(connection?.checkedAt)],['Last inventory attempt',time(check?.attemptedAt)],['Attempt result',check?.status||'Not checked'],['Next automatic check',model.paused?'Server paused':time(connection?.nextPollAt)],['Read backoff',connection?.failures?'Active':'Inactive']],'A reachable gateway does not prove every device is reachable. Failed lighting commands are never replayed.')}
      ${panel('Reported inventory',[['Received',time(model.receivedAt)],['Freshness',model.stale?'Stale — refresh before making changes':'Recent'],['Inventory',model.inventoryComplete?'Complete reported inventory':'Public lighting summary only'],['Devices',model.devices.length],['Lights',model.lights.length],['Rooms',model.groups.length],['Unreachable devices',model.devices.filter(device=>device.reachable===false).length],['Low batteries (20% or less)',model.devices.filter(device=>device.battery!==null&&device.battery<=20).length]],'Values come from gateway reports. Missing reachability or battery information stays unknown; it is not treated as a healthy reading.')}
      ${panel('Command evidence',[['Last lighting operation',phase[model.operation?.phase]||'No retained operation'],['Last scene receipt',last?last.status:'No retained scene'],['Recorded scene progress',last?last.step+' / '+last.totalSteps:'Not recorded'],['Scene started',time(last?.startedAt)],['Scene finished',time(last?.finishedAt)]],'Acknowledgement confirms delivery, not the final light setting. Reported confirmation checks a later reading; it cannot identify which application caused a change.')}
      ${panel('Last recorded execution failure',[['Time',time(failure?.at)],['Stage',stages[failure?.stage]||'No retained failure'],['Error type',failure?.type||'Not recorded'],['Error code',failure?.code||'Not reported']],failure?.code?'Check free disk space and access to the installation folder. A brief locked receipt-file replacement is retried; lighting commands are not.':'Failure details cover this server session; older receipts remain in Activity. An unfinished receipt is not permission to repeat a command; inspect current lighting first.')}
      </div>${this.devices(model,true)}</div>`;
  },
  rooms(service,model,entry) {
    const all=`<button class="room-tile ${entry.room==='all'?'is-selected':''}" data-action="room-select" data-room-id="all" aria-pressed="${entry.room==='all'}"><span class="room-tile-icon">${icon('home')}</span><strong>All rooms</strong><small>${this.summary(model.lights)}</small></button>`;
    const rooms=model.groups.map(group=>{
      const lights=model.lights.filter(light=>group.deviceIds.includes(light.id)),can=this.permitted(model,entry);
      return `<article class="room-tile ${entry.room===group.id?'is-selected':''}" data-live-key="room:${group.id}"><button class="room-select-button" data-action="room-select" data-room-id="${group.id}" aria-pressed="${entry.room===group.id}"><span class="room-tile-icon">${icon('lightbulb')}</span><strong>${escapeHtml(group.name)}</strong><small>${model.inventoryComplete?this.summary(lights):this.reported(group.count,' devices')}</small></button><div class="room-quick-actions"><button class="button" data-action="room-power" ${this.attributes(service,'group',group.id,'power')} data-value="true" ${can?'':'disabled'} aria-label="Turn on ${escapeHtml(group.name)}">On</button><button class="button" data-action="room-power" ${this.attributes(service,'group',group.id,'power')} data-value="false" ${can?'':'disabled'} aria-label="Turn off ${escapeHtml(group.name)}">Off</button></div>${this.taskShortcut(service,'group',group)}${model.management?`<button class="button room-adjust" data-action="room-edit-group" data-room-id="${group.id}" ${can&&group.editToken?'':'disabled'} aria-label="Edit room ${escapeHtml(group.name)}">${icon('pen')}Edit room</button>`:''}</article>`;
    }).join('');
    const ungrouped=model.lights.filter(light=>!model.groups.some(group=>group.deviceIds.includes(light.id)));
    return `<div class="room-section-heading"><h2>Rooms</h2><p>Gateway groups · Select a room to see its lights</p></div><div class="room-grid">${all}${rooms}${model.inventoryComplete&&ungrouped.length?`<button class="room-tile ${entry.room==='ungrouped'?'is-selected':''}" data-action="room-select" data-room-id="ungrouped" aria-pressed="${entry.room==='ungrouped'}"><span class="room-tile-icon">${icon('lightbulb')}</span><strong>Ungrouped</strong><small>${this.summary(ungrouped)}</small></button>`:''}</div>`;
  },
  range(service,model,entry,light,property,label,value,kind='light') {
    const key=kind+':'+light.id+':'+property,draft=entry.drafts.get(key),shown=draft??value;
    return `<label class="room-range"><span>${label}<output>${this.reported(shown,'%')}</output></span><input type="range" min="0" max="100" step="1" value="${shown??0}" aria-label="${escapeHtml(label+' · '+light.name)}" data-room-value ${this.attributes(service,kind,light.id,property)} ${this.permitted(model,entry)&&light.reachable!==false?'':'disabled'}><small>Reported: ${this.reported(value,'%')}${draft!==undefined?' · Selected: '+draft+'%':''}</small></label>`;
  },
  tile(service,model,entry,light) {
    const can=this.permitted(model,entry)&&light.reachable!==false;
    return `<article class="panel room-light ${entry.selected===light.id?'is-selected':''} ${light.on===true?'is-on':''}" data-live-key="room-light:${light.id}" style="--light-color:${this.color(light)}"><div class="room-light-heading"><span class="room-light-symbol">${icon('lightbulb')}</span><button class="room-light-name" data-action="room-inspect" data-target-id="${light.id}"><strong>${escapeHtml(light.name)}</strong><small>${escapeHtml(this.memberships(model,light))}</small></button><button class="icon-button room-power ${light.on===true?'is-on':''}" data-action="room-power" ${this.attributes(service,'light',light.id,'power')} data-value="${light.on!==true}" aria-label="Turn ${light.on===true?'off':'on'} ${escapeHtml(light.name)}" ${can?'':'disabled'}>${icon('power-off')}</button></div><div class="room-light-state"><span>${this.status(light)}</span><small>${light.spectrum==='rgb'?'Colour':light.spectrum==='white'?'Tunable white':light.spectrum==='none'?'Dimmable':'Capability unknown'}</small></div>${this.range(service,model,entry,light,'brightness','Brightness',light.brightness)}<button class="button room-adjust" data-action="room-inspect" data-target-id="${light.id}" aria-label="Adjust ${escapeHtml(light.name)}">${icon('sliders')}Adjust light</button></article>`;
  },
  inspector(service,model,entry,light) {
    if(!light)return '<aside class="panel room-inspector room-inspector-empty"><div class="room-empty"><h2>Light details</h2><p>Select a light to inspect its settings.</p></div></aside>';
    const metadata=model.devices.find(device=>device.id===light.id),can=this.permitted(model,entry)&&light.reachable!==false;
    return `<aside class="panel room-inspector" aria-label="Selected light" data-live-key="room-inspector:${light.id}"><div class="room-inspector-art" style="--light-color:${this.color(light)}">${icon('lightbulb')}</div><div class="room-inspector-body"><button class="button room-mobile-close" type="button" data-action="room-close-inspector">${icon('arrow-left')}Back to lights</button><div class="room-section-heading"><div><h2>${escapeHtml(light.name)}</h2><p>${escapeHtml(this.memberships(model,light))} · ${this.status(light)}</p></div></div><div class="room-quick-actions"><button class="button primary" data-action="room-power" ${this.attributes(service,'light',light.id,'power')} data-value="true" ${can?'':'disabled'}>Turn on</button><button class="button" data-action="room-power" ${this.attributes(service,'light',light.id,'power')} data-value="false" ${can?'':'disabled'}>Turn off</button></div>${this.range(service,model,entry,light,'brightness','Brightness',light.brightness)}${light.spectrum==='white'?this.range(service,model,entry,light,'temperature','Warmth',light.temperature)+'<p class="field-help">0% cooler · 100% warmer</p>':''}${light.spectrum==='rgb'?`<label class="room-colour"><span>Colour</span><input type="color" data-room-value ${this.attributes(service,'light',light.id,'color')} value="${entry.drafts.get('light:'+light.id+':color')||this.hex(light)}" ${can?'':'disabled'}></label><p class="field-help">Colour and brightness are adjusted separately.</p>`:''}<dl class="room-device-facts"><div><dt>Model</dt><dd>${escapeHtml(metadata?.model||'Not reported')}</dd></div><div><dt>Firmware</dt><dd>${escapeHtml(metadata?.firmware||'Not reported')}</dd></div><div><dt>Reachability</dt><dd>${light.reachable===null?'Unknown':light.reachable?'Reachable':'Unreachable'}</dd></div><div><dt>Device ID</dt><dd>${light.id}</dd></div></dl><p class="field-help">Brightness and colour controls do not explicitly send a power command. Use Turn on or Turn off to set power.</p>${model.management?`<button class="button" data-action="room-rename-device" data-target-id="${light.id}" ${can&&metadata?.editToken?'':'disabled'}>${icon('pen')}Rename device</button>`:''}${this.taskShortcut(service,'light',light)}<button class="button" data-action="room-scenes">${icon('palette')}Save or design a scene</button></div></aside>`;
  },
  devices(model,readOnly=false) {
    const types={0:'Remote',1:'Remote',2:'Light',3:'Plug',4:'Motion sensor',6:'Repeater',7:'Blind',8:'Sound remote',10:'Air purifier'};
    const columns=['Device','Type','Reachability','Battery','Model','Firmware',readOnly?'Capabilities':'Actions'];
    const rows=model.devices.map(device=>{
      const spectrum=model.lights.find(light=>light.id===device.id)?.spectrum;
      const capability=device.type===2?'Power · brightness'+(spectrum==='rgb'?' · colour':spectrum==='white'?' · warmth':''):'Inventory only';
      const action=readOnly?escapeHtml(capability):model.management?`<button class="button" data-action="room-rename-device" data-target-id="${device.id}" ${model.available&&!model.stale&&!model.busy&&device.editToken?'':'disabled'} aria-label="Rename ${escapeHtml(device.name)}">${icon('pen')}Rename</button>`:'—';
      const values=[device.name,types[device.type]||'Other device',device.reachable===null?'Unknown':device.reachable?'Reachable':'Unreachable',this.reported(device.battery,'%'),device.model||'Not reported',device.firmware||'Not reported'];
      return `<tr data-live-key="inventory:${device.id}">${values.map((value,index)=>`<td data-label="${columns[index]}">${escapeHtml(value)}</td>`).join('')}<td data-label="${columns[6]}">${action}</td></tr>`;
    }).join('');
    return `<section class="panel room-device-list"><div class="panel-header"><h2>Gateway device inventory</h2><span>${model.devices.length} devices</span></div><p class="field-help">Non-light devices are listed with reported information. Their control, pairing and button events are not exposed by this adapter.</p><div class="table-scroll"><table><thead><tr>${columns.map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows||'<tr><td data-label="Inventory" colspan="7">No complete inventory reported. Refresh lighting to retrieve it.</td></tr>'}</tbody></table></div></section>`;
  },
  async edit(kind,id) {
    const service=this.service(),view=currentView,tab=PluginUI.tabs.get(currentView);
    if(!service)return;
    const model=await request('api/lighting-room/'+service.id);
    if(currentView!==view||PluginUI.tabs.get(view)!==tab||dialog.open)return;
    if(!model.management||!model.inventoryComplete||model.stale||!model.available||model.busy)throw Error('Refresh lighting and wait until the gateway is ready before editing.');
    const target=(kind==='group'?model.groups:model.devices).find(target=>target.id===id);
    if(!target?.editToken)throw Error('Refresh lighting to retrieve the current editor information.');
    const lightIds=new Set(model.lights.map(light=>light.id));
    const kept=kind==='group'?target.deviceIds.filter(id=>!lightIds.has(id)):[];
    const members=kind==='group'?`<fieldset class="room-member-editor"><legend>Lights in this room</legend><p class="field-help">Choose this room’s lights. Other rooms keep their own selections.</p><label class="field"><span class="field-label">Find a light</span><input type="search" data-room-member-search placeholder="Search lights"></label><div class="room-member-list">${model.lights.map(light=>`<label class="room-member" data-member-label="${escapeHtml(light.name.toLowerCase())}"><input class="switch" role="switch" type="checkbox" name="members" value="${light.id}" ${target.deviceIds.includes(light.id)?'checked':''}><span><strong>${escapeHtml(light.name)}</strong><small>${escapeHtml(this.memberships(model,light))}${light.reachable===false?' · Unreachable':''}</small></span></label>`).join('')||'<p>No lights reported.</p>'}</div>${kept.length?`<p class="field-help">Other existing members are kept: ${kept.map(id=>escapeHtml(model.devices.find(device=>device.id===id)?.name||'Unreported device')).join(', ')}.</p>`:''}<p class="room-member-summary" data-member-summary></p></fieldset>`:'';
    showDialog(`<form id="lighting-management-form">${dialogHeader(kind==='group'?'Edit gateway room':'Rename device',target.name)}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>${formField('Name','tag',`<input name="name" required maxlength="64" value="${escapeHtml(target.name)}">`)}${members}<p class="aside-note">${kind==='group'?'Saving updates this room on the gateway and in the IKEA app. Membership changes can affect which lights its physical controls operate.':'Saving updates this device’s gateway name, including in the IKEA app.'} Light power, brightness and colour are not changed by this editor.</p></div>${dialogFooter(kind==='group'?'Save room':'Save name')}</form>`,
      {kind:'lighting-management',pluginId:service.id,targetKind:kind,targetId:id,revision:model.revision,expected:target.editToken,
        kept,original:kind==='group'?target.deviceIds:[],requestId:crypto.randomUUID(),submitted:false});
    this.memberSummary();
  },
  editDraft(form) {
    return {name:form.elements.namedItem('name').value.trim(),...(dialogContext?.targetKind==='group'?{members:[...dialogContext.kept,...form.querySelectorAll('[name="members"]:checked')].map(value=>typeof value==='string'?value:value.value).sort((a,b)=>Number(a)-Number(b))}:{})};
  },
  memberSummary() {
    if(dialogContext?.kind!=='lighting-management'||dialogContext.targetKind!=='group')return;
    const form=dialog.querySelector('#lighting-management-form');if(!form)return;
    const selected=this.editDraft(form).members,old=dialogContext.original;
    const added=selected.filter(id=>!old.includes(id)).length,removed=old.filter(id=>!selected.includes(id)).length;
    form.querySelector('[data-member-summary]').textContent=`${selected.length} members after saving · ${added} added · ${removed} removed`;
  },
  async submitEdit(form) {
    const context=dialogContext;if(context?.kind!=='lighting-management'||context.submitted)return;
    context.submitted=true;const button=form.querySelector('[type="submit"]');button.disabled=true;
    const values={...this.editDraft(form),revision:context.revision,requestId:context.requestId,kind:context.targetKind,id:context.targetId,expected:context.expected};
    try{
      const data=await request('api/lighting-room/'+context.pluginId+'/manage',values);
      this.adopt(this.entry(context.pluginId),data);await refreshState(false);
      if(dialogContext===context){closeDialog();renderView();notify(data.operation?.phase==='confirmed'?'Gateway settings updated':'Update sent. Waiting for gateway confirmation.');}
    }catch(error){if(dialogContext===context){context.submitted=false;button.disabled=false;showFormError(error.message);}}
  },
  async enqueue(service,values) {
    const entry=this.entry(service.id),key=values.kind+':'+(values.id||'gateway')+':'+(values.property||'refresh');
    entry.queue.set(key,values);
    if(entry.sending)return;
    entry.sending=true;entry.error='';renderView();
    try {
      while(entry.queue.size){
        const [key,command]=entry.queue.entries().next().value;entry.queue.delete(key);
        const current=state.services.find(item=>item.id===service.id);
        if(!current||current.config.revision!==service.config.revision)throw Error('Gateway settings changed. Refresh before sending more commands.');
        const data=await request('api/lighting-room/'+service.id,{...command,revision:service.config.revision,requestId:crypto.randomUUID()});
        if(['brightness','temperature','color'].includes(command.property))entry.expectations.set(key,{...command,after:data.operation?.startedAt??Date.now()});
        this.adopt(entry,data);
      }
    }catch(error){entry.queue.clear();entry.error=error.message;}
    finally{entry.sending=false;entry.lastRead=0;await this.load(service,true);if(currentView===service.id&&!dialog.open)renderView();}
  },
  async handle(action,control) {
    const service=this.service();if(!service)return;
    const entry=this.entry(service.id);
    if(action==='room-refresh')return this.enqueue(service,{kind:'refresh'});
    if(action==='room-reload')return this.load(service,true);
    if(action==='room-select')entry.room=control.dataset.roomId;
    if(action==='room-inspect')entry.selected=control.dataset.targetId;
    if(action==='room-close-inspector'){entry.returnToLight=entry.selected;entry.selected='';}
    if(action==='room-scenes')PluginUI.tabs.set(service.id,'scenes');
    if(action==='room-activity')PluginUI.tabs.set(service.id,'log');
    if(action==='room-edit-group')return this.edit('group',control.dataset.roomId);
    if(action==='room-rename-device')return this.edit('device',control.dataset.targetId);
    if(action==='room-reset'){entry.drafts.clear();entry.expectations.clear();}
    if(action==='room-power')return this.enqueue(service,{kind:control.dataset.kind,id:control.dataset.targetId,property:'power',value:control.dataset.value==='true'});
    renderView();
    if(this.compact()&&['room-inspect','room-close-inspector'].includes(action))requestAnimationFrame(()=>{
      const target=action==='room-inspect'?workspace.querySelector('.room-inspector'):workspace.querySelector(`[data-live-key="room-light:${entry.returnToLight}"]`);
      target?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
      target?.querySelector(action==='room-inspect'?'.room-mobile-close':'[data-action="room-inspect"]')?.focus({preventScroll:true});
    });
  },
};

document.addEventListener('input',event=>{
  if(event.target.matches('[data-room-member-search]')){
    const query=event.target.value.trim().toLowerCase();
    for(const row of dialog.querySelectorAll('[data-member-label]'))row.hidden=!row.dataset.memberLabel.includes(query);
  }
  if(!event.target.closest('.lighting-room'))return;
  const service=LightingRoomUI.service();if(!service)return;
  const entry=LightingRoomUI.entry(service.id),input=event.target;
  if(input.matches('[data-room-search]')){entry.query=input.value;renderView();}
  if(input.matches('[data-room-value]')){
    const value=input.type==='color'?input.value:Number(input.value);entry.drafts.set(input.dataset.kind+':'+input.dataset.targetId+':'+input.dataset.property,value);
    const output=input.closest('label')?.querySelector('output');if(output)output.value=String(value)+(input.type==='range'?'%':'');
  }
});
document.addEventListener('change',event=>{
  if(event.target.closest('#lighting-management-form'))LightingRoomUI.memberSummary();
  if(!event.target.closest('.lighting-room'))return;
  const service=LightingRoomUI.service();if(!service)return;
  const entry=LightingRoomUI.entry(service.id),input=event.target;
  if(input.matches('[data-room-filter]')){entry.filter=input.value;renderView();}
  if(input.matches('[data-room-value]'))void LightingRoomUI.enqueue(service,{kind:input.dataset.kind,id:input.dataset.targetId,property:input.dataset.property,value:input.type==='color'?input.value:Number(input.value)});
});
document.addEventListener('submit',event=>{
  if(formIdentifier(event.target)==='lighting-management-form'){event.preventDefault();void LightingRoomUI.submitEdit(event.target);}
});
