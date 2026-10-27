/** Opt-in host Java checks using project-local tools, without a headset or SDK runtime. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const app=path.resolve(import.meta.dirname,'..'),root=path.resolve(app,'../../..');
const jdkRoot=path.join(root,'tools/android-build/jdk');
const jdks=(await fs.readdir(jdkRoot,{withFileTypes:true})).filter(entry=>entry.isDirectory());
if(jdks.length!==1)throw Error('Prepare one project-local Android JDK before running these checks.');
const jdk=path.join(jdkRoot,jdks[0].name,'bin'),base=path.join(app,'build');
await fs.mkdir(base,{recursive:true});const build=await fs.mkdtemp(path.join(base,'offline-')),execute=promisify(execFile);
try{
  const files=['src/org/localserve/go/LibraryItem.java','src/org/localserve/go/LibraryCatalog.java','test/OfflineLibraryTest.java','test/stubs/org/json/JSONObject.java','test/stubs/org/json/JSONArray.java'].map(file=>path.join(app,file));
  await execute(path.join(jdk,'javac.exe'),['-encoding','UTF-8','--release','8','-d',build,...files],{windowsHide:true});
  console.log((await execute(path.join(jdk,'java.exe'),['-cp',build,'org.localserve.go.OfflineLibraryTest'],{windowsHide:true})).stdout.trim());
}finally{
  if(path.dirname(build)!==base||!path.basename(build).startsWith('offline-'))throw Error('Unexpected test build directory.');
  await fs.rm(build,{recursive:true,force:true});
}
