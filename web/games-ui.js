/** Administrator game preferences and explicit local/TV launch controls. */
const GamesUI={
  pending:false,
  render(){
    const value=state.games;if(!value)return pageHeading('Games','Server-hosted games')+'<p>Restart Sormus to load Games.</p>';
    return pageHeading('Games','Server-hosted games')+`<section class="panel game-admin"><div class="game-cover" aria-hidden="true"><div class="game-cover-sun"></div><span>NEON<br>LABYRINTH</span></div><div class="panel-body"><div class="panel-header"><h2>Neon Labyrinth</h2>${statusPill(value.enabled?'Enabled':'Disabled',value.enabled?'running':'paused')}</div><p>First-person mazes. Find the exit, collect gems and earn a speed bonus. Each completed maze opens a larger one.</p><div class="heading-actions"><a class="button primary" href="/games/maze" target="_blank" rel="noopener" ${value.enabled?'':'hidden'}>${icon('play')}Play locally</a><button class="button" data-action="game-tv" ${value.enabled&&value.tvAvailable&&!state.paused&&!this.pending?'':'disabled'}>${icon('display')}Start on TV</button><button class="button" data-action="game-edit">${icon('pen')}Edit</button><button class="switch" role="switch" aria-label="Neon Labyrinth enabled" aria-checked="${value.enabled}" data-action="game-toggle"></button></div><p class="field-help">${this.pending?'Sending to TV…':!value.tvAvailable?escapeHtml(value.tvReason):state.paused?'Enable server functions to launch on TV.':'TV launch requires the TV to be on with the Vista Tizen app installed. Delivery does not confirm display.'}</p><dl class="facts"><div><dt>Maze growth</dt><dd>${value.startSize} × ${value.startSize}, +${value.growth} rooms per side each level</dd></div><div><dt>Gems</dt><dd>Up to ${value.gemCount} · ${value.gemPoints} points each</dd></div><div><dt>Detail</dt><dd>${escapeHtml(value.detail)}</dd></div><div><dt>Music</dt><dd>${value.musicUrl?escapeHtml(value.musicUrl):'Not configured'}</dd></div></dl><p class="field-help">Up/Down walk · Left/Right turn · Enter start/pause · Back pause. Browser keyboard: arrows or WASD. Display URL: <a href="/games/maze" target="_blank" rel="noopener">/games/maze</a>. Settings apply when a game page loads. Best scores stay in each browser.</p></div></section>`;
  },
  edit(){
    const {tvAvailable,tvReason,...value}=state.games;
    const number=(name,label,min,max,help='')=>formField(label,'sliders',`<input name="${name}" type="number" min="${min}" max="${max}" step="1" required value="${value[name]}">`,help);
    showDialog(`<form id="game-settings-form">${dialogHeader('Edit Neon Labyrinth')}<div class="dialog-body"><div id="form-error" class="form-error" hidden role="alert"></div><div class="field-row">${number('startSize','Starting rooms per side',3,25)}${number('growth','Added rooms per side each level',1,10)}</div><div class="field-row">${number('gemCount','Gems per maze',0,64)}${number('gemPoints','Points per gem',1,10000)}</div><div class="field-row">${number('speedPoints','Speed bonus base',1,100000)}${number('paceSeconds','Par seconds per room',1,30,'Bonus = base × level ÷ (1 + active seconds ÷ par time). Par time = rooms² × this value.')}</div><div class="field-row">${number('moveMs','Walking step duration (ms)',120,800)}${formField('Rendering detail','eye',`<select name="detail">${['low','medium','high'].map(detail=>`<option ${detail===value.detail?'selected':''}>${detail}</option>`).join('')}</select>`,'Low renders at up to 960 pixels and 30 fps for TV performance.')}</div>${formField('Looping music file','music-note',`<input name="musicUrl" maxlength="240" value="${escapeHtml(value.musicUrl)}" placeholder="/assets/games/music/maze.mp3">`,'Optional local MP3, OGG, WAV or M4A under assets/games/music/. Keep it under 12 MiB. No music is bundled.')}${number('musicVolume','Music volume (%)',0,100)}</div>${dialogFooter()}</form>`,{kind:'game-settings',revision:value.revision,enabled:value.enabled});
  },
  async action(action){
    if(this.pending)return;
    if(action==='game-edit'){this.edit();return;}
    this.pending=true;renderView();
    try{
      if(action==='game-tv'){await request('api/games/maze/open-on-tv',{revision:state.games.revision});notify('Game sent to the TV. Check its display.');}
      if(action==='game-toggle'){const {tvAvailable,tvReason,...value}=state.games;await mutate('api/games/maze',{...value,enabled:!value.enabled});}
    }catch(error){notify(error.message+(action==='game-tv'?' No launch was retried.':''));}
    finally{this.pending=false;renderView();}
  },
};
document.addEventListener('submit',async event=>{
  if(event.target.id!=='game-settings-form')return;event.preventDefault();
  const context=dialogContext,values=Object.fromEntries(new FormData(event.target));
  for(const key of ['startSize','growth','gemCount','gemPoints','speedPoints','paceSeconds','moveMs','musicVolume'])values[key]=Number(values[key]);
  try{await mutate('api/games/maze',{schemaVersion:1,revision:context.revision,enabled:context.enabled,...values});if(dialogContext===context)closeDialog();}
  catch(error){if(dialogContext===context)showFormError(error.message);}
});
