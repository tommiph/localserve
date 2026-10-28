/** Administrator mode definitions use the ordinary revisioned list editor. */
const HomeModesUI={
  pending:false,
  newId(){
    // getRandomValues also works when the administrator is opened over LAN HTTP.
    const bytes=crypto.getRandomValues(new Uint8Array(16));
    return 'mode-'+Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
  },
  async examples(){
    if(this.pending)return;
    const service=state.services.find(service=>service.id===currentView&&service.modeSelector);
    if(!service||service.config.settings.modes.length)return;
    const modes=[['home','Home','home','#69bda7'],['away','Away','door-open','#dbb06d'],['evening','Evening','sun','#c99cd8'],['night','Night','moon','#8fa5dd']]
      .map(([,name,icon,color])=>({id:this.newId(),name,icon,color,'task-id':'',enabled:true}));
    this.pending=true;renderView();
    try{await mutate(`api/plugins/${service.id}/config`,{revision:service.config.revision,settings:{...service.config.settings,modes}});}
    finally{this.pending=false;renderView();}
  },
  summary(mode){const task=(state.tasks||[]).find(task=>task.id===mode['task-id']);return mode['task-id']?`On entry: ${task?.name||'Unavailable Task'}${task&&!task.enabled?' (Disabled)':''}`:'No Task on entry';},
  render(service){
    const modes=service.config.settings.modes || [];
    const active=modes.find(mode=>mode.enabled&&mode.id===service.pluginState?.['mode-id']);
    const ready=service.enabled&&service.configurationReady&&service.health==='ready'&&!state.paused;
    const choices=modes.filter(mode=>mode.enabled).map(mode=>`<button type="button" class="button mode-choice"
      style="--mode-color:${/^#[a-f0-9]{6}$/i.test(mode.color)?mode.color:'#69bda7'}"
      data-action="home-mode-select" data-id="${escapeHtml(mode.id)}" aria-pressed="${mode.id===active?.id}"
      ${!ready||this.pending||mode.id===active?.id?'disabled':''}>${icon(mode.icon)}${escapeHtml(mode.name)}${mode.id===active?.id?icon('check'):''}</button>`).join('');
    return `<section class="panel"><div class="panel-header"><h2>Current mode</h2></div><div class="panel-body">
      <div class="home-mode-buttons">${choices || '<p>No enabled modes. Add or enable a mode below.</p>'}</div>
      ${!modes.length?'<button type="button" class="button" data-action="home-mode-examples">Add example modes</button>':''}
      <p>${active?`Current: <strong>${escapeHtml(active.name)}</strong>`:'No mode selected.'}</p>
      <p class="field-help">Choose a mode to run its assigned Task once. Selecting the active mode or restarting the server does not replay it.
      ${ready?'':'Enable this plugin and server functions to select a mode.'}</p>
      </div></section>${PluginUI.list(service,service.settings.find(field=>field.id==='modes'))}
      <section class="panel"><div class="panel-body"><h3>Use modes in Tasks</h3>
      <p>Add Select home mode as an action, or use the Home mode Event and compare Mode ID or Mode name.
      For AND rules, the current mode can be combined with another condition even after a restart.</p>
      <p>Task on entry runs as an automatic Task and respects TV Do not disturb. A failed Task does not undo the selected mode.
      Review its run in Tasks or Activity.</p></div></section>`;
  },
  field(field,value){
    const e=escapeHtml;
    if(field.id==='color')return formField(field.label,'palette',`<input class="mode-color-picker" type="color" name="color" value="${/^#[a-f0-9]{6}$/i.test(value)?value:'#69bda7'}" aria-label="Mode color">`);
    if(field.id==='icon')return `<details class="scene-glyph-picker"><summary><span data-mode-symbol>${icon(value)}</span> Mode symbol</summary>
      <input type="hidden" name="icon" value="${e(value)}"><label class="field"><span class="field-label">Find a symbol</span>
      <input type="search" data-mode-symbol-search placeholder="Search symbols"></label><div class="glyph-grid scene-glyph-choices" data-mode-symbols aria-label="Mode symbols"></div></details>`;
    if(field.id==='task-id'){
      const tasks=state.tasks || [],missing=value&&!tasks.some(task=>task.id===value);
      return formField(field.label,'list-check',`<select name="task-id"><option value="">No Task</option>${missing?`<option value="${e(value)}" selected>Unavailable Task</option>`:''}${tasks.map(task=>`<option value="${e(task.id)}" ${task.id===value?'selected':''}>${e(task.name)}${task.enabled?'':' (Disabled)'}</option>`).join('')}</select><p class="field-help">Optional. Enabled modes appear in Controller, Control room and Launcher; assigning a Task makes it callable through this mode. Runs on entry only; automatic start rules are bypassed. Enable the Task before using it. To use mode Event values, declare the Home mode Event in that Task's rules.</p>`);
    }
    return PluginUI.field(field,value,'mode');
  },
  bind(form){
    const input=form.elements.namedItem('icon'),search=form.querySelector('[data-mode-symbol-search]'),grid=form.querySelector('[data-mode-symbols]');
    if(!input||!search||!grid)return;
    const paint=()=>{
      const query=search.value.trim().toLowerCase().replaceAll(' ','-');
      const names=(state.pluginGlyphs||[]).filter(name=>name.includes(query)).slice(0,96);
      grid.replaceChildren();
      for(const name of names){
        const button=document.createElement('button');button.type='button';button.className='glyph-choice';
        button.setAttribute('aria-label','Use '+name+' symbol');button.setAttribute('aria-pressed',String(input.value===name));button.title=name.replaceAll('-',' ');button.innerHTML=icon(name);
        button.onclick=()=>{input.value=name;form.querySelector('[data-mode-symbol]').innerHTML=icon(name);paint();updateDraftStatus();};grid.append(button);
      }
      if(!names.length)grid.textContent='No symbols found.';
    };
    search.oninput=paint;paint();
  },
  async select(id){
    if(this.pending)return;const service=state.services.find(service=>service.id===currentView&&service.modeSelector);if(!service)return;
    this.pending=true;renderView();
    try{const reply=await mutate(`api/plugins/${service.id}/actions/select-mode`,{revision:service.config.revision,parameters:{'mode-id':id}});notify(reply.result?.taskStatus==='not-started'?'Mode selected. Assigned Task did not start; check Activity.':'Home mode selected.');}
    finally{this.pending=false;renderView();}
  },
};
