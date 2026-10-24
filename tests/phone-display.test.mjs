/** Read-only projection and ES5 viewer fixtures. No phone or TV is contacted. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import vm from 'node:vm';
import {phoneDisplay} from '../server/phone-display.mjs';import {createLocalserve} from '../server.mjs';
import {localPagePath} from '../plugins/webpage/server/index.mjs';
import {fileURLToPath} from 'node:url';
test('phone display scopes public readings to an enabled device and preserves zero',()=>{
  const plugin={id:'sensors',enabled:true,instances:{setting:'devices'},config:{settings:{devices:[{id:'one',name:'Phone',enabled:true},{id:'two',name:'Other',enabled:true},{id:'off',name:'Disabled',enabled:false}]}},
    cardFields:[{id:'light',source:{kind:'state'}},{id:'event',source:{kind:'event'}}],cardData:{status:'Ready',values:{'one:light':{available:true,value:0},'two:light':{available:true,value:'OTHER'},'one:event':{available:true,value:'PRIVATE'}}},pluginState:{secret:'PRIVATE'}};
  const registry={services:()=>[plugin]},config={snapshot:()=>({timeFormat:'24',secret:'PRIVATE'})};
  const result=phoneDisplay(registry,config);assert.equal(result.values.light.value,0);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|OTHER|Disabled|pluginState|settings/);
  assert.throws(()=>phoneDisplay(registry,config,'off'),/unavailable/);
  plugin.enabled=false;assert.equal(phoneDisplay(registry,config).device,null);
  assert.deepEqual(phoneDisplay(registry,config).values,{});
});
test('fixed phone page is display-only and does not admit suffixes/private routes',()=>{
  assert.equal(localPagePath('/phone-information'),'/phone-information');
  for(const value of ['/phone-information?token=x','/phone-information/','/phone-information#x','/api/phone-information','http://192.168.1.2/phone-information'])assert.equal(localPagePath(value),null);
});
test('phone HTML/API use scoped read projection and packaged-TV framing without private files',async t=>{
  const base=new URL('./.tmp/',import.meta.url);await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(fileURLToPath(base),'phone-'));
  let app;t.after(async()=>{await app?.close();await fs.rm(root,{recursive:true,force:true});});
  await fs.mkdir(path.join(root,'web'));await fs.copyFile(new URL('../web/phone-information.html',import.meta.url),path.join(root,'web/phone-information.html'));
  app=await createLocalserve(root,{automatic:false});
  const page=await fetch(app.origin+'/phone-information');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'self' file:/);
  assert.doesNotMatch(page.headers.get('content-security-policy'),/unsafe-inline|unsafe-eval|allow-same-origin/);
  assert.match(page.headers.get('content-security-policy'),/img-src 'self' https:\/\/tile\.openstreetmap\.org;/);
  assert.match(page.headers.get('content-security-policy'),/connect-src 'self';/);
  assert.equal(page.headers.get('referrer-policy'),'origin');
  const response=await(await fetch(app.origin+'/api/phone-information')).json();assert.deepEqual(response.values,{});assert.equal(response.token,undefined);
  assert.equal((await fetch(app.origin+'/api/phone-information?device=unknown')).status,404);
  assert.equal((await fetch(app.origin+'/api/phone-information?url=http://x')).status,400);
  assert.equal((await fetch(app.origin+'/data/tasks.json')).status,404);
});

test('phone display media pause aborts only its viewer reads and resumes once without controlling the phone',async()=>{
 const nodes={},reads=[],events={};let pause,stops=0;
 const node=id=>nodes[id]||=( {style:{},focus(){},setAttribute(){},textContent:'',innerHTML:''});
 const context={document:{hidden:false,getElementById:node,addEventListener(name,fn){events[name]=fn;},body:{setAttribute(){}}},
  innerWidth:1920,innerHeight:1080,addEventListener(){},setTimeout(){return 1;},clearTimeout(){},setInterval(){},
  LocalserveTvViewer:{install(step,controls){pause=controls.pause;}},PhoneStreetMap:{stop(){stops++;}},Date,
  XMLHttpRequest:class{open(){}send(){reads.push(this);}abort(){this.aborted=true;}}};context.window=context;
 vm.runInNewContext(await fs.readFile(new URL('../assets/sensors/phone-information.js',import.meta.url),'utf8'),context);
 assert.equal(reads.length,1);pause('pause');assert.equal(reads[0].aborted,true);assert.ok(stops>0);
 events.visibilitychange();assert.equal(reads.length,1);pause('play');assert.equal(reads.length,2);
 pause('play');assert.equal(reads.length,2,'There is only one read in flight');
});
