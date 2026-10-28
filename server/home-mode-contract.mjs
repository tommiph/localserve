/** Mode selectors expose named local state, not arbitrary actions or settings. */
import {glyphs,isIdentifier} from './plugin-schema.mjs';

export function modeEntries(settings) {
  const entries=settings?.modes;
  if(!Array.isArray(entries)||entries.length>20)throw Error('Choose up to 20 home modes.');
  const ids=new Set();
  for(const mode of entries) {
    if(!mode||!isIdentifier(mode.id)||ids.has(mode.id)||typeof mode.name!=='string'||!mode.name.trim()||mode.name.length>40
      ||!glyphs.includes(mode.icon)||!/^#[a-f0-9]{6}$/i.test(mode.color)||typeof mode.enabled!=='boolean'
      ||typeof mode['task-id']!=='string'||mode['task-id'].length>80)throw Error('Each mode needs a unique ID, name, symbol and six-digit hex color.');
    ids.add(mode.id);
  }
  return entries;
}

export function validateModeSelector(value,settings,actions,events) {
  if(value===undefined)return false;
  if(value!==true)throw Error('Mode selector must explicitly opt in.');
  const list=settings.find(field=>field.id==='modes'&&field.type==='list');
  const fields=list?.fields || [];
  for(const id of ['id','name','icon','color','task-id','enabled'])if(!fields.some(field=>field.id===id&&field.type===(id==='enabled'?'boolean':'string')))throw Error('Mode selector needs its complete modes setting.');
  const action=actions.find(action=>action.id==='select-mode'&&!action.settingsOnly);
  if(!action||action.parameters.length!==1||action.parameters[0].id!=='mode-id'||action.parameters[0].type!=='string')throw Error('Mode selector needs the select-mode action.');
  const event=events.find(event=>event.id==='mode-changed');
  if(!event||!['mode-id','mode-name','transition-id'].every(id=>event.payload.some(field=>field.id===id&&field.type==='string')))throw Error('Mode selector needs a typed mode-changed Event.');
  modeEntries({modes:list.default || []});
  return true;
}

export function modeState(settings,state) {
  let mode;try{mode=modeEntries(settings).find(item=>item.enabled&&item.id===state['mode-id']);}catch{}
  // Names/colors follow definitions; historical previous names and timestamps
  // remain the observations captured when the selection actually changed.
  return {...state,'mode-id':mode?.id??null,'mode-name':mode?.name??null,'mode-color':mode?.color??null};
}
