/** Canonical gateway edit contracts. Tokens cover names/membership, not volatile
 * power readings, so lighting changes cannot invalidate an unrelated name edit. */
import {createHash} from 'node:crypto';

export function lightingMemberIds(value) {
  if(!Array.isArray(value)||value.length>100||value.some(id=>typeof id!=='string'||!/^[1-9]\d{0,9}$/.test(id)||Number(id)>0xffffffff)
    ||new Set(value).size!==value.length)throw Error('Choose up to 100 different reported room members.');
  return [...value].sort((a,b)=>Number(a)-Number(b));
}
export function lightingEditName(value) {
  if(typeof value!=='string'||/[\u0000-\u001f\u007f]/u.test(value))throw Error('Enter a valid device or room name.');
  const name=value.normalize('NFC').trim();
  if(!name||name.length>64||Buffer.byteLength(name,'utf8')>128)throw Error('Enter a device or room name of up to 64 characters and 128 UTF-8 bytes.');
  return name;
}
export function lightingEditToken(kind,id,name,members=[]) {
  return createHash('sha256').update(JSON.stringify([kind,String(id),typeof name==='string'?name:'',kind==='group'?lightingMemberIds(members):[]])).digest('hex');
}
export function lightingEditActions(plugin) {
  if(!plugin.controls?.lighting?.inventoryState)return null;
  const contracts={device:'device-rename',group:'room-edit'},result={};
  for(const [kind,id]of Object.entries(contracts)){
    const action=plugin.actions.find(action=>action.id===id&&action.settingsOnly);
    const fields=kind==='device'?['id','name','expected']:['id','name','members','expected'];
    if(!action||action.parameters.length!==fields.length||fields.some(id=>!action.parameters.some(field=>field.id===id&&field.type==='string')))return null;
    result[kind]=id;
  }
  return result;
}
