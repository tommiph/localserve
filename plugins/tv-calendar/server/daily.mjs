/** Stable day-by-day choices from attributed metadata, never a broadcast claim. */
import {createHash} from 'node:crypto';
import {suggestions,checkedOn} from './suggestions.mjs';
export function dayKey(at){const date=new Date(at);return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
const genreNames=['Science-Fiction','Drama','Comedy','Thriller','Fantasy','Action','Crime','Mystery','Adventure'];
export function preferredGenres(settings){
  const value=settings['pick-genres']===undefined?settings['pick-genre']||'':settings['pick-genres'];
  if(typeof value!=='string'||value.length>250)return null;
  const selected=value?value.split(','):[];
  return selected.every(name=>genreNames.includes(name))&&new Set(selected).size===selected.length?selected:null;
}
export function tvPicks(settings,state,at){
  const followed=new Set(settings.shows.map(show=>show['tvmaze-id'])),genres=preferredGenres(settings)||[];
  const pool=[...suggestions.map(show=>({...show,checkedOn,origin:'Starter selection'}))];
  return pool.filter(show=>!followed.has(show.id)&&(!genres.length||genres.some(genre=>show.genres.includes(genre)))&&(settings['pick-ended']!==false||show.status!=='Ended'))
    .map(show=>({show,rank:createHash('sha256').update(dayKey(at)+'/'+show.id).digest('hex')})).sort((a,b)=>a.rank.localeCompare(b.rank)).slice(0,4).map(({show})=>show);
}
export function projectTvPicks(settings,state,at){
  const picks=tvPicks(settings,state,at);state.dailyPicks=picks;state['pick-day']=dayKey(at);state['pick-count']=picks.length;state['more-count']=Math.max(0,picks.length-1);
  state['pick-status']='Starter selection checked '+checkedOn+'; availability not verified';
  for(let i=0;i<4;i++)for(const [key,value]of Object.entries({title:picks[i]?.name||'',summary:picks[i]?.summary||'',genres:picks[i]?.genres.join(' · ')||'',network:picks[i]?.network||'',year:picks[i]?.premiered?.slice(0,4)||'',url:picks[i]?.url||''}))state[`pick-${i+1}-${key}`]=value;
}
