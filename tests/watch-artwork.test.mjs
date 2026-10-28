/** Artwork checks use disposable caches and synthetic provider responses. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {WatchArtwork} from '../server/watch-artwork.mjs';
import {movie} from '../plugins/movies/server/provider.mjs';
import {normalizeLibrary,libraryIdentity,libraryOptions} from '../plugins/emby/server/library.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const jpeg=Buffer.from([255,216,255,224,1,2,3,255,217]);
async function fixture(t,{fetchImpl}={}){
 const base=path.resolve('tests/.tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'watch-art-'));
 const config={enabled:true,revision:1,settings:{source:'discover',region:'FI',language:'en-US',genres:'',genre:'','api-token':'PRIVATE-TMDB'}};
 const film=movie({id:12,title:'A movie',poster_path:'/poster_12.jpg',backdrop_path:'/backdrop12.jpg'}),state={catalog:[film],identity:digest(['discover','FI','en-US','','PRIVATE-TMDB'])};
 const values={'pick-1-title':{available:true,type:'string',value:film.title},'pick-1-url':{available:true,type:'string',value:film.url}};
 let calls=0;const registry={get(id){if(!['movies','emby'].includes(id))throw Error();return {config:{snapshot:()=>config},state:{snapshot:()=>state}};},cardSource:()=>({cardData:{values}})},gate={paused:false};
 const cache=new WatchArtwork(root,registry,gate,{fetchImpl:async(...args)=>{calls++;return fetchImpl?fetchImpl(...args):new Response(jpeg,{headers:{'content-type':'image/jpeg'}});}});
 t.after(async()=>{cache.close();await Promise.allSettled([...cache.pending.values()]);await cache.queue.catch(()=>{});assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
 return {root,config,state,values,cache,gate,film,calls:()=>calls,read:async(kind='poster')=>{const item=cache.choices('movies')[0];return cache.read('movies',item.key,kind);}};
}
test('provider normalizers keep bounded image references and strip arbitrary paths and credentials',()=>{
 const item=movie({id:1,title:'Film',poster_path:'https://foreign.test/key',backdrop_path:'/safe-file.jpg'});assert.equal(item.posterPath,undefined);assert.equal(item.backdropPath,'/safe-file.jpg');
 const library=normalizeLibrary({Items:[{Id:'abc',Name:'Film',Type:'Movie',ImageTags:{Primary:'safeTag'},BackdropImageTags:['backTag'],Path:'PRIVATE',UserData:{},MediaSources:[]}]},50);
 assert.equal(library.items[0].posterTag,'safeTag');assert.equal(library.items[0].backdropTag,'backTag');assert.doesNotMatch(JSON.stringify(library),/PRIVATE|UserData|MediaSources/);
});
test('artwork descriptors are local, current-pick-only and selected Card projections omit hidden picks',async t=>{
 const f=await fixture(t);const art=f.cache.describe('movies','A movie');assert.match(art.poster,/^\/api\/watch-art\/movies\/[a-f0-9]{40}\/poster.jpg$/);assert.doesNotMatch(JSON.stringify(art),/PRIVATE|tmdb.org|poster_12/);assert.equal(f.cache.describe('movies','Other film'),null);
 const view={vista:{presentation:{type:'today'}},cards:[{pluginId:'movies',card:{layout:'readymade'},data:{values:{'pick-1-title':f.values['pick-1-title']}}},{pluginId:'movies',card:{layout:'readymade'},data:{values:{}}}]};f.cache.decorate(view);assert.equal(Object.keys(view.cards[0].data.todayArtwork).length,1);assert.equal(Object.keys(view.cards[1].data.todayArtwork).length,0);
 assert.equal(f.cache.decorate({vista:{},cards:view.cards}).cards[0].data,view.cards[0].data);assert.equal(f.calls(),0);
 f.config.settings.region='US';assert.equal(f.cache.describe('movies','A movie'),null);f.config.settings.region='FI';f.config.enabled=false;assert.equal(f.cache.describe('movies','A movie'),null);
});
test('fixed TMDB image target, one-flight caching and pause never create a metadata request',async t=>{
 const f=await fixture(t,{fetchImpl:async(url,options)=>{assert.equal(url,'https://image.tmdb.org/t/p/w342/poster_12.jpg');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);return new Response(jpeg,{headers:{'content-type':'image/jpeg'}});}});
 const [a,b]=await Promise.all([f.read(),f.read()]);assert.deepEqual(a,jpeg);assert.deepEqual(b,jpeg);assert.equal(f.calls(),1);f.gate.paused=true;assert.deepEqual(await f.read(),jpeg);assert.equal(f.calls(),1);await assert.rejects(f.read('backdrop'),/unavailable/);assert.equal(f.calls(),1);
 const key=f.cache.choices('movies')[0].key;await assert.rejects(f.cache.read('movies','0'.repeat(40),'poster'),/unavailable/);await assert.rejects(f.cache.read('movies',key,'../../config'),/unavailable/);
});
test('image failures cool down without retries and reject non-images, oversized data and redirects',async t=>{
 const f=await fixture(t,{fetchImpl:async()=>new Response('<svg>not a JPEG</svg>',{headers:{'content-type':'image/jpeg'}})});await assert.rejects(f.read(),/unavailable/);await assert.rejects(f.read(),/unavailable/);assert.equal(f.calls(),1);
 f.config.revision++;await assert.rejects(f.read(),/unavailable/);assert.equal(f.calls(),2);
 const large=await fixture(t,{fetchImpl:async()=>new Response(jpeg,{headers:{'content-type':'image/jpeg','content-length':'1572865'}})});await assert.rejects(large.read(),/unavailable/);
 const redirect=await fixture(t,{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://foreign.test/'}})});await assert.rejects(redirect.read(),/unavailable/);
});
test('Emby uses only its configured private server and header token, with source-bound cache keys',async t=>{
 const f=await fixture(t,{fetchImpl:async(url,options)=>{const target=new URL(url);assert.equal(target.origin,'http://127.0.0.1:8096');assert.equal(target.pathname,'/emby/Items/abc/Images/Primary');assert.equal(options.headers['X-Emby-Token'],'PRIVATE_EMBY_123456789');assert.ok(!url.includes('PRIVATE'));return new Response(jpeg,{headers:{'content-type':'image/jpeg'}});}});
 f.config.settings={'server-url':'http://127.0.0.1:8096','api-key':'PRIVATE_EMBY_123456789','poll-minutes':1,'library-suggestions':true,'library-limit':100};
 const connection={url:'http://127.0.0.1:8096/emby/Sessions',token:f.config.settings['api-key']};
 f.state.library={identity:libraryIdentity(connection,libraryOptions(f.config.settings))};f.state.libraryPicks=[{id:'abc',title:'A movie',url:'http://127.0.0.1:8096/web/index.html#!/item?id=abc',posterTag:'tag'}];f.values['pick-1-url'].value=f.state.libraryPicks[0].url;
 const choice=f.cache.choices('emby')[0];assert.ok(choice);await f.cache.read('emby',choice.key,'poster');assert.equal(f.calls(),1);
 f.config.settings['api-key']='OTHER_PRIVATE_KEY_123456';assert.equal(f.cache.choices('emby').length,0);f.config.settings['server-url']='https://public.example';assert.equal(f.cache.choices('emby').length,0);
});
test('late changed-source results are discarded and closing aborts pending downloads',async t=>{
 let finish;const f=await fixture(t,{fetchImpl:()=>new Promise(resolve=>{finish=resolve;})}),pending=f.read();while(!finish)await new Promise(resolve=>setImmediate(resolve));f.config.enabled=false;finish(new Response(jpeg,{headers:{'content-type':'image/jpeg'}}));await assert.rejects(pending,/unavailable/);
 assert.deepEqual(await fs.readdir(path.join(f.root,'data')).catch(()=>[]),[]);
 let abort;const closed=await fixture(t,{fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>{abort=()=>reject(Error('Cancelled'));signal.addEventListener('abort',abort,{once:true});})});const loading=closed.read();while(!abort)await new Promise(resolve=>setImmediate(resolve));closed.cache.close();await assert.rejects(loading,/unavailable/);
});
