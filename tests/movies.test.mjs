/** Movie tests use synthetic metadata or the local starter collection only. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {createMovies} from '../plugins/movies/server/index.mjs';import {readMovies} from '../plugins/movies/server/provider.mjs';
import {validateDeclaration} from '../server/plugins.mjs';import {validateValues} from '../server/plugin-schema.mjs';import {createLocalserve} from '../server.mjs';
const at=Date.parse('2026-10-27T12:00:00Z');
async function defaults(){const declaration=validateDeclaration(JSON.parse(await fs.readFile('plugins/movies/declaration.json','utf8')));return {declaration,settings:validateValues(declaration.settings,{},true)};}
async function fixture(options={}){
  let clock=at,state={},calls=0;const {settings}=await defaults(),configured={...settings,...options.settings};
  const adapter=createMovies({now:()=>clock,fetchImpl:async(...args)=>{calls++;return options.fetchImpl?options.fetchImpl(...args):(()=>{throw Error('Unexpected network');})();}});
  await adapter.start(configured);const context={signal:new AbortController().signal,readState:async()=>structuredClone(state),saveState:async value=>{state=structuredClone(value);}};
  return {adapter,context,settings:configured,state:()=>state,calls:()=>calls,advance:ms=>{clock+=ms;}};
}
test('starter daily picks work without credentials or startup/network side effects',async()=>{
  const f=await fixture();assert.equal(f.calls(),0);assert.deepEqual(f.state(),{});await f.adapter.execute('refresh',{},f.context);
  assert.equal(f.state().dailyPicks.length,4);assert.equal(new Set(f.state().dailyPicks.map(movie=>movie.id)).size,4);assert.equal(f.state()['pick-day'],'2026-10-27');
  const first=f.state().dailyPicks.map(movie=>movie.id);await f.adapter.execute('refresh',{},f.context);assert.deepEqual(f.state().dailyPicks.map(movie=>movie.id),first);
  f.advance(86400000);await f.adapter.execute('refresh',{},f.context);assert.equal(f.state()['pick-day'],'2026-10-28');assert.equal(f.calls(),0);
});
test('genre filtering and watchlist/watched operations preserve saved films and survive restart',async()=>{
  const f=await fixture({settings:{genre:'Science-Fiction'}});await f.adapter.execute('refresh',{},f.context);assert.ok(f.state().dailyPicks.every(movie=>movie.genres.includes('Science-Fiction')));
  const id=f.state().dailyPicks[0].id;
  await f.adapter.execute('library',{'movie-id':id,operation:'save'},f.context);await f.adapter.execute('library',{'movie-id':id,operation:'save'},f.context);assert.equal(f.state().library.length,1);assert.equal(f.state()['saved-count'],1);
  await f.adapter.execute('library',{'movie-id':id,operation:'watched'},f.context);assert.equal(f.state()['watched-count'],1);assert.equal(f.state()['saved-count'],0);assert.ok(!f.state().dailyPicks.some(movie=>movie.id===id));
  const saved=structuredClone(f.state().library);await f.adapter.stop();await f.adapter.start(f.settings);await f.adapter.execute('refresh',{},f.context);assert.deepEqual(f.state().library,saved);
  await f.adapter.execute('library',{'movie-id':id,operation:'unwatched'},f.context);assert.equal(f.state()['saved-count'],1);await f.adapter.execute('library',{'movie-id':id,operation:'remove'},f.context);assert.equal(f.state().library.length,0);assert.equal(f.calls(),0);
});

test('multiple movie genres match any choice, preserve single preferences and use official OR discovery',async()=>{
 const f=await fixture({settings:{genre:'Drama',genres:'Science-Fiction,Comedy'}});await f.adapter.execute('refresh',{},f.context);
 assert.equal(f.state().dailyPicks.length,4);assert.ok(f.state().dailyPicks.every(movie=>movie.genres.some(genre=>['Science-Fiction','Comedy'].includes(genre))));
 assert.equal(f.adapter.validateConfiguration({...f.settings,genres:'Comedy,Comedy'}),false);assert.equal(f.adapter.validateConfiguration({...f.settings,genres:'Unknown'}),false);
 const all=await fixture({settings:{genre:'Drama',genres:''}});await all.adapter.execute('refresh',{},all.context);const defaults=await fixture();await defaults.adapter.execute('refresh',{},defaults.context);assert.deepEqual(all.state().dailyPicks,defaults.state().dailyPicks);
 await readMovies({...f.settings,source:'discover','api-token':'TEST'},'',new AbortController().signal,async url=>{assert.equal(new URL(url).searchParams.get('with_genres'),'35|878');return new Response('{"results":[]}');});
 assert.equal(f.calls(),0);
});
test('starter search and invalid history never cause network calls or a silent history reset',async()=>{
  const f=await fixture();const browse=await f.adapter.execute('search',{},f.context);assert.equal(browse.matches.length,16);const result=await f.adapter.execute('search',{query:'arrival'},f.context);assert.equal(result.scope,'starter');assert.equal(result.matches[0].title,'Arrival');assert.equal(f.calls(),0);
  f.state().library='broken';await assert.rejects(f.adapter.execute('refresh',{},f.context),/retained/);assert.equal(f.state().library,'broken');
});
test('explicit catalogue refresh bypasses the metadata cache while polling and cooldown remain bounded',async()=>{
 const f=await fixture({settings:{source:'popular','api-token':'TEST'},fetchImpl:async()=>new Response('{"results":[{"id":1,"title":"Film","poster_path":"/poster.jpg"}]}')});
 await f.adapter.execute('refresh',{},f.context);assert.equal(f.calls(),1);await f.adapter.execute('refresh',{},f.context);assert.equal(f.calls(),1);f.advance(2000);await f.adapter.execute('refresh-catalogue',{},f.context);assert.equal(f.calls(),2);assert.equal(f.state().catalog[0].posterPath,'/poster.jpg');await f.adapter.execute('refresh-catalogue',{},f.context);assert.equal(f.calls(),2);
 const {declaration}=await defaults();assert.equal(declaration.actions.find(action=>action.id==='refresh-catalogue').settingsOnly,true);
});
test('official API reads keep tokens in headers, filter adult results and reject oversized/aborted data',async()=>{
  const {settings}=await defaults();settings.source='popular';settings['api-token']='TEST-PRIVATE-TOKEN';
  const result=await readMovies(settings,'Arrival',new AbortController().signal,async(url,options)=>{
    const address=new URL(url);assert.equal(address.origin,'https://api.themoviedb.org');assert.equal(address.pathname,'/3/search/movie');assert.ok(!url.includes('TOKEN'));assert.equal(options.headers.Authorization,'Bearer TEST-PRIVATE-TOKEN');assert.equal(options.redirect,'error');
    return new Response(JSON.stringify({results:[{id:1,title:'Film',overview:'Description',genre_ids:[878],release_date:'2020-01-01',vote_average:7},{id:2,title:'Adult',adult:true}]}));
  });
  assert.equal(result.length,1);assert.equal(result[0].id,'tmdb-1');assert.deepEqual(result[0].genres,['Science-Fiction']);assert.ok(!JSON.stringify(result).includes('TOKEN'));
  await assert.rejects(readMovies(settings,'Test',new AbortController().signal,async()=>new Response('x'.repeat(1048577))),/limit/);
  const controller=new AbortController();controller.abort();await assert.rejects(readMovies(settings,'Test',controller.signal,async()=>new Response('[]')),/abort/i);
});
test('live metadata cache, provider cooldown and source changes never replay requests or lose saved movies',async()=>{
  let fail=false;const f=await fixture({settings:{source:'popular','api-token':'TEST-KEY'},fetchImpl:async()=>fail?new Response('',{status:429,headers:{'retry-after':'900'}}):new Response(JSON.stringify({results:[{id:1,title:'Film',overview:'Description',genre_ids:[878],release_date:'2020-01-01'}]}))});
  await f.adapter.execute('refresh',{},f.context);assert.equal(f.calls(),1);await f.adapter.execute('library',{'movie-id':'tmdb-1',operation:'save'},f.context);await f.adapter.execute('refresh',{},f.context);assert.equal(f.calls(),1);
  f.advance(6*3600000+1);fail=true;await assert.rejects(f.adapter.execute('refresh',{},f.context),/retained/);assert.equal(f.calls(),2);assert.equal(f.state().library.length,1);assert.equal(f.state().dailyPicks[0].title,'Film');assert.match(f.state()['pick-status'],/Cached/);
  await f.adapter.execute('refresh',{},f.context);assert.equal(f.calls(),2);await f.adapter.stop();await f.adapter.start({...f.settings,region:'US'});await f.adapter.execute('refresh',{},f.context);assert.equal(f.state().dailyPicks.length,0);assert.equal(f.state()['received-at'],null);assert.equal(f.state().library.length,1);
});
test('live sources require an owner token; runtime Card fields exclude private configuration and library details',async t=>{
  const {settings}=await defaults(),adapter=createMovies();assert.equal(adapter.validateConfiguration({...settings,source:'discover'}),false);
  const base=path.resolve('tests/.tmp');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'movies-'));
  await fs.cp('plugins/movies',path.join(root,'plugins/movies'),{recursive:true,filter:file=>!file.split(path.sep).includes('data')});
  const app=await createLocalserve(root,{automatic:false,listen:{host:'127.0.0.1',port:0}});t.after(async()=>{await app.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  const record=app.registry.get('movies');await app.registry.saveConfiguration('movies',{revision:record.config.snapshot().revision,enabled:true});await app.registry.execute('movies','refresh',{});
  const card=app.registry.cardSource('movies');assert.equal(card.cardData.values['pick-count'].value,4);assert.equal(card.cardData.values['daily-more'].value.length,3);assert.equal(card.cardData.readyMade.templates.length,2);assert.doesNotMatch(JSON.stringify(card),/api-token|library|TEST-KEY/);
  assert.ok(!app.registry.actions().some(action=>action.pluginId==='movies'&&action.actionId==='library'));
  const config=record.config.snapshot();await app.registry.saveConfiguration('movies',{revision:config.revision,settings:{...config.settings,genres:'Science-Fiction,Comedy'}});
  await app.registry.execute('movies','refresh',{});assert.equal(record.config.snapshot().settings.genres,'Science-Fiction,Comedy');assert.ok(record.state.snapshot().dailyPicks.every(movie=>movie.genres.some(genre=>['Science-Fiction','Comedy'].includes(genre))));
});
