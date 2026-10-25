/** Prepare verified release artifacts. This command has no publication step,
 * GitHub access, device calls or running-installation startup/shutdown. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)),run=promisify(execFile);
const withInstaller=process.argv.includes('--installer');
if(process.argv.slice(2).some(argument=>argument!=='--installer'))throw Error('Use optional --installer; preparation never publishes.');
await fs.mkdir(path.join(root,'work'),{recursive:true});
// Remove only the previous readiness receipt. A failed build must not leave an
// older snapshot advertised as the new feature ready for publication.
await fs.rm(path.join(root,'work/release-ready.json'),{force:true});
async function step(script,args=[]){
  console.log('Checking '+script);
  const result=await run(process.execPath,[script,...args],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024});
  return JSON.parse(result.stdout.trim());
}
await step('tools/version.mjs',['--check']);
console.log('Checking native tray build');
// Reuse only a source-bound, current executable. A running tray may lock the
// alternate build target; packaging must never stop the user's tray to rebuild.
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let nativeReady=false;
try{
  const receipt=JSON.parse((await fs.readFile(path.join(root,'tray/build-result.json'),'utf8')).replace(/^\uFEFF/,''));
  const version=JSON.parse(await fs.readFile(path.join(root,'package.json'))).version;
  nativeReady=receipt.version===version&&['tray/LocalserveTray.exe','tray/LocalserveTray.next.exe'].includes(receipt.binary)
    &&receipt.sourceSha256===hash(await fs.readFile(path.join(root,'tray/LocalserveTray.cs')))
    &&receipt.binarySha256===hash(await fs.readFile(path.join(root,receipt.binary)));
}catch{/* Missing or obsolete build receipts require a new native build. */}
if(!nativeReady)await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','tray/build.ps1','-OutputName','LocalserveTray.next.exe'],{cwd:root,windowsHide:true});
const build=await step('tools/distribution/build.mjs');
const verification=await step('tools/distribution/verify.mjs',[build.archive]);
const source=await step('tools/distribution/prepare-source.mjs',[build.archive]);
const startup=await step('tools/distribution/verify-source.mjs');
const installer=withInstaller?await step('tools/installer/build.mjs',[build.archive]):null;
const installerVerification=withInstaller?await step('tools/installer/verify.mjs',[installer.installer,build.archive]):null;
const receipt={schemaVersion:1,preparedAt:new Date().toISOString(),version:source.version,archive:build.archive,sha256:build.sha256,checkout:source.checkout,indexTree:source.indexTree,files:source.files,
  archiveVerified:verification.archiveHashesVerified,privateStateExcluded:verification.privateStateExcluded,sourceTestsPassed:startup.sourceTestsPassed,cleanStartupVerified:startup.firstStartInitialized,existingSettingsPreserved:startup.existingSettingsPreserved,liveDefinitionsUnchanged:build.liveDefinitionsUnchanged,installer:installer?.installer||null,installerVerified:Boolean(installerVerification),published:false};
await fs.writeFile(path.join(root,'work/release-ready.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
