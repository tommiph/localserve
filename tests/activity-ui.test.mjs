/** Presentation fixtures contain synthetic entries only. Pausing/filtering must
 * never mutate the original log collection or merge different observations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const context = vm.createContext({document: {addEventListener() {}}, state: {tasks: [], services: []}, escapeHtml: value => String(value).replaceAll('<', '&lt;'), icon: () => '', relativeTime: () => '', formatServerTimestamp: () => 'Timestamp'});
vm.runInContext(await fs.readFile(new URL('../web/activity-ui.js', import.meta.url), 'utf8') + '\nglobalThis.activity = ActivityUI;', context);
vm.runInContext(await fs.readFile(new URL('../web/run-ui.js', import.meta.url), 'utf8') + '\nglobalThis.runs = RunUI;', context);

test('Activity pages group before slicing and clamp after filtering without changing history',()=>{
  const entries=Array.from({length:126},(_,i)=>({id:'row-'+i,message:'Message '+i,source:'Server'})),original=JSON.stringify(entries);
  const settings={group:false,page:2,pageSize:50};let html=context.activity.rows(entries,settings);
  assert.match(html,/Page 2 of 3/);assert.match(html,/Message 50</);assert.match(html,/Message 99</);assert.doesNotMatch(html,/Message 49<|Message 100</);
  html=context.activity.rows(entries.slice(0,3),settings);assert.equal(settings.page,1);assert.match(html,/Page 1 of 1/);
  settings.group=true;settings.pageSize=25;html=context.activity.rows(Array.from({length:70},(_,i)=>({id:'r'+i,message:'Same',source:'Server'})),settings);
  assert.match(html,/70 identical entries/);assert.match(html,/Page 1 of 1/);assert.equal(JSON.stringify(entries),original);
});

test('paging freezes a bounded snapshot and Latest entries explicitly resumes live reads',async()=>{
  const listeners={},state={activity:Array.from({length:120},(_,i)=>({id:String(i),message:'Message '+i})),tasks:[],services:[]};
  const scope=vm.createContext({document:{addEventListener:(name,fn)=>listeners[name]=fn},state,structuredClone,renderView(){},escapeHtml:String,icon:()=>'',relativeTime:()=>''});
  vm.runInContext(await fs.readFile(new URL('../web/activity-ui.js',import.meta.url),'utf8')+';this.ui=ActivityUI;',scope);
  const panel={dataset:{activityScope:'global'}},button={dataset:{action:'activity-next'},closest:()=>panel};
  listeners.click({target:{closest:()=>button}});const settings=scope.ui.context('global');assert.equal(settings.page,2);assert.equal(settings.paused,true);
  state.activity.unshift({id:'fresh',message:'New arrival'});assert.equal(settings.held.length,120);assert.equal(settings.held[0].id,'0');
  button.dataset.action='activity-live';listeners.click({target:{closest:()=>button}});assert.equal(settings.page,1);assert.equal(settings.paused,false);assert.equal(settings.held.length,0);
});

test('run captions use captured names without reconstructing historical labels', () => {
  const run={event:{pluginId:'phone',eventId:'reading'},reason:'Event: Event',automatic:true,
    eventLabel:{pluginName:'Original phone',name:'Ambient light'}};
  context.state.taskEvents=[{pluginId:'phone',eventId:'reading',pluginName:'Renamed phone',name:'Different name'}];
  assert.equal(context.runs.triggerText(run),'Event: Original phone · Ambient light');
  delete run.eventLabel;
  assert.equal(context.runs.triggerText(run),'Event · Source name not recorded');
  assert.equal(context.runs.triggerText({reason:'Manual'}),'Manual');
});

test('Activity filters combine without altering the retained history and group only identical observations', () => {
  const entries = [
    {id: 'a', message: 'Poll complete', level: 'info', pluginId: 'one', source: 'One'},
    {id: 'b', message: 'Poll complete', level: 'info', pluginId: 'one', source: 'One'},
    {id: 'c', message: 'Event', level: 'info', eventId: 'changed', payload: {value: 0}, pluginId: 'one'},
    {id: 'd', message: 'Event', level: 'info', eventId: 'changed', payload: {value: 1}, pluginId: 'one'},
    {id: 'e', message: 'Task failure', level: 'warning', taskId: 'task', source: 'Task'},
  ];
  const original = JSON.stringify(entries), settings = context.activity.context('global');
  assert.equal(context.activity.groups(entries, true).length, 4);
  assert.equal(context.activity.groups(entries, false).length, 5);
  Object.assign(settings, {plugin: 'one', type: 'event', search: 'event', level: 'info'});
  assert.equal(context.activity.filtered(entries, settings).length, 2);
  settings.task = 'task'; assert.equal(context.activity.filtered(entries, settings).length, 0);
  assert.equal(JSON.stringify(entries), original);
});

test('paused Activity uses its captured snapshot, supports zero/false values and escapes rendered text', () => {
  const settings = context.activity.context('paused');
  Object.assign(settings, {paused: true, held: [{id: 'old', at: 1, message: '<old>', eventId: 'changed', payload: {zero: 0, flag: false}}]});
  const html = context.activity.render([{id: 'new', message: 'NEW_ENTRY'}], 'paused');
  assert.match(html, /&lt;old>/); assert.doesNotMatch(html, /NEW_ENTRY/);
  assert.match(html, /Display paused; server logging continues/);
  assert.match(html, />0</); assert.match(html, />false</);
  assert.equal(settings.held.length, 1);
  assert.match(html, /Snapshot limited to 500 entries/);
  assert.match(html, /older retained logs remain on disk/);
});

test('recent failed-run summary and period filters use server time without changing history', () => {
  const day = 86400000, now = 10 * day;
  context.state.server = {now};
  context.state.runs = [
    {id:'fresh',taskId:'a',status:'failed',startedAt:now - 1000},
    {id:'old',taskId:'a',status:'failed',startedAt:now - 2 * day},
    {id:'ok',taskId:'b',status:'completed',startedAt:now},
  ];
  assert.equal(context.runs.recentFailures(), 1);
  Object.assign(context.runs,{status:'failed',period:'day',task:''});
  assert.deepEqual(Array.from(context.runs.filtered(), run => run.id), ['fresh']);
  context.runs.period = 'week';
  assert.deepEqual(Array.from(context.runs.filtered(), run => run.id), ['fresh','old']);
  assert.equal(context.state.runs.length, 3);
  assert.match(context.runs.controls(), /up to 200 recent runs/);
});

test('Run details show only captured receipts and payloads, with explicit missing old history', () => {
  context.state.taskEvents = [{pluginId:'example',eventId:'changed',payload:[
    {id:'zero',type:'number'},{id:'flag',type:'boolean'},{id:'title',type:'string'},
  ]}];
  const run = {id: 'one', taskId: 'deleted', name: 'Old task', reason: 'Manual', startedAt: 1, finishedAt: 1001, event: {pluginId: 'example', eventId: 'changed', occurredAt: 1, payload: {zero: 0, flag: false, title: '<script>'}}};
  const html = context.runs.details(run);
  assert.match(html, /1\.0 s/); assert.match(html, /Not recorded/);
  assert.match(html, /Per-step timing was not recorded/); assert.match(html, /&lt;script>/);
  assert.match(html, />0</); assert.match(html, />No</);
  assert.doesNotMatch(html, /step parameters|<script>/);
});
