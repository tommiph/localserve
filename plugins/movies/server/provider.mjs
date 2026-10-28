/** TMDB's official metadata API; credentials never enter URLs or returned rows. */
export const genres={'Science-Fiction':878,Drama:18,Comedy:35,Thriller:53,Fantasy:14,Action:28,Mystery:9648,Adventure:12,Animation:16,Crime:80,Documentary:99,Family:10751,History:36,Horror:27,Romance:10749};
/** An absent multi-choice setting retains the existing single preference. */
export function preferredGenres(settings){
  const value=settings.genres===undefined?settings.genre||'':settings.genres;
  if(typeof value!=='string'||value.length>250)return null;
  const selected=value?value.split(','):[];
  return selected.every(name=>Object.hasOwn(genres,name))&&new Set(selected).size===selected.length?selected.sort():null;
}
const plain=(value,max=500)=>String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
export function movie(value){
  if(!Number.isSafeInteger(value?.id)||value.id<=0||!plain(value.title,200)||value.adult===true)return null;
  const releaseDate=/^\d{4}-\d{2}-\d{2}$/.test(value.release_date||'')?value.release_date:'';
  const artwork={};for(const [field,key]of [['posterPath','poster_path'],['backdropPath','backdrop_path']])if(typeof value[key]==='string'&&/^\/[a-zA-Z0-9_-]{1,100}\.jpg$/.test(value[key]))artwork[field]=value[key];
  return {id:'tmdb-'+value.id,title:plain(value.title,200),year:releaseDate?Number(releaseDate.slice(0,4)):null,genres:Object.entries(genres).filter(([,id])=>value.genre_ids?.includes(id)).map(([label])=>label),summary:plain(value.overview),url:'https://www.themoviedb.org/movie/'+value.id,source:'TMDB',releaseDate,rating:Number.isFinite(value.vote_average)&&value.vote_average>=0&&value.vote_average<=10?value.vote_average:null,...artwork};
}
export async function readMovies(settings,query,signal,fetchImpl=fetch){
  if(!settings['api-token'])throw Error('Add your TMDB API read access token in Settings.');
  const path=query?'/search/movie':settings.source==='upcoming'?'/movie/upcoming':settings.source==='popular'?'/movie/popular':'/discover/movie';
  const url=new URL('https://api.themoviedb.org/3'+path);url.searchParams.set('language',settings.language);url.searchParams.set('include_adult','false');url.searchParams.set('page','1');url.searchParams.set('region',settings.region);
  if(query)url.searchParams.set('query',query);
  if(path==='/discover/movie'){url.searchParams.set('sort_by','popularity.desc');url.searchParams.set('include_video','false');url.searchParams.set('vote_count.gte','100');url.searchParams.set('primary_release_date.lte',new Date().toISOString().slice(0,10));const selected=preferredGenres(settings);if(!selected)throw Error('Choose valid movie genres.');if(selected.length)url.searchParams.set('with_genres',selected.map(name=>genres[name]).join('|'));}
  const response=await fetchImpl(url.href,{signal,redirect:'error',headers:{Accept:'application/json',Authorization:'Bearer '+settings['api-token'],'User-Agent':'Sormus-Movies/1.0'}});
  if(!response.ok){await response.body?.cancel();const error=Error(response.status===401?'TMDB did not accept the token. Check Movies Settings.':'TMDB is unavailable. Cached movie information is retained.');error.status=response.status;error.retryMs=response.status===429?Math.min(86400000,Math.max(900000,Number(response.headers.get('retry-after'))*1000||900000)):900000;throw error;}
  if(!response.body)throw Error('TMDB returned no metadata.');
  const reader=response.body.getReader(),chunks=[];let length=0,complete=false;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;break;}length+=part.value.byteLength;if(length>1048576)throw Error('Movie response exceeds its limit.');chunks.push(part.value);}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!Array.isArray(data.results))throw Error('Invalid TMDB movie list.');return data.results.slice(0,30).map(movie).filter(Boolean);
  }finally{signal.removeEventListener('abort',abort);if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
}
