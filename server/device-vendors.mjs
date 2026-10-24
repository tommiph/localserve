/** Manual MAC block lookup. Only public six-digit prefixes leave the server;
 * cached registrations never identify a device model or prove its type. */
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {JsonStore,HttpError} from './storage.mjs';
import {macAddress,cleanText} from './device-discovery.mjs';

const publicPrefix=value=>/^[A-F0-9]{6}$/.test(value)&&!(parseInt(value.slice(0,2),16)&3);
const DAY=86400000,fields=['company','address','country','macPrefix','blockStart','blockEnd','blockType','updated'];
export function vendorPrefix(mac){
  const normalized=macAddress(mac);
  return normalized&&!(parseInt(normalized.slice(0,2),16)&2)?normalized.replaceAll(':','').slice(0,6).toUpperCase():null;
}
function validate(value){
  if(value?.schemaVersion!==1||!Number.isFinite(value.nextAllowedAt)||value.nextAllowedAt<0||!Array.isArray(value.entries)||value.entries.length>512)throw Error('Invalid vendor cache.');
  for(const entry of value.entries){
    if(!publicPrefix(entry.prefix)||!Number.isFinite(entry.checkedAt)||entry.checkedAt<0||typeof entry.found!=='boolean'||typeof entry.isPrivate!=='boolean')throw Error('Invalid vendor entry.');
    for(const field of fields)if(typeof entry[field]!=='string'||entry[field].length>512||cleanText(entry[field],512)!==entry[field])throw Error('Invalid vendor field.');
  }
  if(new Set(value.entries.map(entry=>entry.prefix)).size!==value.entries.length)throw Error('Duplicate vendor prefix.');
}
function registration(body,prefix,at){
  if(!body||body.success!==true||typeof body.found!=='boolean')throw Error('Invalid manufacturer response.');
  const entry={prefix,checkedAt:at,found:body.found,isPrivate:body.isPrivate===true};
  for(const field of fields){
    if(body[field]!==undefined&&typeof body[field]!=='string')throw Error('Invalid manufacturer field.');
    entry[field]=cleanText(body[field]||'',512);
  }
  if(entry.found&&(!entry.company||entry.macPrefix.replace(/[:-]/g,'').toUpperCase()!==prefix))throw Error('Manufacturer prefix mismatch.');
  return entry;
}
function cooldown(headers,at,status){
  const retry=headers.get('retry-after');
  let until=at+500;
  if(retry){const delta=/^\d+(\.\d+)?$/.test(retry)?at+Number(retry)*1000:Date.parse(retry);if(Number.isFinite(delta))until=Math.max(until,delta);}
  const reset=Number(headers.get('x-ratelimit-reset'));
  if(headers.get('x-ratelimit-remaining')==='0'&&Number.isFinite(reset)&&reset>0)until=Math.max(until,reset*1000);
  if(status===429&&until<=at+500)until=at+60000;
  return until;
}
async function jsonBody(response){
  if(!response.headers.get('content-type')?.toLowerCase().includes('application/json')){await response.body?.cancel().catch(()=>{});throw Error('Unexpected manufacturer response.');}
  const reader=response.body?.getReader();if(!reader)throw Error('Empty manufacturer response.');
  let bytes=0;const chunks=[];
  try{
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>32768)throw Error('Manufacturer response too large.');chunks.push(Buffer.from(value));}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }finally{await reader.cancel().catch(()=>{});}
}
export class DeviceVendors {
  constructor(root,{now=Date.now,fetcher=fetch,wait=sleep}={}){
    this.store=new JsonStore(path.join(root,'data/device-vendors.json'),{schemaVersion:1,nextAllowedAt:0,entries:[]});
    this.now=now;this.fetcher=fetcher;this.wait=wait;this.error='';
  }
  async load(){try{await this.store.load();validate(this.store.snapshot());}catch{this.error='Manufacturer cache could not be loaded. Its saved file was retained.';}return this;}
  summary(){const retryAt=this.error?0:this.store.snapshot().nextAllowedAt;return {error:this.error,retryAt,coolingDown:retryAt>this.now()};}
  info(mac){
    if(!macAddress(mac))return {status:'no-mac'};
    const prefix=vendorPrefix(mac);if(!prefix)return {status:'private'};
    const entry=this.error?null:this.store.value.entries.find(item=>item.prefix===prefix);
    return entry?{...entry,status:entry.found?'found':'not-found',stale:this.now()-entry.checkedAt>(entry.found?30:7)*DAY}:{status:'not-looked-up',prefix};
  }
  async lookup(prefix,signal){
    if(this.error)throw new HttpError(409,this.error);
    if(!publicPrefix(prefix))throw new HttpError(400,'Choose a public manufacturer prefix.');
    signal.throwIfAborted();
    const existing=this.store.snapshot().entries.find(item=>item.prefix===prefix);
    if(existing&&this.now()-existing.checkedAt<=(existing.found?30:7)*DAY)return false;
    const delay=this.store.snapshot().nextAllowedAt-this.now();
    if(delay>1000)throw new HttpError(429,'Manufacturer lookup is cooling down. Try again after the time shown.');
    if(delay>0)await this.wait(delay,undefined,{signal});
    signal.throwIfAborted();
    // Reserve the request slot durably before contacting the fixed provider.
    await this.store.update(value=>{signal.throwIfAborted();value.nextAllowedAt=this.now()+500;});
    signal.throwIfAborted();
    const response=await this.fetcher('https://api.maclookup.app/v2/macs/'+prefix,{redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.any([signal,AbortSignal.timeout(6000)])});
    await this.store.update(value=>{value.nextAllowedAt=Math.max(value.nextAllowedAt,cooldown(response.headers,this.now(),response.status));});
    if(!response.ok){await response.body?.cancel();throw new HttpError(response.status===429?429:502,response.status===429?'Manufacturer lookup rate limit reached. Try again after the time shown.':'Manufacturer service is unavailable; saved results were retained.');}
    const entry=registration(await jsonBody(response),prefix,this.now());
    signal.throwIfAborted();
    await this.store.update(value=>{
      signal.throwIfAborted();value.entries=value.entries.filter(item=>item.prefix!==prefix);
      value.entries.push(entry);value.entries.sort((a,b)=>b.checkedAt-a.checkedAt);value.entries=value.entries.slice(0,512);
    });
    return true;
  }
  async close(){await this.store.queue;}
}
