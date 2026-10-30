/** Saved Calendar entries open ordinary disabled drafts, never effects. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {validateTask} from '../server/tasks.mjs';

const taskCode=await fs.readFile(new URL('../web/tasks-ui.js',import.meta.url),'utf8');
const pluginCode=await fs.readFile(new URL('../web/plugin-ui.js',import.meta.url),'utf8');
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function fixture() {
  const date={id:'date',name:'Launch','source-type':'date','target-date':'2027-01-15','target-time':'19:00',enabled:true};
  const feed={id:'feed',name:'Work',url:'https://calendar.example/?token=PRIVATE',enabled:false};
  const service={id:'calendar',config:{revision:7,settings:{calendars:[date,feed]}},listActions:[]};
  const event=(eventId,instanceId)=>({id:`plugin:calendar:event:${eventId}:${instanceId}`,pluginId:'calendar',eventId,instanceId,name:eventId,payload:[],available:false});
  const state={paused:true,tasks:[],services:[service],taskEvents:[event('date-reached','date'),event('event-started','feed'),event('event-started','date'),event('date-reached','feed')]};
  let serial=0,draft=null;const writes=[];
  const context=vm.createContext({state,structuredClone,document:{addEventListener(){}},crypto:{randomUUID:()=>`new-${++serial}`},escapeHtml:escape,icon:()=>'',mutate:(...args)=>writes.push(args)});
  const tasks=vm.runInContext(taskCode+'\nTaskUI;',context);context.TaskUI=tasks;
  const plugins=vm.runInContext(pluginCode+'\nPluginUI;',context);
  tasks.openEditor=(id,copy,value)=>{assert.equal(id,null);assert.equal(copy,false);draft=value;};
  return {state,date,feed,service,tasks,plugins,writes,get draft(){return draft;}};
}

test('local-date shortcut opens an unsaved disabled Task linked to its declared reached Event',()=>{
  const f=fixture(),before=JSON.stringify(f.state);f.tasks.openCalendarTask('date',7);
  assert.equal(f.draft.name,'On Launch');assert.equal(f.draft.enabled,false);assert.equal(f.draft.ruleMode,'or');assert.equal(f.draft.steps.length,0);
  assert.equal(f.draft.starts[0].type,'event');assert.equal(f.draft.starts[0].eventId,'plugin:calendar:event:date-reached:date');assert.equal(f.draft.starts[0].enabled,true);assert.equal(f.draft.starts[0].date,undefined);
  assert.match(f.draft.hint,/later date changes/);assert.equal(JSON.stringify(f.state),before);assert.deepEqual(f.writes,[]);
  const saved=validateTask({...f.draft,steps:[{id:'log',type:'log',enabled:true,message:'Chosen action'}]},null,[],f.state.taskEvents);
  assert.equal(saved.enabled,false);assert.equal(saved.starts[0].eventId,f.draft.starts[0].eventId);assert.equal(saved.hint,undefined);
});

test('legacy and explicit subscriptions select started Events without copying private source settings',()=>{
  const f=fixture();f.tasks.openCalendarTask('feed',7);assert.equal(f.draft.starts[0].eventId,'plugin:calendar:event:event-started:feed');
  assert.match(f.draft.hint,/title comparison/);assert.doesNotMatch(JSON.stringify(f.draft),/PRIVATE|calendar\.example|url/);
  f.feed['source-type']='subscription';f.tasks.openCalendarTask('feed',7);assert.equal(f.draft.starts[0].eventId,'plugin:calendar:event:event-started:feed');
});

test('entry rename/retarget keeps the same source link and repeated shortcuts choose an unused Task name',()=>{
  const f=fixture();f.state.tasks.push({name:'On Launch'});f.tasks.openCalendarTask('date',7);assert.equal(f.draft.name,'On Launch 2');
  const eventId=f.draft.starts[0].eventId;Object.assign(f.date,{name:'New name','target-date':'2028-02-29','target-time':'09:23'});f.tasks.openCalendarTask('date',7);
  assert.equal(f.draft.name,'On New name');assert.equal(f.draft.starts[0].eventId,eventId);
});

test('stale revisions, removed entries and missing/wrong-owner Events cannot create a draft',()=>{
  const f=fixture();for(const revision of [6,8,NaN,undefined])assert.throws(()=>f.tasks.openCalendarTask('date',revision),/changed/);
  assert.throws(()=>f.tasks.openCalendarTask('missing',7),/changed/);f.state.taskEvents=f.state.taskEvents.filter(e=>e.eventId!=='date-reached');
  f.state.taskEvents.push({id:'foreign',pluginId:'another',eventId:'date-reached',instanceId:'date'});assert.throws(()=>f.tasks.openCalendarTask('date',7),/unavailable/);
  assert.equal(f.draft,null);assert.deepEqual(f.writes,[]);
});

test('Calendar row tools scope identity/revision, escape names and preserve other plugin tools',async()=>{
  const f=fixture();f.date.name='<svg "onload">';const html=f.plugins.listActionButtons(f.service,{id:'calendars'},f.date);
  assert.match(html,/data-action="task-from-calendar"/);assert.match(html,/data-id="date"/);assert.match(html,/data-revision="7"/);assert.doesNotMatch(html,/<svg|PRIVATE/);assert.match(html,/&lt;svg/);
  assert.equal(f.plugins.listActionButtons({...f.service,id:'other'},{id:'calendars'},f.date),'');
  f.state.taskEvents=[];assert.match(f.tasks.calendarShortcut(f.service,f.date),/ disabled/);
  const before=JSON.stringify(f.state);await assert.rejects(f.tasks.handleAction('task-from-calendar','date',{dataset:{revision:'6'}}),/changed/);assert.equal(JSON.stringify(f.state),before);
});
