/** Short-lived hash manifests make administrator refreshes incremental. They
 * retain identities/digests only, never a second copy of settings or log data. */
import {createHash,randomBytes} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('base64url');
const keyedArrays=new Set(['activity','runs','pluginActivity']);
function field(value,previous,key) {
  const hash=digest(value);
  if(previous?.hash===hash)return {manifest:previous};
  if(!keyedArrays.has(key)||!Array.isArray(value)||value.some(item=>!item||typeof item.id!=='string')
    ||new Set(value.map(item=>item.id)).size!==value.length)return {manifest:{hash},wire:{kind:'replace',value}};
  const ids=value.map(item=>item.id),itemHashes=new Map(value.map(item=>[item.id,digest(item)]));
  const manifest={hash,ids,itemHashes};
  if(!previous?.ids)return {manifest,wire:{kind:'replace',value}};
  const oldIndex=new Map(previous.ids.map((id,index)=>[id,index]));
  let nextStart=0;
  while(nextStart<ids.length&&!oldIndex.has(ids[nextStart]))nextStart++;
  const oldStart=oldIndex.get(ids[nextStart])??0;
  let shared=0;
  while(nextStart+shared<ids.length&&oldStart+shared<previous.ids.length
    &&ids[nextStart+shared]===previous.ids[oldStart+shared])shared++;
  // Replace either side of the common sequence. Prepending a log row therefore
  // sends one new identity, rather than repeating every retained log identity.
  const splices=[];
  if(!shared)splices.push({at:0,remove:previous.ids.length,insert:ids});
  else {
    const tail={at:oldStart+shared,remove:previous.ids.length-oldStart-shared,insert:ids.slice(nextStart+shared)};
    const head={at:0,remove:oldStart,insert:ids.slice(0,nextStart)};
    if(tail.remove||tail.insert.length)splices.push(tail);
    if(head.remove||head.insert.length)splices.push(head);
  }
  return {manifest,wire:{kind:'array',splices,items:value.filter(item=>previous.itemHashes.get(item.id)!==itemHashes.get(item.id))}};
}
function fields(value,previous=new Map()) {
  const manifest=new Map(),values={};
  for(const [key,item]of Object.entries(value)){
    if(item===undefined)continue;
    const next=field(item,previous.get(key),key);manifest.set(key,next.manifest);
    if(next.wire)values[key]=next.wire;
  }
  return {manifest,values,removed:[...previous.keys()].filter(key=>!manifest.has(key))};
}
export class AdminSync {
  constructor({now=Date.now,limit=12,ttl=60000}={}){this.now=now;this.limit=limit;this.ttl=ttl;this.frames=new Map();}
  encode(snapshot,cursor) {
    const now=this.now();
    for(const [key,frame]of this.frames)if(now-frame.at>this.ttl)this.frames.delete(key);
    const previous=this.frames.get(cursor),{services,...top}=snapshot;
    const next=fields(top,previous?.top),serviceFrames=new Map(),updates=[];
    for(const service of services){
      const old=previous?.services.get(service.id),patch=fields(service,old);
      serviceFrames.set(service.id,patch.manifest);
      if(Object.keys(patch.values).length||patch.removed.length)updates.push({id:service.id,values:patch.values,removed:patch.removed});
    }
    const removed=[...(previous?.services.keys()||[])].filter(id=>!serviceFrames.has(id));
    const id=randomBytes(16).toString('hex');
    this.frames.set(id,{at:now,top:next.manifest,services:serviceFrames});
    while(this.frames.size>this.limit)this.frames.delete(this.frames.keys().next().value);
    return {protocol:'admin-fields-v1',cursor:id,full:!previous,values:next.values,removed:next.removed,
      services:{updates,removed,order:services.map(service=>service.id)}};
  }
}
