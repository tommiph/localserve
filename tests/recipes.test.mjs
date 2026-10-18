/** Recipes uses disposable stores and public schema fixtures, never devices. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {makeDraft,actionFields,describeAction,actionSentence,whenSentence,createModel,screensFor,canonicalDraft,normalizeParameters} from '../plugins/recipes/admin/task-builder.js';
import {validateDeclaration} from '../server/plugins.mjs';
import {validateTask,builtInActions} from '../server/tasks.mjs';
import {createLocalserve} from '../server.mjs';
const events=[{id:'plugin:sensors:event:light:phone-sensor-5',pluginId:'sensors',eventId:'light',payload:[{id:'lux',label:'Ambient light',type:'number'},{id:'title',label:'Title',type:'string'},{id:'secret',type:'string',format:'secret'}]}];
const choice={actionId:'log',parameters:{message:'Matched {{event.lux}}'},name:'Ambient light',when:'event',eventId:events[0].id,condition:{field:'lux',operator:'lt',value:20}};
test('draft preserves exact scoped event identity and zero/false values; normal validator owns saving',()=>{
  const draft=makeDraft(builtInActions,events,choice,randomUUID);assert.equal(draft.enabled,false);assert.equal(draft.starts[0].eventId,events[0].id);assert.equal(draft.steps[0].message,choice.parameters.message);assert.equal(validateTask(draft,null,[],events).starts[0].condition.value,20);
  const manual=makeDraft(builtInActions,[],{...choice,when:'manual',parameters:{message:'Manual'}},randomUUID);assert.deepEqual(manual.starts,[]);assert.equal(validateTask(manual).enabled,false);
  const zero=makeDraft(builtInActions,events,{...choice,condition:{field:'lux',operator:'eq',value:0}},randomUUID);assert.equal(validateTask(zero,null,[],events).starts[0].condition.value,0);
  const text=makeDraft(builtInActions,events,{...choice,parameters:{message:'Title'},condition:{field:'title',operator:'contains',value:'tesla'}},randomUUID);assert.equal(validateTask(text,null,[],events).starts[0].condition.operator,'contains');
});
test('missing events/actions, unavailable actions and private fields are rejected',()=>{
  assert.throws(()=>makeDraft([],events,choice,randomUUID));assert.throws(()=>makeDraft(builtInActions,[],choice,randomUUID));assert.throws(()=>makeDraft([{...builtInActions[0],available:false}],events,choice,randomUUID));assert.throws(()=>makeDraft(builtInActions,events,{...choice,condition:{field:'secret',operator:'eq',value:'x'}},randomUUID));
  const invalid=makeDraft(builtInActions,events,{...choice,condition:{field:'lux',operator:'contains',value:'x'}},randomUUID);assert.throws(()=>validateTask(invalid,null,[],events));
  assert.equal(actionFields(builtInActions[1])[0].id,'seconds');
});
test('scheduled and timed drafts use existing rules and do not invent an enablement clock',()=>{
  for(const when of ['schedule','timer','interval','sunrise','sunset']){const draft=makeDraft(builtInActions,[],{...choice,parameters:{message:'Scheduled'},when,time:'19:15',days:[1,2,3],seconds:60},randomUUID);const saved=validateTask(draft);assert.equal(saved.starts[0].type,when);assert.equal(draft.starts[0].enabledAt,undefined);}
});

test('natural wording is backed by exact capabilities and preserves real choice values',()=>{
  const scene={id:'plugin:fixture:run-scene',actionId:'run-scene',type:'plugin',name:'Run lighting scene',parameters:[{id:'scene-id',label:'Scene',type:'string',required:true,enum:['private-stable-identity'],enumLabels:['Evening glow']}]};
  assert.equal(describeAction(scene).title,'Set the mood');
  const model=createModel([scene],scene.id);assert.equal(model.parameters['scene-id'],'private-stable-identity');assert.equal(actionSentence(scene,model.parameters),'set the mood to Evening glow');
  assert.ok(!actionSentence(scene,model.parameters).includes('private-stable'));
  model.when='schedule';model.time='19:15';model.days=[1,2,3,4,5];assert.equal(whenSentence(model,[]),'it’s 19:15 on weekdays');
  const signals=[{id:'light',name:'My phone · Ambient light',payload:[{id:'lux',label:'Ambient light (lux)',type:'number'}]}];
  assert.equal(whenSentence({when:'event',eventId:'light',condition:{field:'lux',operator:'lt',value:20}},signals),'My phone · Ambient light is below 20 lux');
  const saved=makeDraft([scene],[],{...model,name:'My mood'},randomUUID);assert.equal(saved.steps[0].parameters['scene-id'],'private-stable-identity');assert.equal(saved.enabled,false);
});

test('wizard page/search state does not mark a draft dirty; choices and backtracking do',()=>{
  const model=createModel(builtInActions,'log');const initial=canonicalDraft(model);model.screen='when';model.search='hello';assert.equal(canonicalDraft(model),initial);
  model.parameters.message='Keep me';assert.notEqual(canonicalDraft(model),initial);
  model.when='event';model.eventId=events[0].id;assert.deepEqual(screensFor(model,builtInActions,events),['idea','details','when','signal','condition','finish']);
  model.screen='details';assert.equal(model.parameters.message,'Keep me');model.when='manual';assert.deepEqual(screensFor(model,builtInActions,events),['idea','details','when','finish']);
});

test('YouTube link convenience extracts only a fixed video ID without a fetch',()=>{
  const action={id:'plugin:tv:play-youtube',actionId:'play-youtube',name:'Play video'};
  for(const value of ['abcdEFg1234','https://www.youtube.com/watch?v=abcdEFg1234&t=10','https://youtu.be/abcdEFg1234?si=tracking','https://www.youtube.com/shorts/abcdEFg1234'])assert.equal(normalizeParameters(action,{'video-id':value})['video-id'],'abcdEFg1234');
  for(const value of ['https://example.com/abcdEFg1234','https://user:password@youtube.com/watch?v=abcdEFg1234','invalid'])assert.throws(()=>normalizeParameters(action,{'video-id':value}));
});
test('host catalogue offers declared named targets and excludes private fields',async()=>{
  const code=await fs.readFile(new URL('../web/plugin-ui.js',import.meta.url),'utf8');
  const service={id:'lamp',controls:{lighting:{lights:['lights'],groups:'groups',actions:{lightBrightness:'light-brightness'}}},cardData:{values:{lights:{available:true,value:[{id:'real-id',name:'Reading lamp'}]}}}};
  const state={services:[service],vistas:[{id:'view',name:'Garden',enabled:true},{id:'off',name:'Off',enabled:false}],taskEvents:[{id:'scoped',payload:[{id:'value',type:'number'},{id:'private',format:'secret'}]}]};
  const actionCatalog=[...builtInActions,{id:'plugin:lamp:light-brightness',type:'plugin',pluginId:'lamp',actionId:'light-brightness',parameters:[{id:'id',type:'string'}]},{id:'private-action',parameters:[{id:'key',format:'secret'}]}];
  const catalog=vm.runInNewContext(code+'\nPluginUI.taskBuilderCatalog()',{state,actionCatalog,config:{location:null},structuredClone,document:{addEventListener(){}}});
  assert.equal(catalog.actions.some(action=>action.id==='private-action'),false);assert.equal(catalog.events[0].payload.length,1);assert.equal(catalog.hasLocation,false);
  const light=catalog.actions.find(action=>action.pluginId==='lamp');assert.equal(light.parameters[0].enum[0],'real-id');assert.equal(light.parameters[0].enumLabels[0],'Reading lamp');
  const vista=catalog.actions.find(action=>action.type==='show-vista');assert.equal(vista.parameters[0].enum.length,1);assert.equal(vista.parameters[0].enum[0],'view');
  const draft=makeDraft([vista],[],{actionId:vista.id,parameters:{vistaId:'view'},when:'manual',name:'Garden'},randomUUID);assert.equal(validateTask(draft,null,[],[],state.vistas).steps[0].vistaId,'view');
});
test('builder declaration and served module are opt-in, contained and disabled by default',async t=>{
  let app;t.after(()=>app?.close());const base=fileURLToPath(new URL('./.tmp/',import.meta.url));await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'recipes-'));t.after(async()=>{assert.ok(root.startsWith(base));await fs.rm(root,{recursive:true,force:true});});
  await fs.cp(new URL('../plugins/recipes/',import.meta.url),path.join(root,'plugins/recipes'),{recursive:true,filter:source=>!source.split(path.sep).includes('data')});
  const raw=JSON.parse(await fs.readFile(path.join(root,'plugins/recipes/declaration.json')));assert.equal(validateDeclaration(raw).taskBuilder,true);assert.throws(()=>validateDeclaration({...raw,taskBuilder:'yes'}));
  app=await createLocalserve(root,{automatic:false});assert.equal(app.snapshot().services[0].enabled,false);assert.equal((await fetch(app.origin+'/plugin-task-builders/recipes.js')).status,404);
  const plugin=app.snapshot().services[0];await app.registry.saveConfiguration('recipes',{revision:plugin.config.revision,enabled:true});
  const response=await fetch(app.origin+'/plugin-task-builders/recipes.js');assert.equal(response.status,200);assert.match(await response.text(),/export function open/);assert.equal((await fetch(app.origin+'/plugins/recipes/data/config.json')).status,404);assert.equal((await fetch(app.origin+'/plugin-task-builders/missing.js')).status,404);
  const style=await fetch(app.origin+'/plugin-task-builders/recipes.css');assert.equal(style.status,200);assert.match(style.headers.get('content-type'),/text\/css/);assert.match(await style.text(),/prefers-reduced-motion/);
  const body=makeDraft(builtInActions,[],{...choice,when:'manual',name:'Created off',parameters:{message:'Off'}},randomUUID);
  const posted=await fetch(app.origin+'/api/tasks',{method:'POST',headers:{Origin:app.origin,'X-Localserve-Token':app.snapshot().token,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(posted.status,200);assert.equal(app.snapshot().tasks[0].enabled,false);assert.equal(app.snapshot().runs.length,0);
  assert.equal(app.snapshot().tasks.length,1);assert.equal(app.snapshot().taskActions.filter(action=>action.pluginId==='recipes').length,0);
  await app.registry.saveConfiguration('recipes',{revision:app.snapshot().services[0].config.revision,enabled:false});assert.equal((await fetch(app.origin+'/plugin-task-builders/recipes.js')).status,404);
  assert.equal((await fetch(app.origin+'/plugin-task-builders/recipes.css')).status,404);assert.equal(app.snapshot().tasks[0].enabled,false);
});
