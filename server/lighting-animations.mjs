/** Revisioned lighting sequences. Only an explicit Start admits device writes;
 * durable run claims prevent restart or repeated requests from replaying them. */
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {JsonStore, HttpError} from './storage.mjs';

const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw new HttpError(400, 'Unknown lighting animation property.');
}
function number(value, min, max) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }
export function validateAnimation(value, old = null) {
  object(value, ['id','revision','name','enabled','spread','durationMinutes','targets','steps']);
  if (old && value.revision !== old.revision) throw new HttpError(409, 'Animation changed. Reopen its editor.');
  if (old && old.revision >= Number.MAX_SAFE_INTEGER) throw new HttpError(409, 'Animation revision limit reached. Copy it to continue editing.');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 64 || /[\u0000-\u001f]/.test(value.name)
    || typeof value.enabled !== 'boolean' || typeof value.spread !== 'boolean' || !number(value.durationMinutes,0,1440)
    || !Array.isArray(value.targets) || value.targets.length > 10 || new Set(value.targets).size !== value.targets.length
    || value.targets.some(id => typeof id !== 'string' || !/^\d{1,10}$/.test(id))
    || !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 32)
    throw new HttpError(400, 'Enter a name, up to ten lights, a duration of 0–1440 minutes and 1–32 steps.');
  const seen = new Set();
  const steps = value.steps.map(step => {
    object(step, ['id','enabled','color','brightness','warmth','seconds','secondsMax','fadeSeconds']);
    if (!identifier(step.id) || seen.has(step.id) || typeof step.enabled !== 'boolean'
      || !/^#[a-f0-9]{6}$/i.test(step.color) || !number(step.brightness,0,100) || !number(step.warmth,0,100)
      || !number(step.seconds,0.1,3600) || !number(step.secondsMax ?? step.seconds,step.seconds,3600)
      || !number(step.fadeSeconds,0,60) || step.fadeSeconds > step.seconds)
      throw new HttpError(400, 'Each step needs a unique ID, colour, brightness 0–100%, warmth 0–100%, hold min/max 0.1–3600 s and fade 0–60 s within the minimum hold.');
    seen.add(step.id); return {...step, color:step.color.toUpperCase()};
  });
  if (!steps.some(step => step.enabled)) throw new HttpError(400, 'Enable at least one animation step.');
  return {id:old?.id || randomUUID(),revision:(old?.revision || 0)+1,name:value.name.trim(),enabled:value.enabled,
    spread:value.spread,durationMinutes:value.durationMinutes,targets:[...value.targets],steps};
}

export function animationPresets() {
  const designs = [
    ['party','Party mode',2,0.4,80,['#FF26B0','#00DCFF','#FFC528','#8B40FF'],true],
    ['disco','Disco floor',1,0,95,['#FF3055','#2F82FF','#FFE035','#31FFAD'],true],
    ['dining','Fine dining',30,20,28,['#FFC994','#FFD8B0','#F9B681','#FFDFBF'],false],
    ['aurora','Aurora borealis',30,25,45,['#28EFA3','#28C6D9','#5954DE','#C77EF1'],true],
    ['candlelight','Candlelight',6,4,22,['#FFAE55','#FFC477','#F59A40','#FFD095'],true],
    ['sunset','Sunset lounge',25,20,42,['#FFB26B','#FF736D','#D97BAE','#9B77CD'],true],
    ['ocean','Ocean drift',20,16,48,['#239AC6','#37D8CF','#327DC3','#66C4D5'],true],
    ['forest','Forest canopy',25,20,38,['#6BAE5B','#ACCF7D','#34A88D','#E0C886'],true],
    ['neon','Neon city',8,5,65,['#F833DA','#515BFF','#00C9EE','#B96EFF'],true],
    ['moonlight','Moonlight',40,35,18,['#7F9BCC','#A3AEDE','#8795B6','#BAC8E2'],false],
  ];
  const presets = designs.map(([id,name,seconds,fadeSeconds,brightness,colors,spread]) => ({id:'preset-'+id,revision:1,
    name,enabled:true,spread,durationMinutes:0,targets:[],steps:colors.map((color,index)=>({id:`step-${index+1}`,enabled:true,color,
      brightness:Math.max(1,brightness-(index%2)*Math.round(brightness*0.22)),warmth:['dining','candlelight','sunset'].includes(id)?90:40,
      seconds,fadeSeconds}))}));
  presets.push({id:'preset-lightning',revision:1,name:'Lightning',enabled:true,spread:false,durationMinutes:1,targets:[],
    steps:[
      {id:'flash-one',enabled:true,color:'#FFFFFF',brightness:100,warmth:0,seconds:0.1,secondsMax:0.3,fadeSeconds:0},
      {id:'dark-short',enabled:true,color:'#FFFFFF',brightness:0,warmth:0,seconds:0.1,secondsMax:0.8,fadeSeconds:0},
      {id:'flash-two',enabled:true,color:'#FFFFFF',brightness:100,warmth:0,seconds:0.1,secondsMax:0.2,fadeSeconds:0},
      {id:'dark-long',enabled:true,color:'#FFFFFF',brightness:0,warmth:0,seconds:0.1,secondsMax:1.5,fadeSeconds:0},
    ]});
  return presets;
}

