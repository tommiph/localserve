/** Finite gateway-scene reads. Raw field presence, never library defaults,
 * determines whether an exact light-only copy can be authored. */
import conversions from '../vendor/node_modules/node-tradfri-client/build/lib/conversions.js';
import {gatewayRead,boundedIds,resourceId,parseAccessory,parseGroup} from './client.mjs';
import {lightingEditToken} from '../../../server/lighting-edit-contract.mjs';
const text=(value,fallback)=>typeof value==='string'&&value.trim()?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,64):fallback;
const number=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
export const inspectionAction={id:'inspect-scenes',name:'Read gateway scenes',description:'Read a room scene list or one stored light-only scene without activating it. Use Scenes - Import from gateway.',settingsOnly:true,
  parameters:[{id:'id',label:'Room ID',type:'string',required:true,maxLength:10},{id:'scene-id',label:'Scene ID (blank lists scenes)',type:'string',default:'',maxLength:10}]};
export function sceneLight(raw,device){
  const id=String(raw?.['9003']),light=device.lightList?.[0];
  if(!resourceId(id)||String(device.instanceId)!==id||device.type!==2||device.alive!==true||!light
    ||![0,1,false,true].includes(raw['5850'])||!number(raw['5851'],0,254))throw Error('A scene light has incomplete or unavailable settings.');
  const result={id,on:raw['5850']===1||raw['5850']===true,brightness:conversions.deserializers.brightness(raw['5851'])};
  if(light.spectrum==='white'){
    if(!number(raw['5711'],250,454))throw Error('A white light has no supported scene temperature.');
    result.temperature=conversions.deserializers.colorTemperature(raw['5711']);
  }else if(light.spectrum==='rgb'){
    // XY-only scenes cannot be copied as exact HSV settings. Do not substitute
    // current colour or a constructor's default colour for missing scene data.
    if(!number(raw['5707'],0,65279)||!number(raw['5708'],0,65279))throw Error('A colour light has no supported scene hue and saturation.');
    result.hue=conversions.deserializers.hue(raw['5707']);result.saturation=conversions.deserializers.saturation(raw['5708']);
  }else if(light.spectrum!=='none')throw Error('A scene light has an unsupported capability.');
  return result;
}
export async function readGatewayScenes(client,parameters,signal){
  const id=parameters.id,sceneId=parameters['scene-id']||'';
  if(!resourceId(id)||sceneId&&!resourceId(sceneId))throw Error('Choose a reported room and gateway scene.');
  const group=parseGroup(await gatewayRead(client,'15004/'+id));
  if(String(group.instanceId)!==id)throw Error('The selected room no longer exists.');
  const members=boundedIds(group.deviceIDs||[]),ids=boundedIds(await gatewayRead(client,'15005/'+id));
  const base={groupId:id,groupName:text(group.name,'Room '+id),groupToken:lightingEditToken('group',id,group.name,members)};
  if(!sceneId){
    const scenes=[];
    for(const scene of ids.slice(0,32)){
      signal.throwIfAborted();const raw=await gatewayRead(client,'15005/'+id+'/'+scene);
      if(String(raw?.['9003'])!==scene)throw Error('The selected gateway scene changed.');
      scenes.push({id:scene,name:text(raw['9001'],'Scene '+scene)});
    }
    return {...base,scenes,truncated:ids.length>32};
  }
  if(!ids.includes(sceneId))throw Error('The selected gateway scene no longer exists.');
  const raw=await gatewayRead(client,'15005/'+id+'/'+sceneId),lights=[],issues=[];
  if(String(raw?.['9003'])!==sceneId)throw Error('The selected gateway scene changed.');
  const settings=raw['15013'];
  if(raw['9070']===true||raw['9070']===1)issues.push('This scene uses current lighting rather than fixed stored settings.');
  if(!Array.isArray(settings)||!settings.length||settings.length>20)issues.push('Import requires 1–20 complete light settings.');
  if(['15016','15021','15026'].some(key=>Object.hasOwn(raw,key)&&(!Array.isArray(raw[key])||raw[key].length)))issues.push('This scene includes unsupported non-light settings. Nothing will be omitted.');
  if(!issues.length){
    const seen=new Set();
    for(const setting of settings){
      signal.throwIfAborted();const member=String(setting?.['9003']);
      if(!resourceId(member)||!members.includes(member)||seen.has(member)){issues.push('A scene light is duplicated or no longer belongs to this room.');break;}
      seen.add(member);
      try{lights.push(sceneLight(setting,parseAccessory(await gatewayRead(client,'15001/'+member))));}
      catch{issues.push('A scene light is unavailable or its stored settings cannot be copied exactly.');break;}
    }
  }
  return {...base,sceneId,name:text(raw['9001'],'Scene '+sceneId),lights:issues.length?[]:lights,issues};
}
