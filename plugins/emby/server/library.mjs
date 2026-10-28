/** Daily movie picks use only bounded library metadata, never playback commands. */
import {createHash} from 'node:crypto';
const names=['Science-Fiction','Drama','Comedy','Thriller','Fantasy','Action','Mystery','Adventure','Animation','Crime','Documentary','Family','History','Horror','Romance'];
const plain=(value,max=500)=>String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const genreKey=value=>value.toLowerCase().replace(/[^a-z]/g,'').replace(/^scifi$/,'sciencefiction');
export function libraryOptions(settings){
  const text=settings['library-genres']??'',genres=typeof text==='string'&&text.length<=250?(text?text.split(','):[]):null;
  const hours=settings['library-hours']??6,limit=settings['library-limit']??100,enabled=settings['library-suggestions']??false,monitor=settings['monitor-playback']??true;
  return genres&&genres.every(name=>names.includes(name))&&new Set(genres).size===genres.length&&[6,12,24].includes(hours)&&[50,100,200].includes(limit)&&typeof enabled==='boolean'&&typeof monitor==='boolean'?{genres,hours,limit,enabled,monitor}:null;
}
export function libraryIdentity(config,options){return createHash('sha256').update(JSON.stringify([config.url,config.token,options.limit])).digest('hex');}
export function checkLibrary(state){
  const library=state.library;if(library===undefined)return;
  if(Array.isArray(library?.items)&&library.items.some(item=>item&&['posterTag','backdropTag'].some(key=>item[key]!==undefined&&(typeof item[key]!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(item[key])))))throw Error('Saved Emby artwork metadata is invalid; original data retained.');
  if(!library||typeof library!=='object'||Array.isArray(library)||typeof library.identity!=='string'||!/^[a-f0-9]{64}$/.test(library.identity)||!Number.isSafeInteger(library.total)||library.total<0||!Array.isArray(library.items)||library.items.length>200||library.items.some(item=>!item||typeof item.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(item.id)||typeof item.title!=='string'||item.title.length>200||typeof item.summary!=='string'||item.summary.length>500||!Array.isArray(item.genres)||item.genres.length>15||item.genres.some(genre=>typeof genre!=='string'||genre.length>60)||item.year!==null&&(!Number.isInteger(item.year)||item.year<1000||item.year>9999))||['receivedAt','nextRefresh','nextAllowed'].some(key=>library[key]!==undefined&&(!Number.isFinite(library[key])||library[key]<0)))throw Error('Saved Emby library metadata is invalid; original data retained.');
}
export function normalizeLibrary(value,limit){
  if(!value||!Array.isArray(value.Items)||value.Items.length>limit)throw Error('Invalid Emby movie library response.');
  const seen=new Set(),items=[];
  for(const row of value.Items){
    const id=String(row?.Id??''),title=plain(row?.Name,200);if(row?.Type!=='Movie'||row.IsFolder===true||!title||!/^[a-zA-Z0-9-]{1,80}$/.test(id)||seen.has(id))continue;seen.add(id);
    const year=Number.isInteger(row.ProductionYear)?row.ProductionYear:/^\d{4}-\d{2}-\d{2}/.test(row.PremiereDate||'')?Number(row.PremiereDate.slice(0,4)):null;
    const artwork={};for(const [key,tag]of [['posterTag',row.ImageTags?.Primary],['backdropTag',row.BackdropImageTags?.[0]]])if(typeof tag==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(tag))artwork[key]=tag;
    items.push({id,title,year:year>=1000&&year<=9999?year:null,genres:[...new Set((Array.isArray(row.Genres)?row.Genres:[]).slice(0,15).map(genre=>plain(genre,60)).filter(Boolean))],summary:plain(row.Overview),...artwork});
  }
  return {items,total:Number.isSafeInteger(value.TotalRecordCount)&&value.TotalRecordCount>=items.length?value.TotalRecordCount:items.length};
}
export function projectLibrary(state,config,options,at){
  const library=state.library,available=options.enabled&&library?.identity===libraryIdentity(config,options),date=new Date(at),day=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  const selected=available?library.items.filter(movie=>!options.genres.length||movie.genres.some(genre=>options.genres.some(name=>genreKey(name)===genreKey(genre)))).map(movie=>({movie,rank:createHash('sha256').update(day+'/'+movie.id).digest('hex')})).sort((a,b)=>a.rank.localeCompare(b.rank)).slice(0,4).map(({movie})=>movie):[];
  const base=new URL(config.url);base.pathname='/web/index.html';base.search='';base.hash='';
  state.libraryPicks=selected.map(movie=>({...movie,source:'Emby library',url:base.href+'#!/item?id='+encodeURIComponent(movie.id)}));
  state['library-day']=day;state['library-pick-count']=selected.length;state['library-more-count']=Math.max(0,selected.length-1);state['library-total']=available?library.total:0;state['library-cached-count']=available?library.items.length:0;
  state['library-received-at']=available?library.receivedAt??null:null;state['library-poll-status']=!options.enabled?'Library suggestions off':available?library.status||'Ready':'Waiting for library';
  state['library-note']=!options.enabled?'Enable library suggestions in Emby Settings.':available?`Daily picks from ${library.items.length} recently added movies. Watched status is not filtered.`:'Refresh the library in Emby to receive movie suggestions.';
  for(let i=1;i<=4;i++)for(const[key,value]of Object.entries({title:selected[i-1]?.title||'',summary:selected[i-1]?.summary||'',year:selected[i-1]?.year?String(selected[i-1].year):null,genres:selected[i-1]?.genres.join(' · ')||'',source:'Emby library',url:state.libraryPicks[i-1]?.url||''}))state[`pick-${i}-${key}`]=value;
}
