import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture(native=true,saved=null,storedLayout=null) {
  const listeners={},timers=new Map(),calls=[],nodes={},frames=[],attrs={},shows=[],storage=new Map([['localserve.playstation.server.v1',saved],['localserve.playstation.layout.v1',storedLayout]]);let timerId=0,exits=0;
  const context=vm.createContext({window:{addEventListener(name,fn){listeners[name]=fn;}},
    document:{hidden:false,documentElement:{setAttribute(key,value){attrs[key]=value;}},body:{appendChild(frame){frames.push(frame);frame.parentNode=this;}},
      getElementById(id){return nodes[id];},addEventListener(name,fn){listeners[name]=fn;},
      createElement(name){if(name==='a')return {set href(value){this.url=new URL(value);},get href(){return this.url.href;},get protocol(){return this.url.protocol;},get host(){return this.url.host;},get hostname(){return this.url.hostname;},get pathname(){return this.url.pathname;},get port(){return this.url.port;},get search(){return this.url.search;},get hash(){return this.url.hash;}};
        const frame={messages:[],setAttribute(){},focus(){},contentWindow:{postMessage(data,origin){frame.messages.push({data,origin});}}};return frame;}},
    localStorage:{getItem(key){return storage.get(key);},setItem(key,value){storage.set(key,value);}},
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
    tizen:{application:{getCurrentApplication(){return {exit(){exits++;}};}},...(native?{
      tvinputdevice:{getKey(name){return {code:{Info:457,ChannelUp:427,ChannelDown:428,MediaPlayPause:10252,MediaPlay:415,MediaPause:19}[name]};},registerKey(){}},
      systeminfo:{getPropertyValue(name,ok){calls.push('read');ok({connected:[{type:'HDMI',number:1}]});}},
      tvwindow:{setSource(source,ok){calls.push('source');ok();},show(ok,fail,...options){calls.push('show');shows.push(options);ok();},hide(ok){calls.push('hide');ok();}}
    }:{})}});
  for(const id of ['launcher','status','connection','protocol','host','port','layout','hud-style','hud-opacity','opacity-value','save','resume','exit'])nodes[id]={id,value:'',options:Array.from({length:id==='hud-style'?7:2}),selectedIndex:0,readOnly:true,blur(){context.document.activeElement=null;},hidden:id==='connection',focus(){context.document.activeElement=this;}};
  for(const file of ['url-target.js','hdmi.js','launch.js'])vm.runInContext(fs.readFileSync('tv-tizen/playstation/app/'+file,'utf8'),context);
  function flush(delay){for(const [id,timer] of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn();}}
  const f={nodes,calls,context,frames,flush,attrs,shows,storage,get exits(){return exits;},get saved(){return storage.get('localserve.playstation.server.v1');},
    key(code){listeners.keydown({keyCode:code});},hide(){context.document.hidden=true;listeners.visibilitychange();},
    show(){context.document.hidden=false;listeners.visibilitychange();flush(250);},
    state(connected=true,override={}){const frame=frames[0],probe=frame.messages.filter(m=>m.data.type==='localserve-ps-probe').at(-1).data;
      listeners.message({source:frame.contentWindow,origin:new URL(frame.src).origin,data:{type:'localserve-ps-state',...probe,connected,...override,type:override.type||'localserve-ps-state'}});},
    ready(){frames[0].onload();f.state();}};
  listeners.load();assert.equal(frames.length,0,'Remote frame cannot hold the native startup splash');flush(250);return f;
}
test('PlayStation launch waits for a scoped healthy page before selecting HDMI once',()=>{
  const f=fixture();assert.equal(new URL(f.frames[0].src).pathname,'/playstation-mode');assert.deepEqual(f.calls,[]);
  f.frames[0].onload();f.state(true,{id:'forged'});assert.deepEqual(f.calls,[]);
  f.state();assert.deepEqual(f.calls,['read','source','show']);f.state();assert.equal(f.calls.length,3);
  f.key(39);assert.equal(f.frames[0].messages.at(-1).data.type,'localserve-ps-key');
});
test('settings hides HDMI, keeps drafts on health recovery and explicit Return selects again',()=>{
  const f=fixture();f.ready();f.key(427);assert.equal(f.calls.at(-1),'hide');
  f.nodes.host.value='unsaved';f.state(false);f.state(true);assert.equal(f.nodes.host.value,'unsaved');
  assert.equal(f.nodes.connection.hidden,false);assert.equal(f.calls.filter(c=>c==='show').length,1);
  f.nodes.resume.onclick();assert.equal(f.nodes.launcher.hidden,true);assert.equal(f.calls.filter(c=>c==='show').length,2);
  f.key(10009);assert.equal(f.exits,1);
});
test('background, disconnect and silent health expiry hide HDMI and never retry it automatically',()=>{
  for(const action of ['background','disconnect','timeout']){
    const f=fixture();f.ready();
    if(action==='background'){f.hide();f.state();assert.equal(f.calls.at(-1),'hide');f.show();assert.equal(f.calls.filter(c=>c==='show').length,1);f.ready();assert.equal(f.calls.filter(c=>c==='show').length,2);}
    if(action==='disconnect'){f.state(false);f.state(true);assert.equal(f.calls.at(-1),'hide');}
    if(action==='timeout'){f.flush(9000);assert.equal(f.calls.at(-1),'hide');}
  }
});
test('only explicit validated server settings persist and the route stays fixed',()=>{
  const f=fixture();f.flush(20000);assert.equal(f.nodes.connection.hidden,false);
  f.nodes.protocol.value='http:';f.nodes.host.value='192.168.50.10';f.nodes.port.value='7041';
  f.nodes.connection.onsubmit({});assert.equal(f.saved,'http://192.168.50.10:7041/playstation-mode');
  assert.equal(f.frames[0].src,f.saved);
  assert.notEqual(fixture(true,'http://192.168.50.10:7041/admin').frames[0].src,'http://192.168.50.10:7041/admin');
  const unavailable=fixture(false);unavailable.ready();assert.match(unavailable.nodes.status.textContent,/installed Samsung/);
});

