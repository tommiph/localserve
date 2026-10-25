/** Stored-scene transitions use synthetic adapters, never an installed gateway. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {selectorFixture} from './fixtures/scene-selector.mjs';
import {publicReading} from '../plugins/tradfri/server/readings.mjs';
import {validateControlPage} from '../server/controls.mjs';
import {validateDeclaration} from '../server/plugins.mjs';
import {validateTask} from '../server/tasks.mjs';

async function fixture(t){
  const f=await selectorFixture({sceneFades:true});t.after(()=>f.close());
  const record=f.app.registry.get('tradfri');
  await record.state.update(state=>Object.assign(state,publicReading([{id:'1',name:'White',on:true,brightness:50,
    reachable:true,spectrum:'white',temperature:40}],[],Date.now()),{'gateway-host':''}));
  const page=()=>f.app.controls.pages('tradfri')[0];
  const save=(values)=>f.app.controls.administerScene('tradfri',page().id,{revision:page().revision,...values});
  const create=async (fadeSeconds)=>{
    await save({action:'create',name:'Fade scene',lights:[{id:'1',on:true,brightness:30,temperature:60}],
      ...(fadeSeconds!==undefined?{fadeSeconds}:{})});
    const scene=page().items.at(-1);await save({action:'enabled',itemId:scene.id,enabled:true});return scene.id;
  };
  const run=async id=>{
    await f.app.controls.administerScene('tradfri',page().id,{revision:page().revision,itemId:id,requestId:randomUUID()},true);
    await f.app.controls.active.get('tradfri')?.done;
    assert.equal(f.app.controls.runs.snapshot().runs.at(-1).status,'completed');
  };
  return {...f,record,page,save,create,run};
}

test('scene fade is optional, rounds to gateway precision, copies and resets without light effects',async t=>{
  const f=await fixture(t),id=await f.create(12.34);
  assert.equal(f.page().items.find(item=>item.id===id).fadeSeconds,12.3);
  assert.equal(f.app.controls.sceneDetails('tradfri',f.page().id).fadeDefault,0.4);
  await f.save({action:'copy',itemId:id,name:'Fade copy'});
  assert.equal(f.page().items.at(-1).fadeSeconds,12.3);
  assert.equal(f.page().items.at(-1).enabled,false);
  await f.save({action:'edit',itemId:id,name:'Fade scene',fadeSeconds:0});
  assert.equal(f.page().items.find(item=>item.id===id).fadeSeconds,0);
  await f.run(id);assert.equal(f.record.state.snapshot().effects.at(-1).fade,0);
  await f.save({action:'edit',itemId:id,name:'Fade scene',fadeSeconds:null});
  assert.equal(Object.hasOwn(f.page().items.find(item=>item.id===id),'fadeSeconds'),false);
  await f.run(id);assert.equal(f.record.state.snapshot().effects.at(-1).fade,null,'No override means adapter settings');
  assert.equal(f.record.config.snapshot().settings['fade-seconds'],0.4);
});

test('direct Controls and a global Task deliver the same saved fade through supervised IPC',async t=>{
  const f=await fixture(t),id=await f.create(4.5),page=f.page();
  await f.run(id);
  const task=validateTask({name:'Synthetic scene Task',enabled:true,starts:[],steps:[{id:'scene',type:'plugin',enabled:true,
    capabilityId:'plugin:tradfri:run-scene',parameters:{'scene-id':page.id+'/'+id}}]},null,f.app.registry.actions(),f.app.registry.events());
  await f.app.tasks.update(items=>items.push(task));
  const run=await f.app.engine.manualStart(task.id);
  const deadline=Date.now()+10000;
  while(f.app.engine.active.has(run.id)){
    assert.ok(Date.now()<deadline,'Synthetic Task did not settle');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(f.app.state.snapshot().runs.find(item=>item.id===run.id).status,'completed');
  assert.deepEqual(f.record.state.snapshot().effects.map(item=>item.fade),[4.5,4.5]);
  assert.deepEqual(f.record.state.snapshot().effects[0].values,{id:'1',on:true,brightness:30,temperature:60});
  assert.equal(f.app.registry.get('tradfri').recovery.nextAt,null);
});

test('invalid or injected fades never write definitions or execute commands',async t=>{
  const f=await fixture(t),id=await f.create(),before=f.page();
  for(const fadeSeconds of [-1,61,NaN,Infinity,'2',true,{}])await assert.rejects(f.save({action:'edit',itemId:id,name:'Fade scene',fadeSeconds}),/0–60/);
  assert.deepEqual(f.page(),before);
  const view=f.app.controls.viewer('tradfri','lights');
  await assert.rejects(f.app.controls.scene('tradfri','lights',view.token,{action:'edit',revision:before.revision,itemId:id,name:'Fade scene',fadeSeconds:2}),/administration/);
  assert.throws(()=>f.app.registry.execute('tradfri','light-state',{id:'1',on:true,brightness:10},{lightingFadeSeconds:8}),/current scene/);
  const controller=new AbortController();
  assert.throws(()=>f.app.registry.execute('tradfri','light-state',{id:'1',on:true,brightness:10},
    {lightingScene:'invented',lightingFadeSeconds:8,signal:controller.signal}),/changed or stopped/);
  const plugin=f.app.registry.plugins.find(plugin=>plugin.id==='tradfri');
  const bad={...before,items:[{...before.items.find(item=>item.id===id),fadeSeconds:2,steps:[{id:'power',actionId:'light-power',parameters:{id:'1',on:true}}]}]};
  assert.throws(()=>validateControlPage(bad,plugin,before),/stored light settings/);
  const raw=JSON.parse(await fs.readFile(new URL('../plugins/tradfri/declaration.json',import.meta.url),'utf8'));
  raw.controls.lighting.sceneFadeSetting='host';assert.throws(()=>validateDeclaration(raw),/numeric setting/);
  assert.equal(f.record.state.snapshot().effects,undefined);
});

test('scene edits and owner cancellation invalidate a captured fade without replay',async t=>{
  const f=await fixture(t),id=await f.create(5),page=f.page(),controller=new AbortController();
  const active={runId:'synthetic-run',itemId:id,page,configurationRevision:f.record.config.snapshot().revision,
    controller,signal:controller.signal,fadeSeconds:5};
  f.app.controls.active.set('tradfri',active);
  const context={lightingScene:active.runId,lightingFadeSeconds:5,signal:controller.signal};
  assert.doesNotThrow(()=>f.app.controls.assertSceneFade('tradfri','light-state',context));
  assert.throws(()=>f.app.controls.assertSceneFade('tradfri','light-power',context),/changed or stopped/);
  assert.throws(()=>f.app.controls.assertSceneFade('tradfri','light-state',{...context,lightingFadeSeconds:0}),/changed or stopped/);
  controller.abort();assert.throws(()=>f.app.controls.assertSceneFade('tradfri','light-state',context),/changed or stopped/);
  f.app.controls.active.delete('tradfri');
  assert.throws(()=>f.app.controls.assertSceneFade('tradfri','light-state',context),/changed or stopped/);
  assert.equal(f.record.state.snapshot().effects,undefined);
});

test('administrator fade form preserves zero, inherit and copy drafts with shared form controls',async()=>{
  const source=await fs.readFile(new URL('../web/lighting-scenes-ui.js',import.meta.url),'utf8');
  const sandbox={document:{addEventListener(){}},escapeHtml:String,dialogContext:{sceneAction:'edit'}};
  vm.createContext(sandbox);const ui=vm.runInContext(source+';LightingScenesUI;',sandbox);
  const details={fadeDefault:0.4,editableScenes:{one:[]}},scene={id:'one',fadeSeconds:0};
  assert.match(ui.fadeEditor(scene,details),/value="0"/);
  assert.match(ui.fadeEditor(scene,details),/class="switch" role="switch"/);
  const form={elements:{name:{value:'Evening'},icon:{value:'moon'},inheritFade:{checked:false},fadeSeconds:{value:'0'}}};
  assert.equal(ui.draft(form).fadeSeconds,0);
  form.elements.inheritFade.checked=true;assert.equal(ui.draft(form).fadeSeconds,null);
  assert.equal(ui.fadeEditor({id:'unknown'},details),'','Mixed action scenes keep their default');
});
