/** Daily selections, an explicit watchlist and optional cached TMDB discovery. */
import {createHash} from 'node:crypto';
import {starter} from './starter.mjs';import {readMovies,genres,preferredGenres} from './provider.mjs';
export function dayKey(at){const date=new Date(at);return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
const validId=id=>typeof id==='string'&&/^(?:starter-[a-z0-9-]{1,60}|tmdb-[1-9]\d{0,10})$/.test(id);
const validMovie=value=>value&&validId(value.id)&&typeof value.title==='string'&&value.title.length<=200&&typeof value.summary==='string'&&value.summary.length<=500&&Array.isArray(value.genres)&&value.genres.length<=15&&value.genres.every(genre=>Object.hasOwn(genres,genre))&&typeof value.url==='string'&&/^https:\/\/(?:en.wikipedia.org\/wiki\/|www.themoviedb.org\/movie\/)/.test(value.url);
export function createMovies({now=Date.now,fetchImpl=(...args)=>fetch(...args)}={}){
  let settings=null;
  const valid=value=>value&&['starter','discover','popular','upcoming'].includes(value.source)&&[15,30,60,120].includes(value['poll-minutes'])&&[6,12,24].includes(value['refresh-hours'])&&typeof value['api-token']==='string'&&value['api-token'].length<=2000&&/^[A-Z]{2}$/.test(value.region)&&/^[a-z]{2}-[A-Z]{2}$/.test(value.language)&&(!value.genre||Object.hasOwn(genres,value.genre))&&preferredGenres(value)!==null&&typeof value['hide-watched']==='boolean'&&(value.source==='starter'||Boolean(value['api-token']));
  function identity(){return createHash('sha256').update(JSON.stringify([settings.source,settings.region,settings.language,preferredGenres(settings).join(','),settings['api-token']])).digest('hex');}
  function check(state){
    for(const [key,max]of [['catalog',30],['searchResults',30],['library',200]])if(state[key]!==undefined&&(!Array.isArray(state[key])||state[key].length>max||state[key].some(item=>!validMovie(item))))throw Error('Saved movie data is invalid; original file retained.');
    for(const list of [state.catalog,state.searchResults,state.library])if(list?.some(item=>['posterPath','backdropPath'].some(key=>item[key]!==undefined&&(typeof item[key]!=='string'||!/^\/[a-zA-Z0-9_-]{1,100}\.jpg$/.test(item[key])))))throw Error('Saved movie artwork metadata is invalid; original file retained.');
    if(state.library?.some(movie=>typeof movie.saved!=='boolean'||typeof movie.watched!=='boolean'))throw Error('Saved movie watchlist is invalid; original file retained.');
    for(const key of ['nextRefresh','blockedUntil','receivedAt'])if(state[key]!==undefined&&(!Number.isFinite(state[key])||state[key]<0))throw Error('Saved movie timing is invalid; original file retained.');
  }
  function project(state,at){
    const source=settings.source==='starter'?starter:state.identity===identity()?state.catalog||[]:[],watched=new Set((state.library||[]).filter(movie=>movie.watched).map(movie=>movie.id));
    const selected=preferredGenres(settings),picks=source.filter(movie=>(!selected.length||selected.some(genre=>movie.genres.includes(genre)))&&(!settings['hide-watched']||!watched.has(movie.id))).map(movie=>({movie,rank:createHash('sha256').update(dayKey(at)+'/'+movie.id).digest('hex')})).sort((a,b)=>a.rank.localeCompare(b.rank)).slice(0,4).map(item=>item.movie);
    state.dailyPicks=picks;state['pick-day']=dayKey(at);state['pick-count']=picks.length;state['more-count']=Math.max(0,picks.length-1);
    state['pick-status']=settings.source==='starter'?'Starter suggestions · availability not checked':state.identity===identity()?(state.sourceStatus||'TMDB metadata'):'Waiting for this source';
    state['saved-count']=(state.library||[]).filter(movie=>movie.saved&&!movie.watched).length;state['watched-count']=(state.library||[]).filter(movie=>movie.watched).length;
    state['received-at']=settings.source==='starter'?at:state.identity===identity()?state.receivedAt??null:null;
    for(let i=0;i<4;i++)for(const [key,value]of Object.entries({title:picks[i]?.title||'',summary:picks[i]?.summary||'',genres:picks[i]?.genres.join(' · ')||'',source:picks[i]?.source||'',year:picks[i]?.year?String(picks[i].year):'',url:picks[i]?.url||'',release:picks[i]?.releaseDate||''}))state[`pick-${i+1}-${key}`]=value;
  }
  return {validateConfiguration:valid,async start(value){if(!valid(value))throw Error('Choose a source and complete Movies Settings.');settings=structuredClone(value);},async stop(){settings=null;},async execute(action,parameters,context){
    context.signal.throwIfAborted();if(!settings)throw Error('Enable Movies first.');const force=action==='refresh-catalogue';if(force)action='refresh';const at=now(),state=await context.readState();check(state);state.library??=[];
    if(action==='library'){
      const id=parameters['movie-id'],operation=parameters.operation;
      const item=[...starter,...(state.identity===identity()?state.catalog||[]:[]),...(state.searchResults||[]),...state.library].find(movie=>movie.id===id);
      if(!item||!['save','remove','watched','unwatched'].includes(operation))throw Error('Choose an available movie first.');
      let entry=state.library.find(movie=>movie.id===id);if(!entry){if(state.library.length>=200)throw Error('The movie library is full. Remove an entry first.');entry={...item,saved:false,watched:false};state.library.push(entry);}
      if(operation==='save')entry.saved=true;if(operation==='remove')entry.saved=false;if(operation==='watched'){entry.watched=true;entry.saved=false;}if(operation==='unwatched'){entry.watched=false;entry.saved=true;}
      state.library=state.library.filter(movie=>movie.saved||movie.watched);project(state,at);await context.saveState(state);return {completed:true};
    }
    if(!['refresh','search'].includes(action))throw Error('Choose a Movies action.');
    const query=String(parameters.query||'').trim().slice(0,100);if(action==='search'&&query&&query.length<2)throw Error('Enter at least two letters.');
    if(action==='search'&&!query){const pool=settings.source==='starter'?starter:state.identity===identity()?state.catalog||[]:[];return {matches:pool.filter(movie=>!preferredGenres(settings).length||preferredGenres(settings).some(genre=>movie.genres.includes(genre))),scope:settings.source==='starter'?'starter':'tmdb'};}
    if(action==='search'&&!settings['api-token'])return {matches:starter.filter(movie=>[movie.title,movie.summary].join(' ').toLowerCase().includes(query.toLowerCase())),scope:'starter'};
    if(action==='refresh'&&settings.source==='starter'){project(state,at);await context.saveState(state);return {completed:true};}
    if(action==='refresh'&&!force&&state.identity===identity()&&(state.nextRefresh||0)>at){project(state,at);await context.saveState(state);return {completed:true,cached:true};}
    if((state.blockedUntil||0)>at){if(action==='search')throw Error('Movie search is cooling down. Try again later.');project(state,at);await context.saveState(state);return {completed:true,cached:true};}
    state.blockedUntil=at+1500;await context.saveState(state);const signal=AbortSignal.any([context.signal,AbortSignal.timeout(15000)]);
    try{const movies=await readMovies(settings,action==='search'?query:'',signal,fetchImpl);signal.throwIfAborted();
      if(action==='search'){state.searchResults=movies;await context.saveState(state);return {matches:movies,scope:'tmdb'};}
      state.catalog=movies;state.identity=identity();state.receivedAt=at;state.nextRefresh=at+settings['refresh-hours']*3600000;state.sourceStatus='TMDB metadata · streaming availability not checked';project(state,at);await context.saveState(state);return {completed:true};
    }catch(error){context.signal.throwIfAborted();state.blockedUntil=at+(error.retryMs||900000);state.sourceStatus='Cached · movie source unavailable';project(state,at);await context.saveState(state);throw Error(error.status===401?'TMDB did not accept the token. Check Movies Settings.':'Movie source unavailable. Saved movies and cached listings are retained.');}
  }};
}
export default createMovies();
