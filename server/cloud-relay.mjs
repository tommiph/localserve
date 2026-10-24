/** Cloud messages enter through an optional, configured worker. Durable claims
 * precede effects; uncertain dispatch is never replayed after process loss. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {JsonStore,HttpError} from './storage.mjs';
import {relayId,relayUuid,relayKey,relayUrl} from './relay-protocol.mjs';
import {ControllerEnrollment} from './controller-enrollment.mjs';
const statuses=new Set(['dispatching','received','accepted','queued','running','completed','failed','cancelled','interrupted','expired','rejected']);
const deviceId=/^android-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const safeObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
export class CloudRelay {
  constructor(root,registry,phoneHome,controls,sensors,{now=Date.now}={}){
    Object.assign(this,{root,registry,phoneHome,controls,sensors,now});
    this.enrollment=new ControllerEnrollment(root,{now});
    this.store=new JsonStore(path.join(root,'data/cloud-relay.json'),{schemaVersion:1,receipts:[]});this.error='';this.epoch=0;this.closing=false;this.operations=new Set();
    this.onGate=()=>{this.epoch++;};registry.engine.gate.on('change',this.onGate);
  }
  async load(){
    await this.enrollment.load();
    try{
      await this.store.load();const value=this.store.snapshot();
      if(value?.schemaVersion!==1||!Array.isArray(value.receipts)||value.receipts.length>256||value.receipts.some(item=>!relayUuid.test(item.id)||!relayId.test(item.clientId)||!statuses.has(item.status)||!Number.isFinite(item.at)||!Number.isFinite(item.expiresAt)))throw Error('Invalid relay receipt store.');
      if(value.receipts.some(item=>item.status==='dispatching'||item.expiresAt<=this.now()))await this.store.update(value=>{value.receipts=value.receipts.filter(item=>item.expiresAt>this.now());for(const item of value.receipts)if(item.status==='dispatching')item.status='interrupted';});
    }catch{this.error='Relay receipts could not be loaded. The saved file was retained.';}
    return this;
  }
  check(record,context){
    context.signal.throwIfAborted();this.registry.assertReady(record);
    if(this.closing||this.error||this.registry.engine.gate.paused||context.relayClaim?.epoch!==this.epoch||context.relayClaim?.runtime!==record.runtime||context.relayClaim?.revision!==record.config.snapshot().revision)throw new HttpError(409,this.error||'Relay configuration or server state changed.');
  }
  catalogue(){
    const view=this.phoneHome.viewer(true),base={name:view.name,paused:view.paused,revision:view.revision};
    const tasks=view.tasks.map(item=>({key:item.id,name:item.name,icon:item.icon,revision:item.revision,available:item.available,unavailableReason:item.unavailableReason||'',type:'task'}));
    const scenes=view.scenes.map(item=>({key:item.pluginId+'/'+item.slug+'/'+item.id,name:item.name,icon:item.icon,group:item.group,revision:item.revision,available:item.available,type:'scene'}));
    return {...base,scenes:scenes.slice(0,100),tasks:tasks.slice(0,Math.max(0,100-scenes.length))};
  }
  receipt(item){
    let status=item.status;
    if(item.kind==='shortcut'&&['accepted','queued','running'].includes(status)){
      const run=item.type==='task'?this.phoneHome.state.snapshot().runs.find(run=>run.id===item.runId):this.controls.runs.snapshot().runs.find(run=>run.id===item.runId);
      status=run?.status||'interrupted';
    }
    return {id:item.id,clientId:item.clientId,status:status==='dispatching'?'interrupted':status,...(item.reason?{reason:item.reason}:{})};
  }
  exchange(record,values,context){const operation=this.perform(record,values,context);this.operations.add(operation);operation.finally(()=>this.operations.delete(operation)).catch(()=>{});return operation;}
  async perform(record,values,context){
    this.check(record,context);
    if(values.operation==='snapshot'&&this.store.snapshot().receipts.some(item=>item.expiresAt<=this.now()))await this.store.update(value=>{this.check(record,context);value.receipts=value.receipts.filter(item=>item.expiresAt>this.now());});
    if(values.operation==='snapshot')return {reportIntervalMs:(record.config.snapshot().settings['report-seconds']||60)*1000,clients:record.config.snapshot().settings.clients.map(client=>({id:client['client-id'],key:client.key,enabled:client.enabled,scenes:client.scenes,sensors:client.sensors,events:client.events,deviceId:client['device-id']})),catalog:this.catalogue(),receipts:this.store.snapshot().receipts.filter(item=>item.expiresAt>this.now()).slice(-64).map(item=>this.receipt(item))};
    if(values.operation!=='receive')throw new HttpError(400,'Unknown relay operation.');
    const message=values.message,now=this.now();
    if(!safeObject(message)||!relayUuid.test(message.id)||!relayId.test(message.clientId)||!['sensors','shortcut','event'].includes(message.kind)
      ||!Number.isSafeInteger(message.createdAt)||!Number.isSafeInteger(message.expiresAt)||message.createdAt>now+30000||message.expiresAt>message.createdAt+300000||!safeObject(message.payload))throw new HttpError(400,'Invalid relay message.');
    const previous=this.store.snapshot().receipts.find(item=>item.id===message.id&&item.clientId===message.clientId);
    if(previous)return this.receipt(previous);
    const client=record.config.snapshot().settings.clients.find(client=>client['client-id']===message.clientId&&client.enabled);
    const keyTag=client&&createHmac('sha256',client.key).update([1,message.clientId,'identity',0,'identity',''].join('\n')).digest('hex');
    const allowed=client&&message.keyTag===keyTag&&(message.kind==='sensors'?client.sensors:message.kind==='shortcut'?client.scenes:client.events);
    const status=message.expiresAt<=now?'expired':!allowed?'rejected':'dispatching';
    const claim={id:message.id,clientId:message.clientId,kind:message.kind,status,at:now,expiresAt:now+1200000,...(status==='expired'?{reason:'message-expired'}:status==='rejected'?{reason:'client-permission-denied'}:{})};
    // Store no message text, sensor callback, location, credential or capability.
    await this.store.update(value=>{
      this.check(record,context);value.receipts=value.receipts.filter(item=>item.expiresAt>now);
      if(value.receipts.length>=256)throw new HttpError(429,'Relay receipt limit reached.');
      if(value.receipts.some(item=>item.id===claim.id&&item.clientId===claim.clientId))throw new HttpError(409,'Relay message already admitted.');
      value.receipts.push(claim);
    });
    if(status!=='dispatching')return this.receipt(claim);
    let event;
    try{
      this.check(record,context);
      if(message.kind==='sensors'){
        if(!deviceId.test(client['device-id'])||message.payload.deviceId!==client['device-id']||typeof message.payload.packet!=='string'||message.payload.packet.length>90000||!/^[A-Za-z0-9+/]*={0,2}$/.test(message.payload.packet))throw new Error('Sensor profile mismatch.');
        const packet=JSON.parse(gunzipSync(Buffer.from(message.payload.packet,'base64'),{maxOutputLength:65536}).toString('utf8'));
        if(packet.deviceId!==client['device-id'])throw Error('Sensor device mismatch.');
        const reception=await this.sensors.relay(packet,context.signal,{timeoutMs:(record.config.snapshot().settings['report-seconds']||60)*1000+Math.ceil(record.config.snapshot().settings['poll-minutes']*60000)+15000});
        claim.status=reception.accepted?'received':'rejected';if(!reception.accepted)claim.reason='old-or-duplicate-sensor-report';
      }else if(message.kind==='shortcut'){
        const input=message.payload;if(input.id!==message.id||!['task','scene'].includes(input.type)||typeof input.key!=='string'||input.key.length>220||!Number.isSafeInteger(input.revision))throw Error('Invalid shortcut.');
        const catalog=this.catalogue(),selected=(input.type==='task'?catalog.tasks:catalog.scenes).find(item=>item.key===input.key&&item.revision===input.revision&&item.available);
        if(!selected||catalog.paused)throw Error('Shortcut changed or unavailable.');
        const digest=createHash('sha256').update(message.clientId+'\n'+message.id).digest('hex');
        const requestId=digest.slice(0,8)+'-'+digest.slice(8,12)+'-4'+digest.slice(13,16)+'-8'+digest.slice(17,20)+'-'+digest.slice(20,32);
        claim.type=input.type;
        this.check(record,context);
        if(input.type==='task'){
          const view=this.phoneHome.viewer(true),item=view.tasks.find(item=>item.id===selected.key&&item.revision===selected.revision&&item.available);
          if(!item)throw Error('Shortcut changed.');
          const receipt=await this.phoneHome.run({taskId:item.id,revision:item.revision,homeRevision:view.revision,expires:item.expires,requestId},item.token);
          const saved=this.phoneHome.claims.snapshot().find(item=>item.id===requestId);claim.runId=saved?.runId;claim.status=receipt.status;
        }else{
          const [pluginId,slug,itemId]=input.key.split('/'),view=this.controls.viewer(pluginId,slug);
          const receipt=await this.controls.invoke(pluginId,slug,view.token,{itemId,requestId,revision:input.revision},{signal:context.signal});
          claim.runId=receipt.id;claim.status=receipt.status;
        }
      }else{
        const input=message.payload;
        if(Object.keys(input).some(key=>!['id','channel','message','value','active'].includes(key))||typeof input.channel!=='string'||input.channel.length<1||input.channel.length>64||typeof input.message!=='string'||input.message.length>2000
          ||input.value!==undefined&&!Number.isFinite(input.value)||input.active!==undefined&&typeof input.active!=='boolean')throw Error('Invalid event fields.');
        event={'message-id':message.id,'client-id':message.clientId,channel:input.channel,message:input.message,'sent-at':message.createdAt,
          ...(input.value!==undefined?{value:input.value}:{}),...(input.active!==undefined?{active:input.active}:{})};claim.status='received';
      }
    }catch(error){claim.status=context.signal.aborted?'interrupted':'rejected';claim.reason=context.signal.aborted?'dispatch-interrupted':message.kind==='sensors'?'sensor-report-rejected':message.kind==='shortcut'?'shortcut-changed-or-unavailable':'invalid-event-fields';}
    await this.store.update(value=>{const row=value.receipts.find(item=>item.id===claim.id&&item.clientId===claim.clientId);if(row)Object.assign(row,claim);});
    return {...this.receipt(claim),...(event?{event}:{})};
  }
  admin(){return {error:this.error,controller:this.enrollment.admin(),receipts:this.error?[]:this.store.snapshot().receipts.filter(item=>item.expiresAt>this.now()).slice(-32).reverse().map(item=>({...this.receipt(item),kind:item.kind,at:item.at}))};}
  async connectController(device){
    if(this.closing)throw new HttpError(503,'Server is stopping.');
    const known=id=>this.registry.records.get('google-apps-script')?.config.snapshot().settings.clients.some(c=>c.enabled&&c.sensors&&c['device-id']===id);
    // Older native clients can retrieve only their already configured grant.
    if(device?.version===undefined&&known(device.deviceId))return this.controller(device);
    const approval=await this.enrollment.connect(device,known,phone=>this.createControllerGrant(phone));
    if(!approval.approved)return {scenes:null,sensors:null,...approval};
    const remoteClient=approval.permissions.remoteClient||'';
    const grants=this.controller({deviceId:device.deviceId});
    if(remoteClient){
      const client=this.registry.records.get('google-apps-script')?.config.snapshot().settings.clients.find(c=>c['client-id']===remoteClient);
      if(!client?.enabled){grants.scenes=null;grants.sensors=null;grants.reason='Remote access for this phone is disabled in administration.';}
      else if(remoteClient.startsWith('controller-')){if(!client.scenes)grants.scenes=null;if(!client.sensors)grants.sensors=null;}
    }
    return {...grants,approved:true,...(approval.approvalToken?{approvalToken:approval.approvalToken}:{})};
  }
  async createControllerGrant(phone){
    if(this.closing)throw new HttpError(503,'Server is stopping.');
    const record=this.registry.records.get('google-apps-script'),config=record?.config.snapshot();
    if(!config?.enabled||!relayKey.test(config.settings['collector-key']))return;
    try{relayUrl(config.settings.url);}catch{return;}
    const settings=structuredClone(config.settings);
    // Do not re-enable or widen an administrator's existing phone grants.
    const existing=settings.clients.find(c=>c['device-id']===phone.id&&c.sensors);if(existing)return existing['client-id'];
    if(settings.clients.length>=20)throw new HttpError(429,'The relay client limit is 20.');
    const id='controller-'+createHash('sha256').update(phone.id).digest('hex').slice(0,16);
    let name=phone.name,suffix=2;while(settings.clients.some(c=>c.name.toLowerCase()===name.toLowerCase()))name=phone.name.slice(0,56)+' '+suffix++;
    settings.clients.push({id,'client-id':id,name,enabled:true,key:randomBytes(32).toString('hex'),scenes:phone.scenes,sensors:phone.sensors,events:false,'device-id':phone.id});
    await this.registry.saveConfiguration(record.plugin.id,{revision:config.revision,settings});
    return id;
  }
  /** Trusted LAN phones receive only administrator-enabled client grants.
   * This read never creates clients, enables plugins or starts reporting. */
  controller(device) {
    if(!safeObject(device)||Object.keys(device).some(key=>key!=='deviceId')||!deviceId.test(device.deviceId))throw new HttpError(400,'Use this phone’s Controller connection screen.');
    const record=this.registry.records.get('google-apps-script');
    if(!record?.config.snapshot().enabled)return {scenes:null,sensors:null,reason:'Remote access has not been enabled by the administrator.'};
    const settings=record.config.snapshot().settings;
    try{relayUrl(settings.url);}catch{return {scenes:null,sensors:null,reason:'Remote access needs a valid Google deployment URL in administration.'};}
    const clients=settings.clients.filter(client=>client.enabled&&relayKey.test(client.key));
    const sensor=clients.find(client=>client.sensors&&client['device-id']===device.deviceId);
    const scene=(sensor?.scenes?sensor:null)||clients.find(client=>client.scenes&&!client.sensors);
    const profile=client=>client&&settings.url?{version:1,url:settings.url,clientId:client['client-id'],key:client.key,deviceId:client['device-id'],reportIntervalMs:(settings['report-seconds']||60)*1000}:null;
    return {scenes:profile(scene),sensors:profile(sensor),reason:scene?'':'The administrator has not enabled a Controller shortcut client.'};
  }
  async setup(values){
    if(!safeObject(values)||Object.keys(values).some(key=>!['revision','operation','clientId'].includes(key)))throw new HttpError(400,'Invalid relay setup request.');
    const record=this.registry.get('google-apps-script'),config=record.config.snapshot();
    if(values.revision!==config.revision)throw new HttpError(409,'Relay settings changed. Refresh before exporting.');
    if(values.operation==='phone-code')return this.enrollment.issue();
    if(values.operation==='keys'){
      const settings=structuredClone(config.settings);if(!relayKey.test(settings['collector-key']))settings['collector-key']=randomBytes(32).toString('hex');
      for(const client of settings.clients)if(!relayKey.test(client.key))client.key=randomBytes(32).toString('hex');
      await this.registry.saveConfiguration(record.plugin.id,{revision:config.revision,settings});return {saved:true};
    }
    if(values.operation==='script')return {filename:'Code.gs',text:await fs.readFile(path.join(this.root,'plugins',record.plugin.folder,'server/apps-script/Code.gs'),'utf8')};
    if(values.operation==='google'){
      if(!relayKey.test(config.settings['collector-key'])||config.settings.clients.some(client=>!relayKey.test(client.key)||!relayId.test(client['client-id'])||client['client-id']==='collector'))throw new HttpError(409,'Configure client IDs and generate keys first.');
      const clients=config.settings.clients.map(client=>({id:client['client-id'],key:client.key,enabled:client.enabled,scenes:client.scenes,sensors:client.sensors,events:client.events,deviceId:client['device-id']}));
      return {filename:'localserve-google-private.json',text:JSON.stringify({collectorKey:config.settings['collector-key'],reportIntervalMs:(config.settings['report-seconds']||60)*1000,clients},null,2)};
    }
    if(values.operation==='phone'){
      const client=config.settings.clients.find(item=>item['client-id']===values.clientId);if(!client||!relayKey.test(client.key)||!config.settings.url)throw new HttpError(409,'Configure this client, generate keys and save the deployment URL first.');
      return {filename:'localserve-'+client['client-id']+'-private.json',text:JSON.stringify({version:1,url:config.settings.url,clientId:client['client-id'],key:client.key,deviceId:client['device-id'],reportIntervalMs:(config.settings['report-seconds']||60)*1000},null,2)};
    }
    throw new HttpError(400,'Choose a relay setup operation.');
  }
  async close(){this.closing=true;this.registry.engine.gate.off('change',this.onGate);await this.enrollment.close();await Promise.allSettled([...this.operations]);await this.store.queue;}
}
