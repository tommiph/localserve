/** Watchlist cache, watched history and once-only scheduled episode Events. */
import {suggestions,checkedOn} from './suggestions.mjs';
import {projectTvPicks,preferredGenres} from './daily.mjs';
import {readTvmaze,showSummary,episodes,text,validId} from './client.mjs';

export function createTvCalendar({fetchImpl=(...args)=>fetch(...args),now=Date.now}={}){
  let settings=null,startedAt=0;
  function valid(value){return value&&[1,2,5].includes(value['poll-minutes'])&&[6,12,24].includes(value['refresh-hours'])&&preferredGenres(value)!==null&&Array.isArray(value.shows)&&value.shows.length<=20&&value.shows.every(show=>validId(show['tvmaze-id'])&&typeof show.enabled==='boolean');}
  function stateCheck(state){
    if(state.watched!==undefined&&(!Array.isArray(state.watched)||state.watched.length>10000||state.watched.some(id=>!validId(id))))throw Error('Saved watched history is invalid; original file retained.');
    if(state.emitted!==undefined&&(!Array.isArray(state.emitted)||state.emitted.length>5000||state.emitted.some(item=>!item||!validId(item.id)||!Number.isFinite(item.at))))throw Error('Saved episode claims are invalid; original file retained.');
    if(state.shows!==undefined&&(!state.shows||typeof state.shows!=='object'||Array.isArray(state.shows)||Object.keys(state.shows).length>20))throw Error('Saved show cache is invalid; original file retained.');
    for(const value of ['checked-at','nextRequestAt','blockedUntil'])if(state[value]!==undefined&&(!Number.isFinite(state[value])||state[value]<0))throw Error('Saved episode timing is invalid; original file retained.');
    for(const [id,show]of Object.entries(state.shows||{}))if(!validId(id)||show?.id!==id||typeof show.name!=='string'||!Array.isArray(show.episodes)||show.episodes.length>110||!Number.isFinite(show.receivedAt)||show.episodes.some(episode=>!validId(episode.id)||typeof episode.title!=='string'||episode.at!==null&&!Number.isFinite(episode.at)))throw Error('Saved show cache is invalid; original file retained.');
  }
  function project(state,at){
    projectTvPicks(settings,state,at);
    const enabled=settings.shows.filter(show=>show.enabled),allowed=new Set(settings.shows.map(show=>show['tvmaze-id']));
    state.shows=Object.fromEntries(Object.entries(state.shows||{}).filter(([id])=>allowed.has(id)));
    const active=new Set(enabled.map(show=>show['tvmaze-id']));
    const rows=Object.values(state.shows).filter(show=>active.has(show.id)).flatMap(show=>(show.episodes||[]).filter(episode=>episode.at!==null&&episode.at>=at).map(episode=>({...episode,show:show.name,network:show.network}))).sort((a,b)=>a.at-b.at||Number(a.id)-Number(b.id)).slice(0,10);
    state['row-count']=rows.length;state['show-count']=enabled.length;state['watched-count']=(state.watched||[]).length;
    state['next-show']=rows[0]?.show||'';state['next-title']=rows[0]?.title||'';state['next-at']=rows[0]?.at??null;
    for(let index=0;index<10;index++){const row=rows[index];for(const [key,value]of Object.entries({show:row?.show||'',title:row?.title||'',code:row?`S${String(row.season).padStart(2,'0')}E${String(row.number).padStart(2,'0')}`:'',at:row?.at??null,network:row?.network||''}))state[`episode-${index+1}-${key}`]=value;}
    // Worker and server share the host timezone. Tonight is a documented local
    // wall-clock window, so DST changes do not turn it into a fixed UTC offset.
    const start=new Date(at);start.setHours(16,0,0,0);
    const end=new Date(start);end.setDate(end.getDate()+1);end.setHours(6,0,0,0);
    const tonight=Object.values(state.shows).filter(show=>active.has(show.id)).flatMap(show=>show.episodes.filter(episode=>episode.at>=start.getTime()&&episode.at<end.getTime()).map(episode=>({...episode,show:show.name}))).sort((a,b)=>a.at-b.at).slice(0,10);
    state['tonight-count']=tonight.length;state['tonight-show']=tonight[0]?.show||'';state['tonight-title']=tonight[0]?.title||'';state['tonight-at']=tonight[0]?.at??null;
    for(let i=0;i<10;i++)for(const [key,value]of Object.entries({show:tonight[i]?.show||'',title:tonight[i]?.title||'',at:tonight[i]?.at??null}))state[`tonight-${i+1}-${key}`]=value;
  }
  return {
    validateConfiguration:valid,
    async start(value){if(!valid(value))throw Error('Check the TV Calendar settings.');settings=structuredClone(value);startedAt=now();},
    async stop(){settings=null;},
    async execute(action,parameters,context){
      context.signal.throwIfAborted();if(!settings)throw Error('Enable TV Calendar first.');
      const at=now(),state=await context.readState();stateCheck(state);state.shows??={};state.watched??=[];state.emitted??=[];
      const enabled=settings.shows.filter(show=>show.enabled);
      if(action==='set-watched'){
        const id=parameters['episode-id'];if(!Object.values(state.shows).some(show=>show.episodes?.some(episode=>episode.id===id)))throw Error('Refresh this show before changing its watched status.');
        const watched=new Set(state.watched);parameters.watched?watched.add(id):watched.delete(id);
        if(watched.size>10000)throw Error('Watched history is full. Unmark older entries before adding more.');
        state.watched=[...watched];project(state,at);await context.saveState(state);return {completed:true};
      }
      if(!['lookup-show','refresh','refresh-show'].includes(action))throw Error('Choose a TV Calendar action.');
      // Check only the current active interval. Startup, long pauses and first
      // metadata reads never produce a backlog of old episode notifications.
      const last=state['checked-at']??at;
      const from=at-last>settings['poll-minutes']*90000?at:Math.max(startedAt,last);
      const claims=new Set(state.emitted.map(item=>item.id)),events=[];
      if(action==='refresh'){
        for(const config of enabled){const show=state.shows[config['tvmaze-id']];if(!show||at-show.receivedAt>90000000)continue;
          for(const episode of show.episodes||[])if(episode.at>from&&episode.at<=at&&!claims.has(episode.id)){
            claims.add(episode.id);state.emitted.push({id:episode.id,at});
            if(events.length<20)events.push({'show-id':show.id,'show-name':show.name,'episode-id':episode.id,'episode-title':episode.title,season:episode.season,number:episode.number,'air-at':episode.at,network:show.network,url:episode.url});
          }
        }
        state.emitted=state.emitted.filter(item=>item.at>at-90*86400000).slice(-5000);state['checked-at']=at;
        project(state,at);await context.saveState(state);
        for(const event of events){context.signal.throwIfAborted();await context.emit('episode-airing',event);}
      }
      const target=action==='lookup-show'?null:action==='refresh-show'?enabled.find(show=>show['tvmaze-id']===parameters['show-id']):enabled.find(show=>!state.shows[show['tvmaze-id']]||(state.shows[show['tvmaze-id']].nextCheck||0)<=at);
      if(action==='refresh-show'&&!target)throw Error('Choose an enabled followed show.');
      if(action==='refresh'&&!target)return {completed:true,cached:true};
      const curated=action==='lookup-show'&&!text(parameters.query,100)&&(parameters.source||'suggested')==='suggested';
      if(curated){
        const genre=text(parameters.genre,40),status=text(parameters.status,40);
        return {matches:suggestions.filter(show=>(!genre||show.genres.some(value=>value.toLowerCase()===genre.toLowerCase()))&&(!status||show.status===status)),scope:'suggested',checkedOn};
      }
      if((state.blockedUntil||0)>at||(state.nextRequestAt||0)>at){if(action==='refresh')return {completed:true,cached:true};throw Error('TVmaze is cooling down. Try again later.');}
      const query=text(parameters.query,100),genre=text(parameters.genre,40),status=text(parameters.status,40);
      const sources={suggested:'','tv-us':'US','tv-gb':'GB','tv-fi':'FI',streaming:''};
      const source=parameters.source||'suggested';
      if(action==='lookup-show'&&(query&&query.length<2||!Object.hasOwn(sources,source)))throw Error('Enter at least two letters or browse shows airing today.');
      // Genre discovery is scoped to today's broadcast or streaming schedule.
      // Title searches use the provider's global fuzzy-name search instead.
      const today=new Date(at),date=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
      const lookupRoute=query?'/search/shows?q='+encodeURIComponent(query):'/schedule'+(source==='streaming'?'/web':'')+'?country='+sources[source]+'&date='+date;
      state.nextRequestAt=at+1500;await context.saveState(state);
      const signal=AbortSignal.any([context.signal,AbortSignal.timeout(15000)]);
      let data;
      try{data=await readTvmaze(action==='lookup-show'?lookupRoute:'/shows/'+target['tvmaze-id']+'?embed=episodes',signal,fetchImpl);signal.throwIfAborted();}
      catch(error){
        context.signal.throwIfAborted();if(error.status===429)state.blockedUntil=at+error.retryMs;
        if(target&&state.shows[target['tvmaze-id']])state.shows[target['tvmaze-id']].nextCheck=at+900000;
        state.nextRequestAt=Math.max(at+900000,state.blockedUntil||0);state['poll-status']='Unavailable; cached listings retained';await context.saveState(state);
        throw Error('TVmaze could not be reached. Cached listings are retained; no request was retried.');
      }
      if(action==='lookup-show'){
        if(!Array.isArray(data))throw Error('TVmaze returned invalid search results.');
        const matches=[],seen=new Set();
        for(const item of data){
          const raw=query?item.show:item.show||item._embedded?.show;
          if(!raw||!validId(String(raw.id))||seen.has(String(raw.id)))continue;
          seen.add(String(raw.id));const show=showSummary(raw);
          if(genre&&!show.genres.some(value=>value.toLowerCase()===genre.toLowerCase())||status&&show.status!==status)continue;
          matches.push(show);if(matches.length===100)break;
        }
        return {matches,scope:query?'title':'schedule',date,limited:matches.length===100};
      }
      const show=showSummary(data);if(show.id!==target['tvmaze-id'])throw Error('TVmaze returned a different show.');
      const episodeList=episodes(data,at);
      state.shows[show.id]={...show,episodes:episodeList.items,limited:episodeList.limited,total:episodeList.total,receivedAt:at,nextCheck:at+settings['refresh-hours']*3600000};
      state['received-at']=at;state['poll-status']='Ready';project(state,at);await context.saveState(state);
      return {completed:true,show:show.name};
    },
  };
}
export default createTvCalendar();