test('scoped HUD requests change only the fixed layout, persist after success and Info returns to split',()=>{
  const f=fixture();f.ready();
  const sources=f.calls.filter(c=>c==='source').length;
  f.state(true,{type:'localserve-ps-layout-request',layout:'hud',id:'forged'});assert.equal(f.shows.length,1);
  f.state(true,{type:'localserve-ps-layout-request',layout:'evil'});assert.equal(f.shows.length,1);
  f.state(true,{type:'localserve-ps-layout-request',layout:'hud'});
  assert.equal(JSON.stringify(f.shows.at(-1)),JSON.stringify([['0%','0%','100%','100%'],'MAIN','BEHIND']));
  assert.equal(f.attrs['data-layout'],'hud');assert.equal(f.storage.get('localserve.playstation.layout.v1'),'hud');
  assert.equal(f.frames[0].messages.filter(m=>m.data.type==='localserve-ps-layout').at(-1).data.layout,'hud');
  f.key(457);assert.equal(f.attrs['data-layout'],'split');assert.equal(f.calls.filter(c=>c==='source').length,sources);
  f.key(427);f.state(true,{type:'localserve-ps-layout-request',layout:'hud'});assert.equal(f.attrs['data-layout'],'split');
  f.nodes.layout.value='hud';f.nodes.resume.onclick();assert.equal(f.attrs['data-layout'],'hud');
});

test('saved layouts are allowlisted and optional Info support is not required to choose HUD in settings',()=>{
  const f=fixture(true,null,'hud');f.ready();assert.equal(f.attrs['data-layout'],'hud');
  const invalid=fixture(true,null,'invalid');invalid.ready();assert.equal(invalid.attrs['data-layout'],'split');
  const plain=fixture(false);plain.flush(20000);plain.nodes.layout.value='hud';plain.nodes.resume.onclick();
  assert.equal(plain.attrs['data-layout'],undefined,'No native success means no transparent layout');
});

test('Channel Down cycles seven persisted HUD arrangements without selecting HDMI again',()=>{
  const f=fixture();f.ready();const before=f.calls.filter(c=>c==='source').length;
  for(const style of ['top','right','bottom','left','ticker','none','edges']) {
    f.key(428);assert.equal(f.attrs['data-layout'],'hud');
    assert.equal(f.frames[0].messages.filter(m=>m.data.type==='localserve-ps-appearance').at(-1).data.style,style);
    assert.equal(JSON.parse(f.storage.get('localserve.playstation.hud.v1')).style,style);
  }
  assert.equal(f.calls.filter(c=>c==='source').length,before);
  f.key(427);f.nodes['hud-style'].value='ticker';f.nodes['hud-opacity'].value='35';f.nodes.resume.onclick();
  assert.equal(JSON.parse(f.storage.get('localserve.playstation.hud.v1')).opacity,35);
  f.state(true,{type:'localserve-ps-cycle',id:'forged'});
  assert.equal(JSON.parse(f.storage.get('localserve.playstation.hud.v1')).style,'ticker');
});

test('address focus stays read-only until OK and navigation locks it again',()=>{
  const f=fixture();f.flush(20000);assert.equal(f.context.document.activeElement,f.nodes.host);assert.equal(f.nodes.host.readOnly,true);
  f.key(13);assert.equal(f.nodes.host.readOnly,false);f.key(13);assert.equal(f.nodes.host.readOnly,true);
  f.key(13);f.key(40);assert.equal(f.nodes.host.readOnly,true);assert.equal(f.context.document.activeElement,f.nodes.port);
  f.nodes['hud-opacity'].focus();f.nodes['hud-opacity'].value='100';f.key(39);assert.equal(f.nodes['hud-opacity'].value,100);
  f.key(37);assert.equal(f.nodes['opacity-value'].textContent,'95%');
});
