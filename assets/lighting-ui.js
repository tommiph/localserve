/** Lighting animation gallery and modal authoring. Preview artwork is local
 * presentation only; device effects require an explicit Start submission. */
const LightingUI = {
  draft:null,
  pending:false,
  model() {return state.lightingAnimations;},
  item(id) {return this.model()?.animations.find(item=>item.id===id);},
  render() {
    const model=this.model();
    if(!model)return pageHeading('Lighting animations','TRÅDFRI light sequences')+'<div class="empty-state">Lighting animations are unavailable until Sormus has restarted.</div>';
    const active=model.active;
    const banner=active?`<section class="panel lighting-live" aria-label="Active lighting animation"><span class="lighting-live-dot" aria-hidden="true"></span><div><h2>${escapeHtml(active.name)}</h2><p>${active.paused?'Paused with server':active.status==='running'?'Running':'Stopping'} · Step ${active.step || 1} · ${active.targets.length} lights · ${active.durationMinutes?escapeHtml(active.durationMinutes)+' min':'Until stopped'}</p></div><button class="button danger" data-action="lighting-stop" data-id="${active.id}" ${this.pending?'disabled':''}>${icon('stop')}Stop</button></section>`:'';
    return pageHeading('Lighting animations','Colour, brightness and atmosphere',`<button class="button" data-view="controls">${icon('arrow-left')}Controls</button><button class="button primary" data-action="lighting-add">${icon('plus')}New animation</button><a class="button" href="lighting-animations" target="_blank" rel="noopener">${icon('arrow-up-right-from-square')}Open page</a>`)+
      banner+`<p class="aside-note">${escapeHtml(model.reason || 'Choose an animation, select your lights, then Start. Manual lighting controls take over. Stop leaves lights at their last requested setting.')}</p>`+
      `<div class="lighting-gallery">${model.animations.map(item=>{
        const steps=item.steps.filter(step=>step.enabled),colors=steps.slice(0,5).map(step=>step.color);
        return `<article class="panel lighting-preset" data-live-key="lighting:${item.id}"><div class="lighting-art" aria-hidden="true" style="--lighting-one:${colors[0]};--lighting-two:${colors[1]||colors[0]};--lighting-three:${colors[2]||colors[0]}"><span></span><span></span><span></span><div class="lighting-art-glyph">${icon('lightbulb')}</div></div><div class="lighting-preset-body"><div class="lighting-card-title"><h2>${escapeHtml(item.name)}</h2>${!item.enabled?'<span class="status-pill paused">Disabled</span>':''}</div><div class="lighting-palette" aria-label="Animation colours">${colors.map(color=>`<span style="background:${color}" title="${color}"></span>`).join('')}</div><p>${steps.length} steps${steps.some(step=>step.secondsMax>step.seconds)?' · Random timing':''}${steps.some(step=>step.seconds<1)?' · Flashing lights':''} · ${item.spread?'Spread across lights':'Lights together'}<br>${item.durationMinutes?escapeHtml(item.durationMinutes)+' minutes':'Runs until stopped'}</p><div class="lighting-card-actions"><button class="button primary" data-action="lighting-start" data-id="${item.id}" aria-label="Start ${escapeHtml(item.name)}" ${item.enabled&&!active&&!model.reason&&!this.pending?'':'disabled'}>${icon('play')}Start</button>${itemActions(item,'lighting')}</div></div></article>`;
      }).join('')||'<div class="empty-state">No animations. Create one to begin.</div>'}</div>`+
      (model.recent.length?`<section class="panel lighting-history"><div class="panel-header"><h2>Recent runs</h2></div>${model.recent.slice(0,5).map(run=>`<div class="settings-item" data-live-key="lighting-run:${run.id}"><div class="settings-text"><h3>${escapeHtml(run.name)}</h3><p>${escapeHtml(run.status)} · ${formatServerTimestamp(run.startedAt)}${run.message?' · '+escapeHtml(run.message):''}</p></div></div>`).join('')}</section>`:'');
  },
  step() {return {id:crypto.randomUUID(),enabled:true,color:'#57CDB6',brightness:50,warmth:70,seconds:10,fadeSeconds:5};},
  targets(selected=[]) {
    const lights=this.model().lights;
    const choices=lights.map(light=>`<label class="lighting-target"><input type="checkbox" name="targets" data-lighting-target value="${escapeHtml(light.id)}" ${selected.includes(light.id)?'checked':''} ${light.reachable===false&&!selected.includes(light.id)?'disabled':''}><span><strong>${escapeHtml(light.name||'Light '+light.id)}</strong><small>${escapeHtml(light.room||'Ungrouped')} · ${light.spectrum==='rgb'?'Colour':light.spectrum==='white'?'White temperature':'Brightness'}${light.reachable===false?' · Unreachable':''}</small></span></label>`).join('');
    const missing=selected.filter(id=>!lights.some(light=>light.id===id)).map(id=>`<label class="lighting-target"><input type="checkbox" name="targets" data-lighting-target value="${escapeHtml(id)}" checked><span>Unavailable light ${escapeHtml(id)}<small>Uncheck to remove this saved selection.</small></span></label>`).join('');
    return `<fieldset class="lighting-targets"><legend>Lights <span class="field-help">Select up to 10</span></legend><div class="heading-actions"><button class="button" type="button" data-action="lighting-select-all">Select available</button><button class="button" type="button" data-action="lighting-select-none">Clear</button></div><div class="lighting-target-grid">${choices}${missing}${!lights.length?'<p class="field-help">No reported lights. Configure TRÅDFRI and refresh its readings.</p>':''}</div></fieldset>`;
  },
  rows() {
    return this.draft.steps.map((step,index)=>`<section class="lighting-step" data-lighting-step="${step.id}"><div class="lighting-step-heading"><h3>Step ${index+1}</h3><div class="item-actions"><button type="button" class="icon-button" data-action="lighting-step-up" data-id="${step.id}" aria-label="Move step ${index+1} up" ${index===0?'disabled':''}>${icon('arrow-up')}</button><button type="button" class="icon-button" data-action="lighting-step-down" data-id="${step.id}" aria-label="Move step ${index+1} down" ${index===this.draft.steps.length-1?'disabled':''}>${icon('arrow-down')}</button><button type="button" class="icon-button" data-action="lighting-step-copy" data-id="${step.id}" aria-label="Copy step ${index+1}">${icon('copy')}</button><button type="button" class="icon-button danger" data-action="lighting-step-delete" data-id="${step.id}" aria-label="Delete step ${index+1}" ${this.draft.steps.length===1?'disabled':''}>${icon('trash')}</button><label class="lighting-step-enabled"><input type="checkbox" name="stepEnabled" ${step.enabled?'checked':''}>Enabled</label></div></div><div class="lighting-step-fields">${this.field('Colour','palette',`<input name="color" type="color" value="${step.color}">`)}${this.number('Brightness (%)','brightness',step.brightness,this.model().timing?.darkSteps?0:1,100)}${this.number('Warmth (%)','warmth',step.warmth,0,100)}${this.number(this.model().timing?.randomHolds?'Hold min (seconds)':'Hold (seconds)','seconds',step.seconds,this.model().timing?.minimumHoldSeconds||1,3600,0.1)}${this.model().timing?.randomHolds?this.number('Hold max (seconds)','secondsMax',step.secondsMax??step.seconds,0.1,3600,0.1):''}${this.number('Fade (seconds)','fadeSeconds',step.fadeSeconds,0,60,0.1)}</div></section>`).join('');
  },
  field(label,glyph,control) {return `<label class="field"><span class="field-label">${icon(glyph)}${label}</span>${control}</label>`;},
  number(label,name,value,min,max,step=1) {return this.field(label,'sliders',`<input name="${name}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" required>`);},
  edit(id) {
    this.draft=id?structuredClone(this.item(id)):{name:'New animation',enabled:false,spread:true,durationMinutes:0,targets:[],steps:[this.step()]};
    if(!this.draft)return;
    const item=this.draft;
    showDialog(`<form id="lighting-animation-form">${dialogHeader(id?'Edit animation':'New animation')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><div class="field-row">${this.field('Name','tag',`<input name="name" value="${escapeHtml(item.name)}" maxlength="64" required>`)}${this.number('Run for (minutes, 0 = until stopped)','durationMinutes',item.durationMinutes,0,1440)}</div><div class="lighting-options"><label><input type="checkbox" name="enabled" ${item.enabled?'checked':''}>Enabled</label><label><input type="checkbox" name="spread" ${item.spread?'checked':''}>Spread colours across lights</label></div>${this.targets(item.targets)}<div class="panel-header"><h2>Sequence</h2><button type="button" class="button" data-action="lighting-step-add">${icon('plus')}Add step</button></div><p class="field-help">Steps loop in order. Colour applies to RGB bulbs; Warmth applies to white bulbs (0 cool, 100 warm). Hold follows command delivery; Fade must fit within the minimum hold. A larger maximum chooses a random hold on each pass. Brightness 0 turns the light off. Gateway latency and the number of lights can slow fast sequences.</p><div id="lighting-steps">${this.rows()}</div></div>${dialogFooter()}</form>`,{kind:'lighting',id:item.id||null,revision:item.revision});
  },
  readDraft() {
    const form=dialog.querySelector('#lighting-animation-form');if(!form)return this.draft;
    const value=name=>form.elements.namedItem(name).value;
    return {...this.draft,name:value('name'),durationMinutes:Number(value('durationMinutes')),
      enabled:form.elements.namedItem('enabled').checked,spread:form.elements.namedItem('spread').checked,
      targets:[...form.querySelectorAll('[data-lighting-target]:checked')].map(input=>input.value),
      steps:[...form.querySelectorAll('[data-lighting-step]')].map(row=>({id:row.dataset.lightingStep,
        enabled:row.querySelector('[name="stepEnabled"]').checked,color:row.querySelector('[name="color"]').value,
        ...Object.fromEntries(['brightness','warmth','seconds','fadeSeconds',...(row.querySelector('[name="secondsMax"]')?['secondsMax']:[])].map(name=>[name,Number(row.querySelector(`[name="${name}"]`).value)]))}))};
  },
  startDialog(id) {
    const item=this.item(id);if(!item)return;
    showDialog(`<form id="lighting-start-form">${dialogHeader('Start '+item.name)}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>${item.steps.some(step=>step.enabled&&step.seconds<1)?'<p class="form-error" role="note">Flashing lights. Avoid use around anyone sensitive to flashing light.</p>':''}${this.targets(item.targets)}${this.number('Run for (minutes, 0 = until stopped)','durationMinutes',item.durationMinutes,0,1440)}<p class="field-help">Selected lights turn on. The sequence runs on the server until stopped or its duration ends. Stop keeps the last requested lighting values. Fast presets change rapidly.</p></div>${dialogFooter('Start animation')}</form>`,{kind:'lighting-start',id,revision:item.revision,requestId:crypto.randomUUID()});
  },
  async handle(action,id,control) {
    if(action==='lighting-select-all'||action==='lighting-select-none'){
      let count=0;dialog.querySelectorAll('[data-lighting-target]').forEach(input=>{input.checked=action==='lighting-select-all'&&!input.disabled&&count++<10;});return;
    }
    if(action.startsWith('lighting-step-')){
      this.draft=this.readDraft();const steps=this.draft.steps,index=steps.findIndex(step=>step.id===id);
      if(action==='lighting-step-add'&&steps.length<32)steps.push(this.step());
      if(action==='lighting-step-copy'&&index>=0&&steps.length<32)steps.splice(index+1,0,{...steps[index],id:crypto.randomUUID(),enabled:false});
      if(action==='lighting-step-delete'&&index>=0&&steps.length>1)steps.splice(index,1);
      const next=action==='lighting-step-up'?index-1:action==='lighting-step-down'?index+1:-1;
      if(index>=0&&next>=0&&next<steps.length)[steps[index],steps[next]]=[steps[next],steps[index]];
      dialog.querySelector('#lighting-steps').innerHTML=this.rows();
      const destination=steps.find(step=>step.id===id)||steps[Math.min(Math.max(index,0),steps.length-1)];
      dialog.querySelector(`[data-lighting-step="${destination.id}"] input`)?.focus({preventScroll:true});return;
    }
    if(this.pending)return;
    if(action==='lighting-add'||action==='edit-lighting')return this.edit(id);
    if(action==='lighting-start')return this.startDialog(id);
    const item=this.item(id);
    if(action==='delete-lighting')return showDialog(`${dialogHeader('Delete animation')}<div class="dialog-body"><p>Delete ${escapeHtml(item.name)}? An active run of this animation will stop.</p></div><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog">Cancel</button><button type="button" class="button danger" data-action="lighting-confirm-delete" data-id="${id}">Delete</button></div>`,{kind:'lighting-delete',id,revision:item.revision});
    this.pending=true;renderView();
    try {
      if(action==='lighting-stop')await mutate('api/lighting-animations/stop',{runId:id});
      else if(action==='lighting-confirm-delete'){
        await mutate(`api/lighting-animations/${id}/delete`,{revision:dialogContext.revision});closeDialog();
      }else if(action==='copy-lighting'||action==='toggle-lighting')await mutate(`api/lighting-animations/${id}/${action==='copy-lighting'?'copy':'enabled'}`,
        {revision:item.revision,...(action==='toggle-lighting'?{enabled:!item.enabled}:{})});
    }catch(error){notify(error.message);}finally{this.pending=false;renderView();}
  },
  async submit(form) {
    if(this.pending)return;const context=dialogContext;
    const start=form.id==='lighting-start-form';
    const values=start?{revision:context.revision,requestId:context.requestId,
      targets:[...form.querySelectorAll('[data-lighting-target]:checked')].map(input=>input.value),durationMinutes:Number(form.elements.namedItem('durationMinutes').value)}:this.readDraft();
    this.pending=true;const buttons=form.querySelectorAll('button[type="submit"]');buttons.forEach(button=>{button.disabled=true;});
    try {
      await mutate(`api/lighting-animations${context.id?'/'+context.id:''}${start?'/start':''}`,values);
      if(dialogContext===context)closeDialog();notify(start?'Animation started. Reported readings confirm actual lighting.':'Animation saved');
    }catch(error){if(dialogContext===context)showFormError(error.message);}
    finally{this.pending=false;buttons.forEach(button=>{button.disabled=false;});renderView();}
  },
};
document.addEventListener('submit',event=>{
  if(!['lighting-animation-form','lighting-start-form'].includes(event.target.id))return;
  event.preventDefault();void LightingUI.submit(event.target);
});
