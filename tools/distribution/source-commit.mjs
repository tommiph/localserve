/** Attach a checked source tree to its observed parent without replacing its
 * index or working files. Publication uses a normal non-forced push afterward. */
import assert from 'node:assert/strict';
export async function commitPreparedIndex(git,{indexTree,parent,messageFile}) {
  assert.equal(await git('write-tree'),indexTree,'The verified source index changed.');
  assert.equal(await git('diff','--name-only'),'','The verified source files changed.');
  const changed=!parent||(await git('rev-parse',parent+'^{tree}'))!==indexTree;
  if(!changed)return {commit:parent,changed:false};
  if(parent)await git('update-ref','refs/heads/main',parent);
  await git('commit','--file',messageFile);
  return {commit:await git('rev-parse','HEAD'),changed:true};
}
