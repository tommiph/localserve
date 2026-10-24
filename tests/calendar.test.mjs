/** Isolated feeds, sockets and disposable roots only. No real subscription or
 * installed Task/Card/Vista is read, changed or connected by these tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { parseCalendar } from '../plugins/calendar/server/parser.mjs';
import { expandCalendar } from '../plugins/calendar/server/parse.mjs';
import { subscriptionUrl, readSubscription } from '../plugins/calendar/server/http.mjs';
import { createCalendarAdapter, configuration } from '../plugins/calendar/server/index.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { validateCard, projectCardData, selectedCardData, cardCatalog } from '../server/cards.mjs';
import { createLocalserve } from '../server.mjs';

const now = Date.parse('2026-10-15T06:00:00Z');
const calendar = {id:'personal',name:'Personal',url:'https://calendar.example/private.ics?token=SECRET','reminder-minutes':10,enabled:true};
const settings = {'poll-minutes':1,'feed-minutes':15,calendars:[calendar]};
const feed = events => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const event = (lines,uid='one') => `BEGIN:VEVENT\r\nUID:${uid}\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;
const simple = feed([event(['DTSTART:20261015T061100Z','DTEND:20261015T071100Z','SUMMARY:Team TESLA meeting','LOCATION:Office','DESCRIPTION:Discuss roadmap'])]);
function host(seed={}) {
  let state=structuredClone(seed);
  const events=[],saves=[],controller=new AbortController();
  return {events,saves,controller,get state(){return structuredClone(state);},context:{signal:controller.signal,
    readState:async()=>structuredClone(state),saveState:async value=>{controller.signal.throwIfAborted();state=structuredClone(value);saves.push(structuredClone(value));},
    log:async()=>{},emit:async(id,value)=>{controller.signal.throwIfAborted();events.push({id,value,state:structuredClone(state)});}}};
}

test('Calendar validates subscriptions offline and never accepts local/private/credential URLs',async()=>{
  let reads=0;
  const adapter=createCalendarAdapter({read:async()=>{reads++;return simple;}});
  assert.equal(adapter.validateConfiguration(settings),true);
  await adapter.start(settings);await adapter.stop();assert.equal(reads,0);
  assert.equal(subscriptionUrl('webcal://calendar.example/feed.ics'),'https://calendar.example/feed.ics');
  for(const url of ['http://calendar.example/a','https://127.0.0.1/a','https://10.23.42.3/a','https://user:pass@calendar.example/a','https://calendar.example:99/a','file:///a','https://[::1]/a','https://calendar.example/a#b','https://localhost/a']) assert.equal(subscriptionUrl(url),null);
  for(const patch of [{calendars:[]},{'poll-minutes':0},{'feed-minutes':1},{calendars:[{...calendar,'reminder-minutes':1.1}]}]) assert.equal(configuration({...settings,...patch}),null);
});

test('Calendar expands recurrence, exclusions, moved exceptions, cancellation and escaped/folded text',()=>{
  const text=feed([
    event(['DTSTART:20261014T090000Z','DTEND:20261014T100000Z','RRULE:FREQ=DAILY;COUNT=5','EXDATE:20261016T090000Z','SUMMARY:Team\\, weekly','DESCRIPTION:Line one\\nLine two\r\n continued']),
    event(['RECURRENCE-ID:20261017T090000Z','DTSTART:20261017T110000Z','DTEND:20261017T120000Z','SUMMARY:Moved']),
    event(['RECURRENCE-ID:20261018T090000Z','DTSTART:20261018T090000Z','DTEND:20261018T100000Z','STATUS:CANCELLED']),
  ]);
  const parsed=parseCalendar(text,now);
  assert.equal(parsed.occurrences.length,2);
  assert.equal(parsed.occurrences[0].title,'Team, weekly');
  assert.equal(parsed.occurrences[0].description,'Line one\nLine twocontinued');
  assert.equal(parsed.occurrences[1].start,Date.parse('2026-10-17T11:00:00Z'));
  assert.equal(parsed.occurrences[1].title,'Moved');
  assert.equal(parseCalendar(feed([event(['DTSTART:20261015T090000Z','STATUS:CANCELLED'])]),now).occurrences.length,0);
});

test('Calendar uses IANA/embedded zones and server-local floating/all-day dates without changing global time settings',()=>{
  const iana=feed([event(['DTSTART;TZID=Europe/Helsinki:20261024T090000','DTEND;TZID=Europe/Helsinki:20261024T100000','RRULE:FREQ=DAILY;COUNT=3'])]);
  const rows=parseCalendar(iana,Date.parse('2026-10-23T00:00:00Z')).occurrences;
  assert.equal(rows[0].start,Date.parse('2026-10-24T06:00:00Z'));
  assert.equal(rows[1].start,Date.parse('2026-10-25T07:00:00Z'));
  const embedded=feed(['BEGIN:VTIMEZONE\r\nTZID:Custom/Two\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0200\r\nEND:STANDARD\r\nEND:VTIMEZONE',event(['DTSTART;TZID=Custom/Two:20261015T090000','DTEND;TZID=Custom/Two:20261015T100000'])]);
  assert.equal(parseCalendar(embedded,now).occurrences[0].start,Date.parse('2026-10-15T07:00:00Z'));
  const allDay=parseCalendar(feed([event(['DTSTART;VALUE=DATE:20261015','DTEND;VALUE=DATE:20261017'])]),now).occurrences[0];
  assert.equal(allDay['all-day'],true);assert.equal(allDay.start,new Date(2026,9,15).getTime());assert.equal(allDay.end,new Date(2026,9,17).getTime());
  const floating=parseCalendar(feed([event(['DTSTART:20261015T090000','DTEND:20261015T100000'])]),now).occurrences[0];
  assert.equal(floating.start,new Date(2026,9,15,9).getTime());
  assert.throws(()=>parseCalendar(feed([event(['DTSTART;TZID=Not/AZone:20261015T090000'])]),now));
});

test('Calendar bounds expansion and parser workers cancel without late completion',async()=>{
  const parsed=await expandCalendar(simple,now,new AbortController().signal);assert.equal(parsed.occurrences[0].title,'Team TESLA meeting');
  assert.throws(()=>parseCalendar('not a calendar',now));
  assert.throws(()=>parseCalendar(feed([event(['DTSTART:20200101T090000Z','RRULE:FREQ=SECONDLY'])]),now));
  assert.throws(()=>parseCalendar(feed(Array.from({length:1001},(_,i)=>event(['DTSTART:20261015T090000Z'],String(i)))),now));
  const many=parseCalendar(feed(Array.from({length:40},(_,i)=>event(['DTSTART:20261015T090000Z'],String(i)))),now);
  assert.equal(many.occurrences.length,32);assert.equal(many.limited,true);
  const controller=new AbortController();const pending=expandCalendar(simple,now,controller.signal);controller.abort(Error('cancelled'));await assert.rejects(pending,/cancelled/);
});

test('Calendar reminder claims commit before events; cached checks avoid feed traffic, restart and failures never replay',async()=>{
  let clock=now,reads=0,fail=false;
  const read=async()=>{reads++;if(fail)throw Error('SECRET provider error');return simple;};
  const adapter=createCalendarAdapter({read,now:()=>clock}),h=host();await adapter.start(settings);
  await adapter.execute('refresh',{},h.context);assert.equal(reads,1);assert.deepEqual(h.events.map(row=>row.id),['reading-updated']);
  clock+=61000;await adapter.execute('refresh',{},h.context);
  const upcoming=h.events.find(row=>row.id==='event-upcoming');assert.ok(upcoming);assert.equal(upcoming.value.title,'Team TESLA meeting');assert.equal(upcoming.state.calendars.personal.claims.length,1);
  assert.equal(reads,1);assert.doesNotMatch(JSON.stringify(h.state),/SECRET|calendar\.example/);
  await adapter.execute('refresh',{},h.context);assert.equal(h.events.filter(row=>row.id==='event-upcoming').length,1);
  clock=now+11*60000;await adapter.execute('refresh',{},h.context);assert.ok(h.events.some(row=>row.id==='event-started'));
  clock=now+16*60000;fail=true;await assert.rejects(adapter.execute('refresh',{},h.context),/could not/);
  assert.equal(h.state.calendars.personal['received-at'],now);assert.equal(reads,2);
  clock+=60000;await assert.rejects(adapter.execute('refresh',{},h.context),/cooling/);assert.equal(reads,2);
  const resumed=createCalendarAdapter({read,now:()=>now+72*60000}),resumedHost=host(h.state);fail=false;await resumed.start(settings);await resumed.execute('refresh',{},resumedHost.context);
  assert.deepEqual(resumedHost.events.map(row=>row.id),['reading-updated']);
});

test('Calendar HTTP pins public DNS and rejects mixed answers, redirects, oversized or non-calendar responses',async()=>{
  let sockets=0;
  function request(url,options,callback) {
    sockets++;assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,undefined);
    options.lookup('calendar.example',{all:true},(error,rows)=>assert.deepEqual(rows,[{address:'8.8.8.8',family:4}]));
    const req=new EventEmitter();req.end=()=>{
      const response=new EventEmitter();response.statusCode=200;response.headers={'content-type':'text/calendar'};response.destroy=()=>{};
      callback(response);queueMicrotask(()=>{response.emit('data',Buffer.from(simple));response.emit('end');});
    };return req;
  }
  assert.equal(await readSubscription(calendar.url,new AbortController().signal,{request,lookup:async()=>[{address:'8.8.8.8',family:4}]}),simple);
  await assert.rejects(readSubscription(calendar.url,new AbortController().signal,{request,lookup:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]}),/not public/);assert.equal(sockets,1);
  for(const [status,headers,body] of [[302,{'content-type':'text/calendar'},''],[200,{'content-type':'text/html'},''],[200,{'content-type':'text/calendar'},'x'.repeat(1048577)]]) {
    const fake=(url,options,callback)=>{const req=new EventEmitter();req.end=()=>{const response=new EventEmitter();response.statusCode=status;response.headers=headers;response.destroy=()=>{};callback(response);queueMicrotask(()=>{response.emit('data',Buffer.from(body));response.emit('end');});};return req;};
    await assert.rejects(readSubscription(calendar.url,new AbortController().signal,{request:fake,lookup:async()=>[{address:'8.8.8.8',family:4}]}));
  }
});

test('Calendar secret subscription is absent from shared list summaries and public Card data',async()=>{
  const source=await fs.readFile(new URL('../web/plugin-ui.js',import.meta.url),'utf8');
  const context=vm.createContext({document:{addEventListener(){}}});vm.runInContext(source+'\nglobalThis.pluginUI = PluginUI;',context);
  const raw=JSON.parse(await fs.readFile(new URL('../plugins/calendar/declaration.json',import.meta.url)));
  assert.doesNotMatch(context.pluginUI.itemSummary(raw.settings.find(row=>row.id==='calendars'),calendar),/SECRET|calendar\.example/);
  const plugin=validateDeclaration(raw),reading={'next-title':'Team TESLA meeting','row-count':1,'event-1-title':'Team TESLA meeting','event-1-start':now,'received-at':now};
  const record={health:'ready',configured:true,config:{snapshot:()=>({enabled:true,settings})},log:{latest:()=>[]},state:{snapshot:()=>({calendars:{personal:{...reading,claims:['PRIVATE-CLAIM'],occurrences:['PRIVATE-CACHE']}}})}};
  const card=validateCard({schemaVersion:1,layout:'readymade',templateId:'agenda',sourceId:'personal',enabled:false},plugin,null,settings);
  const selected=selectedCardData(card,projectCardData(plugin,record),cardCatalog(plugin,settings));
  assert.doesNotMatch(JSON.stringify(selected),/SECRET|calendar\.example|PRIVATE/);assert.equal(selected.data.values['personal:agenda'].value.length,1);
});

test('Calendar actual worker discovers disabled package, emits declared reminders and keeps source private',async t=>{
  const base=fileURLToPath(new URL('./.tmp/',import.meta.url));await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'calendar-')),folder=path.join(root,'plugins/calendar');
  await fs.cp(new URL('../plugins/calendar/',import.meta.url),folder,{recursive:true,filter:file=>!file.split(path.sep).includes('data')});
  await fs.writeFile(path.join(folder,'server/test-entry.mjs'),`import {createCalendarAdapter} from './index.mjs';let clock=${now-60000};const adapter=createCalendarAdapter({now:()=>clock,read:async()=>${JSON.stringify(simple)}});export default {...adapter,execute(...args){clock+=60000;return adapter.execute(...args);}};`);
  const raw=JSON.parse(await fs.readFile(path.join(folder,'declaration.json')));raw.runtime.entry='server/test-entry.mjs';await fs.writeFile(path.join(folder,'declaration.json'),JSON.stringify(raw));
  let app=await createLocalserve(root,{automatic:false});
  t.after(async()=>{await app.close();assert.ok(path.resolve(root).startsWith(path.resolve(base)+path.sep));await fs.rm(root,{recursive:true,force:true});});
  assert.equal(app.registry.services()[0].enabled,false);assert.equal(app.registry.services()[0].configurationReady,false);
  await app.registry.saveConfiguration('calendar',{revision:1,enabled:true,settings});
  const taskResponse=await fetch(app.origin+'/api/tasks',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.origin,'X-Localserve-Token':app.snapshot().token},body:JSON.stringify({name:'Calendar reminder',enabled:true,starts:[{id:'rule',name:'Reminder',enabled:true,type:'event',eventId:'plugin:calendar:event:event-upcoming:personal',condition:{field:'title',operator:'contains',value:'TESLA'}}],steps:[{id:'log',type:'log',enabled:true,message:'Calendar reminder matched'}]})});
  assert.equal(taskResponse.status,200,await taskResponse.text());
  await app.registry.execute('calendar','refresh',{});
  assert.equal(app.state.snapshot().runs.length,0);
  await app.registry.execute('calendar','refresh',{});
  const deadline=Date.now()+3000;
  while(app.state.snapshot().runs.length===0 || app.engine.active.size || app.engine.pending.size) {assert.ok(Date.now()<deadline,'Reminder Task did not finish');await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(app.state.snapshot().runs.length,1);
  assert.equal(app.state.snapshot().runs[0].event.payload.title,'Team TESLA meeting');
  assert.equal(app.registry.services()[0].cardData.values['personal:next-title'].value,'Team TESLA meeting');
  const asset=await fetch(app.origin+'/plugin-card-assets/calendar/agenda/card.html');assert.equal(asset.status,200);assert.match(asset.headers.get('content-security-policy'),/script-src 'none'/);
  for(const file of ['/plugins/calendar/data/config.json','/plugins/calendar/vendor/ical.js/lib/ical/module.js']) assert.equal((await fetch(app.origin+file)).status,404);
  const saved=app.registry.get('calendar').state.snapshot();await app.close();app=await createLocalserve(root,{automatic:false});assert.deepEqual(app.registry.get('calendar').state.snapshot(),saved);
});

test('twenty Calendars stay within the shared snapshot bound with long multibyte data',async()=>{
  let clock=now;
  const calendars=Array.from({length:20},(_,i)=>({...calendar,id:`cal-${i}`,name:`Calendar ${i}`}));
  const occurrences=Array.from({length:32},(_,i)=>({id:String(i).padStart(64,'0'),title:'界'.repeat(160),description:'界'.repeat(240),location:'界'.repeat(120),start:now+3600000+i*60000,end:now+7200000+i*60000,'all-day':false}));
  const adapter=createCalendarAdapter({now:()=>clock,read:async()=>simple,expand:async()=>({occurrences:structuredClone(occurrences),limited:false})}),h=host();await adapter.start({...settings,calendars});
  for(const source of calendars){await adapter.execute('refresh',{'calendar-id':source.id},h.context);clock+=3000;}
  assert.ok(Buffer.byteLength(JSON.stringify(h.state))<1048576);
  assert.ok(h.state.calendars['cal-0']['agenda-limited']);
});

test('a replaced Calendar clears prior readings even when request spacing blocks its next read',async()=>{
  const adapter=createCalendarAdapter({now:()=>now,read:async()=>simple}),h=host();
  await adapter.start(settings);await adapter.execute('refresh',{},h.context);
  assert.ok(h.state.calendars.personal['next-title']);
  await adapter.start({...settings,calendars:[{...calendar,url:'https://calendar.example/replacement.ics'}]});
  await assert.rejects(adapter.execute('refresh',{},h.context),/spacing/);
  assert.equal(h.state.calendars.personal['next-title'],undefined);
});
