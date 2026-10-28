/** Layout persistence checks use temporary files and never contact devices. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {HomeMap, emptyHomeMap, validateHomeMap, validateMapImage} from '../server/home-map.mjs';

const marker = () => ({id:'reading-lamp',name:'Reading lamp',icon:'lightbulb',enabled:true,x:25.5,y:75,
  target:{kind:'light',pluginId:'tradfri',slug:'lights',lightId:'1'}});

test('home map has an inert blank default and detached validated references', () => {
  const value = emptyHomeMap(); assert.equal(value.enabled,false); assert.equal(value.image,null);
  value.markers.push(marker()); const result=validateHomeMap(value);
  value.markers[0].target.lightId='2'; assert.equal(result.markers[0].target.lightId,'1');
  for (const target of [{kind:'group',pluginId:'tradfri',slug:'lights',groupId:'3'},
    {kind:'scene',pluginId:'tradfri',slug:'lights',itemId:'evening'},
    {kind:'remote',pluginId:'samsung-tv',slug:'remote'}, {kind:'task',taskId:'night'},
    {kind:'card',pluginId:'weather',templateId:'weather',sourceId:'home'}]) {
    assert.deepEqual(validateHomeMap({...emptyHomeMap(),markers:[{...marker(),target}]}).markers[0].target,target);
  }
});

test('home map rejects commands, paths, unsupported kinds and invalid geometry', () => {
  for (const target of [{...marker().target,parameters:{on:true}}, {...marker().target,url:'https://example.com'},
    {...marker().target,slug:'../../data'}, {kind:'toString'}, {kind:'unknown'}, {kind:'task',taskId:''}]) {
    assert.throws(()=>validateHomeMap({...emptyHomeMap(),markers:[{...marker(),target}]}));
  }
  for (const changes of [{x:NaN},{x:-1},{y:101},{enabled:1},{icon:'not-a-glyph'}, {name:'\n'}]) {
    assert.throws(()=>validateHomeMap({...emptyHomeMap(),markers:[{...marker(),...changes}]}));
  }
  assert.throws(()=>validateHomeMap({...emptyHomeMap(),markers:[marker(),marker()]}));
  assert.throws(()=>validateHomeMap({...emptyHomeMap(),markers:Array.from({length:129},(_,n)=>({...marker(),id:'m'+n}))}));
  const image={id:'a'.repeat(64)+'.png',width:1920,height:1080}; assert.deepEqual(validateMapImage(image),image);
  for (const changes of [{id:'../../plan.png'},{id:'a'.repeat(64)+'.svg'},{width:0},{height:8193},{width:8000,height:8000},{path:'secret'}]) {
    assert.throws(()=>validateMapImage({...image,...changes}));
  }
});

test('queued saves reject stale revisions, persist across restart and stop on close',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sormus-map-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const map=await new HomeMap(root).load(),first={...map.admin(),markers:[marker()]};
  const results=await Promise.allSettled([map.save(first),map.save({...first,name:'Other editor'})]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].reason.status,409);
  assert.equal(map.admin().revision,2);assert.equal(map.admin().name,'Home map');
  const copy=map.admin();copy.markers.length=0;assert.equal(map.admin().markers.length,1);
  await map.close();await assert.rejects(map.save(map.admin()),error=>error.status===503);
  const reopened=await new HomeMap(root).load();assert.deepEqual(reopened.admin(),map.admin());await reopened.close();
});

test('damaged and oversized stores remain untouched rather than resetting the map',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sormus-map-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'data'));const file=path.join(root,'data/home-map.json');
  for (const source of ['{broken',JSON.stringify({...emptyHomeMap(),markers:[{...marker(),x:999}]}),' '.repeat(256*1024+1)]) {
    await fs.writeFile(file,source);await assert.rejects(new HomeMap(root).load());assert.equal(await fs.readFile(file,'utf8'),source);
  }
});
