import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {sessionObservation} from '../plugins/playstation/server/index.mjs';
import {playstationDisplay} from '../server/playstation-display.mjs';
import {assertPublicPath} from '../tools/distribution/boundary.mjs';

const online={'online-status':'online',online:true,'active-game':'A'},offline={'online-status':'offline',online:false,'active-game':null};
test('session observations distinguish baseline, transitions, unknowns and long monitoring gaps',()=>{
  const first=sessionObservation({},online,1000,false);
  assert.equal(first.readings['session-started-at'],null);assert.equal(first.readings['session-observed-at'],1000);
  const start=sessionObservation({...offline,'received-at':1000},online,2000,true);
  assert.equal(start.activity.kind,'online');assert.equal(start.readings['session-started-at'],2000);
  const continuing=sessionObservation({...online,...start.readings,'received-at':2000},online,4000,true);
  assert.equal(continuing.readings['session-observed-at'],2000);
  const end=sessionObservation({...online,...start.readings,'received-at':4000},offline,9000,true);
  assert.equal(end.activity.kind,'offline');assert.equal(end.activity['session-seconds'],7);
  assert.equal(end.readings['session-started-at'],null);
  const gap=sessionObservation({...online,...start.readings,'received-at':2000},online,900000,true);
  assert.equal(gap.readings['session-started-at'],null);assert.equal(gap.readings['session-observed-at'],900000);
  const unknown=sessionObservation({...online,...start.readings,'received-at':2000},{online:null,'online-status':'away'},3000,true);
  assert.equal(unknown.readings['session-observed-at'],null);assert.equal(unknown.activity.kind,'presence');
  const changed=sessionObservation({...online,'received-at':2000},{...online,'active-game':'B'},3000,true);
  assert.equal(changed.activity.kind,'game');assert.equal(changed.activity['previous-game'],'A');
});

test('current-game local timer begins at observation, survives continuous polls and resets on game or monitoring changes',()=>{
  const playing={...online,'game-running':true,'title-id':'A',platform:'PS5'};
  const first=sessionObservation({},playing,1000,false);
  assert.equal(first.readings['game-session-started-at'],1000);
  const previous={...playing,...first.readings,'received-at':1000};
  assert.equal(sessionObservation(previous,playing,9000,true).readings['game-session-started-at'],1000);
  assert.equal(sessionObservation(previous,{...playing,'title-id':'B'},9000,true).readings['game-session-started-at'],9000);
  assert.equal(sessionObservation(previous,{...playing,'game-running':false},9000,true).readings['game-session-started-at'],null);
  assert.equal(sessionObservation(previous,{online:null},9000,true).readings['game-session-started-at'],null);
  assert.equal(sessionObservation(previous,playing,900000,true).readings['game-session-started-at'],900000);
  assert.equal(sessionObservation(previous,playing,9000,false).readings['game-session-started-at'],9000,'Another account cannot retain the clock');
  const fallback={...playing,'title-id':null};
  assert.equal(sessionObservation({...previous,'title-id':null},fallback,9000,true).readings['game-session-started-at'],1000);
  assert.equal(sessionObservation({...previous,'title-id':null},{...fallback,'active-game':'B'},9000,true).readings['game-session-started-at'],9000);
});

test('PlayStation display exposes only declared fields and sanitized bounded observation receipts',()=>{
  const fields=[{id:'game',label:'Game',type:'string',source:{kind:'state'}},{id:'private',type:'string',source:{kind:'setting'}}];
  const service={id:'playstation',enabled:true,cardFields:fields,config:{secret:'secret-token'},pluginState:{'account-id':'private-id'},
    cardData:{status:'Ready',values:{game:{available:true,type:'string',value:'A'},private:{available:true,value:'secret-token'}}},
    pluginActivity:[{at:1234,eventId:'session-activity',payload:{kind:'online',status:'online',game:'A','previous-game':'B','change-id':'private-cursor',token:'secret-token'}},
      {at:1233,eventId:'presence-changed',payload:{status:'online',game:'A','change-id':'private-cursor'}},
      {at:1200,message:'secret-token',payload:{token:'secret-token'}}],pollSeconds:60};
  const config={snapshot:()=>({timeFormat:'24',activityRetentionDays:30})};
  const dto=playstationDisplay({services:()=>[service]},config,2000);
  assert.equal(dto.values.game.value,'A');assert.equal(dto.activity.length,1);assert.equal(dto.activity[0].kind,'online');
  assert.doesNotMatch(JSON.stringify(dto),/secret-token|private-id|private-cursor|config|pluginState/);
  assert.deepEqual(dto.video.rectangle,['2%','2%','50%','50%']);
  service.enabled=false;const disabled=playstationDisplay({services:()=>[service]},config);
  assert.deepEqual(disabled.values,{});assert.deepEqual(disabled.activity,[]);
  assert.equal(playstationDisplay({services:()=>[]},config).status,'Unavailable');
});

