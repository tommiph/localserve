/** Read-only broadcast and holographic presentation metadata. */
import {HttpError} from './storage.mjs';
export const deckThemes=['sci-fi','hacker','rustic','lcars','hologram'];
export const sceneEffects=['weather','wind','daylight','energy','alert'];
const identity=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(value);
function effects(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['enabled','bindings','taskIds'].includes(k))||typeof value.enabled!=='boolean'||!Array.isArray(value.bindings)||value.bindings.length>5||!Array.isArray(value.taskIds)||value.taskIds.length>32||new Set(value.taskIds).size!==value.taskIds.length||!value.taskIds.every(identity))throw new HttpError(400,'Choose optional scene effects and up to 32 activity Tasks.');
 const seen=new Set();for(const b of value.bindings){if(!b||typeof b!=='object'||Array.isArray(b)||!sceneEffects.includes(b.effect)||seen.has(b.effect))throw new HttpError(400,'Choose each scene effect once.');seen.add(b.effect);
  const keys=b.effect==='daylight'?['effect']:['effect','pluginId','cardId','fieldId','maxFieldId','minimum','maximum'];if(Object.keys(b).some(k=>!keys.includes(k))||b.effect!=='daylight'&&![b.pluginId,b.cardId,b.fieldId].every(identity)||b.maxFieldId!==undefined&&!identity(b.maxFieldId))throw new HttpError(400,'Choose a published reading for each effect.');
  if(['minimum','maximum'].some(k=>b[k]!==undefined&&(!Number.isFinite(b[k])||Math.abs(b[k])>1e9))||(b.maximum??100)<=(b.minimum??0))throw new HttpError(400,'Choose an increasing numeric effect range.');
 }
 return {enabled:value.enabled,bindings:value.bindings.map(b=>({...b})),taskIds:[...value.taskIds]};
}
export function deckPresentation(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['type','theme','motion','spotlightSeconds','opacity','effects'].includes(key))||value.type!=='deck'||!deckThemes.includes(value.theme)||!['full','gentle','none'].includes(value.motion)||!Number.isInteger(value.spotlightSeconds)||value.spotlightSeconds<10||value.spotlightSeconds>300||!Number.isInteger(value.opacity)||value.opacity<70||value.opacity>100)throw new HttpError(400,'Choose a TV deck theme, motion level, 10–300 second interval and 70–100% panel opacity.');
 return {...value,...(value.effects!==undefined?{effects:effects(value.effects)}:{})};
}
export function validateSceneSources(vista,services,old,tasks=[]){
 const chosen=new Set();function walk(n){if(!n.enabled)return;for(const ref of n.cards||[])chosen.add(ref.pluginId+'/'+ref.cardId);for(const child of n.children||[])walk(child);}walk(vista.layout);
 for(const binding of vista.presentation?.effects?.bindings||[]){if(binding.effect==='daylight')continue;if(old?.presentation?.effects?.bindings.some(b=>JSON.stringify(b)===JSON.stringify(binding)))continue;
  const plugin=services.find(p=>p.id===binding.pluginId),card=plugin?.cards.find(c=>c.id===binding.cardId),field=card?.fields.find(f=>f.id===binding.fieldId&&f.enabled),type=plugin?.cardCatalog.find(f=>f.id===field?.binding)?.type;
  const allowed=binding.effect==='weather'?['string']:binding.effect==='alert'?['boolean','string']:['number','boolean'];
  if(!chosen.has(binding.pluginId+'/'+binding.cardId)||!card||!field||!allowed.includes(type))throw new HttpError(400,'Choose a compatible reading already selected in this Vista.');
  if(binding.maxFieldId){const maximum=card.fields.find(f=>f.id===binding.maxFieldId&&f.enabled);if(!['energy','wind'].includes(binding.effect)||!maximum||plugin.cardCatalog.find(f=>f.id===maximum.binding)?.type!=='number')throw new HttpError(400,'Choose a numeric total from the same selected source.');}
 }
 for(const id of vista.presentation?.effects?.taskIds||[])if(!tasks.some(t=>t.id===id)&&!old?.presentation?.effects?.taskIds.includes(id))throw new HttpError(400,'Choose an existing Task for scene activity.');
}
export function sceneActivity(vista,tasks,runs){
 const e=vista.presentation?.effects;if(!e?.enabled||!e.taskIds.length)return [];
 const names=new Map(tasks.filter(t=>e.taskIds.includes(t.id)).map(t=>[t.id,t.name]));return runs.slice(-512).filter(r=>names.has(r.taskId)&&identity(r.id)&&Number.isSafeInteger(r.startedAt)&&['running','completed','failed','cancelled','interrupted'].includes(r.status)).slice(-12).map(r=>({id:r.id,taskId:r.taskId,name:names.get(r.taskId),status:r.status,startedAt:r.startedAt,...(Number.isSafeInteger(r.finishedAt)?{finishedAt:r.finishedAt}:{})}));
}
