/** Fresh local-only dates and log Tasks. Never reads installed settings/feeds. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createLocalserve} from '../server.mjs';
import {validateTask,scheduleMinute} from '../server/tasks.mjs';
import {validateRule,calendarDateTime} from '../server/rules.mjs';
import {explainTask} from '../server/task-explanation.mjs';
import {validateDeclaration} from '../server/plugins.mjs';
import {validateValues} from '../server/plugin-schema.mjs';
import {selectedCardData} from '../server/cards.mjs';
import {createCalendarAdapter,configuration} from '../plugins/calendar/server/index.mjs';
import {localTarget,remainingTime} from '../plugins/calendar/server/dates.mjs';

const minute=new Date(2027,0,15,12,34), at=minute.getTime(), local=scheduleMinute(minute);
const date={id:'launch',name:'Launch day','source-type':'date','target-date':local.date,'target-time':local.time,url:'','reminder-minutes':0,enabled:true};
const settings={'poll-minutes':1,'feed-minutes':15,calendars:[date]};
const calendarRule=(extra={})=>({id:'date',name:'Launch date',enabled:true,type:'calendar',date:local.date,time:local.time,...extra});
const draft=(starts,extra={})=>({name:'Date task',enabled:true,starts,steps:[{id:'log',type:'log',enabled:true,message:'Local date fired'}],...extra});
const declaration=validateDeclaration(JSON.parse(await fs.readFile(new URL('../plugins/calendar/declaration.json',import.meta.url),'utf8')));
function host(seed={}, {saveFailure=false,emitFailure=false}={}) {
  let state=structuredClone(seed);const events=[],saves=[],abort=new AbortController();
  return {events,saves,abort,get state(){return structuredClone(state);},context:{signal:abort.signal,
    readState:async()=>structuredClone(state),saveState:async value=>{abort.signal.throwIfAborted();if(saveFailure)throw Error('Disk failed');state=structuredClone(value);saves.push(structuredClone(value));},
    log:async()=>{},emit:async(id,value)=>{abort.signal.throwIfAborted();validateValues(declaration.events.find(e=>e.id===id).payload,value);if(emitFailure)throw Error('Dispatch failed');events.push({id,value,state:structuredClone(state)});}}};
}
async function fixture(t, plugin=false, clocked=false) {
  const base=path.resolve('tests/.tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'calendar-dates-'));
  await fs.mkdir(path.join(root,'plugins'),{recursive:true});
  if(plugin)await fs.cp(new URL('../plugins/calendar/',import.meta.url),path.join(root,'plugins/calendar'),{recursive:true,filter:file=>!file.split(path.sep).includes('data')});
  if(clocked) {
    const folder=path.join(root,'plugins/calendar');
    await fs.writeFile(path.join(folder,'server/test-entry.mjs'),`import {createCalendarAdapter} from './index.mjs';let clock=${at-61000};const adapter=createCalendarAdapter({now:()=>clock,read:async()=>{throw Error('No network in local date fixture')}});export default {...adapter,execute(...args){clock+=60000;return adapter.execute(...args);}};`);
    const raw=JSON.parse(await fs.readFile(path.join(folder,'declaration.json'),'utf8'));raw.runtime.entry='server/test-entry.mjs';await fs.writeFile(path.join(folder,'declaration.json'),JSON.stringify(raw));
  }
  let app=await createLocalserve(root,{automatic:false});
  t.after(async()=>{await app.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  const settle=async()=>{const deadline=Date.now()+5000;while(app.engine.pending.size||app.engine.active.size){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));}};
  const save=async value=>{const task=validateTask(value,null,app.registry.actions(),app.registry.events());await app.tasks.update(items=>items.push(task));return task;};
  return {get app(){return app;},save,settle,restart:async()=>{await app.close();app=await createLocalserve(root,{automatic:false});}};
}

test('calendar rules and local sources reject impossible dates, missing times and DST gaps',()=>{
  const good=validateRule(calendarRule(),[]);assert.equal(good.date,local.date);assert.equal(good.days,undefined);assert.equal(calendarDateTime(local.date,local.time),at);assert.equal(localTarget(date),at);
  for(const patch of [{date:'2027-02-29'},{date:'2027-13-01'},{date:'2027-04-31'},{date:'1969-12-31'},{date:'10000-01-01'},{date:'2027-01-15Z'},{time:'24:00'},{time:'12:34:00'},{time:''}])assert.throws(()=>validateRule(calendarRule(patch),[]),/valid date and time/);
  const script=`import {calendarDateTime,calendarDue} from ${JSON.stringify(new URL('../server/rules.mjs',import.meta.url).href)};import {localTarget} from ${JSON.stringify(new URL('../plugins/calendar/server/dates.mjs',import.meta.url).href)};console.log(JSON.stringify([calendarDateTime('2026-03-29','03:30'),calendarDateTime('2026-10-25','03:30'),localTarget({'target-date':'2026-03-29','target-time':'03:30'}),calendarDue({date:'2026-10-25',time:'03:30'},new Date('2026-10-25T01:30:00Z'))]));`;
  const values=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ:'Europe/Helsinki'},windowsHide:true,encoding:'utf8'}));
  assert.equal(values[0],null);assert.equal(values[1],Date.parse('2026-10-25T00:30:00Z'));assert.equal(values[2],null);assert.equal(values[3],false);
  assert.ok(configuration(settings));assert.equal(configuration({...settings,calendars:[{...date,'source-type':'unknown'}]}),null);
  assert.equal(configuration({...settings,calendars:[{...date,'target-date':'2027-02-29'}]}),null);
});

test('one-time Calendar scheduling claims before a log run and survives restart/clock rollback',async t=>{
  const f=await fixture(t),task=await f.save(draft([calendarRule()]));
  await f.app.engine.tick(new Date(at-1));await f.settle();assert.equal(f.app.state.snapshot().runs.length,0);
  await f.app.engine.tick(minute);await f.settle();assert.equal(f.app.state.snapshot().runs.length,1);assert.equal(f.app.state.snapshot().claims.length,1);
  await f.app.engine.tick(new Date(at+30000));await f.settle();assert.equal(f.app.state.snapshot().runs.length,1);
  const before=JSON.stringify(f.app.state.snapshot());assert.match(explainTask(f.app.engine,task.id,minute).rules[0].status,/already consumed/);assert.equal(JSON.stringify(f.app.state.snapshot()),before);
  await f.restart();await f.app.engine.tick(minute);await f.settle();assert.equal(f.app.state.snapshot().runs.length,1);
  await f.app.engine.tick(new Date(at+86400000));assert.equal(f.app.state.snapshot().runs.length,1);
});

test('the bounded server-local date resolver is read-only and rejects invalid or duplicate parameters',async t=>{
  const f=await fixture(t),before=JSON.stringify([f.app.tasks.snapshot(),f.app.config.snapshot(),f.app.state.snapshot()]);
  const good=await fetch(f.app.origin+`/api/calendar-date?date=${local.date}&time=${local.time}`);assert.equal(good.status,200);assert.equal((await good.json()).at,at);
  for(const query of ['date=2027-02-29&time=12:00',`date=${local.date}&time=24:00`,`date=${local.date}&time=12:00&time=13:00`,`date=${local.date}&time=12:00&zone=UTC`,''])assert.equal((await fetch(f.app.origin+'/api/calendar-date?'+query)).status,400);
  assert.equal((await fetch(f.app.origin+'/api/calendar-date',{method:'POST'})).status,405);assert.equal(JSON.stringify([f.app.tasks.snapshot(),f.app.config.snapshot(),f.app.state.snapshot()]),before);
});

test('Calendar rules skip missed/disabled/paused dates and compose with AND schedules',async t=>{
  const f=await fixture(t);await f.save(draft([calendarRule()],{name:'Missed'}));
  await f.app.engine.tick(new Date(at+60000));assert.equal(f.app.state.snapshot().runs.length,0);
  const task=await f.save(draft([calendarRule({id:'once'}),{id:'daily',type:'schedule',name:'Same minute',enabled:true,time:local.time,days:[local.day]}],{name:'AND date',ruleMode:'and'}));
  await f.app.engine.setPaused(true);await f.app.engine.tick(minute);assert.equal(f.app.state.snapshot().runs.length,0);
  await f.app.engine.setPaused(false);await f.app.tasks.update(items=>items.find(x=>x.name==='Missed').enabled=false);
  await f.app.engine.tick(minute);await f.settle();assert.equal(f.app.state.snapshot().runs.length,1);assert.equal(f.app.state.snapshot().runs[0].taskId,task.id);
  await f.app.engine.tick(new Date(at+2000));await f.settle();assert.equal(f.app.state.snapshot().runs.length,1);
});

test('local countdowns need no feed and expose exact totals/components with positive rounding',async()=>{
  let now=at-90061001,reads=0;const h=host({nextRequestAt:at+999999});
  const a=createCalendarAdapter({now:()=>now,read:async()=>{reads++;throw Error('Forbidden network');}});await a.start(settings);await a.execute('refresh',{},h.context);
  const state=h.state.calendars.launch;assert.equal(reads,0);assert.equal(state['target-at'],at);assert.equal(state['remaining-seconds'],90062);assert.equal(state.days,1);assert.equal(state.hours,1);assert.equal(state.minutes,1);assert.equal(state.seconds,2);
  assert.equal(h.events.filter(e=>e.id==='date-reached').length,0);assert.equal(h.events[0].id,'countdown-updated');
  assert.deepEqual(remainingTime(at,at+1),{'remaining-seconds':0,'remaining-minutes':0,'remaining-hours':0,'remaining-days':0,days:0,hours:0,minutes:0,seconds:0,reached:true});
});

test('reached claims persist before dispatch, suppress clock rollback and baseline restart/long gaps',async()=>{
  let now=at-1000;const h=host(),a=createCalendarAdapter({now:()=>now});await a.start(settings);await a.execute('refresh',{},h.context);
  now=at;await a.execute('refresh',{},h.context);const event=h.events.find(e=>e.id==='date-reached');assert.ok(event);assert.equal(event.value['remaining-seconds'],0);assert.equal(event.state.calendars.launch.claims[0].id,'date-reached');
  now=at-1000;await a.execute('refresh',{},h.context);now=at+1;await a.execute('refresh',{},h.context);assert.equal(h.events.filter(e=>e.id==='date-reached').length,1);
  await a.stop();await a.start(settings);await a.execute('refresh',{},h.context);assert.equal(h.events.filter(e=>e.id==='date-reached').length,1);
  const gap=host(),b=createCalendarAdapter({now:()=>now});now=at-1000;await b.start(settings);await b.execute('refresh',{},gap.context);now=at+600000;await b.execute('refresh',{},gap.context);assert.equal(gap.events.filter(e=>e.id==='date-reached').length,0);assert.equal(gap.state.calendars.launch.reached,true);
});

test('date retargeting baselines, rename preserves claims, and failed persistence/cancellation emit nothing',async()=>{
  let now=at-1000;const h=host(),a=createCalendarAdapter({now:()=>now});await a.start(settings);await a.execute('refresh',{},h.context);now=at;await a.execute('refresh',{},h.context);
  await a.start({...settings,calendars:[{...date,name:'Renamed'}]});await a.execute('refresh',{},h.context);assert.equal(h.events.filter(e=>e.id==='date-reached').length,1);assert.equal(h.state.calendars.launch['target-name'],'Renamed');
  await a.start({...settings,calendars:[{...date,'target-time':'12:35'}]});await a.execute('refresh',{},h.context);assert.equal(h.state.calendars.launch.claims.length,0);
  now=at+60000;await a.execute('refresh',{},h.context);assert.equal(h.events.filter(e=>e.id==='date-reached').length,2);
  const failed=host({}, {saveFailure:true});await assert.rejects(a.execute('refresh',{},failed.context),/Disk failed/);assert.equal(failed.events.length,0);
  const aborted=host();aborted.abort.abort();await assert.rejects(a.execute('refresh',{},aborted.context));assert.equal(aborted.saves.length,0);assert.equal(aborted.events.length,0);
  const late=host();late.context.readState=async()=>{late.abort.abort();return {};};await assert.rejects(a.execute('refresh',{},late.context));assert.equal(late.saves.length,0);
});

test('a lost reached dispatch is not retried and corrupt local claims fail closed',async()=>{
  let now=at-1000;const h=host(),a=createCalendarAdapter({now:()=>now});await a.start(settings);await a.execute('refresh',{},h.context);now=at;
  h.context.emit=async()=>{throw Error('Dispatch failed');};await assert.rejects(a.execute('refresh',{},h.context),/Dispatch failed/);assert.equal(h.state.calendars.launch.claims.length,1);
  const seen=[];h.context.emit=async id=>seen.push(id);await a.execute('refresh',{},h.context);assert.deepEqual(seen,['countdown-updated']);
  const corrupt=h.state;corrupt.calendars.launch.claims=[{id:'unknown',at:now}];const bad=host(corrupt);await assert.rejects(a.execute('refresh',{},bad.context),/claims are invalid/);assert.equal(bad.saves.length,0);
});

test('a real worker exposes only selected countdown fields through a sandboxed ready-made Card',async t=>{
  const f=await fixture(t,true);await f.app.registry.saveConfiguration('calendar',{revision:1,enabled:true,settings});await f.app.registry.execute('calendar','refresh',{});
  const card=await f.app.registry.saveCard('calendar',{schemaVersion:1,layout:'readymade',templateId:'countdown',sourceId:'launch',enabled:true});
  const library=f.app.registry.cardLibrary().find(entry=>entry.id==='calendar');assert.ok(library);assert.doesNotMatch(JSON.stringify(library),/claims|sequence|nextRequestAt|identity/);
  const source=f.app.registry.cardSource('calendar'),selected=selectedCardData(card,source.cardData,source.cardCatalog);assert.equal(selected.data.values['launch:target-at'].value,at);assert.doesNotMatch(JSON.stringify(selected),/claims|sequence|nextRequestAt|identity/);
  const asset=await fetch(f.app.origin+'/plugin-card-assets/calendar/countdown/card.html');assert.equal(asset.status,200);assert.match(asset.headers.get('content-security-policy'),/script-src 'none'/);
  assert.match(await asset.text(),/data-card-text="remaining"/);assert.equal((await fetch(f.app.origin+'/plugins/calendar/data/state.json')).status,404);
  const saved=f.app.registry.get('calendar').state.snapshot();await f.restart();assert.deepEqual(f.app.registry.get('calendar').state.snapshot(),saved);
});

test('a real local-date worker starts one matching Event Task and preserves typed remaining-time payloads',async t=>{
  const f=await fixture(t,true,true);await f.app.registry.saveConfiguration('calendar',{revision:1,enabled:true,settings});
  await f.save(draft([{id:'reached',name:'Reached',type:'event',enabled:true,eventId:'plugin:calendar:event:date-reached:launch'}]));
  await f.app.registry.execute('calendar','refresh',{});await f.settle();assert.equal(f.app.state.snapshot().runs.length,0);
  await f.app.registry.execute('calendar','refresh',{});await f.settle();const runs=f.app.state.snapshot().runs;assert.equal(runs.length,1);assert.equal(runs[0].event.payload.target,at);assert.equal(runs[0].event.payload['remaining-seconds'],0);assert.equal(runs[0].event.payload.reached,true);
  await f.app.registry.execute('calendar','refresh',{});await f.settle();assert.equal(f.app.state.snapshot().runs.length,1);
});
