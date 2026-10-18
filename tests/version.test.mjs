/** Version checks use disposable metadata/stores, without providers or devices. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {nextVersion,initializeVersions,checkVersions,bumpVersion} from '../tools/version.mjs';
import {createLocalserve,defaultConfig,serverVersion} from '../server.mjs';

async function fixture(t,beforeRemove=async()=>{}){
  const base=fileURLToPath(new URL('./.tmp/',import.meta.url));await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'versions-'));
  t.after(async()=>{await beforeRemove();assert.ok(path.resolve(root).startsWith(path.resolve(base)+path.sep));await fs.rm(root,{recursive:true,force:true});});
  return root;
}

test('version increments reset lower parts and reject ambiguous formats',()=>{
  assert.equal(nextVersion('1.2.3','patch'),'1.2.4');assert.equal(nextVersion('1.2.3','minor'),'1.3.0');assert.equal(nextVersion('1.2.3','major'),'2.0.0');
  for(const version of ['1','v1.2.3','01.2.3','1.2.3-extra'])assert.throws(()=>nextVersion(version));
  assert.throws(()=>nextVersion('1.2.3','unknown'));
});

test('server and plugin metadata advance independently with append-only entries and drift checks',async t=>{
  const root=await fixture(t),plugin=path.join(root,'plugins/example');await fs.mkdir(plugin,{recursive:true});
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'0.2.0',name:'localserve'}));
  await fs.writeFile(path.join(plugin,'declaration.json'),JSON.stringify({id:'example',version:'1.0.0',settings:[]}));
  await initializeVersions(root);await assert.rejects(initializeVersions(root));
  await bumpVersion(root,'server','patch','Show installed version');await bumpVersion(root,'example','minor','Add a new action');
  assert.deepEqual(await checkVersions(root),{server:'0.2.1',example:'1.1.0'});
  const history=JSON.parse(await fs.readFile(path.join(root,'VERSION-HISTORY.json')));assert.equal(history.changes.length,2);assert.equal(history.changes[0].from,'0.2.0');assert.equal(history.changes[1].from,'1.0.0');assert.equal(history.baseline.example,'1.0.0');
  await assert.rejects(bumpVersion(root,'../config','patch','Bad target'));await assert.rejects(bumpVersion(root,'example','register','Already tracked'));await assert.rejects(bumpVersion(root,'server','patch',' '));
  await fs.writeFile(path.join(plugin,'declaration.json'),JSON.stringify({id:'example',version:'1.2.0'}));await assert.rejects(checkVersions(root));await assert.rejects(bumpVersion(root,'example','patch','Untracked drift'));
});

test('new plugins register their own version without changing existing components',async t=>{
  const root=await fixture(t);await fs.mkdir(path.join(root,'plugins'));await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.0.0'}));await initializeVersions(root);
  const plugin=path.join(root,'plugins/new-plugin');await fs.mkdir(plugin);await fs.writeFile(path.join(plugin,'declaration.json'),JSON.stringify({id:'new-plugin',version:'1.0.0'}));
  await assert.rejects(checkVersions(root));await bumpVersion(root,'new-plugin','register','Add plugin');assert.deepEqual(await checkVersions(root),{server:'1.0.0','new-plugin':'1.0.0'});
});

test('API reports installed server version despite stale settings and keeps it read-only',async t=>{
  let app;const root=await fixture(t,()=>app?.close()),preferences={...defaultConfig,version:'0.0.1',name:'My server'};await fs.writeFile(path.join(root,'config.json'),JSON.stringify(preferences));
  app=await createLocalserve(root,{automatic:false});
  const state=await fetch(app.origin+'/api/state').then(response=>response.json());assert.equal(state.config.version,serverVersion);assert.equal(state.config.name,'My server');
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'config.json'))).version,'0.0.1');
  const response=await fetch(app.origin+'/api/config',{method:'POST',headers:{Origin:app.origin,'X-Localserve-Token':state.token,'Content-Type':'application/json'},body:JSON.stringify({version:'99.0.0'})});assert.equal(response.status,400);assert.equal(app.snapshot().config.version,serverVersion);
});
