/** Install a test-identity setup into an owned disposable folder. All plugins
 * stay off; current-user registration/shortcuts are removed by its uninstaller. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildInstaller} from './build.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),execute=promisify(execFile),setup=path.resolve(root,process.argv[2]||'');
assert.ok(setup.startsWith(path.join(root,'dist')+path.sep)&&setup.endsWith('-Setup.exe'));
const receipt=JSON.parse(await fs.readFile(setup+'.build.json','utf8'));assert.equal(receipt.sha256,createHash('sha256').update(await fs.readFile(setup)).digest('hex'));
const probe=await buildInstaller(process.argv[3],{test:true});assert.equal(probe.archiveSha256,receipt.archiveSha256);
const workspace=await fs.mkdtemp(path.join(root,'work/installer-check-')),installation=path.join(workspace,'Localserve ä (setup)'),probeFile=path.resolve(root,probe.installer);
const registry='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Localserve.Windows.InstallTest_is1';
const programs=(await execute('powershell.exe',['-NoProfile','-Command','[Environment]::GetFolderPath("Programs")'],{windowsHide:true})).stdout.trim();
const shortcut=path.join(programs,'Localserve Install Test/Localserve.lnk');
assert.equal(await fs.stat(shortcut).then(()=>true,()=>false),false,'An existing test shortcut must not be overwritten.');
let installed=false;
async function registryExists(){try{await execute('reg.exe',['query',registry],{windowsHide:true});return true;}catch(error){if(error.code===1)return false;throw error;}}
assert.equal(await registryExists(),false,'An existing installer test registration must not be replaced.');
async function runSetup(){await execute(probeFile,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/TASKS=',`/DIR=${installation}`,`/LOG=${path.join(workspace,'setup.log')}`],{cwd:workspace,windowsHide:true,timeout:180000});installed=true;}
const tray=async command=>JSON.parse((await execute(path.join(installation,'tray/LocalserveTray.exe'),[command],{cwd:workspace,windowsHide:true,timeout:45000})).stdout);
async function uninstall(purge=false){const file=path.join(installation,'uninstall/unins000.exe');await execute(file,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',...(purge?['/DELETEPRIVATE=1']:[])],{cwd:workspace,windowsHide:true,timeout:90000});installed=false;}
let report;
try{
  await runSetup();assert.equal(await registryExists(),true);assert.ok((await fs.stat(shortcut)).isFile());
  const configFile=path.join(installation,'config.json'),config=JSON.parse(await fs.readFile(configFile,'utf8'));
  assert.equal(config.listen.host,'127.0.0.1');assert.equal((await tray('--startup-status')).enabled,false);
  const start=await tray('--start'),state=await fetch(start.origin+'/api/state').then(response=>response.json());assert.ok(state.services.every(plugin=>!plugin.enabled));assert.equal(state.tasks.length,0);
  const foreign=path.join(workspace,'unowned');await fs.mkdir(foreign);await fs.writeFile(path.join(foreign,'keep.txt'),'preserve this file');
  await assert.rejects(execute(probeFile,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',`/DIR=${foreign}`],{cwd:workspace,windowsHide:true,timeout:30000}));
  assert.equal(await fs.readFile(path.join(foreign,'keep.txt'),'utf8'),'preserve this file');assert.equal((await tray('--status')).pid,start.pid);
  const linkTarget=path.join(workspace,'link-target'),link=path.join(installation,'data/link-check');await fs.mkdir(linkTarget);await fs.writeFile(path.join(linkTarget,'keep.txt'),'preserve linked target');await fs.symlink(linkTarget,link,'junction');
  try{await assert.rejects(execute(probeFile,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',`/DIR=${installation}`],{cwd:workspace,windowsHide:true,timeout:30000}));assert.equal(await fs.readFile(path.join(linkTarget,'keep.txt'),'utf8'),'preserve linked target');}
  finally{assert.ok(link.startsWith(workspace+path.sep));assert.equal((await fs.lstat(link)).isSymbolicLink(),true);await fs.unlink(link);}
  const privateFile=path.join(installation,'data/install-retention-test.json');await fs.writeFile(privateFile,'{"preserve":true}\n');
  await fs.writeFile(configFile,JSON.stringify({...config,name:'Retain settings'}));const settingsBytes=await fs.readFile(configFile,'utf8');
  await runSetup();assert.equal((await tray('--status')).running,false);assert.equal(await fs.readFile(configFile,'utf8'),settingsBytes);assert.equal(await fs.readFile(privateFile,'utf8'),'{"preserve":true}\n');
  await tray('--start');await uninstall();assert.equal(await registryExists(),false);assert.equal(await fs.stat(shortcut).then(()=>true,()=>false),false);assert.equal(await fs.readFile(configFile,'utf8'),settingsBytes);assert.equal(await fs.readFile(privateFile,'utf8'),'{"preserve":true}\n');
  await runSetup();assert.equal(await fs.readFile(configFile,'utf8'),settingsBytes);await uninstall(true);assert.equal(await registryExists(),false);
  assert.equal(await fs.stat(configFile).then(()=>true,()=>false),false);assert.equal(await fs.stat(path.join(installation,'data')).then(()=>true,()=>false),false);
  report={checkedAt:new Date().toISOString(),installer:path.relative(root,setup).replaceAll('\\','/'),sha256:receipt.sha256,testIdentity:true,freshInstall:true,shortcutsCreatedAndRemoved:true,runningServerUpgrade:true,settingsPreserved:true,unownedFolderRejected:true,directoryLinksRejected:true,uninstallKeepsData:true,reinstallPreservesData:true,explicitPurge:true,registrationRemoved:true,windowsStartupChanged:false,firewallChanged:false,providerOrDeviceActions:0,cleanWindowsVm:false,signed:false};
}finally{
  if(installed||(await fs.stat(path.join(installation,'uninstall/unins000.exe')).then(()=>true,()=>false)&&await fs.stat(path.join(installation,'data/installation.json')).then(()=>true,()=>false))){await tray('--stop-and-exit').catch(()=>{});await uninstall();}
  assert.ok(workspace.startsWith(path.join(root,'work/installer-check-')));await fs.rm(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
await fs.writeFile(setup+'.verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
