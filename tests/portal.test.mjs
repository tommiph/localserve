import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {portalView,portalLink,watchGuideView,embyLibraryLink} from '../server/portal.mjs';
import {portalBriefing} from '../server/portal-briefing.mjs';
import fs from 'node:fs/promises';import vm from 'node:vm';
import path from 'node:path';import {createLocalserve} from '../server.mjs';
test('portal keeps only enabled current topic headlines and safe original links',()=>{
  const topic={id:'science',name:'Science',provider:'science',include:'',exclude:'','age-days':7,enabled:true};
  const identity=createHash('sha256').update(JSON.stringify([topic.provider,topic.include,topic.exclude,topic['age-days']])).digest('hex');
  const config={enabled:true,settings:{'tmdb-token':'PRIVATE',topics:[topic,{...topic,id:'hidden',enabled:false}]}};
  const reading={identity,'poll-status':'Ready','received-at':100,items:[{title:'Headline',summary:'Text',url:'https://example.org/story',source:'Publisher',publishedAt:90},{title:'Bad',url:'javascript:alert(1)'},{title:'Duplicate',url:'https://example.org/story'}]};
  const registry={get:id=>{if(id!=='interests')throw Error();return {health:'ready',config:{snapshot:()=>config},state:{snapshot:()=>({topics:{science:reading,hidden:reading},credentials:'PRIVATE'})}};}};
  const result=portalView(registry,{viewer:()=>{throw Error();}},{name:'Sormus',theme:'dark',fontScale:100},110);
  assert.equal(result.articles.length,1);assert.equal(result.articles[0].cached,false);assert.equal(result.sources.length,1);assert.equal(result.briefing,null);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  reading.identity='old';assert.equal(portalView(registry,{viewer:()=>null},{},110).articles.length,0);
  config.enabled=false;assert.equal(portalView(registry,{viewer:()=>null},{},110).sources.length,0);
});
test('watch guide copies public suggestion fields only, rejecting unsafe links and departed episodes',()=>{
  const data={status:'Ready',values:{'pick-1-title':{available:true,value:'Suggested show'},'pick-1-url':{available:true,value:'https://www.tvmaze.com/shows/1'},'pick-1-summary':{available:true,value:'Summary'},'pick-2-title':{available:true,value:'Bad'},'pick-2-url':{available:true,value:'javascript:alert(1)'},'api-token':{available:true,value:'PRIVATE'},upcoming:{available:true,value:[{show:'Old',at:1},{show:'Next',title:'Episode',at:500}]}}};
  const view=watchGuideView({cardSource:id=>id==='tv-calendar'?{cardData:data}:null},{name:'Server',theme:'dark'},100);
  assert.equal(view.tv.picks.length,1);assert.equal(view.tv.episodes.length,1);assert.equal(view.tv.episodes[0].show,'Next');assert.equal(view.movies.picks.length,0);assert.doesNotMatch(JSON.stringify(view),/PRIVATE|api-token|javascript/);
});

const at=Date.parse('2026-10-27T12:00:00Z');

test('daily watch Cards in Today retain suggestion labels instead of becoming episode listings',()=>{
  const cards=['tv-calendar','movies'].map(pluginId=>({pluginId,cardId:pluginId,card:{layout:'readymade',templateId:pluginId==='movies'?'daily-movies':'daily-tv',name:'Suggestions'},catalog:[],data:{status:'Ready',readyMade:{bindings:{title:'pick-1-title',year:'pick-1-year',genre:'pick-1-genres','pick-2-title':'pick-2-title'}},values:{'pick-1-title':{available:true,value:'Chosen title'},'pick-1-year':{available:true,value:'2026'},'pick-1-genres':{available:true,value:'Drama'},'pick-2-title':{available:true,value:'Second title'}}}}));
  const panels=portalBriefing({cards,options:{}},at);assert.equal(panels[0].title,'TV suggestions');assert.equal(panels[1].title,'Movie suggestions');
  for(const panel of panels){assert.equal(panel.primary,'Chosen title');assert.match(panel.secondary,/2026.*Drama/);assert.equal(panel.details[0].value,'Second title');}
});

