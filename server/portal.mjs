/** Reader projection: public headlines and the selected Today display only.
 * Reading this page never polls providers, creates Events or runs commands. */
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {portalBriefing} from './portal-briefing.mjs';
const plain=(value,max=500)=>String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
export function portalLink(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.href.length<=1600?url.href:null;}catch{return null;}}
/** Only token-free item links to a private Emby web client are admitted. */
export function embyLibraryLink(value){
  try{const url=new URL(value),[a,b]=url.hostname.split('.').map(Number),local=isIP(url.hostname)===4&&(a===10||a===127||a===192&&b===168||a===172&&b>=16&&b<=31);
    return local&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&url.pathname==='/web/index.html'&&/^#!\/item\?id=[a-zA-Z0-9-]{1,80}$/.test(url.hash)?url.href:null;
  }catch{return null;}
}
/** The viewing guide copies only declared public suggestion and episode fields. */
export function watchGuideView(registry,options,now=Date.now(),artwork=null){
  function guide(id){
    const source=registry.cardSource(id),values=source?.cardData?.values||{};
    const read=key=>values[key]?.available?values[key].value:undefined,picks=[],images=artwork?.choices(id)||[];
    for(let i=1;i<=4;i++){
      const title=plain(read(`pick-${i}-title`),200),url=id==='emby'?embyLibraryLink(read(`pick-${i}-url`)):portalLink(read(`pick-${i}-url`));if(!title||!url)continue;
      const art=artwork?.describe(id,title,images);picks.push({title,url,summary:plain(read(`pick-${i}-summary`)),genres:plain(read(`pick-${i}-genres`),160),year:plain(read(`pick-${i}-year`),4),source:plain(read(`pick-${i}-${id==='tv-calendar'?'network':'source'}`),100),...(art?{artwork:art}:{})});
    }
    const episodes=id==='tv-calendar'?(Array.isArray(read('upcoming'))?read('upcoming'):[]).filter(row=>Number.isFinite(row.at)&&row.at>=now).slice(0,6).map(row=>({show:plain(row.show,100),title:plain(row.title,140),at:row.at})):[];
    return {picks,episodes,day:plain(read(id==='emby'?'library-day':'pick-day'),10),note:plain(read(id==='emby'?'library-note':'pick-status'),200),status:id==='emby'?plain(read('library-poll-status'),120)||source?.cardData?.status||'Unavailable':source?.cardData?.status||'Unavailable'};
  }
  return {tv:guide('tv-calendar'),movies:guide('movies'),emby:guide('emby'),options:{name:plain(options.name,64),theme:options.theme,fontScale:options.fontScale,timeFormat:options.timeFormat,timeZone:new Intl.DateTimeFormat().resolvedOptions().timeZone,now}};
}
export function portalView(registry,vistas,options,now=Date.now()){
  const articles=[],seen=new Set(),sources=[];
  function add(row,topic,received,status){
    const url=portalLink(row.url),title=plain(row.title,200);if(!url||!title||seen.has(url)||articles.length>=150)return;seen.add(url);
    articles.push({id:createHash('sha256').update(url).digest('hex').slice(0,32),title,url,summary:plain(row.summary),source:plain(row.source,100),topic:plain(topic,60),publishedAt:Number.isFinite(row.publishedAt)?row.publishedAt:null,receivedAt:Number.isFinite(received)?received:null,cached:status!=='Ready'||!Number.isFinite(received)||now-received>86400000,kind:row.kind==='movie'?'movie':'article'});
  }
  for(const id of ['interests','news']){
    let record;try{record=registry.get(id);}catch{continue;}
    const config=record.config.snapshot();if(!config.enabled)continue;const state=record.state.snapshot();
    if(id==='interests')for(const topic of config.settings.topics.filter(item=>item.enabled&&item.provider!=='digest')){
      const reading=state.topics?.[topic.id],identity=createHash('sha256').update(JSON.stringify([topic.provider,topic.include,topic.exclude,topic['age-days']])).digest('hex');
      if(!reading||reading.identity!==identity)continue;
      sources.push({name:plain(topic.name,60),receivedAt:reading['received-at']||null});
      for(const item of (reading.items||[]).slice(0,10))add(item,topic.name,reading['received-at'],record.health==='ready'?reading['poll-status']:'Unavailable');
    }
    if(id==='news')for(const search of config.settings.searches.filter(item=>item.enabled)){
      const reading=state.searches?.[search.id];if(!reading||reading['requested-query']!==search.query)continue;
      sources.push({name:plain(search.name,60),receivedAt:reading['updated-at']||null});
      for(let i=1;i<=10;i++)add({title:reading[`article-${i}-title`],url:reading[`article-${i}-link`],source:reading[`article-${i}-publisher`]||reading['feed-title'],publishedAt:reading[`article-${i}-published-at`]},search.name,reading['updated-at'],record.health==='ready'?'Ready':'Unavailable');
    }
  }
  articles.sort((a,b)=>(b.publishedAt||0)-(a.publishedAt||0));
  let briefing=null;try{briefing=vistas.viewer('today');}catch{/* Today is optional. */}
  return {articles,sources,briefing,day:portalBriefing(briefing,now),options:{name:plain(options.name,64),theme:options.theme,fontScale:options.fontScale,timeFormat:options.timeFormat,timeZone:new Intl.DateTimeFormat().resolvedOptions().timeZone,now}};
}
