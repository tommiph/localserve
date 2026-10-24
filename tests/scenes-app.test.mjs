/** Controller grants are scoped to administrator-approved clients on the LAN. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {CloudRelay} from '../server/cloud-relay.mjs';
import {selectorFixture} from './fixtures/scene-selector.mjs';
const phone='android-11111111-1111-4111-8111-111111111111';
function host(enabled=true){
  const relay=Object.create(CloudRelay.prototype),settings={url:'https://script.google.com/macros/s/abcdefghijklmnopqrst/exec','report-seconds':120,clients:[
    {'client-id':'scenes',enabled:true,scenes:true,sensors:false,key:'a'.repeat(64),'device-id':''},
    {'client-id':'my-phone',enabled:true,scenes:false,sensors:true,key:'b'.repeat(64),'device-id':phone},
    {'client-id':'other-phone',enabled:true,scenes:false,sensors:true,key:'c'.repeat(64),'device-id':'android-22222222-2222-4222-8222-222222222222'},
  ]};
  relay.registry={records:new Map([['google-apps-script',{config:{snapshot:()=>({enabled,settings})}}]])};return {relay,settings};
}
test('Controller obtains existing grants without exposing another phone or collector credentials',()=>{
  const {relay,settings}=host(),before=structuredClone(settings),value=relay.controller({deviceId:phone});
  assert.equal(value.scenes.clientId,'scenes');assert.equal(value.sensors.clientId,'my-phone');assert.equal(value.sensors.deviceId,phone);
  assert.equal(value.sensors.reportIntervalMs,120000);assert.doesNotMatch(JSON.stringify(value),/other-phone|collector/);assert.deepEqual(settings,before);
});
test('Controller never enables remote access or substitutes a different sensor client',()=>{
  assert.equal(host(false).relay.controller({deviceId:phone}).scenes,null);
  const {relay,settings}=host();settings.clients[1].enabled=false;assert.equal(relay.controller({deviceId:phone}).sensors,null);
  settings.clients[0].enabled=false;assert.equal(relay.controller({deviceId:phone}).scenes,null);
  settings.url='http://outside.example/profile';assert.equal(relay.controller({deviceId:phone}).sensors,null);
  assert.throws(()=>relay.controller({deviceId:phone,clientId:'other-phone'}));assert.throws(()=>relay.controller({deviceId:'other-phone'}));
});
test('Controller native connection rejects browser and foreign-origin credential export',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());const url=f.app.origin+'/api/controller/connection';
  const options={method:'POST',headers:{'Content-Type':'application/json','X-Localserve-Controller':'1'},body:JSON.stringify({deviceId:phone})};
  assert.equal((await fetch(url)).status,403);
  assert.equal((await fetch(url,{...options,headers:{...options.headers,Origin:f.app.origin}})).status,403);
  assert.equal((await fetch(url,{...options,headers:{...options.headers,Origin:'https://foreign.example'}})).status,403);
  const response=await fetch(url,options);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).scenes,null);
  assert.equal((await fetch(url+'?deviceId=x',options)).status,403);
  const download=await fetch(f.app.origin+'/downloads/scenes.apk',{redirect:'manual'});assert.equal(download.status,307);assert.equal(download.headers.get('location'),'/downloads/controller.apk');
});

test('administrator issues an ephemeral code and native approval leaves disabled relay and reporting untouched',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());const folder=path.join(f.root,'plugins/google-apps-script');await fs.mkdir(path.join(folder,'server'),{recursive:true});
  const declaration=JSON.parse(await fs.readFile(new URL('../plugins/google-apps-script/declaration.json',import.meta.url),'utf8'));declaration.runtime.entry='server/fixture.mjs';
  await fs.writeFile(path.join(folder,'declaration.json'),JSON.stringify(declaration));await fs.writeFile(path.join(folder,'server/fixture.mjs'),'export default {async validateConfiguration(){return true;},async start(){},async stop(){}};');await f.app.registry.discover();
  const config=f.app.registry.get('google-apps-script').config.snapshot(),before=structuredClone(config),values={revision:config.revision,operation:'phone-code'};
  const headers={'Content-Type':'application/json',Origin:f.app.origin,'X-Localserve-Token':f.app.snapshot().token};
  const post=extra=>fetch(f.app.origin+'/api/cloud-relay/setup',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(values)});
  assert.equal((await post({Origin:'https://foreign.example'})).status,403);
  const response=await post({});assert.equal(response.status,200);const issued=await response.json();assert.match(issued.code,/^[A-Z2-9]{6}$/);
  assert.ok(!JSON.stringify(f.app.snapshot()).includes(issued.code));
  const native=body=>fetch(f.app.origin+'/api/controller/connection',{method:'POST',headers:{'Content-Type':'application/json','X-Localserve-Controller':'1'},body:JSON.stringify(body)});
  assert.equal((await (await native({version:2,deviceId:phone})).json()).approvalRequired,true);
  const paired=await (await native({version:2,deviceId:phone,name:'Example phone',code:issued.code})).json();assert.equal(paired.approved,true);assert.equal(paired.scenes,null);assert.equal(paired.sensors,null);
  assert.ok(!JSON.stringify(f.app.snapshot()).includes(paired.approvalToken));assert.deepEqual(f.app.registry.get('google-apps-script').config.snapshot(),before);
  assert.equal(f.app.registry.records.has('sensors'),false);
  const blocked=await fetch(f.app.origin+'/api/controller/connection',{method:'POST',headers:{'Content-Type':'application/json','X-Localserve-Controller':'1','Sec-Fetch-Site':'same-origin'},body:JSON.stringify({version:2,deviceId:phone})});assert.equal(blocked.status,403);
});