test('Emby watch links allow only token-free private web item pages and keep metadata in its own section',()=>{
 const url='http://10.23.42.8:8096/web/index.html#!/item?id=12';assert.equal(embyLibraryLink(url),url);
 for(const value of ['http://8.8.8.8/web/index.html#!/item?id=12','http://user:secret@10.0.0.1/web/index.html#!/item?id=12','http://10.0.0.1/emby/Items?api_key=SECRET','javascript:alert(1)','http://10.0.0.1/web/index.html?api_key=SECRET#!/item?id=12'])assert.equal(embyLibraryLink(value),null);
 const registry={cardSource:id=>id==='emby'?{cardData:{status:'Ready',values:Object.fromEntries(Object.entries({'pick-1-title':'Owned movie','pick-1-url':url,'pick-1-source':'Emby library','library-note':'Watched status is not filtered.'}).map(([key,value])=>[key,{available:true,value}]))}}:null};
 const guide=watchGuideView(registry,{},100);assert.equal(guide.emby.picks.length,1);assert.equal(guide.emby.picks[0].source,'Emby library');assert.equal(guide.movies.picks.length,0);assert.doesNotMatch(JSON.stringify(guide),/api-key|UserId|Path/);
});
function displayCard(pluginId,values,templateId='main'){
  return {pluginId,cardId:'card-'+pluginId,card:{name:'Selected Card',layout:'readymade',templateId},catalog:Object.keys(values).map(id=>({id,label:'Technical '+id})),data:{status:'Ready',readyMade:{bindings:Object.fromEntries(Object.keys(values).map(id=>[id,id]))},values:Object.fromEntries(Object.entries(values).map(([id,value])=>[id,{available:true,type:Array.isArray(value)?'table':typeof value,value}]))}};
}
test('daily panels prioritize readable weather, future train, TV episodes and lighting values',()=>{
  const cards=[displayCard('weather',{temperature:11,feels:8,condition:'Cloudy',area:'Town',wind:12,received:at}),displayCard('hsl-trains',{station:'Central',trains:[{train:'Old',time:at-120000},{train:'Cancelled',time:at+30000,status:'Cancelled'},{train:'K',route:'To city',time:at+600000,track:'2'}],received:at}),displayCard('tv-calendar',{list:[{show:'Aired',title:'Old',at:at-10000},{show:'Series',title:'New episode',at:at+3600000}],received:at,status:'Ready'},'tonight-television'),displayCard('tradfri',{on:5,received:at})];
  const panels=portalBriefing({cards,options:{timeZone:'UTC',timeFormat:'24',daylight:{sunrise:at-3600000,sunset:at+4*3600000}}},at);
  assert.equal(panels[0].primary,'11°C');assert.equal(panels[0].secondary,'Cloudy · Town');assert.equal(panels[0].details[0].value,'8°C');
  assert.equal(panels[1].primary,'K · To city');assert.match(panels[1].secondary,/12[:.]10 · in 10 min/);assert.equal(panels[1].details[0].value,'2');
  assert.equal(panels[2].title,'Daylight');assert.match(panels[2].primary,/Sunset 16[:.]00/);
  assert.equal(panels[3].primary,'Series');assert.match(panels[3].secondary,/New episode · 13[:.]00/);assert.equal(panels[4].primary,'5 lights on');
  assert.doesNotMatch(JSON.stringify(panels),/Technical|Cancelled|Aired/);
});
test('daily panels keep empty/unavailable/cached/after-sunset states explicit and respect 12-hour time',()=>{
  const cards=[displayCard('hsl-trains',{'next-time':at-60000,received:at-900000}),displayCard('tv-calendar',{list:[]},'tonight-television'),displayCard('tradfri',{on:0,received:at-300000})];
  const panels=portalBriefing({cards,options:{timeZone:'UTC',timeFormat:'12',daylight:{sunrise:at-7200000,sunset:at-3600000}}},at);
  assert.equal(panels[0].primary,'No upcoming departures');assert.equal(panels[0].cached,true);assert.equal(panels[2].primary,'After sunset');assert.match(panels[2].details[1].value,/11[:.]00.*AM/i);
  assert.equal(panels[1].primary,'No episodes listed tonight');assert.equal(panels[3].primary,'0 lights on');assert.equal(panels[3].cached,true);
  assert.deepEqual(portalBriefing(null,at),[]);assert.deepEqual(portalBriefing({cards:[],options:{daylight:{sunrise:null,sunset:null}}},at),[]);
});
async function model(){const context={URLSearchParams};vm.createContext(context);vm.runInContext(await fs.readFile('web/portal-model.js','utf8'),context);return context.PortalModel;}
test('front page balances topics while topic/search/publisher routes retain exact selections',async()=>{
  const ui=await model(),articles=[{id:'a',topic:'Space',title:'Rocket',source:'One',publishedAt:30},{id:'b',topic:'Space',title:'Orbit',source:'Two',publishedAt:29},{id:'c',topic:'Science',title:'Ocean',source:'One',publishedAt:20},{id:'d',topic:'Tech',title:'Chip',source:'Three',publishedAt:null}];
  assert.equal(ui.frontPage(articles).map(row=>row.topic).join(','),'Space,Science,Tech,Space');
  const route={topic:'Science & Tech',fresh:true,query:'a + b',source:'Publisher/One'};assert.deepEqual({...ui.route(ui.queryString(route))},route);
  assert.equal(ui.selection(articles,{topic:'Space',query:'ORBIT',source:'Two'},new Set()).map(row=>row.id).join(','),'b');
  assert.equal(ui.selection(articles,{fresh:true},new Set(['c'])).map(row=>row.id).join(','),'c');
});
test('new-story tracking uses bounded hashed IDs, keeps a visit baseline and supports marking the edition seen',async()=>{
  const ui=await model();let saved=null;const storage={getItem:()=>saved,setItem:(key,value)=>{saved=value;}};
  const article=id=>({id:String(id).padStart(32,'0'),url:'https://private.example/'+id,title:'Private headline'}),first=ui.visits(storage);
  first.record([article(1)],10);assert.equal(first.fresh([article(1)]).size,0);
  const next=ui.visits(storage);next.record([article(1),article(2)],20);assert.equal(next.fresh([article(1),article(2)]).size,1);assert.equal(next.previousAt,10);
  next.markSeen([article(1),article(2)],20);assert.equal(next.fresh([article(1),article(2)]).size,0);
  next.record(Array.from({length:700},(_,i)=>article(i)),30);assert.equal(JSON.parse(saved).ids.length,500);assert.doesNotMatch(saved,/https:|Private headline/);
});
test('unavailable or malformed browser storage cannot break the edition',async()=>{
  const ui=await model(),blocked=ui.visits({getItem:()=>{throw Error();},setItem:()=>{throw Error();}});blocked.record([],10);assert.equal(blocked.available,false);assert.equal(blocked.fresh([]).size,0);
  let saved;const damaged=ui.visits({getItem:()=>'{broken',setItem:(key,value)=>{saved=value;}});damaged.record([],1);assert.equal(damaged.available,true);assert.equal(JSON.parse(saved).schemaVersion,1);
});
test('daily countdowns use server-relative time and disclose elapsed departures',async()=>{
  const ui=await model(),value={at:at+600000,prefix:'12:10',expired:'Departure time passed — refresh edition'};
  assert.equal(ui.countdown(value,at),'12:10 · in 10 min');assert.match(ui.countdown(value,at+720000),/Departure time passed/);assert.equal(ui.countdown({at:at+7200000},at),'in 2h 0m');assert.equal(ui.countdown({},at),'');
});
test('portal labels cached content and never exposes credentials in links',()=>{
  assert.equal(portalLink('https://user:password@example.org'),null);assert.equal(portalLink('http://example.org'),null);assert.equal(portalLink('file:///private'),null);
  const config={enabled:true,settings:{searches:[{id:'a',name:'News',query:'current',enabled:true}]}};
  const registry={get:id=>{if(id!=='news')throw Error();return {health:'error',config:{snapshot:()=>config},state:{snapshot:()=>({searches:{a:{'requested-query':'current','updated-at':1,'article-1-title':'Hello','article-1-link':'https://example.org','article-1-publisher':'Source'}}})}};}};
  const result=portalView(registry,{viewer:()=>({cards:[]})},{name:'Sormus'},90000000);assert.equal(result.articles[0].cached,true);assert.deepEqual(result.briefing,{cards:[]});
  config.settings.searches[0].query='changed';assert.equal(portalView(registry,{viewer:()=>null},{},1).articles.length,0);
});

