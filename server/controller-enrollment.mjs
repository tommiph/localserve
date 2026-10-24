/** Short-lived administrator codes approve native phones on the trusted LAN.
 * Only token hashes persist; codes and credential responses never enter logs. */
import path from 'node:path';
import {createHash,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {JsonStore,HttpError} from './storage.mjs';
const phoneId=/^android-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===64&&b.length===64&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export class ControllerEnrollment {
  constructor(root,{now=Date.now}={}){this.now=now;this.code=null;this.error='';this.queue=Promise.resolve();this.store=new JsonStore(path.join(root,'data/controller-devices.json'),{schemaVersion:1,phones:[]});}
  async load(){
    try{await this.store.load();const value=this.store.snapshot();if(value.schemaVersion!==1||!Array.isArray(value.phones)||value.phones.length>20||new Set(value.phones.map(p=>p.id)).size!==value.phones.length||value.phones.some(p=>!phoneId.test(p.id)||typeof p.name!=='string'||p.name.length>64||!/^[a-f0-9]{64}$/.test(p.tokenHash)||typeof p.scenes!=='boolean'||typeof p.sensors!=='boolean'))throw Error();}
    catch{this.error='Controller approvals could not be loaded. The saved file was retained.';}return this;
  }
  issue(){
    if(this.error)throw new HttpError(409,this.error);
    const alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';let code='';for(let i=0;i<6;i++)code+=alphabet[randomInt(alphabet.length)];
    this.code={hash:hash(code),expiresAt:this.now()+300000,attempts:0};return {code,expiresAt:this.code.expiresAt};
  }
  connect(value,known,createGrant){
    const operation=this.queue.then(()=>this.perform(value,known,createGrant));this.queue=operation.catch(()=>{});return operation;
  }
  async perform(value,known,createGrant){
    if(this.error)throw new HttpError(409,this.error);
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['deviceId','name','version','approvalToken','code'].includes(key))||!phoneId.test(value.deviceId)||value.version!==undefined&&value.version!==2||value.name!==undefined&&(typeof value.name!=='string'||value.name.length>64||/[\u0000-\u001f]/.test(value.name))||value.approvalToken!==undefined&&!/^[a-f0-9]{64}$/.test(value.approvalToken)||value.code!==undefined&&(typeof value.code!=='string'||value.code.length>16))throw new HttpError(400,'Use Controller to connect this phone.');
    const old=this.store.snapshot().phones.find(p=>p.id===value.deviceId);
    if(old&&same(old.tokenHash,value.approvalToken&&hash(value.approvalToken))){
      if(!old.remoteClient){
        const id=await createGrant(old);
        if(id){old.remoteClient=id;await this.store.update(state=>{state.phones.find(p=>p.id===old.id).remoteClient=id;});}
      }
      return {approved:true,permissions:old};
    }
    // Installed, enabled phone identities retain access when upgrading the app.
    // A previously approved phone with a missing token must use a new code.
    const migration=!old&&known(value.deviceId);
    if(!migration){
      const code=this.code;
      if(!value.code)return {approvalRequired:true,reason:'In administration, open Google Apps Script → Settings → Approve a phone. Enter the six-character code here.'};
      if(!code||code.expiresAt<=this.now()||++code.attempts>8||!same(code.hash,hash(value.code.trim().toUpperCase())))return {approvalRequired:true,reason:'Code incorrect or expired. Generate a new code in administration.'};
      this.code=null;
    }
    if(!old&&this.store.snapshot().phones.length>=20)throw new HttpError(429,'The approved phone limit is 20.');
    const approvalToken=randomBytes(32).toString('hex');
    const phone={id:value.deviceId,name:value.name?.trim()||'Controller phone',tokenHash:hash(approvalToken),scenes:true,sensors:true};
    phone.remoteClient=await createGrant(phone)||'';
    await this.store.update(state=>{const index=state.phones.findIndex(p=>p.id===phone.id);if(index<0)state.phones.push(phone);else state.phones[index]=phone;});
    return {approved:true,approvalToken,permissions:phone};
  }
  admin(){return {error:this.error,phones:this.error?[]:this.store.snapshot().phones.map(({id,name,scenes,sensors})=>({id,name,scenes,sensors}))};}
  async close(){this.code=null;await this.queue;await this.store.queue;}
}
