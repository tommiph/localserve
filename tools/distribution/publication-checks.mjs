/** Publication gates are pure checks so failed or mismatched evidence cannot
 * silently fall through to promotion or public download release. */
import assert from 'node:assert/strict';
export function checkReady(ready,preparation,startup,version) {
  assert.equal(ready.version,version);
  for(const key of ['archiveVerified','privateStateExcluded','sourceTestsPassed','cleanStartupVerified','existingSettingsPreserved','liveDefinitionsUnchanged','installerVerified'])assert.equal(ready[key],true,key);
  assert.equal(ready.indexTree,preparation.indexTree);assert.equal(ready.sha256,preparation.archiveSha256);
  assert.equal(startup.indexTree,ready.indexTree);assert.equal(startup.archiveSha256,ready.sha256);assert.equal(startup.files,preparation.files);
  for(const key of ['sourceTestsPassed','firstStartInitialized','existingSettingsPreserved'])assert.equal(startup[key],true,key);
  assert.equal(startup.smoke.windowsStartupUnchanged,true);
}
export function checkWindowsRun(run,commit,branch) {
  assert.equal(run.path,'.github/workflows/windows.yml');assert.equal(run.head_sha,commit);assert.equal(run.head_branch,branch);
  assert.equal(run.event,'push');assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
  return run;
}
export function checkRemoteTree(tree,entries) {
  assert.equal(tree.truncated,false);const blobs=tree.tree.filter(item=>item.type==='blob');assert.equal(blobs.length,entries.length);
  const paths=new Map(blobs.map(item=>[item.path,item]));
  for(const entry of entries){assert.equal(paths.get(entry.path)?.sha,entry.sha,entry.path);assert.equal(paths.get(entry.path)?.mode,entry.mode,entry.path);}
}
export function checkAssets(release,files,{tag,commit}) {
  assert.equal(release.tag_name,tag);assert.equal(release.target_commitish,commit);assert.equal(release.prerelease,true);assert.equal(release.assets.length,files.length);
  for(const file of files){const asset=release.assets.find(item=>item.name===file.name);assert.ok(asset,file.name);assert.equal(asset.state,'uploaded');assert.equal(asset.size,file.bytes);assert.equal(asset.digest,'sha256:'+file.sha256);}
}
