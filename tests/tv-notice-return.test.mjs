/** Synthetic TV observations and disposable notice leases; no device traffic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {captureNoticeApp,returnNoticeApp,vistaAppId} from '../plugins/samsung-tv/server/notice-return.mjs';
import {TvNotices} from '../server/tv-notices.mjs';
import {PluginRegistry} from '../server/plugins.mjs';
import {ExecutionGate} from '../server/tasks.mjs';

const signal=()=>new AbortController().signal;
test('capture selects positive foreground, distinguishes background apps and skips ambiguity or incomplete scans',async()=>{
  const connection={apps:async()=>[{appId:'one'},{appId:'two'}]};
  const http={app:async(host,id)=>({running:true,visible:id==='one'})};
  assert.equal(await captureNoticeApp(connection,http,'local',signal()),'one');
  assert.equal(await captureNoticeApp(connection,{app:async()=>({running:true})},'local',signal()),null);
  assert.equal(await captureNoticeApp(connection,{app:async()=>({running:true,visible:true})},'local',signal()),null);
  assert.equal(await captureNoticeApp({apps:async()=>[{appId:vistaAppId}]},{app:async()=>({running:true,visible:true})},'local',signal()),null);
  assert.equal(await captureNoticeApp({apps:async()=>Array(65).fill({appId:'one'})},http,'local',signal()),null);
  assert.equal(await captureNoticeApp({apps:async()=>{throw Error('Unsupported');}},http,'local',signal()),null);
  const controller=new AbortController();controller.abort();await assert.rejects(captureNoticeApp(connection,http,'local',controller.signal));
});

test('one app return requires Vista still visible, rechecks after connecting and never sends keys or arguments',async()=>{
  let vista={running:true,visible:true},target={running:true,visible:false},closed=0,connected=0;const sent=[];
  const options={appId:'one',host:'local',signal:signal(),http:{app:async(host,id)=>id===vistaAppId?vista:target},
    connect:async()=>{connected++;return {send:async value=>sent.push(value),close(){closed++;}};},gate:async()=>{}};
  assert.equal((await returnNoticeApp(options)).commandSent,true);assert.equal(sent.length,1);assert.equal(closed,1);
  assert.deepEqual(sent[0],{method:'ms.channel.emit',params:{event:'ed.apps.launch',to:'host',data:{action_type:'NATIVE_LAUNCH',appId:'one',metaTag:''}}});
  target={running:true,visible:true};assert.equal((await returnNoticeApp(options)).alreadyVisible,true);assert.equal(connected,1);
  target={running:true};await returnNoticeApp(options);assert.equal(connected,1);
  target={running:true,visible:false};vista={running:true,visible:false};await returnNoticeApp(options);assert.equal(connected,1);
  vista={running:true,visible:true};await returnNoticeApp({...options,gate:async()=>{vista={running:true,visible:false};}});
  assert.equal(connected,2);assert.equal(closed,2);assert.equal(sent.length,1);
  for(const appId of [vistaAppId,'../bad',''])await returnNoticeApp({...options,appId});assert.equal(connected,2);
});

async function broker(t) {
  const base=path.resolve('tests/.tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'notice-return-'));
  t.after(async()=>{assert.ok(root.startsWith(base+path.sep));await fs.rm(root,{recursive:true,force:true});});
  const config={snapshot:()=>({listen:{host:'10.23.42.3'},name:'Localserve',vistaFontScale:100})};
  const notices=await new TvNotices(root,config,()=>({port:7041})).load();
  const create=async()=>new URL(await notices.create({template:'Notice',title:'Title',message:'Message',seconds:10,sound:false})).pathname.split('/').at(-1);
  return {notices,root,config,create};
}
test('private return is durably consumed before effects, blocks overlap and runs only once through duplicate finishes',async t=>{
  const f=await broker(t),id=await f.create();let calls=0,release,entered;
  const start=new Promise(resolve=>entered=resolve);
  await f.notices.captureReturn(id,'one',async()=>{calls++;assert.equal(f.notices.store.snapshot().notice.returnTarget.used,true);entered();await new Promise(resolve=>release=resolve);});
  assert.doesNotMatch(JSON.stringify(f.notices.view(id)),/returnTarget|appId|"one"/);
  await assert.rejects(f.notices.captureReturn(id,'two',()=>{}),/already captured/);
  await f.notices.report(id,'shown');const finish=f.notices.report(id,'finished');await start;
  await f.notices.report(id,'finished');await assert.rejects(f.create(),/already active/);assert.equal(calls,1);
  release();await finish;assert.equal(f.notices.admin().active,false);
});
test('abandonment, expired claims and restart never restore; administrator dismissal still permits the captured return',async t=>{
  const f=await broker(t);let calls=0;
  let id=await f.create();await f.notices.captureReturn(id,'one',async()=>calls++);await f.notices.report(id,'shown');await f.notices.report(id,'abandoned');assert.equal(calls,0);
  id=await f.create();await f.notices.captureReturn(id,'one',async()=>calls++);await f.notices.report(id,'shown');
  const restarted=await new TvNotices(f.root,f.config,()=>({port:7041})).load();await restarted.report(id,'finished');assert.equal(calls,0);
  await f.notices.load();
  id=await f.create();await f.notices.captureReturn(id,'one',async()=>calls++);await f.notices.report(id,'shown');await f.notices.dismiss(f.notices.admin().revision);await f.notices.report(id,'finished');assert.equal(calls,1);
  id=await f.create();await f.notices.captureReturn(id,'one',async()=>calls++);
  await f.notices.store.update(current=>{current.notice.expiresAt=Date.now()-1;});await f.notices.expire();assert.equal(f.notices.returns.has(id),false);assert.equal(calls,1);
});

test('return supervisor rejects stale runtime/configuration, busy queues, shutdown and pause before dispatch',async()=>{
  const gate=new ExecutionGate(),runtime={request:async()=>({commandSent:true})};let ready=0;
  const registry={engine:{gate},closing:false,noticeEpoch:0,assertReady(){ready++;},assertTvQuietHours(){}};
  const record={runtime,pending:0,config:{snapshot:()=>({revision:1})},operations:new Set(),actionQueue:Promise.resolve()};
  const claim={runtime,revision:1,epoch:0};
  const call=()=>PluginRegistry.prototype.returnNotice.call(registry,record,claim,'one',false);
  for(const mutation of [()=>{record.pending=1;},()=>{registry.closing=true;},()=>{record.runtime={};},()=>{claim.revision=2;},()=>gate.setPaused(true)]){
    mutation();assert.equal((await call()).restored,false);record.pending=0;registry.closing=false;record.runtime=runtime;claim.revision=1;gate.setPaused(false);
  }
  let release;record.actionQueue=new Promise(resolve=>release=resolve);const pending=call();gate.setPaused(true);gate.setPaused(false);release();
  await assert.rejects(pending,/paused/);assert.equal(record.pending,0);assert.equal(ready,0);
  record.actionQueue=Promise.resolve();assert.equal((await call()).commandSent,true);assert.equal(record.operations.size,0);
  registry.noticeEpoch++;assert.equal((await call()).restored,false,'A pause/resume since capture invalidates return');
});
