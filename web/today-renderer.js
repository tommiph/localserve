/* A read-only cinematic Vista presentation. ES5 is shared with older Tizen TVs. */
(function (global) {
  'use strict';
  function node(tag, className, text) { var element=document.createElement(tag);element.className=className||'';if(text!==undefined)element.textContent=text;return element; }
  function clear(element) { while(element.firstChild)element.removeChild(element.firstChild); }
  function text(element,value){value=String(value);if(element.textContent!==value)element.textContent=value;}
  function attribute(element,key,value){if(element.getAttribute(key)!==value)element.setAttribute(key,value);}
  function create(host,compatibility) {
    clear(host);host.style.padding='0';
    var root=node('section','today-scene'),world=node('div','today-world'),sky=node('div','today-sky'),stars=node('div','today-stars'),glow=node('div','today-glow');
    root.setAttribute('data-renderer',compatibility&&compatibility.legacy===true?'legacy':'modern');
    var backdrop=node('img','today-backdrop'),depth=node('div','today-depth');backdrop.alt='';backdrop.hidden=true;
    for(var ring=0;ring<3;ring++)depth.appendChild(node('div','today-depth-ring today-depth-ring-'+ring));
    world.appendChild(sky);world.appendChild(backdrop);world.appendChild(stars);world.appendChild(glow);world.appendChild(depth);root.appendChild(world);
    var head=node('header','today-header'),heading=node('div'),eyebrow=node('p','today-eyebrow','TODAY'),greeting=node('h1','today-greeting'),day=node('p','today-date');
    heading.appendChild(eyebrow);heading.appendChild(greeting);heading.appendChild(day);head.appendChild(heading);
    var timeBox=node('div','today-clockbox'),clock=node('time','today-clock'),subclock=node('p','today-clock-note');timeBox.appendChild(clock);timeBox.appendChild(subclock);head.appendChild(timeBox);root.appendChild(head);
    var weather=node('section','today-weather today-glass'),weatherArt=node('div','today-weather-art'),weatherOrb=node('div','today-sun'),weatherLabel=node('p','today-eyebrow','WEATHER'),temperature=node('strong','today-temperature'),condition=node('p','today-condition'),place=node('p','today-source');
    var weatherFacts=node('p','today-weather-facts');weatherArt.appendChild(weatherOrb);weather.appendChild(weatherArt);weather.appendChild(weatherLabel);weather.appendChild(temperature);weather.appendChild(condition);weather.appendChild(place);weather.appendChild(weatherFacts);root.appendChild(weather);
    var daylight=node('section','today-daylight today-glass'),orbit=node('div','today-solar-orbit'),sunset=node('strong','today-sunset'),sunsetNote=node('p','today-source');
    var sunriseNote=node('p','today-sunrise');daylight.appendChild(node('p','today-eyebrow','SUNSET'));daylight.appendChild(orbit);daylight.appendChild(sunset);daylight.appendChild(sunsetNote);daylight.appendChild(sunriseNote);root.appendChild(daylight);
    var spotlight=node('article','today-spotlight today-glass'),spotTitle=node('h2','today-story-title'),spotMeta=node('p','today-story-meta'),spotBody=node('p','today-story-body'),spotFooter=node('p','today-source'),progress=node('div','today-progress'),bar=node('span');
    spotMeta.hidden=true;spotlight.appendChild(spotTitle);spotlight.appendChild(spotMeta);spotlight.appendChild(spotBody);spotlight.appendChild(spotFooter);progress.appendChild(bar);spotlight.appendChild(progress);root.appendChild(spotlight);
    var movieCredit=node('img','today-movie-credit');movieCredit.src='../assets/interests/tmdb.svg';movieCredit.alt='TMDB';movieCredit.hidden=true;spotlight.appendChild(movieCredit);
    var poster=node('img','today-poster'),motif=node('div','today-motif'),motifIcon=node('span','material-symbol');poster.alt='';poster.hidden=true;motif.setAttribute('aria-hidden','true');motif.appendChild(motifIcon);spotlight.appendChild(motif);spotlight.appendChild(poster);
    var queue=node('nav','today-queue'),position=node('span','today-position');queue.setAttribute('aria-label','Upcoming stories');root.appendChild(queue);
    var rail=node('aside','today-rail');root.appendChild(rail);var footer=node('footer','today-footer'),footStatus=node('span','today-footer-status');footer.appendChild(position);footer.appendChild(footStatus);root.appendChild(footer);host.appendChild(root);
    var payload=null,cards=[],selectedKey='',selectedAt=Date.now(),paused=false,destroyed=false,lastStory='',lastRail='',lastQueue='',lastTypography='',receivedAt=0,railTurn=0,railAt=Date.now(),direction=1;
    var railTiles=[],lastStoryKey='',lastQueueKey='',lastSize='',lastAppearance='';
    var glyphs={'tv-calendar':'live-tv',movies:'movie',emby:'video-library',interests:'auto-awesome',news:'newspaper','hsl-trains':'train',tradfri:'lightbulb',weather:'partly-cloudy-day',calendar:'calendar-month','adsb-lol':'flight',finavia:'flight-takeoff',fingrid:'bolt','pc-network':'memory',playstation:'sports-esports','home-modes':'home'};
    function glyph(entry){return 'material-symbol ms-'+(glyphs[entry&&entry.pluginId]||'dashboard');}
    function symbol(entry,className){var icon=node('span',className+' '+glyph(entry));icon.setAttribute('aria-hidden','true');return icon;}
    function image(element,url){
      var safe=typeof url==='string'&&/^\/api\/watch-art\/(?:movies|emby)\/[a-f0-9]{40}\/(?:poster|backdrop)\.jpg$/.test(url)?url:'';
      if(element._todayPath===safe)return;element._todayPath=safe;element.hidden=true;
      element.onload=function(){if(!destroyed&&element._todayPath===safe&&safe)element.hidden=false;};
      element.onerror=function(){if(element._todayPath===safe)element.hidden=true;};
      if(safe)element.src=safe;else element.removeAttribute('src');
    }
    function reference(entry) { return entry.pluginId+'/'+entry.cardId+(entry.storyKey?'/'+entry.storyKey:'')+(typeof entry.rotationTurn==='number'?'/turn-'+entry.rotationTurn:''); }
    function enabledReferences(layout, result) {
      if(!layout||!layout.enabled)return;var i;
      for(i=0;i<(layout.cards||[]).length;i++)result[layout.cards[i].pluginId+'/'+layout.cards[i].cardId]=true;
      for(i=0;i<(layout.children||[]).length;i++)enabledReferences(layout.children[i],result);
    }
    function now() { return payload&&payload.options.now?payload.options.now+(payload.options.connected===false?0:Date.now()-receivedAt):Date.now(); }
    function date(at, options) {
      if(!Number.isFinite?typeof at!=='number':!Number.isFinite(at))return 'Not reported';
      var value=new Date(at),format={timeZone:payload.options.timeZone};for(var key in options)format[key]=options[key];
      try{return new Intl.DateTimeFormat(undefined,format).format(value);}catch(ignore){return options.hour?value.toLocaleTimeString():value.toLocaleDateString();}
    }
    function time(at) { return date(at,{hour:'2-digit',minute:'2-digit',hour12:payload.options.timeFormat==='12'}); }
    function entries(entry) {
      var result=[],data=entry.data||{},catalog=entry.catalog||[],keys=Object.keys(data.values||{}),allowed=null;
      if(Array.isArray(entry.card.fields)){allowed={};for(var f=0;f<entry.card.fields.length;f++)if(entry.card.fields[f].enabled)allowed[entry.card.fields[f].binding]=entry.card.fields[f];}
      if(entry.card.layout==='readymade'){
        var design=data.readyMade||{},chosen=design.template,source=design.source;
        for(var a=0;!chosen&&a<(design.templates||[]).length;a++)if(design.templates[a].id===entry.card.templateId)chosen=design.templates[a];
        for(var b=0;!source&&b<(design.sources||[]).length;b++)if(design.sources[b].id===entry.card.sourceId)source=design.sources[b];
        allowed={};for(var d=0;d<(chosen&&chosen.slots||[]).length;d++){var binding=design.bindings&&design.bindings[chosen.slots[d].id]||source&&source.bindings&&source.bindings[chosen.slots[d].field];if(binding)allowed[binding]={id:chosen.slots[d].id};}
      }
      for(var i=0;i<keys.length;i++){var value=data.values[keys[i]],metadata=null;for(var j=0;j<catalog.length;j++)if(catalog[j].id===keys[i])metadata=catalog[j];
        if(allowed&&!allowed[keys[i]])continue;
        if(value&&value.available&&value.type!=='webpage'&&value.type!=='log'){
          var columns=metadata&&metadata.columns||[],contents=value.value,selection=entry.card.layout==='table'?entry.card.listOptions:null;
          if(value.type==='table'&&entry.card.layout==='readymade'){
            var ready=data.readyMade||{},template=ready.template;
            if(!template)for(var t=0;t<(ready.templates||[]).length;t++)if(ready.templates[t].id===entry.card.templateId)template=ready.templates[t];
            for(var s=0;s<(template&&template.slots||[]).length;s++){var slot=template.slots[s];if(slot.type==='table'&&allowed&&allowed[keys[i]]&&slot.id===allowed[keys[i]].id)selection={rows:slot.rows,columns:slot.columns.map(function(column){return column.id;})};}
          }
          if(value.type==='table'&&selection){columns=columns.filter(function(column){return selection.columns.indexOf(column.id)>=0;});contents=contents.slice(0,selection.rows);}
          result.push({id:keys[i],type:value.type,value:contents,label:metadata?metadata.label:keys[i],columns:columns});
        }
      }return result;
    }
    function match(entry, pattern, type) { var values=entries(entry);for(var i=0;i<values.length;i++)if((pattern.test(values[i].id)||pattern.test(values[i].label))&&(!type||values[i].type===type))return values[i];return null; }
    function sourceName(entry) { var data=entry.data||{};return data.readyMade&&data.readyMade.source&&data.readyMade.source.name||data.pluginName||entry.card.name; }
    function cardTitle(entry){var name=entry.card.name,plugin=entry.data&&entry.data.pluginName,suffix=' · '+plugin;return plugin&&name.slice(-suffix.length)===suffix?name.slice(0,-suffix.length):name;}
    function status(entry) { var state=entry&&entry.data?entry.data.status:entry&&entry.unavailable||'Unavailable';if(state==='Ready')state='';if(entry&&entry.data){var stamp=match(entry,/(?:received-at|updated-at)$/,'timestamp'),report=match(entry,/(?:^|:)poll-status$/,'string');if(report&&!/^(Ready|Updated)$/i.test(report.value))state+=(state?' · ':'Cached · ')+report.value;else if(stamp&&now()-stamp.value>21600000)state+=(state?' · ':'')+'Cached';}return state; }
    function cell(value,type) { if(value===null||value===undefined||value==='')return 'Not reported';if(type==='timestamp')return time(value);if(type==='boolean')return value?'Yes':'No';return String(value).slice(0,150); }
    function watchCard(entry) { return entry.card.layout==='readymade'&&((entry.pluginId==='tv-calendar'&&/^daily-tv(?:-fullscreen)?$/.test(entry.card.templateId))||(entry.pluginId==='movies'&&/^daily-movies(?:-fullscreen)?$/.test(entry.card.templateId))||(entry.pluginId==='emby'&&/^library-movies(?:-fullscreen)?$/.test(entry.card.templateId))); }
    function watchStories(entry) {
      if(!watchCard(entry))return [];
      var result=[],values=entries(entry),read=function(index,field){for(var j=0;j<values.length;j++)if(new RegExp('(?:^|:)pick-'+index+'-'+field+'$').test(values[j].id)&&values[j].type==='string')return String(values[j].value);return '';};
      for(var i=1;i<=4;i++){
        var title=read(i,'title');if(!title)continue;
        var source=read(i,entry.pluginId==='tv-calendar'?'network':'source'),meta=[read(i,'year'),read(i,'genres'),entry.pluginId==='tv-calendar'?source:''].filter(function(value){return Boolean(value);}).join(' · ');
        result.push({pluginId:entry.pluginId,cardId:entry.cardId,card:entry.card,data:entry.data,catalog:entry.catalog,storyKey:'pick/'+title,
          suggestion:{title:title,metadata:meta,body:read(i,'summary')||'No description reported',rows:[title,meta],artwork:entry.data.todayArtwork&&entry.data.todayArtwork[title],credit:entry.pluginId==='emby'?'Emby library':entry.pluginId==='tv-calendar'?'TVmaze':source==='TMDB'?'TMDB':'Sormus starter collection',label:entry.pluginId==='emby'?'IN YOUR EMBY LIBRARY':entry.pluginId==='tv-calendar'?'TV TO DISCOVER':'MOVIE SUGGESTION'}});
      }
      return result;
    }
    /** Expand only the headline rows and columns published by this saved Card. */
    function headlineStories(entry){
      if(!/^(interests|news)$/.test(entry.pluginId))return [];
      var detail=describe(entry),items=[{title:detail.title,body:detail.body,credit:detail.credit,publishedAt:detail.publishedAt}],values=entries(entry),seen={},result=[];
      for(var i=0;i<values.length;i++)if(values[i].type==='table'){
        var visible={};for(var c=0;c<values[i].columns.length;c++)visible[values[i].columns[c].id]=true;
        for(var j=0;j<values[i].value.length&&items.length<11;j++){var row=values[i].value[j];if(visible.title&&row.title)items.push({title:String(row.title),body:'',credit:visible.source?String(row.source||''):'',publishedAt:visible.at?row.at:null});}
      }
      for(var k=0;k<items.length;k++){var item=items[k],key='$'+item.title;if(!item.title||seen[key])continue;seen[key]=true;item.label=sourceName(entry);item.rows=[];
        // Secondary headlines have no invented description or borrowed lead text.
        result.push({pluginId:entry.pluginId,cardId:entry.cardId,card:entry.card,data:entry.data,catalog:entry.catalog,storyKey:'headline/'+item.title,suggestion:item});}
      return result;
    }
    function describe(entry) {
      if(entry.suggestion)return entry.suggestion;
      if(watchCard(entry)){var picks=watchStories(entry);return picks.length?picks[0].suggestion:{title:'No suggestions in this selection',body:'Try another genre in the watch guide.',rows:[],credit:''};}
      var values=entries(entry),rows=[],i,j,hasTable=false;
      if(entry.pluginId==='hsl-trains'){
        var train=match(entry,/(?:^|:)train-1-train$/),route=match(entry,/(?:^|:)train-1-route$/),when=match(entry,/(?:^|:)train-1-(?:due-at|time)$/),track=match(entry,/(?:^|:)train-1-track$/),trainStatus=match(entry,/(?:^|:)train-1-status$/);
        if(train){if(when)rows.push(cell(when.value,when.type)+(track&&track.value?' · Track '+track.value:''));if(trainStatus&&trainStatus.value)rows.push(String(trainStatus.value));return {title:String(train.value)+(route&&route.value?' · '+route.value:''),body:rows.join('\n'),rows:rows,credit:''};}
      }
      if(entry.pluginId==='tradfri'){
        var on=match(entry,/(?:^|:)lights-on$/),total=match(entry,/(?:^|:)light-count$/),rooms=match(entry,/(?:^|:)group-count$/);
        if(on){rows.push(on.value+(total?' of '+total.value:'')+' lights on');if(rooms)rows.push(rooms.value+' rooms');return {title:'Lighting',body:rows.join('\n'),rows:rows,credit:''};}
      }
      if(entry.pluginId==='fingrid'){
        for(i=0;i<5;i++){var metric=['consumption','production','wind','carbon','frequency'][i],reading=match(entry,new RegExp('(?:^|:)grid-'+metric+'$'),'number'),unit=match(entry,new RegExp('(?:^|:)grid-'+metric+'-unit$'),'string');if(reading)rows.push(['Consumption','Production','Wind','Carbon intensity','Frequency'][i]+' · '+Math.round(reading.value*100)/100+(unit?' '+unit.value:''));}
        if(rows.length)return {title:'Finland’s electricity',body:rows.join('\n'),rows:rows,credit:'Fingrid'};
      }
      if(entry.pluginId==='adsb-lol'){
        var count=match(entry,/(?:^|:)aircraft-count$/,'number'),nearest=match(entry,/(?:^|:)nearest-callsign$/,'string'),distance=match(entry,/(?:^|:)nearest-distance$/,'number');
        if(count){if(nearest)rows.push('Nearest · '+nearest.value+(distance?' · '+distance.value+' NM':''));return {title:count.value+' aircraft nearby',body:rows.join('\n'),rows:rows,credit:'adsb.lol'};}
      }
      for(i=0;i<values.length;i++)if(values[i].type==='table'){
        hasTable=true;
        for(j=0;j<values[i].value.length&&rows.length<3;j++){var parts=[],row=values[i].value[j],firstTime=null;for(var c=0;c<values[i].columns.length;c++){var column=values[i].columns[c];if(column.type==='timestamp'&&typeof row[column.id]==='number'&&firstTime===null)firstTime=row[column.id];if(row[column.id]!==null&&row[column.id]!==undefined&&row[column.id]!=='')parts.push(cell(row[column.id],column.type));}
          if(entry.pluginId==='calendar'&&firstTime!==null&&date(firstTime,{year:'numeric',month:'2-digit',day:'2-digit'})!==date(now(),{year:'numeric',month:'2-digit',day:'2-digit'}))continue;
          if(entry.pluginId==='hsl-trains'&&firstTime!==null&&firstTime<now()-60000)continue;
          if(parts.length)rows.push(parts.join(' · '));}if(rows.length)break;
      }
      if(entry.pluginId==='calendar'&&hasTable){if(!rows.length)rows.push('No events starting today');return {title:cardTitle(entry),body:rows.join('\n'),rows:rows,credit:''};}
      if(entry.pluginId==='tv-calendar'&&hasTable&&!rows.length)return {title:'Tonight on television',body:'No episodes listed tonight',rows:['No episodes listed tonight'],credit:'TVmaze'};
      if(!rows.length)for(i=0;i<values.length&&rows.length<4;i++)if(values[i].type!=='table'&&!/received|updated|checked|status|count|version/i.test(values[i].id)&&values[i].value!=='')rows.push(values[i].label+': '+cell(values[i].value,values[i].type));
      var lead=match(entry,/(?:^|:)(?:lead-title|next-title|next-show|mode-name|title|current-game)$/,'string');
      var summary=match(entry,/(?:^|:)(?:lead-summary|description|next-description)$/,'string');
      var credit=match(entry,/(?:^|:)(?:lead-source|publisher|source)$/,'string');
      var published=match(entry,/(?:^|:)(?:lead-at|published-at)$/,'timestamp');
      return {title:lead&&lead.value||cardTitle(entry),body:summary&&summary.value||rows.join('\n')||'No current reading',rows:rows,credit:credit&&credit.value||'',publishedAt:published&&published.value};
    }
    function weatherState() {
      var entry=null;for(var i=0;i<cards.length;i++)if(cards[i].pluginId==='weather'){entry=cards[i];break;}
      if(!entry){text(temperature,'—');text(condition,'Weather not selected');text(place,'Add a weather Card to this Vista');text(weatherFacts,'');attribute(root,'data-weather','unknown');return;}
      var temp=match(entry,/(?:^|:)(?:temperature|temperature-c|temp-c)$/,'number'),description=match(entry,/(?:condition|description|weather-text)/,'string');
      text(temperature,temp?Math.round(temp.value)+'°':'—');text(condition,description?description.value:entry.card.name);text(place,sourceName(entry));
      var feels=match(entry,/(?:^|:)feels-like-c$/,'number'),wind=match(entry,/(?:^|:)wind-speed-kmph$/,'number'),humidity=match(entry,/(?:^|:)humidity-percent$/,'number'),facts=[];
      if(feels)facts.push('Feels '+Math.round(feels.value)+'°');if(wind)facts.push('Wind '+Math.round(wind.value)+' km/h');if(humidity)facts.push(humidity.value+'% humidity');text(weatherFacts,facts.join(' · '));
      var words=(description&&description.value||'').toLowerCase();attribute(root,'data-weather',/snow|sleet|ice/.test(words)?'snow':/rain|drizzle|thunder/.test(words)?'rain':/cloud|overcast|fog/.test(words)?'cloud':'clear');
    }
    function renderRail() {
      var priorities=['hsl-trains','calendar','tv-calendar','tradfri','home-modes'],pool=[],picked=[],i,j;
      for(i=0;i<priorities.length;i++)for(j=0;j<cards.length;j++)if(cards[j].pluginId===priorities[i]&&!watchCard(cards[j])&&pool.indexOf(cards[j])<0)pool.push(cards[j]);
      for(i=0;i<cards.length;i++)if(cards[i].pluginId!=='weather'&&!/^(interests|news)$/.test(cards[i].pluginId)&&!watchCard(cards[i])&&pool.indexOf(cards[i])<0)pool.push(cards[i]);
      var offset=pool.length>4?railTurn*4:0;for(i=0;i<Math.min(4,pool.length);i++)picked.push(pool[(offset+i)%pool.length]);
      var signature=picked.map(reference).join('|')||'empty',changed=signature!==lastRail;
      if(changed){lastRail=signature;clear(rail);railTiles=[];}
      if(!picked.length){if(changed){var empty=node('section','today-mini today-glass');empty.appendChild(node('p','today-eyebrow','DAILY ESSENTIALS'));empty.appendChild(node('h3','','Choose your Cards'));empty.appendChild(node('p','','Add train departures, an agenda, lighting or television Cards in the Vista editor.'));rail.appendChild(empty);paint(empty);}return;}
      // Preserve panel nodes during data refreshes; timestamps and changing
      // readings must not restart their entrance animations.
      for(i=0;i<picked.length;i++){
        var entry=picked[i],detail=describe(entry),view=railTiles[i];
        if(!view){var tile=node('section','today-mini today-glass');view={tile:tile,title:node('h3'),body:node('p','today-mini-body'),status:node('small','today-source')};tile.appendChild(symbol(entry,'today-mini-icon'));tile.appendChild(view.title);tile.appendChild(view.body);tile.appendChild(view.status);rail.appendChild(tile);railTiles.push(view);paint(tile);}
        text(view.title,detail.title);text(view.body,detail.rows.length?detail.rows.slice(0,2).join('\n'):detail.body);text(view.status,status(entry));view.status.hidden=!view.status.textContent;
      }
    }
    function stories() {
      var buckets={tv:[],movies:[],news:[],other:[]},movieGroups=[],groups=[],result=[],i,j,rounds=0;
      for(i=0;i<cards.length;i++){var picks=watchStories(cards[i]);if(picks.length){if(cards[i].pluginId==='tv-calendar')buckets.tv=buckets.tv.concat(picks);else if(cards[i].pluginId==='emby')movieGroups.unshift(picks);else movieGroups.push(picks);}}
      // Alternate owned-library and discovery Cards within the movie section.
      for(i=0;i<4;i++)for(j=0;j<movieGroups.length;j++)if(movieGroups[j][i])buckets.movies.push(movieGroups[j][i]);
      var newsGroups=[];
      for(i=0;i<cards.length;i++)if(cards[i].pluginId!=='weather'&&!watchCard(cards[i])){var category=cards[i].pluginId==='tv-calendar'?'tv':cards[i].pluginId==='movies'?'movies':/^(interests|news)$/.test(cards[i].pluginId)?'news':'other';if(category==='news')newsGroups.push(headlineStories(cards[i]));else buckets[category].push(cards[i]);}
      var seenNews={};for(i=0;i<11;i++)for(j=0;j<newsGroups.length;j++)if(newsGroups[j][i]){var headline=newsGroups[j][i],key='$'+headline.suggestion.title;if(!seenNews[key]){seenNews[key]=true;buckets.news.push(headline);}}
      for(i=0;i<4;i++){var group=buckets[['tv','movies','news','other'][i]];if(group.length){groups.push(group);rounds=Math.max(rounds,group.length);}}
      // Each available section gets one turn per round, even with fewer Cards.
      // Turn identities make repeated stories navigable in both directions.
      for(i=0;i<rounds;i++)for(j=0;j<groups.length;j++){var entry=groups[j][i%groups[j].length];result.push({pluginId:entry.pluginId,cardId:entry.cardId,card:entry.card,data:entry.data,catalog:entry.catalog,storyKey:entry.storyKey,suggestion:entry.suggestion,rotationTurn:i});}
      return result.length?result:cards;
    }
    function fitStory() {
      var scale=(payload.options.fontScale||100)/100,signature=spotTitle.textContent+'/'+spotMeta.textContent+'/'+scale+'/'+spotlight.getAttribute('data-artwork')+'/'+spotFooter.hidden+'/'+movieCredit.hidden;
      if(signature===lastTypography)return;lastTypography=signature;
      var size=42*scale;spotTitle.style.fontSize=size+'px';spotMeta.style.fontSize=17*scale+'px';spotBody.style.fontSize=23*scale+'px';
      // Fit only on a story/font change, never per animation frame or poll.
      // Compare with the two-line budget. Glyph rounding can exceed a single
      // line's clientHeight by a pixel even when the title already fits.
      while(spotTitle.scrollHeight>size*2.4+3&&size>24){size-=2;spotTitle.style.fontSize=size+'px';}
      var bottom=spotFooter.hidden?spotlight.clientHeight-(movieCredit.hidden?28:72):spotFooter.offsetTop;
      if(typeof bottom==='number'&&typeof spotBody.offsetTop==='number')spotBody.style.maxHeight=Math.max(0,bottom-spotBody.offsetTop-18)+'px';
    }
    function renderQueue(list,index){
      var textScale=(payload.options.fontScale||100)/100,signature=list.map(reference).join('|')+'/'+index+'/'+textScale;if(signature===lastQueue)return;lastQueue=signature;var entering=lastQueueKey!==selectedKey;lastQueueKey=selectedKey;clear(queue);
      position.textContent=list.length?(index+1)+' / '+list.length:'';
      for(var i=1;i<=Math.min(3,list.length-1);i++)(function(offset){
        var entry=list[(index+offset)%list.length],detail=describe(entry),button=node('button','today-next'+(entering?' today-next-enter':'')),text=node('span','today-next-copy');button.type='button';
        var title=node('strong','',detail.title);title.style.fontSize=Math.min(28,19*textScale)+'px';button.appendChild(symbol(entry,'today-next-icon'));text.appendChild(title);button.appendChild(text);
        button.setAttribute('aria-label','Show '+detail.title);button.onclick=function(){if(!destroyed&&payload.options.connected!==false){direction=1;selectedKey=reference(entry);selectedAt=Date.now();renderStory();}};queue.appendChild(button);
      }(i));
    }
    function renderStory() {
      var list=stories(),entry=null,i,index=0;for(i=0;i<list.length;i++)if(reference(list[i])===selectedKey){entry=list[i];index=i;}
      if(!entry&&list.length){entry=list[0];selectedKey=reference(entry);selectedAt=Date.now();}
      var story=entry?describe(entry):{title:'No Cards selected',body:'Add Cards to this Vista to bring your daily information together.'};
      renderQueue(list,index);var signature=JSON.stringify([selectedKey,story,entry&&status(entry)]);if(signature===lastStory)return;lastStory=signature;
      text(spotTitle,story.title);text(spotMeta,story.metadata||'');spotMeta.hidden=!story.metadata;text(spotBody,story.body);
      var sourceText=entry?status(entry):'';
      if(story.publishedAt)sourceText+=(sourceText?' · ':'')+'Published '+date(story.publishedAt,{month:'short',day:'numeric'})+' '+time(story.publishedAt);text(spotFooter,sourceText);spotFooter.hidden=!sourceText;
      movieCredit.hidden=story.credit!=='TMDB';
      var artwork=story.artwork||{};image(poster,artwork.poster);image(backdrop,artwork.backdrop);attribute(spotlight,'data-artwork',artwork.poster?'poster':'none');attribute(spotlight,'data-kind',entry&&entry.pluginId||'none');if(motifIcon.className!==glyph(entry))motifIcon.className=glyph(entry);
      if(lastStoryKey!==selectedKey){lastStoryKey=selectedKey;spotlight.className='today-spotlight today-glass';void spotlight.offsetWidth;spotlight.className+=direction<0?' today-arrive-back':' today-arrive';}
      fitStory();
    }
    function scale() { var width=host.clientWidth||1920,height=host.clientHeight||1080,size=width+'/'+height;if(size===lastSize)return;lastSize=size;root.style.transform='scale('+Math.min(width/1920,height/1080)+')';root.style.left=Math.max(0,(width-1920*Math.min(width/1920,height/1080))/2)+'px';root.style.top=Math.max(0,(height-1080*Math.min(width/1920,height/1080))/2)+'px'; }
    function paint(panel){var light=payload.options.theme==='light',opacity=((payload.vista.presentation||{}).opacity||80)/100,color=light?'rgba(245,251,255,'+opacity+')':'rgba(10,26,43,'+opacity+')';if(panel.style.backgroundColor!==color)panel.style.backgroundColor=color;}
    function step(delta) {
      var list=stories();if(!list.length||payload.options.connected===false)return false;var index=0;for(var i=0;i<list.length;i++)if(reference(list[i])===selectedKey)index=i;
      direction=delta<0?-1:1;
      selectedKey=reference(list[(index+(direction<0?-1:1)+list.length)%list.length]);selectedAt=Date.now();renderStory();return true;
    }
    function tick() {
      if(destroyed||!payload)return;attribute(root,'data-idle',document.hidden||!host.clientWidth||!host.clientHeight?'true':'false');if(document.hidden||!host.clientWidth||!host.clientHeight)return;scale();var at=now();text(clock,time(at));text(day,date(at,{weekday:'long',day:'numeric',month:'long'}));
      var hour;try{hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:payload.options.timeZone,hour:'2-digit',hour12:false}).format(new Date(at)));}catch(ignore){hour=new Date(at).getHours();}
      text(greeting,hour<5?'A quieter kind of night.':hour<12?'Good morning.':hour<18?'Good afternoon.':'Good evening.');
      var solar=payload.options.daylight||{};text(sunset,solar.sunset?time(solar.sunset):'—');
      attribute(root,'data-period',solar.sunrise&&Math.abs(at-solar.sunrise)<2700000?'dawn':solar.sunset&&Math.abs(at-solar.sunset)<2700000?'dusk':solar.sunrise&&solar.sunset?(at>solar.sunrise&&at<solar.sunset?'day':'night'):hour>=7&&hour<18?'day':'night');
      text(sunsetNote,solar.sunset?(at<solar.sunset?Math.max(0,Math.ceil((solar.sunset-at)/60000))+' minutes until sunset':'The sun has set'):'Set Server location for sunset times');
      text(sunriseNote,solar.sunrise?'Sunrise '+time(solar.sunrise):'');
      var presentation=payload.vista.presentation||{},seconds=presentation.spotlightSeconds||30,elapsed=(Date.now()-selectedAt)/1000;
      if(!paused&&payload.options.connected!==false&&elapsed>=seconds){step(1);elapsed=0;}
      if(!paused&&payload.options.connected!==false&&Date.now()-railAt>=15000){railAt=Date.now();railTurn++;renderRail();}
      attribute(root,'data-paused',paused||payload.options.connected===false?'true':'false');if(!paused&&payload.options.connected!==false)bar.style.width=Math.min(100,elapsed/seconds*100)+'%';text(footStatus,payload.options.connected===false?'Offline · Last available readings':paused?'Spotlight paused':'');
      text(subclock,payload.options.connected===false?'Last server time':'LOCAL TIME');
    }
    function update(value) {
      var allowed={};if(payload!==value)receivedAt=Date.now();payload=value;enabledReferences(value.vista.layout,allowed);
      cards=(value.cards||[]).filter(function(entry){return entry.card&&entry.card.enabled!==false&&allowed[reference(entry)];});
      var options=value.vista.presentation||{};attribute(root,'data-mood',options.mood||'atmospheric');attribute(root,'data-motion',options.motion||'gentle');attribute(root,'data-theme',value.options.theme||'dark');
      var appearance=JSON.stringify([value.options.theme,value.options.fontScale,options.opacity]);if(appearance!==lastAppearance){lastAppearance=appearance;
        root.style.setProperty('--today-opacity',String((options.opacity||80)/100));root.style.setProperty('--today-text-scale',String((value.options.fontScale||100)/100));
        // Literal panel colors also work without CSS variable support.
        var panels=root.getElementsByClassName('today-glass');for(var p=0;p<panels.length;p++)paint(panels[p]);}
      weatherState();renderRail();renderStory();fitStory();tick();
    }
    var timer=setInterval(tick,1000);
    return {update:update,step:step,pause:function(value){if(paused!==(value===true)){paused=value===true;selectedAt=Date.now();railAt=Date.now();tick();}return paused;},destroy:function(){destroyed=true;poster.onload=poster.onerror=backdrop.onload=backdrop.onerror=null;clearInterval(timer);clear(host);}};
  }
  global.TodayRenderer={create:create};
}(window));
