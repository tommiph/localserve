import test from 'node:test';
import assert from 'node:assert/strict';
import {checkReady,checkWindowsRun,checkRemoteTree,checkAssets} from '../tools/distribution/publication-checks.mjs';

test('publication rejects incomplete, stale or mixed clean build evidence',()=>{
  const flags=['archiveVerified','privateStateExcluded','sourceTestsPassed','cleanStartupVerified','existingSettingsPreserved','liveDefinitionsUnchanged','installerVerified'];
  const ready={version:'1.0.0',indexTree:'tree',sha256:'zip',...Object.fromEntries(flags.map(key=>[key,true]))},preparation={indexTree:'tree',archiveSha256:'zip',files:3},startup={indexTree:'tree',archiveSha256:'zip',files:3,sourceTestsPassed:true,firstStartInitialized:true,existingSettingsPreserved:true,smoke:{windowsStartupUnchanged:true}};
  checkReady(ready,preparation,startup,'1.0.0');
  for(const key of flags)assert.throws(()=>checkReady({...ready,[key]:false},preparation,startup,'1.0.0'));
  assert.throws(()=>checkReady(ready,{...preparation,indexTree:'other'},startup,'1.0.0'));
  assert.throws(()=>checkReady(ready,preparation,{...startup,archiveSha256:'other'},'1.0.0'));
  assert.throws(()=>checkReady(ready,preparation,startup,'1.0.1'));
});
test('only a successful exact-commit Windows push check authorizes promotion',()=>{
  const run={path:'.github/workflows/windows.yml',head_sha:'commit',head_branch:'verify/test',event:'push',status:'completed',conclusion:'success'};
  checkWindowsRun(run,'commit','verify/test');
  for(const patch of [{head_sha:'other'},{head_branch:'main'},{path:'other.yml'},{event:'pull_request'},{status:'in_progress'},{conclusion:'failure'}])assert.throws(()=>checkWindowsRun({...run,...patch},'commit','verify/test'));
});
test('public source and downloads require every blob, mode, digest and size',()=>{
  const entries=[{path:'a',sha:'abc',mode:'100644'}],tree={truncated:false,tree:[{type:'blob',...entries[0]}]};checkRemoteTree(tree,entries);
  assert.throws(()=>checkRemoteTree({...tree,truncated:true},entries));assert.throws(()=>checkRemoteTree(tree,[{...entries[0],mode:'100755'}]));
  const files=[{name:'Setup.exe',bytes:10,sha256:'abc'}],release={tag_name:'v1-preview',target_commitish:'commit',prerelease:true,assets:[{name:'Setup.exe',size:10,state:'uploaded',digest:'sha256:abc'}]},identity={tag:'v1-preview',commit:'commit'};
  checkAssets(release,files,identity);
  for(const patch of [{target_commitish:'main'},{prerelease:false},{assets:[]},{assets:[{...release.assets[0],digest:'sha256:other'}]},{assets:[{...release.assets[0],size:9}]}])assert.throws(()=>checkAssets({...release,...patch},files,identity));
});
