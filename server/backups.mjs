/** Bounded private configuration snapshots. Restores are journalled before stores load.
 * Archives contain data only; never executable source, runtime receipts or process locks.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {JsonStore,HttpError} from './storage.mjs';
import {protectBackupKey} from './backup-key.mjs';

const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const MAX_FILE=16*1024*1024,MAX_BYTES=64*1024*1024,MAX_FILES=2048;
const core=new Set(['config.json','tray/settings.json',...['tasks','vistas','vista-display','universe','games','phone-home','home-map','lighting-animations','controller-devices','devices','theme-pack'].map(name=>'data/'+name+'.json')]);
const permitted=name=>core.has(name)||/^plugins\/[a-z][a-z0-9-]{0,63}\/data\/(?:config\.json|cards\.json|controls\.json|[a-z][a-z0-9-]{0,63}\.dpapi)$/.test(name)||/^data\/home-map\/images\/[a-f0-9]{64}\.png$/.test(name);
const keys=(value,allowed)=>{if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!allowed.includes(k)))throw new HttpError(400,'Invalid backup request.');};
export class Backups{
  constructor(root,version,{keyProvider,now=Date.now,failAfterWrite}={}){Object.assign(this,{root:path.resolve(root),version,keyProvider,now,failAfterWrite});this.folder='data/backups';this.previews=new Map();this.items=[];this.busy=false;this.pending=null;this.error='';}
  async safe(relative,{directory=false,missing=false}={}){
    if(typeof relative!=='string'||relative.includes('\\')||relative.includes(':')||relative.split('/').some(s=>!s||s==='.'||s==='..'))throw Error('Invalid backup path.');
    const parts=relative.split('/');let current=this.root;
    for(let i=0;i<parts.length;i++){
      current=path.join(current,parts[i]);let stat;
      try{stat=await fs.lstat(current);}catch(error){if(error.code==='ENOENT'&&missing)return path.join(this.root,...parts);throw error;}
      if(stat.isSymbolicLink()|| (i<parts.length-1||directory ? !stat.isDirectory():!stat.isFile()))throw Error('Backup refuses linked or unsupported files.');
    }
    return current;
  }
  async read(relative,limit=MAX_FILE){const file=await this.safe(relative);const stat=await fs.stat(file);if(stat.size>limit)throw Error('Backup file exceeds its size limit.');const bytes=await fs.readFile(file);if(bytes.length>limit)throw Error('Backup file exceeds its size limit.');return bytes;}
  async optional(relative,limit){try{return await this.read(relative,limit);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  async write(relative,bytes){
    const destination=await this.safe(relative,{missing:true});await fs.mkdir(path.dirname(destination),{recursive:true});await this.safe(relative,{missing:true});
    const temporary=destination+'.'+randomUUID()+'.tmp';
    try{const handle=await fs.open(temporary,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}await this.safe(relative,{missing:true});await fs.rename(temporary,destination);}finally{await fs.rm(temporary,{force:true});}
  }
  async json(relative,value){await this.write(relative,Buffer.from(JSON.stringify(value,null,2)+'\n'));}
  async load(){
    await this.safe(this.folder,{directory:true,missing:true});await fs.mkdir(path.join(this.root,this.folder),{recursive:true});await this.safe(this.folder,{directory:true});
    this.settings=new JsonStore(path.join(this.root,this.folder,'settings.json'),{beforeUpdates:true,keepAutomatic:5});
    await this.safe(this.folder+'/settings.json',{missing:true});await this.settings.load();this.validateSettings(this.settings.snapshot());
    const pending=await this.optional(this.folder+'/restore.json',65536);if(pending){this.pending=JSON.parse(pending);this.validatePending(this.pending);}
    try{await this.refresh();}catch{this.error='Some backup files cannot be read. Original files were retained; inspect data/backups before creating or restoring snapshots.';}return this;
  }
  validateSettings(value){keys(value,['beforeUpdates','keepAutomatic']);if(typeof value.beforeUpdates!=='boolean'||!Number.isInteger(value.keepAutomatic)||value.keepAutomatic<1||value.keepAutomatic>50)throw new HttpError(400,'Keep 1 to 50 automatic backups.');}
  validatePending(value){keys(value,['id','phase','fingerprint','removals','stagedAt','safetyId']);if(!idPattern.test(value.id)||!idPattern.test(value.safetyId)||!['staged','applying'].includes(value.phase)||!/^[a-f0-9]{64}$/.test(value.fingerprint)||!Number.isSafeInteger(value.stagedAt)||!Array.isArray(value.removals)||value.removals.length>MAX_FILES||value.removals.some(n=>!permitted(n)))throw Error('Restore journal is invalid; original files were retained.');}
  async key(){
    if(this.keyBytes)return this.keyBytes;
    if(this.keyProvider){const key=await this.keyProvider();if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Invalid backup key.');return this.keyBytes=key;}
    const name=this.folder+'/key.dpapi',saved=await this.optional(name,4096);
    if(saved){const value=await protectBackupKey(saved,'Unprotect');if(value.length!==32)throw Error('Invalid backup key.');return this.keyBytes=value;}
    if(this.pending||(await fs.readdir(await this.safe(this.folder,{directory:true}))).some(name=>name.endsWith('.snapshot')))throw Error('The original backup key is missing. Existing backups were retained.');
    const value=randomBytes(32);await this.write(name,await protectBackupKey(value,'Protect'));return this.keyBytes=value;
  }
  async exclusive(operation){if(this.busy)throw new HttpError(409,'A backup operation is in progress.');this.busy=true;try{return await operation();}finally{this.busy=false;}}
  snapshot(){return {busy:this.busy,pending:this.pending?{stagedAt:this.pending.stagedAt,phase:this.pending.phase}:null,error:this.error,settings:this.settings.snapshot(),items:structuredClone(this.items)};}
  async refresh(){
    const items=[];await this.safe(this.folder,{directory:true});
    for(const name of await fs.readdir(path.join(this.root,this.folder))){if(!/^[a-f0-9-]{36}\.snapshot$/.test(name))continue;if(items.length>=200)throw Error('Too many local backups; move older snapshots out of data/backups.');
      const envelope=JSON.parse((await this.read(this.folder+'/'+name,MAX_BYTES*2)).toString('utf8'));this.validateEnvelope(envelope,name.slice(0,-9));
      items.push({...envelope.meta,bytes:(await fs.stat(await this.safe(this.folder+'/'+name))).size});
    }
    this.items=items.sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
  }
  validateEnvelope(value,id){
    keys(value,['format','meta','iv','tag','data']);keys(value.meta,['id','createdAt','version','kind','files']);
    if(value.format!=='sormus-backup-1'||value.meta.id!==id||!idPattern.test(id)||!Number.isSafeInteger(value.meta.createdAt)||!/^\d+\.\d+\.\d+$/.test(value.meta.version)||!['manual','before-update','before-restore'].includes(value.meta.kind)||!Number.isInteger(value.meta.files)||value.meta.files<0||value.meta.files>MAX_FILES||!/^[a-f0-9]{24}$/.test(value.iv)||!/^[a-f0-9]{32}$/.test(value.tag)||typeof value.data!=='string'||value.data.length>MAX_BYTES*2||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.data))throw Error('Invalid encrypted backup.');
  }
  async collect(){
    const names=[...core];
    const plugins=await this.safe('plugins',{directory:true,missing:true});let entries=[];try{entries=await fs.readdir(plugins,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
    const versions={};
    for(const entry of entries){if(!/^[a-z][a-z0-9-]{0,63}$/.test(entry.name))continue;if(entry.isSymbolicLink())throw Error('Backup refuses linked plugins.');if(!entry.isDirectory())continue;
      const declaration=await this.optional('plugins/'+entry.name+'/declaration.json',1024*1024);if(!declaration)continue;const plugin=JSON.parse(declaration);versions[entry.name]=plugin.version;
      for(const file of ['config.json','cards.json','controls.json'])names.push(`plugins/${entry.name}/data/${file}`);
      const folder=`plugins/${entry.name}/data`;try{await this.safe(folder,{directory:true});for(const file of await fs.readdir(path.join(this.root,folder)))if(/^[a-z][a-z0-9-]{0,63}\.dpapi$/.test(file))names.push(folder+'/'+file);}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    const images='data/home-map/images';try{await this.safe(images,{directory:true});for(const file of await fs.readdir(path.join(this.root,images)))if(/^[a-f0-9]{64}\.png$/.test(file))names.push(images+'/'+file);}catch(error){if(error.code!=='ENOENT')throw error;}
    const files=[];let total=0;
    for(const name of names.sort()){const bytes=await this.optional(name);if(!bytes)continue;total+=bytes.length;if(total>MAX_BYTES||files.length>=MAX_FILES)throw Error('Saved configuration exceeds backup limits.');files.push({path:name,sha256:hash(bytes),data:bytes.toString('base64')});}
    return {versions,files};
  }
  fingerprint(value){return hash(JSON.stringify({versions:value.versions,files:value.files.map(f=>[f.path,f.sha256])}));}
  async stable(){const first=await this.collect(),second=await this.collect();if(this.fingerprint(first)!==this.fingerprint(second))throw new HttpError(409,'Saved settings changed during backup. Try again when editing finishes.');return first;}
  async seal(payload,meta){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',await this.key(),iv);cipher.setAAD(Buffer.from(JSON.stringify(meta)));const data=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(payload)))),cipher.final()]);return {format:'sormus-backup-1',meta,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('base64')};}
  async open(id){
    if(!idPattern.test(id))throw new HttpError(400,'Choose a saved backup.');
    const envelope=JSON.parse((await this.read(`${this.folder}/${id}.snapshot`,MAX_BYTES*2)).toString('utf8'));this.validateEnvelope(envelope,id);
    let payload;try{const cipher=createDecipheriv('aes-256-gcm',await this.key(),Buffer.from(envelope.iv,'hex'));cipher.setAAD(Buffer.from(JSON.stringify(envelope.meta)));cipher.setAuthTag(Buffer.from(envelope.tag,'hex'));payload=JSON.parse(gunzipSync(Buffer.concat([cipher.update(Buffer.from(envelope.data,'base64')),cipher.final()]),{maxOutputLength:MAX_BYTES*2}).toString('utf8'));}catch{throw new HttpError(400,'This backup cannot be unlocked or its integrity check failed.');}
    this.validatePayload(payload,envelope.meta.files);return {payload,meta:envelope.meta};
  }
  validatePayload(value,count){
    keys(value,['versions','files']);if(!value.versions||Array.isArray(value.versions)||typeof value.versions!=='object'||!Array.isArray(value.files)||value.files.length!==count||count>MAX_FILES)throw Error('Invalid backup inventory.');
    let total=0;const seen=new Set();for(const file of value.files){keys(file,['path','data','sha256']);if(!permitted(file.path)||seen.has(file.path)||typeof file.data!=='string'||file.data.length>MAX_FILE*2||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid backup file.');seen.add(file.path);const bytes=Buffer.from(file.data,'base64');total+=bytes.length;if(total>MAX_BYTES||bytes.length>MAX_FILE||hash(bytes)!==file.sha256)throw Error('Backup checksum failed.');if(file.path.endsWith('.json'))JSON.parse(bytes.toString('utf8'));}
  }
  async create(kind='manual',version=this.version){return this.exclusive(async()=>{if(this.pending)throw new HttpError(409,'Finish or cancel the pending restore first.');const item=await this.createInside(kind,version);await this.prune();return item;});}
  async createInside(kind,version=this.version){
    if(this.error)throw new HttpError(409,this.error);
    if(this.items.length>=200)throw new HttpError(409,'Move older snapshots out of data/backups before creating more.');
    const payload=await this.stable(),meta={id:randomUUID(),createdAt:this.now(),version,kind,files:payload.files.length};
    const envelope=await this.seal(payload,meta);await this.json(`${this.folder}/${meta.id}.snapshot`,envelope);await this.open(meta.id);await this.refresh();return this.items.find(i=>i.id===meta.id);
  }
  async prune(){
    const automatic=this.items.filter(i=>i.kind==='before-update'),remove=automatic.slice(this.settings.snapshot().keepAutomatic);
    for(const item of remove){if(this.pending?.id===item.id||this.pending?.safetyId===item.id)continue;await this.open(item.id);await fs.rm(await this.safe(`${this.folder}/${item.id}.snapshot`));}await this.refresh();
  }
  async saveSettings(value){this.validateSettings(value);return this.exclusive(async()=>{if(this.pending)throw new HttpError(409,'A restore is pending.');await this.safe(this.folder+'/settings.json');await this.settings.update(current=>Object.assign(current,value));await this.prune();return this.snapshot();});}
  async beforeStartup(){
    const marker=this.folder+'/version.json',old=await this.optional(marker,4096);const previous=old?JSON.parse(old).version:null;
    if(previous&&previous!==this.version&&this.settings.snapshot().beforeUpdates&&await this.optional('config.json')){
      const recent=this.items.find(item=>item.kind==='before-update'&&item.version===previous);
      const alreadySaved=recent&&this.fingerprint((await this.open(recent.id)).payload)===this.fingerprint(await this.stable());
      if(!alreadySaved)await this.create('before-update',previous);
    }
    await this.json(marker,{version:this.version});
  }
  async preview(id){return this.exclusive(async()=>{
    if(this.pending)throw new HttpError(409,'Finish or cancel the pending restore first.');
    const {payload,meta}=await this.open(id),current=await this.stable();
    const old=meta.version.split('.').map(Number),installed=this.version.split('.').map(Number);
    if(old[0]!==installed[0]||old[1]>installed[1]||old[1]===installed[1]&&old[2]>installed[2])throw new HttpError(409,'Use a compatible server version before restoring this backup.');
    for(const [plugin,version]of Object.entries(payload.versions))if(current.versions[plugin]!==version)throw new HttpError(409,'Installed plugin versions differ from this backup. Restore matching plugin software first.');
    const before=new Map(current.files.map(f=>[f.path,f.sha256])),after=new Map(payload.files.map(f=>[f.path,f.sha256]));
    const changes=[];for(const [name,digest]of after)if(before.get(name)!==digest)changes.push({path:name,change:before.has(name)?'replace':'add'});
    const removals=[...before.keys()].filter(name=>!after.has(name)&&!name.startsWith('data/home-map/images/'));for(const name of removals)changes.push({path:name,change:'remove'});
    const taskFile=payload.files.find(f=>f.path==='data/tasks.json'),tasks=taskFile?JSON.parse(Buffer.from(taskFile.data,'base64')):[];
    if(!Array.isArray(tasks))throw Error('Invalid saved Tasks.');
    const token=randomBytes(24).toString('hex');this.previews.clear();this.previews.set(token,{id,fingerprint:this.fingerprint(current),removals,expires:this.now()+300000});
    return {token,expires:this.now()+300000,backup:meta,changes,tasks:tasks.length,plugins:Object.keys(payload.versions).length,notice:'Restore applies at the next normal restart. All restored Tasks and plugins are disabled, and the server stays paused. Current runtime receipts and history are retained. Windows startup and firewall settings are not changed.'};
  });}
  async stage(token){return this.exclusive(async()=>{
    const preview=this.previews.get(token);this.previews.delete(token);if(!preview||preview.expires<this.now()||this.pending)throw new HttpError(409,'Preview this backup again before restoring.');
    if(this.fingerprint(await this.stable())!==preview.fingerprint)throw new HttpError(409,'Saved settings changed. Preview again before restoring.');
    await this.open(preview.id);const safety=await this.createInside('before-restore');
    if(this.fingerprint((await this.open(safety.id)).payload)!==preview.fingerprint)throw new HttpError(409,'Settings changed while creating the safety snapshot. Preview again.');
    const pending={id:preview.id,phase:'staged',fingerprint:preview.fingerprint,removals:preview.removals,stagedAt:this.now(),safetyId:safety.id};
    await this.json(this.folder+'/restore.json',pending);this.pending=pending;return {pending:true,restartRequired:true,safetyId:safety.id};
  });}
  async cancel(){return this.exclusive(async()=>{if(this.pending?.phase==='applying')throw new HttpError(409,'Restore has started. Restart to finish it.');await this.safe(this.folder+'/restore.json',{missing:true});await fs.rm(path.join(this.root,this.folder,'restore.json'),{force:true});this.pending=null;return this.snapshot();});}
  async applyPending(){
    if(!this.pending)return false;const pending=this.pending,{payload}=await this.open(pending.id),{payload:safety}=await this.open(pending.safetyId);
    const retained=new Set(payload.files.map(file=>file.path));
    const removals=safety.files.map(file=>file.path).filter(name=>!retained.has(name)&&!name.startsWith('data/home-map/images/'));
    if(this.fingerprint(safety)!==pending.fingerprint||JSON.stringify([...removals].sort())!==JSON.stringify([...pending.removals].sort()))throw Error('Restore journal does not match its authenticated safety snapshot.');
    if(pending.phase==='staged'&&this.fingerprint(await this.stable())!==pending.fingerprint)throw Error('Settings changed after restore was staged. Original files were retained; cancel the restore offline.');
    pending.phase='applying';await this.json(this.folder+'/restore.json',pending);
    // Retain current receipts/history, and persist pause before touching definitions.
    const stateFile=await this.optional('data/state.json');const state=stateFile?JSON.parse(stateFile):{plugins:{},runs:[],claims:[]};state.paused=true;
    for(const plugin of Object.values(state.plugins||{}))if(plugin&&typeof plugin==='object')plugin.enabled=false;
    await this.json('data/state.json',state);
    let written=0;
    for(const file of payload.files){let bytes=Buffer.from(file.data,'base64');
      if(file.path==='data/tasks.json'){const tasks=JSON.parse(bytes);if(!Array.isArray(tasks))throw Error('Invalid backup Tasks.');for(const task of tasks){task.enabled=false;task.revision=(task.revision||0)+1;}bytes=Buffer.from(JSON.stringify(tasks,null,2)+'\n');}
      if(/^plugins\/[^/]+\/data\/config\.json$/.test(file.path)){const config=JSON.parse(bytes);config.enabled=false;config.revision=(config.revision||0)+1;bytes=Buffer.from(JSON.stringify(config,null,2)+'\n');}
      await this.write(file.path,bytes);if(this.failAfterWrite)await this.failAfterWrite(++written);
    }
    for(const name of pending.removals){await this.safe(name,{missing:true});await fs.rm(path.join(this.root,name),{force:true});}
    await this.json(this.folder+'/last-restore.json',{at:this.now(),backupId:pending.id,safetyId:pending.safetyId,tasksDisabled:true,pluginsDisabled:true});
    await fs.rm(await this.safe(this.folder+'/restore.json'));this.pending=null;this.previews.clear();return true;
  }
  async remove(id){return this.exclusive(async()=>{if(this.pending)throw new HttpError(409,'Finish or cancel the pending restore first.');await this.open(id);await fs.rm(await this.safe(`${this.folder}/${id}.snapshot`));await this.refresh();return this.snapshot();});}
}
