/** Theme authoring stays in administration. Each editor saves one complete
 * palette; cancelling never changes the active document or stored settings. */
const ColorThemeUI={
  labels:{canvas:'Page background',surface:'Panels',surfaceMuted:'Inset panels',text:'Primary text',muted:'Secondary text',border:'Borders',accent:'Accent'},
  list(){return config.colorThemes||[];},
  selected(key){return this.list().find(theme=>theme.enabled&&theme.id===config[key]);},
  render(){
    const choice=(key,label)=>`<label class="theme-choice">${label}<select data-color-theme-target="${key}" aria-label="${label}"><option value="">Default colors</option>${this.list().filter(theme=>theme.enabled).map(theme=>`<option value="${escapeHtml(theme.id)}" ${config[key]===theme.id?'selected':''}>${escapeHtml(theme.name)} (${theme.mode})</option>`).join('')}</select></label>`;
    return `<section class="panel settings-group" aria-label="Color themes"><div class="panel-header"><h2>Color themes</h2><button class="button" data-action="color-theme-new" ${this.list().length>=12?'disabled':''}>${icon('plus')}New theme</button></div><div class="panel-body theme-choices">${choice('adminColorTheme','Administrator colors')}${choice('displayColorTheme','Display colors')}<p class="field-help">Choose colors separately for administration and Vistas or browser controls. Cards keep their designed artwork. Controller keeps its own appearance. Up to 12 editable themes; use Default colors to return to the light/dark setting.</p></div>${this.list().map(theme=>`<div class="settings-item"><span class="theme-swatches" aria-hidden="true">${['canvas','surface','accent'].map(key=>`<span style="background:${theme.colors[key]}"></span>`).join('')}</span><div class="settings-text"><h3>${escapeHtml(theme.name)}</h3><p>${theme.mode==='dark'?'Dark':'Light'} base</p></div><div class="item-actions" role="group" aria-label="Actions for ${escapeHtml(theme.name)}">${[['edit','pen'],['copy','copy'],['delete','trash-can']].map(([action,glyph])=>`<button class="icon-button" data-action="color-theme-${action}" data-theme-id="${escapeHtml(theme.id)}" aria-label="${action[0].toUpperCase()+action.slice(1)} ${escapeHtml(theme.name)}" ${action==='copy'&&this.list().length>=12?'disabled':''}>${icon(glyph)}</button>`).join('')}<button class="switch" role="switch" aria-checked="${theme.enabled}" aria-label="${escapeHtml(theme.name)} enabled" data-action="color-theme-enabled" data-theme-id="${escapeHtml(theme.id)}"></button></div></div>`).join('')}</section>`;
  },
  async save(themes){
    const patch={colorThemes:themes};
    for(const key of ['adminColorTheme','displayColorTheme']){
      const theme=themes.find(theme=>theme.enabled&&theme.id===config[key]);
      if(!theme)patch[key]='';else patch[key==='adminColorTheme'?'theme':'displayTheme']=theme.mode;
    }
    await changeSettings(patch);renderView();
  },
  edit(original,copy=false){
    const theme=structuredClone(original||this.list()[0]||{mode:'dark',enabled:true,colors:{canvas:'#15191d',surface:'#1d2228',surfaceMuted:'#232930',text:'#e7ebef',muted:'#a0aab5',border:'#303840',accent:'#66c9ad'}});
    if(!original||copy){theme.id=crypto.randomUUID();theme.name=original?original.name.slice(0,40)+' copy':'New theme';if(!original)theme.enabled=true;}
    const catalogue=JSON.stringify(this.list());
    showDialog(`<form id="color-theme-form">${dialogHeader(original&&!copy?'Edit color theme':'New color theme')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div>${formField('Name','tag',`<input name="name" required maxlength="48" value="${escapeHtml(theme.name)}">`)}${formField('Base appearance','circle-half-stroke',`<select name="mode"><option value="dark" ${theme.mode==='dark'?'selected':''}>Dark</option><option value="light" ${theme.mode==='light'?'selected':''}>Light</option></select>`)}<div class="theme-color-grid">${Object.entries(this.labels).map(([key,label])=>`<label>${label}<input type="color" name="${key}" value="${theme.colors[key]}"></label>`).join('')}</div><div class="theme-preview"><h3>Preview panel</h3><p>Secondary text and borders</p><span>Accent</span></div><p class="field-help" data-theme-contrast role="status"></p></div>${dialogFooter()}</form>`,{kind:'color-theme'});
    const form=dialog.querySelector('form'),preview=form.querySelector('.theme-preview');
    const read=()=>Object.fromEntries(Object.keys(this.labels).map(key=>[key,form.elements[key].value]));
    const update=()=>{const c=read();preview.style.background=c.surface;preview.style.color=c.text;preview.style.borderColor=c.border;preview.querySelector('p').style.color=c.muted;preview.querySelector('span').style.color=c.accent;const ratio=Math.min(ColorThemes.contrast(c.text,c.surface),ColorThemes.contrast(c.text,c.canvas));form.querySelector('[data-theme-contrast]').textContent=`Primary text contrast: ${ratio.toFixed(1)}:1${ratio<4.5?' · Low contrast; choose more distinct text and background colors.':' · Good contrast.'}`;};
    form.addEventListener('input',update);update();
    form.addEventListener('submit',async event=>{
      event.preventDefault();const button=form.querySelector('[type="submit"]');button.disabled=true;
      try{
        if(JSON.stringify(this.list())!==catalogue)throw Error('Themes changed while this editor was open. Reopen it before saving.');
        theme.name=form.elements.name.value.trim();theme.mode=form.elements.mode.value;theme.colors=read();
        const themes=structuredClone(this.list()),index=themes.findIndex(row=>row.id===theme.id);
        if(index<0)themes.push(theme);else themes[index]=theme;
        await this.save(themes);closeDialog();notify('Color theme saved');
      }catch(error){button.disabled=false;showFormError(error.message);}
    });
  },
};
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action^="color-theme-"]');if(!button)return;
  const action=button.dataset.action.slice(12),theme=ColorThemeUI.list().find(theme=>theme.id===button.dataset.themeId);
  try{
    if(action==='new')return ColorThemeUI.edit();
    if(!theme)return;
    if(action==='edit'||action==='copy')return ColorThemeUI.edit(theme,action==='copy');
    if(action==='delete'){
      showDialog(`<form id="color-theme-delete-form">${dialogHeader('Delete color theme')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><p>Delete ${escapeHtml(theme.name)}? Views using it will return to default colors.</p></div>${dialogFooter('Delete theme')}</form>`,{kind:'color-theme-delete'});
      dialog.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const submit=event.target.querySelector('[type="submit"]');submit.disabled=true;try{await ColorThemeUI.save(ColorThemeUI.list().filter(row=>row.id!==theme.id));closeDialog();}catch(error){submit.disabled=false;showFormError(error.message);}});return;
    }
    const themes=structuredClone(ColorThemeUI.list());
    if(action==='enabled')themes.find(row=>row.id===theme.id).enabled=!theme.enabled;
    await ColorThemeUI.save(action==='delete'?themes.filter(row=>row.id!==theme.id):themes);
  }catch(error){notify(error.message,'error');}
});
document.addEventListener('change',async event=>{
  const key=event.target.dataset.colorThemeTarget;if(!['adminColorTheme','displayColorTheme'].includes(key))return;
  try{const value=event.target.value,theme=ColorThemeUI.list().find(theme=>theme.id===value);await changeSettings({[key]:value,...(theme?{[key==='adminColorTheme'?'theme':'displayTheme']:theme.mode}:{})});renderView();}catch(error){notify(error.message,'error');}
});
