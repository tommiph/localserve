/** Bind prebuilt clients to their first-party inputs without installing an SDK
 * on a consumer PC. Signing keys, build folders and saved preferences are excluded. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const androidPackages=Object.freeze([
  {folder:'plugins/downloads-inbox/android',apk:'sormus-downloads.apk'},
  {folder:'plugins/sensors/android',apk:'localserve-sensors.apk'},
  {folder:'plugins/oculus-go/android',apk:'localserve-go.apk'},
]);
export async function androidSourceReceipt(root,relative) {
  const app=path.resolve(root,relative),files=[];
  async function shared(name){const file=path.join(root,name),stat=await fs.lstat(file);if(stat.isSymbolicLink())throw Error('Shared Android inputs cannot be links.');if(stat.isDirectory())for(const child of (await fs.readdir(file)).sort())await shared(name+'/'+child);else if(stat.isFile())files.push({path:'@shared/'+name,sha256:hash(await fs.readFile(file))});}
  if(!app.startsWith(path.resolve(root)+path.sep))throw Error('Invalid Android source root.');
  async function visit(name){
    const file=path.join(app,name);let stat;
    try{stat=await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(stat.isSymbolicLink())throw Error('Android source inputs cannot be links.');
    if(stat.isDirectory())for(const child of (await fs.readdir(file)).sort())await visit(name+'/'+child);
    else if(stat.isFile())files.push({path:name,sha256:hash(await fs.readFile(file))});
  }
  for(const name of ['AndroidManifest.xml','build.mjs','app.json','vendor/lock.json','src','res','assets','native'])await visit(name);
  if(['apps/scenes','plugins/sensors/android'].includes(relative))await shared('apps/shared/android');
  if(['apps/scenes','plugins/sensors/android'].includes(relative))for(const name of ['catalog.json','material-symbols-outlined.ttf','LICENSE.txt'])await shared('assets/material-symbols/'+name);
  if(relative==='plugins/sensors/android')for(const name of ['web/scene-selector.html','web/scene-selector.css','assets/material-symbols/material-symbols.css'])await shared(name);
  return {algorithm:'sha256',files:files.length,digest:hash(JSON.stringify(files.sort((a,b)=>a.path.localeCompare(b.path,'en'))))};
}
export async function verifyAndroidPackage(root,entry) {
  const app=path.join(root,entry.folder),meta=JSON.parse(await fs.readFile(path.join(app,'dist/verification.json'),'utf8'));
  const actual=await androidSourceReceipt(root,entry.folder);
  if(JSON.stringify(actual)!==JSON.stringify(meta.sourceReceipt))throw Error('Rebuild '+entry.folder+': APK source inputs changed.');
  const bytes=await fs.readFile(path.join(app,'dist',entry.apk));
  if(hash(bytes)!==meta.sha256)throw Error('APK bytes differ from their verification: '+entry.folder);
  const manifest=await fs.readFile(path.join(app,'AndroidManifest.xml'),'utf8');
  if(!manifest.includes('android:versionName="'+meta.version+'"'))throw Error('APK source version differs: '+entry.folder);
  return meta;
}
