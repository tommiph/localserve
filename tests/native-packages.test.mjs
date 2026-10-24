/** Source-bound package receipts require no device, signing key or Android SDK. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {androidPackages,androidSourceReceipt,verifyAndroidPackage} from '../tools/android-build/source-receipt.mjs';
const root=path.resolve(import.meta.dirname,'..');
for(const entry of androidPackages)test(entry.folder+' APK matches current source and verified bytes',async()=>{
  const meta=await verifyAndroidPackage(root,entry);assert.match(meta.sourceReceipt.digest,/^[a-f0-9]{64}$/);assert.ok(meta.sourceReceipt.files>0);
});
test('native source binding excludes output/private state and detects changed inputs',async t=>{
  const base=path.join(root,'tests/.tmp');await fs.mkdir(base,{recursive:true});const fixture=await fs.mkdtemp(path.join(base,'native-source-'));
  t.after(()=>fs.rm(fixture,{recursive:true,force:true}));
  const app=path.join(fixture,'app');await fs.mkdir(path.join(app,'src'),{recursive:true});
  await fs.writeFile(path.join(app,'AndroidManifest.xml'),'source');await fs.writeFile(path.join(app,'src','Example.java'),'class Example {}');
  const first=await androidSourceReceipt(fixture,'app');
  await fs.mkdir(path.join(app,'dist'));await fs.writeFile(path.join(app,'dist','private.txt'),'ignored');
  assert.deepEqual(await androidSourceReceipt(fixture,'app'),first);
  await fs.appendFile(path.join(app,'src','Example.java'),'\n// Current behavior');
  assert.notEqual((await androidSourceReceipt(fixture,'app')).digest,first.digest);
});
