/** AND retains comparison results, never Event payloads. Clock occurrences
 * must fall due together; a blocked occurrence cannot be replayed later. */
import {eventConditionMatches, solarOccurrence} from './rules.mjs';
export const isAndTask = task => task.ruleMode === 'and';
export const groupSignature = task => JSON.stringify(task.starts.filter(rule=>rule.enabled)
  .map(({name,nameEdited,...rule})=>rule).sort((a,b)=>a.id.localeCompare(b.id)));
const sameSource = (a,b) => a && b && a.record===b.record && a.runtime===b.runtime
  && a.generation===b.generation && a.instanceEpoch===b.instanceEpoch;
export function reconcileRuleGroups(tasks, previous = {}) {
  return Object.fromEntries(tasks.filter(task=>task.enabled && isAndTask(task)).map(task=>{
    const signature=groupSignature(task),old=previous[task.id];
    return [task.id,old?.signature===signature?old:{signature,matched:null}];
  }));
}
export class AndRuleGroups {
  constructor(engine) { this.engine=engine;this.observations=new Map();this.queue=Promise.resolve();this.epoch=0; }
  reset() { this.epoch++;this.observations.clear(); }
  enqueue(operation) {
    const next=this.queue.then(()=>!this.engine.closing && !this.engine.gate.paused ? operation() : undefined);
    this.queue=next.catch(()=>{});return next;
  }
  sync() {
    const tasks=this.engine.tasks.snapshot();
    for(const [id,cache] of this.observations) {
      const task=tasks.find(task=>task.id===id && task.enabled && isAndTask(task));
      if(!task || cache.signature!==groupSignature(task))this.observations.delete(id);
    }
  }
  source(rule) {
    const registry=this.engine.registry,capability=registry.events().find(event=>event.id===rule.eventId);
    if(!capability || capability.instanceId && !capability.instanceEnabled)return null;
    const record=registry.records?.get(capability.pluginId);
    if(!record || !record.config.snapshot().enabled || !record.configured || record.health!=='ready')return null;
    let instanceEpoch;
    if(record.plugin?.runtime?.ingest==='sensors-v1' && capability.instanceId) {
      const device=record.state.snapshot().devices?.[capability.instanceId];
      // Offline is a valid presence condition, but retained phone/sensor values
      // cannot stand in for a report from a currently connected device.
      const offline=['device-offline','relay-offline'].includes(capability.eventId);
      const presence=['device-online','device-offline','relay-online','relay-offline'].includes(capability.eventId);
      if(presence&&(device?.transport||'lan')!==(capability.eventId.startsWith('relay-')?'relay':'lan'))return null;
      if(!device || (offline ? device.online!==false : device.online!==true))return null;
      instanceEpoch=JSON.stringify([device.sessionId,device.transitionId,device.transport||'lan']);
    }
    return {record,runtime:record.runtime,generation:record.pollGeneration,instanceEpoch};
  }
  comparison(task,rule) {
    const mode=this.engine.homeModes?.comparison(rule);
    if(mode!==undefined)return mode;
    const cache=this.observations.get(task.id),saved=cache?.values.get(rule.id),source=this.source(rule);
    if(!saved || cache.signature!==groupSignature(task) || !sameSource(saved,source))return null;
    return saved.matched;
  }
  current(task) {
    const current=this.engine.tasks.snapshot().find(item=>item.id===task.id);
    return current?.enabled && isAndTask(current) && groupSignature(current)===groupSignature(task) ? current : null;
  }
  event(task,capability,event,acceptedSource) {
    const epoch=this.epoch;
    return this.enqueue(async()=>{
      if(epoch!==this.epoch || !acceptedSource)return;
      task=this.current(task);if(!task)return;
      const signature=groupSignature(task),rules=task.starts.filter(rule=>rule.enabled);
      let cache=this.observations.get(task.id);
      if(cache?.signature!==signature){cache={signature,values:new Map()};this.observations.set(task.id,cache);}
      const touched=rules.filter(rule=>rule.type==='event' && rule.eventId===capability.id);
      for(const rule of touched) {
        const source=this.source(rule);
        if(sameSource(source,acceptedSource))cache.values.set(rule.id,{...source,matched:eventConditionMatches(rule.condition,event.payload)});
        else return;
      }
      if(rules.some(rule=>rule.type!=='event'))return;
      const matches=rules.map(rule=>this.comparison(task,rule));
      const matched=matches.includes(false)?false:matches.includes(null)?null:true;
      if(matched===null)return;
      const occurrence=capability.occurrenceKey?event.payload[capability.occurrenceKey]:undefined;
      const old=this.engine.state.snapshot().ruleGroups?.[task.id];
      if(old?.signature===signature && old.matched===matched && (occurrence===undefined || old.occurrences?.[capability.id]===occurrence))return;
      const claimed=await this.engine.state.update(state=>{
        if(state.paused || this.engine.closing || !this.current(task))return false;
        if(matched && !rules.every(rule=>this.comparison(task,rule)===true))return false;
        state.ruleGroups=reconcileRuleGroups(this.engine.tasks.snapshot(),state.ruleGroups);
        const previous=state.ruleGroups[task.id];
        const entered=matched && (previous.matched!==true || occurrence!==undefined && previous.occurrences?.[capability.id]!==occurrence);
        const occurrences={...previous.occurrences,...(occurrence===undefined?{}:{[capability.id]:occurrence})};
        state.ruleGroups[task.id]={signature,matched,...(Object.keys(occurrences).length?{occurrences}:{})};
        return entered;
      });
      if(claimed)await this.engine.dispatchRule(task,touched[0],event);
    });
  }
  tick(task,date) {
    return this.enqueue(async()=>{
      task=this.current(task);if(!task)return;
      const rules=task.starts.filter(rule=>rule.enabled),timed=rules.filter(rule=>rule.type!=='event');
      if(!timed.length)return;
      const now=date.getTime(),zone=new Intl.DateTimeFormat().resolvedOptions().timeZone;
      const minute={date:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,time:`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`};
      const state=this.engine.state.snapshot(),location=this.engine.config.snapshot().location;
      const due=timed.map(rule=>{
        const key=`${task.id}/${rule.id}`;
        if(['timer','interval'].includes(rule.type)) {
          const clock=state.ruleClocks?.[key];
          return {rule,key,clock,due:Boolean(clock && !clock.completed && clock.nextAt<=now)};
        }
        const occurrence=rule.type==='schedule'?null:solarOccurrence(date,rule,location);
        const at=occurrence===null?null:new Date(occurrence);
        const time=rule.type==='schedule'?rule.time:at?`${String(at.getHours()).padStart(2,'0')}:${String(at.getMinutes()).padStart(2,'0')}`:null;
        const claim=`${key}/${minute.date}/${minute.time}/${zone}`;
        return {rule,claim,due:time===minute.time && rule.days.includes(date.getDay()) && !state.claims.includes(claim)};
      });
      if(!due.some(item=>item.due))return;
      const claimed=await this.engine.state.update(state=>{
        if(state.paused || this.engine.closing || !this.current(task))return false;
        let all=due.every(item=>item.due);
        for(const item of due.filter(item=>item.due)) {
          if(item.clock) {
            const clock=state.ruleClocks?.[item.key];
            if(!clock || clock.generation!==item.clock.generation || clock.completed || clock.nextAt>now){all=false;continue;}
            if(item.rule.type==='timer')clock.completed=true;
            else clock.nextAt+=(Math.floor((now-clock.nextAt)/(item.rule.seconds*1000))+1)*item.rule.seconds*1000;
          } else {
            if(state.claims.includes(item.claim)){all=false;continue;}
            state.claims.push(item.claim);state.claims=state.claims.slice(-2000);
          }
        }
        return all && rules.filter(rule=>rule.type==='event').every(rule=>this.comparison(task,rule)===true);
      });
      if(claimed)await this.engine.dispatchRule(task,timed[0]);
    });
  }
}
