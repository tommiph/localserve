/** End-user control-room checks use disposable stores and synthetic workers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {selectorFixture} from './fixtures/scene-selector.mjs';
import {publicReading,administrationInventory} from '../plugins/tradfri/server/readings.mjs';
import {selectedCardData} from '../server/cards.mjs';

async function fixture(t){
  const fixture=await selectorFixture({cardTemplates:true});t.after(()=>fixture.close());
  const record=fixture.app.registry.get('tradfri');
  const devices=[{instanceId:1,name:'Reading',type:2,alive:true,lightList:[{onOff:false,dimmer:0,spectrum:'white',colorTemperature:35}]}];
  const groups=[{instanceId:5,name:'Study',deviceIDs:[1,9],onOff:false,dimmer:0},{instanceId:6,name:'Shared',deviceIDs:[1],onOff:false,dimmer:0}];
  const inventory=administrationInventory(devices,groups);
  const reading=publicReading(inventory.lights,groups,Date.now());
  await record.state.update(value=>Object.assign(value,reading,{'gateway-host':record.config.snapshot().settings.host,'lighting-inventory':inventory,privateCredential:'never-publish'}));
  const get=()=>fetch(fixture.app.origin+'/api/control-room').then(r=>r.json());
  return {...fixture,record,get};
}

test('control room exposes published capabilities and bounded room membership without administrator data or effects',async t=>{
  const f=await fixture(t),before=f.app.controls.admin(),tasks=f.app.tasks.snapshot(),view=await f.get();
  assert.equal(view.scenes.length,6);assert.equal(view.tasks.length,3);assert.equal(view.remotes.length,1);assert.equal(view.cards.length,2);
  assert.equal(view.lighting[0].lights[0].brightness,0);assert.equal(view.lighting[0].lights[0].on,false);
  assert.deepEqual(view.lighting[0].groups.map(group=>group.memberIds),[['1'],['1']]);
  assert.equal(view.options.timeFormat,'24');assert.ok(Number.isFinite(view.options.now));
  assert.doesNotMatch(JSON.stringify(view),/privateCredential|never-publish|security-code|editToken|steps|parameters|credentials|pluginState/);
  assert.deepEqual(f.app.controls.admin(),before);assert.deepEqual(f.app.tasks.snapshot(),tasks);assert.equal(f.app.controls.runs.snapshot().runs.length,0);
  assert.equal((await fetch(f.app.origin+'/api/control-room?x=1')).status,405);assert.equal((await fetch(f.app.origin+'/api/control-room',{method:'POST'})).status,405);
  const html=await fetch(f.app.origin+'/control-room');assert.equal(html.status,200);assert.match(html.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.equal(html.headers.get('Referrer-Policy'),'no-referrer');
  const source=await html.text();for(const asset of ['control-room.js','control-room.css']){assert.match(source,new RegExp(asset.replace('.','\\.')));assert.equal((await fetch(f.app.origin+'/'+asset)).status,200);}
  const card=view.cards[0];assert.equal((await fetch(f.app.origin+'/api/phone-home/cards/'+[card.pluginId,card.templateId,card.sourceId].join('/'))).status,200);
});

test('display appearance is separate from administration and obsolete lighting readings disable new inline commands',async t=>{
  const f=await fixture(t);await f.app.config.update(value=>{value.theme='light';value.displayTheme='dark';value.fontScale=130;value.vistaFontScale=90;value.timeFormat='12';});
  let view=await f.get();assert.equal(view.options.theme,'dark');assert.equal(view.options.fontScale,90);assert.equal(view.options.timeFormat,'12');
  await f.record.state.update(value=>{value['received-at']=1;});view=await f.get();assert.equal(view.lighting[0].stale,true);assert.equal(view.lighting[0].available,false);
  f.app.engine.gate.setPaused(true);view=await f.get();assert.equal(view.paused,true);assert.ok(view.tasks.every(task=>!task.available));assert.ok(view.scenes.every(scene=>!scene.available));
});

test('only current enabled pages and published Tasks remain selectable after administration edits',async t=>{
  const f=await fixture(t);await f.app.phoneHome.save({revision:f.app.phoneHome.admin().revision,tasks:[]});
  const page=f.app.controls.pages('tradfri')[0];await f.app.controls.save('tradfri',{revision:page.revision,enabled:false},page.id,'enabled');
  const view=await f.get();assert.equal(view.tasks.length,0);assert.equal(view.scenes.length,0);assert.equal(view.remotes.length,0);assert.equal(view.lighting.length,0);
});

test('inline lighting and Task activation reuse existing capability, revision and durable claim guards',async t=>{
  const f=await fixture(t),view=await f.get(),remote=view.lighting[0],item=remote.lights[0].controls.power,requestId=randomUUID();
  const post=(token,revision=remote.revision)=>fetch(f.app.origin+'/api/control-view/tradfri/lights/run',{method:'POST',headers:{Origin:f.app.origin,'Content-Type':'application/json','X-Localserve-Control-Token':token},body:JSON.stringify({revision,itemId:item,value:true,requestId})});
  assert.equal((await post('bad')).status,403);assert.equal((await post(remote.token,remote.revision+1)).status,409);
  assert.equal((await post(remote.token)).status,202);assert.equal((await post(remote.token)).status,202);await f.app.controls.active.get('tradfri')?.done;
  assert.equal(f.app.controls.runs.snapshot().runs.filter(run=>run.id===requestId).length,1);
  const task=view.tasks[0],body={taskId:task.id,revision:task.revision,homeRevision:view.revision,expires:task.expires,requestId:randomUUID()};
  const reply=await fetch(f.app.origin+'/api/phone-home/run',{method:'POST',headers:{Origin:f.app.origin,'Content-Type':'application/json','X-Localserve-Home-Token':task.token},body:JSON.stringify(body)});
  assert.equal(reply.status,202);assert.ok((await reply.json()).token);
});

test('control room client uses scoped APIs, local presentation preferences and release-only controls',async()=>{
  const script=await fs.readFile(new URL('../web/control-room.js',import.meta.url),'utf8');
  assert.doesNotMatch(script,/\/api\/state|\/api\/admin-state|X-Localserve-Token|\/api\/lighting-room/);
  assert.match(script,/sormus\.control-room\.cards/);assert.match(script,/document\.hidden/);assert.match(script,/epoch!==generation/);
  assert.match(script,/addEventListener\('change'/);assert.match(script,/current\.uncertain=true/);assert.match(script,/reconcile\(/);
});

test('Card catalogues avoid reading state, activity and saved Cards; refreshes project only the selected plugin',async t=>{
  const f=await fixture(t),registry=f.app.registry;
  const config=f.record.config.snapshot();
  const forbidden=()=>{throw Error('Unrelated private store must not be read');};
  const other={...f.record,plugin:{...f.record.plugin,id:'other',name:'Other'},
    state:{snapshot:forbidden,queue:Promise.resolve()},log:{latest:forbidden,queue:Promise.resolve()},
    cards:{snapshot:forbidden,queue:Promise.resolve()}};
  // Both synthetic plugins are eligible designs. Only one plugin's actual
  // public readings are needed when its Card becomes visible.
  registry.plugins.push(other.plugin);registry.records.set('other',other);
  const state=f.record.state.snapshot,log=f.record.log.latest,cards=f.record.cards.snapshot;
  f.record.state.snapshot=forbidden;f.record.log.latest=forbidden;f.record.cards.snapshot=forbidden;
  const index=f.app.phoneHome.cardIndex();
  assert.equal(index.length,4);
  assert.ok(index.every(card=>card.available));
  assert.doesNotMatch(JSON.stringify(index),/privateCredential|never-publish|settings|bindings|pluginState/);
  assert.equal(registry.cardLibrary('unknown').length,0);
  f.record.state.snapshot=state;f.record.log.latest=log;
  registry.services=forbidden;
  const selected=index.find(card=>card.pluginId==='tradfri');
  const reply=await fetch(f.app.origin+'/api/phone-home/cards/'+[selected.pluginId,selected.templateId,selected.sourceId].join('/'));
  assert.equal(reply.status,200);
  assert.doesNotMatch(JSON.stringify(await reply.json()),/privateCredential|never-publish|settings|pluginState/);
  assert.deepEqual(f.record.config.snapshot(),config);
  assert.equal((await f.get()).cards.length,4,'Overview uses the same lightweight catalogue');
  f.record.cards.snapshot=cards;
});

test('scoped Card reads retain the existing public projection and reflect readiness, pause and disablement immediately',async t=>{
  const f=await fixture(t),registry=f.app.registry,home=f.app.phoneHome;
  const card=home.cardIndex()[0];
  const definition={name:card.name,layout:'readymade',templateId:card.templateId,sourceId:card.sourceId,fields:[]};
  const clock=t.mock.method(Date,'now',()=>1792929492000);
  for(const health of ['ready','error','loading','restart-required']){
    f.record.health=health;
    for(const paused of [false,true]){
      f.app.engine.gate.setPaused(paused);
      const service=registry.services().find(service=>service.id===card.pluginId);
      const expected=selectedCardData(definition,service.cardData,service.cardCatalog);
      const actual=home.card(card.pluginId,card.templateId,card.sourceId);
      assert.deepEqual(actual.catalog,expected.catalog);
      assert.deepEqual(actual.data,expected.data);
    }
  }
  clock.mock.restore();
  f.record.health='ready';f.app.engine.gate.setPaused(false);
  assert.throws(()=>home.card(card.pluginId,'missing',card.sourceId),/Card unavailable/);
  assert.throws(()=>home.card(card.pluginId,card.templateId,'missing'),/Card unavailable/);
  home.closing=true;
  assert.throws(()=>home.card(card.pluginId,card.templateId,card.sourceId),/Card unavailable/);
  home.closing=false;
  await registry.saveConfiguration('tradfri',{revision:f.record.config.snapshot().revision,enabled:false});
  assert.equal(home.cardIndex().length,0);
  assert.equal(registry.cardSource('tradfri'),null);
  assert.equal(registry.cardSource('missing'),null);
  assert.throws(()=>home.card(card.pluginId,card.templateId,card.sourceId),/Card unavailable/);
});
