/** A topic-first digest uses cached provider metadata and ordinary list editors. */
const InterestsUI={
  selected:'',pending:false,
  render(service){
    const topics=service.config.settings.topics,enabled=topics.filter(topic=>topic.enabled);
    if(this.selected&&!enabled.some(topic=>topic.id===this.selected))this.selected='';
    const readings=service.pluginState?.topics||{},ready=service.enabled&&service.health==='ready'&&!state.paused;
    const picked=this.selected?enabled.filter(topic=>topic.id===this.selected):enabled;
    const rows=[],seen=new Set();
    for(const topic of picked){const reading=readings[topic.id];for(const item of (reading?.items||[]).slice(0,this.selected?10:2))if(!seen.has(item.id)){seen.add(item.id);rows.push({...item,topic:topic.name,receivedAt:reading['received-at'],status:reading['poll-status']});}}
    return `<section class="panel"><div class="panel-header"><h2>Your briefing</h2><button type="button" class="button primary" data-action="interests-add">${icon('plus')}Add interest</button></div><div class="panel-body"><div class="home-mode-buttons" role="group" aria-label="Interests"><button type="button" class="button ${!this.selected?'primary':''}" data-action="interests-filter" data-id="" aria-pressed="${!this.selected}">All interests</button>${enabled.map(topic=>`<button type="button" class="button ${this.selected===topic.id?'primary':''}" data-action="interests-filter" data-id="${escapeHtml(topic.id)}" aria-pressed="${this.selected===topic.id}">${escapeHtml(topic.name)}</button>`).join('')}</div><p class="field-help">Choose AI, pop culture, film/TV, music, gaming, sci-fi, science, daily news or country-specific search trends with Add interest. Open a headline to read the original; some publisher pages need a subscription.</p></div></section>
      <div class="interests-grid">${rows.length?rows.slice(0,20).map(item=>`<article class="panel"><div class="panel-body"><p class="field-help">${escapeHtml(item.topic)} · ${escapeHtml(item.source)}${item.status!=='Ready'||Date.now()-item.receivedAt>86400000?' · Cached':''}</p><h3><a class="interest-headline" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3><p>${escapeHtml(item.summary)}</p><p class="field-help">${item.publishedAt?escapeHtml(formatServerTimestamp(item.publishedAt)):'Publication time not reported'}${item.releaseDate?' · Cinema release '+escapeHtml(item.releaseDate):''}</p></div></article>`).join(''):'<section class="panel"><div class="panel-body empty-state">Add an interest, choose a source and refresh it to build your briefing.</div></section>'}</div>
      <section class="panel"><div class="panel-header"><h2>Sources</h2></div><div class="panel-body">${enabled.map(topic=>{const reading=readings[topic.id];return `<div class="settings-item"><div class="settings-text"><h3>${escapeHtml(topic.name)}</h3><p>${escapeHtml(reading?.['poll-status']||'Not refreshed')}${reading?.['received-at']?' · '+escapeHtml(formatServerTimestamp(reading['received-at'])):''}</p></div><button type="button" class="button" data-action="interests-refresh" data-id="${escapeHtml(topic.id)}" ${!ready||this.pending?'disabled':''}>${icon('refresh')}Refresh</button></div>`;}).join('')||'<p>No enabled interests.</p>'}</div></section><p class="field-help"><a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer"><img src="assets/interests/tmdb.svg" width="70" alt="TMDB" style="vertical-align:middle;margin-right:12px"></a>Sources retain their content rights. Movie listings: This product uses the TMDB API but is not endorsed or certified by TMDB.</p>`;
  },
  async handle(action,id){
    const service=state.services.find(service=>service.id==='interests');
    if(action==='interests-add')return PluginUI.openItem(service,service.settings.find(field=>field.id==='topics'),'add');
    if(action==='interests-filter')this.selected=id;
    if(action==='interests-refresh'){
      if(this.pending)return;this.pending=true;PluginUI.render(service);
      try{await mutate('api/plugins/interests/actions/refresh',{revision:service.config.revision,parameters:{'topic-id':id}});notify('Interest checked.');}
      finally{this.pending=false;PluginUI.render(state.services.find(service=>service.id==='interests'));}return;
    }
    PluginUI.render(service);
  },
};
