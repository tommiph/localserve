/** Fixed-origin TVmaze reads. Provider markup is reduced to bounded plain text. */
export const text=(value,limit=160)=>String(value??'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&[a-z#0-9]+;/gi,' ').replace(/\s+/g,' ').trim().slice(0,limit);
export const validId=value=>typeof value==='string'&&/^[1-9]\d{0,8}$/.test(value);
export async function readTvmaze(route,signal,fetchImpl=fetch){
  if(!/^\/schedule(?:\/web)?\?country=(?:US|GB|FI|)\&date=\d{4}-\d{2}-\d{2}$/.test(route)&&!/^\/search\/shows\?q=/.test(route)&&!/^\/shows\/[1-9]\d{0,8}\?embed=episodes$/.test(route))throw Error('Unsupported TVmaze resource.');
  const response=await fetchImpl('https://api.tvmaze.com'+route,{signal,redirect:'error',headers:{Accept:'application/json','User-Agent':'Sormus-TV-Calendar/1.0'}});
  if(!response.ok){
    const retry=response.headers.get('retry-after');await response.body?.cancel();
    const error=Error('TVmaze request failed.');error.status=response.status;
    const seconds=/^\d+$/.test(retry||'')?Number(retry):null;
    error.retryMs=Math.min(86400000,Math.max(60000,seconds===null?(Date.parse(retry)-Date.now()||900000):seconds*1000));
    throw error;
  }
  if(!response.body)throw Error('TVmaze returned no data.');
  const reader=response.body.getReader(),chunks=[];let size=0,complete=false;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{
    for(;;){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();if(done){complete=true;break;}size+=value.byteLength;if(size>3*1024*1024)throw Error('TVmaze response is too large.');chunks.push(value);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }finally{signal.removeEventListener('abort',abort);if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function showSummary(show){
  if(!show||!validId(String(show.id)))throw Error('Invalid TVmaze show.');
  return {id:String(show.id),name:text(show.name,100),status:text(show.status,40),network:text(show.network?.name||show.webChannel?.name,80),
    country:text(show.network?.country?.name||show.webChannel?.country?.name,60),premiered:text(show.premiered,10),
    genres:Array.isArray(show.genres)?show.genres.slice(0,8).map(genre=>text(genre,40)):[],language:text(show.language,40),type:text(show.type,40),summary:text(show.summary,500),url:'https://www.tvmaze.com/shows/'+show.id};
}
export function episodes(show,now){
  if(!Array.isArray(show?._embedded?.episodes))throw Error('TVmaze did not return an episode list.');
  const result=[],seen=new Set();
  for(const item of show._embedded.episodes){
    const id=String(item?.id);if(!validId(id)||seen.has(id))continue;seen.add(id);
    const at=Date.parse(item.airstamp),date=/^\d{4}-\d{2}-\d{2}$/.test(item.airdate||'')?item.airdate:'';
    result.push({id,title:text(item.name,140),season:Number.isInteger(item.season)?item.season:0,
      number:Number.isInteger(item.number)?item.number:0,at:Number.isFinite(at)?at:null,date,
      url:'https://www.tvmaze.com/episodes/'+id});
  }
  const sort=(a,b)=>(a.at??(Date.parse(a.date)||0))-(b.at??(Date.parse(b.date)||0))||Number(a.id)-Number(b.id);
  const past=result.filter(item=>item.at!==null&&item.at<now).sort(sort).slice(-50);
  const future=result.filter(item=>item.at!==null&&item.at>=now).sort(sort).slice(0,50);
  const undated=result.filter(item=>item.at===null).slice(-10);
  return {items:[...past,...future,...undated],limited:result.length>past.length+future.length+undated.length,total:result.length};
}