test('portal topic URLs and client dependencies are served with a read-only public API',async t=>{
  const base=path.resolve('tests/.tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'portal-'));
  await fs.mkdir(path.join(root,'web'));
  for(const file of ['portal.html','portal.js','portal-model.js','portal.css','watch.html','watch.js','watch.css'])await fs.copyFile('web/'+file,path.join(root,'web',file));
  const app=await createLocalserve(root,{automatic:false,listen:{host:'127.0.0.1',port:0}});
  t.after(async()=>{await app.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  const page=await fetch(app.origin+'/portal?topic=Science');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);assert.match(await page.text(),/portal-model.js/);
  for(const file of ['portal.js','portal-model.js','portal.css'])assert.equal((await fetch(app.origin+'/'+file)).status,200);
  const response=await fetch(app.origin+'/api/portal');assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.articles,[]);assert.deepEqual(data.day,[]);assert.doesNotMatch(JSON.stringify(data),/token|password|latitude|longitude/);
  assert.equal((await fetch(app.origin+'/api/portal?query=private')).status,405);assert.equal((await fetch(app.origin+'/api/portal',{method:'POST'})).status,405);
  assert.equal((await fetch(app.origin+'/watch')).status,200);assert.equal((await fetch(app.origin+'/watch.js')).status,200);assert.equal((await fetch(app.origin+'/watch.css')).status,200);
  const guide=await fetch(app.origin+'/api/watch-guide').then(response=>response.json());assert.deepEqual(guide.tv.picks,[]);assert.deepEqual(guide.movies.picks,[]);assert.equal((await fetch(app.origin+'/api/watch-guide?token=x')).status,405);assert.equal((await fetch(app.origin+'/api/watch-guide',{method:'POST'})).status,405);
});
