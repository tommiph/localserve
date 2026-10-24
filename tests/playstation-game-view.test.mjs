/** Current-game views use synthetic public snapshots and no physical devices. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {activeTrophyReadings} from '../plugins/playstation/server/index.mjs';
const counts=(bronze=0,silver=0,gold=0,platinum=0)=>({bronze,silver,gold,platinum});
test('current-game trophy summaries use exact IDs, preserve zero and bound duplicate sets',()=>{
  const set={npCommunicationId:'NPWR00001_00',earnedTrophies:counts(2,1),definedTrophies:counts(10,3,1,1),progress:17};
  const raw={titles:[{npTitleId:'OTHER',trophyTitles:[{...set,earnedTrophies:counts(99)}]},{npTitleId:'GAME',trophyTitles:[set,set]}]};
  const data=activeTrophyReadings(raw,'GAME',1234);
  assert.equal(data['active-trophies'],3);assert.equal(data['active-trophies-available'],15);
  assert.equal(data['active-platinum'],0);assert.equal(data['active-bronze'],2);assert.equal(data['active-trophy-progress'],17);assert.equal(data['active-trophies-received-at'],1234);
  assert.ok(Object.values(activeTrophyReadings(raw,'MISSING',1234)).every(v=>v===null));
  raw.titles[1].trophyTitles.push({...set,npCommunicationId:'NPWR00002_00'});
  const multi=activeTrophyReadings(raw,'GAME',1234);assert.equal(multi['active-trophies'],6);assert.equal(multi['active-trophy-progress'],null);
  raw.titles[1].trophyTitles[0].earnedTrophies={bronze:2};assert.equal(activeTrophyReadings(raw,'GAME',1234)['active-trophies'],null);
});
function snapshot(running=true) {
  const raw={'online':true,'game-running':running,'active-game':'Game A','active-game-display':running?'Game A':'Not playing',
    'active-trophies':34,'active-trophies-available':60,'active-trophy-progress':58,'active-platinum':0,'active-gold':4,'active-silver':12,'active-bronze':18,
    'active-play-hours':42.3,'active-play-count':17,'active-first-played':Date.now()-86400000,'active-last-played':Date.now(),'active-trophies-received-at':Date.now(),
    'received-at':Date.now(),'game-session-started-at':Date.now()-1800000,'title-id':'GAME-A','details-status':'Current','trophy-progress':66,'collections':[]};
  return {enabled:true,status:'Ready',values:Object.fromEntries(Object.entries(raw).map(([id,value])=>[id,{value,available:true}])),activity:[],
    catalog:[{id:'online',label:'Online',type:'boolean'}],options:{now:Date.now(),serverName:'Localserve',timeFormat:'24',pollSeconds:60,retentionDays:30}};
}
async function viewer(first,embedded=false) {
  const nodes=new Map(),listeners={},timers=new Map(),attrs={},messages=[];let data=first,timerId=0,clock=first.options.now,tick;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',className:'',style:{},setAttribute(){},removeAttribute(){}});return nodes.get(id);};
  const window={innerWidth:1920,innerHeight:1080,location:{origin:'http://local'},addEventListener(name,fn){listeners[name]=fn;}};window.parent=embedded?{postMessage(data){messages.push(data);}}:window;
  const context={window,document:{hidden:false,documentElement:{setAttribute(key,value){attrs[key]=value;}},getElementById:node,addEventListener(name,fn){listeners[name]=fn;}},
    XMLHttpRequest:class{open(){}abort(){}send(){this.status=200;this.responseText=JSON.stringify(data);this.onload();}},
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},setInterval(fn){tick=fn;},Date:class extends Date{static now(){return clock;}},Intl};
  vm.runInNewContext(await fs.readFile('assets/playstation-mode/display.js','utf8'),context);
  return {node,timers,attrs,messages,advance(ms){clock+=ms;tick();},message(data,override={}){listeners.message({source:window.parent,origin:'null',data,...override});},
    hidden(value){context.document.hidden=value;listeners.visibilitychange();},
    key(code){listeners.keydown({keyCode:code,preventDefault(){},stopPropagation(){}});},poll(next){data=next;const [id,timer]=[...timers].find(([,timer])=>timer.delay===5000);timers.delete(id);timer.fn();}};
}
test('a running game pins its trophy panel, ignores general carousel navigation and preserves zero grades',async()=>{
  const f=await viewer(snapshot());assert.equal(f.node('detail-title').textContent,'Game trophies');
  assert.equal(f.node('detail-eyebrow').textContent,'CURRENT GAME');assert.match(f.node('detail-content').innerHTML,/Game A|34/);
  assert.match(f.node('detail-content').innerHTML,/0<\/strong><span>platinum/);
  assert.ok(![...f.timers.values()].some(timer=>timer.delay===20000));
  f.key(39);assert.equal(f.node('detail-title').textContent,'Game trophies');
  const next=snapshot();next.values['active-game'].value='Game <B>';for(const [id,field] of Object.entries(next.values))if(id.startsWith('active-') && id!=='active-game' && id!=='active-game-display')field.available=false;
  f.poll(next);assert.match(f.node('detail-content').innerHTML,/Game &lt;B&gt;/);assert.doesNotMatch(f.node('detail-content').innerHTML,/42\.3|34<|Game A/);
  assert.equal(f.node('detail-status').textContent,'No trophy summary received for this game');
});
test('ending a game restores the general detail carousel and disabled data does not keep a game panel',async()=>{
  const f=await viewer(snapshot()),ended=snapshot(false);
  ended.catalog=Array.from({length:12},(_,i)=>({id:'field-'+i,label:'Field '+i,type:'number'}));
  f.poll(ended);assert.equal(f.node('detail-eyebrow').textContent,'PLAYER INTELLIGENCE');
  assert.match(f.node('detail-title').textContent,/Account telemetry/);
  assert.ok([...f.timers.values()].some(timer=>timer.delay===20000),'General carousel rotation resumes');
  const disabled=snapshot(false);disabled.enabled=false;disabled.values={};disabled.catalog=[];f.poll(disabled);
  assert.equal(f.node('detail-title').textContent,'PlayStation readings');assert.doesNotMatch(f.node('detail-content').innerHTML,/Game A|34/);
});

test('full-screen HUD shows only the current game, zero grades and the observed timer without resetting on switches',async()=>{
  const data=snapshot();data.values['game-session-started-at'].value=data.options.now-1800000;
  const f=await viewer(data);assert.equal(f.node('hud-timer').textContent,'30:00');
  f.key(72);assert.equal(f.attrs['data-layout'],'hud');assert.equal(f.node('hud-game').textContent,'Game A');
  assert.match(f.node('hud-grades').innerHTML,/0<\/strong><span>platinum/);assert.equal(f.node('hud-hours').textContent,'42.3');
  f.advance(1000);assert.equal(f.node('hud-timer').textContent,'30:01');f.key(72);assert.equal(f.node('hud-timer').textContent,'30:01');
  const ended=snapshot(false);f.poll(ended);assert.equal(f.node('hud-timer').textContent,'—');assert.equal(f.node('hud-hours').textContent,'—');
  assert.equal(f.node('hud-game').textContent,'Waiting for a game');assert.doesNotMatch(f.node('hud-grades').innerHTML,/34/);
});

test('embedded layout stays opaque until its current trusted native parent acknowledges the requested mode',async()=>{
  const f=await viewer(snapshot(),true),probe={type:'localserve-ps-probe',path:'/playstation-mode',id:'current',layouts:['split','hud'],layoutKey:457};
  assert.equal(f.node('layout-toggle').disabled,true);f.message(probe);assert.equal(f.node('layout-toggle').disabled,false);
  f.key(457);assert.equal(f.messages.at(-1).type,'localserve-ps-layout-request');assert.equal(f.attrs['data-layout'],'split');
  const ack={type:'localserve-ps-layout',path:'/playstation-mode',id:'current',layout:'hud',native:true};
  f.message({...ack,id:'old'});f.message(ack,{source:{}});f.message(ack,{origin:'https://other'});assert.equal(f.attrs['data-layout'],'split');
  f.message(ack);assert.equal(f.attrs['data-layout'],'hud');
  f.message({...probe,id:'old-widget',layouts:undefined});assert.equal(f.node('layout-toggle').disabled,true);assert.equal(f.attrs['data-layout'],'split');
  f.message({...ack,id:'old-widget'});assert.equal(f.attrs['data-layout'],'split');
});

test('PlayStation media keys pause UI motion, Channel Up requests settings and Back requests app return',async()=>{
 const f=await viewer(snapshot(),true);f.message({type:'localserve-ps-probe',path:'/playstation-mode',id:'current',remoteKeys:{settings:427,toggle:10252,play:415,pause:19}});
 f.key(19);assert.equal(f.attrs['data-motion'],'paused');f.key(19);assert.equal(f.attrs['data-motion'],'paused');
 f.key(415);assert.equal(f.attrs['data-motion'],'running');f.key(10252);assert.equal(f.attrs['data-motion'],'paused');
 f.key(427);assert.equal(f.messages.at(-1).type,'localserve-ps-settings');f.key(10009);assert.equal(f.messages.at(-1).type,'localserve-ps-back');
});

test('stale presence freezes the game clock at its last report and marks retained readings',async()=>{
  const data=snapshot();data.values['game-session-started-at'].value=data.options.now-1800000;data.values['received-at'].value=data.options.now;
  const f=await viewer(data);f.advance(60000);assert.equal(f.node('hud-timer').textContent,'31:00');
  f.advance(121000);assert.equal(f.node('hud-timer').textContent,'30:00');assert.match(f.node('hud-session-note').textContent,/Retained/);
});

test('HUD trophy toast requires a newer same-game summary and clears on hiding or game changes',async()=>{
  const first=snapshot(),f=await viewer(first);assert.equal(f.node('hud-toast').hidden,true);
  const next=structuredClone(first);next.values['active-trophies'].value=35;next.values['active-trophies-received-at'].value+=1;f.poll(next);
  assert.equal(f.node('hud-toast').hidden,false);assert.equal(f.node('hud-toast-text').textContent,'+1 trophies synced');
  f.advance(8001);assert.equal(f.node('hud-toast').hidden,true);
  next.values['active-trophies'].value=36;next.values['active-trophies-received-at'].value+=1;f.poll(next);assert.equal(f.node('hud-toast').hidden,false);
  f.hidden(true);assert.equal(f.node('hud-toast').hidden,true);f.hidden(false);
  next.values['title-id'].value='GAME-B';next.values['active-trophies'].value=40;next.values['active-trophies-received-at'].value+=1;f.poll(next);
  assert.equal(f.node('hud-toast').hidden,true);
});

test('HUD layout cycling and opacity keep the current session, escape ticker text and reject untrusted appearance',async()=>{
  const data=snapshot();data.values['active-game'].value='Game <script>';const f=await viewer(data);
  for(const style of ['top','right','bottom','left','ticker','none','edges']){f.key(76);assert.equal(f.attrs['data-hud-style'],style);assert.equal(f.attrs['data-layout'],'hud');}
  const line=f.node('hud-line-track').innerHTML;assert.match(line,/Game &lt;script&gt;/);assert.match(line,/42.3h/);assert.match(line,/platinum 0/);
  f.advance(1000);assert.equal(f.node('hud-line-time').textContent,'30:01');assert.equal(f.node('hud-line-track').innerHTML,line);
  const embedded=await viewer(data,true);embedded.message({type:'localserve-ps-probe',path:'/playstation-mode',id:'current',layouts:['split','hud'],appearance:true,remoteKeys:{cycle:428}});
  const appearance={type:'localserve-ps-appearance',path:'/playstation-mode',id:'current',style:'ticker',opacity:35};
  embedded.message({...appearance,id:'old'});assert.equal(embedded.attrs['data-hud-style'],'edges');
  embedded.message({...appearance,style:'arbitrary'});embedded.message({...appearance,opacity:-1});assert.equal(embedded.attrs['data-hud-style'],'edges');
  embedded.message(appearance);assert.equal(embedded.attrs['data-hud-style'],'ticker');assert.equal(embedded.node('game-hud').style.opacity,'0.35');
  embedded.key(428);assert.equal(embedded.messages.at(-1).type,'localserve-ps-cycle');
});

test('No HUD keeps full-screen layout and timer continuity, and cycles back to the visible Edges HUD',async()=>{
  const f=await viewer(snapshot());for(let i=0;i<6;i++)f.key(76);
  assert.equal(f.attrs['data-hud-style'],'none');assert.equal(f.attrs['data-layout'],'hud');
  assert.equal(f.node('hud-style-toggle').textContent,'No HUD');
  f.advance(1000);assert.equal(f.node('hud-timer').textContent,'30:01');
  f.key(76);assert.equal(f.attrs['data-hud-style'],'edges');assert.equal(f.attrs['data-layout'],'hud');
});

test('Resident Evil titles activate the franchise skin across numbered games, subtitles and Japanese branding',async()=>{
  const f=await viewer(snapshot());
  for(const name of ['RESIDENT EVIL 2','Resident Evil 4 Remake','Resident Evil Village','Resident Evil® Revelations 2','Resident-Evil 0','ResidentEvil7','BIOHAZARD RE:4','バイオハザード ヴィレッジ']) {
    const data=snapshot();data.values['active-game'].value=name;f.poll(data);
    assert.equal(f.attrs['data-game-theme'],'resident-evil',name);assert.equal(f.node('hud-link-label').textContent,'RESIDENT EVIL');
    assert.equal(f.attrs['data-layout'],'split','Automatic skin must not change the chosen video layout');
  }
  for(const name of ['Game A','Resident Evilish','Biohazardous','Evil Resident',null]) {
    const data=snapshot();data.values['active-game'].value=name;f.poll(data);
    assert.equal(f.attrs['data-game-theme'],'standard',String(name));assert.equal(f.node('hud-trophies-label').textContent,'TROPHY SYNC');
  }
});

test('automatic franchise styling preserves No HUD, opacity and game time, and clears when the game becomes unavailable',async()=>{
  const data=snapshot();data.values['active-game'].value='RESIDENT EVIL 2';const f=await viewer(data,true);
  f.message({type:'localserve-ps-probe',path:'/playstation-mode',id:'current',layouts:['split','hud'],appearance:true});
  f.message({type:'localserve-ps-layout',path:'/playstation-mode',id:'current',native:true,layout:'hud'});
  f.message({type:'localserve-ps-appearance',path:'/playstation-mode',id:'current',style:'none',opacity:35});
  f.poll(data);assert.equal(f.attrs['data-game-theme'],'resident-evil');assert.equal(f.attrs['data-hud-style'],'none');
  assert.equal(f.node('game-hud').style.opacity,'0.35');f.advance(1000);assert.equal(f.node('hud-timer').textContent,'30:01');
  for(const update of [next=>{next.values['game-running'].value=false;},next=>{next.values['active-game'].available=false;},next=>{next.enabled=false;}]) {
    const next=structuredClone(data);update(next);f.poll(next);assert.equal(f.attrs['data-game-theme'],'standard');
    assert.equal(f.attrs['data-hud-style'],'none');assert.equal(f.node('game-hud').style.opacity,'0.35');
  }
});
