import test from 'node:test';
import assert from 'node:assert/strict';
import {explainTask} from '../server/task-explanation.mjs';
import {eventConditionSignature} from '../server/rules.mjs';
import {selectorFixture} from './fixtures/scene-selector.mjs';

test('Task explanation is a read-only HTTP projection and preserves private arguments',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());const task=f.app.tasks.snapshot()[0];
  const definitions=()=>JSON.stringify([f.app.tasks.snapshot(),f.app.state.snapshot(),f.app.config.snapshot(),f.app.controls.admin(),f.app.phoneHome.admin()]),before=definitions();
  const response=await fetch(f.app.origin+'/api/tasks/'+task.id+'/explanation');assert.equal(response.status,200);const value=await response.json();
  assert.equal(value.taskId,task.id);assert.match(value.gates.join(' '),/manually/);assert.equal(value.steps[0].status,'Available');
  assert.doesNotMatch(JSON.stringify(value),/Synthetic shortcut|parameters|token|eventContext/);assert.equal(definitions(),before);
  assert.equal((await fetch(f.app.origin+'/api/tasks/missing/explanation')).status,404);
  const status=await fetch(f.app.origin+'/api/controller/status',{headers:{'X-Localserve-Controller':'1'}});assert.equal(status.status,200);assert.deepEqual(Object.keys(await status.json()).sort(),['controllerVersion','now','serverVersion']);
  for(const headers of [{},{'X-Localserve-Controller':'1',Origin:f.app.origin},{'X-Localserve-Controller':'1','Sec-Fetch-Site':'same-origin'}])assert.equal((await fetch(f.app.origin+'/api/controller/status',{headers})).status,403);
});
test('explanation distinguishes gates, retained false/unknown comparisons, AND observations and consumed clocks',()=>{
  const rule={id:'event',type:'event',name:'Light level',enabled:true,eventId:'lux',condition:{field:'lux',operator:'lt',value:50}},task={id:'task',name:'Test',enabled:false,starts:[rule,{id:'timer',name:'Timer',enabled:true,type:'timer',seconds:10}],steps:[{id:'tv',enabled:true,type:'plugin',capabilityId:'tv',parameters:{secret:'private'}}]};
  const state={runs:[],eventConditions:{'task/event':{signature:eventConditionSignature(rule),matched:false}},ruleClocks:{'task/timer':{completed:true,nextAt:1}}};
  const engine={tasks:{snapshot:()=>[task]},state:{snapshot:()=>state},config:{snapshot:()=>({maxConcurrentRuns:1,doNotDisturb:{enabled:true,scheduleEnabled:false,days:[1],start:'22:00',end:'07:00'}})},registry:{events:()=>[{id:'lux'}],actions:()=>[{id:'tv',pluginId:'samsung-tv',actionId:'launch-app',name:'Open TV',available:false,unavailableReason:'Configure TV'}]},gate:{paused:true},pending:new Set(['other']),active:new Map(),andRules:{source:()=>({}),comparison:()=>null},activity:{latest:()=>[]}};
  const before=JSON.stringify([task,state]),value=explainTask(engine,'task');assert.equal(value.gates.length,3);assert.match(value.rules[0].status,/did not match/);assert.match(value.rules[1].status,/consumed/);assert.equal(value.quietHours,true);assert.equal(value.steps[0].status,'Configure TV');
  task.ruleMode='and';assert.match(explainTask(engine,'task').rules[0].status,/No current/);delete task.ruleMode;assert.equal(JSON.stringify([task,state]),before);assert.throws(()=>explainTask(engine,'missing'));
  state.runs.push({taskId:'task',status:'failed',startedAt:1,finishedAt:2,error:'Target unavailable',event:{payload:{private:'not projected'}}});assert.equal(explainTask(engine,'task').latestRun.message,'Target unavailable');assert.doesNotMatch(JSON.stringify(explainTask(engine,'task')),/not projected/);
});
