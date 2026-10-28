/** Shared daily display metadata contains derived times, never coordinates. */
import {solarOccurrence} from './rules.mjs';
import {HttpError} from './storage.mjs';
export function daylightAt(config,now=Date.now()){
  const date=new Date(now);
  return {sunrise:solarOccurrence(date,{type:'sunrise'},config.location),sunset:solarOccurrence(date,{type:'sunset'},config.location)};
}
export function todayPresentation(value){
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['type','mood','motion','spotlightSeconds','opacity'].includes(key))||value.type!=='today'
    ||!['atmospheric','aurora','midnight'].includes(value.mood)||!['full','gentle','none'].includes(value.motion)
    ||!Number.isInteger(value.spotlightSeconds)||value.spotlightSeconds<10||value.spotlightSeconds>300
    ||!Number.isInteger(value.opacity)||value.opacity<40||value.opacity>100)throw new HttpError(400,'Choose a Today mood, motion level, spotlight interval of 10–300 seconds and opacity of 40–100%.');
  return {...value};
}