async function hdmiFixture() {
  const calls=[],reports=[],api={tvwindow:{},systeminfo:{getPropertyValue(name,ok,fail){calls.push({name:'read',ok,fail});}}};
  for(const name of ['setSource','show','hide'])api.tvwindow[name]=(...args)=>{
    const source=name==='setSource'?args.shift():null;const [ok,fail,...options]=args;calls.push({name,source,ok,fail,options});
  };
  const context=vm.createContext({});vm.runInContext(await fs.readFile('tv-tizen/playstation/app/hdmi.js','utf8'),context);
  return {calls,reports,control:context.PlaystationHdmi.create(api,(...args)=>reports.push(args))};
}
test('native PlayStation mode selects only reported HDMI 1 and preserves the requested margins',async()=>{
  const f=await hdmiFixture();assert.equal(f.calls.length,0);f.control.open();
  f.calls.at(-1).ok({connected:[{type:'HDMI',number:2}],disconnected:[{type:'HDMI',number:1}]});
  assert.equal(f.calls.at(-1).source.number,1);f.calls.at(-1).ok();
  assert.equal(JSON.stringify(f.calls.at(-1).options),JSON.stringify([['2%','2%','50%','50%'],'MAIN','FRONT']));
  f.calls.at(-1).ok();f.control.hide();assert.equal(f.calls.at(-1).name,'hide');f.calls.at(-1).ok();
});
test('pending native discovery/source/show cannot restore HDMI after cancel',async()=>{
  for(const phase of ['read','source','show']){
    const f=await hdmiFixture();f.control.open();
    if(phase!=='read')f.calls.at(-1).ok({connected:[{type:'HDMI',number:1}]});
    if(phase==='show')f.calls.at(-1).ok();
    const request=f.calls.at(-1);f.control.hide();request.ok({connected:[{type:'HDMI',number:1}]});
    if(phase==='show'){assert.equal(f.calls.at(-1).name,'hide');f.calls.at(-1).ok();}
    else assert.equal(f.calls.at(-1),request);
    assert.equal(f.reports.length,0);
  }
});

test('native HUD resizes behind HTML without reselecting the source and cancels pending layout acknowledgements',async()=>{
  const f=await hdmiFixture();f.control.open('hud');f.calls.at(-1).ok({connected:[{type:'HDMI',number:1}]});f.calls.at(-1).ok();
  assert.equal(JSON.stringify(f.calls.at(-1).options),JSON.stringify([['0%','0%','100%','100%'],'MAIN','BEHIND']));
  assert.equal(f.reports.length,0);f.calls.at(-1).ok();assert.equal(f.reports.at(-1)[2],'hud');
  assert.equal(f.control.layout('invalid'),false);assert.equal(f.control.layout('split'),true);assert.equal(f.control.layout('hud'),false);
  assert.equal(JSON.stringify(f.calls.at(-1).options),JSON.stringify([['2%','2%','50%','50%'],'MAIN','FRONT']));
  const pending=f.calls.at(-1);f.control.hide();pending.ok();assert.equal(f.calls.at(-1).name,'hide');
  assert.equal(f.reports.length,1,'Canceled show must not acknowledge the new layout');f.calls.at(-1).ok();
  assert.equal(f.calls.filter(c=>c.name==='setSource').length,1);
});

