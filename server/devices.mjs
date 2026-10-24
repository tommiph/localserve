/** Administrator-only inventory. Scans never run from reads or startup, and
 * saved labels are bound to a MAC when available rather than a reused IP. */
import path from 'node:path';
import {DeviceVendors,vendorPrefix} from './device-vendors.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {JsonStore,HttpError} from './storage.mjs';
import {localNetworks,discoverNetwork,inferredType,cleanText,macAddress} from './device-discovery.mjs';
import {isPrivateIPv4} from './network.mjs';
export const deviceTypes=['','Computer','Phone','TV','Console','Headset','Router','Gateway','Printer','Speaker','Camera','Media device','Other'];
const mappings=[['samsung-tv','host'],['tradfri','host'],['oculus-go','address'],['emby','server-url']];
export function addressValue(pluginId,address,previous=''){
  if(pluginId==='oculus-go')return address+':'+(/^\d+\.\d+\.\d+\.\d+:(\d{1,5})$/.exec(previous)?.[1]||'5555');
  if(pluginId==='emby'){
    try{const old=new URL(previous);if(['http:','https:'].includes(old.protocol)&&!old.username&&!old.password)return old.protocol+'//'+address+':'+(old.port||(old.protocol==='https:'?'443':'80'));}catch{}
    return 'http://'+address+':8096';
  }
  return address;
}
function shape(value){
  if(value?.schemaVersion!==1||!Array.isArray(value.devices)||value.devices.length>512)throw Error('Invalid inventory.');
  for(const row of value.devices){
    if(!/^[a-f0-9]{32}$/.test(row.id)||!Number.isInteger(row.revision)||row.revision<1||!Number.isFinite(row.observedAt)||!Number.isFinite(row.lastSeen)
      ||typeof row.enabled!=='boolean'||!deviceTypes.includes(row.customType)||typeof row.customName!=='string'||row.customName.length>64
      ||!Array.isArray(row.evidence)||!Array.isArray(row.services))throw Error('Invalid inventory entry.');
    for(const key of ['address','network','mac','name','hostname','manufacturer','model','reportedType'])if(typeof row[key]!=='string'||row[key].length>160)throw Error('Invalid device field.');
    if(!isPrivateIPv4(row.address)||row.mac&&macAddress(row.mac)!==row.mac||row.evidence.length>8||row.services.length>16
      ||[...row.evidence,...row.services].some(item=>typeof item!=='string'||item.length>160))throw Error('Invalid device evidence.');
  }
  if(new Set(value.devices.map(row=>row.id)).size!==value.devices.length)throw Error('Duplicate device identity.');
  return value;
}
export class Devices {
  constructor(root,registry,gate,{networks=localNetworks,discover=discoverNetwork,now=Date.now,vendors={}}={}){
    this.store=new JsonStore(path.join(root,'data/devices.json'),{schemaVersion:1,devices:[]});
    this.vendors=new DeviceVendors(root,{...vendors,now});
    this.registry=registry;this.gate=gate;this.networks=networks;this.discover=discover;this.now=now;this.job=null;this.operation=null;this.error='';this.closing=false;
    this.onGate=()=>{if(gate.paused)this.controller?.abort();};gate.on('change',this.onGate);
  }
  async load(){await this.vendors.load();try{await this.store.load();shape(this.store.snapshot());}catch{this.error='Device inventory could not be loaded. Its saved file was retained.';}return this;}
  rows(){return this.error?[]:this.store.snapshot().devices;}
  candidates(){return mappings.flatMap(([id,field])=>{
    const record=this.registry.records.get(id);if(!record||!record.plugin.settings.some(item=>item.id===field&&item.type==='string'&&item.format!=='secret'))return [];
    const config=record.config.snapshot();
    return [{pluginId:id,name:record.plugin.name,field,revision:config.revision,currentValue:config.settings[field]||''}];
  });}
  snapshot(){return {vendorLookup:this.vendors.summary(),error:this.error,networks:this.networks().map(({addresses,...network})=>network),devices:this.rows().map(row=>({...row,vendor:this.vendors.info(row.mac),type:row.customType||inferredType(row),typeSource:row.customType?'Custom':inferredType(row)==='Unknown'?'Unknown':'Inferred',displayName:row.customName||row.name||row.hostname||row.address})),job:this.job,candidates:this.candidates(),types:deviceTypes};}
  requireAvailable(){if(this.closing)throw new HttpError(503,'Server is stopping.');if(this.error)throw new HttpError(409,this.error);}
  start(values){
    this.requireAvailable();
    if(Object.keys(values).some(key=>!['networkId','requestId'].includes(key))||!/^[a-f0-9-]{36}$/.test(values.requestId||''))throw new HttpError(400,'Choose a network and a new scan request.');
    if(this.job?.requestId===values.requestId)return this.job;
    if(this.operation)throw new HttpError(409,'A device operation is already running.');
    if(this.gate.paused)throw new HttpError(409,'Enable server functions before scanning.');
    const network=this.networks().find(item=>item.id===values.networkId);if(!network)throw new HttpError(409,'That network is no longer attached. Refresh and choose another network.');
    const controller=new AbortController();this.controller=controller;
    const job=this.job={id:randomUUID(),requestId:values.requestId,status:'running',kind:'scan',network:network.cidr,startedAt:this.now(),stage:'Starting discovery',warnings:[]};
    const timer=setTimeout(()=>controller.abort(),45000);
    this.operation=(async()=>{
      try{
        const result=await this.discover(network,{signal:controller.signal,progress:stage=>{job.stage=stage;}});
        controller.signal.throwIfAborted();
        if(!this.networks().some(item=>item.id===network.id))throw Error('Network changed.');
        await this.store.update(value=>{
          controller.signal.throwIfAborted();
          const at=this.now();
          for(const raw of result.rows.slice(0,254)){
            if(!network.addresses.includes(raw.address))continue;
            const mac=macAddress(raw.mac)||'',id=createHash('sha256').update(mac?'mac:'+mac:network.cidr+'|ip:'+raw.address).digest('hex').slice(0,32);
            let row=value.devices.find(item=>item.id===id);
            if(!row){if(value.devices.length>=512)continue;row={id,revision:0,customName:'',customType:'',enabled:true,lastSeen:0};value.devices.push(row);}
            row.revision++;
            Object.assign(row,{address:raw.address,network:network.cidr,mac,observedAt:at,scanId:job.id,lastSeen:raw.seen?at:row.lastSeen});
            for(const key of ['name','hostname','manufacturer','model','reportedType'])row[key]=cleanText(raw[key],160)||row[key]||'';
            row.services=(raw.services||[]).slice(0,16).map(item=>cleanText(item));row.evidence=(raw.evidence||[]).slice(0,8).map(item=>cleanText(item));
          }
        });
        job.status='completed';job.stage='Discovery complete';job.count=result.rows.length;job.warnings=result.warnings;
      }catch{job.status=controller.signal.aborted?'cancelled':'failed';job.stage=controller.signal.aborted?'Scan stopped; previous results retained.':'Discovery could not complete; previous results retained.';}
      finally{clearTimeout(timer);job.finishedAt=this.now();this.operation=null;this.controller=null;}
    })();return job;
  }
  lookup(values){
    this.requireAvailable();
    if(Object.keys(values).some(key=>key!=='requestId')||!/^[a-f0-9-]{36}$/.test(values.requestId||''))throw new HttpError(400,'Use a new lookup request.');
    if(this.job?.requestId===values.requestId)return this.job;
    if(this.operation)throw new HttpError(409,'A device operation is already running.');
    if(this.gate.paused)throw new HttpError(409,'Enable server functions before looking up manufacturers.');
    const summary=this.vendors.summary();if(summary.error)throw new HttpError(409,summary.error);
    if(summary.coolingDown)throw new HttpError(429,'Manufacturer lookup is cooling down. Try again after the time shown.');
    const prefixes=[...new Set(this.rows().filter(row=>row.enabled).map(row=>vendorPrefix(row.mac)).filter(Boolean))];
    const pending=prefixes.filter(prefix=>{const row=this.rows().find(item=>vendorPrefix(item.mac)===prefix),info=this.vendors.info(row.mac);return info.checkedAt===undefined||info.stale;});
    const job=this.job={id:randomUUID(),requestId:values.requestId,kind:'lookup',status:'running',startedAt:this.now(),stage:'Looking up manufacturers',warnings:[],count:0};
    const controller=new AbortController();this.controller=controller;const timer=setTimeout(()=>controller.abort(),180000);
    this.operation=(async()=>{
      await Promise.resolve();
      try{
        if(pending.length>64)job.warnings.push('Only the first 64 uncached prefixes are included. Run lookup again for the remainder.');
        for(const prefix of pending.slice(0,64)){
          controller.signal.throwIfAborted();job.stage='Looking up manufacturers · '+(job.count+1)+' / '+Math.min(pending.length,64);
          await this.vendors.lookup(prefix,controller.signal);job.count++;
        }
        controller.signal.throwIfAborted();job.status='completed';job.stage=job.count?'Manufacturer lookup complete · '+job.count+' prefixes':'Manufacturer results are up to date; no lookup needed.';
      }catch(error){job.status=controller.signal.aborted?'cancelled':'failed';job.stage=controller.signal.aborted?'Lookup stopped; saved results retained.':error instanceof HttpError?error.message:'Manufacturer lookup could not complete; saved results retained.';}
      finally{clearTimeout(timer);job.finishedAt=this.now();this.operation=null;this.controller=null;}
    })();return job;
  }
  cancel(values){if(!this.job||values.id!==this.job.id)throw new HttpError(409,'That device operation is no longer current.');this.controller?.abort();return {accepted:true};}
  async edit(values){
    this.requireAvailable();
    if(Object.keys(values).some(key=>!['id','revision','name','type','enabled','forget'].includes(key)))throw new HttpError(400,'Unknown device setting.');
    await this.store.update(value=>{
      const row=value.devices.find(item=>item.id===values.id);if(!row)throw new HttpError(404,'Device not found.');
      if(row.revision!==values.revision)throw new HttpError(409,'Device information changed. Reopen its editor.');
      if(values.forget===true){value.devices=value.devices.filter(item=>item!==row);return;}
      if(typeof values.name!=='string'||values.name.length>64||cleanText(values.name,64)!==values.name||!deviceTypes.includes(values.type)||typeof values.enabled!=='boolean')throw new HttpError(400,'Choose a device name, type and enabled state.');
      Object.assign(row,{customName:values.name,customType:values.type,enabled:values.enabled,revision:row.revision+1});
    });
  }
  async use(values){
    this.requireAvailable();if(Object.keys(values).some(key=>!['id','revision','pluginId','pluginRevision'].includes(key)))throw new HttpError(400,'Unknown address setting.');
    const row=this.rows().find(item=>item.id===values.id);
    if(!row||row.revision!==values.revision||!row.enabled)throw new HttpError(409,'Device changed or is disabled. Reopen its address selection.');
    if(!this.networks().some(network=>network.cidr===row.network&&network.addresses.includes(row.address)))throw new HttpError(409,'This device is outside the currently attached networks.');
    const candidate=this.candidates().find(item=>item.pluginId===values.pluginId);if(!candidate)throw new HttpError(400,'Choose a compatible plugin.');
    const record=this.registry.records.get(candidate.pluginId),config=record.config.snapshot();
    if(config.revision!==values.pluginRevision)throw new HttpError(409,'Plugin settings changed. Reopen its address selection.');
    const address=addressValue(candidate.pluginId,row.address,config.settings[candidate.field]);
    // Only the declared address changes. Private credentials, enablement and
    // other settings stay in the normal revisioned plugin configuration path.
    await this.registry.saveConfiguration(candidate.pluginId,{revision:config.revision,settings:{...config.settings,[candidate.field]:address}});
    return {pluginId:candidate.pluginId,address};
  }
  async close(){this.closing=true;this.gate.removeListener('change',this.onGate);this.controller?.abort();await this.operation;await this.store.queue;await this.vendors.close();}
}
