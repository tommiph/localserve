/** Authored examples run only in disposable Simulator installations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import http from 'node:http';
import {createLocalserve} from '../server.mjs';
import {demoIds} from '../server/demo.mjs';

async function fixture(t){
  const base=fileURLToPath(new URL('./.tmp/',import.meta.url));await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'demo-'));
  await fs.mkdir(path.join(root,'web'));await fs.copyFile(new URL('../web/demo-ui.js',import.meta.url),path.join(root,'web/demo-ui.js'));
  await fs.cp(new URL('../plugins/simulator/',import.meta.url),path.join(root,'plugins/simulator'),{recursive:true,filter:source=>!source.split(path.sep).includes('data')});
  let app=await createLocalserve(root,{automatic:false});
  t.after(async()=>{await app.close();assert.ok(root.startsWith(base));await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  const call=async(endpoint,values,headers={})=>{
    const response=await fetch(app.origin+endpoint,values===undefined?{}:{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Localserve-Token':app.snapshot().token,...headers},body:JSON.stringify(values)});
    return {status:response.status,body:await response.json()};
  };
  return {root,get app(){return app;},call,async restart(){await app.close();app=await createLocalserve(root,{automatic:false});}};
}

test('demo is optional, creates linked real definitions once, and runs only on request',async t=>{
  const f=await fixture(t);
  assert.equal(f.app.snapshot().demo.available,true);
  const script=await fetch(f.app.origin+'/demo-ui.js');assert.equal(script.status,200);assert.match(await script.text(),/const DemoUI/);
  assert.equal(await fs.stat(path.join(f.root,'data/demo.json')).then(()=>true,()=>false),false);
  assert.equal((await f.call('/api/demo/install',{}, {'X-Localserve-Token':'wrong'})).status,403);
  assert.equal((await f.call('/api/demo/install',{enabled:true})).status,400);
  assert.equal((await f.call('/api/demo/install',{})).status,200);
  let state=f.app.snapshot();
  assert.equal(state.demo.status,'ready');assert.equal(state.tasks.length,1);assert.equal(state.vistas.length,1);
  assert.equal(state.services[0].cards.length,1);assert.equal(state.services[0].enabled,true);
  assert.equal(state.runs.length,0);assert.equal(state.vistaDisplay.vistaId,null);assert.equal(state.tasks[0].starts.length,0);
  assert.equal(state.vistas[0].layout.children[0].cards[0].cardId,state.services[0].cards[0].id);
  assert.equal((await f.call('/api/vistas/localserve-demo')).status,200);
  const configRevision=state.services[0].config.revision;
  await f.call('/api/demo/install',{});assert.equal(f.app.tasks.snapshot().length,1);
  assert.equal(f.app.snapshot().services[0].config.revision,configRevision);
  assert.equal((await f.call('/api/demo/run',{revision:99})).status,409);
  assert.equal((await f.call('/api/demo/run',{revision:1,parameters:{}})).status,400);
  assert.equal((await f.call('/api/demo/run',{revision:1})).status,200);
  const deadline=Date.now()+15000;
  while(f.app.engine.active.size||f.app.engine.pending.size){if(Date.now()>deadline)throw Error('Demo run did not finish');await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(f.app.registry.get('simulator').state.snapshot().value,72);
  assert.equal(f.app.registry.get('simulator').state.snapshot().sequence,1);
  assert.equal(f.app.state.snapshot().runs[0].status,'completed');
  await f.restart();state=f.app.snapshot();
  assert.equal(state.demo.status,'ready');assert.equal(state.tasks.length,1);assert.equal(state.runs.length,1);
  assert.equal(state.services[0].pluginState.sequence,1);
});

test('existing content and configured Simulator are preserved without a demo record',async t=>{
  const f=await fixture(t);
  await f.call('/api/tasks',{name:'My task',enabled:false,starts:[],steps:[{id:'log',type:'log',enabled:true,message:'Keep me'}]});
  const files=['data/tasks.json','data/vistas.json','data/vista-display.json','plugins/simulator/data/config.json','plugins/simulator/data/cards.json'];
  const before=await Promise.all(files.map(file=>fs.readFile(path.join(f.root,file),'utf8')));
  assert.equal(f.app.snapshot().demo.available,false);
  assert.equal((await f.call('/api/demo/install',{})).status,409);
  assert.deepEqual(await Promise.all(files.map(file=>fs.readFile(path.join(f.root,file),'utf8'))),before);
  assert.equal(await fs.stat(path.join(f.root,'data/demo.json')).then(()=>true,()=>false),false);
});

test('a failed setup resumes after restart without enabling anything or duplicating content',async t=>{
  const f=await fixture(t),write=f.app.vistas.store.write.bind(f.app.vistas.store);
  f.app.vistas.store.write=async()=>{throw Error('Synthetic disk failure');};
  assert.equal((await f.call('/api/demo/install',{})).status,500);
  f.app.vistas.store.write=write;
  assert.equal(f.app.snapshot().demo.status,'installing');
  assert.equal(f.app.registry.services()[0].enabled,false);assert.equal(f.app.state.snapshot().runs.length,0);
  await f.restart();assert.equal(f.app.registry.services()[0].enabled,false);
  assert.equal((await f.call('/api/demo/install',{})).status,200);
  assert.equal(f.app.tasks.snapshot().length,1);assert.equal(f.app.vistas.snapshot().length,1);
  assert.equal(f.app.registry.services()[0].cards.length,1);
});

test('setup reserves writes and rejects modified demo Task execution',async t=>{
  const f=await fixture(t),record=f.app.registry.get('simulator'),write=record.cards.write.bind(record.cards);
  let release,entered;const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  record.cards.write=async value=>{entered();await held;return write(value);};
  const setup=f.call('/api/demo/install',{});await started;
  try{assert.equal((await f.call('/api/config',{name:'Concurrent edit'})).status,409);assert.equal((await f.call('/api/demo/install',{})).status,409);}
  finally{release();}
  assert.equal((await setup).status,200);record.cards.write=write;
  const task=f.app.tasks.snapshot()[0];await f.call('/api/tasks/'+task.id,{...task,name:'Edited task'});
  assert.equal(f.app.snapshot().demo.canRun,false);
  assert.equal((await f.call('/api/demo/run',{revision:2})).status,409);
  assert.equal(f.app.state.snapshot().runs.length,0);
});

test('setup refuses earlier administrator writes and cannot start during shutdown',async t=>{
  async function partial(f,endpoint){
    let entered;const started=new Promise(resolve=>{entered=resolve;});
    f.app.server.once('request',entered);
    let request;
    const response=new Promise((resolve,reject)=>{
      request=http.request(f.app.origin+endpoint,{method:'POST',headers:{Origin:f.app.origin,'Content-Type':'application/json','X-Localserve-Token':f.app.snapshot().token}},reply=>{
        reply.resume();reply.once('end',()=>resolve(reply.statusCode));
      });request.once('error',reject);request.write('{');
    });
    await started;return {request,response};
  }
  const first=await fixture(t),edit=await partial(first,'/api/config');
  try{assert.equal((await first.call('/api/demo/install',{})).status,409);}
  finally{edit.request.end('}');}
  assert.equal(await edit.response,200);assert.equal(first.app.tasks.snapshot().length,0);
  const second=await fixture(t),setup=await partial(second,'/api/demo/install');
  const closing=second.app.close();setup.request.end('}');
  assert.equal(await setup.response,503);await closing;
  assert.equal(second.app.tasks.snapshot().length,0);
  assert.equal(await fs.stat(path.join(second.root,'data/demo.json')).then(()=>true,()=>false),false);
});

test('invalid demo metadata quarantines only demo setup',async t=>{
  const f=await fixture(t);await f.app.close();
  await fs.writeFile(path.join(f.root,'data/demo.json'),'{invalid');
  await f.restart();assert.equal(f.app.snapshot().demo.status,'unavailable');
  assert.equal((await f.call('/api/state')).status,200);
  assert.equal((await f.call('/api/demo/install',{})).status,409);
  assert.equal(await fs.readFile(path.join(f.root,'data/demo.json'),'utf8'),'{invalid');
});

test('paused or previously configured installations cannot be populated',async t=>{
  const f=await fixture(t);
  await f.call('/api/pause',{paused:true});
  assert.equal((await f.call('/api/demo/install',{})).status,409);
  await f.call('/api/pause',{paused:false});
  await f.app.registry.saveConfiguration('simulator',{revision:1,settings:{'configuration-complete':false}});
  assert.equal((await f.call('/api/demo/install',{})).status,409);
  assert.equal(f.app.registry.services()[0].config.settings['configuration-complete'],false);
  assert.equal(f.app.tasks.snapshot().length,0);
});

test('interrupted setup refuses to overwrite an edited example',async t=>{
  const f=await fixture(t),write=f.app.vistas.store.write.bind(f.app.vistas.store);
  f.app.vistas.store.write=async()=>{throw Error('Synthetic disk failure');};
  await f.call('/api/demo/install',{});f.app.vistas.store.write=write;
  await f.app.registry.get('simulator').cards.update(store=>{store.cards[0].enabled=false;store.cards[0].revision++;});
  const before=await fs.readFile(path.join(f.root,'plugins/simulator/data/cards.json'),'utf8');
  assert.equal((await f.call('/api/demo/install',{})).status,409);
  assert.equal(await fs.readFile(path.join(f.root,'plugins/simulator/data/cards.json'),'utf8'),before);
  assert.equal(f.app.registry.services()[0].enabled,false);
});

test('shutdown drains demo writes before releasing its installation lock',async t=>{
  const f=await fixture(t),record=f.app.registry.get('simulator'),write=record.cards.write.bind(record.cards);
  let release,entered;const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  record.cards.write=async value=>{entered();await held;return write(value);};
  const setup=f.call('/api/demo/install',{});await started;
  const closing=f.app.close();
  try{await assert.rejects(createLocalserve(f.root,{automatic:false}),/already running/);}
  finally{release();}
  assert.equal((await setup).status,200);await closing;
  await f.restart();assert.equal(f.app.snapshot().demo.status,'ready');
  assert.equal(f.app.tasks.snapshot().length,1);
});

test('demo presentation is explicit, uses normal editors and holds no browser definitions',async()=>{
  const context={state:{demo:{available:true,status:'not-installed'}},icon:()=>'',escapeHtml:value=>String(value).replaceAll('"','&quot;')};
  const ui=vm.runInNewContext(await fs.readFile(new URL('../web/demo-ui.js',import.meta.url),'utf8')+'\nDemoUI;',context);
  assert.match(ui.render(),/Create demo/);assert.match(ui.render(),/Only Simulator is enabled/);
  context.state.demo={status:'ready',taskId:demoIds.task,vistaUrl:'/vistas/localserve-demo',canRun:true};
  assert.match(ui.render(),/rel="noopener"/);assert.match(ui.render(),/data-action="edit-task"/);
  context.state.demo={status:'not-installed',available:false};assert.equal(ui.render(),'');
});

test('Overview remains usable without the optional demo script or backend capability',async()=>{
  const source=await fs.readFile(new URL('../web/app.js',import.meta.url),'utf8');
  const overview=source.slice(source.indexOf('function renderOverview()'),source.indexOf('function runsPanel()'));
  let rendered='';
  const context={state:{services:[],tasks:[],server:{discoveryErrors:[],memoryBytes:0}},config:{name:'Localserve',version:'1.0.0'},
    renderWorkspace:value=>{rendered=value;},pageHeading:()=>'<h1>Overview</h1>',statusPill:()=>'',metric:()=>'',servicesPanel:()=>'',activityPanel:()=>'',icon:()=>'',formatDuration:()=>'',escapeHtml:String};
  vm.createContext(context);vm.runInContext(overview,context);
  context.renderOverview();assert.match(rendered,/<h1>Overview<\/h1>/);assert.match(rendered,/Server controls/);
  context.state.demo={available:true};context.renderOverview();assert.match(rendered,/Server controls/);
  context.DemoUI={render:()=>'<section>Demo setup</section>'};context.renderOverview();assert.match(rendered,/Demo setup/);
  delete context.state.demo;context.renderOverview();assert.doesNotMatch(rendered,/Demo setup/);
});

test('Overview attention excludes disabled configuration but retains runtime and enabled-service failures',async()=>{
  const source=await fs.readFile(new URL('../web/app.js',import.meta.url),'utf8');
  const overview=source.slice(source.indexOf('function renderOverview()'),source.indexOf('function runsPanel()'));
  const metrics=new Map(),context={state:{services:[],tasks:[],server:{discoveryErrors:[],memoryBytes:0}},config:{name:'Localserve',version:'1.0.0'},
    renderWorkspace:()=>{},pageHeading:()=>'',statusPill:()=>'',metric:(label,value)=>{metrics.set(label,value);return '';},servicesPanel:()=>'',activityPanel:()=>'',icon:()=>'',formatDuration:()=>'',escapeHtml:String};
  vm.createContext(context);vm.runInContext(overview,context);
  const disabled={enabled:false,configurationReady:false,health:'idle',pollObservation:{status:'failed'}};
  context.state.services=[disabled];context.renderOverview();assert.equal(metrics.get('Needs attention'),0);
  for(const service of [{...disabled,enabled:true},{...disabled,health:'error'},{...disabled,health:'restart-required'},{enabled:true,configurationReady:true,health:'ready',pollObservation:{status:'failed'}}]){
    context.state.services=[service];context.renderOverview();assert.equal(metrics.get('Needs attention'),1);
  }
  context.state.services=[];context.state.server.discoveryErrors=['Unreadable plugin'];context.renderOverview();assert.equal(metrics.get('Needs attention'),1);
});
