/** Administrator scene authoring uses synthetic adapters and retained stores. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {selectorFixture} from './fixtures/scene-selector.mjs';

test('scene administration enforces CSRF/revisions and preserves stored steps without device effects',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());
  const app=f.app,endpoint='/api/lighting-scenes/tradfri/'+f.page.id;
  const post=(values,headers={})=>fetch(app.origin+endpoint,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Localserve-Token':app.snapshot().token,...headers},body:JSON.stringify(values)});
  const reading=await fetch(app.origin+endpoint).then(response=>response.json());
  assert.equal(reading.pageId,f.page.id);assert.equal(reading.revision,f.page.revision);assert.equal(Object.hasOwn(reading,'token'),false);
  const item=f.page.items[0],values={action:'edit',revision:f.page.revision,itemId:item.id,name:'Reading corner',icon:'book'};
  assert.equal((await post(values,{Origin:'https://foreign.example'})).status,403);
  assert.equal((await post(values,{'X-Localserve-Token':'wrong'})).status,403);
  assert.equal((await post(values)).status,200);
  const saved=app.controls.pages('tradfri')[0];
  assert.equal(saved.items[0].label,'Reading corner');assert.deepEqual(saved.items[0].steps,item.steps);
  assert.equal((await post(values)).status,409);
  await app.engine.setPaused(true);
  assert.equal((await post({...values,revision:saved.revision,name:'Quiet corner'})).status,200,'Metadata editing remains available while paused');
  assert.equal((await post({action:'capture',revision:app.controls.pages('tradfri')[0].revision,name:'No reading',lightIds:['1']})).status,409);
  assert.equal(app.controls.runs.snapshot().runs.length,0);
});

test('Controller setup shows a one-phone enrollment code without exporting a profile',async()=>{
  const context=vm.createContext({state:{services:[{id:'google-apps-script',config:{revision:7}}],server:{lanAddress:'http://192.168.1.2:7041/'}},URL,Date,
    CloudRelayUI:{approval:{code:'ABC234',expiresAt:Date.now()+60000}},formatServerTimestamp:()=> 'soon',document:{addEventListener(){}},icon:()=>'',escapeHtml:String});
  vm.runInContext(await fs.readFile(new URL('../web/phone-home-ui.js',import.meta.url),'utf8')+'\nglobalThis.phone=PhoneHomeUI;',context);
  const html=context.phone.connection();
  assert.match(html,/data-action="cloud-phone-code" data-revision="7"/);assert.match(html,/>Connect a phone</);assert.match(html,/ABC234/);
  assert.doesNotMatch(html,/\.json|data-action="cloud-client-export"/);
});

test('lighting remote can capture a scene while stored-scene editing stays in administration',async()=>{
  const context=vm.createContext({ControlsRenderer:{escape:String,icon:()=>''}});
  vm.runInContext(await fs.readFile(new URL('../web/lighting-controls.js',import.meta.url),'utf8')+'\nglobalThis.lighting=LightingControls;',context);
  const lighting=context.lighting;lighting.tab='scenes';lighting.snapshot={page:{pluginName:'Lighting'},lighting:{lights:[],groups:[],scenes:[{id:'on',label:'Reading',enabled:true,available:true},{id:'off',label:'Hidden',enabled:false}]}};
  const html=lighting.render();assert.match(html,/Reading/);assert.match(html,/data-new-scene/);assert.match(html,/Save as scene/);assert.doesNotMatch(html,/Hidden|data-scene-operation|data-scene-enabled/);
  assert.match(html,/data-control-item="on"/);
});

test('Controls has one destination per tool and Controller setup prominently offers Task selection',async()=>{
  const context=vm.createContext({state:{services:[],controls:[],tasks:[],phoneHome:{tasks:[],revision:1},server:{lanAddress:null}},URL,
    document:{addEventListener(){}},icon:()=>'',escapeHtml:String,pageHeading:(name,description,actions='')=>name+description+actions});
  vm.runInContext(await fs.readFile(new URL('../web/controls-ui.js',import.meta.url),'utf8')+'\nglobalThis.controls=ControlsUI;',context);
  vm.runInContext(await fs.readFile(new URL('../web/phone-home-ui.js',import.meta.url),'utf8')+'\nglobalThis.phone=PhoneHomeUI;',context);
  const hub=context.controls.render();
  for(const view of ['lighting-scenes','lighting','control-pages','phone-home','vr-library'])assert.equal(hub.split('data-view="'+view+'"').length-1,1);
  assert.doesNotMatch(hub,/href=|Open Home|Phone home/);
  const setup=context.phone.render();assert.match(setup,/Controller setup/);assert.match(setup,/Choose Tasks/);assert.doesNotMatch(setup,/Open Home|personal to each phone|published by/);
});
