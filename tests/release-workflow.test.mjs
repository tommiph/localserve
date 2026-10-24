/** Release checks use temporary Git repositories and never contact GitHub. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assertPublicPath} from '../tools/distribution/boundary.mjs';
import {commitPreparedIndex} from '../tools/distribution/source-commit.mjs';
const execute=promisify(execFile);

test('release boundary rejects private paths independently of ignore rules',()=>{
  for(const file of ['config.json','tray/settings.json','data/tasks.json','plugins/a/data/config.json','work/capture.png','reference/test.html','.env','server/.env.local','tools/github-cli/private/hosts.yml','tools/sunshine/config.json','tv-tizen/dist/app.wgt','plugins/sensors/android/build/file','assets/games/music/personal.mp3','private/key','secrets.json','../file','C:/Users/file','plugins\\a\\data\\state.json'])assert.throws(()=>assertPublicPath(file),file);
  for(const file of ['server.mjs','VERSION-HISTORY.json','plugins/a/declaration.json','plugins/a/admin/task-builder.js','plugins/sensors/android/dist/localserve-sensors.apk','assets/games/music/README.md','examples/controls/tradfri.json','tools/android-build/prepare.ps1','tools/android-build/README.md'])assert.doesNotThrow(()=>assertPublicPath(file),file);
  assert.throws(()=>assertPublicPath('tools/android-build/downloads/sdk.zip'));
  assert.doesNotThrow(()=>assertPublicPath('config.json',{seeds:true}));assert.throws(()=>assertPublicPath('data/tasks.json',{seeds:true}));
});

test('verified source updates preserve parent history and normal push rejects concurrent changes',async t=>{
  const base=fileURLToPath(new URL('./.tmp/',import.meta.url));await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'release-git-'));
  t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(base)+path.sep));await fs.rm(root,{recursive:true,force:true});});
  async function gitAt(cwd,...args){return (await execute('git',args,{cwd,windowsHide:true})).stdout.trim();}
  const remote=path.join(root,'remote.git'),first=path.join(root,'first'),prepared=path.join(root,'prepared');await fs.mkdir(first);await fs.mkdir(prepared);
  await gitAt(root,'init','--bare','--initial-branch=main',remote);
  for(const directory of [first,prepared]){await gitAt(directory,'init','--initial-branch=main');await gitAt(directory,'config','user.name','Release fixture');await gitAt(directory,'config','user.email','fixture@example.invalid');await gitAt(directory,'config','core.autocrlf','false');await gitAt(directory,'remote','add','origin',remote);}
  await fs.writeFile(path.join(first,'old.txt'),'old public source');await gitAt(first,'add','--all');await gitAt(first,'commit','-m','Initial source');await gitAt(first,'push','origin','HEAD:main');
  const parent=await gitAt(first,'rev-parse','HEAD');
  await fs.writeFile(path.join(prepared,'new.txt'),'new verified source');await gitAt(prepared,'add','--all');await gitAt(prepared,'fetch','--no-tags','origin','main');
  const git=(...args)=>gitAt(prepared,...args),indexTree=await git('write-tree'),messageFile=path.join(root,'message.txt');await fs.writeFile(messageFile,'Add a capability\n\nDescribe only the public source change.\n');
  await assert.rejects(commitPreparedIndex(git,{indexTree:'0'.repeat(40),parent,messageFile}));
  const result=await commitPreparedIndex(git,{indexTree,parent,messageFile});assert.equal(result.changed,true);assert.equal(await git('rev-parse','HEAD^'),parent);assert.equal(await git('ls-tree','--name-only','HEAD'),'new.txt');await git('push','origin','HEAD:main');
  assert.equal(await gitAt(remote,'rev-parse','main'),result.commit);
  assert.equal((await commitPreparedIndex(git,{indexTree,parent:result.commit,messageFile})).changed,false);
  // An independent writer advances the same main after the observed parent.
  await gitAt(first,'fetch','origin','main');await gitAt(first,'reset','--hard','FETCH_HEAD');await fs.writeFile(path.join(first,'other.txt'),'concurrent public change');await gitAt(first,'add','--all');await gitAt(first,'commit','-m','Concurrent source');await gitAt(first,'push','origin','HEAD:main');
  const concurrent=await gitAt(first,'rev-parse','HEAD');await fs.writeFile(path.join(prepared,'new.txt'),'another capability');await git('add','--all');await commitPreparedIndex(git,{indexTree:await git('write-tree'),parent:result.commit,messageFile});await assert.rejects(git('push','origin','HEAD:main'));assert.equal(await gitAt(remote,'rev-parse','main'),concurrent);
});
