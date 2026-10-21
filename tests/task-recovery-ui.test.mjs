/** Task recovery presentation uses captured fixtures and no device endpoints. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const scripts=await Promise.all(['run-ui','tasks-ui'].map(name=>fs.readFile(new URL(`../web/${name}.js`,import.meta.url),'utf8')));
const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function ui(scope={}) {
  const context=vm.createContext({document:{addEventListener(){}},escapeHtml,icon:()=>'',formatServerTimestamp:value=>'At '+value,dialogHeader:()=>'',dialogFooter:()=>'',...scope});
  vm.runInContext(scripts[0]+'\nglobalThis.runs=RunUI;',context);vm.runInContext(scripts[1]+'\nglobalThis.tasks=TaskUI;',context);return context;
}
const source={pluginId:'youtube',eventId:'released',name:'Video released',payload:[{id:'title',type:'string',label:'Video title'},{id:'secret',type:'string',format:'secret'}]};
const tv={id:'samsung-tv',name:'Samsung TV',connectionSetup:{testAction:'test-connection'}};
const failed=()=>({id:'run',status:'failed',automatic:true,error:'Samsung TV remote connection failed.',stepCount:3,event:{pluginId:'youtube',eventId:'released',payload:{title:'<Video>',secret:'PRIVATE',removed:'REMOVED'}},steps:[
  {number:1,type:'plugin',label:'Show TV notice',capabilityId:'plugin:samsung-tv:show-notice',status:'failed',reason:'Samsung TV remote connection failed.'},
  {number:2,label:'Delay',status:'not-run'},{number:3,label:'Play YouTube video',status:'not-run'},
]});
const preview=()=>({taskName:'Video Task',revision:4,sourceTaskRevision:2,stepCount:2,manualTvEffects:true,
  event:{name:'Released',pluginName:'YouTube',occurredAt:0,values:[{id:'title',label:'Title',value:'<Video>'},{id:'value',label:'Value',value:0},{id:'flag',label:'Flag',value:false}]},
  steps:[{number:1,label:'Show TV notice',enabled:true,parameters:[{label:'Title',value:'<Video>'}]},{number:2,label:'Delay',enabled:false,parameters:[]}]});

test('failed runs show the recorded step, following steps and a connection recovery link without using edited Tasks',()=>{
  const context=ui({state:{services:[tv],taskEvents:[source],tasks:[{steps:[{capabilityId:'plugin:oculus-go:refresh'}]}]}}),run=failed();
  const html=context.runs.outcome(run);assert.match(html,/Triggered, but Samsung TV connection failed/);assert.match(html,/Step 1: Show TV notice/);
  assert.match(html,/2 following steps not run/);assert.match(html,/data-action="runs-connection" data-id="samsung-tv"/);assert.match(html,/&lt;Video>/);
  assert.doesNotMatch(html,/PRIVATE|REMOVED|oculus-go/);
  delete run.steps;assert.match(context.runs.outcome(run),/Samsung TV connection failed/);
  run.error='A generic failure';assert.doesNotMatch(context.runs.outcome(run),/runs-connection/);
  run.status='completed';run.steps=[{status:'skipped',reason:'Do not disturb'}];assert.match(context.runs.outcome(run),/TV actions skipped/);
});

test('history details and previews show only declared public captured values and escape their text',()=>{
  const context=ui({state:{services:[tv],taskEvents:[source]}});const html=context.runs.details(failed());
  assert.match(html,/&lt;Video>/);assert.doesNotMatch(html,/PRIVATE|REMOVED/);
  const plan=context.tasks.rerunPreview(preview());assert.match(plan,/revision 4/);assert.match(plan,/original run used revision 2/);
  assert.match(plan,/>0</);assert.match(plan,/>No</);assert.match(plan,/At 0/);assert.match(plan,/Disabled · skipped/);assert.match(plan,/Do not disturb/);
  const noTv=preview();noTv.manualTvEffects=false;assert.doesNotMatch(context.tasks.rerunPreview(noTv),/Do not disturb/);
  context.state.taskEvents=[];assert.doesNotMatch(context.runs.details(failed()),/PRIVATE|REMOVED|&lt;Video>/);
});

test('Rerun opens a read-only preview; only explicit submit posts once with ID and captured revision',async()=>{
  const button={disabled:false},body={innerHTML:'',textContent:''},form={isConnected:true,querySelector:selector=>selector==='[type="submit"]'?button:body};
  let resolvePreview,resolveRun,calls=0,closed=0;
  const context=ui({state:{runs:[{id:'run',name:'Video Task'}]},dialog:{querySelector:()=>form},dialogContext:null,
    showDialog(_html,options){context.dialogContext=options;},request:async(url,body)=>{assert.equal(url,'api/runs/run/preview');assert.equal(body.revision,4);await new Promise(resolve=>resolvePreview=resolve);return {preview:preview()};},
    mutate:async(url,body)=>{calls++;assert.equal(url,'api/runs/run/rerun');assert.equal(body.revision,4);assert.deepEqual(Object.keys(body),['revision']);await new Promise(resolve=>resolveRun=resolve);},
    closeDialog(){closed++;context.dialogContext=null;form.isConnected=false;},renderView(){},notify(){},showFormError:assert.fail});
  const open=context.tasks.openRerun('run',4);assert.equal(button.disabled,true);assert.equal(calls,0);
  await context.tasks.submitRerun(form);assert.equal(calls,0);resolvePreview();await open;assert.equal(button.disabled,false);
  assert.match(body.innerHTML,/&lt;Video>/);assert.equal(calls,0);
  const run=context.tasks.submitRerun(form);await context.tasks.submitRerun(form);assert.equal(calls,1);resolveRun();await run;assert.equal(closed,1);
});

test('closed preview responses cannot replace another dialog and rerun errors require a fresh preview',async()=>{
  const button={disabled:false},body={innerHTML:'',textContent:''},form={isConnected:true,querySelector:selector=>selector==='[type="submit"]'?button:body};
  let resolvePreview,errors=[];
  const context=ui({state:{runs:[{id:'run',name:'Video Task'}]},dialog:{querySelector:()=>form},dialogContext:null,
    showDialog(_html,options){context.dialogContext=options;},request:async()=>{await new Promise(resolve=>resolvePreview=resolve);return {preview:preview()};},
    mutate:async()=>{throw Error('Task changed. Refresh before running it.');},renderView(){},notify(){},showFormError:message=>errors.push(message)});
  let pending=context.tasks.openRerun('run',4);context.dialogContext={kind:'other'};form.isConnected=false;resolvePreview();await pending;assert.equal(body.innerHTML,'');
  form.isConnected=true;pending=context.tasks.openRerun('run',4);resolvePreview();await pending;await context.tasks.submitRerun(form);
  assert.match(errors[0],/Task changed/);assert.equal(button.disabled,true);assert.equal(context.dialogContext.previewReady,false);
});
