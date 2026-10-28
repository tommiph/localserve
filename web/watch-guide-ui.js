/** Watch guides use explicit saved choices and ordinary revisioned plugin actions. */
const WatchGuideUI={
  pending:false,movieView:'daily',
  genreSetting(service,field){
    const legacy=service.id==='movies'?'genre':service.id==='tv-calendar'?'pick-genre':null;
    if(!legacy&&service.id!=='emby')return null;
    if(field.id===legacy)return `<input type="hidden" name="${field.id}" value="${escapeHtml(service.config.settings[field.id]??field.default??'')}">`;
    const key=service.id==='emby'?'library-genres':service.id==='movies'?'genres':'pick-genres';if(field.id!==key)return null;
    const original=legacy?service.settings.find(item=>item.id===legacy):{enum:field.suggestions.map(choice=>choice.value),enumLabels:field.suggestions.map(choice=>choice.label)},value=service.config.settings[key]??service.config.settings[legacy]??'',selected=value?value.split(','):[],id='plugin-setting-'+key;
    return `<fieldset class="watch-genre-settings" data-watch-genres="${key}"><legend>${icon('category')}Preferred genres</legend><input type="hidden" id="${id}" name="${key}" value="${escapeHtml(value)}"><div class="watch-genre-options"><label class="check-field watch-genre-choice"><input id="${id}-all" type="checkbox" data-watch-genre="" ${selected.length?'':'checked'}><span>All genres</span></label>${original.enum.filter(Boolean).map(choice=>`<label class="check-field watch-genre-choice"><input id="${id}-${escapeHtml(choice)}" type="checkbox" data-watch-genre="${escapeHtml(choice)}" ${selected.includes(choice)?'checked':''}><span>${escapeHtml(original.enumLabels?.[original.enum.indexOf(choice)]||choice)}</span></label>`).join('')}</div><p class="field-help">Suggestions can match any selected genre. All genres removes the filter.</p></fieldset>`;
  },
  syncGenres(control){
    const group=control.closest('[data-watch-genres]');if(!group)return;
    const choices=[...group.querySelectorAll('[data-watch-genre]')],all=choices.find(item=>item.dataset.watchGenre==='');
    if(control===all&&all.checked)for(const choice of choices)if(choice!==all)choice.checked=false;
    const selected=choices.filter(item=>item.dataset.watchGenre&&item.checked).map(item=>item.dataset.watchGenre);
    all.checked=selected.length===0;group.querySelector('input[type="hidden"]').value=selected.join(',');
  },
  ready(service){return service.enabled&&service.configurationReady&&service.health==='ready'&&!state.paused;},
  itemLink(item,service){
    try{const url=new URL(item.url);if(service.id==='emby'&&/^127\./.test(url.hostname)){
      const host=location.hostname,parts=host.split('.').map(Number),[a,b]=parts;
      if(parts.length===4&&parts.every(value=>Number.isInteger(value)&&value>=0&&value<=255)&&(a===10||a===192&&b===168||a===172&&b>=16&&b<=31))url.hostname=host;
    }return url.href;}catch{return item.url;}
  },
  pickCard(item,service,tv=false){
    const library=Array.isArray(service.pluginState?.library)?service.pluginState.library:[],entry=library.find(movie=>movie.id===item.id),followed=tv&&service.config.settings.shows.some(show=>show['tvmaze-id']===item.id);
    const actions=service.id==='emby'?'':tv?`<button type="button" class="button primary" data-action="watch-tv-follow" data-id="${escapeHtml(item.id)}" ${!this.ready(service)||this.pending||followed?'disabled':''}>${icon(followed?'check':'add')}${followed?'Following':'Follow'}</button>`:
      `<button type="button" class="button ${entry?.saved?'':'primary'}" data-action="watch-movie-${entry?.saved?'remove':'save'}" data-id="${escapeHtml(item.id)}" ${!this.ready(service)||this.pending?'disabled':''}>${icon(entry?.saved?'bookmark-remove':'bookmark-add')}${entry?.saved?'Remove from Watchlist':'Save'}</button><button type="button" class="button" data-action="watch-movie-${entry?.watched?'unwatched':'watched'}" data-id="${escapeHtml(item.id)}" ${!this.ready(service)||this.pending?'disabled':''}>${icon(entry?.watched?'undo':'check')}${entry?.watched?'Mark unwatched':'Watched'}</button>`;
    return `<article class="panel watch-pick" data-live-key="watch-pick:${service.id}:${escapeHtml(item.id)}"><div class="panel-body"><div class="watch-pick-art" aria-hidden="true">${icon(tv?'live-tv':'movie-filter')}</div><p class="watch-pick-meta">${escapeHtml([tv?item.premiered?.slice(0,4):item.year,...(item.genres||[])].filter(Boolean).join(' · '))}</p><h3>${escapeHtml(item.title||item.name)}</h3><p class="watch-pick-description">${escapeHtml(item.summary)}</p><p class="field-help">${escapeHtml(tv?item.network:item.source)}${tv?' · '+escapeHtml(item.status||''):''}${item.releaseDate?' · Release '+escapeHtml(item.releaseDate):''}</p><div class="watch-pick-actions">${actions}<a class="button" href="${escapeHtml(this.itemLink(item,service))}" target="_blank" rel="noopener noreferrer">${icon('open-in-new')}${service.id==='emby'?'Open in Emby':'Details'}</a></div></div></article>`;
  },
  renderEmby(service){
    const picks=service.pluginState?.libraryPicks||[],note=service.pluginState?.['library-note']||'Enable library suggestions in Emby Settings, then refresh the library.',status=service.pluginState?.['library-poll-status']||'Waiting for library';
    return `<section class="panel"><div class="panel-header"><h2>From your Emby library</h2><div class="heading-actions"><button type="button" class="button" data-action="watch-cards" data-id="emby">${icon('dashboard')}Create Card</button><button type="button" class="button" data-action="watch-emby-refresh" ${!this.ready(service)||this.pending||!service.config.settings['library-suggestions']?'disabled':''}>${icon('refresh')}Refresh library</button></div></div><div class="panel-body"><p>${escapeHtml(note)}</p><p class="field-help">${escapeHtml(status)} · Metadata and genre preferences use Emby Settings. Open a movie in Emby to choose how to play it.</p></div></section><div class="watch-pick-grid">${picks.map(item=>this.pickCard(item,service)).join('')||'<section class="panel"><div class="panel-body empty-state">No movie suggestions in this selection. Configure Emby, enable library suggestions or choose other genres.</div></section>'}</div>`;
  },
  embySection(){const service=state.services.find(item=>item.id==='emby');return service?.enabled&&service.config.settings['library-suggestions']?this.renderEmby(service):'';},
  async refreshEmby(){
    if(this.pending)return;this.pending=true;let failure='';const service=state.services.find(item=>item.id==='emby');
    document.querySelectorAll('[data-action="watch-emby-refresh"]').forEach(button=>{button.disabled=true;});
    try{await mutate('api/plugins/emby/actions/refresh-library',{revision:service.config.revision,parameters:{}});}catch(error){failure=error.message;}
    finally{this.pending=false;if(['movies','emby'].includes(currentView)){PluginUI.render(state.services.find(item=>item.id===currentView));if(failure)PluginUI.showError(failure);}}
  },
  renderTv(service){
    const picks=service.pluginState?.dailyPicks||[];
    const upcoming=TVCalendarUI.rows(service).filter(row=>!row.watched&&row.at!==null&&row.at>=(state.server.now||Date.now())).slice(0,4);
    return `<section class="panel"><div class="panel-header"><h2>Daily TV suggestions</h2><div class="heading-actions"><button type="button" class="button" data-action="watch-cards" data-id="tv-calendar">${icon('dashboard')}Create Card</button><button type="button" class="button" data-action="watch-refresh" data-id="tv-calendar" ${!this.ready(service)||this.pending?'disabled':''}>${icon('refresh')}Refresh guide</button></div></div><div class="panel-body"><p>Four discovery picks for ${escapeHtml(service.pluginState?.['pick-day']||'today')}. Follow a show to add its episodes to your calendar.</p><p class="field-help">${escapeHtml(service.pluginState?.['pick-status']||'Enable TV Calendar in Settings to build the guide.')} Genres and completed-series preferences are in Settings.</p></div></section><div class="watch-pick-grid">${picks.map(item=>this.pickCard(item,service,true)).join('')||'<section class="panel"><div class="panel-body empty-state">No new suggestions in this selection. Try another genre or use Discover shows.</div></section>'}</div><section class="panel"><div class="panel-header"><h2>Next from your shows</h2></div><div class="panel-body">${upcoming.length?upcoming.map(row=>`<div class="tvcal-agenda-row">${TVCalendarUI.episodeButton(row)}<time>${escapeHtml(formatServerTimestamp(row.at))}</time></div>`).join(''):'<p>No upcoming unwatched episodes are currently listed. Follow a show or refresh its listings.</p>'}</div></section>`;
  },
  renderMovies(service){
    const saved=(service.pluginState?.library||[]),rows=this.movieView==='saved'?saved.filter(movie=>movie.saved&&!movie.watched):this.movieView==='watched'?saved.filter(movie=>movie.watched):service.pluginState?.dailyPicks||[];
    const html=`<section class="panel"><div class="panel-header"><h2>Movie guide</h2><div class="heading-actions"><button type="button" class="button" data-action="watch-cards" data-id="movies">${icon('dashboard')}Create Card</button><button type="button" class="button" data-action="watch-movie-search" ${!this.ready(service)?'disabled':''}>${icon('search')}Find movies</button><button type="button" class="button" data-action="watch-refresh" data-id="movies" ${!this.ready(service)||this.pending?'disabled':''}>${icon('refresh')}Refresh guide</button></div></div><div class="panel-body"><div class="home-mode-buttons" role="group" aria-label="Movie collection">${[['daily','Daily picks'],['saved','Watchlist'],['watched','Watched']].map(([id,label])=>`<button type="button" class="button ${id===this.movieView?'primary':''}" aria-pressed="${id===this.movieView}" data-action="watch-movie-view" data-id="${id}">${label}</button>`).join('')}</div><p class="field-help">${escapeHtml(service.pluginState?.['pick-status']||'Enable Movies in Settings to get started. The starter collection needs no account.')} · Streaming subscription availability is not checked. Choose genres or an optional live source in Settings.</p></div></section><div class="watch-pick-grid">${rows.map(item=>this.pickCard(item,service)).join('')||'<section class="panel"><div class="panel-body empty-state">No movies here yet. Try another genre, find a movie or save a daily pick.</div></section>'}</div><p class="field-help"><img src="assets/interests/tmdb.svg" width="70" alt="TMDB" class="watch-tmdb">Optional live data: This product uses the TMDB API but is not endorsed or certified by TMDB. Starter descriptions are Sormus editorial suggestions.</p>`;
    return html+(this.movieView==='daily'?this.embySection():'');
  },
  async followTv(id){
    if(this.pending)return;const service=state.services.find(service=>service.id==='tv-calendar'),item=service.pluginState?.dailyPicks?.find(show=>show.id===id);
    if(!item||service.config.settings.shows.some(show=>show['tvmaze-id']===id))return;
    const field=service.settings.find(field=>field.id==='shows');if(service.config.settings.shows.length>=field.maxItems)return PluginUI.showError('Your followed-show list is full. Remove a show first.');
    const settings={...structuredClone(service.config.settings),shows:[...structuredClone(service.config.settings.shows),{...PluginUI.newItem(field),name:item.name.slice(0,32),'tvmaze-id':id,enabled:true}]};
    this.pending=true;PluginUI.render(service);let failure='';
    try{await mutate('api/plugins/tv-calendar/config',{revision:service.config.revision,settings});notify('Following '+item.name);}
    catch(error){failure=error.message;}
    finally{this.pending=false;if(currentView==='tv-calendar'){PluginUI.render(state.services.find(service=>service.id==='tv-calendar'));if(failure)PluginUI.showError(failure);}}
  },
  openMovieSearch(){
    const service=state.services.find(service=>service.id==='movies');
    showDialog(`<form id="watch-movie-search-form">${dialogHeader('Find movies')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><label class="field"><span class="field-label">${icon('search')}Movie title</span><input name="query" type="search" minlength="2" maxlength="100" placeholder="Browse below or search for a film"></label><p class="field-help">Browse the current collection below. Without a TMDB token, title search uses the starter collection. Add a token in Movies Settings for the full catalogue.</p><button type="submit" class="button primary">Search</button><div class="source-lookup-results" aria-live="polite"></div></div><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog">Close</button></div></form>`,{kind:'watch-movie-search',revision:service.config.revision});
    void this.searchMovies(dialog.querySelector('#watch-movie-search-form'));
  },
  async searchMovies(form){
    if(this.pending)return;const context=dialogContext,service=state.services.find(service=>service.id==='movies');this.pending=true;const button=form.querySelector('[type="submit"]');button.disabled=true;
    try{const reply=await mutate('api/plugins/movies/actions/search',{revision:context.revision,parameters:{query:form.elements.namedItem('query').value}});if(dialogContext!==context||!form.isConnected)return;
      form.querySelector('.source-lookup-results').innerHTML=`<p class="field-help">${reply.result.scope==='starter'?'Starter collection':'TMDB movie catalogue'}</p>`+(reply.result.matches.length?reply.result.matches.map(item=>this.pickCard(item,state.services.find(service=>service.id==='movies'))).join(''):'<p>No movies match this selection. Try a title search or another genre in Settings.</p>');
    }catch(error){if(dialogContext===context)showFormError(error.message);}finally{this.pending=false;if(button.isConnected)button.disabled=false;if(dialogContext===context)form.querySelectorAll('.watch-pick-actions button').forEach(control=>{control.disabled=!this.ready(state.services.find(service=>service.id==='movies'));});}
  },
  async handle(action,id){
    if(action==='watch-emby-refresh')return this.refreshEmby();
    if(action==='watch-tv-follow')return this.followTv(id);
    const service=state.services.find(service=>service.id===(action==='watch-cards'||action==='watch-refresh'?id:'movies'));
    if(action==='watch-cards'){
      const preferred=service.id==='emby'?'library-movies':service.id==='movies'?'daily-movies':'daily-tv',metadata=service.cardData.readyMade;
      return CardDesigner.openReadyMade({...service,cardData:{...service.cardData,readyMade:{...metadata,templates:[...metadata.templates].sort((a,b)=>Number(b.id===preferred)-Number(a.id===preferred))}}});
    }
    if(action==='watch-movie-view'){this.movieView=id;return PluginUI.render(service);}
    if(action==='watch-movie-search')return this.openMovieSearch();
    if(this.pending)return;this.pending=true;const context=dialogContext;let failure='';
    if(context?.kind==='watch-movie-search')dialog.querySelectorAll('.watch-pick-actions button').forEach(control=>{control.disabled=true;});
    else document.querySelector('#workspace')?.querySelectorAll('.watch-pick-actions button').forEach(control=>{control.disabled=true;});
    if(dialog.open){const error=dialog.querySelector('#form-error');if(error)error.hidden=true;}
    try{
      if(action==='watch-refresh')await mutate(`api/plugins/${id}/actions/${id==='movies'?'refresh-catalogue':'refresh'}`,{revision:service.config.revision,parameters:{}});
      else await mutate('api/plugins/movies/actions/library',{revision:service.config.revision,parameters:{'movie-id':id,operation:action.slice('watch-movie-'.length)}});
      if(context?.kind==='watch-movie-search'&&dialogContext===context){const title=action.endsWith('-save')?'Saved':action.endsWith('-watched')?'Watched':'Updated';notify(title);}
    }catch(error){failure=error.message;}
    finally{
      this.pending=false;
      if(context?.kind==='watch-movie-search'&&dialogContext===context){
        const library=state.services.find(item=>item.id==='movies').pluginState?.library||[];
        for(const control of dialog.querySelectorAll('.watch-pick-actions button')){
          const entry=library.find(movie=>movie.id===control.dataset.id),save=/-(save|remove)$/.test(control.dataset.action),active=save?entry?.saved:entry?.watched;
          control.dataset.action='watch-movie-'+(save?active?'remove':'save':active?'unwatched':'watched');
          control.innerHTML=icon(save?active?'bookmark-remove':'bookmark-add':active?'undo':'check')+(save?active?'Remove from Watchlist':'Save':active?'Mark unwatched':'Watched');control.disabled=!this.ready(state.services.find(service=>service.id==='movies'));
        }
        if(failure)showFormError(failure);
      }else if(!dialog.open&&currentView===service.id){PluginUI.render(state.services.find(item=>item.id===service.id));if(failure)PluginUI.showError(failure);}
    }
  },
};