export function sampleHoldSeconds(step, random = Math.random) {
  const maximum = step.secondsMax ?? step.seconds;
  return step.seconds + (maximum-step.seconds)*random();
}

export function lightCommand(light, step) {
  // Explicit Off accompanies zero dimmer so a dark pulse cannot turn a bulb on.
  const command = {id:light.id,on:step.brightness>0,brightness:step.brightness};
  if (light.spectrum === 'rgb') {
    const values=step.color.match(/[a-f0-9]{2}/ig).map(value=>parseInt(value,16)/255);
    const [red,green,blue]=values,max=Math.max(...values),min=Math.min(...values),delta=max-min;
    let hue=delta===0?0:max===red?((green-blue)/delta)%6:max===green?(blue-red)/delta+2:(red-green)/delta+4;
    command.hue=(hue*60+360)%360;command.saturation=max===0?0:delta/max*100;
  } else if (light.spectrum === 'white') command.temperature=step.warmth;
  return command;
}

export class LightingAnimations {
  constructor(root, registry, activity) {
    Object.assign(this,{registry,activity});this.active=null;this.closing=false;this.error='';
    this.store=new JsonStore(path.join(root,'data/lighting-animations.json'),{schemaVersion:1,animations:animationPresets()});
    this.runs=new JsonStore(path.join(root,'data/lighting-animation-runs.json'),{schemaVersion:1,runs:[]});
  }
  async load() {
    try {
      await this.store.load();const saved=this.store.snapshot();
      if(saved.schemaVersion!==1 || !Array.isArray(saved.animations) || saved.animations.length>100)throw Error();
      const ids=new Set(),names=new Set();
      for(const item of saved.animations){
        if(!identifier(item.id)||ids.has(item.id)||!Number.isSafeInteger(item.revision)||item.revision<1||names.has(item.name.toLowerCase()))throw Error();
        validateAnimation(item,item);ids.add(item.id);names.add(item.name.toLowerCase());
      }
      await this.runs.load();const history=this.runs.snapshot();
      if(history.schemaVersion!==1||!Array.isArray(history.runs)||history.runs.length>50
        ||history.runs.some(run=>!identifier(run.id)||!identifier(run.animationId)||!['running','completed','stopped','failed','interrupted'].includes(run.status)))throw Error();
      if(history.runs.some(run=>run.status==='running'))await this.runs.update(value=>{
        for(const run of value.runs)if(run.status==='running')Object.assign(run,{status:'interrupted',finishedAt:Date.now(),message:'Server restarted. Animation was not resumed.'});
      });
    } catch {this.error='Lighting animation storage is unavailable. Original files were retained.';}
    return this;
  }
  lights() {
    const service=this.registry.services().find(service=>service.id==='tradfri');
    if(!service)return [];
    const data=service.cardData?.values || {},declaration=service.controls?.lighting;
    if(!declaration || !service.config?.settings || !service.pluginState
      || service.config.settings[declaration.identitySetting] !== service.pluginState[declaration.identityState])return [];
    const rows=keys=>(keys||[]).flatMap(key=>data[key]?.available?data[key].value:[]);
    const details=new Map(rows(declaration?.details).map(row=>[row.id,row]));
    return rows(declaration?.lights).map(row=>({...row,...details.get(row.id)})).slice(0,20);
  }
  availability() {
    if(this.error)return this.error;
    if(this.closing)return 'Server is stopping.';
    if(this.registry.engine.gate.paused)return 'Enable server functions first.';
    const status=this.registry.actionAvailability('tradfri','light-state');
    return status.available?'':status.unavailableReason || 'Configure and enable TRÅDFRI first.';
  }
  admin() {
    return {animations:this.error?[]:this.store.snapshot().animations,lights:this.lights(),reason:this.availability(),
      timing:{minimumHoldSeconds:0.1,randomHolds:true,darkSteps:true},
      active:this.active?{...this.active.receipt,step:this.active.step,cycles:this.active.cycles,paused:this.registry.engine.gate.paused}:null,
      recent:this.error?[]:this.runs.snapshot().runs.slice(-10).reverse()};
  }
  ensure() {if(this.error||this.closing)throw new HttpError(409,this.error||'Server is stopping.');}
  async save(values,id=null,operation=null) {
    this.ensure();
    await this.store.update(current=>{
      const index=current.animations.findIndex(item=>item.id===id),old=current.animations[index];
      if(id&&(!old||values.revision!==old.revision))throw new HttpError(409,'Animation changed. Refresh before editing.');
      if(operation){object(values,operation==='enabled'?['revision','enabled']:['revision']);}
      if(operation==='delete'){current.animations.splice(index,1);return;}
      let candidate=operation==='enabled'?{...old,enabled:values.enabled}:values;
      if(operation==='copy'){
        let name=old.name.slice(0,52)+' copy',n=2;
        while(current.animations.some(item=>item.name.toLowerCase()===name.toLowerCase()))name=old.name.slice(0,48)+` copy ${n++}`;
        candidate={...old,id:undefined,revision:undefined,name,enabled:false,steps:old.steps.map(step=>({...step,id:randomUUID()}))};
      }
      const item=validateAnimation(candidate,operation==='copy'?null:old);
      if(current.animations.some(other=>other.id!==item.id&&other.name.toLowerCase()===item.name.toLowerCase()))throw new HttpError(409,'Choose a unique animation name.');
      if(!old||operation==='copy'){
        if(current.animations.length>=100)throw new HttpError(400,'Up to 100 lighting animations are supported.');
        current.animations.push(item);
      }else current.animations[index]=item;
    });
    this.reconcile();await this.activity.add('Lighting animation '+(operation||'saved'));
  }
  interrupt(message='Another lighting control took over.') {
    if(this.active){this.active.reason=message;this.active.controller.abort(new Error(message));}
  }
  reconcile() {
    const active=this.active;if(!active)return;
    try {
      this.registry.assertReady(this.registry.get('tradfri'));
      const item=this.store.snapshot().animations.find(item=>item.id===active.animation.id);
      if(!item?.enabled||item.revision!==active.animation.revision
        ||this.registry.get('tradfri').runtime!==active.runtime
        ||this.registry.get('tradfri').config.snapshot().revision!==active.configRevision)throw Error();
    }catch{this.interrupt('Animation or lighting configuration changed.');}
  }
  async start(id,values) {
    this.ensure();object(values,['revision','requestId','targets','durationMinutes']);
    const animation=this.store.snapshot().animations.find(item=>item.id===id);
    if(!animation?.enabled||animation.revision!==values.revision)throw new HttpError(409,'Choose the current enabled animation.');
    if(typeof values.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(values.requestId)||!Array.isArray(values.targets)
      ||values.targets.length<1||values.targets.length>10||new Set(values.targets).size!==values.targets.length
      ||values.targets.some(target=>typeof target!=='string'||!/^\d{1,10}$/.test(target))
      ||!number(values.durationMinutes,0,1440))throw new HttpError(400,'Choose 1–10 reported lights and a duration of 0–1440 minutes.');
    const targets=values.targets.map(id=>this.lights().find(light=>light.id===id&&light.reachable!==false));
    if(targets.some(light=>!light))throw new HttpError(409,'A selected light is unavailable. Refresh the TRÅDFRI readings.');
    let active,existing;
    await this.runs.update(history=>{
      existing=history.runs.find(run=>run.id===values.requestId);
      if(existing){
        if(existing.animationId!==id||existing.revision!==values.revision||JSON.stringify(existing.targets)!==JSON.stringify(values.targets)
          ||existing.durationMinutes!==values.durationMinutes)throw new HttpError(409,'Request identity was already used.');
        return;
      }
      const reason=this.availability();if(reason)throw new HttpError(409,reason);
      if(this.active||this.registry.controls?.active.has('tradfri'))throw new HttpError(409,'Stop the current lighting run first.');
      const current=this.store.snapshot().animations.find(item=>item.id===id);
      if(!current?.enabled||current.revision!==values.revision)throw new HttpError(409,'Animation changed before starting.');
      const receipt={id:values.requestId,animationId:id,revision:animation.revision,name:animation.name,status:'running',
        targets:[...values.targets],durationMinutes:values.durationMinutes,startedAt:Date.now()};
      active={animation:structuredClone(animation),targets:structuredClone(targets),configRevision:this.registry.get('tradfri').config.snapshot().revision,
        runtime:this.registry.get('tradfri').runtime,
        receipt,controller:new AbortController(),step:0,cycles:0};
      active.done=new Promise(resolve=>{active.finish=resolve;});
      // Reserve before the durable write so simultaneous starts and shutdown
      // share the same admission; no command is sent until that write succeeds.
      this.active=active;history.runs=history.runs.slice(-49);history.runs.push(receipt);
    }).catch(error=>{if(active&&this.active===active){this.active=null;active.finish();}throw error;});
    if(existing)return existing;
    if(this.closing)active.controller.abort(new Error('Server is stopping.'));
    void this.perform(active).finally(()=>{if(this.active===active)this.active=null;active.finish();});
    return active.receipt;
  }
  async perform(active) {
    const signal=active.controller.signal,gate=this.registry.engine.gate,deadline=new AbortController();
    let completed=false;
    const timer=active.receipt.durationMinutes>0?gate.delay(active.receipt.durationMinutes*60000,deadline.signal)
      .then(()=>{completed=true;this.interrupt('Selected duration completed.');}).catch(()=>{}):null;
    try {
      await this.activity.add(`Lighting animation started: ${active.animation.name}`);
      const steps=active.animation.steps.filter(step=>step.enabled);
      while(true){
        for(let index=0;index<steps.length;index++){
          await gate.wait(signal);this.reconcile();signal.throwIfAborted();active.step=index+1;
          for(let lightIndex=0;lightIndex<active.targets.length;lightIndex++){
            await gate.wait(signal);this.reconcile();signal.throwIfAborted();
            // Spread offsets the palette, while the current sequence step owns
            // timing for every light, including custom sequences with unequal holds.
            const step={...steps[(index+(active.animation.spread?lightIndex:0))%steps.length],fadeSeconds:steps[index].fadeSeconds};
            await this.registry.execute('tradfri','light-state',lightCommand(active.targets[lightIndex],step),
              {signal,configRevision:active.configRevision,lightingAnimation:active.receipt.id,lightingFadeSeconds:step.fadeSeconds,automatic:false});
            // One command at a time, at least 500 ms apart; device latency can
            // make a fast preset slower, without catch-up bursts or retries.
            if(lightIndex<active.targets.length-1)await gate.delay(500,signal);
          }
          await gate.delay(sampleHoldSeconds(steps[index])*1000,signal);
        }
        active.cycles++;
      }
    }catch(error){
      const status=completed?'completed':signal.aborted?'stopped':'failed';
      const message=completed?'Selected duration completed.':signal.aborted?active.reason||'Stopped.':
        'Lighting command failed; delivery may be uncertain. No command was retried.';
      Object.assign(active.receipt,{status,message,finishedAt:Date.now()});
      await this.runs.update(value=>{const run=value.runs.find(run=>run.id===active.receipt.id);if(run)Object.assign(run,active.receipt);})
        .catch(()=>{this.error='Lighting run history could not be saved. No commands were replayed.';});
      await this.activity.add(`Lighting animation ${status}: ${active.animation.name}`,{level:status==='failed'?'warning':'info'}).catch(()=>{});
    }finally{deadline.abort();await timer;}
  }
  async stop(values) {
    object(values,['runId']);
    if(!this.active||this.active.receipt.id!==values.runId)throw new HttpError(409,'That lighting run is no longer active.');
    const active=this.active;this.interrupt('Stopped from Lighting animations.');await active.done;
  }
  async close() {
    this.closing=true;const active=this.active;this.interrupt('Server is stopping.');if(active)await active.done;
    await this.store.queue;await this.runs.queue;
  }
}
