/** Catalogue privacy and real durable admission are verified without devices. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {selectorFixture} from './fixtures/scene-selector.mjs';
async function fixture(t){const f=await selectorFixture();t.after(()=>f.close());return f;}
test('selector serves a scoped responsive page/manifest and publishes only enabled scenes and existing Task shortcuts',async t=>{
  const {app,page}=await fixture(t),read=async()=>fetch(app.origin+'/api/scene-selector').then(r=>r.json());
  const view=await read();assert.equal(view.scenes.length,6);assert.equal(view.tasks.length,3);
  assert.equal(view.scenes[0].icon,'sun');assert.equal(view.scenes[0].available,true);
  assert.doesNotMatch(JSON.stringify(view),/parameters|steps|gateway-host|password|apiKey|remotes|cards/);
  assert.equal(view.token,undefined);assert.equal(app.phoneHome.viewer().scenes,undefined);
  const html=await fetch(app.origin+'/scenes');assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.match(await html.text(),/selector-nav/);
  for(const asset of ['/scene-selector.js?v=1','/scene-selector.css?v=1'])assert.equal((await fetch(app.origin+asset)).status,200);
  const manifest=await fetch(app.origin+'/scenes/app.webmanifest').then(r=>r.json());assert.equal(manifest.start_url,'/scenes');assert.doesNotMatch(JSON.stringify(manifest),/token|parameters/);
  assert.equal(manifest.name,'Scenes');assert.equal(manifest.background_color,'#ffffff');
  for(const entry of manifest.icons){assert.match(entry.src,/^\/assets\/scenes\//);assert.equal((await fetch(app.origin+entry.src)).status,200);}
  assert.equal((await fetch(app.origin+'/api/scene-selector?token=x')).status,405);
  assert.equal((await fetch(app.origin+'/api/scene-selector',{method:'POST'})).status,405);
  const edited=structuredClone(page);edited.items[0].enabled=false;await app.controls.save('tradfri',edited,page.id);
  assert.equal((await read()).scenes.length,5);
  await app.phoneHome.save({revision:app.phoneHome.admin().revision,tasks:[]});assert.equal((await read()).tasks.length,0);
});
test('selector scene runs keep capability/revision/Origin guards and durable duplicate identities',async t=>{
  const {app,page}=await fixture(t);const view=app.phoneHome.viewer(true),scene=view.scenes[0],requestId=randomUUID();
  const body={revision:scene.revision,itemId:scene.id,requestId};
  const post=(data=body,token=scene.token,origin=app.origin)=>fetch(app.origin+'/api/control-view/tradfri/lights/run',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Localserve-Control-Token':token},body:JSON.stringify(data)});
  assert.equal((await post(body,scene.token,'https://foreign.example')).status,403);
  assert.equal((await post(body,'wrong')).status,403);
  assert.equal((await post()).status,202);assert.equal((await post()).status,202);
  await app.controls.active.get('tradfri')?.done;
  assert.equal(app.controls.runs.snapshot().runs.filter(r=>r.id===requestId).length,1);
  const run=app.controls.viewer('tradfri','lights').runs.find(r=>r.id===requestId);assert.equal(run.status,'completed');
  await app.controls.save('tradfri',{revision:page.revision,enabled:false},page.id,'enabled');
  assert.equal(app.phoneHome.viewer(true).scenes.length,0);
});
test('selector reflects pause/unavailable plugins without changing saved scene/Task definitions',async t=>{
  const {app}=await fixture(t);const before=structuredClone(app.controls.admin()),tasks=structuredClone(app.tasks.snapshot());
  app.engine.gate.setPaused(true);const paused=app.phoneHome.viewer(true);assert.equal(paused.paused,true);assert.ok(paused.scenes.every(s=>!s.available));assert.ok(paused.tasks.every(s=>!s.available));
  app.engine.gate.setPaused(false);const config=app.registry.records.get('tradfri').config.snapshot();await app.registry.saveConfiguration('tradfri',{revision:config.revision,enabled:false});
  assert.ok(app.phoneHome.viewer(true).scenes.every(s=>!s.available));assert.deepEqual(app.controls.admin(),before);assert.deepEqual(app.tasks.snapshot(),tasks);
});
