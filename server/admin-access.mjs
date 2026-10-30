/** Optional single-administrator password and independently revocable browser sessions.
 * Only salted password derivations and bearer hashes persist. No default password.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {scrypt as scryptCallback,randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {JsonStore,HttpError} from './storage.mjs';
const scrypt=promisify(scryptCallback),digest=value=>createHash('sha256').update(value).digest('hex');
const hex=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9-]{36}$/;
const maxAge=12*3600000;
const loginRequired=()=>Object.assign(new HttpError(401,'Sign in to administer this Sormus server.'),{authenticationRequired:true});
const defaults={schemaVersion:1,revision:1,enabled:false,salt:'',passwordHash:'',sessions:[]};
const checkKeys=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw new HttpError(400,'Invalid administrator access request.');};
function label(value){if(typeof value!=='string'||!value.trim()||value.trim().length>64||/[\u0000-\u001f\u007f]/.test(value))throw new HttpError(400,'Name this browser using 1 to 64 characters.');return value.trim();}
function password(value,newPassword=false){if(typeof value!=='string'||!value.length||value.length>256||Buffer.byteLength(value)>1024||newPassword&&value.length<10)throw new HttpError(400,newPassword?'Use a password of 10 to 256 characters.':'Enter your administrator password.');return value;}
export class AdminAccess{
  constructor(root,{now=Date.now}={}){Object.assign(this,{root,now});this.store=new JsonStore(path.join(root,'data/admin-access.json'),defaults);this.cookieName='sormus_admin_'+digest(path.resolve(root).toLowerCase()).slice(0,12);this.attempts=new Map();this.globalAttempts={until:0,count:0};this.deriving=0;this.operations=new Set();this.touches=new Set();this.closing=false;}
  async load(){
    try{const stat=await fs.lstat(this.store.file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024)throw Error('Invalid administrator access file.');}catch(error){if(error.code!=='ENOENT')throw error;}
    await this.store.load();this.validate(this.store.snapshot());
    if(this.store.snapshot().sessions.some(s=>s.expiresAt<=this.now()))await this.store.update(value=>{value.sessions=value.sessions.filter(s=>s.expiresAt>this.now());});return this;
  }
  validate(value){
    checkKeys(value,Object.keys(defaults));if(value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.enabled!=='boolean'||!Array.isArray(value.sessions)||value.sessions.length>32||value.enabled&&(!/^[a-f0-9]{32}$/.test(value.salt)||!hex.test(value.passwordHash))||!value.enabled&&(value.salt!==''||value.passwordHash!==''||value.sessions.length))throw Error('Administrator access settings are invalid; repair or recover them offline.');
    const ids=new Set(),tokens=new Set();for(const session of value.sessions){checkKeys(session,['id','revision','name','tokenHash','origin','createdAt','lastSeenAt','expiresAt']);if(!uuid.test(session.id)||!Number.isSafeInteger(session.revision)||session.revision<1||label(session.name)!==session.name||!hex.test(session.tokenHash)||ids.has(session.id)||tokens.has(session.tokenHash)||typeof session.origin!=='string'||session.origin.length>128||!/^http:\/\//.test(session.origin)||![session.createdAt,session.lastSeenAt,session.expiresAt].every(Number.isSafeInteger)||session.expiresAt<session.createdAt||session.expiresAt-session.createdAt>maxAge)throw Error('Invalid administrator sessions.');ids.add(session.id);tokens.add(session.tokenHash);}
  }
  enabled(){return this.store.snapshot().enabled;}
  token(request){const cookies=String(request.headers.cookie||'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(this.cookieName+'='));if(cookies.length!==1)return null;const value=cookies[0].slice(this.cookieName.length+1);return hex.test(value)?value:null;}
  session(request,origin){
    if(!this.enabled())return null;const bearer=this.token(request);if(!bearer)return null;const hashed=digest(bearer);
    const session=this.store.snapshot().sessions.find(s=>s.origin===origin&&s.expiresAt>this.now()&&timingSafeEqual(Buffer.from(s.tokenHash,'hex'),Buffer.from(hashed,'hex')));
    if(session)this.touch(session.id);return session||null;
  }
  require(request,origin){const session=this.session(request,origin);if(this.enabled()&&!session)throw loginRequired();return session;}
  status(request,origin){return {enabled:this.enabled(),authenticated:!this.enabled()||Boolean(this.session(request,origin))};}
  admin(currentId){const value=this.store.snapshot();return {enabled:value.enabled,revision:value.revision,currentSessionId:currentId||null,sessionHours:12,sessions:value.sessions.filter(s=>s.expiresAt>this.now()).map(({tokenHash,origin,...session})=>({...session,current:session.id===currentId}))};}
  touch(id){
    const session=this.store.snapshot().sessions.find(s=>s.id===id);if(!session||this.now()-session.lastSeenAt<60000||this.touches.has(id)||this.closing)return;
    this.touches.add(id);this.store.update(value=>{const item=value.sessions.find(s=>s.id===id);if(item)item.lastSeenAt=this.now();}).catch(()=>{}).finally(()=>this.touches.delete(id));
  }
  cookie(bearer){return `${this.cookieName}=${bearer||''}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${bearer?maxAge/1000:0}`;}
  async derive(value,salt){if(this.deriving>=2)throw new HttpError(429,'Administrator sign-in is busy. Try again shortly.');this.deriving++;try{return await scrypt(value,Buffer.from(salt,'hex'),32,{N:16384,r:8,p:1,maxmem:64*1024*1024});}finally{this.deriving--;}}
  async matches(value,settings){const actual=await this.derive(password(value),settings.salt);return timingSafeEqual(actual,Buffer.from(settings.passwordHash,'hex'));}
  admit(ip){
    const now=this.now();for(const [key,value]of this.attempts)if(value.until<=now)this.attempts.delete(key);
    if(this.globalAttempts.until<=now)this.globalAttempts={until:now+600000,count:0};
    let peer=this.attempts.get(ip);if(!peer){if(this.attempts.size>=128)throw new HttpError(429,'Too many sign-in attempts. Try again later.');peer={until:now+600000,count:0};this.attempts.set(ip,peer);}
    if(++peer.count>10||++this.globalAttempts.count>40)throw new HttpError(429,'Too many sign-in attempts. Wait ten minutes before trying again.');
  }
  track(action){if(this.closing)throw new HttpError(503,'Administrator access is stopping.');const operation=Promise.resolve().then(action);this.operations.add(operation);operation.finally(()=>this.operations.delete(operation)).catch(()=>{});return operation;}
  newSession(name,origin){const bearer=randomBytes(32).toString('hex'),at=this.now();return {bearer,session:{id:randomUUID(),revision:1,name:label(name),tokenHash:digest(bearer),origin,createdAt:at,lastSeenAt:at,expiresAt:at+maxAge}};}
  login(value,origin,ip){return this.track(async()=>{
    checkKeys(value,['password','name']);const name=label(value.name);password(value.password);const saved=this.store.snapshot();if(!saved.enabled)throw new HttpError(409,'Administrator sign-in is switched off.');this.admit(ip);
    if(!await this.matches(value.password,saved))throw new HttpError(401,'Password not accepted.');const next=this.newSession(name,origin);
    await this.store.update(current=>{if(this.closing||!current.enabled||current.revision!==saved.revision)throw new HttpError(409,'Access settings changed. Sign in again.');current.sessions=current.sessions.filter(s=>s.expiresAt>this.now());if(current.sessions.length>=32)throw new HttpError(429,'The administrator session limit is 32. Revoke an older session or wait for it to expire.');current.sessions.push(next.session);});
    return {cookie:this.cookie(next.bearer)};
  });}
  configure(value,request,origin){return this.track(async()=>{
    checkKeys(value,['revision','enabled','password','currentPassword','name']);const saved=this.store.snapshot(),caller=this.require(request,origin);
    if(!Number.isSafeInteger(value.revision)||value.revision!==saved.revision||typeof value.enabled!=='boolean')throw new HttpError(409,'Access settings changed. Reopen this editor.');
    if(saved.enabled){this.admit(request.socket.remoteAddress);if(!await this.matches(value.currentPassword,saved))throw new HttpError(401,'Password not accepted.');}
    let salt='',passwordHash='',next;
    if(value.enabled){password(value.password,true);salt=randomBytes(16).toString('hex');passwordHash=(await this.derive(value.password,salt)).toString('hex');next=this.newSession(value.name||caller?.name||'This browser',origin);}
    await this.store.update(current=>{if(this.closing||current.revision!==saved.revision||saved.enabled&&!current.sessions.some(s=>s.id===caller?.id&&s.expiresAt>this.now()))throw new HttpError(409,'Access changed. Sign in and try again.');Object.assign(current,{enabled:value.enabled,salt,passwordHash,sessions:next?[next.session]:[],revision:current.revision+1});});
    return {cookie:this.cookie(next?.bearer)};
  });}
  async logout(request,origin){const session=this.session(request,origin);if(session)await this.store.update(value=>{value.sessions=value.sessions.filter(s=>s.id!==session.id);});return {cookie:this.cookie(null)};}
  async changeSession(value,request,origin,remove=false){
    checkKeys(value,remove?['id']:['id','revision','name']);const caller=this.require(request,origin);if(!this.enabled()||!caller)throw new HttpError(409,'Administrator sign-in is switched off.');
    if(!uuid.test(value.id))throw new HttpError(400,'Choose an administrator session.');const name=remove?null:label(value.name);
    await this.store.update(current=>{if(!current.sessions.some(s=>s.id===caller.id&&s.expiresAt>this.now()))throw loginRequired();const session=current.sessions.find(s=>s.id===value.id&&s.expiresAt>this.now());if(!session)throw new HttpError(409,'This session has expired or was revoked.');if(remove)current.sessions=current.sessions.filter(s=>s.id!==value.id);else{if(session.revision!==value.revision)throw new HttpError(409,'This session changed. Reopen the editor.');session.name=name;session.revision++;}});
    return {signedOut:remove&&caller.id===value.id,...(remove&&caller.id===value.id?{cookie:this.cookie(null)}:{})};
  }
  async recover(){await this.store.update(value=>Object.assign(value,structuredClone(defaults),{revision:value.revision+1}));}
  async close(){this.closing=true;await Promise.allSettled([...this.operations]);await this.store.queue;}
}
