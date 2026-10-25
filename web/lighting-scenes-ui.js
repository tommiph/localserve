/** Administrator scene gallery. Authoring stores light settings; only Apply
 * admits device actions through the normal revisioned Controls runner. */
const LightingScenesUI = {
  pages() {
    return (state.controls||[]).flatMap(owner=>owner.pages.filter(page=>page.presentation==='lighting').map(page=>({page,pluginId:owner.pluginId,service:state.services.find(service=>service.id===owner.pluginId)})));
  },
  find(control) {
    const entry=this.pages().find(entry=>entry.page.id===control.dataset.pageId&&entry.pluginId===control.dataset.pluginId);
    if(!entry)throw Error('Lighting remote unavailable. Refresh administration.');
    return {...entry,scene:entry.page.items.find(item=>item.id===control.dataset.sceneId&&item.kind==='scene')};
  },
  render({pluginId=null,embedded=false}={}) {
    const pages=this.pages().filter(entry=>!pluginId||entry.pluginId===pluginId),lighting=state.services.find(service=>service.controls?.lighting&&(!pluginId||service.id===pluginId));
    const add=!pages.length&&lighting?`<button class="button primary" data-action="scene-create-remote" data-plugin-id="${lighting.id}">${icon('plus')}Set up lighting remote</button>`:'';
    return (embedded?'<div class="room-section-heading"><div><h2>Lighting scenes</h2><p>Design a look or save the current lighting.</p></div>'+add+'</div>':pageHeading('Lighting scenes','Save a look once, then use it from Controller or a Task','<button class="button" data-view="controls">'+icon('arrow-left')+'Controls</button>'+add))+
      '<p class="field-help">Saving, editing and copying do not change the lights. New scenes start disabled. Apply starts the stored scene.</p>'+
      (pages.map(({page,pluginId,service})=>{
        const ready=service?.enabled&&service.configurationReady&&!state.paused,scenes=page.items.filter(item=>item.kind==='scene');
        return `<section class="scene-library-group" data-live-key="scene-group:${page.id}"><div class="panel-header"><h2>${escapeHtml(page.name)} ${page.enabled?'':'· Remote disabled'}</h2><div class="row-actions"><button class="button" data-action="scene-create" data-plugin-id="${pluginId}" data-page-id="${page.id}" ${ready?'':'disabled'}>${icon('palette')}New scene</button><button class="button primary" data-action="scene-capture" data-plugin-id="${pluginId}" data-page-id="${page.id}" ${ready?'':'disabled'}>${icon('plus')}Save current lighting</button>${service?.actions?.some(action=>action.id==='inspect-scenes'&&action.settingsOnly)?`<button class="button" data-action="scene-import" data-plugin-id="${pluginId}" data-page-id="${page.id}" ${ready?'':'disabled'}>${icon('download')}Import from gateway</button>`:''}</div></div>
          ${!ready?'<p class="field-help">Capturing needs an enabled, configured lighting service and current readings. Stored scenes can still be edited.</p>':''}<div class="lighting-gallery">${scenes.map(scene=>{
            const attributes=`data-plugin-id="${pluginId}" data-page-id="${page.id}" data-scene-id="${scene.id}"`;
            return `<article class="panel lighting-preset" data-live-key="scene:${page.id}:${scene.id}"><div class="lighting-art" aria-hidden="true" style="--lighting-one:#659dbe;--lighting-two:#a98cd2;--lighting-three:#61aa98"><span></span><span></span><span></span><div class="lighting-art-glyph">${icon(scene.icon||'lightbulb')}</div></div><div class="lighting-preset-body"><div class="lighting-card-title"><h2>${escapeHtml(scene.label)}</h2>${scene.enabled?'':'<span class="status-pill paused">Disabled</span>'}</div><p>Stored lighting scene</p><div class="lighting-card-actions"><button class="button primary" data-action="scene-run" ${attributes} ${ready&&page.enabled&&scene.enabled?'':'disabled'}>${icon('play')}Apply</button>${typeof TaskUI==='undefined'?'':TaskUI.lightingShortcut({pluginId,kind:'scene',pageId:page.id,sceneId:scene.id,name:scene.label})}<div class="item-actions" role="group" aria-label="Actions for ${escapeHtml(scene.label)}">${[['edit','pen','Edit'],['copy','copy','Copy'],['delete','trash-can','Delete']].map(([action,glyph,label])=>`<button class="icon-button" type="button" data-action="scene-${action}" ${attributes} aria-label="${label} ${escapeHtml(scene.label)}" title="${label}">${icon(glyph)}</button>`).join('')}<button class="switch" role="switch" aria-checked="${scene.enabled}" aria-label="${escapeHtml(scene.label)} enabled" data-action="scene-enabled" ${attributes}></button></div></div></div></article>`;
          }).join('')||'<div class="empty-state">No scenes yet. Create a new scene or save your current lighting.</div>'}</div></section>`;
      }).join('')||'<section class="panel"><div class="panel-body"><p>Set up a lighting remote to store scenes. Configure the lighting plugin first if it is not available.</p></div></section>');
  },
  endpoint(entry) { return `api/lighting-scenes/${entry.pluginId}/${entry.page.id}`; },
  async handle(action,control) {
    if(action==='scene-create-remote')return ControlsUI.open(control.dataset.pluginId);
    const entry=this.find(control);
    if(action==='scene-import')return this.importGateway(entry);
    if(action==='scene-enabled')return mutate(this.endpoint(entry),{action:'enabled',revision:entry.page.revision,itemId:entry.scene.id,enabled:!entry.scene.enabled});
    if(action==='scene-run'){
      control.disabled=true;
      try {await mutate(this.endpoint(entry)+'/run',{revision:entry.page.revision,itemId:entry.scene.id,requestId:crypto.randomUUID()});notify('Scene started');}
      finally {if(control.isConnected)control.disabled=false;}
      return;
    }
    return this.edit(entry,action.slice(6));
  },
  async importGateway(entry) {
    const scope=currentView,details=await request(this.endpoint(entry));
    if(currentView!==scope||dialog.open)return;
    const model=entry.service.lightingRoom,groups=model?.groups||[],e=escapeHtml;
    showDialog(`<form id="gateway-scene-form">${dialogHeader('Import from gateway',entry.page.name)}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><p>Copy stored light settings into a new disabled Sormus scene. Reading and importing do not change your lighting or the gateway scene.</p>${formField('Gateway room','home',`<select name="groupId"><option value="">Choose a room</option>${groups.map(group=>`<option value="${e(group.id)}">${e(group.name)}</option>`).join('')}</select>`)}<button type="button" class="button" data-load-scenes>Load scenes</button><div data-native-scene-picker hidden>${formField('Gateway scene','palette','<select name="sceneId"><option value="">Choose a scene</option></select>')}<button type="button" class="button" data-read-scene>Read selected scene</button></div><p data-import-status class="field-help" role="status">${model?.stale?'Refresh lighting before browsing gateway scenes.':'Choose a room, then load its scenes.'}</p><div data-import-details></div><div data-import-name hidden>${formField('New scene name','tag','<input name="name" maxlength="64" required>')}</div></div>${dialogFooter('Import scene')}</form>`,{kind:'gateway-scene'});
    const context=dialogContext,form=dialog.querySelector('form'),submit=form.querySelector('[type="submit"]'),status=form.querySelector('[data-import-status]');
    let preview=null,busy=false;submit.disabled=true;
    const reset=()=>{preview=null;submit.disabled=true;form.querySelector('[data-import-name]').hidden=true;form.querySelector('[data-import-details]').replaceChildren();};
    const call=async values=>{
      if(busy)return null;busy=true;reset();
      form.querySelector('#form-error').hidden=true;status.textContent='Reading gateway scenes…';
      form.querySelectorAll('[data-load-scenes],[data-read-scene],select').forEach(input=>input.disabled=true);
      try{return await mutate(this.endpoint(entry)+'/gateway',{action:'inspect',revision:model?.revision,pageRevision:details.revision,groupId:form.elements.groupId.value,...values});}
      catch(error){if(dialogContext===context)showFormError(error.message);return null;}
      finally{busy=false;if(dialogContext===context)form.querySelectorAll('[data-load-scenes],[data-read-scene],select').forEach(input=>input.disabled=false);}
    };
    form.elements.groupId.onchange=()=>{reset();form.querySelector('[data-native-scene-picker]').hidden=true;status.textContent='Load scenes for the selected room.';};
    form.elements.sceneId.onchange=()=>{reset();status.textContent='Read this scene to check its stored light settings.';};
    form.querySelector('[data-load-scenes]').onclick=async()=>{
      const result=await call({});if(!result||dialogContext!==context)return;
      form.elements.sceneId.innerHTML='<option value="">Choose a scene</option>'+result.scenes.map(scene=>`<option value="${e(scene.id)}">${e(scene.name)}</option>`).join('');
      form.querySelector('[data-native-scene-picker]').hidden=false;
      status.textContent=result.truncated?'Showing the first 32 gateway scenes.':result.scenes.length?'Choose a scene, then read its settings.':'No gateway scenes were reported for this room.';
    };
    form.querySelector('[data-read-scene]').onclick=async()=>{
      const result=await call({sceneId:form.elements.sceneId.value});if(!result||dialogContext!==context)return;
      if(!result.importable){status.textContent=result.issues.join(' ');return;}
      preview=result.preview;status.textContent='Ready to copy. This inspected snapshot expires in five minutes. The new scene starts disabled.';
      form.elements.name.value=result.name;form.querySelector('[data-import-name]').hidden=false;
      form.querySelector('[data-import-details]').innerHTML='<p>'+result.lights.length+(result.lights.length===1?' light':' lights')+'</p><ul>'+result.lights.map(light=>`<li>${e(light.name)}</li>`).join('')+'</ul>';
      submit.disabled=false;
    };
    form.onsubmit=async event=>{
      event.preventDefault();if(!preview||busy||context.submitted)return;
      context.submitted=true;submit.disabled=true;
      try{await mutate(this.endpoint(entry)+'/gateway',{action:'import',revision:model.revision,pageRevision:details.revision,groupId:form.elements.groupId.value,sceneId:form.elements.sceneId.value,preview,name:form.elements.name.value.trim()});if(dialogContext===context){closeDialog();renderView();notify('Scene imported · Disabled');}}
      catch(error){if(dialogContext===context){preview=null;context.submitted=false;showFormError(error.message+' Read the scene again before another import.');}}
    };
  },
  async edit(entry,action) {
    const scope=currentView;
    const details=await request(this.endpoint(entry));
    if(currentView!==scope||dialog.open)return;
    const e=escapeHtml,scene=details.scenes?.find(scene=>scene.id===entry.scene?.id),name=action==='copy'?scene?.label.slice(0,59)+' copy':scene?.label||'';
    if(!['create','capture'].includes(action)&&!scene)throw Error('This scene changed. Refresh the list and try again.');
    const title={create:'New lighting scene',capture:'Save current lighting',edit:'Edit scene',copy:'Copy scene',delete:'Delete scene'}[action];
    const designed=action==='create'||action==='edit'&&details.editableScenes?.[scene.id];
    const lightEditor=designed?this.lightEditor(details.lighting.lights,action==='edit'?details.editableScenes[scene.id]:null):'';
    const lights=details.lighting.lights.map(light=>`<label class="lighting-target"><input type="checkbox" name="lightIds" value="${e(light.id)}" ${light.capturable?'checked':'disabled'}><span><strong>${e(light.name)}</strong><small>${light.capturable?`${light.on?'On':'Off'} · ${light.brightness}%`:'A current, reachable reading is needed'}</small></span></label>`).join('');
    showDialog(`<form id="lighting-scene-form">${dialogHeader(title,entry.page.name)}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>${action==='delete'?`<p>Delete ${e(name)}? Tasks that use this scene will need a replacement.</p>`:`${formField('Scene name','tag',`<input name="name" maxlength="64" required value="${e(name)}">`)}<details class="scene-glyph-picker"><summary><span data-scene-glyph-current>${icon(scene?.icon||'lightbulb')}</span> Scene symbol</summary><input type="hidden" name="icon" value="${e(scene?.icon||'lightbulb')}"><label class="field"><span class="field-label">Find a symbol</span><input type="search" data-scene-glyph-search placeholder="Search symbols"></label><div class="glyph-grid scene-glyph-choices" aria-label="Scene symbols"></div><p data-scene-glyph-count class="field-help"></p></details>`}${action==='edit'?`${designed?'<label class="check-field"><input class="switch" role="switch" name="customize" type="checkbox">Edit stored light settings</label>':''}<label class="check-field"><input class="switch" role="switch" name="recapture" type="checkbox">Replace stored lighting with the current settings</label>`:''}${action!=='delete'?this.fadeEditor(scene,details):''}${lightEditor}${['capture','edit'].includes(action)?`<fieldset class="lighting-targets" ${action==='edit'?'hidden':''}><legend>Lights to include</legend><p class="field-help">Only complete reported readings can be saved. This does not change the lights.</p><div class="lighting-target-grid">${lights||'<p>No lights are available yet.</p>'}</div></fieldset>`:''}</div>${dialogFooter(action==='delete'?'Delete scene':action==='copy'?'Copy scene':'Save scene')}</form>`,{kind:'lighting-scene',sceneAction:action,pluginId:entry.pluginId,pageId:entry.page.id,itemId:scene?.id,revision:details.revision});
    const form=dialog.querySelector('form'),search=form.querySelector('[data-scene-glyph-search]');
    const paint=()=>{
      const selected=form.elements.icon,query=search.value.trim().toLowerCase().replaceAll('-',' ');
      const choices=state.pluginGlyphs.filter(id=>id.replaceAll('-',' ').includes(query));
      form.querySelector('[data-scene-glyph-current]').innerHTML=icon(selected.value);
      form.querySelector('.glyph-grid').innerHTML=choices.slice(0,96).map(id=>`<button type="button" data-scene-glyph="${id}" aria-label="${e(id.replaceAll('-',' '))}" title="${e(id.replaceAll('-',' '))}" aria-pressed="${id===selected.value}">${icon(id)}</button>`).join('');
      form.querySelector('[data-scene-glyph-count]').textContent=choices.length>96?'Showing 96 symbols. Search to narrow the choices.':choices.length?'':'No matching symbols.';
    };
    if(search){search.oninput=paint;form.querySelector('.glyph-grid').onclick=event=>{const choice=event.target.closest('[data-scene-glyph]');if(choice){form.elements.icon.value=choice.dataset.sceneGlyph;paint();}};paint();}
    const sync=()=>{
      const capture=form.querySelector('.lighting-targets'),editor=form.querySelector('.scene-light-editor');
      const fade=form.elements.fadeSeconds,inherit=form.elements.inheritFade;
      if(fade&&inherit){fade.disabled=inherit.checked;fade.closest('[data-scene-fade-value]').hidden=inherit.checked;}
      if(capture&&action==='edit')capture.hidden=!form.elements.recapture.checked;
      if(editor){editor.hidden=action!=='create'&&!form.elements.customize?.checked;for(const row of editor.querySelectorAll('[data-scene-light]')){
        const selected=row.querySelector('[data-light-selected]').checked;
        row.querySelector('[data-light-settings]').hidden=!selected;
        for(const input of row.querySelectorAll('[data-light-settings] input'))input.disabled=!selected||editor.hidden;
      }}
    };
    form.onchange=event=>{
      if(event.target.name==='recapture'&&event.target.checked&&form.elements.customize)form.elements.customize.checked=false;
      if(event.target.name==='customize'&&event.target.checked)form.elements.recapture.checked=false;
      sync();
    };
    form.oninput=event=>{
      const input=event.target,row=input.closest('[data-scene-light]');if(!row)return;
      if(input.dataset.lightValue==='color'){
        const rgb=input.value.match(/\w\w/g).map(value=>parseInt(value,16)/255),max=Math.max(...rgb),min=Math.min(...rgb),d=max-min;
        let hue=!d?0:max===rgb[0]?((rgb[1]-rgb[2])/d)%6:max===rgb[1]?(rgb[2]-rgb[0])/d+2:(rgb[0]-rgb[1])/d+4;
        row.querySelector('[data-light-value="hue"]').value=(hue*60+360)%360;
        row.querySelector('[data-light-value="saturation"]').value=max?d/max*100:0;
      }
      const output=input.closest('label')?.querySelector('output');if(output)output.value=input.value+'%';
    };
    sync();
  },
  fadeEditor(scene,details) {
    if(details.fadeDefault===undefined || scene && !details.editableScenes?.[scene.id])return '';
    return `<fieldset class="scene-fade-editor"><legend>Transition</legend><label class="check-field"><input type="checkbox" class="switch" role="switch" name="inheritFade" ${scene?.fadeSeconds===undefined?'checked':''}>Use plugin default (${details.fadeDefault} s)</label><label class="field" data-scene-fade-value><span class="field-label">Fade duration (seconds)</span><input name="fadeSeconds" type="number" min="0" max="60" step="0.1" required value="${scene?.fadeSeconds??details.fadeDefault}"></label><p class="field-help">0 changes immediately. Brightness, warmth and colour fade when supported by the light. Each light starts its transition when its command arrives; saving does not change the lights.</p></fieldset>`;
  },
  lightEditor(lights,saved) {
    const e=escapeHtml;
    return '<fieldset class="scene-light-editor" hidden><legend>Light settings</legend><p class="field-help">Choose the lights and settings to store. Saving does not change your lighting.</p><div class="scene-light-grid">'+lights.filter(light=>['none','white','rgb'].includes(light.spectrum)).map(light=>{
      const stored=saved?.find(value=>value.id===light.id),value=stored||light,selected=saved?Boolean(stored):true;
      const range=(property,label,value)=>`<label class="field"><span class="field-label">${label}<output>${value}%</output></span><input type="range" min="0" max="100" step="1" data-light-value="${property}" value="${value}" aria-label="${e(light.name)} ${label.toLowerCase()}"></label>`;
      return `<section class="scene-light-row" data-scene-light="${e(light.id)}" data-spectrum="${light.spectrum}"><label class="check-field"><input type="checkbox" data-light-selected ${selected?'checked':''}><strong>${e(light.name)}</strong></label><div data-light-settings><label class="check-field"><input class="switch" role="switch" type="checkbox" data-light-value="on" aria-label="${e(light.name)} power" ${value.on!==false?'checked':''}>Power on</label>${range('brightness','Brightness',Number.isFinite(value.brightness)?value.brightness:50)}${light.spectrum==='white'?range('temperature','Warmth',Number.isFinite(value.temperature)?value.temperature:50)+'<p class="field-help">Cool white → warm white</p>':''}${light.spectrum==='rgb'?`<label class="field scene-colour"><span class="field-label">Colour</span><input type="color" data-light-value="color" value="${this.colour(value.hue||0,value.saturation||0)}" aria-label="${e(light.name)} colour"></label><input type="hidden" data-light-value="hue" value="${value.hue||0}"><input type="hidden" data-light-value="saturation" value="${value.saturation||0}">`:''}</div></section>`;
    }).join('')+'</div></fieldset>';
  },
  colour(hue,saturation) {
    const c=saturation/100,h=hue%360/60,x=c*(1-Math.abs(h%2-1)),rgb=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];
    return '#'+rgb.map(value=>Math.round((value+1-c)*255).toString(16).padStart(2,'0')).join('');
  },
  draft(form) {
    const action=dialogContext.sceneAction;
    return {action,name:form.elements.name?.value.trim(),icon:form.elements.icon?.value,
      ...(form.elements.inheritFade ? {fadeSeconds:form.elements.inheritFade.checked?null:Number(form.elements.fadeSeconds.value)} : {}),
      ...(action==='create'||form.elements.customize?.checked?{lights:[...form.querySelectorAll('[data-scene-light]')].filter(row=>row.querySelector('[data-light-selected]').checked).map(row=>{
        const read=key=>row.querySelector('[data-light-value="'+key+'"]');
        return {id:row.dataset.sceneLight,on:read('on').checked,brightness:Number(read('brightness').value),...(row.dataset.spectrum==='white'?{temperature:Number(read('temperature').value)}:row.dataset.spectrum==='rgb'?{hue:Number(read('hue').value),saturation:Number(read('saturation').value)}:{})};
      })}:{}),
      ...(action==='capture'||form.elements.recapture?.checked?{lightIds:[...form.querySelectorAll('[name="lightIds"]:checked')].map(input=>input.value)}:{})};
  },
  async submit(form) {
    const context=dialogContext;
    if(context?.kind!=='lighting-scene'||context.submitted)return;
    context.submitted=true;const button=form.querySelector('[type="submit"]');button.disabled=true;
    const draft=this.draft(form),values={action:draft.action,revision:context.revision,...(context.itemId?{itemId:context.itemId}:{})};
    if(values.action!=='delete'){values.name=draft.name;values.icon=draft.icon;}
    if(draft.lightIds)values.lightIds=draft.lightIds;
    if(draft.lights)values.lights=draft.lights;
    if(Object.hasOwn(draft,'fadeSeconds'))values.fadeSeconds=draft.fadeSeconds;
    try {await mutate(`api/lighting-scenes/${context.pluginId}/${context.pageId}`,values);if(dialogContext===context){closeDialog();renderView();notify(values.action==='delete'?'Scene deleted':'Scene saved');}}
    catch(error){if(dialogContext===context){context.submitted=false;button.disabled=false;showFormError(error.message);}}
  },
};
document.addEventListener('submit',event=>{if(event.target.id==='lighting-scene-form'){event.preventDefault();void LightingScenesUI.submit(event.target);}});