test('a failed native layout hides the plane and never acknowledges or retries the failed mode',async()=>{
  const f=await hdmiFixture();f.control.open();f.calls.at(-1).ok({connected:[{type:'HDMI',number:1}]});f.calls.at(-1).ok();f.calls.at(-1).ok();
  f.control.layout('hud');f.calls.at(-1).fail({name:'SecurityError'});assert.equal(f.calls.at(-1).name,'hide');
  assert.equal(f.reports.at(-1)[1],true);assert.equal(f.reports.filter(r=>r[2]==='hud').length,0);f.calls.at(-1).ok();
  assert.equal(f.control.layout('hud'),false);
});
test('missing HDMI and native errors have no retry loop or alternate input fallback',async()=>{
  const f=await hdmiFixture();f.control.open();f.calls.at(-1).ok({connected:[{type:'HDMI',number:2}]});
  assert.equal(f.calls.length,1);assert.equal(f.reports.at(-1)[1],true);
  f.control.open();f.calls.at(-1).ok({connected:[{type:'HDMI',number:1}]});
  f.calls.at(-1).fail({name:'SecurityError'});assert.equal(f.calls.filter(c=>c.name==='show').length,0);
});

test('the reserved display bay contains the full native rectangle and leaves all information outside it',async()=>{
  const css=await fs.readFile('assets/playstation-mode/display.css','utf8');
  const bay=/\#video-bay\{[^}]*left:(\d+)px;top:(\d+)px;width:(\d+)px;height:(\d+)px/.exec(css).slice(1).map(Number);
  const pip={left:1920*.02,top:1080*.02,right:1920*.52,bottom:1080*.52};
  assert.ok(bay[0]<=pip.left&&bay[1]<=pip.top&&bay[0]+bay[2]>=pip.right&&bay[1]+bay[3]>=pip.bottom);
  for(const name of ['hero','activity','details','ticker']){
    const match=new RegExp('\\.'+name+'\\{[^}]*?left:(\\d+)px;top:(\\d+)px;width:(\\d+)px;height:(\\d+)px').exec(css);
    assert.ok(match,name);const [left,top,width,height]=match.slice(1).map(Number);
    assert.ok(left>=pip.right||top>=pip.bottom,name+' stays outside native video');
    assert.ok(left+width<=1920&&top+height<=1080,name+' fits screen');
  }
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(css,/var\(--|display:grid|backdrop-filter/);
  const config=await fs.readFile('tv-tizen/playstation/app/config.xml','utf8');
  assert.match(config,/LsPsMode01.PlaystationMode/);assert.doesNotMatch(config,/HwGlance01.HomeGlance/);
});
test('PlayStation signed outputs and signing records remain outside clean source packages',()=>{
  for(const file of ['tv-tizen/playstation/dist/verification.json','tv-tizen/playstation/dist/PlayStation.wgt','tv-tizen/playstation/app/author-signature.xml','tv-tizen/private/identity.p12'])assert.throws(()=>assertPublicPath(file));
  assert.doesNotThrow(()=>assertPublicPath('tv-tizen/playstation/app/icon.png'));
});

test('PlayStation launcher artwork is uniformly rendered at 16:9 with locally licensed static fonts',async()=>{
  const icon=await fs.readFile('assets/playstation-mode/icon.png');
  assert.equal(icon.readUInt32BE(16),512);assert.equal(icon.readUInt32BE(20),288);
  assert.deepEqual(icon,await fs.readFile('tv-tizen/playstation/app/icon.png'));
  for(const file of ['Rajdhani-Medium.ttf','Rajdhani-SemiBold.ttf','OFL.txt']){
    assert.deepEqual(await fs.readFile('assets/playstation-mode/fonts/'+file),await fs.readFile('tv-tizen/playstation/app/fonts/'+file));
  }
  const css=await fs.readFile('assets/playstation-mode/display.css','utf8');
  assert.match(css,/transform-style:preserve-3d/);assert.match(css,/@font-face/);
  assert.match(css,/html\[data-hidden="true"\]/);assert.doesNotMatch(css,/border-radius:(?:22|14|10|12|6)px/);
  assert.match(await fs.readFile('assets/playstation-mode/fonts/OFL.txt','utf8'),/SIL OPEN FONT LICENSE/);
});
