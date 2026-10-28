/** Reader interactions use text nodes and the public portal projection only. */
'use strict';
let edition=null,selection=PortalModel.route(location.search),newIds=new Set();
let editionReceived=0,countdowns=[];
const storage={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)};
const visits=PortalModel.visits(storage);
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
function date(value){if(!Number.isFinite(value))return 'Time not supplied';return new Intl.DateTimeFormat(undefined,{timeZone:edition.options.timeZone,dateStyle:'medium',timeStyle:'short',hourCycle:edition.options.timeFormat==='12'?'h12':'h23'}).format(value);}
function navigate(value,replace=false){
  selection=value;history[replace?'replaceState':'pushState'](null,'',location.pathname+PortalModel.queryString(value));draw();
}
function topicLink(name,value,count){
  const link=element('a',undefined,'topic-link');link.href=location.pathname+PortalModel.queryString(value);link.append(element('span',name),element('small',String(count)));
  if(selection.topic===value.topic&&selection.fresh===value.fresh)link.setAttribute('aria-current','page');
  link.onclick=event=>{if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();navigate(value);};return link;
}
function draw(){
  const navigationFocused=document.activeElement?.closest('#topics');
  newIds=visits.fresh(edition.articles);document.title=`${selection.topic||'The Daily'} · ${edition.options.name}`;
  const topics=document.querySelector('#topics');topics.replaceChildren(topicLink('Front page',{topic:'',fresh:false},edition.articles.length),topicLink('New',{topic:'',fresh:true},newIds.size));
  const watch=element('a','What to watch','topic-link');watch.href='/watch';topics.append(watch);
  for(const name of new Set(edition.articles.map(article=>article.topic)))topics.append(topicLink(name,{topic:name,fresh:false},edition.articles.filter(article=>article.topic===name).length));
  if(navigationFocused)topics.querySelector('[aria-current="page"]')?.focus({preventScroll:true});
  document.body.dataset.section=selection.topic?'topic':selection.fresh?'new':'front';
  document.querySelector('#section-title').textContent=selection.fresh?'New since your last visit':selection.topic||'The latest';
  const scope=PortalModel.selection(edition.articles,{...selection,query:'',source:''},newIds);
  const publisher=document.querySelector('#publisher-filter');publisher.replaceChildren(element('option','All publishers'));
  publisher.options[0].value='';for(const name of [...new Set(scope.map(row=>row.source))].sort()){const option=element('option',name);option.value=name;publisher.append(option);}
  // Keep the requested publisher visible even if a source has disappeared.
  if(selection.source&&![...publisher.options].some(option=>option.value===selection.source)){const missing=element('option',selection.source+' (unavailable)');missing.value=selection.source;publisher.append(missing);}
  publisher.value=selection.source||'';document.querySelector('#story-search').value=selection.query||'';
  let rows=PortalModel.selection(edition.articles,selection,newIds);
  rows=selection.topic||selection.query||selection.source||selection.fresh?PortalModel.newest(rows):PortalModel.frontPage(rows);
  document.querySelector('#section-summary').textContent=`${rows.length} ${rows.length===1?'story':'stories'} · ${new Set(rows.map(row=>row.source)).size} publishers`;
  const list=document.querySelector('#stories');list.replaceChildren();
  rows.forEach((row,index)=>{
    const article=element('article',undefined,'story');article.style.animationDelay=Math.min(index,8)*35+'ms';
    const link=element('a');link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';
    const kicker=element('div',undefined,'kicker');kicker.append(element('span',row.topic),newIds.has(row.id)?element('span','New','new-badge'):element('span',String(index+1).padStart(2,'0')));
    link.append(kicker,element('h2',row.title));if(row.summary)link.append(element('p',row.summary));
    link.append(element('div',`${row.source} · ${date(row.publishedAt)}${row.cached?' · Cached':''}`,'meta'),element('span',row.kind==='movie'?'View release ↗':'Read original ↗','read'));article.append(link);list.append(article);
  });
  if(!rows.length)list.append(element('p',selection.fresh?visits.previousAt===null?'Your first edition. New stories will be highlighted when you return.':'You are up to date. New arrivals will appear here.':edition.articles.length?'No stories match. Try another publisher or search.':'No stories available yet. Enable and configure Interests or News in the administrator.','empty'));
  document.querySelector('#mark-seen').disabled=!newIds.size;
  document.querySelector('#visit-note').textContent=!visits.available?'New-story tracking is unavailable in this browser.':visits.previousAt!==null?`${newIds.size} new · Previous visit ${date(visits.previousAt)}`:'Your first edition';
}
function dailyPanels(){
  const briefing=document.querySelector('#briefing');briefing.replaceChildren();countdowns=[];
  const symbols={weather:'partly-cloudy-day','hsl-trains':'train',daylight:'wb-twilight','tv-calendar':'tv',tradfri:'lightbulb'};
  for(const panel of edition.day||[]){
    const section=element('section',undefined,'brief brief-'+panel.kind),heading=element('div',undefined,'brief-heading');
    const symbol=element('span',undefined,'material-symbol ms-'+(symbols[panel.kind]||'info'));symbol.setAttribute('aria-hidden','true');
    heading.append(symbol,element('h2',panel.title));section.append(heading,element('strong',panel.primary,'brief-primary'));
    if(panel.secondary){const secondary=element('p',panel.secondary,'brief-secondary');section.append(secondary);if(panel.countdown)countdowns.push({node:secondary,value:panel.countdown});}
    if(panel.details.length){const details=element('dl');for(const row of panel.details){const group=element('div');group.append(element('dt',row.label),element('dd',row.value));details.append(group);}section.append(details);}
    if(panel.cached||panel.receivedAt!==null)section.append(element('p',(panel.cached?'Cached · ':'')+(panel.receivedAt!==null?'Received '+date(panel.receivedAt):panel.status),'brief-freshness'));
    briefing.append(section);
  }
  if(!edition.day?.length)briefing.append(element('p','Daily information appears from the Cards selected in your Today display.','empty'));
  document.querySelector('#today-link').hidden=!edition.briefing;
}
function updateCountdowns(){
  if(document.hidden||!edition||window.getSelection()?.toString())return;
  const now=edition.options.now+performance.now()-editionReceived;
  for(const item of countdowns){const value=PortalModel.countdown(item.value,now);if(item.node.textContent!==value)item.node.textContent=value;}
}
async function load(){
  const button=document.querySelector('#refresh');if(button.disabled)return;button.disabled=true;
  try{
    const response=await fetch('/api/portal',{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();edition=await response.json();editionReceived=performance.now();
    document.body.dataset.theme=edition.options.theme;document.documentElement.style.setProperty('--scale',(edition.options.fontScale||100)/100);
    document.querySelector('#edition-name').textContent=edition.options.name;
    document.querySelector('#date').textContent=new Intl.DateTimeFormat(undefined,{timeZone:edition.options.timeZone,weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(edition.options.now);
    visits.record(edition.articles,edition.options.now);draw();dailyPanels();
    document.querySelector('#sources').replaceChildren(...edition.sources.map(source=>element('p',`${source.name} · Received ${date(source.receivedAt)}`)));
    document.querySelector('#tmdb').hidden=!edition.articles.some(row=>row.kind==='movie');
    document.querySelector('#status').textContent=`${edition.articles.length} stories · Edition refreshed ${date(edition.options.now)}`;
  }catch{document.querySelector('#status').textContent=edition?'Unable to refresh. Showing the previous edition.':'The edition is unavailable. Try Refresh edition.';}finally{button.disabled=false;}
}
document.querySelector('#refresh').onclick=load;
document.querySelector('#story-filters').onsubmit=event=>{event.preventDefault();navigate({...selection,query:document.querySelector('#story-search').value.slice(0,200),source:document.querySelector('#publisher-filter').value});};
document.querySelector('#publisher-filter').onchange=()=>navigate({...selection,source:document.querySelector('#publisher-filter').value});
document.querySelector('#clear-filters').onclick=()=>navigate({...selection,query:'',source:''});
document.querySelector('#mark-seen').onclick=()=>{visits.markSeen(edition.articles,edition.options.now);draw();};
window.addEventListener('popstate',()=>{selection=PortalModel.route(location.search);if(edition)draw();});
// Only the small countdown labels tick. Headlines and scroll position remain
// stable until explicit navigation or Refresh edition; no background requests.
setInterval(updateCountdowns,30000);document.addEventListener('visibilitychange',updateCountdowns);
void load();
