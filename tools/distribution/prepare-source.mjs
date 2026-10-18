/** Extract only a verified clean archive into a new, unpublished Git checkout.
 * No installed configuration is copied and no application is started here. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {assertPublicPath} from './boundary.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const archive=path.resolve(root,process.argv[2]||'');
assert.ok(archive.startsWith(path.join(root,'dist')+path.sep)&&archive.endsWith('.zip'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const checksum=hash(await fs.readFile(archive));
const verification=JSON.parse(await fs.readFile(archive+'.verification.json'));
assert.equal(verification.sha256,checksum); assert.equal(verification.archiveHashesVerified,true);
assert.equal(verification.privateStateExcluded,true); assert.equal(verification.smoke.windowsStartupUnchanged,true);
const execute=promisify(execFile);
const workspace=await fs.mkdtemp(path.join(root,'work/clean-source-'));
await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/distribution/archive.ps1'),'-Mode','Extract','-Source',archive,'-Destination',workspace],{windowsHide:true});
const checkout=path.join(workspace,'Localserve');
const manifest=JSON.parse(await fs.readFile(path.join(checkout,'DISTRIBUTION-MANIFEST.json')));
for(const entry of manifest.files){
  const file=path.resolve(checkout,entry.path);assert.ok(file.startsWith(checkout+path.sep));
  const bytes=await fs.readFile(file);assert.equal(bytes.length,entry.bytes);assert.equal(hash(bytes),entry.sha256);
}
// Even authored empty seeds stay untracked. Launchers create missing defaults.
for(const file of ['config.json','tray/settings.json','DISTRIBUTION-MANIFEST.json'])await fs.unlink(path.join(checkout,file));
await execute('git',['init','--initial-branch=main',checkout],{windowsHide:true});
async function git(...args){return (await execute('git',args,{cwd:checkout,windowsHide:true,maxBuffer:4*1024*1024})).stdout;}
await git('config','core.autocrlf','false');
await git('remote','add','origin','https://github.com/tommiph/localserve.git');
await git('add','--all');
const staged=(await git('ls-files','-z')).split('\0').filter(Boolean);
assert.equal(staged.length,manifest.files.length-2);
for(const file of staged){
  assertPublicPath(file);
  assert.ok(!file.split('/').some(part=>['data','private','.tmp'].includes(part)),file);
  assert.ok(!['config.json','tray/settings.json'].includes(file));
}
assert.ok(staged.includes('AGENTS.md')&&staged.includes('tests/source.test.mjs'));
const report={checkout:path.relative(root,checkout).split(path.sep).join('/'),archiveSha256:checksum,version:manifest.version,indexTree:(await git('write-tree')).trim(),files:staged.length,bytes:0,generatedPrivateSeedsExcluded:true};
for(const file of staged)report.bytes+=(await fs.stat(path.join(checkout,file))).size;
await fs.writeFile(path.join(root,'work/github-source-preparation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
