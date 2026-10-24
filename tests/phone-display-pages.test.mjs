/** Volatile display state and remote-navigation checks; no phone/TV/provider. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import {PhoneDisplayCache} from '../server/phone-display.mjs';
test('callback display is latest-only, private-content free, scoped and generation-bound',()=>{
  const cache=new PhoneDisplayCache(),config={revision:1,enabled:true,settings:{devices:[{id:'one',enabled:true},{id:'two',enabled:true}],'offline-seconds':30}};
  const record={runtime:{},config:{snapshot:()=>structuredClone(config)}};
  const packet={deviceId:'one',sessionId:'first',phoneEvents:[{kind:'battery',timestampNanos:'20',fields:{percent:0,charging:false}},
    {kind:'notification',timestampNanos:'21',fields:{package:'app',title:'PRIVATE',text:'PRIVATE'}},
    {kind:'location',timestampNanos:'22',fields:{latitude:0,longitude:0,'accuracy-m':3}}]};
  cache.capture(packet,1000,record,null);
  assert.equal(cache.snapshot('one',record).battery.fields.percent,0);
  assert.equal(cache.snapshot('one',record).battery.fields.charging,false);
  assert.doesNotMatch(JSON.stringify(cache.snapshot('one',record)),/PRIVATE|timestampNanos|sessionId/);
  assert.deepEqual(cache.snapshot('two',record),{});
  const before=JSON.stringify(cache.snapshot('one',record));
  cache.capture({...packet,phoneEvents:[{kind:'battery',timestampNanos:'19',fields:{percent:99}}]},1100,record,{sessionId:'first',phoneClaims:{battery:'20'}});
  assert.equal(JSON.stringify(cache.snapshot('one',record)),before);
  const clone=cache.snapshot('one',record);clone.battery.fields.percent=99;assert.equal(cache.snapshot('one',record).battery.fields.percent,0);
  config.revision++;assert.deepEqual(cache.snapshot('one',record),{});
  cache.capture(packet,2000,record,null);record.runtime={};assert.deepEqual(cache.snapshot('one',record),{});
  cache.capture(packet,3000,record,null);cache.capture({...packet,phoneEvents:[],sessionId:'replacement'},4000,record,null);assert.deepEqual(cache.snapshot('one',record),{});
  cache.capture(packet,5000,record,null);config.settings.devices[0].enabled=false;assert.deepEqual(cache.snapshot('one',record),{});
});
test('full-screen remote pages and phone changes stay isolated, inert and compatible',async()=>{
  const nodes={},listeners={},reads=[],timers=new Map();
  const element=()=>({style:{},innerHTML:'',textContent:'',focus(){},setAttribute(){}});
  const document={hidden:false,body:element(),getElementById:id=>nodes[id]||(nodes[id]=element()),addEventListener:(k,v)=>listeners[k]=v};
  const mapCalls=[];
  const context={document,Date,PhoneStreetMap:{stop(){mapCalls.push('stop');},layout:fix=>fix?{}:null,draw:(canvas,fix,allow)=>mapCalls.push({fix,allow})},innerWidth:1920,innerHeight:1080,addEventListener:(k,v)=>listeners[k]=v,setTimeout:fn=>{timers.set(1,fn);return 1;},clearTimeout:id=>timers.delete(id),setInterval(){},
    XMLHttpRequest:class{open(method,url){this.url=url;}send(){reads.push(this);}abort(){this.aborted=true;}}};context.window=context;
  vm.runInNewContext(await fs.readFile(new URL('../assets/sensors/phone-information.js',import.meta.url),'utf8'),context);
  const values={online:{available:true,value:true},'ambient-light':{available:true,value:0},'sensors-1':{available:true,value:[{name:'Raw <sensor>',values:'0, -1, 2',unit:'m/s²',accuracy:0,age:0,status:'Streaming'}]}};
  const data={device:{id:'one',name:'First'},devices:[{id:'one',name:'First'},{id:'two',name:'Second'}],values,phone:{battery:{receivedAt:Date.now(),fields:{percent:0,charging:false}}},status:'Ready',options:{now:Date.now(),timeFormat:'24'}};
  function deliver(value){const xhr=reads.at(-1);xhr.status=200;xhr.responseText=JSON.stringify(value);xhr.onload();}
  function press(code){listeners.keydown({keyCode:code,preventDefault(){}});}
  deliver(data);assert.equal(nodes['page-name'].textContent,'Motion & environment');assert.match(nodes.content.innerHTML,/>0</);
  press(39);assert.equal(nodes['page-name'].textContent,'Power & connections');assert.match(nodes.content.innerHTML,/Battery/);assert.match(nodes.content.innerHTML,/>0</);
  press(39);assert.equal(nodes['page-name'].textContent,'Phone activity');
  press(39);assert.equal(nodes['page-name'].textContent,'Location');assert.equal(reads.at(-1).url,'/assets/sensors/map/world.json');assert.match(nodes.content.innerHTML,/No reported GPS fix/);
  const beforeStreet=reads.length;press(39);assert.equal(nodes['page-name'].textContent,'Location · Streets · 300 m');assert.match(nodes.content.innerHTML,/OpenStreetMap contributors/);assert.match(nodes.content.innerHTML,/No reported GPS fix/);assert.equal(mapCalls.at(-1).fix,null);assert.equal(reads.length,beforeStreet);
  press(39);assert.equal(nodes['page-name'].textContent,'Phone event details');press(39);assert.equal(nodes['page-name'].textContent,'Sensor readings');assert.match(nodes.content.innerHTML,/Raw &lt;sensor&gt;/);
  press(40);assert.match(reads.at(-1).url,/device=two/);assert.equal(nodes['device-name'].textContent,'Loading phone…');assert.doesNotMatch(nodes.content.innerHTML,/Raw/);
  deliver({...data,device:{id:'two',name:'Second'},phone:{},values:{}});assert.equal(nodes['device-name'].textContent,'Second');assert.equal(nodes['page-name'].textContent,'Motion & environment');
  press(38);assert.match(reads.at(-1).url,/device=one/);document.hidden=true;listeners.visibilitychange();assert.equal(timers.size,0);assert.equal(reads.at(-1).aborted,true);
  const css=await fs.readFile(new URL('../assets/sensors/phone-information.css',import.meta.url),'utf8'),html=await fs.readFile(new URL('../web/phone-information.html',import.meta.url),'utf8');
  assert.doesNotMatch(css,/var\(|:has\(|display:\s*grid|\bgap\s*:|aspect-ratio/);assert.match(css,/-webkit-flex/);assert.doesNotMatch(html,/<button|<select/);
  assert.match(html,/phone-street-map\.js\?v=1/);assert.match(html,/phone-information\.js\?v=5/);
});
test('offline map plots zero coordinates without contacting a provider',async()=>{
  let mark;const ctx={fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},closePath(){},fill(){},fillText(){},arc(x,y){mark=[x,y];}};
  const context={};vm.runInNewContext(await fs.readFile(new URL('../assets/sensors/phone-map.js',import.meta.url),'utf8'),context);
  context.PhoneMap.draw({width:1824,height:620,getContext:()=>ctx},[],{latitude:0,longitude:0},'Phone');assert.deepEqual(mark,[912,310]);
  const world=JSON.parse(await fs.readFile(new URL('../assets/sensors/map/world.json',import.meta.url),'utf8'));assert.equal(world.length,177);
});
