/** Calendar dates use the server timezone; watched state is committed by the plugin. */
const TVCalendarUI={
  view:'picks',month:'',offset:0,pending:false,
  service(){return state.services.find(service=>service.id==='tv-calendar');},
  dateKey(at){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:state.server.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));
    const get=key=>parts.find(part=>part.type===key).value;return `${get('year')}-${get('month')}-${get('day')}`;
  },
  rows(service){
    const active=new Set(service.config.settings.shows.filter(show=>show.enabled).map(show=>show['tvmaze-id']));
    const watched=new Set(service.pluginState?.watched||[]);
    return Object.values(service.pluginState?.shows||{}).filter(show=>active.has(show.id)).flatMap(show=>(show.episodes||[]).map(episode=>({...episode,show:show.name,network:show.network,watched:watched.has(episode.id)}))).sort((a,b)=>(a.at??Infinity)-(b.at??Infinity)||Number(a.id)-Number(b.id));
  },
  episodeButton(row){return `<button type="button" class="tvcal-episode ${row.watched?'is-watched':''}" data-action="tvcal-episode" data-id="${row.id}" title="${escapeHtml(row.show+' — '+row.title)}">${icon(row.watched?'check-circle':'live-tv')}<span><strong>${escapeHtml(row.show)}</strong><small>S${row.season}E${row.number} · ${escapeHtml(row.title)}</small></span></button>`;},
  render(service){
    if(!this.month)this.month=this.dateKey(state.server.now||Date.now()).slice(0,7);
    const rows=this.rows(service),ready=service.enabled&&service.configurationReady&&service.health==='ready'&&!state.paused;
    const tabs=[['picks','For you','auto-awesome'],['month','Month','calendar-month'],['agenda','Agenda','list'],['shows','Shows','live-tv']];
    const toolbar=`<div class="tvcal-toolbar"><div class="tvcal-views" role="group" aria-label="Calendar view">${tabs.map(([id,label,glyph])=>`<button type="button" class="button ${this.view===id?'primary':''}" aria-pressed="${this.view===id}" data-action="tvcal-view" data-id="${id}">${icon(glyph)}${label}</button>`).join('')}</div><button type="button" class="button primary" data-action="tvcal-search" ${!ready?'disabled':''}>${icon('search')}Discover shows</button></div>`;
    const note=`<p class="field-help">Original air/release dates in the server timezone. Availability on your local streaming service may differ. ${ready?'':'Enable the plugin and server functions in Settings to search or update.'}</p>`;
    const attribution=`<p class="tvcal-credit">Listings provided by <a href="https://www.tvmaze.com" target="_blank" rel="noopener noreferrer">TVmaze</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA</a></p>`;
    let content='';
    if(this.view==='picks')content=WatchGuideUI.renderTv(service);
    else if(this.view==='shows')content=PluginUI.list(service,service.settings.find(field=>field.id==='shows'))+this.showCache(service,ready);
    else if(this.view==='agenda'){
      const page=rows.slice(this.offset,this.offset+50);
      content=`<section class="panel"><div class="panel-header"><h2>Episode agenda</h2><div class="tvcal-views"><button class="button" type="button" data-action="tvcal-page" data-id="-1" ${!this.offset?'disabled':''}>Previous</button><button class="button" type="button" data-action="tvcal-page" data-id="1" ${this.offset+50>=rows.length?'disabled':''}>Next</button></div></div><div class="panel-body">${page.length?page.map(row=>`<div class="tvcal-agenda-row">${this.episodeButton(row)}<time>${row.at?escapeHtml(formatServerTimestamp(row.at)):escapeHtml(row.date||'Time not announced')}</time></div>`).join(''):'<p class="empty-state">No cached episodes. Follow a show to get started.</p>'}</div></section>`;
    }else{
      const [year,month]=this.month.split('-').map(Number),first=new Date(Date.UTC(year,month-1,1)),start=first.getTime()-((first.getUTCDay()+6)%7)*86400000;
      const heading=first.toLocaleDateString(undefined,{month:'long',year:'numeric',timeZone:'UTC'}),today=this.dateKey(state.server.now||Date.now()),groups=new Map();
      for(const row of rows){const key=row.at?this.dateKey(row.at):row.date;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
      const weekdays=Array.from({length:7},(_,i)=>new Date(Date.UTC(2024,0,1+i)).toLocaleDateString(undefined,{weekday:'short',timeZone:'UTC'}));
      content=`<section class="panel"><div class="panel-header"><h2>${escapeHtml(heading)}</h2><div class="tvcal-views"><button type="button" class="button" data-action="tvcal-month" data-id="-1" aria-label="Previous month">${icon('chevron-left')}</button><button type="button" class="button" data-action="tvcal-today">Today</button><button type="button" class="button" data-action="tvcal-month" data-id="1" aria-label="Next month">${icon('chevron-right')}</button></div></div><div class="tvcal-scroll"><div class="tvcal-month">${weekdays.map(day=>`<div class="tvcal-weekday">${escapeHtml(day)}</div>`).join('')}${Array.from({length:42},(_,i)=>{const date=new Date(start+i*86400000),key=date.toISOString().slice(0,10);return `<section class="tvcal-day ${key===today?'is-today':''} ${key.slice(0,7)!==this.month?'is-outside':''}" aria-label="${key}"><time datetime="${key}">${date.getUTCDate()}</time>${(groups.get(key)||[]).map(row=>this.episodeButton(row)).join('')}</section>`;}).join('')}</div></div></section>`;
    }
    return toolbar+note+content+attribution;
  },
  showCache(service,ready){
    const shows=service.config.settings.shows.filter(show=>show.enabled);
    return `<section class="panel"><div class="panel-header"><h2>Cached listings</h2></div><div class="panel-body">${shows.length?shows.map(entry=>{const show=service.pluginState?.shows?.[entry['tvmaze-id']];return `<div class="settings-item"><div class="settings-text"><h3>${escapeHtml(show?.name||entry.name)}</h3><p>${escapeHtml(show?[show.network,show.status,`${show.episodes.length} cached episodes`].filter(Boolean).join(' · '):'Waiting for first refresh')}</p>${show?.limited?'<p class="field-help">Nearest 50 aired, 50 upcoming and up to 10 undated episodes retained. Full history is available on TVmaze.</p>':''}</div><button type="button" class="button" data-action="tvcal-refresh" data-id="${entry['tvmaze-id']}" ${!ready||this.pending?'disabled':''}>${icon('refresh')}Refresh show</button></div>`;}).join(''):'<p>No enabled shows.</p>'}</div></section>`;
  },
  showList(service,field){
    const items=service.config.settings.shows;
    return `<section class="panel plugin-list"><div class="panel-header"><h2>Followed shows <span class="panel-count">${items.length}</span></h2><button type="button" class="button primary" data-action="tvcal-search" ${items.length>=field.maxItems?'disabled':''}>${icon('search')}Add show</button></div>${items.length?items.map(item=>{const show=service.pluginState?.shows?.[item['tvmaze-id']];return `<div class="settings-item" data-live-key="source:shows:${escapeHtml(item.id)}"><div class="settings-text"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(show?[show.network,...(show.genres||[]),show.status].filter(Boolean).join(' · '):'Waiting for show details')}</p></div>${AdminUX.definitionActions(item,{edit:'plugin-list-edit',copy:'plugin-list-copy',delete:'plugin-list-delete',toggle:'plugin-list-toggle'},{attributes:{setting:'shows'}})}</div>`;}).join(''):'<div class="empty-state">Find a show by title, or browse by genre.</div>'}</section>`;
  },
  syncFollowButtons(context,busyIndex=null){
    if(dialogContext!==context)return;
    const service=this.service(),shows=service.config.settings.shows,limit=service.settings.find(field=>field.id==='shows').maxItems;
    for(const button of dialog.querySelectorAll('[data-action="tvcal-follow"]')){
      const index=Number(button.dataset.id),match=context.matches[index];
      const followed=shows.some(show=>show['tvmaze-id']===match?.id);
      button.textContent=followed?'Following':busyIndex===index?'Following…':'Follow';
      button.disabled=this.pending||context.invalid||followed||shows.length>=limit;
    }
    const search=dialog.querySelector('[type="submit"]');if(search)search.disabled=this.pending;
    const count=dialog.querySelector('[data-tvcal-follow-count]');if(count)count.textContent=`Following ${shows.length} of ${limit} shows`;
  },
  async follow(index){
    if(this.pending)return;
    const context=dialogContext,service=this.service(),match=context?.kind==='tvcal-search'&&context.matches[Number(index)];
    if(!match)return;
    if(context.invalid||context.revision!==service.config.revision){context.invalid=true;this.syncFollowButtons(context);return showFormError('Settings changed. Search again before following another show.');}
    if(service.config.settings.shows.some(show=>show['tvmaze-id']===match.id))return;
    const field=service.settings.find(field=>field.id==='shows');
    if(service.config.settings.shows.length>=field.maxItems)return showFormError(`You can follow up to ${field.maxItems} shows. Remove one in Shows before adding another.`);
    const selection=context.selection||{operation:'add'};
    if(selection.operation==='copy')return PluginUI.openItem(service,field,'copy',selection.id,{name:match.name.slice(0,32),'tvmaze-id':match.id,enabled:true});
    const item={...PluginUI.newItem(field),name:match.name.slice(0,32),'tvmaze-id':match.id,enabled:true};
    const settings={...structuredClone(context.settings),shows:[...structuredClone(context.settings.shows),item]};
    this.pending=true;this.syncFollowButtons(context,Number(index));
    const error=dialog.querySelector('#form-error');if(error)error.hidden=true;
    try{
      // Each click saves once against its captured revision. A successful reply
      // advances only this search's baseline; conflicting or uncertain saves
      // require a fresh search and are never automatically repeated.
      const reply=await mutate('api/plugins/tv-calendar/config',{revision:context.revision,settings});
      const saved=reply.services?.find(entry=>entry.id==='tv-calendar')?.config;
      if(saved?.revision!==context.revision+1||!saved.settings.shows.some(show=>show.id===item.id&&show['tvmaze-id']===match.id))throw Error('Save was not confirmed.');
      if(dialogContext===context){context.revision=saved.revision;context.settings=structuredClone(saved.settings);}
    }catch(error){
      if(dialogContext===context){context.invalid=true;showFormError(`${error.message} Search again to reload the saved list before continuing.`);}
    }finally{this.pending=false;this.syncFollowButtons(context);}
  },
  openSearch(selection={operation:'add'}){
    showDialog(`<form id="tvcal-search-form">${dialogHeader('Discover shows')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><p class="field-help">Browse starter picks, search a title, or choose a TV/streaming schedule. Follow saves immediately. Choose as many shows as you like, then close this window.</p><div class="tvcal-search-fields"><label class="field"><span class="field-label">${icon('search')}Show title</span><input name="query" type="search" minlength="2" maxlength="100" autocomplete="off" placeholder="For example, Star Trek"></label><label class="field"><span class="field-label">${icon('category')}Genre</span><select name="genre"><option value="">Any genre</option>${['Action','Adventure','Anime','Children','Comedy','Crime','DIY','Drama','Espionage','Family','Fantasy','Food','History','Horror','Legal','Medical','Music','Mystery','Nature','Romance','Science-Fiction','Sports','Supernatural','Thriller','Travel','War','Western'].map(value=>`<option>${value}</option>`).join('')}</select></label><label class="field"><span class="field-label">${icon('live-tv')}Browse shows</span><select name="source"><option value="suggested">Starter picks</option><option value="streaming">Worldwide streaming</option><option value="tv-us">United States TV</option><option value="tv-gb">United Kingdom TV</option><option value="tv-fi">Finland TV</option></select><small class="field-help">Used when the title is empty. Schedules show today's releases; title searches include all countries.</small></label><label class="field"><span class="field-label">${icon('filter-list')}Show status</span><select name="status"><option value="">Any status</option><option>Running</option><option>Ended</option><option value="To Be Determined">To be determined</option></select></label></div><button class="button primary" type="submit">Search</button><div class="source-lookup-results" aria-live="polite"></div></div><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog">Close</button></div></form>`,{kind:'tvcal-search',revision:this.service().config.revision,matches:[],selection,settings:structuredClone(this.service().config.settings)});
    void this.search(dialog.querySelector('#tvcal-search-form'));
  },
  async search(form){
    if(this.pending)return;const context=dialogContext,service=this.service();this.pending=true;const button=form.querySelector('[type="submit"]');button.disabled=true;
    try{
      const reply=await mutate('api/plugins/tv-calendar/actions/lookup-show',{revision:service.config.revision,parameters:Object.fromEntries(['query','genre','source','status'].map(key=>[key,form.querySelector('[name="'+key+'"]').value]))});
      if(dialogContext!==context||!form.isConnected)return;context.revision=service.config.revision;context.settings=structuredClone(service.config.settings);context.invalid=false;context.matches=reply.result.matches;
      const error=form.querySelector('#form-error');if(error)error.hidden=true;
      const scope=reply.result.scope==='suggested'?'Starter picks · Checked '+reply.result.checkedOn:reply.result.scope==='schedule'?'Shows airing on '+reply.result.date:'Title search results';
      form.querySelector('.source-lookup-results').innerHTML='<p class="field-help">'+escapeHtml(scope)+'</p><p class="field-help" data-tvcal-follow-count></p>'+(context.matches.length?context.matches.map((show,i)=>`<div class="settings-item"><div class="settings-text"><h3>${escapeHtml(show.name)}</h3><p>${escapeHtml([show.premiered?.slice(0,4),show.network,show.country,show.language,...(show.genres||[]),show.status].filter(Boolean).join(' · '))}</p><p>${escapeHtml(show.summary)}</p></div><button type="button" class="button" data-action="tvcal-follow" data-id="${i}" ${service.config.settings.shows.some(entry=>entry['tvmaze-id']===show.id)?'disabled':''}>${service.config.settings.shows.some(entry=>entry['tvmaze-id']===show.id)?'Following':'Follow'}</button></div>`).join(''):'<p>No shows match this selection. Try another genre, search a title, or choose a TV/streaming schedule.</p>');
    }catch(error){if(dialogContext===context)showFormError(error.message);}finally{this.pending=false;if(button.isConnected)button.disabled=false;this.syncFollowButtons(context);}
  },
  openEpisode(id){
    const service=this.service(),row=this.rows(service).find(row=>row.id===id);if(!row)return;
    const ready=service.enabled&&service.health==='ready'&&!state.paused;
    showDialog(`<form id="tvcal-episode-form">${dialogHeader(row.show)}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><h3>${escapeHtml(row.title)}</h3><p>Season ${row.season} · Episode ${row.number}</p><p>${row.at?escapeHtml(formatServerTimestamp(row.at)):escapeHtml(row.date||'Time not announced')}</p><p>${escapeHtml(row.network)}</p><a href="${row.url}" target="_blank" rel="noopener noreferrer">Episode details on TVmaze</a></div><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog">Close</button><button type="submit" class="button primary" ${!ready?'disabled':''}>${icon(row.watched?'undo':'check')}Mark ${row.watched?'unwatched':'watched'}</button></div></form>`,{kind:'tvcal-episode',episodeId:id,watched:!row.watched,revision:service.config.revision});
  },
  async watched(form){
    if(this.pending)return;const context=dialogContext;this.pending=true;form.querySelector('[type="submit"]').disabled=true;
    try{await mutate('api/plugins/tv-calendar/actions/set-watched',{revision:context.revision,parameters:{'episode-id':context.episodeId,watched:context.watched}});if(dialogContext===context)closeDialog();}
    catch(error){if(dialogContext===context)showFormError(error.message);}finally{this.pending=false;if(form.isConnected)form.querySelector('[type="submit"]').disabled=false;}
  },
  async handle(action,id){
    const service=this.service();
    if(action==='tvcal-search')return this.openSearch();
    if(action==='tvcal-follow')return this.follow(id);
    if(action==='tvcal-episode')return this.openEpisode(id);
    if(action==='tvcal-view'){this.view=id;this.offset=0;}
    if(action==='tvcal-page')this.offset=Math.max(0,this.offset+Number(id)*50);
    if(action==='tvcal-today')this.month=this.dateKey(state.server.now||Date.now()).slice(0,7);
    if(action==='tvcal-month'){const [y,m]=this.month.split('-').map(Number);this.month=new Date(Date.UTC(y,m-1+Number(id),1)).toISOString().slice(0,7);}
    if(action==='tvcal-refresh'){
      if(this.pending)return;this.pending=true;PluginUI.render(service);
      try{await mutate('api/plugins/tv-calendar/actions/refresh-show',{revision:service.config.revision,parameters:{'show-id':id}});notify('TV listings refreshed.');}finally{this.pending=false;}
    }
    PluginUI.render(this.service());
  },
};
