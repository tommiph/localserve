/** Provider adapters return attributed metadata, never article page contents. */
import {createHash} from 'node:crypto';
import {providers} from './catalogue.mjs';
import {parseSyndication} from './feed.mjs';
export {providers};
export const plain=(value,max=400)=>String(value??'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&[a-z#0-9]+;/gi,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
export function safeLink(value){try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.href.length>1200)return null;url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key))url.searchParams.delete(key);return url.href;}catch{return null;}}
export function item({title,url,summary='',publishedAt=null,source,kind='article',releaseDate=''}){
  const link=safeLink(url),name=plain(title,200);if(!link||!name)return null;
  const description=plain(summary);
  return {id:createHash('sha256').update(link).digest('hex').slice(0,32),title:name,url:link,summary:/^(null|undefined)$/i.test(description)?'':description,source:plain(source,80),kind,
    publishedAt:Number.isFinite(publishedAt)?publishedAt:null,releaseDate:/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)?releaseDate:''};
}
export function parseFeed(xml,source){return parseSyndication(xml,source,item);}
export async function read(url,signal,fetchImpl,headers={}){
  const allowed=new Set(Object.values(providers).filter(source=>source.url).map(source=>new URL(source.url).hostname));
  const address=new URL(url);if(address.protocol!=='https:'||!allowed.has(address.hostname)||address.port||address.username||address.password)throw Error('Unsupported Interests provider.');
  const response=await fetchImpl(address.href,{signal,redirect:'error',headers:{Accept:'application/json, application/rss+xml, application/atom+xml, application/xml','User-Agent':'Sormus-Interests/1.0',...headers}});
  if(!response.ok){const error=Error('Provider unavailable.');error.status=response.status;const retry=response.headers.get('retry-after');error.retryMs=Math.min(86400000,Math.max(900000,/^\d+$/.test(retry||'')?Number(retry)*1000:Date.parse(retry)-Date.now()||900000));await response.body?.cancel();throw error;}
  if(!response.body)throw Error('Empty provider response.');const reader=response.body.getReader(),chunks=[];let size=0,done=false;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){done=true;break;}size+=part.value.byteLength;if(size>1048576)throw Error('Provider response exceeds1MiB.');chunks.push(part.value);}return Buffer.concat(chunks).toString('utf8');}
  finally{signal.removeEventListener('abort',abort);if(!done)await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function sourceItems(provider,settings,signal,fetchImpl){
  const source=providers[provider];if(!source||source.kind==='digest')throw Error('Choose a source.');
  let url=source.url,headers={};
  if(source.kind==='movies'){
    if(!settings['tmdb-token'])throw Error('Add your TMDB API read access token in Settings to use movie releases.');
    headers.Authorization='Bearer '+settings['tmdb-token'];url+='?region='+settings['movie-region']+'&language='+settings['movie-language'];
  }
  const raw=await read(url,signal,fetchImpl,headers);if(source.kind==='rss')return parseFeed(raw,source.name);
  if(source.kind==='trends')return parseSyndication(raw,source.name,value=>{
    const link=new URL('https://trends.google.com/trends/explore');link.searchParams.set('geo',source.geo);link.searchParams.set('q',plain(value.title,200));
    return item({...value,url:link.href,summary:(value.traffic?'Approximate search traffic: '+plain(value.traffic,40)+' · ':'')+source.country});
  });
  const data=JSON.parse(raw);
  if(source.kind==='hn'){
    if(!Array.isArray(data)||data.slice(0,12).some(id=>!Number.isSafeInteger(id)||id<1))throw Error('Invalid Hacker News list.');
    const result=[];
    // Twelve finite reads, in small batches; comments and article pages are never fetched.
    for(let i=0;i<Math.min(12,data.length);i+=3){signal.throwIfAborted();const batch=await Promise.all(data.slice(i,i+3).map(id=>read(`https://hacker-news.firebaseio.com/v0/item/${id}.json`,signal,fetchImpl).then(JSON.parse)));for(const story of batch)if(story&&!story.deleted&&!story.dead&&story.type==='story')result.push(item({title:story.title,url:story.url,source:source.name,publishedAt:Number(story.time)*1000}));}return result.filter(Boolean);
  }
  if(!Array.isArray(data.results))throw Error('Invalid provider list.');
  return data.results.slice(0,30).filter(value=>value&&Number.isSafeInteger(value.id)&&value.id>0).map(value=>source.kind==='space'?item({title:value.title,url:value.url,summary:value.summary,publishedAt:Date.parse(value.published_at),source:value.news_site||source.name}):item({title:value.title,url:'https://www.themoviedb.org/movie/'+value.id,summary:value.overview,source:source.name,kind:'movie',releaseDate:value.release_date})).filter(Boolean);
}
