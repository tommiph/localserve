/** Read-only Task readiness. Retained comparisons and run history describe
 * observations, not proof that an unrecorded occurrence should have run. */
import {HttpError} from './storage.mjs';
import {eventConditionSignature,solarOccurrence} from './rules.mjs';
import {doNotDisturbStatus,isTvAction} from './do-not-disturb.mjs';

export function explainTask(engine,id,date=new Date()) {
  const task=engine.tasks.snapshot().find(item=>item.id===id);
  if(!task)throw new HttpError(404,'Task not found.');
  const state=engine.state.snapshot(),config=engine.config.snapshot(),events=engine.registry.events(),actions=engine.registry.actions();
  const gates=[];
  if(engine.closing)gates.push('Server is stopping.');
  if(engine.gate.paused)gates.push('Server functions are paused.');
  if(!task.enabled)gates.push('This Task is disabled.');
  if(engine.pending.has(id)||[...engine.active.values()].some(run=>run.taskId===id))gates.push('This Task is already queued or running.');
  if(engine.rootRunCount()>=config.maxConcurrentRuns)gates.push('The concurrent Task limit is reached.');
  const enabled=task.starts.filter(rule=>rule.enabled);
  if(!enabled.length)gates.push('No enabled start rules. This Task can only be started manually.');
  const rules=task.starts.map(rule=>{
    let status='Disabled',nextAt=null;
    if(rule.enabled){
      if(rule.type==='event'){
        const event=events.find(item=>item.id===rule.eventId),source=event&&engine.andRules.source(rule);
        if(!source)status='Event source unavailable or not ready.';
        else if(!rule.condition)status='Waiting for the next reported Event.';
        else {
          const saved=state.eventConditions?.[id+'/'+rule.id];
          const matched=task.ruleMode==='and'?engine.andRules.comparison(task,rule):saved?.signature===eventConditionSignature(rule)?saved.matched:null;
          status=matched===true?'Last evaluated comparison matched. A new qualifying occurrence is required.':matched===false?'Last evaluated comparison did not match.':'No current comparison observation. Wait for a fresh report.';
        }
      }else if(['timer','interval'].includes(rule.type)){
        const clock=state.ruleClocks?.[id+'/'+rule.id];nextAt=Number.isFinite(clock?.nextAt)?clock.nextAt:null;
        status=clock?.completed?'Timer already consumed. Disable and enable the rule to rearm.':nextAt===null?'Clock not armed. Enable the Task and rule.':nextAt<=date.getTime()?'Due time reached; admission still depends on server state and other rules.':'Waiting for the next due time.';
      }else{
        if(rule.type==='schedule')status='Runs at '+rule.time+' on the selected days using server local time.';
        else{nextAt=solarOccurrence(date,rule,config.location);status=nextAt===null?'No solar time available. Check Server location and the selected date.':'Solar time uses Server location and server local time.';}
        if(!rule.days.includes(date.getDay()))status+=' Today is not selected.';
      }
    }
    return {id:rule.id,name:rule.name||rule.type,type:rule.type,enabled:rule.enabled,status,nextAt};
  });
  const steps=task.steps.map((step,index)=>{
    const action=step.type==='plugin'?actions.find(item=>item.id===step.capabilityId):null;
    let status=!step.enabled?'Disabled':step.type==='plugin'?!action?'Capability missing.':action.available===false?action.unavailableReason||'Plugin unavailable.':'Available':step.type==='show-vista'&&!engine.vistas?.snapshot().some(item=>item.id===step.vistaId&&item.enabled)?'Vista unavailable or disabled.':'Available';
    if(step.enabled && step.type==='run-task') {
      const target=engine.tasks.snapshot().find(task=>task.id===step.taskId);
      try {engine.assertStart(target,null,target?.revision,{ancestors:[task.id],nested:true});status='Waits for '+target.name+' to complete.';}catch(error){status=error.message;}
    }
    return {number:index+1,name:action?.name||({'show-vista':'Show Vista','run-task':'Run task',log:'Log activity',delay:'Delay'})[step.type]||'Plugin action',status};
  });
  const latest=state.runs.filter(run=>run.taskId===id).at(-1),skipped=engine.activity.latest().find(entry=>entry.taskId===id&&entry.level==='warning');
  const quiet=doNotDisturbStatus(config.doNotDisturb,date).active&&engine.referencedTasks(task).some(task=>task.steps.some(step=>{const action=step.enabled&&actions.find(item=>item.id===step.capabilityId);return action&&isTvAction(action.pluginId,action.actionId);}));
  return {taskId:id,name:task.name,revision:task.revision,checkedAt:date.getTime(),gates,rules,steps,
    ruleMode:task.ruleMode||'or',quietHours:quiet,
    latestRun:latest?{status:latest.status,startedAt:latest.startedAt,finishedAt:latest.finishedAt||null,message:latest.error||''}:null,
    lastWarning:skipped?{at:skipped.at,message:skipped.message}:null};
}
