/** The viewing guide reads cached public metadata and never starts playback. */
'use strict';
const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;};
let view=null;
function itemLink(item){
  try{const url=new URL(item.url);if(item.source==='Emby library'&&/^127\./.test(url.hostname)){
    const host=location.hostname,parts=host.split('.').map(Number),[a,b]=parts;
    if(parts.length===4&&parts.every(value=>Number.isInteger(value)&&value>=0&&value<=255)&&(a===10||a===192&&b===168||a===172&&b>=16&&b<=31))url.hostname=host;
  }return url.href;}catch{return item.url;}
}
function picks(host,items){
  host.replaceChildren();for(const item of items){const article=node('article',undefined,'watch-tile'),link=node('a');link.href=itemLink(item);link.target='_blank';link.rel='noopener noreferrer';
    if(/^\/api\/watch-art\/(movies|emby)\/[a-f0-9]{40}\/poster\.jpg$/.test(item.artwork?.poster||'')){const poster=node('img',undefined,'watch-poster');poster.alt='';poster.loading='lazy';poster.src=item.artwork.poster;poster.onerror=()=>{poster.remove();article.classList.remove('watch-has-poster');};link.append(poster);article.classList.add('watch-has-poster');}
    link.append(node('small',[item.year,item.genres].filter(Boolean).join(' · ')),node('h3',item.title),node('p',item.summary),node('p',item.source),node('span','Details ↗','read'));article.append(link);host.append(article);}
  if(!items.length)host.append(node('p','No suggestions are available in this selection.','watch-empty'));
}
async function refresh(){
  const button=document.querySelector('#watch-refresh');if(button.disabled)return;button.disabled=true;
  try{const response=await fetch('/api/watch-guide',{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();view=await response.json();
    document.body.dataset.theme=view.options.theme;document.documentElement.style.setProperty('--scale',(view.options.fontScale||100)/100);document.title=`What to watch · ${view.options.name}`;
    const format={timeZone:view.options.timeZone};document.querySelector('#watch-date').textContent=new Intl.DateTimeFormat(undefined,{...format,dateStyle:'full'}).format(view.options.now);
    document.querySelector('#tv-note').textContent=view.tv.note||'Daily discovery suggestions. Availability is not verified.';document.querySelector('#movie-note').textContent=view.movies.note||'Movie suggestions will appear here when available.';
    picks(document.querySelector('#tv-picks'),view.tv.picks);picks(document.querySelector('#movie-picks'),view.movies.picks);
    document.querySelector('#library-note').textContent=view.emby?.note||'Configure Emby library suggestions in the administrator.';picks(document.querySelector('#library-picks'),view.emby?.picks||[]);
    const episodes=document.querySelector('#episode-list');episodes.replaceChildren();for(const episode of view.tv.episodes){const row=node('article',undefined,'watch-episode'),description=node('div');description.append(node('h3',episode.show),node('p',episode.title));row.append(description,node('time',new Intl.DateTimeFormat(undefined,{...format,dateStyle:'medium',timeStyle:'short',hourCycle:view.options.timeFormat==='12'?'h12':'h23'}).format(episode.at)));episodes.append(row);}
    if(!view.tv.episodes.length)episodes.append(node('p','No upcoming episodes are currently listed.','watch-empty'));
    document.querySelector('#watch-status').textContent=`${view.tv.picks.length} TV picks · ${view.movies.picks.length} movie picks · ${view.emby?.picks?.length||0} Emby picks · ${view.tv.episodes.length} upcoming episodes`;
  }catch{document.querySelector('#watch-status').textContent=view?'Unable to refresh. Showing the previous guide.':'The guide is unavailable. Try Refresh guide.';}finally{button.disabled=false;}
}
document.querySelector('#watch-refresh').onclick=refresh;void refresh();
