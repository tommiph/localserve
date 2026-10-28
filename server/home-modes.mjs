/** Public mode capabilities and Task integration use the ordinary plugin queue.
 * The optional plugin owns selection state; this bridge never replays changes. */
import path from 'node:path';
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {JsonStore,HttpError} from './storage.mjs';
import {modeEntries,modeState} from './home-mode-contract.mjs';
import {eventConditionMatches} from './rules.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class HomeModes {
  constructor(root,registry,engine){Object.assign(this,{root,registry,engine});this.secret=randomBytes(32);this.runtimeIds=new WeakMap();this.operations=new Set();this.controllers=new Set();this.closing=false;}
  async load(){
    try {
      this.runs=await new JsonStore(path.join(this.root,'data/home-mode-runs.json'),[]).load();
      if(!Array.isArray(this.runs.snapshot())||this.runs.snapshot().length>256||this.runs.snapshot().some(run=>!uuid.test(run.id)||!Number.isSafeInteger(run.expires)))throw Error('Invalid mode receipts.');
    }catch{
      this.error='Public home mode controls are unavailable; the invalid receipt file was retained.';
      await this.engine.activity.add(this.error,{level:'warning',source:'Home modes'}).catch(()=>{});
    }
    return this;
  }
  record(){const records=[...this.registry.records.values()].filter(record=>record.plugin.modeSelector&&record.config.snapshot().enabled);return records.length===1?records[0]:null;}
  ready(record,insideAction=false){return !this.closing&&(insideAction||!this.error)&&!this.engine.gate.paused&&record?.runtime&&record.configured&&record.health==='ready'&&(insideAction||!record.pending);}
  runtimeId(record){if(!this.runtimeIds.has(record.runtime))this.runtimeIds.set(record.runtime,randomBytes(12).toString('hex'));return this.runtimeIds.get(record.runtime);}
  sign(value){return createHmac('sha256',this.secret).update(value).digest('hex');}
  equal(a,b){return typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
  token(record,revision,expires){return this.sign(JSON.stringify(['mode',record.plugin.id,this.runtimeId(record),revision,expires]));}
  receiptToken(id){return this.sign('mode-receipt:'+id);}
  viewer(){
    const record=this.record();if(!record)return null;
    let items;try{items=modeEntries(record.config.snapshot().settings).filter(mode=>mode.enabled);}catch{return null;}
    const revision=record.config.snapshot().revision,expires=Date.now()+300000,available=Boolean(this.ready(record));
    const current=modeState(record.config.snapshot().settings,record.state.snapshot());
    return {revision,expires,available,token:available?this.token(record,revision,expires):null,currentId:current['mode-id'],changedAt:current['changed-at']||null,
      items:items.map(({id,name,icon,color})=>({id,name,icon,color}))};
  }
  taskFor(event){
    const record=this.record();if(!this.ready(record,true)||record.plugin.id!==event.pluginId||event.eventId!=='mode-changed')return null;
    const state=record.state.snapshot();if(state['transition-id']!==event.payload['transition-id']||state['mode-id']!==event.payload['mode-id'])return null;
    const mode=modeEntries(record.config.snapshot().settings).find(mode=>mode.enabled&&mode.id===event.payload['mode-id']);
    return mode?.['task-id']?{id:mode['task-id'],record,revision:record.config.snapshot().revision}:null;
  }
  async dispatch(event,binding){
    const task=this.engine.tasks.snapshot().find(task=>task.id===binding.id);
    try {
      if(!this.ready(binding.record,true)||this.taskFor(event)?.id!==binding.id||binding.record.config.snapshot().revision!==binding.revision)throw Error('Mode binding changed or became unavailable.');
      const run=await this.engine.start(binding.id,'Home mode: '+event.payload['mode-name'],event,{automatic:true,revision:task?.revision});
      return {status:'started',runId:run.id};
    }catch(error){await this.engine.activity.add('Home mode Task not started: '+(task?.name||'Unavailable Task')+': '+error.message,{level:'warning',pluginId:event.pluginId});return {status:'not-started'};}
  }
  comparison(rule){
    // Most comparisons belong to other plugins. Do not rebuild the complete
    // Event catalogue for each high-frequency phone/sensor comparison.
    const parts=typeof rule.eventId==='string'?rule.eventId.split(':'):[];
    const declared=this.registry.records.get(parts[1]);
    if(parts.length!==4||parts[0]!=='plugin'||parts[2]!=='event'||parts[3]!=='mode-changed'||!declared?.plugin.modeSelector)return undefined;
    const record=this.record();if(record!==declared||!this.ready(record,true))return null;
    const state=modeState(record.config.snapshot().settings,record.state.snapshot());
    if(!state['mode-id'])return null;
    return eventConditionMatches(rule.condition,state);
  }
  owns(id,token){return this.equal(token,this.receiptToken(id));}
  status(id,token){
    if(!this.owns(id,token))throw new HttpError(403,'Use the current mode receipt.');
    const run=this.runs?.snapshot().find(item=>item.id===id);if(!run)throw new HttpError(404,'Mode receipt is unavailable.');
    const task=run.taskRunId&&this.engine.state.snapshot().runs.find(item=>item.id===run.taskRunId);
    return {requestId:id,token:this.receiptToken(id),status:run.status,changed:run.changed??false,
      taskStatus:task?.status||run.taskStatus||'not-requested'};
  }
  select(value,token){
    const operation=this.admit(value,token);this.operations.add(operation);operation.finally(()=>this.operations.delete(operation)).catch(()=>{});return operation;
  }
  async admit(value,token){
    if(!value||Object.keys(value).some(key=>!['modeId','revision','expires','requestId'].includes(key))||!uuid.test(value.requestId)
      ||typeof value.modeId!=='string'||!Number.isSafeInteger(value.revision)||!Number.isSafeInteger(value.expires))throw new HttpError(400,'Use a current home mode.');
    const record=this.record();if(!this.ready(record))throw new HttpError(409,'Home modes are unavailable or paused.');
    if(!this.equal(token,this.token(record,value.revision,value.expires))||value.expires<=Date.now()||value.expires>Date.now()+360000)throw new HttpError(403,'Refresh home modes before selecting.');
    const existing=this.runs.snapshot().find(run=>run.id===value.requestId);
    if(existing){if(existing.modeId!==value.modeId)throw new HttpError(409,'Request already used.');return this.status(existing.id,this.receiptToken(existing.id));}
    const revision=value.revision,runtime=record.runtime;
    const check=()=>{
      if(this.record()!==record||!this.ready(record)||record.runtime!==runtime||record.config.snapshot().revision!==revision
        ||!modeEntries(record.config.snapshot().settings).some(mode=>mode.enabled&&mode.id===value.modeId))throw new HttpError(409,'Home modes changed. Refresh before selecting.');
    };
    check();
    await this.runs.update(runs=>{
      check();if(runs.some(run=>run.id===value.requestId))throw new HttpError(409,'Request already submitted. Check Activity.');
      const kept=runs.filter(run=>run.expires>Date.now());if(kept.length>=256)throw new HttpError(429,'Too many recent mode requests.');
      runs.splice(0,runs.length,...kept,{id:value.requestId,modeId:value.modeId,expires:value.expires,status:'interrupted'});
    });
    const controller=new AbortController();this.controllers.add(controller);
    try {
      check();const result=await this.registry.execute(record.plugin.id,'select-mode',{'mode-id':value.modeId},{signal:controller.signal,configRevision:revision});
      await this.runs.update(runs=>Object.assign(runs.find(run=>run.id===value.requestId),{status:'completed',changed:result.changed===true,
        taskStatus:['started','not-started','not-assigned','not-requested'].includes(result.taskStatus)?result.taskStatus:'not-requested',
        taskRunId:typeof result.taskRunId==='string'&&uuid.test(result.taskRunId)?result.taskRunId:null}));
      return this.status(value.requestId,this.receiptToken(value.requestId));
    }finally{this.controllers.delete(controller);}
  }
  async close(){this.closing=true;for(const controller of this.controllers)controller.abort();await Promise.allSettled([...this.operations]);}
}
